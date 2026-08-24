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

import { TeammateManager, type TeammateManagerDeps } from '../TeammateManager';

type ManagerInternals = {
  managedTeammates: Map<string, unknown>;
  emitDebounceTimer: unknown;
};

const internals = (manager: TeammateManager) => manager as unknown as ManagerInternals;

/** A manager holding the given `name@team` agent ids, already emitted as running. */
async function managerWith(...agentIds: string[]) {
  const manager = new TeammateManager({ emit: vi.fn() } as unknown as TeammateManagerDeps);
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
    await manager.emitTeammateUpdate('session-1', new Map([['bob@team', 'running']]));

    expect(statusOf('alice@team')).toBe('blocked');
  });

  it('does not resurrect a teammate that went terminal while its prompt was open', async () => {
    const manager = await managerWith('alice@team');
    manager.markTeammatePermissionPending('session-1', 'alice', 'req-a');
    await settled({ 'alice@team': 'blocked' });

    // What handleStreamCompletion does when the teammate shuts down mid-prompt.
    internals(manager).managedTeammates.delete('alice@team');
    await manager.emitTeammateUpdate('session-1', new Map([['alice@team', 'completed']]));

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
