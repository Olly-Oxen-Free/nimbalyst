/**
 * TileHeaderBar - the slim header bar for ONE open tile inside a pane: status
 * dot, name, model badge, drag handle, close control.
 *
 * This is not `SubAgentChipRow` in another position. That row keeps its own job
 * above the compose bar as the *opener*; this header belongs to a tile that is
 * already open, and is what the user grabs to move that tile between panes.
 *
 * The dot's status comes from the normalized `SubAgentStatus` mapping
 * (`store/atoms/subAgentStatus.ts`), never from the raw `TeammateInfo.status` /
 * `TaskInfo.status` strings - the same derivation the chip row uses.
 */

import React, { useCallback, useContext } from 'react';
import { useSetAtom } from 'jotai';
import { DndContext, DndProvider, useDrag } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { MosaicContext, MosaicDragType } from 'react-mosaic-component';
import {
  closeTaskTileAtom,
  closeTeammateTileAtom,
  type TaskInfo,
} from '../../store/atoms/agentMode';
import {
  mapTaskStatus,
  mapTeammateStatus,
  type SubAgentStatus,
} from '../../store/atoms/subAgentStatus';
import type { TeammateInfo } from './TeammatePanel';

/**
 * Dot color per normalized status. One complete class per status, never
 * concatenated fragments (`docs/UI_PATTERNS.md`), and the same `--nim-*`
 * variable per status that `SubAgentChipRow`'s chips use, so a header and its
 * chip never disagree about what "blocked" looks like.
 */
const STATUS_DOT_CLASSES: Record<SubAgentStatus, string> = {
  working: 'bg-[var(--nim-info)]',
  waiting: 'bg-[var(--nim-text-faint)]',
  blocked: 'bg-[var(--nim-warning)]',
  complete: 'bg-[var(--nim-success)]',
  error: 'bg-[var(--nim-error)]',
};

/**
 * Payload react-mosaic's drop targets receive when a header is dragged. The
 * `type`/`mosaicId` pair is what those targets check, so it has to match
 * mosaic's own window drags exactly - a native HTML5 `dataTransfer` drag would
 * not be seen by them at all.
 */
export interface TileHeaderDragItem {
  type: typeof MosaicDragType.WINDOW;
  /** Identifies the Mosaic tree this drag is valid for. `undefined` until the
   *  header is rendered inside a `<Mosaic>` subtree, which task 4a builds. */
  mosaicId: string | undefined;
  subAgent: { kind: 'teammate' | 'task'; id: string };
}

/**
 * react-dnd needs a `DndProvider` ancestor, and only one HTML5 backend may
 * exist at a time. So: use the surrounding provider when the header is
 * rendered inside one (the tiled region will own it), and stand up a private
 * one only when it is rendered on its own.
 */
const DragContextBoundary: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const surrounding = useContext(DndContext);
  if (surrounding?.dragDropManager) {
    return <>{children}</>;
  }
  return <DndProvider backend={HTML5Backend}>{children}</DndProvider>;
};

export type TileHeaderBarProps = {
  /** Session the tile belongs to. */
  sessionId: string;
  /** Teammate agent id / task id - travels with the drag and with the close. */
  id: string;
  /** Teammate name / task description. */
  name: string;
  /** Rendered only when the source knows one. `TaskInfo` carries no model, so
   *  task headers have no badge. */
  model?: string;
} & (
  | { kind: 'teammate'; rawStatus: TeammateInfo['status'] }
  | { kind: 'task'; rawStatus: TaskInfo['status'] }
);

/**
 * Renders the header bar for one open tile.
 */
const TileHeaderBarInner: React.FC<TileHeaderBarProps> = ({
  sessionId,
  id,
  name,
  model,
  kind,
  rawStatus,
}) => {
  const status = kind === 'teammate' ? mapTeammateStatus(rawStatus) : mapTaskStatus(rawStatus);

  const mosaic = useContext(MosaicContext);
  const mosaicId: string | undefined = mosaic?.mosaicId;
  const [, connectDrag] = useDrag<TileHeaderDragItem, unknown, unknown>(() => ({
    type: MosaicDragType.WINDOW,
    item: { type: MosaicDragType.WINDOW, mosaicId, subAgent: { kind, id } },
  }), [mosaicId, kind, id]);

  // Both writers are subscribed unconditionally - the tile's kind is fixed for
  // its lifetime, but a conditional hook call would not be.
  const closeTaskTile = useSetAtom(closeTaskTileAtom);
  const closeTeammateTile = useSetAtom(closeTeammateTileAtom);
  const handleClose = useCallback(() => {
    if (kind === 'teammate') {
      closeTeammateTile({ sessionId, agentId: id });
    } else {
      closeTaskTile({ sessionId, taskId: id });
    }
  }, [kind, sessionId, id, closeTeammateTile, closeTaskTile]);

  return (
    <div
      ref={(node) => { connectDrag(node); }}
      className="tile-header-bar flex items-center gap-1.5 h-[24px] px-1.5 border-b border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] text-[11px] leading-none select-none"
      data-drag-id={id}
      data-drag-kind={kind}
    >
      <span
        className={`tile-header-bar-dot shrink-0 w-[7px] h-[7px] rounded-full ${STATUS_DOT_CLASSES[status]}`}
        data-status={status}
        aria-hidden="true"
      />
      <span className="tile-header-bar-name min-w-0 flex-1 truncate font-medium text-[var(--nim-text)]">
        {name}
      </span>
      {model && (
        <span className="tile-header-bar-model shrink-0 px-1 rounded-[3px] border border-[var(--nim-border)] text-[10px] text-[var(--nim-text-faint)]">
          {model}
        </span>
      )}
      <span
        className="tile-header-bar-grip shrink-0 cursor-grab text-[var(--nim-text-faint)]"
        aria-hidden="true"
      >
        &#x22EE;&#x22EE;
      </span>
      <button
        type="button"
        className="tile-header-bar-close shrink-0 bg-transparent border-none cursor-pointer text-[var(--nim-text-muted)] hover:text-[var(--nim-text)] leading-none px-1"
        onClick={handleClose}
        aria-label={`Close ${name} tile`}
      >
        &#x2715;
      </button>
    </div>
  );
};

export const TileHeaderBar: React.FC<TileHeaderBarProps> = React.memo((props) => (
  <DragContextBoundary>
    <TileHeaderBarInner {...props} />
  </DragContextBoundary>
));

TileHeaderBar.displayName = 'TileHeaderBar';
