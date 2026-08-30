# PRD: native-tile-system

## Status

Draft, unapproved -- revision 2. Planned via a background /nimble:plan dispatch with no live
interactive user present; revised after the user reviewed 4 visual mockup options for the tile
switcher and made a live decision (see Decisions D1, now locked). All Open Questions from revision
1 are now resolved -- **none remain blocking approval.** This PRD still requires explicit human
approval (folder numbering + status: ready) before `/nimble:run`.

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

1. A tile (teammate or task) is switched to via the existing `SubAgentChipRow` chip component,
   relocated to the top of the tiled region and repurposed as a switcher -- preserving its current
   visual identity (status dot, name, model badge) exactly, per D1.
2. A tile's compose box is the app's existing shared bottom compose bar, not a bespoke duplicate.
3. Tiles can be manually dragged to split the tiled region horizontally or vertically (niri-style
   edge-drop), and tiles in the same split region can be stacked (tabbed) together.
4. The underlying tile-open state atoms and transcript-fetch logic are reused unmodified.

## Non-Goals (explicitly out of scope per user instruction)

- Full niri feature parity: workspaces, dynamic column widths, focus-follows-mouse.
- Any change to the transcript-fetching/session data model.
- Any change to how teammates/tasks are spawned, stopped, or revived (only how they are *presented
  and composed to*).

## Decisions

**D1 -- Tile switcher component (LOCKED, live user decision).** Revision 1 proposed reusing
`TabBar` for a tile-scoped tab strip; the user reviewed 4 visual mockup options (niri-style stacked
headers / segmented pill switcher / tab-strip lookalike / no-chrome-by-default) and rejected the
`TabBar`-reuse framing entirely -- `TabBar` is scoped to parallel agent *sessions*, and conflating
that with sub-agent *tiles* would be wrong. **Chosen: Option B (segmented pill switcher),
implemented by relocating the existing `SubAgentChipRow` component** (currently rendered just above
the compose bar in `SessionTranscript.tsx`) to the top of the tiled region, and repurposing its
existing click-to-tile behavior to focus a tile within the region's stack instead of toggling a
standalone rail tile open/closed. This is a relocation and behavioral repurposing of an existing
component, not a new component build -- the chip's visual identity (status dot, name, model badge)
is preserved exactly. No new pill/segment/tab-strip component is built from scratch. This
supersedes revision 1's `TabBar`-reuse research finding (see Research Findings above) and resolves
former OQ1.

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
(former OQ4, now locked). Since the switcher (D1) is the same `SubAgentChipRow` that already lists
teammates and tasks together in one row with unified chip styling, a unified region is the natural
default -- a segregated-region design would require either two separate chip-row instances (losing
the "one relocated row" simplicity D1 chose) or artificial filtering of a single row into two
regions, neither of which the user's decision calls for.

## Open Questions

None remain blocking approval. Former OQ1 is resolved by D1 (live user decision). Former OQ3 is
locked by D6 (session-only, deferred as should-have R8). Former OQ4 is locked by D8 (unified
region). Former OQ2 (`react-mosaic-component` v6 vs v7) was never a product-level open question --
it is a pre-implementation technical check already embedded in task 1a's description, executed
before the split-pane engine task begins; it does not block PRD approval and is not re-listed here.

## Requirements

### Must Have

| ID | Requirement | Acceptance Criteria |
| -- | ----------- | -------------------- |
| R1 | Teammate/task tiles are switched to via the relocated, repurposed `SubAgentChipRow` | A tile's chip sits in a switcher row at the top of the tiled region; clicking it opens-or-focuses that tile's content within the region's active stack; the chip's existing visual identity (status dot, name, model badge) is unchanged |
| R2 | Tile compose box is the shared `AIInput`/`SessionAIInput` component | No bespoke duplicated compose box remains in `TeammateTileRail.tsx`/`TaskTileRail.tsx` |
| R3 | Drag a chip to an edge of another pane to split horizontally or vertically | Drop edge determines split orientation, matching niri's manual-tiling model |
| R4 | Drag a chip to the center of another pane to stack (tab together) instead of splitting | Both tiles are reachable via chips within the same pane's stack after a center-drop |
| R5 | Split dividers are resizable | Dragging a divider resizes adjacent panes |
| R6 | Existing tile-open atoms and transcript-fetch IPC are unmodified | No task in this PRD changes `openTeammateTilesAtomFamily`'s shape or `aiGetTeammateTranscript`'s contract |

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
Extend existing test files (`SubAgentChipRow.test.tsx`, `TeammateTileRail.test.tsx`,
`TaskTileRail.test.tsx` -- check first) rather than adding new ones where a suitable file already
exists.
