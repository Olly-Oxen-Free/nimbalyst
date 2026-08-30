// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activeTileKey,
  openTaskTilesAtomFamily,
  openTeammateTilesAtomFamily,
  paneCollapsedAtomFamily,
} from '../../../store/atoms/agentMode';
import { TileHeaderBar, type TileHeaderBarProps } from '../TileHeaderBar';

// The real atoms are used deliberately here: what the close assertions are for
// is that the header routes through the same writers TaskTileRail /
// TeammateTileRail already use, and a mock of those atoms would hide exactly
// that.
function renderHeader(props?: Partial<TileHeaderBarProps>, store = createStore()) {
  const merged = {
    sessionId: 's1',
    paneId: 'root',
    kind: 'task',
    id: 'task-1',
    name: 'db migration',
    rawStatus: 'running',
    ...props,
  } as TileHeaderBarProps;
  const result = render(
    <Provider store={store}>
      <TileHeaderBar {...merged} />
    </Provider>
  );
  return {
    ...result,
    header: () => result.container.querySelector<HTMLElement>('.tile-header-bar')!,
  };
}

describe('TileHeaderBar', () => {
  afterEach(() => {
    cleanup();
  });

  describe('status derivation', () => {
    it('normalizes a task status through mapTaskStatus', () => {
      const { header } = renderHeader({ kind: 'task', rawStatus: 'stopped' });
      expect(header().querySelector('.tile-header-bar-dot')?.getAttribute('data-status'))
        .toBe('error');
    });

    it('normalizes a teammate status through mapTeammateStatus', () => {
      const { header } = renderHeader({ kind: 'teammate', id: 'agent-1', rawStatus: 'idle' });
      expect(header().querySelector('.tile-header-bar-dot')?.getAttribute('data-status'))
        .toBe('waiting');
    });
  });

  it('renders the name, and the model badge only when a model is known', () => {
    const withoutModel = renderHeader({ name: 'code reviewer' });
    expect(withoutModel.getByText('code reviewer'));
    expect(withoutModel.queryByText('sonnet-4')).toBeNull();
    cleanup();

    const withModel = renderHeader({ name: 'code reviewer', model: 'sonnet-4' });
    expect(withModel.getByText('sonnet-4'));
  });

  describe('close control', () => {
    it('closes a task tile through closeTaskTileAtom', () => {
      const store = createStore();
      store.set(openTaskTilesAtomFamily('s1'), ['task-1', 'task-2']);

      const { header } = renderHeader({ kind: 'task', id: 'task-1' }, store);
      fireEvent.click(header().querySelector('.tile-header-bar-close')!);

      expect(store.get(openTaskTilesAtomFamily('s1'))).toEqual(['task-2']);
    });

    it('closes a teammate tile through closeTeammateTileAtom', () => {
      const store = createStore();
      store.set(openTeammateTilesAtomFamily('s1'), ['agent-1', 'agent-2']);

      const { header } = renderHeader({ kind: 'teammate', id: 'agent-1' }, store);
      fireEvent.click(header().querySelector('.tile-header-bar-close')!);

      expect(store.get(openTeammateTilesAtomFamily('s1'))).toEqual(['agent-2']);
    });
  });

  describe('collapse control', () => {
    it('toggles paneCollapsedAtomFamily for the tile\'s pane, distinct from close and the drag grip', () => {
      const store = createStore();
      const key = activeTileKey('s1', 'pane-2');

      const { header } = renderHeader({ sessionId: 's1', paneId: 'pane-2' }, store);
      const chevron = header().querySelector('.tile-header-bar-collapse')!;
      expect(chevron).not.toBeNull();
      expect(chevron).not.toBe(header().querySelector('.tile-header-bar-close'));
      expect(chevron).not.toBe(header().querySelector('.tile-header-bar-grip'));

      expect(store.get(paneCollapsedAtomFamily(key))).toBe(false);
      fireEvent.click(chevron);
      expect(store.get(paneCollapsedAtomFamily(key))).toBe(true);
      fireEvent.click(chevron);
      expect(store.get(paneCollapsedAtomFamily(key))).toBe(false);
    });

    // `TiledRegion`'s `.tiled-region-header-slot` wraps every header with its
    // own onClick that switches focus (`TiledRegion.tsx` ~line 200-204). The
    // chevron is its own affordance and must not also fire that click.
    it('does not also fire an ancestor click handler (the header-slot focus switch)', () => {
      const store = createStore();
      const onSlotClick = vi.fn();
      const { container } = render(
        <Provider store={store}>
          <div onClick={onSlotClick}>
            <TileHeaderBar sessionId="s1" paneId="pane-2" kind="task" id="task-1" name="db migration" rawStatus="running" />
          </div>
        </Provider>,
      );

      fireEvent.click(container.querySelector('.tile-header-bar-collapse')!);

      expect(onSlotClick).not.toHaveBeenCalled();
      expect(store.get(paneCollapsedAtomFamily(activeTileKey('s1', 'pane-2')))).toBe(true);
    });
  });

  // The header is the drag source react-mosaic's drop zones will accept once
  // the tiled region exists (tasks 5a/6a), so it has to be connected to
  // react-dnd itself - a native dataTransfer drag would not be seen by them.
  it('connects the header to react-dnd as a drag source carrying its own identity', () => {
    const { header } = renderHeader({ kind: 'task', id: 'task-1' });
    expect(header().getAttribute('draggable')).toBe('true');
    expect(header().dataset.dragId).toBe('task-1');
    expect(header().dataset.dragKind).toBe('task');
  });
});
