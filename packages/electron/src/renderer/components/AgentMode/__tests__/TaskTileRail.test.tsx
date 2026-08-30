// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { Provider, createStore, type PrimitiveAtom } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Narrow mocks only - never the runtime barrel. The real atom module is
// replaced so a test can drive sessionTasksAtom's contents directly. Its
// export list mirrors exactly what TaskTile imports; an export the tile no
// longer imports would be a silent no-op mock.
vi.mock('../../../store/atoms/agentMode', async () => {
  const { atom: makeAtom } = await import('jotai');
  const signalAtoms = new Map<string, PrimitiveAtom<number>>();
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
    sessionTasksAtom: () => tasks,
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

import { TaskTile } from '../TaskTileRail';
import { sessionTasksAtom } from '../../../store/atoms/agentMode';

const getTaskTranscript = vi.fn();

const tasksAtom = sessionTasksAtom('lead-1') as unknown as PrimitiveAtom<unknown[]>;

function task(taskId: string, status: string, description: string) {
  return { taskId, status, description, startedAt: 0, toolCount: 0, tokenCount: 0, durationMs: 0 };
}

/**
 * Renders one Task tile the way `TiledRegion` mounts it: the tile no longer
 * owns the open list or a close control of its own (the pane's
 * `TileHeaderBar` does), so this drives it directly off session metadata.
 */
async function renderTile(tasks: unknown[] = [
  task('task-1', 'running', 'db-migration'),
  task('task-2', 'running', 'lint-sweep'),
]) {
  const store = createStore();
  store.set(tasksAtom, tasks);
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <Provider store={store}>
        <TaskTile sessionId="lead-1" taskId="task-1" />
      </Provider>,
    );
  });
  return {
    ...result,
    store,
    tile: () => result.container.querySelector('.task-tile'),
  };
}

describe('TaskTile', () => {
  beforeEach(() => {
    getTaskTranscript.mockReset().mockResolvedValue([{ type: 'assistant_message', content: 'hi' }]);
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      aiGetTaskSubagentTranscript: getTaskTranscript,
    };
  });

  afterEach(cleanup);

  it('fetches and renders the transcript of the task it was given', async () => {
    const { tile } = await renderTile();

    expect(getTaskTranscript).toHaveBeenCalledWith('lead-1', { taskId: 'task-1' }, '/ws');
    expect(tile()!.textContent).toContain('db-migration');
    // Its own virtual-list cache key, so an open hover popover can't clobber it.
    expect(tile()!.querySelector('[data-testid="rich-transcript"]')?.getAttribute('data-cache-key'))
      .toBe('lead-1:task-1:tile');
  });

  it('keeps rendering a task that completes, flipping the badge to the terminal state', async () => {
    const { store, tile } = await renderTile();
    expect(tile()!.textContent).toContain('Working');

    await act(async () => {
      store.set(tasksAtom, [
        task('task-1', 'completed', 'db-migration'),
        task('task-2', 'running', 'lint-sweep'),
      ]);
    });

    expect(tile()!.getAttribute('data-status')).toBe('complete');
    expect(tile()!.textContent).toContain('Complete');
  });

  // A tile outlives its metadata entry: the last-seen row is retained rather
  // than blanking the header.
  it('retains the last-seen task entry when it leaves session metadata', async () => {
    const { store, tile } = await renderTile();

    await act(async () => {
      store.set(tasksAtom, [task('task-2', 'running', 'lint-sweep')]);
    });

    expect(tile()!.textContent).toContain('db-migration');
  });
});
