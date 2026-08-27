# Task Brief: 1a

**Title:** Continuation prompt: wait, don't duplicate teammate work
**PRD:** teammate-idle-handoff
**Priority:** must
**Complexity:** 2/10
**Model:** sonnet
**Wave:** 1
**Feature Issue:** TBD — assigned by PM agent at execution start

---

## Objective

Reword the continuation system message the lead sees when its turn ends with active teammates
still outstanding, so it stops inviting the lead to redo the teammates' own work. Extract the
message into an exported constant so task 3a can assert its content without a full provider
harness.

---

## Context

**Parent Feature:** Teammate Idle Handoff (PRD `teammate-idle-handoff`, GitHub feature issue TBD)

Nimbalyst's Agent Mode lets a lead agent spawn "teammates." When the lead's own turn ends while
teammates are still active, `handlePostLeadTurnTeammateState`
(`ClaudeCodeProvider.ts:2424-2474` region) injects a system message via
`emitTeammateMessageWhileIdle` to give the lead another turn ("a continuation"), up to
`MAX_CONTINUATIONS` (= 3, private static class field at `ClaudeCodeProvider.ts:268`) times. The
message currently injected at `ClaudeCodeProvider.ts:2465` reads verbatim:

```
[System: Your previous turn ended but you still have active agents. Wait for their results, or take other actions as needed.]
```

**Live-observed failure** (session c29787e7, teammate "weatherman", 2026-08-27): the lead read "or
take other actions as needed" as license to redo the teammate's own task itself — it re-ran the
same WebSearch/WebFetch query for Miami weather, once per continuation, three times, while the
teammate (haiku) was independently doing the same work and had, in fact, already produced a
correct answer that never reached the lead (that gap is task 1b's fix; this task fixes the prompt
that made the lead's *reaction* to the gap actively wasteful).

This task is part of **Wave 1** — independent of 1b and 1c, no dependencies.

---

## Research Context

Verified during research (target 8, `research/internal/findings.md` "T8"): there is **no hide
mechanism** for this message. It flows through `emitTeammateMessageWhileIdle` →
`teammate:messageWhileIdle` → `sendMessageHandler(mockEvent, data.message, ...)` as a genuine new
prompt to the model, indistinguishable from a user message at that layer. `hideMessages`/
`markMessagesAsHidden` (used for `/context` auto-fetch bookkeeping) is never threaded through this
path. **Wording-only is the correct fix shape — do not attempt to hide, suppress, or debounce
this message.** Rely on this finding; do not re-derive it.

---

## Requirements

Fulfills PRD requirement **R3**: *"The `ClaudeCodeProvider.ts:2465` message instructs the lead to
wait for teammate results, explicitly forbids performing or duplicating the teammates' assigned
work itself, and permits messaging/stopping/shutting down teammates. Wording-only — the message
remains a visible injected prompt (no hide mechanism exists, verified)."*

1. **New wording must, at minimum:**
   - Instruct the lead to WAIT for its teammates' results.
   - Explicitly forbid performing or duplicating the work the teammates are already doing.
   - Still permit teammate management actions (`SendMessage` to a teammate, stopping or shutting
     one down) and answering the user directly if it can already do so without the teammates'
     results.
   - Keep the `'[System: ...]'` framing (this is the existing convention for injected system
     messages on this path — do not switch to a different framing).
2. **Extract the string to an exported constant**, e.g. `TEAMMATE_CONTINUATION_MESSAGE`, declared
   at module scope, physically near `MAX_CONTINUATIONS` for discoverability — since
   `MAX_CONTINUATIONS` itself is a `private static` class field (`:268`, inside the class body and
   therefore not importable), place the new constant at the top level of the file, just before
   `export class ClaudeCodeProvider extends BaseAgentProvider {` (`:209`), with a short comment
   noting it is the sibling of `MAX_CONTINUATIONS` below. Reference the constant at the call site
   (`:2465`) instead of the inline string literal. This mirrors PRD 003's task 1a precedent for
   model-facing-string test scaffolding (see that PRD's brief `1a_teammate-resume-reliability.md`
   for the shape of a wording-only extraction task, if useful).
3. **Do not change anything else in `handlePostLeadTurnTeammateState`** — not the
   `continuationCount` increment/reset logic, not the `abandonIdleTeammates` call, not the
   `hasOnlyBackgroundAgents`/`hasPendingTeammateMessages` branches above it. This task touches
   exactly one string and its extraction.

### Explicit anti-goals (do not implement)

- Do not touch `abandonIdleTeammates` calls or count logic — that is unrelated to prompt wording.
- Do not touch anything in `TeammateManager.ts` — that is task 1b's territory, a different file.
- Do not attempt to hide/suppress the injected message (see Research Context — no hide mechanism
  exists; this is confirmed, not something to investigate further).

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] The continuation message no longer contains open-ended "take other actions" language; it
      instructs waiting and explicitly forbids duplicating the teammates' assigned work, while
      permitting teammate management and user-facing replies
- [ ] Message text lives in an exported constant used by `handlePostLeadTurnTeammateState`; no
      other behavior of the continuation branch changes (count, reset, abandon call sites
      untouched)

**All criteria must pass before task is complete.**

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/runtime/src/ai/server/providers/ClaudeCodeProvider.ts` | modify | Extract the continuation message to an exported constant near `MAX_CONTINUATIONS`; reword it per Requirements item 1; update the single call site at `:2465` to use the constant |

### File Ownership Notes

No other task in this PRD touches `ClaudeCodeProvider.ts`. 3a (test task) imports this task's
exported constant but does not edit this file.

---

## Implementation Guidance

### Patterns to Follow

- Keep the `'[System: ...]'` framing exactly as used today — it's the established convention for
  this injection path (compare the sibling injected messages nearby, e.g. the pending-message-batch
  delivery at `:2456` uses a different, content-derived message; this one is a fixed string).
- Module-level `export const` placed just above the class declaration is the pattern to use since
  `MAX_CONTINUATIONS` itself cannot be exported (private class field) — do not attempt to make
  `MAX_CONTINUATIONS` itself public/exported; that is out of scope.

### Code Style

Plain string constant, template-literal-free (no interpolation needed — this message names no
teammate). Match the existing single-quote / no-semicolon-drift style of the surrounding file.

### Edge Cases

None — this is a narrow, mechanical wording change to one call site.

### Testing Requirements

No test file exists for `ClaudeCodeProvider.ts` continuation wording today (confirmed by research
T7 — zero existing coverage of `MAX_CONTINUATIONS`/`handlePostLeadTurnTeammateState`). This task
does not require writing a test — task 3a (dedicated test task, `depends_on: ["1a", "1b", "2a"]`)
imports this task's exported constant and asserts its content contains the wait/no-duplication
instruction and no open-ended "other actions" invitation.

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
- Do not touch `TeammateManager.ts` — task 1b's territory, different file.
- Do not touch continuation-count logic, `abandonIdleTeammates` calls, or anything in the
  teammate idle branch inside `ClaudeCodeProvider.ts` itself beyond the single string/constant
  extraction.
- Do not touch the Task-subagent system (`activeTasks` in `ClaudeCodeProvider.ts`, PRD 004's
  tile/popover UI) — this PRD is TEAMMATE-lifecycle only.

### Files Requiring Review

`ClaudeCodeProvider.ts` is under `packages/runtime/**`, not `packages/electron/src/main/**` — it
is not in `.nimble/config.yaml`'s `require_review` list. This task does not trigger the PRD's
human-review gate on its own.

---

## Dependencies

### Upstream Tasks

None — `depends_on: []`, Wave 1.

### Downstream Impact

| Task | What it needs from 1a | Why |
|------|------------------------|-----|
| 3a | The exported `TEAMMATE_CONTINUATION_MESSAGE` constant | 3a's continuation-wording test imports and asserts on this constant's content directly, without constructing a full provider harness. |

**Before starting:** No upstream dependency to verify — this task starts from the current state of
`main`/the feature branch.

---

## GitHub Context

**Issue:** TBD — created by PM agent at execution start
**Feature Issue (Parent):** TBD — created by PM agent at execution start
**Branch:** `worktree/teammate-idle-handoff-1a`
**Target:** Determined by PM agent based on execution mode (feature branch or main)

---

## Commit Guidelines

Use Conventional Commits:
```
fix(teammates): stop inviting the lead to duplicate in-flight teammate work
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
*PRD: teammate-idle-handoff | Task: 1a | Wave: 1*
