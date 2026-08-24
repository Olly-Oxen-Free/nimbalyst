/**
 * What happens when a teammate's message arrives for an idle lead.
 *
 * `onTeammateMessageWhileIdle` resumes the main session's turn when a completed
 * teammate's inbox message arrives while the lead is idle. Delivery needs a
 * live, non-destroyed workspace window and a wired sendMessage handler -- any
 * one missing used to fall through with no signal at all, the exact "teammate
 * reports back, main session never wakes" gap this closes.
 */

export type TeammateWakeDeliveryOutcome =
  | 'delivered'
  | 'window_not_found'
  | 'window_destroyed'
  | 'handler_absent';

/** User-facing reason and main.log suffix for each drop case, so triage can tell them apart. */
const WAKE_DROP: Record<Exclude<TeammateWakeDeliveryOutcome, 'delivered'>, { reason: string; log: string }> = {
  window_not_found: {
    reason: 'its workspace window is not open',
    log: 'workspace window not found',
  },
  window_destroyed: {
    reason: 'its workspace window was closed',
    log: 'workspace window destroyed',
  },
  handler_absent: {
    reason: 'the session handler was not ready',
    log: 'sendMessageHandler not available',
  },
};

/** Classify whether a teammate's wake message can be delivered right now. */
export function classifyTeammateWakeDelivery(
  targetWindow: { isDestroyed(): boolean } | null,
  hasSendMessageHandler: boolean,
): TeammateWakeDeliveryOutcome {
  if (!targetWindow) return 'window_not_found';
  if (targetWindow.isDestroyed()) return 'window_destroyed';
  if (!hasSendMessageHandler) return 'handler_absent';
  return 'delivered';
}

export interface TeammateWakeDeliverySignal {
  /** The existing fire-and-forget sendMessage resume. */
  deliver: () => void;
  /** Distinct signal for a message that could not be delivered. */
  notifyUndelivered: (reason: string) => void | Promise<void>;
  /** Logged so main.log triage can tell the three drop cases apart. */
  logDropped: (logSuffix: string) => void;
}

/** Act on a wake-delivery outcome: deliver, or log + notify why delivery failed. */
export async function announceTeammateWakeDelivery(
  outcome: TeammateWakeDeliveryOutcome,
  signal: TeammateWakeDeliverySignal,
): Promise<void> {
  if (outcome === 'delivered') {
    signal.deliver();
    return;
  }
  const { reason, log } = WAKE_DROP[outcome];
  signal.logDropped(log);
  await signal.notifyUndelivered(reason);
}
