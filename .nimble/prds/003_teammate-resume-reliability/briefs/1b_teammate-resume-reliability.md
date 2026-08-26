# Task Brief: 1b

**Title:** Resume-failure wake for the lead's conversation (live-process case)
**PRD:** teammate-resume-reliability
**Priority:** must
**Complexity:** 4/10
**Model:** sonnet
**Wave:** 2
**Feature Issue:** TBD — assigned by PM agent at execution start (no GitHub issue number recorded in the PRD frontmatter yet)

---

## Objective

When a resumed teammate's stream fails (`handleStreamError` fires) while the lead's own Nimbalyst
process is still alive, wake the lead's own conversation with a message describing the failure —
using the existing, already-proven `deliverMessageToLead` mechanism — instead of only flipping the
teammate's chip to `errored` and (at best) firing a desktop notification nobody reads inside the
conversation. This task covers the live-process case only; the post-restart case is task 1c.

---

## Context

**Parent Feature:** Teammate Resume-Delivery Reliability (PRD `teammate-resume-reliability`, GitHub
feature issue TBD)

Nimbalyst's Agent Mode lets a lead agent spawn "teammates." When the lead resumes an idle teammate
(via its own `SendMessage` tool call or a host-initiated send), the resume is fire-and-forget:
`resumeIdleTeammate` kicks off `streamTeammateOutput` and returns without waiting. If that resumed
process fails — dead subprocess, stale session file — `handleStreamError`
(`TeammateManager.ts:1531-1552`, confirmed by direct read 2026-08-25) fires:

```ts
private handleStreamError(
  sessionId: string | undefined,
  agentId: string,
  teamName: string,
  err: Error,
): void {
  const isBackground = this.managedTeammates.get(agentId)?.isBackgroundAgent ?? false;

  this.managedTeammates.delete(agentId);
  this.markCompleted(agentId);
  this.clearPendingMessages(agentId);
  this.idleTeammates.delete(agentId);
  if (!isBackground) void this.removeTeammateFromConfig(teamName, agentId);
  console.warn(`[MANAGED-TEAMMATE] "${agentId}" errored:`, err.message);
  this.scheduleEmitTeammateUpdate(sessionId, new Map([[agentId, 'errored']]));
  this.recordBatchFailure('errored');

  if (!this.hasActiveTeammates()) {
    this.emitAllCompleted(sessionId);
  }
}
```

Today, `handleStreamError`'s only effect on the lead's own conversation is nothing: it drives the
chip UI (`scheduleEmitTeammateUpdate` → `errored`) and, if this was the last active teammate,
`emitAllCompleted` → `teammates:allCompleted`, whose only consumer
(`onTeammatesAllCompleted`, `MessageStreamingHandler.ts:1172-1210`) plays a failure sound and shows a
desktop notification. It never re-enters the lead's own conversation. The lead already told itself
(via task 1a's now-honest, but still not-a-failure-report, ack) that resume was initiated, and
typically ends its turn believing the teammate will report back — which it never will, since the
resume already died.

The fix is **not** a new notification mechanism — `deliverMessageToLead` (`TeammateManager.ts:1090`)
already exists and is already used for exactly this shape of thing:

```ts
private deliverMessageToLead(
  sessionId: string | undefined,
  teammateAgentId: string,
  teammateName: string,
  content: string,
  summary: string,
): void {
  // ... logs a `teammate_message_to_lead` chunk, queues the message, then:
  this.deps.interruptWithMessage(formattedMessage).catch(...);
  this.deps.emit('message:logged', { sessionId, direction: 'output' as const });
}
```

Two existing call sites confirm the calling convention:
- `TeammateManager.ts:1517` (inside `handleStreamCompletion`, background-agent result delivery):
  `this.deliverMessageToLead(sessionId, agentId, displayName, result.capturedResultText, \`${displayName} completed\`);`
- `TeammateManager.ts:1942` (approved shutdown): `this.deliverMessageToLead(sessionId, agentId, name, \`Teammate "${name}" has shut down (approved shutdown request).\`, \`${name} shut down\`);`

`deliverMessageToLead` calls `deps.interruptWithMessage()`, which (`ClaudeCodeProvider.ts:2326-2369`)
either interrupts a mid-turn lead (`leadQuery !== null` branch, `:2349-2368`) or triggers a fresh
`sendMessage` on an idle-but-live one (`:2332-2346`, via `emitTeammateMessageWhileIdle`). Both
branches make `isLeadBusy()` (`ClaudeCodeProvider.ts:2629-2631`,
`return this.leadQuery !== null || this.teammateIdleMessagePending;`) return `true` — mid-turn via
`leadQuery !== null`, idle-but-live via `teammateIdleMessagePending` being latched by
`emitTeammateMessageWhileIdle` (`:2549-2550`). In both cases this makes `onTeammatesAllCompleted`
(`MessageStreamingHandler.ts:1180-1185`) return early *before* `announceTeammatesCompletion`'s
desktop notification fires — this is how "no duplicate notification" is satisfied in this task's
scope, as an emergent property of existing code, not new suppression logic you write.

**Critical ordering constraint — read before implementing (see Requirements item 3 and Edge
Cases below for the mechanism):** the `deliverMessageToLead` call this task adds MUST run *before*
`handleStreamError`'s existing `if (!this.hasActiveTeammates()) { this.emitAllCompleted(sessionId);
}` block (lines 52-54 above). `deps.emit(...)` inside `emitAllCompleted` dispatches synchronously —
`onTeammatesAllCompleted`'s `isLeadBusy()` guard (`MessageStreamingHandler.ts:1180-1185`) runs
synchronously during that dispatch, before any `await`. If `deliverMessageToLead` runs *after*
`emitAllCompleted` instead, the guard reads `isLeadBusy() === false` (the
`teammateIdleMessagePending` flag isn't latched yet) for the idle-but-live, last-teammate case: the
desktop notification fires anyway (breaking R3) and `endSession` runs, so the wake this task adds
then hits an already-ended session and gets dropped by `onTeammateMessageWhileIdle`'s
`isSessionActive` bail (breaking R2). `handleStreamCompletion`'s existing background-agent result
delivery already gets this right — its own `deliverMessageToLead` call (`:1515-1522`) precedes its
own `hasActiveTeammates()`/`emitAllCompleted` check (`:1526-1528`). Match that ordering exactly.

This task is part of **Wave 2** — it depends on task 1a (wording change, same file, sequenced to
avoid a concurrent-edit window) and is a prerequisite for task 1c (post-restart fix, which builds on
this task's new `wasResumed` marker and `deliverMessageToLead` call site).

---

## Requirements

Fulfills PRD requirements **R2** (failure re-enters the lead's conversation, live-process case),
**R3** (no duplicate notification, live-process branches only), **R4** (non-idle lead handled, via
existing machinery).

### 1. Add a `wasResumed` marker to distinguish resumed teammates from freshly-spawned ones

`ManagedTeammate` entries created via `resumeIdleTeammate` (`TeammateManager.ts:1954-1998`) are
today structurally identical to ones created via `spawnManagedTeammate`
(`:1556-1608`) or `spawnBackgroundAgent` (`:1621-1668`) — `handleStreamError` cannot tell them apart.
Add a new boolean field to the `ManagedTeammate` interface (`TeammateManager.ts:22-37`, alongside the
existing `isBackgroundAgent: boolean` at line 33), e.g.:

```ts
wasResumed: boolean;  // true if this entry came from resumeIdleTeammate, not a fresh spawn
```

Set it at **all three** places a `ManagedTeammate` object is constructed — missing one of the first
two is the likely mistake, since only the third is this task's "happy path":

- `spawnManagedTeammate`'s placeholder object (`TeammateManager.ts:1579-1594`) → `wasResumed: false`
- `spawnBackgroundAgent`'s placeholder object (`TeammateManager.ts:1639-1654`) → `wasResumed: false`
- `resumeIdleTeammate`'s object (`TeammateManager.ts:1974-1989`) → `wasResumed: true`

### 2. Read `wasResumed` (and the display `name`) BEFORE `handleStreamError`'s delete

`handleStreamError` (`TeammateManager.ts:1531-1552`) already captures `isBackground` from
`this.managedTeammates.get(agentId)` *before* `this.managedTeammates.delete(agentId)` at line 1539.
Mirror this exactly for `wasResumed` — and also capture the teammate's display `name` (not `agentId`,
not `teamName`) in the same read, since `deliverMessageToLead`'s third parameter is `teammateName`
(the display name used in the message, e.g. `"alice"`, not `"alice@team"`):

```ts
const managed = this.managedTeammates.get(agentId);
const isBackground = managed?.isBackgroundAgent ?? false;
const wasResumed = managed?.wasResumed ?? false;
const teammateName = managed?.name ?? agentId;  // fallback only if somehow already gone

this.managedTeammates.delete(agentId);
```

### 3. Call `deliverMessageToLead` when `wasResumed` is true — BEFORE the `emitAllCompleted` check

Insert the new call immediately after the existing cleanup/status-emit lines (the
`scheduleEmitTeammateUpdate`/`recordBatchFailure` calls), and — this is the part that must not be
gotten wrong — **before** the `if (!this.hasActiveTeammates()) { this.emitAllCompleted(sessionId); }`
block:

```ts
if (wasResumed) {
  this.deliverMessageToLead(
    sessionId,
    agentId,
    teammateName,
    `Resuming teammate "${teammateName}" failed: ${err.message}`,
    `${teammateName} resume failed`,
  );
}

// This check MUST come after the deliverMessageToLead call above, not before —
// see "Critical ordering constraint" in Context for why (mirrors
// handleStreamCompletion's existing :1515-1528 ordering).
if (!this.hasActiveTeammates()) {
  this.emitAllCompleted(sessionId);
}
```

(Exact message wording is your call — match the tone/shape of the two existing call sites at
`:1517`/`:1942`; must name the teammate and describe the failure, not just say "an error occurred.")
A fresh-spawn failure (`wasResumed === false`) must **not** call `deliverMessageToLead` — that is
explicitly out of scope for this PRD (see Non-Goals below).

### Non-Goals (explicit — do not implement)

- **A fresh-spawn (non-resume) teammate failure does not get this new wake.** Per the PRD's
  Non-Goals: `handleStreamError` already reports a fresh-spawn failure to the lead's conversation no
  better than a resume failure today, but a fresh spawn was never preceded by a premature "delivered"
  claim (task 1a's fix), so there's no honesty bug to fix on that path. Adding a lead-wake for
  fresh-spawn failures too is a separate, reasonable, but out-of-scope improvement. Gate strictly on
  `wasResumed`.
- **Do not touch `teammateCompletionSignal.ts`, `ClaudeCodeProvider.ts`, or
  `MessageStreamingHandler.ts` in this task.** The PRD reviewer confirmed the existing
  `deliverMessageToLead` + `interruptWithMessage` + `isLeadBusy` machinery already does everything
  R2-R4 need for the live-process case. This task wires `handleStreamError` into it; it does not add
  a parallel notification system, and it does not touch the post-restart path (task 1c's job — do
  not attempt Door A/Door B fixes here even if you notice them while reading `interruptWithMessage`).
- **Do not build new desktop-notification-suppression code.** The existing `isLeadBusy()` guard is
  what prevents the duplicate notification in both branches (mid-turn and idle-but-live) — verify
  both, do not add a new guard. The only thing you must get right is the *ordering* of your new call
  relative to the existing `emitAllCompleted` check (see Requirements item 3) — not a new mechanism.
- **Do not extend `teammates:allCompleted`/`announceTeammatesCompletion` with a new outcome.** That
  mechanism only fires via an aggregate "last teammate" check and cannot satisfy per-teammate,
  idempotent delivery — rejected during PRD review as the wrong mechanism for this fix.

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] A teammate resume that fails (`handleStreamError` fires) while the lead's process is alive
      calls `deliverMessageToLead` with a message describing the failure — verified by asserting
      `deliverMessageToLead` was invoked with the correct `sessionId`/`agentId`/`teammateName` (the
      display name, not the team name)/`content`, not just that some event fired
- [ ] The new `deliverMessageToLead` call runs BEFORE the existing `hasActiveTeammates()` /
      `emitAllCompleted` check inside `handleStreamError` — verified by testing the last-teammate,
      resume-failure case specifically: `deliverMessageToLead`/`interruptWithMessage` must have been
      called (and, transitively, `teammateIdleMessagePending` latched) before/by the time
      `emitAllCompleted`'s synchronous `emit('teammates:allCompleted', ...)` dispatches, so a
      same-tick consumer's `isLeadBusy()` check reads `true`
- [ ] A teammate that errors on a FRESH spawn (not a resume) does NOT trigger this new wake path —
      verified via the new `wasResumed` marker being `false`/absent for `spawnManagedTeammate`- and
      `spawnBackgroundAgent`-created entries, read before the `:1539` delete
- [ ] No new desktop-notification-suppression code is added for the live-process case — the existing
      `isLeadBusy()` guard (true via `leadQuery !== null` when mid-turn, via
      `teammateIdleMessagePending` when idle-but-live) is what prevents the duplicate notification in
      both branches; verify both, don't assume symmetry
- [ ] Two teammates resumed concurrently that both fail near-simultaneously each independently call
      `deliverMessageToLead` — no dependency on `emitAllCompleted` or `teammates:allCompleted` for
      this path
- [ ] `wasResumed` is set correctly at all three `ManagedTeammate` construction sites
      (`spawnManagedTeammate`, `spawnBackgroundAgent`, `resumeIdleTeammate`)

**All criteria must pass before task is complete.**

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/runtime/src/ai/server/providers/TeammateManager.ts` | modify | Add `wasResumed` field to `ManagedTeammate`, set it at all three construction sites, read it (plus display `name`) before `handleStreamError`'s delete, call `deliverMessageToLead` when `wasResumed` is true — BEFORE the existing `emitAllCompleted` check |

### File Ownership Notes

- Depends on task 1a landing first (`depends_on: ["1a"]`) — same file, sequenced to avoid a
  concurrent-edit window. This task's edits (near `ManagedTeammate`'s definition ~line 22, the three
  construction sites ~1579/1639/1974, and `handleStreamError` ~1531-1552) are textually distant from
  1a's edits (~2389/2398), so no real conflict is expected regardless.
- Task 1c (`depends_on: ["1b"]`) builds directly on this task's `wasResumed` marker and
  `deliverMessageToLead` call site inside `handleStreamError` — do not restructure
  `handleStreamError`'s control flow more than necessary, since 1c's Door A/Door B fixes touch the
  call chain this task wires up (`interruptWithMessage`, `emitTeammateMessageWhileIdle`).

---

## Implementation Guidance

### Patterns to Follow

- `scheduleEmitTeammateUpdate`/`emitTeammateUpdate` (`TeammateManager.ts:1119-1207` region) is the
  only write path for `TeammateInfo.status` — already used correctly in `handleStreamError`; do not
  touch this.
- `deliverMessageToLead`'s calling convention — match `:1517` and `:1942` exactly (same parameter
  order: `sessionId, teammateAgentId, teammateName, content, summary`).
- The `isBackground` capture-before-delete pattern at `handleStreamError:1537` — mirror it exactly
  for `wasResumed` and `teammateName`.
- **`handleStreamCompletion`'s existing call ordering (`:1515-1528`)** — its own
  `deliverMessageToLead` call for background-agent results precedes its own
  `hasActiveTeammates()`/`emitAllCompleted` check. This task's new call in `handleStreamError` must
  follow the identical ordering, for the identical reason (see "Critical ordering constraint" in
  Context).

### Code Style

Match existing style in `TeammateManager.ts` — plain `Map`s for per-entity tracking,
`console.log`/`console.warn` with a `[MANAGED-TEAMMATE]` prefix for diagnostic logging (see
`handleStreamError`'s existing `console.warn` at line 1544 for the exact prefix convention).

### Edge Cases

- **A resumed teammate's `name` is somehow already gone from `managedTeammates` by the time
  `handleStreamError` runs** (should not happen in practice — `handleStreamError` is called from the
  `.catch()` on `streamTeammateOutput`'s own promise, and the entry is only deleted inside
  `handleStreamError`/`handleStreamCompletion` themselves, not concurrently elsewhere — but guard
  with a fallback, e.g. `managed?.name ?? agentId`, rather than throwing).
- **Two teammates resumed concurrently, both fail near-simultaneously.** Each `handleStreamError`
  call operates on its own `agentId`; `deliverMessageToLead` is called once per failure, independent
  of any "last teammate" aggregate check — verify this holds (no shared mutable state between the two
  calls beyond `managedTeammates`/`idleTeammates`, which are keyed by `agentId`).
- **A resumed teammate fails, and it was the last active teammate — the case that makes ordering
  matter.** Both `deliverMessageToLead` (new in this task) and `emitAllCompleted` (existing) fire
  from the same `handleStreamError` invocation. The safety here is NOT "implicit in sync vs. async
  scheduling" — it is explicit call order inside `handleStreamError`, because `deps.emit(...)`
  (a Node `EventEmitter` dispatch) runs its listener's guard logic *synchronously*, before that
  listener's first `await`. Concretely: `deliverMessageToLead` → `deps.interruptWithMessage(...)` →
  (idle-but-live branch) `emitTeammateMessageWhileIdle` sets
  `this.teammateIdleMessagePending = true` synchronously, with no `await` before that assignment
  (`ClaudeCodeProvider.ts:2332-2345`, `2549-2550`). If your `deliverMessageToLead` call runs
  *before* `emitAllCompleted`, the flag is already `true` by the time `emitAllCompleted`'s
  `deps.emit('teammates:allCompleted', ...)` synchronously reaches `onTeammatesAllCompleted`'s
  `isLeadBusy()` check (`MessageStreamingHandler.ts:1180-1185`), so it correctly defers
  `endSession`/the notification. If you get the order backwards, the guard reads `false` (not yet
  latched), the notification fires and the session ends anyway, and this task's own wake then lands
  on an already-ended session and gets dropped. Get the order right per Requirements item 3; this is
  the single most failure-prone detail in this task.

### Testing Requirements

No test file exists for `TeammateManager.ts`'s resume-failure path yet. This task does not require
writing its own test file — task 2a (dedicated, gated on 1a/1b/1c) covers this task's behavior as
part of its broader suite, and is explicitly asked to cover the last-teammate/ordering case above.
If you want to validate your own change locally before 2a lands, construct a `TeammateManager`
directly with stub `TeammateManagerDeps` (see `TeammateManager.stallWatchdog.test.ts` for the exact
pattern: `interruptWithMessage: vi.fn(async () => {})`, `emit: vi.fn()`), seed `managedTeammates` via
bracket-notation cast (`(manager as any).managedTeammates.set(...)`), and assert
`deps.interruptWithMessage` was called with a message naming the teammate, and that it was called
before/independent of the `deps.emit('teammates:allCompleted', ...)` call (check
`deps.interruptWithMessage.mock.invocationCallOrder` vs. `deps.emit.mock.invocationCallOrder` for the
`'teammates:allCompleted'` call, or simply assert `interruptWithMessage` was called at all in the
last-teammate case, since `TeammateManager`-level tests can't observe the downstream `isLeadBusy()`
guard directly).

---

## Boundaries

### Files You MUST NOT Touch

Global `never_touch` list (from `.nimble/config.yaml`):
- `node_modules/**`
- `dist/**`
- `out/**`
- `out2/**`
- `release/**`
- `.vite/**`

PRD-specific boundaries for this task:
- **Do not touch `ClaudeCodeProvider.ts` or `MessageStreamingHandler.ts`.** The PRD reviewer
  confirmed the existing `deliverMessageToLead` + `interruptWithMessage` + `isLeadBusy` machinery
  already does everything this task needs for the live-process case. The post-restart fix that does
  touch these files is task 1c's scope, sequenced after this task.
- Do not touch `teammateCompletionSignal.ts` or `announceTeammatesCompletion`.
- Do not implement a blocking/wait-for-first-chunk ack (task 1a's scope, already rejected as an
  approach during PRD review).
- Do not attempt Door A (stale `lastUsedSessionId` in `emitTeammateMessageWhileIdle`) or Door B
  (`isSessionActive` false negative in `MessageStreamingHandler.ts`) — both are confirmed real gaps,
  but they are task 1c's scope specifically because the fix spans
  `packages/electron/src/main/**` (`require_review`), unlike this task which stays entirely in
  `packages/runtime`.

### Files Requiring Review

`TeammateManager.ts` is not in `.nimble/config.yaml`'s `require_review` list. This task does not
trigger the PRD's human-review gate on its own.

---

## Dependencies

### Upstream Tasks

| Task | What It Provides | Verify Before Starting |
|------|------------------|------------------------|
| 1a | Reworded model-facing ack strings landed on `TeammateManager.ts` (lines ~2389/2398) | Confirm 1a's PR has merged; re-read the current state of the file since line numbers used in this brief may have shifted slightly from 1a's landed diff (1a's edits are textually distant from this task's, so shifts should be small). |

### Downstream Impact

| Task | What it needs from 1b | Why |
|------|------------------------|-----|
| 1c | The `wasResumed` marker and `deliverMessageToLead` call site inside `handleStreamError` must exist first | 1c fixes the post-restart delivery gap in the same call chain (`interruptWithMessage` → `emitTeammateMessageWhileIdle`) that this task's `deliverMessageToLead` call triggers; it cannot be built without this task's wiring landing first. |
| 2a | This task's behavior (live-process wake, `wasResumed` gating, no-duplicate-notification via `isLeadBusy()`, and the call-ordering guarantee) | 2a's test suite covers both the mid-turn and idle-but-live branches of this task as two of its required coverage points, plus the last-teammate ordering case. |

**Before starting:** Confirm task 1a's PR has merged and re-read the current line numbers for
`ManagedTeammate` and `handleStreamError` in `TeammateManager.ts`, since this brief's line references
are pinned to the pre-1a state of the file (verified 2026-08-25).

---

## GitHub Context

**Issue:** TBD — created by PM agent at execution start
**Feature Issue (Parent):** TBD — created by PM agent at execution start
**Branch:** `worktree/teammate-resume-reliability-1b`
**Target:** Determined by PM agent based on execution mode (feature branch or main)

---

## Commit Guidelines

Use Conventional Commits:
```
fix(teammates): wake the lead's conversation when a resumed teammate's stream fails
```

Types: feat, fix, refactor, test, docs, chore

---

## Deliverables

None beyond the files above (inferred — not captured at interview; `tasks.yaml` has no
`deliverables` field for this task). The `wasResumed` marker, its three construction-site
assignments, and the correctly-ordered `deliverMessageToLead` wiring inside `handleStreamError` are
the only artifacts this task produces.

---

## Validation Checklist

Before creating PR:
- [ ] All success criteria met
- [ ] Build passes: `npm run build`
- [ ] Type check passes: `npm run typecheck`
- [ ] No `never_touch` files modified
- [ ] `ClaudeCodeProvider.ts` and `MessageStreamingHandler.ts` confirmed untouched
- [ ] `deliverMessageToLead` call confirmed to precede the `hasActiveTeammates()`/`emitAllCompleted`
      check inside `handleStreamError`
- [ ] Branch rebased on target branch (feature branch or main)

---

*Generated by NIMBLE Brief Writer*
*PRD: teammate-resume-reliability | Task: 1b | Wave: 2*
