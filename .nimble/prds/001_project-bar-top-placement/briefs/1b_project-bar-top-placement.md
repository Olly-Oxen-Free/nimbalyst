# Task Brief: 1b

**Title:** Extract shared project-bar container logic from ProjectRail
**PRD:** project-bar-top-placement
**Priority:** must
**Complexity:** 5/10
**Model:** opus
**Wave:** 1
**Feature Issue:** N/A — this PRD is not tracked via a GitHub Issue (tracker `issue_key` is `null` in `status.json`; NIMBLE tracker item `plan_1787289447069_qb6yvp` is the plan record instead)

---

## Objective

Extract the per-icon rendering (active state, hover tooltip, close button, context-menu trigger) and the container-level business logic (add-project flow, close handler, capacity check, activity-atom wiring) that `ProjectRail.tsx` currently owns inline, into a new file `ProjectRailIcon.tsx` that both the existing left-docked rail and the future top-docked `WindowTopBar` merge (task 3a) can consume without duplicating logic. This is the foundation task for the whole PRD: tasks 2b (horizontal CSS), 3a (structural merge into `WindowTopBar`), 4a (transition animation), and 4b (hover-reveal) all render the pieces this task produces. Get the exported API shape right — downstream briefs reference it by exact name.

---

## Context

**Parent Feature:** Project Bar Top Placement (project-bar-top-placement) — no GitHub Issue exists for this PRD; see Feature Issue note above.

Today, `ProjectRail` (`packages/electron/src/renderer/components/ProjectRail.tsx`) is a single 549-line file that both renders the vertical rail's `<nav>` shell *and* owns every piece of per-icon and container-level logic inline — there is no reusable unit smaller than the whole file. This PRD adds a setting (built in sibling task 1a) that lets a user dock this same functionality into the title bar (`WindowTopBar`) at the top of the window instead of the left edge. Task 3a will not touch `ProjectRail.tsx` at all — it renders a top-docked equivalent inside `WindowTopBar.tsx`. If the icon-rendering and add/close/capacity logic stay inline in `ProjectRail.tsx`, task 3a would have to re-implement all of it a second time inside `WindowTopBar.tsx`, and the two copies would drift. This task exists specifically to prevent that: pull the reusable logic out now, once, correctly.

This task is part of **Wave 1** — the foundation wave, run in parallel with task 1a (settings plumbing) on a fully disjoint file set (confirmed by `execution_plan.yaml`'s `file_conflicts_checked.wave_1`: `store.ts`/`SettingsHandlers.ts`/`openProjects.ts` (1a) vs `ProjectRail.tsx`/`ProjectRailIcon.tsx` (1b) — no overlap, no coordination needed). Nothing in this PRD depends on 1a from this task's side; nothing 1a produces is consumed here.

**Zero-behavior-change constraint:** When `projectRailPosition` stays `'left'` (today's only value — task 1a's new setting doesn't ship UI to change it until task 2a), `ProjectRail.tsx` must render and behave byte-for-byte identically to its current output. This task is a pure extraction/refactor of the left-docked path, not a feature change. Verify this by comparing before/after DOM structure, class names, `data-testid` values, and interaction behavior — nothing here should be visibly different to a user with the default settings.

---

## Research Context

No dedicated task-specific research notes exist for this task in the PRD's `## Research Findings`-equivalent section (`research/findings.md`). That file's Section 1 ("Project bar component") is the authoritative source for the extraction boundaries and has been folded into this brief's Requirements section below with line numbers re-verified against current source.

---

## Requirements

### Source file being modified

`packages/electron/src/renderer/components/ProjectRail.tsx`, current state (541 lines of executable code plus header comment), all line numbers below verified by direct read at brief-generation time:

| Region | Lines | What it is |
|---|---|---|
| Module header comment | 1-10 | Unmodified |
| Imports | 12-44 | Split between the two files (see below) |
| `REVEAL_LABEL` constant | 46 | Moves to `ProjectRailIcon.tsx` |
| `projectInitials()` | 48-56 | Moves to `ProjectRailIcon.tsx`, unchanged |
| `ProjectRailIconProps` interface | 58-66 | Moves to `ProjectRailIcon.tsx`, extended (see API below) |
| `ProjectRailIcon` component | 68-179 | Moves to `ProjectRailIcon.tsx`, extended (see API below) |
| `ProjectRail()` — atom reads | 182-189 | Moves into new `useProjectRailController()` hook |
| `handleActivate` | 191-200 | Moves into hook, exposed as `activate` |
| `addProjectByPath` | 202-222 | Moves into hook, exposed as `addProjectByPath` |
| `handlePickFolder` | 224-238 | Moves into hook, exposed as `pickFolder` |
| `refreshRecents` | 240-248 | Moves into hook, internal (not exposed directly) |
| `handleOpenAddMenu` | 250-257 | Moves into hook, exposed as `openAddMenu` |
| `handleClose` | 259-296 | Moves into hook, exposed as `close` |
| Context-menu state (`menu`, `closeMenu`) | 298-301 | Moves into hook, exposed as `contextMenuProject` / `openContextMenu` / `closeContextMenu` |
| Add-menu state (`addMenuOpen`, `recentProjects`, `addButtonRef`) | 303-307 | `addMenuOpen`/`recentProjects` move into hook; `addButtonRef` stays in `ProjectRail.tsx` (it's a DOM ref for floating-ui positioning, owned by the consumer — see API design below) |
| Add-menu floating-ui (`useFloating`, `size` middleware) | 309-339 | **Stays in `ProjectRail.tsx`** — floating-ui positioning is per-consumer (vertical rail opens `right-start`; task 2b/3a will configure a different placement for the horizontal top bar) |
| Add-button tooltip floating-ui | 341-357 | **Stays in `ProjectRail.tsx`**, same reasoning |
| `addButtonRef` wiring effect | 359-364 | Stays in `ProjectRail.tsx` |
| `openProjectPaths` / `filteredRecents` | 366-370 | Moves into hook, exposed as `filteredRecents` (`openProjectPaths` stays internal) |
| Context-menu floating-ui (virtual reference) | 372-392 | **Stays in `ProjectRail.tsx`**, same reasoning as add-menu |
| `dismiss`/`role`/`getFloatingProps` for context menu | 393-395 | Stays in `ProjectRail.tsx` |
| `handleContextMenu` (sets `menu` state incl. x/y) | 397-399 | **Stays in `ProjectRail.tsx`** — it captures click coordinates for floating-ui's virtual reference, which is DOM/positioning concern, not business logic. It calls the hook's `openContextMenu(project)` for the "which project" part. |
| `handleOpenInNewWindow` | 401-408 | Moves into hook, exposed as `openInNewWindow` |
| `handleRevealInFinder` | 410-417 | Moves into hook, exposed as `revealInFinder` |
| Early return (`if (!isMultiProjectMode) return null`) | 419 | Stays in `ProjectRail.tsx` |
| JSX return (`<nav className="project-rail">…`) | 421-548 | Stays in `ProjectRail.tsx`, rewritten to consume the hook + `ProjectRailIcon` (see below) |

**Why the floating-ui/DOM-positioning pieces stay in `ProjectRail.tsx` and are not extracted:** per this repo's floating-ui rule (`.claude/rules/floating-ui.md` / `CLAUDE.md`), every `useFloating()` instance is anchored to specific DOM refs and configured with placement/middleware tuned to its rendering context. The vertical rail opens menus to the right (`placement: 'right-start'`); PRD requirement R7 explicitly calls for the horizontal top-docked context to open menus *below* instead — a different `useFloating()` config, not a shared one. Sharing positioning logic across two structurally different DOM contexts would fight the floating-ui pattern rather than use it. The **business logic** behind those menus (what data they show, what clicking an item does) is what's shared via the hook; the **positioning** of each menu's popup is not, and is 3a's/2b's concern per-consumer.

---

## New File: `packages/electron/src/renderer/components/ProjectRailIcon.tsx`

This is the shared module. Create it with the following exact exports. Downstream tasks (2b, 3a, 4a, 4b) will import from this file by these exact names — do not rename without a strong reason, and if you do, note it prominently in your completion summary.

### 1. `projectInitials(name: string): string`

Moved verbatim from `ProjectRail.tsx:48-56`. No behavior change.

### 2. `export type ProjectRailOrientation = 'vertical' | 'horizontal';`

New type. This is the "layout/orientation prop" required by success criterion 4.

### 3. `ProjectRailIconProps` (extended)

Original (`ProjectRail.tsx:58-66`):

```ts
interface ProjectRailIconProps {
  project: OpenProject;
  isActive: boolean;
  processingCount: number;
  unreadCount: number;
  onActivate: (path: string) => void;
  onClose: (project: OpenProject) => void;
  onContextMenu: (project: OpenProject, x: number, y: number) => void;
}
```

Add one **required** field (no default value — every caller must be explicit, so `ProjectRail.tsx` passing `orientation="vertical"` is the only thing standing between today's behavior and any future drift):

```ts
export interface ProjectRailIconProps {
  project: OpenProject;
  isActive: boolean;
  processingCount: number;
  unreadCount: number;
  orientation: ProjectRailOrientation;
  onActivate: (path: string) => void;
  onClose: (project: OpenProject) => void;
  onContextMenu: (project: OpenProject, x: number, y: number) => void;
}
```

Export the interface (it was unexported/module-private before — must be exported now so consumers in other files can type their own wiring).

### 4. `ProjectRailIcon` component (extended)

Move the component body from `ProjectRail.tsx:68-179` verbatim, with these two orientation-driven changes only:

**a) Tooltip placement** — currently hardcoded `placement: 'right'` (`ProjectRail.tsx:85`). Change to:

```ts
placement: orientation === 'horizontal' ? 'bottom' : 'right',
```

This directly implements PRD R7's "tooltips and context menus reposition below instead of beside" for the one piece of tooltip positioning that lives inside this component. (The container-level add-menu/context-menu placements are configured separately, per-consumer, in `ProjectRail.tsx` today and in `WindowTopBar.tsx` later — this component only owns its own per-icon hover tooltip.)

**b) Root class name modifier** — currently (`ProjectRail.tsx:113`):

```ts
const className = isActive ? 'project-rail-item is-active' : 'project-rail-item';
```

Change to append an `is-horizontal` modifier, matching this codebase's existing space-separated state-modifier convention (`is-active`, not a BEM `--` suffix — see `ProjectRail.css:59` for the existing `.project-rail-item.is-active` pattern):

```ts
const orientationClass = orientation === 'horizontal' ? ' is-horizontal' : '';
const className = `project-rail-item${isActive ? ' is-active' : ''}${orientationClass}`;
```

`ProjectRail.tsx` always passes `orientation="vertical"`, so `orientationClass` is always `''` there — this is the mechanism that guarantees zero visual change in the left-docked case. Task 2b's brief will target `.project-rail-item.is-horizontal` in a new stylesheet to style the horizontal case; do not add any horizontal-specific styling rules yourself in this task — that is explicitly out of scope here (2b's job) and `ProjectRail.css` should not be touched by this task at all.

Everything else in the component body — the tooltip `useFloating`/`useHover`/`useInteractions` wiring, `handleClick`/`handleClose`/`handleContextMenu` callbacks, `accentColor` memo, badge logic, the returned JSX (wrapper div, activate button, close button, `FloatingPortal`-wrapped tooltip) — moves unchanged.

### 5. `REVEAL_LABEL` constant

Move `const REVEAL_LABEL = getShowInFileBrowserLabel();` (`ProjectRail.tsx:46`) here as an **exported** constant (it currently isn't exported since it's only used within the same file; now `ProjectRail.tsx` needs to import it for the context-menu JSX it still renders). Keep the `getShowInFileBrowserLabel` import (`@nimbalyst/runtime`) in this new file; remove it from `ProjectRail.tsx`.

### 6. `useProjectRailController()` hook

This is the extracted container-level business logic. It is **orientation-agnostic** — unlike the icon component, this hook has no visual output and needs no orientation parameter; the same hook instance shape works whether the consumer renders vertically or horizontally. It takes no arguments (it reads the same module-level atoms `ProjectRail()` reads today) and returns:

```ts
export interface ProjectRailController {
  // --- Data (read-only) ---
  openProjects: OpenProject[];
  activePath: string | null;
  atCap: boolean;

  // --- Per-icon activity lookup, replaces the inline
  //     `activitySummary.get(project.path)` call at ProjectRail.tsx:426 ---
  getActivity: (path: string) => { processingCount: number; unreadCount: number };

  // --- Project switching ---
  activate: (path: string) => void;

  // --- Close (async: confirms streaming sessions, unregisters, may close window) ---
  close: (project: OpenProject) => Promise<void>;

  // --- Add-project flow ---
  addMenuOpen: boolean;
  openAddMenu: () => void;   // capacity check + alert-if-at-cap + refresh recents + open
  closeAddMenu: () => void;
  recentProjects: Array<{ path: string; name: string; timestamp?: number }>;
  filteredRecents: Array<{ path: string; name: string; timestamp?: number }>;
  pickFolder: () => Promise<void>;
  addProjectByPath: (workspacePath: string) => Promise<void>;

  // --- Context menu (business-logic half only — see note above on why
  //     x/y positioning state stays in the consumer) ---
  contextMenuProject: OpenProject | null;
  openContextMenu: (project: OpenProject) => void;
  closeContextMenu: () => void;
  openInNewWindow: (project: OpenProject) => Promise<void>;
  revealInFinder: (project: OpenProject) => Promise<void>;
}

export function useProjectRailController(): ProjectRailController {
  // implementation moves the logic listed in the Requirements table above
}
```

**Implementation notes for each field:**

- `openProjects`, `activePath`: straight `useAtomValue(openProjectsAtom)` / `useAtom(activeWorkspacePathAtom)`, same as `ProjectRail.tsx:183-184` today.
- `atCap`: `useAtomValue(isOpenProjectsAtCapAtom)`, same as today (`ProjectRail.tsx:185`).
- `getActivity(path)`: wraps `useAtomValue(projectActivitySummaryAtom)` (same atom as today, `ProjectRail.tsx:189`) — `projectActivitySummaryAtom`'s value type is `Map<string, ProjectActivitySummary>` where `ProjectActivitySummary = { processing: number; unread: number }` (`packages/electron/src/renderer/store/atoms/sessionActivity.ts:256-258, 267`). Implement as: `(path) => { const a = activitySummary.get(path); return { processingCount: a?.processing ?? 0, unreadCount: a?.unread ?? 0 }; }` — this reproduces the exact `?? 0` fallback used inline at `ProjectRail.tsx:432-433` today.
- `activate`: moves `handleActivate` (`ProjectRail.tsx:191-200`) unchanged — still skips the no-op case where `path === activePath`.
- `close`: moves `handleClose` (`ProjectRail.tsx:259-296`) unchanged, including the `activity.get(project.path)?.streaming.size ?? 0` streaming-confirm check against `globalSessionActivityAtom` (a **separate** atom from `projectActivitySummaryAtom` — both are read inside this hook, for different purposes, exactly as `ProjectRail()` reads both today at lines 188-189), the `wasLast = openProjects.length <= 1` computed **before** calling `closeProject`, the `workspace:unregister-additional` IPC call, and the `workspace:close-rail-window` fallback when `wasLast`.
- `addMenuOpen`/`openAddMenu`/`closeAddMenu`: `addMenuOpen` is `useState` moved from `ProjectRail.tsx:305`. `openAddMenu` reproduces `handleOpenAddMenu` (`ProjectRail.tsx:250-257`): checks `atCap`, shows the `window.alert(...)` and returns early if so, otherwise calls the internal `refreshRecents()` then `setAddMenuOpen(true)`. `closeAddMenu` is `() => setAddMenuOpen(false)`.
- `recentProjects`/`filteredRecents`: `recentProjects` is `useState` moved from `ProjectRail.tsx:306`, populated by the internal (not exposed) `refreshRecents` (`ProjectRail.tsx:240-248`, calls `settings:get-recent-projects` IPC). `filteredRecents` is the `useMemo` from `ProjectRail.tsx:366-370` (filters out paths already in `openProjects`, caps at 8) — keep `openProjectPaths` as an internal `useMemo`, not exposed on the returned object.
- `pickFolder`: moves `handlePickFolder` (`ProjectRail.tsx:224-238`) unchanged.
- `addProjectByPath`: moves `addProjectByPath` (`ProjectRail.tsx:202-222`) unchanged, including the `workspace:register-additional` IPC call and the constructed `OpenProject` shape (`name` derived from `workspacePath.split(/[\\/]/).filter(Boolean).pop()`).
- `contextMenuProject`/`openContextMenu`/`closeContextMenu`: replaces the `menu` state at `ProjectRail.tsx:300` — but note the *original* `menu` state was `{ project, x, y } | null` (positioning bundled with data). Split it: the hook owns only `contextMenuProject: OpenProject | null` (`openContextMenu(project)` sets it, `closeContextMenu()` clears it). The consumer (`ProjectRail.tsx`) keeps its own local `{ x, y }` state (set inside its own `handleContextMenu`, which now calls both `setMenuPosition({x,y})` locally *and* `controller.openContextMenu(project)`) to feed the virtual floating-ui reference. This split is what lets `WindowTopBar.tsx` (task 3a) reuse `contextMenuProject`/`openContextMenu`/`closeContextMenu` while wiring its own click-coordinate capture and its own floating-ui virtual reference, without needing the hook to know anything about pixel coordinates.
- `openInNewWindow`/`revealInFinder`: move `handleOpenInNewWindow`/`handleRevealInFinder` (`ProjectRail.tsx:401-417`) unchanged, including their own `closeMenu()` calls at the top (now `closeContextMenu()`) and the `workspace-manager:open-workspace` / `show-in-finder` IPC calls.

---

## Rewriting `ProjectRail.tsx`

After extraction, `ProjectRail.tsx` should:

1. Import `ProjectRailIcon`, `ProjectRailIconProps` (if needed for typing), `useProjectRailController`, `ProjectRailController` (if needed for typing), and `REVEAL_LABEL` from `./ProjectRailIcon`.
2. Keep its own imports for `@floating-ui/react` pieces, `windowControlsClearance`, `multiProjectModeAtom` (still needed for the early-return gate — this atom is **not** part of the extracted controller since it's a rendering-gate concern, not a rail-controller concern).
3. Call `const controller = useProjectRailController();` at the top of the component body.
4. Keep all four `useFloating()` instances (add-menu, add-tooltip, context-menu, and — inside `ProjectRailIcon` itself, not here — the per-icon tooltip) exactly as they are today, but drive their `open`/`onOpenChange` off `controller.addMenuOpen`/`controller.openAddMenu`/`controller.closeAddMenu` and `controller.contextMenuProject` instead of local `useState`.
5. Keep the local `{ x, y }` state for the context-menu virtual reference (see split explained above), setting it inside its own `handleContextMenu(project, x, y)` which now also calls `controller.openContextMenu(project)`.
6. Render `<ProjectRailIcon orientation="vertical" ... />` for each `openProjects` entry, passing `isActive={project.path === controller.activePath}`, `processingCount`/`unreadCount` from `controller.getActivity(project.path)`, `onActivate={controller.activate}`, `onClose={controller.close}`, `onContextMenu={handleContextMenu}` (the local wrapper described in point 5).
7. Keep the `<nav className="project-rail">` shell, `OrgSwitcher`, divider, add-button, add-tooltip, add-menu JSX, and context-menu JSX exactly as today (`ProjectRail.tsx:421-548`) — only the data sources feeding them change (from local `useState`/`useCallback` to `controller.*`).
8. Keep the `if (!isMultiProjectMode) return null;` early return (`ProjectRail.tsx:419`) unchanged — `isMultiProjectMode` still comes from `useAtomValue(multiProjectModeAtom)` directly in `ProjectRail.tsx`, not routed through the hook.

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] New shared icon component (`ProjectRailIcon` in the new `packages/electron/src/renderer/components/ProjectRailIcon.tsx`) exports the same active-state, tooltip, close, and context-menu-trigger behavior currently inline in `ProjectRailIcon` (`ProjectRail.tsx:68-179` as it exists before this task's changes)
- [ ] Add-project flow, close handler, and `isOpenProjectsAtCapAtom`/activity-atom wiring are extracted into `useProjectRailController()` (a shared, reusable hook) rather than left inline in `ProjectRail()`
- [ ] `ProjectRail.tsx` renders the extracted pieces with zero visual/behavioral change in the left-docked case — same DOM structure, same class names, same `data-testid` values, same interaction behavior as before this task
- [ ] `ProjectRailIcon`'s props accept a required `orientation: ProjectRailOrientation` (`'vertical' | 'horizontal'`) prop that drives tooltip placement (`'bottom'` vs `'right'`) and an `is-horizontal` class modifier, so task 2b can style the horizontal case and task 3a can render the horizontal case without a second component implementation
- [ ] `npm run typecheck` passes
- [ ] No tests added in this task (deferred to task 5a per this PRD's explicit orchestration decision — see Testing Requirements below)

**All criteria must pass before task is complete.**

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/electron/src/renderer/components/ProjectRailIcon.tsx` | create | Shared icon component, `useProjectRailController()` hook, `projectInitials()`, `REVEAL_LABEL` — the reusable API surface tasks 2b/3a/4a/4b build on |
| `packages/electron/src/renderer/components/ProjectRail.tsx` | modify | Strip extracted logic; render `ProjectRailIcon` + `useProjectRailController()` instead; keep all floating-ui positioning, the `<nav>` shell, and the `multiProjectModeAtom` gate |

### File Ownership Notes

`ProjectRail.tsx`/`ProjectRailIcon.tsx` are disjoint from task 1a's file set (`store.ts`, `SettingsHandlers.ts`, `openProjects.ts`) — confirmed by `execution_plan.yaml`'s `file_conflicts_checked.wave_1`. No coordination needed with 1a. Task 2b (Wave 2) edits `ProjectRailIcon.tsx` after this task creates it (`execution_plan.yaml`'s `wave_2_note`) — this is sequencing (2b depends on 1b), not a same-wave conflict. Do **not** touch `ProjectRail.css` in this task — it stays entirely vertical-only; 2b owns the new horizontal stylesheet.

---

## Deliverables

None beyond the files above.

---

## Implementation Guidance

### Patterns to Follow

- Preserve the `@floating-ui/react` + `FloatingPortal` + `windowControlsClearance()` pattern already used for every tooltip/menu (`ProjectRail.tsx:27` for the import; instances at lines 82-90, 309-339, 345-357, 372-379) — do not hand-roll `position: fixed` per `.claude/rules/floating-ui.md` / `CLAUDE.md`'s floating-ui rule. This task doesn't add any new floating-ui instances, but it must not regress the existing ones during the move.
- Match this codebase's existing state-modifier class convention — space-separated (`'project-rail-item is-active'`), not BEM (`--`) — when adding the `is-horizontal` modifier. See `ProjectRail.css:59` for the precedent (`.project-rail-item.is-active`).
- Per `REACT_DOM_MARKERS.md`: `ProjectRailIcon`'s root already carries the semantic class `project-rail-item` and `data-testid="project-rail-item"` (`ProjectRail.tsx:134`) — preserve both unchanged; do not add a second competing semantic root class for the orientation variant, only the `is-horizontal` modifier.

### Code Style

- `camelCase` for all new TypeScript identifiers (hook name, interface fields), per `NAMING_CONVENTIONS.md`.
- Export everything downstream tasks need by the exact names specified in this brief (`ProjectRailIcon`, `ProjectRailIconProps`, `ProjectRailOrientation`, `useProjectRailController`, `ProjectRailController`, `projectInitials`, `REVEAL_LABEL`) — task 2b's and 3a's briefs will reference these names directly.

### Edge Cases

- **`wasLast` computed before `closeProject`**: preserve the exact ordering in `close()` — `openProjects.length <= 1` must be read *before* `closeProject(project.path)` mutates the atom, otherwise the last-project-closes-window fallback breaks (the array is already empty by the time you'd check it after).
- **Two separate activity atoms, don't conflate them**: `globalSessionActivityAtom` (streaming-session confirm-on-close) and `projectActivitySummaryAtom` (per-icon badge counts) are different atoms with different shapes (`WorkspaceActivity { streaming: Set<string>; unread: Set<string> }` vs `ProjectActivitySummary { processing: number; unread: number }`, both in `packages/electron/src/renderer/store/atoms/sessionActivity.ts`). Both are read inside the hook, for different consumers of the hook's return value (`close()` uses the former internally; `getActivity()` exposes the latter).
- **`addButtonRef` stays a `ProjectRail.tsx`-local DOM ref**, not part of the hook — it's a specific `<button>` element in the vertical rail's own JSX; `WindowTopBar.tsx` (task 3a) will have its own add-button element and its own ref, wired to the same `controller.openAddMenu`/`closeAddMenu` state but its own floating-ui instance.
- **Do not add any horizontal-specific CSS** in this task. `ProjectRail.css` is untouched; the `is-horizontal` class exists only so task 2b has a stable selector to target — it currently does nothing visually.

### Testing Requirements

This PRD defers all tests to a dedicated end-of-work task (5a), per explicit user direction recorded in the PRD (Section "Orchestration" and task 5a's description) — this **overrides** this repo's default "tests ship with the behavioral change" convention for *task sequencing only* in this PRD. **Do not write tests in this task.** Task 5a's brief will cover this task's output indirectly through the `WindowTopBar` rendering tests (3a/4a/4b) and does not list a dedicated `ProjectRailIcon.test.tsx` file, since this task is a pure refactor with no new user-facing behavior — the zero-behavior-change constraint above is what stands in for a regression test here; verify it manually (or via the existing `npm run test:unit` suite if any pre-existing tests already exercise `ProjectRail`) before finishing.

Despite deferring test-writing, the end-of-work gate (`npm run typecheck && npm run test:prepush`) must still be green before the single integration review, so run `npm run typecheck` before finishing this task.

---

## Boundaries

### Files You MUST NOT Touch

Per `.nimble/config.yaml` `boundaries.never_touch` (global list — not specific to this task, but relevant subset):
- `*.lock`, `package-lock.json`
- `.env*`
- `packages/electron/src/database/migrations/*`
- `dist/`, `out/`, `out2/`, `release/`, `node_modules/`
- `.nimbalyst/`, `.dolt/`, `*.db`
- `packages/electron/index.js`
- `packages/electron/resources/bundled-extensions/*.nimext`

None of these overlap with this task's file set.

### Files Requiring Review

Per `.nimble/config.yaml` `boundaries.require_review`, this task's files (`packages/electron/src/renderer/components/ProjectRail.tsx`, `ProjectRailIcon.tsx`) are **renderer** paths, not `packages/electron/src/main/**` — they do **not** fall under `require_review`. Unlike sibling task 1a, this task's files are not flagged for the require-review boundary at the single end-of-work integration review (confirmed by `execution_plan.yaml`'s `review_gate.require_review_files_touched`, which lists only `store.ts` and `SettingsHandlers.ts`).

---

## Dependencies

### Upstream Tasks

None — `depends_on: []`. This is one of two Wave 1 foundation tasks (alongside 1a) with no prerequisites, and runs on a disjoint file set from 1a.

### Downstream Impact

Tasks that depend on this one:

| Task | What it needs from 1b |
|------|------------------------|
| 2b (Horizontal CSS) | The `is-horizontal` class hook and `ProjectRailIcon.tsx`'s existing structure to style, without writing a second icon component |
| 3a (WindowTopBar merge) | `useProjectRailController()` and `ProjectRailIcon` (with `orientation="horizontal"`) to render the top-docked bar's content without re-implementing add/close/capacity logic — this is the entire reason this task's scope was widened beyond icon-rendering alone |
| 4a (transition animation) | `ProjectRailIcon`'s structure (to animate between circle and expanded-name forms) |
| 4b (hover-reveal) | The controller's data (`openProjects`, `activePath`) to know which circles to reveal on hover |

**Before starting:** No upstream verification needed — this task has no dependencies and can start immediately.

---

## GitHub Context

**Issue:** N/A — this PRD is not tracked via GitHub Issues (see Feature Issue note in the header)
**Feature Issue (Parent):** N/A
**Branch:** `worktree/project-bar-movement` — this PRD uses a single shared feature branch for all 8 tasks (per `status.json`'s `branch_strategy: "use-worktree-branch-directly"` and the PRD's explicit orchestration decision: "Single feature branch, all 8 tasks land together; one integration review at the end"). Do not create a per-task branch.
**Target:** Determined by PM agent — per this PRD's single-integration-review orchestration, this task's commit lands on the shared feature branch, not directly on `main`.

---

## Commit Guidelines

Use Conventional Commits. Keep the subject to one sentence, per this repo's `CLAUDE.md` commit-message rule (no root-cause prose in the body unless the diff can't explain itself):

```
refactor(electron): extract shared project-rail icon and controller logic
```

Do NOT add a `Co-Authored-By: Claude` trailer — this repo's `CLAUDE.md` explicitly says "Don't add `Co-Authored-By` lines to commit messages."

Types: feat, fix, refactor, test, docs, chore

**CHANGELOG.md:** Per this repo's `CLAUDE.md`, only update `CHANGELOG.md` when explicitly asked to propose a commit, and only with a user-facing line. This task is a pure internal refactor with zero visible behavior change — per `CLAUDE.md`'s explicit rule ("Internal-only changes... refactors... get NO entry"), do **not** add a CHANGELOG bullet for this task, even if a CHANGELOG entry is requested for the overall PRD (that entry belongs on whichever task ships the visible top-docked feature — likely 3a or the final integration commit).

---

## Validation Checklist

Before creating PR / handing off for the integration review:
- [ ] All success criteria met
- [ ] Build passes: `npm run build`
- [ ] Type check passes: `npm run typecheck`
- [ ] No `never_touch` files modified
- [ ] `ProjectRail.css` not modified (2b's scope, not this task's)
- [ ] No tests added in this task (deferred to 5a per PRD orchestration) — confirm this is intentional, not an oversight, if a reviewer flags it
- [ ] Manually verified zero visual/behavioral change in the left-docked case (default settings, `projectRailPosition` unset/`'left'`)
- [ ] Branch is the shared feature branch `worktree/project-bar-movement`, not a new per-task branch

---

*Generated by NIMBLE Brief Writer*
*PRD: project-bar-top-placement | Task: 1b | Wave: 1*
