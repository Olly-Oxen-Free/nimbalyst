# Task 1a — Fix drag-and-tile: replace fictional `.mosaic.-dragging` CSS gate with a real react-dnd signal

Repo: `/home/jayden-eppcohen/Documents/Projects/Software/nimbalyst`. Branch:
`feature/tile-header-chrome-fixes` (already created, checked out). Working directly on the shared
checkout — **no worktree, no PR, no `gh` command, ever.** Commit your own work when done; the PM
will review and may ask for follow-up before the next task starts.

## Bug

Dragging a `TileHeaderBar` to split or stack a tiled pane is a complete no-op in the running app.

`packages/electron/src/renderer/components/AgentMode/TiledRegion.css` gates the five drop zones:

```css
.tiled-region-drop-zone {
  position: absolute;
  z-index: 1;
  pointer-events: none;
}

.mosaic.-dragging .tiled-region-drop-zone {
  pointer-events: auto;
}
```

with a comment claiming "the library puts `-dragging` on the mosaic root for exactly this." This
is false — confirmed by grepping every file under `node_modules/react-mosaic-component/` (`lib/*.cjs`,
`lib/*.mjs`, `react-mosaic-component.css`) for the string `dragging`: zero matches anywhere. The
library never adds `.mosaic.-dragging`, and nothing in `TiledRegion.tsx` adds it either. So
`.tiled-region-drop-zone { pointer-events: none; }` is never overridden in a real browser —
`TileDropZone`'s `useDrop` target (in `TiledRegion.tsx`, ~lines 139-156) never receives a real
pointer event, and a dropped tile never reaches `handleEdgeDrop`/`handleCenterDrop`.

The drag *source* side is fine: `useDrag` in `TileHeaderBar.tsx` (~lines 101-106) is correctly
wired to `MosaicDragType.WINDOW`. **Do not touch `TileHeaderBar.tsx` in this task** — the bug is
entirely on the drop-zone visibility gate.

## Fix

In `TiledRegion.tsx`, derive a real "is a `MosaicDragType.WINDOW` drag currently active" signal
using react-dnd's `useDragLayer` hook, called once at the `TiledRegion` component level (not per
pane — avoid N redundant subscriptions):

```ts
import { useDragLayer } from 'react-dnd';
// ...
const isDraggingTile = useDragLayer(monitor =>
  monitor.isDragging() && monitor.getItemType() === MosaicDragType.WINDOW);
```

Apply a real class to the wrapper `TiledRegion.css` styles (`.tiled-region-mosaic` or
`.tiled-region`, your call — pick whichever reads more naturally given the existing selectors) when
`isDraggingTile` is true. Update `TiledRegion.css`: replace the `.mosaic.-dragging` selector with
the real class you introduced, and correct or remove the misleading comment above it (the current
one wrongly credits the library).

`MosaicDragType` is already imported in `TiledRegion.tsx` from `react-mosaic-component` — reuse it.

## Test coverage gap to close

`packages/electron/src/renderer/components/AgentMode/__tests__/TiledRegion.test.tsx`'s `dropTile`
helper (~lines 84-96) drives a drop via `fireEvent.dragStart/dragEnter/dragOver/drop` directly on
the drop-zone DOM node. jsdom performs no hit-testing and does not apply CSS `pointer-events` to
event dispatch, so `fireEvent.drop()` reaches the `useDrop` handler regardless of the CSS gate —
this is exactly why the pointer-events bug shipped with every existing test green. The existing
tests are real, valuable coverage of the tree-update logic; they just cannot see this class of
regression.

Add a new test (extend this existing file — do not create a parallel test file) that actually
proves the gating class appears on the wrapper element during an active `WINDOW`-type drag and
disappears after the drag ends, driven by the same `dragStart`/`dragEnd` (or `drop`) event sequence
the existing `dropTile` helper already uses — i.e., assert on the `className`/`data-*` attribute
your fix introduces, not on the atom-level tree update. This is what closes the actual coverage gap
the bug exposed: the mechanism gating pointer-events must itself be under test, not just the
handler behind it.

## Constraints

- No presentation-only tests. Assert real behavior (class presence, not exact string content).
- Don't touch `paneTreeAtomFamily`, `handleEdgeDrop`/`handleCenterDrop`, or any split/stack
  tree-update logic — scope is strictly the drop-zone visibility gate and its coverage.
- Match existing code style; don't reformat untouched lines.

## Verify before committing

```bash
npm run typecheck && npm run test:prepush
```

Never pipe test output through `tail`. Capture full output to a file in the scratchpad and read it.
If it fails, run `npm run test:last` to see cached failures rather than re-running blind.

Known false-positive tests to exclude from your pass/fail judgment (pre-existing, unrelated):
`AgentTranscriptPanel.listenerCleanup.test.tsx`, `MarkdownRenderer.rtl.test.tsx`,
`BodyDocCache.remountPaint.test.ts` (flaky under load — rerun isolated before treating as real).

## Commit

One commit, one-sentence subject, no `Co-Authored-By` line (repo CLAUDE.md forbids it). Example
shape: `fix(tiling): gate drop-zone pointer-events on a real react-dnd drag signal`. Do not touch
`CHANGELOG.md` in this task — that lands with task 2a.

## Success criteria

- `TiledRegion.css` no longer references `.mosaic.-dragging` anywhere.
- A real `useDragLayer`-derived class gates `.tiled-region-drop-zone` pointer-events.
- New/extended test proves the gating class toggles with an active `WINDOW` drag via the same
  event-driven path the existing `dropTile` helper uses.
- All existing `TiledRegion.test.tsx` / `TileHeaderBar.test.tsx` cases still pass, behavior
  unchanged.
- `npm run typecheck && npm run test:prepush` pass.
