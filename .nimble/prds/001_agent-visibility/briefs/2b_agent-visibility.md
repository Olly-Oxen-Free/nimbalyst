# Task Brief: 2b

**Title:** Build horizontal chip row above chat input
**PRD:** agent-visibility
**Priority:** must
**Complexity:** 6/10
**Model:** opus
**Wave:** 3
**Feature Issue:** Not yet created — this PRD has not started execution (`.nimble/prds/001_agent-visibility/status.json`: `tracker.issue_key: null`). The PM agent assigns the issue number and updates this brief's GitHub Context section at spawn time.

---

## Objective

Build a new horizontal chip row component that renders directly above the chat message input, one chip per active Teammate/SDK-native Task sub-agent in the current session, colored by a normalized status (working / waiting / blocked / complete / error). This closes gap #2 from the tracker item this PRD resolves (`tsk_mt1xxymgata1sw`): Nimbalyst has no chip-row equivalent to native Claude Code's sub-agent visibility — every existing sub-agent list today is vertical, sidebar-anchored, or hidden inside a separate mode, never a persistent horizontal strip next to where the architect is typing.

---

## Context

**Parent Feature:** Agent Visibility and Workflow Enhancement (PRD `agent-visibility`, source tracker item `tsk_mt1xxymgata1sw`). GitHub feature issue not yet created — see note above.

Nimbalyst has three separate "spawned agent" systems, each with its own status vocabulary and UI surface: SDK-native `Task` sub-agents (in-process, driven by `TaskInfo` in session metadata), Nimbalyst "Teammates" (`TeamCreate`/`SendMessage`, driven by `TeammateInfo`), and Meta-Agent Mode child sessions (real, separate `ai_sessions` rows — out of scope for this task and this PRD's chip-row work entirely). Today the only sub-agent status list is `TeammatePanel`, a vertical collapsible list rendered inside `FilesEditedSidebar` on the right side of the workstream layout — not adjacent to the chat input, and with no `blocked` status.

This task builds the new UI surface: a horizontal strip of small chips, one per active Teammate/Task sub-agent for the current session, positioned directly above the chat message input box. It is purely additive — `TeammatePanel`/`FilesEditedSidebar` are not replaced, redesigned, or removed. It is deliberately **display-only** in this task: click behavior (opening a Teammate's thread, showing a Task's read-only popover) is built in the *next* two tasks (2c, 2d), which both depend on this one and extend the same component file. Do not build click handlers beyond stubs/placeholders needed to keep the two downstream tasks' hooks straightforward — but do not skip planning for them either (see Implementation Guidance).

This task is part of **Wave 3** of a 6-wave execution plan. Wave 1 added the `blocked` status value to `TeammateInfo.status` (task 1a) and `TaskInfo.status` (task 1b). Wave 2 built the normalized `SubAgentStatus` mapping this task consumes (task 2a). This task (wave 3) is the first UI-visible deliverable of the PRD.

---

## Assumed Precondition: Task 2a's Output (`SubAgentStatus` Mapping)

**This task depends on 2a and cannot start until 2a is merged.** At the time this brief was written, task 2a had not yet run — `packages/electron/src/renderer/store/atoms/subAgentStatus.ts` does not exist yet. Before starting, read that file (or wherever 2a actually landed the mapping — it is `files_affected` per 2a's task definition, but do not assume the exact export name) and verify it actually provides what is assumed below. If it diverges from this description, adapt to what 2a actually shipped rather than to this brief.

**Expected shape, per PRD §4 R3 and task 2a's definition:**

- A new module, expected at `packages/electron/src/renderer/store/atoms/subAgentStatus.ts` (2a's stated `files_affected`; may also touch `agentMode.ts`).
- A **derived** mapping (Jotai derived-atom pattern, following `groupSessionStatusAtom` at `packages/electron/src/renderer/store/atoms/sessions.ts:1052` as the reference pattern) — **not** a new field persisted on `TeammateInfo`/`TaskInfo`.
- Normalizes every value of `TeammateInfo.status` (`'running' | 'completed' | 'errored' | 'idle' | 'blocked'`, the last value added by task 1a) and every value of `TaskInfo.status` (`'running' | 'completed' | 'failed' | 'stopped' | 'blocked'`, the last value added by task 1b) into exactly one of five normalized values: `working | waiting | blocked | complete | error`.
- Exhaustive — no silent fallthrough on an unmapped status value (TypeScript exhaustiveness check via `never`, or an equivalent test).
- Scoped to Teammates + Task sub-agents only. It does **not** touch or fold in Meta-Agent Mode's independent `getStatusTone`/`getBarTone` enum (`MetaAgentMode.tsx:67-104`) — that remains a third, disjoint vocabulary, explicitly out of scope for this PRD.

**How this task consumes it:** For each entry from `sessionTeammatesAtom(sessionId)` / `sessionTasksAtom(sessionId)` (see below), call/read the 2a mapping to get its normalized `working | waiting | blocked | complete | error` value, and use that value — not the raw `TeammateInfo.status`/`TaskInfo.status` string — to pick the chip's color/icon variant. If 2a exposes a per-entry atom/function (likely, given the derived-atom pattern), use it per-item rather than re-deriving the mapping logic in this component.

---

## Visual References

Approved mockup (local file, HTML — open in a browser to view live, do not just read the markup): `nimbalyst-local/mockups/agent-visibility-chip-row.mockup.html` (absolute path: `/home/jayden-eppcohen/Documents/Projects/Software/nimbalyst_worktrees/Agent-visibility-and-Workflow-Enhancement/nimbalyst-local/mockups/agent-visibility-chip-row.mockup.html`). This file is under `nimbalyst-local/`, which is in `.nimble/config.yaml`'s `never_touch` list — **read it for reference only, never edit or reference-copy it into the shipped component.**

The mockup shows the chip row inserted between the fading message history and the existing message input box, exactly matching the placement identified in Implementation Guidance below. It renders 5 example chips, one per normalized status, plus two callouts (not part of the visual spec) explaining click behavior for later tasks 2c/2d — ignore those callouts for this task.

**Chip visual spec, transcribed from the mockup's CSS (`--nim-*` values confirmed against `packages/runtime/src/editor/themes/palette.ts` `darkThemeColors`):**

| Status | Background | Border | Text/icon color | Icon | Animation |
|---|---|---|---|---|---|
| `working` | `var(--nim-bg-tertiary)` | `var(--nim-info)` (1px solid) | `var(--nim-info)` | quarter-circle spinner (SVG, matches `TeammatePanel.tsx`'s existing spin convention) | `animation: spin 0.9s linear infinite` on the icon |
| `waiting` | transparent | `var(--nim-text-faint)` (1px **dashed**) | `var(--nim-text-faint)` | hollow ring (SVG circle, stroke only) | none |
| `blocked` | `rgba(239, 68, 68, 0.18)` | `var(--nim-warning)` (1px solid) | `#fde3b0` (light amber; not a canonical `--nim-*` token — see note below) | warning triangle with exclamation dot (SVG) | pulsing box-shadow glow, `1.6s ease-in-out infinite`, using `rgba(251, 191, 36, 0.55)` (amber) fading to transparent |
| `complete` | `rgba(74, 222, 128, 0.16)` | `var(--nim-success)` (1px solid) | `var(--nim-success)` | checkmark (SVG) | none |
| `error` | `rgba(239, 68, 68, 0.16)` | `var(--nim-error)` (1px solid) | `#ffb4b4` (light red; not a canonical token — see note below) | x-circle (SVG) | none |

**Note on non-canonical text colors:** the mockup uses ad-hoc lightened hex values (`#fde3b0`, `#ffb4b4`) for chip text on top of the translucent status backgrounds, purely for contrast at small size on a dark background. `UI_PATTERNS.md` requires canonical `--nim-*` variables — do not hardcode these hex values. Use `var(--nim-warning)` / `var(--nim-error)` for text color directly (matching the border color) unless a contrast check shows that fails against the translucent background; if so, flag it rather than inventing a new hardcoded hex constant.

**Chip structure (each chip):** height 25px, horizontal flex, `gap: 5px` between icon and label, `padding: 0 8px`, `border-radius: 5px`, `font-size: 11px`, `font-weight: 500`, `white-space: nowrap`, `cursor: pointer`, 12x12px icon.

**Row structure:** `display: flex`, `align-items: center`, `gap: 6px`, `flex-wrap: nowrap` in the mockup (the mockup does not demonstrate wrapping — see Requirements below for the responsive requirement this task must still satisfy via `@container`, which supersedes the mockup's static `nowrap`).

**Accessibility (mockup does not show this, but PRD §5 requires it):** each chip needs an accessible label combining status + agent name (e.g. `aria-label="db-migration — blocked"`), not color alone — the icon differs per status specifically to serve this (also serves R9, which is Could-Have and not this task's job to build further, but do not use icon-less color-only chips).

If no relevant mockup existed for a follow-up detail, this brief states so explicitly rather than improvising a visual not shown above.

---

## Requirements

Build `SubAgentChipRow.tsx`, a new component, satisfying PRD requirement R4:

1. **Placement.** Render the chip row directly above the chat message input, inside `SessionTranscript.tsx`. The exact anchor point (confirmed by reading `SessionTranscript.tsx` for this brief): insert `<SubAgentChipRow sessionId={sessionId} />` immediately after the `<PromptQueueList ... />` block and immediately before the `{/* Input area ... */}` comment / `<SessionAIInput ... />` render (`packages/electron/src/renderer/components/UnifiedAI/SessionTranscript.tsx`, around line 2662–2674 at the time of writing — re-locate by searching for `<SessionAIInput` if line numbers have shifted). `PromptQueueList` in that spot is **not** gated by `mode === 'chat'` or `collapseTranscript` (unlike the `WakeupBanner`/`McpLockdownBanner`/`FileGutter` blocks a few lines above it, which are) — place `SubAgentChipRow` the same way, ungated, and let the component itself control visibility by rendering `null` when there is nothing to show (see requirement 3). This resolves PRD §9 Q3 (chip-row placement was an open question) — this is not a placement the architect approved visually beyond the mockup's schematic "above the input" framing; if the resulting layout visually collides with the existing input toolbar/attachment row once implemented, that is worth flagging in the PR, not silently reworking the anchor point without note.
   - `SessionTranscript.tsx` is **not** in task 2b's `files_affected` list in `tasks.yaml`, but is the necessary integration point discovered by investigation. Modify it as part of this task; note the addition in your PR/commit body since it's outside the originally-scoped file list.
2. **Data source.** Read `sessionTeammatesAtom(sessionId)` and `sessionTasksAtom(sessionId)` from `packages/electron/src/renderer/store/atoms/agentMode.ts` (already-existing atom families, no new atom family needed for sourcing — only for the 2a normalization layer). `sessionTeammatesAtom` returns `TeammateInfo[]` (type declared in `TeammatePanel.tsx`, not `agentMode.ts` — `agentMode.ts` only imports it). `sessionTasksAtom` returns `TaskInfo[]` (type declared in `agentMode.ts`). Filter `TeammateInfo` entries the same way `TeammatePanel.tsx` already does — exclude `teamName === '_background'` and `teamName === '_subagent'` (dead legacy entries after the switch to SDK-native sub-agents); see `TeammatePanel.tsx`'s existing `teammates` `useMemo`.
3. **Empty state.** Render nothing (return `null`, not an empty placeholder row/div) when there are zero active Teammate/Task entries for the session after filtering.
4. **One chip per entry**, colored/iconed per its normalized status from the 2a mapping (see precondition section above). Chips must appear as new teammates/tasks spawn and disappear/update as they complete — this falls out naturally from subscribing to the atom families, no polling needed.
5. **Terminal-state persistence convention.** PRD §9 Q6 directs this brief to match whatever convention `TeammatePanel.tsx` already uses for completed/errored teammates, rather than inventing a new one. `TeammatePanel.tsx` does **not** auto-dismiss completed/errored entries from its own rendered list on a timer — it keeps them visible with reduced opacity (`opacity-60` class, `TeammatePanel.tsx:335`) and a filled-dot icon, for as long as the entry remains in `sessionTeammatesAtom`/`sessionTasksAtom` (i.e., until whatever upstream mechanism — outside this task's scope — removes it from session metadata). Match this: do not build a new client-side dismissal timer for `complete`/`error` chips in this task; let them persist as long as the atom returns them, exactly like `TeammatePanel.tsx` does.
6. **Styling.** Only canonical `--nim-*` CSS variables (`docs/UI_PATTERNS.md`) — no ad-hoc hex values baked into the component beyond what's justified in Visual References above. Component root needs a stable kebab-case semantic class per `docs/REACT_DOM_MARKERS.md` (e.g. `sub-agent-chip-row`), not a utility-only className. Mutually exclusive status-color states must use a ternary/switch that applies one complete class set, never concatenated conditional fragments (`docs/UI_PATTERNS.md` "Tailwind Conditional Classes Pattern").
7. **Responsive.** Use `@container` queries, not `@media`, for chip sizing/wrapping when many teammates/tasks are active (`docs/UI_PATTERNS.md`). The mockup shows a static `flex-wrap: nowrap` row — that is the mockup's simplification for a fixed-width screenshot, not the shipped requirement; the row must degrade gracefully (wrap or horizontal-scroll) at real container widths per PRD §5's "Responsive" note. Container query naming/threshold is your implementation choice; document the chosen breakpoint in a code comment.
8. **No click behavior in this task.** Clicking a chip does nothing user-visible yet (2c wires Teammate click-to-thread; 2d wires the Task read-only popover). It is fine — and expected, per the file-overlap note in Implementation Guidance — to add an `onClick` prop/callback stub on the chip component so 2c/2d can wire behavior in without restructuring your component, but do not implement navigation, popovers, or messaging logic here.

---

## Success Criteria

Complete ALL criteria before marking task done (verbatim from `tasks.yaml`):

- [ ] Chip row renders above the chat message input when at least one teammate/task is active for the session
- [ ] No chip row rendered (not an empty placeholder) when no teammates/tasks are active
- [ ] Chips appear/disappear as teammates/tasks spawn and complete, reading from `sessionTeammatesAtom`/`sessionTasksAtom`
- [ ] Chip color follows the normalized `SubAgentStatus` mapping from task 2a
- [ ] Uses only canonical `--nim-*` CSS variables; component root has a stable kebab-case class per `REACT_DOM_MARKERS.md`
- [ ] Responsive chip sizing/wrapping uses `@container` queries, not `@media`

**All criteria must pass before task is complete.**

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/electron/src/renderer/components/AgentMode/SubAgentChipRow.tsx` | create | New chip-row component; the primary deliverable of this task, and the file 2c/2d will extend |
| `packages/electron/src/renderer/components/AgentMode/TeammatePanel.tsx` | modify (reference only, likely no code change) | Read for its existing spinner/hollow-circle/filled-dot status-coloring convention and terminal-state persistence convention (see Requirements #5); only edit if you need to export something (e.g. the `TeammateInfo` type is already exported — verify no new export is needed before touching this file) |
| `packages/electron/src/renderer/components/UnifiedAI/SessionTranscript.tsx` | modify | Integration point — render `<SubAgentChipRow sessionId={sessionId} />` above `<SessionAIInput>` (see Requirements #1). Not in the task's originally-scoped `files_affected`; added here based on investigation of the actual chat-input parent component. |
| `packages/electron/src/renderer/components/AgentMode/__tests__/SubAgentChipRow.test.tsx` | create | Component test — existing sibling test convention is `AgentMode/__tests__/AgentReviewPanel.test.tsx`; follow the same location pattern |

### File Ownership Notes

- `TeammatePanel.tsx` is touched by tasks 1a (declares `blocked`), 2b (this task, reference only), and 2c (adds real click-to-thread wiring). Per `dependencies.md`, this is sequential by construction (2b depends on 2a which depends on 1a; 2c depends on 2b) — no real conflict, but do not make speculative edits to `TeammatePanel.tsx` beyond what's needed, since 2c lands right after this task and touches the same file.
- `SubAgentChipRow.tsx` (this task's new file) is also extended by 2c (click-to-thread for Teammate chips) and 2d (read-only popover for Task chips), both of which structurally `depends_on` this task (2d also depends on 2c). Structure the component so a chip's click handler is a clean, single seam to extend — e.g. a per-chip `onClick`/`onTeammateClick`/`onTaskClick` prop threaded from the row's props down to each chip — rather than baking "no click behavior" assumptions into the render logic in a way that's awkward to unwind. Do not build the actual click behavior yourself; just don't paint 2c/2d into a corner.
- `SessionTranscript.tsx` is a large, heavily-used file (2600+ lines) with many existing conditional render blocks in the same region you're editing (`WakeupBanner`, `McpLockdownBanner`, `PendingReviewBanner`, `FileGutter`, `PromptQueueList`). Add your one new line/block; do not restructure or reformat the surrounding blocks.

---

## Implementation Guidance

### Patterns to Follow

- **Derived-atom status pattern reference:** `packages/electron/src/renderer/store/atoms/sessions.ts:1052` (`groupSessionStatusAtom`) — this is the pattern task 2a followed to build the `SubAgentStatus` mapping this task consumes. You do not need to re-read it in depth for this task (2a already did the work), but it explains *why* the mapping is a derived read, not a stored field, if you need context on the shape you're consuming.
- **Existing sub-agent status-coloring convention to stay visually consistent with:** `TeammatePanel.tsx:342-355` (teammate icon states: spinner for `running`, hollow circle `&#x25CB;` for `idle`, filled dot `&#x25CF;` in `--nim-success`/`--nim-error` for `completed`/`errored`) and `TeammatePanel.tsx:267-277` (task icon states: spinner for running, filled dot in success/error color for `completed`/`failed`/`stopped`). Your chip row is a **new, separate component** — do not merge into or replace `TeammatePanel`/`FilesEditedSidebar` — but its five normalized states should feel like a natural evolution of this existing dot/spinner language, which the mockup's SVG icon choices already reflect (spinner for working, hollow ring for waiting, triangle for blocked, check for complete, x-circle for error).
- **Component/test file location convention:** new components under `AgentMode/` go directly in that directory; tests go in `AgentMode/__tests__/`.

### Code Style

- Match the surrounding file's existing style (Tailwind utility classes with `var(--nim-*)` arbitrary values where no canonical Tailwind class exists, per `docs/UI_PATTERNS.md`'s usage examples) — do not introduce a new styling approach (CSS modules, styled-components, etc.) for this one component.
- Ternary Tailwind classes for the five mutually-exclusive status states, not concatenated conditional fragments (see `docs/UI_PATTERNS.md`).

### Edge Cases

- A session with only Teammates and no Tasks, or vice versa, or both, or neither (empty state) — all four combinations must render correctly.
- A teammate/task whose status is one of the five normalized values you don't expect (should be impossible if 2a's exhaustiveness check holds, but do not silently render an unstyled/blank chip if it somehow happens — TypeScript's exhaustiveness check on the *consuming* side, i.e. this component's switch/ternary over the five normalized values, should also be exhaustive so a compiler error surfaces if a sixth value is ever added).
- Very long teammate/task names or many concurrent entries — this is exactly what the `@container` responsive requirement (#7) exists to handle; do not rely on manual truncation logic alone without also handling row-level wrap/scroll.

### Testing Requirements

- Add `packages/electron/src/renderer/components/AgentMode/__tests__/SubAgentChipRow.test.tsx`.
- Cover, at minimum: (a) renders `null`/nothing with zero teammates/tasks, (b) renders one chip per teammate + one chip per task when both are present, (c) each of the five normalized statuses maps to its expected visual variant (assert on the ternary-driven className or a data attribute, not on exact CSS text), (d) `_background`/`_subagent` teammate entries are filtered out (mirrors `TeammatePanel.tsx`'s existing filter).
- Per this repo's testing rules: no presentation-only assertions (exact icon SVG paths, exact pixel spacing) — assert on `className`/`data-status` and structural presence, not visual minutiae a human would notice on screen. Mock the narrowest module needed (e.g. mock the specific atoms this component reads, not the whole `@nimbalyst/runtime` barrel).
- Add `// @vitest-environment jsdom` only if the default environment for this test tree isn't already jsdom — check a sibling test file (e.g. `AgentReviewPanel.test.tsx`) for the existing convention rather than guessing.

---

## Boundaries

### Files You MUST NOT Touch

From `.nimble/config.yaml`'s global `never_touch` list:
- `package-lock.json`, `packages/browser-extension/package-lock.json`
- `.env*`
- `.github/workflows/*`
- `packages/electron/src/database/migrations/*`
- `packages/electron/src/main/database/sqlite/schemas/*`
- `node_modules/`, `**/dist/`, `packages/electron/out/`
- `nimbalyst-local/` — **this includes the approved mockup file itself** (`nimbalyst-local/mockups/agent-visibility-chip-row.mockup.html`). Read it for reference; never edit it, never copy it into the shipped tree.
- `.beads/`

PRD-specific boundaries (§11):
- Do not modify `MetaAgentMode.tsx`'s `getStatusTone`/`getBarTone` status-mapping logic (lines 67-104) — do not fold Meta-Agent Mode into this chip row or the `SubAgentStatus` mapping; explicitly out of scope.
- Do not modify `claudeCliSubAgentTracker.ts`'s transcript-hiding logic — irrelevant to this task's files, flagged here only because it's a hard project-wide boundary for the whole PRD.

### Files Requiring Review

None of this task's files (`SubAgentChipRow.tsx`, `TeammatePanel.tsx`, `SessionTranscript.tsx`) are in `.nimble/config.yaml`'s `require_review` list. This task does not trigger the PRD's human-review gate on its own — that gate is attached to task 5a (`CHANGELOG.md`, which *is* in `require_review`).

---

## Deliverables

None beyond the files above.

---

## Dependencies

### Upstream Tasks

| Task | What It Provides | Verify Before Starting |
|------|------------------|------------------------|
| 2a | Normalized `SubAgentStatus` derived mapping (`packages/electron/src/renderer/store/atoms/subAgentStatus.ts` or wherever it actually lands) covering every `TeammateInfo.status`/`TaskInfo.status` value including `blocked` | Read the actual file 2a produced and its exported names/shape before writing this component — do not assume the export name/signature described in the "Assumed Precondition" section above without checking; that section is this brief's best prediction, written before 2a ran. |
| 1a (transitive, via 2a) | `blocked` value added to `TeammateInfo.status` | Covered by 2a's own dependency verification; you don't need to re-check `TeammatePanel.tsx`'s type directly unless something looks off. |
| 1b (transitive, via 2a) | `blocked` value added to `TaskInfo.status` | Same as above, via `agentMode.ts`. |

### Downstream Impact

Tasks that depend on this one:
- **2c** — "Wire Teammate chip click-to-open-thread." Extends `SubAgentChipRow.tsx` to make Teammate chips clickable and open a real thread.
- **2d** — "Read-only status popover for Task sub-agent chips." Extends `SubAgentChipRow.tsx` to make Task chips clickable and show a `@floating-ui/react` popover. `depends_on: [2b, 2c]` — 2d runs after 2c, not in parallel with it, precisely because both extend this task's new file.

**Before starting:** Verify 2a is complete by confirming `subAgentStatus.ts` (or its actual landing location) exists, exports a working normalized-status mapping, and its own success criteria (exhaustiveness test, unit test per source status value) are met — do not build against an assumed shape without checking the real file.

---

## GitHub Context

**Issue:** Not yet created — assigned by the PM agent when this task's worktree is spawned.
**Feature Issue (Parent):** Not yet created — see note under Objective/Context above.
**Branch:** `worktree/agent-visibility-2b`
**Target:** `feature/agent-visibility` (this PRD's execution mode is `feature-branch` per `status.json`; the PM agent confirms the exact target branch at spawn time).

---

## Commit Guidelines

Use Conventional Commits:
```
feat(agent-visibility): add horizontal sub-agent status chip row

Co-Authored-By: Claude <noreply@anthropic.com>
```

Types: feat, fix, refactor, test, docs, chore

Note: this repo's own `CLAUDE.md` says not to add `Co-Authored-By` lines to commit messages in general project work — but NIMBLE's own brief template specifies this trailer for its generated task commits. If in doubt, follow whatever convention the PM agent's worktree-commit tooling actually applies; do not hand-edit commit trailers against that tooling's output.

---

## Validation Checklist

Before creating PR:
- [ ] All success criteria met
- [ ] Build passes: `npm run build`
- [ ] Type check passes: `npm run typecheck`
- [ ] No `never_touch` files modified (including `nimbalyst-local/` — the mockup was reference-only)
- [ ] Tests added/updated (`SubAgentChipRow.test.tsx`)
- [ ] Branch rebased on `feature/agent-visibility`
- [ ] `npm run test:unit` (full unit suite, per `.nimble/config.yaml`'s `commands.test`) green, plus `npm run test:prepush` per this repo's `CLAUDE.md` pre-push gate

---

*Generated by NIMBLE Brief Writer*
*PRD: agent-visibility | Task: 2b | Wave: 3*
