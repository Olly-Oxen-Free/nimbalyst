// @vitest-environment node
import { createStore } from 'jotai';
import { describe, expect, it } from 'vitest';
import {
  closeTaskTileAtom,
  openTaskTilesAtomFamily,
  toggleTaskTileAtom,
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
