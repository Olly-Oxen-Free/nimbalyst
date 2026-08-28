# PRD Template (v2)

```yaml
---
feature_name: "Agent Revival & Persistence"
feature_slug: "agent-revival-persistence"
owner: "jeppcohen@gmail.com"
status: "ready"
created_date: "2026-08-28"
target_date: ""
phase: "awaiting-user-decision"
scope_type: "feature"
github_project: ""
links: [".nimble/prds/003_teammate-resume-reliability", ".nimble/prds/006_teammate-idle-handoff", ".nimble/prds/004_task-subagent-visibility"]
checkpoint_refs: []
cross_feature_blockers: []
---
```

> **NOT SCHEDULED FOR EXECUTION.** This PRD is an investigation/scoping deliverable for the
> user to review and decide whether/when to build. `/nimble:run` must NOT be invoked on it
> without an explicit user go-ahead.

---

## 1. Executive Summary

**One-liner:** Let the user revive a recently-ended agent — message a finished or abandoned
teammate and have it pick up with its original context, the way it can already be messaged while
idle.

**The honest feasibility split (research-verified, `research/internal/findings.md`):**

- **Teammate revival is a genuine, small extension of existing machinery — not new capability.**
  Spawn and resume are already one code path (`TeammateManager.streamTeammateOutput`,
  `TeammateManager.ts:1777-2057`); resume is just `options.resume = sessionId` handed to the
  Claude Agent SDK, whose docs name resuming a *completed* session as the primary use case for
  `resume`. The SDK session id is already persisted to `ai_sessions.metadata.currentTeammates[]`
  while the teammate is still running. The entire block is one deliberate PRD 003 gate:
  `RESUMABLE_PERSISTED_STATUSES = new Set(['idle','running','blocked'])` (`:183`) plus the UI's
  `canCompose` check (`TeammateTileRail.tsx:110-116`) — both pinned by a named regression test
  (`TeammateManager.sendMessageFromHost.test.ts:193-200`) that this feature consciously inverts.
- **Task sub-agent revival is NOT an extension of anything — no resume mechanism exists.** A Task
  sub-agent is an SDK-internal tool call inside the lead's single session
  (`ClaudeCodeProvider.activeTasks` has no `sessionId`; the SDK exposes no sub-agent-level
  resume). The only honest offering is **context-seeded respawn**: spawn a new teammate whose
  prompt embeds the old sub-agent's reconstructed transcript. No conversation state, permission
  state, or SDK memory carries over — a fundamentally weaker guarantee that must not be sold with
  the same "resumes as if it were the same agent" language. Scoped here as an optional,
  clearly-labeled phase 2.

**What's genuinely new (the real scope, neither undersold nor oversold):** an end-reason taxonomy
(today `completed` conflates clean-finish, user-approved shutdown, and lead-transport-death
abandonment — the last being the most valuable revival case and the second one arguably not to
be silently offered back); per-teammate `cwd` persistence (rehydration currently borrows the
lead's cwd — wrong when the team ran in its own worktree, and worktree cleanup can outlive the
rows); a revival-failure delivery target when no lead turn is live (PRD 003's failure wake
assumes a live lead to interrupt); and the compose/revive UI affordance itself.

**Who it's for:** Agent Mode users whose teammate finished (or was abandoned by a restart) and
who want one more turn out of it without re-explaining everything.

**Primary risk:** Reviving deliberately-terminated agents (user approved a shutdown → it comes
back) and resuming into a stale or deleted worktree. Both are addressed structurally (end-reason
gating; persisted cwd + existence check) rather than by heuristics.

---

## 2. Problem & Context

**User's words:** "ideally, we want some persistence so that recent agents could be revived with
their original context," as native Claude Code CLI's own multi-agent UI sometimes manages.

**Today:** a teammate that goes `completed`/`errored` is terminal. `rehydrateIdleTeammate`
(`TeammateManager.ts:1298-1338`) refuses it; `TeammateTileRail` shows it dimmed with the compose
box shut, on a code comment ("no process left to receive a message") that is inaccurate at the
SDK level — the SDK session file on disk remains resumable. The largest involuntary-loss case:
`abandonIdleTeammates` marks still-viable idle teammates `completed` whenever the lead's
transport dies (restart, abort), foreclosing them permanently even though their sessions are
sitting resumable on disk.

**Evidence:** `research/internal/findings.md` points 1-12 (all file:line-cited);
`research/external/findings.md` (SDK `resume` semantics, resume-after-completion confirmed
documented; session files are local-disk only).

---

## 3. Goals, Non-Goals & Success Metrics

### Goals

1. A `completed` (or `errored`) teammate whose SDK session id is persisted can be messaged again
   from the UI; the message resumes its SDK session with full original context via the existing
   `ai:sendMessageToTeammate` → `sendMessageFromHost` → resume chain.
2. Revival works across a Nimbalyst restart (widened `rehydrateIdleTeammate`), covering the
   abandoned-by-restart case specifically.
3. The user can tell apart — and the system gates on — *why* an agent ended: clean finish,
   user-approved shutdown, lead-abandoned, error.
4. A failed revival is reported somewhere the user will see it even when no lead turn is live.
5. (Phase 2, optional) An ended Task sub-agent offers "continue as teammate": a new agent seeded
   with the sub-agent's reconstructed transcript, labeled as a fresh agent with that context —
   never as "the same agent back."

### Non-Goals

- No cross-machine revival (SDK session files are local disk; out of scope, recorded).
- No revival of agents whose session metadata has been pruned (bounded by retention — Open Q1).
- No automatic revival — always an explicit user action.
- No new sync/collab surface; `currentTeammates` metadata stays the storage.
- No attempt to make Task sub-agent respawn carry permission or SDK memory state (impossible at
  the SDK surface used; saying otherwise would be dishonest UI).

### Success Metrics

| Metric | Baseline | Target | How Measured |
| ------ | -------- | ------ | ------------ |
| Finished teammate reachable for one more turn | 0% (gate refuses) | 100% when sessionId persisted and endReason eligible | Unit: widened gate resumes a completed row through streamTeammateOutput with options.resume set |
| Teammates lost to lead-transport death | 100% foreclosed | Revivable after restart | Unit on widened rehydrateIdleTeammate; manual restart script |
| Deliberately-shut-down teammates silently resurfacing | n/a | Never by default | Unit: endReason 'user-shutdown' requires explicit confirm |
| Revival failure visibility with no live lead | Nowhere | Always lands (notification + transcript system line) | Unit on the new fallback delivery path |

---

## 4. Requirements

### Must Have (blocks launch)

| ID | Requirement | Acceptance Criteria |
| -- | ----------- | -------------------- |
| R1 | End-reason taxonomy | Persisted teammate rows gain `endReason: 'finished' \| 'user-shutdown' \| 'lead-abandoned' \| 'errored'`, written at every terminal transition: clean idle-teardown (`stop`/`stopByAgentId`), approved shutdown request, `abandonIdleTeammates` (→ `lead-abandoned`), `killAll` error path, stream error. Missing/legacy rows default to `finished`. Wire format camelCase; STATE_PERSISTENCE `??` defaults. |
| R2 | Widened revival gate | `RESUMABLE_PERSISTED_STATUSES` (or a successor eligibility function taking status + endReason) admits `completed`/`errored` rows that have a `sessionId`; `'user-shutdown'` rows are excluded from silent revival (UI-confirm only). The PRD 003 regression test asserting terminal-means-dead is consciously rewritten to assert the new eligibility contract instead — with a comment citing this PRD. |
| R3 | Durable spawn cwd | The teammate's spawn `cwd` is persisted per-row and used on rehydration/revival instead of borrowing the lead's cwd (`:1333`); revival verifies the directory still exists and fails cleanly (R5) when it does not (worktree cleanup case). |
| R4 | Revival UI affordance | A `completed`/`errored` tile/panel row whose row is eligible opens compose (current `canCompose` gate widened); send routes through the existing host-send chain. `user-shutdown` rows show an explicit "Revive" confirm instead of a bare compose. The inaccurate "no process left" comment is corrected. |
| R5 | Failure delivery without a live lead | A revival failure with no live lead turn lands as (a) a desktop notification via the existing NotificationService agent-notification path and (b) a persisted system line in the session transcript visible on next open. With a live lead, PRD 003's `deliverMessageToLead` wake is reused unchanged. |
| R6 | Tests | Red-first unit coverage for R1-R5 following `TeammateManager.stallWatchdog.test.ts` mocking patterns; the R2 test inversion is its own reviewed change, never a silent edit. |

### Should Have

| ID | Requirement | Acceptance Criteria |
| -- | ----------- | -------------------- |
| R7 | Recently-ended ordering | Ended-agent rows carry `endedAt` so UI can show "recently ended" ordering and (later) age-based de-emphasis. |

### Could Have (Phase 2 — explicitly weaker guarantee)

| ID | Requirement | Acceptance Criteria |
| -- | ----------- | -------------------- |
| R8 | Task sub-agent context-seeded respawn | An ended Task chip/card offers "continue as new agent": spawns a teammate whose prompt embeds the `ai:getTaskSubagentTranscript` reconstruction, UI-labeled as a NEW agent seeded with that context. Copy must never claim continuity of memory/permissions. |

---

## Interview Decisions (recorded; user absent — this PRD awaits the user's build/no-build call)

- **D1 — Teammate revival and Task respawn are one PRD, two phases, two vocabularies.** They
  answer the same user request but carry different guarantees; splitting the honest-language
  requirement (R8's labeling) into a separate doc invites the two getting conflated later.
- **D2 — Gate on endReason, not on a blanket "completed is revivable".** Research point 6: three
  different situations hide inside `completed`. Blanket widening either resurrects deliberately
  killed agents or (if too strict) hides the lead-abandoned case that motivated the request.
- **D3 — Invert the PRD 003 regression test openly.** That test encodes a deliberate past
  decision (`architecture-decisions` material). The task must rewrite it to pin the *new*
  contract, citing this PRD, so the reversal is on the record — never delete it quietly.
- **D4 — No TaskInfo/session-resume for sub-agents, period.** Confirmed at both code and SDK-doc
  level: there is no second session to resume. Any design pretending otherwise would fail in
  implementation; seeded respawn is the ceiling and is labeled as such.
- **D5 — Failure fallback = notification + persisted transcript line, not a new inbox.** Reuses
  NotificationService (PRD 001-agent-visibility work) and the transcript store; no new surface.

## Open Questions (genuinely open — for the user)

1. **Retention:** where/whether `ai_sessions.metadata` rows are pruned was not located
   (`research` point 12). Any retention policy bounds how far back "recently ended" can honestly
   reach. Needs an answer before R2 ships defaults.
2. **Default eligibility window:** should revival be offered indefinitely, or only for agents
   ended within N hours/days? (SDK session files persist on disk; staleness is a UX question,
   not a technical one.)
3. **`user-shutdown` rows:** hide entirely, or show behind an explicit confirm (current spec:
   confirm)? The user deliberately ended these.
4. **Worktree lifecycle coupling:** should worktree cleanup refuse (or warn) while a revivable
   teammate row still points into the worktree, or is fail-clean-on-revive (R3) enough?
5. **Phase 2 at all:** is context-seeded Task respawn worth building, given it cannot deliver
   the "same agent" promise? It may be better served by the user just spawning a named teammate
   themselves with the sub-agent's popped-out transcript on screen.
6. **Cross-machine expectations:** revival is this-machine-only. Fine, or does the mobile/sync
   story eventually need a "not revivable here" explainer?

---

## 5. Task Breakdown

Seven tasks, four waves, phase 2 detachable. See `tasks.yaml`; `execution_plan.yaml` has waves.
Not scheduled — awaiting user decision.

## Review Outcome (reviewer, 2026-08-28)

Verdict: **approve**, no corrections required. The reviewer independently verified: every
file:line claim (all exact or within ±2); the flagship honesty claim traced to mechanics —
`abandonIdleTeammates` (`:280-298`) → `emitTeammateUpdate` (`:1447-1476`) preserves
`sessionId` via `...tm` spread on the abandoned row, so lead-abandoned teammates really are
sitting resumable; `activeTasks` confirmed to have no `sessionId` (Task sub-agent split honest);
task graph acyclic, waves correct, complexity sum correct, R1-R8 fully covered; Open Question 1
independently confirmed genuinely open (no age-based `ai_sessions` retention exists anywhere —
only a one-time migration cleanup, user-initiated deletes, and tool-output pruning); execution
hold unambiguous in all three artifacts (`status: "ready"` means reviewed/finalized per repo
convention — 005/006 use it identically — not cleared-to-execute; the gate is `phase` + banner +
both `execution_hold` fields). Cosmetic R6/R7 "Fulfills" tags applied post-review. Note: R5's
"NotificationService agent-notification path" describes `showAgentFailureNotification` /
`provider: 'agent'` events, not a literal API name.

## Research Findings

`research/internal/findings.md` (12 numbered, file:line-cited findings; the feasibility split),
`research/internal/{patterns,errors,dependencies,structure}.md`,
`research/external/findings.md` + `sources.yaml` (SDK resume semantics, resume-after-completion,
local-disk session files).
