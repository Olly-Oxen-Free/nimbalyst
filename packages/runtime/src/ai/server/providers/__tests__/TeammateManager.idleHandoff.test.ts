// @vitest-environment node
/**
 * The teammate running -> idle transition dropping the handoff to the lead.
 *
 * A teammate that finished its turn without calling SendMessage went idle
 * silently: its answer sat in the idle record, the lead kept waiting, and a
 * killAll then reported every idle teammate as 'errored'. These cover the three
 * idle-notice cases (D7), the unchanged background-agent branch, killAll's
 * status split, and the activity counters that have to survive idle and resume.
 * Proves tasks 1a/1b/2a of the teammate-idle-handoff PRD.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'os';
import path from 'path';

type StoredTeammate = {
  agentId: string;
  status: string;
  toolCallCount?: number;
  lastActiveAt?: number;
  sessionId?: string;
  endReason?: string;
};

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
  resolveClaudeConfigDir: () => path.join(os.tmpdir(), 'nimbalyst-teammate-idle-handoff-test'),
}));

import { TeammateManager, type IdleTeammate, type TeammateManagerDeps } from '../TeammateManager';
import { TEAMMATE_CONTINUATION_MESSAGE } from '../ClaudeCodeProvider';

const SDK_SESSION = 'sdk-session-1';

const systemChunk = { type: 'system', session_id: SDK_SESSION };
const resultChunk = { type: 'result', session_id: SDK_SESSION, result: 'the roof needs replacing' };

/** Fake SDK query yielding `chunks`, then ending — or, with `wedge`, never settling again. */
function fakeQuery(chunks: unknown[], wedge = false) {
  let index = 0;
  return {
    [Symbol.asyncIterator]() {
      return this;
    },
    next: async (): Promise<IteratorResult<unknown>> => {
      if (index >= chunks.length) {
        if (wedge) return new Promise<never>(() => {});
        return { value: undefined, done: true };
      }
      return { value: chunks[index++], done: false };
    },
  };
}

type Deps = TeammateManagerDeps & {
  emit: ReturnType<typeof vi.fn>;
  logNonBlocking: ReturnType<typeof vi.fn>;
  interruptWithMessage: ReturnType<typeof vi.fn>;
};

function makeDeps(): Deps {
  return {
    logNonBlocking: vi.fn(),
    emit: vi.fn(),
    createPreToolUseHook: vi.fn(() => vi.fn()),
    createPostToolUseHook: vi.fn(() => vi.fn()),
    getAbortSignal: vi.fn(() => undefined),
    interruptWithMessage: vi.fn(async () => {}),
    createCanUseToolHandler: vi.fn(() => vi.fn()),
  } as unknown as Deps;
}

type ManagedEntry = { toolCallCount: number; lastActiveAt?: number; abort: { abort: () => void } };

type ManagerInternals = {
  managedTeammates: Map<string, ManagedEntry>;
  idleTeammates: Map<string, IdleTeammate>;
  resumeIdleTeammate(sessionId: string, agentId: string, idleInfo: IdleTeammate, prompt: string): void;
  handleStreamCompletion(
    sessionId: string | undefined,
    agentId: string,
    teamName: string,
    idleTemplate: unknown,
    result: {
      capturedSessionId?: string;
      approvedShutdown: boolean;
      capturedResultText?: string;
      sentMessageToLead: boolean;
    },
  ): void;
};

const internals = (manager: TeammateManager) => manager as unknown as ManagerInternals;

const idleTemplate = (agentId: string, extra: Partial<IdleTeammate> = {}): IdleTeammate => {
  const [name, teamName] = agentId.split('@');
  return {
    teamName, name, sessionId: SDK_SESSION, agentType: 'general-purpose',
    model: undefined, color: 'blue', cwd: os.tmpdir(), prompt: 'work', ...extra,
  };
};

/** Every teammate_message_to_lead chunk deliverMessageToLead logged, decoded. */
const delivered = (deps: Deps) =>
  deps.logNonBlocking.mock.calls
    .filter(([, , , , metadata]) => (metadata as { messageType: string }).messageType === 'teammate_message_to_lead')
    .map(([, , , payload]) => JSON.parse(payload as string) as {
      content: string; summary: string; _teammateName: string; _teammateAgentId: string;
    });

const statusOf = (agentId: string) => storedTeammates.find(tm => tm.agentId === agentId)?.status;

const rowOf = (agentId: string) => storedTeammates.find(tm => tm.agentId === agentId);

/** Wait out the 100ms emit debounce and the metadata write behind it. */
const settled = (expected: Record<string, string>) =>
  vi.waitFor(() => expect(
    Object.fromEntries(Object.keys(expected).map(id => [id, statusOf(id)]))
  ).toEqual(expected));

/** Take a teammate that finished its turn to idle, with the given stream result. */
const finishTurn = (
  manager: TeammateManager,
  agentId: string,
  result: { capturedResultText?: string; sentMessageToLead: boolean },
) => internals(manager).handleStreamCompletion('session-1', agentId, 'team', idleTemplate(agentId), {
  capturedSessionId: SDK_SESSION,
  approvedShutdown: false,
  ...result,
});

beforeEach(() => {
  storedTeammates = [];
  queryMock.mockReset();
  // Unlike the stall-watchdog file, nothing here should be reaped mid-test.
  delete process.env.NIMBALYST_CC_STREAM_STALL_MS;
});

describe('TeammateManager idle handoff to the lead', () => {
  it('hands the captured result to the lead when the teammate never messaged it', async () => {
    const deps = makeDeps();
    const manager = new TeammateManager(deps);
    internals(manager).managedTeammates.set('alice@team', { toolCallCount: 2 } as ManagedEntry);

    finishTurn(manager, 'alice@team', { capturedResultText: 'the roof needs replacing', sentMessageToLead: false });

    const [message, ...rest] = delivered(deps);
    expect(rest).toEqual([]);
    expect(message._teammateName).toBe('alice');
    expect(message.summary).toBe('alice idle');
    expect(message.content).toContain('the roof needs replacing');
    expect(message.content).toContain('"alice"');
    // The lead is actually woken, with the teammate named in the interruption.
    expect(deps.interruptWithMessage).toHaveBeenCalledTimes(1);
    expect(deps.interruptWithMessage.mock.calls[0][0]).toContain('[Teammate message from "alice"]');
    expect(deps.interruptWithMessage.mock.calls[0][0]).toContain('the roof needs replacing');
    await settled({ 'alice@team': 'idle' });
  });

  it('says so explicitly when the teammate went idle without reporting a result', async () => {
    const deps = makeDeps();
    const manager = new TeammateManager(deps);
    internals(manager).managedTeammates.set('alice@team', { toolCallCount: 0 } as ManagedEntry);

    finishTurn(manager, 'alice@team', { capturedResultText: undefined, sentMessageToLead: false });

    const [message, ...rest] = delivered(deps);
    expect(rest).toEqual([]);
    expect(message.summary).toBe('alice idle (no result)');
    expect(message.content).toContain('without reporting a result');
    expect(deps.interruptWithMessage).toHaveBeenCalledTimes(1);
    await settled({ 'alice@team': 'idle' });
  });

  it('delivers a bare idle notice, without the result body, to a lead the teammate already messaged', async () => {
    const deps = makeDeps();
    const manager = new TeammateManager(deps);
    internals(manager).managedTeammates.set('alice@team', { toolCallCount: 1 } as ManagedEntry);

    finishTurn(manager, 'alice@team', { capturedResultText: 'ALREADY-SENT-BODY', sentMessageToLead: true });

    const [message, ...rest] = delivered(deps);
    expect(rest).toEqual([]);
    expect(message.summary).toBe('alice idle');
    expect(message.content).toContain('is now idle');
    // Re-delivering it would duplicate the SendMessage the lead already has.
    expect(message.content).not.toContain('ALREADY-SENT-BODY');
    expect(deps.interruptWithMessage).toHaveBeenCalledTimes(1);
    expect(deps.interruptWithMessage.mock.calls[0][0]).not.toContain('ALREADY-SENT-BODY');
    await settled({ 'alice@team': 'idle' });
  });

  it('reaches the lead from a real stream, not just a hand-built completion result', async () => {
    queryMock.mockReturnValue(fakeQuery([systemChunk, resultChunk]));
    const deps = makeDeps();
    const manager = new TeammateManager(deps);

    manager.spawnManagedTeammate('session-1', { team_name: 'team', name: 'alice', prompt: 'work' });

    await settled({ 'alice@team': 'idle' });
    const [message, ...rest] = delivered(deps);
    expect(rest).toEqual([]);
    expect(message.content).toContain('the roof needs replacing');
  });

  it('persists a usable sessionId on a finished row even when the stream produces zero chunks (NIM revive-compose bug)', async () => {
    // A real stream that ends before yielding anything -- no session_id chunk
    // was ever emitted, the failure mode teammateComposeMode's 'inactive' gate
    // depends on. Seeded 'running' first, matching the fresh-spawn race guard
    // documented in resumeReliability.test.ts:302-308.
    storedTeammates = [{ agentId: 'alice@team', status: 'running' }];
    queryMock.mockReturnValue(fakeQuery([]));
    const deps = makeDeps();
    const manager = new TeammateManager(deps);

    manager.spawnManagedTeammate('session-1', { team_name: 'team', name: 'alice', prompt: 'work' });

    await settled({ 'alice@team': 'completed' });
    const row = rowOf('alice@team');
    expect(row?.endReason).toBe('finished');
    expect(row?.sessionId).toBeTruthy();
    // The persisted id is the one streamTeammateOutput assigned up front via
    // options.sessionId -- the SDK's own earliest-available identity for a
    // fresh spawn.
    expect(row?.sessionId).toBe(queryMock.mock.calls[0][0].options.sessionId);
  });

  it('leaves the background-agent branch delivering its raw result exactly once', async () => {
    const deps = makeDeps();
    const manager = new TeammateManager(deps);
    internals(manager).managedTeammates.set('bot@team', {
      name: 'bot', agentId: 'bot@team', teamName: 'team', agentType: 'general-purpose',
      toolCallCount: 0, isBackgroundAgent: true,
    } as unknown as ManagedEntry);
    await manager.emitTeammateUpdate('session-1');

    // No capturedSessionId: a background agent never goes idle, so only its own
    // branch can deliver — the idle notice must not fire alongside it.
    internals(manager).handleStreamCompletion('session-1', 'bot@team', 'team', idleTemplate('bot@team'), {
      capturedSessionId: undefined,
      approvedShutdown: false,
      capturedResultText: 'found the leak',
      sentMessageToLead: false,
    });

    expect(delivered(deps)).toEqual([expect.objectContaining({
      content: 'found the leak',
      summary: 'bot completed',
    })]);
    expect(deps.interruptWithMessage).toHaveBeenCalledTimes(1);
    await settled({ 'bot@team': 'completed' });
  });

  it('stays silent for a background agent that already messaged the lead', async () => {
    const deps = makeDeps();
    const manager = new TeammateManager(deps);
    internals(manager).managedTeammates.set('bot@team', {
      name: 'bot', agentId: 'bot@team', teamName: 'team', agentType: 'general-purpose',
      toolCallCount: 0, isBackgroundAgent: true,
    } as unknown as ManagedEntry);
    await manager.emitTeammateUpdate('session-1');

    internals(manager).handleStreamCompletion('session-1', 'bot@team', 'team', idleTemplate('bot@team'), {
      capturedSessionId: undefined,
      approvedShutdown: false,
      capturedResultText: 'found the leak',
      sentMessageToLead: true,
    });

    expect(delivered(deps)).toEqual([]);
    expect(deps.interruptWithMessage).not.toHaveBeenCalled();
    await settled({ 'bot@team': 'completed' });
  });
});

/**
 * killAll tears down both rosters at once. Reporting an idle teammate as
 * 'errored' told the user something failed when nothing had.
 */
describe('TeammateManager.killAll status split', () => {
  it('reports the running teammate as errored and the idle one as completed', async () => {
    const deps = makeDeps();
    const manager = new TeammateManager(deps);
    manager.lastUsedSessionId = 'session-1';
    const abort = vi.fn();
    internals(manager).managedTeammates.set('alice@team', {
      name: 'alice', agentId: 'alice@team', teamName: 'team', agentType: 'general',
      abort: { abort }, toolCallCount: 0,
    } as unknown as ManagedEntry);
    internals(manager).idleTeammates.set('bob@team', idleTemplate('bob@team'));
    await manager.emitTeammateUpdate('session-1');

    manager.killAll();

    await settled({ 'alice@team': 'errored', 'bob@team': 'completed' });
    expect(abort).toHaveBeenCalled();
  });
});

/**
 * The popover's tool-call count and last-activity time live only on the managed
 * entry while a teammate runs; going idle and resuming used to reset them to
 * zero, so a resumed teammate looked like it had never done anything.
 */
describe('TeammateManager idle activity counters', () => {
  const LAST_ACTIVE = 1_700_000_000_000;

  it('carries the count into a row the roster has never seen', async () => {
    const deps = makeDeps();
    const manager = new TeammateManager(deps);
    internals(manager).idleTeammates.set('alice@team', idleTemplate('alice@team', {
      toolCallCount: 7, lastActiveAt: LAST_ACTIVE,
    }));

    await manager.emitTeammateUpdate('session-1');

    expect(rowOf('alice@team')).toMatchObject({ status: 'idle', toolCallCount: 7, lastActiveAt: LAST_ACTIVE });
  });

  it('seeds a resume from the idle count and keeps the accumulated total on the way back to idle', async () => {
    // Wedged stream: the resume stays running until this test drives it to idle.
    queryMock.mockReturnValue(fakeQuery([systemChunk], true));
    const deps = makeDeps();
    const manager = new TeammateManager(deps);
    const idle = idleTemplate('alice@team', { toolCallCount: 3, lastActiveAt: LAST_ACTIVE });

    internals(manager).resumeIdleTeammate('session-1', 'alice@team', idle, 'more work');

    // Resume starts from the work already done, not from zero.
    expect(internals(manager).managedTeammates.get('alice@team')?.toolCallCount).toBe(3);
    await settled({ 'alice@team': 'running' });

    // Two more tool calls this turn, then the turn ends.
    const managed = internals(manager).managedTeammates.get('alice@team')!;
    managed.toolCallCount = 5;
    managed.lastActiveAt = LAST_ACTIVE + 1000;
    finishTurn(manager, 'alice@team', { capturedResultText: 'done', sentMessageToLead: false });
    await settled({ 'alice@team': 'idle' });

    // Any later emit re-reads the persisted row through the idle branch; it must
    // report the accumulated count, not the pre-resume one.
    await manager.emitTeammateUpdate('session-1');
    expect(rowOf('alice@team')).toMatchObject({ toolCallCount: 5, lastActiveAt: LAST_ACTIVE + 1000 });
  });
});

/**
 * The continuation message is the only thing standing between "teammates are
 * still working" and a lead that redoes their work itself while it waits.
 */
describe('TEAMMATE_CONTINUATION_MESSAGE', () => {
  it('tells the lead to wait and not duplicate teammate work, with no open-ended invitation to act', () => {
    expect(TEAMMATE_CONTINUATION_MESSAGE).toContain('Wait for their results');
    expect(TEAMMATE_CONTINUATION_MESSAGE).toContain('do not perform or duplicate the work you assigned');
    expect(TEAMMATE_CONTINUATION_MESSAGE).not.toMatch(/other actions/i);
  });
});
