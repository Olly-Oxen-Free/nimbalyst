# Pre-Execution Brief Review — 003_teammate-resume-reliability

**Reviewed:** `PRD_teammate-resume-reliability.md`, `tasks.yaml`, `execution_plan.yaml`,
`briefs/1a_*.md`, `briefs/1b_*.md`, `briefs/1c_*.md`, `briefs/2a_*.md`, against the live state of:
`packages/runtime/src/ai/server/providers/TeammateManager.ts`,
`packages/runtime/src/ai/server/providers/ClaudeCodeProvider.ts`,
`packages/electron/src/main/services/ai/MessageStreamingHandler.ts`,
`packages/electron/src/main/services/ai/AIService.ts`,
`packages/runtime/src/ai/server/SessionStateManager.ts`, and existing test files.

**Headline: no Critical findings.** Every file:line citation spot-checked against live source
matched, most of them exactly (2389/2398, 1090-1132, 1124, 1531-1552, 1537-1539, 1954-1998,
1579/1639, 2041-2081/2057, 2326-2369, 2332-2347 vs cited 2332-2346, 2549-2555, 2629-2631,
1092-1154/1103-1106/1112, 1172-1210/1180-1185, 3208-3239, `TeammateManager.test.ts:264-277`,
`research/findings.md`'s "Superseded by PRD review" section). The 1b ordering claim
(`deliverMessageToLead` must run before `handleStreamError`'s `emitAllCompleted` check) is
independently confirmed by reading `handleStreamCompletion`, which already does exactly that at
`:1515-1528`. Door A and Door B in 1c are both concrete, line-cited, and give step-by-step
instructions, not hand-waving. Wave order (1a→1b→1c→2a) and file boundaries in the briefs match
`tasks.yaml`/`execution_plan.yaml` exactly.

**Clearance: PROCEED WITH CAUTION.** The two Warnings below are execution-time steering for the
1c and 2a implementers, not blockers — nothing here contradicts the PRD or breaks a dependency.

---

## Critical Findings

None.

---

## Warnings

### Warning 1 — 1c's recommended Door B fix (Option A) disables the "session already ended" guard for all four `emitTeammateMessageWhileIdle` call sites, not just the post-restart wake

**Affected file:** `briefs/1c_teammate-resume-reliability.md:173-185` (Door B, "Option A (recommended...)")
**Also relevant:** `MessageStreamingHandler.ts:1100-1106`, `SessionStateManager.ts:72-95`

**Actual state:** `onTeammateMessageWhileIdle` (`MessageStreamingHandler.ts:1092-1154`) is the
single handler for the `'teammate:messageWhileIdle'` event, which has **four** emit sites inside
`ClaudeCodeProvider.ts`: the post-restart wake this PRD adds (via 1c's Door A threading), plus
three existing ones (`:2379`, `:2403`, `:2412` — re-triggering pending messages, finally-block
delivery, and unresolved-continuation). All four funnel through the same handler and the same
`isSessionActive` guard at line 1103. `SessionStateManager.startSession`
(`SessionStateManager.ts:72-95`) is unconditional — it does not check whether the session was
previously ended deliberately; it simply `activeSessions.set(sessionId, state)`s and marks it
`running`. The guard's own comment (`:1100-1101`) states its purpose: "don't trigger sendMessage
if session was already ended (e.g., all teammates completed between message queue and this
handler)."

**Problem:** Option A as written — "move the `startSession` call to *before* the `isSessionActive`
check, so the check always passes" — makes the check a no-op for every caller of this handler, not
just the post-restart wake. A teammate message racing in after the user has explicitly closed a
session (or after `endSession` ran for an unrelated reason) would now resurrect that session as
`running` and dispatch a `sendMessage`, which is exactly the scenario the existing guard exists to
prevent. The brief's own Edge Cases section (lines 349-352) names this exact resurrect scenario but
still recommends the option that causes it, deferring to "confirm `startSession`'s own semantics
handle this gracefully" without saying how, and `startSession`'s actual implementation does not
handle it gracefully — it has no such check.

**Correction needed:** Either (a) prefer Option B (have `ai:sendMessageToTeammate`,
`AIService.ts:3208-3239`, call `startSession` itself before triggering the wake) since that is the
only handler through which a post-restart resume can originate, leaving the other three call
sites' guard intact; or (b) if Option A is kept, scope the bypass narrowly — e.g. thread a flag
through the same `sessionId`-threading mechanism Door A already builds so `onTeammateMessageWhileIdle`
only skips the guard for `deliverMessageToLead`-originated wakes, not for the three pre-existing
call sites. Flag this to the 1c implementer before they pick an option; either fix is small, but
picking Option A as literally described is the wrong default.

### Warning 2 — 2a's Door B coverage question has a concrete answer the brief doesn't give: `teammateWakeDelivery.test.ts`

**Affected file:** `briefs/2a_teammate-resume-reliability.md:184-191, 309-313`
**Actual state:** `packages/electron/src/main/services/ai/__tests__/teammateWakeDelivery.test.ts`
already exists, with a docblock stating it covers `onTeammateMessageWhileIdle`'s drop cases —
but its actual tests exercise only `classifyTeammateWakeDelivery`/`announceTeammateWakeDelivery`
(the pure classification functions called *after* the `isSessionActive` gate), not the gate
itself. `MessageStreamingHandler.opencodeModel.test.ts` and `teammateCompletionSignal.test.ts` are
the other adjacent electron-package test files; neither touches `isSessionActive` either. Door B
(the `!isSessionActive` bail this PRD's 1c task fixes) has zero test coverage today, anywhere.

**Problem:** Brief 2a correctly recognizes it cannot prove Door B from a `runtime`-package test
file and tells the implementer to "check whether one exists before deciding whether to add one" —
but leaves that as an open question rather than naming the answer. Given tasks.yaml's own success
criteria for 2a ("Covers: resume-then-fail post-restart... reaches the lead") technically require
proving *both* doors, and brief 2a's own downgrade (Door A only, from `runtime`) is a reasonable
scope call, there's a real risk the 2a implementer either skips Door B silently (search comes back
"nothing obviously named for this") or bolts a new file on when `teammateWakeDelivery.test.ts` is
the natural, already-scoped home for it.

**Correction needed:** Name `packages/electron/src/main/services/ai/__tests__/teammateWakeDelivery.test.ts`
explicitly in brief 2a as the file to extend for Door B coverage (a test that seeds
`isSessionActive` false, fires `'teammate:messageWhileIdle'`, and asserts the wake reaches
`deliver()`/`sendMessage` after 1c's fix) — either inside this PRD's scope if the orchestrator
wants an `electron`-package task added, or explicitly deferred as follow-up work with a tracker
item, but not left as a silent maybe.

---

## Observations

### Observation 1 — tasks.yaml lists `AIService.ts` unconditionally for 1c; brief 1c makes it Option-B-conditional
`tasks.yaml`'s `files_affected` for task 1c includes `AIService.ts` unconditionally, while brief
1c's own "Files to Modify" table marks it "modify (only if you choose Option B for Door B)". This
is a harmless superset (the orchestrator's file-overlap/review-boundary logic reads `tasks.yaml`,
which already covers the `require_review` case either way) — no correction needed, but worth
knowing if `AIService.ts` shows up unmodified in 1c's diff and someone wonders why tasks.yaml
predicted it.

### Observation 2 — brief 1a's "no test file exists for `TeammateManager.ts`" framing is imprecise
Brief 1a (`Testing Requirements` section) and brief 1b (same section) both say "No pre-existing
test file exercises this branch (confirmed: `TeammateManager.ts` has no test file today...)". In
fact three exist: `TeammateManager.test.ts`, `TeammateManager.stallWatchdog.test.ts`,
`TeammateManager.sendMessageFromHost.test.ts`. The *operative* claim — that no existing assertion
references the old "delivered ... do not retry" wording, or the `handleStreamError`/`wasResumed`
behavior 1b adds — is independently verified true by direct grep (only `TeammateManager.ts` itself
and this PRD's own planning docs match "Do not retry"/"delivered to idle teammate"). No correction
needed; the imprecise phrasing doesn't point the implementer anywhere wrong.

### Observation 3 — minor line-number drift, immaterial
`tasks.yaml`/PRD cite `interruptWithMessage` as `ClaudeCodeProvider.ts:2326-2360`; brief 1b/1c cite
`:2326-2369`. Actual method spans 2326-2364 (the `try`/`catch` block around `leadQuery.interrupt()`
ends at line 2364, plus a closing brace). The idle branch is cited as `:2332-2346` in brief 1c;
actual is `:2332-2347`. All off by at most a few lines — well within the brief's own stated
tolerance ("line numbers may have shifted slightly"). No correction needed.

### Observation 4 — re-verification claim holds up
All four briefs assert they were "confirmed by direct read 2026-08-25" at multiple citation points.
Every citation independently spot-checked in this review matched live source, several exactly to
the line. This is a positive signal for the orchestrator: the brief-writer's line/behavior claims
in this PRD can be trusted without a second independent re-derivation pass at execution time,
beyond the normal "re-read before editing" hygiene each brief already asks for.

---

## Correction Summary

| # | Severity | File | Correction |
|---|----------|------|------------|
| 1 | Warning | `briefs/1c_teammate-resume-reliability.md` | Re-scope Door B's recommended fix: prefer Option B (start session in `ai:sendMessageToTeammate`) or narrow Option A's guard bypass to the `deliverMessageToLead`-originated wake specifically, not a blanket reorder that defeats the "already-ended session" guard for all four `emitTeammateMessageWhileIdle` call sites. |
| 2 | Warning | `briefs/2a_teammate-resume-reliability.md` | Name `packages/electron/src/main/services/ai/__tests__/teammateWakeDelivery.test.ts` as the concrete home for Door B coverage (or explicitly defer it via a tracker item) instead of leaving "check whether one exists" open. |

No corrections required for Observations 1-4 (informational only).

---

## Execution Clearance

**PROCEED WITH CAUTION.** No Critical findings — task order, file boundaries, line citations, the
1b ordering mechanism, and 1c's two-door fix are all verified sound against live source. The two
Warnings above should reach the 1c and 2a implementers (e.g. as `agent_context` addenda or a
pre-task note) but do not block starting Wave 1 (task 1a).
