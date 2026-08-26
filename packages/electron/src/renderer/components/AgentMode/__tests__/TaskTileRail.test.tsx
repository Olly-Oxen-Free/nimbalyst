// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { Provider, createStore, type PrimitiveAtom } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Narrow mocks only - never the runtime barrel. The real atom module is
// replaced so a test can drive sessionTasksAtom's contents directly.
vi.mock('../../../store/atoms/agentMode', async () => {
  const { atom: makeAtom } = await import('jotai');
  const signalAtoms = new Map<string, PrimitiveAtom<number>>();
  const openTiles = makeAtom<string[]>([]);
  const tasks = makeAtom<unknown[]>([]);
  return {
    taskTranscriptSignalKey: (sessionId: string, taskId: string) => `${sessionId}:${taskId}`,
    taskTranscriptSignalAtomFamily: (key: string) => {
      let existing = signalAtoms.get(key);
      if (!existing) {
        existing = makeAtom(0);
        signalAtoms.set(key, existing);
      }
      return existing;
    },
    openTaskTilesAtomFamily: () => openTiles,
    sessionTasksAtom: () => tasks,
    // Mirrors the real close atom: drop the id from the open list.
    closeTaskTileAtom: makeAtom(
      null,
      (get, set, arg: { sessionId: string; taskId: string }) => {
        set(openTiles, get(openTiles).filter(id => id !== arg.taskId));
      },
    ),
  };
});

vi.mock('../../../store/atoms/sessions', async () => {
  const { atom: makeAtom } = await import('jotai');
  return { sessionListWorkspaceAtom: makeAtom('/ws') };
});

vi.mock('@nimbalyst/runtime/ui/AgentTranscript/components/RichTranscriptView', () => ({
  RichTranscriptView: ({ sessionId }: { sessionId: string }) => (
    <div data-testid="rich-transcript" data-cache-key={sessionId} />
  ),
}));

import { TaskTileRail } from '../TaskTileRail';
import { openTaskTilesAtomFamily, sessionTasksAtom } from '../../../store/atoms/agentMode';

const getTaskTranscript = vi.fn();

const openTilesAtom = openTaskTilesAtomFamily('lead-1') as PrimitiveAtom<string[]>;
const tasksAtom = sessionTasksAtom('lead-1') as unknown as PrimitiveAtom<unknown[]>;

function task(taskId: string, status: string, description: string) {
  return { taskId, status, description, startedAt: 0, toolCount: 0, tokenCount: 0, durationMs: 0 };
}

function renderRail() {
  const store = createStore();
  store.set(openTilesAtom, []);
  store.set(tasksAtom, [
    task('task-1', 'running', 'db-migration'),
    task('task-2', 'running', 'lint-sweep'),
  ]);
  const result = render(
    <Provider store={store}>
      <TaskTileRail sessionId="lead-1" />
    </Provider>,
  );
  return {
    ...result,
    store,
    rail: () => result.container.querySelector('.task-tile-rail'),
    tiles: () => Array.from(result.container.querySelectorAll('.task-tile')),
  };
}

async function openTile(store: ReturnType<typeof createStore>, ...taskIds: string[]) {
  await act(async () => {
    store.set(openTilesAtom, taskIds);
  });
}

describe('TaskTileRail', () => {
  beforeEach(() => {
    getTaskTranscript.mockReset().mockResolvedValue([{ type: 'assistant_message', content: 'hi' }]);
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      aiGetTaskSubagentTranscript: getTaskTranscript,
    };
  });

  afterEach(cleanup);

  it('renders nothing until a task is opened, then one tile fetching that task', async () => {
    const { store, rail, tiles } = renderRail();
    expect(rail()).toBeNull();

    await openTile(store, 'task-1');

    expect(tiles()).toHaveLength(1);
    expect(getTaskTranscript).toHaveBeenCalledWith('lead-1', { taskId: 'task-1' }, '/ws');
    expect(rail()!.textContent).toContain('db-migration');
    // Its own virtual-list cache key, so an open hover popover can't clobber it.
    expect(rail()!.querySelector('[data-testid="rich-transcript"]')?.getAttribute('data-cache-key'))
      .toBe('lead-1:task-1:tile');
  });

  it('opens a second concurrent tile alongside the first rather than replacing it', async () => {
    const { store, tiles } = renderRail();
    await openTile(store, 'task-1');
    await openTile(store, 'task-1', 'task-2');

    expect(tiles().map(t => t.getAttribute('data-task-id'))).toEqual(['task-1', 'task-2']);
  });

  it('caps the rail so the main thread keeps width priority, at a per-tile floor', async () => {
    const { store, rail, tiles } = renderRail();
    await openTile(store, 'task-1', 'task-2');

    // Main thread always keeps at least half the row; the rail scrolls
    // horizontally past that rather than shrinking tiles below the floor.
    expect(rail()!.getAttribute('style')).toContain('max-width: 50%');
    expect(rail()!.className).toContain('overflow-x-auto');
    expect(tiles()[0].getAttribute('style')).toContain('320px');
  });

  it('keeps a tile open when its task completes, flipping the badge to the terminal state', async () => {
    const { store, tiles, rail } = renderRail();
    await openTile(store, 'task-1');
    expect(rail()!.textContent).toContain('Working');

    await act(async () => {
      store.set(tasksAtom, [
        task('task-1', 'completed', 'db-migration'),
        task('task-2', 'running', 'lint-sweep'),
      ]);
    });

    expect(tiles()).toHaveLength(1);
    expect(tiles()[0].getAttribute('data-status')).toBe('complete');
    expect(rail()!.textContent).toContain('Complete');
  });

  it('closes only the tile whose close control was used', async () => {
    const { store, tiles, container } = renderRail();
    await openTile(store, 'task-1', 'task-2');

    await act(async () => {
      fireEvent.click(container.querySelectorAll('.task-tile-close')[0]);
    });

    expect(tiles().map(t => t.getAttribute('data-task-id'))).toEqual(['task-2']);
  });
});
