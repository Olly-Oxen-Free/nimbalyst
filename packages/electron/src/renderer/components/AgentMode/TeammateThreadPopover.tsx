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

/** Same knobs as the session transcript peek, except thinking stays visible:
 *  a teammate's reasoning is most of what the architect opens this to read. */
const TEAMMATE_TRANSCRIPT_SETTINGS = {
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
  // Delivery is plausible while the teammate is running/blocked/idle; a
  // completed or errored teammate has no process left to receive a message.
  const canCompose = !!teammate
    && teammate.status !== 'completed'
    && teammate.status !== 'errored';

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

  const [message, setMessage] = useState('');
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');

  const handleSend = useCallback(async () => {
    const content = message.trim();
    if (!content || sendState === 'sending') return;
    setSendState('sending');
    try {
      const result = await window.electronAPI.aiSendMessageToTeammate(sessionId, agentId, content);
      if (result.success) {
        setSendState('sent');
        setMessage('');
      } else {
        setSendState('failed');
      }
    } catch {
      setSendState('failed');
    }
  }, [message, sendState, sessionId, agentId]);

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
        <div className="teammate-thread-popover-header flex flex-col gap-0.5">
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
            />
          ) : (
            <div className="teammate-thread-popover-empty flex h-full items-center justify-center text-[11px] italic text-[var(--nim-text-faint)]">
              No activity yet from this teammate.
            </div>
          )}
        </div>

        {!canCompose ? (
          <div className="teammate-thread-popover-inactive text-[11px] text-[var(--nim-text-faint)]">
            This teammate is no longer active — messages can&apos;t be delivered.
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
      </div>
    </FloatingPortal>
  );
};

TeammateThreadPopover.displayName = 'TeammateThreadPopover';
