# Pre-Execution Review — project-bar-top-placement

## Resolution

Applied directly (not via brief-corrector agent):
- **Finding 1** (context-menu ownership gap): resolved via option (a) — widened task 3a's scope in
  both `tasks.yaml` and `briefs/3a_project-bar-top-placement.md` to build the top-docked context
  menu, per the PRD's full-implementation direction. Added 2 new success criteria to 3a (context
  menu, add-menu dropdown visibility — folding in Warning 1 too).
- **Finding 2** (stale `ProjectRail.css` line range in `tasks.yaml`): fixed, `73-81` → `66-75`.
- **Warning 1** (add-menu dropdown under-specified): folded into the Finding 1 fix above.
- **Warning 2** (4a/`ProjectRailIcon.tsx` className overlap with 2b): no fix — left as an
  observation for the single end-of-work review, per the reviewer's own recommendation.


**Reviewed:** PRD, tasks.yaml, execution_plan.yaml, all 8 briefs (1a, 1b, 2a, 2b, 3a, 4a, 4b, 5a), against live source (`ProjectRail.tsx`, `WindowTopBar.tsx`, `App.tsx`, `store.ts`, `SettingsHandlers.ts`, `openProjects.ts`, `AdvancedPanel.tsx`, test tree, `package.json`).

**Counts:** Critical: 2 · Warning: 2 · Observation: 3

**Clearance: PROCEED WITH CAUTION** — one Critical (context-menu ownership gap) should be resolved in `tasks.yaml`/3a's brief before execution; the other Critical is a documentation-only line-number drift with no execution impact once flagged.

---

## Critical Findings

### Finding 1 — No task owns building the top-docked context menu; R7's "context menus reposition below" is unimplementable as scoped

**Affected files:** `tasks.yaml` (3a `files_affected`), `briefs/3a_project-bar-top-placement.md` (Composition Plan), `briefs/1b_project-bar-top-placement.md:66-72`, `briefs/2b_project-bar-top-placement.md:29-39`, PRD R6/R7.

**Evidence:** Verified live in `ProjectRail.tsx`: `ProjectRailIcon` (the function 1b extracts) spans lines 68-179 and contains exactly **one** `useFloating()` call (line 82, the hover tooltip, `placement: 'right'`). The other three `useFloating()` instances — add-menu (line 313, `placement: 'right-start'`), add-button tooltip (line 349), and the right-click **context menu** (line 372, `placement: 'right-start'`, virtual cursor reference) — all live in the parent `ProjectRail()` container, confirmed by grep (`function ProjectRail(` boundary at 179, all three later `useFloating` calls after it). 1b's own brief (line 60-72) explicitly keeps these three in `ProjectRail.tsx`, not `ProjectRailIcon.tsx`, "per-consumer." 1b's exported `ProjectRailIconProps` (its own brief, line 107-117) makes `onContextMenu` a **required** prop with no default.

2b's brief independently discovered this and explicitly flagged it as a scope gap to raise at execution time (2b brief, "Pre-flight Verification" item 2: "If the add-menu and/or context-menu floating-ui logic is still in `ProjectRail.tsx` after 1b's extraction, that logic is out of this task's declared file scope — flag this as a scope gap before proceeding"). That is the correct behavior for 2b in isolation, but **3a's brief — the only task with `WindowTopBar.tsx` in scope — never picks this up.** 3a's "Top-Docked Composition Plan" enumerates exactly three pieces (active-name+close, non-active circles, add-project control) and never mentions a context menu, right-click handling, "Open in new window," or "Reveal in Finder." Because `onContextMenu` is required on `ProjectRailIconProps`, the executing agent for 3a must supply *some* callback to satisfy TypeScript, but has zero guidance on what it should do — the likely outcome is a no-op or an unstyled/side-opening leftover, silently regressing right-click functionality in the top-docked position with no test or success criterion catching it (5a's brief only requires the active-name and left/right position-branch tests, not context-menu behavior).

**Problem:** R7 ("tooltips and context menus reposition below instead of beside") presumes context menus render in the top-docked layout. As task-scoped, no file boundary covers building that UI: it's not in 1b (deliberately, per-consumer), not in 2b (files are `ProjectRail.css`/`ProjectRailIcon.tsx` only, and 2b's own brief says to flag rather than expand), and not in 3a (whose Composition Plan omits it, despite `WindowTopBar.tsx` being the only place a per-consumer context-menu `useFloating()` instance could live). This will surface as either a TypeScript compile pressure point or a silent functional regression, not caught by any declared success criterion.

**Correction needed:** Before execution, either:
- (a) Widen 3a's brief/`tasks.yaml` `files_affected`/success criteria to explicitly require a top-docked context menu: a new `useFloating()` instance in `WindowTopBar.tsx` (virtual cursor reference, `placement: 'bottom-start'`, `windowControlsClearance()` middleware — mirroring `ProjectRail.tsx:372-392`), wired to 1b's `contextMenuProject`/`openContextMenu`/`closeContextMenu`/`openInNewWindow`/`revealInFinder`, with its own local `{x,y}` state exactly as `ProjectRail.tsx` does today. Add a matching success criterion; or
- (b) Explicitly descope context-menu parity from the top-docked position for this PRD (document as an accepted limitation, matching R8's Q1 pattern), and correct R7's wording to scope "context menus" down to whatever is actually built (the per-icon tooltip only), and have 3a wire `onContextMenu={() => {}}` deliberately with a one-line comment noting the descope.

Given the PRD's own risk table already flags 3a as highest-risk, folding this into 3a rather than inventing a ninth task is the lower-disruption fix.

---

### Finding 2 — 2b's brief cites a stale `ProjectRail.css` line range for the active-indicator rule, inherited from `tasks.yaml`'s `agent_context`

**Affected file:** `tasks.yaml` task 2a agent_context (n/a) — actually `tasks.yaml` task **2b**'s `agent_context` field cites `ProjectRail.css:73-81`.

**Actual state:** 2b's own brief (lines 39, 51, 105) already caught and corrected this: "the task definition's `agent_context` in `tasks.yaml` cites `ProjectRail.css:73-81` for the vertical active-indicator rule. As independently verified while writing this brief, that rule is currently at `ProjectRail.css:66-75`... the task definition's line numbers have drifted from source." 2b's brief consistently uses the corrected `66-75` range in its own Requirements/Success Criteria.

**Problem:** This is downgraded from "would cause execution failure" to a documentation nit because 2b's brief — the artifact the executing agent actually reads — already self-corrected and instructs re-verification at execution time regardless. It is flagged as Critical-tier only because `tasks.yaml` itself (the machine-parsed task definition, not just the brief) still carries the stale line numbers, and if any other task or a future regeneration re-reads `tasks.yaml`'s `agent_context` directly instead of the brief, it will cite the wrong lines.

**Correction needed:** Update `tasks.yaml` task 2b's `agent_context` field to cite `ProjectRail.css:66-75` instead of `73-81`, so the machine-readable source of truth matches the brief's already-corrected value.

---

## Secondary Observations

### Warning 1 — 3a's add-menu floating-ui reuse is under-specified relative to its context-menu treatment

3a's brief tells the executing agent to reuse 1b's `handleOpenAddMenu`/`addProjectByPath`/`atCap` business logic for the `+` button, and generically says to reuse `windowControlsClearance()` "for any circle tooltip you compose in," citing `ProjectRail.tsx:309-339` (the add-menu) as a pattern to follow — but never states as an explicit success criterion that the add-menu dropdown itself (the recent-projects list UI, not just the IPC calls behind it) must be built with its own `useFloating()` instance in `WindowTopBar.tsx`. This is less severe than Finding 1 (the add-menu is at least referenced as a pattern to clone, and 3a's success criteria do require "add-project controls... function"), but a reviewer should confirm 3a's shipped code actually renders a positioned dropdown and not just a bare "+" that calls `openAddMenu()` with no visible menu.

### Warning 2 — 4a's `files_affected` includes `ProjectRailIcon.tsx`, which 1b's brief explicitly says is not needed for animation

1b's brief (line 281) states "Do not add any horizontal-specific CSS in this task... the `is-horizontal` class exists only so task 2b has a stable selector to target." 4a's `files_affected` (tasks.yaml) lists `ProjectRailIcon.tsx` as a file it modifies, and its own brief frames this as adding "hooks (class names, animation-trigger keys)" to the shared component. This is plausible and not a conflict (2b already established the `is-horizontal` modifier as a stable hook 4a can build on), but worth a light touch: 4a should avoid re-touching the same className logic 2b added rather than layering a second modifier system on `ProjectRailIcon.tsx`. Not blocking — flagged for the reviewer's attention during the single end-of-work review, consistent with this PRD's orchestration model.

---

## Observations

### Observation 1 — 5a brief and tasks.yaml/execution_plan.yaml are in agreement (confirmed, no gap)

Verified via `git show 86650d3`: the same commit that generated all 8 briefs also corrected `tasks.yaml`'s and `execution_plan.yaml`'s `files_affected`/`file_conflicts_checked.wave_5` fields to the `__tests__/` sibling-directory paths. Live filesystem check confirms `openProjects.test.ts` and `WindowTopBar.test.tsx` already exist at `store/atoms/__tests__/` and `components/WindowTopBar/__tests__/` respectively (matching both 5a's brief and the corrected `tasks.yaml`), and `AdvancedPanel.test.tsx` does not yet exist anywhere (correctly treated as new by both). No correction needed.

### Observation 2 — Parallel-generation re-verification instructions are present exactly where required

2a, 2b, 3a, 4a, 4b, and 5a's briefs (the six generated before or alongside their upstream dependencies existed) all correctly include an explicit "verify against actual shipped code, not this brief's inferred description" instruction, with specifics on what to re-check (prop names, `useFloating()` locations, `data-testid`s, whether `pointer-events-none` was resolved). This matches the PRD's parallel-generation caveat and is not a defect. 1a's brief (which has no upstream dependencies) correctly omits this instruction, as expected.

### Observation 3 — 1b's inferred API shape is broadly consistent with what 2a/2b/3a/4a/4b assume, with one naming caveat

1b's brief (`useProjectRailController()`, `ProjectRailIcon`, `ProjectRailOrientation`, required `orientation` prop) is largely what 2b, 3a, and 4a describe as their working assumption. One inconsistency worth noting for the executing agents: 3a's brief (line 127) speculates the hook might be named `useProjectRailActions()` as a fallback guess, while 1b's actual brief fixes the name as `useProjectRailController()`. Since 3a's brief also says "if it lands differently, adapt," this is self-resolving and not a blocking issue — flagged only so the reviewer isn't surprised if 3a's landed code doesn't match its own speculative naming aside.

---

## Correction Summary

| # | Severity | File(s) | Fix |
|---|----------|---------|-----|
| 1 | Critical | `tasks.yaml` (task 3a), `briefs/3a_project-bar-top-placement.md` | Add explicit scope/success-criterion for the top-docked context menu (new `useFloating()` instance in `WindowTopBar.tsx`, wired to 1b's controller), or explicitly descope and correct R7's wording + 3a's `onContextMenu` wiring comment |
| 2 | Critical (docs) | `tasks.yaml` (task 2b `agent_context`) | Change cited line range from `ProjectRail.css:73-81` to `66-75` to match 2b's brief and live source |
| 3 | Warning | `briefs/3a_project-bar-top-placement.md` | Add explicit success criterion that the add-project dropdown menu (not just its handlers) is visibly positioned via its own `useFloating()` instance |
| 4 | Warning | `briefs/4a_project-bar-top-placement.md` | No fix required — flag for reviewer attention only, re: avoiding a second className system on `ProjectRailIcon.tsx` |

