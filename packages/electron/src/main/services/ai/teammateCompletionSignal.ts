/**
 * What the user gets told when a lead's teammates all stop.
 *
 * `teammates:allCompleted` fires once no teammate is left, whether they
 * finished, crashed, or were abandoned by a dead lead. It used to end on the
 * completion chime in every case, so a team that died had exactly the UX of a
 * team that delivered. A non-clean outcome now replaces the chime with a
 * notification that says so.
 */

import type { TeammatesCompletionOutcome } from '@nimbalyst/runtime/ai/server';

export type { TeammatesCompletionOutcome };

/** Phrase describing an unhappy ending, or null when the batch finished cleanly. */
const FAILURE_REASON: Record<TeammatesCompletionOutcome, string | null> = {
  clean: null,
  errored: 'a teammate ended with an error',
  abandoned: 'teammates were abandoned when the session lost its connection',
};

export interface TeammatesCompletionSignal {
  /** The existing success chime. */
  playCompletionSound: () => void;
  /** Distinct signal for a batch that did not finish cleanly. */
  showFailureNotification: (reason: string) => void | Promise<void>;
}

/**
 * Announce the end of a teammate batch.
 *
 * @param outcome From the `teammates:allCompleted` payload. Treated as clean
 *   when absent, since the event is emitted across an untyped provider bus.
 */
export async function announceTeammatesCompletion(
  outcome: TeammatesCompletionOutcome | undefined,
  signal: TeammatesCompletionSignal,
): Promise<void> {
  const reason = outcome ? FAILURE_REASON[outcome] : null;
  if (!reason) {
    signal.playCompletionSound();
    return;
  }
  await signal.showFailureNotification(reason);
}
