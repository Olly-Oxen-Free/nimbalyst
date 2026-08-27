// @vitest-environment node
import { createStore } from 'jotai';
import { describe, expect, it } from 'vitest';
import {
  closeTaskTileAtom,
  openTaskTilesAtomFamily,
  toggleTaskTileAtom,
  closeTeammateTileAtom,
  openTeammateTilesAtomFamily,
  toggleTeammateTileAtom,
} from '../agentMode';

// TaskTileRail's own test mocks this module, so these are the only assertions
// that run the real toggle/close writers.
describe('task tile atoms', () => {
  it('toggles a task in and back out of its session, appending in open order', () => {
    const store = createStore();
    const tiles = () => store.get(openTaskTilesAtomFamily('lead-1'));

    store.set(toggleTaskTileAtom, { sessionId: 'lead-1', taskId: 'task-1' });
    store.set(toggleTaskTileAtom, { sessionId: 'lead-1', taskId: 'task-2' });
    expect(tiles()).toEqual(['task-1', 'task-2']);

    store.set(toggleTaskTileAtom, { sessionId: 'lead-1', taskId: 'task-1' });
    expect(tiles()).toEqual(['task-2']);
  });

  it('keeps each session\'s open tiles separate', () => {
    const store = createStore();
    store.set(toggleTaskTileAtom, { sessionId: 'lead-1', taskId: 'task-1' });
    store.set(toggleTaskTileAtom, { sessionId: 'lead-2', taskId: 'task-9' });

    expect(store.get(openTaskTilesAtomFamily('lead-1'))).toEqual(['task-1']);
    expect(store.get(openTaskTilesAtomFamily('lead-2'))).toEqual(['task-9']);
  });

  it('closes only the named tile, and is a no-op for one already closed', () => {
    const store = createStore();
    store.set(toggleTaskTileAtom, { sessionId: 'lead-1', taskId: 'task-1' });
    store.set(toggleTaskTileAtom, { sessionId: 'lead-1', taskId: 'task-2' });

    store.set(closeTaskTileAtom, { sessionId: 'lead-1', taskId: 'task-1' });
    expect(store.get(openTaskTilesAtomFamily('lead-1'))).toEqual(['task-2']);

    store.set(closeTaskTileAtom, { sessionId: 'lead-1', taskId: 'task-1' });
    expect(store.get(openTaskTilesAtomFamily('lead-1'))).toEqual(['task-2']);
  });
});

// Sibling atom family for teammate tiles - same shape, independent map, so a
// task tile and a teammate tile toggle independently even under the same id.
describe('teammate tile atoms', () => {
  it('toggles a teammate in and back out of its session, appending in open order', () => {
    const store = createStore();
    const tiles = () => store.get(openTeammateTilesAtomFamily('lead-1'));

    store.set(toggleTeammateTileAtom, { sessionId: 'lead-1', agentId: 'agent-a' });
    store.set(toggleTeammateTileAtom, { sessionId: 'lead-1', agentId: 'agent-b' });
    expect(tiles()).toEqual(['agent-a', 'agent-b']);

    store.set(toggleTeammateTileAtom, { sessionId: 'lead-1', agentId: 'agent-a' });
    expect(tiles()).toEqual(['agent-b']);
  });

  it('keeps each session\'s open tiles separate', () => {
    const store = createStore();
    store.set(toggleTeammateTileAtom, { sessionId: 'lead-1', agentId: 'agent-a' });
    store.set(toggleTeammateTileAtom, { sessionId: 'lead-2', agentId: 'agent-z' });

    expect(store.get(openTeammateTilesAtomFamily('lead-1'))).toEqual(['agent-a']);
    expect(store.get(openTeammateTilesAtomFamily('lead-2'))).toEqual(['agent-z']);
  });

  it('closes only the named tile, and is a no-op for one already closed', () => {
    const store = createStore();
    store.set(toggleTeammateTileAtom, { sessionId: 'lead-1', agentId: 'agent-a' });
    store.set(toggleTeammateTileAtom, { sessionId: 'lead-1', agentId: 'agent-b' });

    store.set(closeTeammateTileAtom, { sessionId: 'lead-1', agentId: 'agent-a' });
    expect(store.get(openTeammateTilesAtomFamily('lead-1'))).toEqual(['agent-b']);

    store.set(closeTeammateTileAtom, { sessionId: 'lead-1', agentId: 'agent-a' });
    expect(store.get(openTeammateTilesAtomFamily('lead-1'))).toEqual(['agent-b']);
  });

  it('does not share state with the Task-tile atom family under the same id', () => {
    const store = createStore();
    store.set(toggleTaskTileAtom, { sessionId: 'lead-1', taskId: 'shared-id' });
    store.set(toggleTeammateTileAtom, { sessionId: 'lead-1', agentId: 'shared-id' });

    expect(store.get(openTaskTilesAtomFamily('lead-1'))).toEqual(['shared-id']);
    expect(store.get(openTeammateTilesAtomFamily('lead-1'))).toEqual(['shared-id']);

    store.set(closeTaskTileAtom, { sessionId: 'lead-1', taskId: 'shared-id' });
    expect(store.get(openTaskTilesAtomFamily('lead-1'))).toEqual([]);
    expect(store.get(openTeammateTilesAtomFamily('lead-1'))).toEqual(['shared-id']);
  });
});
