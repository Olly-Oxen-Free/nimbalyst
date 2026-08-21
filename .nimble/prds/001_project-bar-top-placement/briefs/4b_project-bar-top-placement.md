# Task Brief: 4b

**Title:** Hover-reveal for non-selected project circles
**PRD:** project-bar-top-placement
**Priority:** must
**Complexity:** 3/10
**Model:** sonnet
**Wave:** 4
**Feature Issue:** N/A — this PRD is not tracked via a GitHub Issue (`status.json` has `tracker.issue_key: null`; NIMBLE tracker item `plan_1787289447069_qb6yvp` is the plan record instead)

---

## Objective

When the persisted `projectRailExpandedDisplayAtom` setting is `'hover-reveal'`, hovering anywhere over the top-docked project bar must reveal the other open-project circles (hidden by default, showing only the active project's expanded name); moving the mouse off the bar hides them again. This closes out R8 — the last of the three top-docked interaction requirements (R4-R6 in 3a, R9 in 4a, R8 here).

---

## Context

**Parent Feature:** Project Bar Top Placement (project-bar-top-placement) — no GitHub Issue exists for this PRD; see Feature Issue note above.

Today, `ProjectRail` (`packages/electron/src/renderer/components/ProjectRail.tsx`) is a fixed 56px vertical strip on the left showing circular avatars for every open project, always visible. This PRD adds a setting that docks that content into the title bar (`WindowTopBar`) at the top of the window instead, with the active project's circle expanding into full name text. A second, independent setting (`projectRailExpandedDisplay`) controls whether, in the top-docked layout, the *other* open projects' circles are always visible alongside the active project's name, or hidden until the user hovers the bar. This task implements the `'hover-reveal'` branch of that second setting.

This task is part of **Wave 4** — the final feature-behavior wave before the dedicated test task (5a). It depends on 3a (the structural merge into `WindowTopBar`), 2b (the horizontal CSS variant, since the revealed circles need horizontal-layout styling to sit correctly next to the expanded name), and 4a (the circle-to-text expand animation, since 4a lands in Wave 3 and touches the exact same two files — `WindowTopBar.tsx` and `ProjectRail.css` — that this task also touches; the dependency exists to avoid a same-branch file conflict, not because 4a's animation logic is a functional prerequisite for hover-reveal itself).

**Critical pre-condition — verify before writing any code:** 3a, 2b, and 4a do not have their briefs generated yet as of this writing (only 1a's brief exists in `.nimble/prds/001_project-bar-top-placement/briefs/`). This brief's guidance below is written against the **current, unmerged** shape of `WindowTopBar.tsx` and `ProjectRail.css` (read directly from the repo at brief-generation time — see line refs below) because that is the only ground truth available. By the time this task executes, 3a will have restructured `WindowTopBar.tsx`'s `window-top-bar__identity` block to render project circles instead of static text, 2b will have added horizontal-layout CSS classes to `ProjectRail.css` (or a new stylesheet), and 4a will have added expand-in-place animation classes/state to the same two files. **Before implementing, re-read the actual current state of both files** — do not assume the line numbers or class names cited in this brief still match; they describe pre-3a/2b/4a state as a reference point for the underlying mechanics (drag-region handling, atom names, existing CSS variable conventions), not the exact code you will be editing.

---

## Requirements

Implement the `'hover-reveal'` branch of R8 in the top-docked `WindowTopBar`:

1. When `projectRailExpandedDisplayAtom === 'hover-reveal'`: by default (not hovering), only the active project's expanded name (built by 4a) is visible. The other open-project circles are not visible.
2. Hovering anywhere over the top project-bar area reveals the other circles. They must be genuinely clickable while revealed — clicking one switches the active project via the same write path 3a wired to `activeWorkspacePathAtom`.
3. Moving the mouse off the bar area hides the revealed circles again.
4. When `projectRailExpandedDisplayAtom === 'always-visible'` (the default persisted value from 1a), this task changes nothing — all open-project circles stay visible regardless of hover state, exactly as 3a/2b built them.
5. No keyboard or touch equivalent reveal path is required in this pass — this is an accepted, explicit known limitation (PRD Open Questions Q1), not an oversight to silently fix.

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] When display mode = 'hover-reveal', only the expanded selected-project name shows by default
- [ ] Hovering the top bar area reveals the other open-project circles; they remain clickable to switch projects while revealed
- [ ] Moving the mouse off the bar hides the revealed circles again
- [ ] When display mode = 'always-visible' (default), all open-project circles remain visible regardless of hover state — no regression to that mode

**All criteria must pass before task is complete.**

Additional non-regression bar (not in the PRD's literal success-criteria list, but required by this task's `agent_context` and the PRD Risk table — do not skip):

- [ ] Window-dragging from empty bar space still works after the hover listener/state is attached — verify manually, not just by reading the code, per this repo's `end-to-end-verification.md`
- [ ] `npm run typecheck` passes

---

## Deliverables

None beyond the files above.

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/electron/src/renderer/components/WindowTopBar/WindowTopBar.tsx` | modify | Add hover-state tracking over the top-docked bar area (or a CSS-only `:hover` reveal — see Implementation Guidance) and conditionally render/reveal non-selected project circles when `projectRailExpandedDisplayAtom === 'hover-reveal'` |
| `packages/electron/src/renderer/components/ProjectRail.css` | modify | Add the hidden/revealed visual states (opacity, pointer-events, transition) for non-selected circles in the top-docked, hover-reveal case |

### File Ownership Notes

Both files are also touched by 3a (structural merge), 2b (horizontal CSS), and 4a (expand animation) — all three land in earlier waves (2, 2, 3 respectively) and this task (wave 4) is explicitly ordered after all three via `depends_on: ["3a", "2b", "4a"]` specifically to avoid a same-wave file conflict on the shared branch (`worktree/project-bar-movement` — single feature branch, no per-task branch, per PRD orchestration). Read the actual post-4a state of both files before editing; do not diff against the line numbers cited in this brief.

`WindowTopBar.tsx` is not itself a `require_review`-boundary file under `.nimble/config.yaml` (only `packages/electron/src/main/**` and a short explicit list are) — no special review flag beyond the PRD's single end-of-work integration review.

---

## Implementation Guidance

### Patterns to Follow

**Drag-region mechanics — read `dragRegion.ts` in full before touching hover logic:**

```ts
// packages/electron/src/renderer/components/WindowTopBar/dragRegion.ts
export const DRAG_REGION = '[-webkit-app-region:drag]';
export const NO_DRAG_REGION = '[-webkit-app-region:no-drag]';
```

The file's own doc comment is load-bearing context: `-webkit-app-region` is not inherited, and Blink only subtracts rectangles that declare `no-drag` explicitly — "anything interactive painted over the drag strip must opt out itself or the OS window manager consumes the click before the renderer sees it" (NIM-2243, GitHub #1052). `WindowTopBar`'s root `<header>` currently carries `DRAG_REGION` on the whole bar (`WindowTopBar.tsx:510` as of brief-generation time); interactive children opt out individually with `NO_DRAG_REGION` (see the existing `window-top-bar__new-session` button, `WindowTopBar.tsx:564`, for the exact class-composition pattern: `` `${CONTROL_BASE} ${CONTROL_PRIMARY} ${NO_DRAG_REGION}` ``).

`-webkit-app-region: drag` affects *click* semantics (the OS intercepts the drag gesture before a click completes), not general DOM pointer events — `mouseenter`/`mouseleave`/`mousemove`/CSS `:hover` still fire normally over a drag region. This means hover-state tracking itself is not the fragile part; **what's fragile is the revealed circles' click targets**, which 3a already had to solve for the always-visible case (3a's success criteria explicitly required overriding `window-top-bar__identity`'s `pointer-events-none` and adding `NO_DRAG_REGION` to every interactive element — `WindowTopBar.tsx:529` as of brief-generation time). Confirm 3a's actual solution (it may render circles outside the `pointer-events-none` container entirely, or override it locally) and make sure the hover-revealed circles inherit whichever fix 3a applied — a circle that is visually revealed but still sitting inside an un-overridden `pointer-events-none` ancestor, or missing `NO_DRAG_REGION`, will look interactive and silently not be.

**Two implementation shapes to choose between — pick based on what 4a actually shipped:**

1. **CSS-only `:hover` reveal.** Wrap the revealed-circles group in a container with a stable class (e.g. `project-bar-top__others`), and gate visibility with `.project-bar-top:hover .project-bar-top__others { opacity: 1; pointer-events: auto; }` (default `opacity: 0; pointer-events: none;`). This needs no React state, cannot desync from actual mouse position, and cannot interfere with the drag region's own event handling since it never attaches a JS listener to the drag-region element. Prefer this shape unless 4a's animation state machine already needs a JS-driven class for the expand transition, in which case reusing that same state for reveal (see option 2) avoids two independent state sources fighting over the same DOM.
2. **JS-tracked hover state** (`onMouseEnter`/`onMouseLeave` on the bar's identity container, a local `useState<boolean>`, applied as a data attribute or conditional class). Necessary only if the reveal state needs to coordinate with something CSS alone can't express (e.g., gating on `projectRailExpandedDisplayAtom` itself, which does need a JS read regardless — the mode check happens in JS either way, only the hover *tracking* can be CSS-only).

Either shape must still gate on `useAtomValue(projectRailExpandedDisplayAtom)` (`'hover-reveal'` vs `'always-visible'`) — that check is unavoidably JS since it reads a Jotai atom. In `'always-visible'` mode, skip the hidden/revealed CSS entirely (render circles with normal, unconditional visibility) so criterion 4 has zero coupling to the hover mechanism.

**Existing precedent for `pointer-events`-gated reveal-on-hover in this codebase:** `.project-rail-item-close` (`ProjectRail.css:98-119`) — hidden by default (`display: none`), shown via `.project-rail-item:hover .project-rail-item-close { display: flex; }`. This is the closest existing analog to a hover-reveal pattern already in the repo (parent `:hover` gates a child's visibility) — same idiom, applied to the whole non-selected-circles group instead of a single close button. Note it uses `display: none/flex` rather than `opacity`/`pointer-events`; either is acceptable, but `opacity` + `pointer-events` + `transition` is preferable here since 4a already introduces animation and an abrupt `display` toggle won't animate — check what pattern 4a settled on and stay consistent with it rather than introducing a third transition idiom in the same file.

**Read `windowControlsClearance()`** (`packages/electron/src/main/window/windowChrome.ts`) if the revealed circles' tooltip/context-menu floating-ui instances need repositioning — `ProjectRail.tsx` already uses this middleware for its own floating menus (referenced at `ProjectRail.tsx:27` among other lines) to keep popovers clear of native OS window controls (traffic lights / caption buttons). 2b should have already wired this for the top-docked tooltip/menu placements generally; this task doesn't need to re-derive it, only confirm the revealed circles use the same tooltip/menu components 2b/3a already set up rather than a bespoke one.

### Code Style

- Stable kebab-case class names on new elements per `REACT_DOM_MARKERS.md` (e.g. `project-bar-top__others` or whatever naming convention 3a/2b already established for the top-docked variant — match theirs, don't invent a parallel one).
- Only canonical `--nim-*` CSS variables (per `UI_PATTERNS.md`) — no new hex/px values duplicating existing tokens. `ProjectRail.css`'s existing rules (e.g. `.project-rail-item-main`, `ProjectRail.css:33-51`) show the established `var(--nim-*, <fallback>)` idiom to follow.
- `@container` queries, not `@media`, if any responsive sizing is needed for the revealed group (per `UI_PATTERNS.md`) — 2b should already have this in place for the horizontal layout generally; this task should not need a new container-query rule unless the revealed-state group has a distinct overflow concern the always-visible case doesn't.

### Edge Cases

- **Single project open, no others to reveal:** hover is a no-op (nothing renders in the revealed group) — this is explicitly called out in the PRD's UX section ("Single project open, position = top: expanded name shows, no other circles to reveal (hover is a no-op)"). Don't special-case this in code beyond what naturally falls out of mapping an empty "other open projects" list — no error state needed.
- **Rapid hover in/out (mouse passing through, not settling):** if using JS-tracked state (option 2 above), a fast mouseenter/mouseleave pair should not cause a visible flash-then-hide that reads as a bug — a short CSS transition (matching whatever duration 4a's animation uses, for consistency) is sufficient; do not add a debounce/delay timer unless 4a's brief or shipped code establishes that convention first, since an undocumented delay is itself a UX surprise.
- **Reduced-motion:** no `prefers-reduced-motion` convention exists anywhere in `packages/electron/src` as of brief-generation time (confirmed by repo-wide grep — the only hit in the whole monorepo is an unrelated file in `packages/collab-bundle`). Do not invent one for this task alone; if 4a introduced a reduced-motion guard for its expand animation, reuse the same guard for this task's reveal transition for consistency, otherwise skip it (matches 4a's own success-criterion wording: "if the codebase has an existing reduced-motion convention").
- **Mode switches while hovering:** if the user (hypothetically, via settings) flips `projectRailExpandedDisplay` from `'hover-reveal'` to `'always-visible'` while the bar is currently hovered and revealed, the circles should simply stay visible (the `'always-visible'` branch has no hidden state to begin with) — verify this doesn't require an explicit transition reset, just that the conditional render/class logic falls through cleanly.

### Testing Requirements

**Do not write tests in this task.** This PRD defers all tests to the dedicated end-of-work task 5a, per explicit user direction recorded in the PRD ("Tests are a dedicated end-of-work task (5a), not embedded per task, per explicit user direction — this overrides the repo's default 'tests ship with the behavioral change' convention for *task sequencing* only"). Task 5a's file list (`packages/electron/src/renderer/components/WindowTopBar/WindowTopBar.test.tsx`, a new file) is expected to cover this task's behavior alongside 3a's and 4a's. Despite deferring test-writing, run `npm run typecheck` before finishing this task — do not wait for 5a to surface a type error introduced here.

---

## Boundaries

### Files You MUST NOT Touch

Per `.nimble/config.yaml` `boundaries.never_touch` (global list):
- `*.lock`, `package-lock.json`
- `.env*`
- `packages/electron/src/database/migrations/*`
- `dist/`, `out/`, `out2/`, `release/`, `node_modules/`
- `.nimbalyst/`, `.dolt/`, `*.db`
- `packages/electron/index.js`
- `packages/electron/resources/bundled-extensions/*.nimext`

None of these overlap with this task's file set.

### Files Requiring Review

Per `.nimble/config.yaml` `boundaries.require_review`, neither of this task's two files matches the listed patterns (`packages/collabv3/*`, `packages/electron/src/main/**`, `packages/electron/src/database/**`, `scripts/run-workspace-script.mjs`, `scripts/install-git-hooks.mjs`) — both `WindowTopBar.tsx` and `ProjectRail.css` are renderer-side, not main-process. Standard single end-of-work review applies, no special flag.

---

## Dependencies

### Upstream Tasks

| Task | What It Provides | Verify Before Starting |
|------|------------------|------------------------|
| 1a | `projectRailExpandedDisplayAtom` (typed `'always-visible' \| 'hover-reveal'`, default `'always-visible'`), persisted via `app:get/set-project-rail-expanded-display` — brief exists (`briefs/1a_project-bar-top-placement.md`), already implemented per wave ordering | Confirm the atom import path (`packages/electron/src/renderer/store/atoms/openProjects.ts`) and exact atom name match what 1a actually shipped — this brief assumes the names as specified in 1a's brief; re-verify if 1a's implementation diverged during review. |
| 3a | Structural merge of the project bar into `WindowTopBar`'s `window-top-bar__identity` area when `projectRailPositionAtom === 'top'`; solves the `pointer-events-none` click-dead problem and establishes the `NO_DRAG_REGION` pattern for every interactive circle | **No brief exists yet as of this writing.** Read the actual shipped `WindowTopBar.tsx` before starting — confirm how 3a rendered the circle-click-target fix (removed `pointer-events-none`, or moved circles outside that container) and reuse the identical approach for the newly-revealed circles, don't re-derive a second fix. |
| 2b | Horizontal-layout CSS for the shared icon component (from 1b) in the top-docked context — no vertical-only styles reused, `@container`-based responsive sizing, tooltip/menu placement flipped to open downward | **No brief exists yet as of this writing.** Read the actual shipped `ProjectRail.css` (or whatever stylesheet 2b produced) before adding hover-reveal styles — build on 2b's horizontal classes rather than introducing a parallel layout. |
| 4a | Expand-in-place animation for the active project's circle-to-text transition inside the top bar; establishes whatever animation-state convention (CSS class toggle, transition duration, reduced-motion guard if any) this task should reuse for its own reveal/hide transition | **No brief exists yet as of this writing.** Read the actual shipped `WindowTopBar.tsx`/`ProjectRail.css` diff from 4a before starting — this task's dependency on 4a exists primarily to avoid a same-branch file conflict (both tasks touch the same two files), but reusing 4a's transition-duration/easing convention for the reveal/hide animation is good practice even though not strictly required by the success criteria. |

### Downstream Impact

Tasks that depend on this one:

| Task | What it needs from 4b |
|------|------------------------|
| 5a (Tests) | Hover-reveal behavior implemented and stable, to write component tests against `WindowTopBar.test.tsx` covering both `'hover-reveal'` and `'always-visible'` display modes |

**Before starting:** Verify 3a, 2b, and 4a are actually complete and merged onto the shared branch (`worktree/project-bar-movement`) — check `git log`/the current state of `WindowTopBar.tsx` and `ProjectRail.css` directly rather than trusting task-status metadata alone, since this task's entire implementation surface depends on structure none of which exists in the codebase as of brief-generation time (2026-08-21).

---

## GitHub Context

**Issue:** N/A — this PRD is not tracked via GitHub Issues (see Feature Issue note in the header)
**Feature Issue (Parent):** N/A
**Branch:** `worktree/project-bar-movement` — single shared feature branch for all 8 tasks (per `status.json`'s `branch_strategy: "use-worktree-branch-directly"` and the PRD's explicit "single feature branch, all 8 tasks land together; one integration review at the end" orchestration decision). Do not create a per-task branch.
**Target:** Determined by PM agent — per this PRD's single-integration-review orchestration, this task's commit lands on the shared feature branch, not directly on `main`.

---

## Commit Guidelines

Use Conventional Commits. Keep the subject to one sentence, per this repo's `CLAUDE.md` commit-message rule (no root-cause prose in the body unless the diff can't explain itself):

```
feat(electron): reveal non-selected project circles on hover in top-docked bar
```

Do NOT add a `Co-Authored-By: Claude` trailer — this repo's `CLAUDE.md` explicitly says "Don't add `Co-Authored-By` lines to commit messages."

Types: feat, fix, refactor, test, docs, chore

**CHANGELOG.md:** Per this repo's `CLAUDE.md`, only update `CHANGELOG.md` when explicitly asked to propose a commit. If asked, the entry belongs to the overall feature (project-bar top placement / hover-reveal), phrased as user-facing behavior — not internal scaffolding (no atom names, class names, or file paths in the bullet). Given this PRD's single-integration-review orchestration, a single CHANGELOG bullet covering the whole feature likely belongs on the final integration commit rather than this task alone — coordinate with whichever task/commit closes out the PRD rather than adding a duplicate bullet here.

---

## Validation Checklist

Before creating PR / handing off for the integration review:
- [ ] All success criteria met
- [ ] Build passes: `npm run build`
- [ ] Type check passes: `npm run typecheck`
- [ ] No `never_touch` files modified
- [ ] Window-dragging manually verified still works with hover listener/CSS attached (see Success Criteria — this is required even though it's not in the PRD's literal R8 acceptance-criteria list)
- [ ] No tests added in this task (deferred to 5a per PRD orchestration) — confirm this is intentional, not an oversight, if a reviewer flags it
- [ ] Branch is the shared feature branch `worktree/project-bar-movement`, not a new per-task branch

---

*Generated by NIMBLE Brief Writer*
*PRD: project-bar-top-placement | Task: 4b | Wave: 4*
