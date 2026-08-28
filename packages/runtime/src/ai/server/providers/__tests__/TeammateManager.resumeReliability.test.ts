// @vitest-environment node
/**
 * Resume-delivery reliability (PRD teammate-resume-reliability, tasks 1a/1b/1c).
 *
 * Resuming an idle teammate is fire-and-forget: `handlePreToolUse`'s SendMessage
 * routing acks the lead immediately, before the resumed stream has produced a
 * single chunk. When that resume then fails -- especially post-restart, when the
 * underlying CLI subprocess or session file is stale -- nothing used to tell the
 * lead. 1a stopped the immediate ack from claiming unconditional delivery; 1b
 * wired a failed resume into `deliverMessageToLead`, ordered before the
 * `emitAllCompleted` check so a last-teammate failure doesn't let the desktop
 * notification race ahead of the wake; 1c threaded the lead's `sessionId`
 * explicitly through `interruptWithMessage` so the wake survives a process
 * where the lead's own query never ran (post-restart).
 *
 * Scope: this file proves everything reachable from `TeammateManager` in
 * isolation -- 1a's wording, 1b's gating/ordering, and 1c's "Door A" (explicit
 * sessionId threading into `deps.interruptWithMessage`). Two things are
 * verified to be true by direct code reading here but are NOT independently
 * tested here, because they live outside `TeammateManager`/`runtime`:
 *
 * - The mid-turn vs. idle-but-live distinction is `ClaudeCodeProvider.isLeadBusy()`'s
 *   concern, not `TeammateManager`'s: `interruptWithMessage` (ClaudeCodeProvider.ts)
 *   takes the mid-turn branch (leadQuery !== null, ~L2353-2372, leadQuery stays
 *   set through `await leadQuery.interrupt()`) or the idle branch (leadQuery ===
 *   null, ~L2336-2350, which sets `teammateIdleMessagePending = true` via
 *   `emitTeammateMessageWhileIdle`, ~L2559-2565) -- both leave `isLeadBusy()`
 *   (`leadQuery !== null || teammateIdleMessagePending`, ~L2655-2656) true.
 *   `TeammateManager` never sees `leadQuery`/`isLeadBusy`, so at this layer both
 *   scenarios reduce to the same observable: `deps.interruptWithMessage` fired.
 * - 1c's "Door B" (`onTeammateMessageWhileIdle`'s `isSessionActive` gate,
 *   `MessageStreamingHandler.ts`, and the `ai:sendMessageToTeammate` handler's
 *   pre-emptive `startSession`, `AIService.ts`) is `electron`-package code.
 *   Its coverage lives in
 *   `packages/electron/src/main/services/ai/__tests__/teammateWakeDelivery.test.ts`.
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

// Keep the team-config writes out of the real ~/.claude. Mutable so the spawn-gate
// tests can point each case at an empty dir: team-context resolution falls back to
// scanning <configDir>/teams, and one leftover dir there would mask synthesis.
let claudeConfigDir = path.join(os.tmpdir(), 'nimbalyst-teammate-resume-reliability-test');
vi.mock('../claudeCode/claudeConfigDir', () => ({
  resolveClaudeConfigDir: () => claudeConfigDir,
}));

import { TeammateManager, TeammateCwdMissingError, type IdleTeammate, type TeammateManagerDeps } from '../TeammateManager';

const SDK_SESSION = 'sdk-session-1';
/** Lead session id; its first 8 chars are what a synthesized team name is built from. */
const LEAD_SESSION = '0d5f2a91-7c3e-4b1a-9f22-1e2d3c4b5a6f';

/** A query whose first `next()` never resolves -- fine for ack-only assertions that never await the stream. */
function wedgedQuery() {
  return {
    [Symbol.asyncIterator]() {
      return this;
    },
    next: () => new Promise<never>(() => {}),
  };
}

/** A query whose iterator rejects immediately -- simulates a resumed subprocess/session dying on attach. */
function failingQuery(message: string) {
  return {
    [Symbol.asyncIterator]() {
      return this;
    },
    next: async (): Promise<IteratorResult<unknown>> => {
      throw new Error(message);
    },
  };
}

/** A query that reports one session-id chunk and ends -- the teammate finishes its turn and goes idle. */
function emptyQuery(sessionId: string) {
  async function* stream() {
    yield { type: 'system', session_id: sessionId };
  }
  return stream();
}

function makeDeps() {
  return {
    logNonBlocking: vi.fn(),
    emit: vi.fn(),
    createPreToolUseHook: vi.fn(() => vi.fn()),
    createPostToolUseHook: vi.fn(() => vi.fn()),
    getAbortSignal: vi.fn(() => undefined),
    interruptWithMessage: vi.fn(async () => {}),
    createCanUseToolHandler: vi.fn(() => vi.fn()),
  } as unknown as TeammateManagerDeps & {
    emit: ReturnType<typeof vi.fn>;
    logNonBlocking: ReturnType<typeof vi.fn>;
    interruptWithMessage: ReturnType<typeof vi.fn>;
  };
}

type ManagerInternals = {
  idleTeammates: Map<string, IdleTeammate>;
  resumeIdleTeammate(sessionId: string | undefined, agentId: string, idleInfo: IdleTeammate, prompt: string): void;
};

const internals = (manager: TeammateManager) => manager as unknown as ManagerInternals;

const idleTeammate = (name: string, sessionId: string): IdleTeammate => ({
  teamName: 'team', name, sessionId, agentType: 'general-purpose',
  model: undefined, color: 'blue', cwd: os.tmpdir(), prompt: 'work',
});

const idleAlice = idleTeammate('alice', SDK_SESSION);
const idleBob = idleTeammate('bob', 'sdk-session-2');

/** Resume-then-fail: trigger resumeIdleTeammate() and wait for the resulting handleStreamError(). */
const resumeAndFail = (
  manager: TeammateManager,
  sessionId: string | undefined,
  agentId: string,
  idleInfo: IdleTeammate,
) => internals(manager).resumeIdleTeammate(sessionId, agentId, idleInfo, 'more work');

/** Status the emit path last persisted for a teammate. */
const statusOf = (agentId: string) => storedTeammates.find(tm => tm.agentId === agentId)?.status;

beforeEach(() => {
  storedTeammates = [];
  queryMock.mockReset();
});

describe('resume-delivery ack wording (task 1a)', () => {
  it('no longer claims unconditional delivery when a resume is initiated', async () => {
    queryMock.mockReturnValue(wedgedQuery());
    const deps = makeDeps();
    const manager = new TeammateManager(deps);
    internals(manager).idleTeammates.set('alice@team', idleAlice);

    const result = await manager.handlePreToolUse(
      'SendMessage',
      { recipient: 'alice', type: 'message', content: 'do more work' },
      'tool-1',
      'session-1',
    );

    if (!result.handled) throw new Error('expected handled: true');
    const ackText: string = result.result.hookSpecificOutput.permissionDecisionReason;
    expect(ackText).not.toMatch(/do not retry/i);
    expect(ackText).not.toMatch(/delivered to idle teammate/i);

    // The synthetic tool_result logged to the transcript carries the same claim.
    const resultCall = deps.logNonBlocking.mock.calls.find(
      ([, , , , metadata]) => (metadata as { messageType: string }).messageType === 'teammate_message_result',
    );
    expect(resultCall).toBeDefined();
    const loggedContent = JSON.parse(resultCall![3] as string);
    const loggedText = loggedContent.message.content[0].content as string;
    expect(loggedText).not.toMatch(/do not retry/i);
    expect(loggedText).not.toMatch(/delivered to idle teammate/i);
  });
});

describe('resume-then-fail delivers a wake to the lead (task 1b)', () => {
  // At the TeammateManager level, "mid-turn" and "idle-but-live" both reduce to
  // the same observable (deps.interruptWithMessage fired) -- see this file's
  // top-of-file docblock for the ClaudeCodeProvider-level distinction and the
  // line numbers confirming both branches leave isLeadBusy() true.

  it('delivers the failure when the lead is mid-turn (interruptWithMessage represents the leadQuery-busy branch)', async () => {
    queryMock.mockReturnValue(failingQuery('subprocess exited'));
    const deps = makeDeps();
    const manager = new TeammateManager(deps);

    resumeAndFail(manager, 'session-1', 'alice@team', idleAlice);

    await vi.waitFor(() => expect(deps.interruptWithMessage).toHaveBeenCalledTimes(1));
    expect(deps.interruptWithMessage.mock.calls[0][0]).toMatch(/alice/);
    expect(deps.interruptWithMessage.mock.calls[0][0]).toMatch(/failed/i);
  });

  it('delivers the failure when the lead is idle-but-live (interruptWithMessage represents the teammateIdleMessagePending branch)', async () => {
    queryMock.mockReturnValue(failingQuery('subprocess exited'));
    const deps = makeDeps();
    const manager = new TeammateManager(deps);

    resumeAndFail(manager, 'session-1', 'bob@team', idleBob);

    await vi.waitFor(() => expect(deps.interruptWithMessage).toHaveBeenCalledTimes(1));
    expect(deps.interruptWithMessage.mock.calls[0][0]).toMatch(/bob/);
  });

  it('delivers the wake BEFORE emitAllCompleted when this is the last active teammate', async () => {
    queryMock.mockReturnValue(failingQuery('subprocess exited'));
    const deps = makeDeps();
    const manager = new TeammateManager(deps);

    // A single resumed teammate: its failure makes hasActiveTeammates() false,
    // so handleStreamError also runs the emitAllCompleted check in the same call.
    resumeAndFail(manager, 'session-1', 'alice@team', idleAlice);

    await vi.waitFor(() => expect(deps.interruptWithMessage).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(deps.emit.mock.calls.some(([event]) => event === 'teammates:allCompleted')).toBe(true),
    );

    const allCompletedIndex = deps.emit.mock.calls.findIndex(([event]) => event === 'teammates:allCompleted');
    const allCompletedOrder = deps.emit.mock.invocationCallOrder[allCompletedIndex];
    const interruptOrder = deps.interruptWithMessage.mock.invocationCallOrder[0];
    // 1b's fix: deliverMessageToLead (and its interruptWithMessage call) must run
    // before emitAllCompleted, or a real ClaudeCodeProvider/MessageStreamingHandler
    // would let the desktop-notification/endSession race ahead of the wake.
    expect(interruptOrder).toBeLessThan(allCompletedOrder);
  });
});

describe('revival-then-fail delivers a distinct revival_failed notice (PRD 008 task 2b)', () => {
  it('a revived (terminal-origin) teammate that fails delivers revival_failed, not the generic resume-failed wording', async () => {
    queryMock.mockReturnValue(failingQuery('subprocess exited'));
    const deps = makeDeps();
    const manager = new TeammateManager(deps);
    const revivedCarol = { ...idleTeammate('carol', 'sdk-session-3'), revivedFromTerminal: true };

    resumeAndFail(manager, 'session-1', 'carol@team', revivedCarol);

    await vi.waitFor(() => expect(deps.interruptWithMessage).toHaveBeenCalledTimes(1));
    expect(deps.interruptWithMessage.mock.calls[0][0]).toMatch(/carol/);
    expect(deps.interruptWithMessage.mock.calls[0][0]).toMatch(/revival failed/i);
    expect(deps.logNonBlocking).toHaveBeenCalledWith(
      'session-1', 'claude-code', 'output',
      expect.stringContaining('"type":"revival_failed"'),
      expect.objectContaining({ messageType: 'revival_failed' }),
    );
  });

  it('a plain PRD-003 resume-then-fail (no revivedFromTerminal) is completely unaffected -- still teammate_message_to_lead', async () => {
    // Regression guard for the brief's explicit constraint: this task must not
    // fork or alter deliverMessageToLead's existing contract for its current
    // callers. idleAlice carries no revivedFromTerminal, matching every resume
    // that predates PRD 008 (idle/running/blocked -- never went through the
    // terminal-status branch of isRevivalEligible).
    queryMock.mockReturnValue(failingQuery('subprocess exited'));
    const deps = makeDeps();
    const manager = new TeammateManager(deps);

    resumeAndFail(manager, 'session-1', 'alice@team', idleAlice);

    await vi.waitFor(() => expect(deps.interruptWithMessage).toHaveBeenCalledTimes(1));
    expect(deps.interruptWithMessage.mock.calls[0][0]).not.toMatch(/revival failed/i);
    expect(deps.logNonBlocking).toHaveBeenCalledWith(
      'session-1', 'claude-code', 'output',
      expect.stringContaining('"type":"teammate_message_to_lead"'),
      expect.anything(),
    );
  });
});

describe('resume-then-fail post-restart reaches the lead (task 1c, Door A)', () => {
  it('threads the explicit sessionId into interruptWithMessage, not the unset lastUsedSessionId', async () => {
    queryMock.mockReturnValue(failingQuery('session file stale'));
    const deps = makeDeps();
    const manager = new TeammateManager(deps);
    // Mirrors the post-restart case: the lead's own query never ran in this
    // process, so lastUsedSessionId was never populated.
    expect(manager.lastUsedSessionId).toBeUndefined();

    resumeAndFail(manager, 'session-explicit-restart', 'alice@team', idleAlice);

    await vi.waitFor(() => expect(deps.interruptWithMessage).toHaveBeenCalledTimes(1));
    // deliverMessageToLead calls deps.interruptWithMessage(message, sessionId)
    // with the sessionId explicitly threaded through resumeIdleTeammate ->
    // handleStreamError, never falling back to (still-unset) lastUsedSessionId.
    expect(deps.interruptWithMessage.mock.calls[0][1]).toBe('session-explicit-restart');
    expect(manager.lastUsedSessionId).toBeUndefined();
  });
});

describe('fresh spawn vs. resume: the wasResumed marker (task 1b)', () => {
  it('does not deliver a wake when a freshly-spawned (not resumed) teammate fails', async () => {
    queryMock.mockReturnValue(failingQuery('subprocess exited'));
    const deps = makeDeps();
    const manager = new TeammateManager(deps);

    // Seed the roster the way a running teammate's first activity emit does --
    // the persisted status only tracks teammates the roster has already seen.
    // Seeded before spawning (rather than via a post-spawn emitTeammateUpdate
    // await) so it can't lose the race with the failing query's immediate
    // rejection, which would otherwise delete the managedTeammates entry
    // before an async seed call gets to read it.
    storedTeammates = [{ agentId: 'alice@team', status: 'running' }];
    manager.spawnManagedTeammate('session-1', { team_name: 'team', name: 'alice', prompt: 'work' });

    await vi.waitFor(() => expect(statusOf('alice@team')).toBe('errored'));
    expect(deps.interruptWithMessage).not.toHaveBeenCalled();
  });
});

describe('concurrent resume failures (task 1b)', () => {
  it('delivers an independent wake for each of two teammates that fail near-simultaneously', async () => {
    queryMock.mockReturnValueOnce(failingQuery('alice subprocess exited'));
    queryMock.mockReturnValueOnce(failingQuery('bob subprocess exited'));
    const deps = makeDeps();
    const manager = new TeammateManager(deps);

    resumeAndFail(manager, 'session-1', 'alice@team', idleAlice);
    resumeAndFail(manager, 'session-1', 'bob@team', idleBob);

    await vi.waitFor(() => expect(deps.interruptWithMessage).toHaveBeenCalledTimes(2));
    const messages = deps.interruptWithMessage.mock.calls.map(([message]) => message as string);
    expect(messages.some(message => /alice/.test(message))).toBe(true);
    expect(messages.some(message => /bob/.test(message))).toBe(true);
  });
});

describe('spawn gate: implicit-team protocol (PRD agent-teams-cold-start-bootstrap, task 1a)', () => {
  /** Spawn through the PreToolUse gate, the way the SDK hook actually reaches it. */
  const spawnViaGate = (
    manager: TeammateManager,
    toolName: string,
    toolInput: Record<string, unknown>,
    sessionId: string | undefined = LEAD_SESSION,
  ) => manager.handlePreToolUse(toolName, toolInput, 'tool-1', sessionId);

  /** agentId of the teammate the manager actually registered, or undefined if it never spawned. */
  const spawnedAgentId = (manager: TeammateManager) =>
    [...(manager as unknown as { managedTeammates: Map<string, unknown> }).managedTeammates.keys()][0];

  beforeEach(() => {
    claudeConfigDir = path.join(os.tmpdir(), `nimbalyst-spawn-gate-${Math.random().toString(36).slice(2)}`);
    queryMock.mockReturnValue(wedgedQuery());
  });

  it('spawns a managed teammate for a name-only Agent call, synthesizing a session-scoped team it stays addressable under', async () => {
    const manager = new TeammateManager(makeDeps());
    manager.enableAgentTeams = true;

    const result = await spawnViaGate(manager, 'Agent', {
      name: 'git-scout',
      description: 'Scout the git history',
      prompt: 'Find the commit that introduced the regression.',
      subagent_type: 'general-purpose',
    });

    expect(result.handled).toBe(true);
    expect(spawnedAgentId(manager)).toBe(`git-scout@team-${LEAD_SESSION.slice(0, 8)}`);

    // The whole point of pinning currentTeamContext to the synthesized name:
    // SendMessage's bare-name routing has to keep finding the teammate.
    const send = await manager.handlePreToolUse(
      'SendMessage',
      { recipient: 'git-scout', type: 'message', content: 'status?' },
      'tool-2',
      LEAD_SESSION,
    );
    expect(send.handled).toBe(true);
  });

  it('honors a legacy Task + team_name spawn without agent teams being enabled', async () => {
    const manager = new TeammateManager(makeDeps());

    const result = await spawnViaGate(manager, 'Task', { team_name: 'team', name: 'alice', prompt: 'work' });

    expect(result.handled).toBe(true);
    expect(spawnedAgentId(manager)).toBe('alice@team');
  });

  it.each([
    ['a nameless Agent call', true, { description: 'do a thing', prompt: 'work' }],
    ['a name-only Agent call while agent teams are disabled', false, { name: 'git-scout', prompt: 'work' }],
  ])('does not intercept %s', async (_label, enabled, toolInput) => {
    const manager = new TeammateManager(makeDeps());
    manager.enableAgentTeams = enabled;

    expect(await spawnViaGate(manager, 'Agent', toolInput)).toEqual({ handled: false });
    expect(queryMock).not.toHaveBeenCalled();
  });

  // The D10/C2 regression guard. A resumed session already has a real team, and
  // SendMessage routing keys on `name@team` matching exactly
  // (agentIdMatchesRecipient's preferredTeam branch). Synthesizing over that
  // team would make every already-spawned teammate permanently unreachable.
  it('spawns into a resumed session\'s existing team rather than synthesizing over it', async () => {
    const manager = new TeammateManager(makeDeps());
    manager.enableAgentTeams = true;
    // How a resumed session presents itself: idle teammates rehydrated from
    // persisted metadata, carrying the real team name, before any spawn.
    internals(manager).idleTeammates.set('alice@real-team', idleTeammate('alice', SDK_SESSION));

    await spawnViaGate(manager, 'Agent', { name: 'git-scout', prompt: 'work' });

    expect(spawnedAgentId(manager)).toBe('git-scout@real-team');
    // And the resumed teammate stays addressable by bare name under that team.
    expect(manager.agentIdMatchesRecipient('alice@real-team', 'alice', 'real-team')).toBe(true);
  });

  it('denies a duplicate spawn keyed on the synthesized team', async () => {
    const manager = new TeammateManager(makeDeps());
    manager.enableAgentTeams = true;
    const toolInput = { name: 'git-scout', prompt: 'work' };

    await spawnViaGate(manager, 'Agent', toolInput);
    const second = await spawnViaGate(manager, 'Agent', toolInput);

    if (!second.handled) throw new Error('expected handled: true');
    expect(second.result.hookSpecificOutput.permissionDecisionReason).toMatch(/ALREADY running/);
    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});

describe('resume round-trip: synthesized team name survives a manager restart (PRD agent-teams-cold-start-bootstrap, task 1b, R4)', () => {
  /** IDs of the manager's currently-managed teammates, read off a live instance. */
  const managedIds = (manager: TeammateManager) =>
    [...(manager as unknown as { managedTeammates: Map<string, { sessionId?: string }> }).managedTeammates.keys()];
  const managedSessionId = (manager: TeammateManager, agentId: string) =>
    (manager as unknown as { managedTeammates: Map<string, { sessionId?: string }> }).managedTeammates.get(agentId)?.sessionId;

  /** Yields one chunk carrying session_id (so the manager captures it), then wedges. */
  function oneChunkThenWedge(sdkSessionId: string) {
    let yielded = false;
    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      next: async (): Promise<IteratorResult<unknown>> => {
        if (!yielded) {
          yielded = true;
          return { done: false, value: { session_id: sdkSessionId } };
        }
        return new Promise<never>(() => {});
      },
    };
  }

  it('a fresh manager rehydrates the same synthesized team name and resumes the same teammate, not a re-synthesized one', async () => {
    claudeConfigDir = path.join(os.tmpdir(), `nimbalyst-resume-roundtrip-${Math.random().toString(36).slice(2)}`);
    queryMock.mockReturnValue(oneChunkThenWedge(SDK_SESSION));

    // 1. Spawn via 1a's name-only path -- no team_name, so the gate synthesizes one.
    const manager = new TeammateManager(makeDeps());
    manager.enableAgentTeams = true;
    const expectedTeamName = `team-${LEAD_SESSION.slice(0, 8)}`;
    const agentId = `git-scout@${expectedTeamName}`;

    const spawnResult = await manager.handlePreToolUse(
      'Agent',
      { name: 'git-scout', prompt: 'work' },
      'tool-1',
      LEAD_SESSION,
    );
    expect(spawnResult.handled).toBe(true);
    expect(managedIds(manager)).toEqual([agentId]);

    // 2. emitTeammateUpdate persists the currentTeammates[] row -- wait for the
    // spawn-triggered emit, then the stream's captured SDK session id, then
    // persist that session id the way a later production emit would.
    await vi.waitFor(() => expect(storedTeammates.some(tm => tm.agentId === agentId)).toBe(true));
    await vi.waitFor(() => expect(managedSessionId(manager, agentId)).toBe(SDK_SESSION));
    await manager.emitTeammateUpdate(LEAD_SESSION);

    const persistedRow = storedTeammates.find(tm => tm.agentId === agentId) as unknown as
      { teamName?: string; sessionId?: string; status?: string; cwd?: string } | undefined;
    expect(persistedRow?.status).toBe('running');
    expect(persistedRow?.teamName).toBe(expectedTeamName);
    expect(persistedRow?.sessionId).toBe(SDK_SESSION);
    // Spawn-time cwd (this manager's lastUsedCwd is unset, so process.cwd())
    // lands on the persisted row via the updateMetadata payload, not just the
    // in-memory ManagedTeammate.
    expect(persistedRow?.cwd).toBe(process.cwd());

    // 3. Construct a genuinely fresh TeammateManager instance -- simulates a
    // manager restart: empty in-memory maps, only the persisted row survives.
    const restarted = new TeammateManager(makeDeps());
    expect(managedIds(restarted)).toEqual([]);

    // 4. A fresh instance's resolveTeamContext must find the SAME synthesized
    // name via the metadata cascade, not regenerate a new one.
    const rehydratedTeamName = await restarted.resolveTeamContext(LEAD_SESSION);
    expect(rehydratedTeamName).toBe(expectedTeamName);

    // 5. The resume entry point accepts the rehydrated team and resumes the
    // teammate under the exact same agentId (git-scout@<same synthesized team>).
    queryMock.mockReturnValue(oneChunkThenWedge(SDK_SESSION));
    const sendResult = await restarted.sendMessageFromHost(LEAD_SESSION, agentId, 'status?');
    expect(sendResult).toEqual({ delivered: true, wasIdle: true });
    expect(managedIds(restarted)).toEqual([agentId]);

    const resumeCallOptions = queryMock.mock.calls[queryMock.mock.calls.length - 1][0].options;
    expect(resumeCallOptions.resume).toBe(SDK_SESSION);
    expect(resumeCallOptions.extraArgs['team-name']).toBe(expectedTeamName);
  });
});

describe('shutdown-request handshake wording is unaffected (task 1a "confirm unchanged")', () => {
  it('still says sent/awaiting approval, never delivered/do not retry', async () => {
    queryMock.mockReturnValue(wedgedQuery());
    const deps = makeDeps();
    const manager = new TeammateManager(deps);
    internals(manager).idleTeammates.set('alice@team', idleAlice);

    const result = await manager.handlePreToolUse(
      'SendMessage',
      { recipient: 'alice', type: 'shutdown_request', content: 'please stop' },
      'tool-1',
      'session-1',
    );

    if (!result.handled) throw new Error('expected handled: true');
    const ackText: string = result.result.hookSpecificOutput.permissionDecisionReason;
    expect(ackText).toMatch(/sent/i);
    expect(ackText).toMatch(/awaiting approval/i);
    expect(ackText).not.toMatch(/delivered/i);
    expect(ackText).not.toMatch(/do not retry/i);
  });
});

/**
 * Spawn cwd persists per teammate row and is preferred over lastUsedCwd on
 * rehydration (PRD agent-revival-persistence, task 1b). Covers the
 * post-restart path (`rehydrateIdleTeammate`, reached via
 * `sendMessageFromHost` when neither in-memory map holds the teammate).
 */
describe('spawn cwd persists per teammate row (task 1b)', () => {
  const persistedRow = (overrides: Record<string, unknown> = {}) => ({
    name: 'bob',
    agentId: 'bob@team',
    teamName: 'team',
    agentType: 'general-purpose',
    status: 'idle',
    sessionId: 'sdk-session-9',
    startedAt: 111,
    ...overrides,
  });

  beforeEach(() => {
    storedTeammates = [];
    queryMock.mockReset();
  });

  it('prefers the persisted row\'s own cwd over lastUsedCwd/resumeContext.cwd on rehydration', async () => {
    const manager = new TeammateManager(makeDeps());
    // lastUsedCwd is normally unset in a process where the lead never ran
    // (post-restart) -- set it explicitly here to prove the row's own cwd
    // wins even when a lastUsedCwd IS present, not just when it's absent.
    manager.lastUsedCwd = '/some/other/lastUsedCwd/that/would/be/wrong';
    const resumeSpy = vi
      .spyOn(internals(manager) as unknown as { resumeIdleTeammate: (...args: unknown[]) => void }, 'resumeIdleTeammate')
      .mockImplementation(() => {});
    storedTeammates = [persistedRow({ cwd: os.tmpdir() })] as unknown as StoredTeammate[];

    const result = await manager.sendMessageFromHost(LEAD_SESSION, 'bob@team', 'still there?');

    expect(result).toEqual({ delivered: true, wasIdle: true });
    expect(resumeSpy).toHaveBeenCalledWith(
      LEAD_SESSION,
      'bob@team',
      expect.objectContaining({ cwd: os.tmpdir() }),
      'still there?',
    );
  });

  it('falls back to lastUsedCwd/process.cwd() without throwing for a legacy row with no cwd field', async () => {
    const manager = new TeammateManager(makeDeps());
    const resumeSpy = vi
      .spyOn(internals(manager) as unknown as { resumeIdleTeammate: (...args: unknown[]) => void }, 'resumeIdleTeammate')
      .mockImplementation(() => {});
    storedTeammates = [persistedRow()] as unknown as StoredTeammate[];

    const result = await manager.sendMessageFromHost(LEAD_SESSION, 'bob@team', 'still there?');

    expect(result).toEqual({ delivered: true, wasIdle: true });
    expect(resumeSpy).toHaveBeenCalledWith(
      LEAD_SESSION,
      'bob@team',
      expect.objectContaining({ cwd: process.cwd() }),
      'still there?',
    );
  });

  it('catches TeammateCwdMissingError and routes it to revival-failure delivery instead of rejecting (task 2b)', async () => {
    // PRD 008 task 2b: the raw TeammateCwdMissingError throw (still exactly
    // what rehydrateIdleTeammate itself does -- see the error-shape assertions
    // below) is caught inside sendMessageFromHost, not left to propagate as an
    // unhandled rejection to whatever called it (a real gap this task closes).
    const deps = makeDeps();
    const manager = new TeammateManager(deps);
    const missingCwd = path.join(os.tmpdir(), `nimbalyst-teammate-cwd-missing-${Math.random().toString(36).slice(2)}`);
    storedTeammates = [persistedRow({ cwd: missingCwd })] as unknown as StoredTeammate[];

    const result = await manager.sendMessageFromHost(LEAD_SESSION, 'bob@team', 'still there?');

    expect(result).toEqual({ delivered: false, wasIdle: false });

    // Both delivery halves fired: persisted transcript line...
    expect(deps.logNonBlocking).toHaveBeenCalledWith(
      LEAD_SESSION, 'claude-code', 'output',
      expect.stringContaining('"type":"revival_failed"'),
      expect.objectContaining({ messageType: 'revival_failed' }),
    );
    const [, , , chunkJson] = deps.logNonBlocking.mock.calls[0];
    const chunk = JSON.parse(chunkJson);
    expect(chunk.content).toContain(missingCwd);
    expect(chunk._teammateAgentId).toBe('bob@team');
    // ...and the live/idle wake attempt.
    expect(deps.interruptWithMessage).toHaveBeenCalledWith(
      expect.stringContaining('Teammate revival failed'),
      LEAD_SESSION,
    );
  });

  it('the underlying rehydrateIdleTeammate throw is still the typed, specific error (unit-level shape check)', async () => {
    // Exercises the throw site directly (not through sendMessageFromHost's
    // catch) so this specific error's shape stays pinned even as the outer
    // call site's handling of it evolves.
    const manager = new TeammateManager(makeDeps());
    const missingCwd = path.join(os.tmpdir(), `nimbalyst-teammate-cwd-missing-${Math.random().toString(36).slice(2)}`);
    storedTeammates = [persistedRow({ cwd: missingCwd })] as unknown as StoredTeammate[];

    const rehydrate = (internals(manager) as unknown as {
      rehydrateIdleTeammate: (sessionId: string | undefined, agentId: string) => Promise<unknown>;
    }).rehydrateIdleTeammate.bind(manager);

    await expect(rehydrate(LEAD_SESSION, 'bob@team')).rejects.toThrow(TeammateCwdMissingError);
    await rehydrate(LEAD_SESSION, 'bob@team').catch((err: unknown) => {
      expect(err).toBeInstanceOf(TeammateCwdMissingError);
      expect((err as TeammateCwdMissingError).agentId).toBe('bob@team');
      expect((err as TeammateCwdMissingError).cwd).toBe(missingCwd);
    });
  });
});

/**
 * Restart-path revival, full shape (PRD 008 agent-revival-persistence, tasks
 * 2a + 3b). Distinct from every describe block above this comment: those
 * cover PRD 003's original resume-reliability scenarios plus PRD 008's
 * 1b/2b slices in isolation. This block is the scripted stand-in for a real
 * app restart, matching the "second boot" pattern
 * `sendMessageFromHost.test.ts:145-182` already established -- construct a
 * fresh `TeammateManager` (never call any spawn/resume method on it before
 * the assertion), seed only the persisted repository row, then call
 * `sendMessageFromHost`. The fresh instance's `managedTeammates`/
 * `idleTeammates` maps are empty by construction, exactly like a process
 * that never ran the original spawn -- the persisted row is the only
 * surviving handle, so this proves the whole abandon -> restart -> rehydrate
 * -> resume shape, not just that 2a's gate function accepts the row in
 * isolation.
 */
describe('restart-path revival: a lead-abandoned teammate resumes through the widened gate (PRD 008, tasks 2a+3b)', () => {
  const leadAbandonedRow = (overrides: Record<string, unknown> = {}) => ({
    name: 'bob',
    agentId: 'bob@team',
    teamName: 'team',
    agentType: 'general-purpose',
    // Shape written by abandonIdleTeammates (PRD 008 task 1a, TeammateManager.ts:349):
    // status: 'completed', endReason: 'lead-abandoned', endedAt: Date.now().
    status: 'completed',
    endReason: 'lead-abandoned',
    endedAt: Date.now() - 60_000,
    sessionId: 'sdk-session-9',
    // Task 1b's persisted-cwd field, pointed at a real directory so the
    // TeammateCwdMissingError path (covered above) does not spuriously fire.
    cwd: os.tmpdir(),
    startedAt: 111,
    ...overrides,
  });

  beforeEach(() => {
    storedTeammates = [];
    queryMock.mockReset();
    queryMock.mockReturnValue(wedgedQuery());
  });

  it('resumes a lead-abandoned teammate after a simulated restart (fresh TeammateManager, empty in-memory maps)', async () => {
    const manager = new TeammateManager(makeDeps());
    storedTeammates = [leadAbandonedRow()] as unknown as StoredTeammate[];

    const result = await manager.sendMessageFromHost(LEAD_SESSION, 'bob@team', 'still there?', {
      cwd: os.tmpdir(),
      permissionsPath: os.tmpdir(),
    });

    // Resumed (options.resume set via streamTeammateOutput's idle-resume
    // path), not a fresh spawn -- {delivered: true, wasIdle: true} is only
    // reachable through rehydrateIdleTeammate -> resumeIdleTeammate.
    expect(result).toEqual({ delivered: true, wasIdle: true });

    // Closes the loop: the row is genuinely usable afterward, not just
    // "the call didn't get rejected" -- resumeIdleTeammate's own
    // scheduleEmitTeammateUpdate({ status: 'running' }) writes back through
    // the mocked AISessionsRepository.updateMetadata into storedTeammates.
    await vi.waitFor(() => expect(statusOf('bob@team')).toBe('running'));
  });
});

describe('revival grounding: a shutdown-ended teammate is told the shutdown is stale (PRD 009, task 1b)', () => {
  const terminalRow = (overrides: Record<string, unknown> = {}) => ({
    name: 'bob',
    agentId: 'bob@team',
    teamName: 'team',
    agentType: 'general-purpose',
    status: 'completed',
    endReason: 'finished',
    endedAt: Date.now() - 60_000,
    sessionId: 'sdk-session-11',
    cwd: os.tmpdir(),
    startedAt: 111,
    ...overrides,
  });

  /** The prompt query() was seeded with, drained to plain strings when it is an iterable. */
  const promptOf = async (call: unknown): Promise<string | string[]> => {
    const prompt = (call as { prompt: string | AsyncIterable<{ message: { content: string } }> }).prompt;
    if (typeof prompt === 'string') return prompt;
    const contents: string[] = [];
    for await (const msg of prompt) contents.push(msg.message.content);
    return contents;
  };

  beforeEach(() => {
    storedTeammates = [];
    queryMock.mockReset();
    queryMock.mockReturnValue(wedgedQuery());
  });

  it('seeds the resume with a grounding turn ahead of the real prompt when the prior end was an approved user shutdown', async () => {
    const manager = new TeammateManager(makeDeps());
    storedTeammates = [terminalRow({ endReason: 'user-shutdown' })] as unknown as StoredTeammate[];

    const result = await manager.sendMessageFromHost(LEAD_SESSION, 'bob@team', 'which GPU processes are running?', {
      cwd: os.tmpdir(),
      permissionsPath: os.tmpdir(),
      // Required by isRevivalEligible for a user-shutdown row; without it the
      // rehydrate refuses and this would fail for the wrong reason.
      confirmedUserShutdown: true,
    });
    expect(result).toEqual({ delivered: true, wasIdle: true });

    await vi.waitFor(() => expect(queryMock).toHaveBeenCalled());
    const prompt = await promptOf(queryMock.mock.calls[0][0]);
    expect(Array.isArray(prompt)).toBe(true);
    const [grounding, real] = prompt as string[];
    expect(prompt).toHaveLength(2);
    expect(grounding).toMatch(/revived/i);
    expect(grounding).toMatch(/no longer active/i);
    expect(real).toBe('which GPU processes are running?');
  });

  it('leaves an ordinary restart-path revival (lead-abandoned, no shutdown handshake) on a plain string prompt', async () => {
    const manager = new TeammateManager(makeDeps());
    storedTeammates = [terminalRow({ endReason: 'lead-abandoned' })] as unknown as StoredTeammate[];

    await manager.sendMessageFromHost(LEAD_SESSION, 'bob@team', 'still there?', {
      cwd: os.tmpdir(),
      permissionsPath: os.tmpdir(),
    });

    await vi.waitFor(() => expect(queryMock).toHaveBeenCalled());
    expect(await promptOf(queryMock.mock.calls[0][0])).toBe('still there?');
  });

  it('does not re-ground the next resume after the revived teammate has gone idle again', async () => {
    const manager = new TeammateManager(makeDeps());
    storedTeammates = [terminalRow({ endReason: 'user-shutdown' })] as unknown as StoredTeammate[];
    // First turn ends normally with a captured session id -> teammate re-idles.
    queryMock.mockReturnValue(emptyQuery('sdk-session-11'));

    await manager.sendMessageFromHost(LEAD_SESSION, 'bob@team', 'first prompt', {
      cwd: os.tmpdir(), permissionsPath: os.tmpdir(), confirmedUserShutdown: true,
    });
    await vi.waitFor(() => expect(internals(manager).idleTeammates.has('bob@team')).toBe(true));

    queryMock.mockClear();
    queryMock.mockReturnValue(wedgedQuery());
    await manager.sendMessageFromHost(LEAD_SESSION, 'bob@team', 'second prompt');

    await vi.waitFor(() => expect(queryMock).toHaveBeenCalled());
    expect(await promptOf(queryMock.mock.calls[0][0])).toBe('second prompt');
  });
});
