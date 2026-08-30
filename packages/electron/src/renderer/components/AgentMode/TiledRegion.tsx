/**
 * TiledRegion - the sub-agent side of `SessionTranscript`, sitting beside the
 * main thread where `TaskTileRail`/`TeammateTileRail` used to. It replaces
 * their fixed horizontal-scroll rails with a `react-mosaic-component` tree.
 *
 * At this stage the tree has exactly ONE leaf and no splitting or stacking -
 * that arrives in later tasks - but the leaf's internal model is already the
 * real one: an ordered, kind-interleaved list of the tiles occupying the pane,
 * a `TileHeaderBar` per tile stacked at its top, and a pane-scoped pointer at
 * the one whose body is showing.
 *
 * `SubAgentChipRow` does not live here. It keeps its own job above the compose
 * bar as the *opener*; what it opens lands in this pane.
 *
 * Deliberate choices:
 *
 * - **No `DndProvider` of our own.** `<Mosaic>` already wraps its subtree in
 *   one (MultiBackend), and react-dnd tolerates a single HTML5 backend at a
 *   time. That is also why the header stack renders inside `renderTile` rather
 *   than above the tree: only in there does `MosaicContext` resolve, so
 *   `TileHeaderBar`'s own `DragContextBoundary` finds the surrounding context
 *   and stands up nothing.
 * - **A single-tile pane still shows its one header.** The header is the tile's
 *   drag handle and its close control, so a bare content view would have no
 *   handle at all.
 * - **Every occupying tile stays mounted**, with only the focused one
 *   displayed. Switching focus must not remount a transcript view (losing its
 *   virtual-list scroll state) or refetch it.
 * - **Zero tiles renders nothing at all**, so a session that never opens one
 *   has the layout it had before this feature.
 */

import React, { useCallback, useMemo } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { Mosaic } from 'react-mosaic-component';
import 'react-mosaic-component/react-mosaic-component.css';
import {
  ROOT_PANE_ID,
  activeTileAtomFamily,
  activeTileKey,
  openTaskTilesAtomFamily,
  openTeammateTilesAtomFamily,
  paneTileOrderAtomFamily,
  sessionTasksAtom,
  sessionTeammatesAtom,
  type ActiveTileRef,
} from '../../store/atoms/agentMode';
import { TaskTile } from './TaskTileRail';
import { TeammateTile } from './TeammateTileRail';
import { TileHeaderBar, type TileHeaderBarProps } from './TileHeaderBar';
import './TiledRegion.css';

/** Region width once a tile is showing. Below this a transcript is unreadable. */
const REGION_WIDTH = 420;
/** The main thread always keeps at least half the row. */
const MAX_REGION_WIDTH = '50%';

/** The tree's only leaf until splitting lands (task 5a). */
const SINGLE_LEAF = 'tiles';

export interface TiledRegionProps {
  sessionId: string;
}

/**
 * Renders the mosaic-hosted sub-agent region for a session, or nothing when no
 * tile is open.
 */
export const TiledRegion: React.FC<TiledRegionProps> = React.memo(({ sessionId }) => {
  const teammates = useAtomValue(sessionTeammatesAtom(sessionId));
  const tasks = useAtomValue(sessionTasksAtom(sessionId));
  const openTeammateIds = useAtomValue(openTeammateTilesAtomFamily(sessionId));
  const openTaskIds = useAtomValue(openTaskTilesAtomFamily(sessionId));
  const tileOrder = useAtomValue(paneTileOrderAtomFamily(sessionId));
  const paneKey = activeTileKey(sessionId, ROOT_PANE_ID);
  const activeTile = useAtomValue(activeTileAtomFamily(paneKey));
  const setActiveTile = useSetAtom(activeTileAtomFamily(paneKey));

  // The open-tile lists are the authority on *whether* a tile is open; the
  // order atom only says in what order. So filter the order down to what is
  // still open, then append anything open that the order never saw - the
  // sidebar still opens tiles through `toggleXTileAtom`, which does not write
  // the order, and those tiles must not silently fail to render.
  const occupants = useMemo<ActiveTileRef[]>(() => {
    const ordered = tileOrder.filter(ref => (ref.kind === 'teammate'
      ? openTeammateIds.includes(ref.id)
      : openTaskIds.includes(ref.id)));
    const seen = new Set(ordered.map(ref => `${ref.kind}:${ref.id}`));
    const appended: ActiveTileRef[] = [];
    for (const agentId of openTeammateIds) {
      if (!seen.has(`teammate:${agentId}`)) appended.push({ kind: 'teammate', id: agentId });
    }
    for (const taskId of openTaskIds) {
      if (!seen.has(`task:${taskId}`)) appended.push({ kind: 'task', id: taskId });
    }
    return [...ordered, ...appended];
  }, [tileOrder, openTeammateIds, openTaskIds]);

  // Closing the focused tile leaves the stored pointer aimed at a tile that is
  // no longer open (the header's close and this pane's focus-on-click both
  // fire from the same click), so the pointer is never trusted on its own.
  const focused = useMemo<ActiveTileRef | null>(() => {
    const stillOccupies = activeTile !== null
      && occupants.some(ref => ref.kind === activeTile.kind && ref.id === activeTile.id);
    if (stillOccupies) return activeTile;
    return occupants[occupants.length - 1] ?? null;
  }, [activeTile, occupants]);

  const headerProps = useCallback((ref: ActiveTileRef): TileHeaderBarProps => {
    if (ref.kind === 'teammate') {
      const teammate = teammates.find(t => t.agentId === ref.id);
      return {
        kind: 'teammate',
        sessionId,
        id: ref.id,
        name: teammate?.name ?? ref.id,
        model: teammate?.model,
        // A tile outlives its metadata entry; a vanished row reads as ended
        // rather than blanking the header.
        rawStatus: teammate?.status ?? 'completed',
      };
    }
    const task = tasks.find(t => t.taskId === ref.id);
    return {
      kind: 'task',
      sessionId,
      id: ref.id,
      name: task?.description ?? 'Sub-agent',
      rawStatus: task?.status ?? 'completed',
    };
  }, [sessionId, teammates, tasks]);

  const renderTile = useCallback(() => (
    <div className="tiled-region-leaf">
      <div className="tiled-region-headers">
        {occupants.map(ref => (
          <div
            key={`${ref.kind}:${ref.id}`}
            className="tiled-region-header-slot"
            // The header's own close button bubbles through here too, which is
            // why `focused` recomputes defensively rather than this gating.
            onClick={() => setActiveTile({ kind: ref.kind, id: ref.id })}
          >
            <TileHeaderBar {...headerProps(ref)} />
          </div>
        ))}
      </div>
      <div className="tiled-region-body">
        {occupants.map(ref => (
          <div
            key={`${ref.kind}:${ref.id}`}
            className="tiled-region-pane"
            data-tile-kind={ref.kind}
            data-tile-id={ref.id}
            style={{
              display: focused?.kind === ref.kind && focused.id === ref.id ? 'flex' : 'none',
            }}
          >
            {ref.kind === 'teammate'
              ? <TeammateTile sessionId={sessionId} agentId={ref.id} />
              : <TaskTile sessionId={sessionId} taskId={ref.id} />}
          </div>
        ))}
      </div>
    </div>
  ), [occupants, focused, headerProps, setActiveTile, sessionId]);

  // No-op: the tree is a single fixed leaf until splitting lands, so there is
  // no user-initiated shape change to persist yet.
  const handleChange = useCallback(() => {}, []);

  if (occupants.length === 0) return null;

  return (
    <div
      className="tiled-region"
      style={{ flex: '0 1 auto', width: REGION_WIDTH, maxWidth: MAX_REGION_WIDTH }}
      aria-label="Sub-agent threads"
    >
      <Mosaic<string>
        // Mosaic refuses to update its mosaicId after instantiation (it warns
        // and keeps the stale one), so a session switch has to rebuild the
        // tree rather than re-render it.
        key={sessionId}
        className="tiled-region-mosaic"
        mosaicId={`tiled-region:${sessionId}`}
        value={SINGLE_LEAF}
        onChange={handleChange}
        renderTile={renderTile}
      />
    </div>
  );
});

TiledRegion.displayName = 'TiledRegion';
