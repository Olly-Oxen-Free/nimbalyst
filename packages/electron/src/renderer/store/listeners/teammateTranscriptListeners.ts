/**
 * Centralized Teammate Transcript IPC Listener
 *
 * Subscribes ONCE to `teammate:transcript-updated` (main -> renderer live-update
 * signal, R5) and bumps a per-(sessionId, agentId) counter atom. Components
 * (e.g. the teammate thread popover) read the atom via useAtomValue and debounce
 * their own refetch -- they never subscribe to IPC directly, per
 * docs/IPC_LISTENERS.md.
 *
 * Call initTeammateTranscriptListeners() once at startup, mirroring
 * sessionTranscriptListeners.ts.
 */

import { store } from '@nimbalyst/runtime/store';
import { teammateTranscriptSignalAtomFamily, teammateTranscriptSignalKey } from '../atoms/agentMode';

/**
 * Initialize teammate transcript IPC listeners.
 * Should be called once at app startup.
 *
 * @returns Cleanup function to call on unmount
 */
export function initTeammateTranscriptListeners(): () => void {
  const cleanups: Array<() => void> = [];

  cleanups.push(
    window.electronAPI.on('teammate:transcript-updated', (data: {
      sessionId: string;
      agentId: string;
    }) => {
      const { sessionId, agentId } = data;
      if (!sessionId || !agentId) return;

      store.set(
        teammateTranscriptSignalAtomFamily(teammateTranscriptSignalKey(sessionId, agentId)),
        (prev) => prev + 1
      );
    })
  );

  return () => {
    cleanups.forEach((cleanup) => cleanup());
  };
}
