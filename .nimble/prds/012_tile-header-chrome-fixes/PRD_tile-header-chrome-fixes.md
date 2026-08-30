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

### Root cause 1 (corrected — see below) — drag-and-tile is inert

**Original hypothesis (WRONG, superseded).** An earlier pass of this research claimed
`.mosaic.-dragging` was a fictional selector never applied by anything, based on a `grep -iname
"*.js"` that only matched `.js` files and silently missed the library's actual `.cjs`/`.mjs`
build output. Task 1a's implementer caught this empirically: `.mosaic.-dragging` IS real.
`node_modules/react-mosaic-component/lib/Mosaic.cjs`'s `MosaicRootWithDragDetection` — the actual
root div `<Mosaic className="tiled-region-mosaic">` renders — runs a live `useDrop({ accept:
MosaicDragType.WINDOW })` and applies `-dragging` to its own class list whenever a `WINDOW`-type
drag is active. The CSS gate the original research called dead is live and correctly toggled.
Re-implementing it via `useDragLayer` (the original planned fix) would have changed nothing, and
in fact `useDragLayer` cannot even be called at the `TiledRegion` level as originally briefed:
`<Mosaic>` owns its own internal `DndProvider` wrapping only its own subtree, so `TiledRegion`
(the provider's parent, not a descendant) has no drag-drop context to read from without additional
plumbing. Credit to the implementer for verifying this against source and against a real jsdom
repro instead of shipping a fix that wouldn't have worked.

**Actual, verified root cause.** `<Mosaic>` always renders a *second*, always-mounted drop-target
system alongside the app's own custom `TileDropZone`s: `RootDropTargets`
(`node_modules/react-mosaic-component/lib/RootDropTargets.cjs`), rendered as the direct next
sibling after the whole rendered tree, inside the same root div (`Mosaic.cjs` line ~84:
`renderTree(), createElement(RootDropTargets)`). It stands up 4 of its own drop targets (top,
bottom, left, right — no center; `internalTypes.cjs`'s `MosaicDropTargetPosition`), always scoped
to the tree's root (`path: []`), regardless of how many panes the tree actually has.

The library's own stylesheet (`react-mosaic-component.css` lines 101-134) makes these targets:
- `display: none` normally, `display: block` for the *entire* duration of any `WINDOW`-type
  drag (`.drop-target-container.-dragging`) — i.e. active for the whole drag, not just the moment
  of hover.
- `position: absolute; inset: 0` for the container, each of the 4 `.drop-target` children also
  `position: absolute` and sized to a ~30%-wide edge band of the *entire root rectangle*
  (`calc(100% - 30%)` from the relevant edge) — nearly the same physical area the app's own
  `.tiled-region-drop-zone-{top,bottom,left,right}` occupy (28%-wide bands, `TiledRegion.css` lines
  71-99), for *every* pane, not just the root.
- `z-index: 5`, versus the app's own zones at `z-index: 1` (`TiledRegion.css` line 63).

Later DOM sibling + higher z-index + near-identical physical coverage = the library's own root
drop targets sit on top of and physically intercept the app's custom edge zones for the whole
duration of every drag. `opacity: 0` (their default, unhovered visual state) does not disable
pointer-event capture — an invisible element still wins hit-testing unless `pointer-events: none`
is set, which nothing does today. This is airtight from static CSS/DOM-order analysis; it is not
independently provable in jsdom (jsdom performs no layout/hit-testing at all — this is exactly why
the original `dropTile` test helper, which fires events directly on the target node, "passed" both
before and after this bug: fireEvent bypasses real hit-testing entirely, so no jsdom test can
observe stacking-order/pointer-events regressions of this kind. Vitest's default `css: false` also
means imported `.css` files are not parsed into jsdom's style engine during unit tests, so this
repo's current test tier cannot assert on the fix's actual effect either).

`TiledRegion.tsx`'s own header comment already documents the deliberate choice to build custom
zones instead of the library's ("`MosaicDropTarget` is not exported from the package index, and its
targets quarter the whole pane with no center region") — but the library's *own* root-level
targets were never suppressed, so they were left mounted and silently absorbing every drop attempt.

The drag *source* (`useDrag` in `TileHeaderBar.tsx`) is correctly wired to `MosaicDragType.WINDOW`
and needs no change.

**Fix:** CSS-only. Suppress the library's own root drop-target overlay inside the tiled region so
it never competes for pointer capture with the app's own zones:

```css
.tiled-region-mosaic > .drop-target-container {
  pointer-events: none;
}
```

(Confirmed via `Mosaic.cjs`: `.drop-target-container` — `RootDropTargets`'s own root element — is a
direct child of the div carrying `.tiled-region-mosaic`, so a direct-child selector is safe and
specific.) No React/TSX changes are required for this fix. Correct the existing misleading comment
above the `.mosaic.-dragging` rule (it now needs to say the class IS real and library-driven,
which was already true — the original comment's factual content was actually correct, only the
research that flagged it as fictional was wrong) and add a comment on the new rule explaining what
it suppresses and why.

**Testing tier note.** This bug class (CSS stacking-order / pointer-events interception between
two sibling absolutely-positioned overlays) is not observable under jsdom, which performs no
layout or hit-testing, and this repo's vitest config does not parse imported CSS into jsdom's style
engine (`css: false` default). Per `.claude/rules/end-to-end-verification.md`, the correct
verification tier for this class of bug is a real rendering engine (E2E/Playwright), not a vitest
unit test asserting on CSS source text (explicitly disallowed by this repo's own testing rules).
No E2E harness for `TiledRegion`/tiling exists yet in `packages/electron/e2e/`, and building one
from scratch is out of scope for this small PRD. This is called out explicitly rather than shipped
behind a placebo test — manual verification steps are provided in the PM's final report instead.

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
