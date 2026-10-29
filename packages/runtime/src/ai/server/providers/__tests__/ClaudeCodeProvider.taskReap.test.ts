// @vitest-environment node
/**
 * Every path that kills a query must reap its background sub-agent tasks
 * (NIM-2458, #1269).
 *
 * A background Task/Bash sub-agent runs inside the SDK subprocess. abort()
 * kills that subprocess, so the task's terminal `task_notification` can never
 * arrive. If it is left `status: 'running'` in `activeTasks`, the *next* turn's
 * `result` sees hasRunningTasks() === true and defers teardown to the drain
 * loop — the session stays 'running' and its queued prompts stall until the
 * drain grace expires. Observed as a ~5 minute stall on 2026-08-04.
 *
 * interruptCurrentTurn() leaves the same wreckage: the streaming loop breaks on
 * the interrupt, so no terminal notification can land afterwards, and the drain
 * that would otherwise reap never runs because an interrupt is not an abort.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', async () => ({
  app: { ...(await import('../../../../../../electron/test-stubs/privateUserData')).testApp, isPackaged: false },
}));

vi.mock('../claudeCode/cliPathResolver', () => ({
  resolveClaudeAgentCliPath: async () => '/fake/claude',
}));

vi.mock('../../../../electron/claudeCodeEnvironment', () => ({
  setupClaudeCodeEnvironment: () => ({}),
  resolveNativeBinaryPath: () => undefined,
}));

import { ClaudeCodeProvider } from '../ClaudeCodeProvider';

type ProviderInternals = {
  activeTasks: Map<string, {
    taskId: string;
    description: string;
    status: string;
    lastActivityAt?: number;
  }>;
  hasRunningTasks: () => boolean;
  handleSystemTask: (subtype: string, chunk: any, sessionId: string | undefined) => void;
  reapStalledSubagentTasks: (staleMs: number, sessionId: string | undefined) => void;
  leadQuery: unknown;
};

function seedTasks(state: ProviderInternals): void {
  state.activeTasks.set('bkxaizroy', {
    taskId: 'bkxaizroy',
    description: 'Block until suite finishes',
    status: 'running',
  });
  state.activeTasks.set('done', {
    taskId: 'done',
    description: 'Already finished',
    status: 'completed',
  });
}

function internals(provider: ClaudeCodeProvider): ProviderInternals {
  return provider as unknown as ProviderInternals;
}

describe('ClaudeCodeProvider background task reaping', () => {
  it('marks tasks orphaned by abort() stopped so the next turn does not defer teardown', () => {
    const provider = new ClaudeCodeProvider();
    const state = internals(provider);
    seedTasks(state);
    // Parked on a permission prompt is still alive: it must be reaped like a
    // running task, not mistaken for settled and left 'blocked' forever.
    state.activeTasks.set('waiting', {
      taskId: 'waiting',
      description: 'Awaiting permission',
      status: 'blocked',
    });

    expect(state.hasRunningTasks()).toBe(true);

    provider.abort();

    expect(state.hasRunningTasks()).toBe(false);
    expect(state.activeTasks.get('bkxaizroy')?.status).toBe('stopped');
    expect(state.activeTasks.get('waiting')?.status).toBe('stopped');
    // A task that already settled keeps its own terminal status.
    expect(state.activeTasks.get('done')?.status).toBe('completed');
  });

  it('marks tasks orphaned by interruptCurrentTurn() stopped', async () => {
    const provider = new ClaudeCodeProvider();
    const state = internals(provider);
    const interrupt = vi.fn(async () => {});
    state.leadQuery = { interrupt };
    seedTasks(state);

    const outcome = await provider.interruptCurrentTurn();

    expect(outcome.method).toBe('interrupt');
    expect(interrupt).toHaveBeenCalledTimes(1);
    expect(state.hasRunningTasks()).toBe(false);
    expect(state.activeTasks.get('bkxaizroy')?.status).toBe('stopped');
    expect(state.activeTasks.get('done')?.status).toBe('completed');
  });
});

/**
 * Concurrent sub-agents share ONE post-result grace timer, and it resets on
 * every chunk of any kind. With two draining at once, a healthy sibling's
 * chunks kept resetting it forever, so a genuinely stalled sibling was never
 * reaped. Per-task activity stamps make each one individually detectable.
 */
describe('ClaudeCodeProvider stalled sub-agent detection', () => {
  const GRACE_MS = 5 * 60_000;
  const T0 = 1_750_000_000_000;

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reaps a stalled sub-agent even while a healthy sibling keeps producing chunks', () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);

    const provider = new ClaudeCodeProvider();
    const state = internals(provider);
    state.handleSystemTask('task_started', { task_id: 'stalled', description: 'Never reports back' }, undefined);
    state.handleSystemTask('task_started', { task_id: 'healthy', description: 'Still working' }, undefined);

    // The healthy sibling streams progress across the whole grace window. In
    // production each of these chunks resets the shared timer, which is exactly
    // what used to mask the silent sibling.
    for (const offset of [2 * 60_000, 4 * 60_000, GRACE_MS + 1_000]) {
      vi.setSystemTime(T0 + offset);
      state.handleSystemTask('task_progress', { task_id: 'healthy', usage: { tool_uses: 3 } }, undefined);
      state.reapStalledSubagentTasks(GRACE_MS, undefined);
    }

    expect(state.activeTasks.get('stalled')?.status).toBe('stopped');
    expect(state.activeTasks.get('healthy')?.status).toBe('running');
    // The healthy sibling still holds the drain open.
    expect(state.hasRunningTasks()).toBe(true);
  });

  it('leaves a solo silent sub-agent to the existing shared grace timer', () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);

    const provider = new ClaudeCodeProvider();
    const state = internals(provider);
    state.handleSystemTask('task_started', { task_id: 'solo', description: 'Alone and silent' }, undefined);

    // No sibling, so no post-result chunk arrives to drive the per-task sweep.
    // Advancing past the window must not reap it early via some background
    // poller — the shared timer's teardown path still owns this case.
    vi.setSystemTime(T0 + GRACE_MS * 2);
    vi.advanceTimersByTime(GRACE_MS * 2);
    expect(state.activeTasks.get('solo')?.status).toBe('running');
    expect(state.hasRunningTasks()).toBe(true);

    // ...and that teardown path still reaps it, unchanged.
    provider.abort();
    expect(state.activeTasks.get('solo')?.status).toBe('stopped');
  });
});
