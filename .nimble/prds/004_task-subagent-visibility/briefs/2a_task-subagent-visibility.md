# Task Brief: 2a

**Title:** Hover popover for a Task chip (inline + sidebar); retire click-to-status-popover
**PRD:** task-subagent-visibility
**Priority:** must
**Complexity:** 5/10
**Model:** opus
**Wave:** 4
**Feature Issue:** N/A (no GitHub issue tracking configured for this PRD at brief-generation time)

---

## Objective

Give a Task-kind chip a hover-triggered, read-only popover showing its live transcript —
the first of three presentation surfaces for Task sub-agent visibility, and the one closest
to near-total reuse of the existing `TeammateThreadPopover.tsx` pattern.

---

## Context

**Parent Feature:** Task Sub-Agent Live Transcript Visibility (task-subagent-visibility)

The backend (tasks 1a-1c, waves 1-3) made Task sub-agent text retrievable, projectable, and
live-signaled. This task is the first of three UI surfaces consuming that backend. Today,
clicking a Task-kind chip opens `TaskStatusPopover` — label, status, active tool name only,
no transcript, no click-to-thread equivalent to what teammates already have. This task
replaces that experience with a hover-triggered popover carrying the actual live text.

This task is part of **Wave 4** — depends on tasks 1b (fetch) and 1c (live signal), both
complete. It runs alongside task 2b in the same wave (file-disjoint from it: this task
touches `SubAgentChipRow.tsx`/`TeammatePanel.tsx`, 2b touches `RichTranscriptView.tsx`/a new
`TaskToolWidget.tsx`/`AgentMode.tsx`). Task 2c (wave 5) is sequenced *after* this task
specifically because both add a new handler (hover vs. click) to the same two components —
sequencing avoids a real merge conflict rather than working around one after the fact. This
task must land cleanly before 2c starts.

**This task lands after the PRD's wave-3 gate.** Confirm with whoever ran task 1c that the
gate's `require_review` completed before starting UI work here — the gate exists precisely
to catch backend correctness problems before the larger UI investment (this task included)
begins.

---

## Research Context

### Patterns to Follow — the exact pattern to adapt

`TeammateThreadPopover.tsx` (`packages/electron/src/renderer/components/AgentMode/
TeammateThreadPopover.tsx`), verified live, is your template:

- `useFloating` + `FloatingPortal` per this repo's floating-ui rule (see
  `.claude/rules/floating-ui.md`) — never manually calculate `position: fixed`.
- `fetchGenerationRef` guard against out-of-order async responses (verified live at lines
  78, 81, 84, 87, 96 of `TeammateThreadPopover.tsx`):

```tsx
const fetchGenerationRef = useRef(0);

const fetchTranscript = useCallback(async () => {
  const generation = ++fetchGenerationRef.current;
  try {
    const next = await window.electronAPI.aiGetTeammateTranscript(sessionId, agentId, workspacePath);
    if (generation !== fetchGenerationRef.current) return;
    setMessages(next);
  } catch {
    if (generation !== fetchGenerationRef.current) return;
    setMessages(previous => previous ?? []);
  }
  setLoading(false);
}, [sessionId, agentId, workspacePath]);
```

- Debounce-refetch on the transcript signal atom, exactly 1.5 seconds (verified live at
  lines 100-112 — `window.setTimeout(..., 1_500)`), triggered off `useAtomValue` on the
  signal atom family, not on every event:

```tsx
const transcriptSignal = useAtomValue(
  teammateTranscriptSignalAtomFamily(teammateTranscriptSignalKey(sessionId, agentId)),
);
const initialSignalRef = useRef(transcriptSignal);
useEffect(() => {
  if (transcriptSignal === initialSignalRef.current) return;
  const debounceTimer = window.setTimeout(() => {
    void fetchTranscript();
  }, 1_500);
  return () => window.clearTimeout(debounceTimer);
}, [fetchTranscript, transcriptSignal]);
```

Your `TaskThreadPopover.tsx` follows this exact shape, substituting
`window.electronAPI.aiGetTaskSubagentTranscript` (task 1b) and
`taskTranscriptSignalAtomFamily`/`taskTranscriptSignalKey` (task 1c) for the teammate
equivalents.

`RichTranscriptView` fed by fetched `TranscriptViewMessage[]` — same as the teammate
popover — is also part of this pattern; do not build a separate rendering path.

**Read-only distinction:** this is closer to `SessionTranscriptPeek.tsx`'s shape (find and
read this file — it is referenced in the PRD as the nearer analog) than the teammate
popover's compose-capable variant. No input field, no stop control. Read
`TeammateThreadPopover.tsx`'s compose/stop-control code (around its `canCompose`/`canStop`
logic, lines 72 and 115 in the verified excerpt above) specifically so you know what to
*omit*, not just what to copy.

### The Existing `TaskStatusPopover` You Are Retiring

Verified live at `packages/electron/src/renderer/components/AgentMode/
SubAgentChipRow.tsx:152-204` (the component) and `:261-268` (its click-trigger site,
`handleChipClick`):

```tsx
const handleChipClick = useCallback((entry: SubAgentChipEntry, e: React.SyntheticEvent<HTMLDivElement>) => {
  if (entry.kind === 'teammate') {
    onTeammateClick?.(entry.id, e.currentTarget);
  } else {
    onTaskClick?.(entry.id);
    setOpenTaskPopover({ taskId: entry.id, anchorEl: e.currentTarget });
  }
}, [onTeammateClick, onTaskClick]);
```

Its state is `const [openTaskPopover, setOpenTaskPopover] = useState<{ taskId: string;
anchorEl: HTMLElement } | null>(null);` and it renders conditionally near the bottom of the
component (search for `openTask &&` in the file). **Remove this local popover state
entirely.** Its content — `label`, `status`, `lastToolName` — is a subset of what the new
hover popover will show. Fold those three fields into `TaskThreadPopover`'s header so no
information is lost.

**Leave the `onTaskClick?.(entry.id)` call itself intact** (line 265) — it stays unwired to
anything until task 2c wires it to open a tile. Do not delete this line or its prop; do not
wire it to anything in this task.

**Important note on a stale in-repo comment:** `TaskStatusPopover`'s own doc comment (lines
160-165 of `SubAgentChipRow.tsx`) currently reads: "A deliberate visibility ceiling, not a
stepping stone toward a full thread view — Task sub-agent turns stay hidden from the
transcript by design (`claudeCliSubAgentTracker.ts:20-22`). No buttons, no navigation." This
comment describes the *old* design this PRD is explicitly reversing. Since you are deleting
`TaskStatusPopover` entirely, this comment goes with it — no action needed beyond normal
deletion, but do not be confused by it if you read it mid-task and wonder whether it
represents a constraint you must honor. It does not; it describes the status quo this PRD
changes.

### Recommended Approach

Trigger is **hover, not click**, on both surfaces: the inline chip in `SubAgentChipRow.tsx`
(the component whose entries render via `<SubAgentChip ... onClick={...} />` — you'll be
adding a hover handler alongside/instead of the click handler for `kind: 'task'` entries
specifically; leave the teammate `kind: 'teammate'` click-to-thread behavior completely
untouched) and the equivalent row in the Sub-agents sidebar section of `TeammatePanel.tsx`
(its `TaskItem` component, verified live at lines 248-289 — read the full component before
adding a hover handler to it).

Auto-dismiss on mouse-leave — this is a stated success criterion, not implicit in "it's a
popover." Use `useDismiss` from `@floating-ui/react` configured appropriately, or explicit
`onMouseLeave` handling if `useDismiss`'s default behavior doesn't cover hover-trigger
dismissal cleanly; verify against `@floating-ui/react`'s actual hover-interaction primitives
(`useHover`) rather than assuming `useDismiss` alone covers it — `useHover` combined with
`useDismiss` is the standard floating-ui pattern for exactly this trigger type.

### Dependencies

**File Dependencies:**
- `window.electronAPI.aiGetTaskSubagentTranscript` (task 1b) — the fetch call.
- `taskTranscriptSignalAtomFamily`/`taskTranscriptSignalKey` (task 1c) — the live-refetch
  trigger.

---

## Requirements

Fulfills R5 ("Hover popover").

- Hovering a Task chip (inline row or sidebar row) opens a read-only popover (no input, no
  stop button) showing the live transcript, auto-dismissing on mouse-leave, no click
  required — built on the same `@floating-ui/react` pattern as `TeammateThreadPopover`.
- `TaskStatusPopover`'s local click-triggered popover state is removed entirely; its
  status/label/tool-name fields are present in `TaskThreadPopover`'s header.
- Clicking a Task chip no longer opens any popover (`onTaskClick` still fires, unconsumed
  until task 2c).

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] Hovering a Task chip (inline) opens the popover with live transcript content, no click
      required
- [ ] Hovering the same task's row in the Sub-agents sidebar list opens the same popover
- [ ] Popover has no input field and no stop control
- [ ] Popover auto-dismisses on mouse-leave
- [ ] Popover content updates live via the 1c signal atom, debouncing to the same 1.5s window
      `TeammateThreadPopover` uses, not refetching on every event
- [ ] `TaskStatusPopover`'s local click-triggered popover state is removed; its
      status/label/tool-name fields are present in `TaskThreadPopover`'s header; clicking a
      Task chip no longer opens it (`onTaskClick` still fires, unconsumed until 2c)

**All criteria must pass before task is complete.**

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/electron/src/renderer/components/AgentMode/TaskThreadPopover.tsx` | create | New read-only hover popover, near-total reuse of `TeammateThreadPopover.tsx`'s pattern |
| `packages/electron/src/renderer/components/AgentMode/SubAgentChipRow.tsx` | modify | Remove `TaskStatusPopover` and its local state; add hover trigger for the inline Task chip |
| `packages/electron/src/renderer/components/AgentMode/TeammatePanel.tsx` | modify | Add hover trigger for the Task row in the Sub-agents sidebar list (its `TaskItem` component) |

### File Ownership Notes

`SubAgentChipRow.tsx` and `TeammatePanel.tsx` are also touched by task 2c (wave 5) — real
overlap (both tasks add a new handler, hover vs. click, to the same two components).
Resolved by sequencing: 2c `depends_on` this task specifically to avoid a merge conflict.
Leave `onTaskClick?.(entry.id)` (and its equivalent in `TeammatePanel.tsx`) intact and
unconsumed — do not repurpose it for the hover trigger; the hover popover you're building
should use its own trigger mechanism (`useHover`/`onMouseEnter` or equivalent), not the
existing click-wired prop, since 2c needs that click prop free to wire to tile-opening.

---

## Implementation Guidance

### Patterns to Follow

Copy `TeammateThreadPopover.tsx`'s structure directly (floating-ui setup,
`fetchGenerationRef` guard, debounce-refetch pattern) — see the verified excerpts under
Research Context. Do not reinvent any of this; it is a proven, tested pattern already in
production for the teammate case.

### Code Style

Follow this repo's `.claude/rules/floating-ui.md` rule exactly: `useFloating` +
`FloatingPortal`, never manual `position: fixed`.

### Edge Cases

- Rapid hover-in/hover-out (e.g. mouse passing over the chip without pausing) — do not fire
  a fetch on every hover event; consider whether a hover-intent delay is warranted (the
  teammate popover's own trigger mechanism, wherever it lives — check how `onTeammateClick`
  actually opens `TeammateThreadPopover` in the parent component for any existing debounce
  on open — is click-triggered so has no equivalent concern; this is a new consideration
  specific to hover triggers).
- A task that completes while its popover is open — the popover should still show its final
  transcript state; do not force-close on completion (this is a live-view feature, not a
  "while running" feature).
- Multiple chips hovered in quick succession — ensure only one popover is open at a time and
  the `fetchGenerationRef` guard correctly discards a stale in-flight fetch when the hover
  target changes.

### Testing Requirements

Component test suite `TaskThreadPopover.test.tsx` covers: hover-open, mouse-leave-dismiss,
live update via the signal atom, and that `TaskStatusPopover` no longer renders on click.

---

## Boundaries

### Files You MUST NOT Touch

- `TeammateThreadPopover.tsx` itself — read as template only, no changes. No changes to any
  Agent Teams / teammate code path, including the existing teammate click-to-thread
  behavior in `SubAgentChipRow.tsx`/`TeammatePanel.tsx` (`onTeammateClick` and its wiring
  must be completely unaffected by this task).

### Files Requiring Review

None of this task's files are under `packages/electron/src/main/**`, so no automatic
`require_review` trigger for this task specifically — but it lands after the wave-3 gate,
which already covered the backend this task depends on.

---

## Dependencies

### Upstream Tasks

| Task | What It Provides | Verify Before Starting |
|------|------------------|------------------------|
| 1b | `ai:getTaskSubagentTranscript` IPC handler, keyable by `taskId` or `toolUseId` | Call it manually (or via a quick test) with a known task's `taskId` and confirm a non-empty result during an active session |
| 1c | `task:transcript-updated` live signal, `taskTranscriptSignalAtomFamily` | Confirm the atom bumps when a Task sub-agent produces new content, before wiring the popover's debounce-refetch to it |

### Downstream Impact

Task 2c (wave 5) depends on this task landing first (file-overlap sequencing on
`SubAgentChipRow.tsx`/`TeammatePanel.tsx`) and reuses `onTaskClick?.(entry.id)`, which this
task must leave intact and unconsumed.

**Before starting:** Confirm 1b and 1c are both merged and the wave-3 review gate has
closed.

---

## Deliverables

| Artifact | Path | Done when |
|---|---|---|
| `TaskThreadPopover.tsx` | `packages/electron/src/renderer/components/AgentMode/TaskThreadPopover.tsx` | Component test suite (`TaskThreadPopover.test.tsx`) covers hover-open, mouse-leave-dismiss, live update via the signal atom, and that `TaskStatusPopover` no longer renders on click |

---

## GitHub Context

**Issue:** N/A — no GitHub issue configured for this PRD at brief-generation time
**Feature Issue (Parent):** N/A
**Branch:** `worktree/task-subagent-visibility-2a`
**Target:** Determined by PM agent based on execution mode (feature branch or main)

---

## Commit Guidelines

Use Conventional Commits:
```
feat(agent-mode): add hover popover for Task sub-agent chips
```

Types: feat, fix, refactor, test, docs, chore

---

## Validation Checklist

Before considering this task done:
- [ ] All success criteria met
- [ ] Typecheck passes: `npm run typecheck` (repo root)
- [ ] `TaskThreadPopover.test.tsx` passes
- [ ] No teammate click-to-thread behavior modified in `SubAgentChipRow.tsx`/
      `TeammatePanel.tsx`
- [ ] `onTaskClick?.(entry.id)` (and its `TeammatePanel.tsx` equivalent) left intact and
      unconsumed for task 2c
- [ ] Tests added/updated
- [ ] Branch rebased on target branch (feature branch or main)

---

*Generated by NIMBLE Brief Writer*
*PRD: task-subagent-visibility | Task: 2a | Wave: 4*
