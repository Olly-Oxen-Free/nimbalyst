// @vitest-environment node
/**
 * Per-teammate `blocked` status on TeammateManager.
 *
 * Every teammate a lead spawns shares the lead's permission UI, so a teammate
 * parked on a prompt used to render the same running spinner as one that was
 * busy working. `toolPermission:pending` names the teammate but the matching
 * `:resolved` does not, so the pair is correlated by requestId; these cover that
 * correlation, its release, and the ways it must refuse to guess.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

type StoredTeammate = { agentId: string; status: string; sessionId?: string; endReason?: string; endedAt?: number };

let storedTeammates: StoredTeammate[] = [];

vi.mock('../../../../storage/repositories/AISessionsRepository', () => ({
  AISessionsRepository: {
    get: async () => ({ metadata: { currentTeammates: storedTeammates } }),
    updateMetadata: async (_sessionId: string, patch: { metadata: { currentTeammates: StoredTeammate[] } }) => {
      storedTeammates = patch.metadata.currentTeammates;
    },
  },
}));

import { TeammateManager, type TeammateManagerDeps } from '../TeammateManager';

type ManagerInternals = {
  deps: { emit: ReturnType<typeof vi.fn> };
  managedTeammates: Map<string, unknown>;
  idleTeammates: Map<string, unknown>;
  emitDebounceTimer: unknown;
  handleStreamCompletion(
    sessionId: string | undefined,
    agentId: string,
    teamName: string,
    idleTemplate: unknown,
    result: { capturedSessionId?: string; approvedShutdown: boolean; capturedResultText?: string; sentMessageToLead: boolean },
  ): void;
  handleStreamError(sessionId: string, agentId: string, teamName: string, err: Error): void;
};

const internals = (manager: TeammateManager) => manager as unknown as ManagerInternals;

/** A manager holding the given `name@team` agent ids, already emitted as running. */
async function managerWith(...agentIds: string[]) {
  const manager = new TeammateManager({
    emit: vi.fn(),
    // handleStreamCompletion's idle branch hands the finished turn to the
    // lead (deliverMessageToLead), which needs both of these.
    logNonBlocking: vi.fn(),
    interruptWithMessage: vi.fn().mockResolvedValue(undefined),
  } as unknown as TeammateManagerDeps);
  for (const agentId of agentIds) {
    const [name, teamName] = agentId.split('@');
    internals(manager).managedTeammates.set(agentId, { name, agentId, teamName, agentType: 'general' });
  }
  await manager.emitTeammateUpdate('session-1');
  return manager;
}

/** Status the emit path last persisted for a teammate. */
const statusOf = (agentId: string) => storedTeammates.find(tm => tm.agentId === agentId)?.status;

const statuses = (agentIds: string[]) => Object.fromEntries(agentIds.map(id => [id, statusOf(id)]));

/** Wait out the 100ms emit debounce and the metadata write behind it. */
const settled = (expected: Record<string, string | undefined>) =>
  vi.waitFor(() => expect(statuses(Object.keys(expected))).toEqual(expected));

beforeEach(() => {
  storedTeammates = [];
});

/** Outcome carried by each teammates:allCompleted the manager has emitted. */
const allCompletedOutcomes = (manager: TeammateManager) =>
  internals(manager).deps.emit.mock.calls
    .filter(([event]) => event === 'teammates:allCompleted')
    .map(([, payload]) => (payload as { outcome?: string }).outcome);

/** Add a running teammate without going through the SDK spawn path. */
const addRunning = (manager: TeammateManager, agentId: string) => {
  const [name, teamName] = agentId.split('@');
  internals(manager).managedTeammates.set(agentId, { name, agentId, teamName, agentType: 'general' });
};

/** What streamTeammateOutput resolves with when a teammate is done for good. */
const FINISHED = { capturedSessionId: undefined, approvedShutdown: false, capturedResultText: undefined, sentMessageToLead: false };

const idleTemplateFor = (agentId: string) => {
  const [name, teamName] = agentId.split('@');
  return { teamName, name, sessionId: '', agentType: 'general', model: undefined, color: 'blue', cwd: '/tmp', prompt: 'work' };
};

describe('TeammateManager permission blocking', () => {
  it('blocks the named teammate until its own prompt resolves, independently of other teammates', async () => {
    const manager = await managerWith('alice@team', 'bob@team');

    manager.markTeammatePermissionPending('session-1', 'alice', 'req-a');
    await settled({ 'alice@team': 'blocked', 'bob@team': 'running' });

    manager.markTeammatePermissionPending('session-1', 'bob', 'req-b');
    await settled({ 'alice@team': 'blocked', 'bob@team': 'blocked' });

    manager.markTeammatePermissionResolved('session-1', 'req-a');
    await settled({ 'alice@team': 'running', 'bob@team': 'blocked' });

    manager.markTeammatePermissionResolved('session-1', 'req-b');
    await settled({ 'alice@team': 'running', 'bob@team': 'running' });
  });

  it('keeps a blocked teammate blocked through an update it is not the subject of', async () => {
    const manager = await managerWith('alice@team', 'bob@team');
    manager.markTeammatePermissionPending('session-1', 'alice', 'req-a');
    await settled({ 'alice@team': 'blocked' });

    // Any other teammate's activity re-emits the whole roster; without the
    // blocked set that pass would reset alice to 'running' mid-prompt.
    await manager.emitTeammateUpdate('session-1', new Map([['bob@team', { status: 'running' }]]));

    expect(statusOf('alice@team')).toBe('blocked');
  });

  it('does not resurrect a teammate that went terminal while its prompt was open', async () => {
    const manager = await managerWith('alice@team');
    manager.markTeammatePermissionPending('session-1', 'alice', 'req-a');
    await settled({ 'alice@team': 'blocked' });

    // What handleStreamCompletion does when the teammate shuts down mid-prompt.
    internals(manager).managedTeammates.delete('alice@team');
    await manager.emitTeammateUpdate('session-1', new Map([['alice@team', { status: 'completed' }]]));

    manager.markTeammatePermissionResolved('session-1', 'req-a');
    await settled({ 'alice@team': 'completed' });
    expect(internals(manager).emitDebounceTimer).toBeNull();
  });

  it('blocks nobody when the prompt cannot be pinned to exactly one teammate', async () => {
    // canUseTool is handed the plain teammate name, so same-named teammates in
    // two teams are indistinguishable — a known limitation of that payload.
    const manager = await managerWith('alice@red', 'alice@blue');

    manager.markTeammatePermissionPending('session-1', 'alice', 'req-a');
    manager.markTeammatePermissionPending('session-1', 'carol', 'req-b');
    // An unattributed prompt must not release anything either.
    manager.markTeammatePermissionResolved('session-1', 'req-a');

    expect(internals(manager).emitDebounceTimer).toBeNull();
    expect(statuses(['alice@red', 'alice@blue'])).toEqual({ 'alice@red': 'running', 'alice@blue': 'running' });
  });
});

/**
 * teammates:allCompleted fires once nothing is left, however the teammates got
 * there — so a crashed team used to reach the host as the same payload a
 * finished one did, and got the same completion chime. The payload now says
 * which happened.
 */
describe('TeammateManager batch outcome', () => {
  it('reports the batch as errored even when a healthy sibling is the one that closes it', async () => {
    const manager = await managerWith('alice@team', 'bob@team');

    // alice's stream throws. bob is still working, so nothing is announced yet.
    internals(manager).handleStreamError('session-1', 'alice@team', 'team', new Error('transport closed'));
    expect(allCompletedOutcomes(manager)).toEqual([]);

    // bob then finishes cleanly and triggers the emit. alice's crash is still
    // what the user needs to hear about.
    internals(manager).handleStreamCompletion('session-1', 'bob@team', 'team', idleTemplateFor('bob@team'), FINISHED);
    expect(allCompletedOutcomes(manager)).toEqual(['errored']);

    // The next batch must not inherit the last one's failure.
    addRunning(manager, 'carol@team');
    internals(manager).handleStreamCompletion('session-1', 'carol@team', 'team', idleTemplateFor('carol@team'), FINISHED);
    expect(allCompletedOutcomes(manager)).toEqual(['errored', 'clean']);
  });

  it('reports idle teammates orphaned by a dead lead as abandoned, not finished', async () => {
    // No error is ever thrown here: the lead's transport died and the idle
    // teammates can no longer be resumed, so they are quietly marked completed.
    const manager = await managerWith();
    internals(manager).idleTeammates.set('alice@team', idleTemplateFor('alice@team'));

    manager.abandonIdleTeammates('session-1');

    expect(allCompletedOutcomes(manager)).toEqual(['abandoned']);
  });
});

/**
 * A teammate's SDK session id is the only durable handle on its transcript and
 * the only way to resume it after a restart, but it is captured from the first
 * chunk -- long after the teammate was first emitted with no session id at all.
 * These cover that late capture reaching persisted metadata, and surviving the
 * transition to idle.
 */
/**
 * The live-update signal (R5): every path that delivers a teammate message to
 * the lead must also emit `teammate:transcriptUpdated` so an open transcript
 * popover knows to refetch -- but only when a session id actually exists to
 * key the popover off of (deliverMessageToLead's `if (sessionId)` guard).
 */
describe('TeammateManager live-update signal on message-to-lead', () => {
  it('emits teammate:transcriptUpdated when a background agent delivers its result to the lead', async () => {
    const emit = vi.fn();
    const interruptWithMessage = vi.fn(async () => {});
    const logNonBlocking = vi.fn();
    const manager = new TeammateManager({ emit, interruptWithMessage, logNonBlocking } as unknown as TeammateManagerDeps);
    internals(manager).managedTeammates.set('bot@team', {
      name: 'bot', agentId: 'bot@team', teamName: 'team', agentType: 'general', isBackgroundAgent: true,
    });

    internals(manager).handleStreamCompletion('session-1', 'bot@team', 'team', idleTemplateFor('bot@team'), {
      capturedSessionId: undefined,
      approvedShutdown: false,
      capturedResultText: 'done working',
      sentMessageToLead: false,
    });

    expect(emit).toHaveBeenCalledWith('teammate:transcriptUpdated', { sessionId: 'session-1', agentId: 'bot@team' });
  });

  it('does not emit teammate:transcriptUpdated when sessionId is undefined', async () => {
    const emit = vi.fn();
    const interruptWithMessage = vi.fn(async () => {});
    const logNonBlocking = vi.fn();
    const manager = new TeammateManager({ emit, interruptWithMessage, logNonBlocking } as unknown as TeammateManagerDeps);
    internals(manager).managedTeammates.set('bot@team', {
      name: 'bot', agentId: 'bot@team', teamName: 'team', agentType: 'general', isBackgroundAgent: true,
    });

    internals(manager).handleStreamCompletion(undefined, 'bot@team', 'team', idleTemplateFor('bot@team'), {
      capturedSessionId: undefined,
      approvedShutdown: false,
      capturedResultText: 'done working',
      sentMessageToLead: false,
    });

    expect(emit).not.toHaveBeenCalledWith('teammate:transcriptUpdated', expect.anything());
  });
});

describe('TeammateManager teammate session id persistence', () => {
  const sessionIdOf = (agentId: string) => storedTeammates.find(tm => tm.agentId === agentId)?.sessionId;

  it('persists a session id captured after the teammate was already emitted, and keeps it through idle', async () => {
    const manager = await managerWith('alice@team');
    expect(sessionIdOf('alice@team')).toBeUndefined();

    // What the first chunk's capture does to the managed entry.
    (internals(manager).managedTeammates.get('alice@team') as { sessionId?: string }).sessionId = 'sdk-alice-1';
    await manager.emitTeammateUpdate('session-1');
    expect(sessionIdOf('alice@team')).toBe('sdk-alice-1');

    internals(manager).handleStreamCompletion('session-1', 'alice@team', 'team', idleTemplateFor('alice@team'), {
      capturedSessionId: 'sdk-alice-1',
      approvedShutdown: false,
      sentMessageToLead: false,
    });

    await settled({ 'alice@team': 'idle' });
    expect(sessionIdOf('alice@team')).toBe('sdk-alice-1');
  });
});

/**
 * User-initiated stop from the thread popover (R7). `stopByAgentId` addresses
 * the exact agentId (no fuzzy name matching) and takes the lead sessionId
 * explicitly, unlike `stop(name)` which leans on `this.lastUsedSessionId` --
 * unset here, matching a manager that never ran a live lead query (the
 * post-restart case).
 */
describe('TeammateManager.stopByAgentId', () => {
  const withAbort = (manager: TeammateManager, agentId: string) => {
    const abort = { abort: vi.fn() };
    Object.assign(internals(manager).managedTeammates.get(agentId) as object, { abort });
    return abort;
  };

  it('stops the exact agentId and emits with the explicitly-passed sessionId when lastUsedSessionId is unset', async () => {
    const manager = await managerWith('alice@team');
    expect(manager.lastUsedSessionId).toBeUndefined();
    const abort = withAbort(manager, 'alice@team');

    const result = manager.stopByAgentId('alice@team', 'session-explicit');

    expect(result).toEqual({ stopped: true });
    expect(abort.abort).toHaveBeenCalled();
    expect(internals(manager).managedTeammates.has('alice@team')).toBe(false);
    await settled({ 'alice@team': 'errored' });
  });

  it('logs a distinct user-stop marker, not the stall-watchdog abort message', async () => {
    const manager = await managerWith('alice@team');
    withAbort(manager, 'alice@team');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    manager.stopByAgentId('alice@team', 'session-explicit');

    const loggedUserStop = logSpy.mock.calls.some(([msg]) =>
      typeof msg === 'string' && msg.includes('user requested'));
    const loggedWatchdog = logSpy.mock.calls.some(([msg]) =>
      typeof msg === 'string' && msg.includes('STREAM_STALL_DETECTED'));
    expect(loggedUserStop).toBe(true);
    expect(loggedWatchdog).toBe(false);
    logSpy.mockRestore();
  });

  it('is a graceful no-op, not a throw, for an already-terminal or unknown teammate', () => {
    const manager = new TeammateManager({ emit: vi.fn() } as unknown as TeammateManagerDeps);

    expect(() => manager.stopByAgentId('ghost@team', 'session-explicit')).not.toThrow();
    expect(manager.stopByAgentId('ghost@team', 'session-explicit')).toEqual({ stopped: false });
  });
});

/**
 * endReason/endedAt taxonomy (task 1a, PRD agent-revival-persistence).
 *
 * Every place a teammate goes terminal must stamp why, so a later gate (2a)
 * can tell a clean finish, a deliberate user shutdown, and an involuntary
 * lead-abandonment apart instead of collapsing them all into `completed`.
 * One test per write site; `stop`/`stopByAgentId`/`killAll`'s idle-teammate
 * loop write 'user-shutdown' rather than 'finished', per the settled Known
 * Issues decision in the task brief -- a UI Stop click is exactly the
 * "deliberately shut down" case the revival gate must never resurface.
 */
describe('TeammateManager endReason/endedAt taxonomy', () => {
  const endReasonOf = (agentId: string) => storedTeammates.find(tm => tm.agentId === agentId)?.endReason;
  const endedAtOf = (agentId: string) => storedTeammates.find(tm => tm.agentId === agentId)?.endedAt;

  const withAbort = (manager: TeammateManager, agentId: string) => {
    const abort = { abort: vi.fn() };
    Object.assign(internals(manager).managedTeammates.get(agentId) as object, { abort });
    return abort;
  };

  it('abandonIdleTeammates writes lead-abandoned', async () => {
    const manager = await managerWith();
    internals(manager).idleTeammates.set('alice@team', idleTemplateFor('alice@team'));
    // abandonIdleTeammates persists via scheduleEmitTeammateUpdate against a
    // roster that must already know about alice@team for the override to land.
    await manager.emitTeammateUpdate('session-1', new Map([['alice@team', { status: 'idle' }]]));

    manager.abandonIdleTeammates('session-1');

    await settled({ 'alice@team': 'completed' });
    expect(endReasonOf('alice@team')).toBe('lead-abandoned');
    expect(endedAtOf('alice@team')).toEqual(expect.any(Number));
  });

  it('handleStreamCompletion writes user-shutdown for an approved shutdown', async () => {
    const manager = await managerWith('alice@team');

    internals(manager).handleStreamCompletion('session-1', 'alice@team', 'team', idleTemplateFor('alice@team'), {
      capturedSessionId: undefined,
      approvedShutdown: true,
      capturedResultText: undefined,
      sentMessageToLead: false,
    });

    await settled({ 'alice@team': 'completed' });
    expect(endReasonOf('alice@team')).toBe('user-shutdown');
    expect(endedAtOf('alice@team')).toEqual(expect.any(Number));
  });

  it('handleStreamCompletion writes finished for a clean/no-session-id completion', async () => {
    const manager = await managerWith('alice@team');

    internals(manager).handleStreamCompletion('session-1', 'alice@team', 'team', idleTemplateFor('alice@team'), FINISHED);

    await settled({ 'alice@team': 'completed' });
    expect(endReasonOf('alice@team')).toBe('finished');
    expect(endedAtOf('alice@team')).toEqual(expect.any(Number));
  });

  it('handleStreamError writes errored', async () => {
    const manager = await managerWith('alice@team');

    internals(manager).handleStreamError('session-1', 'alice@team', 'team', new Error('transport closed'));

    await settled({ 'alice@team': 'errored' });
    expect(endReasonOf('alice@team')).toBe('errored');
    expect(endedAtOf('alice@team')).toEqual(expect.any(Number));
  });

  it('killAll writes errored for running teammates and user-shutdown for idle ones', async () => {
    const manager = await managerWith('alice@team');
    withAbort(manager, 'alice@team');
    internals(manager).idleTeammates.set('bob@team', idleTemplateFor('bob@team'));
    await manager.emitTeammateUpdate('session-1', new Map([['bob@team', { status: 'idle' }]]));
    // killAll emits immediately against lastUsedSessionId, not the sessionId
    // threaded through managerWith/emitTeammateUpdate above.
    (manager as unknown as { lastUsedSessionId: string }).lastUsedSessionId = 'session-1';

    manager.killAll();

    await settled({ 'alice@team': 'errored', 'bob@team': 'completed' });
    expect(endReasonOf('alice@team')).toBe('errored');
    expect(endReasonOf('bob@team')).toBe('user-shutdown');
  });

  it('stop/stopByAgentId write user-shutdown for both the running and idle branches', async () => {
    const manager = await managerWith('alice@team');
    withAbort(manager, 'alice@team');
    internals(manager).idleTeammates.set('bob@team', idleTemplateFor('bob@team'));
    await manager.emitTeammateUpdate('session-1', new Map([['bob@team', { status: 'idle' }]]));

    manager.stopByAgentId('alice@team', 'session-1');
    manager.stopByAgentId('bob@team', 'session-1');

    await settled({ 'alice@team': 'errored', 'bob@team': 'completed' });
    expect(endReasonOf('alice@team')).toBe('user-shutdown');
    expect(endReasonOf('bob@team')).toBe('user-shutdown');
  });

  it('handleShutdownResult (SDK-mediated shutdown_request) writes user-shutdown for the idle branch', async () => {
    // Discovered via the brief's Edge Cases grep: a sixth scheduleEmitTeammateUpdate
    // call site that sets 'completed', not one of the five named write sites.
    // Same deliberate shutdown handshake as handleStreamCompletion's
    // approvedShutdown branch, so it gets the same reason.
    const manager = await managerWith();
    internals(manager).idleTeammates.set('alice@team', idleTemplateFor('alice@team'));
    await manager.emitTeammateUpdate('session-1', new Map([['alice@team', { status: 'idle' }]]));

    manager.handleShutdownResult('session-1', 'alice');

    await settled({ 'alice@team': 'completed' });
    expect(endReasonOf('alice@team')).toBe('user-shutdown');
  });
});
