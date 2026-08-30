# PRD: native-tile-system

## Status

Revision 3, approved and in execution. Revision 2 (D1: relocate/repurpose `SubAgentChipRow` as an
in-region "segmented pill" switcher) was built through task 4a on `feature/native-tile-system`
(commits `7b9e017ac` 1a, `b1ffa282a` 3a, `f97ec3b39` 4a, `1b9509bde` jsdom fix) and reached its
wave-3 gate. The user reviewed the live implementation against an interactive HTML mockup, **rejected
the chip-row switcher outright**, and iterated live to a different design the mockup called "Style
A -- headers." Verbatim confirmation: "uep. rebuild." See D1R3 below, which supersedes D1.

Revision 2's `3a`/`4a` commits were discarded (`git reset --hard 7b9e017ac`, keeping only 1a's
react-mosaic pin); the discarded commits are preserved for reference on `archive/011-chip-switcher`
(tip `1b9509bde`) -- not merged, not deleted, citable by hash. Task 1a's landed decisions (react-mosaic
v7.0.0, react-dnd as the required DnD mechanism, `MosaicDragType`/`mosaicId` bridging pattern) remain
valid and are reused; only the switcher's shape and which component initiates the drag change.

Execution rule (repo-wide, confirmed by user for this dispatch, consistent with PRD 006-010
precedent): **no PR workflow, ever.** No `gh` usage, no GitHub PRs. Execution uses the
worktree-free-local cadence: a single feature branch (`feature/native-tile-system`), tasks
committed sequentially to it by the executing coordinator's own checkout, final `git merge
--ff-only` to `main`.

## Problem & Context

Prior PRDs (004, 007, 008, 009, 010 -- all merged to `main`) built a bespoke teammate/task tiling
system from scratch:

- `packages/electron/src/renderer/components/AgentMode/TeammateTileRail.tsx` and
  `TaskTileRail.tsx` -- each tile is a self-contained floating panel with its own fetch-driven
  transcript view, its own compose input box, its own Stop/Close/Revive controls, positioned via
  `openTeammateTilesAtomFamily`/`openTaskInlineExpandAtomFamily`-style Jotai atoms in
  `packages/electron/src/renderer/store/atoms/agentMode.ts`.
- Tiles render in a fixed side-by-side rail layout (composed alongside the main thread pane in
  `SessionTranscript.tsx`) -- no drag-to-position, no horizontal/vertical split choice.
- Each tile has its own bespoke compose UI. `TeammateTileRail.tsx` explicitly documents this as a
  liability in its own code comments: the compose input is "deliberately duplicated" against
  `TeammateThreadPopover.tsx`, "keep changed in lockstep."

The user wants to extend the *existing* app-wide structure to tiles, instead of continuing to grow
a parallel, bespoke one:

1. Each tile gets a tab, identical to the top tab list. (Superseded by D1 in revision 2: the tab
   strip reuse was rejected; tiles are switched via the relocated `SubAgentChipRow`, not a tab.)
2. The bottom task bar (shared compose UI) replaces each tile's own custom message box.
3. Tiles can be tiled horizontally as well as vertically, via manual drag, niri-style (drag toward
   an edge to split; tiles in the same region can be stacked).

## Research Findings

Full detail in `research/internal/findings.md`, `research/external/findings.md`,
`research/summary.md`. Summary:

- **Top tab strip finding -- superseded by D1 (revision 2).** Revision 1 recommended reusing
  `TabBar.tsx`/`TabManager.tsx` (`packages/electron/src/renderer/components/TabManager/`) as the
  tile switcher, adding `'teammate'`/`'task'` `kind` values to its existing `'file' | 'tracker'`
  discriminator. The user rejected this after review: `TabBar` is scoped to parallel agent
  *sessions* (top-level tabs), and reusing it for sub-agent tiles would conflate two different
  things. **Superseded by D1**: the tile switcher is the existing `SubAgentChipRow` component,
  relocated and repurposed, not `TabBar`. `TabBar`/`TabManager` are unaffected by this PRD.
- **`SubAgentChipRow` is already most of the switcher.**
  (`packages/electron/src/renderer/components/AgentMode/SubAgentChipRow.tsx`) already renders one
  chip per open teammate/task sub-agent, reading `sessionTeammatesAtom`/`sessionTasksAtom` directly
  (no `Tab[]` projection needed). It already sits directly above the compose bar in
  `SessionTranscript.tsx` (line ~2746), and its `onTeammateClick`/`onTaskClick` handlers already
  call `toggleTeammateTileAtom`/`toggleTaskTileAtom` -- both chip kinds are already unified to a
  single click-to-tile behavior (a prior PRD already collapsed the teammate chip's old
  click-opens-popover behavior into the same toggle-tile behavior the task chip uses). This is why
  D1's "relocate and repurpose" framing is accurate: the click-to-open-a-tile behavior already
  exists; what's new is (a) its position (top of the tiled region, not bottom, near compose), (b) a
  drag-source capability it does not have today (needed for 5a/6a's edge/center drop), and (c) its
  click semantics changing from toggle-open/close to open-or-focus (closing a tile remains the
  tile's own Close control, unchanged).
- **`SubAgentChipRow` has no drag-and-drop today.** Its chips are plain `<div role="button">`
  elements with `onClick`/`onKeyDown` only -- no `draggable`/`dataTransfer` wiring. This differs
  from revision 1's assumption (that `TabBar`'s existing native-HTML5 tab-drag could be reused
  as-is): task 3a must add drag-source capability to the chip from scratch, and task 1a's DnD
  compatibility check (below) now determines *which* mechanism 3a builds with, not just whether an
  existing mechanism is compatible.
- **`TeammateThreadPopover.tsx` is pre-existing dead code, unrelated to this PRD.** It has no
  render callsite anywhere in the app (only its own test renders it) -- the teammate chip's click
  behavior already moved to toggle-tile in a prior PRD and nothing was cleaned up. Out of scope to
  fix here; flagged for 10a's dead-reference sweep to note (not silently touch).
- **Bottom compose bar is reusable.** `AIInput.tsx` (wrapped by `SessionAIInput` in
  `SessionTranscript.tsx`, both under `packages/electron/src/renderer/components/UnifiedAI/`) is
  already parameterized by `sessionId`. It directly resolves the duplication
  `TeammateTileRail.tsx` itself flags as a liability. It is a heavy component (voice, slash
  commands, attachments, mentions) -- instantiate per *visible focused pane*, not per open tile.
- **No split-pane/tiling library exists in this repo.** Evaluated `react-mosaic-component`,
  `react-resizable-panels`, `allotment`, `golden-layout`, `react-rnd`, `react-grid-layout`.
  Recommendation: **adopt `react-mosaic-component`** -- the only candidate that natively models
  both edge-drop binary/n-ary splitting and tab-stacking within a split node, avoiding a hand-built
  binary-tree layout engine (the single riskiest greenfield piece of this PRD).
- **Data/state layer is layout-agnostic and should be reused unchanged**:
  `openTeammateTilesAtomFamily`, `closeTeammateTileAtom`, `sessionTeammatesAtom`,
  `teammateTranscriptSignalAtomFamily`, and the `aiGetTeammateTranscript` IPC fetch pattern.
- **Remount constraint**: `RichTranscriptView` keeps a per-session VList cache that survives
  remounts (more forgiving than Monaco/Lexical/RevoGrid), but a tile going tab-hidden -> visible
  within a stack should still hide-not-unmount, consistent with the editor-state rule's spirit.
- **No existing drag-and-drop infrastructure transfers directly.** `@dnd-kit` in this repo is used
  only for simple list reordering (`ReorderList.tsx`); the Project Sidebar's file-tree
  drag-and-drop is a different problem shape (not spatial edge-drop tiling).

## Goals

1. A tile (teammate or task) is opened via the existing `SubAgentChipRow` chip component, unmoved
   above the compose bar, and switched to within its pane via that pane's slim header-bar stack
   (status dot, name, model badge, drag handle, close), per D1R3.
2. A tile's compose box is the app's existing shared bottom compose bar, not a bespoke duplicate.
3. Tiles can be manually dragged, from their header bar, to split the tiled region horizontally or
   vertically at any pane and any depth (niri-style edge-drop), and tiles in the same pane can be
   stacked (tabbed) together via a center-drop.
4. The underlying tile-open state atoms and transcript-fetch logic are reused unmodified.

## Non-Goals (explicitly out of scope per user instruction)

- Full niri feature parity: workspaces, dynamic column widths, focus-follows-mouse.
- Any change to the transcript-fetching/session data model.
- Any change to how teammates/tasks are spawned, stopped, or revived (only how they are *presented
  and composed to*).

## Decisions

**D1 -- Tile switcher component (SUPERSEDED by D1R3, kept for history).** Revision 1 proposed
reusing `TabBar`; the user rejected that and, in revision 2, chose Option B (segmented pill switcher
via relocated `SubAgentChipRow`). Built through task 4a, reviewed live, and rejected -- see D1R3.

**D1R3 -- Tile switcher: per-pane header-bar stacks (LOCKED, live user decision, revision 3).**
After reviewing the working revision-2 implementation against an interactive mockup with several
styles, the user rejected the chip-row switcher and confirmed the mockup's **"Style A -- headers"**
as final ("uep. rebuild."). Naming: this is called "headers" / "tile header" / "pane header" in code
and UI copy -- never "niri header" or "niri-style" (niri is an internal design reference only, not a
user-facing or code-facing term).

Each pane in the tiled region renders a **stack of slim window-manager-style header bars, one per
tile currently occupying that pane** -- not a relocated chip row. Each header bar shows: a status
dot (reusing the normalized `SubAgentStatus` color vocabulary already shared by `SubAgentChipRow`'s
`STATUS_CLASSES` and `SubagentStatusChip` in `packages/runtime/src/ui/AgentTranscript/components/
SubagentCardPieces.tsx` -- both derive from `store/atoms/subAgentStatus.ts`'s `mapTeammateStatus`/
`mapTaskStatus`; the header must reuse this derivation, not invent new color literals), the
teammate/task name, a model badge, a drag handle, and a close control (X). Clicking a header
focuses that tile within its pane; a pane with only one tile still shows its header (for
drag-to-split affordance and the close control) but renders as a single slim bar, not a
two-row placeholder.

**D1R3a -- Opener stays `SubAgentChipRow`, unmoved.** Revision 2's task 3a relocated
`SubAgentChipRow` into the tiled region and repurposed its click behavior. That relocation is fully
reverted: `SubAgentChipRow` returns to (and in this revision's implementation, never actually left)
its original position directly above the compose bar in `SessionTranscript.tsx`, and keeps its
original job -- listing every teammate/task sub-agent in the session and opening-or-focusing a tile
on click. Header bars are NOT how a tile is first opened; they only exist for tiles already open,
one per occupied pane-slot. This resolves the gap the wave-3 gate review surfaced (headers alone
have nothing to open a not-yet-open tile) and means task 10a's "remove the old standalone
SubAgentChipRow call site" language (revision 2) no longer applies -- that call site is not being
removed, only the pane-internal switcher is being replaced.

**D1R3b -- Drag source moves from chip to header.** Task 1a's DnD-mechanism decision (react-dnd,
`MosaicDragType`, a `mosaicId`-bearing payload, one shared `DndProvider`) is unchanged and reused,
but the drag-source now lives on the header bar (an already-open tile being rearranged), not on the
`SubAgentChipRow` chip (which only opens, never drags). `SubAgentChipRow`'s chips do not need
drag-source capability in this revision.

**D1R3c -- Close control.** The header bar's X is the tile's close control once it is open in a
pane. `TeammateTile`/`TaskTile`'s own internal Close control (if still rendered by
`TeammateTileRail.tsx`/`TaskTileRail.tsx`'s content components) is removed to avoid two close
affordances for the same tile; closing happens through the header only.

**D1R3d -- Recursive binary split tree (LOCKED).** The tiling engine must support arbitrarily deep
binary splits, exactly like niri/i3 manual tiling -- split a pane horizontally into two, then split
either child vertically, to any depth. `react-mosaic-component` (D2, unchanged) models this natively
as a binary mosaic tree; the implementation must lean on react-mosaic's own tree/window/split APIs
for the recursive structure itself, and only hand-build what react-mosaic does not cover natively
(the header-stack-per-pane content, and drag semantics originating from a header instead of
react-mosaic's own default window drag handle). Dropping a dragged header on another pane: within
roughly 28% of that pane's shorter dimension from an edge (left/right/top/bottom) splits that pane
in the corresponding direction; a center drop stacks the dragged tile into that pane's header stack
instead. Closing the last tile in a pane auto-collapses that split -- the sibling pane takes over the
freed space, matching niri's own auto-collapse -- and this must be real, tested behavior, not only
true in the reference mockup.

**D2 -- Split-pane engine.** Adopt `react-mosaic-component` rather than hand-build a binary-tree
split-pane engine. Rationale: it is the only evaluated library that natively models both
edge-drop splitting and tab-stacking-within-a-node; hand-building both would be the largest and
riskiest greenfield chunk of this PRD for no clear benefit over an actively maintained library.
Exact version (v6 stable/binary vs v7 beta/n-ary) is an Open Question / pre-implementation check,
not resolved here.

**D3 -- Compose bar instantiation.** One shared `AIInput`/`SessionAIInput` instance per *visible
focused pane*, not one per open tile (tiles that are backgrounded within a stack, or occupy a
non-focused split region, do not get their own live compose instance). `teammateComposeMode()`'s
revive/inactive branching stays as a thin wrapper around the shared input, not absorbed into it.

**D4 -- Data/state layer untouched.** All existing teammate/task tile-open atoms and the
transcript-fetch IPC pattern are reused as-is. No task in this PRD modifies
`openTeammateTilesAtomFamily` et al.'s underlying shape or the `aiGetTeammateTranscript` contract.

**D5 -- Scope boundary.** Binary-split drag-to-tile (horizontal or vertical, by drop edge),
tab-stacking within one region, and resizable split dividers are IN scope. Full niri parity
(workspaces, dynamic column widths, focus-follows-mouse) is OUT of scope, per explicit user
instruction -- do not silently expand scope to chase parity.

**D6 -- Layout persistence (LOCKED).** Split-pane layout (the mosaic tree shape) persists only for
the session's lifetime (a Jotai atom), not across app restarts (former OQ3, now locked to this
default). Kept as a should-have (R8, deferred) since it is a reasonable future want, not dropped.

**D7 -- Execution cadence.** No PR workflow, ever, per explicit user instruction for this repo.
Worktree-free-local cadence, feature branch, `git merge --ff-only` to main -- matching PRD
006-010 precedent, encoded in `.execution_config.json` below.

**D8 -- Unified tiled region (LOCKED).** Teammate and task tiles share ONE unified tiled region
(former OQ4, now locked). `SubAgentChipRow` already lists teammates and tasks together in one row
with unified chip styling as the opener (D1R3a); the header-bar switcher (D1R3) inherits the same
unified treatment -- one pane's header stack can hold a mix of teammate and task tiles.

## Open Questions

None remain blocking approval. Former OQ1 is resolved by D1R3 (live user decision, revision 3).
Former OQ3 is locked by D6 (session-only, deferred as should-have R8). Former OQ4 is locked by D8
(unified region). Former OQ2 (`react-mosaic-component` v6 vs v7) was resolved in task 1a (v7.0.0,
commit `7b9e017ac`) and does not block approval.

## Requirements

### Must Have

| ID | Requirement | Acceptance Criteria |
| -- | ----------- | -------------------- |
| R1 | Teammate/task tiles are opened via `SubAgentChipRow` (unmoved, D1R3a) and switched within a pane via that pane's header-bar stack (D1R3) | Clicking a chip whose tile isn't open, opens it into the active pane; clicking a header in a pane's stack focuses that tile there; a single-tile pane still shows its header |
| R2 | Tile compose box is the shared `AIInput`/`SessionAIInput` component | No bespoke duplicated compose box remains in `TeammateTileRail.tsx`/`TaskTileRail.tsx` |
| R3 | Dragging a header to an edge of another pane splits it horizontally or vertically, to arbitrary depth | Drop edge determines split orientation; splitting any existing pane (not just a top-level one) produces correctly nested mosaic tree shapes, matching niri's manual-tiling model (D1R3d) |
| R4 | Dragging a header to the center of another pane stacks it into that pane's header stack instead of splitting | Both tiles are reachable via headers within the same pane's stack after a center-drop |
| R5 | Split dividers are resizable | Dragging a divider resizes adjacent panes |
| R6 | Existing tile-open atoms and transcript-fetch IPC are unmodified | No task in this PRD changes `openTeammateTilesAtomFamily`'s shape or `aiGetTeammateTranscript`'s contract |
| R9 | Closing the last tile in a pane auto-collapses that pane | The sibling pane takes over the freed space; verified by test, not only visually (D1R3d) |

### Should Have

| ID | Requirement | Acceptance Criteria |
| -- | ----------- | -------------------- |
| R7 | A backgrounded tab within a stack is hidden, not unmounted, when switching tabs | No refetch-on-remount cost when returning to a previously-viewed tile's tab |

### Could Have (deferred, see OQ3)

| ID | Requirement | Acceptance Criteria |
| -- | ----------- | -------------------- |
| R8 | Split-pane layout persists across app restarts | Reopening the app restores the prior split/stack arrangement |

## Tasks

See `tasks.yaml` for the full executable task breakdown (10 tasks, single-shared-checkout
sequential waves per D7).

## Testing

Per this repo's CLAUDE.md: any task touching runtime behavior ships with red-first unit test
coverage; no presentation-only tests (no CSS-class/drag-state assertions, no
`readFileSync`+`toContain` source assertions). Each task below embeds its own test instructions.
`SubAgentChipRow.test.tsx` is unaffected (D1R3a -- the component is untouched); `TileHeaderBar` and
`TiledRegion` get new test files (task 3a/4a). Extend `TeammateTileRail.test.tsx`/
`TaskTileRail.test.tsx` where a suitable file already exists rather than adding new ones.
