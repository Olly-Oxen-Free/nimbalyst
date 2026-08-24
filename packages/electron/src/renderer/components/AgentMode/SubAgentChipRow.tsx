/**
 * SubAgentChipRow - horizontal strip of compact status chips rendered directly
 * above the chat message input, one chip per active Teammate / SDK-native Task
 * sub-agent in the session.
 *
 * This is the horizontal counterpart to `TeammatePanel`, which stays as-is: the
 * panel is a vertical, sidebar-anchored list, this row sits next to where the
 * architect is typing. Both read the same `sessionTeammatesAtom` /
 * `sessionTasksAtom` families, so chips appear and update as sub-agents spawn
 * and finish with no polling.
 *
 * Chip color/icon comes from the normalized `SubAgentStatus` mapping
 * (`store/atoms/subAgentStatus.ts`), never from the raw `TeammateInfo.status` /
 * `TaskInfo.status` strings.
 *
 * Display-only: chips carry an optional click callback so Teammate
 * click-to-thread and the Task status popover can be wired in without
 * restructuring, but nothing here implements either.
 *
 * Terminal states are not auto-dismissed on a timer. A `complete`/`error` chip
 * stays until the entry leaves session metadata, matching `TeammatePanel`.
 */

import React, { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { useAtomValue } from 'jotai';
import {
  useFloating,
  offset,
  flip,
  shift,
  FloatingPortal,
  useInteractions,
  useDismiss,
  useRole,
} from '@floating-ui/react';
import { sessionTeammatesAtom, sessionTasksAtom } from '../../store/atoms/agentMode';
import {
  mapTaskStatus,
  mapTeammateStatus,
  type SubAgentStatus,
} from '../../store/atoms/subAgentStatus';
import './SubAgentChipRow.css';

/**
 * One complete class set per normalized status - never concatenated fragments
 * (`docs/UI_PATTERNS.md`). Keyed by `SubAgentStatus`, so a sixth status value
 * fails to compile here instead of rendering an unstyled chip.
 */
const STATUS_CLASSES: Record<SubAgentStatus, string> = {
  working:
    'bg-[var(--nim-bg-tertiary)] border-solid border-[var(--nim-info)] text-[var(--nim-info)]',
  waiting:
    'bg-transparent border-dashed border-[var(--nim-text-faint)] text-[var(--nim-text-faint)]',
  blocked:
    'bg-[color-mix(in_srgb,var(--nim-error)_18%,transparent)] border-solid border-[var(--nim-warning)] text-[var(--nim-warning)] animate-[sub-agent-blocked-pulse_1.6s_ease-in-out_infinite]',
  complete:
    'bg-[color-mix(in_srgb,var(--nim-success)_16%,transparent)] border-solid border-[var(--nim-success)] text-[var(--nim-success)]',
  error:
    'bg-[color-mix(in_srgb,var(--nim-error)_16%,transparent)] border-solid border-[var(--nim-error)] text-[var(--nim-error)]',
};

/**
 * A distinct shape per status, not color alone - the chips have to stay
 * readable for color-blind users and in a screenshot. Shapes continue
 * `TeammatePanel`'s spinner/hollow-ring/filled-dot language.
 */
const STATUS_ICONS: Record<SubAgentStatus, React.ReactElement> = {
  working: (
    <svg viewBox="0 0 16 16" width="12" height="12" className="animate-spin" aria-hidden="true">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
      <path d="M8 2 A6 6 0 0 1 14 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  waiting: (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  ),
  blocked: (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path d="M8 2 L14.5 13.5 L1.5 13.5 Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <line x1="8" y1="6.4" x2="8" y2="9.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="11.6" r="0.9" fill="currentColor" />
    </svg>
  ),
  complete: (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path d="M3 8.5 L6.5 12 L13 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  error: (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <line x1="5.8" y1="5.8" x2="10.2" y2="10.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="10.2" y1="5.8" x2="5.8" y2="10.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
};

interface SubAgentChipProps {
  label: string;
  status: SubAgentStatus;
  kind: 'teammate' | 'task';
  /** Optional - a chip is inert (and not focusable) until a handler is given.
   *  Receives the triggering event so a caller can anchor a popover to
   *  `e.currentTarget` regardless of whether the click came from a pointer or
   *  a keyboard activation. */
  onClick?: (e: React.SyntheticEvent<HTMLDivElement>) => void;
}

const SubAgentChip: React.FC<SubAgentChipProps> = React.memo(({ label, status, kind, onClick }) => {
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (onClick && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onClick(e);
    }
  }, [onClick]);

  const interactive = onClick
    ? { role: 'button' as const, tabIndex: 0, onClick, onKeyDown: handleKeyDown }
    : { role: 'listitem' as const };

  return (
    <div
      {...interactive}
      className={`sub-agent-chip inline-flex items-center gap-[5px] h-[25px] shrink-0 px-2 rounded-[5px] border text-[11px] font-medium leading-none whitespace-nowrap ${STATUS_CLASSES[status]} ${onClick ? 'cursor-pointer' : ''}`}
      data-status={status}
      data-kind={kind}
      aria-label={`${label} — ${status}`}
      title={`${label} — ${status}`}
    >
      <span className="sub-agent-chip-icon inline-flex shrink-0 items-center justify-center w-3 h-3">
        {STATUS_ICONS[status]}
      </span>
      <span className="sub-agent-chip-label overflow-hidden text-ellipsis max-w-[140px]">
        {label}
      </span>
    </div>
  );
});

SubAgentChip.displayName = 'SubAgentChip';

const STATUS_LABELS: Record<SubAgentStatus, string> = {
  working: 'Working',
  waiting: 'Waiting',
  blocked: 'Blocked',
  complete: 'Complete',
  error: 'Error',
};

interface TaskStatusPopoverProps {
  label: string;
  status: SubAgentStatus;
  lastToolName: string | undefined;
  anchorEl: HTMLElement;
  onClose: () => void;
}

/**
 * Read-only status/tool-name popover for a Task sub-agent chip (R6). A
 * deliberate visibility ceiling, not a stepping stone toward a full thread
 * view — Task sub-agent turns stay hidden from the transcript by design
 * (`claudeCliSubAgentTracker.ts:20-22`). No buttons, no navigation.
 */
const TaskStatusPopover: React.FC<TaskStatusPopoverProps> = ({ label, status, lastToolName, anchorEl, onClose }) => {
  const { refs, floatingStyles, context } = useFloating({
    placement: 'top',
    open: true,
    onOpenChange: (open) => { if (!open) onClose(); },
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
  });

  useLayoutEffect(() => {
    refs.setPositionReference(anchorEl);
  }, [anchorEl, refs]);

  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'dialog' });
  const { getFloatingProps } = useInteractions([dismiss, role]);

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        style={floatingStyles}
        {...getFloatingProps()}
        className="sub-agent-task-status-popover flex flex-col gap-1 p-2.5 rounded-md border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] shadow-lg w-[200px] z-50 text-[11px]"
      >
        <div className="sub-agent-task-status-popover-title font-medium text-[var(--nim-text)] truncate">{label}</div>
        <div className="flex items-center justify-between text-[var(--nim-text-faint)]">
          <span>Status</span>
          <span className="text-[var(--nim-text)]">{STATUS_LABELS[status]}</span>
        </div>
        <div className="flex items-center justify-between text-[var(--nim-text-faint)]">
          <span>Active tool</span>
          <span className="text-[var(--nim-text)] truncate max-w-[110px]">{lastToolName ?? '—'}</span>
        </div>
      </div>
    </FloatingPortal>
  );
};

TaskStatusPopover.displayName = 'TaskStatusPopover';

interface SubAgentChipEntry {
  key: string;
  id: string;
  kind: 'teammate' | 'task';
  label: string;
  status: SubAgentStatus;
}

export interface SubAgentChipRowProps {
  /** Session whose teammates/tasks are shown. */
  sessionId: string;
  /** Opens the teammate's own thread, anchored to the clicked chip element. */
  onTeammateClick?: (agentId: string, anchorEl: HTMLElement) => void;
  /** Wired by a later task - opens the task's read-only status popover. */
  onTaskClick?: (taskId: string) => void;
}

/**
 * Renders one status chip per active teammate / Task sub-agent for a session,
 * or nothing at all when the session has none.
 */
export const SubAgentChipRow: React.FC<SubAgentChipRowProps> = React.memo(({
  sessionId,
  onTeammateClick,
  onTaskClick,
}) => {
  const allTeammates = useAtomValue(sessionTeammatesAtom(sessionId));
  const tasks = useAtomValue(sessionTasksAtom(sessionId));

  // Task-chip read-only status popover (R6). A separate, purely local flow
  // from the Teammate click-to-thread path below — does not touch it.
  const [openTaskPopover, setOpenTaskPopover] = useState<{ taskId: string; anchorEl: HTMLElement } | null>(null);
  const openTask = openTaskPopover ? tasks.find(t => t.taskId === openTaskPopover.taskId) ?? null : null;

  const entries = useMemo<SubAgentChipEntry[]>(() => [
    // Same filter as TeammatePanel: _background/_subagent entries are dead
    // legacy rows left over from before SDK-native sub-agents.
    ...allTeammates
      .filter(t => t.teamName !== '_background' && t.teamName !== '_subagent')
      .map((t): SubAgentChipEntry => ({
        key: `teammate:${t.agentId}`,
        id: t.agentId,
        kind: 'teammate',
        label: t.name,
        status: mapTeammateStatus(t.status),
      })),
    ...tasks.map((t): SubAgentChipEntry => ({
      key: `task:${t.taskId}`,
      id: t.taskId,
      kind: 'task',
      label: t.description,
      status: mapTaskStatus(t.status),
    })),
  ], [allTeammates, tasks]);

  const handleChipClick = useCallback((entry: SubAgentChipEntry, e: React.SyntheticEvent<HTMLDivElement>) => {
    if (entry.kind === 'teammate') {
      onTeammateClick?.(entry.id, e.currentTarget);
    } else {
      onTaskClick?.(entry.id);
      setOpenTaskPopover({ taskId: entry.id, anchorEl: e.currentTarget });
    }
  }, [onTeammateClick, onTaskClick]);

  if (entries.length === 0) {
    return null;
  }

  const hasClickHandler = Boolean(onTeammateClick || onTaskClick);

  return (
    // The root is the query container, the inner row responds to it; both
    // halves of that live in SubAgentChipRow.css (see the note there on why
    // this can't be Tailwind's `@container` utilities).
    <div className="sub-agent-chip-row px-3 py-1.5">
      <div
        className="sub-agent-chip-row-items flex items-center gap-1.5 flex-nowrap overflow-x-auto"
        role="list"
        aria-label="Sub-agent status"
      >
        {entries.map(entry => (
          <SubAgentChip
            key={entry.key}
            label={entry.label}
            status={entry.status}
            kind={entry.kind}
            onClick={hasClickHandler ? (e) => handleChipClick(entry, e) : undefined}
          />
        ))}
      </div>
      {openTask && openTaskPopover && (
        <TaskStatusPopover
          label={openTask.description}
          status={mapTaskStatus(openTask.status)}
          lastToolName={openTask.lastToolName}
          anchorEl={openTaskPopover.anchorEl}
          onClose={() => setOpenTaskPopover(null)}
        />
      )}
    </div>
  );
});

SubAgentChipRow.displayName = 'SubAgentChipRow';
