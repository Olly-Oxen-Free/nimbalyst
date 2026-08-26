# Pre-Orchestration Review — task-subagent-visibility

**Reviewed:** PRD_task-subagent-visibility.md, tasks.yaml, execution_plan.yaml, .execution_config.json, .nimble/config.yaml, briefs 1a/1b/1c/2a/2b/2c against live source.

**Method:** Every file:line citation in every brief was re-read from the live tree (not trusted from the brief's own text) — `ClaudeCodeProvider.ts`, `ClaudeCodeTranscriptAdapter.ts`, `toolChunkUtils.ts`, `TeammateManager.ts`, `AIService.ts`, `projectRawMessages.ts`, `preload/index.ts`, `electron.d.ts`, `MessageStreamingHandler.ts`, `agentMode.ts`, `AgentMode.tsx`, `TeammateThreadPopover.tsx`, `SubAgentChipRow.tsx`, `TeammatePanel.tsx`, `RichTranscriptView.tsx`, `CustomToolWidgets/index.ts`, `TranscriptToolWidgetContributions.ts`, `packages/runtime/package.json`, `docs/CUSTOM_TOOL_WIDGETS.md`, `electron.vite.config.ts`, `SessionTranscript.tsx`.

**Result: 0 Critical findings.** Every citation checked — line numbers, code excerpts, function names, comment text — matched the live tree exactly, including the three self-reported corrections (Q5 correlation direction, Q6 two-pass RichTranscriptView fix, electron.d.ts location) and the stale-doc warning on `docs/CUSTOM_TOOL_WIDGETS.md` step 3. This is an unusually well-verified brief set. Findings below are Warnings and Observations only.

**Clearance: PROCEED WITH CAUTION** (no blocking issues; two Warnings worth a one-line brief edit or explicit implementer awareness before wave 2 and wave 3 start).

---

## Critical Findings

None.

---

## Secondary Observations

### Warning 1 — "require_review triggers automatically" is mechanically inaccurate; the gate holds anyway

**Affected:** PRD §5 gate note, brief 1c (Context, Files Requiring Review), brief 1b (Files Requiring Review), execution_plan.yaml gate rationale, `.execution_config.json` gate condition.

**Actual state:** `.nimble/config.yaml:43-44` — `review.enabled: false`, `provider: null`, `none_behavior: manual`. No automated review provider is configured for this repo; `require_review` is a path-pattern list (`config.yaml:27-33`) with nothing wired to auto-run against it when `review.enabled` is false. `.execution_config.json`'s own `orchestration.review.note` says as much ("Falls back to the manual final_merge_gate already enabled").

**Problem:** The PRD, execution_plan.yaml, and briefs 1b/1c all describe the wave-3 gate as `require_review auto-triggers` because `MessageStreamingHandler.ts`/`AIService.ts` are under `packages/electron/src/main/**`. That framing implies an automated review bot fires and blocks. It doesn't — there is no bot. What actually enforces the pause is `.execution_config.json`'s `orchestration.gates.placements[0]` (`after_wave: 3`, `model: "pause"`), which is a separate, already-correctly-placed, human-in-the-loop stop, not a consequence of the boundary-file match.

**Net effect:** the gate is real and correctly placed — waves 4-5 cannot start without a human pause after wave 3, matching the PRD's stated intent. This is a documentation-accuracy issue, not an execution-plan defect.

**Suggested fix:** Optional, low-priority. Reword the gate rationale in the PRD and briefs 1b/1c from "require_review auto-triggers" to "this task's files match the `require_review` boundary list; enforcement is via the explicit `gates.placements` pause configured after wave 3" — so an implementer reading the brief doesn't go looking for a review-bot comment that will never appear.

### Warning 2 — Option B's `taskId`-keyed lookup path in 1b has an unstated translation step

**Affected:** Brief 1b (Research Context "Projection function", Requirements, Edge Cases), tasks.yaml task 1b.

**Actual state:** Under Option A, both `_taskId` and `_taskToolUseId` are written into the tagged row, so 1b's dual-key lookup is a direct tag match either way. Under Option B, the persisted raw chunk only carries `parent_tool_use_id` (verified: `ClaudeCodeProvider.ts:1301-1318`, `toolChunkUtils.ts` slimming does not touch this field) — there is no `task_id` anywhere in the raw row. A `toolUseId`-keyed call resolves directly by matching `parent_tool_use_id`. A `taskId`-keyed call (needed for 2c's tiles, which have `taskId` but not `toolUseId` — see 2c brief, Upstream Tasks) has no direct match target in the raw chunk shape at all; it requires first resolving `taskId → toolUseId` via `activeTasks`/`session.metadata.currentTasks` (confirmed live: `TaskInfo.toolUseId?: string` at `agentMode.ts:251`, populated from `activeTasks` and persisted via `currentTasks: Array.from(this.activeTasks.values())` at `ClaudeCodeProvider.ts:3086`), then filtering raw rows by that resolved `toolUseId`.

**Problem:** Brief 1b's description of the Option B filter path ("matching `parent_tool_use_id` directly in the generic raw chunk shape... then adapt/reuse `projectRawMessagesToViewMessages`") reads as if both lookup keys are handled by the same direct match. It doesn't name the extra taskId→toolUseId indirection step, or its data source (`session.metadata.currentTasks`, which the IPC handler already has access to via `AISessionsRepository.get(sessionId)`). An implementer following the brief literally could get partway through Option B's `taskId` path before realizing there's nothing to match on and have to re-derive the resolution step from scratch. Also worth flagging: `TaskInfo.toolUseId` is typed optional — a race where a task's `activeTasks` entry hasn't yet received `toolUseId` (before `task_started` fully lands) means the `taskId`-keyed lookup would need to handle "task known, toolUseId not yet available" as its own not-quite-empty-array edge case, distinct from "unknown taskId entirely."

**Suggested fix:** Add one sentence to brief 1b's "Projection function" section, conditional on Option B: "the `taskId`-keyed path has no direct match in the raw chunk shape; resolve `taskId → toolUseId` via the session's `metadata.currentTasks` (already fetched via `AISessionsRepository.get(sessionId)` in the handler) before filtering, and treat a task with no `toolUseId` yet as an empty-array case, not an error."

---

### Observations

1. **Q5 correlation direction is genuinely correct, not just re-asserted.** `markTaskBlockedForToolUse` (`ClaudeCodeProvider.ts:3890-3897`) independently proves the value-space/key-space distinction the brief claims: it resolves a value out of `subagentToolCallOwners` by key, then matches that value against `activeTasks[*].toolUseId` — exactly the pattern 1a's brief says is correct and `subagentToolCallOwners` is not. No correction needed.

2. **Q7 (the Option A/B fork) is genuinely left open, not pre-answered.** Brief 1a presents both options with full context and says "pick based on what actually works cleanly... don't guess from this description alone" — it does not steer toward one option in its Success Criteria or Deliverables, both of which are worded option-neutral ("via the mechanism chosen"). Confirmed against the PRD's own Q7 text, which says the same.

3. **2b's RichTranscriptView.tsx guard is correctly scoped and minimal.** Verified live at `RichTranscriptView.tsx:1755-1764`: `isSubAgent`/`isTeammate` are already computed before the `CustomWidget` resolution (no "move the resolution" is actually needed, exactly as the brief's own correction notes), and the only required edit is adding `&& !(isSubAgent && isTeammate)` to the existing `if (CustomWidget)` check at line 1764. This cannot affect any non-`Task` tool's widget resolution, since the added clause only ever evaluates true/false based on `isSubAgent`/`isTeammate`, both of which are `false` for every non-Task, non-subagent tool call.

4. **2b's widget fully replaces, not supplements, the existing subagent/teammate card's information for plain Task spawns.** The existing card (unchanged code, ~lines 1816-2042) shows name, mode, live status, model, description, prompt, and child events for a subagent spawn. None of 2b's success criteria require `TaskToolWidget` to preserve that same information set — only that it renders in place of the generic tool card and supports expand/collapse. This is very likely intentional (the PRD's "Done looks like" section describes the live transcript as the replacement experience), but it is not stated as a deliberate design choice anywhere in brief 2b, so an implementer or reviewer could reasonably ask whether the existing card's summary fields (mode, model, description) should be folded into the new widget's collapsed state the way 2a's brief explicitly requires for `TaskStatusPopover`'s fields. Worth a one-line implementer note, not a brief correction.

5. **Recursive widget rendering (depth-2+ Task spawning message inside a parent's popover/inline-expand) means each nested `TaskToolWidget`/`TaskThreadPopover` fires its own independent fetch and its own debounce-refetch subscription.** Both 2a and 2b's briefs correctly call this "expected, not a bug to suppress," but neither flags the fetch-fanout implication (N nested widgets open concurrently means N independent `ai:getTaskSubagentTranscript` calls plus N live-signal subscriptions). Not a blocking concern at this feature's expected scale (per PRD's own volume framing, nesting is rare relative to top-level dispatch), but worth a short implementer-facing note so it isn't mistaken for a bug during 2b's testing.

6. **2c's "no split-pane library exists in this repo" claim is confirmed accurate** — a repo-wide `package.json` grep for `react-resizable-panels`, `allotment`, `SplitPane`, and `react-split` returns nothing. The from-scratch CSS approach is correctly framed as the only existing option, not a stated preference dressed up as a constraint.

7. **1c's live-signal chain does not require touching `preload/index.ts`, despite the brief's conditional "may finish the preload surface begun in 1b" language.** `window.electronAPI.on` is a fully generic IPC-channel passthrough (`preload/index.ts:2252`, `on: subscribeToIpcChannel`, itself a generic `(channel, callback) => …` wrapper with no channel whitelist — confirmed in `packages/electron/src/preload/ipcSubscriptions.ts:30-49`). `teammate:transcript-updated` itself has no dedicated preload entry, proving the pattern already works generically. 1c's `task:transcript-updated` needs no preload change to function; the brief's hedged "if any additional typed listener registration is needed" language is accurate hedging, not a gap — downgraded from a possible Warning to this observation after checking the actual mechanism.

8. **File-boundary and wave-ordering claims all check out against tasks.yaml/execution_plan.yaml.** 1a→1b→1c is genuinely fully sequential with no false dependency; 2a/2b are genuinely file-disjoint (`SubAgentChipRow.tsx`/`TeammatePanel.tsx` vs. `RichTranscriptView.tsx`/`TaskToolWidget.tsx`/`AgentMode.tsx`) and share no hidden coupling beyond both reading 1b/1c's outputs, which is the intended fan-out; 2c's dependency on 2a (not just 1b/1c) is justified by a real file overlap (`SubAgentChipRow.tsx`, `TeammatePanel.tsx`) rather than an invented one — 2a's brief explicitly leaves `onTaskClick?.(entry.id)` unconsumed specifically for 2c to wire, and 2c's brief correctly treats its own edits there as additive, not a rework of 2a's hover logic.

9. **The gate-after-wave-3 placement is enforceable as designed** despite Warning 1's wording issue: `.execution_config.json`'s `orchestration.gates.model: "pause"` with an explicit `placements[0].after_wave: 3` entry is a hard stop independent of whether any automated review tool exists. Waves 4-5 cannot start without that pause resolving.

10. **All six briefs carry a `## Deliverables` section with path + falsifiable done-when conditions** (e.g. 1a: "Unit test asserts correct correlation... regardless of which option was chosen"; 2c: "Component test covers open/multi-tile-concurrent/main-thread-priority/stay-open-on-completion... a human manually verifies the visual layout matches the approved mockup"). No brief has a missing or vague Deliverables section.

---

## Correction Summary

| # | Severity | Brief(s) | Suggested correction |
|---|----------|----------|----------------------|
| 1 | Warning | PRD §5, briefs 1b/1c, execution_plan.yaml | Reword "require_review auto-triggers" to name the actual enforcement mechanism (`gates.placements` pause), since `review.enabled: false` in config.yaml means no automated reviewer exists to trigger. No change to gate placement or wave order needed. |
| 2 | Warning | brief 1b | Add a sentence to the Option B projection description naming the `taskId → toolUseId` resolution step (via `session.metadata.currentTasks`, already available in the handler) and the "task known but toolUseId not yet set" edge case, so the `taskId`-keyed lookup path isn't discovered as a gap mid-implementation. |

No corrections needed for briefs 2a, 2b, or 2c's file boundaries, success criteria, or scope framing — all verified accurate against live source.

---

## Execution Clearance

**PROCEED WITH CAUTION.**

Zero Critical findings; the codebase claims underlying every brief — including the three self-reported corrections (Q5, Q6, electron.d.ts location) — were independently re-verified against live source and are accurate. The two Warnings above do not block execution: the gate is correctly placed regardless of its stated rationale's wording, and 1b's Option B gap is a documentation completeness issue an implementer following the brief's own "read 1a's landed diff" step would likely surface on their own — but naming it now avoids rediscovery cost during wave 2.
