# Task Brief: 1a

**Title:** Add `blocked` status to `TeammateInfo.status`
**PRD:** agent-visibility
**Priority:** must
**Complexity:** 5/10
**Model:** opus
**Wave:** 1
**Feature Issue:** TBD — assigned by PM agent at execution start (no GitHub issue number recorded in the PRD frontmatter yet)

---

## Objective

Add a `blocked` value to `TeammateInfo.status` (Nimbalyst's "Teammates" sub-agent system) and set/
clear it correctly when a teammate's own permission/prompt request is pending, so the architect can
see — per teammate — which one is actually waiting on them instead of every teammate showing the
same "running" spinner. This closes half of requirement R1/R2 (Teammates' half; Task sub-agents'
half is task 1b) and is a prerequisite for the normalized `SubAgentStatus` mapping (task 2a) and the
chip row (task 2b) built on top of it.

---

## Context

**Parent Feature:** Agent Visibility and Workflow Enhancement (PRD `agent-visibility`, GitHub
feature issue TBD)

Nimbalyst has three separate "spawned agent" systems, each with its own status vocabulary: Nimbalyst
"Teammates" (`TeammateInfo`, own `query()` per teammate via `TeammateManager`), SDK-native Task
sub-agents (`TaskInfo`, in-process, never persisted as their own `ai_sessions` row — task 1b), and
Meta-Agent Mode child sessions (real, independent `ai_sessions` rows, out of scope for this task).
This PRD closes a gap against native Claude Code's sub-agent visibility, verified against tracker
item `tsk_mt1xxymgata1sw`: today, a teammate that hits a permission prompt shows no distinct signal
— it keeps the same "running" spinner as a teammate that's actively working
(`TeammatePanel.tsx:343-345`), and the architect only discovers the block by manually scrolling.

`TeammateInfo.status` today has four values — `'running' | 'completed' | 'errored' | 'idle'`
(declared at `packages/electron/src/renderer/components/AgentMode/TeammatePanel.tsx:30`, inside the
`TeammateInfo` interface at lines 25-35). Unlike Task sub-agents (task 1b), Teammates already have a
clean, proven attribution path: the lead's `sessionId` is passed explicitly into
`createCanUseToolHandler(sessionId, cwd, permissionsPath, name)` at `TeammateManager.ts:1465`, so a
teammate's permission request is already correctly routed and rendered under the lead session. This
task does not need to build new routing — it needs to observe the pending/resolved lifecycle of an
*already-routed* request and translate it into a status transition (see Research Context below for
exactly where that lifecycle is observable).

This task is part of **Wave 1** — the foundation wave. It has no upstream dependencies and runs in
parallel with task 1b (which does the equivalent work for `TaskInfo.status`). Task 2a (build the
normalized `SubAgentStatus` mapping) and task 3a (guaranteed error/crash notification) both depend
on this task completing.

---

## Research Context

PRD `agent-visibility` has approved research findings
(`.nimble/prds/001_agent-visibility/research/findings.md`), reproduced/extended here with additional
investigation performed for this brief (see "Investigation Findings" below — this goes beyond what
the PRD/tasks.yaml already state and should materially de-risk the task).

### Patterns to Follow

- **`scheduleEmitTeammateUpdate` / `emitTeammateUpdate`** — `TeammateManager.ts:1068-1096` (debounced
  wrapper, 100ms via `TeammateManager.EMIT_DEBOUNCE_MS`) and `TeammateManager.ts:1119-1207` (the
  actual write: merges a `Map<agentId, status>` of overrides into `session.metadata.currentTeammates`
  and emits `message:logged` so the renderer reloads). This is the *only* write path for
  `TeammateInfo.status` — every existing transition (`handleStreamCompletion` →
  `completed`/`idle`, `handleStreamError` → `errored`) calls `this.scheduleEmitTeammateUpdate(...)`,
  never the raw `emitTeammateUpdate` directly. Follow this exactly for the new blocked/unblocked
  transition — do not invent a second write path or bypass the debounce.
- **Local type duplication — the four-value union is hardcoded in *four* separate places in
  `TeammateManager.ts` alone, not one.** None of them import from `TeammatePanel.tsx`'s
  `TeammateInfo` type:
  1. `pendingStatusOverrides` field type, `TeammateManager.ts:127`.
  2. `scheduleEmitTeammateUpdate`'s `statusOverrides` parameter type, `TeammateManager.ts:1070`.
  3. `emitTeammateUpdate`'s `statusOverrides` parameter type, `TeammateManager.ts:1121`.
  4. `emitTeammateUpdate`'s inline `existingTeammates` array element type, `TeammateManager.ts:1137`.
  You must add `'blocked'` to **all five** locations (these four, plus `TeammatePanel.tsx:30` itself)
  for TypeScript to accept passing `'blocked'` through the override path without a cast. If you find
  a shared type definition during implementation that supersedes this duplication, fixing that
  duplication is out of scope here — just keep all five in sync as they are today.
- **`packages/electron/src/renderer/store/atoms/agentMode.ts` likely needs no functional edit.** It
  only imports the type (`import type { TeammateInfo } from '../../components/AgentMode/TeammatePanel'`,
  line 25) and casts to it (`raw as TeammateInfo[]`, line 224) — it does not redeclare the status
  union. Once `TeammatePanel.tsx:30` is widened, `agentMode.ts` picks up the new value automatically
  through the import. Confirm this empirically (typecheck after your edit) rather than assuming it,
  but do not expect a real diff here beyond possibly nothing.

### Known Issues to Address

- `TeammatePanel.tsx`'s existing icon-rendering switch for a teammate row (lines 342-355) has cases
  for `running`/`idle`/`completed`/`errored` only — there is no case for `blocked`. A teammate in the
  `blocked` state will render with an **empty icon slot** in `TeammatePanel` until task 2a/2b add the
  normalized `SubAgentStatus` chip-coloring mapping. This is non-breaking (no crash, no TypeScript
  error — it's a JSX conditional chain, not an exhaustive switch) and explicitly out of scope for
  this task's success criteria, which cover the status field and its transitions only. Do not add ad
  hoc icon/color treatment here — that work belongs to tasks 2a/2b.

### Investigation Findings (read before implementing — this is the load-bearing part of this brief)

**The pending/resolved lifecycle of a teammate's permission request is already observable via two
existing events — you do not need to build new instrumentation into `ToolPermissionService`.**

1. `ToolPermissionService.requestToolPermission` (`packages/runtime/src/ai/server/permissions/ToolPermissionService.ts:344-374`)
   accepts an optional `teammateName?: string` (line 358) and, when a permission request actually
   needs a human decision (not auto-approved by trust/cache/pattern checks), emits
   `this.emit('toolPermission:pending', { requestId, sessionId, workspacePath, request, teammateName,
   timestamp })` at **lines 485-492** — `teammateName` is present on this payload today.
2. On resolution (approved, denied, or the request erroring/aborting), it emits
   `this.emit('toolPermission:resolved', { requestId, sessionId, response, timestamp })` at
   **lines 551-556** (success path) and again at **lines 561-566** (error/abort path). **Critically,
   `teammateName` is NOT included in the resolved payload** — only `requestId`, `sessionId`,
   `response`, `timestamp`. You must correlate resolution back to the correct teammate via
   `requestId`, captured at pending-time (e.g. a `Map<requestId, agentId>` you populate in your
   pending handler and consume/delete in your resolved handler).
3. **`ToolPermissionService.emit` is not its own independent event bus — it is
   `ClaudeCodeProvider.emit.bind(this)`, injected at construction.** At `ClaudeCodeProvider.ts:410-417`:
   ```
   this.permissionService = new ToolPermissionService({
     ...,
     emit: this.emit.bind(this),
   });
   ```
   `ClaudeCodeProvider extends BaseAgentProvider extends BaseAIProvider extends EventEmitter`
   (`packages/runtime/src/ai/server/providers/BaseAgentProvider.ts:31`,
   `packages/runtime/src/ai/server/AIProvider.ts:256`). So `toolPermission:pending`/
   `toolPermission:resolved` are actually emitted **on the `ClaudeCodeProvider` instance's own
   `EventEmitter`**, not on some internal service-scoped bus.
4. **This plumbing is already consumed today, proving the pattern works end-to-end — just not for
   teammate status.** `packages/electron/src/main/services/ai/MessageStreamingHandler.ts:1002` and
   `:1017` already do `this.installListener(provider, 'toolPermission:pending', onToolPermissionPending)`
   and the `:resolved` equivalent, to drive the top-level session's own "waiting for input" UI/sound/
   notification (lines 976-1017). This is the main-process consumer, external to both
   `TeammateManager` and `ClaudeCodeProvider`'s internals — it is not the right place to add the
   *teammate-status* hook (it has no access to `TeammateManager`'s `managedTeammates` map or
   `scheduleEmitTeammateUpdate`), but it is proof the event pair fires reliably for both lead-session
   and teammate permission requests today.

**Recommended approach (verify before committing to it):**

1. In `ClaudeCodeProvider.ts`'s constructor, immediately after `this.permissionService = new
   ToolPermissionService({...})` is assigned (after line 417), add two listeners on `this` (the
   provider's own `EventEmitter`):
   ```
   this.on('toolPermission:pending', (data: { requestId: string; sessionId: string; teammateName?: string }) => {
     if (data.teammateName) {
       this.teammateManager.markTeammatePermissionPending(data.sessionId, data.teammateName, data.requestId);
     }
   });
   this.on('toolPermission:resolved', (data: { requestId: string; sessionId: string }) => {
     this.teammateManager.markTeammatePermissionResolved(data.requestId);
   });
   ```
   (Method names are suggestions — pick names consistent with `TeammateManager`'s existing
   `handleStreamCompletion`/`handleStreamError` naming convention.)
2. Add `markTeammatePermissionPending(sessionId, teammateName, requestId)` and
   `markTeammatePermissionResolved(requestId)` (or your chosen names) as new public methods on
   `TeammateManager`. Implementation shape:
   - **Pending:** scan `this.managedTeammates` (`Map<agentId, ManagedTeammate>`) for an entry whose
     `.name === teammateName`. If found, record `agentId` in a new private
     `Map<requestId, agentId>` (e.g. `pendingPermissionRequests`), then call
     `this.scheduleEmitTeammateUpdate(sessionId, new Map([[agentId, 'blocked']]))`.
   - **Resolved:** look up `agentId = this.pendingPermissionRequests.get(requestId)`; if present,
     delete the map entry, then — **only if `this.managedTeammates.has(agentId)` is still true** (see
     Edge Cases below) — call `this.scheduleEmitTeammateUpdate(sessionId, new Map([[agentId,
     'running']]))`. If the teammate is no longer in `managedTeammates`, do nothing; its terminal
     status was already set by `handleStreamCompletion`/`handleStreamError`.
3. Do not modify `ToolPermissionService.ts`'s routing/decision logic at all — it already emits
   everything this task needs. This satisfies the task's own constraint ("Do not touch
   ToolPermissionService's core routing logic — only add the status-transition hook").

**Gotcha — the `teammateName` → `agentId` correlation is a name match, not an ID match, and is
theoretically ambiguous.** `createCanUseToolHandler(sessionId, cwd, permissionsPath, name)`
(`TeammateManager.ts:1465`) passes only the plain teammate `name` (the local variable from
`spawnTeammate`), not the composite `agentId` (`"name@teamName"`) and not `teamName` itself. If two
teammates in *different* teams are simultaneously active in the same lead session and happen to
share the same display name, a name-based scan of `managedTeammates` cannot disambiguate them with
the information `canUseToolHandler` currently receives. This is a pre-existing limitation of the
`teammateName` parameter's shape, not something introduced by this task — do not attempt to widen
`createCanUseToolHandler`'s signature to also pass `agentId`/`teamName` to fix it (that touches
`ClaudeCodeProvider.ts`'s `createCanUseToolHandler` signature and its one other call site for the
lead's own permission routing — larger blast radius than this task's scope). If your pending-time
scan matches more than one managed teammate by name, fail safe: do not guess, do not mark any
teammate blocked for that ambiguous case, and log a warning. Note this as a known limitation in your
test coverage rather than working around it.

**Gotcha — the inline fallback permission path never carries `teammateName` at all.**
`handleToolPermissionFallback` (`ClaudeCodeProvider.ts:3767-3796`, backed by
`packages/runtime/src/ai/server/providers/claudeCode/toolAuthorization.ts:156-320`) is used only when
`this.permissionService` is not configured (missing `trustChecker`/pattern saver/checker
dependencies — not the normal production path, but used in some test harnesses). Its own
`toolPermission:pending`/`:resolved` emits (`toolAuthorization.ts:249`, `:289`, `:305`) never include
`teammateName` — the parameter isn't threaded into `handleToolPermissionFallback` at all
(`ClaudeCodeProvider.ts:3767-3773`; compare to `handleToolPermissionWithService`'s signature at
`:3739-3746`, which does receive it). A teammate's permission request that takes this fallback path
will never trigger the blocked transition. This is a known, accepted gap for this task — do not
expand scope to thread `teammateName` through the fallback path; the production path
(`handleToolPermissionWithService`) is what's covered.

### Recommended Approach

- No new library dependency. This is entirely internal wiring across `TeammateManager.ts` and (per
  the Investigation Findings above) a small addition to `ClaudeCodeProvider.ts`'s constructor.
- Do not build a second, parallel status-write mechanism — everything for `TeammateInfo.status` goes
  through `scheduleEmitTeammateUpdate`/`emitTeammateUpdate` (see Patterns to Follow above).

### Dependencies

**File Dependencies:**
- None from other tasks — 1a has `depends_on: []`. Tasks 2a (normalized `SubAgentStatus` mapping) and
  3a (guaranteed error/crash notification) depend on this task's output (the `blocked` value existing
  on `TeammateInfo.status`), not the other way around.

**Library Dependencies:**
- None new.

---

## Requirements

Fulfills PRD requirement **R1**: *"Add `blocked` status to `TeammateInfo.status`
(`packages/electron/src/renderer/components/AgentMode/TeammatePanel.tsx:30`, values today
`'running'|'completed'|'errored'|'idle'`), set when the teammate's permission/prompt request is
pending via `createCanUseToolHandler` routing in `TeammateManager.ts:1465`."*

Concretely:

1. Add `'blocked'` to the `TeammateInfo.status` union at `TeammatePanel.tsx:30`, and to the four
   duplicated inline unions inside `TeammateManager.ts` listed under "Patterns to Follow" above
   (lines 127, 1070, 1121, 1137). Do not touch any other status value.
2. Wire the existing `toolPermission:pending`/`toolPermission:resolved` events (see Investigation
   Findings) so that when a *teammate's* permission request becomes pending, that teammate's status
   transitions to `blocked`; when it resolves (approved, denied, or cancelled/aborted), it transitions
   back to `running` — unless the teammate has since gone terminal (completed/errored) via a race, in
   which case do not overwrite the terminal status (see Edge Cases).
3. Do not change any other `TeammateInfo`/teammate-lifecycle status-transition logic
   (`handleStreamCompletion`, `handleStreamError`, `TeammateManager.ts:1214-1290`) beyond what's
   needed to add the `blocked` value to the shared type unions.
4. Do not modify `ToolPermissionService.ts`'s routing/decision logic — only observe its already-
   emitted `toolPermission:pending`/`toolPermission:resolved` events.

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] `blocked` is a valid value of `TeammateInfo.status` alongside the existing four values
- [ ] Status transitions to `blocked` when a teammate's permission/prompt request becomes pending
- [ ] Status transitions away from `blocked` correctly once the prompt resolves (approved, denied, or
      cancelled)
- [ ] Existing running/completed/errored/idle transitions are unaffected (regression-safe)
- [ ] Unit test covers both the blocked-entry and blocked-exit transitions
- [ ] Unit test covers the race case: prompt resolves after the teammate has already gone terminal —
      status is not overwritten back to `running`
- [ ] Unit test covers the safe-failure case: no managed teammate matches the pending event's
      `teammateName` (or more than one matches) — no status is incorrectly set

**All criteria must pass before task is complete.**

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/electron/src/renderer/components/AgentMode/TeammatePanel.tsx` | modify | Add `'blocked'` to the `TeammateInfo.status` union (line 30) |
| `packages/runtime/src/ai/server/providers/TeammateManager.ts` | modify | Add `'blocked'` to the four duplicated inline status unions (lines 127, 1070, 1121, 1137); add `markTeammatePermissionPending`/`markTeammatePermissionResolved` (or equivalently named) methods that call `scheduleEmitTeammateUpdate` |
| `packages/runtime/src/ai/server/providers/ClaudeCodeProvider.ts` | modify (likely required — see Investigation Findings) | Wire two `this.on('toolPermission:pending' \| 'toolPermission:resolved', ...)` listeners in the constructor (after `this.permissionService` is assigned, ~line 417) forwarding to the new `TeammateManager` methods. Not in the task's originally-declared `files_affected` list in `tasks.yaml`; flagged here because the pending/resolved lifecycle is only observable at this level (see Investigation Findings for why `TeammateManager.ts:1465` alone cannot see it) |
| `packages/electron/src/renderer/store/atoms/agentMode.ts` | modify (likely no-op) | Listed in `tasks.yaml`'s `files_affected`, but only imports/casts the `TeammateInfo` type (lines 25, 224) — expect no real diff here; confirm via typecheck rather than editing speculatively |

### File Ownership Notes

- **New, previously-undocumented overlap with task 1b on `ClaudeCodeProvider.ts`.** `dependencies.md`'s
  "Known File Overlaps" table only lists a `ClaudeCodeProvider.ts` overlap between tasks 1b and 4a —
  it does not mention 1a, because 1a's `files_affected` in `tasks.yaml` did not originally include
  this file. Per the Investigation Findings above, 1a likely needs a small constructor-only edit here
  (two `.on(...)` listener registrations, ~line 417). **1a and 1b run in the same wave (wave 1) with
  no `depends_on` between them** — both may be in separate worktrees editing this file concurrently.
  Keep your edit minimal and localized to the constructor region (after `this.permissionService =
  ...`, before the closing of the constructor); this is textually distant from 1b's edits (the
  `canUseTool`/`case 'tool_use':` handling around lines 1362-1404 and 3648-3760), so a git conflict is
  unlikely but not impossible — rebase carefully and re-run typecheck after merging with 1b's branch.
- `TeammateManager.ts` is also touched by task **3a** (`depends_on: ["1a"]` — sequenced after this
  task specifically). 3a's edits target the "all completed" emit sites
  (`handleStreamCompletion`/`handleStreamError`, lines 1264-1289 in the pre-1a file). Add your new
  `markTeammatePermissionPending`/`markTeammatePermissionResolved` methods near the existing "UI sync"
  section (`scheduleEmitTeammateUpdate`/`emitTeammateUpdate`, lines 1062-1207) rather than inside or
  adjacent to `handleStreamCompletion`/`handleStreamError`, to keep your diff and 3a's diff in
  different regions of the file.
- `TeammatePanel.tsx` is also touched by tasks **2b** and **2c** later (chip row, click-to-thread).
  Per this PRD's own dependency chain (2b depends on 2a which depends on 1a; 2c depends on 2b), those
  run strictly after this task — no real conflict, just sequential.
- `agentMode.ts` is also touched by task **1b** (`TaskInfo`-related work). Per 1b's own brief, there
  is no real overlap between 1a and 1b on this file — 1a is expected to make no functional change to
  it at all (see Files to Modify above).

---

## Implementation Guidance

### Patterns to Follow

See "Research Context" above — `scheduleEmitTeammateUpdate`/`emitTeammateUpdate` is the single write
path for `TeammateInfo.status`; the `toolPermission:pending`/`toolPermission:resolved` event pair
(already emitted by `ToolPermissionService`, already consumed by `MessageStreamingHandler.ts` for the
lead session's own UI) is the existing, proven pattern for observing a permission request's
lifecycle — reuse it rather than adding new instrumentation to `ToolPermissionService`.

### Code Style

Match existing style in `TeammateManager.ts` — plain `Map`s for per-entity tracking (see
`managedTeammates`, `idleTeammates`, `completedTeammates`), `console.log`/`console.warn`/`console.error`
with a `[MANAGED-TEAMMATE]` prefix for diagnostic logging (see e.g. lines 1230, 1238, 1245, 1282), and
private methods grouped under a `// ─── Section ──` comment banner matching the existing "UI sync"
section.

### Edge Cases

- **A teammate's permission prompt resolves after the teammate itself has already gone terminal**
  (completed via approved shutdown, went idle, or errored — `handleStreamCompletion`/
  `handleStreamError` both call `this.managedTeammates.delete(agentId)` before scheduling their own
  status override). Do not overwrite a terminal status back to `running` when clearing `blocked` —
  only clear to `running` if `this.managedTeammates.has(agentId)` is still true at resolution time;
  if the teammate is no longer managed, leave its already-set terminal status alone.
- **The `teammateName` → `agentId` name-match is ambiguous or has no match** (see the "Gotcha" in
  Investigation Findings). Do not attribute to the wrong teammate or set a global flag — fail safe by
  not setting any teammate to `blocked` in this case, and cover it in your test suite as the
  documented safe-failure path (mirrors the equivalent safe-failure requirement in sibling task 1b).
- **Two teammates hit permission prompts near-simultaneously.** Your `pendingPermissionRequests` map
  and `managedTeammates` lookup must handle both being `blocked` at once, independently clearable by
  their own `requestId`.
- **The permission request takes the fallback path** (`handleToolPermissionFallback`, no
  `teammateName` threaded — see Investigation Findings). No blocked transition fires; this is an
  accepted, documented gap for this task, not a bug to fix here.

### Testing Requirements

- No existing test file references `TeammateManager` anywhere in the repo today (verified by search)
  — you are creating the first one. Recommended location:
  `packages/runtime/src/ai/server/providers/__tests__/TeammateManager.test.ts`, matching the sibling
  `__tests__` directory's existing naming convention for other providers/services in this folder.
- `TeammateManager` takes all its host dependencies via a single constructor-injected
  `TeammateManagerDeps` object (`TeammateManager.ts:72-88`) — no `internals()`-style casting trick is
  needed to construct it (unlike `ClaudeCodeProvider`, which several sibling test files in this
  directory use that pattern for). Construct it directly with fake/stub deps
  (`emit: vi.fn()`, `logNonBlocking: vi.fn()`, etc.), then use `as any`/bracket-notation to seed
  private state (`managedTeammates`, `idleTeammates`) and to call your new
  `markTeammatePermissionPending`/`markTeammatePermissionResolved` methods (these should be `public`
  so they don't need the cast).
- Cover, at minimum: (1) pending sets the matching teammate's status to `blocked` and calls
  `scheduleEmitTeammateUpdate` (assert via the injected `emit` stub or by inspecting
  `pendingStatusOverrides`/timer behavior); (2) resolved after pending clears back to `running`;
  (3) resolved for a teammate no longer in `managedTeammates` does not resurrect its status;
  (4) no-match/ambiguous-match `teammateName` is a safe no-op; (5) existing
  `handleStreamCompletion`/`handleStreamError` transitions (`completed`, `idle`, `errored`) are
  unregressed by your type-union changes.
- Since the `ClaudeCodeProvider.ts` constructor wiring is thin integration glue, add or extend a
  lightweight test in `ClaudeCodeProvider.permissionChange.test.ts` (existing file in the same
  `__tests__` directory, already covering permission-adjacent behavior on this provider — see 1b's
  brief for the same pointer) confirming the provider actually invokes
  `teammateManager.markTeammatePermissionPending`/`markTeammatePermissionResolved` when it emits
  `toolPermission:pending`/`:resolved` with a `teammateName` present. The core transition logic itself
  should be tested in `TeammateManager.test.ts`, not duplicated here.

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
  (`packages/electron/src/renderer/components/MetaAgentMode/MetaAgentMode.tsx:67-104`) into anything
  this task touches — explicitly out of scope.
- Do not modify `packages/electron/src/main/services/ai/claudeCliSubAgentTracker.ts`'s
  transcript-hiding logic — unrelated to this task, but listed as a global "do not touch" for this
  PRD; if you find yourself anywhere near it, stop and re-check scope.
- Do not touch `ToolPermissionService.ts`'s core routing/decision logic (trust checks, pattern
  caching, the `requestToolPermission` decision flow itself) — only observe its already-emitted
  `toolPermission:pending`/`toolPermission:resolved` events from outside the class.
- Do not touch `TeammateManager.ts:1264-1289`/`:1740-1757` (the `teammates:allCompleted` emit sites)
  — that is task 3a's scope, sequenced after this task.

### Files Requiring Review

None of this task's files (`TeammatePanel.tsx`, `TeammateManager.ts`, `ClaudeCodeProvider.ts`,
`agentMode.ts`) are in `.nimble/config.yaml`'s `require_review` list. This task does not trigger the
PRD's human-review gate on its own (only task 5a, via `CHANGELOG.md`, does — see Dependencies below).

---

## Dependencies

### Upstream Tasks

None — task 1a has `depends_on: []` and can start immediately.

### Downstream Impact

Tasks that depend on this one:

| Task | What it needs from 1a | Why |
|------|------------------------|-----|
| 2a | `blocked` value present on `TeammateInfo.status` | Builds the normalized `SubAgentStatus` mapping across both `TeammateInfo.status` (from this task) and `TaskInfo.status` (from 1b); its exhaustiveness test needs `blocked` to already exist on both source enums. |
| 3a | This task's `blocked`/error status signal exists as prior art | Wires `showBlockedNotification` into `TeammateManager`'s error/crash paths; depends on 1a per `dependencies.md`, primarily for sequencing on `TeammateManager.ts` and to build on the status vocabulary this task establishes. |

**Before starting:** No upstream dependency to verify — this task starts from the current state of
`main`/the feature branch with no prior task's output required.

---

## GitHub Context

**Issue:** TBD — created by PM agent at execution start
**Feature Issue (Parent):** TBD — created by PM agent at execution start
**Branch:** `worktree/agent-visibility-1a`
**Target:** Determined by PM agent based on execution mode (feature branch or main)

---

## Commit Guidelines

Use Conventional Commits:
```
feat(agent-mode): add blocked status to TeammateInfo for teammate permission prompts

Co-Authored-By: Claude <noreply@anthropic.com>
```

Types: feat, fix, refactor, test, docs, chore

---

## Deliverables

None beyond the files above. The status-field addition, the pending/resolved wiring, and their unit
tests are the only artifacts this task produces (per PRD `tasks.yaml`'s `deliverables_note` for task
1a: "Nothing beyond the code — the status field addition and its unit test are the only artifacts.").

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
*PRD: agent-visibility | Task: 1a | Wave: 1*
