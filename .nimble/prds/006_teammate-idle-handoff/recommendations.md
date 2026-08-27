# Brief Review — teammate-idle-handoff

**Reviewed:** 5 briefs (1a, 1b, 1c, 2a, 3a) against PRD_teammate-idle-handoff.md, tasks.yaml, and
the live codebase state of `TeammateManager.ts` (2517 lines), `ClaudeCodeProvider.ts`, and
`TeammatePanel.tsx`.

**Method:** Extracted every line-anchor claim (`:NNNN` references) and factual code-state claim
from each brief, then verified each against the actual file with `grep -n`/`sed -n`. No claim was
taken on the brief's word alone.

## Critical Findings

None.

## Warnings

None.

## Observations

1. **Off-by-one in tasks.yaml, silently corrected in the brief.** `tasks.yaml`'s task 2a
   description says the `existingTeammates.map` idle branch is at `:1461-1466`; the actual code
   (and brief `2a_teammate-idle-handoff.md`) correctly say `:1461-1467` (the branch's closing
   brace is on 1467). The brief is right; `tasks.yaml` is off by one line. No brief edit needed —
   flagging so nobody "fixes" the brief back to match `tasks.yaml`'s stale number.

2. **2a's `PersistedTeammateRow.toolCallCount?: number` addition needs no migration/fixture
   artifact — confirmed by design, not by omission.** The interface's own docblock (verified at
   `TeammateManager.ts:55-56`) states "Every field is optional: rows written before a field
   existed keep their old shape, and nothing validates them on the way back in." Old persisted
   rows without the new field simply read `undefined` and fall through the existing `?? 0`/
   `?? 0` fallbacks 2a's own change specifies. This closes the "missed deliverable" check —
   there is no schema/fixture gap here.

3. **3a's single full `npm run test:prepush` run is the correct reading, not a contradiction of
   the "targeted runs only" execution rule.** `tasks.yaml`'s own task 3a spec mandates
   `npm run typecheck && npm run test:prepush` green before handoff; the brief's guidance ("use
   `npx vitest run <file>` for targeted runs while iterating — never re-run the full suite
   repeatedly") governs the iteration loop, and the brief's Validation Checklist still lists the
   one full-suite gate at the end. No drift — the coordinator should not read this as a
   contradiction.

4. **Load-bearing ordering claim in 1b verified verbatim.** Brief 1b cites
   `TeammateManager.ts:1600-1603` as documenting the "capture before delete, call before the
   completion check" pattern (PRD 003 precedent in `handleStreamError`'s `wasResumed`-gated
   wake). Read in full at `:1598-1614`: the comment there states `deliverMessageToLead`'s
   `interruptWithMessage()` "Must run BEFORE the `emitAllCompleted` check below" because it
   "synchronously latches `isLeadBusy()`... which is what suppresses a duplicate desktop
   notification when this was also the last active teammate." This is exactly the reasoning 1b's
   brief repeats for its own `hasActiveTeammates()` ordering requirement — the analogy is sound,
   not asserted.

## Line-Anchor Verification Table (spot-checked, all resolved exactly)

| Claim | Brief | Verified location |
|---|---|---|
| `IdleTeammate` exported interface | 2a | `TeammateManager.ts:40` ✓ |
| `PersistedTeammateRow` interface | 2a | `TeammateManager.ts:57-66` ✓ |
| `handleStreamCompletion` idle branch `idleTeammates.set` | 1b/2a | `TeammateManager.ts:1542-1549` region, `managed` captured `:1531`, delete `:1534` ✓ |
| Background-agent delivery branch | 1b | `TeammateManager.ts:1562-1569` ✓ |
| `hasActiveTeammates()` gate after idle branch | 1b | `TeammateManager.ts:1573` ✓ |
| `deliverMessageToLead` private method | 1b/3a | `TeammateManager.ts:1137`, sessionId gate `:1144`, formatted-message template `:1170` ✓ |
| `sentMessageToLead` per-stream local | 1b/3a | declared `:1828`, set `:1982` ✓ |
| `killAll` body / blanket override / emit call | 2a | `:2078`, override map `:2109`, emit `:2111` ✓ |
| `emitTeammateUpdate` push loop (idle) | 2a | `:1488-1501` ✓ |
| `emitTeammateUpdate` `existingTeammates.map` idle branch | 2a | `:1461-1467` (brief correct; `tasks.yaml` says `:1461-1466`, off by one — see Observation 1) ✓ |
| `resumeIdleTeammate` / `toolCallCount: 0` seed | 2a | method at `:2029`, seed line `:2064` ✓ |
| `rehydrateIdleTeammate` returned object | 2a | `:1295`, return block `:1323-1333` ✓ |
| `sendMessageFromHost` third branch (rehydrate) | 2a | `:1259-1272` region ✓ |
| `IdleTeammate` bare-literal test construction | 2a | `TeammateManager.stallWatchdog.test.ts:105` (`idleAlice`), `TeammateManager.resumeReliability.test.ts:119` (`idleTeammate` factory) — both omit `toolCallCount`/`lastActiveAt`, confirming the optional-field requirement is real ✓ |
| `MAX_CONTINUATIONS` private static field | 1a | `ClaudeCodeProvider.ts:268` ✓ |
| Continuation message inline string | 1a | `ClaudeCodeProvider.ts:2465`, verbatim text matches brief's quote ✓ |
| Class declaration (constant placement anchor) | 1a | `ClaudeCodeProvider.ts:209` ✓ |
| Pending-message-batch drain call sites | 1b/3a | `ClaudeCodeProvider.ts:2394`ish (`:2398` `emitTeammateMessageWhileIdle`), `:2429`, `:2452` region ✓ |
| `TeammatePanel.tsx` label line | 1c | `:402-404` (content line `:403`) ✓ |
| `TeammatePanel.tsx` `> 0` tool-count guard | 2a | `:365` ✓ |
| `.nimble/config.yaml` `require_review` / `never_touch` lists | all | confirmed; none of these 5 briefs' files are in `require_review` ✓ |

## Cross-Brief Sequencing Check (item 5)

1b and 2a both edit `handleStreamCompletion`'s idle branch region. 2a is correctly sequenced
after 1b (`depends_on: ["1b"]` in both `tasks.yaml` and the brief). 2a's brief explicitly
acknowledges 1b's change will already be present and that line numbers may have shifted: its
"File Ownership Notes" section states "re-read the current state of the idle branch before
editing; do not remove or reorder 1b's delivery call," and its "Dependencies → Upstream Tasks"
table repeats "re-read the current line numbers... since 1b's own edit sits in the same branch
and line numbers may have shifted slightly." This is exactly the acknowledgment the review
checklist asked for.

## Deliverables Section Check

All 5 briefs carry a `## Deliverables` section. 1a, 1b, 1c, 2a each state "None beyond the files
above" (valid — each is a narrow, single-file change with no independent artifact). 3a carries a
2-row table with falsifiable "done when" conditions tied to its own coverage-point list. No
missing-deliverable gaps found (see Observation 2 for the one schema-change case checked
specifically).

## Execution-Rule Embedding Check (item 6)

Verified present, verbatim or equivalent, in every brief's "Execution rules (mandatory...)"
block: no `gh pr create`/no pushes; no commits (coordinator commits); 1a/1b/1c/2a forbidden from
running `npm` commands; 3a explicitly permitted to run targeted `npx vitest run <file>` (never
the full suite repeatedly, read `.vitest/last-run.log` on failure); Task-subagent system
(`activeTasks`, PRD 004 UI) called out as never-touch in every brief.

## Correction Summary

None required — zero Critical or Warning findings.

## Execution Clearance

**Verdict: approve**

All five briefs' line anchors, D7 gating logic, sequencing rationale, and execution-rule
boilerplate check out exactly against the current codebase state. No transcription drift,
contradicted claims, or execution hazards found.
