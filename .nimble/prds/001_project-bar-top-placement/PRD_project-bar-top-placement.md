# PRD Template (v2)

```yaml
---
feature_name: "Project Bar Top Placement"
feature_slug: "project-bar-top-placement"
owner: "jeppcohen@gmail.com"
status: "draft"
created_date: "2026-08-20"
target_date: ""
phase: ""
scope_type: "new-feature"
github_project: ""
links: []
checkpoint_refs: []
cross_feature_blockers: []
---
```

---

## 1. Executive Summary

**One-liner:** A settings toggle relocates the left-side project bar (circular project-initial avatars) to the top of the window, merged into the title bar, with the selected project's circle expanding into its full name.

**What's changing:** Today, `ProjectRail` is a fixed 56px vertical strip on the left showing circular avatars for each open project; the window title bar (`WindowTopBar`) separately shows a static workspace name. After this ships, a new setting lets the user dock the project bar at the top instead — the rail's content renders inside `WindowTopBar` itself, the selected project's circle expands into full name text (replacing the current title), and the other open projects remain reachable via a hover-reveal interaction.

**Who it's for:** Multi-project users who want project identity anchored in the title area rather than the left edge, or who want the extra ~56px of horizontal space back.

**Done looks like:** Flip the setting in Settings → Advanced. The left rail disappears; the title bar now shows the active project's full name where the static workspace name used to sit, with the circle-to-text transition animated. Hovering over the bar reveals the other open projects as circles; clicking one switches the active project, closing and adding projects both work, and the setting persists across restart.

**Primary risk:** Merging into `WindowTopBar`'s DOM couples project-switching UI to native window drag-region handling — every interactive element (circles, close buttons, add button, hover-reveal state) needs explicit `NO_DRAG_REGION`, and empty space must stay draggable. Getting this wrong breaks either window dragging or click targets.

---

## 2. Problem & Context

**Problem statement:** The project bar is fixed to the left edge with no way to reposition it. Some users would prefer project identity to live in the title bar (where a single-project window already shows its name) instead of a separate left-edge strip, and/or want the horizontal space back.

**Supporting data / evidence:** User-requested (this PRD originated from a direct feature request, not research/telemetry). Internal research (`research/findings.md`) confirms no existing bar-position precedent in the codebase — this is a net-new layout pattern, not a variant of something already built.

**What happens if we don't build this:** No functional loss — this is a preference/layout feature, not a bug fix. Users who want this today have no workaround short of not using multi-project mode.

**Strategic fit:** Extends the existing settings-driven layout customization surface (multi-project mode, restore-previous-projects) with a new axis: chrome placement.

---

## 3. Goals, Non-Goals & Success Metrics

### Goals

1. Let the user move the project bar from left to top via a persisted setting.
2. When docked at top, the selected project's avatar expands into full name text in place of the current static title.
3. Preserve full interaction parity (switch, close, add project) in the top-docked position.

### Non-Goals

- Right or bottom bar positions — the position type is structured as an extensible string union so these could be added later, but no UI or layout logic is built for them in this PRD.
- "Collapse other projects into an overflow menu" display mode — explicitly rejected during interview in favor of hover-reveal.

### Success Metrics

| Metric | Baseline | Target | How Measured |
| ------ | -------- | ------ | ------------ |
| Setting persists across restart | N/A (new setting) | 100% | Manual restart test / IPC round-trip test |
| Top-docked interactions work (switch/close/add) | N/A | Feature parity with left rail | Manual QA + unit tests on shared atom writes |

---

## 4. Requirements

### Must Have (blocks launch)

| ID | Requirement | Acceptance Criteria |
| -- | ----------- | ------------------- |
| R1 | Extensible position setting, 4-layer persisted (store schema → IPC → atom → UI) | `projectRailPosition: 'left' \| 'top'` (string union, not boolean) in `store.ts`; `app:get/set-project-rail-position` IPC; renderer atom loaded with `??` default-merge (per `STATE_PERSISTENCE.md`); survives restart; missing field on old saved state loads as `'left'` |
| R2 | Settings UI control for position | New control in `AdvancedPanel`, visible only when multi-project mode is on (dependent-visibility, following the `RestorePreviousProjectsToggle` pattern); not a boolean toggle since the value is a union — needs a segmented/select-style control; changes apply live, no restart |
| R3 | Secondary "non-selected project display mode" setting, same 4-layer pattern | `projectRailExpandedDisplay: 'always-visible' \| 'hover-reveal'`, default `'always-visible'`; its control in `AdvancedPanel` is visible only when position = `'top'` |
| R4 | Structural DOM merge: top position renders inside `WindowTopBar` | `App.tsx` renders the rail in its current left column when position = `'left'` (unchanged, zero regression); when `'top'`, `WindowTopBar` renders the rail's content in place of `window-top-bar__identity`'s workspace-name text, via a shared subcomponent — not duplicated logic |
| R5 | Selected project expands to full name at top | Text sourced from `activeOpenProjectAtom.name`; replaces today's `data-testid="window-top-bar-workspace-name"` content when position = `'top'` |
| R6 | Full interaction parity at top | Clicking a non-selected circle switches the active project (same `activeWorkspacePathAtom` write path as the left rail); close-project control works; add-project (+) works; every interactive element gets explicit `NO_DRAG_REGION`; empty bar space stays draggable |
| R7 | Horizontal-layout CSS | New stylesheet/variant — none of `width:56px` / `flex-direction:column` / the absolutely-positioned `left:-10px` active indicator carry over; tooltips and context menus reposition below instead of beside (still `@floating-ui/react` + `FloatingPortal` + `windowControlsClearance()`); `@container`-based responsive behavior for many open projects on a narrow window; canonical `--nim-*` vars only |
| R8 | Hover-reveal for non-selected projects | Hovering anywhere over the top project-bar area reveals the other open-project circles; they hide on mouse-leave; hover tracking coexists with the bar's drag-region (known limitation: no keyboard/touch equivalent reveal path in this pass — accepted per interview) |
| R9 | Animated circle↔text transition | The selected project's avatar visually morphs between its circle form (left-docked) and expanded full-name form (top-docked) — both on position-setting change and on load in the top-docked state |

### Non-Goals restated for clarity

Originally scoped as MVP (static display only); scope was explicitly escalated to full implementation during planning — R8 and R9 (hover-reveal behavior and the transition animation) are in-scope requirements here, not deferred polish.

---

## 5. UX & Interaction Notes

**Visual Assets:** None provided during interview.

**User Experience:**
- Left-docked (default/unchanged): identical to today's `ProjectRail` behavior — vertical strip, always-visible circles, tooltip on hover, click to switch.
- Top-docked: `WindowTopBar`'s title area shows the active project's full name (animated in from a circle). Hovering the bar area reveals the other open-project circles beside/around the name; clicking one switches active project (name text updates and re-animates); a close (×) affordance and an add-project (+) affordance are both reachable in the revealed state.
- Switching the position setting live-updates the layout without restart.

**Visual Design:** Follows `WindowTopBar`'s existing 38px height (`MAIN_WINDOW_TITLE_BAR_HEIGHT`) and drag-region conventions; project circles reuse existing avatar styling from `ProjectRailIcon`, resized/repositioned for a horizontal context.

**Key screens & states:**
- Single project open, position = top: expanded name shows, no other circles to reveal (hover is a no-op).
- Many projects open, narrow window, position = top: `@container` query reduces circle size or truncates name before overflow.
- Multi-project mode toggled off while position = top: rail (in both forms) disappears entirely, matching existing `multiProjectModeAtom` gating — no dangling top-bar remnants.

**Accessibility:** Hover-reveal (R8) has a known gap — no documented keyboard/touch reveal path in this pass; flagged as an accepted limitation per the interview, not silently dropped.

**Responsive:** `@container` queries per `UI_PATTERNS.md`, not `@media`.

---

## 6. Dependencies & Risks

### Cross-Feature Blockers

_None._

### External Blockers

_None._

### Internal Dependencies

- `activeOpenProjectAtom`, `activeWorkspacePathAtom`, `multiProjectModeAtom` (`packages/electron/src/renderer/store/atoms/openProjects.ts`) — read-only dependencies, not modified by this PRD.
- `windowControlsClearance()` middleware and `NO_DRAG_REGION`/`DRAG_REGION` conventions (`packages/electron/src/renderer/components/WindowTopBar/dragRegion.ts`).

### Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| Drag-region/`NO_DRAG_REGION` mistakes break window dragging or click targets when merged into `WindowTopBar` | Med | High | Task 3a isolates the structural merge as its own reviewed task; reuse `windowControlsClearance()` pattern already proven by `ProjectRail`'s existing floating menus |
| `window-top-bar__identity` has `pointer-events-none` (`WindowTopBar.tsx:529`) — every project circle is click-dead by default | High | High | Called out explicitly as a 3a success criterion, caught during reviewer validation before execution started |
| Hover-tracking over a native drag region behaves inconsistently across platforms | Med | Med | Accepted as a known limitation (R8); scoped to hover only, no platform-specific workarounds attempted in this pass |
| `store.ts` / `SettingsHandlers.ts` are `require_review` boundary files (main process) | Low | Med | Flagged now; single end-of-work review (per orchestration decision below) covers this, not a surprise at merge time |

---

## 7. Rollout Plan

**Phase/level:** Single PRD, no phased rollout.

**Deployment strategy:** Direct merge, default `projectRailPosition: 'left'` preserves current behavior for all existing users — opt-in only.

**Rollback plan:** Revert the merge; no data migration involved (new optional settings field, defaults preserve old behavior).

**Monitoring:** None specified — no analytics/telemetry requirement raised during interview.

---

## 8. Milestones & Release Criteria

| Milestone | What's True When Done | Target Date |
| --------- | --------------------- | ----------- |
| All 8 tasks complete, single end-of-work review passed | Feature works end-to-end per R1-R9, `npm run typecheck && npm run test:prepush` green | — |

**Release criteria:**

- Left-docked behavior is a zero-regression no-op when position stays `'left'`.
- Setting persists across restart (old saved state without the field defaults to `'left'`).
- All must-have requirements (R1-R9) pass manual verification per repo's end-to-end-verification rule.

---

## 9. Open Questions

| # | Question | Status | Resolution |
| - | -------- | ------ | ---------- |
| Q1 | Keyboard/touch-accessible equivalent for hover-reveal (R8) | Open | Deferred — accepted as known limitation for this PRD, noted in UX section |

---

## 10. Checkpoint Learnings

First PRD for this project — no prior checkpoints exist.

---

## 11. Agent Boundaries (Phase-Specific)

**Files the agent should reference for patterns:**

- `packages/electron/src/main/utils/store.ts` (multi-project-mode getter/setter pattern, ~line 293, 2743-2749)
- `packages/electron/src/main/ipc/SettingsHandlers.ts` (~626-632)
- `packages/electron/src/renderer/store/atoms/openProjects.ts` (atom + persistence subscriber pattern)
- `packages/electron/src/renderer/components/GlobalSettings/panels/AdvancedPanel.tsx` (`MultiProjectModeToggle`, `RestorePreviousProjectsToggle` — dependent-visibility pattern, ~683-753)
- `packages/electron/src/renderer/components/WindowTopBar/dragRegion.ts`
- `packages/electron/src/renderer/components/ProjectRail.tsx` (icon rendering, tooltip, close, context-menu logic to extract/share)

**Files the agent should NOT touch (beyond the global `never_touch` list):**

- `packages/electron/src/database/migrations/*` — unrelated to this feature.

**Architecture decisions already made (don't re-decide):**

- Position stored as an extensible string union (`'left' | 'top'`), not a boolean — future positions are a config/type extension, not a schema migration.
- Non-selected-project display mode is itself a separate persisted setting (R3), not a hardcoded behavior.
- Top-docked rail merges into `WindowTopBar`'s DOM (not a new sibling row) — accept the drag-region coupling as the chosen tradeoff.
- Hover-reveal (not a disclosure button) is the chosen R8 trigger, despite its accessibility gap — accepted explicitly by the user during planning.

**Known gotchas discovered since the implementation plan:**

- `ProjectRail.css` has zero horizontal/row styles — nothing here is reusable via a CSS flip; a parallel stylesheet is required (R7).
- `workspaceName` reaches `WindowTopBar` as a prop from `App.tsx` today, not read from an atom internally — the merge (task 3a) changes this to an atom read when position = `'top'`.

---

## Agent Tasks

> Tasks are stored in `./tasks.yaml`. The execution plan is in `./execution_plan.yaml` (generated by the reviewer agent).

**Task Summary:**

| ID | Title | Complexity | Priority | Dependencies |
|----|-------|------------|----------|--------------|
| 1a | Persisted project-bar layout settings (position + display mode) | 4 | must | - |
| 1b | Extract shared project-bar container logic from ProjectRail | 5 | must | - |
| 2a | Settings UI for project-bar position and display mode | 3 | must | 1a |
| 2b | Horizontal-layout CSS variant for top-docked project bar | 3 | must | 1b |
| 3a | Merge project bar into WindowTopBar when position is top | 5 | must | 1a, 1b |
| 4a | Animated circle-to-text transition for selected project | 3 | must | 3a, 2b |
| 4b | Hover-reveal for non-selected project circles | 3 | must | 3a, 2b, 4a |
| 5a | Tests for project-bar top-placement feature | 5 | must | 1a, 1b, 2a, 2b, 3a, 4a, 4b |

Total complexity: 31 across 8 tasks, 5 waves (see `execution_plan.yaml`). 4b depends on 4a to avoid a file conflict (both touch `WindowTopBar.tsx`/`ProjectRail.css`) on the shared branch. 1b was widened during reviewer validation to include the add-project/close/capacity logic `ProjectRail()` owns today, not just icon rendering, so 3a doesn't have to re-implement it. `pointer-events-none` on `window-top-bar__identity` (`WindowTopBar.tsx:529`) is called out explicitly in 3a — every circle is click-dead until that's handled, not just `NO_DRAG_REGION`. R9's animation (4a) is scoped to expand-in-place inside the top bar; the codebase has no shared-layout-animation library, so the left↔top position-change transition is a crossfade/slide, not a literal cross-tree circle morph.

**Orchestration:** Single feature branch, all 8 tasks land together; one integration review at the end (not per-task PR review), per explicit user direction. Tests are a dedicated end-of-work task (5a), not embedded per task, per explicit user direction — this overrides the repo's default "tests ship with the behavioral change" convention for *task sequencing* only; task 5a must still land before the single end-of-work review, and the review gate still requires `npm run typecheck && npm run test:prepush` green before merge.

---

*Generated by NIMBLE — interview conducted directly in-session after the `nimble:nimble-interviewer` subagent became unusable mid-session (repeated tool denials/stops); Round 1-2 answers and the final two clarifications (hover-reveal trigger, full-implementation scope) were gathered directly from the user.*
