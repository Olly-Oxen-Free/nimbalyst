// @vitest-environment node
/**
 * Per-sub-agent `blocked` status on ClaudeCodeProvider.
 *
 * SDK-native Task sub-agents all share the lead session's single `canUseTool`
 * callback, so a sub-agent parked on a permission prompt used to look exactly
 * like one that was busy working — every chip spun identically and the
 * architect had to scroll to find the one actually waiting on them.
 * `subagentToolCallOwners` attributes the prompt to a single `activeTasks`
 * entry; these cover that attribution, its release, and its failure mode.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: false },
}));

vi.mock('../claudeCode/cliPathResolver', () => ({
  resolveClaudeAgentCliPath: async () => '/fake/claude',
}));

vi.mock('../../../../electron/claudeCodeEnvironment', () => ({
  setupClaudeCodeEnvironment: () => ({}),
  resolveNativeBinaryPath: () => undefined,
}));

import { ClaudeCodeProvider } from '../ClaudeCodeProvider';

type PermissionResult = { behavior: 'allow' | 'deny'; updatedInput?: unknown; message?: string };
type PermissionOptions = { signal: AbortSignal; toolUseID?: string };
type CanUseTool = (toolName: string, input: unknown, options: PermissionOptions) => Promise<PermissionResult>;

type ProviderInternals = {
  activeTasks: Map<string, { taskId: string; description: string; toolUseId: string; status: string }>;
  subagentToolCallOwners: Map<string, string>;
  permissionService: unknown;
  emitTaskUpdate: (sessionId: string | undefined) => Promise<void>;
  resolveImmediateToolDecision: () => Promise<PermissionResult | null>;
  handleToolPermissionWithService: (
    toolName: string,
    input: unknown,
    options: PermissionOptions,
  ) => Promise<PermissionResult>;
  createCanUseToolHandler: (sessionId?: string, workspacePath?: string) => CanUseTool;
};

/**
 * Two concurrent sub-agents, each with one inner tool call already correlated
 * back to it. `prompt` stands in for the interactive permission path, so the
 * test can observe task statuses while a prompt is still open.
 */
function twoSubAgents(prompt: (options: PermissionOptions) => Promise<PermissionResult>) {
  const provider = new ClaudeCodeProvider();
  const state = provider as unknown as ProviderInternals;

  state.activeTasks.set('task-a', { taskId: 'task-a', description: 'Audit imports', toolUseId: 'toolu_taskA', status: 'running' });
  state.activeTasks.set('task-b', { taskId: 'task-b', description: 'Rewrite docs', toolUseId: 'toolu_taskB', status: 'running' });
  state.subagentToolCallOwners.set('toolu_bashA', 'toolu_taskA');
  state.subagentToolCallOwners.set('toolu_bashB', 'toolu_taskB');

  state.emitTaskUpdate = vi.fn(async () => {});
  // The blocked marker is only meant to be set once an interactive prompt is
  // certain, i.e. after the auto-allow/auto-deny short circuit declines.
  state.resolveImmediateToolDecision = async () => null;
  state.permissionService = {};
  state.handleToolPermissionWithService = (_toolName, _input, options) => prompt(options);

  return { state, canUseTool: state.createCanUseToolHandler('session-1', '/workspace') };
}

const statusOf = (state: ProviderInternals, taskId: string) => state.activeTasks.get(taskId)?.status;
const ask = (canUseTool: CanUseTool, toolUseID: string | undefined) =>
  canUseTool('Bash', { command: 'ls' }, { signal: new AbortController().signal, toolUseID });

describe('ClaudeCodeProvider sub-agent permission blocking', () => {
  it('blocks only the sub-agent awaiting permission and releases it once the prompt resolves', async () => {
    let whilePending: Record<string, string | undefined> = {};
    const { state, canUseTool } = twoSubAgents(async () => {
      whilePending = { a: statusOf(state, 'task-a'), b: statusOf(state, 'task-b') };
      return { behavior: 'allow' };
    });

    await ask(canUseTool, 'toolu_bashA');

    expect(whilePending).toEqual({ a: 'blocked', b: 'running' });
    expect(statusOf(state, 'task-a')).toBe('running');
    expect(statusOf(state, 'task-b')).toBe('running');
    // Both the block and the release must reach the UI's only write path.
    expect(state.emitTaskUpdate).toHaveBeenCalledTimes(2);
  });

  it('leaves every sub-agent running when the prompt cannot be attributed to one', async () => {
    const seen: Record<string, string | undefined>[] = [];
    const { state, canUseTool } = twoSubAgents(async () => {
      seen.push({ a: statusOf(state, 'task-a'), b: statusOf(state, 'task-b') });
      return { behavior: 'allow' };
    });

    // The lead session's own tool call, and a call whose correlation entry has
    // not been recorded yet (the canUseTool/streaming-loop race). Guessing an
    // owner here would blame an innocent sub-agent, so neither may block.
    await ask(canUseTool, 'toolu_leadOwnCall');
    await ask(canUseTool, undefined);

    expect(seen).toEqual([{ a: 'running', b: 'running' }, { a: 'running', b: 'running' }]);
    expect(state.emitTaskUpdate).not.toHaveBeenCalled();
  });

  it('does not resurrect a sub-agent that reached a terminal status while its prompt was open', async () => {
    const { state, canUseTool } = twoSubAgents(async () => {
      // A task_notification settles the task mid-prompt; that outcome must win
      // over the release back to 'running'.
      state.activeTasks.get('task-a')!.status = 'completed';
      return { behavior: 'deny', message: 'nope' };
    });

    await ask(canUseTool, 'toolu_bashA');

    expect(statusOf(state, 'task-a')).toBe('completed');
  });

  it('tracks two simultaneous prompts independently', async () => {
    const release: Record<string, () => void> = {};
    const { state, canUseTool } = twoSubAgents(
      (options) =>
        new Promise<PermissionResult>((resolve) => {
          release[options.toolUseID!] = () => resolve({ behavior: 'allow' });
        }),
    );

    const promptA = ask(canUseTool, 'toolu_bashA');
    const promptB = ask(canUseTool, 'toolu_bashB');
    await vi.waitFor(() => expect(release.toolu_bashB).toBeDefined());

    expect(statusOf(state, 'task-a')).toBe('blocked');
    expect(statusOf(state, 'task-b')).toBe('blocked');

    release.toolu_bashA();
    await promptA;
    expect(statusOf(state, 'task-a')).toBe('running');
    expect(statusOf(state, 'task-b')).toBe('blocked');

    release.toolu_bashB();
    await promptB;
    expect(statusOf(state, 'task-b')).toBe('running');
  });
});
