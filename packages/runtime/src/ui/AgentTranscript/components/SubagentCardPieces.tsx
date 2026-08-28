/**
 * Shared sub-agent card pieces used by BOTH the generic spawn card
 * (RichTranscriptView's renderToolCard) and TaskToolWidget's header, so the
 * two card kinds read as one family (PRD 007 D2).
 */

import React from 'react';
import { MaterialSymbol } from '../../icons/MaterialSymbol';

/** Plain status a caller derives on its own (teammate lookup, TaskInfo.status
 *  mapping, etc.) and hands to SubagentStatusChip — this component holds no
 *  derivation logic of its own. */
export type SubagentStatus = 'running' | 'blocked' | 'idle' | 'completed' | 'errored' | 'stopped';

/** Formats provider-supplied sub-agent execution metadata without normalizing it. */
export function formatSubagentAuditLabel(
  model: string | null | undefined,
  reasoningEffort: string | null | undefined,
): string | null {
  const parts: string[] = [];
  if (model) parts.push(`Model: ${model}`);
  if (reasoningEffort) parts.push(`Reasoning effort: ${reasoningEffort}`);
  return parts.length > 0 ? parts.join('; ') : null;
}

export interface SubagentStatusChipProps {
  status: SubagentStatus;
}

/**
 * Running/idle/completed/errored spinner-or-icon + text vocabulary, lifted
 * verbatim from RichTranscriptView's renderToolCard (formerly inlined
 * per-status JSX). 'blocked' and 'stopped' have no source JSX to lift (the
 * inline block only ever rendered four states) — 'blocked' mirrors
 * SubAgentChipRow's blocked/warning color token
 * (packages/electron/src/renderer/components/AgentMode/SubAgentChipRow.tsx
 * STATUS_CLASSES.blocked), and 'stopped' reuses completed's icon+text shape
 * in a muted, inactive treatment instead of the success color.
 */
export const SubagentStatusChip: React.FC<SubagentStatusChipProps> = ({ status }) => {
  switch (status) {
    case 'running':
      return (
        <span className="subagent-status-chip flex items-center gap-1 shrink-0">
          <span className="inline-block w-3 h-3 border-2 border-[var(--nim-bg-tertiary)] border-t-[var(--nim-primary)] rounded-full animate-spin" />
          <span className="text-[11px] text-[var(--nim-text-muted)]">Running</span>
        </span>
      );
    case 'idle':
      return (
        <span className="subagent-status-chip flex items-center gap-1 shrink-0">
          <span className="text-[var(--nim-primary)] text-[10px]">&#9675;</span>
          <span className="text-[11px] text-[var(--nim-text-muted)]">Idle</span>
        </span>
      );
    case 'completed':
      return (
        <span className="subagent-status-chip flex items-center gap-1 shrink-0">
          <MaterialSymbol icon="check_circle" size={14} className="text-[var(--nim-success)]" />
          <span className="text-[11px] text-[var(--nim-text-muted)]">Done</span>
        </span>
      );
    case 'errored':
      return (
        <span className="subagent-status-chip flex items-center gap-1 shrink-0">
          <MaterialSymbol icon="cancel" size={14} className="text-[var(--nim-error)]" />
          <span className="text-[11px] text-[var(--nim-text-muted)]">Errored</span>
        </span>
      );
    case 'blocked':
      return (
        <span className="subagent-status-chip flex items-center gap-1 shrink-0">
          <MaterialSymbol icon="warning" size={14} className="text-[var(--nim-warning)]" />
          <span className="text-[11px] text-[var(--nim-warning)]">Blocked</span>
        </span>
      );
    case 'stopped':
      return (
        <span className="subagent-status-chip flex items-center gap-1 shrink-0">
          <MaterialSymbol icon="stop_circle" size={14} className="text-[var(--nim-text-faint)]" />
          <span className="text-[11px] text-[var(--nim-text-muted)]">Stopped</span>
        </span>
      );
    default:
      return null;
  }
};

SubagentStatusChip.displayName = 'SubagentStatusChip';

export interface SubagentAuditLabelProps {
  model: string | null | undefined;
  reasoningEffort: string | null | undefined;
}

/** Model/effort truncated label, lifted from renderToolCard's inline audit
 *  span. Renders nothing when neither model nor reasoningEffort is present. */
export const SubagentAuditLabel: React.FC<SubagentAuditLabelProps> = ({ model, reasoningEffort }) => {
  const label = formatSubagentAuditLabel(model, reasoningEffort);
  if (!label) return null;
  return (
    <span
      className="rich-transcript-subagent-audit min-w-0 max-w-40 truncate text-[11px] text-[var(--nim-text-muted)]"
      aria-label={label}
      title={label}
    >
      {model}{model && reasoningEffort ? ' · ' : ''}{reasoningEffort}
    </span>
  );
};

SubagentAuditLabel.displayName = 'SubagentAuditLabel';
