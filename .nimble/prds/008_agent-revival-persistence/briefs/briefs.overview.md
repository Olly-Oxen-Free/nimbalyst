# Briefs Overview: agent-revival-persistence

Generated after task briefs 1a-3b are complete. **Task 4a (Task sub-agent context-seeded respawn)
is explicitly deferred/skipped per user decision and has no brief.** This PRD is teammate revival
only, in this execution.

## Task Summary

| Task | Title | Wave | Complexity | Model | Status |
|------|-------|------|------------|-------|--------|
| [1a](1a_agent-revival-persistence.md) | End-reason taxonomy on persisted teammate rows | 1 | 4 | sonnet | ready |
| [1b](1b_agent-revival-persistence.md) | Persist spawn cwd per teammate row | 2 | 2 | sonnet | ready |
| [2a](2a_agent-revival-persistence.md) | Widen the revival gate (invert PRD 003 terminality contract) | 3 | 4 | sonnet | ready |
| [2b](2b_agent-revival-persistence.md) | Revival-failure delivery without a live lead | 3 | 4 | sonnet | ready |
| [3a](3a_agent-revival-persistence.md) | Revive/compose UI for ended teammates | 4 | 3 | sonnet | ready |
| [3b](3b_agent-revival-persistence.md) | Restart-path revival end-to-end test | 4 | 2 | sonnet | ready |
| 4a | Phase 2: Task sub-agent context-seeded respawn | 5 | 3 | — | **skipped — no brief, out of scope for this execution** |

## Wave Breakdown

### Wave 1 (no dependencies)
- **1a** — `endReason`/`endedAt` taxonomy on persisted teammate rows; foundation for everything
  else.

### Wave 2 (depends on 1a; same file, sequenced)
- **1b** — Persist spawn `cwd` per teammate row; existence check with typed failure on revival.

### Wave 3 (depends on 1a+1b; both touch `TeammateManager.ts`, coordinator may serialize)
- **2a** — Widen the resume gate to admit eligible `completed`/`errored` rows within a hardcoded
  **24-hour** eligibility window (`endedAt`-based); openly invert the named PRD 003 regression
  test.
- **2b** — Revival-failure delivery (notification + persisted transcript line) when no lead turn
  is live to receive the failure.

### Wave 4 (depends on 2a; disjoint files, parallel)
- **3a** — Revive/compose UI in `TeammateTileRail.tsx`/`TeammateThreadPopover.tsx` (**not**
  `TeammatePanel.tsx` for the compose gate — see 3a's Context section for the file-list correction
  verified against live source). Should reflect the 24h window client-side so the UI does not
  offer an action the backend will silently refuse.
- **3b** — Scripted restart-path test proving `lead-abandoned` teammates resume after a simulated
  restart (seed row's `endedAt` must be within the 24h window).

## File Overlap Analysis

| File | Tasks | Potential Conflict |
|------|-------|--------------------|
| `packages/runtime/src/ai/server/providers/TeammateManager.ts` | 1a, 1b, 2a, 2b | Sequenced (1a→1b) then coordinator-serialized (2a/2b same wave) — high overlap, low conflict risk if landed in dependency order |
| `packages/runtime/src/ai/server/providers/__tests__/TeammateManager.test.ts` | 1a | Low |
| `packages/runtime/src/ai/server/providers/__tests__/TeammateManager.resumeReliability.test.ts` | 1b, 3b | Low — additive test cases in each |
| `packages/runtime/src/ai/server/providers/__tests__/TeammateManager.sendMessageFromHost.test.ts` | 2a | Low — one task, one named regression test rewritten |
| `packages/electron/src/renderer/components/AgentMode/TeammateTileRail.tsx` | 3a | Low |
| `packages/electron/src/renderer/components/AgentMode/TeammateThreadPopover.tsx` | 3a | Low |
| `packages/electron/src/renderer/components/AgentMode/TeammatePanel.tsx` | 3a | Low (ordering only) |
| `packages/electron/src/preload/index.ts` | 3a | Low |
| `packages/electron/src/main/services/ai/AIService.ts` | 3a | Low — `require_review` per config |
| `packages/electron/src/main/services/NotificationService.ts` | 2b | Low — `require_review` per config, likely no-op reuse |

## Cross-Cutting Notes

- **This repo never opens a GitHub PR.** All six briefs land via local merge only — no task in
  this PRD should attempt to create a PR.
- **No feature GitHub issue exists** for this PRD at brief-generation time. If one is created
  before execution, update each brief's "Feature Issue" field.
- **Decisions baked into these briefs as settled facts** (per the user's resolution of the PRD's
  own open questions, not left as open questions in the briefs):
  1. No `ai_sessions.metadata` retention policy exists; default conservatively (1a's `??`
     fallbacks).
  2. Eligibility window: **24 hours from `endedAt`, hardcoded**, implemented directly in 2a's
     eligibility function (named constant, not a magic number); not configurable in this PRD's
     scope.
  3. `user-shutdown` rows: confirm-gated, never silent (2a backend, 3a UI), still subject to the
     24h window.
  4. Worktree lifecycle: fail-clean-on-revive only (1b); no cleanup-blocking/warning behavior.
  5. Phase 2 (Task sub-agent respawn): skipped entirely.
  6. Cross-machine: this-machine-only, no explainer UI in this scope.

## Quick Links

- [PRD](../PRD_agent-revival-persistence.md)
- [Execution Plan](../execution_plan.yaml)
- [Tasks](../tasks.yaml)
- [Research: internal findings](../research/internal/findings.md)
- [Research: internal patterns](../research/internal/patterns.md)
- [Research: internal errors](../research/internal/errors.md)
- [Research: internal dependencies](../research/internal/dependencies.md)
- [Research: internal structure](../research/internal/structure.md)

---
*For full briefs, see `{task-id}_agent-revival-persistence.md` files.*
