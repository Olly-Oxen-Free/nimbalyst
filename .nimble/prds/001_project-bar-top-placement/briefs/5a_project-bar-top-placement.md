# Task Brief: 5a

**Title:** Tests for project-bar top-placement feature
**PRD:** project-bar-top-placement
**Priority:** must
**Complexity:** 5/10
**Model:** opus
**Wave:** 5 (final wave — depends on every other task in this PRD)
**Feature Issue:** N/A — this PRD is not tracked via a GitHub Issue (tracker `issue_key` is `null` in `status.json`; NIMBLE tracker item `plan_1787289447069_qb6yvp` is the plan record instead)

---

## Objective

Add the single, dedicated end-of-work test coverage for the whole project-bar-top-placement feature: settings persistence and default-merge (1a), the settings-UI dependent-visibility controls (2a), and the top-docked `WindowTopBar` merge/render behavior (3a/4a/4b). This is the last task in the PRD — it must land before the single end-of-work integration review, and `npm run typecheck && npm run test:prepush` must be green afterward.

---

## Context

**Parent Feature:** Project Bar Top Placement (project-bar-top-placement) — no GitHub Issue exists for this PRD; see Feature Issue note above.

Today `ProjectRail` is a fixed 56px vertical strip on the left showing circular project avatars; `WindowTopBar` separately shows a static workspace name. This PRD adds a persisted setting (`projectRailPosition: 'left' | 'top'`) that docks the rail into the title bar instead, expanding the active project's circle into its full name, with a second setting (`projectRailExpandedDisplay: 'always-visible' | 'hover-reveal'`) controlling whether the other open projects stay visible or reveal on hover.

Per explicit user direction recorded in the PRD ("Orchestration" section and this task's own description), **tests were deliberately deferred out of every implementation task and consolidated here** — this overrides the repo's default "tests ship with the behavioral change" convention for *task sequencing* only in this PRD. Every one of 1a/1b/2a/2b/3a/4a/4b's briefs (where they exist) explicitly instructs "do not write tests in this task" and defers to 5a. That means the behavior this task tests was implemented without a task-local test to lock it down — your tests are the first and only check on whether the shipped code matches the seven upstream tasks' success criteria.

This task is part of **Wave 5** — the last wave, with no parallel siblings. Nothing depends on it; it gates the single end-of-work integration review (`review_gate.mode: single-integration-review` in `execution_plan.yaml`), not a per-task PR review.

---

## Critical: Verify Actual Shipped Code Before Writing Anything

**This is the most important instruction in this brief.** You depend on all seven other tasks (1a, 1b, 2a, 2b, 3a, 4a, 4b). At the time this brief was generated, only **task 1a's brief** existed on disk (`briefs/1a_project-bar-top-placement.md`) — 1b, 2a, 2b, 3a, 4a, 4b had no brief files yet, meaning their implementations may have been written directly from the PRD/tasks.yaml by whichever agent executed them, and could diverge from what tasks.yaml describes. **Do not trust any task description, brief, or this document for exact atom names, component names, prop shapes, file structure, or CSS class names.** By the time you run, all seven upstream tasks are complete (5a's `depends_on` guarantees this) — read the real, current source files listed below and derive your tests from what is actually there, not from what was planned.

Specifically verify, by reading source, before writing each test file:

- **`packages/electron/src/renderer/store/atoms/openProjects.ts`**: Do `projectRailPositionAtom` / `projectRailExpandedDisplayAtom` exist under those exact names? What does `initOpenProjects()` actually do with them — same `??` default-merge shape as 1a's brief describes, or did it land differently? (1a's brief is unusually detailed with exact code to clone — a good tentative reference — but it is still a brief, not the committed diff. Confirm the getter/IPC-channel names it specifies — `app:get-project-rail-position`, `app:get-project-rail-expanded-display` — were actually used, since 2a's and 3a's real implementations may have renamed something 1a shipped differently than briefed.)
- **`packages/electron/src/renderer/components/GlobalSettings/panels/AdvancedPanel.tsx`**: What is the actual name and export of the position control and display-mode control (2a's brief doesn't exist — you have only the task-level description: "segmented/select-style control... visible only when multi-project mode is on" and a display-mode control "visible only when position = 'top'"). Read the file directly for the real component name, the atom(s) it reads for visibility gating, and whether it's a new standalone component or an extension of `SettingsToggle`.
- **`packages/electron/src/renderer/components/WindowTopBar/WindowTopBar.tsx`**: This is the highest-risk file in the whole PRD (3a's brief-equivalent description flags it as such). As of brief-generation time it still took `workspaceName: string` as a **required prop** and had no read of `activeOpenProjectAtom` — the merge described in R4/R5 had not landed. Confirm whether `WindowTopBar`'s prop signature changed (workspaceName may have become optional, or the component may now read `activeOpenProjectAtom`/`projectRailPositionAtom` internally instead of/alongside the prop), whether `window-top-bar__identity`'s `pointer-events-none` was actually removed/overridden for the top-docked circles (PRD Risk table + 3a's success criteria call this out as the single most likely place to get it wrong), and what the actual `data-testid`s and class names on the new top-docked elements are. **Do not assume the existing `window-top-bar-workspace-name` testid still exists or still means what it did** — R5 says it gets *replaced* by the expanded name when position = `'top'`; confirm by reading the current source whether that's a conditional replacement (testid persists, content changes) or a structurally different element.
- **Where the shared icon/rail-container logic that 1b/2b/4a/4b built actually lives** — `ProjectRailIcon.tsx` is referenced across four different task descriptions but did not exist as a separate file at PRD-authoring time (it was to be extracted from `ProjectRail.tsx` by 1b). Confirm its real export names before referencing them in any test, if you need them at all (you likely only need `WindowTopBar` and `AdvancedPanel`'s public surface, not the icon internals — but confirm this by reading `WindowTopBar.tsx`'s actual imports).

If what you find contradicts a specific claim in this brief, **follow the source, not the brief**, and proceed — this brief's job was to save you the trip to the PRD and give you a head start, not to be an oracle.

---

## Known Discrepancy: Two of the Three Target Files Already Exist

The task's `files_affected` list (and `execution_plan.yaml`'s `file_conflicts_checked.wave_5` note, "5a touches only new test files") both assume all three target files are new. **This is wrong for two of the three, verified during brief generation by reading the actual file tree:**

| Task-specified path | Actual state | What to do |
|---|---|---|
| `packages/electron/src/renderer/store/atoms/openProjects.test.ts` | **Already exists**, at `packages/electron/src/renderer/store/atoms/__tests__/openProjects.test.ts` (not the flat path the task lists — this repo puts renderer tests in a sibling `__tests__/` directory, confirmed by every other file in `store/atoms/` and `components/WindowTopBar/`). It already has substantial coverage of `addOpenProjectAtom`, `closeOpenProjectAtom`, `activeOpenProjectAtom`, `resolveInitialOpenProjectsState`, etc. | **Extend this existing file** with new `describe` block(s) for the default-merge behavior of `projectRailPositionAtom`/`projectRailExpandedDisplayAtom`. Do not create a second file at the flat path — that would produce two competing test files for the same module. |
| `packages/electron/src/renderer/components/WindowTopBar/WindowTopBar.test.tsx` | **Already exists**, at `packages/electron/src/renderer/components/WindowTopBar/__tests__/WindowTopBar.test.tsx`. It has ~15 existing tests covering git status, panel toggles, fullscreen exit, etc. — none of it covers project-bar placement yet (expected, since 3a/4a/4b are the tasks that add that behavior and this test file predates them). | **Extend this existing file.** Read it in full first — it already establishes the render helper pattern, the `MaterialSymbol` mock, and the `afterEach` cleanup convention you must match. |
| `packages/electron/src/renderer/components/GlobalSettings/panels/AdvancedPanel.test.tsx` | **Does not exist**, confirmed. Sibling tests in the same component directory live at `panels/__tests__/*.test.tsx` (four existing files: `AccountOrgList.test.tsx`, `DatabasePanel.test.tsx`, `SharedLinksPanel.test.tsx`, `SyncPanel.test.tsx`). | **Create new**, at `panels/__tests__/AdvancedPanel.test.tsx` — matching the sibling directory convention, not the flat path the task lists. |

Re-verify this table yourself before writing anything — it reflects the tree as read at brief-generation time; if any of the seven upstream tasks changed test-file layout as part of their own work, trust what you see on disk over this table.

---

## Requirements

Three independent test surfaces, one per file, each covering a distinct upstream task cluster:

1. **Default-merge behavior (1a)** — extend `store/atoms/__tests__/openProjects.test.ts`. Confirm `projectRailPositionAtom` resolves to `'left'` and `projectRailExpandedDisplayAtom` resolves to `'always-visible'` when the corresponding IPC calls return `undefined`/missing (simulating a saved-state object from before this PRD shipped). This is testing the renderer-atom load path inside `initOpenProjects()` (or whatever the real 1a implementation calls it), not just the atom's initial value — the interesting case is "the IPC round-trip returned nothing," not "nobody wrote to the atom yet."

2. **Settings-UI dependent visibility (2a)** — new file `GlobalSettings/panels/__tests__/AdvancedPanel.test.tsx`. Confirm the position control renders only when multi-project mode is on, and the display-mode control renders only when position is `'top'`. This is a component test (render `AdvancedPanel`, assert on presence/absence of the controls via `screen.queryByTestId`/`queryByRole`, not on internal state).

3. **Top-docked `WindowTopBar` merge (3a/4a/4b)** — extend `WindowTopBar/__tests__/WindowTopBar.test.tsx`. Confirm the active project's full name (sourced from `activeOpenProjectAtom`) renders when position = `'top'`, and today's static-workspace-name behavior is unchanged when position = `'left'`. This is the highest-value test in the task, because 3a is the PRD's flagged highest-risk task (drag-region + `pointer-events-none` handling) and had no task-local test.

None of these three tests need to cover 4a's animation timing or 4b's hover-reveal pixel-level behavior in detail — per this task's fourth success criterion, no presentation-only assertions. If 4a/4b's behavior is reachable through a `className`/`data-*` state toggle (e.g., a `data-revealed="true"` attribute, a `data-animating` state), asserting on that state transition is in scope; asserting on computed CSS values, transition durations, or exact pixel positions is not.

---

## This Repo's Testing Rules (verbatim from root `CLAUDE.md`)

Restated here in full so you have it without needing the file loaded separately:

> **Any change to runtime behavior ships with a unit test** — a new test, or an extension of an existing one. Pure refactors already covered by tests, formatting, docs, and config-only changes are exempt. Before pushing, run the gate locally: `npm run typecheck && npm run test:prepush`. The repo's pre-push hook runs this automatically; it installs on `npm install` (or `npm run hooks:install`). Never push to `main` with a red suite — CI on `main` is a backstop, not the gate.
>
> **A test's job is to catch a regression a reader cannot see.** The test corpus is ~2M tokens, and every future session pays to read the tests next to the code it touches. A test that only re-states what is obvious on screen is pure cost. Write fewer, denser tests:
>
> - **No presentation-only tests** — icon names, exact title strings, tab ordering, hardcoded element counts. If a human would notice the breakage in one second of looking at the screen, it does not need a unit test. Purely visual changes (label, spacing, color) need no test at all.
> - **Never assert on component source text** via `readFileSync` + `toContain`/`toMatch`. Render it or don't test it. Genuine architectural invariants belong in a `scripts/` gate, not the vitest suite.
> - **Never assert CSS through jsdom by injecting the CSS you are about to assert on** — that is circular. Assert the `className`, or cover it in E2E where real styles load.
> - **Mock the narrowest module, never the `@nimbalyst/runtime` barrel.** Importing that barrel costs ~2.6s of module-import CPU per test file because it drags in the whole Lexical editor tree. `vi.mock('@nimbalyst/runtime/ui/icons/MaterialSymbol', …)` is cheap; `vi.mock('@nimbalyst/runtime', async (importOriginal) => ({ ...await importOriginal(), … }))` is the expensive shape — the spread forces the real barrel to load. Import from the deep path in source too, so the barrel never enters the graph. See NIM-2374.
> - **A `vi.mock()` whose specifier the module under test no longer imports is a silent no-op.** Moving a source import (barrel → deep path, or any rename) without repointing every mock of it lets the *real* module load, and the failure surfaces far from the edit. When you change an import specifier in source, grep the test tree for the old specifier in the same commit.
> - **Prefer extending an existing test file** over creating a new one — but do not merge unrelated tests into a mega-file. Small and focused is correct; total volume is the enemy, not file count.
> - **Add `// @vitest-environment node` as the first line of any test that never touches the DOM.** The jsdom environment costs ~270ms per file for nothing.
> - **Don't write `expect(getBy*(...)).toBeTruthy()`** — `getBy*` already throws.

**Applied to this task's three files specifically:**

- `openProjects.test.ts` is a pure atom/logic test — no DOM. The *existing* file does not currently carry a `// @vitest-environment node` pragma (worth noting, not worth fixing — that's an unrelated pre-existing gap, don't touch it as part of this task; changing it would be scope creep per this repo's "change surgically" rule). Your **new** additions to this file don't need their own separate pragma since it's a single file-level directive — if you want the perf win, you would need to add the pragma at the top of the whole file, which touches lines outside your addition; leave it alone unless a fresh empty file were being created (it is not).
- `AdvancedPanel.test.tsx` is a new file that renders a component — needs `// @vitest-environment jsdom` as its first line (every existing sibling in `panels/__tests__/` does this — `SyncPanel.test.tsx` and `DatabasePanel.test.tsx` both open with it).
- `WindowTopBar.test.tsx` already carries `// @vitest-environment jsdom` — keep it, you're extending, not replacing.

**One sibling anti-pattern to explicitly avoid copying:** `GlobalSettings/panels/__tests__/SyncPanel.test.tsx` uses `vi.mock('@nimbalyst/runtime', async (importOriginal) => ({ ...await importOriginal(), MaterialSymbol: ... }))` — this is the exact expensive barrel-spread shape the CLAUDE.md rule above calls out by name. It predates that rule (or was missed by it) and is not something to clone. For `AdvancedPanel.test.tsx`, follow **`DatabasePanel.test.tsx`'s** pattern instead — same directory, same kind of component, and it already uses the cheap deep-path mock:
```ts
vi.mock('@nimbalyst/runtime/ui/icons/MaterialSymbol', () => ({
  MaterialSymbol: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));
```
`AdvancedPanel.tsx` itself already imports `MaterialSymbol` from that same deep path (`@nimbalyst/runtime/ui/icons/MaterialSymbol`, confirmed at its line 4), so the deep-path mock will actually intercept it — confirm this is still true after re-reading the file per the verification section above.

---

## Success Criteria

Complete ALL criteria before marking task done (verbatim from `tasks.yaml`, with implementation notes added):

- [ ] Unit test confirms `projectRailPosition` and `projectRailExpandedDisplay` default to `'left'`/`'always-visible'` when absent from saved state (default-merge behavior) — added to `store/atoms/__tests__/openProjects.test.ts`
- [ ] Unit or component test confirms the position control in `AdvancedPanel` is hidden when multi-project mode is off, and the display-mode control is hidden when position != `'top'` — added to `GlobalSettings/panels/__tests__/AdvancedPanel.test.tsx`
- [ ] Test confirms `WindowTopBar` renders the active project's full name (from `activeOpenProjectAtom`) when position = `'top'`, and renders today's static workspace-name behavior unchanged when position = `'left'` — added to `WindowTopBar/__tests__/WindowTopBar.test.tsx`
- [ ] No presentation-only tests (icon names, exact pixel positions) per this repo's testing conventions — assert behavior/className, not visual detail
- [ ] All three target areas covered by **extending the existing files** for `openProjects.test.ts` and `WindowTopBar.test.tsx` (both already exist — see Known Discrepancy section above) and **creating** `AdvancedPanel.test.tsx` as new, following the closest existing sibling test file's setup/mocking conventions in the same directory
- [ ] `npm run typecheck` passes
- [ ] `npm run test:prepush` passes (this is the PRD's explicit release-gate requirement, not just this task's local gate — see Milestones in the PRD)

**All criteria must pass before task is complete.**

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/electron/src/renderer/store/atoms/__tests__/openProjects.test.ts` | modify | Add default-merge coverage for `projectRailPositionAtom`/`projectRailExpandedDisplayAtom` (task-listed path was `openProjects.test.ts` flat — corrected per Known Discrepancy above) |
| `packages/electron/src/renderer/components/GlobalSettings/panels/__tests__/AdvancedPanel.test.tsx` | create | New file: dependent-visibility coverage for the position and display-mode controls added by 2a (task-listed path was flat, no `__tests__/` — corrected above) |
| `packages/electron/src/renderer/components/WindowTopBar/__tests__/WindowTopBar.test.tsx` | modify | Add top-docked-vs-left-docked identity rendering coverage for 3a/4a/4b's merge (task-listed path was `WindowTopBar.test.tsx` flat — corrected above) |

### File Ownership Notes

All three files are test-only; none overlap with any other task's file set (every other task in this PRD explicitly defers test-writing to this one). No coordination needed with any sibling task — this task runs alone in Wave 5 after everything else has landed on the shared branch.

---

## Deliverables

None beyond the files above.

---

## Implementation Guidance

### Patterns to Follow

**For `openProjects.test.ts`** — the existing file (read it in full before adding anything) tests pure atom writes with a locally-created `createStore()` from `jotai`, bypassing `initOpenProjects()` entirely for most of its coverage. The default-merge behavior you need to test, however, lives *inside* `initOpenProjects()`'s `??`-guarded load logic (per 1a's brief — reconfirm against real source), which reads the module-level singleton `store` from `@nimbalyst/runtime/store`, not a locally-created one. Two known-good reference patterns exist in this same package for testing that kind of IPC-driven init function directly:
- `store/atoms/__tests__/windowMode.hydration.test.ts` — stubs `window.electronAPI.invoke` via `vi.stubGlobal('window', { electronAPI: { invoke } })`, calls the real `init*()` function, and asserts against the real module-level `store` (imported from `@nimbalyst/runtime/store`) via `store.get(...)`.
- **Gotcha to verify before relying on this pattern**: `initOpenProjects()` guards itself with a module-level `let initialized = false; if (initialized) return;` — unlike `windowMode.ts`, `openProjects.ts` does **not** export a `resetOpenProjects()`-equivalent (confirm this is still true when you read the file — 1b/3a might have added one). If it's still absent, you can only meaningfully call `initOpenProjects()` **once** per test-file module instance without `vi.resetModules()` + a dynamic re-import. Write the default-merge assertion as a single `it()` that stubs `window.electronAPI.invoke` to resolve `undefined` for the position/display-mode channels (and whatever minimal stubs the other `Promise.all` entries need to not throw), calls `initOpenProjects()` once, and asserts both new atoms resolved to their defaults. Do not attempt a second `initOpenProjects()` call in a different test case in the same file unless you've confirmed a reset path exists.

**For `AdvancedPanel.test.tsx`** — clone `DatabasePanel.test.tsx`'s shape: `// @vitest-environment jsdom` first line, deep-path `MaterialSymbol` mock, `render(<AdvancedPanel ... />)`, assert via `screen.queryByTestId`/`queryByRole`. `AdvancedPanel.tsx` currently imports `multiProjectModeAtom`, `openProjectsAtom`, `activeWorkspacePathAtom`, `restorePreviousProjectsAtom` from `../../../store/atoms/openProjects` (confirmed at its lines 32-36) — the two new atoms from 1a almost certainly live in the same import block; confirm the exact names by reading the file, then seed them via a Jotai `Provider`+`createStore()` wrapper (see `SyncPanel.test.tsx`'s `renderAccounts()` helper for the `Provider store={store}` pattern, though skip its barrel-mock anti-pattern per the note above) or via whatever local render helper `AdvancedPanel.tsx`'s own component tree expects.

**For `WindowTopBar.test.tsx`** — clone the existing file's own conventions exactly: `// @vitest-environment jsdom`, the deep-path `MaterialSymbol` mock already at its top (do not duplicate it), `afterEach(() => { cleanup(); getDefaultStore().set(windowFullScreenAtom, false); })`-style reset for any new atom you seed via `getDefaultStore()` (e.g. `activeOpenProjectAtom`'s upstream dependencies — `openProjectsAtom`, `activeWorkspacePathAtom` — and the new `projectRailPositionAtom`), and the existing `render(<WindowTopBar ... />)` call shape. **Before writing assertions, re-read `WindowTopBar.tsx`'s current prop signature and JSX** — as of brief-generation time `workspaceName` was a required prop and the component read no rail-related atoms at all; after 3a lands this may have changed substantially (new props, new atom reads, or both). Write your two new test cases — "position = `'top'` renders the active project's full name" and "position = `'left'` renders the unchanged static name" — against whatever the real post-3a component actually needs to be rendered correctly (which may include seeding `openProjectsAtom`/`activeWorkspacePathAtom` on the default Jotai store before render, matching how the existing file seeds `windowFullScreenAtom`).

### Code Style

Match each target file's existing style exactly (import ordering, `describe`/`it` nesting depth, assertion style) — these are extensions of files with established conventions, not blank-slate files. `AdvancedPanel.test.tsx` is the only genuinely new file; match its nearest sibling (`DatabasePanel.test.tsx`) rather than inventing a new shape.

### Edge Cases

- The default-merge test's actual edge case is "the field is *absent* from persisted state" (an old saved-state JSON blob, or a stubbed IPC call resolving `undefined`), not "the atom hasn't been written to yet" — those are different failure modes and only the former is what 1a's `??` guard exists to catch.
- For the position-control visibility test, cover both directions explicitly: multi-project mode off → position control absent; multi-project mode on → position control present. Same for the display-mode control against position `!= 'top'` vs `== 'top'`.
- For `WindowTopBar`, don't only test the "happy path" of position=`'top'` with an active project set — also confirm the existing `position = 'left'` test cases in the file (git status, panel toggles, fullscreen exit, etc.) still pass unmodified after your changes, since R4's zero-regression requirement for the left-docked path is itself testable by "the existing suite still passes."

### Testing Requirements

This *is* the testing task — there is no further deferral. Everything above is the testing requirement.

### Coverage Expectations

**Target Files for Coverage:** upstream implementation files from all seven dependency tasks. Since only 1a's brief exists at brief-generation time, the exact file list for 1b/2a/2b/3a/4a/4b is inferred from `tasks.yaml`'s `files_affected` fields — re-verify against the real diff/file tree before treating this as authoritative.

| File | Target | Rationale |
|------|--------|-----------|
| `packages/electron/src/renderer/store/atoms/openProjects.ts` | 80%+ on the new default-merge branch specifically | Core persistence logic from 1a |
| `packages/electron/src/renderer/components/GlobalSettings/panels/AdvancedPanel.tsx` | 70%+ on the two new controls | Dependent-visibility UI from 2a |
| `packages/electron/src/renderer/components/WindowTopBar/WindowTopBar.tsx` | 70%+ on the position-branch rendering | Highest-risk merge logic from 3a; full drag-region/pointer-events coverage is not achievable in jsdom (no real drag events) and is intentionally out of scope here — that risk is mitigated by 3a's own manual verification, not by this task's unit tests |

**Intentionally Uncovered Lines:**
- `WindowTopBar.tsx` — any native-drag-region interaction paths (jsdom cannot simulate OS-level window dragging; covered by 3a's manual end-to-end verification per this repo's `end-to-end-verification.md` rule, not by unit tests here)
- `WindowTopBar.tsx`/`ProjectRail.css` — 4a's animation/transition timing and 4b's exact hover-reveal CSS state (explicitly out of scope per this task's fourth success criterion — no presentation-only assertions)

**Verification:**
```bash
npm run test:unit -- --coverage
```

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

Per `.nimble/config.yaml` `boundaries.require_review`, none of this task's three test files fall under the require-review list (`packages/electron/src/main/**`, `packages/electron/src/database/**`, `packages/collabv3/*`, or the two named scripts) — all three are renderer-side test files. No special review flag applies to this task's own diff, though the PRD's single end-of-work review still covers the whole feature branch including the main-process files 1a touched.

---

## Dependencies

### Upstream Tasks

| Task | What it provides | Verify before starting |
|------|------------------|------------------------|
| 1a | `projectRailPosition`/`projectRailExpandedDisplay` store schema, IPC channels, renderer atoms with `??` default-merge (brief exists — see `briefs/1a_project-bar-top-placement.md` for exact planned names, but reconfirm against real `openProjects.ts`) | Read `packages/electron/src/renderer/store/atoms/openProjects.ts` for the real atom names and `initOpenProjects()` shape |
| 1b | Extracted shared icon/container logic (`ProjectRailIcon.tsx` or equivalent) — no brief exists yet at generation time | Read `packages/electron/src/renderer/components/ProjectRail.tsx` and check whether `ProjectRailIcon.tsx` exists as a separate file |
| 2a | `AdvancedPanel` position + display-mode controls — no brief exists yet | Read `packages/electron/src/renderer/components/GlobalSettings/panels/AdvancedPanel.tsx` for the real control component names/testids |
| 2b | Horizontal-layout CSS variant for the shared icon component — no brief exists yet | Read `packages/electron/src/renderer/components/ProjectRail.css` for the new class names, only if your `WindowTopBar` tests need to assert a specific className |
| 3a | Structural merge of the rail into `WindowTopBar` when position=`'top'` — no brief exists yet, PRD flags this as highest-risk | Read `packages/electron/src/renderer/App.tsx` and `WindowTopBar.tsx` for the real merged structure, prop signature, and whether `pointer-events-none` was actually resolved |
| 4a | Circle-to-text expand animation — no brief exists yet | Only relevant if you assert on an animation-state `data-*` attribute; skip CSS/timing assertions entirely |
| 4b | Hover-reveal for non-selected circles — no brief exists yet | Only relevant if you assert on a hover-revealed-state `data-*` attribute; skip CSS/timing assertions entirely |

### Downstream Impact

None — no downstream dependencies. This is the last task in the PRD; it gates the single end-of-work integration review, not another task.

**Before starting:** All seven upstream tasks must be complete (this task's `depends_on` guarantees the orchestrator will not start it otherwise). Do not additionally assume any of their *briefs* exist or are accurate — most don't exist yet at brief-generation time. Verify completeness by reading the real source files listed in the table above, not by looking for brief files.

---

## GitHub Context

**Issue:** N/A — this PRD is not tracked via GitHub Issues (see Feature Issue note in the header)
**Feature Issue (Parent):** N/A
**Branch:** `worktree/project-bar-movement` — this PRD uses a single shared feature branch for all 8 tasks (per `status.json`'s `branch_strategy: "use-worktree-branch-directly"`). Do not create a per-task branch.
**Target:** Determined by PM agent — per this PRD's single-integration-review orchestration, this task's commit lands on the shared feature branch, not directly on `main`. This task's completion is also the trigger condition for the review gate (`execution_plan.yaml`'s `review_gate.before_review` lists "5a complete" first).

---

## Commit Guidelines

Use Conventional Commits. Keep the subject to one sentence, per this repo's `CLAUDE.md` commit-message rule:

```
test(electron): cover project-bar top-placement settings and WindowTopBar merge
```

Do NOT add a `Co-Authored-By: Claude` trailer — this repo's `CLAUDE.md` explicitly forbids it.

Types: feat, fix, refactor, test, docs, chore (this task is `test`).

**CHANGELOG.md:** Per this repo's `CLAUDE.md`, only update `CHANGELOG.md` when explicitly asked to propose a commit. This task is test-only with no user-visible behavior change — no CHANGELOG entry belongs on this task even if one is requested for the overall PRD; that entry belongs on whichever task(s) shipped the visible feature (2a for the settings UI, 3a/4a/4b for the top-docked behavior).

---

## Validation Checklist

Before creating PR / handing off for the integration review:
- [ ] All success criteria met
- [ ] Type check passes: `npm run typecheck`
- [ ] Full pre-push gate passes: `npm run test:prepush`
- [ ] No `never_touch` files modified
- [ ] Both existing test files (`openProjects.test.ts`, `WindowTopBar.test.tsx`) were extended, not duplicated at a second path
- [ ] `AdvancedPanel.test.tsx` created at `panels/__tests__/AdvancedPanel.test.tsx`, matching sibling convention
- [ ] No presentation-only assertions (icon names, exact pixel/CSS values, animation timing)
- [ ] Branch is the shared feature branch `worktree/project-bar-movement`, not a new per-task branch
- [ ] This is the last task before the single end-of-work integration review — flag completion clearly for the PM agent to trigger that review

---

*Generated by NIMBLE Brief Writer*
*PRD: project-bar-top-placement | Task: 5a | Wave: 5*
