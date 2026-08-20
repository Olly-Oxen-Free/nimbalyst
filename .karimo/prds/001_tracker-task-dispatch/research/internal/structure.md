# Internal Research — Structure

## Directory landmarks

```
packages/runtime/src/core/TrackerRecord.ts          canonical TrackerRecord type + converters
packages/runtime/src/plugins/TrackerPlugin/
  models/
    TrackerDataModel.ts                             schema model, globalRegistry
    trackerStatusCategory.ts                         per-type terminal-status resolution
    trackerSchemaChangeClassifier.ts                 additive vs destructive schema-change gate
    trackerLifecycle.ts                              publish/promote/archive lifecycle
  components/
    TrackerTable.tsx                                 shared table view (used by electron host)
    TrackerRowContextMenu.tsx                         floating-ui row context menu

packages/electron/src/main/
  ipc/SessionHandlers.ts                              session:*, sessions:*, tracker:link-session IPC
  services/ai/AIService.ts                             ai:createSession, ai:sendMessage, ai:saveDraftInput
  services/CommitTrackerLinker.ts                      commit -> tracker item auto-close
  services/session/sessionPhaseTransition.ts           session workflow-phase audit trail
  mcp/tools/trackerToolHandlers.ts                      tracker_* MCP tools + bidirectional link helpers
  database/sqlite/schemas/0001_initial.sql              tracker_items / ai_sessions table DDL
  shared/trackerSessionLinks.ts                         team-sync gate for linkedSessions visibility

packages/electron/src/renderer/
  components/TrackerMode/
    TrackerMainView.tsx                               owns handleLaunchSession/handleLaunchWorktree
    TrackerItemDetail.tsx                              only current UI surface with launch buttons
    trackerSessionLaunch.ts                            buildTrackerLaunchContext (prompt synthesis)
    TrackerBoardCard.tsx                               kanban card (no launch affordance yet)
    TrackerGridView.tsx                                list view
    KanbanBoard.tsx / KanbanContextSubmenu.tsx          board + its floating-ui context submenu
  store/
    atoms/sessions.ts                                  sessionProcessingAtom, session registry
    atoms/sessionKanban.ts                              SessionPhase, session-kanban board atoms
    sessionStateListeners.ts                            central IPC->atom listener (per IPC_LISTENERS.md)
  services/aiApi.ts                                     renderer-side wrapper over window.electronAPI.ai.*
  preload/index.ts                                       electronAPI surface (ai.*, invoke(...) generic)

packages/electron/src/renderer/components/TabEditor/
  editorRevealCommand.ts                                pending-request/replay-on-mount registry (considered, not needed)
```

## Naming/ID conventions observed

- Tracker item identity: `id` (internal row id, stable, always present) vs
  `issueKey` (`NIM-123`-shaped, room-assigned, absent until publish — see
  `TRACKER_SCHEMA_SHARING.md` "Numbering") vs `localKey` (never synced,
  per-machine). `trackerSessionLaunch.ts` uses `issueKey` when present in
  the synthesized prompt text, falling back to the raw `trackerItemId`.
- `trackerLinkId` used by `buildTrackerLaunchContext`/`tracker:link-session`
  is **not** always the plain item id: for file-backed items it's
  `file:${documentPath}` (`trackerSessionLaunch.ts:63-65`). Any new
  dispatch code that needs to re-derive "which tracker item does this
  session belong to" must handle this `file:`-prefixed form, not assume a
  bare row id.
- IPC channel naming is inconsistent between `namespace:verb` (`ai:createSession`,
  `session:create` singular vs `sessions:create` plural, `tracker:link-session`)
  — this is pre-existing, not something to fix, but expect to grep both
  singular and plural forms when searching for a related handler.
- Session workflow states are called **"phase"** (`backlog`/`planning`/
  `implementing`/`validating`/`complete`), not "status" — this codebase
  reserves "status" for tracker item workflow status
  (`getWorkflowStatusFieldName`) and uses "phase" for session lifecycle, and
  a third term "processing" (boolean) for per-turn busy/idle. Keep this
  three-way distinction straight in the PRD's own vocabulary — do not
  introduce a fourth term for the same axis.

## Component/prop wiring pattern for tracker actions

Actions on a tracker item currently flow top-down as callback props from
`TrackerMainView.tsx` (which owns the Jotai wiring, IPC calls, and
navigation) into `TrackerItemDetail.tsx` (pure presentation + local UI
state), e.g. `onLaunchSession`, `onLaunchWorktree`, `onArchive`, `onDelete`,
`onOpenItem` (all visible in the `<TrackerItemDetail ... />` JSX at
`TrackerMainView.tsx:1144-1170`). A dispatch button added to
`TrackerBoardCard.tsx` / `TrackerGridView.tsx` / `TrackerTable.tsx` should
follow this same pattern: the actual IPC/session-creation logic stays in
`TrackerMainView.tsx` (or a shared hook extracted from it, given
`handleLaunchSession` would now be called from four+ places instead of one),
and the card/row components stay presentational, receiving a callback prop.

## Test locations (for whoever writes the dispatch tests)

- `packages/electron/src/renderer/components/TrackerMode/__tests__/` —
  existing tracker UI test directory (confirmed present via the `grid`
  subfolder and sibling `__tests__` folder in the directory listing).
- `packages/electron/src/renderer/components/TrackerMode/__tests__/trackerSessionLaunch.test.ts`
  already covers `buildTrackerLaunchContext` / `deriveTrackerWorktreeName`
  (prompt synthesis and worktree-name slugification). It does **not** cover
  `handleLaunchSession` / `handleCreateTrackerWorktree` themselves (those
  are inline callbacks inside `TrackerMainView.tsx`, not exported units) —
  extracting them to a testable module (or a hook) is worth considering when
  extending this flow for dispatch, both for testability and because the
  logic needs to be callable from more than one caller (card/list/table, not
  just the detail panel).
