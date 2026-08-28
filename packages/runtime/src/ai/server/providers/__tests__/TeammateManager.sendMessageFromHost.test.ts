// @vitest-environment node
/**
 * UI-initiated message delivery to a Teammate (task 2c, R5's backend half).
 *
 * A chip click in the renderer has an exact agentId, unlike the lead model's
 * own SendMessage tool call, which only has a fuzzy recipient name. These
 * cover both delivery paths sendMessageFromHost picks between, and the
 * not-found case the UI must be able to show as "no longer active" rather
 * than a false "sent".
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'os';
import path from 'path';

/** Teammate rows the lead session's metadata holds, as a restarted app would find them. */
let persistedTeammates: Array<Record<string, unknown>> = [];

vi.mock('../../../../storage/repositories/AISessionsRepository', () => ({
  AISessionsRepository: {
    get: async () => ({ metadata: { currentTeammates: persistedTeammates } }),
    updateMetadata: async () => {},
  },
}));

const queryMock = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: unknown) => queryMock(args),
}));

// Keep any inbox-fallback writes out of the real ~/.claude.
vi.mock('../claudeCode/claudeConfigDir', () => ({
  resolveClaudeConfigDir: () => path.join(os.tmpdir(), 'nimbalyst-teammate-send-from-host-test'),
}));

import { TeammateManager, type TeammateManagerDeps } from '../TeammateManager';

type ManagerInternals = {
  managedTeammates: Map<string, { name: string; agentId: string; teamName: string; agentType: string; query: unknown }>;
  idleTeammates: Map<string, { teamName: string; name: string; sessionId: string; agentType: string; model: string | undefined; color: string; cwd: string; prompt: string }>;
  flushPendingMessages(agentId: string, teammateQuery: unknown): Promise<void>;
  resumeIdleTeammate(sessionId: string | undefined, agentId: string, idleInfo: unknown, prompt: string): void;
};

const internals = (manager: TeammateManager) => manager as unknown as ManagerInternals;

const idleTemplateFor = (agentId: string) => {
  const [name, teamName] = agentId.split('@');
  return { teamName, name, sessionId: 'sdk-session-1', agentType: 'general', model: undefined, color: 'blue', cwd: '/tmp', prompt: 'work' };
};

/** Idle-resume immediately ends its stream so the test doesn't hang. */
function endsImmediately() {
  return {
    [Symbol.asyncIterator]() { return this; },
    next: async () => ({ value: undefined, done: true }),
  };
}

describe('TeammateManager.sendMessageFromHost', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockReturnValue(endsImmediately());
    persistedTeammates = [];
  });

  it('delivers to a running teammate via the existing queue/flush path', async () => {
    const manager = new TeammateManager({ emit: vi.fn() } as unknown as TeammateManagerDeps);
    const flushSpy = vi.spyOn(internals(manager), 'flushPendingMessages').mockResolvedValue(undefined);
    internals(manager).managedTeammates.set('alice@team', {
      name: 'alice', agentId: 'alice@team', teamName: 'team', agentType: 'general', query: null,
    });

    const result = await manager.sendMessageFromHost('lead-session', 'alice@team', 'hello alice');

    expect(result).toEqual({ delivered: true, wasIdle: false });
    expect(flushSpy).toHaveBeenCalledWith('alice@team', null);
  });

  it('reports failure without throwing when flush rejects for a running teammate', async () => {
    const manager = new TeammateManager({ emit: vi.fn() } as unknown as TeammateManagerDeps);
    vi.spyOn(internals(manager), 'flushPendingMessages').mockRejectedValue(new Error('inbox lock timeout'));
    internals(manager).managedTeammates.set('alice@team', {
      name: 'alice', agentId: 'alice@team', teamName: 'team', agentType: 'general', query: null,
    });

    const result = await manager.sendMessageFromHost('lead-session', 'alice@team', 'hello alice');

    expect(result).toEqual({ delivered: false, wasIdle: false });
  });

  it('resumes an idle teammate and reports wasIdle', async () => {
    // Stub logNonBlocking/interruptWithMessage: resumeIdleTeammate's stream rejects
    // (deps here don't implement the hooks streamTeammateOutput needs), which routes
    // through handleStreamError -> deliverMessageToLead since the resumed teammate's
    // wasResumed marker is true -- those two deps calls must exist to avoid an
    // unhandled rejection, independent of this test's own assertions.
    const manager = new TeammateManager({
      emit: vi.fn(),
      logNonBlocking: vi.fn(),
      interruptWithMessage: vi.fn(async () => {}),
    } as unknown as TeammateManagerDeps);
    const resumeSpy = vi.spyOn(internals(manager), 'resumeIdleTeammate');
    internals(manager).idleTeammates.set('bob@team', idleTemplateFor('bob@team'));

    const result = await manager.sendMessageFromHost('lead-session', 'bob@team', 'wake up bob');

    expect(result).toEqual({ delivered: true, wasIdle: true });
    expect(resumeSpy).toHaveBeenCalledWith('lead-session', 'bob@team', idleTemplateFor('bob@team'), 'wake up bob');
  });

  it('threads the lead session id into the wake a failed resume raises', async () => {
    // The provider's own lastUsedSessionId is only set while a live lead query
    // streams, so a wake raised in a process where the lead never ran has no
    // session to reach unless this id is passed along with the message.
    const interruptWithMessage = vi.fn(async (_message: string, _sessionId?: string) => {});
    const manager = new TeammateManager({
      emit: vi.fn(),
      logNonBlocking: vi.fn(),
      interruptWithMessage,
    } as unknown as TeammateManagerDeps);
    internals(manager).idleTeammates.set('bob@team', idleTemplateFor('bob@team'));

    await manager.sendMessageFromHost('lead-session', 'bob@team', 'wake up bob');

    await vi.waitFor(() => expect(interruptWithMessage).toHaveBeenCalled());
    expect(interruptWithMessage.mock.calls[0][1]).toBe('lead-session');
  });

  it('reports not-delivered for an agentId that is neither running nor idle', async () => {
    const manager = new TeammateManager({ emit: vi.fn() } as unknown as TeammateManagerDeps);

    const result = await manager.sendMessageFromHost('lead-session', 'ghost@team', 'anyone there?');

    expect(result).toEqual({ delivered: false, wasIdle: false });
  });
});

/**
 * The second boot. Both teammate maps are memory-only, so after a restart the
 * only surviving handle on an idle teammate is the session id the emit path
 * persisted -- and none of the lead-derived config streamTeammateOutput reads
 * off the manager has been assigned, because the lead's own query never ran.
 */
describe('TeammateManager.sendMessageFromHost after a restart', () => {
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
    queryMock.mockReset();
    queryMock.mockReturnValue(endsImmediately());
    persistedTeammates = [];
  });

  it('resumes a teammate held only in persisted metadata, seeding the lead config the resume needs', async () => {
    const manager = new TeammateManager({ emit: vi.fn() } as unknown as TeammateManagerDeps);
    const resumeSpy = vi.spyOn(internals(manager), 'resumeIdleTeammate').mockImplementation(() => {});
    persistedTeammates = [persistedRow()];

    const result = await manager.sendMessageFromHost('lead-session', 'bob@team', 'still there?', {
      cwd: '/repo',
      permissionsPath: '/repo-parent',
    });

    expect(result).toEqual({ delivered: true, wasIdle: true });
    expect(resumeSpy).toHaveBeenCalledWith(
      'lead-session',
      'bob@team',
      expect.objectContaining({ sessionId: 'sdk-session-9', name: 'bob', teamName: 'team', startedAt: 111 }),
      'still there?',
    );
    expect(manager.lastUsedCwd).toBe('/repo');
    expect(manager.lastUsedPermissionsPath).toBe('/repo-parent');
  });

  it('does not resume a teammate persisted before session ids were recorded', async () => {
    const manager = new TeammateManager({ emit: vi.fn() } as unknown as TeammateManagerDeps);
    persistedTeammates = [persistedRow({ sessionId: undefined })];

    const result = await manager.sendMessageFromHost('lead-session', 'bob@team', 'still there?');

    expect(result).toEqual({ delivered: false, wasIdle: false });
  });

  /**
   * PRD 003 pinned "terminal means dead" here: a 'completed' row was refused on
   * status alone. PRD 008
   * (.nimble/prds/008_agent-revival-persistence/PRD_agent-revival-persistence.md)
   * reverses that for rows whose SDK session is still plausibly resumable -- the
   * gate is now (status, endReason, sessionId, endedAt age). These cases replace
   * that single blanket-rejection assertion.
   */
  const withinWindow = () => Date.now() - 60_000;
  const pastWindow = () => Date.now() - 25 * 60 * 60 * 1000;

  const sendAfterRestart = async (
    row: Record<string, unknown>,
    resumeContext?: { confirmedUserShutdown?: boolean },
  ) => {
    const manager = new TeammateManager({ emit: vi.fn() } as unknown as TeammateManagerDeps);
    vi.spyOn(internals(manager), 'resumeIdleTeammate').mockImplementation(() => {});
    persistedTeammates = [persistedRow(row)];
    return manager.sendMessageFromHost('lead-session', 'bob@team', 'still there?', resumeContext);
  };

  it.each([
    ['completed', 'finished'],
    ['errored', 'errored'],
  ])('resumes a %s teammate that ended within the revival window', async (status, endReason) => {
    expect(await sendAfterRestart({ status, endReason, endedAt: withinWindow() }))
      .toEqual({ delivered: true, wasIdle: true });
  });

  it('does not resume a teammate that ended more than 24 hours ago', async () => {
    expect(await sendAfterRestart({ status: 'completed', endReason: 'finished', endedAt: pastWindow() }))
      .toEqual({ delivered: false, wasIdle: false });
  });

  it('does not resume a teammate the user shut down unless the caller confirms', async () => {
    const row = { status: 'completed', endReason: 'user-shutdown', endedAt: withinWindow() };

    expect(await sendAfterRestart(row)).toEqual({ delivered: false, wasIdle: false });
    expect(await sendAfterRestart(row, { confirmedUserShutdown: true }))
      .toEqual({ delivered: true, wasIdle: true });
  });

  it('resumes a legacy terminal row that carries neither endReason nor endedAt', async () => {
    expect(await sendAfterRestart({ status: 'completed' })).toEqual({ delivered: true, wasIdle: true });
  });
});
