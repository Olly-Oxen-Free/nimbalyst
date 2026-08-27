# Task Brief: 1b

**Title:** Idle handoff: deliver the teammate's captured result to the lead
**PRD:** teammate-idle-handoff
**Priority:** must
**Complexity:** 5/10
**Model:** opus
**Wave:** 1
**Feature Issue:** TBD — assigned by PM agent at execution start

---

## Objective

When a non-background teammate goes idle (finishes its turn) without having messaged the lead,
deliver its captured final output — or an explicit idle notice when it has none — into the lead's
own conversation via the existing `deliverMessageToLead` machinery, instead of silently dropping
the handoff. This is the core fix for the seam this PRD exists to close.

---

## Context

**Parent Feature:** Teammate Idle Handoff (PRD `teammate-idle-handoff`, GitHub feature issue TBD)

Nimbalyst's Agent Mode lets a lead agent spawn "teammates" — separate `query()` processes that go
`idle` between turns and can be resumed via `SendMessage`. `TeammateManager.handleStreamCompletion`
(`TeammateManager.ts:1524-1576`) is the shared completion handler for both spawn and resume paths.
Its idle branch (`:1542-1549`, reproduced below from the current file state) moves a finished
non-background teammate into `idleTeammates` and schedules only a UI status emit — **nothing
notifies the lead**:

```ts
} else if (result.capturedSessionId && !isBackground) {
  // Only go idle for real teammates, not background agents
  this.idleTeammates.set(agentId, {
    ...idleTemplate,
    sessionId: result.capturedSessionId,
  });
  console.log(`[MANAGED-TEAMMATE] "${agentId}" idle (session=${result.capturedSessionId})`);
  this.scheduleEmitTeammateUpdate(sessionId, new Map([[agentId, 'idle']]));
}
```

Contrast the background-agent branch a few lines below (`:1562-1569`), which already does the
right thing for background agents:

```ts
if (isBackground && result.capturedResultText && !result.sentMessageToLead) {
  const displayName = idleTemplate.name;
  this.deliverMessageToLead(
    sessionId, agentId, displayName,
    result.capturedResultText,
    `${displayName} completed`,
  );
}
```

**Live-observed failure** (session c29787e7, teammate "weatherman", 2026-08-27): weatherman
(haiku) made 3 real tool calls, produced a complete plain-text weather answer, and ended its turn
— it never called `SendMessage`. Its raw transcript (24-line JSONL, directly read by the
researcher) proves this definitively. Because the lead's own continuation budget had already been
exhausted 1.5s *before* weatherman went idle, `abandonIdleTeammates` (called from continuation
exhaustion) was a silent no-op — weatherman was still `running`, not yet in `idleTeammates`, when
exhaustion fired. The session then sat deferred forever with weatherman's correct answer captured
in `result.capturedResultText` and never delivered anywhere.

This task is part of **Wave 1** — independent of 1a and 1c, no dependencies. It is a prerequisite
for task 2a, which is sequenced after it because both edit `TeammateManager.ts`.

---

## Research Context

Rely on the following verified findings (`research/internal/findings.md`) — do not re-derive or
re-litigate them:

- **T1 — fields are already populated for every path.** `streamTeammateOutput`
  (`TeammateManager.ts:1745-2025` region) is the single shared implementation for spawn, resume,
  and background paths. `capturedResultText` (set at the `chunk.type === 'result'` handler,
  currently around `:1994-1998`) and `sentMessageToLead` (declared `false` at `:1828`, set `true`
  at `:1982` when a `SendMessage` targets `team-lead`/`lead`/`team_lead`) populate identically
  regardless of `isBackground`. Only the caller (`handleStreamCompletion`) discriminates — you are
  adding the missing read on the idle branch, not adding new tracking.
- **T2 — the live-process delivery chain works end-to-end from this exact call site.** After
  continuation exhaustion the session stays deferred (`isSessionActive() === true`); a
  `deliverMessageToLead` call in the idle branch routes through `interruptWithMessage`'s idle path
  → `emitTeammateMessageWhileIdle` with correctly-threaded `sessionId` →
  `MessageStreamingHandler.onTeammateMessageWhileIdle`, whose `isSessionActive` check passes. No
  changes are needed in `ClaudeCodeProvider.ts` or `MessageStreamingHandler.ts` for this task.
- **T3/T4 — latch and spam safety confirmed sound.** The 4th `deliverMessageToLead` call site you
  are adding uses the same already-audited machinery, including the existing
  `releaseIdleWakeLatch()` safety valve. `sentMessageToLead` resets to `false` on every
  `streamTeammateOutput` call (spawn, and each resume independently), so gating on
  `!result.sentMessageToLead` prevents duplicate wakes across repeated idle cycles and resumes —
  add no new suppression or queueing code.
- **Reviewer-verified: double delivery is impossible.** `sentMessageToLead` is a per-stream local
  (declared `:1828`, set `:1982`); queued teammate messages merge into one drained batch (around
  `:2394`/`:2429`/`:2452` in `ClaudeCodeProvider.ts`) — they do not duplicate.

---

## Requirements

Fulfills PRD requirements **R1** (idle handoff delivery) and **R2** (latch & spam safety, via
using existing machinery unchanged).

### 1. Add the delivery call to the idle branch, unconditionally per idle transition

In `handleStreamCompletion`'s idle branch (`:1542-1549`), after the existing
`scheduleEmitTeammateUpdate` call, add a call to `this.deliverMessageToLead(...)` for **every**
`!isBackground` idle transition — this call fires on every idle transition, not just the
first-ever one. `displayName` is `idleTemplate.name` (the display name, e.g. `"weatherman"`, not
the `agentId`, e.g. not `"weatherman@team"`).

### 2. D7 gating — notice unconditional, result body gated (do not gate the whole call)

Per PRD Decision D7 (reviewer M2, option a): **the idle notice itself is always delivered.** Only
`result.capturedResultText`'s inclusion in the message body is gated on
`!result.sentMessageToLead`. Gating the entire delivery on `!sentMessageToLead` would drop the
*final* answer of a teammate that sent a mid-stream progress message and then finished — the same
bug shape minus the wedge (a teammate that `SendMessage`'d once mid-turn and then produced a
separate final answer without a second `SendMessage` would otherwise have its final answer
silently dropped, exactly like weatherman). Concretely:

- `!result.sentMessageToLead` **and** non-empty `result.capturedResultText`: include the captured
  text in the delivered content.
- `!result.sentMessageToLead` **and** no `result.capturedResultText`: deliver a bare idle notice
  that explicitly says the teammate reported no result — **never skip delivery silently.**
- `result.sentMessageToLead === true`: deliver a bare idle notice only; do **not** include
  `capturedResultText` (it would be a duplicate — the teammate's `SendMessage` already delivered
  it via the call at `:1981`).

### 3. Message content and summary shape

Content: identify the teammate, state that it finished its turn and is now idle (can be resumed
via `SendMessage` or shut down). Wording is your call (not mandated verbatim) but must satisfy the
above three cases. Summary shape (mandated): `'{displayName} idle'` for the has-content and
bare-notice-with-prior-SendMessage cases, `'{displayName} idle (no result)'` for the
no-result case.

### 4. Call-site ordering — before `hasActiveTeammates()`

Place the new `deliverMessageToLead` call **before** the `hasActiveTeammates()` check at `:1573`
(the same check that gates `emitAllCompleted`). This matches the load-bearing ordering already
documented in this file around `:1600-1603` (in `handleStreamError`, task 1b of PRD 003's
precedent for exactly this reason): `deliverMessageToLead` → `interruptWithMessage` synchronously
latches `isLeadBusy()` (mid-turn via `leadQuery !== null`, or idle-but-live via
`teammateIdleMessagePending`), which is what suppresses a duplicate desktop notification if this
idle transition also happens to be the last active teammate. If your call runs *after* the
`hasActiveTeammates()`/`emitAllCompleted` check instead, the guard could read `false` for the
last-teammate case and both the notification fires unnecessarily and the wake risks landing on an
already-ended session.

### Explicit anti-goals (do not implement)

- **Do not touch `ClaudeCodeProvider.ts` or `MessageStreamingHandler.ts`.** T2 confirms the
  delivery chain needs no changes for the live-process case.
- **Do not modify `abandonIdleTeammates`.** Per PRD Decision D3, the exhaustion-race no-op this
  task fixes indirectly is made moot by the idle transition itself now waking the lead (which,
  via `interruptWithMessage`, resets `continuationCount`) — no direct change to
  `abandonIdleTeammates`'s own logic is needed or wanted.
- **Do not add any new suppression, queueing, or debounce logic.** T3/T4 confirm the existing
  machinery is sufficient. Mid-turn, this delivery interrupts the lead's active turn
  (`ClaudeCodeProvider.ts:2406-2421`) exactly as a teammate `SendMessage` does — this is accepted
  behavior, not a bug to work around.
- **Do not add a redundant `sessionId` guard.** `sessionId` may be `undefined` at this call site;
  `deliverMessageToLead` already tolerates it (`:1144` gates its logging block on `if (sessionId)`;
  `:1163`/`:1171` — the message queue push and `interruptWithMessage` call — do not require it).
- **The approved-shutdown branch (the `if (result.approvedShutdown)` branch above the idle
  branch) and the background-agent branch (`:1562-1569`) are untouched** — do not refactor them
  even if you notice similar-looking code.

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] Idle completion with `!sentMessageToLead` and non-empty `capturedResultText` calls
      `deliverMessageToLead` with the display name and a content string containing the captured
      text
- [ ] Idle completion with `!sentMessageToLead` and no `capturedResultText` calls
      `deliverMessageToLead` with an explicit no-result idle notice (never silent)
- [ ] Idle completion with `sentMessageToLead === true` delivers a bare idle notice and does NOT
      include `capturedResultText` (D7: notice unconditional, result body gated)
- [ ] Background-agent and approved-shutdown branches byte-identical in behavior; no new
      suppression/queueing code anywhere

**All criteria must pass before task is complete.**

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/runtime/src/ai/server/providers/TeammateManager.ts` | modify | Add the `deliverMessageToLead` call to `handleStreamCompletion`'s idle branch (`:1542-1549` region), gated per D7, ordered before the `hasActiveTeammates()` check at `:1573` |

### File Ownership Notes

Task 2a (`depends_on: ["1b"]`) also edits `TeammateManager.ts` — its own scope is `killAll`
(`:2078-2115`) and tool-count continuity across `emitTeammateUpdate`/`resumeIdleTeammate`/
`PersistedTeammateRow`. Sequencing exists to avoid a concurrent-edit window on the same file, and
because 2a's `managed` entry capture (task 2a: "populate them from the `managed` entry captured at
`:1531` (BEFORE the delete at `:1534`)") reads the same local variable
(`const managed = this.managedTeammates.get(agentId);` at `:1531`) this task's own idle branch sits
downstream of — do not remove or rename that variable.

---

## Implementation Guidance

### Patterns to Follow

- Read the background-result call at `TeammateManager.ts:1562-1569` — match its calling
  convention (`sessionId, agentId, displayName, content, summary`) exactly.
- Read `handleStreamError`'s existing `wasResumed`-gated wake (around `:1598-1612`, PRD 003's
  task 1b) for the exact "capture before delete, call before the completion check" pattern this
  task mirrors — note that in `handleStreamCompletion` the delete already happened at `:1534`
  *before* the idle branch runs, but `managed` was captured at `:1531` before that delete, so it
  remains available.

### Code Style

Plain template-literal strings, matching the surrounding file's style; no i18n layer for these
model/lead-facing strings in this codebase.

### Edge Cases

- **`sessionId` undefined at this call site** — tolerated by `deliverMessageToLead`, add no guard
  (see Requirements anti-goals above).
- **Mid-turn interruption is expected, not a bug** — a teammate going idle while the lead is
  actively mid-turn on something else will interrupt that turn, exactly as a teammate `SendMessage`
  already does today. This is accepted PRD-level behavior (see PRD "Primary risk" section); do not
  add batching or a delay.
- **A teammate whose turn produces no final assistant text** (residual gap noted in research "Open
  risks") has nothing to deliver as result text — this is exactly the no-`capturedResultText` case
  in Requirements item 2; the bare "reported no result" notice is the correct, intended behavior
  for this case, not a gap to close further in this task.

### Testing Requirements

No test file exists for this idle-handoff path today (confirmed by research T7 — zero existing
coverage of `killAll`, `MAX_CONTINUATIONS`, or `handlePostLeadTurnTeammateState`; this task's own
idle branch has similarly no coverage). This task does not require writing its own test — task 3a
(dedicated test task, `depends_on: ["1a", "1b", "2a"]`) covers all three D7 cases from this task's
success criteria as required coverage points.

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
- Do not touch `ClaudeCodeProvider.ts` or `MessageStreamingHandler.ts` (T2 confirms no changes
  needed for the live-process case).
- Do not modify `abandonIdleTeammates` (PRD Decision D3).
- Do not touch the Task-subagent system (`activeTasks` in `ClaudeCodeProvider.ts`, PRD 004's
  tile/popover UI) — this PRD is TEAMMATE-lifecycle only.
- Do not touch the approved-shutdown or background-agent branches in `handleStreamCompletion`.

### Files Requiring Review

`TeammateManager.ts` is under `packages/runtime/**`, not `packages/electron/src/main/**` — it is
not in `.nimble/config.yaml`'s `require_review` list. This task does not trigger the PRD's
human-review gate on its own.

---

## Dependencies

### Upstream Tasks

None — `depends_on: []`, Wave 1.

### Downstream Impact

| Task | What it needs from 1b | Why |
|------|------------------------|-----|
| 2a | This task's idle-branch edit landed first, and the `managed` local variable still captured before the `:1534` delete | 2a's own `toolCallCount`/`lastActiveAt` capture reads the same `managed` variable this task's idle branch sits downstream of; sequencing avoids a concurrent-edit window on the same file. |
| 3a | The three D7-gated delivery cases (result text, no result text, already-sent) from this task's success criteria | 3a's dedicated test file asserts `deliverMessageToLead`'s call arguments for all three cases. |

**Before starting:** No upstream dependency to verify — this task starts from the current state of
`main`/the feature branch.

---

## GitHub Context

**Issue:** TBD — created by PM agent at execution start
**Feature Issue (Parent):** TBD — created by PM agent at execution start
**Branch:** `worktree/teammate-idle-handoff-1b`
**Target:** Determined by PM agent based on execution mode (feature branch or main)

---

## Commit Guidelines

Use Conventional Commits:
```
fix(teammates): deliver a finished teammate's idle result to the lead
```

Types: feat, fix, refactor, test, docs, chore

---

## Deliverables

None beyond the files above.

---

## Validation Checklist

Before creating PR (worker does not run these commands — coordinator gates centrally; listed for
completeness/self-check only):
- [ ] All success criteria met
- [ ] Build passes: `npm run build`
- [ ] Type check passes: `npm run typecheck`
- [ ] No `never_touch` files modified
- [ ] `ClaudeCodeProvider.ts` and `MessageStreamingHandler.ts` confirmed untouched
- [ ] `deliverMessageToLead` call confirmed to precede the `hasActiveTeammates()` check inside
      `handleStreamCompletion`'s idle branch
- [ ] Branch rebased on target branch (feature branch or main)

**Execution rules (mandatory, repo-level, non-negotiable):**
- Do NOT run `gh pr create` at any point. No pushes.
- Do NOT commit — the coordinator reviews your diff, runs gates, and commits per task.
- Do NOT run `npm` commands (no typecheck/test runs) — the coordinator runs gates centrally. Edit
  only the file listed above.
- This is the TEAMMATE lifecycle (`TeammateManager.ts`/`ClaudeCodeProvider.ts`, PRD 002/003 UI
  surface) — never touch the Task-subagent system (`activeTasks` in `ClaudeCodeProvider.ts`, PRD
  004 tile/popover UI).
- Match existing code style; every changed line must trace to this task; no drive-by refactors; no
  emojis; comments citing issues use prose or GitHub issue numbers, never `NIM-###` keys.

---

*Generated by NIMBLE Brief Writer*
*PRD: teammate-idle-handoff | Task: 1b | Wave: 1*
