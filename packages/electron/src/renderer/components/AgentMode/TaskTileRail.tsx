/**
 * TaskTileRail - the column of Task sub-agent transcript tiles that sits beside
 * the main thread in `SessionTranscript`. Clicking a Task chip (inline row) or a
 * Sub-agents sidebar row toggles that task's tile in `openTaskTilesAtomFamily`.
 *
 * Purpose-built to this one content type: a Task sub-agent transcript. It is
 * not a docking framework - no drag-to-rearrange, no persistence across an app
 * restart, and a depth-2 sub-agent's tile looks exactly like a top-level one's.
 *
 * Layout decisions, all of which are choices rather than defaults:
 *
 * - **Main thread keeps priority.** The rail is `flex: 0 1 auto` capped at
 *   `MAX_RAIL_WIDTH` of the row, so the main transcript always keeps at least
 *   half the width and the full height.
 * - **Many tiles (4+) scroll rather than shrink.** Tiles are a fixed
 *   `TILE_WIDTH` and the rail scrolls horizontally once they overflow the cap.
 *   A shrink floor was the alternative; at four tiles a proportional share is
 *   already too narrow to read a transcript in, so a hard floor plus scrolling
 *   is the honest behavior.
 * - **Zero tiles renders nothing at all** - no rail element, so the layout is
 *   byte-identical to a session with this feature unused.
 * - **A tile is user-closable.** Not a stated requirement, but tiles never
 *   auto-close on task completion, so without a close control they would
 *   accumulate for the life of the session.
 * - **The rail lives inside the transcript-collapsed gate.** Chips render even
 *   when the transcript is collapsed, so a click there toggles the atom with
 *   nothing on screen; the tile appears when the transcript is expanded again.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { RichTranscriptView } from '@nimbalyst/runtime/ui/AgentTranscript/components/RichTranscriptView';
import type { TranscriptViewMessage } from '@nimbalyst/runtime/ai/server/types';
import {
  closeTaskTileAtom,
  openTaskTilesAtomFamily,
  sessionTasksAtom,
  taskTranscriptSignalAtomFamily,
  taskTranscriptSignalKey,
  type TaskInfo,
} from '../../store/atoms/agentMode';
import { sessionListWorkspaceAtom } from '../../store/atoms/sessions';
import { mapTaskStatus, type SubAgentStatus } from '../../store/atoms/subAgentStatus';

/** Per-tile width. Below this a transcript is not readable. */
const TILE_WIDTH = 320;
/** Share of the row the rail may take before it starts scrolling horizontally. */
const MAX_RAIL_WIDTH = '50%';

/** Matches the hover popover's knobs - a sub-agent's reasoning is most of what
 *  the architect opens this to read. */
const TILE_TRANSCRIPT_SETTINGS = {
  showToolCalls: true,
  compactMode: true,
  collapseTools: true,
  showThinking: true,
  showSessionInit: false,
};

const STATUS_LABELS: Record<SubAgentStatus, string> = {
  working: 'Working',
  waiting: 'Waiting',
  blocked: 'Blocked',
  complete: 'Complete',
  error: 'Error',
};

interface TaskTileProps {
  sessionId: string;
  taskId: string;
}

const TaskTile: React.FC<TaskTileProps> = ({ sessionId, taskId }) => {
  const workspacePath = useAtomValue(sessionListWorkspaceAtom);
  const closeTile = useSetAtom(closeTaskTileAtom);
  const tasks = useAtomValue(sessionTasksAtom(sessionId));
  const [messages, setMessages] = useState<TranscriptViewMessage[] | null>(null);
  const [loading, setLoading] = useState(true);
  const fetchGenerationRef = useRef(0);

  // A tile stays open when its task completes, so its badge has to keep
  // tracking the live entry. If the entry later leaves session metadata
  // entirely, the last-seen one is retained rather than blanking the header.
  const liveTask = tasks.find(t => t.taskId === taskId);
  const lastSeenRef = useRef<TaskInfo | undefined>(liveTask);
  if (liveTask) lastSeenRef.current = liveTask;
  const task = liveTask ?? lastSeenRef.current;
  const status = task ? mapTaskStatus(task.status) : 'complete';

  const fetchTranscript = useCallback(async () => {
    if (!workspacePath) return;
    const generation = ++fetchGenerationRef.current;
    try {
      const next = await window.electronAPI.aiGetTaskSubagentTranscript(
        sessionId,
        { taskId },
        workspacePath,
      );
      if (generation !== fetchGenerationRef.current) return;
      setMessages(next);
    } catch {
      if (generation !== fetchGenerationRef.current) return;
      setMessages(previous => previous ?? []);
    }
    setLoading(false);
  }, [sessionId, taskId, workspacePath]);

  useEffect(() => {
    void fetchTranscript();
    return () => {
      fetchGenerationRef.current += 1;
    };
  }, [fetchTranscript]);

  // Live follow: Task sub-agent chunks never reach ai_transcript_events, so the
  // refetch trigger is the per-task signal, debounced like the popover's.
  const transcriptSignal = useAtomValue(
    taskTranscriptSignalAtomFamily(taskTranscriptSignalKey(sessionId, taskId)),
  );
  const initialSignalRef = useRef(transcriptSignal);
  useEffect(() => {
    if (transcriptSignal === initialSignalRef.current) return;
    const debounceTimer = window.setTimeout(() => {
      void fetchTranscript();
    }, 1_500);
    return () => window.clearTimeout(debounceTimer);
  }, [fetchTranscript, transcriptSignal]);

  const handleClose = useCallback(() => {
    closeTile({ sessionId, taskId });
  }, [closeTile, sessionId, taskId]);

  return (
    <div
      className="task-tile flex flex-col rounded-md border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] overflow-hidden"
      style={{ flex: `0 0 ${TILE_WIDTH}px`, width: TILE_WIDTH }}
      data-task-id={taskId}
      data-status={status}
    >
      <div className="task-tile-header flex items-start gap-2 px-2 py-1.5 border-b border-[var(--nim-border)]">
        <div className="min-w-0 flex-1">
          <div className="task-tile-title text-[12px] font-medium text-[var(--nim-text)] truncate">
            {task?.description ?? 'Sub-agent'}
          </div>
          <div className="task-tile-status text-[10px] text-[var(--nim-text-faint)]">
            {STATUS_LABELS[status]}
          </div>
        </div>
        <button
          type="button"
          className="task-tile-close shrink-0 bg-transparent border-none cursor-pointer text-[var(--nim-text-muted)] hover:text-[var(--nim-text)] leading-none px-1"
          onClick={handleClose}
          aria-label={`Close ${task?.description ?? 'sub-agent'} tile`}
        >
          &#x2715;
        </button>
      </div>
      <div className="task-tile-body flex-1 min-h-0 overflow-hidden">
        {loading ? (
          <div className="task-tile-loading flex h-full items-center justify-center text-[11px] text-[var(--nim-text-faint)]">
            Loading thread&#8230;
          </div>
        ) : !messages || messages.length === 0 ? (
          <div className="task-tile-empty flex h-full items-center justify-center text-[11px] italic text-[var(--nim-text-faint)]">
            No activity yet from this sub-agent.
          </div>
        ) : (
          <RichTranscriptView
            // `:tile` suffix: RichTranscriptView caches virtual-list state per
            // sessionId, and the hover popover already claims `session:task`.
            sessionId={`${sessionId}:${taskId}:tile`}
            messages={messages}
            settings={TILE_TRANSCRIPT_SETTINGS}
            persistScrollState={false}
          />
        )}
      </div>
    </div>
  );
};

TaskTile.displayName = 'TaskTile';

export interface TaskTileRailProps {
  sessionId: string;
}

/** Renders one tile per open Task sub-agent, or nothing when none are open. */
export const TaskTileRail: React.FC<TaskTileRailProps> = React.memo(({ sessionId }) => {
  const openTaskIds = useAtomValue(openTaskTilesAtomFamily(sessionId));
  const tiles = useMemo(
    () => openTaskIds.map(taskId => (
      <TaskTile key={taskId} sessionId={sessionId} taskId={taskId} />
    )),
    [openTaskIds, sessionId],
  );

  if (openTaskIds.length === 0) return null;

  return (
    <div
      className="task-tile-rail flex gap-2 overflow-x-auto overflow-y-hidden"
      style={{ flex: '0 1 auto', maxWidth: MAX_RAIL_WIDTH }}
      aria-label="Sub-agent transcripts"
    >
      {tiles}
    </div>
  );
});

TaskTileRail.displayName = 'TaskTileRail';
