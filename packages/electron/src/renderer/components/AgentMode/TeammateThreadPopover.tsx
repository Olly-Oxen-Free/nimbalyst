/**
 * TeammateThreadPopover - opens when a Teammate chip in `SubAgentChipRow` is
 * clicked. Shows that teammate's own thread (projected out of the lead
 * session's raw log by `ai:getTeammateTranscript`) and lets the architect
 * message it directly, without navigating away from the current transcript.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { RichTranscriptView } from '@nimbalyst/runtime/ui/AgentTranscript/components/RichTranscriptView';
import type { TranscriptViewMessage } from '@nimbalyst/runtime/ai/server/types';
import { useFloatingMenu, FloatingPortal } from '../../hooks/useFloatingMenu';
import {
  sessionTeammatesAtom,
  teammateTranscriptSignalAtomFamily,
  teammateTranscriptSignalKey,
} from '../../store/atoms/agentMode';
import { mapTeammateStatus } from '../../store/atoms/subAgentStatus';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { ConfirmDialog } from '../ConfirmDialog/ConfirmDialog';
import type { TeammateInfo } from './TeammatePanel';

/** Same knobs as the session transcript peek, except thinking stays visible:
 *  a teammate's reasoning is most of what the architect opens this to read. */
const TEAMMATE_TRANSCRIPT_SETTINGS = {
  showToolCalls: true,
  compactMode: true,
  collapseTools: true,
  showThinking: true,
  showSessionInit: false,
};

/**
 * Mirror of `TeammateManager.REVIVAL_ELIGIBILITY_WINDOW_MS` (24h), which is
 * private to the manager. The backend stays the authority on revival; this
 * copy only keeps the UI from offering a box the send would refuse.
 */
const REVIVAL_ELIGIBILITY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Which compose affordance an ended teammate gets. Deliberately duplicated in
 * `TeammateTileRail` rather than shared -- the two compose surfaces are
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

const STATUS_LABELS: Record<ReturnType<typeof mapTeammateStatus>, string> = {
  working: 'Working',
  waiting: 'Waiting',
  blocked: 'Blocked',
  complete: 'Complete',
  error: 'Error',
};

export interface TeammateThreadPopoverProps {
  /** The LEAD session id - a teammate's chunks live in the lead's raw log. */
  sessionId: string;
  agentId: string;
  teammateName: string;
  workspacePath: string;
  anchorEl: HTMLElement;
  onClose: () => void;
}

export const TeammateThreadPopover: React.FC<TeammateThreadPopoverProps> = ({
  sessionId,
  agentId,
  teammateName,
  workspacePath,
  anchorEl,
  onClose,
}) => {
  const menu = useFloatingMenu({
    placement: 'top-start',
    reference: anchorEl,
    open: true,
    onOpenChange: (open) => {
      if (!open) onClose();
    },
  });

  const teammates = useAtomValue(sessionTeammatesAtom(sessionId));
  const teammate = useMemo(
    () => teammates.find(t => t.agentId === agentId),
    [teammates, agentId],
  );
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

  const [messages, setMessages] = useState<TranscriptViewMessage[] | null>(null);
  const [loading, setLoading] = useState(true);
  const fetchGenerationRef = useRef(0);

  const fetchTranscript = useCallback(async () => {
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
  // refetch trigger is the per-teammate signal, debounced like the peek's.
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

  const handleStop = useCallback(async () => {
    if (stopping) return;
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
      title: `Revive ${teammate?.name ?? teammateName}?`,
      message: 'You shut this teammate down. Reviving resumes its session and lets it start working again.',
      confirmLabel: 'Revive',
      cancelLabel: 'Cancel',
    });
    if (confirmed) setReviveConfirmed(true);
  }, [confirmDialog, teammate?.name, teammateName]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }, [handleSend]);

  // Never the lead's id: RichTranscriptView caches virtual-list state per
  // sessionId, and reusing the lead's would clobber the main transcript's.
  const transcriptKey = teammate?.sessionId ?? `${sessionId}:${agentId}`;

  return (
    <FloatingPortal>
      <div
        ref={menu.refs.setFloating}
        style={{
          ...menu.floatingStyles,
          width: 'min(600px, calc(100vw - 16px))',
          height: 'min(420px, calc(100vh - 16px))',
        }}
        {...menu.getFloatingProps()}
        className="teammate-thread-popover flex flex-col gap-2 p-3 rounded-md border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] shadow-lg z-50"
      >
        <div className="teammate-thread-popover-header flex items-start justify-between gap-2">
          <div className="flex flex-col gap-0.5 min-w-0">
            <div className="teammate-thread-popover-title text-[12px] font-medium text-[var(--nim-text)] truncate">
              {teammate?.name ?? teammateName}
            </div>
            <div className="teammate-thread-popover-meta flex flex-wrap gap-x-2 text-[10px] text-[var(--nim-text-faint)]">
              {teammate && <span>{STATUS_LABELS[mapTeammateStatus(teammate.status)]}</span>}
              {teammate?.model && <span>{teammate.model}</span>}
              {teammate?.startedAt !== undefined && (
                <span>Started {new Date(teammate.startedAt).toLocaleTimeString()}</span>
              )}
              {teammate?.toolCallCount !== undefined && (
                <span>{teammate.toolCallCount} tool calls</span>
              )}
            </div>
          </div>
          {canStop && (
            <button
              type="button"
              className="teammate-thread-popover-stop shrink-0 text-[11px] px-2 py-1 rounded border border-[var(--nim-border)] text-[var(--nim-text)] disabled:opacity-50"
              onClick={handleStop}
              disabled={stopping}
            >
              {stopping ? 'Stopping…' : 'Stop'}
            </button>
          )}
        </div>

        <div className="teammate-thread-popover-body flex-1 min-h-0 overflow-hidden rounded border border-[var(--nim-border)]">
          {loading ? (
            <div className="teammate-thread-popover-loading flex h-full items-center justify-center text-[11px] text-[var(--nim-text-faint)]">
              Loading thread…
            </div>
          ) : messages && messages.length > 0 ? (
            <RichTranscriptView
              sessionId={transcriptKey}
              messages={messages}
              settings={TEAMMATE_TRANSCRIPT_SETTINGS}
              persistScrollState={false}
              agentName={teammate?.name ?? teammateName}
              agentModel={teammate?.model}
            />
          ) : (
            <div className="teammate-thread-popover-empty flex h-full items-center justify-center text-[11px] italic text-[var(--nim-text-faint)]">
              No activity yet from this teammate.
            </div>
          )}
        </div>

        {composeMode === 'inactive' ? (
          <div className="teammate-thread-popover-inactive text-[11px] text-[var(--nim-text-faint)]">
            This teammate is no longer active — messages can&apos;t be delivered.
          </div>
        ) : composeMode === 'revive' ? (
          <div className="teammate-thread-popover-revive-confirm flex items-center justify-between gap-2">
            <span className="text-[11px] text-[var(--nim-text-faint)] select-text">
              You shut this teammate down.
            </span>
            <button
              type="button"
              className="teammate-thread-popover-revive shrink-0 text-[11px] px-2 py-1 rounded border border-[var(--nim-border)] text-[var(--nim-text)]"
              onClick={handleRevive}
            >
              Revive
            </button>
          </div>
        ) : (
          <>
            <textarea
              className="teammate-thread-popover-input text-[12px] p-1.5 rounded border border-[var(--nim-border)] bg-[var(--nim-bg)] text-[var(--nim-text)] resize-none focus:outline-none focus:border-[var(--nim-primary)]"
              rows={3}
              value={message}
              placeholder={`Message ${teammate?.name ?? teammateName}…`}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={sendState === 'sending'}
              autoFocus
            />
            <div className="flex items-center justify-between gap-2">
              <span className="teammate-thread-popover-status text-[10px] text-[var(--nim-text-faint)]">
                {sendState === 'sent' && 'Sent'}
                {sendState === 'failed' && 'Failed to deliver — try again'}
              </span>
              <button
                type="button"
                className="teammate-thread-popover-send text-[11px] px-2 py-1 rounded bg-[var(--nim-primary)] text-white disabled:opacity-50"
                onClick={handleSend}
                disabled={!message.trim() || sendState === 'sending'}
              >
                {sendState === 'sending' ? 'Sending…' : 'Send'}
              </button>
            </div>
          </>
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
    </FloatingPortal>
  );
};

TeammateThreadPopover.displayName = 'TeammateThreadPopover';
