# Task Brief: 2d

**Title:** Read-only status popover for Task sub-agent chips
**PRD:** agent-visibility
**Priority:** should
**Complexity:** 3/10
**Model:** sonnet
**Wave:** 6
**Feature Issue:** Not yet created — this PRD has no GitHub issue at time of writing (tracker item `tsk_mt1xxymgata1sw`, plan id `plan_1787269888437_qky6ex`, `status.json.tracker.issue_key` is `null`). If the PM agent has since filed a feature issue, use that number instead of this placeholder.

---

## Objective

Make clicking a **Task sub-agent** chip in the horizontal chip row (built in tasks 2b/2c) open a small, read-only popover showing that sub-agent's current status and its active tool name — nothing more. This closes requirement R6: native Claude Code shows what a background Task sub-agent is doing without exposing its hidden transcript, and Nimbalyst currently has no equivalent for Task chips at all.

This is a deliberate visibility **ceiling**, not a stepping stone toward a full thread view. SDK-native Task sub-agent turns are intentionally hidden from the visible transcript (`packages/electron/src/main/services/ai/claudeCliSubAgentTracker.ts:20-22`, explicit design comment: "so they don't pollute the visible transcript"). This task must not attempt to surface that hidden transcript, add navigation, or build toward one.

---

## Context

**Parent Feature:** Agent Visibility and Workflow Enhancement (`.nimble/prds/001_agent-visibility/PRD_agent-visibility.md`)

Nimbalyst has three separate "spawned agent" systems (SDK-native Task sub-agents, Nimbalyst Teammates, Meta-Agent Mode child sessions), each with its own status vocabulary and UI surface. This PRD closes a gap identified against native Claude Code sub-agent UX (tracker item `tsk_mt1xxymgata1sw`): a chip row above the chat input, a `blocked` status, click-to-thread for Teammates, and a read-only status popover for Task sub-agents (this task).

Unlike Teammates — which get a real click-to-open-thread flow in task 2c because `TeammateManager.appendToInbox`/`flushPendingMessages` can actually route a message to them — Task sub-agents run in-process inside the lead's own `query()` call and have no separate thread to open. There is nothing to click into. The popover is the correct, final UX for this system, not a placeholder for a future thread view.

This task is part of **Wave 6** — the last functional-UI wave before the wave-7 CHANGELOG/gate task (5a). It runs after wave 5 (task 2c) rather than in parallel with it, specifically because both tasks extend the same new component file (`SubAgentChipRow.tsx`) and the PM structurally sequenced them (`2d depends_on: [2b, 2c]`) to avoid a file conflict.

---

## Assumed Precondition — Read Before Starting

This task depends on tasks **2b** and **2c**, which must already be merged/present in your worktree. Do not re-derive or re-implement their scope. Verify the following exists before writing any code:

- **From 2b:** `packages/electron/src/renderer/components/AgentMode/SubAgentChipRow.tsx` exists — a new horizontal chip-row component rendered directly above the chat message input, sourced from `sessionTeammatesAtom`/`sessionTasksAtom` (`agentMode.ts:223-253`), rendering one chip per active Teammate/Task sub-agent, colored by the normalized `SubAgentStatus` mapping from task 2a (`packages/electron/src/renderer/store/atoms/subAgentStatus.ts`, or wherever 2a landed it).
- **From 2c:** The **Teammate** chips in that same component already have click-to-open-thread wired — clicking a Teammate chip opens/loads that teammate's own thread and lets the user send it a message, via `TeammateManager.appendToInbox`/`flushPendingMessages` (`TeammateManager.ts:957-1011`), extending `scrollToTeammateAtom` (`TeammatePanel.tsx:61-63,307-309`).
- Some mechanism in `SubAgentChipRow.tsx` already distinguishes a Teammate-sourced chip from a Task-sourced chip (they come from two different atoms — `sessionTeammatesAtom` vs `sessionTasksAtom` — and only Teammate chips have a click handler after 2c). Read the actual component before writing code: confirm how chip "kind" is discriminated (a `kind`/`source` prop, a union type, separate chip sub-components, etc.) and reuse that discriminant to attach a **different** click handler to Task chips, rather than inventing a second parallel classification scheme.

If 2b/2c's actual implementation diverges materially from this description (e.g., a different file path, a different click-wiring shape), treat the real code as authoritative — this brief describes the *expected* shape, not a substitute for reading the merged code.

---

## Research Context

### Patterns to Follow

- **Task status/tool-name fields already exist and require no new plumbing.** `TaskInfo` (`packages/electron/src/renderer/store/atoms/agentMode.ts:229-241`) already carries everything the popover needs client-side:
  ```ts
  export interface TaskInfo {
    taskId: string;
    description: string;
    taskType?: string;
    status: 'running' | 'completed' | 'failed' | 'stopped';
    startedAt: number;
    toolUseId?: string;
    toolCount: number;
    tokenCount: number;
    durationMs: number;
    lastToolName?: string;
    summary?: string;
  }
  ```
  Use `task.status` (or the normalized `SubAgentStatus` from 2a, for visual consistency with the chip's own color) for "current status", and `task.lastToolName` for "active tool name". No IPC round-trip, no new atom, no main-process change is needed for this task — everything is already in the renderer's `sessionTasksAtom`.
- **Existing status-coloring convention for Task items** — `TeammatePanel.tsx`'s `TaskItem` component (`:241-292`, specifically the icon block at `:267-277`) is the existing spinner/hollow-circle/filled-dot convention for Task status. Match this visually inside the popover for consistency, but do not import or reuse `TaskItem` itself — it renders a full list row, not a popover body.
- **Floating UI pattern** — per `.claude/rules/floating-ui.md`, use `@floating-ui/react` with `FloatingPortal`. Do not hand-roll `position: fixed` math off `getBoundingClientRect()`. Minimal shape:
  ```tsx
  import { useFloating, offset, flip, shift, FloatingPortal, useInteractions, useDismiss, useRole, useClick } from '@floating-ui/react';

  const { refs, floatingStyles, context } = useFloating({
    placement: 'top',
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
  });
  const click = useClick(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'dialog' });
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss, role]);
  ```
  `@floating-ui/react` is already a dependency in `packages/electron/package.json` — no new dependency to add.

### Known Issues to Address

- None specific to this task beyond the boundary below — this is a small, additive, client-only UI change.

### Recommended Approach

- Keep the popover a pure presentational component reading from already-derived local state (`task.status`, `task.lastToolName`, and the 2a `SubAgentStatus` mapping if you use it for the label/color). Do not add a new IPC channel, new atom family, or main-process change — R6's acceptance criteria are satisfiable entirely from existing `TaskInfo` fields.
- Use `useRole(context, { role: 'dialog' })` (not `'menu'`) since this is a read-only informational popover, not an actionable menu — no `useListNavigation`/keyboard-item-selection is needed.

### Dependencies

**File Dependencies:**
- `SubAgentChipRow.tsx` (created by 2b, extended by 2c) — this task extends it further. Read it in full before editing.
- `packages/electron/src/renderer/store/atoms/agentMode.ts` — `TaskInfo` type, `sessionTasksAtom` (read-only consumption, no changes expected).
- `packages/electron/src/renderer/store/atoms/subAgentStatus.ts` (from 2a, exact path may differ — confirm) — normalized `SubAgentStatus` mapping, if used for the popover's status label/color.

**Library Dependencies:**
- `@floating-ui/react` (already installed) — required per `floating-ui.md`.

---

## Requirements

1. Clicking a **Task sub-agent chip** (i.e., a chip sourced from `sessionTasksAtom`/`TaskInfo`, not `sessionTeammatesAtom`/`TeammateInfo`) opens a floating popover anchored to that chip.
2. The popover is **read-only**: no buttons that send messages, no navigation, no "open thread" affordance of any kind.
3. The popover shows, at minimum:
   - Current status (raw `TaskInfo.status`, or the normalized `SubAgentStatus` label if that reads better against the chip's own color — pick one and be consistent with the chip).
   - Active tool name (`TaskInfo.lastToolName`, when present; show a sensible empty state — e.g. "—" or "no active tool" — when `lastToolName` is undefined, such as immediately after the task starts or once it has completed).
4. Clicking a **Teammate chip** must continue to trigger 2c's click-to-open-thread behavior, completely unaffected by this change. Do not let the new Task-popover logic leak onto Teammate chips, and do not regress 2c's click handler.
5. The popover dismisses on outside click / Escape (via `useDismiss`), consistent with other floating UI usage in the codebase.
6. No attempt is made, directly or indirectly, to surface the hidden Task sub-agent transcript (`claudeCliSubAgentTracker.ts:20-22`). Do not add a "view full details" link, a modal, or any UI that implies more content exists beyond status + tool name.

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] Clicking a Task sub-agent chip opens a read-only popover with current status and active tool name
- [ ] Popover uses `@floating-ui/react` with `FloatingPortal` — no manually calculated `position: fixed` coordinates
- [ ] No navigation occurs; no attempt is made to surface the hidden Task sub-agent transcript
- [ ] Clicking a Teammate chip still triggers 2c's open-thread behavior, unaffected by this change (regression check)
- [ ] Popover dismisses on outside click and Escape
- [ ] Unit/component test covers: popover opens on Task-chip click, shows status + tool name, and does not fire on Teammate-chip click

**All criteria must pass before task is complete.**

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/electron/src/renderer/components/AgentMode/SubAgentChipRow.tsx` | modify | Add Task-chip click handler that opens the read-only status/tool-name popover, without touching the Teammate-chip click-to-thread path added in 2c |

### File Ownership Notes

`SubAgentChipRow.tsx` is a three-task shared file: created in 2b, extended for Teammate click-to-thread in 2c, extended again here for the Task popover. Per the PM's structural sequencing (`2d depends_on: [2b, 2c]`, waves 4 then 5), there is no concurrent-edit risk — 2c's changes are already merged into your worktree before you start. Still, when editing, touch only the Task-chip branch of whatever click-dispatch logic 2c introduced; do not restructure or reformat the Teammate-chip branch.

If a colocated test file already exists for this component (e.g. `SubAgentChipRow.test.tsx`, likely created or extended by 2b/2c), **extend it** rather than creating a second test file — per this repo's token-discipline rule, prefer one growing test file per component over several small ones.

---

## Deliverables

None beyond the files above.

---

## Implementation Guidance

### Patterns to Follow

- Reuse `SubAgentChipRow.tsx`'s existing chip-kind discrimination (Teammate vs Task) from 2b/2c — see "Assumed Precondition" above. Do not add a second, parallel way of telling chip types apart.
- Match `TeammatePanel.tsx`'s existing spinner/hollow-circle/filled-dot status-coloring convention (`:267-277` for tasks) for the popover's status indicator, for visual consistency with the chip row itself.
- Use the `@floating-ui/react` pattern shown in Research Context above — `useFloating` + `offset`/`flip`/`shift` middleware + `FloatingPortal` + `useClick`/`useDismiss`/`useRole('dialog')`.

### Code Style

- Uses only canonical `--nim-*` CSS variables (per `UI_PATTERNS.md`) — no hardcoded colors.
- Component root (and the popover's own root) needs a stable kebab-case class per `REACT_DOM_MARKERS.md` (e.g. `sub-agent-task-status-popover`).
- Ternary Tailwind classes for mutually exclusive status-color states, matching the existing convention in `TeammatePanel.tsx`.
- If the popover's internal layout needs responsive behavior (unlikely for a small fixed-content popover), use `@container` queries, not `@media`, per this repo's convention — but a fixed-size popover with two lines of text likely needs neither.

### Edge Cases

- `task.lastToolName` is `undefined` when the task hasn't executed a tool yet, or after it completes and the field is cleared/stale — show an explicit empty state, not a blank line or `undefined` string.
- A Task chip for a task that has since transitioned to `completed`/`failed`/`stopped` while the popover is open: the popover should reflect whatever `task.status` is at click time; it does not need to live-update while open (task is short-lived UI, not a subscription target) — but do not crash or show stale-looking data if the underlying atom does update while the popover happens to be open (it's a derived atom read via `sessionTasksAtom`, so a re-render will naturally pick up the new value if the popover component itself re-renders — verify this behaves sanely, don't suppress it).
- Multiple Task chips clicked in sequence: only one popover should be open at a time (clicking a second Task chip should close the first and open the new one, standard floating-ui single-open-instance behavior via shared open state per chip or a single shared popover instance keyed by task id).

### Testing Requirements

- Extend the existing `SubAgentChipRow` test file (see File Ownership Notes) rather than creating a new one.
- Cover: Task-chip click opens the popover with the right status/tool-name content; Teammate-chip click is unaffected (still triggers 2c's handler, does not open this popover); popover dismisses on outside click/Escape.
- This is a small, low-risk client-only change (complexity 3/10) — a component-level test (e.g. React Testing Library) exercising the click → popover-visible → content-correct flow is sufficient; no E2E test is required for this task.

---

## Boundaries

### Files You MUST NOT Touch

From `.nimble/config.yaml`'s global `never_touch` list:
- `package-lock.json`, `packages/browser-extension/package-lock.json`
- `.env*`
- `.github/workflows/*`
- `packages/electron/src/database/migrations/*`
- `packages/electron/src/main/database/sqlite/schemas/*`
- `node_modules/`, `**/dist/`, `packages/electron/out/`
- `nimbalyst-local/`, `.beads/`

None of these are relevant to this task's scope, but they apply globally regardless.

Additionally, PRD-specific out-of-scope files (§11 Agent Boundaries, §3 Non-Goals):
- `packages/electron/src/renderer/components/MetaAgentMode/MetaAgentMode.tsx` status-mapping logic (`getStatusTone`/`getBarTone`, lines 67-104) — do not fold Meta-Agent Mode's status vocabulary into this component or the `SubAgentStatus` mapping.
- `packages/electron/src/main/services/ai/claudeCliSubAgentTracker.ts` transcript-hiding logic — do not modify to expose Task sub-agent turns. This is the whole point of the boundary this task respects.

### Files Requiring Review

From `.nimble/config.yaml`'s `require_review` list: `packages/runtime/src/auth/*`, `packages/electron/src/main/database/*`, `packages/electron/src/main/index.ts`, `packages/electron/src/main/bootstrap.ts`, `packages/electron/src/main/utils/protocolRegistration.ts`, `CHANGELOG.md`, `packages/collab-protocol/*`, `packages/collab-client/*`, `packages/collab-bundle/*`, `packages/collab-adapters/*`.

This task does not touch any of these files — no human-review gate is triggered by this task on its own. (The PRD's one gate is after wave 6, before task 5a in wave 7, because 5a touches `CHANGELOG.md` — see PRD §12 Assumption 5. This task's own diff feeds into that gate's review, but does not itself require review before the gate.)

---

## Dependencies

### Upstream Tasks

| Task | What It Provides | Verify Before Starting |
|------|------------------|------------------------|
| 2b | `SubAgentChipRow.tsx` — new horizontal chip-row component above the chat input, one chip per active Teammate/Task sub-agent, colored by the 2a `SubAgentStatus` mapping | Confirm the file exists at the expected path and renders chips for both Teammates and Tasks, sourced from `sessionTeammatesAtom`/`sessionTasksAtom` |
| 2c | Teammate chips in `SubAgentChipRow.tsx` have click-to-open-thread wired (opens/loads the teammate's own thread, allows sending it a message via `TeammateManager.appendToInbox`/`flushPendingMessages`) | Click a Teammate chip in a running session and confirm it opens the teammate's thread rather than just scrolling to the spawn point; identify how the component currently discriminates Teammate vs Task chips so you can attach a separate handler cleanly |

### Downstream Impact

Tasks that depend on this one: **5a** (CHANGELOG entry and final review gate) depends on 2d among five other tasks (2c, 3b, 4a, 4b, 4c) — 5a only summarizes shipped behavior in one CHANGELOG bullet and does not touch this component; there is no code-level downstream consumer of this task's output.

**Before starting:** Verify 2b and 2c are complete by checking:
- `SubAgentChipRow.tsx` exists and renders both Teammate and Task chips with status-based coloring.
- A Teammate chip's click handler already opens its thread (not just a scroll) — do this by reading the merged code, not by assuming this brief's description is exact.

---

## GitHub Context

**Issue:** Not yet created (no per-task GitHub issue observed in `status.json`; PM agent creates these during execution per the enhanced issue-body template)
**Feature Issue (Parent):** Not yet created — see note under task metadata above
**Branch:** `worktree/agent-visibility-2d`
**Target:** `feature/agent-visibility` (this PRD runs in `feature-branch` execution mode per `status.json.execution_mode`) — confirm with the PM agent at task start in case this has changed.

---

## Commit Guidelines

Use Conventional Commits:
```
feat(agent-visibility): add read-only status popover for Task sub-agent chips

Co-Authored-By: Claude <noreply@anthropic.com>
```

Types: feat, fix, refactor, test, docs, chore

---

## Validation Checklist

Before creating PR:
- [ ] All success criteria met
- [ ] Build passes: `npm run build`
- [ ] Type check passes: `npm run typecheck`
- [ ] No `never_touch` files modified
- [ ] Tests added/updated (extend existing `SubAgentChipRow` test file, don't create a new one)
- [ ] Branch rebased on `feature/agent-visibility` (or main, if execution mode has changed — confirm with PM)

---

*Generated by NIMBLE Brief Writer*
*PRD: agent-visibility | Task: 2d | Wave: 6*
