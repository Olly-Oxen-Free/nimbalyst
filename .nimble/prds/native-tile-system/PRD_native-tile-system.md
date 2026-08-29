# PRD: native-tile-system

## Status

Draft, unapproved. Planned via a background /nimble:plan dispatch with no live interactive user
present -- per explicit dispatch instruction, the coordinator (this session) made the interview's
judgment calls directly from the user's own feature-request brief rather than running a live Q&A,
and documents every such call below in Decisions. Anything genuinely ambiguous or product-level is
listed under Open Questions instead of being silently resolved, per the same instruction. This PRD
requires human review and explicit approval (folder numbering + status: ready) before
`/nimble:run` -- that step was intentionally not taken by this dispatch.

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

1. Each tile gets a tab, identical to the top tab list.
2. The bottom task bar (shared compose UI) replaces each tile's own custom message box.
3. Tiles can be tiled horizontally as well as vertically, via manual drag, niri-style (drag toward
   an edge to split; tiles in the same region can be stacked).

## Research Findings

Full detail in `research/internal/findings.md`, `research/external/findings.md`,
`research/summary.md`. Summary:

- **Top tab strip is reusable.** `TabBar.tsx`/`TabManager.tsx`
  (`packages/electron/src/renderer/components/TabManager/`) take `tabs`/`activeTabId` as props (not
  hard-wired globally) and already have a `kind` discriminator precedent (`'file' | 'tracker'`).
  Adding `'teammate'`/`'task'` kinds and instantiating one `TabBar` per tiled region is additive,
  not a redesign.
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

1. A tile (teammate or task) presents as a tab, visually and behaviorally consistent with the
   app's existing tab strip component.
2. A tile's compose box is the app's existing shared bottom compose bar, not a bespoke duplicate.
3. Tiles can be manually dragged to split the tiled region horizontally or vertically (niri-style
   edge-drop), and tiles in the same split region can be stacked (tabbed) together.
4. The underlying tile-open state atoms and transcript-fetch logic are reused unmodified.

## Non-Goals (explicitly out of scope per user instruction)

- Full niri feature parity: workspaces, dynamic column widths, focus-follows-mouse.
- Any change to the transcript-fetching/session data model.
- Any change to how teammates/tasks are spawned, stopped, or revived (only how they are *presented
  and composed to*).

## Decisions (judgment calls made during this background-dispatch interview, not by a live user)

**D1 -- Tab strip scoping.** Tiles get their OWN tab strip -- visually/behaviorally identical to
the top one (same `TabBar` component, reused), but scoped to the tiled region, not merged into the
same tab strip/namespace as document/editor tabs. Rationale: avoids conflating document tabs and
agent tiles in one namespace; matches the safer default named in the dispatch brief. **Also listed
under Open Questions below** -- this changes user-facing information architecture and should be
confirmed by the user before or at PRD approval, not just accepted because a coordinator picked it.

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

**D6 -- Layout persistence.** Split-pane layout (the mosaic tree shape) persists only for the
session's lifetime (a Jotai atom), not across app restarts, to bound this PRD's scope. Also listed
under Open Questions -- persisting layout across restarts is a reasonable should-have the user may
want, deferred rather than silently dropped.

**D7 -- Execution cadence.** No PR workflow, ever, per explicit user instruction for this repo.
Worktree-free-local cadence, feature branch, `git merge --ff-only` to main -- matching PRD
006-010 precedent, encoded in `.execution_config.json` below.

## Open Questions (for user confirmation -- NOT resolved by this dispatch)

**OQ1.** Confirm D1: should tiles get their own tab strip scoped to the tiled region (current
default), or should tiles literally join the SAME tab strip as document/editor tabs (one unified
tab row for everything open)? This changes the app's information architecture and should be a
human call before/at PRD approval.

**OQ2.** `react-mosaic-component` version: v6 (stable, binary-tree model) vs v7 (beta at research
time, n-ary tree model). Needs a pre-implementation check (task 1a) before the split-pane engine
task begins -- this PRD does not block planning on it, but flags it so the check isn't skipped.

**OQ3.** Should split-pane layout persist across app restarts (via workspace-settings, IPC-routed,
never `localStorage`), or is session-lifetime-only (D6's default) acceptable for v1? Deferred as a
should-have if the user wants it.

**OQ4.** Do teammate and task tiles share ONE unified tiled region (a teammate tab and a task tab
can sit side-by-side or stacked together), or do teammate tiles and task tiles get separate tiled
regions that don't mix? The dispatch brief implies unified (niri-style tiling is spatial, not
type-segregated), and this PRD's tasks assume a single unified region -- but this is a product call
the user should confirm, since it affects task 3a/4a's component boundaries.

## Requirements

### Must Have

| ID | Requirement | Acceptance Criteria |
| -- | ----------- | -------------------- |
| R1 | Teammate/task tiles present as tabs via the existing `TabBar` component | A tile's tab is visually and behaviorally consistent with the top tab strip (open/close/reorder/active-state) |
| R2 | Tile compose box is the shared `AIInput`/`SessionAIInput` component | No bespoke duplicated compose box remains in `TeammateTileRail.tsx`/`TaskTileRail.tsx` |
| R3 | Drag a tile's tab to an edge of another pane to split horizontally or vertically | Drop edge determines split orientation, matching niri's manual-tiling model |
| R4 | Drag a tile's tab to the center of another pane to stack (tab together) instead of splitting | Both tiles are reachable via tabs within the same pane after a center-drop |
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

See `tasks.yaml` for the full executable task breakdown (11 tasks, single-shared-checkout
sequential waves per D7).

## Testing

Per this repo's CLAUDE.md: any task touching runtime behavior ships with red-first unit test
coverage; no presentation-only tests (no CSS-class/drag-state assertions, no
`readFileSync`+`toContain` source assertions). Each task below embeds its own test instructions.
Extend existing test files (`TeammateTileRail.test.tsx`, `TaskTileRail.test.tsx`,
`TabBar.test.tsx`/`TabManager` tests if they exist -- check first) rather than adding new ones
where a suitable file already exists.
