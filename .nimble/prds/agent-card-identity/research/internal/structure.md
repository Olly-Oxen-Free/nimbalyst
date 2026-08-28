# Internal Structure — agent-card-identity

## File ownership / package boundary

- `packages/runtime/src/ui/AgentTranscript/components/RichTranscriptView.tsx` — cross-platform (Electron + mobile), owns `renderToolCard`, the auto-expand effect, `getProviderDisplayName`, the `isNewGroup` header. Per `packages/runtime/CLAUDE.md`, put shared header logic here if it might be reused by mobile.
- `packages/electron/src/renderer/components/AgentMode/` — Electron-only: `TaskToolWidget.tsx`, `TeammateThreadPopover.tsx`, `TaskThreadPopover.tsx`, `TaskTileRail.tsx`, `TeammateTileRail.tsx`. These are the embed sites that mount a second `RichTranscriptView` and would pass any new identity-override prop.
- `packages/electron/src/renderer/store/atoms/agentMode.ts` — `TaskInfo`, `sessionTasksAtom`, `openTaskInlineExpandAtomFamily`/`setTaskInlineExpandAtom`, `sessionTeammatesAtom` (teammate name/model/status source for popovers).
- `packages/runtime/src/ai/server/transcript/parsers/ClaudeCodeRawParser.ts` — sets `subagentId = toolUseId` on `subagent_started`/`subagent_completed` descriptors; upstream of A1's id-collision-driven auto-expand.

## Naming convention observed

Kebab-case root class per component (per `REACT_DOM_MARKERS.md` convention referenced in root CLAUDE.md): `.rich-transcript-tool-card`, `.task-tool-widget`, `.teammate-thread-popover`. Any unified header component should follow the same pattern with its own stable root class, and preserve the existing `.rich-transcript-tool-card.sub-agent` / `.rich-transcript-tool-card.teammate` / `.task-tool-widget-header` selectors that tests already key on (see errors.md).

## Test directory layout

- `packages/runtime/src/ui/AgentTranscript/components/__tests__/` — runtime-side transcript rendering tests (`RichTranscriptView.*.test.tsx`, `TranscriptWidgets.test.tsx`).
- `packages/electron/src/renderer/components/AgentMode/__tests__/` — Electron-side widget tests (`TaskToolWidget.test.tsx`).
Extend these existing files for the fix rather than adding new ones, per repo test-discipline rules (`CLAUDE.md` testing section, `token-discipline.md`).

## Related PRDs (vocabulary/history)

- **PRD 004 `task-subagent-visibility`** (`.nimble/prds/004_task-subagent-visibility/PRD_task-subagent-visibility.md`): built the Task-widget-gate mechanism itself — the `CustomWidget && !(isSubAgent && isTeammate)` gate (RichTranscriptView.tsx:1766) and `TaskToolWidget` exist because of this PRD. Explicitly scoped teammate rendering as untouched ("Teammate spawn messages must render exactly as they do today"). Confirms `TaskToolWidget`'s divergent header anatomy is deliberate-but-incomplete: PRD 004 built a minimal widget and never unified it with the pre-existing teammate/sub-agent card, which is exactly this feature's A1 gap.
- **PRD 006 `teammate-idle-handoff`**: unrelated to card rendering — fixes teammate idle-transition message delivery and status painting (`errored` vs `completed` on idle). No overlap with A1/A2's rendering-layer scope, but establishes vocabulary: "teammate", "idle", "lead" (the spawning session), consistent with usage in `RichTranscriptView.tsx`/`TeammateThreadPopover.tsx`.
