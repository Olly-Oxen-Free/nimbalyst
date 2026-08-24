# Task Brief: 2a

**Title:** Build normalized `SubAgentStatus` mapping
**PRD:** agent-visibility
**Priority:** must
**Complexity:** 4/10
**Model:** sonnet
**Wave:** 3
**Feature Issue:** TBD — assigned by PM agent during Phase 2 issue creation (no GitHub issue number was present in PRD metadata at brief-generation time; `github_project` is unset in `PRD_agent-visibility.md`)

---

## Objective

Create a single, exhaustive display-layer mapping that normalizes the two independent status
vocabularies used by Nimbalyst's in-conversation sub-agents — `TeammateInfo.status` and
`TaskInfo.status` — into one shared five-value status (`working / waiting / blocked / complete /
error`). This mapping is the data layer the horizontal chip row (task 2b, wave 4) will use to
color every teammate/Task-sub-agent chip consistently, regardless of which of the two underlying
systems produced the status.

---

## Context

**Parent Feature:** Agent Visibility and Workflow Enhancement (PRD `agent-visibility`,
`.nimble/prds/001_agent-visibility/PRD_agent-visibility.md`)

Nimbalyst has three separate "spawned agent" systems, each with its own status vocabulary: SDK-native
Task sub-agents (`TaskInfo.status`), Nimbalyst Teammates (`TeammateInfo.status`), and Meta-Agent Mode
child sessions (its own `getStatusTone`/`getBarTone` enum). This PRD closes a tracker-item gap
(`tsk_mt1xxymgata1sw`) comparing Nimbalyst's sub-agent visibility against native Claude Code's UX:
today, none of Teammates/Task sub-agents shows in a chip row above the chat input, none has a
`blocked` state, and a crashed sub-agent produces the same notification (none) as a clean finish.

This task is the **data-normalization step** in that effort. Two upstream tasks (1b, wave 1; 1a,
wave 2) each add a new `blocked` value to one of the two source status enums. This task does not add any
new status value itself — it builds the mapping *from* those (now five-valued) enums *to* the
shared five-value `SubAgentStatus` the chip row will render. The PRD explicitly scopes this
normalization to Teammates + Task sub-agents only; Meta-Agent Mode's independent status enum is out
of scope and must not be touched or folded in (§3 Non-Goals, §12 Assumption 2 of the PRD).

This task is part of **Wave 3** — the status-foundation wave that converges the `blocked`
additions from 1b (wave 1: Task sub-agents) and 1a (wave 2: Teammates) into one normalized
mapping. Wave 3 runs 2a in parallel with 3a (notification wiring off 1a) — none of those siblings
touches the same files as 2a. (4a, the stall-masking fix off 1b, now runs earlier, in wave 2, per
the Phase-2 brief review correction that serialized 1a after 1b.) Wave 4 (task 2b, the chip row
itself) depends directly on this task's output.

---

## Precondition — Upstream Tasks May Not Have Executed Yet

Tasks 1a and 1b are being drafted/executed in parallel with this brief and **may not be complete
when you start**. Do not treat their absence as a reason to invent your own `blocked` value or
skip verification — confirm they have landed before writing the mapping, per the Dependencies
section below.

**Assumed precondition (what 1a and 1b are expected to produce):**

- **Task 1a** adds `'blocked'` to `TeammateInfo.status` in
  `packages/electron/src/renderer/components/AgentMode/TeammatePanel.tsx` (currently declared at
  line 30 as `'running' | 'completed' | 'errored' | 'idle'`). After 1a lands, the type is expected
  to read `'running' | 'completed' | 'errored' | 'idle' | 'blocked'`. The status is set when a
  teammate's permission/prompt request becomes pending (via `TeammateManager.ts:1465`'s
  `createCanUseToolHandler` routing) and cleared on resolution.
- **Task 1b** adds `'blocked'` to `TaskInfo.status` in
  `packages/electron/src/renderer/store/atoms/agentMode.ts` (currently declared at line 233 as
  `'running' | 'completed' | 'failed' | 'stopped'`). After 1b lands, the type is expected to read
  `'running' | 'completed' | 'failed' | 'stopped' | 'blocked'`, attributed to the specific Task
  sub-agent whose permission request is pending (via `ClaudeCodeProvider.ts:3648-3760`'s shared
  `canUseTool` routing, keyed per-task rather than as a single global flag).

If, when you start, either type still shows only its original four values, **stop and verify with
the orchestrator/PM that 1a/1b have actually completed** before writing the mapping — do not guess
at the final shape of either enum.

---

## Requirements

Fulfills **R3** from the PRD:

> New normalized `SubAgentStatus` mapping (derived-atom pattern, not a new raw enum stored on
> either type) that maps every `TeammateInfo.status` and `TaskInfo.status` value — including
> `blocked` — to one of: working / waiting / blocked / complete / error. Follows the reusable
> pattern in `groupSessionStatusAtom` (`sessions.ts:1052`).
>
> **Acceptance:** Mapping is exhaustive (compiler/test enforced — no silent fallthrough); unit test
> asserts every current status value maps correctly.

Concretely:

1. Define a `SubAgentStatus` union type with exactly five values: `'working' | 'waiting' |
   'blocked' | 'complete' | 'error'`.
2. Write a mapping function (or two — one per source type, or one overloaded/generic function) that
   maps every value of the post-1a `TeammateInfo['status']` and every value of the post-1b
   `TaskInfo['status']` to a `SubAgentStatus`.
3. The mapping must be **display-only** — do not persist `SubAgentStatus` on `TeammateInfo` or
   `TaskInfo`; it is computed on read, matching the derived-atom pattern already used for
   `groupSessionStatusAtom`.
4. Enforce exhaustiveness so that a future new status value added to either source enum without
   updating this mapping is a **compile error**, not a silent runtime fallthrough. Use a TypeScript
   exhaustiveness check (a `switch` with a `default: assertNever(status)` branch, or equivalent) —
   do not use an untyped `if/else` chain with a fallback default that could silently swallow an
   unmapped value.
5. Expose the mapping as a Jotai derived atom (or atom family, scoped per session/per sub-agent as
   appropriate) so task 2b's chip row can consume it reactively, following the derived-atom pattern
   at `sessions.ts:1052` (`groupSessionStatusAtom`) — reuse the **pattern**, not the atom itself
   (that one is session-level; this one is sub-agent-level).

**Mapping judgment call — surface it, don't hide it:** the PRD specifies the five target values but
not the exact source→target table. The most direct reading of each source status is:

| Source | Value | Suggested `SubAgentStatus` |
| --- | --- | --- |
| `TeammateInfo.status` | `running` | `working` |
| `TeammateInfo.status` | `idle` | `waiting` |
| `TeammateInfo.status` | `blocked` | `blocked` |
| `TeammateInfo.status` | `completed` | `complete` |
| `TeammateInfo.status` | `errored` | `error` |
| `TaskInfo.status` | `running` | `working` |
| `TaskInfo.status` | `stopped` | `waiting` (see note) |
| `TaskInfo.status` | `blocked` | `blocked` |
| `TaskInfo.status` | `completed` | `complete` |
| `TaskInfo.status` | `failed` | `error` |

**Note on `TaskInfo.status: 'stopped'`:** this is a judgment call, not something the PRD or research
findings pin down. `'stopped'` could plausibly mean "user-stopped, no longer relevant" (closer to a
terminal/waiting state) or could be treated as an error-adjacent terminal state. The suggestion
above (`waiting`) is a reasonable default; if you find evidence in `ClaudeCodeProvider.ts` of how
`'stopped'` is actually set (voluntary stop vs. abnormal stop), let that evidence decide instead of
the table above, and document which you chose and why in the PR description.

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] Mapping function/atom covers every current `TeammateInfo.status` value including `blocked`
- [ ] Mapping function/atom covers every current `TaskInfo.status` value including `blocked`
- [ ] Mapping is exhaustive — no silent fallthrough on an unmapped status (TypeScript exhaustiveness
      check or equivalent test)
- [ ] Unit test asserts each source status maps to the expected normalized `SubAgentStatus` value

**All criteria must pass before task is complete.**

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/electron/src/renderer/store/atoms/subAgentStatus.ts` | create | New module: `SubAgentStatus` type, the source→target mapping function(s) for `TeammateInfo['status']` and `TaskInfo['status']`, and a derived Jotai atom/atom-family exposing normalized status per sub-agent (and/or per session, whichever shape best serves task 2b — your call, document it). |
| `packages/electron/src/renderer/store/atoms/agentMode.ts` | modify | Minimal wiring only: import/export as needed so `subAgentStatus.ts` can reference `TaskInfo` (already exported here) without a circular import, and so `subAgentStatus.ts`'s exports are easily discoverable from this file if that helps task 2b. Do not restructure existing atoms in this file — this task only adds the new normalization layer, it does not change `sessionTeammatesAtom`/`sessionTasksAtom` themselves. |

The exact file name `subAgentStatus.ts` is a naming choice — the PRD leaves it open ("Exact new-file
path is a naming choice for the implementing agent/brief-writer; keep it near `agentMode.ts` for
discoverability"). Keep it in the same `store/atoms/` directory either way, since task 2b will need
to import from wherever you place it.

### File Ownership Notes

`agentMode.ts` is also touched by tasks 1a (wave 2) and 1b (wave 1, both upstream of this task) and,
later, indirectly informs task 2b (wave 4). Because 2a `depends_on: [1a, 1b]`, both of their edits
to `agentMode.ts` (1b adds `blocked` to the `TaskInfo` interface at line 233; 1a's `agentMode.ts`
edit is more minor since `TeammateInfo` is declared in `TeammatePanel.tsx`, not here) should already
be present by the time you start — this is sequential by construction, not a live conflict. Do not
rebase/merge speculatively; verify the current state of `TaskInfo.status` in `agentMode.ts` matches
the precondition described above before writing the mapping.

No other in-flight task in this PRD touches `subAgentStatus.ts` (it is new) or edits `agentMode.ts`
concurrently with this task.

---

## Deliverables

| Artifact | Path | Done when |
|---|---|---|
| `SubAgentStatus` normalization module | `packages/electron/src/renderer/store/atoms/subAgentStatus.ts` | Exports the `SubAgentStatus` type, an exhaustive source→target mapping function for both `TeammateInfo['status']` and `TaskInfo['status']`, and a derived atom/atom-family exposing the normalized value — importable by task 2b without further changes. |
| Unit test for the mapping | colocated test file (e.g. `subAgentStatus.test.ts`) next to the new module | Asserts all 10 source-status→target-status pairs (5 Teammate values + 5 Task values, including `blocked`) and exercises the derived atom's read path, not just the pure mapping function. |

None beyond the files above — per the task's `deliverables_note` in `tasks.yaml` ("Nothing beyond
the code — new module plus its unit test are the only artifacts"), this task produces no
documentation, fixture, or config deliverable outside the module and its test.

---

## Implementation Guidance

### Patterns to Follow

- **`groupSessionStatusAtom`** (`packages/electron/src/renderer/store/atoms/sessions.ts:1052`) is
  the PRD's explicitly cited reference pattern for a derived, multi-source status aggregation atom.
  Read it before writing this module. Reuse the *shape* of the pattern (a derived atom that reads
  several underlying per-entity atoms and folds them into one summary value) — do not reuse or
  extend that atom itself; it operates over whole sessions, this task operates over individual
  sub-agents within one session.
- **`atomFamily` import convention:** this codebase wraps `jotai-family`'s `atomFamily` with a debug
  registry — always `import { atomFamily } from '../debug/atomFamilyRegistry'`, never
  `from 'jotai/utils'` or `from 'jotai-family'` directly. See the existing import in
  `agentMode.ts:20` for the exact form. If your mapping atom needs to be keyed per sub-agent (or per
  session), use this wrapped `atomFamily`.
- **Existing sub-agent data sources** (do not duplicate, only consume): `sessionTeammatesAtom` and
  `sessionTasksAtom`, both in `agentMode.ts:220-250`, each an `atomFamily` keyed by `sessionId` that
  derives `TeammateInfo[]` / `TaskInfo[]` from `session.metadata.currentTeammates` /
  `currentTasks`. Your new atom(s) should read from these, not re-derive from `sessionStoreAtom`
  directly.

### Code Style

- TypeScript strict mode is assumed project-wide; use a real exhaustiveness guard (e.g. a
  `never`-typed `assertNever` helper in the `default` branch of a `switch`) rather than an
  `if/else` chain that silently falls through on an unrecognized value — this is a named success
  criterion, not a style nicety.
- No new raw string status constants scattered across files — define `SubAgentStatus` once, in the
  new module, and export it for task 2b to import.

### Edge Cases

- A sub-agent's underlying status list (`TeammateInfo[]` / `TaskInfo[]`) can be empty (no active
  sub-agents for a session) — the mapping function itself only needs to handle a single status value
  at a time; emptiness is the chip row's (task 2b's) concern, not this task's.
- Do not assume the two source enums stay in sync in size or naming going forward — the
  exhaustiveness check exists specifically so a *future* new value (e.g. if Task sub-agents someday
  add a `'paused'` state) fails to compile here rather than silently mapping to the wrong color in
  the chip row.

### Testing Requirements

- Colocate a unit test (e.g. `subAgentStatus.test.ts` next to the new module) that asserts, for
  every one of the five `TeammateInfo.status` values and every one of the five `TaskInfo.status`
  values (10 total, assuming 1a/1b landed as expected), the mapping function returns the correct
  `SubAgentStatus`.
- If you expose a derived atom, add at least one test exercising it end-to-end (seed a fake session
  with a teammate/task in a given raw status, read the derived atom, assert the normalized value) —
  not just the pure mapping function in isolation, since a bug in the atom's read-path (e.g. wrong
  atom-family key, stale `get()`) would not be caught by a pure-function test alone.
- Add `// @vitest-environment node` as the first line of this test file — it does not touch the DOM.
- This is a small, focused, standalone module: prefer a new dedicated test file over folding these
  assertions into an unrelated existing test file, since `subAgentStatus.ts` itself is new.

---

## Boundaries

### Files You MUST NOT Touch

Global `never_touch` list (`.nimble/config.yaml`):

- `package-lock.json`, `packages/browser-extension/package-lock.json`
- `.env*`
- `.github/workflows/*`
- `packages/electron/src/database/migrations/*`
- `packages/electron/src/main/database/sqlite/schemas/*`
- `node_modules/`, `**/dist/`, `packages/electron/out/`
- `nimbalyst-local/`
- `.beads/`

None of these overlap this task's files.

Additionally, per the PRD's task-specific boundaries (§11 Agent Boundaries): do **not** fold
Meta-Agent Mode's independent `getStatusTone`/`getBarTone` status-color mapping
(`packages/electron/src/renderer/components/MetaAgentMode/MetaAgentMode.tsx:67-104`) into
`SubAgentStatus` — this is an explicit PRD non-goal, not an oversight to fix.

### Files Requiring Review

None of this task's files (`subAgentStatus.ts`, `agentMode.ts`) are in `.nimble/config.yaml`'s
`require_review` list (`packages/runtime/src/auth/*`, `packages/electron/src/main/database/*`,
`packages/electron/src/main/index.ts`, `packages/electron/src/main/bootstrap.ts`,
`packages/electron/src/main/utils/protocolRegistration.ts`, `CHANGELOG.md`,
`packages/collab-protocol/*`, `packages/collab-client/*`, `packages/collab-bundle/*`,
`packages/collab-adapters/*`). No review gate is triggered by this task on its own — the PRD's only
review gate is after wave 6, triggered by task 5a's `CHANGELOG.md` edit.

---

## Dependencies

### Upstream Tasks

| Task | What It Provides | Verify Before Starting |
|------|------------------|------------------------|
| 1a | `blocked` added to `TeammateInfo.status` in `TeammatePanel.tsx:30`, wired to permission-pending/resolved transitions via `TeammateManager.ts:1465` | Open `TeammatePanel.tsx`, confirm the `TeammateInfo.status` union now includes `'blocked'` alongside `'running' \| 'completed' \| 'errored' \| 'idle'` |
| 1b | `blocked` added to `TaskInfo.status` in `agentMode.ts:233`, attributed per-Task via `ClaudeCodeProvider.ts` `canUseTool` routing | Open `agentMode.ts`, confirm the `TaskInfo.status` union now includes `'blocked'` alongside `'running' \| 'completed' \| 'failed' \| 'stopped'` |

**If either type still shows only its original four values when you start:** these briefs (1a, 1b)
were being drafted/executed in parallel with this one and may not have landed yet. Stop and confirm
their actual completion status with the orchestrator/PM before writing the mapping — do not infer
the final shape of either enum from this brief's "assumed precondition" section alone, since that
section is a best-effort description written before 1a/1b executed, not a guarantee of their final
diff.

### Downstream Impact

Tasks that depend on this one (directly or transitively): **2b** (wave 4, chip row — consumes this
mapping to color chips), and transitively **2c** (wave 5, click-to-thread, depends on 2b), **2d**
(wave 6, Task sub-agent popover, depends on 2b/2c), and **5a** (wave 7, CHANGELOG/gate task, depends
on the whole chain). A bug or incomplete coverage in this task's mapping propagates directly into
every chip's displayed color in the finished feature.

**Before starting:** verify both upstream preconditions above. **Before finishing:** make sure the
mapping and atom you export are named/shaped in a way that's easy for task 2b to consume directly
(a plain exported function plus a derived atom is likely sufficient — avoid over-engineering a
generic "status registry" beyond what R3 asks for).

---

## GitHub Context

**Issue:** TBD — assigned by PM agent during Phase 2 issue creation
**Feature Issue (Parent):** TBD — assigned by PM agent during Phase 2 issue creation
**Branch:** `worktree/agent-visibility-2a`
**Target:** Determined by PM agent based on execution mode (feature branch or main)

---

## Commit Guidelines

Conventional Commits, one-sentence subject, per this repo's root `CLAUDE.md`:
```
feat(agent-visibility): add normalized SubAgentStatus mapping for teammates/tasks
```

Types: feat, fix, refactor, test, docs, chore. Do **not** add a `Co-Authored-By` trailer — this
repo's `CLAUDE.md` explicitly forbids it, overriding NIMBLE's generic default.

---

## Validation Checklist

Before creating PR:
- [ ] All success criteria met
- [ ] Build passes: `npm run build`
- [ ] Type check passes: `npm run typecheck`
- [ ] No `never_touch` files modified
- [ ] Unit test added covering all 10 source-status→target-status mappings (assuming 1a/1b landed
      as expected) plus the derived-atom read path
- [ ] Branch rebased on target branch (feature branch or main)
- [ ] `npm run typecheck && npm run test:prepush` is green before pushing (this repo's pre-push
      gate — see root `CLAUDE.md`)

---

*Generated by NIMBLE Brief Writer*
*PRD: agent-visibility | Task: 2a | Wave: 3*
