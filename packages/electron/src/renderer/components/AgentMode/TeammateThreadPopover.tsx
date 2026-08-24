/**
 * TeammateThreadPopover - opens when a Teammate chip in `SubAgentChipRow` is
 * clicked. Lets the architect send a message directly to that teammate,
 * without navigating away from the current transcript.
 *
 * Teammates have no persisted `ai_sessions` row (see task 2c's brief,
 * Finding 1), so there is no existing transcript to render here - this is a
 * compose-only surface, not a full thread view. That satisfies R5's "opens/
 * loads that teammate's own thread and allows sending it a message directly"
 * without inventing a new streamed-transcript feature.
 */

import React, { useCallback, useState } from 'react';
import { useFloatingMenu, FloatingPortal } from '../../hooks/useFloatingMenu';

export interface TeammateThreadPopoverProps {
  sessionId: string;
  agentId: string;
  teammateName: string;
  /** false for a completed/errored teammate - delivery is not attempted. */
  isActive: boolean;
  anchorEl: HTMLElement;
  onClose: () => void;
}

export const TeammateThreadPopover: React.FC<TeammateThreadPopoverProps> = ({
  sessionId,
  agentId,
  teammateName,
  isActive,
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

  return (
    <FloatingPortal>
      <div
        ref={menu.refs.setFloating}
        style={menu.floatingStyles}
        {...menu.getFloatingProps()}
        className="teammate-thread-popover flex flex-col gap-2 p-3 rounded-md border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] shadow-lg w-[280px] z-50"
      >
        <div className="teammate-thread-popover-title text-[12px] font-medium text-[var(--nim-text)] truncate">
          {teammateName}
        </div>

        {!isActive ? (
          <div className="teammate-thread-popover-inactive text-[11px] text-[var(--nim-text-faint)]">
            This teammate is no longer active — messages can&apos;t be delivered.
          </div>
        ) : (
          <>
            <textarea
              className="teammate-thread-popover-input text-[12px] p-1.5 rounded border border-[var(--nim-border)] bg-[var(--nim-bg)] text-[var(--nim-text)] resize-none focus:outline-none focus:border-[var(--nim-primary)]"
              rows={3}
              value={message}
              placeholder={`Message ${teammateName}…`}
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
