# Task Brief: 2b

**Title:** Rendering and downstream regression verification for name-only spawns
**PRD:** agent-teams-cold-start-bootstrap
**Priority:** must
**Complexity:** 3/10
**Model:** sonnet
**Wave:** 3
**Feature Issue:** N/A — no_pull_requests mode, tracked via `.nimble/prds/005_agent-teams-cold-start-bootstrap/status.json`

---

## Objective

Task 1a made name-only spawns produce a synthetic `teammate_task` tool pair (with tool name kept as `'Task'`); task 2a fixed `TaskToolWidget` registration for the `'Agent'` key. This task is pure verification: prove the rendering discriminators built in PRDs 002/004 hold for these live shapes — a name-only spawn renders the teammate card, a name-less dispatch renders `TaskToolWidget` under both tool names, and neither path regressed.

**This is a verification/extension task, not a source-change task.** If a discriminator actually breaks during this work, the fix belongs in 1a's payload/args shape (coordinate back to that task's owner), not in new renderer branching added here.

---

## Context

**Parent Feature:** Agent Teams Cold-Start Bootstrap (PRD `005_agent-teams-cold-start-bootstrap`)

PRD 002 built the teammate thread-view/card rendering; PRD 004 built the plain sub-agent `TaskToolWidget` inline-expand. Both rendering paths share the same transcript pipeline and must correctly discriminate a teammate spawn from a plain sub-agent dispatch. That discrimination has always come from the tool_use call's **arguments** — `args.name` presence — not from the tool name or the result payload. Task 1a's fix changes what shape reaches this pipeline (name-only spawns now succeed instead of falling through), and task 2a's fix changes which tool names route to `TaskToolWidget`. This task confirms both rendering paths still land correctly under the new shapes, closing R6's rendering half.

This task is part of **Wave 3** — it depends on both 1a (spawn/args shape) and 2a (widget registered for `'Agent'`), and runs **after** the PRD's post-Wave-2 human-review gate. Do not start this task until that gate has cleared.

---

## Research Context

### Patterns to Follow

- **The `isTeammate` discriminator chain, end to end (both verified live):**
  1. `ClaudeCodeRawParser.ts:509-511`: `const teammateName = typeof args.name === 'string' ? args.name : null; const teamName = typeof args.team_name === 'string' ? args.team_name : null;` — these come from the tool_use **args**, i.e. the model's actual call, not any synthesized result.
  2. `RichTranscriptView.tsx:1756`: `const isTeammate = isSubAgent && !!(toolMsg.subagent?.teammateName || toolMsg.subagent?.teamName);` — this is where the boolean discriminator itself is computed, downstream of the parser's extraction above.
  3. `RichTranscriptView.tsx:1766`: `if (CustomWidget && !(isSubAgent && isTeammate)) { ... }` — this is the gate that prevents a registered custom widget (like `TaskToolWidget`, now registered for `'Agent'` too per task 2a) from swallowing a teammate spawn. A name-only spawn is `isTeammate: true` purely from `args.name` being present — no renderer change was needed for the discriminator itself when 1a/2a landed (this was explicitly verified during PRD review). Your job is to add fixture coverage proving it, not to change this logic.

### Known Issues to Address

None expected — this is a verification task. If you find the discriminator chain above does NOT hold for the live name-only-spawn shape, that is a genuine finding: do not patch renderer logic here. Document the exact failure (fixture input, expected vs actual render) and flag it back for a fix in task 1a's payload/args shape.

### Recommended Approach

1. **Teammate-card rendering (item 1, PRD R6 rendering half):** Extend the existing `RichTranscriptView` / `TaskToolWidget` test coverage (prefer PRD 004's existing regression test file — do not create a new one) with a name-only spawn fixture: a `tool_use` with `name` present, no `team_name`, tool name `'Task'` (matching 1a's synthetic-pair shape, which deliberately keeps `'Task'` as the tool_use name for teammate spawns — see 1a's brief). Assert it renders the existing teammate card, **not** `TaskToolWidget`.
2. **Name-less dispatch, both tool names (item 2):** Task 2a already added the `'Agent'`-shape test for the name-less path (no `name` arg, tool name `'Agent'` → renders `TaskToolWidget`). Here, confirm the **existing** `'Task'`-keyed fixtures from PRD 004 still pass — this is a green-suite confirmation only, no new fixture needed for the `'Task'` half unless you find an actual gap.
3. **Teammate chip + notification behavior for the new spawn shape (item 3) — runtime-side only:** Verify (via existing runtime-side test coverage, extended if needed) that the chip/notification signal path handles the name-only spawn shape correctly. **Do NOT touch any file under `packages/electron/src/main/**`** in this task — that crosses the `require_review` boundary post-gate, and this task is explicitly barred from it (PRD decision D10/W3). If you find `NotificationService`'s test needs extending for the new spawn shape and that file lives under the main-process boundary, do not edit it — instead, note the finding in `research/findings.md` (or a comparable location the final merge gate will read) for someone to pick up post-gate.

### Dependencies

**File Dependencies:**
- Depends on 1a's synthetic tool-pair shape (`teammate_task` result, `'Task'` tool_use name kept, `args.name` present) — confirm 1a landed as described in its brief before writing fixtures against it.
- Depends on 2a's `TaskToolWidget` registration for the `'Agent'` key — confirm 2a landed (`AgentMode.tsx` registers `{ Task: TaskToolWidget, Agent: TaskToolWidget }`) before asserting the name-less-under-both-tool-names criterion.

**Library Dependencies:** None new.

---

## Requirements

Fulfills R6 (rendering half — the name-less passthrough behavioral half was already covered by 1a's own tests).

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] Name-only spawn fixture renders the teammate card, not `TaskToolWidget` (isTeammate true from `args.name`)
- [ ] Name-less dispatch rendering verified under both tool names (2a's `'Agent'` test + existing `'Task'` fixtures green)
- [ ] Existing teammate test suites green; all extensions land in existing runtime-side files; no `packages/electron/src/main/**` file touched

**All criteria must pass before task is complete.**

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/runtime/src/ui/AgentTranscript/components/__tests__/` (existing files, extended) | modify | Add name-only spawn rendering fixture; confirm existing `'Task'`-keyed fixtures pass |

### File Ownership Notes

No other task in this PRD touches this test directory. If a chip/notification test extension is warranted and its target file is outside `packages/electron/src/main/**`, it may also land here — otherwise defer per the guidance above.

---

## Implementation Guidance

### Patterns to Follow

Prefer extending PRD 004's existing regression test file over creating a new one (repo token-discipline guidance — the test corpus is large and every future session pays to read it).

### Code Style

Match existing test file conventions for fixture construction (however the existing `'Task'`-keyed fixtures build their `tool_use`/`tool_result` pair objects — mirror that shape exactly for the new name-only fixture, changing only `name`/`team_name` presence).

### Edge Cases

- A fixture with both `name` and `team_name` present (legacy shape) should still render the teammate card — this is pre-existing behavior from before this PRD; include it only if not already covered, as a sanity check that legacy-protocol rendering didn't regress.
- Do not conflate "isTeammate" (rendering discriminator) with "handled by TeammateManager's gate" (task 1a's interception decision) — they are two separate mechanisms that happen to key off the same `args.name` signal. Your fixtures test the renderer only.

### Testing Requirements

No new source files. All new coverage lands in existing test files under `packages/runtime/src/ui/AgentTranscript/components/__tests__/`. Do not touch `packages/electron/src/main/**` test files (explicit boundary per this task's scope).

---

## Boundaries

### Files You MUST NOT Touch

- `node_modules/**`, `dist/**`, `out/**`, `out2/**`, `release/**`, `.vite/**` (global `never_touch`)
- **`packages/electron/src/main/**` (task-specific boundary, per PRD decision D10/W3) — even though this is technically a `require_review` file per `.nimble/config.yaml` rather than an absolute block, this task's own scope explicitly excludes it. Do not edit any file under this path in this task, full stop.

### Files Requiring Review

- `package.json`, `package-lock.json`, `packages/electron/src/main/**`, `packages/runtime/src/auth/jwtScopes.ts`, `packages/electron/build/**`, `CHANGELOG.md` (global list). This task should not need to touch any of these.

---

## Dependencies

### Upstream Tasks

| Task | What It Provides | Verify Before Starting |
|------|------------------|------------------------|
| 1a | Synthetic tool-pair shape for name-only spawns (`'Task'` tool_use name, `args.name` present, `teammate_task` result) | Confirm 1a's success criteria are met, especially the synthetic-pair behavior described in its brief |
| 2a | `TaskToolWidget` registered for both `'Task'` and `'Agent'` keys | Confirm `AgentMode.tsx` registers both keys and 2a's live-shape test is green |

### Downstream Impact

Tasks that depend on this one: **3a** (live E2E — this task's fixture-level proof is the pre-flight confidence check before 3a exercises the same rendering paths manually in the running app).

**Before starting:** Confirm the PRD's post-Wave-2 human-review gate has cleared (check `.nimble/prds/005_agent-teams-cold-start-bootstrap/status.json`'s `gate.status` field). Verify 1a and 2a are both complete per their own success criteria.

---

## Deliverables

| Artifact | Path | Done when |
|---|---|---|
| Name-only spawn rendering regression coverage | `packages/runtime/src/ui/AgentTranscript/components/__tests__/` | New fixture green in existing test files; no renderer source change (or, if one was genuinely needed, it was routed to task 1a and is noted here rather than made directly) |

---

## GitHub Context

**Issue:** N/A — this PRD runs with `no_pull_requests: true` and `execution_mode: feature-branch`; work is tracked via `.nimble/prds/005_agent-teams-cold-start-bootstrap/status.json`, not GitHub Issues/PRs.
**Feature Issue (Parent):** N/A
**Branch:** `worktree/agent-teams-cold-start-bootstrap-2b`
**Target:** feature branch (base: `main`, per `status.json` execution_mode)

---

## Commit Guidelines

Use Conventional Commits, one-sentence subject:
```
test(agent-transcript): verify name-only spawn and name-less dispatch rendering discriminators
```
Do not add `Co-Authored-By` lines (repo rule).

---

## Validation Checklist

Before considering this task done:
- [ ] All success criteria met
- [ ] Build passes: `npm run build`
- [ ] Type check passes: `npm run typecheck`
- [ ] Test suite passes: `npm run test:prepush`
- [ ] No `never_touch` file modified
- [ ] No `packages/electron/src/main/**` file touched (task-specific boundary)
- [ ] Any discriminator failure found was routed back to task 1a, not patched here

---

*Generated by NIMBLE Brief Writer*
*PRD: agent-teams-cold-start-bootstrap | Task: 2b | Wave: 3*
