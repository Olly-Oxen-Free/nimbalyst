/**
 * TiledRegion - the sub-agent side of `SessionTranscript`, sitting beside the
 * main thread where `TaskTileRail`/`TeammateTileRail` used to. It replaces
 * their fixed horizontal-scroll rails with a `react-mosaic-component` tree.
 *
 * Panes split by dragging a `TileHeaderBar` onto an edge of any pane, at any
 * depth: the drop replaces that pane's *node* with a two-child split of it and
 * a freshly minted pane, so a pane that is already a child of a split nests one
 * level deeper rather than flattening into its parent. That recursion is
 * react-mosaic's own tree model (`MosaicPath` + `updateTree`), not a shape this
 * file tracks itself.
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
 * - **Our own edge drop zones, not the library's.** `MosaicDropTarget` is not
 *   exported from the package index, and its targets quarter the whole pane
 *   with no center region - task 6a needs that center free. So the four zones
 *   below are ours, sized in CSS (`TiledRegion.css`) rather than measured, and
 *   what they carry to `createDragToUpdates` would be wrong anyway: the thing
 *   being dragged is a tile *inside* a pane, not a node of the tree.
 * - **A single-tile pane still shows its one header.** The header is the tile's
 *   drag handle and its close control, so a bare content view would have no
 *   handle at all.
 * - **Every occupying tile stays mounted**, with only the focused one
 *   displayed. Switching focus must not remount a transcript view (losing its
 *   virtual-list scroll state) or refetch it. Moving a tile to another pane is
 *   the one exception - it is a different place in the React tree, so its body
 *   necessarily remounts there.
 * - **A pane that loses its last tile is removed**, whether that was a close or
 *   a drag-out, so its sibling takes the freed space back.
 * - **Zero tiles renders nothing at all**, so a session that never opens one
 *   has the layout it had before this feature.
 */

import React, { useCallback, useEffect, useMemo } from 'react';
import { useAtomValue, useSetAtom, useStore } from 'jotai';
import { useDrop } from 'react-dnd';
import {
  Mosaic,
  MosaicDragType,
  createRemoveUpdate,
  getLeaves,
  getNodeAtPath,
  isSplitNode,
  updateTree,
  type MosaicDirection,
  type MosaicNode,
  type MosaicPath,
} from 'react-mosaic-component';
import 'react-mosaic-component/react-mosaic-component.css';
import {
  ROOT_PANE_ID,
  activeTileAtomFamily,
  activeTileKey,
  openTaskTilesAtomFamily,
  openTeammateTilesAtomFamily,
  paneTileOrderAtomFamily,
  paneTreeAtomFamily,
  sessionTasksAtom,
  sessionTeammatesAtom,
  tilePaneAtomFamily,
  tilePaneKey,
  type ActiveTileRef,
} from '../../store/atoms/agentMode';
import { TaskTile } from './TaskTileRail';
import { TeammateTile } from './TeammateTileRail';
import { TileHeaderBar, type TileHeaderBarProps, type TileHeaderDragItem } from './TileHeaderBar';
import './TiledRegion.css';

/** Region width once a tile is showing. Below this a transcript is unreadable. */
const REGION_WIDTH = 420;
/** The main thread always keeps at least half the row. */
const MAX_REGION_WIDTH = '50%';

/** The pane edges a header can be dropped on. The remaining center belongs to
 *  task 6a and has no zone here. */
const DROP_EDGES = ['top', 'bottom', 'left', 'right'] as const;
type TileDropEdge = (typeof DROP_EDGES)[number];

/** niri's convention: a left/right drop puts the panes side by side (mosaic's
 *  'row'), a top/bottom drop stacks them ('column'). */
const EDGE_DIRECTION: Record<TileDropEdge, MosaicDirection> = {
  left: 'row',
  right: 'row',
  top: 'column',
  bottom: 'column',
};

/** Whether the new pane goes before the dropped-on one in the split. */
const EDGE_TAKES_FIRST: Record<TileDropEdge, boolean> = {
  left: true,
  top: true,
  right: false,
  bottom: false,
};

/** Path to `paneId` in `node`, or null. react-mosaic has `getNodeAtPath` but no
 *  inverse, and the empty-pane sweep only knows the pane's id. */
function pathToPane(node: MosaicNode<string>, paneId: string, prefix: MosaicPath = []): MosaicPath | null {
  if (typeof node === 'string') return node === paneId ? prefix : null;
  if (!isSplitNode(node)) return null;
  for (let index = 0; index < node.children.length; index++) {
    const found = pathToPane(node.children[index], paneId, [...prefix, index]);
    if (found) return found;
  }
  return null;
}

/** Lowest `pane-N` the tree is not already using. */
function mintPaneId(tree: MosaicNode<string>): string {
  const used = new Set(getLeaves(tree));
  let index = 2;
  while (used.has(`pane-${index}`)) index++;
  return `pane-${index}`;
}

/**
 * One edge drop zone. Sized and gated in CSS - the library only lets its own
 * targets through while a window drag is running (`.mosaic.-dragging`), and
 * these follow that, so they never swallow a click.
 */
const TileDropZone: React.FC<{
  edge: TileDropEdge;
  onDrop: (ref: ActiveTileRef) => void;
}> = ({ edge, onDrop }) => {
  const [, connectDrop] = useDrop<TileHeaderDragItem, unknown, unknown>(() => ({
    accept: MosaicDragType.WINDOW,
    // Mosaic's own window drags share this type and carry no `subAgent`.
    drop: (item) => { if (item.subAgent) onDrop(item.subAgent); },
  }), [onDrop]);

  return (
    <div
      ref={(node) => { connectDrop(node); }}
      className={`tiled-region-drop-zone tiled-region-drop-zone-${edge}`}
      data-drop-edge={edge}
    />
  );
};

interface TilePaneProps {
  sessionId: string;
  paneId: string;
  path: MosaicPath;
  occupants: ActiveTileRef[];
  headerProps: (ref: ActiveTileRef) => TileHeaderBarProps;
  onEdgeDrop: (path: MosaicPath, edge: TileDropEdge, ref: ActiveTileRef) => void;
}

/** One leaf of the tree: its own header stack, its own tile bodies, its own
 *  focus pointer, and the four zones that split it. */
const TilePane: React.FC<TilePaneProps> = ({
  sessionId,
  paneId,
  path,
  occupants,
  headerProps,
  onEdgeDrop,
}) => {
  const key = activeTileKey(sessionId, paneId);
  const activeTile = useAtomValue(activeTileAtomFamily(key));
  const setActiveTile = useSetAtom(activeTileAtomFamily(key));

  // Closing the focused tile leaves the stored pointer aimed at a tile that is
  // no longer open (the header's close and this pane's focus-on-click both
  // fire from the same click), so the pointer is never trusted on its own. A
  // tile dragged out to another pane leaves the same stale pointer behind.
  const focused = useMemo<ActiveTileRef | null>(() => {
    const stillOccupies = activeTile !== null
      && occupants.some(ref => ref.kind === activeTile.kind && ref.id === activeTile.id);
    if (stillOccupies) return activeTile;
    return occupants[occupants.length - 1] ?? null;
  }, [activeTile, occupants]);

  return (
    <div className="tiled-region-leaf" data-pane-id={paneId}>
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
      {DROP_EDGES.map(edge => (
        <TileDropZone
          key={edge}
          edge={edge}
          onDrop={ref => onEdgeDrop(path, edge, ref)}
        />
      ))}
    </div>
  );
};

export interface TiledRegionProps {
  sessionId: string;
}

/**
 * Renders the mosaic-hosted sub-agent region for a session, or nothing when no
 * tile is open.
 */
export const TiledRegion: React.FC<TiledRegionProps> = React.memo(({ sessionId }) => {
  const store = useStore();
  const teammates = useAtomValue(sessionTeammatesAtom(sessionId));
  const tasks = useAtomValue(sessionTasksAtom(sessionId));
  const openTeammateIds = useAtomValue(openTeammateTilesAtomFamily(sessionId));
  const openTaskIds = useAtomValue(openTaskTilesAtomFamily(sessionId));
  const tileOrder = useAtomValue(paneTileOrderAtomFamily(sessionId));
  const tree = useAtomValue(paneTreeAtomFamily(sessionId));
  const setTree = useSetAtom(paneTreeAtomFamily(sessionId));
  const tilePanes = useAtomValue(tilePaneAtomFamily(sessionId));
  const setTilePanes = useSetAtom(tilePaneAtomFamily(sessionId));

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

  const leaves = useMemo(() => getLeaves(tree), [tree]);

  // A tile with no assignment is one nothing has moved yet, so it belongs to
  // the root pane - the same pane `openOrFocusXTileAtom` focuses it in. Once a
  // collapse has taken the root leaf away, or a tile's own pane with it, the
  // first surviving leaf takes it instead: no tile is ever stranded on a pane
  // id the tree no longer holds.
  const occupantsByPane = useMemo(() => {
    const byPane = new Map<string, ActiveTileRef[]>(leaves.map(leaf => [leaf, []]));
    const fallback = byPane.has(ROOT_PANE_ID) ? ROOT_PANE_ID : (leaves[0] ?? ROOT_PANE_ID);
    if (!byPane.has(fallback)) byPane.set(fallback, []);
    for (const ref of occupants) {
      const assigned = tilePanes[tilePaneKey(ref)];
      byPane.get(assigned && byPane.has(assigned) ? assigned : fallback)!.push(ref);
    }
    return byPane;
  }, [occupants, tilePanes, leaves]);

  // Splitting is a node replacement at the dropped-on pane's own path, so it
  // works identically at every depth: the pane becomes a two-child split of
  // itself and the new pane, and whatever nested it stays as it was.
  const handleEdgeDrop = useCallback((path: MosaicPath, edge: TileDropEdge, ref: ActiveTileRef) => {
    const target = getNodeAtPath(tree, path);
    if (typeof target !== 'string') return;
    const occupying = occupantsByPane.get(target) ?? [];
    // Dropping a pane's only tile back on that pane would split and immediately
    // collapse again.
    if (occupying.length <= 1 && occupying.some(t => t.kind === ref.kind && t.id === ref.id)) return;

    const paneId = mintPaneId(tree);
    const children = EDGE_TAKES_FIRST[edge] ? [paneId, target] : [target, paneId];
    setTree(updateTree(tree, [{
      path,
      spec: { $set: { type: 'split', direction: EDGE_DIRECTION[edge], children } },
    }]));
    // Pin the tiles staying behind to the pane they are in before the moved one
    // takes the new pane: after this the target may no longer be the leaf an
    // unassigned tile would fall back to.
    const next = { ...tilePanes };
    for (const staying of occupying) next[tilePaneKey(staying)] = target;
    next[tilePaneKey(ref)] = paneId;
    setTilePanes(next);
    store.set(activeTileAtomFamily(activeTileKey(sessionId, paneId)), ref);
  }, [tree, occupantsByPane, tilePanes, setTree, setTilePanes, store, sessionId]);

  // A pane emptied by its last tile closing - or by that tile being dragged
  // out - is removed, which is what collapses the split back onto its sibling.
  // The root leaf is exempt: when it empties the region unmounts entirely.
  useEffect(() => {
    const empty = leaves.filter(leaf => (occupantsByPane.get(leaf)?.length ?? 0) === 0);
    if (empty.length === 0) return;
    let next = tree;
    for (const leaf of empty) {
      const path = pathToPane(next, leaf);
      if (!path || path.length === 0) continue;
      next = updateTree(next, [createRemoveUpdate(next, path)]);
    }
    if (next !== tree) setTree(next);
  }, [tree, leaves, occupantsByPane, setTree]);

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

  const renderTile = useCallback((paneId: string, path: MosaicPath) => (
    <TilePane
      sessionId={sessionId}
      paneId={paneId}
      path={path}
      occupants={occupantsByPane.get(paneId) ?? []}
      headerProps={headerProps}
      onEdgeDrop={handleEdgeDrop}
    />
  ), [sessionId, occupantsByPane, headerProps, handleEdgeDrop]);

  // Resizes and the library's own normalization arrive here; dropping them
  // would silently revert every split handle the user drags.
  const handleChange = useCallback((next: MosaicNode<string> | null) => {
    if (next !== null) setTree(next);
  }, [setTree]);

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
        value={tree}
        onChange={handleChange}
        renderTile={renderTile}
      />
    </div>
  );
});

TiledRegion.displayName = 'TiledRegion';
