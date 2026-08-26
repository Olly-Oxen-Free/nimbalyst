# Task Brief: 2c

**Title:** Tiling pane for Task sub-agent transcripts; claim the chip's click behavior
**PRD:** task-subagent-visibility
**Priority:** must
**Complexity:** 9/10
**Model:** opus
**Wave:** 5
**Feature Issue:** N/A (no GitHub issue tracking configured for this PRD at brief-generation time)

---

## Objective

Give clicking a Task chip (inline or sidebar) a real destination: a new pane, tiled beside
the main transcript thread, showing that task's live transcript. This is the largest single
task in this PRD — a purpose-built, minimal split-pane system, built from scratch, for this
feature only.

---

## Context

**Parent Feature:** Task Sub-Agent Live Transcript Visibility (task-subagent-visibility)

This is the third and final presentation surface. Tasks 2a (hover popover) and 2b (inline
expand) both reuse existing patterns closely. This task does not — there is no split-pane
library anywhere in this repo today (confirmed by dependency search: no
`react-resizable-panels`, `allotment`, `SplitPane`, or `react-split` in any `package.json`).
Build the primitive from scratch using CSS flexbox/grid; do not add a new npm dependency
unless an implementer-time spike finds a compelling reason otherwise, and if you do add one,
say explicitly in the commit message why the from-scratch CSS approach was insufficient —
this is a stated, checked success criterion, not a suggestion.

This task is part of **Wave 5** — the last wave, depending on 1b, 1c, and 2a. It is
**sequenced after task 2a specifically** because both tasks add a new handler (hover vs.
click) to the same two components, `SubAgentChipRow.tsx` and `TeammatePanel.tsx` — a real
file overlap, resolved by sequencing rather than parallelizing, to avoid a genuine merge
conflict.

**This task lands after the PRD's wave-3 gate**, and depends on task 2a having landed
cleanly in wave 4.

---

## Research Context

### Patterns to Follow

There is no existing tiling/docking pattern in this codebase to copy — this is genuinely new
UI infrastructure. What *does* exist and should inform the shape:

- **State home pattern**: `store/atoms/agentMode.ts` already holds several AgentMode-scoped
  atoms (`sessionTasksAtom` at lines 260-266, `teammateTranscriptSignalAtomFamily` at
  239-241, both verified live). Your new `openTaskTilesAtom` belongs alongside them, in the
  same file, following the same `atomFamily` keying-by-session convention where relevant.
- **Live content per tile**: each open tile renders the exact same transcript content tasks
  2a/2b already consume — task 1b's `ai:getTaskSubagentTranscript` fetch, task 1c's
  `task:transcript-updated` live signal. Do not build a third data path; reuse the fetch +
  signal-atom pattern verified live in `TeammateThreadPopover.tsx` (see task 2a's brief for
  the full verified excerpt) for each tile's own transcript view.
- **Host site**: `SessionTranscript.tsx`, verified live, currently renders
  `<AgentTranscriptPanel ... />` at line 2502 (inside a flex container starting at line
  2490 with `style={{ flex: 1, overflow: 'hidden', ... }}`) and
  `<SubAgentChipRow sessionId={sessionId} onTeammateClick={handleTeammateChipClick} />` at
  line 2696 — **`onTaskClick` is NOT currently passed to `SubAgentChipRow`; this task adds
  it.** The tiling container wraps/sits alongside `AgentTranscriptPanel` in this same tree
  — do not create a new top-level mount point elsewhere in the component hierarchy.

### Known Issues to Address

None specific beyond the general risk of building new layout infrastructure — see the
explicit exclusions below, all of which were decided during PRD scoping specifically to keep
this task's scope bounded given its complexity (9/10, the highest in the PRD).

### Recommended Approach

**Explicitly out of scope — do not build any of these, even if they feel like natural
extensions:**
- Drag-to-rearrange tiles.
- Cross-session layout persistence (tile state does not survive an app restart).
- A general-purpose docking framework, or support for docking any content type other than a
  Task sub-agent transcript.
- A visual hierarchy/nesting indicator for depth-2+ sub-agents opened as tiles — a nested
  task's tile looks exactly like a top-level task's tile.

A CSS flexbox/grid approach where the main thread has a fixed/dominant `flex-basis` and each
open tile takes a smaller, roughly-equal share of the remaining width is the simplest fit for
"main thread keeps priority, N tiles beside it" — this is a strong steer, not a mandate; if
implementation reveals grid is a better fit for equal-width N-tile layout, that's a
reasonable within-scope deviation, but do not reach for a flex/grid hybrid more complex than
necessary for this bounded feature.

### Dependencies

**File Dependencies:**
- Task 1b's `ai:getTaskSubagentTranscript` — each tile's own fetch.
- Task 1c's `task:transcript-updated` signal — each tile's own live-refetch trigger.
- Task 2a's `onTaskClick?.(entry.id)` callback, left intact and unconsumed by that task
  specifically for this task to wire up.

---

## Requirements

Fulfills R7 ("Tiling pane").

- Clicking a Task chip (inline or sidebar) opens a new pane beside the main thread.
- The main thread retains height/width priority.
- Multiple tiles can be open concurrently, arranged side by side.
- A tile stays open when its task completes; its status badge flips to the terminal state
  rather than the pane auto-closing.

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] Clicking a Task chip (inline or sidebar) opens a new tile beside the main thread,
      hosted in `SessionTranscript.tsx` alongside `AgentTranscriptPanel`
- [ ] Main thread retains height/width priority when one or more tiles are open
- [ ] A second concurrent task's chip opens a second tile alongside the first, not replacing
      it
- [ ] A tile whose task completes stays open; its status badge updates to the terminal state
      instead of the pane closing
- [ ] `openTaskTilesAtom` (or equivalent) lives in `store/atoms/agentMode.ts`, not local
      component state, so tile state survives the triggering component's remount
- [ ] No drag-to-rearrange, no layout persisted across app restart, no docking of arbitrary
      content types, no new split-pane npm dependency added without an explicit note
      explaining why the from-scratch CSS approach was insufficient — purpose-built to this
      feature only

**All criteria must pass before task is complete.**

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/electron/src/renderer/components/UnifiedAI/SessionTranscript.tsx` | modify | Host the tiling layout alongside `AgentTranscriptPanel`; pass new `onTaskClick` prop to `SubAgentChipRow` |
| `packages/electron/src/renderer/store/atoms/agentMode.ts` | modify | Add `openTaskTilesAtom` (or equivalent), alongside `sessionTasksAtom`/`taskTranscriptSignalAtomFamily` |
| `packages/electron/src/renderer/components/AgentMode/` (new tiling components) | create | The tiling layout primitive itself — file(s) to be named by the implementer, kept under this existing directory |
| `packages/electron/src/renderer/components/AgentMode/SubAgentChipRow.tsx` | modify | Wire the existing (unconsumed since task 2a) `onTaskClick?.(entry.id)` call through to the new `onTaskClick` prop |
| `packages/electron/src/renderer/components/AgentMode/TeammatePanel.tsx` | modify | Wire the equivalent click in the sidebar's Task row through the same mechanism |

### File Ownership Notes

`SubAgentChipRow.tsx` and `TeammatePanel.tsx` are also touched by task 2a (already landed by
the time this task starts, since this task `depends_on` 2a) — task 2a added the hover
trigger and left the existing `onTaskClick?.(entry.id)` click call intact and unconsumed
specifically for this task. Your edits here are additive (wiring the click prop through),
not a rework of 2a's hover logic — do not modify the hover-popover behavior 2a built.

`store/atoms/agentMode.ts` is also touched by task 1c (already landed, adds
`taskTranscriptSignalAtomFamily`) — disjoint addition.

---

## Implementation Guidance

### Patterns to Follow

Read `SessionTranscript.tsx` broadly around lines 2480-2700 before making changes — this is
a large, dense component with several interacting pieces (CLI drawer expansion, queue
display, file-edit sidebar, sub-agent chip row, teammate popover). Understand how
`AgentTranscriptPanel`'s existing flex container (`flex: 1, overflow: hidden`, with a
special-cased `minHeight` for a CLI drawer edge case at lines 2493-2499) behaves before
wrapping or adjusting it — your tiling container needs to coexist with this existing
layout logic, not fight it.

### Code Style

New tiling component(s) should follow this repo's general component conventions: a stable
kebab-case root class per `docs/REACT_DOM_MARKERS.md`, `@container` queries rather than
`@media` for any responsive behavior per `docs/UI_PATTERNS.md`, and canonical `--nim-*` CSS
variables for theming.

### Edge Cases

- Zero tiles open: layout must be indistinguishable from today's (no dead space reserved for
  a tile rail that isn't showing anything).
- Many tiles open concurrently (e.g. 4+): decide and document a reasonable minimum
  per-tile width or overflow behavior (horizontal scroll of the tile rail, or a shrink
  floor) — this isn't specified numerically in the PRD, so pick something defensible and
  note the choice in the component's own doc comment.
- A tile's task completing while its tile is open: status badge flips to terminal state (per
  the existing `SubAgentStatus` mapping already used elsewhere in this codebase — reuse
  `mapTaskStatus` from `SubAgentChipRow.tsx`'s imports, don't reinvent the status→badge
  mapping).
- Closing a tile: the PRD doesn't specify an explicit close affordance in its Requirements,
  but "a tile stays open when its task completes" implies tiles must be user-closable at
  some point (otherwise they accumulate indefinitely across a long session) — add a close
  control on each tile as a reasonable, in-scope implementation detail, even though it isn't
  a named success criterion; do not treat its absence as intentional.

### Testing Requirements

Component test covers: open/multi-tile-concurrent/main-thread-priority/stay-open-on-
completion, per the success criteria. Per the deliverable below, **a human also manually
verifies the visual layout matches the approved mockup before the end-of-PRD gate closes**
— your automated test suite does not substitute for that; flag at handoff that manual
verification is still required.

---

## Boundaries

### Files You MUST NOT Touch

- Task 2a's hover-popover logic in `SubAgentChipRow.tsx`/`TeammatePanel.tsx` — your edits to
  these files are additive (wiring the click callback through), not a rework.
- No new split-pane npm dependency without an explicit justifying note in the commit
  message — this is a checked success criterion.
- Any Agent Teams / teammate code path beyond the equivalent click-wiring in
  `TeammatePanel.tsx`'s Task sidebar row (the teammate rows in that same file must be
  completely unaffected).

### Files Requiring Review

None of this task's files are under `packages/electron/src/main/**`, so no automatic
`require_review` trigger for this task specifically — it lands after the wave-3 gate, which
already covered the backend. Given this task's complexity (9/10, the highest in the PRD) and
its new-infrastructure nature, treat its own diff as warranting careful self-review before
handoff even without an automatic trigger.

---

## Dependencies

### Upstream Tasks

| Task | What It Provides | Verify Before Starting |
|------|------------------|------------------------|
| 1b | `ai:getTaskSubagentTranscript`, keyable by `taskId` | Confirm the `taskId`-keyed lookup works — tiles have the `taskId` directly (unlike 2b's widget, which only has `toolUseId`) |
| 1c | `task:transcript-updated` live signal | Confirm the atom bumps correctly for a tile's own live-refetch |
| 2a | `onTaskClick?.(entry.id)` left intact and unconsumed in `SubAgentChipRow.tsx`/`TeammatePanel.tsx`; `TaskStatusPopover` already removed | Confirm 2a's hover popover works correctly and that the click callback fires without opening anything, before wiring it to tile-opening |

### Downstream Impact

None within this PRD — this is the last task, wave 5.

**Before starting:** Confirm 1b, 1c, and 2a are all merged. Manually exercise the hover
popover from task 2a to confirm `onTaskClick?.(entry.id)` fires on click without any visible
effect yet — that's your starting point.

---

## Deliverables

| Artifact | Path | Done when |
|---|---|---|
| Tiling pane layout + click-to-open wiring | `packages/electron/src/renderer/components/UnifiedAI/SessionTranscript.tsx` | Component test covers open/multi-tile-concurrent/main-thread-priority/stay-open-on-completion per success criteria; a human manually verifies the visual layout matches the approved mockup before the end-of-PRD gate closes |

---

## GitHub Context

**Issue:** N/A — no GitHub issue configured for this PRD at brief-generation time
**Feature Issue (Parent):** N/A
**Branch:** `worktree/task-subagent-visibility-2c`
**Target:** Determined by PM agent based on execution mode (feature branch or main)

---

## Commit Guidelines

Use Conventional Commits:
```
feat(agent-mode): add tiling pane for Task sub-agent transcripts
```

Types: feat, fix, refactor, test, docs, chore

---

## Validation Checklist

Before considering this task done:
- [ ] All success criteria met
- [ ] Typecheck passes: `npm run typecheck` (repo root)
- [ ] Component test suite passes
- [ ] No new split-pane npm dependency added without an explicit justifying note
- [ ] No teammate-path or 2a hover-popover behavior modified
- [ ] Tests added/updated
- [ ] Branch rebased on target branch (feature branch or main)
- [ ] **Manual E2E gate flagged at handoff** — a human must visually verify the tiling
      layout against the approved mockup before this PRD's status can move past
      `verification.manual_e2e` PENDING

---

*Generated by NIMBLE Brief Writer*
*PRD: task-subagent-visibility | Task: 2c | Wave: 5*
