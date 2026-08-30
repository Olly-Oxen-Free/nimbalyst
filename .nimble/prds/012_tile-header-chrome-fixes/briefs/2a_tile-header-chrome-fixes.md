# Task 2a — Minimize/expand pane chrome: chevron control collapses a pane's body, headers stay visible

Repo: `/home/jayden-eppcohen/Documents/Projects/Software/nimbalyst`. Branch:
`feature/tile-header-chrome-fixes` (already has task 1a's commit). Working directly on the shared
checkout — **no worktree, no PR, no `gh` command, ever.** Commit your own work when done.

## Requirement

User's live-test report: "the header is not also functioning as the chrome in that window. it
should be a minimize/expand kind of chrome header." Today a header slot's only interaction is
`onClick={() => setActiveTile({ kind: ref.kind, id: ref.id })}` in
`packages/electron/src/renderer/components/AgentMode/TiledRegion.tsx`'s `TilePane` component
(~lines 194-242) — it switches which occupant is focused within that pane's stack. There is no
collapse/expand affordance anywhere.

## Design (already decided — implement as specified, don't re-litigate)

Add a dedicated chevron/disclosure control to `TileHeaderBar`
(`packages/electron/src/renderer/components/AgentMode/TileHeaderBar.tsx`), visually and
functionally distinct from the existing close (✕) button and the drag grip (⋮⋮). Clicking the
chevron toggles collapse for the **whole pane** the tile belongs to — every tile in that pane's
header stack, not just the one clicked. A collapsed pane keeps every stacked header visible and
clickable while its content area collapses to zero height/width (niri-style). The pane's five drop
zones (four edges + center, `TileDropZone` in `TiledRegion.tsx`) must keep working while collapsed
— collapsing hides content, it does not remove the pane from the tree or make it undroppable.

## Implementation

1. **State.** In `packages/electron/src/renderer/store/atoms/agentMode.ts`, add
   `paneCollapsedAtomFamily`. Read `paneTreeAtomFamily` (~line 389) and `tilePaneAtomFamily`
   (~line 401) first and follow their exact shape: `atomFamily((_key: string) => atom(...))`,
   session-lifetime only, no persistence middleware. Key it the same way
   `activeTileKey`/`tilePaneKey` key their families (check those helper functions, ~lines 372-381,
   before inventing a new keying scheme).

2. **Control.** Add the chevron as a new button in `TileHeaderBar.tsx`, in the same header row as
   the existing close button (~lines 120-154). It needs a click handler that toggles
   `paneCollapsedAtomFamily` for the pane this tile is in — thread whatever prop
   `TileHeaderBarProps` needs. Check how `TiledRegion.tsx`'s `headerProps` callback (~lines
   359-381) already builds `TileHeaderBarProps` per tile and extend that shape (it has `sessionId`
   available; you likely need the pane id too — thread it through the same path rather than
   inventing a parallel one).

   The chevron's click must **not** also trigger `TilePane`'s header-slot `onClick={() =>
   setActiveTile(...)}` (which sits one level up, wrapping each header in
   `.tiled-region-header-slot`, ~line 200-204 of `TiledRegion.tsx`). Look at how the existing close
   button already avoids double-firing that focus-switch onClick — `TileHeaderBar.test.tsx`'s
   existing close-button test shows the pattern (event propagation handling) to replicate for the
   chevron.

3. **Collapse rendering.** In `TiledRegion.tsx`'s `TilePane`, read `paneCollapsedAtomFamily` for
   this pane and apply the result to the `.tiled-region-body` container (~line 209): when
   collapsed, hide it via CSS only (e.g. a `data-collapsed="true"` attribute or a class, toggled to
   `display: none` / zero height in `TiledRegion.css`). **Never conditionally render or unmount**
   `.tiled-region-pane` children (~lines 210-227) — every occupying tile's body must stay mounted
   through a collapse exactly as it already stays mounted through a focus switch. This file's own
   header comment states the invariant explicitly ("Every occupying tile stays mounted... Switching
   focus must not remount a transcript view"); a collapse is not an exception to that rule. The
   five `TileDropZone` children (~lines 229-239) must remain rendered and functional regardless of
   collapsed state — do not gate them on the collapse flag.

4. **CSS.** Update `TiledRegion.css` for whatever collapsed-state selector you introduce (parallel
   to how `.tiled-region-body`/`.tiled-region-pane` are already styled, ~lines 118-133).

5. **CHANGELOG.** Add exactly one bullet to the `[Unreleased]` section of `CHANGELOG.md` at the
   repo root. User-facing only — no internal symbol names (no "TileHeaderBar", no "atomFamily", no
   "react-dnd", no "Mosaic"). Example shape: "Tiled agent panes can now be collapsed to just their
   header, freeing space without closing anything." Match the existing terse one-line-bullet style
   in `[Unreleased]` — see recent entries for voice.

## Tests

Extend the existing files — do not create new ones:

- `TileHeaderBar.test.tsx`: chevron renders; clicking it calls the collapse toggle for the correct
  pane; clicking it does not also fire the header-slot's focus `onClick`.
- `TiledRegion.test.tsx`: collapsing a pane hides `.tiled-region-body`'s content via the
  CSS/attribute mechanism you introduced while `.tiled-region-pane` bodies remain present in the
  DOM (assert DOM presence + the style/attribute, not just the atom's value — follow the existing
  "hide-not-unmount" assertion pattern this file already uses for focus switches, e.g. the test
  around line 166 and the center-drop-stack test around line 221); expanding again does not
  remount or refetch (same no-remount assertion style already used in this file).

No presentation-only assertions (icon glyph text, exact pixel styling). No `readFileSync` +
`toContain` source assertions. Follow repo testing rules in `CLAUDE.md` generally.

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

One commit, one-sentence subject, no `Co-Authored-By` line. Include the `CHANGELOG.md` update in
this same commit. Example shape: `feat(tiling): add minimize/expand chrome to tile header panes`.

## Success criteria

- `paneCollapsedAtomFamily` exists in `agentMode.ts`, following the established atomFamily pattern.
- `TileHeaderBar` has a chevron control distinct from close and the drag grip.
- Clicking the chevron toggles collapse for the whole pane, not just one tile.
- Collapsing hides the pane body via CSS/attribute only — no tile body is ever unmounted.
- Drop zones remain functional on a collapsed pane.
- `CHANGELOG.md` has exactly one new user-facing `[Unreleased]` bullet, no internal symbol names.
- `npm run typecheck && npm run test:prepush` pass.
