# Internal Research Findings: native-tile-system

## Q1 -- Top tab strip

`packages/electron/src/renderer/components/TabManager/TabBar.tsx`, `TabManager.tsx`.

Reusable. The `Tab` interface already has `kind?: 'file' | 'tracker'` as precedent -- adding a
`'teammate'`/`'task'` kind is a small additive change. `isProcessing`/`hasUnread` already map onto
teammate working/unread states. Reordering uses native HTML5 drag-and-drop (`dataTransfer`), not
`@dnd-kit`. `TabBar` takes `tabs`/`activeTabId` as props (not hard-wired to the global
`TabsContext`), so instantiating one `TabBar` per split-pane region, fed a filtered tab list, is
the low-risk integration path -- no need to make `useTabs()` pane-scoped.

Pre-existing pattern gap (not this PRD's scope unless touched anyway): `TabBar.tsx:519-546`'s
dropdown hand-positions with `getBoundingClientRect` instead of `@floating-ui/react`.

## Q2 -- Bottom compose bar

`packages/electron/src/renderer/components/UnifiedAI/AIInput.tsx`, wrapped by `SessionAIInput` in
`SessionTranscript.tsx`.

Reusable and already parameterized by `sessionId` (drives voice, undo history, mention search).
This directly replaces the duplication `TeammateTileRail.tsx` explicitly flags in its own doc
comment: the compose input is "deliberately duplicated" against `TeammateThreadPopover`, "keep
changed in lockstep."

Caveat: `AIInput` is heavy (voice/slash-commands/attachments/mentions) -- instantiate one per
*visible focused pane*, not one per open tile. `teammateComposeMode()`'s revive/inactive branching
(`TeammateTileRail.tsx:75-86`) has no `AIInput` equivalent and must stay as a wrapper around the
shared input, not be absorbed into it.

## Q3 -- Tiling/window-manager mechanics

No split-pane/binary-tree layout library present in this repo today. Checked: `react-mosaic`,
`golden-layout`, `allotment`, `react-resizable-panels`, `react-rnd`, `react-grid-layout` -- none in
`package.json`/lockfile. `@dnd-kit/core`/`sortable`/`utilities` are already a dependency of
`packages/runtime`, but only used for a simple sortable list (`ReorderList.tsx`), not spatial
edge-drop tiling. The current `TeammateTileRail`/`TaskTileRail` layout is a fixed horizontal-scroll
rail beside the main thread -- no resizable-divider or spatial-split concept exists to build on.

**Build vs. adopt recommendation: adopt `react-mosaic-component`** for the split-pane engine. It is
the only evaluated candidate that models the niri-style requirement natively -- drag-to-edge
binary/n-ary splits *and* tab groups as a first-class node type, not a bolt-on -- versus
react-resizable-panels/Allotment, which are flat resizable splits with no tab-group-within-a-split
concept and would require hand-building the binary-tree + stacking logic on top.

Trade-off: react-mosaic is actively maintained (v7.0.0-beta0, ~4 months old at time of research,
React 16-19 support), but v7 migrated its tree model from binary to n-ary. Pin to a stable v6, or
verify v7 beta suitability, before committing to a version in planning.

`@floating-ui/react` remains mandated for any new dropdown/context menu the per-tile tab strips
need (this does not apply to the split-pane drag mechanics themselves).

## Data/state layer

Reuse as-is. `openTeammateTilesAtomFamily`, `closeTeammateTileAtom`, `sessionTeammatesAtom`,
`teammateTranscriptSignalAtomFamily` (`store/atoms/agentMode.ts`) and the
`aiGetTeammateTranscript` IPC fetch pattern are layout-agnostic -- no reason found to rebuild them.

## Remount constraint

`RichTranscriptView` (`packages/runtime/src/ui/AgentTranscript/components/RichTranscriptView.tsx:32`)
keeps a per-session VList cache that explicitly survives remounts -- more forgiving than
Monaco/Lexical/RevoGrid, but a tile going tab-hidden->visible should still use CSS-hide-not-unmount
to avoid refetch-on-mount cost, consistent with the editor-state rule's spirit (`docs/EDITOR_STATE.md`).

## Test infrastructure notes

Extend `packages/electron/src/renderer/components/AgentMode/__tests__/TeammateTileRail.test.tsx`
and `TaskTileRail.test.tsx` rather than adding new files. Assert on callbacks/state (e.g.
`onTabReorder`), not CSS drag-state class names -- no presentation-only tests per this repo's
CLAUDE.md.

## Files referenced (all existing, none created)

- `packages/electron/src/renderer/components/TabManager/TabBar.tsx`
- `packages/electron/src/renderer/components/TabManager/TabManager.tsx`
- `packages/electron/src/renderer/components/UnifiedAI/AIInput.tsx`
- `packages/electron/src/renderer/components/UnifiedAI/SessionTranscript.tsx`
- `packages/electron/src/renderer/components/AgentMode/TeammateTileRail.tsx`
- `packages/electron/src/renderer/components/AgentMode/TaskTileRail.tsx`
- `packages/runtime/src/ui/AgentTranscript/components/RichTranscriptView.tsx`
- `packages/runtime/src/ui/AgentTranscript/components/CustomToolWidgets/shared/ReorderList.tsx`
- `packages/electron/src/renderer/store/atoms/agentMode.ts`

Not yet inspected in depth: Project Sidebar file-tree drag-and-drop handler (flagged as a
follow-up during planning -- unlikely to transfer to spatial split-detection, but worth a quick
check before committing to hand-building drop-zone logic from scratch).
