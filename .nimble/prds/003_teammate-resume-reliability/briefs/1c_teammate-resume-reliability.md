# Task Brief: 1c

**Title:** Resume-failure wake survives a Nimbalyst restart
**PRD:** teammate-resume-reliability
**Priority:** must
**Complexity:** 6/10
**Model:** opus
**Wave:** 3
**Feature Issue:** TBD — assigned by PM agent at execution start (no GitHub issue number recorded in the PRD frontmatter yet)

---

## Objective

Task 1b's resume-failure wake only reaches the lead while the lead's own Nimbalyst process is alive.
Confirmed during PRD review (not hypothetical): post-restart, that wake is silently dropped through
two independent doors, and — critically — shipping 1b without this fix makes the post-restart
scenario **worse than doing nothing**: no lead wake (still dropped, as before), no desktop
notification (newly suppressed by a side effect of 1b's fix), and a session that never ends. This
task fixes both doors so the wake this PRD exists to build actually survives a restart, which is the
headline scenario the whole PRD targets.

---

## Context

**Parent Feature:** Teammate Resume-Delivery Reliability (PRD `teammate-resume-reliability`, GitHub
feature issue TBD)

Task 1b wired `handleStreamError` (`TeammateManager.ts`) to call `deliverMessageToLead` when a
resumed teammate's stream fails while the lead's process is alive. `deliverMessageToLead` calls
`deps.interruptWithMessage(formattedMessage)`
(`ClaudeCodeProvider.ts:2326-2369`). When the lead has no live query (`!this.leadQuery`, the
post-restart case — a restart always starts with no live lead query), `interruptWithMessage` takes
the idle branch:

```ts
if (!this.leadQuery) {
  if (this.teammateIdleMessagePending) { ... return; }
  const pendingMessageBatch = this.drainAndFormatPendingTeammateMessages();
  if (!pendingMessageBatch) return;
  this.emitTeammateMessageWhileIdle(pendingMessageBatch.formattedMessage);
  return;
}
```

`emitTeammateMessageWhileIdle` (`ClaudeCodeProvider.ts:2549-2555`, confirmed by direct read
2026-08-25):

```ts
private emitTeammateMessageWhileIdle(message: string): void {
  this.teammateIdleMessagePending = true;
  this.emit('teammate:messageWhileIdle', {
    sessionId: this.teammateManager.lastUsedSessionId,
    message,
  });
}
```

### Door A — wrong/missing `sessionId`

`this.teammateManager.lastUsedSessionId` is only ever set while a live lead query is running
(`sdkOptionsBuilder.ts:333`, `teammateManager.lastUsedSessionId = sessionId;`, called from inside the
SDK options builder used by an active `sendMessage` turn; also documented at
`TeammateManager.ts:2047` in `stopByAgentId`'s docstring, see below). Post-restart it is `undefined`
— even though a real, correct `sessionId` was already passed explicitly into `deliverMessageToLead`
by 1b's `handleStreamError` caller. The emitted `teammate:messageWhileIdle` event therefore carries
`sessionId: undefined`.

**The fix pattern already exists in this same file for the identical class of gap.**
`TeammateManager.stopByAgentId` (`TeammateManager.ts:2041-2081`) has this exact docstring:

```
/**
 * Stop a specific managed teammate by exact `agentId` -- addressed by the
 * UI, which already has the exact id, unlike the lead model's own
 * SendMessage tool which goes through `stop(name)`'s fuzzy matching.
 *
 * `leadSessionId` is threaded in explicitly rather than read from
 * `this.lastUsedSessionId`, which is only set while a live lead query is
 * streaming and is therefore unset for the first UI action after a
 * restart -- the same gap `sendMessageFromHost`'s `leadSessionId`
 * parameter exists to close. Without this, a post-restart stop would
 * abort the subprocess but silently skip the status emit.
 * ...
 */
stopByAgentId(agentId: string, leadSessionId: string | undefined): { stopped: boolean } {
  ...
  this.scheduleEmitTeammateUpdate(leadSessionId, new Map([[agentId, 'errored']]));
  ...
}
```

Follow the same pattern here: **thread the `sessionId` explicitly through the call chain, don't read
stale instance state.** Concretely:

1. `TeammateManagerDeps.interruptWithMessage` (`TeammateManager.ts:108-124`, the interface
   `TeammateManager` uses to call back into `ClaudeCodeProvider`) currently has the signature:
   ```ts
   interruptWithMessage(message: string): Promise<void>;
   ```
   Widen it to accept the `sessionId` `deliverMessageToLead` already has, e.g.:
   ```ts
   interruptWithMessage(message: string, sessionId?: string): Promise<void>;
   ```
2. `deliverMessageToLead` (`TeammateManager.ts:1090-1132`) already receives `sessionId` as its first
   parameter — update its `this.deps.interruptWithMessage(formattedMessage)` call
   (`:1124`) to pass it through: `this.deps.interruptWithMessage(formattedMessage, sessionId)`.
3. `ClaudeCodeProvider.ts`'s own `interruptWithMessage(message: string)` method
   (`:2326-2369`) is what's wired as the `interruptWithMessage` dependency at construction
   (`ClaudeCodeProvider.ts:420`, `interruptWithMessage: (message) => this.interruptWithMessage(message)`).
   Widen both: the method's own signature to `interruptWithMessage(message: string, sessionId?:
   string): Promise<void>`, and the constructor-site arrow function to forward the new parameter:
   `interruptWithMessage: (message, sessionId) => this.interruptWithMessage(message, sessionId)`.
4. Inside `interruptWithMessage`'s idle branch (`:2332-2346`), pass the threaded `sessionId` to
   `emitTeammateMessageWhileIdle`.
5. `emitTeammateMessageWhileIdle` (`:2549-2555`) currently takes only `message: string`. Widen it to
   `emitTeammateMessageWhileIdle(message: string, sessionId?: string): void` and use
   `sessionId ?? this.teammateManager.lastUsedSessionId` as the emitted payload's `sessionId` — fall
   back to the old behavior only when no explicit `sessionId` was threaded in (this preserves
   `emitTeammateMessageWhileIdle`'s **other** call sites, which do not have an explicit sessionId to
   thread — see "Other call sites of `emitTeammateMessageWhileIdle`" below).

**Other call sites of `emitTeammateMessageWhileIdle`** (do not break these — they have no
`deliverMessageToLead`-sourced `sessionId` to thread, so they must keep falling back to
`this.teammateManager.lastUsedSessionId`):
- `ClaudeCodeProvider.ts:2379` (re-triggering pending teammate messages after `sendMessage` exit)
- `ClaudeCodeProvider.ts:2403` (finally-block pending message delivery)
- `ClaudeCodeProvider.ts:2412` (continuation message for unresolved active agents)

All three of these fire from contexts where a live lead query recently ran (so
`lastUsedSessionId` is populated), unlike this task's post-restart case — leave them passing no
second argument, relying on the fallback.

### Door B — `isSessionActive` false negative

Even with a correct `sessionId` from Door A's fix, `onTeammateMessageWhileIdle`
(`MessageStreamingHandler.ts:1092-1154`, confirmed by direct read 2026-08-25) bails before doing
anything useful:

```ts
const onTeammateMessageWhileIdle = async (data: { sessionId: string; message: string }) => {
  if (!data.sessionId) { ... return; }
  const sessionStateManager = getSessionStateManager();
  if (!sessionStateManager.isSessionActive(data.sessionId)) {
    logger.main.info(`[AIService] Ignoring teammate message for ended session ${data.sessionId}`);
    return;
  }
  // ... startSession() is called at :1112, but only AFTER this bail check
  ...
};
```

This bails at `:1103-1106` because `stateManager.isSessionActive(sessionId)` is `false` — the
session was never marked active in this process. It becomes active again only via `startSession`
(called at `:1112`, but that line is unreachable because of the bail above). The reason
`isSessionActive` is false post-restart: `ai:sendMessageToTeammate`
(`AIService.ts:3208-3239`, confirmed by direct read 2026-08-25) — the IPC handler behind a
UI-initiated host send to a teammate — never calls `startSession` at all:

```ts
safeHandle('ai:sendMessageToTeammate', async (_event, sessionId: string, agentId: string, content: string) => {
  ... // resolves session, gets provider, calls provider.sendMessageToManagedTeammate(...)
  return { success: delivered, wasIdle };
});
```

Compare to `sendMessageHandler`'s own flow, which does call `stateManager.startSession(...)`
(`MessageStreamingHandler.ts:1283-1286`) as a matter of course for a normal lead turn — that call
never happens for a UI-initiated teammate send, so nothing marks the session active before
`onTeammateMessageWhileIdle`'s check runs.

**Fix (pick one — either satisfies the requirement, as long as the wake actually reaches the
user):**
- **Option A (recommended, smaller blast radius):** In `onTeammateMessageWhileIdle`
  (`MessageStreamingHandler.ts`), move the `sessionStateManager.startSession({...})` call
  (currently at `:1112`, after the bail) to *before* the `isSessionActive` check, so the session is
  marked active first and the check always passes for this handler's own flow. Confirm `startSession`
  is idempotent (the existing code comment at `:1109-1111` already states it is: "sendMessageHandler
  also calls startSession, but there can be a gap ... Re-calling startSession is safe (idempotent)")
  — so moving it earlier is safe.
- **Option B:** Have `ai:sendMessageToTeammate` (`AIService.ts:3208-3239`) call
  `sessionStateManager.startSession(...)` itself before invoking
  `provider.sendMessageToManagedTeammate(...)`, mirroring what `sendMessageHandler` already does for
  a normal lead turn.

Whichever you pick, the end state must be: a post-restart resume-failure wake, once
`onTeammateMessageWhileIdle` receives it with a correct `sessionId` (Door A fixed), results in the
session being marked active and the wake actually reaching the user (the `deliver()` callback inside
`announceTeammateWakeDelivery`'s classification, `:1117-1149`, actually fires and calls
`this.svc.sendMessageHandler!(...)`), rather than the early bail.

### Why "document the gap" is not an acceptable fallback here

Once `deliverMessageToLead` runs, `interruptWithMessage` drains the pending message queue (`:2341`)
and, on the idle branch, latches `teammateIdleMessagePending = true` (`emitTeammateMessageWhileIdle`,
`:2550`) **before** the drop happens at either door. That flag is only reset when the next lead query
starts (`ClaudeCodeProvider.ts:1010`, `this.teammateIdleMessagePending = false;`) — which never
happens post-restart until the user sends a new message. Until then, `isLeadBusy()`
(`:2629-2631`) returns `true` (via `teammateIdleMessagePending`), so `onTeammatesAllCompleted`
(`MessageStreamingHandler.ts:1180-1185`) returns early — **before** `stateManager.endSession(...)`
(`:1188`) and **before** `announceTeammatesCompletion`'s desktop notification (`:1195-1207`).

**Net effect of shipping task 1b without this task:** no lead wake (still dropped through Door A/B),
no desktop notification (newly suppressed by the `isLeadBusy()` latch), and a session that never
ends — strictly worse than today, where the user at least gets the notification. This task is not
optional polish; it is required for 1b to be a net improvement rather than a regression in the exact
scenario this PRD exists for.

This task is part of **Wave 3** — it depends on task 1b's `wasResumed` marker and
`deliverMessageToLead` call site inside `handleStreamError` existing first, and is its own task
(rather than folded into 1b) because this fix spans `packages/electron/src/main/**`
(`require_review` per `.nimble/config.yaml`), unlike 1a/1b which stay entirely in
`packages/runtime`.

---

## Requirements

Fulfills PRD requirements **R2, R3, R4, R6** (post-restart specifically).

1. **Door A:** Thread the `sessionId` `deliverMessageToLead` already has, explicitly, through
   `TeammateManagerDeps.interruptWithMessage` → `ClaudeCodeProvider.interruptWithMessage` →
   `emitTeammateMessageWhileIdle`, instead of `emitTeammateMessageWhileIdle` unconditionally reading
   `this.teammateManager.lastUsedSessionId`. Preserve `lastUsedSessionId` as the fallback for
   `emitTeammateMessageWhileIdle`'s other three call sites (`:2379`, `:2403`, `:2412`), which have no
   explicit sessionId to thread and must keep working exactly as today.
2. **Door B:** Fix `onTeammateMessageWhileIdle` (or its caller, `ai:sendMessageToTeammate`) so a
   post-restart wake no longer silently bails on `!isSessionActive` — either the session gets
   started/marked active as part of delivering the wake (Option A above, recommended), or the
   `AIService.ts` handler starts the session itself before triggering the wake path (Option B).
3. **Fallback requirement — read carefully, this is not optional:** if, after implementing both
   doors, some sub-case genuinely still cannot be fixed (should be rare given the fixes above), it
   MUST fall back to preserving today's pre-1b behavior for that sub-case specifically: the desktop
   notification via `announceTeammatesCompletion` (`MessageStreamingHandler.ts:1195-1207`) still
   fires, and the session still ends via `stateManager.endSession(...)` (`:1188`). Silently doing
   neither — the failure mode this task exists to prevent — is not acceptable under any
   circumstance. Concretely: if you find a sub-case where the wake truly cannot reach the user, do
   not just add a `try/catch` that swallows it — ensure `teammateIdleMessagePending` gets reset (or
   never gets latched in that sub-case) so `isLeadBusy()` returns `false` and the existing
   `onTeammatesAllCompleted` path can still run to completion and notify/end the session as it did
   before 1b shipped.

### Non-Goals (explicit — do not implement)

- **Do not implement a blocking "wait for first chunk before acking" version** — task 1a's scope,
  already rejected as an approach during PRD review.
- **Do not extend `notifyUndelivered`/the wake-delivery pattern with a new outcome type** for this
  specific fix — the existing `classifyTeammateWakeDelivery`/`announceTeammateWakeDelivery` machinery
  in `MessageStreamingHandler.ts:1092-1154` already handles delivery classification once
  `isSessionActive` correctly returns `true`; you are fixing the gate in front of it, not replacing
  it.
- **Do not extend `teammateCompletionSignal.ts`/`announceTeammatesCompletion` with a new outcome** —
  rejected during PRD review as the wrong mechanism (aggregate "last teammate" check, not
  per-teammate).
- **Do not widen `createCanUseToolHandler`'s signature or touch permission-routing code** — unrelated
  to this task; if you find yourself anywhere near `ToolPermissionService.ts`, stop and re-check
  scope.

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] A resume-failure wake fired post-restart (session not active in `stateManager`,
      `lastUsedSessionId` undefined) reaches the lead's conversation — both doors verified
      independently, not just the combined happy path
- [ ] The `sessionId` `emitTeammateMessageWhileIdle` uses for a `deliverMessageToLead`-originated
      wake is the one explicitly passed through the call chain from `deliverMessageToLead`'s caller,
      not `this.teammateManager.lastUsedSessionId`
- [ ] `emitTeammateMessageWhileIdle`'s other three call sites (`:2379`, `:2403`, `:2412`) are
      unaffected — they still fall back to `lastUsedSessionId` correctly (no explicit sessionId
      threaded for those)
- [ ] `onTeammateMessageWhileIdle` no longer silently bails on `!isSessionActive` for the
      post-restart wake path — either the session gets started/marked active as part of delivering
      the wake, or an equivalent fix is applied that results in the message actually reaching the
      user
- [ ] If, after implementation, some sub-case genuinely cannot be fixed (should be rare given the
      above), it falls back to preserving today's pre-1b behavior (the desktop notification via
      `announceTeammatesCompletion` still fires, the session still ends via `endSession`) — silently
      doing neither is not an acceptable outcome under any circumstance
- [ ] `teammateIdleMessagePending` is not left permanently latched when a post-restart wake cannot be
      delivered through Door A or Door B — confirm the session can still end via some path (either
      the wake succeeds, or the fallback in the criterion above kicks in and resets/never-latches the
      flag)

**All criteria must pass before task is complete.**

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/runtime/src/ai/server/providers/TeammateManager.ts` | modify | Widen `TeammateManagerDeps.interruptWithMessage` to accept an optional `sessionId`; thread it through from `deliverMessageToLead`'s call at `:1124` |
| `packages/runtime/src/ai/server/providers/ClaudeCodeProvider.ts` | modify | Widen `interruptWithMessage`'s method signature and its constructor-site wiring (`:420`) to forward `sessionId`; widen `emitTeammateMessageWhileIdle` (`:2549-2555`) to accept and prefer an explicit `sessionId` over `lastUsedSessionId` |
| `packages/electron/src/main/services/ai/MessageStreamingHandler.ts` | modify | Fix `onTeammateMessageWhileIdle` (`:1092-1154`) so a post-restart wake does not bail on `!isSessionActive` (Option A: reorder `startSession` before the check) |
| `packages/electron/src/main/services/ai/AIService.ts` | modify (only if you choose Option B for Door B) | If reordering inside `MessageStreamingHandler.ts` is insufficient or inappropriate at implementation time, have `ai:sendMessageToTeammate` (`:3208-3239`) call `startSession` itself before triggering the wake path |

### File Ownership Notes

- This task is the only one in this PRD touching `packages/electron/src/main/**`
  (`MessageStreamingHandler.ts`, `AIService.ts`) — both are in `.nimble/config.yaml`'s
  `require_review` list, so this task is expected to surface at the single end-of-work integration
  review, not a surprise.
- Depends on task 1b (`depends_on: ["1b"]`) — this task's `TeammateManager.ts` edits (widening
  `TeammateManagerDeps.interruptWithMessage` and its call site inside `deliverMessageToLead`) build
  directly on 1b's `deliverMessageToLead`/`handleStreamError` wiring. Do not restructure
  `handleStreamError`'s control flow beyond what Door A/B require.
- `ClaudeCodeProvider.ts` is not touched by 1a or 1b, so there is no sequencing concern there beyond
  depending on 1b for `TeammateManager.ts`'s state.

---

## Implementation Guidance

### Patterns to Follow

- **`stopByAgentId`'s docstring and `leadSessionId` threading pattern**
  (`TeammateManager.ts:2041-2081`) — read it in full before starting. It documents the exact same
  "`lastUsedSessionId` is only set while a live lead query is running" gap for a different action
  (Stop) and how that action's fix threads the `sessionId` explicitly instead of reading stale
  instance state. This task follows the same pattern for the wake path rather than inventing a new
  one.
- **`sendMessageFromHost`'s `leadSessionId` parameter** (`TeammateManager.ts:1191-1229`) is the same
  class of fix already applied to a sibling method — useful as a second reference for "thread it
  explicitly" if `stopByAgentId`'s docstring alone isn't enough context.
- **`onTeammateMessageWhileIdle`'s existing idempotent-`startSession`-call comment**
  (`MessageStreamingHandler.ts:1109-1111`) already documents that re-calling `startSession` is safe
  — use this as the justification for reordering it earlier in the function.

### Code Style

Match existing style — optional parameters with `?:` and `??`/fallback patterns already used
throughout `TeammateManager.ts` and `ClaudeCodeProvider.ts` (e.g. `seedLeadContext`'s `??=` pattern,
`TeammateManager.ts:1236-1239`).

### Edge Cases

- **A resume-failure wake fires while the lead's process IS alive (1b's case), going through this
  task's widened `interruptWithMessage` signature.** Confirm the mid-turn branch
  (`leadQuery !== null`, `:2349-2368`) is unaffected by the new optional `sessionId` parameter — it
  doesn't use `emitTeammateMessageWhileIdle` at all, only the idle branch does.
- **`emitTeammateMessageWhileIdle`'s three other call sites firing with no explicit `sessionId`
  after your change.** Confirm they still resolve to `this.teammateManager.lastUsedSessionId` exactly
  as before — a regression here would break the "lead turn ends with active agents, continuation
  fires" flow, unrelated to this PRD but easy to break by accident while widening the signature.
- **The session was already ended by the time the post-restart wake arrives** (e.g. user closed the
  session in the UI between the resume failure and this wake being processed). `startSession` being
  called again should not resurrect a session the user explicitly ended — confirm `startSession`'s
  own semantics handle this gracefully (read its implementation if unsure; do not assume).
- **Two teammates both fail post-restart near-simultaneously.** Both should independently reach
  `onTeammateMessageWhileIdle` with the correct `sessionId` (same lead session for both, since they
  share a lead) — `startSession` being called twice for the same session must be idempotent (already
  documented as such).

### Testing Requirements

No pre-existing test file covers this path (confirmed: this class of post-restart gap has no test
today). This task does not require its own new test file — task 2a (dedicated, gated on 1a/1b/1c)
covers this task's behavior explicitly: "resume-then-fail post-restart (session not active,
`lastUsedSessionId` undefined) reaches the lead — proves 1c's fix actually works, not just that it
compiles." If you want to validate locally before 2a lands, construct the relevant pieces with
`lastUsedSessionId` left `undefined` and `isSessionActive` stubbed to return `false` initially, then
assert the wake still reaches a `deliver()`/`sendMessage` call after your fix, and that
`startSession`/`isSessionActive` transition correctly.

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
- Do not touch `ToolPermissionService.ts`, `createCanUseToolHandler`, or any permission-routing
  logic — unrelated to this task.
- Do not touch `teammateCompletionSignal.ts`/`announceTeammatesCompletion`'s outcome classification —
  only rely on it firing correctly once your Door A/B fixes let `onTeammatesAllCompleted` reach it
  normally (via the fallback requirement, if needed); do not add a new outcome type.
- Do not modify `classifyTeammateWakeDelivery`/`announceTeammateWakeDelivery`
  (`teammateWakeDelivery.ts`) — that machinery already correctly classifies delivery once
  `isSessionActive` returns `true`; you are fixing what gates it, not replacing it.

### Files Requiring Review

Per `.nimble/config.yaml`'s `require_review` list, this task touches:
- `packages/electron/src/main/**` (both `MessageStreamingHandler.ts` and `AIService.ts` if Option B
  is used)

Expected at the single end-of-work integration review, not a surprise.

---

## Dependencies

### Upstream Tasks

| Task | What It Provides | Verify Before Starting |
|------|------------------|------------------------|
| 1b | The `wasResumed` marker and the `deliverMessageToLead` call site inside `handleStreamError`, plus the (currently un-threaded) `deps.interruptWithMessage(formattedMessage)` call inside `deliverMessageToLead` this task widens to pass `sessionId` | Confirm 1b's PR has merged; re-read the current state of `deliverMessageToLead` (`TeammateManager.ts:1090-1132`) and `handleStreamError` before starting, since line numbers may have shifted slightly from 1b's landed diff. |

### Downstream Impact

| Task | What it needs from 1c | Why |
|------|------------------------|-----|
| 2a | Both doors fixed and observably testable (via `isSessionActive` state transitions and the threaded `sessionId`) | 2a's test suite proves the post-restart fix actually works, not just that it compiles — this is 2a's most load-bearing coverage point, since post-restart delivery is the headline scenario this whole PRD exists for. |

**Before starting:** Confirm task 1b's PR has merged. Read `TeammateManager.stopByAgentId`'s
docstring in full (`TeammateManager.ts:2041-2081`) before starting your own edits — it documents the
exact same class of gap for a different action and the fix pattern this task should mirror.

---

## GitHub Context

**Issue:** TBD — created by PM agent at execution start
**Feature Issue (Parent):** TBD — created by PM agent at execution start
**Branch:** `worktree/teammate-resume-reliability-1c`
**Target:** Determined by PM agent based on execution mode (feature branch or main)

---

## Commit Guidelines

Use Conventional Commits:
```
fix(teammates): thread sessionId and start the session so a post-restart resume-failure wake actually reaches the lead
```

Types: feat, fix, refactor, test, docs, chore

---

## Deliverables

None beyond the files above (inferred — not captured at interview; `tasks.yaml` has no
`deliverables` field for this task). The widened `interruptWithMessage`/`emitTeammateMessageWhileIdle`
signatures and the `onTeammateMessageWhileIdle`/`ai:sendMessageToTeammate` session-activation fix are
the only artifacts this task produces.

---

## Validation Checklist

Before creating PR:
- [ ] All success criteria met
- [ ] Build passes: `npm run build`
- [ ] Type check passes: `npm run typecheck`
- [ ] No `never_touch` files modified
- [ ] `packages/electron/src/main/**` changes flagged for review per `require_review`
- [ ] Branch rebased on target branch (feature branch or main)

---

*Generated by NIMBLE Brief Writer*
*PRD: teammate-resume-reliability | Task: 1c | Wave: 3*
