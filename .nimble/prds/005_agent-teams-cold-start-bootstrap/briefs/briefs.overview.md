# Briefs Overview: agent-teams-cold-start-bootstrap

Generated after all task briefs are complete. Provides quick navigation and context.

## Task Summary

| Task | Title | Wave | Complexity | Model | Status |
|------|-------|------|------------|-------|--------|
| [1a](1a_agent-teams-cold-start-bootstrap.md) | Adapt the teammate spawn gate to the implicit-team protocol | 1 | 7 | opus | ready |
| [1b](1b_agent-teams-cold-start-bootstrap.md) | Resume/rehydration with synthesized teams; mark legacy explicit-team surface | 2 | 4 | sonnet | ready |
| [2a](2a_agent-teams-cold-start-bootstrap.md) | Recognize 'Agent' alongside 'Task' in electron tool-name-keyed surfaces | 2 | 3 | sonnet | ready |
| [2b](2b_agent-teams-cold-start-bootstrap.md) | Rendering and downstream regression verification for name-only spawns | 3 | 3 | sonnet | ready |
| [3a](3a_agent-teams-cold-start-bootstrap.md) | Live cold-start end-to-end verification | 4 | 3 | sonnet | ready |

## Wave Breakdown

### Wave 1 (No dependencies)
- **1a** — Core fix: implicit-team spawn gate (`Task`/`Agent` recognition, drop `team_name` requirement), team-teams-enablement flag plumbing, corrected team-resolution/synthesis order, red-first regression test.

### Wave 2 (Depends on 1a)
- **1b** — Resume round-trip proof for synthesized team names; legacy-marks the deprecated explicit-team env/tool-result surfaces (no behavior change).
- **2a** — Registers `TaskToolWidget` for the `'Agent'` key (fixing an independently-discovered dead-in-production bug); audits `packages/electron/src` for other `'Task'`-only hardcodes.

**GATE after Wave 2:** human review of 1a's gate/resolution diff (the single most behavior-changing edit in the PRD) plus any `packages/electron/src/main/**` touch from 2a's audit, before the verification waves (3, 4) invest against the landed shape.

### Wave 3 (Depends on 1a, 2a)
- **2b** — Pure verification: name-only spawns render the teammate card (not `TaskToolWidget`); name-less dispatches render `TaskToolWidget` under both tool names. Barred from touching `packages/electron/src/main/**`.

### Wave 4 (Depends on 1b, 2a, 2b)
- **3a** — Live cold-start E2E in the running dev app: the exact scenario that exposed the bug. Records evidence in `status.json`; closes the PRD.

## File Overlap Analysis

| File | Tasks | Potential Conflict |
|------|-------|-------------------|
| `packages/runtime/src/ai/server/providers/TeammateManager.ts` | 1a, 1b | None — serialized via `depends_on` (1b strictly after 1a), never same-wave |
| `packages/runtime/src/ai/server/providers/claudeCode/sdkOptionsBuilder.ts` | 1b | None — 1b only |
| `packages/electron/src/renderer/components/AgentMode/AgentMode.tsx` | 2a | None — 2a only |
| `packages/electron/src/main/services/ClaudeSettingsManager.ts` | 2a | None — 2a only (optional, no-op, may be skipped in favor of documentation) |
| Runtime renderer test files (`packages/runtime/src/ui/AgentTranscript/components/__tests__/`) | 2b | None — 2b only; no source change expected |
| `.nimble/prds/005_agent-teams-cold-start-bootstrap/status.json` | 3a | None — evidence only |

## Quick Links

- [PRD](../PRD_agent-teams-cold-start-bootstrap.md)
- [Execution Plan](../execution_plan.yaml)
- [Tasks](../tasks.yaml)
- [Research Summary](../research/summary.md)

---
*For full briefs, see `{task-id}_agent-teams-cold-start-bootstrap.md` files.*
