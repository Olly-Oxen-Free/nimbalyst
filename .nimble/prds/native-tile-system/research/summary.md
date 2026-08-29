# Research Summary: native-tile-system

## Executive summary

All three core research questions have clear, reusable answers in the existing codebase:

1. **Top tab strip is reusable.** `TabBar.tsx`/`TabManager.tsx` already take `tabs`/`activeTabId`
   as props and already have a `kind` discriminator precedent (`'file' | 'tracker'`). Adding
   `'teammate'`/`'task'` as tab kinds, and instantiating one `TabBar` per tiled region, is a small,
   low-risk change -- not a rebuild.
2. **Bottom compose bar is reusable.** `AIInput.tsx` (wrapped by `SessionAIInput`) is already
   parameterized by `sessionId` and directly replaces the compose-box duplication
   `TeammateTileRail.tsx` itself flags as a maintenance liability ("keep changed in lockstep").
   Reuse it per focused pane, not per tile (it's a heavy component).
3. **No tiling/split-pane library exists in this repo.** Recommend adopting
   `react-mosaic-component` over hand-building a binary-tree split-pane engine -- it is the only
   evaluated candidate that natively models both edge-drop splitting and tab-stacking within a
   split region, matching the niri-style requirement directly.

## Key discoveries

- `Tab.kind` already supports extension (`'file' | 'tracker'` precedent) -- teammate/task tiles as
  tabs is additive, not a redesign of the tab data model.
- `TeammateTileRail.tsx`'s own code comments already identify the compose-box duplication as a
  problem to fix ("deliberately duplicated... keep changed in lockstep") -- this PRD directly
  resolves a documented liability, not a speculative refactor.
- The underlying data/state layer (`openTeammateTilesAtomFamily`, `aiGetTeammateTranscript` IPC,
  etc.) is layout-agnostic and should be reused unchanged.
- `RichTranscriptView` already tolerates remounts better than Monaco/Lexical/RevoGrid (per-session
  VList cache survives), but tab-hidden/visible transitions should still hide-not-unmount to avoid
  refetch cost.
- No existing drag-and-drop infrastructure in this repo transfers to spatial edge-drop tiling
  (`@dnd-kit` here is only used for simple list reordering; the Project Sidebar's file-tree DnD is
  a different problem shape).

## Recommended approach

Adopt `react-mosaic-component` as the split-pane/tiling engine (binary or n-ary tree of leaf tiles
and split containers, tabs-within-a-node for stacking). Feed it tab-strip regions built from the
existing `TabBar` component (parameterized per region) and compose panes built from the existing
`AIInput`/`SessionAIInput` component (parameterized per focused pane). Reuse all existing
teammate/task tile data atoms and transcript-fetch IPC unchanged.

## Open items carried into planning

- react-mosaic version choice (v6 stable/binary vs v7 beta/n-ary) needs a pre-implementation check.
- Whether tiles get their own tab strip (scoped to the tiled region) or join the same top-level tab
  strip as document/editor tabs is a product decision, not fully resolved by research -- flagged as
  an open question for the PRD's decisions section.
- Project Sidebar file-tree drag-and-drop implementation not inspected in depth; low expected
  relevance to spatial tiling drop-zones, but a quick check is cheap if the split-pane task needs a
  drag-and-drop pattern precedent beyond what react-mosaic already provides.

See `research/internal/findings.md` and `research/external/findings.md` for full detail.
