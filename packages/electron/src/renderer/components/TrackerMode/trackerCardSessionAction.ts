/**
 * Pure state derivation for TrackerBoardCard's run/resume/focus dispatch
 * button. Kept in its own module (no React/jotai imports) so it stays
 * unit-testable without dragging in the component or the runtime barrel.
 */

export type TrackerCardSessionAction = 'run' | 'resume' | 'focus';

/**
 * No linked session -> run; linked session idle -> resume; linked session
 * currently processing -> focus (never creates a duplicate).
 */
export function deriveTrackerCardSessionAction(
  hasLinkedSession: boolean,
  isLinkedSessionProcessing: boolean,
): TrackerCardSessionAction {
  if (!hasLinkedSession) return 'run';
  return isLinkedSessionProcessing ? 'focus' : 'resume';
}

export const SESSION_ACTION_LABEL: Record<TrackerCardSessionAction, string> = {
  run: 'Run session',
  resume: 'Resume session',
  focus: 'Focus session',
};

export const SESSION_ACTION_ICON: Record<TrackerCardSessionAction, string> = {
  run: 'play_arrow',
  resume: 'restart_alt',
  focus: 'progress_activity',
};
