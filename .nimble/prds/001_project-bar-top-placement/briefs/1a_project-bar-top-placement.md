# Task Brief: 1a

**Title:** Persisted project-bar layout settings (position + display mode)
**PRD:** project-bar-top-placement
**Priority:** must
**Complexity:** 4/10
**Model:** sonnet
**Wave:** 1
**Feature Issue:** N/A — this PRD is not tracked via a GitHub Issue (tracker `issue_key` is `null` in `status.json`; NIMBLE tracker item `plan_1787289447069_qb6yvp` is the plan record instead)

---

## Objective

Add two new persisted app settings — `projectRailPosition` and `projectRailExpandedDisplay` — that will let a later task (2a) expose a settings-UI control for moving the project bar from the left edge to the top of the window. This task only builds the plumbing (store schema → IPC → renderer atom); no UI. Both settings must default to today's behavior so existing users see zero change until they explicitly opt in via task 2a's UI.

---

## Context

**Parent Feature:** Project Bar Top Placement (project-bar-top-placement) — no GitHub Issue exists for this PRD; see Feature Issue note above.

Today, `ProjectRail` (`packages/electron/src/renderer/components/ProjectRail.tsx`) is a fixed 56px vertical strip on the left showing circular avatars for each open project. This PRD adds a setting to instead dock that content into the title bar at the top of the window, with the active project's circle expanding into full name text. This task (1a) is the first of two independent Wave 1 tasks (alongside 1b, which extracts shared rendering logic from `ProjectRail`) and lays down the persisted-settings plumbing that every later task in the PRD reads from.

This task is part of **Wave 1** — the foundation wave. It has no dependencies and nothing in this PRD depends on 1b, so 1a and 1b run in parallel on disjoint files. Task 2a (Settings UI, Wave 2) depends directly on 1a's IPC channels and atoms; do not invent your own channel names or atom names — 2a's brief will reference the exact ones you create here.

Both new settings are **string unions, not booleans** — this is a deliberate architecture decision already made in the PRD (Section 11, "Architecture decisions already made — don't re-decide"): future rail positions (right/bottom) or display modes can be added later as a type extension, without a schema migration.

---

## Requirements

Add two settings, each following the existing **Multi-project Mode** four-layer pattern exactly (schema → IPC → renderer atom; the fourth layer, UI, is task 2a — do not build it here):

1. **`projectRailPosition: 'left' | 'top'`** — default `'left'`. Fulfills PRD requirement R1.
2. **`projectRailExpandedDisplay: 'always-visible' | 'hover-reveal'`** — default `'always-visible'`. Fulfills PRD requirement R3.

Both must:
- Be typed as string-literal unions in TypeScript (mirror `ReleaseChannel`/`CompletionSoundType`'s exported-type pattern below), never `boolean`.
- Default such that an existing saved-state object with the field **absent** (not just `undefined` — genuinely missing from the persisted JSON, as with any user who saved state before this PRD shipped) resolves to `'left'` / `'always-visible'` respectively, without throwing.
- Use the `??` default-merge idiom at the renderer-atom load site (not `!!value` boolean coercion — that pattern only works for booleans and is unsuitable for a string union).

---

## Requirements Detail — Exact Pattern to Clone

### Layer 1: Store schema + getter/setter (`packages/electron/src/main/utils/store.ts`)

**Schema field** — the interface these settings live on has the `multiProjectMode` field at line 293:

```ts
// packages/electron/src/main/utils/store.ts:291-293
// Multi-project rail: opt-in flag to host multiple projects in a single
// window. When false (default), each project still gets its own window.
multiProjectMode?: boolean;
```

Add two new optional fields to this same interface, immediately adjacent, each with a comment explaining the union and default (following the existing comment style on that field):

```ts
projectRailPosition?: 'left' | 'top';
projectRailExpandedDisplay?: 'always-visible' | 'hover-reveal';
```

Also export the union types themselves at the top of the file, next to the existing exported union-type aliases (`packages/electron/src/main/utils/store.ts:24-25`):

```ts
export type CompletionSoundType = 'chime' | 'bell' | 'pop' | 'alert' | 'custom' | 'none';
export type ReleaseChannel = 'stable' | 'alpha';
```

Add:

```ts
export type ProjectRailPosition = 'left' | 'top';
export type ProjectRailExpandedDisplay = 'always-visible' | 'hover-reveal';
```

Use these exported types for the schema field, getter return type, and setter parameter type (do not inline the literal union at every use site).

**Getter/setter functions** — the exact pattern to clone is `getMultiProjectMode`/`setMultiProjectMode` at `packages/electron/src/main/utils/store.ts:2743-2749`:

```ts
// Multi-Project Rail Settings
// `multiProjectMode` is the opt-in toggle that lets users open several
// projects in a single window via the project rail. The `openProjects` list
// and `activeProjectPath` are restored on launch so the rail rehydrates.

export function getMultiProjectMode(): boolean {
  return getAppStore().get('multiProjectMode', false);
}

export function setMultiProjectMode(enabled: boolean): void {
  getAppStore().set('multiProjectMode', enabled);
}
```

Add two analogous function pairs nearby (same file, near the Multi-Project Rail Settings block, since these are conceptually part of the same rail-settings group):

```ts
export function getProjectRailPosition(): ProjectRailPosition {
  return getAppStore().get('projectRailPosition', 'left');
}

export function setProjectRailPosition(position: ProjectRailPosition): void {
  getAppStore().set('projectRailPosition', position);
}

export function getProjectRailExpandedDisplay(): ProjectRailExpandedDisplay {
  return getAppStore().get('projectRailExpandedDisplay', 'always-visible');
}

export function setProjectRailExpandedDisplay(mode: ProjectRailExpandedDisplay): void {
  getAppStore().set('projectRailExpandedDisplay', mode);
}
```

The `getAppStore().get(key, defaultValue)` call is electron-store's own default-value parameter — this is what makes "field missing from persisted JSON" resolve correctly at the main-process layer. This is layer 1 of the default-resolution story; layer 3 (renderer atom) needs its own `??` guard too — see below — because the IPC round-trip could in principle return `undefined` (e.g. a stale preload/main mismatch), and a renderer atom typed as a string union must never hold `undefined`.

### Layer 2: IPC handlers (`packages/electron/src/main/ipc/SettingsHandlers.ts`)

Import the four new functions in the existing `import { ... } from '../utils/store';` block. `getMultiProjectMode, setMultiProjectMode` are imported at line 30 of that block (`packages/electron/src/main/ipc/SettingsHandlers.ts:8-45`); add your four functions as a new line in the same import statement, near that line.

The handler-registration pattern to clone is `app:get-multi-project-mode` / `app:set-multi-project-mode` at `packages/electron/src/main/ipc/SettingsHandlers.ts:625-632`:

```ts
// Multi-project rail (opt-in: hosts multiple projects in a single window)
safeHandle('app:get-multi-project-mode', async () => {
    return getMultiProjectMode();
});

safeHandle('app:set-multi-project-mode', async (_event, enabled: boolean) => {
    setMultiProjectMode(enabled);
});
```

Add four new handlers, in the same registration function, near this block:

```ts
safeHandle('app:get-project-rail-position', async () => {
    return getProjectRailPosition();
});

safeHandle('app:set-project-rail-position', async (_event, position: ProjectRailPosition) => {
    setProjectRailPosition(position);
});

safeHandle('app:get-project-rail-expanded-display', async () => {
    return getProjectRailExpandedDisplay();
});

safeHandle('app:set-project-rail-expanded-display', async (_event, mode: ProjectRailExpandedDisplay) => {
    setProjectRailExpandedDisplay(mode);
});
```

Channel names are exact — task 2a's brief and the success criteria below both hard-code `app:get/set-project-rail-position` and `app:get/set-project-rail-expanded-display`. Do not rename them.

Note: `safeHandle`/`safeOn` is this codebase's required wrapper over raw `ipcMain.handle`/`ipcMain.on` (see `MAIN_PROCESS_INIT.md`) — it is already imported at the top of `SettingsHandlers.ts` (`import { safeHandle, safeOn } from '../utils/ipcRegistry';`, line 3). No separate preload allowlist entry is needed: `window.electronAPI.invoke` is a generic pass-through (confirmed by grepping the existing multi-project-mode channel names — they appear only in `SettingsHandlers.ts` and `openProjects.ts`, nowhere in `preload/index.ts`).

### Layer 3: Renderer atoms + persistence (`packages/electron/src/renderer/store/atoms/openProjects.ts`)

**Atom declarations** — clone the shape of `multiProjectModeAtom` (`packages/electron/src/renderer/store/atoms/openProjects.ts:59-67`):

```ts
/**
 * Whether multi-project mode is enabled. When false, rail UI is hidden and
 * opening a new project spawns a fresh window (legacy behavior). When true,
 * opening a project adds it to the rail in the current window.
 *
 * Persisted via `app:set-multi-project-mode` IPC; seeded from store on
 * launch by an effect that reads `app:get-multi-project-mode`.
 */
export const multiProjectModeAtom = atom<boolean>(false);
```

Add two new atoms nearby (same file, near the other rail-config atoms), each with a doc comment following this style, and each defaulted to the same value as the main-process getter default:

```ts
export const projectRailPositionAtom = atom<'left' | 'top'>('left');
export const projectRailExpandedDisplayAtom = atom<'always-visible' | 'hover-reveal'>('always-visible');
```

(Import the `ProjectRailPosition`/`ProjectRailExpandedDisplay` types from `../../../main/utils/store` if this file already imports main-process types elsewhere for consistency; otherwise inline the literal union is acceptable here since the file does not currently import cross-process types — check current imports at the top of `openProjects.ts:16-20` before deciding, and match whatever convention is already established there.)

**Load in `initOpenProjects()`** — the load site is `packages/electron/src/renderer/store/atoms/openProjects.ts:267-283`. The existing multi-project-mode load line is:

```ts
const [mode, restorePrev, paths, activePath, initialState] = await Promise.all([
  window.electronAPI.invoke('app:get-multi-project-mode') as Promise<boolean>,
  window.electronAPI.invoke('app:get-restore-previous-projects') as Promise<boolean>,
  window.electronAPI.invoke('app:get-open-projects') as Promise<string[]>,
  window.electronAPI.invoke('app:get-active-project-path') as Promise<string | null>,
  window.electronAPI.getInitialState?.() ?? Promise.resolve(null),
]);

store.set(multiProjectModeAtom, !!mode);
store.set(restorePreviousProjectsAtom, !!restorePrev);
```

Add two new entries to the `Promise.all` array (two new invoke calls) and set the two new atoms using **`??`**, not `!!` — `!!` is boolean-only coercion and is wrong for a string union (e.g. `!!'left'` is `true`, not `'left'`):

```ts
store.set(projectRailPositionAtom, position ?? 'left');
store.set(projectRailExpandedDisplayAtom, expandedDisplay ?? 'always-visible');
```

This is the concrete instance of the repo's `STATE_PERSISTENCE.md` "Always Merge with Defaults" rule (`docs/STATE_PERSISTENCE.md`) — the `??` guards against the IPC call returning `null`/`undefined` even though the main-process getter already has its own default; both layers defend independently, matching the two-layer default pattern already used elsewhere in this codebase (e.g. `appSettings.ts`'s `loaded.enabled ?? defaultConfig.enabled`).

**Persist via `store.sub`** — the subscriber-registration site is `packages/electron/src/renderer/store/atoms/openProjects.ts:332-352`, inside the same `unsubscribers.push(...)` call. The existing multi-project-mode subscriber:

```ts
store.sub(multiProjectModeAtom, () => {
  const mode = store.get(multiProjectModeAtom);
  window.electronAPI?.invoke?.('app:set-multi-project-mode', mode).catch((err: unknown) => {
    console.error('[openProjects] Failed to persist multiProjectMode:', err);
  });
}),
```

Add two analogous entries to the same `unsubscribers.push(...)` array:

```ts
store.sub(projectRailPositionAtom, () => {
  const position = store.get(projectRailPositionAtom);
  window.electronAPI?.invoke?.('app:set-project-rail-position', position).catch((err: unknown) => {
    console.error('[openProjects] Failed to persist projectRailPosition:', err);
  });
}),
store.sub(projectRailExpandedDisplayAtom, () => {
  const mode = store.get(projectRailExpandedDisplayAtom);
  window.electronAPI?.invoke?.('app:set-project-rail-expanded-display', mode).catch((err: unknown) => {
    console.error('[openProjects] Failed to persist projectRailExpandedDisplay:', err);
  });
}),
```

Do not add a debounce here — `multiProjectModeAtom`'s subscriber persists immediately on every change (unlike `openProjectsAtom`/`activeWorkspacePathAtom`, which use `schedulePersistOpenProjects()`/`schedulePersistActivePath()` debouncing at lines 346-349 because they can fire rapidly during drag/reorder). A position or display-mode toggle changes rarely and should persist immediately, matching `multiProjectModeAtom`'s un-debounced pattern.

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] Both fields (`projectRailPosition`, `projectRailExpandedDisplay`) exist in the app-settings store schema (`packages/electron/src/main/utils/store.ts`) as string unions, each with getter/setter functions mirroring `getMultiProjectMode`/`setMultiProjectMode`
- [ ] IPC handlers `app:get-project-rail-position`, `app:set-project-rail-position`, `app:get-project-rail-expanded-display`, `app:set-project-rail-expanded-display` are registered via `safeHandle` in `SettingsHandlers.ts`
- [ ] Renderer atoms (`projectRailPositionAtom`, `projectRailExpandedDisplayAtom`) load via `??` default-merge in `initOpenProjects()` and persist via `store.sub`, mirroring `multiProjectModeAtom`'s wiring
- [ ] Loading a saved-state object missing these fields resolves to `'left'` / `'always-visible'` without throwing (verify by exercising the getter with no prior `.set()` call — electron-store's `.get(key, default)` returns the default when the key was never written)
- [ ] `npm run typecheck` passes
- [ ] No UI work performed — this task is plumbing only; the settings control is task 2a's scope

**All criteria must pass before task is complete.**

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/electron/src/main/utils/store.ts` | modify | Add `ProjectRailPosition`/`ProjectRailExpandedDisplay` exported types, two schema fields, and four getter/setter functions |
| `packages/electron/src/main/ipc/SettingsHandlers.ts` | modify | Import the four new store functions; register four `safeHandle` IPC channels |
| `packages/electron/src/renderer/store/atoms/openProjects.ts` | modify | Add two new atoms; load them with `??` defaults in `initOpenProjects()`; add two `store.sub` persistence subscribers |

### File Ownership Notes

`store.ts` and `SettingsHandlers.ts` are `require_review` boundary files under `.nimble/config.yaml` (main-process paths) — this is expected and already flagged in the PRD (Section 6, Risks table) and this project's single end-of-work review, not a surprise mid-task. `openProjects.ts` is also modified by task 1b's sibling files (`ProjectRail.tsx`, `ProjectRailIcon.tsx`) but 1b does not touch `openProjects.ts` itself — the execution plan (`execution_plan.yaml`, `file_conflicts_checked.wave_1`) confirms 1a's and 1b's file sets are disjoint; no coordination needed with 1b.

---

## Deliverables

None beyond the files above.

---

## Implementation Guidance

### Patterns to Follow

- Clone `getMultiProjectMode`/`setMultiProjectMode` (`store.ts:2743-2749`) exactly for the two new getter/setter pairs — same `getAppStore().get(key, default)` / `.set(key, value)` shape.
- Clone `app:get-multi-project-mode`/`app:set-multi-project-mode` (`SettingsHandlers.ts:625-632`) exactly for the four new `safeHandle` registrations.
- Clone `multiProjectModeAtom`'s declaration, load-site, and un-debounced `store.sub` persistence (`openProjects.ts:59-67`, `267-283`, `332-339`) exactly for the two new atoms — do not copy the debounced pattern used by `openProjectsAtom`/`activeWorkspacePathAtom` (those debounce because they fire on every drag/reorder; a settings toggle does not need debouncing).
- Use the exported-type-alias pattern already established for `CompletionSoundType`/`ReleaseChannel` (`store.ts:24-25`) rather than inlining the literal union at every getter/setter/IPC-handler signature.

### Code Style

- `camelCase` for the two new store field names, IPC channel payload shapes (per `NAMING_CONVENTIONS.md` — wire-format JSON is always `camelCase`), and TypeScript identifiers.
- IPC channel names themselves follow the existing `app:get-<kebab-name>` / `app:set-<kebab-name>` convention already used throughout `SettingsHandlers.ts` — do not deviate from the exact channel names specified in this brief (`app:get-project-rail-position`, `app:set-project-rail-position`, `app:get-project-rail-expanded-display`, `app:set-project-rail-expanded-display`); task 2a's brief hard-codes these.

### Edge Cases

- **Missing field on old saved state**: the primary edge case this task exists to handle. Two independent defense layers: (1) `getAppStore().get(key, defaultValue)` in the main-process getter, (2) `??` at the renderer-atom load site. Neither layer alone is sufficient per this repo's `STATE_PERSISTENCE.md` "Always Merge with Defaults" rule — implement both.
- **Do not use `!!value` for these atoms.** `multiProjectModeAtom`'s load line uses `!!mode` because it is a boolean; a string union must use `?? defaultValue` instead. Using `!!` on a string union silently corrupts the value to a boolean (`!!'left'` → `true`), which is a type-checker-invisible bug — `store.set` would coerce or fail depending on strictness, so double-check this specific line carefully during self-review.
- **Do not add UI validation logic** (e.g., checking the position is a recognized value) in this task — that belongs to whichever layer eventually needs it, and no such need exists yet at the store/IPC/atom layers; TypeScript's union type is the only validation this task provides.

### Testing Requirements

This PRD defers all tests to a dedicated end-of-work task (5a), per explicit user direction recorded in the PRD (Section "Orchestration" and task 5a's description) — this **overrides** this repo's default "tests ship with the behavioral change" convention for *task sequencing only* in this PRD. **Do not write tests in this task.** Task 5a's first success criterion explicitly covers this task's default-merge behavior: "Unit test confirms `projectRailPosition` and `projectRailExpandedDisplay` default to `'left'`/`'always-visible'` when absent from saved state." Task 5a's brief will target `packages/electron/src/renderer/store/atoms/openProjects.test.ts` (a new file) for this coverage — no such file exists yet as of this task.

Despite deferring test-writing, the end-of-work gate (`npm run typecheck && npm run test:prepush`) must still be green before the single integration review, so run `npm run typecheck` before finishing this task to catch type errors in the new getter/setter/atom signatures early — do not wait for task 5a to surface a type mismatch in this task's code.

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

Per `.nimble/config.yaml` `boundaries.require_review`, both files this task modifies fall under this list:
- `packages/electron/src/main/utils/store.ts` — matches `packages/electron/src/main/**`
- `packages/electron/src/main/ipc/SettingsHandlers.ts` — matches `packages/electron/src/main/**`

This is expected for this task (both are main-process files) and does not block work — it means these files get scrutiny at the single end-of-work integration review already planned for this PRD (per `execution_plan.yaml`'s `review_gate.require_review_files_touched`, which lists exactly these two files). Do not skip or route around review; just be aware the change is flagged, not blocked.

---

## Dependencies

### Upstream Tasks

None — `depends_on: []`. This is one of two Wave 1 foundation tasks (alongside 1b) with no prerequisites.

### Downstream Impact

Tasks that depend on this one:

| Task | What it needs from 1a |
|------|------------------------|
| 2a (Settings UI) | The exact atom names (`projectRailPositionAtom`, `projectRailExpandedDisplayAtom`) and IPC channel names built here, to wire a settings-panel control |
| 3a (WindowTopBar merge) | Reads `projectRailPositionAtom` to decide whether to render the left-docked or top-docked layout |

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
feat(electron): add persisted project-bar position and display-mode settings
```

Do NOT add a `Co-Authored-By: Claude` trailer — this repo's `CLAUDE.md` explicitly says "Don't add `Co-Authored-By` lines to commit messages."

Types: feat, fix, refactor, test, docs, chore

**CHANGELOG.md:** Per this repo's `CLAUDE.md`, only update `CHANGELOG.md` when explicitly asked to propose a commit, and only with a user-facing line — this task is pure plumbing with no visible behavior change (the setting has no UI yet and defaults preserve current behavior), so if a CHANGELOG entry is requested for the overall PRD, it belongs on whichever task ships the visible feature (likely 2a or the final integration commit), not on this task alone. Do not add scaffolding-only bullets (IPC channel names, atom names, store field names) to the CHANGELOG per this repo's explicit rule against internal scaffolding entries.

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
*PRD: project-bar-top-placement | Task: 1a | Wave: 1*
