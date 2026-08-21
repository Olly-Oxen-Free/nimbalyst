# Research Findings: project-bar-top-placement

## 1. Project bar component
`packages/electron/src/renderer/components/ProjectRail.tsx` — `ProjectRail` (1-549), vertical rail of circular project-initial avatars.
- `projectInitials()` (48-56) computes 2-letter circle content from `project.name` — expands to full name when top-docked.
- `ProjectRailIcon` (68-179) — one circle button: active state, hover tooltip, close, context menu.
- `ProjectRail()` (181-549) — `<nav className="project-rail">`, renders `OrgSwitcher`, mapped `openProjects`, add-project `+`.
- Gated by `multiProjectModeAtom` — returns `null` when multi-project mode off (419).
- `ProjectRail.css` — `.project-rail { width: 56px; height: 100%; display: flex; flex-direction: column }` (1-14). Hard-coded vertical; no row variant exists.
- Mounted `App.tsx:2638` as sibling of `NavigationGutter` inside `workspace-row`.

## 2. Top bar / title bar component
`packages/electron/src/renderer/components/WindowTopBar/WindowTopBar.tsx` — `WindowTopBar` (462-585).
- Electron custom title bar, fixed height `MAIN_WINDOW_TITLE_BAR_HEIGHT = 38` (`packages/electron/src/shared/windowChrome.ts:1`).
- `window-top-bar__identity` (529-544): centered `workspace-name` span (`data-testid="window-top-bar-workspace-name"`, 530-536) + em-dash + `mode-label`. `workspaceName` is a prop from `App.tsx` (render call `App.tsx:2612`) — not read from an atom directly inside `WindowTopBar`.
- Left slot (524-527): `ExitFullScreenButton`, `WindowMenuBar` (Win/Linux only).
- Whole header is a drag region (`DRAG_REGION`, 510); `env(titlebar-area-x/width)` inset (520) clears native traffic lights. Interactive elements need explicit `NO_DRAG_REGION` (`dragRegion.ts:13-14`) — ProjectRail's floating menus already use `windowControlsClearance()` middleware (`ProjectRail.tsx:27,86,326,353,378`) for this.

## 3. Selected-project state (Jotai)
`packages/electron/src/renderer/store/atoms/openProjects.ts`:
- `activeWorkspacePathAtom` (57) — active project path, read by `ProjectRail.tsx:184`.
- `openProjectsAtom` (82) — ordered `OpenProject { path, name, openedAt }` list (24-31).
- `activeOpenProjectAtom` (87-91) — derived atom resolving the full active `OpenProject` record incl. `.name`. **Use this for the expanded project-name text.**
- `multiProjectModeAtom` (67) — gates rail rendering entirely.
- Selection writes: `activeWorkspacePathAtom` → `notifyMainSetActive()` (395-401) → IPC `workspace:set-active`, plus debounced persist (`schedulePersistActivePath`, 415-421) → `app:set-active-project-path`.

## 4. Settings toggle pattern to clone
Template: existing Multi-project Mode toggle (four-layer pattern):
- Store schema: `multiProjectMode?: boolean` (`packages/electron/src/main/utils/store.ts:293`), getter/setter `getMultiProjectMode()`/`setMultiProjectMode()` (2743-2749).
- IPC: `app:get-multi-project-mode` / `app:set-multi-project-mode` (`SettingsHandlers.ts:626-632`).
- Renderer atom + persistence: `multiProjectModeAtom`, loaded in `initOpenProjects()` (267-283), persisted via `store.sub(...)` (334-339).
- Settings UI: `MultiProjectModeToggle()` (`AdvancedPanel.tsx:688-729`) using shared `SettingsToggle` component. `RestorePreviousProjectsToggle()` (737-753) shows a dependent-toggle pattern (description changes based on `isMultiProject`) — relevant since a bar-position toggle likely only matters when multi-project mode is on.

## 5. Layout/CSS changes required
`App.tsx:2609-2639` root structure:
```
<div data-layout="root-container" className="h-screen flex flex-col">
  {workspaceMode && <WindowTopBar ... />}          // full-width row, fixed 38px
  <div data-layout="workspace-row" className="flex flex-row flex-1 min-h-0">
    <ProjectRail />                                  // 56px column, full height
    <NavigationGutter ... />
    ...
  </div>
</div>
```
- `ProjectRail` is currently nested *inside* `workspace-row`, below `WindowTopBar` — not a sibling row of it. A pure CSS flex-direction flip cannot achieve "top of window, full width"; this needs a structural change to `App.tsx`'s JSX tree (new row between `WindowTopBar` and `workspace-row`, or merge into `WindowTopBar` itself per the ask to fold into the existing title text).
- `ProjectRail.css` has no horizontal/row styles — fixed 40x40 circles, absolute-positioned active-indicator bar assuming vertical layout (`left: -10px`, 73-81). Needs a parallel top-docked stylesheet, not a toggle.
- If merged into `WindowTopBar`'s row: inherits `env(titlebar-area-x/width)` inset and drag-region rules — every interactive project circle needs explicit `NO_DRAG_REGION`.

## 6. Existing position-toggle precedent
None found. Searched `sidebarPosition`, `panelPosition`, `dockPosition`, `railPosition`, `barPosition` — no hits. `WindowTopBarPanelControls { left?, right? }` (`WindowTopBar.tsx:41-44`) toggles which *content panel* docks to which side of the editor — not a chrome-bar-position precedent. This is a new layout pattern; only the settings-persistence plumbing (Section 4) is reusable.

## Key files
- `packages/electron/src/renderer/components/ProjectRail.tsx`
- `packages/electron/src/renderer/components/ProjectRail.css`
- `packages/electron/src/renderer/components/WindowTopBar/WindowTopBar.tsx`
- `packages/electron/src/renderer/components/WindowTopBar/dragRegion.ts`
- `packages/electron/src/shared/windowChrome.ts`
- `packages/electron/src/renderer/store/atoms/openProjects.ts`
- `packages/electron/src/renderer/App.tsx` (~2609-2639)
- `packages/electron/src/main/utils/store.ts` (293, 2739-2749)
- `packages/electron/src/main/ipc/SettingsHandlers.ts` (625-656)
- `packages/electron/src/renderer/components/GlobalSettings/panels/AdvancedPanel.tsx` (683-753)
- `packages/electron/src/renderer/components/GlobalSettings/SettingsToggle.tsx`
