# Task Brief: 2b

**Title:** Revival-failure delivery without a live lead
**PRD:** agent-revival-persistence
**Priority:** must
**Complexity:** 4/10
**Model:** sonnet
**Wave:** 3
**Feature Issue:** none yet — no GitHub issue exists for this PRD. This repo never opens GitHub
PRs; land this via local merge only (see Commit Guidelines).

---

## Objective

When a revival attempt fails (resume error, missing cwd from 1b's existence check, missing SDK
session file) and there is no live lead turn to interrupt with the failure, the failure must still
reach the user: a desktop notification, and a persisted line in the session transcript visible the
next time the session is opened. Today's failure-delivery path (`deliverMessageToLead` /
`handleStreamError`'s `wasResumed` branch) assumes a live lead session exists to interrupt — true
for the idle-teammate-resume case PRD 003 built it for, not necessarily true for a revival
triggered when the whole session was closed and later reopened, or the lead itself never resumes
in this process.

---

## Context

**Parent Feature:** Agent Revival & Persistence — PRD at
`.nimble/prds/008_agent-revival-persistence/PRD_agent-revival-persistence.md`. Not filed as a
GitHub issue.

Confirmed live: `handleStreamError` (`:1610-1650`) already wakes the lead for a resumed teammate
that dies (`wasResumed` branch, `:1636-1644`, calling `deliverMessageToLead`), but
`deliverMessageToLead` (`:1140-1183`) always attempts `this.deps.interruptWithMessage(...)`
(`:1174`) regardless of whether a lead turn is actually live — for a revival with no live lead,
this either silently no-ops or throws somewhere the user never sees, per PRD 006's own
"5th call site into `deliverMessageToLead`/`interruptWithMessage`" flag in
`research/internal/dependencies.md`.

The established pattern for "this failed and there's no live turn to tell" already exists one
layer up, in `packages/electron`: `MessageStreamingHandler.ts`'s `onTeammateMessageWhileIdle`
handler (confirmed live at `:1092-1169`) calls `classifyTeammateWakeDelivery` /
`announceTeammateWakeDelivery` (from PRD 003/006's work) with a `notifyUndelivered` callback
(`:1140-1148`) that calls `notificationService.showAgentFailureNotification(sessionId,
sessionTitle, reason, workspacePath)` — confirmed live signature at `NotificationService.ts:
640-660`. The same file's `onTeammatesAllCompleted` handler uses the identical call
(`:1224-1236`) for the batch-outcome case. This is the reviewer-confirmed
"NotificationService agent-notification path" the PRD's Review Outcome section names — it is
`showAgentFailureNotification`, not a literal API named "agent-notification."

The **persisted transcript line** half of this requirement has its own established mechanism,
distinct from `NotificationService`: `TeammateManager`'s own `deliverMessageToLead` writes a raw
transcript chunk via `this.deps.logNonBlocking(sessionId, 'claude-code', 'output',
JSON.stringify(chunk), { messageType: ... })` (confirmed live at `:1157-1161`) followed by
`this.deps.emit('message:logged', { sessionId, direction: 'output' })` (`:1178-1181`) — this raw
log write is what the two-tier transcript architecture (`TRANSCRIPT_ARCHITECTURE.md`:
`ai_agent_messages` raw → `TranscriptTransformer` derives canonical `ai_transcript_events`) turns
into something visible on next open. **This task's "TranscriptWriter" deliverable is this same
`logNonBlocking` + `message:logged` pattern**, not a separate class to build or call.

This task is part of **Wave 3**, alongside 2a — both touch `TeammateManager.ts`; the execution
plan flags a likely serialization point. This task's failure path fires specifically when 2a's
widened gate admits a revival attempt that then fails.

---

## Research Context

### Patterns to Follow

- **`showAgentFailureNotification(sessionId, sessionName, reason, workspacePath)`** —
  `NotificationService.ts:640-660`, confirmed live. Already called from two sites in
  `MessageStreamingHandler.ts` (`:1140-1148`, `:1224-1236`) with an identical shape: resolve
  `sessionTitle` via `getCurrentSessionTitle(sessionId)`, then call with a short `reason` phrase.
  Reuse this exact call, do not invent a new notification path.
- **`logNonBlocking` + `message:logged` emit** — `TeammateManager.ts:1157-1161`, `:1178-1181` (the
  pattern inside `deliverMessageToLead`) is the reference implementation for "write a system line
  the transcript will render on next open." Follow this shape for the failure line: a JSON chunk
  with a distinguishing `type` (e.g. `'revival_failed'`, consistent with the existing
  `'teammate_message_to_lead'` convention at `:1149`), `_isTeammateOutput: true` if appropriate, a
  `content` string describing the failure, and the same `logNonBlocking`/`message:logged` pair.
- **`classifyTeammateWakeDelivery` / `announceTeammateWakeDelivery`** (imported into
  `MessageStreamingHandler.ts`, PRD 003/006 work) is the existing outcome-classification pattern
  for "is there actually a live turn to deliver to, or not." Read this pair before writing new
  branching logic — this task's "no live lead" detection should reuse or closely mirror it rather
  than inventing a second way to ask the same question.

### Known Issues to Address

- ⚠️ **`deliverMessageToLead`'s unconditional `interruptWithMessage` call is the actual gap.**
  Confirmed live, `:1140-1183`: nothing in this function checks whether a lead turn is live before
  calling `this.deps.interruptWithMessage(formattedMessage, sessionId)` (`:1174`). For the
  in-process resumed-teammate-dies case PRD 003 built this for, the lead is always live by
  construction (the teammate was resumed *from* a live lead's SendMessage call). For a revival
  triggered from the UI (task 3a) with no live lead turn, this assumption breaks — this task must
  either add a liveness check before `deliverMessageToLead` is called on the revival-failure path,
  or introduce a separate revival-specific failure handler that does the check `deliverMessageToLead`
  currently skips. Do not change `deliverMessageToLead`'s existing unconditional behavior for its
  current callers (`:1581`, `:1596-1600`, `:1637-1643`, `:2013`, `:2049-2053`) — those all have a
  live lead by construction; this task adds a **new, revival-specific** branch, it does not modify
  the shared function's contract for its existing callers.
- `TeammateManagerDeps` (`:112-136`) has no existing hook for "is the lead turn live" —
  `isLeadBusy()` lives on `ClaudeCodeProvider`, not `TeammateManager` (confirmed by
  `resumeReliability.test.ts`'s own header comment, `:22-28`: "`TeammateManager` never sees
  `leadQuery`/`isLeadBusy`"). You likely need either a new `deps` method the host provider
  implements, or to push the liveness check up to the `electron`/`ClaudeCodeProvider` layer (where
  `classifyTeammateWakeDelivery` already lives) rather than inside `TeammateManager` itself — this
  is a real architectural decision, not a one-line fix. Read
  `MessageStreamingHandler.ts:1092-1169` in full before deciding where the check belongs.

### Recommended Approach

- Given the "no live lead" liveness check already lives at the `electron`/`MessageStreamingHandler`
  layer (via `classifyTeammateWakeDelivery`), the cleanest shape is likely: `TeammateManager`'s
  revival-failure path emits an event (parallel to the existing `teammate:messageWhileIdle` /
  `teammates:allCompleted` events `MessageStreamingHandler.ts` already listens for) that the
  `electron` layer picks up and classifies exactly as it does today for the idle-message-while-lead-
  down case, then routes to `notifyUndelivered`'s existing `showAgentFailureNotification` call —
  reusing the classification machinery rather than duplicating it inside `runtime`.
- Independently of where the notification fires, the persisted transcript line
  (`logNonBlocking`/`message:logged`) can be written unconditionally from `TeammateManager` at the
  moment the revival failure is detected — this half does not need the liveness classification,
  since a persisted line is safe to write whether or not a lead turn is live (it just sits in the
  transcript until the session is next opened).
- With a live lead, PRD 003's `deliverMessageToLead` wake must be reused **unchanged** — do not
  duplicate or fork this codepath for the live-lead case; only add the new branch for the no-live-
  lead case.

### Dependencies

**File Dependencies:**
- 1b's typed missing-directory failure — this is one of the concrete triggers this task's fallback
  delivery must handle (alongside a resume error from the SDK itself, and a missing SDK session
  file).
- 2a's widened gate — a revival failure is only reachable once 2a admits a `completed`/`errored`
  row into the resume path in the first place.

**Library Dependencies:** None new.

---

## Requirements

1. A revival attempt that fails with no live lead turn produces (a) a desktop notification via
   `notificationService.showAgentFailureNotification` and (b) a persisted system line in the
   session transcript via the existing `logNonBlocking`/`message:logged` pattern.
2. With a live lead turn, the existing `deliverMessageToLead`/`interruptWithMessage` wake fires
   exactly as it does today — unchanged, not duplicated.
3. The three concrete failure triggers named in the PRD are all covered: resume error (SDK-level
   failure from `streamTeammateOutput`), missing cwd (1b's typed failure), missing SDK session
   file (an SDK-level resume error — verify whether the SDK surfaces this distinctly from a
   generic resume error, or whether it's indistinguishable at this layer; if indistinguishable,
   say so in your implementation notes rather than inventing a distinction the SDK doesn't expose).
4. Red-first unit tests for both the no-live-lead and live-lead paths.

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] A revival failure with no live lead produces both a notification and a persisted transcript
      line — verified by a test that asserts both side effects, not just one
- [ ] A revival failure with a live lead reuses the existing `deliverMessageToLead` wake,
      unchanged from current behavior — verified by a test showing the live-lead path is
      unaffected by this task's changes
- [ ] The liveness check (live lead vs. not) is implemented at the appropriate layer — documented
      in your implementation notes if you had to push logic up into
      `electron`/`ClaudeCodeProvider`/`MessageStreamingHandler` rather than keeping it entirely in
      `TeammateManager`
- [ ] `npm run typecheck` and `npm run test:prepush` both pass

**All criteria must pass before task is complete.**

---

## Deliverables

None beyond the files above.

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/runtime/src/ai/server/providers/TeammateManager.ts` | modify | Revival-failure detection; persisted transcript line via `logNonBlocking`/`message:logged`; new event emit (if the liveness check is pushed to `electron`) for the no-live-lead case. |
| `packages/electron/src/main/services/NotificationService.ts` | modify (only if a new notification variant is needed — likely reuses `showAgentFailureNotification` unchanged; verify before adding a new method) | Confirm `showAgentFailureNotification`'s existing signature covers the revival-failure reason string; add a new method only if it genuinely cannot. |
| `packages/runtime/src/ai/server/transcript/parsers/ClaudeCodeRawParser.ts` | modify | **Required, not optional — see Known Issues below.** Without this, the persisted `'revival_failed'` chunk this task writes has no consumer and silently vanishes from the rendered transcript. |

### File Ownership Notes

Shares `TeammateManager.ts` with 2a — 2a now lands first (this task's `depends_on` was
corrected during brief review to include `"2a"`; the persisted PRD-003 test guard). No longer
concurrent with 2a, so no coordination needed there.

- **Critical, found during brief review — the write side alone is not enough.** The sibling
  pattern this task is told to follow, `'teammate_message_to_lead'`
  (`ClaudeCodeRawParser.ts:446-464`), is gated `this.teammateProjection && parsed.type ===
  'teammate_message_to_lead'` — it only renders when reparsing INTO a teammate's own projected
  thread view, never into the lead's own session transcript. The parser's dispatch is a closed
  if/else-if chain over `parsed.type` with no catch-all (confirmed live: the branch's own comment
  says an unmatched type "vanishes from the thread"). If this task writes a `'revival_failed'`
  chunk and adds no parser branch for it — or copies the sibling branch's `teammateProjection`
  gate verbatim — the failure notification fires (task 2's other half) but the persisted
  transcript line never appears anywhere, including in the lead's own transcript the user
  actually reopens after a failed unattended revival. This defeats R6 (persisted evidence on next
  open) silently, with no error to signal it.
  **Fix:** add a new `else if (parsed.type === 'revival_failed')` branch, **unconditional — do
  NOT gate it on `this.teammateProjection`**, since the reader who needs this line is the lead
  session's own transcript, not a teammate-projection view. Push a `system_message` descriptor
  (`systemType: 'status'`, `searchable: false`) the same shape as the sibling branch produces.
  **Test this specifically**: a unit test asserting the descriptor renders when reparsing the
  LEAD session's raw messages (`teammateProjection: false` / unset), not only when
  `teammateProjection: true`. This is the one behavior a naive copy-paste of the sibling branch
  would get backwards.

---

## Implementation Guidance

### Patterns to Follow

See "Research Context" above — read `MessageStreamingHandler.ts:1092-1169` and
`:1198-1239` in full before starting; both are the direct template for this task's electron-side
half, if the liveness check needs to live there.

### Code Style

Match `deliverMessageToLead`'s existing chunk-shape convention (`:1148-1156`) for the persisted
transcript line's JSON payload.

### Edge Cases

- A revival failure that happens to race with the session being closed mid-attempt — the
  notification and transcript-line writes should both be best-effort (matching this file's
  existing `.catch(err => console.warn(...))` posture on fire-and-forget calls, e.g. `:1174-1176`)
  and must not throw uncaught.
- Do not let this task's new failure path suppress or duplicate the existing desktop notification
  ordering constraint noted in comments at `:1566-1568` and `:1632-1635` (`deliverMessageToLead`
  must run *before* the `emitAllCompleted`/`hasActiveTeammates` check, since `interruptWithMessage`
  synchronously latches `isLeadBusy()`, which suppresses a duplicate desktop notification for the
  last-active-teammate case) — if your new branch also touches this ordering, preserve it.

### Testing Requirements

Red-first tests per success criteria: no-live-lead path produces both side effects; live-lead path
is unchanged. Follow `packages/electron/src/main/services/ai/__tests__/teammateWakeDelivery.test.ts`'s
existing mocking pattern for `notificationService.showAgentFailureNotification` (confirmed it
already mocks this exact method at `:204`) if your liveness-check logic lands in `electron`.

---

## Boundaries

### Files You MUST NOT Touch

Per `.nimble/config.yaml`: `node_modules/**`, `dist/**`, `out/**`, `out2/**`, `release/**`,
`.vite/**`.

### Files Requiring Review

`packages/electron/src/main/**` — `NotificationService.ts` falls under this. Flag your change
here explicitly even if it is a pure reuse of the existing `showAgentFailureNotification` method.

---

## Dependencies

### Upstream Tasks

| Task | What It Provides | Verify Before Starting |
|------|------------------|------------------------|
| 1b | Typed missing-directory failure | Confirm the failure shape 1b introduced is importable/catchable from wherever this task's revival-failure detection lives |
| 2a | Widened resume gate | A revival failure is only reachable through 2a's admitted resume path — confirm 2a has landed before writing this task's failure-trigger tests |

### Downstream Impact

None within this PRD's scope (1a-3b) — 3a's UI surfaces the eligibility state this task's failure
handling protects, but does not itself depend on 2b's internals.

**Before starting:** Verify 2a has landed (the widened gate is what makes a revival attempt
reachable) and 1b has landed (the missing-cwd typed failure is one of this task's three triggers).

---

## GitHub Context

**Issue:** none yet
**Feature Issue (Parent):** none yet
**Branch:** `worktree/agent-revival-persistence-2b`
**Target:** Local merge only — this repo never opens a GitHub PR.

---

## Commit Guidelines

Use Conventional Commits:
```
feat(teammates): deliver revival failures via notification + transcript line when no lead is live
```

---

## Validation Checklist

Before landing (local merge, not a PR):
- [ ] All success criteria met
- [ ] Build passes: `npm run build`
- [ ] Type check passes: `npm run typecheck`
- [ ] Test gate passes: `npm run test:prepush`
- [ ] No `never_touch` files modified
- [ ] Tests added
- [ ] Branch rebased on target branch
- [ ] `NotificationService.ts` change (if any) flagged for review per `require_review`

---

*Generated by NIMBLE Brief Writer*
*PRD: agent-revival-persistence | Task: 2b | Wave: 3*
