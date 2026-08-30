# Task 1a (v2 — corrected) — Fix drag-and-tile: suppress react-mosaic's own competing root drop targets

Repo: `/home/jayden-eppcohen/Documents/Projects/Software/nimbalyst`. Branch:
`feature/tile-header-chrome-fixes` (checked out, no commits yet — a prior attempt at this task
correctly rejected an earlier, wrong version of this brief without committing anything; you are
starting clean). Working directly on the shared checkout — **no worktree, no PR, no `gh` command,
ever.**

If your harness sandboxes you into an isolated worktree/branch regardless of this instruction, note
that explicitly in your report but do not let it block you — apply and commit the fix; the PM will
reconcile it onto `feature/tile-header-chrome-fixes` directly if needed.

## This brief supersedes an earlier, disproven version

An earlier version of this brief claimed `.mosaic.-dragging` in `TiledRegion.css` was a fictional
CSS selector never applied by react-mosaic-component, based on a flawed grep that only searched
`*.js` files and missed the library's actual `.cjs`/`.mjs` output. **That claim is false — do not
re-investigate it, it has already been empirically disproven.** `.mosaic.-dragging` is real and
correctly toggled by the library (`node_modules/react-mosaic-component/lib/Mosaic.cjs`,
`MosaicRootWithDragDetection`, runs a live `useDrop` and applies `-dragging` to its own root div's
class list during any `MosaicDragType.WINDOW` drag). **Do not attempt a `useDragLayer`-based fix —
it is unneeded, and cannot even be called at the `TiledRegion` component level** (`<Mosaic>` owns
its own internal `DndProvider` scoped to its own subtree; `TiledRegion` sits above it, not inside
it, so no drag-drop context is available there without extra plumbing this task does not need).

## Actual, verified root cause

`<Mosaic>` always renders a *second*, always-mounted drop-target system in addition to the app's
own custom `TileDropZone`s (defined in `TiledRegion.tsx`): `RootDropTargets`
(`node_modules/react-mosaic-component/lib/RootDropTargets.cjs`), rendered as the direct next
sibling after the whole rendered tree, inside the same root div (`Mosaic.cjs` ~line 84:
`createElement(MosaicRootWithDragDetection, { className }, this.renderTree(), createElement(RootDropTargets))`).
It stands up 4 of its own drop targets — top, bottom, left, right, no center
(`internalTypes.cjs`'s `MosaicDropTargetPosition`) — always scoped to the tree's root (`path: []`),
regardless of how many panes the tree actually has.

The library's own stylesheet (`node_modules/react-mosaic-component/react-mosaic-component.css`,
lines ~101-134) makes these targets:
- `display: none` normally, `display: block` for the entire duration of any `WINDOW`-type drag
  (`.mosaic-drop-target .drop-target-container.-dragging { display: block; }`).
- `position: absolute`, container at `inset: 0`, each of the 4 `.drop-target` children also
  `position: absolute`, sized to a ~30%-wide edge band of the *entire root rectangle* (e.g.
  `.left { right: calc(100% - 30%); }`) — nearly the same physical area the app's own
  `.tiled-region-drop-zone-{top,bottom,left,right}` occupy (28%-wide bands,
  `packages/electron/src/renderer/components/AgentMode/TiledRegion.css` lines 71-99), for every
  pane, not just the root.
- `z-index: 5`, versus the app's own zones at `z-index: 1` (`TiledRegion.css` line 63).

Later DOM sibling + higher z-index + near-identical physical coverage means the library's own root
drop targets sit on top of, and physically intercept, the app's custom edge zones for the whole
duration of every drag. `opacity: 0` (their unhovered default) does not disable pointer-event
capture — an invisible element still wins hit-testing unless `pointer-events: none` is set, which
nothing currently sets. This is a static CSS/DOM-stacking-order fact, not something a jsdom test
can independently confirm (jsdom performs no layout or hit-testing at all).

`TiledRegion.tsx`'s own header comment already documents the deliberate choice to build custom
zones instead of the library's ("`MosaicDropTarget` is not exported from the package index, and its
targets quarter the whole pane with no center region") — but the library's *own* root-level targets
were never suppressed, so they stayed mounted and silently absorbed every drop attempt.

The drag *source* side (`useDrag` in `TileHeaderBar.tsx`) is correctly wired to
`MosaicDragType.WINDOW` already — **do not touch `TileHeaderBar.tsx` in this task.**

## Fix (CSS only — no React/TSX changes required)

In `packages/electron/src/renderer/components/AgentMode/TiledRegion.css`, add a rule suppressing
pointer-event capture on the library's own root drop-target overlay, scoped to this component's
mosaic instance:

```css
/* react-mosaic mounts its own root-level drop targets (RootDropTargets) alongside our custom
   TileDropZones, covering nearly the same edge bands but at a higher z-index and as a later DOM
   sibling - so they win hit-testing and silently swallow every drop before our own zones ever see
   it. We deliberately build our own zones (5, including a center stack target the library's
   RootDropTargets doesn't have) - neutralize the library's competing overlay rather than fight it. */
.tiled-region-mosaic > .drop-target-container {
  pointer-events: none;
}
```

Confirmed via `Mosaic.cjs`: `.drop-target-container` (`RootDropTargets`'s own root element) is a
direct child of the div carrying the `.tiled-region-mosaic` class, so the direct-child selector
`.tiled-region-mosaic > .drop-target-container` is safe and specific — verify this yourself by
reading `RootDropTargets.cjs` and `Mosaic.cjs`'s `MosaicRootWithDragDetection` before committing,
don't take this brief's word for the selector without checking.

Also: the existing comment above `.mosaic.-dragging .tiled-region-drop-zone { pointer-events: auto; }`
(around line 57-60) says "the library puts `-dragging` on the mosaic root for exactly this" — that
statement is actually TRUE (it was the earlier *research*, not this comment, that was wrong).
Leave that comment as-is or lightly tighten it if you touch nearby lines, but don't rewrite it to
say something false.

## Testing — read this before writing a test

This bug class (CSS stacking-order / pointer-events interception between two sibling
absolutely-positioned overlays, one from a third-party library) is not observable under jsdom,
which performs no layout or hit-testing, and this repo's vitest config does not parse imported CSS
into jsdom's style engine (`css: false` default) — so no unit test can assert on this fix's actual
effect without violating the repo's own testing rules (no asserting on CSS source text via
`readFileSync`/`toContain`, no injecting-then-asserting-the-same-CSS circularity).

**Do not write a placebo test that doesn't actually prove anything.** Instead:
1. Confirm the full existing `TiledRegion.test.tsx` / `TileHeaderBar.test.tsx` suites still pass
   unmodified (this fix should not change any jsdom-observable behavior — the `dropTile` test
   helper already bypasses CSS entirely via direct `fireEvent` calls, so it was never exercising
   this bug and won't be affected by the fix either).
2. In your final report to the PM, state plainly that this fix's actual effect (drop events
   reaching the app's zones instead of being intercepted) can only be verified in a real browser/
   Electron window, not in this repo's current unit-test tier, and that this is a known, deliberate
   limitation of this test tier for this bug class — not a shortcut you're taking to avoid writing
   a test.

## Verify before committing

```bash
npm run typecheck && npm run test:prepush
```

Capture full output to a scratchpad file and read it — never pipe through `tail`. On failure, use
`npm run test:last` before re-running.

Known false-positive tests to exclude from your pass/fail judgment: `AgentTranscriptPanel.listenerCleanup.test.tsx`,
`MarkdownRenderer.rtl.test.tsx`, `BodyDocCache.remountPaint.test.ts` (flaky under load — rerun
isolated before treating as real).

## Commit

One commit, one-sentence subject, no `Co-Authored-By` line (repo CLAUDE.md forbids it). Example
shape: `fix(tiling): suppress react-mosaic's own root drop targets from intercepting our drop zones`.
Do not touch `CHANGELOG.md` in this task — that lands with task 2a.

## Success criteria

- `TiledRegion.css` has a rule suppressing pointer-events on react-mosaic's own
  `.drop-target-container` scoped to `.tiled-region-mosaic`, with a comment explaining why.
- No React/TSX files changed.
- All existing `TiledRegion.test.tsx` / `TileHeaderBar.test.tsx` cases still pass unmodified.
- `npm run typecheck && npm run test:prepush` pass.
- Your report states clearly that this fix's real-world effect requires manual/browser
  verification, not a vitest assertion, and why.
