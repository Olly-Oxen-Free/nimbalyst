# Task Brief: 2a

**Title:** Widen the revival gate (invert the PRD 003 terminality contract)
**PRD:** agent-revival-persistence
**Priority:** must
**Complexity:** 4/10
**Model:** sonnet
**Wave:** 3
**Feature Issue:** none yet — no GitHub issue exists for this PRD. This repo never opens GitHub
PRs; land this via local merge only (see Commit Guidelines).

---

## Objective

Replace the blanket `RESUMABLE_PERSISTED_STATUSES` status check with an eligibility function over
`(status, endReason, sessionId presence, endedAt age)`, so a `completed`/`errored` teammate with a
persisted `sessionId`, ended within the last **24 hours**, becomes resumable — except
`'user-shutdown'` rows, which additionally require an explicit-confirm flag the UI (task 3a)
supplies. This is the core gate-widening this whole PRD exists to deliver, and it requires
**consciously rewriting**, not silently editing, the named regression test that currently pins the
old "terminal means dead" behavior.

**Settled decision, not open for this task to revisit:** the default eligibility window is
**hardcoded at 24 hours** from `endedAt` (1a's field). This is a resolved product decision, not a
placeholder — do not leave it unimplemented or defer it to a follow-up task. It may become
configurable later; that is explicitly out of scope here.

---

## Context

**Parent Feature:** Agent Revival & Persistence — PRD at
`.nimble/prds/008_agent-revival-persistence/PRD_agent-revival-persistence.md`. Not filed as a
GitHub issue.

Confirmed live: `TeammateManager.RESUMABLE_PERSISTED_STATUSES = new Set(['idle', 'running',
'blocked'])` (`TeammateManager.ts:183`), consumed at exactly one site,
`rehydrateIdleTeammate:1323`:
`if (!entry.status || !TeammateManager.RESUMABLE_PERSISTED_STATUSES.has(entry.status)) return undefined;`
— with the adjacent comment (`:1320-1323`) stating this is a deliberate PRD 003 decision:
"'running'/'blocked' rows are stale after a restart... 'completed'/'errored' are terminal and must
not be brought back." This decision is pinned by a named regression test,
`TeammateManager.sendMessageFromHost.test.ts:193-200`
(`'does not resume a teammate that already reached a terminal status'`), confirmed live to assert
exactly `{ delivered: false, wasIdle: false }` for a persisted row with `status: 'completed'`. This
feature exists specifically to reverse that decision for the cases 1a's `endReason` taxonomy now
distinguishes.

This is the same code path proven safe by `sendMessageFromHost` → `rehydrateIdleTeammate` →
`resumeIdleTeammate` → `streamTeammateOutput` (the `options.resume = resumeSessionId` branch,
confirmed live at `:1843-1845`) — nothing new to invent, only the gate itself changes.

This task is part of **Wave 3**, alongside 2b — both touch `TeammateManager.ts`; the execution
plan notes the coordinator may serialize them. This task's diff sits on top of both 1a (`endReason`
taxonomy) and 1b (`cwd` persistence + missing-dir failure), which both must already be present in
`rehydrateIdleTeammate` before you widen its gate.

---

## Research Context

### Patterns to Follow

- **`rehydrateIdleTeammate`** (`:1298-1338`) is the sole read/reconstruction site for a persisted
  row. Your eligibility function replaces the single-line check at `:1323`.
- **`sendMessageFromHost`** (`:1241-1279`) is the caller — it does not need a new branch; it
  already falls through to `rehydrateIdleTeammate` for any `agentId` not in `managedTeammates` or
  `idleTeammates` (true for any teammate that ever went fully `completed`, since
  `handleStreamCompletion:1533-1608` removes it from both maps). Widening the gate inside
  `rehydrateIdleTeammate` is sufficient; `sendMessageFromHost`'s control flow does not change.
- **`TeammateResumeContext`** (`:76-79`) is how the UI-invoked path threads `cwd`/`permissionsPath`
  in for a process where the lead never ran. This task should add an explicit-confirm flag to this
  same context object (or a new parameter alongside it on `sendMessageFromHost`) rather than
  inventing a separate channel — 3a's UI already supplies `resumeContext` on the compose-send call.

### Known Issues to Address

- ⚠️ **The regression test at `TeammateManager.sendMessageFromHost.test.ts:193-200` must be
  rewritten openly, never deleted quietly (decision D3).** Confirmed live — the test currently
  reads:
  ```
  it('does not resume a teammate that already reached a terminal status', async () => {
    const manager = new TeammateManager({ emit: vi.fn() } as unknown as TeammateManagerDeps);
    persistedTeammates = [persistedRow({ status: 'completed' })];
    const result = await manager.sendMessageFromHost('lead-session', 'bob@team', 'still there?');
    expect(result).toEqual({ delivered: false, wasIdle: false });
  });
  ```
  Rewrite this to assert the **new** contract: a `completed` row with a `sessionId`, an eligible
  `endReason` (e.g. `'finished'` or `'lead-abandoned'`), and an `endedAt` within the 24h window
  (e.g. `endedAt: Date.now() - 60_000`) now resumes (`delivered: true, wasIdle: true`); a
  `completed` row with `endReason: 'user-shutdown'` and no confirm flag still returns
  `{ delivered: false, wasIdle: false }`; the same row *with* the confirm flag resumes; a row
  otherwise eligible but with `endedAt` older than 24 hours (e.g. `Date.now() - 25 * 3_600_000`)
  does **not** resume. Add a comment on the rewritten test(s) citing this PRD by path
  (`.nimble/prds/008_agent-revival-persistence/PRD_agent-revival-persistence.md`) so the reversal
  is on the record, the way `TeammateManager.resumeReliability.test.ts`'s own header comment
  (`:1-36`) documents its lineage back to PRD 003's tasks 1a/1b/1c.
- The `persistedRow()` test helper (`sendMessageFromHost.test.ts:146-155`) currently has no
  `endReason`/`endedAt` field — you will need to extend it (or add a variant) to set both per test
  case, matching 1a's persisted shape.
- `RESUMABLE_PERSISTED_STATUSES` itself (`:183`) is a `Set<string>` keyed only on status; your
  eligibility function needs `endReason`, `sessionId` presence, and `endedAt` age too, so this is a
  genuine function, not a wider Set. Keep the existing `'running'`/`'blocked'` staleness handling —
  those still resume unconditionally after a restart, per the existing comment's reasoning,
  independent of `endReason`/`endedAt` (a row that never reached a terminal status has neither).
- **A row with no `endedAt`** (legacy, written before 1a/1b shipped, or — per `PersistedTeammateRow`'s
  own doc comment at `:54-58` — any row whose age cannot be determined) must not be silently
  treated as either "always eligible" or "always expired." Treat a missing `endedAt` as *not
  subject to the age cutoff* (i.e. eligible on the other criteria alone) rather than rejecting it
  outright — rejecting every legacy row with no `endedAt` would make this feature invisible for
  data written before this PRD shipped, which is a worse default than the conservative-but-
  permissive choice. Document this choice explicitly in the eligibility function's own comment,
  since it's a real judgment call, not an obvious default.

### Recommended Approach

- Write a small pure function, e.g. `isRevivalEligible(entry: PersistedTeammateRow, opts: {
  confirmedUserShutdown?: boolean; now?: number }): boolean`, called from `rehydrateIdleTeammate`
  in place of the `:1323` check. Logic:
  - `'idle' | 'running' | 'blocked'` → eligible unconditionally (existing behavior, unchanged; no
    age cutoff applies — these never had an `endedAt`).
  - `'completed' | 'errored'` with a `sessionId` present:
    - Age check first: if `entry.endedAt` is present and `(opts.now ?? Date.now()) - entry.endedAt
      > 24 * 60 * 60 * 1000`, not eligible, regardless of `endReason`. Use a named constant (e.g.
      `REVIVAL_ELIGIBILITY_WINDOW_MS = 24 * 60 * 60 * 1000`) declared near
      `RESUMABLE_PERSISTED_STATUSES` (`:183`), not a bare magic number, so a future task widening
      this to a configurable value has one obvious place to change.
    - `endReason === 'user-shutdown'` → eligible only if `opts.confirmedUserShutdown` is true
      (still subject to the age check above).
    - any other `endReason` (`'finished' | 'lead-abandoned' | 'errored'`, or missing/legacy →
      defaults to `'finished'` per 1a's `??` contract) → eligible (subject to the age check above).
  - No `sessionId`, or missing entry → not eligible (unchanged).
- Accept `now` as an injectable option (default `Date.now()`) specifically so tests can pin the
  clock deterministically rather than relying on `Date.now() - <large offset>` arithmetic at test-
  authoring time, which is fragile against slow CI runs near a boundary.
- Thread the confirm flag from `sendMessageFromHost`'s caller (ultimately 3a's UI action) through
  to `rehydrateIdleTeammate` — likely via `TeammateResumeContext` (`:76-79`) gaining a
  `confirmedUserShutdown?: boolean` field, since `resumeContext` is already the established channel
  for UI-supplied, lead-derived-but-not-lead-owned data on this call path.
- Do not change `streamTeammateOutput`/`resumeIdleTeammate` themselves — the resume mechanics are
  already correct (P1/P2 in `research/internal/patterns.md`, confirmed live at `:1843-1845`,
  `:2061-2076`); only the admission decision changes.

### Dependencies

**File Dependencies:**
- 1a's `endReason`/`endedAt` fields on `PersistedTeammateRow` — required to write both the
  `endReason` branch and the 24h age check.
- 1b's `cwd` persistence and missing-directory typed failure — `rehydrateIdleTeammate` should
  still run 1b's existence check on a now-wider set of admitted rows; do not bypass it for the
  newly-admitted `completed`/`errored` cases.

**Library Dependencies:** None new.

---

## Requirements

1. Replace the `:1323` `RESUMABLE_PERSISTED_STATUSES.has(entry.status)` check in
   `rehydrateIdleTeammate` with an eligibility function honoring `(status, endReason, sessionId
   presence, endedAt age)` as specified above.
2. **The 24-hour eligibility window is implemented as part of this function** — a `completed`/
   `errored` row whose `endedAt` is more than 24 hours old is not eligible, regardless of
   `endReason`. Use a named constant, not a magic number. This is a settled decision, not an open
   question for this task.
3. `'user-shutdown'` rows are excluded from silent revival — admitted only with an explicit
   confirm flag supplied by the caller (ultimately the UI, wired end-to-end in 3a; this task only
   needs to accept and honor the flag, not build the UI that sets it), and still subject to the
   24h window.
4. `'idle'`/`'running'`/`'blocked'` rows continue to resume unconditionally, unchanged from
   current behavior, with no age cutoff applied to them.
5. Rows with no `sessionId` are still never eligible, unchanged.
6. A row with no `endedAt` at all (legacy data) is not rejected by the age check — treat the
   absence as "age unknown, do not gate on it," per "Known Issues" above.
7. `TeammateManager.sendMessageFromHost.test.ts:193-200` is rewritten — not deleted, not left
   failing — to assert the new eligibility contract, with a comment citing this PRD.
8. Red-first tests covering: eligible `completed` row within the window resumes; eligible `errored`
   row within the window resumes; a row past the 24h window does not resume even when otherwise
   eligible; `user-shutdown` row without confirm does not resume; `user-shutdown` row with confirm
   (within the window) resumes; legacy row with no `endReason` defaults to eligible (`'finished'`);
   legacy row with no `endedAt` is not rejected on age grounds.

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] A `completed`/`errored` teammate row with a persisted `sessionId`, an eligible `endReason`,
      and an `endedAt` within 24 hours resumes through `streamTeammateOutput` via the existing
      `sendMessageFromHost` → `rehydrateIdleTeammate` → `resumeIdleTeammate` chain
- [ ] A row otherwise eligible but with `endedAt` older than 24 hours does not resume
- [ ] A `'user-shutdown'` row is gated on an explicit confirm flag — absent the flag, it behaves
      exactly as today (`{ delivered: false, wasIdle: false }`)
- [ ] The PRD 003 regression test at `sendMessageFromHost.test.ts:193-200` is rewritten (with a
      citation comment), not deleted or left red
- [ ] `'idle'`/`'running'`/`'blocked'` and no-`sessionId` behavior are unchanged
- [ ] A legacy row with no `endedAt` is not rejected purely for lacking an age
- [ ] `npm run typecheck` and `npm run test:prepush` both pass

**All criteria must pass before task is complete.**

---

## Deliverables

None beyond the files above.

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/runtime/src/ai/server/providers/TeammateManager.ts` | modify | New eligibility function (status + endReason + sessionId + 24h `endedAt` window) replacing the `RESUMABLE_PERSISTED_STATUSES` check at `rehydrateIdleTeammate:1323`; confirm-flag threading through `TeammateResumeContext`/`sendMessageFromHost`; named 24h-window constant. |
| `packages/runtime/src/ai/server/providers/__tests__/TeammateManager.sendMessageFromHost.test.ts` | modify | Rewrite the terminal-status regression test (lines 193-200) to assert the new contract including the age window, citation comment; add confirm-flag and window-boundary test cases. |

### File Ownership Notes

Shares `TeammateManager.ts` with 2b in the same wave — the execution plan flags this as a likely
serialization point. Keep this task's diff scoped to the eligibility gate, the 24h window, and
confirm-flag threading; do not touch 2b's failure-delivery plumbing (`handleStreamError`'s
no-live-lead branch) even though both tasks touch nearby code.

---

## Implementation Guidance

### Patterns to Follow

See "Research Context" above.

### Code Style

Pure function for the eligibility check — easy to unit test in isolation, matching this file's
existing style of small `private static` helpers (`colorForAgentId:1341-1347`,
`statusForManaged:1353-1358`). Named constant for the 24h window, declared near
`RESUMABLE_PERSISTED_STATUSES` (`:183`).

### Edge Cases

- An `errored` row's `endReason` should always be `'errored'` per 1a — but do not hard-code an
  assumption that `status === 'errored' implies endReason === 'errored'`; read `endReason`
  explicitly, since a future write site could in principle set status/endReason independently.
- A `completed` row whose `endReason` value is some future/unknown string (schema drift,
  `PersistedTeammateRow`'s own doc comment at `:54-58` warns nothing validates on the way in) —
  treat as the safe default (`'finished'`-equivalent, eligible) rather than throwing, consistent
  with this file's existing defensive-`??` posture.
- Clock skew / boundary precision: a row exactly at the 24h boundary is an implementation detail
  (inclusive or exclusive) — pick one, document it in the function's comment, and make sure your
  test doesn't rely on exact-boundary behavior that isn't explicitly specified (test comfortably
  inside and comfortably outside the window instead).

### Testing Requirements

See Requirement 8 above. Follow `sendMessageFromHost.test.ts`'s existing `persistedRow()` helper
pattern (`:146-155`), extended with `endReason`/`endedAt` overrides, and its `AISessionsRepository`
mock (`:19-24`). Inject `now` into the eligibility function (per "Recommended Approach") so
window-boundary tests are deterministic, not dependent on real wall-clock timing.

---

## Boundaries

### Files You MUST NOT Touch

Per `.nimble/config.yaml`: `node_modules/**`, `dist/**`, `out/**`, `out2/**`, `release/**`,
`.vite/**`.

### Files Requiring Review

None touched by this task fall under `require_review`.

---

## Dependencies

### Upstream Tasks

| Task | What It Provides | Verify Before Starting |
|------|------------------|------------------------|
| 1a | `endReason`/`endedAt` on `PersistedTeammateRow` | Confirm `entry.endReason` and `entry.endedAt` are both readable on a row returned from `rehydrateIdleTeammate`'s lookup |
| 1b | `cwd` persistence + missing-dir typed failure | Confirm the existence check still runs for newly-admitted `completed`/`errored` rows, not bypassed |

### Downstream Impact

- **3a** wires the UI's Revive/confirm action to the confirm flag this task introduces, and should
  reflect the 24h window in what it offers as "eligible for revival" (a row past the window should
  not show a Revive/compose affordance at all, to avoid a UI action the backend will silently
  refuse).
- **3b** exercises the widened gate across a restart-shaped scenario for `lead-abandoned` rows
  specifically — its seed row's `endedAt` must be within the 24h window.
- **2b** (parallel, same wave) assumes this task's widened gate is what makes a revival attempt
  possible in the first place — a revival failure 2b handles is a failure *of* the resume this
  task admits, not a new failure mode.

**Before starting:** Verify 1a and 1b have both landed in `TeammateManager.ts` — check
`PersistedTeammateRow` (`:59-69` region, line numbers will have shifted after 1a/1b's edits) for
`endReason`, `endedAt`, and `cwd` fields before writing the eligibility function.

---

## GitHub Context

**Issue:** none yet
**Feature Issue (Parent):** none yet
**Branch:** `worktree/agent-revival-persistence-2a`
**Target:** Local merge only — this repo never opens a GitHub PR.

---

## Commit Guidelines

Use Conventional Commits:
```
feat(teammates): widen revival gate to eligible completed/errored rows within 24h
```

Body should note the inverted PRD 003 test explicitly, e.g.:
```
Rewrites TeammateManager.sendMessageFromHost.test.ts's terminal-status regression
test to assert the new eligibility contract (endReason + 24h endedAt window) per
008_agent-revival-persistence.
```

---

## Validation Checklist

Before landing (local merge, not a PR):
- [ ] All success criteria met
- [ ] Build passes: `npm run build`
- [ ] Type check passes: `npm run typecheck`
- [ ] Test gate passes: `npm run test:prepush`
- [ ] No `never_touch` files modified
- [ ] Tests added/rewritten (rewritten test cites this PRD)
- [ ] Branch rebased on target branch

---

*Generated by NIMBLE Brief Writer*
*PRD: agent-revival-persistence | Task: 2a | Wave: 3*
