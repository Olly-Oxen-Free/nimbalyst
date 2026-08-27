/**
 * TeammateTileRail - the column of teammate transcript tiles that sits beside
 * the main thread in `SessionTranscript`, alongside `TaskTileRail`. Clicking a
 * teammate chip (inline row) or a Teammates sidebar row toggles that
 * teammate's tile in `openTeammateTilesAtomFamily`.
 *
 * Sibling of `TaskTileRail`, not a shared component with it: a teammate tile
 * is interactive (compose input, stop control) where a Task tile is read-only,
 * so the two kinds don't share tile-body logic, matching how
 * `TeammateThreadPopover`/`TaskThreadPopover` are also two independent
 * implementations rather than one kind-branching component.
 *
 * Layout decisions mirror `TaskTileRail`'s (see its own doc comment for the
 * reasoning): main thread keeps priority, many tiles scroll rather than
 * shrink, zero tiles renders nothing, a tile is user-closable and never
 * auto-closes.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { RichTranscriptView } from '@nimbalyst/runtime/ui/AgentTranscript/components/RichTranscriptView';
import type { TranscriptViewMessage } from '@nimbalyst/runtime/ai/server/types';
import {
  closeTeammateTileAtom,
  openTeammateTilesAtomFamily,
  sessionTeammatesAtom,
  teammateTranscriptSignalAtomFamily,
  teammateTranscriptSignalKey,
} from '../../store/atoms/agentMode';
import { sessionListWorkspaceAtom } from '../../store/atoms/sessions';
import { mapTeammateStatus } from '../../store/atoms/subAgentStatus';

/** Per-tile width. Below this a transcript is not readable. */
const TILE_WIDTH = 320;
/** Share of the row the rail may take before it starts scrolling horizontally. */
const MAX_RAIL_WIDTH = '50%';

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

interface TeammateTileProps {
  sessionId: string;
  agentId: string;
}

const TeammateTile: React.FC<TeammateTileProps> = ({ sessionId, agentId }) => {
  const workspacePath = useAtomValue(sessionListWorkspaceAtom);
  const closeTile = useSetAtom(closeTeammateTileAtom);
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
  // Delivery is plausible while the teammate is running/blocked/idle; a
  // completed or errored teammate has no process left to receive a message.
  const canCompose = !!teammate
    && teammate.status !== 'completed'
    && teammate.status !== 'errored';

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

  const handleClose = useCallback(() => {
    closeTile({ sessionId, agentId });
  }, [closeTile, sessionId, agentId]);

  const status = teammate ? mapTeammateStatus(teammate.status) : 'complete';
  // Never the lead's id, and never the hover popover's key: RichTranscriptView
  // caches virtual-list state per sessionId.
  const transcriptKey = teammate?.sessionId
    ? `${teammate.sessionId}:tile`
    : `${sessionId}:${agentId}:tile`;

  return (
    <div
      className="teammate-tile flex flex-col rounded-md border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] overflow-hidden"
      style={{ flex: `0 0 ${TILE_WIDTH}px`, width: TILE_WIDTH }}
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
        <button
          type="button"
          className="teammate-tile-close shrink-0 bg-transparent border-none cursor-pointer text-[var(--nim-text-muted)] hover:text-[var(--nim-text)] leading-none px-1"
          onClick={handleClose}
          aria-label={`Close ${teammateName} tile`}
        >
          &#x2715;
        </button>
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
          />
        )}
      </div>
      {!canCompose ? (
        <div className="teammate-tile-inactive px-2 py-1.5 border-t border-[var(--nim-border)] text-[10px] text-[var(--nim-text-faint)]">
          This teammate is no longer active — messages can&apos;t be delivered.
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
    </div>
  );
};

TeammateTile.displayName = 'TeammateTile';

export interface TeammateTileRailProps {
  sessionId: string;
}

/** Renders one tile per open teammate, or nothing when none are open. */
export const TeammateTileRail: React.FC<TeammateTileRailProps> = React.memo(({ sessionId }) => {
  const openAgentIds = useAtomValue(openTeammateTilesAtomFamily(sessionId));
  const tiles = useMemo(
    () => openAgentIds.map(agentId => (
      <TeammateTile key={agentId} sessionId={sessionId} agentId={agentId} />
    )),
    [openAgentIds, sessionId],
  );

  if (openAgentIds.length === 0) return null;

  return (
    <div
      className="teammate-tile-rail flex gap-2 overflow-x-auto overflow-y-hidden"
      style={{ flex: '0 1 auto', maxWidth: MAX_RAIL_WIDTH }}
      aria-label="Teammate transcripts"
    >
      {tiles}
    </div>
  );
});

TeammateTileRail.displayName = 'TeammateTileRail';
