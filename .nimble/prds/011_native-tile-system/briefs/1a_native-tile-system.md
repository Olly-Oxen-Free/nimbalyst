# Task 1a: Evaluate and pin react-mosaic-component version; add as a dependency

PRD: native-tile-system (011) | Wave: 1 | Complexity: 2/10 | Model: sonnet

## Execution mode (read first)

This PRD uses a **worktree-free-local** cadence: NO git worktrees, NO PRs, NO `gh`. Edit files
directly in the repo at its current path, on branch `feature/native-tile-system` (already checked
out by the coordinator). **Do NOT run any git commands** (no `git add`, `git commit`, `git checkout`,
`git worktree`) — the coordinator reviews your diff and commits it after you finish. Do not create
a branch, do not create a PR.

## Task

Research recommends adopting `react-mosaic-component` as the split-pane/tiling engine (see
`.nimble/prds/011_native-tile-system/research/summary.md`). At research time it was mid-migration:
v6 is the last stable release with a binary-tree layout model; v7 was in beta with an n-ary tree
model.

Before adding the dependency: re-check the current published version and changelog (npm view, or
the package's GitHub releases). Pick v6 (binary, stable) unless v7 has since reached a stable
release AND its n-ary model is confirmed compatible with this PRD's binary-split-plus-stacking
requirement (n-ary is a superset of binary, so it should be compatible, but verify the API surface
— particularly `MosaicWindow`/tab-group support — before committing).

Add the chosen version to `packages/electron/package.json` (this is a `require_review` path per
`.nimble/config.yaml` — package.json changes need review, so flag this clearly in your summary).
Verify it installs cleanly and its peer-dependency React version range covers this repo's React
version (this repo is on React 19 — confirm `packages/electron/package.json`'s exact pinned
version). Check react-mosaic's transitive dependencies (commonly `react-dnd`/
`react-dnd-html5-backend` for libraries in this space — verify, do not assume) for React 19
compatibility specifically — this is the single most likely cause of this task failing outright,
more likely than the mosaic package's own peer range.

Two claims from research were NOT verified against a live source (research explicitly notes "no
live web search performed") and are load-bearing for later tasks — verify both before finishing
this task, not by accident later:

1. **Tab-group-as-first-class-node claim.** Research's build-vs-adopt recommendation rests on
   react-mosaic modeling "tab groups as a first-class node type." Confirm this against the
   library's actual current docs/API (e.g. `MosaicWindow`'s tab-group support, or whatever the
   current API calls it). Note: this PRD's design does NOT depend on the library providing native
   tab groups — the relocated `SubAgentChipRow` switcher (task 3a) already provides stacking
   independently of react-mosaic's own tab-group feature, hosted inside a single mosaic leaf. If
   the claim turns out to be false, the library recommendation likely still holds (the split/resize
   engine is still the valuable, hard-to-hand-build part) — but confirm this deliberately and
   record the corrected rationale in your summary rather than letting it be discovered accidentally
   during task 5a/6a.
2. **Drag-and-drop system compatibility — load-bearing, not just informational.** Confirm what DnD
   mechanism react-mosaic uses internally for its own split/drop zones (commonly `react-dnd` for
   libraries in this space — verify, do not assume). Task 3a is NOT reusing an existing draggable
   component (`SubAgentChipRow`'s chips are plain, non-draggable `<div>`s today — confirmed by
   reading the source, no `draggable`/`dataTransfer` wiring exists) — task 3a must build
   drag-source capability on the chip from scratch. **Your job is to determine WHICH mechanism 3a
   should build with:** native HTML5 `dataTransfer` (consistent with `TabBar`'s existing reordering
   elsewhere in the app, but not directly reusable here since the chip isn't `TabBar`), or
   `react-dnd`'s `useDrag` (if react-mosaic's own drop zones only recognize `react-dnd` drag
   sources, a native HTML5 drag will not register as a valid drop source and 3a/5a would need a
   bridging adapter). **State the answer explicitly and prominently in your final summary** — the
   coordinator will paste it verbatim into task 3a's spawn prompt.

## Tests

None required for a dependency addition alone (no runtime behavior yet). If the package ships its
own type definitions, verify `npm run typecheck` passes with a trivial smoke import.

## Success criteria

- react-mosaic-component is added to `packages/electron/package.json` at a deliberately chosen,
  documented version
- `npm install` succeeds and `npm run typecheck` is unaffected
- Your summary explicitly states which DnD mechanism (native HTML5 vs react-dnd) task 3a must build
  the chip's drag-source with, and why

## Files affected

- `packages/electron/package.json`
- `package-lock.json`

## House rules (apply throughout this PRD)

- Rules of Hooks: never combine two `useAtomValue`/hook calls with `||`/`&&` short-circuit — call
  both unconditionally, combine booleans after (a real crash earlier this session came from this).
- @floating-ui/react is mandatory for any new popover/dropdown/context-menu positioning — never
  manual `position: fixed` math. (Not expected to apply to this task.)
- Stateful editors (Monaco/Lexical/RevoGrid) must never remount on tile visibility toggle within a
  stack — hide via CSS/display, don't unmount. (Not expected to apply to this task.)
- Runtime behavior changes ship with a red-first unit test — not applicable here (dependency-only
  task, no runtime behavior).
- Do not touch CHANGELOG.md — that is task 11a's job only.
