# Task Brief: 2a

**Title:** Tests for resume-delivery reliability
**PRD:** teammate-resume-reliability
**Priority:** must
**Complexity:** 4/10
**Model:** sonnet
**Wave:** 4
**Feature Issue:** TBD — assigned by PM agent at execution start (no GitHub issue number recorded in the PRD frontmatter yet)

---

## Objective

Write `TeammateManager.resumeReliability.test.ts`, the dedicated end-of-work test file proving tasks
1a, 1b, and 1c actually fixed the resume-delivery reliability bug this PRD exists for — not just that
the code compiles. This is the single gate task before the PRD's end-of-work integration review;
`npm run typecheck && npm run test:prepush` must be green when you're done.

---

## Context

**Parent Feature:** Teammate Resume-Delivery Reliability (PRD `teammate-resume-reliability`, GitHub
feature issue TBD)

This PRD fixes a confirmed, reproduced bug: resuming an idle teammate is fire-and-forget, and when
the resume fails — especially post-restart, when the underlying CLI subprocess or session file is
stale — nothing told the lead. Tasks 1a/1b/1c fix three layers of this:

- **1a:** The immediate ack the lead gets on resume no longer claims unconditional delivery
  (`TeammateManager.ts:2389`/`:2398`, was `"Message delivered to idle teammate ... via resume. Do not
  retry."`).
- **1b:** When a resumed teammate's stream fails while the lead's process is alive,
  `handleStreamError` (`TeammateManager.ts:1531-1552`) now calls the existing `deliverMessageToLead`
  (`:1090`), gated on a new `wasResumed` marker on `ManagedTeammate` so a fresh-spawn failure does NOT
  trigger this path — and, critically, the call is ordered to run BEFORE the existing
  `hasActiveTeammates()`/`emitAllCompleted` check, so a last-teammate resume failure doesn't let the
  desktop notification/`endSession` race ahead of the wake (see 1b's brief, "Critical ordering
  constraint," for the full mechanism — this is the subtlest thing 1b built and worth its own test
  here).
- **1c:** The same wake now survives a Nimbalyst restart — `sessionId` is threaded explicitly through
  `TeammateManagerDeps.interruptWithMessage` → `ClaudeCodeProvider.interruptWithMessage` →
  `emitTeammateMessageWhileIdle` (`ClaudeCodeProvider.ts:2549-2555`) instead of relying on
  `this.teammateManager.lastUsedSessionId` (unset post-restart), and
  `onTeammateMessageWhileIdle` (`MessageStreamingHandler.ts:1092-1154`) no longer silently bails on
  `!isSessionActive`.

This task is part of **Wave 4** — the end-of-work test task, gated on all three implementation tasks
(`depends_on: ["1a", "1b", "1c"]`) per this repo's convention. Since this task runs after the fixes
already exist in the codebase, "red-first" here means: for each test you write, temporarily revert
the specific change it covers, confirm the test fails, restore the change, confirm it passes — not
writing tests before the fix exists in the codebase at all (that phase already happened in 1a/1b/1c).

---

## Requirements

### Test location and file naming

`packages/runtime/src/ai/server/providers/__tests__/TeammateManager.resumeReliability.test.ts` — this
codebase's topic-suffixed test file convention for `TeammateManager` (matches
`TeammateManager.stallWatchdog.test.ts`, `TeammateManager.test.ts` in the same `__tests__`
directory). Do not create a new mega-file combining unrelated `TeammateManager` behavior; this file
covers only resume-delivery reliability.

### Mocking pattern — follow `TeammateManager.stallWatchdog.test.ts` exactly

Read `packages/runtime/src/ai/server/providers/__tests__/TeammateManager.stallWatchdog.test.ts` in
full before writing this file. Reuse its exact conventions:

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
    resolveClaudeConfigDir: () => path.join(os.tmpdir(), 'nimbalyst-teammate-resume-reliability-test'),
  }));
  ```
  These are the exact three specifiers `stallWatchdog`'s file uses; match them (adjust only the
  tmpdir path suffix to something unique to this file, e.g.
  `nimbalyst-teammate-resume-reliability-test`).
- Literal SDK-shaped chunk fixtures (`systemChunk`, `toolUseChunk`, `resultChunk`, etc.) — not
  builder functions.
- Short, small, tuned timing constants with a local `sleep()` helper if any test needs to wait on
  async ordering — keep the suite fast.
- A local `queryMock = vi.fn()` fed a fake async-iterable `query` implementation
  (`stallWatchdog.test.ts`'s `fakeQuery`/`immediate` helpers are directly reusable — copy their shape
  rather than reinventing).

### `deliverMessageToLead` is private — how to assert it fired

`deliverMessageToLead` (`TeammateManager.ts:1090-1132`) is a **private** method. You cannot import
and call it directly, or type-check a spy on it without a cast. Two options, both acceptable — pick
whichever reads more clearly for the specific assertion:

1. **Assert on the observable side effect via the injected `deps.interruptWithMessage` mock.**
   `deliverMessageToLead` always calls `this.deps.interruptWithMessage(formattedMessage, sessionId)`
   (after task 1c's fix, with the `sessionId` as the second argument). Construct `TeammateManager`
   with `interruptWithMessage: vi.fn(async () => {})` in your `TeammateManagerDeps` stub (see
   `stallWatchdog.test.ts`'s `makeDeps()` for the exact shape) and assert on its call arguments —
   this is the same technique `stallWatchdog.test.ts` already uses and does not require touching
   private state.
2. **`vi.spyOn(manager as any, 'deliverMessageToLead')`** if you need to assert the exact
   `teammateAgentId`/`teammateName`/`content`/`summary` arguments `deliverMessageToLead` itself
   received (finer-grained than what `interruptWithMessage`'s single formatted-string argument
   exposes). Use `as any` to bypass the TypeScript private-method restriction, matching this
   directory's existing convention of bracket-notation/`as any` casts for accessing private state
   (see `TeammateManager.test.ts:264-277`'s `stopByAgentId` test for a precedent of asserting against
   `TeammateManagerDeps` mock calls to verify an explicitly-threaded `sessionId`, the closest existing
   analog to this task's post-restart assertions).

Prefer option 1 for "did a wake fire at all" assertions and option 2 only when you need to verify the
exact teammate name/content passed into `deliverMessageToLead` itself, since `interruptWithMessage`'s
formatted message already embeds the teammate name (`` `[Teammate message from "${teammateName}"]\n\n${content}` ``,
`TeammateManager.ts:1123`) and can usually be asserted via a substring/regex match on
`interruptWithMessage`'s first argument instead of spying on the private method.

### Required coverage (from `tasks.yaml`'s success criteria — all must be present)

1. **Resume-then-fail no longer produces the old "delivered ... do not retry" model-facing
   strings.** Drive the `SendMessage` tool-routing branch for an idle teammate — the code path at
   `TeammateManager.ts:2374-2401`, inside the `handlePreToolUse` method (`TeammateManager.ts:2170`,
   confirmed by direct read 2026-08-25; `handlePreToolUse` is public/`async`, so it can be called
   directly on a constructed `TeammateManager` instance with a `SendMessage` tool-use payload
   targeting an idle teammate's recipient name — no cast needed to invoke it, only to seed
   `idleTeammates` beforehand) — and assert the returned `denyPreToolUse` message and the
   `logSyntheticToolPair` result text do NOT contain `"Do not retry"` or the old
   `"delivered to idle teammate"` phrasing (proves task 1a).
2. **Resume-then-fail while the lead is mid-turn** calls `deliverMessageToLead` (via the
   `interruptWithMessage` mock assertion pattern above) AND suppresses the desktop notification via
   the `leadQuery !== null` branch of `isLeadBusy()`. Since `TeammateManager` itself doesn't know
   about `leadQuery`/`isLeadBusy` (those live on `ClaudeCodeProvider`), this half of the assertion is:
   confirm `deliverMessageToLead`/`interruptWithMessage` fired with the failure message when a
   resumed teammate's stream rejects — the "mid-turn" framing is really about which branch of
   `interruptWithMessage` your test's stub represents; if you're testing `TeammateManager` in
   isolation (recommended, matching `stallWatchdog.test.ts`'s scope), assert
   `deps.interruptWithMessage` was called once per failed resume and trust `ClaudeCodeProvider`'s own
   branching (already covered by `isLeadBusy`'s existing production code, not new code this PRD
   wrote) — do not attempt to construct a real `ClaudeCodeProvider` instance to test this unless a
   sibling test file already does so cheaply for a similar assertion.
3. **Resume-then-fail while the lead is idle-but-live** — a DIFFERENT code path from mid-turn (the
   `teammateIdleMessagePending` branch of `isLeadBusy()`, not `leadQuery !== null`). Both must be
   tested, not just one. Same scoping note as above applies: at the `TeammateManager` level, this is
   still "a failed resume calls `deliverMessageToLead`" — the idle-vs-mid-turn distinction is
   `ClaudeCodeProvider`'s concern. If `TeammateManager`-level tests cannot meaningfully distinguish
   these two branches (they likely cannot, since `TeammateManager` doesn't see `leadQuery`), document
   this explicitly in a comment near the relevant test(s) rather than silently only covering one
   branch, and confirm via direct code reading (not a test) that `ClaudeCodeProvider.interruptWithMessage`'s
   two branches (`:2332-2346` idle, `:2349-2368` mid-turn) both terminate in a state where
   `isLeadBusy()` returns `true`— cite the specific lines you checked in a comment.
4. **Resume-then-fail when it's the last active teammate — the call-ordering case task 1b's brief
   flags as its most failure-prone detail.** Resume a single teammate (so its failure makes
   `hasActiveTeammates()` false), fail its stream, and assert `deps.interruptWithMessage` was called
   (i.e. `deliverMessageToLead` ran) — this is the case where getting the call order backwards inside
   `handleStreamError` (delivering the wake AFTER `emitAllCompleted` instead of before) would silently
   drop the wake once a real `ClaudeCodeProvider`/`MessageStreamingHandler` are in the loop. At the
   `TeammateManager`-level scope this file uses, you cannot observe the downstream `isLeadBusy()` race
   directly — assert what you can (`interruptWithMessage` was called at all for the last-teammate
   case) and, if `deps.emit`/`deps.interruptWithMessage` are both `vi.fn()`, additionally assert via
   `mock.invocationCallOrder` that `interruptWithMessage`'s call preceded any `emit(..., 'teammates:allCompleted', ...)`
   call in the same failure, since that ordering is exactly what 1b's fix guarantees.
5. **Resume-then-fail post-restart** (session not active in `stateManager`, `lastUsedSessionId`
   undefined) reaches the lead — proves task 1c's fix actually works, not just that it compiles. This
   is the most load-bearing test in this file: construct a `TeammateManager` where
   `lastUsedSessionId` is left `undefined` (mirrors `TeammateManager.test.ts:275-277`'s existing
   `stopByAgentId` precedent: `expect(manager.lastUsedSessionId).toBeUndefined();`), trigger a
   resumed teammate's stream failure, and assert `deps.interruptWithMessage` was called with the
   **explicit `sessionId`** passed to the triggering call (not `undefined`, not silently dropped) —
   this proves Door A (the sessionId-threading fix). Door B
   (`onTeammateMessageWhileIdle`'s `isSessionActive` bail, `MessageStreamingHandler.ts`) is in the
   `electron` package, not `runtime` — this file, scoped to `TeammateManager.ts`/`runtime`, can only
   prove Door A directly. Door B's coverage has a named home:
   `packages/electron/src/main/services/ai/__tests__/teammateWakeDelivery.test.ts` already exists and
   its docblock claims to cover `onTeammateMessageWhileIdle`'s drop cases, but its actual tests only
   exercise `classifyTeammateWakeDelivery`/`announceTeammateWakeDelivery` (the classification
   functions called *after* the `isSessionActive` gate) — the gate itself has zero coverage there
   today. Extend `teammateWakeDelivery.test.ts` with a test that seeds `isSessionActive` false, fires
   `'teammate:messageWhileIdle'`, and asserts the wake reaches `deliver()`/`sendMessage` after 1c's
   Door B fix (Option B: `ai:sendMessageToTeammate` calling `startSession` before triggering the wake).
   This is in-scope deliverable work for this task, not a deferred/optional item — see the Deliverables
   table below. State explicitly in this file's docblock (the `runtime`-package
   `TeammateManager.resumeReliability.test.ts` file) that Door A is covered here and Door B is covered
   in `teammateWakeDelivery.test.ts`.
6. **A fresh-spawn failure does NOT call the new wake path** (`wasResumed` marker distinguishes
   correctly). Spawn a teammate via the fresh-spawn path (not `resumeIdleTeammate`), fail its stream,
   and assert `deps.interruptWithMessage` was NOT called for that failure (separate from any other
   assertions in the same test — use a fresh mock or check call count before/after).
7. **Two concurrent resume failures each independently trigger their own `deliverMessageToLead`
   call.** Resume two idle teammates, fail both streams near-simultaneously, and assert
   `deps.interruptWithMessage` (or your `deliverMessageToLead` spy) was called twice, once per
   teammate, with each call's message naming the correct teammate.
8. **The shutdown-request handshake's behavior and wording are unaffected.** No pre-existing test
   suite covers this path today (confirmed by search before writing this file) — add minimal coverage
   rather than claiming to "re-run existing tests" that don't exist. Drive the shutdown-request branch
   (`TeammateManager.ts:2341-2372`, also inside `handlePreToolUse`) and assert the response still says
   `"sent"`/`"awaiting approval"` and never `"delivered"`/`"do not retry"` — proves 1a's explicit
   "confirm unchanged" requirement actually holds in code, not just in the reviewer's prior manual
   check.

### Explicit anti-goals (rejected during PRD review — do not implement/assert)

- Do not assert a blocking "wait for first chunk" behavior anywhere — task 1a's ack change is
  immediate, not delayed. A test asserting the ack is delayed until a chunk arrives would be testing
  a rejected design.
- Do not test `notifyUndelivered`/wake-delivery extension with a new outcome type, or
  `teammateCompletionSignal.ts`'s outcome classification with a new value — neither was built (both
  rejected as mechanisms during PRD review); there is nothing there to test.
- **Never assert on component source text** via `readFileSync` + `toContain`/`toMatch` (repo-wide
  rule, `.claude/CLAUDE.md`). Assert observable behavior: returned values, `deliverMessageToLead`/
  `interruptWithMessage` call arguments, the `wasResumed` marker's effect, `isSessionActive` state
  transitions for the post-restart case.

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] Covers: resume-then-fail no longer produces the old "delivered ... do not retry" model-facing
      strings
- [ ] Covers: resume-then-fail while the lead is mid-turn calls `deliverMessageToLead`/
      `interruptWithMessage` (see scoping note in Requirements item 2 — assert what's testable at the
      `TeammateManager` level, document what isn't)
- [ ] Covers: resume-then-fail while the lead is idle-but-live — a DIFFERENT code path from mid-turn,
      both documented/tested per the scoping note in Requirements item 3
- [ ] Covers: resume-then-fail when it's the last active teammate — the call-ordering case from
      Requirements item 4, proving 1b's `deliverMessageToLead`-before-`emitAllCompleted` fix
- [ ] Covers: resume-then-fail post-restart (session not active, `lastUsedSessionId` undefined)
      reaches the lead — proves 1c's Door A fix (sessionId threading) actually works, not just that
      it compiles
- [ ] Door B (1c's `isSessionActive` gate fix) has test coverage added to
      `packages/electron/src/main/services/ai/__tests__/teammateWakeDelivery.test.ts` — a test that
      seeds `isSessionActive` false, fires `'teammate:messageWhileIdle'`, and asserts the wake reaches
      `deliver()`/`sendMessage` after 1c's fix; this is a required deliverable of this task, not an
      optional/deferred item
- [ ] Covers: a fresh-spawn failure does NOT call the new wake path (`wasResumed` marker distinguishes
      correctly)
- [ ] Covers: two concurrent resume failures each independently trigger their own
      `deliverMessageToLead`/`interruptWithMessage` call
- [ ] Confirms the shutdown-request handshake's behavior and wording are unaffected — minimal new
      coverage added since none existed before
- [ ] `// @vitest-environment node` as the first line; narrow `vi.mock` of
      `@anthropic-ai/claude-agent-sdk`, `AISessionsRepository`, AND `claudeConfigDir`
      (`../claudeCode/claudeConfigDir`, keeps team-config writes out of `~/.claude`) — per
      `TeammateManager.stallWatchdog.test.ts`'s exact pattern
- [ ] `npm run typecheck && npm run test:prepush` both green

**All criteria must pass before task is complete.**

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/runtime/src/ai/server/providers/__tests__/TeammateManager.resumeReliability.test.ts` | create | Dedicated test file covering all resume-delivery reliability behavior from tasks 1a/1b/1c (Door A of 1c's post-restart fix) |
| `packages/electron/src/main/services/ai/__tests__/teammateWakeDelivery.test.ts` | modify | Extend existing file with coverage for Door B (1c's `isSessionActive` gate fix) — currently only tests the classification layer, not the gate itself |

### File Ownership Notes

`teammateWakeDelivery.test.ts` is an existing file, not created by this task — extend it rather than
replacing it; do not touch its existing classification-layer tests beyond adding new ones.

---

## Implementation Guidance

### Patterns to Follow

- `TeammateManager.stallWatchdog.test.ts` — exact mocking shape, fake-query helpers
  (`fakeQuery`/`immediate`), `makeDeps()` stub shape, `os.tmpdir()`-based `claudeConfigDir` mock.
  Copy its structure wholesale for this file's setup, then diverge only in the actual test bodies.
- `TeammateManager.test.ts:264-277` — the existing `stopByAgentId` test that asserts an explicitly-
  threaded `sessionId` is used instead of the unset `lastUsedSessionId`. This is the closest existing
  precedent in this codebase for exactly the assertion shape needed for the post-restart coverage
  point (Requirements item 5) — read it before writing that test.

### Code Style

Match `stallWatchdog.test.ts`'s style: `describe`/`it` blocks grouped by scenario, small helper
functions at the top of the file (`statusOf`, `allCompletedOutcomes`-style accessors) rather than
inline repeated lookups in every test body.

### Edge Cases

Covered inline in the "Required coverage" list above (items 1-8) — this task's edge cases ARE its
required coverage points, since it's a test task for a reliability bugfix PRD.

### Testing Requirements

This task IS the testing requirement. See "Required coverage" above.

### Coverage Expectations

**Target Files for Coverage:**

| File | Target | Rationale |
|------|--------|-----------|
| `packages/runtime/src/ai/server/providers/TeammateManager.ts` (resume-related methods: `resumeIdleTeammate`, `handleStreamError`, `deliverMessageToLead`, `handlePreToolUse`'s idle-teammate-resume/shutdown branches) | Behavioral coverage of every success criterion above | Core implementation from tasks 1a/1b/1c |

No numeric coverage-percentage target is specified by this PRD's own success criteria (see PRD §3
Success Metrics — the measurement is "unit test asserts X," not a percentage threshold) — this repo
does not use `--coverageThreshold` flags for this kind of behavioral test task. Do not invent one.

**Intentionally Uncovered Lines (within this file only):**

- Task 1c's Door B fix (`MessageStreamingHandler.ts`'s `onTeammateMessageWhileIdle`,
  `AIService.ts`'s `ai:sendMessageToTeammate`) is in the `electron` package, outside
  `TeammateManager.resumeReliability.test.ts`'s scope (`runtime` package, `TeammateManager.ts`-
  focused) — it is not uncovered by this *task*, only by this one file. Door B coverage is required
  as part of this task, added to `packages/electron/src/main/services/ai/__tests__/teammateWakeDelivery.test.ts`
  (see Requirements item 5 and Files to Modify above).

**Verification:**
```bash
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
- Do not modify `TeammateManager.ts`, `ClaudeCodeProvider.ts`, `MessageStreamingHandler.ts`, or
  `AIService.ts` themselves — this task is test-only. If you discover a genuine bug in 1a/1b/1c's
  implementation while writing these tests, do not fix it yourself; flag it clearly in your final
  report so it can be routed back to the relevant task/reviewer.
- Door B coverage goes in the existing `electron`-package file
  `packages/electron/src/main/services/ai/__tests__/teammateWakeDelivery.test.ts` — extend it, do not
  create a new `electron`-package test file for this.

### Files Requiring Review

The new `runtime`-package test file is not itself in `.nimble/config.yaml`'s `require_review` list.
The extension to `teammateWakeDelivery.test.ts`, however, is under `packages/electron/src/main/**`,
which IS in `require_review` (per brief 1c's own file-ownership notes) — expect that edit to surface
at the same end-of-work integration review as 1c's changes.

---

## Dependencies

### Upstream Tasks

| Task | What It Provides | Verify Before Starting |
|------|------------------|------------------------|
| 1a | Reworded model-facing ack strings | Confirm 1a's PR merged; re-read the current strings at `TeammateManager.ts` (search for the SendMessage tool-routing branch, inside `handlePreToolUse`, near where `logSyntheticToolPair`/`denyPreToolUse` are called for idle-teammate resume) to know exactly what NOT to match against. |
| 1b | `wasResumed` marker on `ManagedTeammate`, `deliverMessageToLead` wired into `handleStreamError` BEFORE the `emitAllCompleted` check | Confirm 1b's PR merged; read the current `handleStreamError` and the three `ManagedTeammate` construction sites to know exact field names/behavior to assert against, and confirm the call-ordering guarantee described in 1b's brief actually landed as written. |
| 1c | `sessionId`-threaded `interruptWithMessage`/`emitTeammateMessageWhileIdle`, `onTeammateMessageWhileIdle`'s `isSessionActive` fix | Confirm 1c's PR merged; read the current signatures of `TeammateManagerDeps.interruptWithMessage` and `deliverMessageToLead`'s call to it, since this task's post-restart assertion (item 5) depends on the exact parameter shape 1c landed. |

### Downstream Impact

None — no task in this PRD depends on 2a. This is the terminal task in the dependency chain
(`1a → 1b → 1c → 2a`).

**Before starting:** Confirm all three of 1a, 1b, and 1c have merged. Read the actual landed diffs
(not just this brief's line-number references, which are pinned to the pre-1a/1b/1c state of the
files as of 2026-08-25 and will have shifted) before writing assertions against specific strings,
method signatures, or line numbers.

---

## GitHub Context

**Issue:** TBD — created by PM agent at execution start
**Feature Issue (Parent):** TBD — created by PM agent at execution start
**Branch:** `worktree/teammate-resume-reliability-2a`
**Target:** Determined by PM agent based on execution mode (feature branch or main)

---

## Commit Guidelines

Use Conventional Commits:
```
test(teammates): cover resume-delivery reliability across live-process and post-restart failures
```

Types: feat, fix, refactor, test, docs, chore

---

## Deliverables

| Artifact | Path | Done when |
|---|---|---|
| Test file | `packages/runtime/src/ai/server/providers/__tests__/TeammateManager.resumeReliability.test.ts` | Covers all 8 required coverage points from this brief's Requirements section, `npm run typecheck && npm run test:prepush` both green, and the docblock states Door A is covered here / Door B is covered in `teammateWakeDelivery.test.ts` |
| Extended test file | `packages/electron/src/main/services/ai/__tests__/teammateWakeDelivery.test.ts` | Adds a test proving Door B (1c's `isSessionActive` gate fix): seeds `isSessionActive` false, fires `'teammate:messageWhileIdle'`, asserts the wake reaches `deliver()`/`sendMessage` after the fix; `npm run typecheck && npm run test:prepush` both green |

---

## Validation Checklist

Before creating PR:
- [ ] All success criteria met
- [ ] Build passes: `npm run build`
- [ ] Type check passes: `npm run typecheck`
- [ ] No `never_touch` files modified
- [ ] Full test suite green: `npm run test:prepush`
- [ ] Branch rebased on target branch (feature branch or main)

---

*Generated by NIMBLE Brief Writer*
*PRD: teammate-resume-reliability | Task: 2a | Wave: 4*
