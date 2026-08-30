/**
 * TeammateTile - one teammate's transcript, as shown inside a `TiledRegion`
 * pane alongside `TaskTile`. Clicking a teammate chip (inline row) or a
 * Teammates sidebar row opens that teammate's tile in
 * `openTeammateTilesAtomFamily`.
 *
 * Sibling of `TaskTile`, not a shared component with it: a teammate tile is
 * interactive (compose input, stop control) where a Task tile is read-only, so
 * the two kinds don't share tile-body logic, matching how
 * `TeammateThreadPopover`/`TaskThreadPopover` are also two independent
 * implementations rather than one kind-branching component.
 *
 * The tile fills whatever pane the region gives it, and the pane's
 * `TileHeaderBar` owns the close control, so the tile has none of its own. A
 * tile never auto-closes.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { RichTranscriptView } from '@nimbalyst/runtime/ui/AgentTranscript/components/RichTranscriptView';
import type { TranscriptViewMessage } from '@nimbalyst/runtime/ai/server/types';
import {
  sessionTeammatesAtom,
  teammateTranscriptSignalAtomFamily,
  teammateTranscriptSignalKey,
} from '../../store/atoms/agentMode';
import { sessionListWorkspaceAtom } from '../../store/atoms/sessions';
import { mapTeammateStatus } from '../../store/atoms/subAgentStatus';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { ConfirmDialog } from '../ConfirmDialog/ConfirmDialog';
import type { TeammateInfo } from './TeammatePanel';

/** Matches the hover popover's knobs - a teammate's reasoning is most of what
 *  the architect opens this to read. */
const TILE_TRANSCRIPT_SETTINGS = {
  showToolCalls: true,
  compactMode: true,
  collapseTools: true,
  showThinking: true,
  showSessionInit: false,
};

const STATUS_LABELS: Record<ReturnType<typeof mapTeammateStatus>, string> = {
  working: 'Working',
  waiting: 'Waiting',
  blocked: 'Blocked',
  complete: 'Complete',
  error: 'Error',
};

/**
 * Mirror of `TeammateManager.REVIVAL_ELIGIBILITY_WINDOW_MS` (24h), which is
 * private to the manager. The backend stays the authority on revival; this
 * copy only keeps the UI from offering a box the send would refuse.
 */
const REVIVAL_ELIGIBILITY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Which compose affordance an ended teammate gets. Deliberately duplicated in
 * `TeammateThreadPopover` rather than shared -- the two compose surfaces are
 * independent implementations; keep them changed in lockstep.
 *
 * Matches `TeammateManager.isRevivalEligible`, including its two judgment
 * calls: a row with no `endedAt` is not subject to the cutoff, and an unknown
 * `endReason` falls through to eligible.
 */
function teammateComposeMode(
  teammate: TeammateInfo | undefined,
  reviveConfirmed: boolean,
): 'compose' | 'revive' | 'inactive' {
  if (!teammate) return 'inactive';
  if (teammate.status !== 'completed' && teammate.status !== 'errored') return 'compose';
  if (!teammate.sessionId) return 'inactive';
  if (teammate.endedAt !== undefined
    && Date.now() - teammate.endedAt > REVIVAL_ELIGIBILITY_WINDOW_MS) return 'inactive';
  if (teammate.endReason !== 'user-shutdown') return 'compose';
  return reviveConfirmed ? 'compose' : 'revive';
}

export interface TeammateTileProps {
  sessionId: string;
  agentId: string;
}

export const TeammateTile: React.FC<TeammateTileProps> = ({ sessionId, agentId }) => {
  const workspacePath = useAtomValue(sessionListWorkspaceAtom);
  const teammates = useAtomValue(sessionTeammatesAtom(sessionId));
  const teammate = useMemo(
    () => teammates.find(t => t.agentId === agentId),
    [teammates, agentId],
  );
  const teammateName = teammate?.name ?? agentId;

  const [messages, setMessages] = useState<TranscriptViewMessage[] | null>(null);
  const [loading, setLoading] = useState(true);
  const fetchGenerationRef = useRef(0);

  const fetchTranscript = useCallback(async () => {
    if (!workspacePath) return;
    const generation = ++fetchGenerationRef.current;
    try {
      const next = await window.electronAPI.aiGetTeammateTranscript(sessionId, agentId, workspacePath);
      if (generation !== fetchGenerationRef.current) return;
      setMessages(next);
    } catch {
      if (generation !== fetchGenerationRef.current) return;
      setMessages(previous => previous ?? []);
    }
    setLoading(false);
  }, [sessionId, agentId, workspacePath]);

  useEffect(() => {
    void fetchTranscript();
    return () => {
      fetchGenerationRef.current += 1;
    };
  }, [fetchTranscript]);

  // Live follow: teammate chunks never reach ai_transcript_events, so the
  // refetch trigger is the per-teammate signal, debounced like the popover's.
  const transcriptSignal = useAtomValue(
    teammateTranscriptSignalAtomFamily(teammateTranscriptSignalKey(sessionId, agentId)),
  );
  const initialSignalRef = useRef(transcriptSignal);
  useEffect(() => {
    if (transcriptSignal === initialSignalRef.current) return;
    const debounceTimer = window.setTimeout(() => {
      void fetchTranscript();
    }, 1_500);
    return () => window.clearTimeout(debounceTimer);
  }, [fetchTranscript, transcriptSignal]);

  const [stopping, setStopping] = useState(false);
  const canStop = teammate?.status === 'running' || teammate?.status === 'blocked';

  // A completed/errored teammate's SDK session is still resumable if it has a
  // sessionId and an eligible endReason -- only a user-shutdown row needs an
  // explicit Revive confirm before compose opens (PRD 008
  // agent-revival-persistence). The backend gate
  // (TeammateManager.isRevivalEligible) remains the authority; this mirrors it
  // so the UI never offers a compose box the send will refuse.
  const [reviveConfirmed, setReviveConfirmed] = useState(false);
  const composeMode = useMemo(
    () => teammateComposeMode(teammate, reviveConfirmed),
    [teammate, reviveConfirmed],
  );

  const handleStop = useCallback(async () => {
    if (stopping || !workspacePath) return;
    setStopping(true);
    try {
      await window.electronAPI.aiStopTeammate(sessionId, agentId, workspacePath);
    } finally {
      setStopping(false);
    }
  }, [sessionId, agentId, workspacePath, stopping]);

  const [message, setMessage] = useState('');
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const confirmDialog = useConfirmDialog();

  const handleSend = useCallback(async () => {
    const content = message.trim();
    if (!content || sendState === 'sending') return;
    setSendState('sending');
    try {
      const result = await window.electronAPI.aiSendMessageToTeammate(
        sessionId,
        agentId,
        content,
        // Only ever true for a row the user confirmed reviving; the backend
        // refuses a user-shutdown revival without it.
        reviveConfirmed || undefined,
      );
      if (result.success) {
        setSendState('sent');
        setMessage('');
      } else {
        setSendState('failed');
      }
    } catch {
      setSendState('failed');
    }
  }, [message, sendState, sessionId, agentId, reviveConfirmed]);

  const handleRevive = useCallback(async () => {
    const confirmed = await confirmDialog.confirm({
      title: `Revive ${teammateName}?`,
      message: 'You shut this teammate down. Reviving resumes its session and lets it start working again.',
      confirmLabel: 'Revive',
      cancelLabel: 'Cancel',
    });
    if (confirmed) setReviveConfirmed(true);
  }, [confirmDialog, teammateName]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }, [handleSend]);

  const status = teammate ? mapTeammateStatus(teammate.status) : 'complete';
  // Never the lead's id, and never the hover popover's key: RichTranscriptView
  // caches virtual-list state per sessionId.
  const transcriptKey = teammate?.sessionId
    ? `${teammate.sessionId}:tile`
    : `${sessionId}:${agentId}:tile`;

  return (
    <div
      className="teammate-tile flex flex-col h-full w-full min-h-0 rounded-md border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] overflow-hidden"
      data-agent-id={agentId}
      data-status={status}
    >
      <div className="teammate-tile-header flex items-start gap-2 px-2 py-1.5 border-b border-[var(--nim-border)]">
        <div className="min-w-0 flex-1">
          <div className="teammate-tile-title text-[12px] font-medium text-[var(--nim-text)] truncate">
            {teammateName}
          </div>
          <div className="teammate-tile-status flex flex-wrap gap-x-2 text-[10px] text-[var(--nim-text-faint)]">
            <span>{STATUS_LABELS[status]}</span>
            {teammate?.model && <span>{teammate.model}</span>}
            {teammate?.toolCallCount !== undefined && <span>{teammate.toolCallCount} tool calls</span>}
          </div>
        </div>
        {canStop && (
          <button
            type="button"
            className="teammate-tile-stop shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-[var(--nim-border)] text-[var(--nim-text)] disabled:opacity-50"
            onClick={handleStop}
            disabled={stopping}
          >
            {stopping ? 'Stopping…' : 'Stop'}
          </button>
        )}
      </div>
      <div className="teammate-tile-body flex-1 min-h-0 overflow-hidden">
        {loading ? (
          <div className="teammate-tile-loading flex h-full items-center justify-center text-[11px] text-[var(--nim-text-faint)]">
            Loading thread&#8230;
          </div>
        ) : !messages || messages.length === 0 ? (
          <div className="teammate-tile-empty flex h-full items-center justify-center text-[11px] italic text-[var(--nim-text-faint)]">
            No activity yet from this teammate.
          </div>
        ) : (
          <RichTranscriptView
            sessionId={transcriptKey}
            messages={messages}
            settings={TILE_TRANSCRIPT_SETTINGS}
            persistScrollState={false}
            agentName={teammateName}
            agentModel={teammate?.model}
          />
        )}
      </div>
      {composeMode === 'inactive' ? (
        <div className="teammate-tile-inactive px-2 py-1.5 border-t border-[var(--nim-border)] text-[10px] text-[var(--nim-text-faint)]">
          This teammate is no longer active — messages can&apos;t be delivered.
        </div>
      ) : composeMode === 'revive' ? (
        <div className="teammate-tile-revive-confirm flex items-center justify-between gap-2 px-2 py-1.5 border-t border-[var(--nim-border)]">
          <span className="text-[10px] text-[var(--nim-text-faint)] select-text">
            You shut this teammate down.
          </span>
          <button
            type="button"
            className="teammate-tile-revive shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-[var(--nim-border)] text-[var(--nim-text)]"
            onClick={handleRevive}
          >
            Revive
          </button>
        </div>
      ) : (
        <div className="teammate-tile-compose flex flex-col gap-1 px-2 py-1.5 border-t border-[var(--nim-border)]">
          <textarea
            className="teammate-tile-input text-[11px] p-1 rounded border border-[var(--nim-border)] bg-[var(--nim-bg)] text-[var(--nim-text)] resize-none focus:outline-none focus:border-[var(--nim-primary)]"
            rows={2}
            value={message}
            placeholder={`Message ${teammateName}…`}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={sendState === 'sending'}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="teammate-tile-send-status text-[10px] text-[var(--nim-text-faint)]">
              {sendState === 'sent' && 'Sent'}
              {sendState === 'failed' && 'Failed — try again'}
            </span>
            <button
              type="button"
              className="teammate-tile-send text-[10px] px-1.5 py-0.5 rounded bg-[var(--nim-primary)] text-white disabled:opacity-50"
              onClick={handleSend}
              disabled={!message.trim() || sendState === 'sending'}
            >
              {sendState === 'sending' ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      )}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.options.title}
        message={confirmDialog.options.message}
        confirmLabel={confirmDialog.options.confirmLabel}
        cancelLabel={confirmDialog.options.cancelLabel}
        destructive={confirmDialog.options.destructive}
        onConfirm={confirmDialog.handleConfirm}
        onCancel={confirmDialog.handleCancel}
      />
    </div>
  );
};

TeammateTile.displayName = 'TeammateTile';
