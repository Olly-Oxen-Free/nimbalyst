# Task Brief: 3b

**Title:** Extend guaranteed notification to Meta-Agent Mode
**PRD:** agent-visibility
**Priority:** should
**Complexity:** 5/10
**Model:** opus
**Wave:** 4 (per `execution_plan.yaml` — depends on task 3a, wave 3)
**Feature Issue:** #{feature_issue_number} (see GitHub Context section — resolve at PR-creation time from the PM agent's tracking issue)

---

## Objective

Meta-Agent Mode already detects when a spawned child session is blocked on an interactive prompt
(`pendingPrompt`), but today that state is visible only as a dashboard label the architect happens
to be looking at. This task wires the same distinct main-thread notification pattern task 3a
establishes for Teammates into Meta-Agent Mode's child-session lifecycle, so a blocked Meta-Agent
child proactively notifies the architect — via OS notification — even when the Meta-Agent
dashboard isn't the focused view.

---

## Context

**Parent Feature:** [Agent Visibility and Workflow Enhancement](https://github.com/Olly-Oxen-Free/nimbalyst/issues/{feature_issue_number})

Nimbalyst has three separate "spawned agent" systems: SDK-native Task sub-agents, Nimbalyst
Teammates, and Meta-Agent Mode child sessions. This PRD closes a tracker-verified gap
(`tsk_mt1xxymgata1sw`) between Nimbalyst's sub-agent visibility and native Claude Code's sub-agent
UX. Of the five original asks, this task fulfills the "should have" extension of R7 (Must Have) —
**R8: guarantee a distinct main-thread notification whenever a sub-agent errors, crashes, or
blocks** — applied to Meta-Agent Mode specifically.

Meta-Agent Mode is architecturally different from the other two systems: unlike Task sub-agents
and Teammates (which are ephemeral, in-process, and the primary target of this PRD's chip-row/
status work), Meta-Agent child sessions are **real, independent `ai_sessions` rows** with their own
transcripts, tracked via `meta-agent:list-spawned-sessions` IPC and rendered in the
`MetaAgentMode.tsx` dashboard (a fixed right-hand `aside`, only visible in the dedicated Meta-Agent
Mode). Per this PRD's Non-Goals, Meta-Agent Mode's chip row and click-to-thread are **explicitly
out of scope** — it already has both (`MetaAgentMode.tsx:550-559` "Open In Agent",
`MetaAgentMode.tsx:538-542` the "Waiting for {promptType}" label). Only the **notification gap** —
the fact that `pendingPrompt` produces a passive dashboard label rather than a proactive OS
notification — is closed here.

This task is part of **Wave 4** (Milestone M3 — Guaranteed notification), alongside task 3a which
lands first and establishes the reusable distinct-notification pattern this task extends.

---

## Assumed Precondition: Output of Task 3a

**Task 3a ("Guarantee distinct notification on Teammate error/crash") is an upstream dependency of
this task and must be complete before you start.** Task 3a wires `notificationService
.showBlockedNotification` (the existing primitive, already used for top-level session permission/
`AskUserQuestion` blocks — see `interactiveToolHandlers.ts:671,1070,1548` and
`MessageStreamingHandler.ts:899,951,995` for the established call pattern) into every
`teammates:allCompleted` emit site in `TeammateManager.ts` (lines 205, 1265, 1288, 1740, 1757) and
into `MessageStreamingHandler.onTeammatesAllCompleted` (`:1109-1136`), so that a Teammate that
errors or is silently abandoned while idle produces a distinct notification — not the same
completion chime a clean multi-teammate finish plays.

**What you can assume 3a produced, without re-reading its diff:**

1. The call signature and pattern for `notificationService.showBlockedNotification(sessionId,
   sessionName, blockingType, workspacePath)` is proven end-to-end for a sub-agent lifecycle event
   (not just the pre-existing top-level permission-prompt call sites) — reuse this exact primitive
   and call shape, do not invent a second notification mechanism.
2. A regression test exists proving a clean multi-teammate run still plays the unchanged
   success-completion sound — this task's own regression test (see Success Criteria) should follow
   the same "reproduce the bug as a failing test, then make the fix pass it" structure task 3a
   established, per `end-to-end-verification.md`.
3. 3a did **not** touch `MetaAgentService.ts` or `MetaAgentMode.tsx` — this task is the first to
   wire the notification pattern into the Meta-Agent child-session path; there is no Meta-Agent-
   specific code from 3a to build on beyond the shared `showBlockedNotification` primitive.

**Verify before starting:** Confirm `notificationService.showBlockedNotification` is now called
from at least one site inside `packages/runtime/src/ai/server/providers/TeammateManager.ts` and/or
`packages/electron/src/main/services/ai/MessageStreamingHandler.ts` (grep for
`showBlockedNotification` in those two files). If no such call site exists, task 3a is not actually
complete — stop and escalate rather than proceeding on a false precondition.

---

## Requirements

Fulfills **R8** (Should Have):

> Extend the R7 notification wiring to Meta-Agent Mode's `pendingPrompt` detection. The
> implementation anchor is `packages/electron/src/main/services/MetaAgentService.ts`, where
> `pendingPrompt` is actually produced — `MetaAgentMode.tsx:31-34` is only a renderer view-model
> type declaration and cannot fire a notification when the dashboard isn't mounted/focused.
> `MetaAgentMode.tsx:538-542` remains useful as the existing renderer *display* pattern to stay
> consistent with (for when the dashboard IS focused), not as the fix location.

### Where `pendingPrompt` is actually produced (read before editing)

`MetaAgentService.handleChildSessionEvent` (`MetaAgentService.ts:1195-1292`) is the real detection
site. It is invoked from `MetaAgentService.ts:298-299` whenever a child session's stream emits one
of four event types: `session:completed`, `session:error`, `session:waiting`, or
`session:interrupted`. **`session:waiting` is the event that corresponds to a child entering a
blocked/pending-prompt state** — when it fires, `handleChildSessionEvent` calls
`buildSessionResultData` (`:1248`) to build a `SessionResultData` object whose `pendingPrompt` field
(populated at `:1185` inside `getSpawnedSessions`/`buildSessionResultData`, and consumed for the
"ACTION REQUIRED" message text at `:1336-1366`) tells you exactly what prompt the child is blocked
on (`promptId`, `promptType`, and prompt-type-specific content).

Today, `handleChildSessionEvent` uses that `result.pendingPrompt` only to:
- build the `[Child Session Update]` message queued back to the **parent** (Meta-Agent) session via
  `this.aiService.queuePromptForSession` (`:1266-1278`) — this is agent-to-agent communication, not
  a user-facing notification, and must be preserved unchanged;
- conditionally create a plan-approval tracker item when `promptType === 'exit_plan_mode_request'`
  (`:1262-1264`).

Neither path produces an OS-level notification the architect would see outside the app. This task
adds that missing call.

### What to add

Inside `handleChildSessionEvent`, when `eventType === 'session:waiting'` (i.e. the child has
entered a pending-prompt/blocked state — confirm by checking `result.pendingPrompt` is non-null at
that point, since `session:waiting` should always coincide with a populated `pendingPrompt`, but
guard defensively rather than assuming), call `notificationService.showBlockedNotification` with
the child session's id, a human-readable title (use `result.title`, matching the pattern in
`buildNotificationMessage`'s `Session: "${result.title}"` line at `:1300`), an appropriate
`BlockingType`, and `session.workspacePath`.

`BlockingType` (declared `NotificationService.ts:79`) is
`'permission' | 'question' | 'plan_approval' | 'git_commit'`. Map `pendingPrompt.promptType` to it:

| `pendingPrompt.promptType` | `BlockingType` |
| --- | --- |
| `'permission_request'` | `'permission'` |
| `'ask_user_question_request'` | `'question'` |
| `'exit_plan_mode_request'` | `'plan_approval'` |
| (any other/future value) | fall back to `'question'` — do not silently no-op on an unmapped type; log it so a future promptType addition isn't invisible |

This mirrors the existing call pattern at `interactiveToolHandlers.ts:670-677`
(`notifyBlocked: ({ sessionId, workspacePath }) => { notificationService
.showBlockedNotification(sid, sessionTitle, "permission", wp ?? ""); ... }`) — same primitive, same
shape, different call site and blocking-type source.

### Respect the existing dedup gate

`handleChildSessionEvent` already computes a `notificationSignature`
(`computeNotificationSignature(eventType, result)`, `:1256`) and returns early if the signature
matches the last one delivered for that session (`:1257-1259`), specifically to avoid duplicate
`[Child Session Update]` prompts to the parent. Your new `showBlockedNotification` call should sit
**after** this existing dedup check (so it inherits the same "don't re-notify for an unchanged
state" guarantee) rather than before it or as a separate parallel signature scheme.

### Preserve the existing dashboard label

`MetaAgentMode.tsx:538-542` — the "Waiting for {promptType}" renderer label shown when the
dashboard is focused and a spawned session's `pendingPrompt` is set — must remain exactly as-is.
Do not replace it with, or make it dependent on, the new notification call; the two are
complementary (one is a passive in-dashboard label, the other is a proactive OS notification for
when the dashboard isn't focused). `MetaAgentMode.tsx:31-34` is only the `SpawnedSessionSummary`
type declaration (`pendingPrompt: { promptId: string; promptType: string } | null`) — you should
not need to change it; it is cited here only so you don't mistake it for the fix location.

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] A Meta-Agent child session entering `pendingPrompt` (i.e. its stream emits `session:waiting`)
      fires `showBlockedNotification` (or the exact signal established in task 3a) even when the
      Meta-Agent dashboard is not the focused view
- [ ] The existing "Waiting for {promptType}" dashboard label (`MetaAgentMode.tsx:538-542`) is
      preserved, not replaced or removed
- [ ] Regression test confirms normal Meta-Agent child-session completion (no pending prompt,
      `session:completed` with an empty queue) is unaffected — no spurious notification fires
- [ ] Regression test confirms the existing `[Child Session Update]` message delivery to the parent
      session (`this.aiService.queuePromptForSession`, `:1266-1278`) is unchanged for both the
      blocked and non-blocked paths
- [ ] `promptType` values other than the three currently-known ones (`permission_request`,
      `ask_user_question_request`, `exit_plan_mode_request`) do not silently fail to notify — either
      a sensible `BlockingType` fallback fires, or the gap is logged
- [ ] `notificationService.showBlockedNotification` is the only notification primitive used — no
      new/second notification mechanism is introduced for Meta-Agent Mode

**All criteria must pass before task is complete.**

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/electron/src/main/services/MetaAgentService.ts` | modify | Add the `showBlockedNotification` call inside `handleChildSessionEvent` when a child enters `session:waiting`/`pendingPrompt`, after the existing dedup-signature check |
| `packages/electron/src/renderer/components/MetaAgentMode/MetaAgentMode.tsx` | modify (minimal) | Only if needed to keep the `:538-542` display label consistent with any new type field — no new UI, no chip row, no click-to-thread work here |
| `packages/electron/src/main/services/NotificationService.ts` | modify (if needed) | Only if `BlockingType`'s existing four values (`permission`/`question`/`plan_approval`/`git_commit`) are insufficient for a `promptType` not yet covered — do not add new values speculatively; only if a real gap is hit while implementing |

### File Ownership Notes

`NotificationService.ts` is also touched by task 3a (sequential — 3b `depends_on` 3a, so 3a lands
first; no concurrent-edit risk). `MetaAgentService.ts` and `MetaAgentMode.tsx` are not touched by
any other task in this PRD — no file-overlap risk for this task's primary edit site.

---

## Implementation Guidance

### Patterns to Follow

- **Reuse, don't reinvent:** `notificationService.showBlockedNotification(sessionId, sessionName,
  blockingType, workspacePath)` — signature at `NotificationService.ts:607-627`. Call it the same
  way `interactiveToolHandlers.ts:670-677`'s `notifyBlocked` callback does.
- **Derived-signal pattern:** Task 3a establishes the "distinct notification, not the completion
  chime" pattern for Teammates. This task is the second, not the first, application of that
  pattern — treat 3a's call sites as the reference implementation for "how a sub-agent lifecycle
  event should trigger `showBlockedNotification`," adapted to Meta-Agent Mode's
  `handleChildSessionEvent` dispatch instead of `TeammateManager`'s emit sites.
- **Existing dedup infrastructure:** `computeNotificationSignature` (referenced at
  `MetaAgentService.ts:1256`) already exists to prevent duplicate `[Child Session Update]` prompts
  for an unchanged state — piggyback on it rather than building a second dedup mechanism for the OS
  notification.

### Code Style

- Follow `NAMING_CONVENTIONS.md`: this is main-process TypeScript, no wire-protocol/JSON
  camelCase-vs-snake_case concern here, but keep variable naming consistent with the surrounding
  `handleChildSessionEvent` code (`result`, `session`, `metaSession`, `signature`).
- No new IPC channel required — `showBlockedNotification` is a direct main-process service call,
  not IPC (main process calling main process).

### Edge Cases

- **`session:waiting` fires but `pendingPrompt` is somehow null** (defensive case — should not
  happen per the current data flow, but `handleChildSessionEvent` does not currently assert this).
  Guard with a null check; do not call `showBlockedNotification` with a null/undefined
  `blockingType` source — skip and log instead.
- **`isSessionBlockedNotificationsEnabled()`** — `showBlockedNotification` already checks this
  setting internally (`NotificationService.ts:613-616`) and no-ops if disabled. You do not need to
  duplicate this check at the call site; this also means "notifications are disabled in settings"
  is not a case your own logic needs to branch on.
- **`meta-agent` role session filtering:** `handleChildSessionEvent` already returns early if
  `session.agentRole === 'meta-agent'` (`:1202`) — this guards against a Meta-Agent session
  notifying about itself; do not remove or weaken this guard.
- **Workspace path availability:** `session.workspacePath` is already validated as required earlier
  in `handleChildSessionEvent` (`:1202`, part of the same early-return guard) — safe to pass
  directly to `showBlockedNotification`'s `workspacePath` parameter without an additional null
  check.

### Testing Requirements

Per `end-to-end-verification.md`, write the regression test **first**: reproduce the current gap
(a Meta-Agent child entering `pendingPrompt`/`session:waiting` produces no OS notification, only
the dashboard label) as a failing test, then implement the fix and confirm it flips green. Cover:

1. A child session emitting `session:waiting` with a `permission_request` pendingPrompt → asserts
   `showBlockedNotification` is called with `blockingType: 'permission'`.
2. A child session emitting `session:waiting` with an `ask_user_question_request` pendingPrompt →
   asserts `'question'`.
3. A child session emitting `session:waiting` with an `exit_plan_mode_request` pendingPrompt →
   asserts `'plan_approval'`.
4. A child session emitting `session:completed` with no pending prompt and an empty queued-prompts
   count → asserts `showBlockedNotification` is **not** called (regression guard for the normal
   completion path).
5. The existing `[Child Session Update]` `queuePromptForSession` call still fires for both the
   blocked and normal-completion paths, unchanged in content/shape.

Mock `notificationService` narrowly (per `token-discipline.md`/testing rules — do not import the
full `@nimbalyst/runtime` barrel to reach it); mock only `MetaAgentService`'s direct dependency on
the `NotificationService` singleton/import.

---

## Boundaries

### Files You MUST NOT Touch

Per `.nimble/config.yaml` global `never_touch` list:
- `package-lock.json`, `packages/browser-extension/package-lock.json`
- `.env*`
- `.github/workflows/*`
- `packages/electron/src/database/migrations/*`
- `packages/electron/src/main/database/sqlite/schemas/*`
- `node_modules/`, `**/dist/`, `packages/electron/out/`
- `nimbalyst-local/`, `.beads/`

Also, per this PRD's Agent Boundaries (§11):
- Do **not** modify `MetaAgentMode.tsx`'s `getStatusTone`/`getBarTone` status-color mapping
  (`:67-104`) — out of scope, explicitly a non-goal (status-vocabulary unification is deferred).
- Do **not** modify `claudeCliSubAgentTracker.ts`'s transcript-hiding logic — unrelated to this
  task and out of scope regardless.
- Do **not** bring Meta-Agent Mode's chip row or click-to-thread into this PRD's scope — both
  already exist (`MetaAgentMode.tsx:550-559` "Open In Agent", `:538-542` pending-prompt label) and
  are explicitly excluded from this task; you are closing only the notification gap.

### Files Requiring Review

Per `.nimble/config.yaml` `require_review` list, none of this task's files
(`MetaAgentService.ts`, `MetaAgentMode.tsx`, `NotificationService.ts`) are in that list — this task
does not itself trigger the human-review gate. (The PRD's gate is triggered later, by task 5a's
`CHANGELOG.md` edit — see PRD §12 Assumption 5: one `pause`-model gate after wave 6, before wave
7.)

---

## Dependencies

### Upstream Tasks

| Task | What It Provides | Verify Before Starting |
|------|------------------|------------------------|
| 3a — Guarantee distinct notification on Teammate error/crash | The proven `showBlockedNotification` call pattern applied to a sub-agent lifecycle event, plus a regression-test structure to mirror. See "Assumed Precondition" section above for the full expected-output description. | Grep `TeammateManager.ts` and `MessageStreamingHandler.ts` for `showBlockedNotification` call sites; confirm at least one exists before starting this task. |
| 1a — Add `blocked` status to `TeammateInfo.status` | Indirect — 3a depends on 1a, not this task directly; no direct file/type dependency for 3b. | Not required to verify directly; transitively satisfied if 3a is complete. |

### Downstream Impact

Task **5a** (CHANGELOG entry and final review gate) depends on this task among others (`2c, 2d, 3b,
4a, 4b, 4c`) — 5a cannot proceed until this task is merged. No other task depends on 3b directly.

**Before starting:** Verify task 3a is complete by confirming `showBlockedNotification` call sites
exist in `TeammateManager.ts` and/or `MessageStreamingHandler.ts` (see "Assumed Precondition"
section). If 3a is not complete, stop and escalate rather than building against an assumed pattern
that doesn't yet exist in the codebase.

---

## Deliverables

None beyond the files above. The regression test proving the fix (and proving normal Meta-Agent
completion is unaffected) is part of the code deliverable in `MetaAgentService.ts`'s test suite,
not a separate artifact — per PRD §12 Assumption 7 and this task's `deliverables_note` in
`tasks.yaml`.

---

## GitHub Context

**Issue:** #{issue_number} (created by the PM agent at task-start time)
**Feature Issue (Parent):** #{feature_issue_number}
**Branch:** `worktree/agent-visibility-3b`
**Target:** Determined by PM agent based on execution mode (feature branch or main)

---

## Commit Guidelines

Use Conventional Commits:
```
fix(meta-agent): fire distinct notification on pending-prompt block

Co-Authored-By: Claude <noreply@anthropic.com>
```

Types: feat, fix, refactor, test, docs, chore

---

## Validation Checklist

Before creating PR:
- [ ] All success criteria met
- [ ] Build passes: `npm run build`
- [ ] Type check passes: `npm run typecheck`
- [ ] Unit tests pass: `npm run test:unit`
- [ ] No `never_touch` files modified
- [ ] Regression tests added (blocked-notification fires; normal completion unaffected;
      `[Child Session Update]` delivery unchanged)
- [ ] `MetaAgentMode.tsx:538-542`'s existing display label is unchanged/preserved
- [ ] Branch rebased on target branch (feature branch or main)

---

*Generated by NIMBLE Brief Writer*
*PRD: agent-visibility | Task: 3b | Wave: 4*
