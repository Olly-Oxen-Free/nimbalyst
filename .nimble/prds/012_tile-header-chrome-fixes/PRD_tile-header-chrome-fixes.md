# PRD 012 — tile-header-chrome-fixes

## Source

User live-tested PRD 011's shipped native tiling feature (merged to main at `f297f677b`) and
reported, verbatim: "i noticed that the header is not also functioning as the chrome in that
window. it should be a minimize/expand kind of chrome header. also theere are buttons on teh
header that are non functional. and i cant seem to drag and tile."

No structured interview was run for this PRD — the report already carried file/line-level
root-cause evidence, verified against live source before task planning (below) rather than taken
on faith.

## Research Findings

### Root cause 1 (confirmed) — drag-and-tile is inert

`packages/electron/src/renderer/components/AgentMode/TiledRegion.css` gates the five drop zones
behind `.mosaic.-dragging .tiled-region-drop-zone { pointer-events: auto; }`, with a comment
claiming "the library puts `-dragging` on the mosaic root for exactly this."

Verified directly: no file under `node_modules/react-mosaic-component/` (`lib/*.cjs`, `lib/*.mjs`,
`react-mosaic-component.css`) contains the string `dragging` anywhere. The library never adds
`.mosaic.-dragging`, and nothing in `TiledRegion.tsx` adds it either. `.tiled-region-drop-zone {
pointer-events: none; }` is therefore never overridden in a real browser — `TileDropZone`'s
`useDrop` target never receives pointer events. Dropping a dragged `TileHeaderBar` anywhere is a
complete no-op in the running app today.

The drag *source* (`useDrag` in `TileHeaderBar.tsx`) is correctly wired to `MosaicDragType.WINDOW`.
Only the drop-side CSS gate is broken.

**Why this shipped green:** `TiledRegion.test.tsx`'s `dropTile` helper drives the drop via
`fireEvent.dragStart/dragEnter/dragOver/drop` directly on the drop-zone DOM node. jsdom performs no
hit-testing and does not apply CSS `pointer-events` to event dispatch, so `fireEvent.drop()` reaches
the `useDrop` handler regardless of the CSS gate. The existing suite is real coverage of the
tree-update logic (`handleEdgeDrop`/`handleCenterDrop`) but structurally cannot catch a
`pointer-events` regression in the gating CSS. Closing that gap is part of task 1a.

**Fix:** replace the fictional CSS selector with a real signal via `react-dnd`'s `useDragLayer`,
called once in `TiledRegion` (not per-pane), deriving `isDragging = monitor.isDragging() &&
monitor.getItemType() === MosaicDragType.WINDOW`, applied as a real class on the region wrapper
that `TiledRegion.css` targets instead of `.mosaic.-dragging`.

### Root cause 2 (confirmed) — "non-functional buttons" fully explained by root cause 1

`TileHeaderBar.tsx` has exactly one real `<button>`: `.tile-header-bar-close`, correctly wired to
`closeTaskTileAtom`/`closeTeammateTileAtom`, and it works today. The drag grip (`⋮⋮`,
`.tile-header-bar-grip`) is a `<span>` with `cursor-grab` — a drag handle, not a button — and
correctly initiates a `useDrag` source. It reads as "non-functional" only because the drag it
starts can never complete (root cause 1).

Checked `TeammateTileRail.tsx` for leftover pre-011 buttons: found `Stop` (`handleStop`) and
`Revive` (`handleRevive`), both wired to live handlers, not dead code. **No separate fix required**
— root cause 1's fix resolves this symptom entirely.

### Missing feature — minimize/expand chrome

Confirmed: a header slot's only interaction today is `onClick={() => setActiveTile(...)}` in
`TiledRegion.tsx`'s `TilePane` (~lines 194-242) — focus switch within the pane's stack. No
collapse/expand affordance exists anywhere.

**Design decision (made directly, recorded here):** add a dedicated chevron/disclosure control to
`TileHeaderBar`, distinct from the existing close (✕) and drag grip, rather than overloading the
existing single-click header interaction (which must keep meaning "focus this tile within the
pane's stack"). The chevron toggles the whole PANE's body visibility (all tiles in that pane, not
just one) — a niri-style collapsed pane keeps its stacked headers visible and clickable while the
content area collapses to zero height. The pane's drop zones must keep working while collapsed —
collapsing hides content, it does not remove the pane from the tree.

State: new `paneCollapsedAtomFamily` in `packages/electron/src/renderer/store/atoms/agentMode.ts`,
following the existing session-scoped, non-persisted pattern of `paneTreeAtomFamily` /
`tilePaneAtomFamily`. Hide via CSS display toggle, never unmount — every occupying tile must stay
mounted through a collapse exactly as it does through a focus switch (`TiledRegion.tsx`'s own
documented invariant).

## Execution Model

Precedent: PRD 011 (`status.json` note). No PRs, no `gh`, ever. Worktree-free local cadence:
workers edit the shared main checkout on `feature/tile-header-chrome-fixes` sequentially; the PM
(this session) reviews/tests/commits each task before starting the next. Two tasks both touch
`TiledRegion.tsx` / `TiledRegion.css` / `TileHeaderBar.tsx` — same-wave parallelism is not viable
(file overlap per PM validation rules), so tasks run in sequential waves.

## Tasks

1. **1a — Fix drag-and-tile via `useDragLayer`.** Replace the fictional `.mosaic.-dragging` CSS
   gate with a real react-dnd drag-state signal; add an interaction test that actually exercises
   CSS-driven gating (not just direct `fireEvent.drop`) so a regression here is caught again.
   Complexity 4.
2. **2a — Minimize/expand pane chrome.** Add `paneCollapsedAtomFamily`, a chevron control on
   `TileHeaderBar`, pane-body collapse in `TiledRegion.tsx`/`.css` (CSS-hide, never unmount).
   Complexity 4.

## CHANGELOG

One user-facing bullet on completion, no internal scaffolding: tile headers can now collapse the
pane's content, and dragging a tile header to split/stack a pane in the tiled agent view works.
