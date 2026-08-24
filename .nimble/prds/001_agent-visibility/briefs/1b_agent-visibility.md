# Task Brief: 1b

**Title:** Add `blocked` status to `TaskInfo.status`
**PRD:** agent-visibility
**Priority:** must
**Complexity:** 6/10
**Model:** opus
**Wave:** 1
**Feature Issue:** TBD — assigned by PM agent at execution start (no GitHub issue number recorded in the PRD frontmatter yet)

---

## Objective

Add a `blocked` value to `TaskInfo.status` (the status enum for Nimbalyst's SDK-native "Task"
sub-agents) and set/clear it correctly when a *specific* individual Task sub-agent's permission
prompt is pending, so the architect can see — per sub-agent — which one is actually waiting on
them instead of every Task sub-agent showing the same "running" spinner. This closes half of
requirement R1/R2 (Task sub-agents' half; Teammates' half is task 1a) and is a prerequisite for the
normalized `SubAgentStatus` mapping (task 2a) and the chip row (task 2b) built on top of it.

---

## Context

**Parent Feature:** Agent Visibility and Workflow Enhancement (PRD `agent-visibility`, GitHub
feature issue TBD)

Nimbalyst has three separate "spawned agent" systems, each with its own status vocabulary: SDK-native
Task sub-agents (`TaskInfo`, in-process, never persisted as their own `ai_sessions` row),
Nimbalyst "Teammates" (`TeammateInfo`, own `query()` per teammate via `TeammateManager`), and
Meta-Agent Mode child sessions (real, independent `ai_sessions` rows, out of scope for this task).
This PRD closes a gap against native Claude Code's sub-agent visibility, verified against tracker
item `tsk_mt1xxymgata1sw`: today, a Task sub-agent that hits a permission prompt shows no distinct
signal — it keeps the same "running" spinner as a sub-agent that's actively working, and the
architect only discovers the block by manually scrolling.

`TaskInfo.status` today has four values — `'running' | 'completed' | 'failed' | 'stopped'`
(`packages/electron/src/renderer/store/atoms/agentMode.ts:233`). SDK-native Task sub-agents share
the *same* `canUseTool` permission callback as the lead session's own `query()` — there is no
per-Task override. That shared callback currently has no way to know *which* Task sub-agent (if
any) the permission request came from, so this task cannot just flip a status field; it must first
establish the attribution.

This task is part of **Wave 1** — the foundation wave. It has no upstream dependencies. Task 1a
(the equivalent work for `TeammateInfo.status`) now depends on this task completing first (both
edit `ClaudeCodeProvider.ts`, sequenced to avoid a concurrent edit window — see task 1a's brief)
and runs in Wave 2. Task 2a (build the normalized `SubAgentStatus` mapping) depends on both 1a and
1b completing, and runs in Wave 3.

---

## Research Context

PRD `agent-visibility` has approved research findings
(`.nimble/prds/001_agent-visibility/research/findings.md`), reproduced/extended here with
additional investigation performed for this brief (see "Investigation Findings" below — this goes
beyond what the PRD/tasks.yaml already state and should materially de-risk the task).

### Patterns to Follow

- **`emitTaskUpdate` write path** — `packages/runtime/src/ai/server/providers/ClaudeCodeProvider.ts:2924-2943`.
  Mutate the relevant entry in the private `activeTasks` Map, then call
  `this.emitTaskUpdate(sessionId).catch(() => {})`. This persists
  `Array.from(this.activeTasks.values())` into `session.metadata.currentTasks` (the field
  `sessionTasksAtom` reads) and emits `message:logged` so the renderer reloads. This is the *only*
  write path for `TaskInfo` — every existing status transition (`task_started`, `task_progress`,
  `task_notification`, `task_updated`) goes through it. Follow it exactly; do not invent a second
  write path.
- **Existing status-transition handling for reference** —
  `ClaudeCodeProvider.ts:2752-2823` (`handleSystemTask`). This is where `task_started` sets
  `status: 'running'` (:2759), `task_notification` sets a terminal status (:2780), and `task_updated`
  applies a mapped patch status via `mapTaskUpdatedPatchStatus`/`shouldApplyTaskUpdatedStatus`
  (:2815-2818, imported helpers — check their source file for the exhaustive value list before
  adding `blocked`, since a `never`-style exhaustiveness check may need a new case).
- **Local type duplication — you must update it in two places, not one.** `TaskInfo.status`'s
  string-literal union is declared *twice*, independently:
  1. `packages/electron/src/renderer/store/atoms/agentMode.ts:233` (renderer-side type, consumed by
     `sessionTasksAtom` and everything downstream in the UI).
  2. `packages/runtime/src/ai/server/providers/ClaudeCodeProvider.ts:298-313` — the private
     `activeTasks` Map's inline value type (`status: 'running' | 'completed' | 'failed' | 'stopped'`
     at line 302). This is the runtime-side shape that actually gets serialized into
     `session.metadata.currentTasks`.
  These two types are not imported from a shared location — they are hand-kept in sync. Add
  `'blocked'` to **both** unions. If you find a shared type definition during implementation that
  supersedes this duplication, that is out of scope to fix here — just keep both in sync as they
  are today.
- **`lastActiveAt`-style per-entity tracking used by Teammates** —
  `packages/runtime/src/ai/server/providers/TeammateManager.ts:1524` sets
  `managedEntry.lastActiveAt = Date.now()` per-teammate on every chunk, keyed by teammate id. This
  is the reference shape (a per-entity Map value updated by a keyed lookup) if you need an
  additional lookup structure for attribution — see Investigation Findings below for the concrete
  recommendation.

### Known Issues to Address

- The PRD's own task description (`tasks.yaml`, task 1b) explicitly calls out that
  `options.toolUseID` in the `canUseTool` callback (`ClaudeCodeProvider.ts:3654-3658`) is the
  **inner** tool call's id (e.g. the `Bash` call a Task sub-agent is trying to run), **not** the
  Task's own `tool_use_id` that populates `activeTasks`'s `toolUseId` field
  (`ClaudeCodeProvider.ts:2761`, set from `chunk.tool_use_id` at `task_started`). Attribution
  requires bridging these two ids. See Investigation Findings — this bridge already half-exists in
  the codebase but is not currently threaded through to where `canUseTool` can read it.

### Investigation Findings (perform this FIRST, per the task description — this section gives you a concrete starting point, but you must still verify it empirically before relying on it)

**The correlation mechanism already exists in the transcript adapter, but its output is discarded
before it reaches the provider's tool-call handling.**

1. `packages/runtime/src/ai/server/providers/claudeCode/ClaudeCodeTranscriptAdapter.ts`'s
   `parseToolUseBlock` (lines 256-315) already computes exactly the value you need, for a
   different purpose:
   - `emittedSubagents` (a `Set<string>` of Task tool_use ids) is populated whenever a `Task`-type
     tool_use block is parsed (line 262-264: `SUBAGENT_TOOLS.has(toolName) && toolId`).
   - For every *subsequent* (non-subagent) tool_use block, line 294-295 computes:
     `const subagentId = parentToolUseId && this.emittedSubagents.has(parentToolUseId) ? parentToolUseId : undefined;`
     — i.e., if this tool call's `parent_tool_use_id` (threaded in from `chunk.parent_tool_use_id`
     at line 219, itself present on every raw SDK stream chunk per `ClaudeSDKProtocol.ts:36`)
     matches a known Task's own tool_use id, `subagentId` **is** that Task's `tool_use_id` — the
     exact value stored as `activeTasks.get(taskId).toolUseId`.
   - This `subagentId` is emitted on the internal event bus at line 301-312
     (`type: 'tool_call_started', ..., subagentId: subagentId ?? null`) — but it is **NOT** included
     in the `ParsedItem` returned at line 314:
     `return { kind: 'tool_use', toolId: toolId ?? 'tool-anon', toolName, args, isMcp, isSubagent: false };`
     — no `subagentId` field. The `ParsedItem` type for `kind: 'tool_use'`
     (`ClaudeCodeTranscriptAdapter.ts:29`) also has no `subagentId` field to add it to.
2. `ClaudeCodeProvider.ts`'s main chunk-processing loop consumes exactly this `ParsedItem` shape at
   the `case 'tool_use':` handler (`ClaudeCodeProvider.ts:1362-1404`), destructuring
   `{ toolId, toolName, args, isMcp, isSubagent }` from `item` (line 1368) — `toolId` here is the
   **inner** tool's own id, i.e. exactly what later shows up as `options.toolUseID` in the
   `canUseTool` callback.

**Recommended approach (verify before committing to it):**

1. Add an optional `subagentId?: string` field to the `kind: 'tool_use'` variant of `ParsedItem`
   (`ClaudeCodeTranscriptAdapter.ts:29`) and thread it through the return at line 314 (use the
   `subagentId` local variable already computed at line 294-295 — do not recompute it).
2. In `ClaudeCodeProvider.ts`'s `case 'tool_use':` handler, when `item.subagentId` is present,
   record a mapping from the inner tool's id to the owning Task's `tool_use_id` — e.g. a private
   `Map<string, string>` (`toolUseIdToTaskToolUseId` or similar), keyed by `item.toolId`, valued by
   `item.subagentId`. Do this before/alongside the existing `toolCallsById.set(toolId, toolCall)`
   at line 1397, since both need the same `toolId`.
3. In `createCanUseToolHandler`'s returned closure (`ClaudeCodeProvider.ts:3654-3705`), when
   `options.toolUseID` is present, look it up in that map to get the Task's own `tool_use_id`, then
   find the matching entry in `activeTasks` (scan `activeTasks.values()` for
   `entry.toolUseId === taskToolUseId`, or add a secondary index if you find the scan awkward —
   `activeTasks` is small, a scan is acceptable). Set that entry's `status = 'blocked'` and call
   `this.emitTaskUpdate(sessionId)` before the permission decision resolves; clear it back
   (to `'running'`, unless the task has since gone terminal) once `handleToolPermissionWithService`
   /`handleToolPermissionFallback` returns.

**CRITICAL — ordering is not proven, verify empirically before relying on it:** the assistant chunk
carrying the inner tool_use block (step 2 above, which populates the correlation map) arrives via
the main `for await` iterator loop. The `canUseTool` callback (step 3) is invoked by the SDK
through a *separate* control-channel mechanism, not necessarily synchronized with how far the
provider's own iterator-consumption loop has progressed. **It is not proven that the tool_use item
is guaranteed to have been processed by the provider's loop before `canUseTool` fires for that same
tool.** If they race and `canUseTool` fires first, the lookup map will be empty for that toolId and
attribution will silently fail (falling back to no status change, which is the safe failure mode —
do not guess/attribute to the wrong task if the map lookup misses).

Before writing the attribution-consuming logic in `canUseTool`, write a small test or add temporary
logging that proves the ordering for at least one real concurrent-Task-sub-agent permission-prompt
scenario. If ordering is NOT reliable, you will need a different approach — options include (do not
implement speculatively; only reach for these if the direct approach is proven unreliable):
- Deferring the permission UI/status-set by a short window to let the map populate, or
- Building the correlation map from a different chunk than the one currently consumed by the
  provider's own loop (e.g. processing the raw chunk for `parent_tool_use_id` directly in
  `handleSystemTask` or a new dedicated hook, ahead of/independent from the `ParsedItem` pipeline).

Document what you find (the actual ordering behavior you observed) directly in a code comment near
the attribution logic — this is exactly the kind of hard-won context a future reader needs and
cannot get from the diff alone.

### Recommended Approach

- No new library dependency. This is entirely internal wiring across two files already in
  `files_affected`.
- Do not build a second, parallel notification/status-write mechanism — everything for `TaskInfo`
  goes through `emitTaskUpdate` (see Patterns to Follow above).

### Dependencies

**File Dependencies:**
- None from other tasks — 1b has `depends_on: []`. Task 2a (normalized `SubAgentStatus` mapping)
  depends on this task's output (the `blocked` value existing on `TaskInfo.status`), not the other
  way around.

**Library Dependencies:**
- None new.

---

## Requirements

Fulfills PRD requirement **R2**: *"Add `blocked` status to `TaskInfo.status`
(`packages/electron/src/renderer/store/atoms/agentMode.ts:233`, values today
`'running'|'completed'|'failed'|'stopped'`), set via the same `canUseTool` routing Task sub-agents
already inherit (`ClaudeCodeProvider.ts:3648`, `:3705-3760`)."*

Concretely:

1. Add `'blocked'` to the `TaskInfo.status` union in **both** locations (renderer type and the
   runtime provider's internal `activeTasks` Map value type — see "Local type duplication" under
   Patterns to Follow). Do not touch any other status value.
2. Perform the investigation step described above (or your own equivalent investigation) to
   establish a reliable way to attribute a `canUseTool` permission request to the specific
   `activeTasks` entry (Task sub-agent) it came from. Do not implement the status transition before
   this attribution mechanism is proven to work for the concurrent case.
3. Set the correct Task's status to `'blocked'` when its permission/prompt request becomes pending,
   via the existing `createCanUseToolHandler` routing. Clear it back to the prior/next status
   (typically `'running'`, unless the task has since terminated) once the prompt resolves (approved,
   denied, or cancelled) — mirror however `handleToolPermissionWithService`/
   `handleToolPermissionFallback` signal resolution today (both are awaited calls; attach your
   clear-on-resolve logic around the `await` that already exists in
   `createCanUseToolHandler`, `ClaudeCodeProvider.ts:3663-3691`).
4. Do not change any other `TaskInfo`/`activeTasks` status-transition logic
   (`task_started`/`task_progress`/`task_notification`/`task_updated` handling in
   `handleSystemTask`, `ClaudeCodeProvider.ts:2752-2823`) beyond what's needed to add the `blocked`
   value to the type union.
5. When two Task sub-agents are running concurrently and only one hits a permission prompt, only
   that one's status may show `blocked` — the other must remain `running`. This is the specific
   scenario the attribution mechanism exists to handle; do not implement a global "any task is
   blocked" flag as a shortcut.

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] `blocked` is a valid value of `TaskInfo.status` alongside the existing four values (both in
      `agentMode.ts:233` and in `ClaudeCodeProvider.ts`'s internal `activeTasks` Map value type)
- [ ] Status transitions to `blocked` when the specific Task sub-agent's permission request becomes
      pending
- [ ] Status transitions away from `blocked` correctly once the prompt resolves
- [ ] Existing `running`/`completed`/`failed`/`stopped` transitions are unaffected (regression-safe)
- [ ] Unit test covers both the blocked-entry and blocked-exit transitions
- [ ] When two Task sub-agents are running concurrently and one hits a permission prompt, only that
      sub-agent's chip/status shows `blocked` — the other stays `running`
- [ ] The ordering assumption between the tool_use item's processing and the `canUseTool` callback
      firing has been empirically verified (not just assumed), and the finding is documented in a
      code comment near the attribution logic

**All criteria must pass before task is complete.**

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/electron/src/renderer/store/atoms/agentMode.ts` | modify | Add `'blocked'` to the `TaskInfo.status` union (line 233) |
| `packages/runtime/src/ai/server/providers/ClaudeCodeProvider.ts` | modify | Add `'blocked'` to the internal `activeTasks` status type (line 302); implement attribution + set/clear logic in `createCanUseToolHandler` (lines 3648-3706) and its `case 'tool_use':` handling (lines 1362-1404) |
| `packages/runtime/src/ai/server/providers/claudeCode/ClaudeCodeTranscriptAdapter.ts` | modify (likely) | Thread the already-computed `subagentId` (line 294-295) through the `kind: 'tool_use'` `ParsedItem` return (line 314) and its type (line 29), if you adopt the recommended approach above. Only touch this file if your chosen attribution mechanism needs it — do not modify it speculatively. |

### File Ownership Notes

- `ClaudeCodeProvider.ts` is also touched by task **4a** (`depends_on: ["1b"]` — sequenced after
  this task specifically to avoid a conflicting edit). Task 4a touches a different section (the
  post-result drain-grace timer, `:1038-1052`/`:1197-1200`) than this task (`canUseTool` routing,
  `:3648`/`:3705-3760`, and the `tool_use` chunk handler, `:1362-1404`). No overlap expected, but
  do not touch the drain-grace-timer code — that is 4a's scope.
- `agentMode.ts` is also touched by task **1a** (`TeammateInfo`-related work), but 1a's own
  `agent_context` confirms `TeammateInfo.status` is declared in `TeammatePanel.tsx`, not
  `agentMode.ts` (which only imports that type) — there is no real overlap between 1a and 1b on this
  file. You are only adding one string literal to the `TaskInfo.status` union here.
- `ClaudeCodeTranscriptAdapter.ts` is not listed as touched by any other task in this PRD as of
  planning time — safe to modify if your approach requires it.

---

## Implementation Guidance

### Patterns to Follow

See "Research Context" above — `emitTaskUpdate` is the single write path for `TaskInfo`/
`activeTasks`; the transcript-adapter `parentToolUseId`/`emittedSubagents` mechanism is the
existing, proven pattern for correlating a child tool call to its owning Task sub-agent (already
used for the `tool_call_started` bus event and for building sub-agent hierarchy in
`SessionManager.ts:195-224`'s `transformAgentMessagesToUI`, a post-hoc/persisted-message analog of
what this task needs to do live).

### Code Style

Match existing style in `ClaudeCodeProvider.ts` and `ClaudeCodeTranscriptAdapter.ts` — these files
use plain `Map`s for per-entity tracking, `console.log`/`console.warn`/`console.error` with a
`[CLAUDE-CODE]` prefix for diagnostic logging (see e.g. line 2766, 2787), and inline comments
explaining *why* (not just what) for non-obvious ordering/timing decisions — follow this convention
for the ordering-verification comment required by this task's success criteria.

### Edge Cases

- **A Task sub-agent's permission prompt resolves after the task itself has already gone
  terminal** (e.g. reaped by `reapRunningTasks` due to abort, or already marked `completed`/`failed`
  via a race with `task_notification`). Do not overwrite a terminal status back to `running` when
  clearing `blocked` — only clear to `running` if the entry's status is still `blocked` at
  resolution time; if it's already terminal, leave it.
- **The attribution lookup misses** (map has no entry for `options.toolUseID`, e.g. due to the
  ordering risk described above, or because the permission request came from the lead session
  itself, not a Task sub-agent). Do not attribute to the wrong task or to a global flag in this
  case — fail safe by not setting any Task to `blocked` (the existing behavior, i.e. no regression),
  and note in your test coverage that this fallback path is exercised.
- **Two concurrent Task sub-agents both hit permission prompts near-simultaneously.** Your
  attribution map and `activeTasks` lookup must handle both being `blocked` at once, independently
  clearable.

### Testing Requirements

- Extend `packages/runtime/src/ai/server/providers/__tests__/ClaudeCodeProvider.taskReap.test.ts`
  (or add a sibling file in the same `__tests__` directory, e.g.
  `ClaudeCodeProvider.taskBlocked.test.ts`, if the attribution logic needs more setup than fits
  naturally alongside the existing reap tests — use judgment, but prefer extending an existing file
  per the project's test-discipline rules) using the same pattern: instantiate
  `new ClaudeCodeProvider()`, cast via an `internals()`-style helper to reach the private
  `activeTasks` Map (and whatever private attribution map you add) directly, set up two concurrent
  fake task entries, and assert the blocked-entry/blocked-exit transitions and the
  "only the right task transitions" concurrent case, without needing a real SDK subprocess.
- If your chosen approach requires exercising `createCanUseToolHandler`'s closure directly (rather
  than just the `activeTasks` Map mutation), you may need to construct the closure with a fake
  `sessionId`/`workspacePath` and stub the `permissionService`/`handleToolPermissionFallback` path —
  check `ClaudeCodeProvider.permissionChange.test.ts` in the same `__tests__` directory for an
  existing pattern of testing permission-adjacent behavior on this provider before building your own
  stubbing approach from scratch.
- Regression coverage: confirm existing `running`/`completed`/`failed`/`stopped` transitions
  (already covered by `ClaudeCodeProvider.taskReap.test.ts` for the `stopped`-on-abort case) still
  pass unmodified.

---

## Boundaries

### Files You MUST NOT Touch

Global `never_touch` list (from `.nimble/config.yaml`):
- `package-lock.json`
- `packages/browser-extension/package-lock.json`
- `.env*`
- `.github/workflows/*`
- `packages/electron/src/database/migrations/*`
- `packages/electron/src/main/database/sqlite/schemas/*`
- `node_modules/`
- `**/dist/`
- `packages/electron/out/`
- `nimbalyst-local/`
- `.beads/`

PRD-specific boundaries (§11 Agent Boundaries):
- Do not fold Meta-Agent Mode's separate `getStatusTone`/`getBarTone` status enum
  (`packages/electron/src/renderer/components/MetaAgentMode/MetaAgentMode.tsx:67-104`) into
  anything this task touches — explicitly out of scope.
- Do not modify `packages/electron/src/main/services/ai/claudeCliSubAgentTracker.ts`'s
  transcript-hiding logic — unrelated to this task, but listed as a global "do not touch" for this
  PRD; if you find yourself anywhere near it, stop and re-check scope.

### Files Requiring Review

None of this task's files (`agentMode.ts`, `ClaudeCodeProvider.ts`,
`ClaudeCodeTranscriptAdapter.ts`) are in `.nimble/config.yaml`'s `require_review` list. This task
does not trigger the PRD's human-review gate on its own (only task 5a, via `CHANGELOG.md`, does —
see Dependencies below).

---

## Dependencies

### Upstream Tasks

None — task 1b has `depends_on: []` and can start immediately.

### Downstream Impact

Tasks that depend on this one:

| Task | What it needs from 1b | Why |
|------|------------------------|-----|
| 2a | `blocked` value present on `TaskInfo.status` | Builds the normalized `SubAgentStatus` mapping across both `TeammateInfo.status` (from 1a) and `TaskInfo.status` (from this task); its exhaustiveness test needs `blocked` to already exist on both source enums. |
| 4a | This task's edits to `ClaudeCodeProvider.ts` landed first | 4a (fix concurrent Task sub-agent stall masking) also touches `ClaudeCodeProvider.ts`, in a different section (post-result drain-grace timer). Sequenced via `depends_on: ["1b"]` purely to avoid a conflicting edit window, not because 4a needs any specific behavior from 1b. |

**Before starting:** No upstream dependency to verify — this task starts from the current state of
`main`/the feature branch with no prior task's output required.

---

## GitHub Context

**Issue:** TBD — created by PM agent at execution start
**Feature Issue (Parent):** TBD — created by PM agent at execution start
**Branch:** `worktree/agent-visibility-1b`
**Target:** Determined by PM agent based on execution mode (feature branch or main)

---

## Commit Guidelines

Use Conventional Commits:
```
feat(agent-mode): add blocked status to TaskInfo for Task sub-agent permission prompts

Co-Authored-By: Claude <noreply@anthropic.com>
```

Types: feat, fix, refactor, test, docs, chore

---

## Deliverables

None beyond the files above. The status-field addition, the attribution mechanism, and their unit
tests are the only artifacts this task produces (per PRD `tasks.yaml`'s `deliverables_note` for
task 1b: "Nothing beyond the code — the status field addition and its unit test are the only
artifacts.").

---

## Validation Checklist

Before creating PR:
- [ ] All success criteria met
- [ ] Build passes: `npm run build`
- [ ] Type check passes: `npm run typecheck`
- [ ] No `never_touch` files modified
- [ ] Tests added/updated (`npm run test:unit`)
- [ ] Branch rebased on target branch (feature branch or main)

---

*Generated by NIMBLE Brief Writer*
*PRD: agent-visibility | Task: 1b | Wave: 1*
