/**
 * Centralized Task Sub-Agent Transcript IPC Listener
 *
 * Subscribes ONCE to `task:transcript-updated` (main -> renderer live-update
 * signal, R4) and bumps a per-(sessionId, taskId) counter atom. Components
 * (the Task transcript popover and tile) read the atom via useAtomValue and
 * debounce their own refetch -- they never subscribe to IPC directly, per
 * docs/IPC_LISTENERS.md.
 *
 * Call initTaskTranscriptListeners() once at startup, mirroring
 * teammateTranscriptListeners.ts.
 */

import { store } from '@nimbalyst/runtime/store';
import { taskTranscriptSignalAtomFamily, taskTranscriptSignalKey } from '../atoms/agentMode';

/**
 * Initialize task transcript IPC listeners.
 * Should be called once at app startup.
 *
 * @returns Cleanup function to call on unmount
 */
export function initTaskTranscriptListeners(): () => void {
  const cleanups: Array<() => void> = [];

  cleanups.push(
    window.electronAPI.on('task:transcript-updated', (data: {
      sessionId: string;
      taskId: string;
    }) => {
      const { sessionId, taskId } = data;
      if (!sessionId || !taskId) return;

      store.set(
        taskTranscriptSignalAtomFamily(taskTranscriptSignalKey(sessionId, taskId)),
        (prev) => prev + 1
      );
    })
  );

  return () => {
    cleanups.forEach((cleanup) => cleanup());
  };
}
