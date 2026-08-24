# Task Brief: 4b

**Title:** Add Teammate stream-stall watchdog
**PRD:** agent-visibility
**Priority:** must
**Complexity:** 6/10
**Model:** opus
**Wave:** 4
**Feature Issue:** Not yet created — tracker publish is pending (`.nimble/prds/001_agent-visibility/status.json` → `tracker.publish_error`: "No document service available to change Draft/Published state"). Reference the PRD file directly: `.nimble/prds/001_agent-visibility/PRD_agent-visibility.md`.

---

## Objective

`TeammateManager.spawnTeammate`'s core streaming loop (`packages/runtime/src/ai/server/providers/TeammateManager.ts:1493`, a plain `for await (const chunk of teammateQuery)`) has no timeout — a teammate subprocess that hangs mid-turn with no error and no chunk produces no signal at all, and the loop's `await` blocks forever. This is the exact NIM-1481 bug class already fixed for the lead session's own stream (`streamStallWatchdog.ts`), reproduced unfixed on the teammate path. This task adds a watchdog reusing that same helper so a stalled teammate transitions to `errored` within a bounded window and fires the distinct notification task `3a` establishes — instead of leaving the teammate (and the architect) waiting indefinitely. Fulfills requirement **R10**.

---

## Context

**Parent Feature:** Agent Visibility and Workflow Enhancement (PRD `agent-visibility`, `.nimble/prds/001_agent-visibility/PRD_agent-visibility.md`). No GitHub feature issue exists yet for this PRD — do not block on one; reference the PRD file above for full context if needed.

This task is part of the PRD's 2026-08-22 amendment (R10-R12), which added stall/hang-detection and wake-delivery-reliability scope on top of the original chip-row/notification work. The amendment was triggered by a user-reported recurring failure: "a spawned agent designed to report back either never reports, or the main session never wakes." This task closes the first half of that report — the "never reports" case for Teammates specifically. (SDK-native Task sub-agents get a related but architecturally different fix under task `4a`; NIMBLE's own `nimble-pm` worker-liveness gap is explicitly out of scope for this PRD/codebase — see PRD §2 Amendment Context.)

This task is part of **Wave 4** — it runs alongside `2b`, `3b`, and `4c`, after Wave 3 (`2a`, `3a`) completes (and after Wave 2's `4a`), before Wave 5 (`2c`). Task `5a` (CHANGELOG entry, final gate) depends on this task completing, along with `2c`, `2d`, `3b`, `4a`, `4c`.

---

## Assumed Precondition: Task 3a's Distinct-Notification Wiring

**This task `depends_on: ["3a"]`.** Do not begin implementation without first reading whatever `3a` actually built in `TeammateManager.ts` and `MessageStreamingHandler.ts` — the description below is the pattern 3a is *expected* to establish, not a guarantee of its exact final shape. Verify against the real diff before reusing it.

**Expected shape of 3a's output** (per its own brief, `.nimble/prds/001_agent-visibility/briefs/3a_agent-visibility.md`):

- 3a wires `notificationService.showBlockedNotification` (or an equivalent distinct signal) into every `teammates:allCompleted` emit site in `TeammateManager.ts` — as of this research pass there are five: lines 205 (`abandonIdleTeammates()`, silent-idle-abandon), 1265 (end of `handleStreamCompletion`), 1288 (end of `handleStreamError`), 1740 and 1757 (the mirrored background-agent completion/error paths).
- To let `MessageStreamingHandler.onTeammatesAllCompleted` distinguish a clean finish from an error/abandon, 3a most likely extends the `teammates:allCompleted` emit payload (today just `{ sessionId }`) with an outcome signal — e.g. an `outcome: 'clean' | 'errored' | 'abandoned'` field or a `hadErrors: boolean` flag. The exact field name/shape is 3a's design choice; read what it actually landed.
- `showBlockedNotification`'s `blockingType` parameter is currently typed `'permission' | 'question' | 'plan_approval' | 'git_commit'` (`NotificationService.ts:79`) — none of these fit "teammate errored." 3a most likely adds a new `BlockingType` value (e.g. `'teammate_error'`) with its own title/body case, or adds a dedicated method (e.g. `showTeammateErrorNotification(...)`) that calls the lower-level `showNotification` directly. Either way, `handleStreamError` (`TeammateManager.ts:1269-1290`) is 3a's primary hook point for the error path.

**What this task needs from 3a, concretely:** a working path by which a teammate that ends up calling `handleStreamError(sessionId, agentId, teamName, err)` produces a distinct main-thread notification (not the success chime). This task's job is to make sure a *stalled* teammate reaches that same `handleStreamError` call — by throwing an `Error` out of the streaming loop on stall detection, exactly as `ClaudeCodeProvider`'s own watchdog does for the lead session (see Implementation Guidance below). **This task does not call `showBlockedNotification` (or 3a's equivalent) directly** — it relies on funneling the stall into the existing `.catch((err) => this.handleStreamError(...))` handler at `TeammateManager.ts:1343-1345` (and the mirrored background-agent handler at `:1404`/`:1647`), which 3a has already wired to notify.

**Before starting, verify:**
- `handleStreamError` (or whatever 3a's diff renamed/restructured it to) actually results in a distinct notification firing — read 3a's test(s) proving this, don't just read the source and assume.
- Confirm the exact throw/reject path is unchanged — this task depends on a thrown `Error` from inside `streamTeammateOutput`'s loop propagating to the `streamPromise.catch(...)` handler that calls `handleStreamError`. If 3a restructured this control flow, adapt to what actually landed.

---

## Requirements

### The bug, as it exists today (verified against source at brief-generation time)

`streamTeammateOutput` (`packages/runtime/src/ai/server/providers/TeammateManager.ts:1410-1421`) builds SDK options including an `abortController` (the `AbortController` parameter, `teammateAbort`/`bgAbort` at the call sites) and calls `query({ prompt, options })`, then loops:

```ts
for await (const chunk of teammateQuery) {
  if (chunk.session_id && !capturedSessionId) { /* ... */ }
  try {
    await this.flushPendingMessages(agentId, teammateQuery as unknown as Query);
  } catch (error) { /* ... */ }
  if (chunk.type === 'assistant' || chunk.type === 'user') {
    const managedEntry = this.managedTeammates.get(agentId);
    if (managedEntry) {
      managedEntry.lastActiveAt = Date.now();
    }
    /* ... */
  }
  /* ... */
}
```

If the SDK subprocess goes silent mid-turn without emitting a chunk, an error, or ending the iterator, `for await` blocks on `teammateQuery`'s internal `next()` forever. `lastActiveAt` (`ManagedTeammate.lastActiveAt`, set at `:1524`) is written on every assistant/user chunk, but a repo-wide grep confirms its only read site is `TeammatePanel.tsx:324-325` — a cosmetic "last active Xm ago" label for an already-idle teammate. Nothing polls it; nothing compares it to a threshold; nothing fires when it goes stale for a `running` teammate.

### What to build

Reuse `raceNextChunkWithStallWatchdog` and `resolveStreamStallMs` from `packages/runtime/src/ai/server/providers/claudeCode/streamStallWatchdog.ts` (already imported and used by `ClaudeCodeProvider.ts:1118-1151` for the lead session's own pre-result stall detection) — do not build a new timeout mechanism from scratch. Convert `streamTeammateOutput`'s `for await` loop into a manual iterator-race loop, following the same shape as `ClaudeCodeProvider.ts:1096-1151`:

```ts
const iterator = (teammateQuery as AsyncIterable<any>)[Symbol.asyncIterator]();
const streamStallMs = resolveStreamStallMs();
while (true) {
  if (abortController.signal.aborted) {
    // teammate was explicitly stopped via stop(name)/killAll() — break, no error
    break;
  }
  const nextPromise = iterator.next();
  const raceResult = await raceNextChunkWithStallWatchdog<any>({
    nextPromise,
    interruptPromise: /* see "Interrupt racer" below */,
    watchdogActive: /* see "Arming condition" below */,
    stallMs: streamStallMs,
  });

  if (raceResult.kind === 'stalled') {
    void nextPromise.catch(() => {});
    console.error(`[MANAGED-TEAMMATE] STREAM_STALL_DETECTED for "${agentId}": no chunk for ${streamStallMs}ms. Aborting wedged subprocess.`);
    try { abortController.abort(); } catch { /* best effort */ }
    throw new Error(
      `Teammate "${name}" stopped responding: no output for ${Math.round(streamStallMs / 1000)}s.`
    );
  }
  if (raceResult.kind === 'chunk-error') {
    throw raceResult.error;
  }
  // raceResult.kind === 'interrupted' only if you wire an interrupt racer — see below
  const iterResult = raceResult.result;
  if (iterResult.done) break;
  const chunk = iterResult.value;
  // ... existing per-chunk body unchanged (session_id capture, flushPendingMessages,
  //     lastActiveAt update, tool-use counting, SendMessage-to-lead handling, etc.) ...
}
```

Throwing from inside the loop causes `streamTeammateOutput`'s returned promise to reject, which the existing call sites already `.catch((err) => this.handleStreamError(sessionId, agentId, teamName, err))` (non-background: `:1343-1345`; background: `:1404`; resumed-idle: `:1647`) — this is the funnel into 3a's notification wiring described above. **Do not call the notification primitive directly from inside this loop** — let the existing error-propagation path do it, exactly as the lead session's own watchdog does (`ClaudeCodeProvider.ts:1147-1151`: "Throw so the existing catch path... yields it to the UI").

### Arming condition — a real design decision, not fully specified by the PRD

`ClaudeCodeProvider`'s watchdog is deliberately **disarmed** while a tool is executing, a background sub-agent is draining, or the user has a pending permission/question prompt (`shouldArmStreamStallWatchdog`, `streamStallWatchdog.ts:56-66`) — those are legitimate long silences, not stalls. **`TeammateManager` has no equivalent per-teammate "pending permission" signal today.** A grep of this file for `blocked`/`pending` at brief-generation time found nothing — task `1a` (upstream of `3a`, itself upstream of this task) is expected to add a `blocked` status to `TeammateInfo` via a hook alongside `createCanUseToolHandler` at `TeammateManager.ts:1465`, but that hook lives outside `streamTeammateOutput`'s loop and there is no proven mechanism today for the loop itself to know "this teammate is currently waiting on a permission prompt, don't reap it."

You must resolve this before finalizing the arming condition. Two viable approaches:

1. **Track pending-permission state per teammate** (e.g. a `pendingPermission: boolean` field on `ManagedTeammate`, set/cleared by whatever hook 1a/3a's landed code uses around `createCanUseToolHandler`), and disarm the watchdog while it's true — mirroring `hasPendingUserInteraction()`'s role in the lead's own arming condition.
2. **Accept the tradeoff and rely on the stall window's size.** `resolveStreamStallMs()` defaults to 10 minutes (`DEFAULT_STREAM_STALL_MS = 600_000`, overridable via `NIMBALYST_CC_STREAM_STALL_MS`) — generous enough that a normal permission-approval wait is unlikely to trip it, but a teammate legitimately blocked on an unanswered prompt for >10 minutes would still be reaped and marked `errored`. If you take this approach, **document the tradeoff explicitly** in a code comment at the watchdog site and in your task completion report — do not silently ship it as if it were risk-free.

Whichever you choose, a teammate actively producing chunks (tool calls, assistant/user turns) must never be reaped — `lastActiveAt` already proves the data needed for "is this teammate alive" exists; the watchdog only needs to fire when *nothing* has happened for the full stall window, same semantics as the lead session's watchdog.

### Interrupt racer

`raceNextChunkWithStallWatchdog` requires an `interruptPromise` parameter. The lead session's own loop resolves this from a user-initiated interrupt (`this.interruptResolve`, `ClaudeCodeProvider.ts:1097-1099`). Teammates have no equivalent user-interrupt channel — per the existing code comment at `TeammateManager.ts:1309-1311`, "Teammate abort is intentionally NOT wired to the lead's abort signal... Teammates are only aborted by explicit `stop(name)` or `killAll()` calls," both of which call `tm.abort.abort()` (`:1663`, `:1698`) on the same `abortController` already passed into `streamTeammateOutput`. You have two reasonable options:

1. Pass a promise that never resolves (e.g. `new Promise<'interrupted'>(() => {})`) and rely on the existing `if (abortController.signal.aborted) break;` check at the top of each loop iteration to catch an explicit `stop`/`killAll` between chunks — simplest, consistent with the fact that teammates have no analogous "interrupt-with-message" mid-stream signal.
2. Derive an `interruptPromise` from `abortController.signal`'s `'abort'` event, so an explicit stop is caught immediately rather than only at the top of the next loop iteration (relevant if the loop is currently blocked inside `raceNextChunkWithStallWatchdog`'s `Promise.race`, since the top-of-loop check won't run again until the race resolves).

Prefer option 2 if it doesn't add meaningful complexity — it makes an explicit `stop(name)`/`killAll()` call actually interrupt an in-flight race rather than waiting up to `stallMs` for the next check. Document which you chose and why.

Fulfills requirement **R10**.

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] A teammate whose stream produces no chunk within the timeout window transitions to `errored`
- [ ] The stalled-teammate transition fires `showBlockedNotification` (or the equivalent distinct signal established by task `3a`) — verified by asserting the notification call, not just that an error was thrown
- [ ] A healthy teammate producing chunks normally is unaffected — no false-positive stall detection, no change to existing session-capture, message-flush, or tool-use-counting behavior in the per-chunk loop body
- [ ] Regression test proves both: stalled detection now fires (test that currently would hang forever without the fix, now resolves to `errored` within the test's shortened stall window), and healthy teammates are unregressed

**All criteria must pass before task is complete.**

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/runtime/src/ai/server/providers/TeammateManager.ts` | modify | Convert `streamTeammateOutput`'s `for await` loop (`:1493` at brief-generation time) into a manual iterator-race loop using `raceNextChunkWithStallWatchdog`/`resolveStreamStallMs`; add the `import` from `./claudeCode/streamStallWatchdog`; on stall, abort the teammate's `AbortController` and throw so the existing `.catch(err => handleStreamError(...))` sites pick it up. |
| Test file for `TeammateManager.ts` (new — no existing test file for this source file was found; follow the sibling naming convention, e.g. `packages/runtime/src/ai/server/providers/__tests__/TeammateManager.stallWatchdog.test.ts`) | create | Regression test(s) for the stalled and healthy cases. |

### File Ownership Notes

- **`TeammateManager.ts`** is also touched by task `1a` (upstream, already assumed landed — adds the `blocked` status-transition hook at `:1465`, outside this loop) and task `3a` (upstream, this task's direct dependency — extends the `teammates:allCompleted` emit payload and adds notification calls at the `handleStreamError`/`handleStreamCompletion`/`abandonIdleTeammates` sites, lines 205/1265/1288/1740/1757). This task's edits are scoped to `streamTeammateOutput`'s loop body (`:1410` onward) — **do not modify `handleStreamError`, `handleStreamCompletion`, `abandonIdleTeammates`, or the `createCanUseToolHandler` routing at `:1465`**; those are 1a's and 3a's landed scope. Your only interaction with 3a's code is relying on the existing `.catch(...)` call sites that already invoke `handleStreamError` — you do not need to (and should not) edit those call sites themselves.
- This task's core loop change (`:1493`-area) is a different section of the file from 3a's emit-site changes (`:205`, `:1265`, `:1288`, `:1740`, `:1757`) and 1a's routing change (`:1465`) — no line-level overlap expected, but confirm by reading the actual diffs of 1a/3a before starting, since exact line numbers will have shifted once those tasks land.
- Apply the same loop conversion to **all** call sites that run this streaming pattern, not just the primary one: `spawnManagedTeammate`'s non-background path (`:1335`/`:1341-1345`), `spawnBackgroundAgent`'s background path (`:1395`/`:1402-1404`), and the resumed-idle-teammate path (`:1619`/`:1645-1647`) all call `streamTeammateOutput` — since the loop lives inside that one shared function, converting it once covers all three call sites. Verify this by reading `streamTeammateOutput`'s full body before assuming a single conversion suffices.

---

## Implementation Guidance

### Patterns to Follow

- **Reuse `raceNextChunkWithStallWatchdog`/`resolveStreamStallMs` verbatim** from `packages/runtime/src/ai/server/providers/claudeCode/streamStallWatchdog.ts` — do not fork or reimplement the race/timer logic. This is the same NIM-1481 bug class already fixed for the lead session; the fix is a proven, tested primitive (see `claudeCode/__tests__/streamStallWatchdog.test.ts` for its own test coverage — you are not responsible for testing the helper itself, only your integration of it).
- **Mirror `ClaudeCodeProvider.ts:1096-1151`'s loop-conversion shape** (manual `iterator.next()` race replacing `for await`, abort-check at top of loop, throw-on-stall funneling into the existing catch path) — this is the direct precedent for converting a `for await` loop into a watchdog-raced loop in this codebase.
- **Write the regression test FIRST**, per `.claude/rules/end-to-end-verification.md`: reproduce "a teammate stream that never yields another chunk hangs forever" as a failing test (using a fake/mock async iterator that never resolves, with a short `NIMBALYST_CC_STREAM_STALL_MS` override so the test doesn't wait 10 real minutes), confirm it currently hangs/times out, then make the fix flip it to resolving with `errored` within the shortened window. Do not declare this task done on "the code path looks right."

### Code Style

- TypeScript throughout; match existing style in `TeammateManager.ts` — no reformatting of unrelated code.
- This file uses `console.log`/`console.warn`/`console.error` with a `[MANAGED-TEAMMATE]` tag for its debug logging (e.g. `:1282`: `` console.warn(`[MANAGED-TEAMMATE] "${agentId}" errored:`, err.message) ``) — match this convention for any new log lines (e.g. the stall-detected log). Do not introduce a different logger into this file.

### Edge Cases

- **Concurrent teammates are naturally isolated.** Unlike task `4a`'s fix (a single shared grace timer across concurrent Task sub-agents, masking one stalled sibling with a healthy one's activity), each teammate has its *own* `streamTeammateOutput` call and thus its own loop instance and its own watchdog race — there is no shared-timer masking risk here by construction. Do not add cross-teammate coordination; each teammate's stall detection must be fully independent.
- **Resumed idle teammates** (`streamTeammateOutput` called with `resumeSessionId` set, from the resumed-idle-teammate call site around `:1619`/`:1645-1647`) go through the same loop and must get the same watchdog — do not special-case resume to skip stall detection.
- **The `abandonIdleTeammates()` silent-death path** (`:205`, in 3a's scope) is a *different* failure mode from this task's stall watchdog — that path handles a teammate that already went `idle` (finished a turn, no more chunks expected) whose lead's transport died. This task's watchdog is for a teammate whose stream is still expected to produce chunks (mid-turn) but has gone silent. Do not conflate the two; do not modify `abandonIdleTeammates()`.
- **The permission-pending arming question** (see "Arming condition" above) is the single largest open design decision in this task — resolve it explicitly, do not leave the watchdog unconditionally armed without at least documenting the tradeoff if you choose not to build a `pendingPermission` gate.
- **`abortController.abort()` on stall** will also cause the SDK subprocess's own iterator to eventually reject/end — the `void nextPromise.catch(() => {})` line (mirroring `ClaudeCodeProvider.ts:1141`) exists specifically to prevent that now-abandoned `nextPromise` from becoming an unhandled promise rejection once the abort-induced rejection lands after you've already thrown. Keep this line; do not remove it as "dead code."

### Testing Requirements

- Regression test proving the **currently broken** behavior (a stream that never yields a second chunk hangs indefinitely) fails/hangs before your fix and resolves to `errored` within a short, overridden stall window after your fix — write this first.
- Test proving a **healthy** teammate (mock iterator that keeps yielding chunks on a normal cadence) is unaffected — completes normally, `lastActiveAt` still updates, no spurious stall/abort.
- Cover at least one of the non-primary call sites (background agent or resumed-idle) if your conversion touches shared code reachable from all three, to confirm the fix isn't accidentally scoped to only the primary spawn path.
- Use `NIMBALYST_CC_STREAM_STALL_MS` (via `resolveStreamStallMs`'s existing env-override support) to keep the test fast — do not wait out the real 10-minute default in a unit test.
- Mock the narrowest module needed — do not mock the `@nimbalyst/runtime` barrel; see the project's testing rule in the root `CLAUDE.md`.
- Add `// @vitest-environment node` as the first line of the new test file — this is pure main-process/runtime logic with no DOM.
- Run `npm run typecheck && npm run test:prepush` before pushing, per the repo's pre-push gate.

---

## Boundaries

### Files You MUST NOT Touch

Global `never_touch` list (`.nimble/config.yaml`):
- `package-lock.json`
- `packages/browser-extension/package-lock.json`
- `.env*`
- `.github/workflows/*`
- `packages/electron/src/database/migrations/*`
- `packages/electron/src/main/database/sqlite/schemas/*`
- `node_modules/`
- `**/dist/`
- `packages/electron/out/`
- `nimbalyst-local/`
- `.beads/`

Also, per this PRD's Agent Boundaries (§11) and this task's own scope:
- Do not modify `TeammateManager.ts:1465`'s `createCanUseToolHandler` routing or the `blocked` status-transition hook — that is task `1a`'s completed scope.
- Do not modify `handleStreamError`, `handleStreamCompletion`, or `abandonIdleTeammates`'s notification-emission logic — that is task `3a`'s completed scope; you only rely on the existing `.catch(...)` call sites that invoke `handleStreamError`, you do not edit them.
- Do not fold Meta-Agent Mode's independent `getStatusTone`/`getBarTone` status enum (`MetaAgentMode.tsx:67-104`) into anything here — out of scope, unrelated to this task.
- Do not modify `streamStallWatchdog.ts` itself (the shared helper) unless you discover a genuine bug in it while integrating — if so, flag it explicitly in your completion report rather than silently patching a shared primitive other providers depend on.
- Do not touch `ClaudeCodeProvider.ts`'s own watchdog usage (`:1096-1151`) — that is the reference pattern to follow, not a file this task modifies.

### Files Requiring Review

None of this task's files are in `.nimble/config.yaml`'s `require_review` list (`packages/runtime/src/auth/*`, `packages/electron/src/main/database/*`, `packages/electron/src/main/index.ts`, `packages/electron/src/main/bootstrap.ts`, `packages/electron/src/main/utils/protocolRegistration.ts`, `CHANGELOG.md`, `packages/collab-protocol/*`, `packages/collab-client/*`, `packages/collab-bundle/*`, `packages/collab-adapters/*`). This task does not require the human-review gate on its own — the PRD's single review gate is after wave 6, triggered by task `5a` touching `CHANGELOG.md`.

---

## Dependencies

### Upstream Tasks

| Task | What It Provides | Verify Before Starting |
|------|------------------|------------------------|
| `3a` | Distinct main-thread notification wiring into every `teammates:allCompleted` emit site, including `handleStreamError` — the funnel this task's thrown-on-stall error relies on. See "Assumed Precondition" above. | Read `3a`'s actual diff on `TeammateManager.ts` and confirm `handleStreamError` (or wherever the error path landed) results in a distinct notification, verified by 3a's own regression test — not just by reading the source and assuming it works. |
| `1a` (indirect, via 3a) | Adds `blocked` status to `TeammateInfo.status`, set/cleared via a hook alongside `createCanUseToolHandler` at `:1465`. Relevant to this task's "Arming condition" design decision (whether a per-teammate pending-permission signal exists to disarm the watchdog). | Check whether 1a's landed hook exposes a per-teammate boolean/flag usable from inside `streamTeammateOutput`'s loop, or whether it only affects the externally-reported `TeammateInfo.status` with no internal signal reachable from the loop. |

### Downstream Impact

Task `5a` (CHANGELOG entry and final review gate) depends on this task (along with `2c`, `2d`, `3b`, `4a`, `4c`) — it is the PRD's final gate task and will not run until this task's PR is merged/complete.

**Before starting:** Verify `3a` is complete by checking:
- `TeammateManager.ts`'s `teammates:allCompleted` emit sites (lines 205, 1265, 1288, 1740, 1757 as of the research pass) call `notificationService.showBlockedNotification` (or 3a's chosen equivalent) on error/abandon paths.
- `handleStreamError` specifically (`:1269-1290` as of this pass) results in a distinct notification when it fires — this is the exact path this task's stall-triggered error will flow through.
- `.nimble/prds/001_agent-visibility/status.json` → `tasks."3a".status` is not `queued`/`pending`.

---

## GitHub Context

**Issue:** Not yet created (tracker publish pending — see `status.json`)
**Feature Issue (Parent):** Not yet created
**Branch:** `worktree/agent-visibility-4b`
**Target:** `feature/agent-visibility` (this PRD runs in `feature-branch` execution mode per `status.json` — merges go to the feature branch, not directly to `main`)

---

## Commit Guidelines

Use Conventional Commits:
```
fix(teammates): add stream-stall watchdog to teammate spawn loop
```

Types: feat, fix, refactor, test, docs, chore

Do not add `Co-Authored-By` lines (project convention, `CLAUDE.md`).

---

## Deliverables

None beyond the files above. Per `tasks.yaml`'s `deliverables_note` for this task: "the regression test proving the fix is itself part of the code deliverable, not a separate artifact" — there is no migration, fixture regeneration, or doc update required for this task.

---

## Validation Checklist

Before creating PR:
- [ ] All success criteria met
- [ ] Build passes: `npm run build`
- [ ] Type check passes: `npm run typecheck`
- [ ] Test suite passes: `npm run test:unit` (and `npm run test:prepush` before pushing, per the repo's pre-push hook)
- [ ] No `never_touch` files modified
- [ ] Regression test added proving the stall → `errored`-transition-plus-notification behavior, and a second test proving healthy teammates are unregressed
- [ ] Arming-condition design decision (permission-pending gate vs. documented tradeoff) resolved and documented, not left implicit
- [ ] Branch rebased on `feature/agent-visibility` (this PRD's target, not `main`)
- [ ] CHANGELOG.md NOT touched by this task (that is task 5a's exclusive scope, gated for human review)
- [ ] Confirmed 3a's actual notification pattern was reused via the existing `handleStreamError` funnel, not reinvented (see "Assumed Precondition" section)

---

*Generated by NIMBLE Brief Writer*
*PRD: agent-visibility | Task: 4b | Wave: 4*
