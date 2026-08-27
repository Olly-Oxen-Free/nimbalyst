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

import { TeammateManager, type IdleTeammate, type TeammateManagerDeps } from '../TeammateManager';

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
