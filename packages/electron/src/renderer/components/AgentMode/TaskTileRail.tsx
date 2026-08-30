/**
 * TaskTile - one Task sub-agent's transcript, as shown inside a `TiledRegion`
 * pane. Clicking a Task chip (inline row) or a Sub-agents sidebar row opens
 * that task's tile in `openTaskTilesAtomFamily`.
 *
 * Purpose-built to this one content type: a Task sub-agent transcript. A
 * depth-2 sub-agent's tile looks exactly like a top-level one's.
 *
 * The tile fills whatever pane the region gives it - sizing and placement are
 * the mosaic's business, not the tile's, and the pane's `TileHeaderBar` owns
 * the close control, so the tile has none of its own.
 *
 * The tile lives inside the transcript-collapsed gate: it is off screen in a
 * collapsed (Files) layout, but the open-tile atoms survive the collapse, so
 * it reappears when the transcript is expanded again.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { RichTranscriptView } from '@nimbalyst/runtime/ui/AgentTranscript/components/RichTranscriptView';
import type { TranscriptViewMessage } from '@nimbalyst/runtime/ai/server/types';
import {
  sessionTasksAtom,
  taskTranscriptSignalAtomFamily,
  taskTranscriptSignalKey,
  type TaskInfo,
} from '../../store/atoms/agentMode';
import { sessionListWorkspaceAtom } from '../../store/atoms/sessions';
import { mapTaskStatus, type SubAgentStatus } from '../../store/atoms/subAgentStatus';

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

export interface TaskTileProps {
  sessionId: string;
  taskId: string;
}

export const TaskTile: React.FC<TaskTileProps> = ({ sessionId, taskId }) => {
  const workspacePath = useAtomValue(sessionListWorkspaceAtom);
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

  return (
    <div
      className="task-tile flex flex-col h-full w-full min-h-0 rounded-md border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] overflow-hidden"
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
            agentName={task?.description ?? 'Sub-Agent'}
          />
        )}
      </div>
    </div>
  );
};

TaskTile.displayName = 'TaskTile';
