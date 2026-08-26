/**
 * TaskToolWidget - replaces the generic sub-agent card for the assistant
 * message that spawned a plain `Task` sub-agent. Clicking it expands the
 * sub-agent's own transcript inline (projected out of the lead session's raw
 * log by `ai:getTaskSubagentTranscript`).
 *
 * Registered for the `Task` tool name from `AgentMode.tsx` via
 * `setTranscriptToolWidgets`. Teammate spawns are also `Task` calls, but
 * `RichTranscriptView` excludes them from widget lookup so their existing card
 * stays untouched.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { RichTranscriptView } from '@nimbalyst/runtime/ui/AgentTranscript/components/RichTranscriptView';
import type { CustomToolWidgetProps } from '@nimbalyst/runtime/ui/AgentTranscript/components/CustomToolWidgets';
import type { TranscriptViewMessage } from '@nimbalyst/runtime/ai/server/types';
import {
  sessionTasksAtom,
  taskTranscriptSignalAtomFamily,
  taskTranscriptSignalKey,
} from '../../store/atoms/agentMode';

/** Contribution source id for this widget's registry entry. */
export const TASK_TOOL_WIDGET_SOURCE = 'task-subagent-visibility';

/** Same knobs as the teammate thread popover — thinking is most of the value. */
const TASK_TRANSCRIPT_SETTINGS = {
  showToolCalls: true,
  compactMode: true,
  collapseTools: true,
  showThinking: true,
  showSessionInit: false,
};

export const TaskToolWidget: React.FC<CustomToolWidgetProps> = ({
  message,
  isExpanded,
  onToggle,
  workspacePath,
  sessionId,
}) => {
  const tool = message.toolCall;
  const toolUseId = tool?.providerToolCallId;
  const args = tool?.arguments as Record<string, unknown> | undefined;
  const description = typeof args?.description === 'string' ? args.description : null;
  const agentType = message.subagent?.agentType
    ?? (typeof args?.subagent_type === 'string' ? args.subagent_type : null);

  const [messages, setMessages] = useState<TranscriptViewMessage[] | null>(null);
  const [loading, setLoading] = useState(false);
  const fetchGenerationRef = useRef(0);

  const fetchTranscript = useCallback(async () => {
    if (!toolUseId || !workspacePath) {
      setMessages([]);
      return;
    }
    const generation = ++fetchGenerationRef.current;
    setLoading(true);
    try {
      const next = await window.electronAPI.aiGetTaskSubagentTranscript(
        sessionId,
        { toolUseId },
        workspacePath,
      );
      if (generation !== fetchGenerationRef.current) return;
      setMessages(next);
    } catch {
      if (generation !== fetchGenerationRef.current) return;
      setMessages(previous => previous ?? []);
    }
    setLoading(false);
  }, [sessionId, toolUseId, workspacePath]);

  useEffect(() => {
    if (!isExpanded) return;
    void fetchTranscript();
    return () => {
      fetchGenerationRef.current += 1;
    };
  }, [fetchTranscript, isExpanded]);

  // Live follow while expanded. The signal is keyed by taskId, which only the
  // session's task list maps back to this widget's toolUseId.
  const tasks = useAtomValue(sessionTasksAtom(sessionId));
  const taskId = useMemo(
    () => tasks.find(task => task.toolUseId === toolUseId)?.taskId ?? '',
    [tasks, toolUseId],
  );
  const transcriptSignal = useAtomValue(
    taskTranscriptSignalAtomFamily(taskTranscriptSignalKey(sessionId, taskId)),
  );
  const initialSignalRef = useRef(transcriptSignal);
  useEffect(() => {
    if (!isExpanded) return;
    if (transcriptSignal === initialSignalRef.current) return;
    const debounceTimer = window.setTimeout(() => {
      void fetchTranscript();
    }, 1_500);
    return () => window.clearTimeout(debounceTimer);
  }, [fetchTranscript, isExpanded, transcriptSignal]);

  return (
    <div className="task-tool-widget rounded border border-[var(--nim-border)] overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="task-tool-widget-header w-full py-1 px-2 flex items-center gap-1.5 text-left border-none cursor-pointer text-sm bg-transparent"
      >
        <span className="task-tool-widget-title font-mono text-sm text-[var(--nim-text)] font-medium">
          Sub-Agent
          {agentType && (
            <span className="task-tool-widget-agent-type text-[var(--nim-primary)] font-semibold"> [{agentType}]</span>
          )}
        </span>
        {description && (
          <span className="task-tool-widget-description flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[var(--nim-text-muted)]">
            {description}
          </span>
        )}
      </button>

      {isExpanded && (
        <div className="task-tool-widget-body border-t border-[var(--nim-border)] h-80 overflow-hidden">
          {loading && messages === null ? (
            <div className="task-tool-widget-loading p-2 text-[11px] text-[var(--nim-text-faint)]">
              Loading sub-agent transcript…
            </div>
          ) : messages && messages.length > 0 ? (
            <RichTranscriptView
              sessionId={`${sessionId}:${toolUseId}`}
              messages={messages}
              settings={TASK_TRANSCRIPT_SETTINGS}
              persistScrollState={false}
            />
          ) : (
            <div className="task-tool-widget-empty p-2 text-[11px] italic text-[var(--nim-text-faint)]">
              No activity yet from this sub-agent.
            </div>
          )}
        </div>
      )}
    </div>
  );
};

TaskToolWidget.displayName = 'TaskToolWidget';
