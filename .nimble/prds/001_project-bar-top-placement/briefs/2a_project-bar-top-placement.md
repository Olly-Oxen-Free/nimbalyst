# Task Brief: 2a

**Title:** Settings UI for project-bar position and display mode
**PRD:** project-bar-top-placement
**Priority:** must
**Complexity:** 3/10
**Model:** sonnet
**Wave:** 2
**Feature Issue:** N/A — this PRD is not tracked via a GitHub Issue (tracker `issue_key` is `null` in `status.json`; NIMBLE tracker item `plan_1787289447069_qb6yvp` is the plan record instead)

---

## Objective

Add two new controls to `AdvancedPanel` that expose the `projectRailPosition` and `projectRailExpandedDisplay` settings built by task 1a: a position control (`'left' | 'top'`) visible only in multi-project mode, and a display-mode control (`'always-visible' | 'hover-reveal'`) visible only when position is `'top'`. Fulfills PRD requirement R2 and part of R3.

---

## Context

**Parent Feature:** Project Bar Top Placement (project-bar-top-placement) — no GitHub Issue exists for this PRD; see Feature Issue note above.

This PRD lets users dock the project bar (the vertical strip of circular project avatars, `ProjectRail.tsx`) at the top of the window instead of the left edge, merged into the title bar. Task 1a (Wave 1, complete before this task starts) built the persisted-settings plumbing — store schema, IPC, and renderer atoms — for two new string-union settings. This task (2a) is the *only* task in the PRD that builds the settings-panel UI for them; no other task touches `AdvancedPanel.tsx`.

This task is part of **Wave 2** — it runs alongside 2b (CSS variant) and 3a (structural `WindowTopBar` merge) on disjoint files (`file_conflicts_checked.wave_2` in `execution_plan.yaml` confirms no overlap). 2a depends only on 1a, not on 2b or 3a; those tasks depend on 2a's *atoms* being read correctly elsewhere, not on anything 2a produces.

---

## Requirements

Add two settings-row controls to `AdvancedPanel.tsx`, in the existing "General" section (`packages/electron/src/renderer/components/GlobalSettings/panels/AdvancedPanel.tsx:405-411`), immediately after the existing `<RestorePreviousProjectsToggle />` call and before the "Send Anonymous Usage Data" toggle:

1. **Position control** — lets the user choose `projectRailPosition: 'left' | 'top'`. Visible only when `multiProjectModeAtom` is `true`; renders nothing (not just visually hidden — unmounted) when multi-project mode is off.
2. **Display-mode control** — lets the user choose `projectRailExpandedDisplay: 'always-visible' | 'hover-reveal'`. Visible only when `projectRailPositionAtom` is `'top'`; renders nothing otherwise, including when multi-project mode is off (position can never be meaningfully `'top'` without multi-project mode, but gate on position directly — don't reimplement the multi-project check here).

Both values are **string unions, not booleans** — this is a deliberate architecture decision from the PRD (Section 11: "Position stored as an extensible string union ... not a boolean"). Do not force `SettingsToggle`'s boolean `checked`/`onChange` shape onto either setting.

Changing either control must update the renderer atom immediately and persist with no restart required — this happens automatically via 1a's `store.sub` subscribers already wired in `initOpenProjects()` (`openProjects.ts`); this task only needs to write the atom via `useAtom`'s setter, exactly like `MultiProjectModeToggle` does (`setEnabled(next)` — no manual IPC call in the component).

---

## Research Context

### Existing control for this exact shape: `DropdownRow`

`AdvancedPanel.tsx` already contains a reusable component for a union-of-2+-values settings row, defined locally in this same file:

```ts
// packages/electron/src/renderer/components/GlobalSettings/panels/AdvancedPanel.tsx:39-73
function DropdownRow({
  value,
  onChange,
  name,
  description,
  options,
}: {
  value: string | number;
  onChange: (value: string) => void;
  name: string;
  description: string;
  options: { value: string | number; label: string }[];
})
```

It renders a settings-row layout (name + description on the left, a styled `<select>` on the right) — visually consistent with `SettingsToggle`'s inline variant but for non-boolean values. It is **already used for exactly this shape** elsewhere in the same file:

- `externalEditorType: ExternalEditorType` (a 8-value string union) at `AdvancedPanel.tsx:516-531`
- `maxHeapSizeMB` (a 6-value number union) at `AdvancedPanel.tsx:552-565`

**Use `DropdownRow` for both new controls.** It is not exported (module-scoped to this file), which is fine since both consumers live in this same file. This resolves the task's own open question ("SettingsToggle.tsx's existing two consumers are both booleans — confirm whether it can be extended ... or whether a small new segmented-control component is warranted") — no new component is needed; `DropdownRow` already exists and already serves this exact purpose. **`SettingsToggle.tsx` likely does not need to be modified at all** — see File Ownership Notes below.

### Correction: `RestorePreviousProjectsToggle`'s actual pattern does not hide/show

The task description says the display-mode control should follow "the dependent-visibility pattern already used by `RestorePreviousProjectsToggle`." Read literally, `RestorePreviousProjectsToggle()` (`AdvancedPanel.tsx:737-753`) does **not** conditionally render or hide itself — it always renders the toggle, and only swaps its `description` text based on `multiProjectModeAtom`:

```tsx
// AdvancedPanel.tsx:737-753 (current)
function RestorePreviousProjectsToggle() {
  const [enabled, setEnabled] = useAtom(restorePreviousProjectsAtom);
  const isMultiProject = useAtomValue(multiProjectModeAtom);

  return (
    <SettingsToggle
      checked={enabled}
      onChange={setEnabled}
      name="Restore last session's projects on launch"
      description={
        isMultiProject
          ? 'When on, the project rail rehydrates with every project that was open at last close. When off, only the project you pick from the launch screen opens.'
          : 'Only takes effect when Multi-project Mode is enabled.'
      }
    />
  );
}
```

This does not satisfy the success criteria below, which require the controls to be genuinely **hidden** (unmounted), not just re-labeled. The actually-applicable precedent in this same file for true conditional mount/unmount based on state is the `{condition && (...)}` guard already used twice:

```tsx
// AdvancedPanel.tsx:395 — gates a whole block on releaseChannel
{releaseChannel === 'alpha' && ( ... )}

// AdvancedPanel.tsx:533 — gates a whole block on externalEditorType
{externalEditorType === 'custom' && ( ... )}
```

An equally valid and arguably cleaner option, consistent with how `ProjectRail()` itself gates on `multiProjectModeAtom` (`ProjectRail.tsx:419`, `return null` when multi-project mode is off — cited in `research/findings.md` Section 1), is to have each new control component read its own gating atom and `return null` internally. Either approach (external `{cond && <Control />}` guard, or internal `if (!cond) return null;`) satisfies "hidden otherwise" — pick one and apply it consistently to both new controls. This brief's example code below uses the internal `return null` form since it mirrors `ProjectRail()`'s own established gating pattern most directly, but the external-guard form is equally acceptable.

### Atom names and import path (from task 1a)

Per task 1a's brief, the atoms this task must read/write are declared in `packages/electron/src/renderer/store/atoms/openProjects.ts`:

- `projectRailPositionAtom` — `atom<'left' | 'top'>('left')`
- `projectRailExpandedDisplayAtom` — `atom<'always-visible' | 'hover-reveal'>('always-visible')`

Both persist automatically via `store.sub` subscribers 1a adds in `openProjects.ts` (mirroring `multiProjectModeAtom`'s un-debounced persistence at `openProjects.ts:334-339`) — this task does not need to call `window.electronAPI.invoke(...)` directly; writing the atom via the `useAtom` setter is sufficient, exactly like `MultiProjectModeToggle()` does today.

**1a had not yet landed as of this brief being written** (verified: `projectRailPositionAtom`/`projectRailExpandedDisplayAtom` do not exist yet in current `openProjects.ts`). Before starting this task, re-read `openProjects.ts` to confirm both atoms exist and check whether 1a exported type aliases (`ProjectRailPosition`/`ProjectRailExpandedDisplay`) from `openProjects.ts` itself or only from `packages/electron/src/main/utils/store.ts`. `AdvancedPanel.tsx` already establishes the convention of importing renderer-facing union types alongside their atoms rather than from main-process files — e.g. `type ReleaseChannel` from `'../../../store/atoms/appSettings'` (`AdvancedPanel.tsx:21`) and `type ExternalEditorType` from the same import block (`:22`). If 1a followed this same convention in `openProjects.ts`, import `ProjectRailPosition`/`ProjectRailExpandedDisplay` from `'../../../store/atoms/openProjects'` alongside the atoms. If 1a instead left the types only in `store.ts` (main process), either import them from there (matching what 1a actually did) or inline the literal unions (`'left' | 'top'`, `'always-visible' | 'hover-reveal'`) at the two `as` cast sites in this task's new code — do not block on this; use whatever 1a actually shipped.

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] Position control renders only when `multiProjectModeAtom` is `true`; hidden (unmounted) otherwise
- [ ] Display-mode control renders only when `projectRailPositionAtom` is `'top'`; hidden (unmounted) otherwise
- [ ] Changing either control updates the corresponding renderer atom and persists immediately (via 1a's `store.sub` subscriber), no restart required
- [ ] New control(s) follow `GlobalSettings/SettingsToggle.tsx`'s prop conventions where reusable (n/a here — see Research Context on why `SettingsToggle`'s boolean shape doesn't fit), or a sibling component with matching visual style — satisfied by reusing the existing `DropdownRow` component already in `AdvancedPanel.tsx`, which has the same settings-row visual language as `SettingsToggle`'s inline variant
- [ ] `npm run typecheck` passes

**All criteria must pass before task is complete.**

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/electron/src/renderer/components/GlobalSettings/panels/AdvancedPanel.tsx` | modify | Import the two new atoms; add two new gated control components (`DropdownRow`-based); render them in the "General" section after `<RestorePreviousProjectsToggle />` |
| `packages/electron/src/renderer/components/GlobalSettings/SettingsToggle.tsx` | modify (conditional — may end up unchanged) | Only touch this file if, after reviewing `DropdownRow`, you determine a `SettingsToggle`-family component genuinely needs extending. Given `DropdownRow` already exists and already serves this exact shape (see Research Context), the expected outcome is that this file needs **no changes** for this task. |

### File Ownership Notes

No other task in this PRD touches `AdvancedPanel.tsx` or `SettingsToggle.tsx` — both are exclusive to 2a in the execution plan (`file_conflicts_checked.wave_2` in `execution_plan.yaml`). No coordination needed with 2b or 3a, which touch a disjoint file set (`ProjectRailIcon.tsx`, `ProjectRail.css`, `App.tsx`, `WindowTopBar.tsx`).

---

## Deliverables

None beyond the files above.

---

## Implementation Guidance

### Patterns to Follow

- Use `DropdownRow` (`AdvancedPanel.tsx:39-73`) for both new controls — do not build a new component. Clone the call shape already used for `externalEditorType` (`AdvancedPanel.tsx:516-531`):

```tsx
<DropdownRow
  value={externalEditorType}
  onChange={(val) => updateExternalEditorSettings({ editorType: val as ExternalEditorType })}
  name="External Editor"
  description="Editor for the 'Open in...' context menu option."
  options={[
    { value: 'none', label: 'None' },
    { value: 'vscode', label: 'VS Code' },
    // ...
  ]}
/>
```

- Suggested shape for the two new components (add near `MultiProjectModeToggle`/`RestorePreviousProjectsToggle`, e.g. after `RestorePreviousProjectsToggle()` at `AdvancedPanel.tsx:753`):

```tsx
function ProjectRailPositionControl() {
  const isMultiProject = useAtomValue(multiProjectModeAtom);
  const [position, setPosition] = useAtom(projectRailPositionAtom);

  if (!isMultiProject) return null;

  return (
    <DropdownRow
      value={position}
      onChange={(val) => setPosition(val as ProjectRailPosition)}
      name="Project Bar Position"
      description="Dock the project bar on the left edge, or merge it into the title bar at the top."
      options={[
        { value: 'left', label: 'Left' },
        { value: 'top', label: 'Top' },
      ]}
    />
  );
}

function ProjectRailExpandedDisplayControl() {
  const position = useAtomValue(projectRailPositionAtom);
  const [displayMode, setDisplayMode] = useAtom(projectRailExpandedDisplayAtom);

  if (position !== 'top') return null;

  return (
    <DropdownRow
      value={displayMode}
      onChange={(val) => setDisplayMode(val as ProjectRailExpandedDisplay)}
      name="Non-Selected Project Display"
      description="How other open projects are shown when the project bar is docked at the top."
      options={[
        { value: 'always-visible', label: 'Always Visible' },
        { value: 'hover-reveal', label: 'Hover to Reveal' },
      ]}
    />
  );
}
```

  Names/descriptions above are suggestions, not fixed strings — adjust wording to match the panel's existing tone if a shorter/clearer phrasing reads better, but keep both controls' `name`/`description` distinct and self-explanatory without requiring the PRD for context.

- Render both new components in the JSX, in the "General" section, immediately after the existing `<RestorePreviousProjectsToggle />` call and before the "Send Anonymous Usage Data" toggle:

```tsx
// AdvancedPanel.tsx:405-413 (current, for reference)
<div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0">
  <h4 className="provider-panel-section-title text-base font-semibold mb-2 text-[var(--nim-text)]">General</h4>

  <MultiProjectModeToggle />

  <RestorePreviousProjectsToggle />

  {/* insert <ProjectRailPositionControl /> and <ProjectRailExpandedDisplayControl /> here */}

  <SettingsToggle
    checked={analyticsEnabled}
    ...
```

- Import the two new atoms in the existing `openProjects` import block (`AdvancedPanel.tsx:31-36`):

```ts
import {
  multiProjectModeAtom,
  openProjectsAtom,
  activeWorkspacePathAtom,
  restorePreviousProjectsAtom,
  projectRailPositionAtom,
  projectRailExpandedDisplayAtom,
} from '../../../store/atoms/openProjects';
```

  Add the `ProjectRailPosition`/`ProjectRailExpandedDisplay` type import to whichever import block 1a actually exports them from (see Research Context above — verify against 1a's landed code, don't assume).

### Code Style

- `camelCase` for all identifiers, matching the rest of the file.
- Follow the existing two-space JSX indentation and the file's existing Tailwind utility-class conventions (`text-sm font-medium text-[var(--nim-text)]` etc. are already baked into `DropdownRow`'s own markup — no new className work needed at the call sites).
- Do not add a `data-testid`/kebab-case root class to the new control components beyond what `DropdownRow` already provides, unless a later task (5a, testing) specifically needs a hook — `DropdownRow` currently has no `data-testid` prop; if 5a's component tests need one, that is 5a's concern to add, not this task's (this task's own success criteria do not require a test hook).

### Edge Cases

- **Position control must not silently reappear when multi-project mode is toggled off while position is `'top'`.** The gating condition (`if (!isMultiProject) return null;`) already handles this — when the component unmounts, the underlying atom value is untouched (still `'top'`), only the *control* disappears. This matches the PRD's explicit non-regression note (Section 5, "Multi project mode toggled off while position = top: rail ... disappears entirely ... no dangling top-bar remnants") — that broader rendering behavior is task 3a's responsibility, not this task's; this task only needs to make sure its own *settings-panel controls* hide correctly, which they will given the gating above.
- **Do not add validation logic** rejecting a position/display-mode value — the `<select>`'s `options` list already constrains the user to valid values, and TypeScript's union type is the only validation layer needed here (same principle 1a's brief established for the store/IPC/atom layers).
- **Display-mode control's gate is on position alone (`'top'`), not on `isMultiProject && position === 'top'`.** Since `projectRailPositionAtom` can only be user-set to `'top'` via the position control that itself requires multi-project mode to be visible, gating on position alone is sufficient and avoids a redundant double-read of `multiProjectModeAtom`. (If the position atom is ever externally forced to `'top'` while multi-project mode is off — e.g. stale persisted state — the display-mode control would still show; this is an acceptable edge case since the PRD's real project-bar rendering gate, not this task's settings-panel gate, is what determines whether the feature is actually visible to the user.)

### Testing Requirements

This PRD defers all tests to a dedicated end-of-work task (5a), per explicit user direction recorded in the PRD (Section "Orchestration") — this **overrides** this repo's default "tests ship with the behavioral change" convention for *task sequencing only* in this PRD. **Do not write tests in this task.** Task 5a's second success criterion explicitly covers this task: "Unit or component test confirms the position control in AdvancedPanel is hidden when multi-project mode is off, and the display-mode control is hidden when position != 'top'." Task 5a's brief will target `packages/electron/src/renderer/components/GlobalSettings/panels/AdvancedPanel.test.tsx` (a new file, does not exist yet) for this coverage.

Despite deferring test-writing, run `npm run typecheck` before finishing this task to catch type errors in the new component signatures and `as ProjectRailPosition`/`as ProjectRailExpandedDisplay` casts early.

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

Per `.nimble/config.yaml` `boundaries.require_review`, neither file this task modifies falls under this list (`packages/electron/src/main/**`, `packages/electron/src/database/**`, `packages/collabv3/*`, `scripts/run-workspace-script.mjs`, `scripts/install-git-hooks.mjs`). Both `AdvancedPanel.tsx` and `SettingsToggle.tsx` are renderer files — no elevated review requirement beyond this PRD's single end-of-work integration review.

---

## Dependencies

### Upstream Tasks

| Task | What It Provides | Verify Before Starting |
|------|------------------|------------------------|
| 1a | `projectRailPositionAtom`, `projectRailExpandedDisplayAtom` in `packages/electron/src/renderer/store/atoms/openProjects.ts`, plus their persisted store/IPC layers | Read `openProjects.ts` and confirm both atoms exist with the exact names above; confirm whether the union types are exported from `openProjects.ts` or only from `packages/electron/src/main/utils/store.ts` (affects your import path — see Research Context) |

### Downstream Impact

Tasks that depend on this one: **None** — no task in this PRD depends on 2a. (3a depends on 1a and 1b, not on 2a; it reads `projectRailPositionAtom` directly, independent of whether this task's UI exists.)

**Before starting:** Verify 1a is complete by reading `packages/electron/src/renderer/store/atoms/openProjects.ts` and confirming `projectRailPositionAtom` and `projectRailExpandedDisplayAtom` are declared and wired into `initOpenProjects()`'s load/persist logic. If they are missing, 1a has not landed yet — do not stub or invent them; wait for 1a.

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
feat(electron): add settings UI for project-bar position and display mode
```

Do NOT add a `Co-Authored-By: Claude` trailer — this repo's `CLAUDE.md` explicitly says "Don't add `Co-Authored-By` lines to commit messages."

Types: feat, fix, refactor, test, docs, chore

**CHANGELOG.md:** Per this repo's `CLAUDE.md`, only update `CHANGELOG.md` when explicitly asked to propose a commit, and only with a user-facing line. This task adds a settings control but the feature it configures (top-docked project bar) is not usable end-to-end until later tasks (3a, 4a, 4b) land — a user-facing CHANGELOG entry for the whole feature more naturally belongs on whichever task or integration commit completes the visible feature, not on this task alone. If a CHANGELOG bullet is requested at this point anyway, phrase it around the user-visible capability ("project bar can now be docked at the top of the window"), not internal names (`DropdownRow`, `projectRailPositionAtom`, IPC channel names) — this repo's CLAUDE.md explicitly forbids scaffolding-only bullets.

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
*PRD: project-bar-top-placement | Task: 2a | Wave: 2*
