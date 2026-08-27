# Briefs Overview: teammate-idle-handoff

Generated after all task briefs are complete. Provides quick navigation and context.

## Task Summary

| Task | Title | Wave | Complexity | Model | Status |
|------|-------|------|------------|-------|--------|
| [1a](1a_teammate-idle-handoff.md) | Continuation prompt: wait, don't duplicate teammate work | 1 | 2 | sonnet | ready |
| [1b](1b_teammate-idle-handoff.md) | Idle handoff: deliver the teammate's captured result to the lead | 1 | 5 | opus | ready |
| [1c](1c_teammate-idle-handoff.md) | Teammates panel row: show model | 1 | 1 | sonnet | ready |
| [2a](2a_teammate-idle-handoff.md) | Truthful abort status and tool-count continuity | 2 | 4 | sonnet | ready |
| [3a](3a_teammate-idle-handoff.md) | Tests for idle handoff, abort status, and continuation wording | 3 | 5 | opus | ready |

## Wave Breakdown

### Wave 1 (No dependencies)
- **1a** — Reword the continuation system message (`ClaudeCodeProvider.ts:2465`) so it stops
  inviting the lead to redo teammate work; extract to an exported constant.
- **1b** — Deliver a finished teammate's captured result (or idle notice) to the lead via
  `deliverMessageToLead`, gated per PRD Decision D7.
- **1c** — Show `model` alongside `agentType` on the Teammates panel row (visual-only).

### Wave 2 (Depends on Wave 1)
- **2a** — Split `killAll`'s status emission (`errored` for running, `completed` for idle); carry
  `toolCallCount`/`lastActiveAt` through the idle transition and resume. Depends on 1b (same file).

### Wave 3 (Depends on Wave 1 + Wave 2)
- **3a** — `TeammateManager.idleHandoff.test.ts`, greenfield coverage for 1a/1b/2a's behavior,
  red-first verified. Depends on 1a, 1b, 2a.

## File Overlap Analysis

| File | Tasks | Potential Conflict |
|------|-------|-------------------|
| `packages/runtime/src/ai/server/providers/TeammateManager.ts` | 1b, 2a, 3a (test-only) | Low — 1b and 2a sequenced (2a `depends_on: ["1b"]`); edits are in adjacent but distinct regions (idle-branch delivery vs. `killAll`/type/resume). |
| `packages/runtime/src/ai/server/providers/ClaudeCodeProvider.ts` | 1a, 3a (test-only, import only) | None — 1a is the sole editor. |
| `packages/electron/src/renderer/components/AgentMode/TeammatePanel.tsx` | 1c | None — sole editor, no other task touches this file. |
| `packages/runtime/src/ai/server/providers/__tests__/TeammateManager.test.ts` | 3a | None — 3a is the sole editor (optional extension for `killAll` coverage). |

## Quick Links

- [PRD](../PRD_teammate-idle-handoff.md)
- [Tasks](../tasks.yaml)
- [Research findings](../research/internal/findings.md)
- [Research summary](../research/summary.md)

---
*For full briefs, see `{task-id}_teammate-idle-handoff.md` files.*
