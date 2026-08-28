# Pre-Execution Review: PRD 008 agent-revival-persistence (briefs 1a, 1b, 2a, 2b, 3a, 3b)

**Reviewed:** 2026-08-28. Scope: the six in-scope briefs against `tasks.yaml`,
`execution_plan.yaml`, and `PRD_agent-revival-persistence.md`. Task 4a is deliberately
deferred/skipped per instructions — not flagged.

**Method:** every file:line claim in each brief was checked against the live source
(`TeammateManager.ts`, `TeammateTileRail.tsx`, `TeammateThreadPopover.tsx`, `TeammatePanel.tsx`,
preload `index.ts`, `AIService.ts`, `NotificationService.ts`, `MessageStreamingHandler.ts`,
`ClaudeCodeRawParser.ts`, and the four referenced test files). All checked claims matched live
code (line numbers drift by a few lines in a couple of spots from ordinary git churn — not
flagged as findings, since the semantic claims are accurate).

**Bottom line on the consent-sensitive chain:** it holds end to end. 1a settles (not hedges) that
both `stop`/`stopByAgentId` branches and `killAll`'s idle-teammate branch write
`endReason: 'user-shutdown'`, not `'finished'` — verified against the live code, where the
running-teammate branch's `status` is `'errored'` and the idle branch's `status` is `'completed'`,
so without this decision a user-initiated Stop would be indistinguishable from a genuine error or
clean finish and would silently pass 2a's gate. 2a's eligibility function excludes
`'user-shutdown'` from the default revivable set and requires an explicit `confirmedUserShutdown`
flag (still subject to the 24h window). 3a wires exactly that flag behind a `useConfirmDialog`
"Revive" step, and only for `'user-shutdown'` rows — non-`user-shutdown` eligible rows get a bare
compose box, matching 2a's default-eligible path. No point in the chain silently resurrects a
deliberately-shut-down teammate.

---

## Critical Findings

### Finding 1 — 2b's new `'revival_failed'` transcript chunk type has no rendering branch; the persisted line will silently vanish

**Affected File:** `briefs/2b_agent-revival-persistence.md` (Requirement 1, "Recommended
Approach", "Files to Modify" table)
**Actual State:** `packages/runtime/src/ai/server/transcript/parsers/ClaudeCodeRawParser.ts` is a
closed `if (...) {} else if (...) {} else if (...) {} ...` chain over `parsed.type` (confirmed
live, lines ~145-464) with **no trailing `else` / catch-all branch** for the JSON-parse-succeeded
path. The existing `'teammate_message_to_lead'` branch (`:443-464`) has this comment directly
above it: *"Synthetic chunk TeammateManager writes when a teammate reports back
(deliverMessageToLead). No SDK analogue, so without this branch it matches nothing and vanishes
from the thread."* — i.e. this exact failure mode is already a documented, known hazard in this
file for exactly this style of synthetic chunk.

**Problem:** 2b's brief instructs writing a new synthetic chunk via `logNonBlocking` with
`type: 'revival_failed'` (its own suggested tag), modeled explicitly on the
`'teammate_message_to_lead'` pattern — but the brief's "Files to Modify" table only lists
`TeammateManager.ts` and (conditionally) `NotificationService.ts`. It never lists
`ClaudeCodeRawParser.ts`. Without a new `else if (parsed.type === 'revival_failed')` branch there,
`logNonBlocking` will still write the raw chunk to `ai_agent_messages` (so the notification half of
R5 fires), but `TranscriptTransformer`'s derivation of canonical `ai_transcript_events` from that
raw chunk produces **no descriptor at all** — the chunk is silently dropped, exactly as the
existing comment warns for the sibling type. This directly breaks 2b's own success criterion "a
persisted system line in the session transcript visible on next open" and R5's acceptance
criterion — the notification fires, but the transcript half of the requirement silently fails.

**Correction Needed:** Add `packages/runtime/src/ai/server/transcript/parsers/ClaudeCodeRawParser.ts`
to 2b's Files to Modify table, with an instruction to add a rendering branch for the new
synthetic chunk type (mirroring the `'teammate_message_to_lead'` branch's shape at `:443-464`:
resolve a display string, push a `system_message` descriptor). Add a test asserting the chunk
round-trips through the parser into a rendered `system_message`, not just that
`logNonBlocking`/`message:logged` were called. **One more sharpening beyond mirroring the
sibling branch verbatim:** the `'teammate_message_to_lead'` branch is gated on
`this.teammateProjection` (`:446`) — it only renders in the teammate-thread projection, not the
lead session's own transcript. R5 requires the failure line be "visible on next open" in the
*session transcript* the user actually opens (the lead's view). If 2b's new branch copies the
`teammateProjection` gate as-is, the line would render in the teammate-thread view but stay
invisible in the lead transcript — the view most users will actually reopen. The correction must
say explicitly: the new branch renders unconditionally (or at least in the lead/non-projected
view), and the round-trip test must assert the descriptor appears when parsing runs in the
lead-transcript (non-projection) mode, not only under `teammateProjection = true`.

---

## Warnings

### Finding 2 — `tasks.yaml`/`execution_plan.yaml` don't encode 2b's actual dependency on 2a

**Affected File:** `tasks.yaml` (task `2b`, `depends_on: ["1b"]`), `execution_plan.yaml` (wave 3:
`["2a", "2b"]`, note: "both touch TeammateManager.ts, coordinator may serialize")
**Actual State:** 2b's own brief states, in "Dependencies → File Dependencies": *"2a's widened
gate — a revival failure is only reachable once 2a admits a `completed`/`errored` row into the
resume path in the first place,"* and in "Downstream Impact" upstream table: *"2a | Widened
resume gate | ... confirm 2a has landed before writing this task's failure-trigger tests,"* and in
"Before starting": *"Verify 2a has landed ... and 1b has landed."* This is a real, brief-author-
acknowledged dependency, not just a shared-file coordination concern.

**Problem:** The formal dependency graph (`tasks.yaml`'s `depends_on`) only encodes the file-
conflict concern ("both touch `TeammateManager.ts`, coordinator may serialize") as a wave-level
prose note, not as a `depends_on` edge. If the execution coordinator schedules wave-3 tasks by
`depends_on` alone (both depend only on wave-1/2 tasks, no edge between them) rather than by the
prose note, 2b could be dispatched to a worktree/branch that doesn't yet have 2a's eligibility
function, making its own success criteria ("a revival failure is only reachable through 2a's
admitted resume path") impossible to write correctly against, or requiring a rebase mid-task.

**Correction Needed:** Add `"2a"` to task `2b`'s `depends_on` in `tasks.yaml`, and update
`execution_plan.yaml`'s wave-3 note (or split 2b into its own wave 4 slot before the current wave
4, if the coordinator can't express same-wave ordering) so the dependency is enforced, not just
described in prose.

---

## Observations

### Observation 1 — All deep file:line claims verified accurate

Spot-checked against live code: `PersistedTeammateRow` (`:59-69`... now `:59-68`, one field
short of the brief's count until 1a/1b land — expected, since the brief describes the target
state), `RESUMABLE_PERSISTED_STATUSES` (`:183`, exact), `abandonIdleTeammates` (`:279-296`, within
the brief's `:280-298` range), `stop`/`stopByAgentId` (`:2164-2186`/`:2190-2210`, matches — and
confirms the running-branch/idle-branch status split that motivates 1a's settled `'user-shutdown'`
decision), `killAll` (`:2110-2141`, matches), `handleStreamCompletion`/`handleStreamError`
(`:1533`/`:1610`, matches), the `TeammateTileRail.tsx`/`TeammateThreadPopover.tsx` `canCompose`
duplication and "no process left" comment (both confirmed character-for-character identical, and
`TeammatePanel.tsx` confirmed to have no `canCompose`/compose box at all — 3a's file-list
correction to `tasks.yaml` is itself correct), the preload `aiSendMessageToTeammate` 3-arg
signature, `AIService.ts:3212` handler, `showAgentFailureNotification` at `NotificationService.ts:640`,
`MessageStreamingHandler.ts`'s `classifyTeammateWakeDelivery`/`announceTeammateWakeDelivery`
usage at both call sites, and the exact test bodies at `sendMessageFromHost.test.ts:145-198`
(the "second boot" describe block and the terminal-status regression test 2a must rewrite). No
mismatches found beyond ordinary line-drift.

### Observation 2 — 24h eligibility window is a real, named, tested constant, not prose

2a's brief specifies `REVIVAL_ELIGIBILITY_WINDOW_MS = 24 * 60 * 60 * 1000` declared near
`RESUMABLE_PERSISTED_STATUSES`, injectable `now` for deterministic tests, and an explicit
"missing `endedAt` → not gated on age" rule distinct from 1a's `endReason` `??` default — this is
correctly scoped as a separate judgment call from 1a's default, not conflated with it. Requirement
8 and the success-criteria checklist both require boundary tests (within-window, past-window,
missing-`endedAt`), so this isn't a prose-only mention.

### Observation 3 — 2a's regression-test inversion is a genuine rewrite, not an add-alongside

Verified: the brief quotes the exact current test body at `sendMessageFromHost.test.ts:191-198`
and instructs rewriting the same test (not adding a parallel one) to assert the new contract, with
a citation comment. This satisfies decision D3 ("rewrite openly, never delete quietly") and avoids
leaving a contradictory old test in the suite.

### Observation 4 — 2b's failure-delivery design correctly reuses PRD 003/006 machinery, no parallel mechanism invented

Verified: 2b's brief instructs reusing `showAgentFailureNotification` (the exact call already used
at `MessageStreamingHandler.ts:1142` and `:1229` for the idle-message and all-completed cases) for
the notification half, and reusing/mirroring the `logNonBlocking`/`message:logged` pattern already
used by `deliverMessageToLead` (`:1157-1161`, `:1178-1181`) for the transcript half — not a new
notification path or a new transcript-write mechanism. It explicitly requires the existing
live-lead `deliverMessageToLead` wake stay unchanged for its current callers, with the new
no-live-lead branch added alongside rather than forking it. On the "where does the liveness check
live" question, the brief correctly identifies that `isLeadBusy()` lives on `ClaudeCodeProvider`,
not `TeammateManager` (per `resumeReliability.test.ts`'s own header comment,
"`TeammateManager` never sees `leadQuery`/`isLeadBusy`"), and recommends pushing the check to the
`electron`/`MessageStreamingHandler` layer where `classifyTeammateWakeDelivery` already runs —
reusing that classification machinery rather than duplicating it inside `runtime`. This is
architecturally sound and consistent with PRD 003/006's precedent, not a new parallel mechanism.

### Observation 5 — 3b's restart-path test matches PRD 003's own "second boot" precedent for what restart-path testing means here

Verified: 3b's brief instructs constructing a fresh `TeammateManager` instance with empty
`managedTeammates`/`idleTeammates` maps (never calling any spawn method on it), seeding only the
mocked `AISessionsRepository`'s backing array with a persisted row, then calling
`sendMessageFromHost` directly — this is the identical shape already used by
`sendMessageFromHost.test.ts`'s own `describe('TeammateManager.sendMessageFromHost after a
restart', ...)` block (`:145-182`, confirmed live), which is this codebase's established
"restart" vocabulary: a real process restart is simulated by constructing a manager with no
process-boundary-crossing state, not a superficial happy-path resume test against a manager that
was never actually "restarted." 3b's test is additive to a different file
(`resumeReliability.test.ts`) but follows the same pattern, seeds the row shaped exactly as 1a's
`abandonIdleTeammates` writes it (`endReason: 'lead-abandoned'`), and asserts the resume path (not
a fresh spawn) was taken — this is a genuine restart-adjacent race test, not a rebadged
happy-path test.

### Observation 6 — 3a's IPC signature widening isn't flagged for `IPC_GUIDE.md`/preload doc updates

3a widens `aiSendMessageToTeammate`'s preload signature (3 args → 4) and its `AIService.ts`
handler. This is an existing-channel parameter addition, not a new IPC channel, so it likely
doesn't require the full `IPC_GUIDE.md` treatment — but the brief doesn't mention verifying no
other caller of `aiSendMessageToTeammate` breaks by omitting the new optional 4th arg (should be
safe if made optional/defaulted, but worth a one-line explicit check in the brief). Not blocking;
correction optional.

### Observation 7 — 1b's cwd fix is correctly scoped, no scope creep

Confirmed: 1b changes exactly `rehydrateIdleTeammate`'s single fallback line to prefer
`entry.cwd` (the specific row's own persisted cwd) over `this.lastUsedCwd`/`process.cwd()`, with
an explicit "no worktree-cleanup coupling" exclusion citing the resolved open question. It does
not touch `spawnManagedTeammate`/`spawnBackgroundAgent`'s live-process cwd handling or any other
cwd computation path.

---

## Correction Summary

| Finding | Severity | Action |
| --- | --- | --- |
| 1 | Critical | Add `ClaudeCodeRawParser.ts` to 2b's Files to Modify; require a rendering branch + test for the new synthetic chunk type. |
| 2 | Warning | Add `"2a"` to task `2b`'s `depends_on` in `tasks.yaml`; tighten `execution_plan.yaml`'s wave-3 note from advisory to enforced ordering. |

## Execution Clearance

**PROCEED WITH CAUTION** — one Critical finding (Finding 1) should be corrected in 2b's brief
before execution, since it would otherwise produce code that passes 2b's own tests (which per the
brief's own guidance would likely only assert `logNonBlocking`/`message:logged` were called, not
that the line renders) while silently failing the user-visible half of R5. The dependency-graph
gap (Finding 2) is lower risk given the execution plan's prose acknowledgment of the file conflict,
but should still be fixed for deterministic scheduling. No findings in the consent-sensitive
`endReason`/gating/UI chain (1a → 2a → 3a) — that chain was the primary audit target and holds.
