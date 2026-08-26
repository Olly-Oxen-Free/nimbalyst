# Task Brief: 2b

**Title:** Inline expand via the custom tool-widget registry, scoped to exclude teammates
**PRD:** task-subagent-visibility
**Priority:** must
**Complexity:** 6/10
**Model:** opus
**Wave:** 4
**Feature Issue:** N/A (no GitHub issue tracking configured for this PRD at brief-generation time)

---

## Objective

Make the assistant message that spawned a plain Task sub-agent expand inline into its live
transcript when clicked — the second of three presentation surfaces — via the existing
custom tool-widget registry, **without breaking how a teammate-spawn message renders**,
since teammates are also spawned via the `Task` tool and share the exact same registry call
site.

---

## Context

**Parent Feature:** Task Sub-Agent Live Transcript Visibility (task-subagent-visibility)

This task is the riskiest single piece of UI work in this PRD from a regression standpoint.
It went through **two separate PRD review corrections** before this brief was written (PRD
§6 Q6, quoted in full below) — read that section before writing any code, not just this
brief's summary of it.

This task is part of **Wave 4** — depends on tasks 1b (fetch) and 1c (live signal), both
complete. It runs alongside task 2a in the same wave, file-disjoint from it (this task
touches `RichTranscriptView.tsx`, a new `TaskToolWidget.tsx`, and `AgentMode.tsx`; 2a
touches `SubAgentChipRow.tsx`/`TeammatePanel.tsx`).

**This task lands after the PRD's wave-3 gate.** Confirm the gate's `require_review`
completed before starting.

---

## Research Context — the two corrections you must not re-introduce

Quoted directly from the PRD (§6 Q6), because getting this wrong is the single most likely
way this task fails review:

> How should the inline-expand widget (task 2b) avoid a package-layering violation while
> also not breaking teammate rendering? **First correction:** an earlier draft imported a
> new `packages/electron` component directly into `packages/runtime`'s
> `RichTranscriptView.tsx` — a layering violation (`runtime` has no dependency on
> `electron`). Corrected to use the existing dynamic tool-widget contribution registry
> (`setTranscriptToolWidgets` et al.), self-registered from the electron side. **Second
> correction**, found on the follow-up review of that fix: since teammates are *also*
> spawned via the `Task` tool and render through the *same* `getCustomToolWidget`/registry
> call site — which returns unconditionally, before any teammate-specific rendering logic
> runs — a bare `'Task'`-keyed widget registration would have silently blanked out the
> existing teammate card for every teammate spawn. **Final resolution:** a small, explicit,
> narrowly-scoped change *is* needed in `RichTranscriptView.tsx` (gate the widget lookup on
> `!(isSubAgent && isTeammate)`), which is not the layering violation the first correction
> ruled out — it is a one-line conditional inside a file `runtime` already owns, not a new
> cross-package import.

Two failure modes to avoid, both already tried and rejected during PRD review:
1. **Do not** import an electron-side component into `packages/runtime` — this is a real
   package-layering violation (`runtime` must work standalone for mobile too, per
   `packages/runtime/CLAUDE.md`'s "Package Placement" guidance).
2. **Do not** register a widget bare for `'Task'` and stop there — this silently blanks the
   existing teammate spawn card for every teammate, a real regression that was only caught
   on a *second* review pass, not the first. Your own testing must catch this explicitly,
   not rely on a code read.

### Verified live: the exact call site you're modifying

`RichTranscriptView.tsx`, verified live at
`packages/runtime/src/ui/AgentTranscript/components/RichTranscriptView.tsx:1755-1784`:

```tsx
const isSubAgent = toolMsg.type === 'subagent';                                    // line 1755
const isTeammate = isSubAgent && !!(toolMsg.subagent?.teammateName || toolMsg.subagent?.teamName); // line 1756
const hasChildren = isSubAgent && toolMsg.subagent?.childEvents && toolMsg.subagent.childEvents.length > 0; // line 1757
const lazyDiffLoader = tool.providerToolCallId && loadToolCallDiffs
  ? () => loadToolCallDiffs(tool.providerToolCallId!, toolMsg.createdAt?.getTime())
  : undefined;

// Check for custom widget first
const CustomWidget = tool.toolName ? getCustomToolWidget(tool.toolName) : undefined;  // line 1763
if (CustomWidget) {                                                                    // line 1764
  return (
    <div ...>
      <ToolWidgetErrorBoundary toolName={tool.toolName}>
        <CustomWidget
          message={toolMsg}
          isExpanded={isExpanded}
          onToggle={() => toggleToolExpand(toolId)}
          workspacePath={workspacePath}
          sessionId={sessionId}
          readFile={readFile}
          loadToolCallDiffs={lazyDiffLoader}
        />
      </ToolWidgetErrorBoundary>
    </div>
  );
}
```

**Note the actual code order, precisely** (verified live, do not trust a paraphrase): the
PRD's task description says to "move the `const CustomWidget = ...` resolution to AFTER
isSubAgent/isTeammate are computed (they already are, lines 1755-1757)" — this parenthetical
is the accurate framing. `isSubAgent`/`isTeammate` are *already positioned* before the
`CustomWidget` resolution in the current file (1755-1757 precede 1763). Nothing needs to
physically move. **The actual required change is narrower than "move the resolution": add
the guard condition to the existing `if (CustomWidget)` check at line 1764**, so it reads
something like `if (CustomWidget && !(isSubAgent && isTeammate))`. Every other tool name's
widget resolution (e.g. `capture_editor_screenshot`) is completely unaffected by this
change, since the condition only ever excludes the teammate-spawn-`Task` case.

**Confirmed live** that teammates are also spawned via the `Task` tool:
`TeammateManager.ts:2209` — `if (toolName === 'Task' && toolInput?.team_name &&
toolInput?.name) { ... }`. This is why the bare-`'Task'`-registration failure mode is real,
not theoretical.

### The actual registration mechanism — verified live, confirms the PRD's citation

`getCustomToolWidget` (imported at `RichTranscriptView.tsx:20` from
`./CustomToolWidgets`) internally calls `getTranscriptToolWidget` (the dynamic contribution
registry function) **first**, before falling back to the static
`BUILT_IN_TOOL_WIDGETS`/`CUSTOM_TOOL_WIDGETS` map — verified at
`packages/runtime/src/ui/AgentTranscript/components/CustomToolWidgets/index.ts:265-266`.
This confirms `setTranscriptToolWidgets` (in
`packages/runtime/src/ui/AgentTranscript/contributions/TranscriptToolWidgetContributions.ts`,
re-exported via `packages/runtime/src/ui/AgentTranscript/contributions/index.ts`) is the
correct registration point — it is consulted before the static registry, so your
electron-side registration will actually take effect without touching the static map at
all.

```ts
export function setTranscriptToolWidgets(
  source: string,
  next?: TranscriptToolWidgetRegistry,
): void {
  if (!source) throw new Error('setTranscriptToolWidgets requires a non-empty source');
  if (!next) { clearTranscriptToolWidgets(source); return; }
  contributionsBySource.set(source, next);
  invalidateCache();
  notifyListeners();
}
```

Call it once, from `AgentMode.tsx`, with a stable `source` string identifying this feature
(e.g. `'task-subagent-visibility'`), passing `{ Task: TaskToolWidget }` as the registry.
Import path: `@nimbalyst/runtime/ui/AgentTranscript` — verified live in
`packages/runtime/package.json` this subpath exists (`./ui/AgentTranscript` →
`./dist/ui/AgentTranscript/index.js`); do not import from a deeper internal path, since the
electron Vite config's production module resolution only rewrites `@nimbalyst/runtime/
<subpath>` for subpaths with their own package-exports entry.

### Note: `docs/CUSTOM_TOOL_WIDGETS.md` is partially stale — do not follow it literally

That doc (read in full during brief verification) documents the *older*, static-registry
mechanism (`CUSTOM_TOOL_WIDGETS` map edited directly in `CustomToolWidgets/index.ts`), not
the dynamic `setTranscriptToolWidgets` contribution registry this task must use. It is
useful for the `CustomToolWidgetProps` shape (mostly accurate, though it's missing
`sessionId`/`readFile`/`loadToolCallDiffs` — the real interface, verified live at
`CustomToolWidgets/index.ts:71-88`, has all seven props listed below) but **do not follow
its "Register the widget" step 3** — that would put you back in the first-correction failure
mode (a static electron-unaware registration that can't gate on `isSubAgent`/`isTeammate`
at all, since that gating lives in `RichTranscriptView.tsx` itself, not in the widget
registry).

Verified live, the real `CustomToolWidgetProps` interface
(`packages/runtime/src/ui/AgentTranscript/components/CustomToolWidgets/index.ts:71-88`):

```ts
export interface CustomToolWidgetProps {
  message: TranscriptViewMessage;
  isExpanded: boolean;
  onToggle: () => void;
  workspacePath?: string;
  sessionId: string;
  readFile?: (filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>;
  loadToolCallDiffs?: () => Promise<ToolCallDiffLoadResult>;
}
```

The `isExpanded`/`onToggle` props ARE the accordion mechanism for your widget — no separate
expand-state plumbing needed; `RichTranscriptView.tsx` already manages `expandedTools` state
and calls `toggleToolExpand(toolId)` for you.

### Recommended Approach

Your widget has access to `message.toolCall.providerToolCallId` (the Task tool_use id) and
`sessionId`, but NOT a `taskId` directly. Call
`ai:getTaskSubagentTranscript(sessionId, { toolUseId: providerToolCallId }, workspacePath)`
(task 1b's `toolUseId`-keyed lookup path exists specifically for this widget). Do not try to
derive a `taskId` some other way.

Register the widget once at startup from `AgentMode.tsx`, alongside the
`initTaskTranscriptListeners()` call task 1c already adds there — both land in
`AgentMode.tsx` (sequenced after 1c, not a same-wave conflict since this task
`depends_on` 1c).

A depth-2+ Task sub-agent's own spawning message, if surfaced inside a parent task's
transcript (via the popover from task 2a or this task's own inline-expand), will render
through this same widget recursively. This is expected and acceptable, not a bug to
suppress — do not special-case nested rendering to prevent it.

---

## Requirements

Fulfills R6 ("Inline expand, teammate-safe").

- A widget registered for the `'Task'` tool name via the existing tool-widget contribution
  registry renders in place of the generic tool card for a plain Task sub-agent's spawning
  message ONLY.
- A teammate-spawn `Task` message (`isSubAgent && isTeammate`) must continue rendering
  through its existing card, requiring a narrow, explicit exclusion in
  `RichTranscriptView.tsx`.
- Every other tool name's widget resolution is completely unaffected.

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] A plain Task sub-agent's spawning message (`isSubAgent && !isTeammate`) renders via the
      new `TaskToolWidget`, registered through `setTranscriptToolWidgets` for the `'Task'`
      tool name
- [ ] A teammate-spawn `Task` message (`isSubAgent && isTeammate`) renders via the EXISTING
      subagent/teammate card in `RichTranscriptView.tsx`, completely unchanged — this is the
      primary regression this task must not introduce, and needs an explicit test, not just
      a code read
- [ ] Every other tool_use message type (non-`Task`) is unaffected by the
      `RichTranscriptView.tsx` change — registry lookup and rendering for e.g.
      `capture_editor_screenshot` is identical to before
- [ ] Clicking the widget toggles `isExpanded`/`onToggle`, expanding the transcript inline
      beneath the message; a second click collapses it
- [ ] The widget fetches via `toolUseId` (`message.toolCall.providerToolCallId`), not a
      `taskId` it doesn't have
- [ ] Widget registration happens exactly once at startup (`AgentMode.tsx`), imported from
      `@nimbalyst/runtime/ui/AgentTranscript`, not per-render or per-component-mount

**All criteria must pass before task is complete.**

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/runtime/src/ui/AgentTranscript/components/RichTranscriptView.tsx` | modify | Narrow `!(isSubAgent && isTeammate)` gate added to the existing `if (CustomWidget)` check at line 1764 — this is the ONLY change in this file |
| `packages/electron/src/renderer/components/AgentMode/TaskToolWidget.tsx` | create | New widget component using the `CustomToolWidgetProps` contract |
| `packages/electron/src/renderer/components/AgentMode/AgentMode.tsx` | modify | One-time `setTranscriptToolWidgets` registration call, alongside the `initTaskTranscriptListeners()` call from task 1c |

### File Ownership Notes

`RichTranscriptView.tsx` is touched by no other task in this PRD — a narrow, isolated
addition. `AgentMode.tsx` is also touched by task 1c (already landed by the time this task
starts, since this task `depends_on` 1c) — disjoint additions to the same file, no conflict.

---

## Implementation Guidance

### Patterns to Follow

Look at any existing widget under
`packages/runtime/src/ui/AgentTranscript/components/CustomToolWidgets/` (e.g.
`EditorScreenshotWidget.tsx`) for the general shape of a widget component, but note that all
of those live in `packages/runtime` and are statically registered in that package's own
`CustomToolWidgets/index.ts` — your widget is different: it lives in `packages/electron`
(it needs electron-only IPC access via `window.electronAPI`) and self-registers dynamically
via `setTranscriptToolWidgets` from `AgentMode.tsx`, per the corrected Q6 design. Do not
place your widget file under `packages/runtime`.

### Code Style

Match `TeammateThreadPopover.tsx`'s / `TaskThreadPopover.tsx`'s (task 2a) fetch pattern for
consistency across this PRD's two consumers of `ai:getTaskSubagentTranscript` — same
`fetchGenerationRef` guard against out-of-order responses, same debounce-refetch shape on
the 1c signal atom if the widget stays expanded across new content arriving.

### Edge Cases

- Widget rendered for a Task sub-agent that has already completed by the time the user
  expands it — must still fetch and show whatever transcript exists, not assume "live"
  implies "still running."
- Nested (depth-2+) Task sub-agent spawning messages rendering the same widget recursively —
  expected, not a bug (see Recommended Approach above).
- A `providerToolCallId` that doesn't resolve to any known task (race, or a non-Task-tool
  message that somehow reaches this widget) — the widget should degrade gracefully (empty
  state), not crash; `ai:getTaskSubagentTranscript` already returns `[]` for unknown keys
  per task 1b's contract.

### Testing Requirements

Test suite covers, per the success criteria: plain-Task-sub-agent renders new widget;
teammate-spawn Task renders unchanged existing card (**write this test explicitly** — it is
the regression the PRD's own review process only caught on a second pass, so do not treat a
code read as sufficient); non-Task tools unaffected; expand/collapse toggle;
one-time registration.

---

## Boundaries

### Files You MUST NOT Touch

- No other file in `packages/runtime/src/ui/AgentTranscript/` beyond the one narrow line
  change in `RichTranscriptView.tsx` — do not touch the existing subagent/teammate card's
  own rendering code (lines ~1816-2042 per the verified read), only the gate at line 1764.
- Any Agent Teams / teammate code path, including `TeammateManager.ts`.
- Do not import any `packages/electron` component into `packages/runtime` — this is the
  exact layering violation Q6's first correction already rejected.

### Files Requiring Review

None of this task's files are under `packages/electron/src/main/**`. `RichTranscriptView.tsx`
is shared, high-traffic UI infrastructure in `packages/runtime` — treat the single-line
change there with the precision this brief describes; a broader change here is itself a
signal something has gone wrong relative to this task's scope.

---

## Dependencies

### Upstream Tasks

| Task | What It Provides | Verify Before Starting |
|------|------------------|------------------------|
| 1b | `ai:getTaskSubagentTranscript`, keyable by `toolUseId` | Confirm the `toolUseId`-only lookup path works — this widget has no other identifier available |
| 1c | `task:transcript-updated` live signal | Confirm the atom bumps correctly if this widget's expanded state needs to stay live |

### Downstream Impact

None within this PRD — this is a leaf UI surface. No other task depends on
`TaskToolWidget.tsx`.

**Before starting:** Confirm 1b and 1c are both merged and the wave-3 review gate has
closed.

---

## Deliverables

| Artifact | Path | Done when |
|---|---|---|
| Narrow `isTeammate`-exclusion fix in `RichTranscriptView.tsx` + `TaskToolWidget.tsx`, registered via `setTranscriptToolWidgets` | `packages/runtime/src/ui/AgentTranscript/components/RichTranscriptView.tsx` | Test suite covers: plain-Task-sub-agent renders new widget; teammate-spawn Task renders unchanged existing card; non-Task tools unaffected; expand/collapse toggle; one-time registration |

---

## GitHub Context

**Issue:** N/A — no GitHub issue configured for this PRD at brief-generation time
**Feature Issue (Parent):** N/A
**Branch:** `worktree/task-subagent-visibility-2b`
**Target:** Determined by PM agent based on execution mode (feature branch or main)

---

## Commit Guidelines

Use Conventional Commits:
```
feat(agent-mode): add inline-expand widget for Task sub-agent spawn messages
```

Types: feat, fix, refactor, test, docs, chore

---

## Validation Checklist

Before considering this task done:
- [ ] All success criteria met
- [ ] Typecheck passes: `npm run typecheck` (repo root)
- [ ] Test suite passes, including the explicit teammate-unaffected regression test
- [ ] No broader changes to `RichTranscriptView.tsx` beyond the single narrow gate
- [ ] No `packages/electron` import added to `packages/runtime`
- [ ] Tests added/updated
- [ ] Branch rebased on target branch (feature branch or main)

---

*Generated by NIMBLE Brief Writer*
*PRD: task-subagent-visibility | Task: 2b | Wave: 4*
