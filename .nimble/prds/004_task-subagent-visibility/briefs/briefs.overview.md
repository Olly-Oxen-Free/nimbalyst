# Briefs Overview: task-subagent-visibility

Generated after all task briefs are complete. Provides quick navigation and context.

## Task Summary

| Task | Title | Wave | Complexity | Model | Status |
|------|-------|------|------------|-------|--------|
| [1a](1a_task-subagent-visibility.md) | Make Task sub-agent text retrievable and correctly correlated | 1 | 7 | opus | ready |
| [1b](1b_task-subagent-visibility.md) | IPC fetch handler + projection for a task's transcript | 2 | 4 | sonnet | ready |
| [1c](1c_task-subagent-visibility.md) | Live-update signal for task transcripts | 3 | 5 | opus | ready |
| [2a](2a_task-subagent-visibility.md) | Hover popover for a Task chip (inline + sidebar) | 4 | 5 | opus | ready |
| [2b](2b_task-subagent-visibility.md) | Inline expand via the custom tool-widget registry | 4 | 6 | opus | ready |
| [2c](2c_task-subagent-visibility.md) | Tiling pane for Task sub-agent transcripts | 5 | 9 | opus | ready |

## Wave Breakdown

### Wave 1 (No dependencies)
- **1a** — Resolve the Option A/new-write vs. Option B/project-existing-rows fork; correlate
  Task sub-agent text to its owning `activeTasks` entry via `parentToolUseId` ↔
  `activeTasks[*].toolUseId`, not `subagentToolCallOwners`.

### Wave 2 (Depends on Wave 1)
- **1b** — `ai:getTaskSubagentTranscript` IPC handler + `projectTaskSubagentRawMessages`,
  keyable by either `taskId` or `toolUseId`.

### Wave 3 (Depends on Wave 2 — GATE follows this wave)
- **1c** — `task:transcriptUpdated` → `task:transcript-updated` live-signal channel,
  mirroring the teammate chain, keyed by `taskId`.

**Gate after wave 3:** `require_review` auto-triggers (`MessageStreamingHandler.ts` and
`AIService.ts` are both under `packages/electron/src/main/**`). Explicit human-verify
checkpoint before the wave 4-5 UI investment begins — this PRD's deliberate fix for a gap
PRD 002's own retrospective flagged (its equivalent gate stayed `PENDING` through merge).

### Wave 4 (Depends on 1b + 1c; both file-disjoint, run together)
- **2a** — Hover popover (`TaskThreadPopover.tsx`), retires the click-triggered
  `TaskStatusPopover`.
- **2b** — Inline expand via `setTranscriptToolWidgets`, with the narrow
  `!(isSubAgent && isTeammate)` exclusion in `RichTranscriptView.tsx` so teammate-spawn
  messages are unaffected.

### Wave 5 (Depends on 1b, 1c, and sequenced after 2a for file-overlap safety)
- **2c** — Purpose-built tiling pane; claims the `onTaskClick` callback 2a left unconsumed.

## File Overlap Analysis

| File | Tasks | Potential Conflict |
|------|-------|-------------------|
| `ClaudeCodeProvider.ts` / `ClaudeCodeTranscriptAdapter.ts` | 1a | None — 1a only |
| `AIService.ts` / `projectRawMessages.ts` | 1b | None — 1b only |
| `preload/index.ts` / `renderer/electron.d.ts` | 1b, 1c | Serialized via `depends_on` |
| `MessageStreamingHandler.ts` / `taskTranscriptListeners.ts` | 1c | None — 1c only |
| `AgentMode.tsx` | 1c, 2b | Disjoint additions (listener init vs. widget registration), already ordered by 2b `depends_on` 1c |
| `store/atoms/agentMode.ts` | 1c, 2c | Disjoint additions (`taskTranscriptSignalAtomFamily` vs. `openTaskTilesAtom`), already ordered by 2c `depends_on` 1c |
| `SubAgentChipRow.tsx`, `TeammatePanel.tsx` | 2a, 2c | Real overlap (hover vs. click handler) — resolved by sequencing (2c `depends_on` 2a), not parallelized |
| `RichTranscriptView.tsx` | 2b | None — narrow, isolated one-line-guard addition |
| `TaskToolWidget.tsx` (new) | 2b | None |
| `SessionTranscript.tsx` | 2c | None — fresh host introduced in wave 5 |

## Verified-Against-Live-Source Notes

Every file:line citation carried into these briefs was re-verified against the live
repository during brief generation (not trusted from the PRD text alone). All citations
checked out accurately, including two that were worth double-checking closely:

- **PRD §6 Q6's `RichTranscriptView.tsx:1755-1764` framing** ("move the resolution to
  AFTER isSubAgent/isTeammate are computed") is technically imprecise but the PRD's own
  parenthetical already corrects it ("they already are, lines 1755-1757") — live code
  confirms `isSubAgent`/`isTeammate` are computed at 1755-1757, *before* the `CustomWidget`
  resolution at 1763-1764. Nothing needs to physically move; the actual required change is
  narrower than the sentence implies — adding a guard condition to the existing
  `if (CustomWidget)` check. Brief 2b calls this out explicitly so the implementer doesn't
  over-scope the change.
- **`docs/CUSTOM_TOOL_WIDGETS.md` is partially stale** relative to this feature's actual
  registration mechanism — it documents the older static `CUSTOM_TOOL_WIDGETS` map, not the
  dynamic `setTranscriptToolWidgets` contribution registry Q6's correction requires. Brief
  2b flags this explicitly so the implementer doesn't follow the doc's registration step
  literally. Confirmed live that `getCustomToolWidget` (the function `RichTranscriptView.tsx`
  actually calls) consults the dynamic registry first, so `setTranscriptToolWidgets` is
  still the correct mechanism — the doc is stale, the PRD's citation is not.

No other citation drift was found. All line numbers for `ClaudeCodeProvider.ts` (activeTasks
map at 300-323, raw persistence at 1301-1318, `handleSystemTask` at 2892-2974,
`markTaskBlockedForToolUse` at 3890-3902, `subagentToolCallOwners` at 329/1450/1462),
`ClaudeCodeTranscriptAdapter.ts` (drop guard at 233, `parentToolUseId` extraction at 222),
`TeammateManager.ts` (Task-tool team-spawn match at 2209, `logNonBlocking` call sites),
`SubAgentChipRow.tsx` (`TaskStatusPopover` at 152-204, `handleChipClick` at 261-268),
`AIService.ts` (`ai:getTeammateTranscript` at 3303-3328), `MessageStreamingHandler.ts`
(teammate live-signal forward at 1176-1183), `agentMode.ts` (signal atom family at
228-241, `sessionTasksAtom` at 260-266), `AgentMode.tsx` (listener init at 58/264-268), and
`SessionTranscript.tsx` (`AgentTranscriptPanel` at 2502, `SubAgentChipRow` at 2696) all
matched the PRD's citations exactly against live source.

## Quick Links

- [PRD](../PRD_task-subagent-visibility.md)
- [Execution Plan](../execution_plan.yaml)
- [Tasks](../tasks.yaml)
- [Research: internal](../research/internal/findings.md)
- [Research: external](../research/external/findings.md)
- [Research: summary](../research/summary.md)

---
*For full briefs, see `{task-id}_task-subagent-visibility.md` files.*
