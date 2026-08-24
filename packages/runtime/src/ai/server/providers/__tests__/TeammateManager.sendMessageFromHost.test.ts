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

vi.mock('../../../../storage/repositories/AISessionsRepository', () => ({
  AISessionsRepository: {
    get: async () => ({ metadata: { currentTeammates: [] } }),
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
    const manager = new TeammateManager({ emit: vi.fn() } as unknown as TeammateManagerDeps);
    const resumeSpy = vi.spyOn(internals(manager), 'resumeIdleTeammate');
    internals(manager).idleTeammates.set('bob@team', idleTemplateFor('bob@team'));

    const result = await manager.sendMessageFromHost('lead-session', 'bob@team', 'wake up bob');

    expect(result).toEqual({ delivered: true, wasIdle: true });
    expect(resumeSpy).toHaveBeenCalledWith('lead-session', 'bob@team', idleTemplateFor('bob@team'), 'wake up bob');
  });

  it('reports not-delivered for an agentId that is neither running nor idle', async () => {
    const manager = new TeammateManager({ emit: vi.fn() } as unknown as TeammateManagerDeps);

    const result = await manager.sendMessageFromHost('lead-session', 'ghost@team', 'anyone there?');

    expect(result).toEqual({ delivered: false, wasIdle: false });
  });
});
