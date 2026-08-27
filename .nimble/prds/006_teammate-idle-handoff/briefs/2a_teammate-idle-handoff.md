# Task Brief: 2a

**Title:** Truthful abort status and tool-count continuity
**PRD:** teammate-idle-handoff
**Priority:** must
**Complexity:** 4/10
**Model:** sonnet
**Wave:** 2
**Feature Issue:** TBD — assigned by PM agent at execution start

---

## Objective

Two metadata fixes in `TeammateManager.ts`, sequenced after task 1b (same file): (1) `killAll`
stops painting idle (finished-work) teammates as `errored` on session abort — it now emits
`completed` for them, matching `stop`/`stopByAgentId` precedent; (2) a teammate's real
`toolCallCount`/`lastActiveAt` survive the running→idle transition and a subsequent resume,
instead of being dropped/reset to zero.

---

## Context

**Parent Feature:** Teammate Idle Handoff (PRD `teammate-idle-handoff`, GitHub feature issue TBD)

`killAll()` (`TeammateManager.ts:2078-2115`, current file state) is called only from
`ClaudeCodeProvider.abort()` — not a periodic sweep. It clears both `managedTeammates` (actually
aborted mid-run) and `idleTeammates` (finished their turn, just parked) into one flat list of
`allAgentIds`, then blanket-emits `'errored'` for all of them at `:2108-2113`:

```ts
if (allAgentIds.length > 0 && this.lastUsedSessionId) {
  const overrides = new Map(allAgentIds.map(id => [id, 'errored' as const]));
  this.emitTeammateUpdate(this.lastUsedSessionId, overrides).catch(err => {
    console.error('[CLAUDE-CODE] Failed to emit teammate kill update:', err);
  });
}
```

Contrast `stopByAgentId` (`:2133-2157`) and `stop(name)` (`:2159-2186`), both of which already emit
`'completed'` for idle teammates and `'errored'` only for genuinely-running ones. **Live-observed
effect** (session c29787e7, 2026-08-27): weatherman finished its work (3 real tool calls, correct
answer) and went idle; 12 minutes later a session abort ran `killAll`, which painted it `Error`
with `0 tool calls` — a teammate that succeeded was shown as having failed and done nothing.

The "0 tool calls" half of that same trace is a separate, coordinated defect: `IdleTeammate`
(`TeammateManager.ts:40-50`) carries no `toolCallCount`/`lastActiveAt` fields at all, so both
`emitTeammateUpdate` idle-entry code paths omit them from what they emit, and `resumeIdleTeammate`
(`:2064`, current file state: `toolCallCount: 0,`) always re-registers a resumed teammate starting
from zero, discarding whatever it accumulated before going idle.

This task is part of **Wave 2** — it depends on task 1b (`depends_on: ["1b"]`), sequenced because
both edit `TeammateManager.ts`; this task's `managed` entry capture (see Requirements item 2)
reads the same local variable 1b's idle-branch delivery call sits downstream of.

---

## Research Context

Rely on the following verified finding (`research/internal/findings.md` "T6") — do not
re-derive it:

**Renderer needs no changes for these fixes.** `TeammateThreadPopover.tsx`'s header/tool-count/
footer read the emitted `status`/`toolCallCount` directly off the wire object, so fixing
`killAll`'s emission (`'errored'` → `'completed'` for idle teammates) fixes the popover header for
free; its "no longer active" footer already treats `completed` as inactive. In `TeammatePanel.tsx`,
the `'0 tool calls'` symptom is an **omission**, not a wrong-guard bug: idle metadata entries
simply lack `toolCallCount` entirely, so the `> 0` guard at `TeammatePanel.tsx:365` renders no stat
at all. Once the field exists on the idle entry with its real accumulated value, the guard renders
it correctly — a zero-tool teammate reading "0 tool calls" in the **popover** specifically (which
renders on `!== undefined`, not `> 0`) is truthful once this task lands, not a regression to guard
against.

---

## Requirements

Fulfills PRD requirements **R4** (truthful abort status) and **R5** (tool-count continuity).

### Part 1 — `killAll` status split (R4)

Split `killAll`'s single blanket `'errored'` override into two buckets: agents cleared from
`managedTeammates` (actually aborted mid-run, at `:2082-2091`) stay `'errored'`; agents cleared
from `idleTeammates` (finished their turn, at `:2093-2101`) emit `'completed'`. Per PRD Decision D4:
**reuse `'completed'`, do not invent a new wire/display status** — `mapTeammateStatus` has exactly
5 buckets and the popover footer already treats `completed` as inactive; `stop`/`stopByAgentId`
already made this same choice for idle teardown.

Implementation shape (from `tasks.yaml`'s own guidance): collect running vs. idle ids into one
`Map<string, 'errored' | 'completed'>` for the existing single `emitTeammateUpdate` call at
`:2111` (you will need to widen the `'as const'` currently pinning the map's value type to
`'errored'` at `:2109`, since the map now carries two possible statuses). Populate the map inside
the two existing loops (`:2084-2089` for running, `:2095-2098` for idle) instead of building
`allAgentIds` and mapping it to a single status afterward. The `lastUsedSessionId`-undefined guard
that gates the whole emit at `:2108` is unchanged — do not alter when the emit fires, only what
status each id maps to.

### Part 2 — Tool-count continuity (R5), four coordinated pieces

1. **`IdleTeammate` gains OPTIONAL fields**: `toolCallCount?: number; lastActiveAt?: number` on
   the exported interface (`TeammateManager.ts:40-50`). They must be **optional**, not required —
   `IdleTeammate` is constructed as a bare object literal in
   `TeammateManager.stallWatchdog.test.ts:105` (`idleAlice`, seen directly in that file) and in
   `TeammateManager.resumeReliability.test.ts:119` (PRD 003's test) without these fields; making
   them required would break typecheck in test files this task does not own and must not touch.
2. **In `handleStreamCompletion`'s idle branch** (`:1542-1549`, the same branch task 1b instruments
   for delivery), populate the new fields from the `managed` entry already captured at `:1531`
   (`const managed = this.managedTeammates.get(agentId);`) — **before** the `:1534` delete:
   ```ts
   this.idleTeammates.set(agentId, {
     ...idleTemplate,
     sessionId: result.capturedSessionId,
     toolCallCount: managed?.toolCallCount ?? 0,
     lastActiveAt: managed?.lastActiveAt,
   });
   ```
   **Do NOT source from `idleTemplate`** — it is the spawn-time literal passed into
   `handleStreamCompletion` (constructed at `spawnManagedTeammate`/`spawnBackgroundAgent`, roughly
   `:1674`/`:1735` in the current file, or the *previous* idle record on the resume path, roughly
   `:2068`). Either source would give you a stale, pre-this-run count — `managed` (the live
   `ManagedTeammate` entry that `streamTeammateOutput` increments in real time at its
   `chunk.message.content` tool-use loop) is the only correct source of the count from the run that
   just finished.
3. **Both idle-entry paths in `emitTeammateUpdate` must carry the fields:**
   - The push loop (`:1488-1501`, fires only for agents with no persisted row yet) — add
     `toolCallCount: tm.toolCallCount, lastActiveAt: tm.lastActiveAt,` to the pushed object
     literal, reading off the `IdleTeammate` (`tm`) you just extended in Part 2 item 2.
   - The `existingTeammates.map` idle branch (`:1461-1467`, fires whenever a row already exists —
     e.g. after a resume's own `'running'` emit already wrote a row for this `agentId`). This
     branch currently spreads the **stale previous persisted row** (`{ ...tm, sessionId: ...,
     status: 'idle' as const }`) — it must instead read the current values off
     `this.idleTeammates.get(tm.agentId)` (the same map key used two lines above for `sessionId`)
     so a resume→re-idle cycle emits the *accumulated* count, not whatever the row said before the
     resume:
     ```ts
     } else if (this.idleTeammates.has(tm.agentId)) {
       const idleInfo = this.idleTeammates.get(tm.agentId);
       return {
         ...tm,
         sessionId: idleInfo?.sessionId ?? tm.sessionId,
         toolCallCount: idleInfo?.toolCallCount,
         lastActiveAt: idleInfo?.lastActiveAt,
         status: 'idle' as const,
       };
     }
     ```
4. **`resumeIdleTeammate` seeds `toolCallCount` from the idle record**, not `0`. At `:2064`
   (current file state: `toolCallCount: 0,` inside the `ManagedTeammate` object constructed for the
   resume), change to `toolCallCount: idleInfo.toolCallCount ?? 0,` so the count accumulates
   across resume cycles rather than resetting each time. `idleInfo` is the `IdleTeammate` parameter
   already in scope for `resumeIdleTeammate` (see its signature at the top of that method).
5. **`PersistedTeammateRow` (`:57-66`) and `rehydrateIdleTeammate` (`:1323-1333`, current file
   state) gain the count** so a post-restart host-send resume (`sendMessageFromHost`'s third
   branch, around `:1266`, which calls `rehydrateIdleTeammate` when neither `managedTeammates` nor
   `idleTeammates` has the agent — i.e. a fresh process after a restart) does not reset to `0`. Add
   `toolCallCount?: number;` to `PersistedTeammateRow`, and in `rehydrateIdleTeammate`'s returned
   `IdleTeammate` object literal (`:1323-1333`), add `toolCallCount: entry.toolCallCount,` sourced
   from the persisted row.

### Explicit anti-goals (do not implement)

- **Do not invent a new wire/display status** for the idle-abort case (PRD Decision D4) — reuse
  `'completed'`.
- **Do not source the idle branch's `toolCallCount`/`lastActiveAt` from `idleTemplate`** — see Part
  2 item 2 above; this is the most likely mistake in this task.
- **Do not make the new `IdleTeammate` fields required** — see Part 2 item 1; this would break
  typecheck in `TeammateManager.stallWatchdog.test.ts` and
  `TeammateManager.resumeReliability.test.ts`, files this task does not own.
- **Do not touch the renderer** (`TeammatePanel.tsx`, `TeammateThreadPopover.tsx`) — T6 confirms no
  renderer change is needed; both already read the emitted fields correctly once they exist.

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] `killAll` with one running and one idle teammate emits `'errored'` for the running one and
      `'completed'` for the idle one
- [ ] Idle metadata entries in `emitTeammateUpdate` include `toolCallCount` and `lastActiveAt` with
      the values from the teammate's run, in BOTH the push loop and the `existingTeammates.map`
      idle branch
- [ ] A resume→re-idle cycle emits the accumulated count (row already present in
      `currentTeammates`), not the pre-resume value
- [ ] `resumeIdleTeammate` registers the resumed teammate with the accumulated prior
      `toolCallCount`, not `0`; the count survives a restart via `PersistedTeammateRow`/
      `rehydrateIdleTeammate`
- [ ] `IdleTeammate` type changes are confined to `TeammateManager.ts` (or its types module); no
      wire-protocol/renderer changes needed

**All criteria must pass before task is complete.**

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/runtime/src/ai/server/providers/TeammateManager.ts` | modify | Split `killAll`'s status emission (running vs. idle); add optional `toolCallCount`/`lastActiveAt` to `IdleTeammate`; populate them at the idle-branch construction site, both `emitTeammateUpdate` idle-entry paths, `resumeIdleTeammate`, `PersistedTeammateRow`, and `rehydrateIdleTeammate` |

### File Ownership Notes

Depends on task 1b landing first (`depends_on: ["1b"]`) — same file, sequenced to avoid a
concurrent-edit window. This task's `managed` entry read (Part 2 item 2) is downstream of 1b's own
`deliverMessageToLead` call in the same idle branch — re-read the current state of the idle branch
before editing; do not remove or reorder 1b's delivery call while adding the new fields to the
`idleTeammates.set(...)` object literal.

---

## Implementation Guidance

### Patterns to Follow

- `stopByAgentId` (`:2133-2157`) and `stop(name)` (`:2159-2186`) — the existing precedent for
  emitting `'completed'` for idle teardown vs. `'errored'` for running teardown. `killAll`'s split
  should read as the same policy applied to the abort path.
- The running-entries push loop (`:1474-1486`) already includes `toolCallCount`/`lastActiveAt` —
  use it as the shape reference for what the idle push loop (`:1488-1501`) should add.
- `TeammateManager.test.ts:264-277`'s `stopByAgentId` test — the closest existing precedent for
  asserting status-emission-split behavior in this file, useful to skim before writing your own
  change (task 3a writes the actual test, but reading this helps you match the emission shape it
  will assert against).

### Code Style

Plain `Map`s and object-literal spreads, matching the surrounding file's style. Use `??` for the
optional-field fallbacks (`managed?.toolCallCount ?? 0`), not `||` (a legitimate `0` must not be
treated as falsy-and-replaced).

### Edge Cases

- **A `managed` entry that is somehow already gone** by the time the idle branch runs (should not
  happen — `handleStreamCompletion` is the only caller that deletes `managedTeammates` for this
  `agentId`, and it deletes it at `:1534`, one line before the idle branch reads `managed`, which
  was already captured at `:1531` — but guard with `managed?.toolCallCount ?? 0` regardless, not a
  throw).
- **`lastActiveAt` has no sensible zero-fallback** — leave it `undefined` when `managed` is
  unexpectedly absent (don't fabricate `Date.now()` as a fallback; that would misrepresent when the
  teammate was actually last active).
- **Two teammates aborted together via `killAll`, one running and one idle** — the Map-based
  approach (Part 1) naturally handles this per-id; verify your loop changes don't accidentally
  collapse both into the same status bucket.

### Testing Requirements

No test file exists for `killAll` today (confirmed by research T7 — zero existing coverage of
`killAll`, `MAX_CONTINUATIONS`, or `handlePostLeadTurnTeammateState`). This task does not require
writing its own test — task 3a (dedicated test task, `depends_on: ["1a", "1b", "2a"]`) covers both
parts of this task (`killAll` status split, tool-count continuity across both `emitTeammateUpdate`
paths and resume) as required coverage points.

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
- Do not touch `TeammatePanel.tsx`, `TeammateThreadPopover.tsx`, or any renderer file — T6
  confirms no renderer change is needed.
- Do not touch `ClaudeCodeProvider.ts` or `MessageStreamingHandler.ts`.
- Do not touch the Task-subagent system (`activeTasks` in `ClaudeCodeProvider.ts`, PRD 004's
  tile/popover UI) — this PRD is TEAMMATE-lifecycle only.
- Do not modify `TeammateManager.stallWatchdog.test.ts` or
  `TeammateManager.resumeReliability.test.ts` — if your `IdleTeammate` change breaks their bare
  object-literal construction, the fix is making the new fields optional (Part 2 item 1), not
  editing those test files.

### Files Requiring Review

`TeammateManager.ts` is under `packages/runtime/**`, not `packages/electron/src/main/**` — it is
not in `.nimble/config.yaml`'s `require_review` list. This task does not trigger the PRD's
human-review gate on its own.

---

## Dependencies

### Upstream Tasks

| Task | What It Provides | Verify Before Starting |
|------|------------------|------------------------|
| 1b | `deliverMessageToLead` call added to `handleStreamCompletion`'s idle branch, `managed` variable still captured at `:1531` before the `:1534` delete | Confirm 1b's diff has landed; re-read the current state of the idle branch (`:1542-1549` region) before adding the new fields to the `idleTeammates.set(...)` call, since 1b's own edit sits in the same branch and line numbers may have shifted slightly. |

### Downstream Impact

| Task | What it needs from 2a | Why |
|------|------------------------|-----|
| 3a | The `killAll` status split and all five tool-count-continuity pieces | 3a's dedicated test file asserts both parts of this task's behavior as required coverage points. |

**Before starting:** Confirm task 1b has merged; re-read the current line numbers for
`handleStreamCompletion`'s idle branch, since this brief's line references are pinned to the
pre-1b state of the file plus 1b's own expected edit (both verified 2026-08-27, but exact offsets
may drift by a few lines).

---

## GitHub Context

**Issue:** TBD — created by PM agent at execution start
**Feature Issue (Parent):** TBD — created by PM agent at execution start
**Branch:** `worktree/teammate-idle-handoff-2a`
**Target:** Determined by PM agent based on execution mode (feature branch or main)

---

## Commit Guidelines

Use Conventional Commits:
```
fix(teammates): stop showing finished teammates as errored on abort, keep their tool count
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
- [ ] `IdleTeammate`'s new fields confirmed optional (not required)
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
*PRD: teammate-idle-handoff | Task: 2a | Wave: 2*
