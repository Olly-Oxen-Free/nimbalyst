# Task Brief: 1a

**Title:** Make Task sub-agent text retrievable and correctly correlated
**PRD:** task-subagent-visibility
**Priority:** must
**Complexity:** 7/10
**Model:** opus
**Wave:** 1
**Feature Issue:** N/A (no GitHub issue tracking configured for this PRD at brief-generation time)

---

## Objective

Nimbalyst's Agent Mode dispatches Task-tool sub-agents constantly (the model's default
delegation mechanism), but their assistant text/thinking is currently silently dropped at
read time and has no path to the renderer. This task makes that text retrievable and
correctly correlated to the `activeTasks` entry that owns it — the foundational backend
piece three UI surfaces (hover popover, inline expand, tiling pane) will consume in later
waves.

---

## Context

**Parent Feature:** Task Sub-Agent Live Transcript Visibility (task-subagent-visibility)

Nimbalyst's Agent Mode has two independent multi-agent systems. Teammates (named,
addressable, under Agent Teams) got full transcript visibility in a prior PRD
(002_teammate-thread-view, merged): a chip, a live transcript popover, a stop control.
Task-tool sub-agents — the model's *default*, unnamed `Task`/`Agent` dispatch — get a chip
too, but it opens only a static status popover (label, status, active tool name). No
transcript. PRD 002 explicitly deferred this ("Task chips stay read-only. Separate product
decision, not revisited here.") This PRD is that decision.

The SDK option `forwardSubagentText` is already enabled (for teammate visibility) and
already forwards Task sub-agent text/thinking through the lead's own async iterator, tagged
with `parent_tool_use_id`. Today that text is deliberately dropped at
`ClaudeCodeTranscriptAdapter.ts:233` (`if (parentToolUseId) continue;`) because it has no
consumer — a fix applied same-session as the PRD's own research to stop it leaking into the
lead's own visible transcript unmarked. This task gives it a consumer without touching that
guard's correctness.

This task is part of **Wave 1** — the only task in wave 1, with no dependencies. It is the
first link in a fully sequential backend chain (1a → 1b → 1c) that the UI waves (4, 5)
depend on entirely. Nothing else in this PRD can start meaningfully until this task lands.

---

## Research Context

### Patterns to Follow

- **`TeammateManager`'s existing `logNonBlocking` tagging pattern** (if Option A, see below):
  `TeammateManager.ts:1109-1116`, `1893-1898`, `1957-1961` all call
  `this.deps.logNonBlocking(sessionId, source, direction, content, metadata)` with
  `metadata` containing `_isTeammateOutput: true, _teammateAgentId: <id>` spread into the
  JSON content. `logNonBlocking` is wired at `ClaudeCodeProvider.ts:406-407` as
  `this.logAgentMessageNonBlocking(...)` — the same underlying method. A Task-sub-agent
  write, if you choose Option A, is a direct structural copy of this pattern with different
  tag keys.
- **`markTaskBlockedForToolUse`'s existing correlation direction**
  (`ClaudeCodeProvider.ts:3890-3902`): this method already does *half* of the correct
  pattern — it resolves a value out of `subagentToolCallOwners` (a Task tool_use id) and
  then matches that value against `task.toolUseId` in `activeTasks`. Read it before writing
  your own correlation code; it's proof the map's value space (not key space) is what
  aligns with a Task tool_use id.

### Known Issues to Address

- The PRD went through two review passes that corrected wrong framings of this exact task
  (§6 Q5, Q7 in the PRD — full text below). Do not re-derive the correlation logic from
  first principles without reading those corrections; an earlier draft of this task
  shipped the wrong lookup direction and would have made the feature inert at depth 1 and
  wrong at depth 2.

### Recommended Approach

See "The Fork You Must Resolve First" below — this **is** the recommended approach section
for this task; there is no separate library/architecture recommendation beyond it.

---

## The Fork You Must Resolve First (PRD §6 Q7)

**Resolve this before writing implementation code — it changes which files this task
actually touches.** Do not guess from this brief alone; verify against the real projected
shape during implementation.

### Option A — new tagged write

Route the forwarded text in the provider's streaming loop
(`packages/runtime/src/ai/server/providers/ClaudeCodeProvider.ts`) and persist it via
`this.logAgentMessageNonBlocking` (the same `logNonBlocking` dependency
`TeammateManager`'s own calls use — see Patterns to Follow above). Tag the Task-sub-agent
write with:
- `_isTaskSubagentOutput: true`
- `_taskId: <owning task id>`
- `_taskToolUseId: <the same toolUseId>`

Both tag keys are required — 1b's fetch handler needs to be reachable by either (R3), and
the inline-expand widget in task 2b only ever has the `toolUseId` available, not the
`taskId`.

### Option B — project existing raw rows, no new write

Verified live in this brief's own investigation (do not re-verify from scratch, but do
confirm nothing has drifted since):

- `ClaudeCodeProvider.ts:1301` (`if (sessionId && !isTransientClaudeCodeChunk(chunk))`)
  already calls `this.logAgentMessageNonBlocking(...)` at line 1318 for essentially every
  non-transient chunk. `isTransientClaudeCodeChunk`
  (`packages/runtime/src/ai/server/providers/claudeCode/toolChunkUtils.ts:30-37`) filters
  only on `type`/`subtype`, never on `parent_tool_use_id`.
- `slimClaudeCodeChunkForStorage` (`toolChunkUtils.ts:59+`) only trims
  `tool_use_result` sidecar fields and thinking-block signatures — confirmed by reading the
  function — it does not touch `parent_tool_use_id`.
- This means a sub-agent's raw chunk, `parent_tool_use_id` field intact, is **plausibly
  already durably stored** in `ai_agent_messages`, written **before**
  `ClaudeCodeTranscriptAdapter.ts:233`'s drop guard ever runs on it (the adapter only
  affects the LEAD's own parsed/rendered transcript — persistence at line 1301-1318
  happens on the raw, unparsed chunk, in a different code path entirely).

Under this option, task 1a becomes: **verify this holds** (write a throwaway script or a
test asserting a raw row for a forwarded sub-agent chunk exists and contains
`parent_tool_use_id`), and if so, this task's only real work is making
`projectRawMessagesToViewMessages` — or a variant of it — correctly project that generic,
untagged raw shape (not the `TeammateManager`-style pre-tagged shape it currently expects,
see `projectTeammateRawMessages` at `packages/runtime/src/ai/server/transcript/
projectRawMessages.ts:132-152` for what "pre-tagged shape" means) into a normal
`TranscriptViewMessage`.

That projection work may genuinely belong to task 1b instead — if so, 1a becomes nearly a
no-op provider change (just the verification), and 1a/1b should be treated as one combined
unit of work by you, the implementer, even though they remain two separate task entries in
this PRD's tracking.

### How to decide

Pick based on what actually works cleanly against `projectRawMessagesToViewMessages`
during implementation. State the choice made in the commit message — this repo never opens
a PR, so there is no PR description to write it into. If Option A: also state the volume
mitigation choice or explicit deferral (see below) in the commit message.

**Either option, `ClaudeCodeTranscriptAdapter.ts:233`'s guard (`if (parentToolUseId)
continue;`) stays exactly as-is.** It correctly prevents the LEAD's own rendered transcript
from showing sub-agent text — unrelated to whether that text is separately retrievable by
taskId.

### Volume mitigation (Should, not blocking — Option A only)

Task sub-agents fire far more often than teammates in a session. Consider skipping
thinking blocks for this path, or another cheap cap. Under Option B this concern doesn't
apply — no new rows are added at all.

---

## Correlation — Read Carefully (PRD §6 Q5, a documented earlier-draft bug)

**Match the chunk's `parentToolUseId` DIRECTLY against `activeTasks[*].toolUseId`.**
`activeTasks` entries store `toolUseId: chunk.tool_use_id` at
`ClaudeCodeProvider.ts:2904`, set when `task_started` fires (verified live: the full
`handleSystemTask` transition handler is at `ClaudeCodeProvider.ts:2892-2974`).

**Do NOT route through `subagentToolCallOwners`** (`ClaudeCodeProvider.ts:329`, populated
at line 1450, cleared at line 1462 — all verified live). That map's **keys** are *inner*
tool_use ids — calls issued *by* a sub-agent, set as `this.subagentToolCallOwners.set(toolId,
item.subagentId)` at line 1450 — and its **values** are the owning Task's tool_use id.

A forwarded chunk's `parentToolUseId` is itself a Task tool_use id — it lives in that map's
**value space**, not its key space. Looking it up as a key there:
- **Misses entirely for a depth-1 sub-agent** (the lead's own Task call is never a key in
  this map).
- **Misattributes a depth-2 sub-agent's text to its ancestor** (the nested Task call *is* a
  key there, but resolves to the wrong owner).

`subagentToolCallOwners` exists for a different purpose entirely: attributing a
still-in-flight tool call to its owning sub-agent for permission-prompt routing. See
`markTaskBlockedForToolUse` at `ClaudeCodeProvider.ts:3890-3902` — it already does the
*correct half* of this pattern (resolve a value out of `subagentToolCallOwners`, then match
that value against `task.toolUseId` in `activeTasks`) but for a different purpose. It is
not the mechanism for this task's correlation, and this task must not modify it.

The direct `activeTasks[*].toolUseId` match already handles nesting correctly by
construction: every depth gets its own `activeTasks` entry keyed by its own `task_id` with
its own `toolUseId`. Verify this with an explicit depth-2 fixture in your tests — do not
assume it from the code read alone.

---

## Requirements

Fulfills R1 ("Task sub-agent text is retrievable, correlated correctly") and R2
("Correlation survives nesting") from the PRD.

- Whichever option is chosen, a chunk with `parentToolUseId` set that matches a known
  `activeTasks[*].toolUseId` must become retrievable through the mechanism you build,
  correlated to the correct task.
- That same chunk must continue to NOT appear in the lead's own projected transcript — the
  existing `ClaudeCodeTranscriptAdapter.ts:233` guard behavior is preserved regardless of
  option.
- A depth-2+ sub-agent's text must correlate to its own `activeTasks` entry, not an
  ancestor's.
- A chunk whose `parentToolUseId` doesn't match any known `activeTasks[*].toolUseId` (e.g.
  a teammate's own chunk — teammates are also Task-tool dispatch, see
  `TeammateManager.ts:2209` — or a race before `task_started` registers the entry) must not
  be misattributed to the wrong task.

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] A concrete decision is made and stated in the commit message between Option A (new
      tagged write) and Option B (project existing raw rows) — not left ambiguous for 1b to
      guess at
- [ ] A chunk with `parentToolUseId` set that matches a known `activeTasks[*].toolUseId` is
      retrievable via the mechanism chosen, correlated correctly, and does NOT appear in the
      lead's own projected transcript (existing guard behavior preserved either way)
- [ ] A depth-2 sub-agent's text (its `parentToolUseId` matching its OWN `activeTasks`
      entry's `toolUseId`, not an ancestor's) is correlated to its OWN `activeTasks` entry —
      covered by an explicit nested fixture, not inferred
- [ ] The fix does NOT route through `subagentToolCallOwners` for this correlation — that
      map is left untouched by this task, used only for its existing
      permission-prompt-attribution purpose
- [ ] A chunk whose `parentToolUseId` does not match any known `activeTasks[*].toolUseId`
      (e.g. a teammate's own chunk, or a race before `task_started` registers the entry) is
      not misattributed to the wrong task
- [ ] If Option A is chosen: volume mitigation choice (or explicit deferral) is stated in
      the commit message

**All criteria must pass before task is complete.**

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/runtime/src/ai/server/providers/ClaudeCodeProvider.ts` | modify | Correlation logic and (if Option A) the new tagged write |
| `packages/runtime/src/ai/server/providers/claudeCode/ClaudeCodeTranscriptAdapter.ts` | read/verify only under Option B; may be genuinely unmodified | Confirm the drop guard at line 233 stays correct and unrelated to retrievability |

### File Ownership Notes

No other task in wave 1 touches these files. Task 1b (wave 2) depends on whatever shape
this task lands on — coordinate the exact projected-message shape via the commit message
and code itself, since there is no PR description to hand off through.

---

## Implementation Guidance

### Patterns to Follow

- `TeammateManager`'s `logNonBlocking` tagging calls (`TeammateManager.ts:1109-1116,
  1893-1898, 1957-1961`) — direct structural template if Option A.
- `markTaskBlockedForToolUse` (`ClaudeCodeProvider.ts:3890-3902`) — proof of the correct
  correlation direction through `activeTasks[*].toolUseId`, for a different purpose but the
  same lookup shape.
- `handleSystemTask` (`ClaudeCodeProvider.ts:2892-2974`) — where `activeTasks` entries are
  created, updated, and where `toolUseId` is set at `task_started` (line 2904). Read this in
  full before writing correlation code; `activeTasks` entries are never deleted (only status
  transitions), which is relevant to how correlation should behave for a completed task.

### Code Style

Match the existing provider's style: extensive inline comments explaining *why*, not just
*what*, especially around SDK ordering/timing subtleties (see the comment block above
`markTaskBlockedForToolUse` for the level of rigor expected — it documents SDK internals
verified against the shipped SDK bundle).

### Edge Cases

- A chunk arriving before `task_started` has registered the `activeTasks` entry (race
  condition) — must not crash, must not misattribute.
- A teammate's own forwarded chunk (teammates are also Task-tool dispatch per
  `TeammateManager.ts:2209`) must not be picked up by this task's correlation — teammates
  already have their own separate `_isTeammateOutput`/`_teammateAgentId` tagging path via
  `TeammateManager`, entirely disjoint from this task's mechanism. Do not conflate the two.
- Depth-2+ correlation, covered by an explicit fixture per the success criteria.

### Testing Requirements

Unit tests are required, not optional — this is a `must`-priority task with no adjacent E2E
coverage planned for it. Cover: correct correlation, exclusion from the lead transcript,
and depth-2 correlation via an explicit nested fixture. Extend an existing test file for
`ClaudeCodeProvider.ts` or `ClaudeCodeTranscriptAdapter.ts` rather than creating a new one,
per repo test-discipline conventions, unless no existing file fits.

---

## Boundaries

### Files You MUST NOT Touch

- `subagentToolCallOwners` map's existing logic (`ClaudeCodeProvider.ts:329, 1450, 1462`)
  and `markTaskBlockedForToolUse` (`ClaudeCodeProvider.ts:3890-3902`) — read these, do not
  modify their behavior. This task's correlation mechanism is independent of them.
- Any Agent Teams / teammate code path (`TeammateManager.ts` and its call sites) — no
  changes to how teammates work, are tagged, or render.
- No general `.nimble/config.yaml` boundaries file was found for this repo at brief-writing
  time; apply the repo-wide database and provider-layering rules from the root `CLAUDE.md`
  and `packages/runtime/CLAUDE.md` instead (no `localStorage`, no dynamic imports in main
  process code paths this touches, respect the PGLite/SQLite dual-backend constraint if your
  chosen option touches query shape).

### Files Requiring Review

`packages/runtime/src/ai/server/providers/ClaudeCodeProvider.ts` is large, high-traffic,
shared infrastructure — any change here is inherently high-risk. This is compounded by the
PRD-level gate after wave 3 (see Dependencies below), which will re-review this task's
landed shape before UI work begins.

---

## Dependencies

### Upstream Tasks

None — this is the first task in the PRD, wave 1, no dependencies.

### Downstream Impact

Tasks 1b, 1c, 2a, 2b, and 2c (the entire rest of the PRD) depend transitively on this task's
output. In particular:
- **1b** needs to know which option you chose and the exact shape of the retrievable data
  (tagged JSON metadata under Option A, or generic raw-chunk shape under Option B) to write
  its projection function.
- **2b**'s widget can only ever supply a `toolUseId`, never a `taskId` — if you choose
  Option A, both `_taskId` and `_taskToolUseId` tags are required for this reason (see
  Option A above).

**Before starting:** No upstream work to verify — this is wave 1.

---

## Deliverables

| Artifact | Path | Done when |
|---|---|---|
| Task sub-agent text retrievable and correctly correlated, via Option A or B | `packages/runtime/src/ai/server/providers/ClaudeCodeProvider.ts` | Unit test asserts correct correlation via `activeTasks[*].toolUseId`, correct exclusion from the lead transcript, and correct depth-2 correlation, per the success criteria above, regardless of which option was chosen |
| Commit message stating the Option A/B decision (and volume mitigation if Option A) | N/A (git history) | The decision is legible to the task 1b implementer without them re-deriving it from a code diff |

---

## GitHub Context

**Issue:** N/A — no GitHub issue configured for this PRD at brief-generation time
**Feature Issue (Parent):** N/A
**Branch:** `worktree/task-subagent-visibility-1a`
**Target:** Determined by PM agent based on execution mode (feature branch or main)

---

## Commit Guidelines

Use Conventional Commits:
```
feat(agent-mode): correlate Task sub-agent text to its owning task

State the Option A/B decision and (if Option A) the volume mitigation
choice here — this repo has no PR, so this commit message is the only
place that decision is recorded for the next task's implementer.
```

Types: feat, fix, refactor, test, docs, chore

---

## Validation Checklist

Before considering this task done:
- [ ] All success criteria met
- [ ] Typecheck passes: `npm run typecheck` (repo root)
- [ ] Relevant unit tests pass (run the affected test files directly; do not run the full
      suite twice — see the root CLAUDE.md's guidance on `.vitest/last-run.log`)
- [ ] No boundary files modified (`subagentToolCallOwners`/`markTaskBlockedForToolUse`
      logic, teammate code paths)
- [ ] Tests added covering correlation, exclusion, and depth-2 nesting
- [ ] Branch rebased on target branch (feature branch or main)

---

*Generated by NIMBLE Brief Writer*
*PRD: task-subagent-visibility | Task: 1a | Wave: 1*
