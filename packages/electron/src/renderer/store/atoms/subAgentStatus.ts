/**
 * Normalized sub-agent status mapping.
 *
 * Nimbalyst has two independent "spawned agent" status vocabularies:
 * `TeammateInfo.status` (Nimbalyst Teammates) and `TaskInfo.status` (SDK-native Task
 * sub-agents). This module normalizes both into one shared, display-only
 * `SubAgentStatus` so a single chip row can color every sub-agent consistently
 * regardless of which system produced its status.
 *
 * Follows the derived-atom pattern of `groupSessionStatusAtom` (`sessions.ts`):
 * a derived atom that reads several underlying per-entity atoms and folds them
 * into one summary shape, computed on read rather than persisted.
 *
 * `SubAgentStatus` is never persisted on `TeammateInfo` or `TaskInfo` — it is
 * always derived from the raw status on read.
 */

import { atom } from 'jotai';
import { atomFamily } from '../debug/atomFamilyRegistry';
import { sessionTeammatesAtom, sessionTasksAtom, type TaskInfo } from './agentMode';
import type { TeammateInfo } from '../../components/AgentMode/TeammatePanel';

export type SubAgentStatus = 'working' | 'waiting' | 'blocked' | 'complete' | 'error';

/** Compile-time exhaustiveness guard: a new status value on either source enum
 *  that isn't handled below fails to compile here instead of silently falling
 *  through at runtime. */
function assertNeverStatus(status: never): never {
  throw new Error(`Unhandled sub-agent status: ${JSON.stringify(status)}`);
}

/** Maps a Nimbalyst Teammate's raw status to the normalized `SubAgentStatus`. */
export function mapTeammateStatus(status: TeammateInfo['status']): SubAgentStatus {
  switch (status) {
    case 'running':
      return 'working';
    case 'idle':
      return 'waiting';
    case 'blocked':
      return 'blocked';
    case 'completed':
      return 'complete';
    case 'errored':
      return 'error';
    default:
      return assertNeverStatus(status);
  }
}

/**
 * Maps an SDK-native Task sub-agent's raw status to the normalized `SubAgentStatus`.
 *
 * `'stopped'` maps to `'error'`, not `'waiting'`: both places that set it
 * (`ClaudeCodeProvider.ts`'s stale-task cleanup on restart, and
 * `reapStalledSubagentTasks`'s stall-reaping) are abnormal-termination paths, not
 * a user-initiated stop, and the existing `TeammatePanel.tsx` `TaskItem` already
 * renders `'stopped'` with the same error-colored indicator as `'failed'`.
 */
export function mapTaskStatus(status: TaskInfo['status']): SubAgentStatus {
  switch (status) {
    case 'running':
      return 'working';
    case 'stopped':
      return 'error';
    case 'blocked':
      return 'blocked';
    case 'completed':
      return 'complete';
    case 'failed':
      return 'error';
    default:
      return assertNeverStatus(status);
  }
}

/** One normalized sub-agent status entry, tagged with its source and identity
 *  so the chip row (task 2b) can key/click through to the right sub-agent. */
export interface NormalizedSubAgentStatus {
  id: string;
  kind: 'teammate' | 'task';
  status: SubAgentStatus;
}

/**
 * Per-session derived atom: normalized status for every teammate and Task
 * sub-agent currently active in a session, in one flat list.
 *
 * Reads from the existing `sessionTeammatesAtom` / `sessionTasksAtom` atom
 * families rather than re-deriving from `sessionStoreAtom` directly.
 */
export const sessionSubAgentStatusesAtom = atomFamily((sessionId: string) =>
  atom((get): NormalizedSubAgentStatus[] => {
    const teammates = get(sessionTeammatesAtom(sessionId));
    const tasks = get(sessionTasksAtom(sessionId));

    const teammateStatuses: NormalizedSubAgentStatus[] = teammates.map((teammate) => ({
      id: teammate.agentId,
      kind: 'teammate',
      status: mapTeammateStatus(teammate.status),
    }));

    const taskStatuses: NormalizedSubAgentStatus[] = tasks.map((task) => ({
      id: task.taskId,
      kind: 'task',
      status: mapTaskStatus(task.status),
    }));

    return [...teammateStatuses, ...taskStatuses];
  })
);
