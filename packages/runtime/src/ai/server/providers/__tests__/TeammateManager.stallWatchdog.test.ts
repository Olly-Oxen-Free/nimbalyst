// @vitest-environment node
/**
 * Stall watchdog on the teammate stream.
 *
 * A wedged teammate subprocess emits no chunk, no error, and never ends its
 * iterator, so the streaming loop's await blocked forever: the teammate stayed
 * "running" and the architect waited on a report that was never coming. Same
 * bug class as NIM-1481, already fixed for the lead's own stream. These cover
 * the reap, the outcome it has to carry, and the two silences that must NOT be
 * reaped.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'os';
import path from 'path';

type StoredTeammate = { agentId: string; status: string };

let storedTeammates: StoredTeammate[] = [];

vi.mock('../../../../storage/repositories/AISessionsRepository', () => ({
  AISessionsRepository: {
    get: async () => ({ metadata: { currentTeammates: storedTeammates } }),
    updateMetadata: async (_sessionId: string, patch: { metadata: { currentTeammates: StoredTeammate[] } }) => {
      storedTeammates = patch.metadata.currentTeammates;
    },
  },
}));

const queryMock = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: unknown) => queryMock(args),
}));

// Keep the team-config writes out of the real ~/.claude.
vi.mock('../claudeCode/claudeConfigDir', () => ({
  resolveClaudeConfigDir: () => path.join(os.tmpdir(), 'nimbalyst-teammate-stall-watchdog-test'),
}));

import { TeammateManager, type IdleTeammate, type TeammateManagerDeps } from '../TeammateManager';

const STALL_MS = 60;
/** Comfortably past the stall window, so an armed watchdog would have fired. */
const PAST_STALL_MS = STALL_MS * 4;

const SDK_SESSION = 'sdk-session-1';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const systemChunk = { type: 'system', session_id: SDK_SESSION };
const toolUseChunk = {
  type: 'assistant',
  session_id: SDK_SESSION,
  message: { content: [{ type: 'tool_use', id: 'tool-1', name: 'Bash', input: {} }] },
};
const toolResultChunk = {
  type: 'user',
  session_id: SDK_SESSION,
  message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1' }] },
};
const resultChunk = { type: 'result', session_id: SDK_SESSION, result: 'all done' };

/**
 * Fake SDK query. Each step is `[silenceBeforeChunkMs, chunk]`. Once the steps
 * run out the iterator ends, or — with `wedge` — never settles again, which is
 * exactly what a hung subprocess looks like from inside the loop.
 */
function fakeQuery(steps: Array<[number, unknown]>, wedge = false) {
  let index = 0;
  return {
    [Symbol.asyncIterator]() {
      return this;
    },
    next: async (): Promise<IteratorResult<unknown>> => {
      if (index >= steps.length) {
        if (wedge) return new Promise<never>(() => {});
        return { value: undefined, done: true };
      }
      const [silenceMs, chunk] = steps[index++];
      if (silenceMs > 0) await sleep(silenceMs);
      return { value: chunk, done: false };
    },
  };
}

const immediate = (chunks: unknown[], wedge = false) =>
  fakeQuery(chunks.map(chunk => [0, chunk] as [number, unknown]), wedge);

function makeDeps() {
  return {
    logNonBlocking: vi.fn(),
    emit: vi.fn(),
    createPreToolUseHook: vi.fn(() => vi.fn()),
    createPostToolUseHook: vi.fn(() => vi.fn()),
    getAbortSignal: vi.fn(() => undefined),
    interruptWithMessage: vi.fn(async () => {}),
    createCanUseToolHandler: vi.fn(() => vi.fn()),
  } as unknown as TeammateManagerDeps & { emit: ReturnType<typeof vi.fn> };
}

type ManagerInternals = {
  resumeIdleTeammate(sessionId: string, agentId: string, idleInfo: IdleTeammate, prompt: string): void;
  deliverMessageToLead(
    sessionId: string | undefined,
    teammateAgentId: string,
    teammateName: string,
    content: string,
    summary: string,
  ): void;
  deliverRevivalFailure(
    sessionId: string | undefined,
    teammateAgentId: string,
    teammateName: string,
    reason: string,
  ): void;
};

const idleAlice: IdleTeammate = {
  teamName: 'team', name: 'alice', sessionId: SDK_SESSION, agentType: 'general-purpose',
  model: undefined, color: 'blue', cwd: os.tmpdir(), prompt: 'work',
};

/** Outcome carried by each teammates:allCompleted the manager emitted. */
const allCompletedOutcomes = (deps: { emit: ReturnType<typeof vi.fn> }) =>
  deps.emit.mock.calls
    .filter(([event]) => event === 'teammates:allCompleted')
    .map(([, payload]) => (payload as { outcome?: string }).outcome);

/** Status the emit path last persisted for a teammate. */
const statusOf = (agentId: string) => storedTeammates.find(tm => tm.agentId === agentId)?.status;

/** The abortController the manager handed the SDK for the only spawned query. */
const spawnedAbortSignal = () => (queryMock.mock.calls[0][0] as { options: { abortController: AbortController } })
  .options.abortController.signal;

const spawnAlice = (manager: TeammateManager) =>
  manager.spawnManagedTeammate('session-1', { team_name: 'team', name: 'alice', prompt: 'work' });

const resumeAlice = (manager: TeammateManager) =>
  (manager as unknown as ManagerInternals).resumeIdleTeammate('session-1', 'alice@team', idleAlice, 'more work');

beforeEach(() => {
  storedTeammates = [];
  queryMock.mockReset();
  process.env.NIMBALYST_CC_STREAM_STALL_MS = String(STALL_MS);
});

describe('TeammateManager stream stall watchdog', () => {
  it.each([
    ['a freshly spawned teammate', spawnAlice],
    ['a resumed idle teammate', resumeAlice],
  ])('reaps %s whose stream goes silent, and reports the batch as errored', async (_label, start) => {
    // One chunk, then the subprocess wedges: no chunk, no error, no end.
    queryMock.mockReturnValue(immediate([systemChunk], true));
    const deps = makeDeps();
    const manager = new TeammateManager(deps);

    start(manager);
    // Seed the roster the way a running teammate's first activity emit does —
    // the persisted status only tracks teammates the roster has already seen.
    await manager.emitTeammateUpdate('session-1');

    await vi.waitFor(() => expect(statusOf('alice@team')).toBe('errored'));
    // The distinct signal task 3a wired up: the host turns a non-clean outcome
    // into a failure notification instead of the completion chime.
    expect(allCompletedOutcomes(deps)).toEqual(['errored']);
    // The wedged subprocess is torn down rather than left running.
    expect(spawnedAbortSignal().aborted).toBe(true);
  });

  it('leaves a teammate that keeps producing chunks alone', async () => {
    queryMock.mockReturnValue(immediate([systemChunk, toolUseChunk, toolResultChunk, resultChunk]));
    const deps = makeDeps();
    const manager = new TeammateManager(deps);

    spawnAlice(manager);

    // Idle, not errored, and still resumable — so nothing is announced yet.
    await vi.waitFor(() => expect(statusOf('alice@team')).toBe('idle'));
    expect(allCompletedOutcomes(deps)).toEqual([]);
    expect(spawnedAbortSignal().aborted).toBe(false);
    // The per-chunk body still runs: output logged, completion logged.
    const loggedTypes = (deps.logNonBlocking as unknown as ReturnType<typeof vi.fn>).mock.calls
      .map(([, , , , metadata]) => (metadata as { messageType: string }).messageType);
    // The trailing teammate_message_to_lead is the idle handoff: going idle
    // without having SendMessage'd the lead now delivers the captured result.
    expect(loggedTypes).toEqual(['teammate_output', 'teammate_output', 'teammate_completed', 'teammate_message_to_lead']);
    // Each logged chunk (2 output + 1 result) fires exactly one live-update
    // signal for the popover (task 2b) to key its refetch off of, plus one
    // for the idle-handoff delivery.
    const transcriptUpdatedPayloads = deps.emit.mock.calls
      .filter(([event]) => event === 'teammate:transcriptUpdated')
      .map(([, payload]) => payload);
    expect(transcriptUpdatedPayloads).toEqual([
      { sessionId: 'session-1', agentId: 'alice@team' },
      { sessionId: 'session-1', agentId: 'alice@team' },
      { sessionId: 'session-1', agentId: 'alice@team' },
      { sessionId: 'session-1', agentId: 'alice@team' },
    ]);
  });

  it('does not reap a teammate that is silent because a tool is still running', async () => {
    // A long build or test run yields nothing until its tool_result comes back.
    queryMock.mockReturnValue(fakeQuery([
      [0, systemChunk],
      [0, toolUseChunk],
      [PAST_STALL_MS, toolResultChunk],
      [0, resultChunk],
    ]));
    const deps = makeDeps();
    const manager = new TeammateManager(deps);

    spawnAlice(manager);

    await vi.waitFor(() => expect(statusOf('alice@team')).toBe('idle'));
    expect(allCompletedOutcomes(deps)).toEqual([]);
    expect(spawnedAbortSignal().aborted).toBe(false);
  });

  it('does not reap a teammate that is silent because it owns an open permission prompt', async () => {
    // The teammate's tool result only lands once the user answers the prompt,
    // and the subprocess wedges afterwards.
    queryMock.mockReturnValue(fakeQuery([[0, systemChunk], [600, toolResultChunk]], true));
    const deps = makeDeps();
    const manager = new TeammateManager(deps);

    spawnAlice(manager);
    manager.markTeammatePermissionPending('session-1', 'alice', 'req-a');

    await vi.waitFor(() => expect(statusOf('alice@team')).toBe('blocked'));
    await sleep(PAST_STALL_MS);
    expect(allCompletedOutcomes(deps)).toEqual([]);
    expect(statusOf('alice@team')).toBe('blocked');

    // The user answers, the tool result arrives, and the watchdog re-arms — so
    // the disarm is per-iteration, not a one-way switch.
    manager.markTeammatePermissionResolved('session-1', 'req-a');
    await vi.waitFor(() => expect(statusOf('alice@team')).toBe('errored'), { timeout: 2000 });
    expect(allCompletedOutcomes(deps)).toEqual(['errored']);
  });
});

/**
 * The lead's idle-wake path re-drains this queue rather than reusing
 * `interruptWithMessage`'s formatted string, so the per-item `kind` is what
 * lets a batched wake say which entries were messages and which were revival
 * failures.
 */
describe('TeammateManager teammate-to-lead queue origin kind', () => {
  it('tags each queued delivery with its kind, preserving order across a mixed batch', () => {
    const manager = new TeammateManager(makeDeps());
    const internals = manager as unknown as ManagerInternals;

    internals.deliverMessageToLead(undefined, 'alice@team', 'alice', 'done', 'alice done');
    internals.deliverRevivalFailure(undefined, 'bob@team', 'bob', 'cwd missing');

    expect(manager.drainNextTeammateMessage()).toMatchObject({
      teammateAgentId: 'alice@team', teammateName: 'alice', kind: 'wake-message',
    });
    expect(manager.drainNextTeammateMessage()).toMatchObject({
      teammateAgentId: 'bob@team', teammateName: 'bob', kind: 'revival-failed',
    });
    expect(manager.hasPendingTeammateMessages()).toBe(false);
  });
});
