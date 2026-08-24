# Task Brief: 3a

**Title:** Guarantee distinct notification on Teammate error/crash
**PRD:** agent-visibility
**Priority:** must
**Complexity:** 6/10
**Model:** opus
**Wave:** 3
**Feature Issue:** Not yet created — tracker publish is pending (`.nimble/prds/001_agent-visibility/status.json` → `tracker.publish_error`: "No document service available to change Draft/Published state"). Reference the PRD file directly: `.nimble/prds/001_agent-visibility/PRD_agent-visibility.md`.

---

## Objective

A Nimbalyst Teammate that crashes, errors, or is silently abandoned while idle currently produces the **exact same UX as a clean, successful finish** — the same `teammates:allCompleted` event, the same completion chime, no error-specific signal at all. This task wires the existing `notificationService.showBlockedNotification` primitive (or an equivalent distinct signal) into every path that can lead to that event so an errored/crashed/abandoned teammate is never indistinguishable from success. This fulfills requirement **R7** from the PRD.

---

## Context

**Parent Feature:** Agent Visibility and Workflow Enhancement (PRD `agent-visibility`, `.nimble/prds/001_agent-visibility/PRD_agent-visibility.md`). No GitHub feature issue exists yet for this PRD — do not block on one; reference the PRD file above for full context if needed.

Nimbalyst has three separate "spawned agent" systems (SDK-native Task sub-agents, Nimbalyst Teammates, Meta-Agent Mode child sessions). This PRD closes a tracker-verified gap (`tsk_mt1xxymgata1sw`) between Nimbalyst's sub-agent visibility and native Claude Code's sub-agent UX. One of the five gaps: **there is no guaranteed main-thread notification when a sub-agent dies, ends unexpectedly, or blocks.** Task 3a closes this specifically for Teammates (the "Nimbalyst Teams" spawn system, `TeammateManager`); a sibling task (3b, depends on this one) extends the same pattern to Meta-Agent Mode.

This task is part of **Wave 3** of a 7-wave execution plan. Wave 3 runs in parallel with task `2a` (normalized `SubAgentStatus` mapping) — neither touches overlapping files, so no coordination is required between them. (Task `4a`, concurrent Task sub-agent stall masking fix, now runs earlier, in wave 2, per the Phase-2 brief review correction that serialized 1a after 1b.) Three tasks depend on this one completing first: `3b` (Meta-Agent notification extension), `4b` (Teammate stream-stall watchdog — needs this task's notification wiring to call into), and `4c` (`onTeammateMessageWhileIdle` silent-drop fallback — needs the same distinct-signal primitive this task establishes).

### Precondition: what task 1a provides (already merged before this task starts)

This task `depends_on: ["1a"]`. Task 1a adds a `blocked` value to `TeammateInfo.status`
(`packages/electron/src/renderer/components/AgentMode/TeammatePanel.tsx:30`, declared there — not
in `agentMode.ts`, which only imports the type), set when a teammate's permission/prompt request
becomes pending via the existing `createCanUseToolHandler` routing at `TeammateManager.ts:1465`,
and cleared once the prompt resolves.

**Before starting, verify 1a actually landed:**
- `TeammateInfo['status']` in `TeammatePanel.tsx` includes `'blocked'` alongside
  `'running'|'completed'|'errored'|'idle'`.
- A unit test exists covering the blocked-entry/blocked-exit transition (1a's own success
  criteria required this).

This task does **not** consume the `blocked` value directly — R7's scope is the
error/crash/abandon path (`'errored'`/silent-death), not the permission-pending path. The
dependency exists because 1a is the first task to touch `TeammateManager.ts`'s status-emission
surface, and this task's own agent_context (from the PRD) explicitly calls out: **do not touch
1a's status-transition hook** — this task only adds notification calls alongside the existing
`teammates:allCompleted` emit sites, it does not change what triggers the emit or how status is
set.

---

## Requirements

Wire `notificationService.showBlockedNotification` (or an equivalent distinct signal) into **every**
`teammates:allCompleted` emit site in
`packages/runtime/src/ai/server/providers/TeammateManager.ts` — confirmed via source read, there
are exactly five:

| Line | Context | Trigger |
| --- | --- | --- |
| `TeammateManager.ts:205` | `abandonIdleTeammates()` | Lead's transport died; idle teammates can no longer be resumed — silently marked `completed`, no error thrown. **This is the "silent abandon" case** — indistinguishable today from a clean finish. |
| `TeammateManager.ts:1265` | end of `handleStreamCompletion()` (non-background branch, after `markCompleted`) | Normal per-teammate completion path — but this same emit fires whether the *last* teammate finished cleanly or not; the emit itself carries no clean/error signal. |
| `TeammateManager.ts:1288` | end of `handleStreamError()` | A teammate's stream threw — genuine error/crash. `handleStreamError` already logs `"errored"` and calls `scheduleEmitTeammateUpdate(sessionId, new Map([[agentId, 'errored']]))` before this emit — this is the clearest signal to distinguish on. |
| `TeammateManager.ts:1740` | inside the background-agent completion path (mirrors 1265) | Same completion-vs-error ambiguity as 1265, for background/sub-agent-spawned teammates. |
| `TeammateManager.ts:1757` | inside the background-agent error path (mirrors 1288) | Same error signal as 1288, for background/sub-agent-spawned teammates. |

Also wire `MessageStreamingHandler.onTeammatesAllCompleted`
(`packages/electron/src/main/services/ai/MessageStreamingHandler.ts:1111-1137`), which today
unconditionally calls `SoundNotificationService.getInstance().playCompletionSound(workspacePath)`
(line 1134) — the **same success chime** regardless of why `teammates:allCompleted` fired.

**The two files must agree on how "this was an error/abandon, not success" is communicated.** The
emit payload today is `{ sessionId: string }` only (`this.deps.emit('teammates:allCompleted', {
sessionId })`) — you will need to extend this payload (e.g. add an `outcome: 'clean' | 'errored' |
'abandoned'` field, or a `hadErrors: boolean` flag) so `MessageStreamingHandler` can branch on it
without re-deriving state. Design the payload shape yourself; there is no existing precedent to
copy for this specific signal — `TeammateManager` already tracks per-agent outcome via
`scheduleEmitTeammateUpdate`'s status map (`'completed'` vs `'errored'`), so the emit site has the
information available at the point it fires.

### NotificationService.ts requires an actual extension, not just a call site

Read `packages/electron/src/main/services/NotificationService.ts` before assuming
`showBlockedNotification` can be called as-is. Its signature is:

```typescript
async showBlockedNotification(
  sessionId: string,
  sessionName: string,
  blockingType: BlockingType,
  workspacePath: string
): Promise<void>
```

`BlockingType` (line 79) is `'permission' | 'question' | 'plan_approval' | 'git_commit'` — **none
of these fit "a teammate errored or was silently abandoned."** `getBlockedTitle`/`getBlockedBody`
(lines 561-601) switch on `BlockingType` with a `default` fallback ("Session Needs Attention" /
`"${sessionName}" needs your input`), so calling `showBlockedNotification` with an existing value
would produce a misleading title/body for a crash. You have two viable approaches — pick one and
be consistent:

1. **Add a new `BlockingType` value** (e.g. `'teammate_error'`) with its own title/body case, and
   a matching `NotificationKind` in `packages/electron/src/main/services/notificationIcons.ts`
   (current kinds: `'agent-complete' | 'agent-question' | 'needs-input' | 'teams-message'` — none
   fit "error/crash" either; adding a new kind needs matching icon assets under
   `resources/notifications/`, verify what exists before assuming an icon is available).
2. **Add a new dedicated method** (e.g. `showTeammateErrorNotification(sessionId, sessionName,
   workspacePath, reason)`) that calls the lower-level `showNotification`/`showNotificationWithResult`
   directly (same pattern `showBlockedNotification` itself uses internally, lines 618-626) with its
   own title/body, reusing an existing `NotificationKind` (`'needs-input'` is the closest semantic
   fit if you don't want to add new icon assets).

Whichever you choose, it must respect `isSessionBlockedNotificationsEnabled()` (the existing gate
`showBlockedNotification` checks at line 614) so the notification honors the user's existing
settings toggle rather than bypassing it.

Fulfills requirement **R7**.

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] A teammate that errors (reaches `handleStreamError`) triggers `showBlockedNotification` (or the equivalent distinct signal built per the guidance above), not the success completion sound
- [ ] A teammate that crashes without an explicit thrown error — the silent-abandon path in `abandonIdleTeammates()` (`TeammateManager.ts:205`) — also triggers the distinct notification
- [ ] Regression test proves a clean multi-teammate run still plays the existing unchanged success sound (`SoundNotificationService.playCompletionSound`)
- [ ] Every `teammates:allCompleted` emit site (`TeammateManager.ts:205, 1265, 1288, 1740, 1757`) distinguishes clean finish from error/abandon — not just the two originally cited in the PRD narrative (1265/1288)

**All criteria must pass before task is complete.**

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/runtime/src/ai/server/providers/TeammateManager.ts` | modify | Extend the `teammates:allCompleted` emit payload at all 5 sites (lines 205, 1265, 1288, 1740, 1757) with an outcome signal (e.g. `outcome`/`hadErrors`) so downstream consumers can distinguish clean finish from error/abandon. |
| `packages/electron/src/main/services/ai/MessageStreamingHandler.ts` | modify | In `onTeammatesAllCompleted` (lines 1111-1137), branch on the new outcome signal: call the distinct-error notification instead of (or in addition to, per your design) `SoundNotificationService.playCompletionSound` when the outcome is error/abandon. |
| `packages/electron/src/main/services/NotificationService.ts` | modify | Add either a new `BlockingType` value + title/body cases, or a new dedicated `showTeammateErrorNotification`-style method — see "NotificationService.ts requires an actual extension" above. |
| `packages/electron/src/main/services/notificationIcons.ts` | modify (only if you add a new `NotificationKind`) | Add a new icon kind for teammate error/crash, if you choose approach 1 above rather than reusing `'needs-input'`. |

### File Ownership Notes

- **`TeammateManager.ts`** is also touched by task `1a` (upstream — already landed, adds the
  `blocked` status-transition hook at a different location, `TeammateManager.ts:1465`) and task
  `4b` (downstream, depends on this task — adds a stream-stall watchdog to the same spawn loop).
  Do not touch 1a's status-transition hook (`createCanUseToolHandler` routing) or
  `handleStreamCompletion`/`handleStreamError`'s existing status-map logic (`scheduleEmitTeammateUpdate`
  calls) beyond adding the outcome field to the emit payload — those are 1a's and pre-existing
  logic respectively, not yours to restructure.
- **`MessageStreamingHandler.ts`** is also touched by task `4c` (downstream, depends on this task —
  adds a missing `else` branch to a *different* handler, `onTeammateMessageWhileIdle`,
  lines 1054-1106). Do not modify `onTeammateMessageWhileIdle` in this task; that is 4c's scope.
- **`NotificationService.ts`** is also touched by task `3b` (downstream, depends on this task —
  reuses whatever notification mechanism you build here for Meta-Agent Mode's `pendingPrompt`
  detection). Whatever primitive/method you add must be reusable by 3b without a second bespoke
  mechanism — keep the new method/BlockingType general enough to accept a different `sessionName`/
  `workspacePath` context, not hardcoded to teammate-specific wording beyond the title/body text
  itself.

---

## Implementation Guidance

### Patterns to Follow

- **Write the regression test FIRST.** Per `.claude/rules/end-to-end-verification.md`: reproduce
  the current bug (a crashing/abandoned teammate produces identical UX to success) as a failing
  test, then make the fix flip it green. Do not declare this task done on "the code path looks
  right" — this is exactly the class of bug that rule exists to catch (main-process event wiring
  that "looks correct" but was never observed to actually diverge from the success path).
- **Existing `showBlockedNotification` call sites** to follow as pattern for how the primitive is
  invoked in this codebase: `packages/electron/src/main/mcp/tools/interactiveToolHandlers.ts:671,
  1070, 1548` and `MessageStreamingHandler.ts:899, 951, 995` — all top-level session
  permission/`AskUserQuestion` blocks. This task wires the same *class* of primitive into the
  sub-agent lifecycle; it does not invent a new notification system from scratch.
- **`isSessionBlockedNotificationsEnabled()`** (imported from `../utils/store` in
  `NotificationService.ts`) is the existing settings gate — respect it in whatever new method/path
  you add, matching `showBlockedNotification`'s own check at line 614.

### Code Style

- TypeScript throughout; match existing style in both files (no reformatting unrelated code).
- `TeammateManager.ts` uses `console.log`/`console.warn` for its `[MANAGED-TEAMMATE]`-tagged debug
  logging (e.g. line 1264: `` `[MANAGED-TEAMMATE] All teammates completed/errored, emitting
  teammates:allCompleted` ``) — match this convention if you add new log lines; do not switch to a
  different logger in this file.
- `MessageStreamingHandler.ts` uses `logger.main.info`/`logger.main.error` — match that convention
  there instead; the two files have different logging conventions, do not cross-pollinate them.

### Edge Cases

- **The "last teammate happens to be a clean finish, but an earlier teammate in the same batch
  errored" case.** `hasActiveTeammates()` gates all 5 emit sites — the emit only fires once *no*
  teammates remain active. If teammate A errors and teammate B (still running) later finishes
  cleanly, the emit fires from B's completion path (e.g. line 1265), but A's error should still be
  surfaced. Your outcome signal needs to track "did *any* teammate in this batch error/abandon,"
  not just "did the specific teammate whose completion triggered this emit succeed." Consider
  tracking this at the `TeammateManager` instance/session level (a per-session "had an error this
  batch" flag, cleared when a fresh batch starts) rather than only inspecting the single call's
  local state.
- **`isBackground` teammates** (background/sub-agent-spawned) hit a parallel but separate code path
  (lines ~1740/1757 mirror ~1265/1288) — both must be covered; do not assume fixing the
  non-background pair is sufficient.
- **`isLeadBusy` deferral** in `onTeammatesAllCompleted` (`MessageStreamingHandler.ts:1119-1124`):
  if the lead is still processing, `endSession` and the sound/notification are deferred entirely —
  your new notification call must sit inside the same `if (isSessionActive) { ... }` block, after
  the `isLeadBusy` early-return, so it doesn't fire prematurely while the lead is still busy.

### Testing Requirements

- Regression test proving the **currently broken** behavior (crash → same success sound) fails
  before your fix and passes after — write this first.
- Test proving a **clean** multi-teammate run's success sound is unaffected (no false-positive
  error notification on a normal finish).
- Cover both the non-background (`handleStreamError`/`handleStreamCompletion`) and background-agent
  emit-site pairs.
- Cover the `abandonIdleTeammates()` silent-death path specifically — this is the one PRD callout
  ("crashes without an explicit thrown error") that has no existing error object to key off of.
- Run `npm run typecheck && npm run test:prepush` before pushing, per the repo's pre-push gate.

---

## Boundaries

### Files You MUST NOT Touch

Global `never_touch` list (`.nimble/config.yaml`):
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

Also, per this PRD's Agent Boundaries (§11):
- Do not modify `TeammateManager.ts:1465`'s `createCanUseToolHandler` routing or the `blocked`
  status-transition hook — that is task 1a's completed scope.
- Do not fold Meta-Agent Mode's independent `getStatusTone`/`getBarTone` status enum
  (`MetaAgentMode.tsx:67-104`) into anything you build here — out of scope, task 3b handles
  Meta-Agent's notification gap separately with its own implementation anchor
  (`MetaAgentService.ts`).

### Files Requiring Review

None of this task's files are in `.nimble/config.yaml`'s `require_review` list
(`packages/runtime/src/auth/*`, `packages/electron/src/main/database/*`,
`packages/electron/src/main/index.ts`, `packages/electron/src/main/bootstrap.ts`,
`packages/electron/src/main/utils/protocolRegistration.ts`, `CHANGELOG.md`,
`packages/collab-protocol/*`, `packages/collab-client/*`, `packages/collab-bundle/*`,
`packages/collab-adapters/*`). This task does not require the human-review gate on its own — the
PRD's single review gate is after wave 6, triggered by task `5a` touching `CHANGELOG.md`.

---

## Dependencies

### Upstream Tasks

| Task | What It Provides | Verify Before Starting |
|------|------------------|------------------------|
| 1a | `blocked` value added to `TeammateInfo.status` (`TeammatePanel.tsx:30`), set/cleared via `TeammateManager.ts:1465`'s permission-pending routing | Confirm `'blocked'` is present in `TeammateInfo['status']`'s type and 1a's unit test covering the transition exists. This task does not consume the `blocked` value directly, but shares `TeammateManager.ts` with it — verify 1a's diff has already landed to avoid a merge conflict on the same file. |

### Downstream Impact

Tasks that depend on this one:
- **3b** — Extends this task's exact notification pattern to Meta-Agent Mode's `pendingPrompt`
  detection (`MetaAgentService.ts`). It reuses whatever primitive/method you build in
  `NotificationService.ts` — keep it general enough for 3b to call with a different session
  name/context.
- **4b** — Adds a stream-stall watchdog to `TeammateManager.spawnTeammate`'s core loop
  (`TeammateManager.ts:1493`). It calls into the distinct-notification signal this task
  establishes when a stalled teammate transitions to `errored`, and shares `TeammateManager.ts`
  with this task (sequenced after to avoid file conflict).
- **4c** — Adds a missing `else` branch/fallback notification to `onTeammateMessageWhileIdle`
  (`MessageStreamingHandler.ts:1054-1106`, a different handler in the same file this task touches).
  Sequenced after this task to avoid file conflict, and likely reuses the same notification
  primitive you build here.

**Before starting:** Confirm task 1a's PR has merged (check `git log` on `TeammateManager.ts` for
1a's commit, or check `.nimble/prds/001_agent-visibility/status.json` for `tasks."1a".status`).

---

## GitHub Context

**Issue:** Not yet created (tracker publish pending — see `status.json`)
**Feature Issue (Parent):** Not yet created
**Branch:** `worktree/agent-visibility-3a`
**Target:** `feature/agent-visibility` (this PRD runs in `feature-branch` execution mode per `status.json` — merges go to the feature branch, not directly to `main`)

---

## Commit Guidelines

Use Conventional Commits:
```
fix(teammates): distinguish error/abandon notification from clean-finish sound
```

Types: feat, fix, refactor, test, docs, chore

Do not add `Co-Authored-By` lines (project convention, `CLAUDE.md`).

---

## Deliverables

None beyond the files above. Per `tasks.yaml`'s `deliverables_note` for this task: "the regression
test proving the fix is itself part of the code deliverable, not a separate artifact" — there is no
migration, fixture regeneration, or doc update required for this task.

---

## Validation Checklist

Before creating PR:
- [ ] All success criteria met
- [ ] Build passes: `npm run build`
- [ ] Type check passes: `npm run typecheck`
- [ ] Test suite passes: `npm run test:unit` (and `npm run test:prepush` before pushing, per the repo's pre-push hook)
- [ ] No `never_touch` files modified
- [ ] Regression test added proving the crash/abandon → distinct-notification behavior, and a second test proving the clean-finish sound is unregressed
- [ ] Branch rebased on `feature/agent-visibility` (this PRD's target, not `main`)
- [ ] CHANGELOG.md NOT touched by this task (that is task 5a's exclusive scope, gated for human review)

---

*Generated by NIMBLE Brief Writer*
*PRD: agent-visibility | Task: 3a | Wave: 3*
