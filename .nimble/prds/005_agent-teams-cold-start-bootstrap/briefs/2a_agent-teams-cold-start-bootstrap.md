# Task Brief: 2a

**Title:** Recognize 'Agent' alongside 'Task' in electron tool-name-keyed surfaces
**PRD:** agent-teams-cold-start-bootstrap
**Priority:** must
**Complexity:** 3/10
**Model:** sonnet
**Wave:** 2
**Feature Issue:** N/A — no_pull_requests mode, tracked via `.nimble/prds/005_agent-teams-cold-start-bootstrap/status.json`

---

## Objective

`AgentMode.tsx:281` registers PRD 004's inline-expand `TaskToolWidget` under the `'Task'` key only. The live SDK spawn tool is `Agent`, so **PRD 004's inline-expand widget is already unreachable for real name-less dispatches in production today** — a live regression independent of the cold-start bug this PRD otherwise fixes, found during PRD review. This task registers the widget under both keys and audits the rest of `packages/electron/src` for other `'Task'`-only tool-name hardcodes.

---

## Context

**Parent Feature:** Agent Teams Cold-Start Bootstrap (PRD `005_agent-teams-cold-start-bootstrap`)

PRD 004 (task-subagent-visibility) built a polished inline-expand widget (`TaskToolWidget`) for anonymous sub-agent dispatches — the fallback surface every delegation lands on today because of this PRD's core bug. But PRD 004's own widget registration hardcodes the tool name `'Task'`, and the live SDK (pinned at `@anthropic-ai/claude-agent-sdk@0.3.221`) calls the tool `Agent`. That means even 004's fallback surface is currently broken for real dispatches: they fall through to the generic sub-agent card instead of rendering the polished widget. 004's own test fixtures never caught this because they were written against the `'Task'` name, which is stale.

This task is part of **Wave 2** — it runs in parallel with task 1b (file-disjoint: this task touches `packages/electron/src/renderer/**` and audits `packages/electron/src`; 1b touches `packages/runtime/src/ai/server/providers/**`). **A gate follows Wave 2**: this task's primary file (`AgentMode.tsx`) is a renderer file and fast-tracks normally, but if your audit finds a hardcode that needs fixing **inside `packages/electron/src/main/**`**, that edit falls under the repo's `require_review` boundary (confirmed: `packages/electron/src/main/**` is listed verbatim in `.nimble/config.yaml`'s `boundaries.require_review`). The PRD's post-Wave-2 gate exists specifically to catch this case before the verification waves (2b, 3a) proceed. Task 2b is explicitly barred from touching `packages/electron/src/main/**` — any main-process finding from your audit that needs a real fix (not just documentation) should be flagged for the final merge gate rather than blocking this task, unless it's small enough to land here and you accept it triggers review.

---

## Research Context

### Patterns to Follow

- **Widget registration site** (`AgentMode.tsx:279-283`, verified current text):
  ```tsx
  // Register the inline-expand widget for Task sub-agent spawns (runs once)
  useEffect(() => {
    setTranscriptToolWidgets(TASK_TOOL_WIDGET_SOURCE, { Task: TaskToolWidget });
    return () => setTranscriptToolWidgets(TASK_TOOL_WIDGET_SOURCE, undefined);
  }, []);
  ```
  Change the registration object to `{ Task: TaskToolWidget, Agent: TaskToolWidget }`.

- **`SUBAGENT_TOOLS` dual-name-recognition precedent already exists elsewhere** — `SUBAGENT_TOOLS = new Set(['Task', 'Agent'])` in both `packages/runtime/src/ai/server/transcript/parsers/ClaudeCodeRawParser.ts:27` and `packages/runtime/src/ai/server/providers/claudeCode/ClaudeCodeTranscriptAdapter.ts:20` (both verified live). This is the established pattern for tool-name-rename recognition in this codebase — follow the same shape (recognize both names, don't replace one with the other).

### Known Issues to Address

- **`ClaudeSettingsManager.ts:381`'s bare `case 'Task':` is a confirmed behavioral no-op.** Verified live (`packages/electron/src/main/services/ClaudeSettingsManager.ts:340-393`): this is inside `generateToolPattern(toolName, input)`, a `switch` statement. The `case 'Task':` at line 381 falls into a group of cases (`WebSearch`, `Glob`, `Grep`, `LS`, `TodoRead`, `TodoWrite`, `Task`, `NotebookRead`, `NotebookEdit`, `ExitPlanMode`) that all just `return toolName;`. The `default:` branch (lines 387-392) **also** returns `toolName` for any unrecognized name (including `'Agent'` today). So adding `case 'Agent':` to this switch changes nothing behaviorally — it's purely optional clarity. **Do not write a test for this** — asserting `generateToolPattern('Agent', {})` returns `'Agent'` would be an identity assertion, which the repo's testing rules forbid (this was struck from the mandate during PRD review, D10/W1). If you touch this file at all, treat it as documentation/audit-note only.

### Recommended Approach

1. **PRIMARY FIX:** In `AgentMode.tsx`, change `{ Task: TaskToolWidget }` to `{ Task: TaskToolWidget, Agent: TaskToolWidget }` at the registration site (~line 281).
2. **LIVE-SHAPE TEST:** Add a test asserting a `tool_use` named `'Agent'` with **no `name` arg** renders `TaskToolWidget`. Extend PRD 004's existing widget test file — do not create a new test file (repo token-discipline guidance: prefer extending an existing file). This is the test that catches the real regression 004's own `'Task'`-keyed fixtures could not.
3. **REGRESSION GUARD:** Also add/confirm a test that a **name-carrying** `'Agent'` `tool_use` still renders the teammate card, not `TaskToolWidget` — this is the `isTeammate` discriminator (derived from tool_use args, see `ClaudeCodeRawParser.ts:510-511` and `RichTranscriptView.tsx:1756`, both verified) that must not regress when you register `TaskToolWidget` for the `'Agent'` key. Registering the widget for `'Agent'` must not make it swallow name-carrying (teammate) spawns — the `isTeammate` gate at `RichTranscriptView.tsx:1766` (`if (CustomWidget && !(isSubAgent && isTeammate))`, verified) is what prevents that; confirm it holds with a live-shape fixture rather than assuming.
4. **AUDIT:** Sweep `packages/electron/src` (both `main` and `renderer`) for other `'Task'`-only tool-name hardcodes. `ClaudeSettingsManager.ts:381` is the one already-known finding (documented above — no-op, audit-note only, no test). Search for other bare `'Task'` string literals used as tool-name comparisons or switch cases; for each one found, either align it to recognize `'Agent'` too, or document in the commit message why it doesn't need to (e.g. genuinely `'Task'`-specific legacy data, or another confirmed no-op like `ClaudeSettingsManager`).
5. State the audit result (sites found / aligned / no-op-documented) in the commit message.

### Dependencies

**File Dependencies:** Depends on task 1a's landed synthetic-pair shape (1a deliberately keeps the synthetic `tool_use` name as `'Task'` for the *teammate* spawn path — see 1a's brief — so this task's `'Agent'` registration is specifically about the **name-less, plain sub-agent** dispatch path, which uses the SDK's real `Agent` tool name unmodified). Verify 1a is complete: confirm the gate at `TeammateManager.ts:~2209` is landed so that a name-less `Agent` call correctly returns `{ handled: false }` and falls through to the plain-subagent path this task's widget renders.

**Library Dependencies:** None new.

---

## Requirements

Fulfills R5 (electron tool-name-keyed surfaces recognize `Agent`).

**Constraint — small task by design:** every changed line must be a `'Task'`-vs-`'Agent'` recognition fix. Do not use this task as an opportunity to refactor or "improve" adjacent code (repo surgical-change rule).

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] `TaskToolWidget` registered for both `'Task'` and `'Agent'` keys; live-shape test (tool named `'Agent'`, no `name` arg) renders it
- [ ] A name-carrying `'Agent'` tool_use still renders the teammate card, not `TaskToolWidget` (isTeammate gate from `args.name` — regression guard)
- [ ] Audit result across `packages/electron/src` (sites found/aligned/no-op-documented) stated in the commit message
- [ ] No identity-asserting test added for the `ClaudeSettingsManager` no-op

**All criteria must pass before task is complete.**

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/electron/src/renderer/components/AgentMode/AgentMode.tsx` | modify | Register `TaskToolWidget` under both `'Task'` and `'Agent'` keys (~line 281) |
| `packages/electron/src/main/services/ClaudeSettingsManager.ts` | modify (optional) | Audit-only: adding `case 'Agent':` is optional clarity given the confirmed no-op default branch; no test required |
| (audit output, no fixed path) | none/modify as found | Any other `'Task'`-only hardcode found in `packages/electron/src` during the sweep, aligned or documented |

### File Ownership Notes

`AgentMode.tsx` and `ClaudeSettingsManager.ts` are touched only by this task in this PRD. **`ClaudeSettingsManager.ts` is under `packages/electron/src/main/**`, which is in the repo's `require_review` boundary list** — touching it (even for the optional no-op clarity case) triggers review. Given it's a confirmed no-op, you may choose to skip the optional `case 'Agent':` addition entirely and just document the finding in the commit message instead, avoiding the review trigger for a change that has zero behavioral effect. Either choice is acceptable; document your choice in the commit message either way.

---

## Implementation Guidance

### Patterns to Follow

Mirror the existing `SUBAGENT_TOOLS = new Set(['Task', 'Agent'])` pattern conceptually (recognize both, don't replace) even though the widget registry is an object literal, not a Set — the shape `{ Task: TaskToolWidget, Agent: TaskToolWidget }` is the object-literal equivalent.

### Code Style

Match existing `AgentMode.tsx` conventions — the `useEffect` cleanup pattern (`setTranscriptToolWidgets(..., undefined)` on unmount) is already correct and needs no change beyond the registration object itself.

### Edge Cases

- Do not accidentally register `TaskToolWidget` in a way that also intercepts teammate spawns — the discriminator that prevents this lives in `RichTranscriptView.tsx:1766` (`isTeammate` gate), not in the widget registry itself. Your live-shape regression test (criterion 2) is what proves this boundary holds.

### Testing Requirements

Extend PRD 004's existing widget test file (find it by searching for the current `'Task'`-keyed widget test — do not create a new file). Add exactly two new fixtures: (1) `'Agent'` tool name, no `name` arg → renders `TaskToolWidget`; (2) `'Agent'` tool name, `name` arg present → renders teammate card, not `TaskToolWidget`. Do not add a test for the `ClaudeSettingsManager` no-op (explicitly forbidden — identity assertion).

---

## Boundaries

### Files You MUST NOT Touch

- `node_modules/**`, `dist/**`, `out/**`, `out2/**`, `release/**`, `.vite/**` (global `never_touch`)

### Files Requiring Review

- `package.json`, `package-lock.json`, `packages/electron/src/main/**`, `packages/runtime/src/auth/jwtScopes.ts`, `packages/electron/build/**`, `CHANGELOG.md`. **This task's `ClaudeSettingsManager.ts` file falls inside `packages/electron/src/main/**` and is therefore a `require_review` file.** If your audit finds any other `'Task'`-only hardcode inside `packages/electron/src/main/**`, fixing it also triggers this boundary — proceeding is fine (the PRD's post-Wave-2 gate exists precisely to review this), but be aware of it and call it out clearly in your commit message.

---

## Dependencies

### Upstream Tasks

| Task | What It Provides | Verify Before Starting |
|------|------------------|------------------------|
| 1a | Corrected spawn gate ensuring name-less `Agent` calls return `{ handled: false }` and fall through to the plain-subagent path this task's widget renders | Confirm 1a's success criteria are met (see 1a's brief), specifically the name-less passthrough criterion |

### Downstream Impact

Tasks that depend on this one: **2b** (rendering/regression verification depends on this task's widget registration for the `'Agent'` key), **3a** (live E2E control-case verification of the un-named delegation path renders through this widget).

**Before starting:** Verify 1a is complete by confirming the gate change is landed (read `TeammateManager.ts:~2209`).

---

## Deliverables

| Artifact | Path | Done when |
|---|---|---|
| 'Agent' recognized in widget registration + audit | `packages/electron/src/renderer/components/AgentMode/AgentMode.tsx` | Live-shape widget test green; audit documented in commit message (sites found/aligned/no-op) |

---

## GitHub Context

**Issue:** N/A — this PRD runs with `no_pull_requests: true` and `execution_mode: feature-branch`; work is tracked via `.nimble/prds/005_agent-teams-cold-start-bootstrap/status.json`, not GitHub Issues/PRs.
**Feature Issue (Parent):** N/A
**Branch:** `worktree/agent-teams-cold-start-bootstrap-2a`
**Target:** feature branch (base: `main`, per `status.json` execution_mode)

---

## Commit Guidelines

Use Conventional Commits, one-sentence subject:
```
fix(agent-mode): register TaskToolWidget for both Task and Agent tool names
```
Include the audit result as a short bullet in the commit body (e.g. "Audit: `packages/electron/src` swept for `'Task'`-only hardcodes; `ClaudeSettingsManager.ts:381` confirmed no-op (default branch returns toolName), no other sites found"). Do not add `Co-Authored-By` lines (repo rule).

---

## Validation Checklist

Before considering this task done:
- [ ] All success criteria met
- [ ] Build passes: `npm run build`
- [ ] Type check passes: `npm run typecheck`
- [ ] Test suite passes: `npm run test:prepush`
- [ ] No `never_touch` file modified; any `require_review` file touch (e.g. `ClaudeSettingsManager.ts`) is called out explicitly in the commit message
- [ ] No identity-asserting test added for the `ClaudeSettingsManager` no-op
- [ ] Every changed line traces to a `'Task'`-vs-`'Agent'` recognition fix — no adjacent refactoring

**Note:** this task, together with 1b, is followed by a PRD-level human-review gate (after Wave 2) before tasks 2b/3a proceed — see Context section.

---

*Generated by NIMBLE Brief Writer*
*PRD: agent-teams-cold-start-bootstrap | Task: 2a | Wave: 2*
