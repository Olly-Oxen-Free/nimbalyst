# Task Brief: 3a

**Title:** Tests for idle handoff, abort status, and continuation wording
**PRD:** teammate-idle-handoff
**Priority:** must
**Complexity:** 5/10
**Model:** opus
**Wave:** 3
**Feature Issue:** TBD — assigned by PM agent at execution start

---

## Objective

Write `TeammateManager.idleHandoff.test.ts`, the dedicated end-of-work test file proving tasks
1a, 1b, and 2a actually fixed the idle-handoff, abort-status, and continuation-wording bugs this
PRD exists for — not just that the code compiles. This is the gate task before the PRD's
end-of-work review; `npm run typecheck && npm run test:prepush` must both be green when done.

---

## Context

**Parent Feature:** Teammate Idle Handoff (PRD `teammate-idle-handoff`, GitHub feature issue TBD)

This PRD fixes three sibling bugs around one seam — the teammate running→idle transition dropping
the handoff to the lead — all observed live in one session (c29787e7, teammate "weatherman",
2026-08-27). Tasks 1a/1b/2a fix three layers:

- **1a:** The continuation system message (`ClaudeCodeProvider.ts`, extracted to an exported
  constant, e.g. `TEAMMATE_CONTINUATION_MESSAGE`) no longer invites the lead to "take other actions
  as needed" — it instructs waiting and forbids duplicating teammate work, while still permitting
  teammate management.
- **1b:** `TeammateManager.handleStreamCompletion`'s idle branch now calls the existing
  `deliverMessageToLead` for every `!isBackground` idle transition. Per PRD Decision D7, the idle
  notice is unconditional; only `capturedResultText`'s inclusion is gated on
  `!result.sentMessageToLead` — three distinct cases (has text, no text, already sent) that must
  all be tested.
- **2a:** `killAll` now emits `'completed'` for teammates cleared from `idleTeammates` and
  `'errored'` only for those cleared from `managedTeammates`. `toolCallCount`/`lastActiveAt`
  survive the idle transition via both `emitTeammateUpdate` idle-entry paths (the push loop and the
  `existingTeammates.map` branch) and across `resumeIdleTeammate`.

This task is part of **Wave 3** — the end-of-work test task, gated on all three implementation
tasks (`depends_on: ["1a", "1b", "2a"]`). Since this task runs after the fixes already exist in the
codebase, "red-first" here means: for each test you write, temporarily revert the specific change
it covers, confirm the test fails, restore the change, confirm it passes — not writing tests before
the fix exists at all (that phase already happened in 1a/1b/2a).

---

## Research Context

- **T7 (zero existing coverage):** repo-wide search confirmed no test references `killAll`,
  `MAX_CONTINUATIONS`, or `handlePostLeadTurnTeammateState` before this PRD. This is greenfield
  coverage, not an extension of pre-existing assertions for those three surfaces —
  `TeammateManager.test.ts`'s `abandonIdleTeammates`/`stopByAgentId` describe blocks (around `:154`
  and `:268`) are the natural home to extend for `killAll`'s status-emission split specifically,
  since they already construct a `TeammateManager` with the right shape of stub deps.
- **Reviewer-verified: double delivery is impossible.** `sentMessageToLead` is a per-stream local
  (declared `TeammateManager.ts:1828`, set `:1982`); queued teammate messages merge into one
  drained batch in `ClaudeCodeProvider.ts` (around `:2394`/`:2429`/`:2452`) — assert this by testing
  each D7 case in isolation, not by asserting an absence of duplication across a whole session
  (out of scope for a `TeammateManager`-level test file).

---

## Requirements

### Test location and file naming

`packages/runtime/src/ai/server/providers/__tests__/TeammateManager.idleHandoff.test.ts` — this
codebase's topic-suffixed test file convention for `TeammateManager` (matches
`TeammateManager.stallWatchdog.test.ts`, `TeammateManager.test.ts` in the same `__tests__`
directory). `killAll` emission tests may instead extend the existing
`abandonIdleTeammates`/`stopByAgentId` describe blocks in `TeammateManager.test.ts` where that is
cheaper than re-mocking a fresh file — your call, per test, based on which setup is cheaper.
Continuation-wording assertions import task 1a's exported constant from `ClaudeCodeProvider.ts`.

### Mocking pattern — follow `TeammateManager.stallWatchdog.test.ts` exactly

Read `packages/runtime/src/ai/server/providers/__tests__/TeammateManager.stallWatchdog.test.ts` in
full before writing this file. Reuse its exact conventions for the new file:

- `// @vitest-environment node` as **line 1** (no DOM needed).
- Top-of-file docblock naming the bug class this file covers and which PRD/tasks it proves.
- **Narrow `vi.mock` calls only** — never the `@nimbalyst/runtime` barrel:
  ```ts
  vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
    query: (args: unknown) => queryMock(args),
  }));

  vi.mock('../../../../storage/repositories/AISessionsRepository', () => ({
    AISessionsRepository: {
      get: async () => ({ metadata: { currentTeammates: storedTeammates } }),
      updateMetadata: async (_sessionId: string, patch: { metadata: { currentTeammates: StoredTeammate[] } }) => {
        storedTeammates = patch.metadata.currentTeammates;
      },
    },
  }));

  // Keep the team-config writes out of the real ~/.claude.
  vi.mock('../claudeCode/claudeConfigDir', () => ({
    resolveClaudeConfigDir: () => path.join(os.tmpdir(), 'nimbalyst-teammate-idle-handoff-test'),
  }));
  ```
  These are the exact three specifiers `stallWatchdog.test.ts` uses; match them (adjust only the
  `tmpdir` path suffix to something unique to this file).
- Literal SDK-shaped chunk fixtures (`systemChunk`, `toolUseChunk`, `resultChunk`, etc.) — not
  builder functions. `stallWatchdog.test.ts`'s `fakeQuery`/`immediate` helpers are directly
  reusable — copy their shape rather than reinventing.
- A local `queryMock = vi.fn()` fed a fake async-iterable `query` implementation.
- `makeDeps()` stub shape from `stallWatchdog.test.ts`: `interruptWithMessage: vi.fn(async () =>
  {})`, `emit: vi.fn()`, etc.

### `deliverMessageToLead` is private — how to assert it fired

`deliverMessageToLead` is a **private** method. Two options, both acceptable:

1. **Assert on the observable side effect via the injected `deps.interruptWithMessage` mock** —
   `deliverMessageToLead` always calls `this.deps.interruptWithMessage(formattedMessage,
   sessionId)`. Construct `TeammateManager` with `interruptWithMessage: vi.fn(async () => {})` and
   assert on its call arguments. Prefer this for "did a wake fire at all, and with what content"
   assertions — `interruptWithMessage`'s formatted message already embeds the teammate name
   (`` `[Teammate message from "${teammateName}"]\n\n${content}` ``, `TeammateManager.ts:1170`) so
   a substring/regex match on its first argument covers most assertions.
2. **`vi.spyOn(manager as any, 'deliverMessageToLead')`** if you need the exact
   `teammateAgentId`/`teammateName`/`content`/`summary` arguments `deliverMessageToLead` itself
   received (finer-grained than what `interruptWithMessage` exposes) — e.g. to assert the D7
   summary shape (`'{displayName} idle'` vs. `'{displayName} idle (no result)'`). Use `as any` to
   bypass the TypeScript private-method restriction, matching this directory's existing convention
   (see `TeammateManager.test.ts:264-277`'s `stopByAgentId` test for a precedent of asserting
   against `TeammateManagerDeps` mock calls).

### How to drive an idle completion in a test

Construct a `TeammateManager` with stub `TeammateManagerDeps`, seed `managedTeammates` via
bracket-notation cast (`(manager as any).managedTeammates.set(agentId, {...})`) with a known
`toolCallCount`/`lastActiveAt`, then either: (a) call the private `handleStreamCompletion` directly
via `(manager as any).handleStreamCompletion(sessionId, agentId, teamName, idleTemplate, result)`
with a hand-built `result` object (`{ capturedSessionId, approvedShutdown: false,
capturedResultText, sentMessageToLead }`) for the most direct, fastest test of the D7 branching; or
(b) drive it end-to-end through a fake `query()` stream (`stallWatchdog.test.ts`'s pattern) for at
least one test, to prove the wiring from a real stream through to the idle branch actually holds.
Prefer (a) for the D7 case-matrix (cheap, precise) and (b) for at least one integration-shaped test
that doesn't rely on calling a private method directly.

### Required coverage (from `tasks.yaml`'s success criteria — all must be present)

1. Idle with result text and `!sentMessageToLead` → `deliverMessageToLead` called with the display
   name and the captured text (assert arguments, not just invocation).
2. Idle with NO result text and `!sentMessageToLead` → explicit no-result notice delivered (never
   silent).
3. Idle with `sentMessageToLead === true` → bare idle notice delivered, `capturedResultText` NOT
   included in the delivered content (D7).
4. Background-agent completion path unchanged — still delivers via its own branch
   (`isBackground && result.capturedResultText && !result.sentMessageToLead`), no double delivery
   when both the idle-branch and background-branch conditions could theoretically apply (they
   cannot in practice — the branches are mutually exclusive on `isBackground`/`capturedSessionId` —
   but assert the background branch's own behavior is unchanged by 1b's edit).
5. `killAll` emits `'errored'` for a running teammate and `'completed'` for an idle teammate in the
   same call (seed both `managedTeammates` and `idleTeammates`, call `killAll()`, assert the
   `emitTeammateUpdate`/`emit` call's status map has both values).
6. Idle metadata entry carries `toolCallCount`/`lastActiveAt` in BOTH `emitTeammateUpdate` paths —
   the push loop (no persisted row yet) and the `existingTeammates.map` branch (row already
   present, e.g. after a resume's own `'running'` emit) — i.e. a resume→re-idle cycle keeps the
   accumulated count, not the pre-resume value; and `resumeIdleTeammate` seeds the accumulated
   `toolCallCount` from the idle record, not `0`.
7. The continuation message constant (`TEAMMATE_CONTINUATION_MESSAGE`, imported from
   `ClaudeCodeProvider.ts`) contains the wait/no-duplication instruction and no open-ended "other
   actions" invitation — a plain string-content assertion (`toContain`/`not.toContain` /
   `toMatch`), not a rendering test.
8. `// @vitest-environment node` first line; narrow `vi.mock` of `@anthropic-ai/claude-agent-sdk`,
   `AISessionsRepository`, `claudeConfigDir`; no `@nimbalyst/runtime` barrel mock.

### Red-first verification (do this for each of items 1-7 above)

Temporarily revert the specific source change the test covers (e.g. comment out the new
`deliverMessageToLead` call in the idle branch, or restore the old `'errored'`-only status map in
`killAll`, or restore the old continuation string), run the test with
`npx vitest run packages/runtime/src/ai/server/providers/__tests__/TeammateManager.idleHandoff.test.ts`
(and the extended block in `TeammateManager.test.ts` if you put the `killAll` test there), confirm
it fails, restore the source change, confirm it passes. Do this per assertion group, not once for
the whole file — a single red/green cycle at the end does not prove each individual assertion is
load-bearing.

### Explicit anti-goals (do not implement/assert)

- **Never assert on component source text** via `readFileSync` + `toContain`/`toMatch` (repo-wide
  rule). The one exception is item 7 above, which is *intentionally* a plain string-content
  assertion on an imported constant's *value* (not a file read) — that is the correct shape for a
  model-facing-string test per PRD 003's precedent, not a violation of this rule.
- Do not test anything under `packages/electron/src/main/**` — 1a/1b/2a are entirely within
  `packages/runtime`; there is nothing on the electron side for this PRD to test (unlike PRD 003's
  2a, which had a Door B electron-side component — no equivalent exists here per this PRD's own
  scope).
- Do not attempt to construct a real `ClaudeCodeProvider` to test the mid-turn vs. idle-but-live
  distinction in `isLeadBusy()` — that machinery is PRD 003's, already audited, and out of scope
  for `TeammateManager`-level tests (this manager doesn't see `leadQuery`/`isLeadBusy` at all).
  Assert what's testable at the `TeammateManager` level (`deliverMessageToLead`/
  `interruptWithMessage` fired with correct arguments) and trust the existing, already-covered
  `ClaudeCodeProvider` branching.

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] Covers: idle with result text and `!sentMessageToLead` → `deliverMessageToLead` called with
      display name and captured text (assert arguments, not just invocation)
- [ ] Covers: idle with NO result text → explicit no-result notice delivered
- [ ] Covers: idle with `sentMessageToLead === true` → bare idle notice delivered,
      `capturedResultText` NOT included (D7)
- [ ] Covers: background-agent completion path unchanged (still delivers via its own branch, no
      double delivery)
- [ ] Covers: `killAll` emits `'errored'` for running, `'completed'` for idle teammates
- [ ] Covers: idle metadata entry carries `toolCallCount`/`lastActiveAt` in both `emitTeammateUpdate`
      paths (push loop and map branch, i.e. resume→re-idle keeps the accumulated count); resume
      seeds accumulated `toolCallCount`
- [ ] Covers: continuation message constant contains the wait/no-duplication instruction and no
      open-ended "other actions" invitation
- [ ] `@vitest-environment node` first line; narrow `vi.mock` of `@anthropic-ai/claude-agent-sdk`,
      `AISessionsRepository`, `claudeConfigDir`; no `@nimbalyst/runtime` barrel mock
- [ ] `npm run typecheck && npm run test:prepush` both green (two known pre-existing failures
      excluded: `AgentTranscriptPanel.listenerCleanup.test.tsx`,
      `MarkdownRenderer.rtl.test.tsx` — jsdom localStorage)

**All criteria must pass before task is complete.**

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/runtime/src/ai/server/providers/__tests__/TeammateManager.idleHandoff.test.ts` | create | Dedicated test file covering D7 delivery cases, `killAll` status split, tool-count continuity, and continuation wording |
| `packages/runtime/src/ai/server/providers/__tests__/TeammateManager.test.ts` | modify | Optionally extend the existing `abandonIdleTeammates`/`stopByAgentId` describe blocks with `killAll` status-split coverage, if cheaper than re-mocking in the new file |

### File Ownership Notes

`TeammateManager.test.ts` is an existing file — extend it, don't restructure it. Do not touch its
existing tests beyond adding new ones inside (or alongside) the named describe blocks.

---

## Implementation Guidance

### Patterns to Follow

- `TeammateManager.stallWatchdog.test.ts` — exact mocking shape, fake-query helpers
  (`fakeQuery`/`immediate`), `makeDeps()` stub shape, `os.tmpdir()`-based `claudeConfigDir` mock.
  Copy its structure wholesale for the new file's setup, then diverge only in test bodies.
- `TeammateManager.test.ts:154-` (`abandonIdleTeammates`/batch-outcome describe block) and `:268-`
  (`stopByAgentId` describe block) — closest existing precedent for asserting status-emission
  behavior in this file; read both before writing the `killAll` tests.
- PRD 003's `TeammateManager.resumeReliability.test.ts` (if present in the codebase at task-start
  time) for a second worked example of driving `handleStreamError`-adjacent private-method paths
  via bracket-notation casts — the same general shape applies to `handleStreamCompletion`.

### Code Style

`describe`/`it` blocks grouped by scenario (D7 cases, `killAll` split, tool-count continuity,
continuation wording — one describe block per concern), small helper functions at the top of the
file rather than inline repeated lookups in every test body, matching
`stallWatchdog.test.ts`'s `statusOf`/`allCompletedOutcomes`-style accessors.

### Edge Cases

Covered inline in the "Required coverage" list above (items 1-8) — this task's edge cases ARE its
required coverage points, since it's a test task for a reliability/honesty bugfix PRD.

### Testing Requirements

This task IS the testing requirement. Run `npx vitest run <file>` for targeted runs while
iterating — never re-run the full suite to find out what failed. If a run fails, read
`.vitest/last-run.log` via `npm run test:last` rather than re-running.

### Coverage Expectations

**Target Files for Coverage:**

| File | Target | Rationale |
|------|--------|-----------|
| `packages/runtime/src/ai/server/providers/TeammateManager.ts` (idle branch of `handleStreamCompletion`, `killAll`, `emitTeammateUpdate`'s two idle-entry paths, `resumeIdleTeammate`) | Behavioral coverage of every success criterion above | Core implementation from tasks 1b/2a |
| `packages/runtime/src/ai/server/providers/ClaudeCodeProvider.ts` (the exported `TEAMMATE_CONTINUATION_MESSAGE` constant only) | String-content assertion | Core implementation from task 1a |

No numeric coverage-percentage target is specified by this PRD's own success metrics (PRD §3 — the
measurement is "unit test asserts X," not a percentage threshold). Do not invent one.

**Intentionally Uncovered Lines:**

- `abandonIdleTeammates`'s exhaustion-reset semantics are explicitly out of scope for new coverage
  (PRD Decision D3 — made moot by 1b's fix, no direct change to that method in this PRD, and no new
  test requirement for it beyond what already exists).
- The `ClaudeCodeProvider`-side `isLeadBusy()` mid-turn vs. idle-but-live branching is not directly
  testable at the `TeammateManager` level and is out of scope for this file (see Explicit
  anti-goals above) — it is PRD 003's already-audited machinery, unchanged by this PRD.

**Verification:**
```bash
npx vitest run packages/runtime/src/ai/server/providers/__tests__/TeammateManager.idleHandoff.test.ts
npm run typecheck && npm run test:prepush
```

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
- Do not modify `TeammateManager.ts` or `ClaudeCodeProvider.ts` themselves — this task is
  test-only. If you discover a genuine bug in 1a/1b/2a's implementation while writing these tests,
  do not fix it yourself; flag it clearly in your final report so it can be routed back to the
  relevant task/reviewer.
- Do not touch the Task-subagent system (`activeTasks` in `ClaudeCodeProvider.ts`, PRD 004's
  tile/popover UI) — this PRD is TEAMMATE-lifecycle only; there is nothing to test there for this
  PRD.

### Files Requiring Review

Neither the new test file nor `TeammateManager.test.ts` is under `packages/electron/src/main/**` —
not in `.nimble/config.yaml`'s `require_review` list. This task does not trigger the PRD's
human-review gate on its own.

---

## Dependencies

### Upstream Tasks

| Task | What It Provides | Verify Before Starting |
|------|------------------|------------------------|
| 1a | Exported `TEAMMATE_CONTINUATION_MESSAGE` constant on `ClaudeCodeProvider.ts` | Confirm 1a merged; re-read the current exported constant's name/location before importing it. |
| 1b | `deliverMessageToLead` wired into `handleStreamCompletion`'s idle branch per D7 | Confirm 1b merged; re-read the current idle branch to know exact field names/behavior to assert against. |
| 2a | `killAll` status split; `IdleTeammate.toolCallCount`/`lastActiveAt`; `resumeIdleTeammate` seeding fix | Confirm 2a merged; re-read the current `IdleTeammate` interface and `killAll` body before writing assertions against specific field names. |

### Downstream Impact

None — no task in this PRD depends on 3a. This is the terminal task in the dependency chain.

**Before starting:** Confirm all three of 1a, 1b, and 2a have landed. Read the actual current diffs
(not just this brief's line-number references, which are pinned to the pre-1a/1b/2a state of the
files as of 2026-08-27 and will have shifted) before writing assertions against specific strings,
method signatures, or line numbers.

---

## GitHub Context

**Issue:** TBD — created by PM agent at execution start
**Feature Issue (Parent):** TBD — created by PM agent at execution start
**Branch:** `worktree/teammate-idle-handoff-3a`
**Target:** Determined by PM agent based on execution mode (feature branch or main)

---

## Commit Guidelines

Use Conventional Commits:
```
test(teammates): cover idle handoff, abort status, and continuation wording
```

Types: feat, fix, refactor, test, docs, chore

---

## Deliverables

| Artifact | Path | Done when |
|---|---|---|
| Test file | `packages/runtime/src/ai/server/providers/__tests__/TeammateManager.idleHandoff.test.ts` | Covers all 8 required coverage points from this brief's Requirements section, red-first verified per group, `npm run typecheck && npm run test:prepush` both green |
| Extended test file (optional) | `packages/runtime/src/ai/server/providers/__tests__/TeammateManager.test.ts` | If `killAll` status-split coverage was placed here instead of the new file, it's added inside/alongside the existing `abandonIdleTeammates`/`stopByAgentId` describe blocks without disturbing existing tests |

---

## Validation Checklist

Before creating PR:
- [ ] All success criteria met
- [ ] Build passes: `npm run build`
- [ ] Type check passes: `npm run typecheck`
- [ ] No `never_touch` files modified
- [ ] Full test suite green: `npm run test:prepush` (two known pre-existing failures excluded, see
      Success Criteria)
- [ ] Each of the 7 behavioral assertions verified red-first (temporarily revert → fail → restore
      → pass)
- [ ] Branch rebased on target branch (feature branch or main)

**Execution rules (mandatory, repo-level, non-negotiable):**
- Do NOT run `gh pr create` at any point. No pushes.
- Do NOT commit — the coordinator reviews your diff, runs gates, and commits per task.
- This task DOES run tests: use `npx vitest run <file>` for targeted runs, never the full suite
  repeatedly. Read `.vitest/last-run.log` via `npm run test:last` on failures — never pipe a test
  run through `tail -n`, it truncates the failure block.
- This is the TEAMMATE lifecycle (`TeammateManager.ts`/`ClaudeCodeProvider.ts`, PRD 002/003 UI
  surface) — never touch the Task-subagent system (`activeTasks` in `ClaudeCodeProvider.ts`, PRD
  004 tile/popover UI).
- Match existing code style; every changed line must trace to this task; no drive-by refactors; no
  emojis; comments citing issues use prose or GitHub issue numbers, never `NIM-###` keys.

---

*Generated by NIMBLE Brief Writer*
*PRD: teammate-idle-handoff | Task: 3a | Wave: 3*
