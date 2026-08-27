/**
 * Correlating forwarded Task sub-agent chunks back to the `activeTasks` entry
 * that owns them.
 *
 * The SDK option `forwardSubagentText` relays a Task sub-agent's own
 * assistant/thinking chunks through the LEAD's iterator, tagged with
 * `parent_tool_use_id` = the tool_use id of the `Task` call that spawned it.
 * `activeTasks` records that same id as `toolUseId` when `task_started` fires,
 * so the correlation is a direct match between the two.
 *
 * Why a DIRECT match and not a lookup through `subagentToolCallOwners`: that
 * map's KEYS are the *inner* tool_use ids of calls issued BY a sub-agent, and
 * its VALUES are the owning Task's tool_use id. A forwarded chunk's
 * `parent_tool_use_id` already lives in that map's value space, so treating it
 * as a key misses entirely at depth 1 (the lead's own Task call is never a key)
 * and resolves to the ancestor at depth 2. That map exists only to attribute an
 * in-flight tool call to its sub-agent for permission-prompt routing.
 *
 * Nesting needs no special handling: every depth gets its own `activeTasks`
 * entry keyed by its own `task_id` carrying its own `toolUseId`, so a depth-2
 * sub-agent's chunks match the depth-2 entry and never its ancestor's.
 */

/** The subset of an `activeTasks` entry this correlation needs. */
export interface SubagentTaskOwner {
  taskId: string;
  toolUseId?: string;
}

/**
 * Find the task that owns a forwarded sub-agent chunk.
 *
 * @param tasks The provider's `activeTasks` values. Entries are never deleted,
 *   only status-transitioned, so a completed task still correlates — which is
 *   what makes a finished sub-agent's transcript still readable.
 * @param parentToolUseId The chunk's `parent_tool_use_id`.
 * @returns The owning entry, or `undefined` when nothing matches — a chunk that
 *   arrived before `task_started` registered the entry, or one belonging to a
 *   teammate (teammates run their own SDK query, so their ids are from a
 *   different id space and must not be force-fit onto a task).
 */
/**
 * Resolve the `toolUseId` a `tool_progress` chunk implies for its owning
 * task, when that task doesn't have one yet.
 *
 * `SDKTaskStartedMessage.tool_use_id` is optional and comes back `undefined`
 * for `type=local_agent` (background-dispatched) tasks -- `task_updated`'s
 * `patch` never carries it either, so without this, `findTaskOwningSubagentChunk`
 * can never match those tasks' forwarded chunks: it's matching against
 * `undefined` forever, and the task's transcript stays empty even after it
 * completes. `tool_progress` chunks carry both `task_id` and
 * `parent_tool_use_id` on the same frame, giving a reliable second source.
 *
 * @param task The `activeTasks` entry the chunk's `task_id` names, or
 *   `undefined` if unknown.
 * @param chunk A raw `tool_progress` chunk.
 * @returns The id to set, or `undefined` when there's nothing to backfill
 *   (task unknown, chunk missing either id, or the task already has one --
 *   this never overwrites an id `task_started` already set).
 */
export function resolveTaskToolUseIdFromProgress(
  task: SubagentTaskOwner | undefined,
  chunk: { task_id?: unknown; parent_tool_use_id?: unknown } | null | undefined,
): string | undefined {
  if (!task || task.toolUseId) return undefined;
  if (!chunk || typeof chunk !== 'object') return undefined;
  const taskId = chunk.task_id;
  const parentToolUseId = chunk.parent_tool_use_id;
  if (typeof taskId !== 'string' || typeof parentToolUseId !== 'string') return undefined;
  if (taskId !== task.taskId) return undefined;
  return parentToolUseId;
}

export function findTaskOwningSubagentChunk<T extends SubagentTaskOwner>(
  tasks: Iterable<T>,
  parentToolUseId: string | undefined,
): T | undefined {
  if (!parentToolUseId) return undefined;
  for (const task of tasks) {
    if (task.toolUseId === parentToolUseId) return task;
  }
  return undefined;
}

/**
 * True if a persisted `ai_agent_messages` row is a forwarded chunk belonging to
 * the Task sub-agent spawned by `toolUseId`.
 *
 * The cheap reject tests for the id itself rather than the field name: the
 * lead's own chunks serialize `"parent_tool_use_id":null`, so testing for the
 * field name rejects nothing. The lead's `Task` tool_use block does contain the
 * id string, and is rejected by the parse-confirm below.
 *
 * Teammate-tagged rows are excluded explicitly. Teammates are also `Task`
 * dispatch and their own nested sub-agents produce rows carrying a
 * `parent_tool_use_id`; those ids come from the teammate's separate SDK query
 * and belong to the teammate thread view, not to a lead task.
 */
export function isTaskSubagentRawChunk(content: unknown, toolUseId: string): boolean {
  if (typeof content !== 'string' || !content.includes(toolUseId)) return false;
  try {
    const parsed = JSON.parse(content) as {
      parent_tool_use_id?: unknown;
      _isTeammateOutput?: unknown;
    };
    return parsed.parent_tool_use_id === toolUseId && parsed._isTeammateOutput !== true;
  } catch {
    return false;
  }
}
