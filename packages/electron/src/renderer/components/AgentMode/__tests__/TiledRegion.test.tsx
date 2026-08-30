// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Narrow mock only - the transcript view is the one thing in the tile bodies
// that has no business running here. The atoms are the real ones (3a's
// TileHeaderBar test does the same): what these assertions are for is that the
// pane's open / focus / close semantics come out of the shipped atoms, and a
// mock of those would hide exactly that.
vi.mock('@nimbalyst/runtime/ui/AgentTranscript/components/RichTranscriptView', () => ({
  RichTranscriptView: ({ sessionId }: { sessionId: string }) => (
    <div data-testid="rich-transcript" data-cache-key={sessionId} />
  ),
}));

import { TiledRegion } from '../TiledRegion';
import {
  openOrFocusTaskTileAtom,
  openOrFocusTeammateTileAtom,
  sessionTasksAtom,
  sessionTeammatesAtom,
} from '../../../store/atoms/agentMode';
import { sessionListWorkspaceAtom, sessionStoreAtom } from '../../../store/atoms/sessions';

const SESSION = 'lead-1';

const getTeammateTranscript = vi.fn();
const getTaskTranscript = vi.fn();

function seededStore() {
  const store = createStore();
  store.set(sessionListWorkspaceAtom, '/ws');
  // sessionTeammatesAtom / sessionTasksAtom are derived read-only views over
  // this metadata, so the store is seeded at the source rather than mocked.
  store.set(sessionStoreAtom(SESSION), {
    metadata: {
      currentTeammates: [
        { agentId: 'agent-a', name: 'code-reviewer', teamName: 'squad', agentType: 'general-purpose', status: 'running', model: 'sonnet-4' },
      ],
      currentTasks: [
        { taskId: 'task-1', description: 'db-migration', status: 'running', startedAt: 0, toolCount: 0, tokenCount: 0, durationMs: 0 },
      ],
    },
  } as never);
  return store;
}

function renderRegion(store = seededStore()) {
  const result = render(
    <Provider store={store}>
      <TiledRegion sessionId={SESSION} />
    </Provider>,
  );
  return {
    ...result,
    store,
    region: () => result.container.querySelector('.tiled-region'),
    headers: () => Array.from(result.container.querySelectorAll<HTMLElement>('.tile-header-bar')),
    panes: () => Array.from(result.container.querySelectorAll<HTMLElement>('.tiled-region-pane')),
    visiblePane: () => result.container.querySelector<HTMLElement>('.tiled-region-pane[style*="flex"]'),
  };
}

async function open(store: ReturnType<typeof createStore>, ref: { kind: 'teammate' | 'task'; id: string }) {
  await act(async () => {
    if (ref.kind === 'teammate') {
      store.set(openOrFocusTeammateTileAtom, { sessionId: SESSION, agentId: ref.id });
    } else {
      store.set(openOrFocusTaskTileAtom, { sessionId: SESSION, taskId: ref.id });
    }
  });
}

describe('TiledRegion', () => {
  beforeEach(() => {
    getTeammateTranscript.mockReset().mockResolvedValue([]);
    getTaskTranscript.mockReset().mockResolvedValue([]);
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      aiGetTeammateTranscript: getTeammateTranscript,
      aiGetTaskSubagentTranscript: getTaskTranscript,
    };
  });

  afterEach(cleanup);

  it('renders nothing until a tile is opened, then one pane with its single header bar', async () => {
    const { store, region, headers, panes } = renderRegion();
    expect(region()).toBeNull();

    await open(store, { kind: 'teammate', id: 'agent-a' });

    // A single-tile pane still gets a header - it is the tile's drag handle
    // and its only close control.
    expect(headers()).toHaveLength(1);
    expect(headers()[0].dataset.dragId).toBe('agent-a');
    expect(panes()).toHaveLength(1);
  });

  it('stacks a header per tile across both kinds, and focuses by header click', async () => {
    const { store, headers, visiblePane } = renderRegion();
    await open(store, { kind: 'teammate', id: 'agent-a' });
    await open(store, { kind: 'task', id: 'task-1' });

    // Most recently opened is focused.
    expect(headers().map(h => h.dataset.dragId)).toEqual(['agent-a', 'task-1']);
    expect(visiblePane()?.dataset.tileId).toBe('task-1');

    await act(async () => {
      fireEvent.click(headers()[0]);
    });
    expect(visiblePane()?.dataset.tileId).toBe('agent-a');
  });

  it('keeps every open tile mounted, showing only the focused one', async () => {
    const { store, panes, visiblePane } = renderRegion();
    await open(store, { kind: 'teammate', id: 'agent-a' });
    await open(store, { kind: 'task', id: 'task-1' });
    await waitFor(() => expect(getTeammateTranscript).toHaveBeenCalled());

    // Both bodies stay in the DOM: a focus switch must not remount a
    // transcript view (losing its scroll state) or refetch it.
    expect(panes()).toHaveLength(2);
    expect(visiblePane()?.dataset.tileId).toBe('task-1');
    expect(getTeammateTranscript).toHaveBeenCalledTimes(1);

    const teammatePane = panes().find(p => p.dataset.tileId === 'agent-a')!;
    expect(teammatePane.style.display).toBe('none');
    expect(teammatePane.querySelector('.teammate-tile')).not.toBeNull();
  });

  it('does not refetch or remount the tile body when focus moves back to it', async () => {
    const { store, headers } = renderRegion();
    await open(store, { kind: 'teammate', id: 'agent-a' });
    await open(store, { kind: 'task', id: 'task-1' });
    await waitFor(() => expect(getTeammateTranscript).toHaveBeenCalledTimes(1));

    await act(async () => {
      fireEvent.click(headers()[0]);
    });

    expect(getTeammateTranscript).toHaveBeenCalledTimes(1);
  });

  it('closing through the header collapses back to no region once the last tile goes', async () => {
    const { store, headers, region, visiblePane } = renderRegion();
    await open(store, { kind: 'teammate', id: 'agent-a' });
    await open(store, { kind: 'task', id: 'task-1' });

    // Closing the focused tile falls back to the one still open rather than
    // leaving an empty body behind an open header.
    await act(async () => {
      fireEvent.click(headers()[1].querySelector('.tile-header-bar-close')!);
    });
    expect(headers().map(h => h.dataset.dragId)).toEqual(['agent-a']);
    expect(visiblePane()?.dataset.tileId).toBe('agent-a');

    await act(async () => {
      fireEvent.click(headers()[0].querySelector('.tile-header-bar-close')!);
    });
    expect(region()).toBeNull();
  });

  it('renders a tile the sidebar opened through the older toggle atom', async () => {
    const store = seededStore();
    const { headers } = renderRegion(store);

    // toggleTeammateTileAtom does not write the pane order atom, so a tile
    // opened from the sidebar is only in the open list. It must still render.
    const { toggleTeammateTileAtom } = await import('../../../store/atoms/agentMode');
    await act(async () => {
      store.set(toggleTeammateTileAtom, { sessionId: SESSION, agentId: 'agent-a' });
    });

    expect(headers().map(h => h.dataset.dragId)).toEqual(['agent-a']);
  });
});
