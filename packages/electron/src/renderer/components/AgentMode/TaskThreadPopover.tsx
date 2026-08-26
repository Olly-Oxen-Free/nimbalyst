/**
 * TaskThreadPopover - wraps a Task sub-agent trigger (the inline chip in
 * `SubAgentChipRow`, the row in `TeammatePanel`'s Sub-agents list) and opens a
 * read-only popover of that task's own transcript on hover.
 *
 * Read-only by design: unlike `TeammateThreadPopover` there is no compose input
 * and no stop control - a Task sub-agent has no channel to receive a message.
 * The header carries the status/tool-name fields that the retired
 * `TaskStatusPopover` used to show on click.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import {
  useFloating,
  useHover,
  useDismiss,
  useRole,
  useInteractions,
  offset,
  flip,
  shift,
  autoUpdate,
  FloatingPortal,
} from '@floating-ui/react';
import { RichTranscriptView } from '@nimbalyst/runtime/ui/AgentTranscript/components/RichTranscriptView';
import type { TranscriptViewMessage } from '@nimbalyst/runtime/ai/server/types';
import {
  taskTranscriptSignalAtomFamily,
  taskTranscriptSignalKey,
} from '../../store/atoms/agentMode';
import { sessionListWorkspaceAtom } from '../../store/atoms/sessions';
import type { SubAgentStatus } from '../../store/atoms/subAgentStatus';

/** Matches `TeammateThreadPopover`'s knobs - a sub-agent's reasoning is most of
 *  what the architect opens this to read. */
const TASK_TRANSCRIPT_SETTINGS = {
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

/** Hover-intent delay: a pointer passing over a chip never reaches the open
 *  delay, so it never mounts the body and never fetches. */
const HOVER_DELAY = { open: 200, close: 150 };

interface TaskThreadBodyProps {
  sessionId: string;
  taskId: string;
}

/** Mounted only while the popover is open, so the fetch is tied to a real
 *  hover rather than to every chip that happens to be on screen. */
const TaskThreadBody: React.FC<TaskThreadBodyProps> = ({ sessionId, taskId }) => {
  const workspacePath = useAtomValue(sessionListWorkspaceAtom);
  const [messages, setMessages] = useState<TranscriptViewMessage[] | null>(null);
  const [loading, setLoading] = useState(true);
  const fetchGenerationRef = useRef(0);

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
    // Discards an in-flight fetch when the hover target changes.
    return () => {
      fetchGenerationRef.current += 1;
    };
  }, [fetchTranscript]);

  // Live follow: Task sub-agent chunks never reach ai_transcript_events, so the
  // refetch trigger is the per-task signal, debounced like the teammate popover's.
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

  if (loading) {
    return (
      <div className="task-thread-popover-loading flex h-full items-center justify-center text-[11px] text-[var(--nim-text-faint)]">
        Loading thread…
      </div>
    );
  }
  if (!messages || messages.length === 0) {
    return (
      <div className="task-thread-popover-empty flex h-full items-center justify-center text-[11px] italic text-[var(--nim-text-faint)]">
        No activity yet from this sub-agent.
      </div>
    );
  }
  return (
    <RichTranscriptView
      // Never the lead's id: RichTranscriptView caches virtual-list state per
      // sessionId, and reusing the lead's would clobber the main transcript's.
      sessionId={`${sessionId}:${taskId}`}
      messages={messages}
      settings={TASK_TRANSCRIPT_SETTINGS}
      persistScrollState={false}
    />
  );
};

TaskThreadBody.displayName = 'TaskThreadBody';

export interface TaskThreadPopoverProps {
  /** The LEAD session id - a Task sub-agent's chunks live in the lead's raw log. */
  sessionId: string;
  taskId: string;
  label: string;
  status: SubAgentStatus;
  lastToolName?: string;
  /** Classes for the hover-trigger wrapper, so it can sit in the host layout. */
  triggerClassName?: string;
  /** The trigger element - a chip or a sidebar row. */
  children: React.ReactNode;
}

export const TaskThreadPopover: React.FC<TaskThreadPopoverProps> = ({
  sessionId,
  taskId,
  label,
  status,
  lastToolName,
  triggerClassName,
  children,
}) => {
  const [open, setOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'top-start',
    strategy: 'fixed',
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  const hover = useHover(context, { delay: HOVER_DELAY });
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'dialog' });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, dismiss, role]);

  return (
    <>
      <div
        ref={refs.setReference}
        {...getReferenceProps()}
        className={`task-thread-popover-trigger ${triggerClassName ?? ''}`}
      >
        {children}
      </div>
      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={{
              ...floatingStyles,
              width: 'min(600px, calc(100vw - 16px))',
              height: 'min(420px, calc(100vh - 16px))',
            }}
            {...getFloatingProps()}
            className="task-thread-popover flex flex-col gap-2 p-3 rounded-md border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] shadow-lg z-50"
          >
            <div className="task-thread-popover-header flex flex-col gap-0.5 min-w-0">
              <div className="task-thread-popover-title text-[12px] font-medium text-[var(--nim-text)] truncate">
                {label}
              </div>
              <div className="task-thread-popover-meta flex flex-wrap gap-x-2 text-[10px] text-[var(--nim-text-faint)]">
                <span>{STATUS_LABELS[status]}</span>
                <span>Active tool: {lastToolName ?? '—'}</span>
              </div>
            </div>
            <div className="task-thread-popover-body flex-1 min-h-0 overflow-hidden rounded border border-[var(--nim-border)]">
              <TaskThreadBody sessionId={sessionId} taskId={taskId} />
            </div>
          </div>
        </FloatingPortal>
      )}
    </>
  );
};

TaskThreadPopover.displayName = 'TaskThreadPopover';
