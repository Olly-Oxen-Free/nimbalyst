# Dependencies: Agent Visibility and Workflow Enhancement

**PRD Slug:** `agent-visibility`
**Created:** 2026-08-20
**Last Updated:** 2026-08-22

---

## Original Dependencies (from execution_plan.yaml)

| Task | Depends On | Rationale |
|------|------------|-----------|
| 1a | - | Adds `blocked` to `TeammateInfo.status`; no upstream dependency |
| 1b | - | Adds `blocked` to `TaskInfo.status`; no upstream dependency |
| 2a | 1a, 1b | Normalized status mapping needs both source enums finalized first |
| 3a | 1a | Notification wiring needs the `blocked`/error status signal from 1a |
| 2b | 2a | Chip row needs the normalized `SubAgentStatus` mapping to color chips |
| 3b | 3a | Reuses the exact notification pattern established in 3a |
| 2c | 2b | Click-to-thread extends the chip row component built in 2b |
| 2d | 2b, 2c | Status popover extends the chip row component built in 2b; also depends on 2c since both extend the same new `SubAgentChipRow.tsx` file — sequenced rather than parallelized |
| 4a | 1b | Fixes concurrent Task sub-agent stall masking (R11); file overlap with 1b on `ClaudeCodeProvider.ts` — sequenced to avoid conflict |
| 4b | 3a | Reuses the distinct-notification wiring 3a establishes; also file overlap with 3a on `TeammateManager.ts` — sequenced to avoid conflict |
| 4c | 3a | File overlap with 3a on `MessageStreamingHandler.ts` — sequenced to avoid conflict |
| 5a | 2c, 2d, 3b, 4a, 4b, 4c | CHANGELOG entry summarizes the complete feature; gate task, waits on all functional work (updated to also cover the amendment's stall-detection/wake-delivery fixes) |

---

## Runtime Dependencies Discovered

_Dependencies discovered by task agents during execution. The PM agent evaluates each entry and
updates the PM Action field._

<!-- DEPENDENCY_ENTRIES_START -->

_No runtime dependencies discovered yet — execution has not started._

<!-- DEPENDENCY_ENTRIES_END -->

---

## Known File Overlaps (flagged at planning time)

| Files | Tasks | Note |
| ----- | ----- | ---- |
| `packages/electron/src/renderer/components/AgentMode/TeammatePanel.tsx` | 1a, 2b, 2c | `TeammateInfo.status` is declared here, not in `agentMode.ts` (which only imports the type); 1a adds `blocked` here, 2b/2c extend it later. Sequential per the dependency chain (2b depends on 2a which depends on 1a; 2c depends on 2b) — no real conflict. |
| `packages/runtime/src/ai/server/providers/TeammateManager.ts` | 1a, 3a, 4b | Sequential by construction (3a depends on 1a; 4b depends on 3a — 4b adds a stall watchdog to the same spawn loop 3a's error-path notification wiring touches). |
| `packages/runtime/src/ai/server/providers/ClaudeCodeProvider.ts` | 1b, 4a | Sequential by construction (4a depends on 1b) — 1b touches the canUseTool routing (:3648/:3705-3760), 4a touches the post-result drain-grace timer (:1038-1052/:1197-1200), different sections of the same file. |
| `packages/electron/src/main/services/NotificationService.ts` | 3a, 3b | Sequential by construction (3b depends on 3a). |
| `packages/electron/src/main/services/ai/MessageStreamingHandler.ts` | 3a, 4c | Sequential by construction (4c depends on 3a) — 3a wires notification into `onTeammatesAllCompleted`, 4c adds the missing fallback notification to `onTeammateMessageWhileIdle` (window-not-found, window-destroyed, and handler-absent cases). |
| New chip-row component (`SubAgentChipRow.tsx`, exact path TBD) | 2b, 2c, 2d | 2c and 2d both extend this file; sequencing is now enforced structurally via `2d depends_on 2c` (2c in wave 4, 2d in wave 5) rather than left as prose-only PM guidance. |

---

*This file is maintained by NIMBLE task agents and the PM agent during execution.*
