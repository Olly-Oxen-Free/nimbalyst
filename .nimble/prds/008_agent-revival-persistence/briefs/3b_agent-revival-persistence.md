# Task Brief: 3b

**Title:** Restart-path revival (rehydration widening) end-to-end test
**PRD:** agent-revival-persistence
**Priority:** must
**Complexity:** 2/10
**Model:** sonnet
**Wave:** 4
**Feature Issue:** none yet — no GitHub issue exists for this PRD. This repo never opens GitHub
PRs; land this via local merge only (see Commit Guidelines).

---

## Objective

Prove, with a scripted test — not a manual-restart-only claim — that the single largest revival
case (a teammate `abandonIdleTeammates` marked `completed`/`lead-abandoned` because the lead's
transport died) is actually resumable after a simulated app restart: fresh `TeammateManager`
instance, empty in-memory maps, persisted metadata is all that survives, rehydration admits the
row, host-send resumes it.

---

## Context

**Parent Feature:** Agent Revival & Persistence — PRD at
`.nimble/prds/008_agent-revival-persistence/PRD_agent-revival-persistence.md`. Not filed as a
GitHub issue.

Per this repo's `end-to-end-verification.md` rule: "For any bug whose verification requires a user
`/restart` or a user manually exercising a UI flow, the first deliverable is a failing test that
the fix must make pass... no 'the code path looks right' claims." This task is that failing-test
deliverable for the restart-shaped revival scenario specifically — 2a's own tests cover the gate
function in isolation; this task covers the full shape: abandon → (simulated) restart → rehydrate
→ resume, in one scripted flow, matching how `TeammateManager.resumeReliability.test.ts`'s own
header comment (`:1-36`, confirmed live) already documents "the second boot" as a named scenario
class (see its `describe('TeammateManager.sendMessageFromHost after a restart', ...)` block,
`sendMessageFromHost.test.ts:145` — confirmed live, note this second describe block lives in the
`sendMessageFromHost` test file, not `resumeReliability`, even though this task's target file is
`resumeReliability.test.ts` per `tasks.yaml`; both patterns are valid reference points).

A "restart" in this test suite's vocabulary is not a real process restart — it is exactly what
`sendMessageFromHost.test.ts:145-182`'s existing "second boot" describe block already does:
construct a **fresh** `TeammateManager` instance (never call any spawn method on it), pre-seed the
mocked `AISessionsRepository` with a persisted row, and call `sendMessageFromHost` directly — the
fresh instance has empty `managedTeammates`/`idleTeammates` maps by construction, exactly
simulating a restart without touching a real process boundary. Follow this same shape.

This task is part of **Wave 4**, alongside 3a — disjoint files (this task touches no UI, no
non-test source), can run fully in parallel with 3a.

---

## Research Context

### Patterns to Follow

- **The "fresh instance = simulated restart" pattern** — confirmed live,
  `sendMessageFromHost.test.ts:163-182` (`'resumes a teammate held only in persisted metadata,
  seeding the lead config the resume needs'`): `new TeammateManager(...)`, never spawn anything on
  it, seed `persistedTeammates` (the mocked repository's backing array) directly, call
  `sendMessageFromHost(leadSessionId, agentId, content, resumeContext)`, assert on the result and
  on `resumeIdleTeammate`'s call arguments via `vi.spyOn(internals(manager), 'resumeIdleTeammate')`.
- **`AISessionsRepository` mock** — both `sendMessageFromHost.test.ts:19-24` and
  `resumeReliability.test.ts:46-53` mock the same module path
  (`'../../../../storage/repositories/AISessionsRepository'`); `resumeReliability.test.ts`'s
  version (`:46-53`) additionally captures `updateMetadata`'s writes back into the mutable
  `storedTeammates` array, which is the more realistic shape for this task — you need to (a) seed
  a `lead-abandoned` row, then (b) call `sendMessageFromHost` against the fresh instance, and be
  able to assert on what a subsequent `emitTeammateUpdate` would persist, if your test also checks
  the post-resume `status` transition back to `'running'`.
- **`ManagerInternals`/`internals()` cast pattern** (`sendMessageFromHost.test.ts:38-45`) is how
  these tests reach private methods (`resumeIdleTeammate`, `managedTeammates`, `idleTeammates`)
  without changing their visibility — reuse this exact cast helper, do not make anything `public`
  to accommodate the test.

### Known Issues to Address

- This task's `tasks.yaml` file target (`TeammateManager.resumeReliability.test.ts`) already has
  its own established scenario taxonomy in its header comment (confirmed live, `:1-36`) — this new
  test is a genuinely new scenario class (restart + `lead-abandoned` + widened gate), not a
  variant of 1a/1b/1c from PRD 003 that file currently documents. Add a new header comment block
  (or a clearly delimited new `describe`) explaining this test's provenance (PRD
  008-agent-revival-persistence, tasks 2a+3b) rather than silently folding it into the existing
  PRD-003-labeled scenarios, so a future reader does not misattribute it.
- The test must exercise the **actual widened gate** (2a's eligibility function) and the **actual
  `endReason`** taxonomy (1a) — not a hand-rolled stand-in. If 2a's eligibility function is not
  separately exported/importable, this test still exercises it correctly by going through
  `sendMessageFromHost` end-to-end (the public entry point), which is the more realistic test
  anyway — prefer that over reaching for internals unless the public path cannot express the
  scenario.

### Recommended Approach

1. Seed a persisted row shaped like what `abandonIdleTeammates` (1a) actually writes:
   `status: 'completed'`, `endReason: 'lead-abandoned'`, `endedAt: <some past ms>`, a valid
   `sessionId`, and (per 1b) a `cwd` pointing at a real, existing directory (e.g. `os.tmpdir()`,
   matching this test file's own `claudeConfigDir` convention at `:63-66`) so the missing-directory
   failure path from 1b does not spuriously fire.
2. Construct a fresh `TeammateManager` (no prior spawn calls on this instance).
3. Call `sendMessageFromHost(leadSessionId, agentId, 'still there?', resumeContext)` — supply a
   `resumeContext` matching `TeammateResumeContext`'s shape (`cwd`, `permissionsPath`, and 2a's
   confirm flag only if `endReason` requires it — `lead-abandoned` should not require confirm).
4. Assert `{ delivered: true, wasIdle: true }`, and assert (via `resumeIdleTeammate` spy, or via
   the mocked `queryMock` from `@anthropic-ai/claude-agent-sdk` if you want to verify
   `options.resume` was actually set) that the resume path was taken, not a fresh spawn.
5. Optionally, extend the scenario to also assert the post-resume status transition
   (`'running'`) is written back through `scheduleEmitTeammateUpdate`, to close the loop on "the
   row is genuinely usable afterward," not just "the call didn't get rejected."

### Dependencies

**File Dependencies:**
- 1a's `endReason` write for `abandonIdleTeammates` (`'lead-abandoned'`) — this test's seed row
  must match what 1a actually writes, not an invented shape.
- 1b's `cwd` persistence and existence check — the seed row's `cwd` must point at a real directory
  or this test will incorrectly exercise 1b's failure path instead of the happy path.
- 2a's widened eligibility gate — this is literally what the test proves works.

**Library Dependencies:** None new.

---

## Requirements

1. A scripted (not manual-restart) test simulates: `abandonIdleTeammates`-shaped persisted row
   (`status: 'completed'`, `endReason: 'lead-abandoned'`) → fresh `TeammateManager` instance
   (simulated restart) → `sendMessageFromHost` → resume succeeds.
2. The test exercises the real widened gate and real `endReason` taxonomy from 2a/1a — not a
   stand-in.
3. The test's provenance (this PRD, tasks 2a+3b) is documented, distinct from the existing
   PRD-003-scenario header comment in the target file.
4. No manual `/restart`-only verification claim anywhere in this task's deliverable — the test is
   the verification.

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] A restart-shaped scripted test resumes a `lead-abandoned` teammate without any manual
      restart step
- [ ] The test seeds a row matching 1a's actual `abandonIdleTeammates` write shape and 1b's `cwd`
      persistence, not an invented shape
- [ ] The test fails against the pre-2a gate (verify by temporarily checking out or mentally
      tracing the old `RESUMABLE_PERSISTED_STATUSES` check — the point is confirming this test
      would have caught the old behavior, not that you actually revert code to check) and passes
      against the current widened gate
- [ ] `npm run typecheck` and `npm run test:prepush` both pass

**All criteria must pass before task is complete.**

---

## Deliverables

None beyond the files above.

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/runtime/src/ai/server/providers/__tests__/TeammateManager.resumeReliability.test.ts` | modify | New restart-shaped test proving `lead-abandoned` teammates resume after a simulated restart through the widened gate. |

### File Ownership Notes

Disjoint from 3a's files (pure UI). Shares the target test file with 1b (which already added
tests here) — this task's new test(s) should be additive, not a rewrite of 1b's existing cases.

---

## Implementation Guidance

### Patterns to Follow

See "Research Context" above — `sendMessageFromHost.test.ts:145-200`'s existing "second boot"
describe block is the closest direct template, even though it lives in a different test file than
this task's target.

### Code Style

`// @vitest-environment node` as the first line if this test file does not already have it
(confirmed both reference files already do, `:1` in each) — no DOM touched.

### Edge Cases

- Make sure the seeded row's `sessionId` is a non-empty string — `rehydrateIdleTeammate`'s
  existing guard (`typeof sessionId !== 'string' || !sessionId`) rejects rows without one,
  independent of the gate this test is proving.
- If your seed row's `cwd` does not exist, 1b's typed failure fires instead of a successful
  resume — this would make the test fail for the wrong reason. Point `cwd` at `os.tmpdir()` or an
  equivalent guaranteed-to-exist path.

### Testing Requirements

This task *is* the test requirement — see Success Criteria.

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
| 2a | Widened eligibility gate | This test's entire point is exercising 2a's gate — confirm 2a has landed before writing it, or the test will fail against old behavior (which, per success criteria, you should confirm once, then not rely on as your working state) |

### Downstream Impact

None within this PRD's scope — 3b is a leaf test task.

**Before starting:** Verify 1a, 1b, and 2a have all landed — this test seeds a row shaped by 1a's
write and 1b's `cwd` field, and exercises 2a's gate directly.

---

## GitHub Context

**Issue:** none yet
**Feature Issue (Parent):** none yet
**Branch:** `worktree/agent-revival-persistence-3b`
**Target:** Local merge only — this repo never opens a GitHub PR.

---

## Commit Guidelines

Use Conventional Commits:
```
test(teammates): scripted restart-path coverage for lead-abandoned teammate revival
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

---

*Generated by NIMBLE Brief Writer*
*PRD: agent-revival-persistence | Task: 3b | Wave: 4*
