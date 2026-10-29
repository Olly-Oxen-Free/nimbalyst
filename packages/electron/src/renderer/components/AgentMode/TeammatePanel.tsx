/**
 * TeammatePanel - Collapsible panel showing teammates and SDK-native spawned tasks.
 *
 * Two sections:
 * - "Teammates" for real team members (from currentTeammates metadata)
 * - "Agents & commands" for SDK-native tasks (from currentTasks metadata, driven by
 *   task_started/task_progress/task_notification events). The list is not an agent
 *   registry: a plain Bash call arrives as local_bash, and foreground work is in
 *   there too -- so each row names its own kind.
 *
 * Each section is independently collapsible. Sections only render when they have entries.
 * Collapse state is persisted at the project level.
 *
 * Clicking a teammate item scrolls the transcript to its spawn point via scrollToTeammateAtom
 * and toggles that teammate's tile via toggleTeammateTileAtom.
 * Clicking a sub-agent item toggles that task's transcript tile beside the main thread.
 */

import React, { useCallback, useMemo, useState, useEffect } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import type { TeammateEndReason } from '@nimbalyst/runtime/ai/server/providers/TeammateManager';
import {
  teammatePanelCollapsedAtom, toggleTeammatePanelCollapsedAtom,
  agentPanelCollapsedAtom, toggleAgentPanelCollapsedAtom,
  sessionTeammatesAtom, scrollToTeammateAtom, toggleTeammateTileAtom,
  sessionTasksAtom, type TaskInfo, toggleTaskTileAtom,
} from '../../store/atoms/agentMode';
import { mapTaskStatus } from '../../store/atoms/subAgentStatus';
import { TaskThreadPopover } from './TaskThreadPopover';
import { taskKindLabel, taskOutcomeLabel } from './taskPresentation';

export interface TeammateInfo {
  name: string;
  agentId: string;
  teamName: string;
  agentType: string;
  // 'blocked' = this teammate is parked on a permission prompt for one of its
  // own tool calls. Kept distinct from 'running' so the UI can show which
  // teammate is actually waiting on the user.
  status: 'running' | 'blocked' | 'completed' | 'errored' | 'idle';
  model?: string;
  startedAt?: number;
  lastActiveAt?: number;
  toolCallCount?: number;
  // The teammate's own SDK session id, not the lead's. Absent until the
  // teammate's first chunk lands, and on teammates recorded before it was
  // persisted at all.
  sessionId?: string;
  // Why this teammate went terminal, and when. Only present on
  // 'completed'/'errored' rows written after the fields existed; a missing
  // endReason means 'finished'. Written by TeammateManager.emitTeammateUpdate
  // and read here to decide whether an ended teammate can be revived.
  endReason?: TeammateEndReason;
  endedAt?: number;
}

interface TeammatePanelProps {
  /** The session ID to get teammates from */
  sessionId: string;
}

export const TeammatePanel: React.FC<TeammatePanelProps> = React.memo(({
  sessionId,
}) => {
  const isTeammatesCollapsed = useAtomValue(teammatePanelCollapsedAtom);
  const toggleTeammatesCollapsed = useSetAtom(toggleTeammatePanelCollapsedAtom);
  const isTasksCollapsed = useAtomValue(agentPanelCollapsedAtom);
  const toggleTasksCollapsed = useSetAtom(toggleAgentPanelCollapsedAtom);
  const allEntries = useAtomValue(sessionTeammatesAtom(sessionId));
  const tasks = useAtomValue(sessionTasksAtom(sessionId));
  const setScrollTarget = useSetAtom(scrollToTeammateAtom);
  const toggleTeammateTile = useSetAtom(toggleTeammateTileAtom);

  const handleToggleTeammates = useCallback(() => {
    toggleTeammatesCollapsed();
  }, [toggleTeammatesCollapsed]);

  const handleToggleTasks = useCallback(() => {
    toggleTasksCollapsed();
  }, [toggleTasksCollapsed]);

  const handleTeammateClick = useCallback((agentId: string) => {
    setScrollTarget({ sessionId, agentId });
    toggleTeammateTile({ sessionId, agentId });
  }, [sessionId, setScrollTarget, toggleTeammateTile]);

  // Filter out _background/_subagent entries from teammates -- those are dead
  // after switching to SDK-native sub-agents. Only real team members remain.
  // Ended rows sink below the live ones and sort most-recently-ended first, so
  // the teammate an architect just stopped (and is most likely to revive) sits
  // at the top of the dead pile. Live rows keep their spawn order. A row with
  // no endedAt sorts oldest -- it predates the field, so it is not recent.
  const teammates = useMemo(() => {
    const visible = allEntries.filter(e => e.teamName !== '_background' && e.teamName !== '_subagent');
    const isEnded = (e: TeammateInfo) => e.status === 'completed' || e.status === 'errored';
    const live = visible.filter(e => !isEnded(e));
    const ended = visible
      .filter(isEnded)
      .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
    return ended.length === 0 ? live : [...live, ...ended];
  }, [allEntries]);

  if (teammates.length === 0 && tasks.length === 0) {
    return null;
  }

  return (
    <div className="teammate-panel border-t border-[var(--nim-border)] bg-[var(--nim-bg-secondary)]">
      {teammates.length > 0 && (
        <TeammateSection
          entries={teammates}
          isCollapsed={isTeammatesCollapsed}
          onToggle={handleToggleTeammates}
          onTeammateClick={handleTeammateClick}
        />
      )}
      {tasks.length > 0 && (
        <TaskSection
          tasks={tasks}
          sessionId={sessionId}
          isCollapsed={isTasksCollapsed}
          onToggle={handleToggleTasks}
          className={teammates.length > 0 ? 'border-t border-[var(--nim-border)]' : undefined}
        />
      )}
    </div>
  );
});

TeammatePanel.displayName = 'TeammatePanel';

// ─── Teammate Section (real team members) ─────────────────────────────────

interface TeammateSectionProps {
  entries: TeammateInfo[];
  isCollapsed: boolean;
  onToggle: () => void;
  onTeammateClick: (agentId: string) => void;
}

const TeammateSection: React.FC<TeammateSectionProps> = React.memo(({
  entries,
  isCollapsed,
  onToggle,
  onTeammateClick,
}) => {
  const runningCount = entries.filter(t => t.status === 'running' || t.status === 'idle').length;

  return (
    <div>
      <button
        className="w-full flex items-center gap-2 px-3 py-2 bg-transparent border-none cursor-pointer text-left hover:bg-[var(--nim-bg-hover)]"
        onClick={onToggle}
      >
        <MaterialSymbol
          icon={isCollapsed ? 'chevron_right' : 'expand_more'}
          size={16}
          className="text-[var(--nim-text-muted)] shrink-0"
        />
        <MaterialSymbol icon="group" size={16} className="text-[var(--nim-text-muted)] shrink-0" />
        <span className="text-xs font-medium text-[var(--nim-text)]">Teammates</span>
        <span className="ml-auto text-[11px] text-[var(--nim-text-muted)] font-mono">
          {runningCount}/{entries.length}
        </span>
      </button>

      {!isCollapsed && (
        <div className="px-3 pb-2 max-h-[200px] overflow-y-auto">
          <div className="flex flex-col gap-1">
            {entries.map((entry) => (
              <TeammateItem key={entry.agentId} teammate={entry} onClick={onTeammateClick} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

TeammateSection.displayName = 'TeammateSection';

// ─── Task Section (SDK-native background tasks) ───────────────────────────

interface TaskSectionProps {
  tasks: TaskInfo[];
  sessionId: string;
  isCollapsed: boolean;
  onToggle: () => void;
  className?: string;
}

const TaskSection: React.FC<TaskSectionProps> = React.memo(({
  tasks,
  sessionId,
  isCollapsed,
  onToggle,
  className,
}) => {
  const runningCount = tasks.filter(t => t.status === 'running').length;

  return (
    <div className={className}>
      <button
        className="w-full flex items-center gap-2 px-3 py-2 bg-transparent border-none cursor-pointer text-left hover:bg-[var(--nim-bg-hover)]"
        onClick={onToggle}
      >
        <MaterialSymbol
          icon={isCollapsed ? 'chevron_right' : 'expand_more'}
          size={16}
          className="text-[var(--nim-text-muted)] shrink-0"
        />
        <MaterialSymbol icon="swap_horiz" size={16} className="text-[var(--nim-text-muted)] shrink-0" />
        <span className="text-xs font-medium text-[var(--nim-text)]">Agents &amp; commands</span>
        <span className="ml-auto text-[11px] text-[var(--nim-text-muted)] font-mono">
          {runningCount}/{tasks.length}
        </span>
      </button>

      {!isCollapsed && (
        <div className="px-3 pb-2 max-h-[200px] overflow-y-auto">
          <div className="flex flex-col gap-1">
            {tasks.map((task) => (
              <TaskItem key={task.taskId} task={task} sessionId={sessionId} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

TaskSection.displayName = 'TaskSection';

// ─── Elapsed time formatting ──────────────────────────────────────────────

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function formatAgo(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

// ─── Live clock hook ──────────────────────────────────────────────────────

/** Ticks every second so relative times stay fresh. Returns current epoch ms. */
function useNow(enabled: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [enabled]);
  return now;
}

// ─── TaskItem ─────────────────────────────────────────────────────────────

interface TaskItemProps {
  task: TaskInfo;
  sessionId: string;
}

const TaskItem: React.FC<TaskItemProps> = React.memo(({ task, sessionId }) => {
  // Click-to-tile (R7). Reads the write-only atom directly rather than threading
  // a callback through TaskSection/TeammatePanel, which take only a sessionId.
  const toggleTaskTile = useSetAtom(toggleTaskTileAtom);
  const handleClick = useCallback(() => {
    toggleTaskTile({ sessionId, taskId: task.taskId });
  }, [toggleTaskTile, sessionId, task.taskId]);

  const isRunning = task.status === 'running';
  const now = useNow(isRunning);
  const isDone = task.status === 'completed' || task.status === 'failed' || task.status === 'stopped';

  // Build stats line. The kind rides in front rather than on a line of its own:
  // the section scrolls at 200px, and a third line per row costs a visible entry.
  const stats: string[] = [taskKindLabel(task.taskType)];
  if (task.durationMs > 0) {
    stats.push(formatElapsed(task.durationMs));
  } else if (isRunning && task.startedAt) {
    stats.push(formatElapsed(now - task.startedAt));
  }
  if (task.toolCount > 0) {
    stats.push(`${task.toolCount} tool${task.toolCount !== 1 ? 's' : ''}`);
  }
  if (task.lastToolName && isRunning) {
    stats.push(task.lastToolName);
  }
  // "ran and exited non-zero" vs "did not finish on its own" -- the icons alone
  // leave the two indistinguishable.
  const outcome = taskOutcomeLabel(task.status);
  if (outcome) {
    stats.push(outcome);
  }

  return (
    <TaskThreadPopover
      sessionId={sessionId}
      taskId={task.taskId}
      label={task.description}
      status={mapTaskStatus(task.status)}
      lastToolName={task.lastToolName}
    >
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
      className={`task-item flex items-start gap-2 py-1 px-1 rounded text-xs cursor-pointer ${
        isRunning ? 'bg-[var(--nim-bg-hover)]' : ''
      } ${isDone ? 'opacity-60' : ''}`}
      data-status={task.status}
    >
      <div className="shrink-0 w-4 h-4 flex items-center justify-center mt-0.5">
        {isRunning && (
          <span className="inline-block w-3 h-3 border-2 border-[var(--nim-bg-tertiary)] border-t-[var(--nim-primary)] rounded-full animate-spin" />
        )}
        {task.status === 'completed' && (
          <span className="text-[#4ade80] text-[10px]">&#x25CF;</span>
        )}
        {task.status === 'failed' && (
          <span className="text-[var(--nim-error)] text-[10px]">&#x25CF;</span>
        )}
        {task.status === 'stopped' && (
          <MaterialSymbol icon="stop_circle" size={12} className="text-[var(--nim-text-muted)]" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className={`leading-[1.4] break-words ${
          isDone ? 'text-[var(--nim-text-muted)]' : 'text-[var(--nim-text)]'
        }`}>
          {task.description}
        </div>
        {stats.length > 0 && (
          <div className="text-[10px] text-[var(--nim-text-faint)] truncate font-mono">
            {stats.join(' \u00B7 ')}
          </div>
        )}
      </div>
    </div>
    </TaskThreadPopover>
  );
});

TaskItem.displayName = 'TaskItem';

// ─── TeammateItem ─────────────────────────────────────────────────────────

interface TeammateItemProps {
  teammate: TeammateInfo;
  onClick: (agentId: string) => void;
}

const TeammateItem: React.FC<TeammateItemProps> = React.memo(({ teammate, onClick }) => {
  const isActive = teammate.status === 'running' || teammate.status === 'idle';
  const now = useNow(isActive);

  const handleClick = useCallback(() => {
    onClick(teammate.agentId);
  }, [onClick, teammate.agentId]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick(teammate.agentId);
    }
  }, [onClick, teammate.agentId]);

  // Build stats line
  const stats: string[] = [];
  if (teammate.startedAt) {
    stats.push(formatElapsed(now - teammate.startedAt));
  }
  // Only show "last active" when idle - when running, elapsed time is sufficient
  if (teammate.status === 'idle' && teammate.lastActiveAt) {
    stats.push(formatAgo(now - teammate.lastActiveAt));
  }
  if (typeof teammate.toolCallCount === 'number' && teammate.toolCallCount > 0) {
    stats.push(`${teammate.toolCallCount} tool${teammate.toolCallCount !== 1 ? 's' : ''}`);
  }

  return (
    <div
      className={`teammate-item flex items-start gap-2 py-1 px-1 rounded text-xs cursor-pointer hover:bg-[var(--nim-bg-hover)] ${
        teammate.status === 'running' ? 'bg-[var(--nim-bg-hover)]' : ''
      } ${teammate.status === 'completed' || teammate.status === 'errored' ? 'opacity-60' : ''}`}
      data-status={teammate.status}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
    >
      <div className="teammate-item-icon shrink-0 w-4 h-4 flex items-center justify-center mt-0.5">
        {teammate.status === 'running' && (
          <span className="inline-block w-3 h-3 border-2 border-[var(--nim-bg-tertiary)] border-t-[var(--nim-primary)] rounded-full animate-spin" />
        )}
        {teammate.status === 'idle' && (
          <span className="text-[var(--nim-primary)] text-[10px]">&#x25CB;</span>
        )}
        {teammate.status === 'completed' && (
          <span className="text-[var(--nim-success)] text-[10px]">&#x25CF;</span>
        )}
        {teammate.status === 'errored' && (
          <span className="text-[var(--nim-error)] text-[10px]">&#x25CF;</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className={`teammate-item-name leading-[1.4] break-words ${
          teammate.status === 'completed'
            ? 'line-through text-[var(--nim-text-muted)]'
            : 'text-[var(--nim-text)]'
        }`}>
          {teammate.name}
        </div>
        <div className="text-[10px] text-[var(--nim-text-faint)] truncate">
          {teammate.agentType}{teammate.model ? ` · ${teammate.model}` : ''}{teammate.status === 'idle' ? ' (idle)' : ''}
        </div>
        {stats.length > 0 && (
          <div className="text-[10px] text-[var(--nim-text-faint)] truncate font-mono">
            {stats.join(' \u00B7 ')}
          </div>
        )}
      </div>
    </div>
  );
});

TeammateItem.displayName = 'TeammateItem';
