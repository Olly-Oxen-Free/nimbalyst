# Task Brief: 2b

**Title:** Horizontal-layout CSS variant for top-docked project bar
**PRD:** project-bar-top-placement
**Priority:** must
**Complexity:** 3/10
**Model:** sonnet
**Wave:** 2
**Feature Issue:** N/A — this PRD is not tracked via a GitHub Issue (tracker `issue_key` is `null` in `status.json`; NIMBLE tracker item `plan_1787289447069_qb6yvp` is the plan record instead)

---

## Objective

Give the shared project-bar icon component (extracted by task 1b into `ProjectRailIcon.tsx`) a horizontal-layout CSS variant so it can render correctly when task 3a later docks the project bar into the top title bar instead of the left edge. This task only produces styling and the floating-ui placement logic that reacts to layout — it does not touch `App.tsx` or `WindowTopBar.tsx` (that structural merge is task 3a). Fulfills PRD requirement R7.

---

## Context

**Parent Feature:** Project Bar Top Placement (project-bar-top-placement) — no GitHub Issue exists for this PRD; see Feature Issue note above.

Today, `ProjectRail` is a fixed 56px vertical strip on the left showing circular project-initial avatars, styled entirely by `packages/electron/src/renderer/components/ProjectRail.css`. That stylesheet has **zero horizontal/row styles** — every geometry rule assumes a vertical column (fixed width, `flex-direction: column`, an absolutely-positioned left-edge active indicator). This PRD adds a setting that docks the same icons into the title bar at the top of the window instead. Because CSS-only flips can't turn a `width: 56px` column into a full-width row without stripping the assumptions baked into each selector, this task authors a parallel, horizontal-specific set of rules rather than trying to make the existing vertical rules conditional.

This task is part of **Wave 2** — it runs alongside 2a (settings UI) and 3a (structural merge into `WindowTopBar`) on disjoint files (per `execution_plan.yaml`'s `file_conflicts_checked.wave_2`), after 1b (Wave 1) has extracted `ProjectRailIcon.tsx` out of `ProjectRail.tsx`. 2b's ordering relative to 1b is **sequential, not parallel** — this task edits the file 1b creates.

### Pre-flight verification — 1b may not have landed yet

At the time this brief was generated, task 1b's own brief had not yet been written, and `packages/electron/src/renderer/components/ProjectRailIcon.tsx` **does not exist in the repository yet** — it is currently inline as the `ProjectRailIcon` function inside `packages/electron/src/renderer/components/ProjectRail.tsx:68-179`. Before starting this task, confirm 1b has actually landed and re-verify the following against the real file, since everything below is inferred from 1b's task definition (`tasks.yaml`), not from reading 1b's output:

1. **The component/prop name.** 1b's success criteria require "Extracted API accepts a layout/orientation prop so task 2b can style it for a horizontal context without a second implementation" — but the exact prop name (`layout`, `orientation`, `variant`, etc.) and its literal-union values (e.g. `'vertical' | 'horizontal'` vs `'left' | 'top'`) are 1b's implementation choice. Read the actual prop signature in `ProjectRailIcon.tsx` before writing any conditional className/placement logic against it.
2. **Where the floating-ui instances ended up.** As of the current (pre-1b) source, there are **four** `useFloating()` call sites in `ProjectRail.tsx`, not one:
   - Per-icon hover tooltip — inside `ProjectRailIcon` (current `ProjectRail.tsx:82-90`), `placement: 'right'`.
   - Per-icon right-click context menu — inside the parent `ProjectRail()` component (current `ProjectRail.tsx:372-378`), `placement: 'right-start'`, anchored to a virtual cursor-position reference, opened via the icon's `onContextMenu` callback prop.
   - Add-button (`+`) menu — inside `ProjectRail()` (current `ProjectRail.tsx:309-336`), `placement: 'right-start'`.
   - Add-button hover tooltip — inside `ProjectRail()` (current `ProjectRail.tsx:344-357`), `placement: 'right'`.

   1b's stated scope ("New shared icon component exports the same active-state, tooltip, close, and context-menu behavior currently inline in ProjectRailIcon") does not cleanly match the current file — the context-menu's `useFloating()` call is currently in the *parent* `ProjectRail()`, not inside `ProjectRailIcon`, even though the click handler that triggers it (`handleContextMenu`) is inside the icon. **After 1b lands, check whether all four `useFloating()` instances that need a downward-opening variant are actually reachable from `ProjectRailIcon.tsx`** (this task's only files_affected are `ProjectRail.css` and `ProjectRailIcon.tsx`). If the add-menu and/or context-menu floating-ui logic is still in `ProjectRail.tsx` after 1b's extraction, that logic is out of this task's declared file scope — flag this as a scope gap before proceeding rather than silently expanding `files_affected`, since R7 requires *all* tooltips and menus to reposition downward, not just the per-icon hover tooltip.
3. **Verify current line numbers before citing them elsewhere.** The task definition's `agent_context` in `tasks.yaml` cites `ProjectRail.css:73-81` for the vertical active-indicator rule. As independently verified while writing this brief, that rule is currently at **`ProjectRail.css:66-75`** (`.project-rail-item.is-active::before`), not 73-81 — the task definition's line numbers have drifted from source. Use the verified line numbers in this brief; re-verify again at execution time in case the file has changed further since this brief was written.

---

## Requirements

### 1. What "no styles reused as-is" means precisely

The task's success criteria call out three specific vertical-only rules in `ProjectRail.css` (verified current line numbers) that must **not** be reused for the top-docked case:

- **`.project-rail`** (`ProjectRail.css:1-14`) — `width: 56px`, `height: 100%`, `flex-direction: column`. This is the *rail container's* geometry. Note: the actual `<nav className="project-rail">` element lives in `ProjectRail.tsx`, which is **not** in this task's `files_affected` — task 3a owns building whatever wrapper markup renders inside `WindowTopBar` for the top-docked case. This task's job is to **author the horizontal container class(es) in `ProjectRail.css`** that 3a's markup will apply — you are producing the CSS contract 3a consumes, not wiring it into `WindowTopBar.tsx` yourself.
- **`.project-rail-item`** (`ProjectRail.css:17-31`) — fixed `width: 40px; height: 40px` per-icon box. Reusable as a *starting point* for sizing, but must become responsive (see Requirement 3) rather than a hardcoded 40×40 in the horizontal variant.
- **`.project-rail-item.is-active::before`** (`ProjectRail.css:66-75`) — the absolutely-positioned active indicator: `position: absolute; left: -10px; top: 8px; bottom: 8px; width: 4px;`, a vertical bar assuming a vertical rail. Do not reuse this rule for the horizontal case; if an active-state indicator is wanted in the horizontal layout, redesign it as a horizontal-appropriate treatment (e.g. an underline/bottom-border-style accent), or rely solely on the existing `.project-rail-item.is-active .project-rail-item-main` background/border-radius treatment at `ProjectRail.css:59-64`, which is not geometry-locked and *can* be reused as-is.

**Not barred from reuse:** the appearance-only rules — `.project-rail-item-main` fill/hover colors (`33-57`), `.project-rail-item-badge` (`77-96`), `.project-rail-item-close` (`98-124`), `.project-rail-context-menu`/`-item`/`-divider`/`-heading` (`162-212`), `.project-rail-tooltip`/`-name`/`-path` (`250-279`). None of these encode vertical-only geometry — they style colors, padding, and border-radius that apply equally in a horizontal layout. Reuse them by keeping the icon markup on the same base classes (see Requirement 5) rather than duplicating every rule under new selectors.

### 2. New horizontal layout classes

Author a parallel set of horizontal-layout rules in `ProjectRail.css` (or a variant block clearly separated with a comment header, e.g. `/* Horizontal / top-docked layout — see task 2b */`) covering, at minimum:

- A horizontal container class (naming is your choice, but pick something 3a's brief can hard-code — e.g. `project-rail-top` or `project-rail--top`) with `flex-direction: row`, no fixed `width`, and `overflow-x` handling appropriate for many icons in a narrow window (paired with the `@container` rule in Requirement 3). Actual bar height (38px) is owned by `WindowTopBar`/`MAIN_WINDOW_TITLE_BAR_HEIGHT`, not this task.
- A modifier for `.project-rail-item`/`.project-rail-item-main` that removes the vertical active-indicator dependency and adjusts spacing/gap for a row layout instead of a column.
- Document the exact class name(s) 3a must apply, in a comment at the top of the new block — this is the naming contract the next task depends on, so state it explicitly rather than leaving it implicit in the CSS.

### 3. `@container`-based responsive sizing (not `@media`)

Per `docs/UI_PATTERNS.md`, this repo requires `@container` queries for responsive layout — `@media` queries don't respond to actual panel/container width, and the top-docked bar's available width varies with window size and how many other title-bar elements are present. Existing precedent (`packages/electron/src/renderer/components/TrackerMode/TrackerDocumentView.css:5-10, 21-24, 30-38`):

```css
.tracker-document-view-list-pane {
  container-name: tracker-document-list-pane;
  container-type: inline-size;
}

@container tracker-document-list-pane (max-width: 420px) {
  .tracker-document-view-list-pane .tracker-table-row {
    /* narrower-width rules */
  }
}
```

Apply the same pattern here: set `container-type: inline-size` (and a `container-name`) on the new horizontal container class from Requirement 2, then add one or more `@container` rules that either shrink the circle size/spacing or truncate the expanded active-project name before the row overflows horizontally when many projects are open in a narrow window. (Rendering the "expanded name" text itself is 3a/4a's job — this task only needs the CSS truncation/sizing rule ready for when that text exists; use a class like `.project-rail-top-name` as a hook, documented alongside the container class contract from Requirement 2.)

### 4. Floating-ui placements: open downward, not sideways

For every `useFloating()` instance this task's file scope reaches (see Pre-flight Verification item 2), the floating placement must change from the current side-opening configuration to a downward-opening one **when the component is in horizontal/top-docked layout**, driven by the layout/orientation prop 1b's extraction added. Using the current (pre-1b) call sites as reference:

| Current call site | Current `placement` | Horizontal-mode `placement` |
|---|---|---|
| Icon hover tooltip | `'right'` | `'bottom'` |
| Icon context menu (virtual cursor anchor) | `'right-start'` | unchanged — already follows the click point, not a fixed side of the icon. Re-verify this is still true post-1b-extraction. |
| Add-button `+` menu | `'right-start'` | `'bottom-start'` |
| Add-button hover tooltip | `'right'` | `'bottom'` |

Keep `windowControlsClearance()` in the middleware chain for every instance (R7 requires "still `@floating-ui/react` + `FloatingPortal` + `windowControlsClearance()`") — do not remove it. `offset()`/`flip()`/`shift()` padding values can stay as-is unless testing shows they clip against the new anchor geometry. Do **not** hand-roll `position: fixed` math — `.claude/rules/floating-ui.md` and this repo's `CLAUDE.md` forbid it; switching `placement` is the correct floating-ui-native way to reposition.

### 5. Stable DOM markers

Per `docs/REACT_DOM_MARKERS.md` and this task's own `agent_context`, keep a stable kebab-case class on the icon's root element in the horizontal layout too — do not fall back to a utility-class-only root. The existing vertical root already carries `project-rail-item` (`ProjectRail.tsx:132`, moving into `ProjectRailIcon.tsx` via 1b); when horizontal, keep that same base class and add a modifier class rather than replacing it, so `data-testid="project-rail-item"` and any existing selectors targeting `.project-rail-item` keep working in both layouts.

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] No styles from `ProjectRail.css` (`width: 56px`, `flex-direction: column` on `.project-rail`, or the `left: -10px` absolutely-positioned active indicator on `.project-rail-item.is-active::before`, verified at `ProjectRail.css:66-75`) are reused as-is for the top-docked case
- [ ] An `@container` query adjusts circle size/spacing or truncates the expanded name before horizontal overflow at narrow window widths, using `container-type: inline-size` on the new horizontal container class (not `@media`)
- [ ] Tooltip and context-menu floating-ui placements are configured to open below the bar, not beside it, when the component is in horizontal/top-docked layout (verify against 1b's actual layout/orientation prop and actual floating-ui call-site locations — see Pre-flight Verification)
- [ ] Only canonical `--nim-*` CSS variables are used (no ad hoc hex/px values duplicating existing color tokens) — see the CSS Variables reference below
- [ ] `npm run typecheck` passes
- [ ] Left-docked (vertical) rendering is unchanged — no existing `.project-rail*` selector's vertical-layout behavior was altered, only new horizontal-specific rules added

**All criteria must pass before task is complete.**

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/electron/src/renderer/components/ProjectRail.css` | modify | Add a horizontal-layout rule block (container class, item modifier, `@container` responsive rules) alongside the existing vertical rules; do not remove or alter existing vertical selectors |
| `packages/electron/src/renderer/components/ProjectRailIcon.tsx` | modify | Consume the layout/orientation prop added by 1b to (a) apply the new horizontal modifier class(es) conditionally, and (b) switch each reachable `useFloating()` instance's `placement` from side-opening to bottom-opening per Requirement 4 |

### File Ownership Notes

Per `execution_plan.yaml`'s `file_conflicts_checked.wave_2_note`: "2b edits `ProjectRailIcon.tsx` created by 1b in wave 1 — ordering, not conflict." This task must run after 1b completes, not in parallel with it. `ProjectRail.css` is also touched later by 4a (Wave 3) and 4b (Wave 4) — per `execution_plan.yaml`'s `wave_3`/`wave_4` notes, those tasks are serialized after this one specifically because they share `ProjectRail.css`/`ProjectRailIcon.tsx`/`WindowTopBar.tsx` with this task's output. **The class names and container-query contract you choose here are load-bearing for 3a, 4a, and 4b** — document them clearly (a comment block at the top of the new CSS section is sufficient) so those tasks don't have to reverse-engineer your naming.

---

## Deliverables

None beyond the files above. The naming contract for the new horizontal CSS classes (Requirement 2/3) must be documented as a comment inside `ProjectRail.css` itself — it is not a separate artifact, but its absence would leave task 3a unable to know which class(es) to apply without re-reading this task's diff.

---

## Implementation Guidance

### Patterns to Follow

- `@container` responsive pattern: `packages/electron/src/renderer/components/TrackerMode/TrackerDocumentView.css:5-10, 21-24, 30-38` (cited in full under Requirement 3).
- Floating-ui + `windowControlsClearance()` pattern: current `ProjectRail.tsx:82-90` (tooltip), `309-339` (add menu), `344-357` (add tooltip), `372-379` (context menu) — re-locate these in `ProjectRailIcon.tsx` post-1b-extraction and adjust only the `placement` value per Requirement 4, keeping the rest of the middleware chain (`offset`, `flip`, `shift`, `windowControlsClearance()`) intact.
- Existing color-token usage convention: every existing rule in `ProjectRail.css` follows `var(--nim-x, #fallbackhex)` — e.g. `background-color: var(--nim-bg-secondary, #1a1a1a)` (`ProjectRail.css:10`). Match this exact convention (var + matching fallback hex, not a bare hex) for any new rule that sets a color.

### Code Style

**Canonical `--nim-*` CSS variables** (per `docs/UI_PATTERNS.md`, "CSS Variables: Canonical Naming Reference" — the only valid names for the categories relevant to this component), cross-referenced against how `ProjectRail.css` already uses them:

| Variable | Usage in this component |
|---|---|
| `--nim-bg-secondary` | Rail/bar background, tooltip/menu border-contrast surface (`ProjectRail.css:10, 87, 105, 172`) |
| `--nim-bg-tertiary` | Icon circle default fill, close-button hover-state background (`ProjectRail.css:41, 153`) |
| `--nim-text` | Icon-circle text on non-active state, tooltip/menu text, badge label ink where applicable (`ProjectRail.css:106, 188, 253, 270`) |
| `--nim-text-muted` | Secondary/path text in tooltip and context menu, add-button icon color (`ProjectRail.css:141, 211, 233, 276`) |
| `--nim-primary` | Active/hover accent fallback for `--rail-item-accent`, badge fill, context-menu hover fill (`ProjectRail.css:42, 55, 61, 86, 195`) |
| `--nim-border` | Rail border, tooltip/menu/divider borders (`ProjectRail.css:11, 107, 129, 145, 173, 201, 258`) |
| `--nim-error` | Close-button hover state (`ProjectRail.css:122`) |

`--nim-on-primary` also appears in the current file (`ProjectRail.css:91, 196`, both for text-on-filled-accent-circle color) — it is **not** in `UI_PATTERNS.md`'s canonical table, but it is a real, widely-used token elsewhere in this codebase (40+ files reference it, e.g. `packages/electron/src/renderer/index.css`). Treat it as legitimate for any new horizontal-layout rule that needs "text color on a filled accent background," consistent with existing usage in this same file — do not invent a substitute.

Sizing/spacing values (`40px`, `8px`, `gap`, etc.) have no canonical `--nim-*` token equivalent in this codebase — the "no ad hoc hex/px values" success criterion applies to **colors**, not dimensions. Ad hoc pixel values for layout geometry are consistent with the rest of `ProjectRail.css` and are fine to use in the new rules.

### Edge Cases

- **Single open project, position = top:** the container/`@container` rules must not visually break with only one icon present (no overflow, no empty-state artifacts from the row-layout gap/flex rules).
- **Many open projects (up to the existing 8-project cap, see `ProjectRail.tsx`'s `atCap`/`isOpenProjectsAtCapAtom`), narrow window:** this is the primary `@container` scenario — verify the chosen breakpoint(s) actually trigger before 8 icons at 40px + gaps overflow a plausible narrow-window title-bar width.
- **Tooltip/menu clipped by window edge on the right or left when opening downward:** `flip`/`shift` middleware already handles this generically; do not add manual edge-detection logic on top of it.

### Testing Requirements

This PRD defers all tests to a dedicated end-of-work task (5a), per explicit user direction recorded in the PRD's Orchestration note — this overrides the repo's default "tests ship with the behavioral change" convention for *task sequencing* in this PRD only. **Do not write tests in this task.** Task 5a's file scope (`openProjects.test.ts`, `AdvancedPanel.test.tsx`, `WindowTopBar.test.tsx`) does not currently name a dedicated test file for `ProjectRailIcon`/`ProjectRail.css` — if 5a's actual coverage doesn't reach the horizontal-layout classes/placement logic added here, that is a gap for 5a's own brief to resolve, not something to preempt in this task. Still run `npm run typecheck` before finishing, per the success criteria above.

---

## Boundaries

### Files You MUST NOT Touch

Per `.nimble/config.yaml` `boundaries.never_touch` (global list): `*.lock`, `package-lock.json`, `.env*`, `packages/electron/src/database/migrations/*`, `dist/`, `out/`, `out2/`, `release/`, `node_modules/`, `.nimbalyst/`, `.dolt/`, `*.db`, `packages/electron/index.js`, `packages/electron/resources/bundled-extensions/*.nimext`. None of these overlap with this task's file set.

### Files Requiring Review

Per `.nimble/config.yaml` `boundaries.require_review`: `packages/collabv3/*`, `packages/electron/src/main/**`, `packages/electron/src/database/**`, `scripts/run-workspace-script.mjs`, `scripts/install-git-hooks.mjs`. This task's two files (`ProjectRail.css`, `ProjectRailIcon.tsx`) are both renderer-side and do **not** fall under `require_review` — no special review flag applies here, unlike task 1a's main-process files.

---

## Dependencies

### Upstream Tasks

| Task | What it provides | Verify before starting |
|------|------------------|------------------------|
| 1b | `ProjectRailIcon.tsx` (new file, extracted from `ProjectRail.tsx:68-179` plus container-level add/close/capacity logic), with a layout/orientation prop for styling in a horizontal context | Confirm the file exists, read its actual prop signature and the current location of all `useFloating()` calls per Pre-flight Verification above — do not assume the shape matches this brief's inferred description |

### Downstream Impact

Tasks that depend on this one (directly or via shared files, per `execution_plan.yaml`):

| Task | What it needs from 2b |
|------|------------------------|
| 3a (merge into `WindowTopBar`) | The horizontal container class name(s) and `@container` contract authored here, to apply when rendering the rail inside `WindowTopBar` for `position = 'top'` |
| 4a (circle-to-text animation) | The horizontal sizing/spacing this task establishes, as the base state the expand-in-place animation transitions from/to |
| 4b (hover-reveal) | The same horizontal layout classes, reused when toggling icon visibility on hover |

**Before starting:** Verify 1b is complete by confirming `ProjectRailIcon.tsx` exists and exposes a layout/orientation prop (see Pre-flight Verification, item 1). Do not start against the current inline `ProjectRail.tsx:68-179` shape — it will not exist in that form once 1b lands.

---

## GitHub Context

**Issue:** N/A — this PRD is not tracked via GitHub Issues (see Feature Issue note in the header)
**Feature Issue (Parent):** N/A
**Branch:** `worktree/project-bar-movement` — this PRD uses a single shared feature branch for all 8 tasks (per `status.json`'s `branch_strategy: "use-worktree-branch-directly"` and the PRD's explicit orchestration decision). Do not create a per-task branch.
**Target:** Determined by PM agent — per this PRD's single-integration-review orchestration, this task's commit lands on the shared feature branch, not directly on `main`.

---

## Commit Guidelines

Use Conventional Commits. Keep the subject to one sentence, per this repo's `CLAUDE.md` commit-message rule:

```
feat(electron): add horizontal-layout CSS variant for top-docked project bar
```

Do NOT add a `Co-Authored-By: Claude` trailer — this repo's `CLAUDE.md` explicitly says not to.

Types: feat, fix, refactor, test, docs, chore

**CHANGELOG.md:** Per this repo's `CLAUDE.md`, only update `CHANGELOG.md` when explicitly asked to propose a commit, and only with a user-facing line. This task alone has no user-visible effect (nothing renders the horizontal layout until task 3a merges it into `WindowTopBar`) — if a CHANGELOG entry is requested for the overall PRD, it belongs on whichever task ships the visible feature (3a or the final integration commit), not on this task alone. Do not add scaffolding-only bullets (CSS class names, floating-ui placement values) to the CHANGELOG.

---

## Validation Checklist

Before creating PR / handing off for the integration review:
- [ ] All success criteria met
- [ ] Build passes: `npm run build`
- [ ] Type check passes: `npm run typecheck`
- [ ] No `never_touch` files modified
- [ ] No tests added in this task (deferred to 5a per PRD orchestration) — confirm this is intentional, not an oversight, if a reviewer flags it
- [ ] Branch is the shared feature branch `worktree/project-bar-movement`, not a new per-task branch

---

*Generated by NIMBLE Brief Writer*
*PRD: project-bar-top-placement | Task: 2b | Wave: 2*
