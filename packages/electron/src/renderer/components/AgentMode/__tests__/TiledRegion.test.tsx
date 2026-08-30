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

// Same reasoning for the shared compose input: the real one drags in the
// `@nimbalyst/runtime` barrel. Only its presence and its session key matter here.
vi.mock('../../UnifiedAI/AIInput', () => ({
  AIInput: ({ sessionId }: { sessionId?: string }) => (
    <div data-testid="ai-input" data-session-id={sessionId} />
  ),
}));

import { TiledRegion } from '../TiledRegion';
import {
  activeTileAtomFamily,
  activeTileKey,
  openOrFocusTaskTileAtom,
  openOrFocusTeammateTileAtom,
  paneTreeAtomFamily,
  ROOT_PANE_ID,
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
        { agentId: 'agent-b', name: 'test-writer', teamName: 'squad', agentType: 'general-purpose', status: 'running' },
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
    tree: () => store.get(paneTreeAtomFamily(SESSION)),
    /** The tiles occupying one leaf of the tree, in header order. */
    tilesIn: (paneId: string) => Array.from(
      result.container.querySelectorAll<HTMLElement>(
        `.tiled-region-leaf[data-pane-id="${paneId}"] .tile-header-bar`,
      ),
    ).map(h => h.dataset.dragId),
    dropTile: (dragId: string, paneId: string, edge: 'top' | 'bottom' | 'left' | 'right' | 'center') => {
      const header = result.container.querySelector<HTMLElement>(`.tile-header-bar[data-drag-id="${dragId}"]`)!;
      const zone = result.container.querySelector<HTMLElement>(
        `.tiled-region-leaf[data-pane-id="${paneId}"] .tiled-region-drop-zone[data-drop-edge="${edge}"]`,
      )!;
      // react-dnd's HTML5 backend reads the drag through these events, so the
      // drop has to travel the same route the user's would.
      const dataTransfer = stubDataTransfer();
      fireEvent.dragStart(header, { dataTransfer });
      fireEvent.dragEnter(zone, { dataTransfer });
      fireEvent.dragOver(zone, { dataTransfer });
      fireEvent.drop(zone, { dataTransfer });
    },
  };
}

/** jsdom has no DataTransfer, and the HTML5 backend calls into it on dragStart. */
function stubDataTransfer() {
  const data: Record<string, string> = {};
  return {
    dropEffect: 'move',
    effectAllowed: 'all',
    files: [],
    items: [],
    types: [] as string[],
    setData: (key: string, value: string) => { data[key] = value; },
    getData: (key: string) => data[key] ?? '',
    clearData: () => {},
    setDragImage: () => {},
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

  // Both teammate bodies stay mounted, but only one of them may hold a live
  // compose instance: the shared input keys undo and voice registration off its
  // session key, and a stacked pane would otherwise stand up two at once.
  it('gives only the pane\'s focused tile a compose input', async () => {
    const { store, container, headers } = renderRegion();
    await open(store, { kind: 'teammate', id: 'agent-a' });
    await open(store, { kind: 'teammate', id: 'agent-b' });

    const inputs = () => Array.from(
      container.querySelectorAll<HTMLElement>('[data-testid="ai-input"]'),
    ).map(node => node.dataset.sessionId);

    expect(inputs()).toEqual([`${SESSION}:agent-b`]);

    await act(async () => {
      fireEvent.click(headers()[0]);
    });
    expect(inputs()).toEqual([`${SESSION}:agent-a`]);
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

  // 8a audit: hide-not-unmount must hold for a stack assembled via center-drop
  // (6a), not just tiles that landed in the same pane by default. A tile that
  // moved panes is allowed to remount once (it is a new place in the tree);
  // switching focus within the resulting stack afterward must not remount it
  // again.
  it('keeps a center-drop-stacked tile mounted across repeated focus switches within that pane', async () => {
    const { store, dropTile, headers, panes, visiblePane, tilesIn } = renderRegion();
    await open(store, { kind: 'teammate', id: 'agent-a' });
    await open(store, { kind: 'task', id: 'task-1' });
    await open(store, { kind: 'teammate', id: 'agent-b' });
    await act(async () => { dropTile('agent-a', 'root', 'left'); });
    await act(async () => { dropTile('agent-b', 'pane-2', 'center'); });
    expect(tilesIn('pane-2')).toEqual(['agent-a', 'agent-b']);

    // Each tile remounts exactly once for its cross-pane move (agent-a's edge
    // drop, agent-b's center drop) on top of its initial open-mount fetch -
    // that is the one exception this file's own header comment carves out.
    // What must NOT happen is any fetch beyond that from focus switching.
    await waitFor(() => expect(getTeammateTranscript).toHaveBeenCalledTimes(4));
    const fetchesAfterStack = getTeammateTranscript.mock.calls.length;
    const mountedAfterStack = panes().length;

    const headerIn = (paneId: string, dragId: string) => headers()
      .find(h => h.closest(`[data-pane-id="${paneId}"]`) && h.dataset.dragId === dragId)!;

    // agent-b is focused (it was the one dragged in); switch to agent-a, then
    // back, then to agent-a again.
    await act(async () => { fireEvent.click(headerIn('pane-2', 'agent-a')); });
    expect(visiblePane()?.dataset.tileId).toBe('agent-a');
    await act(async () => { fireEvent.click(headerIn('pane-2', 'agent-b')); });
    expect(visiblePane()?.dataset.tileId).toBe('agent-b');
    await act(async () => { fireEvent.click(headerIn('pane-2', 'agent-a')); });
    expect(visiblePane()?.dataset.tileId).toBe('agent-a');

    // No new mount and no new fetch: both bodies were hidden via CSS, not
    // unmounted and recreated.
    expect(panes().length).toBe(mountedAfterStack);
    expect(getTeammateTranscript.mock.calls.length).toBe(fetchesAfterStack);
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

  // Left/right put the panes side by side ('row'); top/bottom stack them
  // ('column'); the dropped-on edge decides which side the new pane takes.
  it.each([
    ['left', 'row', ['pane-2', 'root']],
    ['right', 'row', ['root', 'pane-2']],
    ['top', 'column', ['pane-2', 'root']],
    ['bottom', 'column', ['root', 'pane-2']],
  ] as const)('dropping a header on the %s edge splits the pane %s', async (edge, direction, children) => {
    const { store, dropTile, tree, tilesIn } = renderRegion();
    await open(store, { kind: 'teammate', id: 'agent-a' });
    await open(store, { kind: 'task', id: 'task-1' });

    await act(async () => { dropTile('agent-a', 'root', edge); });

    expect(tree()).toEqual({ type: 'split', direction, children });
    expect(tilesIn('pane-2')).toEqual(['agent-a']);
    expect(tilesIn('root')).toEqual(['task-1']);
    // The new pane's own focus pointer, not the origin pane's, which still
    // aims at what it was showing.
    expect(store.get(activeTileAtomFamily(activeTileKey(SESSION, 'pane-2'))))
      .toEqual({ kind: 'teammate', id: 'agent-a' });
  });

  // The split has to happen at the dropped-on pane's own path, so a pane that
  // is already a child of a split nests one level deeper rather than joining
  // its parent's children. One split cannot tell those two apart; two can.
  it('splits a pane that is itself the child of a split, nesting three levels deep', async () => {
    const { store, dropTile, tree, tilesIn } = renderRegion();
    await open(store, { kind: 'teammate', id: 'agent-a' });
    await open(store, { kind: 'task', id: 'task-1' });
    await act(async () => { dropTile('agent-a', 'root', 'left'); });

    await open(store, { kind: 'teammate', id: 'agent-b' });
    expect(tilesIn('root')).toEqual(['task-1', 'agent-b']);

    await act(async () => { dropTile('agent-b', 'pane-2', 'top'); });

    expect(tree()).toEqual({
      type: 'split',
      direction: 'row',
      children: [
        { type: 'split', direction: 'column', children: ['pane-3', 'pane-2'] },
        'root',
      ],
    });
    expect(tilesIn('pane-3')).toEqual(['agent-b']);
    expect(tilesIn('pane-2')).toEqual(['agent-a']);
    expect(tilesIn('root')).toEqual(['task-1']);
  });

  // The other half of the drop gesture: the center stacks where the edges
  // split, so the tree must come out of it byte-identical.
  it('stacks the dragged tile into the target pane on a center drop, leaving the tree alone', async () => {
    const { store, dropTile, tree, tilesIn } = renderRegion();
    await open(store, { kind: 'teammate', id: 'agent-a' });
    await open(store, { kind: 'task', id: 'task-1' });
    await open(store, { kind: 'teammate', id: 'agent-b' });
    await act(async () => { dropTile('agent-a', 'root', 'left'); });
    const split = tree();

    await act(async () => { dropTile('agent-b', 'pane-2', 'center'); });

    expect(tree()).toEqual(split);
    expect(tilesIn('pane-2')).toEqual(['agent-a', 'agent-b']);
    expect(tilesIn('root')).toEqual(['task-1']);
    // Focus follows the tile into its new pane, not the pane it left.
    expect(store.get(activeTileAtomFamily(activeTileKey(SESSION, 'pane-2'))))
      .toEqual({ kind: 'teammate', id: 'agent-b' });
  });

  it('only refocuses when a tile is center-dropped on the pane it already occupies', async () => {
    const { store, dropTile, tree, tilesIn } = renderRegion();
    await open(store, { kind: 'teammate', id: 'agent-a' });
    await open(store, { kind: 'task', id: 'task-1' });
    await waitFor(() => expect(getTeammateTranscript).toHaveBeenCalledTimes(1));

    await act(async () => { dropTile('agent-a', 'root', 'center'); });

    expect(tree()).toBe('root');
    expect(tilesIn('root')).toEqual(['agent-a', 'task-1']);
    expect(store.get(activeTileAtomFamily(activeTileKey(SESSION, 'root'))))
      .toEqual({ kind: 'teammate', id: 'agent-a' });
    // The body it was already showing must not be torn down and refetched.
    expect(getTeammateTranscript).toHaveBeenCalledTimes(1);
  });

  it('collapses the split back onto the sibling when a split-created pane loses its last tile', async () => {
    const { store, dropTile, headers, tree, tilesIn } = renderRegion();
    await open(store, { kind: 'teammate', id: 'agent-a' });
    await open(store, { kind: 'task', id: 'task-1' });
    await act(async () => { dropTile('agent-a', 'root', 'left'); });

    const closeAgentA = headers()
      .find(h => h.dataset.dragId === 'agent-a')!
      .querySelector('.tile-header-bar-close')!;
    await act(async () => { fireEvent.click(closeAgentA); });

    expect(tree()).toBe('root');
    expect(tilesIn('root')).toEqual(['task-1']);
  });

  // The collapse can take the root leaf away, so a tile opened afterwards has
  // no pane it was ever assigned to and must not vanish.
  it('lands a newly opened tile in the surviving pane after the root pane collapsed away', async () => {
    const { store, dropTile, headers, tree, tilesIn } = renderRegion();
    await open(store, { kind: 'teammate', id: 'agent-a' });
    await open(store, { kind: 'task', id: 'task-1' });
    await act(async () => { dropTile('task-1', 'root', 'left'); });

    const closeAgentA = headers()
      .find(h => h.dataset.dragId === 'agent-a')!
      .querySelector('.tile-header-bar-close')!;
    await act(async () => { fireEvent.click(closeAgentA); });
    expect(tree()).toBe('pane-2');

    await open(store, { kind: 'teammate', id: 'agent-b' });
    expect(tilesIn('pane-2')).toEqual(['task-1', 'agent-b']);
  });

  // The divider itself is react-mosaic's own <Split>, which measures its
  // parent through getBoundingClientRect - jsdom's default is a zero rect, so
  // it is stubbed only after the split exists, to avoid feeding a fake rect
  // to the drop machinery that created it.
  it('dragging a divider resizes the split and writes the new percentages into the session-lifetime atom', async () => {
    const { store, container, dropTile, tree } = renderRegion();
    await open(store, { kind: 'teammate', id: 'agent-a' });
    await open(store, { kind: 'task', id: 'task-1' });
    await act(async () => { dropTile('agent-a', 'root', 'left'); });

    const rect = {
      width: 1000, height: 600, top: 0, left: 0, right: 1000, bottom: 600, x: 0, y: 0, toJSON: () => {},
    } as DOMRect;
    const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect);
    try {
      const splitEl = container.querySelector('.mosaic-split')!;
      // One mousemove (throttle fires leading-edge) plus clientX on mouseup
      // (Split's onRelease reads the event directly, unthrottled) makes the
      // resulting percentages deterministic regardless of throttle timing.
      await act(async () => {
        fireEvent.mouseDown(splitEl, { button: 0 });
        fireEvent.mouseMove(document, { clientX: 700 });
        fireEvent.mouseUp(document, { clientX: 700 });
      });
    } finally {
      rectSpy.mockRestore();
    }

    expect(tree()).toEqual({
      type: 'split',
      direction: 'row',
      children: ['pane-2', 'root'],
      splitPercentages: [70, 30],
    });
  });

  // The pane tree lives only in a plain Jotai atom family - no persistence
  // middleware, no IPC/workspace-settings write path - so it must not survive
  // past the store that held it, which is what an app reload replaces.
  it('does not survive a simulated app reload - the pane tree is session-lifetime only', async () => {
    const first = renderRegion();
    await open(first.store, { kind: 'teammate', id: 'agent-a' });
    await open(first.store, { kind: 'task', id: 'task-1' });
    await act(async () => { first.dropTile('agent-a', 'root', 'left'); });
    expect(first.tree()).not.toBe(ROOT_PANE_ID);

    first.unmount();

    // A fresh store simulates a renderer reload: paneTreeAtomFamily caches the
    // atom *instance* at module scope, but a new store starts every atom at
    // its own initial value, so nothing survives that was never written to
    // disk.
    const second = renderRegion(seededStore());
    expect(second.tree()).toBe(ROOT_PANE_ID);
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
