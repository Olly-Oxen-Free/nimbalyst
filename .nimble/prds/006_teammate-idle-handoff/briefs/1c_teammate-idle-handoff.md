# Task Brief: 1c

**Title:** Teammates panel row: show model
**PRD:** teammate-idle-handoff
**Priority:** should
**Complexity:** 1/10
**Model:** sonnet
**Wave:** 1
**Feature Issue:** TBD — assigned by PM agent at execution start

---

## Objective

The Teammates panel row currently shows only `agentType` (e.g. "general-purpose"); the teammate's
`model` (e.g. "haiku") is already present on the emitted object but unused. Show it alongside the
type. Visual-only change.

---

## Context

**Parent Feature:** Teammate Idle Handoff (PRD `teammate-idle-handoff`, GitHub feature issue TBD)

`TeammatePanel.tsx`'s `TeammateItem` component renders each teammate row. The label line at
`TeammatePanel.tsx:402-404` (current file state) reads:

```tsx
<div className="text-[10px] text-[var(--nim-text-faint)] truncate">
  {teammate.agentType}{teammate.status === 'idle' ? ' (idle)' : ''}
</div>
```

Research (T6, `research/internal/findings.md`) confirmed `model` is already carried on emitted
teammate objects for idle entries (`TeammateManager.ts:1496` region) and is simply not read by
this row. This is a display omission, not a data-plumbing gap — no changes to `TeammateManager.ts`
or any IPC/wire type are needed for this task.

This task is part of **Wave 1** — independent of 1a and 1b, no dependencies.

---

## Requirements

Fulfills PRD requirement **R7**: *"The Teammates panel row shows the teammate's `model` when
present (currently only `agentType`, e.g. 'general-purpose'). Visual-only; no unit test per repo
testing rules."*

1. Show the `model` string alongside `agentType` when the teammate object carries one (e.g.
   `"general-purpose - haiku"`), matching the panel's existing text styling (same
   `text-[10px] text-[var(--nim-text-faint)] truncate` treatment, same line).
2. When `teammate.model` is absent/undefined, the row's layout is unchanged from today (just
   `agentType`, optionally with the `(idle)` suffix) — do not render a stray separator or empty
   segment.
3. Separator/format between `agentType` and `model` is your call (the PRD's own example uses
   `" - "`) as long as it reads cleanly next to the existing `(idle)` suffix.

### Explicit anti-goals (do not implement)

- **No unit test** — per this repo's testing rules (`CLAUDE.md`: "No presentation-only tests" —
  icon names, exact title strings, hardcoded element counts do not get unit tests when a human
  would notice the breakage in one second of looking at the screen), and per this PRD's own
  Decision D5 ("Excluded from test scope (visual)"). Do not add a snapshot or DOM-text-matching
  test for this change.
- **No changes outside `TeammatePanel.tsx`.** Do not touch `TeammateManager.ts`, any IPC type, or
  the popover component (`TeammateThreadPopover.tsx`) — this task is the panel row only.

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] Panel row displays the model string when the teammate object carries one; layout unchanged
      when model is absent
- [ ] No changes outside `TeammatePanel.tsx`; no new tests

**All criteria must pass before task is complete.**

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/electron/src/renderer/components/AgentMode/TeammatePanel.tsx` | modify | Add `model` display alongside `agentType` in the row's label line (`~:402-404`) |

### File Ownership Notes

No other task in this PRD touches `TeammatePanel.tsx`. No file-overlap risk.

---

## Implementation Guidance

### Patterns to Follow

Match the existing conditional-suffix pattern already used in the same line
(`{teammate.status === 'idle' ? ' (idle)' : ''}`) — a ternary appended inline, not a separate
`{condition && <span>...}` block, to stay consistent with the surrounding style.

### Code Style

Per this repo's UI pattern rules: use a ternary for the mutually-exclusive model-present/absent
states rather than `&&` chains. No new CSS classes — reuse the existing text styling on the same
`<div>`.

### Edge Cases

- `teammate.model` may be `undefined` (per `IdleTeammate.model: string | undefined` and
  `ManagedTeammate.model?: string` in `TeammateManager.ts`) — the ternary must handle this cleanly,
  matching Requirements item 2.
- Do not assume `model` is always a short label — no truncation logic beyond the existing
  `truncate` Tailwind class already on the containing `<div>`.

### Testing Requirements

None — see Explicit anti-goals above. This task ships no test.

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
- This is the TEAMMATE panel (PRD 002 surface) — do not touch anything under the Task-subagent
  tile/popover UI (PRD 004).
- Do not touch `TeammateManager.ts` or any type/wire-protocol definitions — `model` is already
  emitted; this task only reads an existing field.

### Files Requiring Review

`TeammatePanel.tsx` is under `packages/electron/src/renderer/**`, not
`packages/electron/src/main/**` — it is not in `.nimble/config.yaml`'s `require_review` list. This
task does not trigger the PRD's human-review gate on its own.

---

## Dependencies

### Upstream Tasks

None — `depends_on: []`, Wave 1.

### Downstream Impact

None — no task in this PRD depends on 1c.

**Before starting:** No upstream dependency to verify — this task starts from the current state of
`main`/the feature branch.

---

## GitHub Context

**Issue:** TBD — created by PM agent at execution start
**Feature Issue (Parent):** TBD — created by PM agent at execution start
**Branch:** `worktree/teammate-idle-handoff-1c`
**Target:** Determined by PM agent based on execution mode (feature branch or main)

---

## Commit Guidelines

Use Conventional Commits:
```
feat(teammates): show the spawn model on the teammates panel row
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
- [ ] No new tests added (per repo testing rules and PRD Decision D5)
- [ ] Branch rebased on target branch (feature branch or main)

**Execution rules (mandatory, repo-level, non-negotiable):**
- Do NOT run `gh pr create` at any point. No pushes.
- Do NOT commit — the coordinator reviews your diff, runs gates, and commits per task.
- Do NOT run `npm` commands (no typecheck/test runs) — the coordinator runs gates centrally. Edit
  only the file listed above.
- This is the TEAMMATE lifecycle (PRD 002/003 UI surface) — never touch the Task-subagent system
  (`activeTasks` in `ClaudeCodeProvider.ts`, PRD 004 tile/popover UI).
- Match existing code style; every changed line must trace to this task; no drive-by refactors; no
  emojis; comments citing issues use prose or GitHub issue numbers, never `NIM-###` keys.

---

*Generated by NIMBLE Brief Writer*
*PRD: teammate-idle-handoff | Task: 1c | Wave: 1*
