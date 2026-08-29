# External Research Findings: native-tile-system

Scope note: given this is a background/cost-constrained dispatch, external research was limited to
a dependency-tree and known-library evaluation pass (no live web search performed). This should be
treated as a starting point, not exhaustive -- the implementer for the split-pane engine task
should re-verify current release status before pinning a version.

## Candidate libraries for the split-pane/tiling engine

Evaluated for fit against the niri-style requirement: drag-to-edge binary/n-ary splits, plus
tab-stacking within a split region.

| Library | Splits | Tab-stacking as first-class node | Verdict |
| --- | --- | --- | --- |
| `react-mosaic-component` | Binary tree (v6) / n-ary (v7 beta) | Yes -- native | **Recommended** |
| `react-resizable-panels` | Flat resizable splits | No | Would require hand-building tab-stack + spatial-drop logic on top |
| `allotment` | Flat resizable splits | No | Same gap as above |
| `golden-layout` | n-ary + tabs | Yes | Viable alternative; heavier, more opinionated DOM/CSS ownership (less React-idiomatic than react-mosaic) |
| `react-rnd` / `react-grid-layout` | Free-form/grid, not binary-split | No | Wrong model -- these are absolute-position/grid layouts, not tiling window managers |

## Recommendation

Adopt `react-mosaic-component`. It is the closest existing match to the niri/i3-style manual
binary-split-with-stacking model described in the feature request, avoiding a hand-built
binary-tree layout engine (the most architecturally risky part of this PRD if built from scratch).

**Open item for planning/implementation:** react-mosaic v7 (n-ary tree model) was in beta at
research time; v6 (binary tree) is the last stable major. Confirm current release status and pick
a version before the split-pane engine task starts -- this PRD should not block planning on it, but
the task brief must call it out as a pre-implementation check.

## Styling/positioning

`@floating-ui/react` (already mandated, already a dependency) covers any new dropdown/context menu
the per-tile tab strips need. It does not apply to react-mosaic's own drag/drop/resize internals,
which are a distinct concern.
