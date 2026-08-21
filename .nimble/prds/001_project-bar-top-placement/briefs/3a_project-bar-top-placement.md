# Task Brief: 3a

**Title:** Merge project bar into WindowTopBar when position is top
**PRD:** project-bar-top-placement
**Priority:** must
**Complexity:** 5/10
**Model:** opus
**Wave:** 2
**Feature Issue:** N/A — this PRD is not tracked via a GitHub Issue (`status.json` `tracker.issue_key` is `null`; NIMBLE tracker item `plan_1787289447069_qb6yvp` is the plan record instead)

---

## RISK FLAG — READ THIS FIRST

This is the highest-risk task in the PRD. It couples project-switching UI to Electron's native
window-drag-region mechanism inside `WindowTopBar`. Two independent things can each break the
whole title bar if you get them wrong, and they are **not the same mechanism**:

1. **`-webkit-app-region: drag` / `no-drag`** (native OS-level window dragging, `dragRegion.ts`).
   Get this wrong → the user can no longer drag the window by clicking empty title-bar space, or
   dragging becomes possible on top of a button that should have been clickable instead.
2. **CSS `pointer-events: none`** on `window-top-bar__identity` (`WindowTopBar.tsx:529`, verified
   below) — a completely separate mechanism that blocks the DOM/React event system entirely,
   independent of drag-region. `NO_DRAG_REGION` alone does **not** make a circle clickable if its
   ancestor still has `pointer-events: none` — `pointer-events` is CSS-inheritable and a descendant
   needs its own explicit override (or must sit outside the `pointer-events: none` ancestor) to
   receive clicks at all.

Do not assume adding `NO_DRAG_REGION` classes is sufficient. Verify by literally clicking a
non-active circle in a running dev build and confirming the active project switches — not by
reading the JSX and confirming the class is present.

---

## Objective

Move the project bar's content from its current left-docked strip into `WindowTopBar` itself when
the user has set `projectRailPosition` to `'top'`. When `'left'` (the default), nothing changes —
`App.tsx` and `WindowTopBar.tsx` render byte-identical output to today. When `'top'`, `WindowTopBar`
shows the open projects using the shared logic extracted by task 1b, with the active project's
full name displayed in place of today's static workspace name, sourced from `activeOpenProjectAtom`
instead of the `workspaceName` prop.

---

## Context

**Parent Feature:** Project Bar Top Placement (project-bar-top-placement) — no GitHub Issue exists
for this PRD; see Feature Issue note above.

Today, `ProjectRail` (`packages/electron/src/renderer/components/ProjectRail.tsx`) is a fixed 56px
vertical strip on the left showing circular avatars for each open project, and `WindowTopBar`
(`packages/electron/src/renderer/components/WindowTopBar/WindowTopBar.tsx`) separately shows a
static workspace name in its title area. This PRD adds a setting (`projectRailPosition`, built in
task 1a) that lets the user dock the project bar at the top instead, merged into the title bar,
with the active project's circle expanding into its full name.

This task is part of **Wave 2** (`1a, 1b` in Wave 1 → `2a, 2b, 3a` in Wave 2, per
`execution_plan.yaml`). It depends on **1a** (the `projectRailPositionAtom` /
`multiProjectModeAtom` / `activeOpenProjectAtom` this task reads) and **1b** (the shared
icon/container logic extracted from `ProjectRail.tsx` that this task must reuse rather than
re-implement). 1a's brief exists and is verified below
(`.nimble/prds/001_project-bar-top-placement/briefs/1a_project-bar-top-placement.md`). **1b's
brief did not exist at the time this brief was generated** — see the dedicated section below,
"1b Dependency — Verify Before Starting," before touching `WindowTopBar.tsx`.

This task fulfills PRD requirements **R4** (structural DOM merge), **R5** (active project's full
name replaces static workspace name), and **R6** (full interaction parity: switch/close/add, every
interactive element `NO_DRAG_REGION`'d, empty space stays draggable). It does **not** cover R9 (the
animated circle↔text transition — task 4a, which depends on this task) or R8 (hover-reveal — task
4b). Your job is the correct static end-state DOM structure and full interactivity; 4a layers an
animation on top of what you build, it does not change what state exists.

---

## 1b Dependency — Verify Before Starting

Task 1b ("Extract shared project-bar container logic from ProjectRail") widens
`ProjectRailIcon.tsx`/`ProjectRail.tsx` so that both the left-docked rail and this task's top-docked
merge can share: icon rendering (active state, hover tooltip, close, context menu), the add-project
flow (`workspace:register-additional` + folder-picker dialog), the close handler
(`workspace:unregister-additional` + streaming-session confirm), `isOpenProjectsAtCapAtom`, and the
`globalSessionActivityAtom`/`projectActivitySummaryAtom` per-icon feeds — per 1b's success criteria
in `tasks.yaml`.

**As of this brief's generation, 1b had not yet produced a brief or landed code**, so the exact
export names, file locations, and hook/component shape below are inferred from 1b's task
description and from reading `ProjectRail.tsx`'s current (pre-extraction) implementation — **not**
verified against 1b's actual output. Before writing any code in this task:

1. Read `packages/electron/src/renderer/components/ProjectRail.tsx` and `ProjectRailIcon.tsx` as
   they exist on your branch (post-1b) to find the actual exported hook/component names.
2. If 1b's brief now exists at
   `.nimble/prds/001_project-bar-top-placement/briefs/1b_project-bar-top-placement.md`, read it for
   the authoritative API.
3. Map the composition plan below (see "Top-Docked Composition Plan") onto whatever 1b actually
   exports. **Do not modify `ProjectRailIcon.tsx` or `ProjectRail.tsx` to accommodate a mismatch** —
   this task's `files_affected` is `App.tsx` and `WindowTopBar.tsx` only; if 1b's extraction is
   missing something this task needs, treat that as a signal to compose differently within
   `WindowTopBar.tsx`, not to widen this task's file scope.

**What the current (pre-1b) `ProjectRail.tsx` looks like**, as the closest available reference for
what 1b is extracting (verified by direct read, all line numbers current as of this brief):

- `projectInitials(name)` (`ProjectRail.tsx:48-56`) — derives the 2-letter circle content from
  `project.name`.
- `ProjectRailIconProps` (`ProjectRail.tsx:58-66`): `{ project: OpenProject; isActive: boolean;
  processingCount: number; unreadCount: number; onActivate: (path: string) => void; onClose:
  (project: OpenProject) => void; onContextMenu: (project, x, y) => void }`.
- `ProjectRailIcon` (`ProjectRail.tsx:68-179`) — one circle: floating-ui hover tooltip (`useFloating`
  + `FloatingPortal`, `windowControlsClearance()` middleware, `ProjectRail.tsx:82-90`), a
  `project-rail-item-main` activate button (`ProjectRail.tsx:139-155`) showing
  `projectInitials(project.name)` plus an optional unread/processing badge, and a
  `project-rail-item-close` button (`ProjectRail.tsx:156-163`) rendered **unconditionally,
  including on the active item** — the close button is not hidden when `isActive` is true.
- `ProjectRail()` container (`ProjectRail.tsx:181-549`) owns: `handleActivate`
  (`ProjectRail.tsx:191-200`, no-ops if the clicked path is already active, otherwise
  `setActivePath(path)` which the `initOpenProjects()` subscriber in `openProjects.ts` forwards to
  main via `workspace:set-active`), `addProjectByPath`/`handlePickFolder`/`refreshRecents`
  (`ProjectRail.tsx:202-248`), `handleOpenAddMenu` (`ProjectRail.tsx:250-257`, alerts if
  `isOpenProjectsAtCapAtom` is true), `handleClose` (`ProjectRail.tsx:259-296`, confirms if the
  project has streaming sessions, then `closeOpenProjectAtom` + `workspace:unregister-additional`,
  and closes the whole rail window if it was the last open project), and the right-click context
  menu (`ProjectRail.tsx:298-417`, "Open in new window" / reveal-in-Finder / "Close project").
  `if (!isMultiProjectMode) return null;` gates the entire component (`ProjectRail.tsx:419`).

If 1b lands a hook (e.g. something like `useProjectRailActions()`) exposing `handleActivate`,
`handleClose`, `handleOpenAddMenu`/`addProjectByPath`, and `atCap`, plus an icon component (e.g. a
renamed/exported `ProjectRailIcon`) accepting an orientation prop (per 1b's success criterion
"Extracted API accepts a layout/orientation prop"), that is the shape to compose against. If it
lands differently, adapt — but preserve every success criterion below exactly.

---

## Requirements

### 1. `App.tsx` — gate `ProjectRail` on position

`App.tsx`'s root layout (verified current, `App.tsx:2608-2650`, relevant excerpt):

```tsx
// App.tsx:2608-2639
<WalkthroughProvider currentMode={activeMode}>
<TipProvider currentMode={activeMode} workspacePath={workspacePath || undefined}>
<div data-layout="root-container" className="h-screen flex flex-col">
  {workspaceMode && (
    <WindowTopBar
      workspaceName={workspaceName || 'Nimbalyst'}
      activeModeLabel={activeModeLabel}
      gitStatus={gitStatus}
      gitActions={{ /* ... */ }}
      panelControls={windowTopBarPanelControls}
      newSessionControl={windowTopBarNewSessionControl}
      workspacePath={workspacePath}
    />
  )}
  <div data-layout="workspace-row" className="flex flex-row flex-1 min-h-0">
  {/* Far-left: project rail (Discord-style) — visible only when
      multi-project mode is enabled in settings. */}
  <ProjectRail />
  {/* Left: Navigation Gutter - full height */}
  <NavigationGutter
    ...
```

`ProjectRail` is nested **inside** `workspace-row`, below `WindowTopBar` — not a sibling row of it.
This is a real structural constraint: you cannot flip this with CSS alone, but for this specific
task you don't need to — you only need to stop rendering `<ProjectRail />` in its current slot when
`projectRailPosition === 'top'`. (`ProjectRail`'s own `if (!isMultiProjectMode) return null;`,
`ProjectRail.tsx:419`, already handles the multi-project-mode gate; you're adding the position
gate on top of that, in `App.tsx`.)

**Exact change:** import `projectRailPositionAtom` into `App.tsx`'s existing atoms-from-openProjects
import block (`App.tsx:170-174`, currently `{ activeWorkspacePathAtom, multiProjectModeAtom,
addOpenProjectAtom as addOpenProjectAction }`), read it with `useAtomValue` near the existing
`isMultiProjectMode`/`railActivePath` reads (`App.tsx:571-572`), and wrap the existing
`<ProjectRail />` element (`App.tsx:2638`) in a condition:

```tsx
{projectRailPosition !== 'top' && <ProjectRail />}
```

**Do not** change `<ProjectRail />`'s own JSX/props, and do not touch anything else in the
`workspace-row` div or the `WindowTopBar` call. The only diff to `App.tsx` should be: one new atom
import, one new `useAtomValue` line, and wrapping the existing `<ProjectRail />` line in a
condition. This satisfies success criterion 1 — when `projectRailPosition` is `'left'` (the
default), the condition evaluates true and `<ProjectRail />` renders exactly as it does today.

### 2. `WindowTopBar.tsx` — top-docked identity branch

Current `window-top-bar__identity` block, verified current (`WindowTopBar.tsx:529-544`):

```tsx
<div className="window-top-bar__identity flex items-baseline justify-center gap-1.5 min-w-0 max-w-[min(42vw,520px)] whitespace-nowrap pointer-events-none">
  <span
    className="window-top-bar__workspace-name min-w-0 overflow-hidden text-ellipsis text-nim text-xs font-semibold"
    data-testid="window-top-bar-workspace-name"
    title={workspaceName}
  >
    {workspaceName}
  </span>
  <span className="window-top-bar__identity-separator text-nim-muted text-[11px]" aria-hidden="true">—</span>
  <span
    className="window-top-bar__mode-label min-w-0 overflow-hidden text-ellipsis text-nim-muted text-[11px]"
    data-testid="window-top-bar-mode-label"
  >
    {activeModeLabel}
  </span>
</div>
```

Note `pointer-events-none` is on the container div itself (line 529) — today this is harmless
because the container only holds inert `<span>` text with no click handlers. The moment you put
interactive circles/buttons inside it (or reuse this class name for the top-docked case), they
become click-dead unless you handle this explicitly.

**Recommended approach — do not reuse this container for the top-docked case.** Render this exact
block (unchanged, `pointer-events-none` and all) only in the fallback branch, and render a **new,
structurally separate** div — a new class, e.g. `window-top-bar__identity-rail`, without
`pointer-events-none` — for the top-docked case. This satisfies success criterion 3's second option
("the circles are rendered outside that container") directly, and avoids relying on CSS
`pointer-events` inheritance/override edge cases across two different render paths sharing one
class name. It also keeps the diff to the existing static block at zero — the exact bar for success
criterion 1 applying to `WindowTopBar.tsx` too.

If you instead choose to reuse `window-top-bar__identity` for both cases and drop
`pointer-events-none` from it conditionally: every non-interactive area inside that div (gaps
between circles, any wrapper divs) must **not** silently become click-swallowing — plain `<div>`s
with no `onClick` and no `NO_DRAG_REGION` don't swallow anything, so this is survivable, but you
must still add `NO_DRAG_REGION` to every interactive descendant individually since removing
`pointer-events-none` does not affect drag-region behavior (see the Risk Flag above — they're
unrelated mechanisms). The separate-container approach above is simpler to reason about and is the
recommended path for a task already flagged as highest-risk.

**Atom reads to add** (import from `'../../store/atoms/openProjects'` — verified this is the
correct relative path: `WindowTopBar.tsx` already imports `orgInboxUnreadCountAtomFamily` from
`'../../store/atoms/teamInbox'` at line 11 and `windowFullScreenAtom` from
`'../../store/atoms/windowFullScreen'` at line 12, same directory depth):

```ts
import {
  activeOpenProjectAtom,
  activeWorkspacePathAtom,
  multiProjectModeAtom,
  projectRailPositionAtom,
} from '../../store/atoms/openProjects';
```

Inside `WindowTopBar()` (`WindowTopBar.tsx:462` on), add:

```ts
const projectRailPosition = useAtomValue(projectRailPositionAtom);
const isMultiProjectMode = useAtomValue(multiProjectModeAtom);
const activeOpenProject = useAtomValue(activeOpenProjectAtom);
const showTopDockedRail = projectRailPosition === 'top' && isMultiProjectMode;
```

`showTopDockedRail` is the single gate for success criterion 7 ("When `multiProjectModeAtom` is
false and position = `'top'`, `WindowTopBar` shows no rail remnant — falls back to today's static
workspace-name display") — falling through to the unchanged fallback branch is automatic as long
as this boolean correctly requires both conditions.

**Render:** in place of the single `window-top-bar__identity` div, render a ternary choosing between
the unchanged fallback block and the new top-docked block:

```tsx
{showTopDockedRail ? (
  <div className="window-top-bar__identity-rail flex items-center justify-center gap-1.5 min-w-0 max-w-[min(42vw,520px)]">
    {/* active project: expanded full name, not a circle — see composition plan below */}
    {/* other open projects: circles from 1b's shared icon component */}
    {/* add-project control */}
  </div>
) : (
  <div className="window-top-bar__identity flex items-baseline justify-center gap-1.5 min-w-0 max-w-[min(42vw,520px)] whitespace-nowrap pointer-events-none">
    {/* exact existing content, unchanged — see WindowTopBar.tsx:530-543 above */}
  </div>
)}
```

Do not add any conditional logic *inside* the fallback branch's JSX — it must be a verbatim copy of
today's `WindowTopBar.tsx:530-543`. This is what "no new conditional touches the left-docked JSX
output or props" means in practice: the ternary picks between two whole blocks, but the fallback
block's internals are untouched.

### Top-Docked Composition Plan

Given the files-affected constraint (`App.tsx` + `WindowTopBar.tsx` only — not
`ProjectRailIcon.tsx`), and R5's requirement that the active project shows as **full name text**,
not a circle, structure the top-docked branch as three pieces, all read via 1b's exported hook/
container logic (see "1b Dependency" above — verify exact names before wiring):

1. **Active project — full name, not a circle.** Build this directly in `WindowTopBar.tsx` (this is
   new UI unique to the top-docked case, not a reuse of the circle icon component): a span or
   button showing `activeOpenProject?.name` (R5: "Text sourced from `activeOpenProjectAtom.name`").
   `activeOpenProject` can be `null` (e.g. no active path resolved yet) — fall back to something
   sane (empty string, or `workspaceName` prop) rather than rendering `null`/`undefined` as text.
   Give this element `data-testid="window-top-bar-workspace-name"` (reusing the existing testid) so
   any existing selectors keyed to that testid keep finding *an* active-project name element in
   both docked positions — this is a recommendation for continuity, not a criterion verified
   against a downstream test file, since task 5a's test brief does not yet exist either.
   The active project still needs a working close (×) control per success criterion 5 ("close
   project... functions") — today's `ProjectRailIcon` renders close unconditionally even when
   active (`ProjectRail.tsx:156-163`), so the active project's expanded-name element needs its own
   close affordance too, wired to 1b's shared close handler. Give the close button explicit
   `NO_DRAG_REGION`.
2. **Non-active open projects — circles.** Render each via 1b's shared icon component (whatever it's
   actually named post-extraction), passing `onActivate` wired to 1b's shared activate handler
   (same `activeWorkspacePathAtom` write path `ProjectRail.tsx:191-200` uses today — do not
   reimplement the no-op-if-already-active guard differently). Filter these to open projects whose
   path is **not** the active path (the active one is handled by piece 1 instead of being rendered
   as a circle). Each circle's activate button and close button need explicit `NO_DRAG_REGION`.
3. **Add-project control.** Reuse 1b's shared add-project logic (`handleOpenAddMenu`/
   `addProjectByPath`/`handlePickFolder`/`atCap`, per `ProjectRail.tsx:202-257` today) rather than
   re-implementing the `workspace:register-additional` IPC call or the folder-picker dialog call
   inline in `WindowTopBar.tsx` — this duplication is exactly what 1b's widened scope exists to
   prevent (see PRD `## Agent Tasks` summary note: "1b was widened during reviewer validation to
   include the add-project/close/capacity logic `ProjectRail()` owns today, not just icon
   rendering, so 3a doesn't have to re-implement it"). Give the `+` button explicit
   `NO_DRAG_REGION`.

Everything else in the new `window-top-bar__identity-rail` div (gaps, wrapper divs with no click
handler) gets **no** `NO_DRAG_REGION` class, so it inherits the header's `-webkit-app-region: drag`
(`WindowTopBar.tsx:510`) and stays a functioning drag handle — this is success criterion 6's "empty
bar space stays a functioning drag region."

Do not attempt the circle→text animation here (4a's job) — a plain conditional swap between "render
circle" and "render expanded name text" for the active project is the correct scope for this task.

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] Position = 'left' (default): App.tsx and WindowTopBar.tsx take the same render branch as before this task existed — no new conditional touches the left-docked JSX output or props
- [ ] Position = 'top' replaces window-top-bar__identity's workspace-name content with the shared icon component showing the active project's full name from activeOpenProjectAtom
- [ ] The window-top-bar__identity container's existing pointer-events-none (WindowTopBar.tsx:529) is overridden/removed for the replaced content, or the circles are rendered outside that container — verify by clicking a circle and confirming the click registers, not just that NO_DRAG_REGION is present
- [ ] Clicking a non-selected circle writes activeWorkspacePathAtom via the same path ProjectRail uses today, switching the active project
- [ ] Close-project and add-project controls both function in the top-docked position
- [ ] Every interactive element has explicit NO_DRAG_REGION; dragging the window from empty bar space still works
- [ ] When multiProjectModeAtom is false and position = 'top', WindowTopBar shows no rail remnant — falls back to today's static workspace-name display, matching ProjectRail's existing return-null gating

**All criteria must pass before task is complete.** Per this repo's `end-to-end-verification.md`
rule: this task's verification (dragging the window, clicking a circle) requires manually
exercising the running app, not just reading the JSX. Do not declare a criterion met from "the code
path looks right" — actually click a circle in a dev build and confirm the active project switches,
and actually drag the window from empty top-bar space and confirm it moves.

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/electron/src/renderer/App.tsx` | modify | Gate `<ProjectRail />` (currently unconditional at line 2638) behind `projectRailPosition !== 'top'` |
| `packages/electron/src/renderer/components/WindowTopBar/WindowTopBar.tsx` | modify | Add a top-docked identity branch (new div, separate from the existing `pointer-events-none` `window-top-bar__identity` at lines 529-544) rendering the active project's full name plus other open projects' circles plus add-project control, all wired via 1b's shared logic |

### File Ownership Notes

Neither file is under `.nimble/config.yaml`'s `require_review` list (that list is
`packages/collabv3/*`, `packages/electron/src/main/**`, `packages/electron/src/database/**`,
`scripts/run-workspace-script.mjs`, `scripts/install-git-hooks.mjs` — both this task's files are
renderer-side, outside all of those globs). Per `execution_plan.yaml`'s
`file_conflicts_checked.wave_2`, this task's file set (`App.tsx` + `WindowTopBar.tsx`) is disjoint
from 2a's (`AdvancedPanel.tsx` + `SettingsToggle.tsx`) and 2b's (`ProjectRailIcon.tsx` +
`ProjectRail.css`) — no same-wave conflict. `WindowTopBar.tsx` is touched again by 4a and 4b later
(Waves 3-4, both dependent on this task completing first) — this task establishes the structural
branch those tasks build on top of, so keep the diff to what's described above rather than
speculatively over-engineering the top-docked branch's internals.

---

## Deliverables

None beyond the files above (inferred — not captured at interview; this task is a structural JSX
change with no separate artifact such as a migration, fixture, or doc).

---

## Implementation Guidance

### Patterns to Follow

- `NO_DRAG_REGION` usage pattern — clone exactly from `ExitFullScreenButton` (`WindowTopBar.tsx:
  444-460`, specifically line 451: `` className={`window-top-bar__exit-full-screen px-1.5
  ${CONTROL_BASE} ${CONTROL_GHOST} ${NO_DRAG_REGION}`} ``) or the "New" session button
  (`WindowTopBar.tsx:562-573`, line 564). Both are already-working examples of an interactive
  button inside the drag-region header getting explicit `NO_DRAG_REGION`.
- Floating-ui tooltip/menu positioning for any circle tooltip you compose in — reuse
  `windowControlsClearance()` middleware exactly as `ProjectRail.tsx:82-90` and `ProjectRail.tsx:
  309-339` already do (imported from `@nimbalyst/runtime/ui/floating/windowControlsClearance`).
  Per this repo's `floating-ui.md` rule, never hand-roll `position: fixed` coordinates.
- `activeWorkspacePathAtom` write path — clone `handleActivate`'s no-op guard exactly
  (`ProjectRail.tsx:191-200`): `if (path === activePath) return; setActivePath(path);` — do not
  write the atom unconditionally on every click.

### Code Style

- `camelCase` for all new local variables, prop names, and any new atom names (none should be
  needed — this task only reads existing 1a atoms).
- Follow `REACT_DOM_MARKERS.md`: give the new top-docked identity div a stable kebab-case class on
  its root (`window-top-bar__identity-rail` as suggested above, or whatever you settle on) —
  Tailwind utility classes alone are not sufficient per that doc.
- No inline `position: fixed` — see floating-ui pattern above.

### Edge Cases

- **`activeOpenProjectAtom` resolves to `null`.** This happens if `activeWorkspacePathAtom` is set
  but doesn't match any entry in `openProjectsAtom` (see `openProjects.ts:87-91`, the derived-atom
  definition) — e.g. a brief window during project-close/switch. Render a safe fallback (empty
  string or the `workspaceName` prop) rather than letting `null`/`undefined` reach JSX text content.
- **Zero open projects, top-docked, multi-project mode on.** `showTopDockedRail` can be true with an
  empty `openProjectsAtom`. Decide what the top-docked bar shows in this state (likely: no active
  name, just the add button) rather than leaving it unhandled — this is an edge case the success
  criteria don't explicitly name but a reviewer will notice if it renders broken/empty-looking UI.
- **`workspaceMode` false.** `WindowTopBar` isn't rendered at all in that case (`App.tsx:2611`,
  unchanged by this task) — no special handling needed, this is pre-existing behavior.
- **Do not let the top-docked branch regress the fallback branch's pointer-events / drag-region
  behavior.** Since the two branches are structurally separate divs (per the recommended approach),
  this should be a non-issue, but if you deviate from that approach and share one container,
  re-verify the fallback (left-docked) branch's drag behavior after your change, not just the new
  top-docked branch's.

### Testing Requirements

This PRD defers all tests to a dedicated end-of-work task (5a), per explicit user direction — do
not write tests in this task (see 1a's brief for the same note; it applies identically here). Task
5a's success criteria (per `tasks.yaml`) include: "Test confirms WindowTopBar renders the active
project's full name (from activeOpenProjectAtom) when position = 'top', and renders today's static
workspace-name behavior unchanged when position = 'left'" — your implementation should make that
test straightforward to write (e.g. a stable testid or role on the active-project-name element, as
suggested above), but you are not writing it.

Despite deferring test-writing, run `npm run typecheck` before finishing this task — this repo's
end-of-work gate requires `npm run typecheck && npm run test:prepush` green, and given this task's
risk level, catching a type error here is cheaper than discovering it during the single
end-of-work integration review.

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

Per `.nimble/config.yaml` `boundaries.require_review` (`packages/collabv3/*`,
`packages/electron/src/main/**`, `packages/electron/src/database/**`,
`scripts/run-workspace-script.mjs`, `scripts/install-git-hooks.mjs`): neither `App.tsx` nor
`WindowTopBar.tsx` matches any of these globs. This task's files are not flagged for mandatory
review beyond the PRD's single end-of-work integration review that covers all 8 tasks.

**Do not modify `ProjectRailIcon.tsx` or `ProjectRail.tsx`.** They are not in this task's
`files_affected`; they belong to tasks 1b (this wave) and 2b (also this wave, disjoint file set).
If 1b's actual exports don't fit the composition plan above, adapt your composition inside
`WindowTopBar.tsx` — do not widen this task's file scope to patch 1b's output.

---

## Dependencies

### Upstream Tasks

| Task | What It Provides | Verify Before Starting |
|------|------------------|------------------------|
| 1a | `projectRailPositionAtom`, `multiProjectModeAtom`, `activeOpenProjectAtom`, `activeWorkspacePathAtom` in `packages/electron/src/renderer/store/atoms/openProjects.ts` | Read the brief at `.nimble/prds/001_project-bar-top-placement/briefs/1a_project-bar-top-placement.md`; confirm the atom names match by reading `openProjects.ts` directly (this brief already verified `activeWorkspacePathAtom`/`multiProjectModeAtom`/`activeOpenProjectAtom` exist pre-1a at `openProjects.ts:57,67,87-91` — 1a adds `projectRailPositionAtom` alongside them, default `'left'`) |
| 1b | Shared icon-rendering + add/close/capacity container logic extracted from `ProjectRail.tsx`/`ProjectRailIcon.tsx` | **Mandatory** — read the "1b Dependency" section above in full before starting. If 1b's brief still doesn't exist when you start, read 1b's landed code directly and treat the composition plan in this brief as an assumption, not ground truth |

### Downstream Impact

Tasks that depend on this one:

| Task | What it needs from 3a |
|------|------------------------|
| 4a (animated circle-to-text transition) | The structural branch this task establishes — active project already renders as expanded text, not a circle, by the time 4a adds the transition animation on mount/switch |
| 4b (hover-reveal for non-selected circles) | The same structural branch, plus the non-active circles this task renders, to conditionally show/hide on hover |
| 5a (tests) | The `WindowTopBar.tsx` top-docked render path this task builds, to write component tests against |

**Before starting:** Confirm 1a's atoms exist by reading `openProjects.ts` on your branch (not just
this brief) — 1a runs in the same wave as 1b but is a separate task; if executing out of strict
dependency order for any reason, do not assume 1a has landed without checking. Confirm 1b's
extraction has landed by reading `ProjectRail.tsx`/`ProjectRailIcon.tsx` on your branch — this task
cannot proceed correctly without 1b's shared logic actually existing to compose against.

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
feat(electron): merge project bar into WindowTopBar for top-docked position
```

Do NOT add a `Co-Authored-By: Claude` trailer — this repo's `CLAUDE.md` explicitly says "Don't add
`Co-Authored-By` lines to commit messages."

Types: feat, fix, refactor, test, docs, chore

**CHANGELOG.md:** Per this repo's `CLAUDE.md`, only update `CHANGELOG.md` when explicitly asked to
propose a commit. This task alone is not a complete user-facing feature (position='top' still has
no way to be set until 2a's settings UI lands, and no animation until 4a) — if a CHANGELOG entry is
requested at this point in the PRD's execution, prefer deferring the user-facing bullet to whichever
commit completes the visible feature (likely 4a or the final integration commit), per this repo's
"one feature = one CHANGELOG bullet" rule. Do not add a scaffolding-only bullet (class names, atom
names, internal structure) for this task alone.

---

## Validation Checklist

Before creating PR / handing off for the integration review:
- [ ] All success criteria met, including the two that require manually exercising the running app (click a circle, drag the window)
- [ ] Build passes: `npm run build`
- [ ] Type check passes: `npm run typecheck`
- [ ] No `never_touch` files modified
- [ ] `ProjectRailIcon.tsx`/`ProjectRail.tsx` not modified by this task
- [ ] No tests added in this task (deferred to 5a per PRD orchestration)
- [ ] Branch is the shared feature branch `worktree/project-bar-movement`, not a new per-task branch

---

*Generated by NIMBLE Brief Writer*
*PRD: project-bar-top-placement | Task: 3a | Wave: 2*
