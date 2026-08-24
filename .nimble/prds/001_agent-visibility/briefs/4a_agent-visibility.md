# Task Brief: 4a

**Title:** Fix concurrent Task sub-agent stall masking
**PRD:** agent-visibility
**Priority:** must
**Complexity:** 6/10
**Model:** opus
**Wave:** 2
**Feature Issue:** Not yet created — no GitHub issue has been filed for this PRD as of brief generation. The PM agent will populate this field (and the branch's PR target) at execution start; if you need the parent context, it lives at `.nimble/prds/001_agent-visibility/PRD_agent-visibility.md`.

---

## Objective

When multiple SDK-native Task sub-agents drain concurrently after the lead's own `result` chunk has arrived, a genuinely stalled sub-agent is currently masked indefinitely by any healthy sibling's activity — because all sub-agents share one reset-on-any-chunk grace timer. Add per-task-id last-activity tracking so a stalled task is individually detectable within a bounded window, without touching the pre-result stall watchdog or regressing the solo-sub-agent case (which is already correct today).

This fulfills PRD requirement **R11**.

---

## Context

**Parent Feature:** Agent Visibility and Workflow Enhancement (`.nimble/prds/001_agent-visibility/PRD_agent-visibility.md`)

Nimbalyst has three separate "spawned agent" systems: SDK-native Task sub-agents, Nimbalyst
Teammates, and Meta-Agent Mode child sessions. This PRD closes a visibility/reliability gap
between Nimbalyst's sub-agents and native Claude Code's sub-agent UX: a chip row, a `blocked`
status, click-to-thread, and guaranteed notifications when a sub-agent dies or blocks.

**Amendment context (2026-08-22):** this task belongs to a later addition to the PRD (R10-R12,
tasks 4a-4c), triggered by a user-reported recurring failure: "a spawned agent designed to report
back either never reports, or the main session never wakes." Investigating that report surfaced
three separate hang/wake-delivery gaps across Teammates, Task sub-agents, and NIMBLE's own
`nimble-pm` orchestration (the last of which is explicitly out of scope for this codebase — see
PRD §2 Amendment Context and §3 Non-Goals). Task 4a is the Task-sub-agent-specific fix from that
set; 4b (Teammate stream-stall watchdog) and 4c (silent-drop wake-delivery fallback) are its
siblings, each a separate task/brief.

This task runs in **Wave 2** of the execution plan (`execution_plan.yaml`), alongside 1a (add
`blocked` to `TeammateInfo.status`) — which does not touch the same file region as this task.

---

## Requirements

### The mechanism that exists today (do not confuse the two)

`packages/runtime/src/ai/server/providers/ClaudeCodeProvider.ts` has **two distinct**
"has the stream gone quiet" mechanisms, armed in different phases of a turn:

1. **Pre-result stall watchdog** (`shouldArmStreamStallWatchdog`, defined in
   `packages/runtime/src/ai/server/providers/claudeCode/streamStallWatchdog.ts:56-66`, invoked at
   `ClaudeCodeProvider.ts:1118-1123`). Races `iterator.next()` against a timer
   (`raceNextChunkWithStallWatchdog`, `streamStallWatchdog.ts:84-118`) but is **only armed** while
   `resultReceivedTime === null && outstandingToolCalls === 0 && !hasRunningTasks &&
   !hasPendingUserInteraction` — i.e. before the lead's own answer is done, with nothing else
   legitimately explaining silence. This is a correctly-scoped, already-shipped mechanism
   (NIM-1481 / GitHub #802). **This task does not touch it.**

2. **Post-result drain grace timer** (`armPromptEndTimer`, `ClaudeCodeProvider.ts:1048-1057`,
   using `SUBAGENT_DRAIN_GRACE_MS = 5 * 60_000` at `ClaudeCodeProvider.ts:1038`). Armed once the
   real `result` chunk lands (`ClaudeCodeProvider.ts:1192-1196`, `'grace-period-after-result'`)
   and **reset on every subsequent chunk of any kind** (`ClaudeCodeProvider.ts:1197-1200`,
   `'grace-period-reset-on-activity'`) — including chunks unrelated to any specific sub-agent
   (e.g. task-list system reminders). It exists to keep stdin open long enough for a legitimately
   still-working background sub-agent to finish, and to eventually reap a genuinely dead one
   (comment at `ClaudeCodeProvider.ts:1031-1037`, NIM-1344 / GitHub #732). **This is the mechanism
   with the bug this task fixes.**

### The bug (R11)

With **one** Task sub-agent running solo post-result, the 5-minute grace timer works correctly:
nothing else resets it, so if that sole sub-agent goes silent, the timer eventually expires and
the drain logic reaps it (`finalizeBackgroundDrain`, `ClaudeCodeProvider.ts:2668-2750`, via
`reapRunningTasks`, `packages/runtime/src/ai/server/providers/claudeCode/subagentDrain.ts:216-225`).
**Do not change this solo-agent path — it is already correct and a regression test must prove it
stays that way.**

With **two or more** Task sub-agents draining concurrently post-result, the single shared timer
resets on **any** of their chunks. A genuinely stalled sub-agent (no `task_progress`/
`task_notification`/`task_updated` chunk carrying its `task_id` for an arbitrarily long time) is
masked forever as long as at least one sibling keeps producing chunks — the shared timer never
expires, so the stalled sub-agent is never individually flagged.

### The fix

Add **per-task-id last-activity tracking**, mirroring the pattern already used for Nimbalyst
Teammates: `TeammateManager.ts:1524` sets `managedEntry.lastActiveAt = Date.now()` on every
assistant/user chunk for that specific teammate. The Task sub-agent equivalent of a "managed
entry" is `this.activeTasks` (a `Map<string, TaskEntry>` on `ClaudeCodeProvider`), populated and
updated inside `handleSystemTask` (`ClaudeCodeProvider.ts:2752-2820`):

- `task_started` (`:2754-2766`) creates the entry (`taskId`, `description`, `taskType`, `status`,
  `startedAt`, `toolUseId`, `toolCount`, `tokenCount`, `durationMs`).
- `task_progress` (`:2768-2776`) is the per-task activity heartbeat — it already carries
  `chunk.task_id` and updates `toolCount`/`tokenCount`/`durationMs`/`lastToolName` on the matching
  entry.
- `task_notification` (`:2777-2802`) and `task_updated` (`:2803-2819`) also key off `chunk.task_id`
  and mutate the same entry.

These three branches are the natural sites to also stamp a new `lastActivityAt` (or equivalent)
timestamp field on the per-task entry, since they are the only chunk types that carry a
`task_id` at all — the shared grace timer's `armPromptEndTimer('grace-period-reset-on-activity')`
call at `:1197-1200` fires on every chunk regardless of whether it's task-attributable, which is
exactly why it over-resets today.

With per-task last-activity available, add a way to individually detect a task whose own
last-activity has exceeded the grace window even while `armPromptEndTimer`'s shared timer keeps
getting reset by a healthy sibling. `packages/runtime/src/ai/server/providers/claudeCode/subagentDrain.ts`
is the existing home for this class of pure, unit-testable decision helper (see
`hasRunningTasks`, `reapRunningTasks`, `countRunningTasks`, `classifyDrainOutcome` already there,
each documented as "extracted as pure functions so the teardown logic can be unit-tested without
the full SDK streaming machinery") — a new helper here (e.g. something in the shape of
`findStalledTasks(tasks, nowMs, staleMs)`) is a strong fit for the same pattern, called from
wherever the provider already has an opportunity to check staleness (a chunk-driven check inside
`handleSystemTask`/the streaming loop, since there is no separate polling timer today — introducing
one is also a valid design choice, but must not leak/outlive the turn).

The exact reaping/flagging behavior (mark the task `stopped` similar to `reapRunningTasks`, emit a
warning log, call `emitTaskUpdate`, or some combination) is an implementation choice — the success
criteria require detectability within a bounded window, not a specific downstream reaction. Task
4a's success criteria do **not** require wiring a user-facing notification for this case (that is
task 3a/4b's concern for Teammates, and is not listed in this task's criteria below) — but do not
actively prevent a later task from building on whatever signal you emit.

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] With two concurrent Task sub-agents, one stalled and one healthy and actively producing chunks, the stalled one is still detected/flagged within a bounded window — not masked indefinitely by the healthy sibling
- [ ] A solo sub-agent's existing 5-minute grace-timer reap behavior (already correct today) is unaffected
- [ ] The pre-result `shouldArmStreamStallWatchdog` arming condition is NOT modified by this task
- [ ] Regression test proves both: concurrent-stall detection now fires, and solo/healthy cases are unregressed

**All criteria must pass before task is complete.**

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/runtime/src/ai/server/providers/ClaudeCodeProvider.ts` | modify | Stamp per-task last-activity in `handleSystemTask` (`:2752-2820`); add the call site that checks/reaps a stalled task individually. Do not touch the pre-result watchdog invocation (`:1118-1123`) or `shouldArmStreamStallWatchdog` itself. |
| `packages/runtime/src/ai/server/providers/claudeCode/subagentDrain.ts` | modify (likely) | Natural home for a new pure, testable helper (e.g. `findStalledTasks`) alongside the existing `hasRunningTasks`/`reapRunningTasks`/`classifyDrainOutcome` — optional if you choose to inline the logic in the provider instead, but the existing module strongly suggests this is where the project wants this class of logic to live. |
| `packages/runtime/src/ai/server/providers/__tests__/ClaudeCodeProvider.taskReap.test.ts` | modify (likely) | Existing white-box test file for `activeTasks`/`hasRunningTasks` internals (accesses provider internals via `provider as unknown as ProviderInternals`, see its `internals()` helper) — the closest existing home for this task's regression test. Prefer extending it over creating a new file (per this repo's token-discipline testing rule) unless the new pure helper in `subagentDrain.ts` warrants its own colocated unit test file (that module has no dedicated test file today — check for one before assuming). |

### File Ownership Notes

This task and **1b** (`Add blocked status to TaskInfo.status`) both touch
`ClaudeCodeProvider.ts`, but in different, non-overlapping sections: 1b edits the `canUseTool`
routing (`:3648`, `:3705-3760`); this task edits the post-result drain-grace region
(`:1038-1057`, `:1192-1200`) and the `handleSystemTask` chunk handler (`:2752-2820`). This task
`depends_on: ["1b"]` purely to sequence the two edits and avoid a merge conflict on the same
file — it is **not** a functional/data dependency (see Dependencies section below for the
distinction and what to verify anyway).

No other task in this PRD touches `ClaudeCodeProvider.ts` in this wave.

---

## Implementation Guidance

### Patterns to Follow

- **`TeammateManager.ts:1524`** — `managedEntry.lastActiveAt = Date.now()` on every
  assistant/user chunk for a specific teammate. This is the exact pattern to mirror per-`task_id`
  on `activeTasks` entries; the PRD's own R11 text names this as the reference pattern.
- **`packages/runtime/src/ai/server/providers/claudeCode/subagentDrain.ts`** — the project's
  existing convention for extracting pure, synchronously-testable decision functions out of the
  streaming loop (`hasRunningTasks`, `reapRunningTasks`, `countRunningTasks`,
  `classifyDrainOutcome`, `shouldDeferTeardownForSubagents`, `shouldExitDrain`). New staleness-
  detection logic belongs in the same style: a plain function over `Iterable<...>` with no
  dependency on the provider class, unit-testable in isolation.
- **`packages/runtime/src/ai/server/providers/__tests__/ClaudeCodeProvider.taskReap.test.ts`** —
  shows the established white-box pattern for testing `activeTasks`/`hasRunningTasks` without
  mocking the full SDK: cast the provider via a narrow `ProviderInternals` type
  (`provider as unknown as ProviderInternals`) and manipulate `state.activeTasks` directly. Reuse
  this shape for the new regression test rather than inventing a new test harness.
- **`packages/runtime/src/ai/server/providers/claudeCode/streamStallWatchdog.ts`** — read this
  file in full to understand *why* the pre-result watchdog is scoped the way it is (its top-of-file
  comment explains the exact "SDK subprocess goes silent mid-turn without emitting result/error"
  failure class). Understanding it is necessary context for this task, but its `stallMs`/race-based
  mechanism is **not** what you are building here — the fix for this task is a reset-tracking
  fix on the existing grace-timer mechanism, not a new race-against-timer watchdog. Do not merge
  the two mechanisms or make the post-result fix reuse `raceNextChunkWithStallWatchdog`.

### Code Style

Standard project TypeScript conventions; no new dependencies required. Follow the existing
logging convention in this file (`console.log`/`console.warn`/`console.error` with a
`[CLAUDE-CODE]` prefix and an UPPER_SNAKE_CASE event tag, e.g. `STREAM_STALL_DETECTED`,
`SUBAGENT_DRAIN`, `SUBAGENT_TASK`) if you add a log line for the new detection path.

### Edge Cases

- **A task legitimately waiting on a permission prompt is not the same as a stalled task.** Task
  1b (upstream dependency) adds a `blocked` value to `TaskInfo.status`
  (`packages/electron/src/renderer/store/atoms/agentMode.ts:233`), set when that specific task's
  permission request is pending. A task in that state may legitimately produce no chunks for a
  while — it is waiting on the *user*, not silently hung. The pre-result watchdog already treats
  `hasPendingUserInteraction` as a reason to stay disarmed (`streamStallWatchdog.ts:60,65`); when
  designing this task's per-task staleness check, consider whether a task whose corresponding
  `activeTasks` entry (or `TaskInfo.status`, if threaded through) shows `blocked` should be
  exempted from being flagged as "stalled," the same way the existing pre-result mechanism exempts
  pending-interaction. This is not itself a listed success criterion for this task — it is a
  correctness consideration so the new mechanism doesn't introduce a *false-positive* reap of a
  task that is correctly waiting on a human, once 1b's `blocked` status exists. Verify current
  behavior around this before finalizing your detection logic; note your reasoning either way in
  the PR description if you decide it's out of scope for this task specifically.
- **A task with no chunk yet at all** (i.e. `task_started` fired but no `task_progress` has
  arrived yet) needs a sane default for "last activity" — likely `startedAt`
  (`ClaudeCodeProvider.ts:2760`) — so it isn't immediately flagged as stalled before it's had a
  chance to produce its first progress chunk.
- **Multiple sibling tasks stalled simultaneously** should each be individually detectable — don't
  build a mechanism that only handles "exactly one stalled, one healthy."

### Testing Requirements

**Write the regression test FIRST**, per `.claude/rules/end-to-end-verification.md`: reproduce
"one stalled Task sub-agent is masked by a healthy concurrent sibling's activity resetting the
shared grace timer" as a failing test, confirm it fails, then make the fix flip it green. Do not
declare this task done on "the code path looks right" — this is exactly the class of bug that
rule exists to prevent, and the PRD's own task description repeats this instruction.

The regression test must prove, at minimum:
1. Concurrent-stall case: two tracked tasks, one whose last-activity timestamp is stale beyond the
   grace window, one whose chunks keep arriving — the stale one is individually detected/flagged;
   the healthy one is not.
2. Solo-agent regression guard: a single tracked task going silent still gets reaped via the
   existing shared-timer path, unaffected by whatever new per-task mechanism you add.
3. The pre-result `shouldArmStreamStallWatchdog` function's behavior/exported shape is unchanged —
   a simple `import` + direct assertion against `streamStallWatchdog.test.ts`'s existing coverage
   (`packages/runtime/src/ai/server/providers/claudeCode/__tests__/streamStallWatchdog.test.ts`) is
   sufficient evidence; you do not need to duplicate that file's test cases, just avoid touching
   the function it covers.

This task is not a test-only task (see Coverage Expectations note below) — this section applies in
addition to, not instead of, normal code changes.

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

**Task-specific boundary (the point of this brief's re-scoping — see PRD §12 Assumption 10):**

- **Do NOT modify `shouldArmStreamStallWatchdog`'s arming condition**
  (`packages/runtime/src/ai/server/providers/claudeCode/streamStallWatchdog.ts:56-66`) or its
  invocation site (`ClaudeCodeProvider.ts:1118-1123`). This function/mechanism is the **pre-result**
  watchdog and is correctly scoped already — an earlier draft of this task incorrectly targeted
  it, was re-reviewed against the actual code, and was corrected. If your implementation finds
  itself editing this function or its call site, stop — you have drifted back into the original,
  incorrect scoping. The bug this task fixes is entirely in the **post-result**
  `armPromptEndTimer`/`SUBAGENT_DRAIN_GRACE_MS` region (`ClaudeCodeProvider.ts:1038-1057`,
  `1192-1200`) and the per-task chunk handling (`handleSystemTask`, `:2752-2820`).
- Do not modify `packages/electron/src/renderer/components/MetaAgentMode/MetaAgentMode.tsx`'s
  `getStatusTone`/`getBarTone` status-mapping logic (lines 67-104) — out of scope for the entire
  PRD, unrelated to this task's file anyway.
- Do not modify `packages/electron/src/main/services/ai/claudeCliSubAgentTracker.ts`'s
  transcript-hiding logic — deliberate design, out of scope for the entire PRD.
- Do not build a NIMBLE-side (`nimble-pm`/`.claude/plugins/nimble`) worker-liveness fix as part of
  this task — that gap lives in a separate sibling repository and is explicitly out of scope for
  this PRD (PRD §2 Amendment Context, §3 Non-Goals).

### Files Requiring Review

None of this task's files (`ClaudeCodeProvider.ts`, `subagentDrain.ts`, its test file) are in
`.nimble/config.yaml`'s `require_review` list. This task does not require the human-review gate on
its own — only task 5a (`CHANGELOG.md`) does, at the end of the PRD (see Dependencies below).

---

## Dependencies

### Upstream Tasks

| Task | What It Provides | Verify Before Starting |
|------|------------------|------------------------|
| **1b** — Add `blocked` status to `TaskInfo.status` | Adds `'blocked'` as a valid value of `TaskInfo.status` (`packages/electron/src/renderer/store/atoms/agentMode.ts:233`, today `'running'\|'completed'\|'failed'\|'stopped'`), set/cleared via per-task-attributed `canUseTool` routing in `ClaudeCodeProvider.ts` (`:3648`, `:3705-3760`). **This is a file-overlap-avoidance dependency, not a functional one** — task 4a's fix does not require 1b's code to exist to work correctly. However: (a) confirm 1b's branch is merged/rebased into your working branch before starting, so your edits to `ClaudeCodeProvider.ts` (a different section) land on top of 1b's, avoiding a late conflict; (b) read 1b's finished `canUseTool`-routing change to understand how (if at all) a task's pending-permission state is exposed on the server-side `activeTasks` entry, since that is directly relevant to the "don't falsely reap a legitimately blocked task" edge case above. |

**How to verify 1b is complete:** confirm `TaskInfo.status` in `agentMode.ts:233` includes
`'blocked'` as a union member, and that `ClaudeCodeProvider.ts`'s `canUseTool` routing
(`:3648-3760`) shows evidence of per-task attribution (not a single global flag) — 1b's own
success criteria require this. If 1b is not yet merged, do not start this task; escalate the
sequencing conflict rather than working around it.

### Downstream Impact

No task in this PRD directly depends on 4a's output. Task **5a** (CHANGELOG entry and final
review gate) transitively waits on this task via `execution_plan.yaml`'s wave ordering
(`5a depends_on: [2c, 2d, 3b, 4a, 4b, 4c]`) — 5a's CHANGELOG bullet should reflect this fix as
part of the amendment's stall-detection/wake-delivery summary, but 5a's brief (not this one) owns
exact wording.

**Before starting:** verify 1b per the table above; confirm no other in-flight branch in this
worktree touches `ClaudeCodeProvider.ts:1000-1250` or `:2650-2830` concurrently (check
`dependencies.md`'s Runtime Dependencies Discovered section for anything logged since this brief
was generated).

---

## GitHub Context

**Issue:** Not yet created — to be filed by the PM agent at execution start.
**Feature Issue (Parent):** Not yet created (see above).
**Branch:** `worktree/agent-visibility-4a`
**Target:** Determined by PM agent based on execution mode (feature branch or main) — per PRD §7,
this PRD uses the standard `/nimble:run` feature-branch execution mode (no `review.enabled`
provider configured in `.nimble/config.yaml`, so review defaults to manual at the wave-5 gate).

---

## Commit Guidelines

Use Conventional Commits:
```
fix(claude-code): track per-task activity to stop stalled sub-agent masking

Co-Authored-By: Claude <noreply@anthropic.com>
```

Types: feat, fix, refactor, test, docs, chore

---

## Deliverables

None beyond the files above. Captured at interview as "nothing beyond the code" (`tasks.yaml`
`deliverables: []`); the interview's accompanying note is worth restating here since it bears
directly on how to read the Success Criteria: *"Nothing beyond the code — the regression test
proving the fix is itself part of the code deliverable, not a separate artifact."* In other
words, the regression test required under Testing Requirements above is not an optional add-on —
it is the deliverable that proves this task is actually done, not a nice-to-have alongside it.

---

## Validation Checklist

Before creating PR:
- [ ] All success criteria met
- [ ] Build passes: `npm run build`
- [ ] Type check passes: `npm run typecheck`
- [ ] No `never_touch` files modified
- [ ] `shouldArmStreamStallWatchdog` (`streamStallWatchdog.ts:56-66`) and its invocation
      (`ClaudeCodeProvider.ts:1118-1123`) are byte-identical to before this task — diff them
      explicitly if unsure
- [ ] Regression test added/updated proving both the concurrent-stall detection and the
      solo-agent-unregressed cases (per Testing Requirements)
- [ ] Branch rebased on target branch (feature branch or main), with task 1b's changes already
      merged in

---

*Generated by NIMBLE Brief Writer*
*PRD: agent-visibility | Task: 4a | Wave: 2*
