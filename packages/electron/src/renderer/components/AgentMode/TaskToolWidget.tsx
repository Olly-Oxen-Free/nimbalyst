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
import { useAtomValue, useSetAtom } from 'jotai';
import { RichTranscriptView } from '@nimbalyst/runtime/ui/AgentTranscript/components/RichTranscriptView';
import type { CustomToolWidgetProps } from '@nimbalyst/runtime/ui/AgentTranscript/components/CustomToolWidgets';
import type { TranscriptViewMessage } from '@nimbalyst/runtime/ai/server/types';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import {
  SubagentAuditLabel,
  SubagentStatusChip,
  type SubagentStatus,
} from '@nimbalyst/runtime/ui/AgentTranscript/components/SubagentCardPieces';
import {
  sessionTasksAtom,
  setTaskInlineExpandAtom,
  taskTranscriptSignalAtomFamily,
  taskTranscriptSignalKey,
  type TaskInfo,
} from '../../store/atoms/agentMode';

/** Maps SDK-native TaskInfo.status to the shared chip's plain status vocabulary. */
function mapTaskInfoStatus(status: TaskInfo['status']): SubagentStatus {
  switch (status) {
    case 'running': return 'running';
    case 'blocked': return 'blocked';
    case 'completed': return 'completed';
    case 'failed': return 'errored';
    case 'stopped': return 'stopped';
    default: return 'running';
  }
}

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

  // Lets the chip row's open-indicator dot reflect this widget's own expand
  // state. Cleared on unmount too, so a message scrolled out of a virtualized
  // list doesn't leave a stale dot lit.
  const setInlineExpand = useSetAtom(setTaskInlineExpandAtom);
  useEffect(() => {
    if (!toolUseId) return;
    setInlineExpand({ sessionId, toolUseId, expanded: isExpanded });
    return () => setInlineExpand({ sessionId, toolUseId, expanded: false });
  }, [setInlineExpand, sessionId, toolUseId, isExpanded]);

  // Live follow while expanded. The signal is keyed by taskId, which only the
  // session's task list maps back to this widget's toolUseId.
  const tasks = useAtomValue(sessionTasksAtom(sessionId));
  const matchedTask = useMemo(
    () => tasks.find(task => task.toolUseId === toolUseId),
    [tasks, toolUseId],
  );
  const taskId = matchedTask?.taskId ?? '';
  const chipStatus: SubagentStatus = useMemo(() => {
    if (matchedTask) return mapTaskInfoStatus(matchedTask.status);
    return tool?.result ? 'completed' : 'running';
  }, [matchedTask, tool?.result]);
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
        <MaterialSymbol
          icon={args?.run_in_background ? 'cloud_sync' : 'description'}
          size={16}
          className="task-tool-widget-icon w-4 h-4 text-[var(--nim-primary)] shrink-0"
        />
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
        <SubagentAuditLabel model={message.subagent?.model} reasoningEffort={message.subagent?.reasoningEffort} />
        <SubagentStatusChip status={chipStatus} />
        <MaterialSymbol
          icon={isExpanded ? 'expand_more' : 'chevron_right'}
          size={16}
          className="task-tool-widget-chevron w-3 h-3 text-[var(--nim-text-faint)]"
        />
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
              agentName={agentType ?? 'Sub-Agent'}
              agentModel={message.subagent?.model ?? undefined}
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
