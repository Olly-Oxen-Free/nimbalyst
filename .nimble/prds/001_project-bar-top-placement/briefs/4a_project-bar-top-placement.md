# Task Brief: 4a

**Title:** Animated circle-to-text transition for selected project
**PRD:** project-bar-top-placement
**Priority:** must
**Complexity:** 3/10
**Model:** sonnet
**Wave:** 3
**Feature Issue:** N/A — this PRD is not tracked via a GitHub Issue (tracker `issue_key` is `null` in `status.json`; NIMBLE tracker item `plan_1787289447069_qb6yvp` is the plan record instead)

---

## PREREQUISITE WARNING — read before starting

This brief describes **target state for tasks 3a and 2b, not verified shipped code.** At the time
this brief was written, only task **1a**'s brief existed (`briefs/1a_project-bar-top-placement.md`);
**2b** and **3a** had not yet been generated or implemented. Everything below about "what 3a built"
and "what 2b built" is inferred from the PRD (Section 4, R4–R7, R9) and `research/findings.md` —
i.e. the *intended* structure, not a confirmed diff.

**Before writing any code for 4a:**

1. Confirm 3a and 2b are actually merged/present on the shared feature branch
   (`worktree/project-bar-movement`).
2. Read the real `WindowTopBar.tsx`, `ProjectRailIcon.tsx`, and `ProjectRail.css` as they exist
   *after* 3a and 2b landed — do not assume this brief's description of their shape is exact.
   In particular verify:
   - What component/DOM structure 3a actually used to merge the rail into `WindowTopBar` when
     `projectRailPositionAtom === 'top'` (a shared subcomponent per R4, but the exact component
     name/props are 3a's implementation choice).
   - Whether 3a solved the `pointer-events-none` issue on `window-top-bar__identity`
     (`WindowTopBar.tsx:529` in the pre-3a codebase) by removing the class from the merged
     container, scoping it more narrowly, or another approach — this affects where you can safely
     add animation classes/hooks.
   - What horizontal-layout classes/selectors 2b actually added to `ProjectRail.css` (or a new
     stylesheet) for the top-docked circle presentation — this brief's CSS below is written against
     the *pre-existing* vertical rail (`.project-rail-item`, 40x40 circles, `ProjectRail.tsx:113`)
     since 2b's exact class names are not yet known.
3. If the real 3a/2b implementation diverges meaningfully from what's described here (e.g.
   different component names, a different prop for "is this the active/expanded item"), adapt this
   brief's approach to match reality rather than forcing the codebase to match this document.

---

## Objective

Within the top-docked `WindowTopBar` (built by 3a), animate the selected project's avatar
expanding in place from its circle form to its full-name text form on mount, and re-animate this
transition whenever the active project changes. This is a CSS-only expand-in-place animation
scoped strictly inside the top bar — it does not attempt a cross-tree shared-element morph from the
left rail's position to the top bar's position when the position *setting* itself changes live.

---

## Context

**Parent Feature:** Project Bar Top Placement (project-bar-top-placement) — no GitHub Issue exists
for this PRD; see Feature Issue note above.

Today, `ProjectRail` (`packages/electron/src/renderer/components/ProjectRail.tsx`) shows each open
project as a small circular avatar with 2-letter initials (`projectInitials()`,
`ProjectRail.tsx:48-56`). This PRD adds a `projectRailPosition: 'left' | 'top'` setting (built by
1a) that, when set to `'top'`, docks that same project-identity UI into the title bar
(`WindowTopBar`) instead of the left edge, per 3a's structural merge and 2b's horizontal-layout CSS.
When top-docked, the active project's identity is expected to read as the project's **full name**,
not just a 2-letter circle (PRD R5) — this task is what makes that circle-to-text transformation
feel like a deliberate transition rather than a layout jump.

This task is part of **Wave 3** — the third of five dependency-ordered waves on the shared feature
branch (`worktree/project-bar-movement`). Wave 3 runs alone after Wave 2 (`2a`, `2b`, `3a`)
completes; Wave 4 (`4b`, hover-reveal) depends on this task specifically because it edits the same
two files (`WindowTopBar.tsx`, `ProjectRail.css`) and must serialize after 4a to avoid a conflict on
the shared branch — do not assume 4b's hover-reveal markup already exists when you implement 4a.

PRD requirement fulfilled: **R9** — "The selected project's avatar visually morphs between its
circle form (left-docked) and expanded full-name form (top-docked) — both on position-setting
change and on load in the top-docked state." Per the PRD's "Non-Goals restated for clarity" section,
this was explicitly escalated from deferred MVP polish to full-implementation scope during planning
— it is not optional or skippable.

---

## Research Context

`research/findings.md` (project-level research file, not a PRD-embedded "Research Findings"
section) contains directly relevant findings for this task:

### Patterns to Follow

- **`activeOpenProjectAtom`** (`packages/electron/src/renderer/store/atoms/openProjects.ts:87-91`)
  — derived atom resolving the full active `OpenProject` record including `.name`. Use this for the
  expanded full-name text; do not re-derive the active project's name from `activeWorkspacePathAtom`
  plus a manual lookup.
- **`projectInitials()`** (`ProjectRail.tsx:48-56`) — existing helper producing the 2-letter circle
  content from `project.name`. Reuse this for the collapsed/circle form rather than writing a new
  initials function.
- **Existing CSS transition convention**: `ProjectRail.css` already uses plain CSS `transition`
  (no animation library) at two sites — `transition: border-radius 150ms ease, background-color
  150ms ease, ...` (`ProjectRail.css:49`) and `transition: border-radius 150ms ease,
  background-color 150ms ease, color 150ms ease;` (`ProjectRail.css:147`). Follow this exact idiom
  (plain `transition` property, `150ms ease`-style timing) for the circle↔text animation rather than
  introducing `@keyframes` unless a keyframe animation is genuinely required for the shape change.

### Known Issues to Address

- ⚠️ **`window-top-bar__identity` had `pointer-events-none`** in the pre-3a codebase
  (`WindowTopBar.tsx:529`), which made every circle inside it click-dead. This was called out as an
  explicit 3a success criterion, so 3a should have already resolved it — but re-verify per the
  Prerequisite Warning above before assuming your animated element is interactive.
- ⚠️ **No shared-element/layout-animation library is present in this codebase.** Do not add one
  (Framer Motion, react-spring, etc.) to satisfy this task — the PRD and `agent_context` are explicit
  that the left↔top position-change transition is a plain crossfade/slide, not a literal shared-
  element morph, precisely because no such library exists as a dependency.

### Recommended Approach

- CSS transitions/keyframes only, consistent with `ProjectRail.css`'s existing un-guarded
  `transition: ... 150ms ease` sites.
- Trigger re-animation on active-project change by keying off `activeOpenProjectAtom` (or
  `activeWorkspacePathAtom`) changes — e.g. a `key`-based remount of the animated element, or a CSS
  animation restarted via a class toggle keyed to the active path, whichever fits 3a's actual
  component structure once verified.

### Dependencies

**File dependencies:**
- `activeOpenProjectAtom`, `activeWorkspacePathAtom` (`openProjects.ts:57, 87-91`) — read-only,
  already built, not modified by this task.
- 3a's merged top-bar structure and 2b's horizontal CSS variant — both **must exist on the branch
  before this task starts**; see Prerequisite Warning.

**Library dependencies:** None. Explicitly do not add an animation library (see Known Issues above).

---

## Requirements

1. **Expand-in-place animation, top-docked state.** When `projectRailPositionAtom === 'top'`, the
   active project's identity element animates from its collapsed circle/initials form to its
   expanded full-name form. This must fire:
   - On mount, when the app loads directly into the top-docked state (not just when transitioning
     into it live from the settings panel).
   - On every subsequent active-project change while already top-docked (clicking a different
     project circle, per R6's interaction parity, re-triggers the animation for the newly-active
     project).
   - There is no configuration escape hatch to skip this animation (aside from the reduced-motion
     handling below) — it is a hard requirement per the success criteria, not a nice-to-have.

2. **Crossfade/slide for the position-setting change.** When the user flips `projectRailPosition`
   from `'left'` to `'top'` (or back) live via the settings control (built by 2a), play a defined
   crossfade or slide transition between the left-rail layout and the top-bar layout. This is
   explicitly **not** a literal circle-follows-the-cursor shared-element morph across the
   left-rail-unmount / top-bar-mount boundary — implement it as a plain CSS crossfade or slide
   between the two mounted/unmounted states, matching the "no shared-layout-animation library"
   constraint above.

3. **Reduced-motion respect**, scoped by whatever convention actually exists in this codebase — see
   the dedicated section below. If no convention exists in the immediately relevant package, decide
   and document your choice per the guidance given there; do not silently skip this requirement.

4. **No new animation library.** Use CSS transitions/keyframes consistent with the rest of the
   codebase (see `ProjectRail.css:49` and `:147` above) unless one is already a project dependency
   (verify via `packages/electron/package.json` before assuming there is none, but per
   `research/findings.md` and the PRD, none has been found).

---

## Reduced-Motion Convention — investigated, cite this

Searched the full monorepo for `prefers-reduced-motion`. Result: **one match, outside the electron
package.**

- `packages/collab-bundle/src/editor/browserChrome.css:64-70`:
  ```css
  /* The one animation on this surface: remote cursors cross-fade when they go
     idle. */
  @media (prefers-reduced-motion: reduce) {
    .collab-bundle-editor .collab-cursors-container > div > span {
      transition: none !important;
    }
  }
  ```
  This is in `packages/collab-bundle`, a different package from `packages/electron` (this task's
  file set), used for the Lexical collab-cursor idle fade — not a shared/importable utility, just an
  inline `@media` block scoped to that one selector.

**Conclusion: no established reduced-motion convention exists within `packages/electron`
specifically** — `ProjectRail.css`'s existing transitions (`:49`, `:147`) have no
`prefers-reduced-motion` guard today. The one precedent in the monorepo (`collab-bundle`) uses the
plain, unwrapped pattern: wrap the animated selector(s) in `@media (prefers-reduced-motion: reduce)`
and set `transition: none !important;` (or, for a `@keyframes` shape-change animation, `animation:
none !important;`) inside it.

**Recommended action for this task:** adopt the same pattern (`@media (prefers-reduced-motion:
reduce)` disabling the new circle↔text transition/animation) in `ProjectRail.css`, since it is the
only precedent found anywhere in this codebase and matches the plain-CSS-transition approach already
used at `:49`/`:147`. This establishes the first such convention inside `packages/electron` — note
this explicitly in your commit/PR description since it's new territory for this package, not a copy
of an existing electron-package pattern.

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] Loading directly into the top-docked state (or switching the active project while already
      top-docked) always renders the expand-in-place animation — no escape hatch, this is a hard
      requirement
- [ ] Toggling the position setting from left to top plays a defined crossfade/slide transition
      between the two layouts (explicitly not a cross-tree shared-element morph, per scope note
      above)
- [ ] Animation respects reduced-motion preferences if the codebase has an existing reduced-motion
      convention

**All criteria must pass before task is complete.**

Note on the third criterion: per the investigation above, `packages/electron` itself has no existing
reduced-motion convention; the nearest codebase precedent lives in `packages/collab-bundle`. Applying
that pattern to this task's new CSS satisfies the criterion's intent ("respect reduced-motion where
a convention exists") without inventing an unprecedented approach.

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/electron/src/renderer/components/WindowTopBar/WindowTopBar.tsx` | modify | Add the mount/re-mount or class-toggle trigger for the expand-in-place animation on the active project's identity element inside the top-docked render path (built by 3a) |
| `packages/electron/src/renderer/components/ProjectRailIcon.tsx` | modify | Adjust the shared icon-rendering component (extracted/widened by 1b, resized by 2b) so the top-docked/expanded rendering path exposes hooks (class names, animation-trigger keys) this task's CSS/JS can target |
| `packages/electron/src/renderer/components/ProjectRail.css` | modify | Add the circle↔text transition/keyframe rules, the left↔top crossfade/slide rules, and the `prefers-reduced-motion` guard |

### File Ownership Notes

All three files are also touched by upstream tasks (1b created/widened `ProjectRailIcon.tsx`; 2b
added horizontal-layout CSS to `ProjectRail.css`; 3a modified `WindowTopBar.tsx` for the structural
merge) and by the downstream task **4b** (hover-reveal), which explicitly depends on 4a specifically
*because* it touches the same two files (`WindowTopBar.tsx`, `ProjectRail.css`) — per
`execution_plan.yaml`'s `file_conflicts_checked.wave_4` note, 4b is serialized after 4a on the shared
branch to avoid a conflict, not run in parallel. Do not assume you have the last word on these files
in the wider PRD — leave room for 4b's hover-reveal markup/state to slot in after you (e.g. don't
hardcode assumptions that only one project's circle can ever be visible at a time in the top bar,
since 4b makes other projects' circles appear on hover).

All three files are on the shared feature branch `worktree/project-bar-movement` — no per-task
branch/worktree isolation, so coordinate mentally with the fact that 3a/2b's actual landed state
(not just their briefs) is what you're building on top of.

---

## Deliverables

None beyond the files above.

---

## Implementation Guidance

### Patterns to Follow

- Reuse `projectInitials()` (`ProjectRail.tsx:48-56`) for the collapsed circle content — do not
  duplicate this logic.
- Reuse `activeOpenProjectAtom` (`openProjects.ts:87-91`) for the expanded full-name text, per R5
  ("Text sourced from `activeOpenProjectAtom.name`").
- Match the existing plain-CSS-`transition` idiom at `ProjectRail.css:49` and `:147`
  (`transition: <property> 150ms ease, ...`) for timing/easing consistency, rather than inventing a
  new duration/easing curve.
- For a shape/content transition (circle → text) that plain `transition` can't express cleanly
  (e.g. animating `border-radius` + `width` + opacity crossfade of inner content simultaneously),
  `@keyframes` is acceptable — this codebase has no blanket rule against keyframes, only a rule
  against pulling in an animation *library*.
- For the left↔top crossfade/slide (requirement 2), key it off `projectRailPositionAtom` (built by
  1a) changing value — a CSS transition on mount/unmount opacity or transform is sufficient; do not
  attempt to track DOM positions across the left-rail/top-bar boundary.

### Code Style

- Use canonical `--nim-*` CSS variables only for any new colors (per `UI_PATTERNS.md` / this repo's
  global CLAUDE.md) — do not hardcode hex colors in the new CSS.
- Use `@container` queries, not `@media`, for any responsive sizing adjustments this animation needs
  to account for (per `UI_PATTERNS.md`) — the one `@media` usage in this task is specifically
  `prefers-reduced-motion`, which is a user-preference media feature, not a layout breakpoint, and is
  the correct use of `@media` here.
- Follow `NAMING_CONVENTIONS.md`: `camelCase` for any new prop/atom names touched in
  `WindowTopBar.tsx`/`ProjectRailIcon.tsx`.

### Edge Cases

- **Single project open, top-docked:** per the PRD's UX notes (Section 5, "Key screens & states"),
  there's only ever one identity to animate in this case — no other circles exist to reveal (that's
  4b's hover-reveal, N/A here), but the mount animation must still fire once on load. Do not
  implement hover-reveal logic in this task — that's explicitly 4b's scope; just don't let this
  task's animation logic assume multiple projects are always present.
- **Rapid active-project switching:** if a user clicks between projects faster than the animation
  duration, the re-trigger mechanism (mount key, class toggle) should not leave the element in a
  visually broken half-animated state — prefer restarting the animation cleanly (e.g. forcing
  reflow on class toggle, or keying a remount) over stacking/queuing animations.
- **Reduced-motion users:** the `prefers-reduced-motion: reduce` guard must disable *both* the
  expand-in-place animation and the left↔top crossfade/slide — not just one of the two required
  transitions. Verify both are covered by your `@media` block, not just whichever one you implement
  first.
- **Multi-project mode toggled off while top-docked:** per the PRD's "Key screens & states," the
  rail disappears entirely in both forms when `multiProjectModeAtom` is false — don't let an
  in-flight animation leave orphaned DOM/CSS state behind when the rail unmounts mid-transition.

### Testing Requirements

This PRD defers all tests to a dedicated end-of-work task (**5a**), per explicit user direction
recorded in the PRD ("Orchestration" section) and task 5a's `depends_on` list, which includes this
task. **Do not write tests in this task.** This overrides the repo's default "tests ship with the
behavioral change" convention for *task sequencing* only in this PRD — the end-of-work gate
(`npm run typecheck && npm run test:prepush`) still must be green before the single integration
review, so run `npm run typecheck` before finishing this task to catch type errors in any new
props/hooks early.

Note for whoever writes 5a's brief (not this task's job, but useful context): animation-heavy CSS is
generally a poor unit-test target (per this repo's "no presentation-only tests" rule) — the useful
test surface here is likely the reduced-motion guard's presence and the re-trigger key/logic in
`WindowTopBar.tsx`/`ProjectRailIcon.tsx`, not asserting on animation timing or visual appearance.

---

## Boundaries

### Files You MUST NOT Touch

Per `.nimble/config.yaml` `boundaries.never_touch` (global list — not specific to this task, but
relevant subset):
- `*.lock`, `package-lock.json`
- `.env*`
- `packages/electron/src/database/migrations/*`
- `dist/`, `out/`, `out2/`, `release/`, `node_modules/`
- `.nimbalyst/`, `.dolt/`, `*.db`
- `packages/electron/index.js`
- `packages/electron/resources/bundled-extensions/*.nimext`

None of these overlap with this task's file set.

### Files Requiring Review

Per `.nimble/config.yaml` `boundaries.require_review`, none of this task's three files
(`WindowTopBar.tsx`, `ProjectRailIcon.tsx`, `ProjectRail.css`) match `packages/electron/src/main/**`
or the other `require_review` patterns — all three are renderer-side. `execution_plan.yaml`'s
`review_gate.require_review_files_touched` list (only `store.ts` and `SettingsHandlers.ts`, both
from task 1a) confirms this task does not add to the require-review set.

---

## Dependencies

### Upstream Tasks

| Task | What It Provides | Verify Before Starting |
|------|------------------|------------------------|
| **3a** | Merged structure — the top-docked rail rendering inside `WindowTopBar` (per R4), with the `pointer-events-none` issue on `window-top-bar__identity` resolved | Read the actual `WindowTopBar.tsx` on the branch; confirm the top-docked render path exists and circles are click-interactive, not just visually present. Do not trust this brief's description of 3a's shape — see Prerequisite Warning at top |
| **2b** | Horizontal-layout CSS variant for top-docked circles (per R7) — resized/repositioned circle presentation | Read the actual `ProjectRail.css` (or wherever 2b landed its stylesheet) on the branch; confirm horizontal circle classes exist before writing animation CSS against them |

**Both 3a and 2b must be present and merged on `worktree/project-bar-movement` before starting this
task's implementation** — this is not a "check the brief exists" gate, it's a "check the code
exists" gate, since at brief-generation time neither task's brief had been written yet.

### Downstream Impact

Tasks that depend on this one:

| Task | What it needs from 4a |
|------|------------------------|
| **4b** (hover-reveal) | Depends on 4a explicitly because it edits the same two files (`WindowTopBar.tsx`, `ProjectRail.css`) and must land after 4a is complete on the shared branch, per `execution_plan.yaml`'s wave-4 conflict note — not because it consumes any specific export from 4a, but to avoid a file conflict |
| **5a** (tests) | Depends on 4a (and every other task) being complete before writing end-of-work test coverage |

**Before starting:** Verify 3a and 2b are complete by reading the actual current state of
`WindowTopBar.tsx`, `ProjectRailIcon.tsx`, and `ProjectRail.css` on the shared branch — not by
checking whether their brief files exist (neither did at the time this brief was written).

---

## GitHub Context

**Issue:** N/A — this PRD is not tracked via GitHub Issues (see Feature Issue note in the header)
**Feature Issue (Parent):** N/A
**Branch:** `worktree/project-bar-movement` — this PRD uses a single shared feature branch for all
8 tasks (per `status.json`'s `branch_strategy: "use-worktree-branch-directly"` and the PRD's
explicit orchestration decision: "Single feature branch, all 8 tasks land together; one integration
review at the end"). Do not create a per-task branch.
**Target:** Determined by PM agent — per this PRD's single-integration-review orchestration, this
task's commit lands on the shared feature branch, not directly on `main`.

---

## Commit Guidelines

Use Conventional Commits. Keep the subject to one sentence, per this repo's `CLAUDE.md`
commit-message rule (no root-cause prose in the body unless the diff can't explain itself):

```
feat(electron): animate circle-to-text transition for top-docked active project
```

Do NOT add a `Co-Authored-By: Claude` trailer — this repo's `CLAUDE.md` explicitly says "Don't add
`Co-Authored-By` lines to commit messages."

Types: feat, fix, refactor, test, docs, chore

**CHANGELOG.md:** Per this repo's `CLAUDE.md`, only update `CHANGELOG.md` when explicitly asked to
propose a commit, and only with a user-facing line. If a CHANGELOG entry is requested at that point,
this task's contribution is part of the single larger "top-docked project bar" feature line (see the
PRD's single-feature-multi-task orchestration) — don't add a separate scaffolding-flavored bullet
just for the animation; fold it into whichever task's brief/commit produces the overall feature's
CHANGELOG entry (or the final integration commit), per this repo's "one feature = one CHANGELOG
bullet" rule.

---

## Validation Checklist

Before creating PR / handing off for the integration review:
- [ ] All success criteria met
- [ ] Build passes: `npm run build`
- [ ] Type check passes: `npm run typecheck`
- [ ] No `never_touch` files modified
- [ ] No tests added in this task (deferred to 5a per PRD orchestration) — confirm this is
      intentional, not an oversight, if a reviewer flags it
- [ ] Branch is the shared feature branch `worktree/project-bar-movement`, not a new per-task branch
- [ ] Confirmed 3a's and 2b's actual shipped code (not just their briefs) before implementing, per
      the Prerequisite Warning

---

*Generated by NIMBLE Brief Writer*
*PRD: project-bar-top-placement | Task: 4a | Wave: 3*
