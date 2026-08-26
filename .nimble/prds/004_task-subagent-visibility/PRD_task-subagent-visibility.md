# PRD Template (v2)

```yaml
---
feature_name: "Task Sub-Agent Live Transcript Visibility"
feature_slug: "task-subagent-visibility"
owner: "jeppcohen@gmail.com"
status: "draft"
created_date: "2026-08-26"
target_date: ""
phase: ""
scope_type: "new feature"
github_project: ""
links: [".nimble/prds/002_teammate-thread-view", ".nimble/prds/003_teammate-resume-reliability"]
checkpoint_refs: ["002_teammate-thread-view", "003_teammate-resume-reliability"]
cross_feature_blockers: []
---
```

---

## 1. Executive Summary

**One-liner:** Task-tool sub-agents (the model's default, anonymous `Task`/`Agent` dispatch) get a
real live transcript — hover peek, inline expand, and a tiling pane — instead of today's static
status-only popover, reusing the exact backend pattern PRD 002 built for teammates.

**What's changing:** Clicking a Task-kind chip today opens `TaskStatusPopover` — label, status,
active tool name, nothing else. Sub-agent text is currently produced by the SDK
(`forwardSubagentText: true`, enabled this session for teammates); whether it needs a new tagged
persistence write or is already durably stored and only needs correlation on read is an open
implementation fork (task 1a, §6 Q7) — either way, it reaches the renderer correlated to its owning
task by matching `parentToolUseId` directly against `activeTasks[*].toolUseId` (see task 1a — an
earlier draft of this PRD proposed the wrong lookup direction through `subagentToolCallOwners`,
corrected during PRD review, §6 Q5), and is surfaced through three distinct triggers: hovering a
chip (inline or in the Sub-agents sidebar list) opens a lightweight read-only popover; clicking the
assistant message that spawned the task (rendered via the existing custom-tool-widget registry,
narrowly scoped so teammate-spawn messages are untouched, §6 Q6) expands the transcript inline,
accordion-style; clicking the chip itself opens a tiling pane beside the main thread, with multiple
tiles supported side by side.

**Who it's for:** Anyone running Agent Mode — Task-tool dispatch is the model's default delegation
mechanism, used far more often per session than named teammates.

**Done looks like:** Spawn a Task sub-agent. Hover its chip — see its live text stream in a
popover. Click the spawning message — see the same transcript expand inline beneath it, without
teammate-spawn messages changing appearance. Click the chip — a tiled pane opens beside the main
thread, and a second concurrent task's chip opens a second tile alongside the first.

**Primary risk:** Volume, if task 1a resolves its persistence fork toward a new tagged write
(Option A) rather than projecting already-stored raw rows (Option B) — Task sub-agents fire far
more often than teammates in a session, so a second copy of their text in `ai_agent_messages` risks
measurably faster table growth than Option B, which adds no new rows at all. Named as a
Should-level mitigation in task 1a, not a blocker either way.

---

## 2. Problem & Context

**Problem statement:** Nimbalyst's Agent Mode has two independent multi-agent systems. Teammates
(named, addressable, under Agent Teams) have full visibility as of PRD 002: a chip, a live
transcript popover, a stop control, resume reliability (PRD 003). Task-tool sub-agents — the
model's default, unnamed `Task`/`Agent` dispatch — get a chip too, but it opens only
`TaskStatusPopover`, fed entirely from `activeTasks` metadata (status, active tool name, tool
count). No transcript. The user has no way to read what a Task sub-agent actually said or did,
which PRD 002 explicitly deferred as a non-goal ("Task chips stay read-only. Separate product
decision, not revisited here.") This PRD is that decision.

**Supporting data / evidence:** Full trace in `research/internal/findings.md` and
`research/external/findings.md`, verified against live source (not memory) in the same session,
and re-verified twice during PRD review (§6 Q5-Q8). Key facts: (1) `forwardSubagentText` is already
enabled and already forwarding Task sub-agent text through the lead's own async iterator; (2)
`ClaudeCodeProvider.ts:1300-1318` persists the raw, unparsed SDK chunk for essentially every
non-transient chunk (filtered only by `isTransientClaudeCodeChunk`, which checks `type`/`subtype`,
never `parent_tool_use_id`) — meaning a sub-agent's raw chunk, `parent_tool_use_id` field intact
(confirmed not stripped by `slimClaudeCodeChunkForStorage`), is plausibly *already* durably stored
before `ClaudeCodeTranscriptAdapter.ts:233`'s drop guard ever runs; that guard only prevents the
LEAD's own *parsed/rendered* transcript from showing the text, which is correct and unrelated to
whether the text is retrievable at all (§6 Q7 — this reframes task 1a's actual scope, and possibly
its need to exist as a separate provider-side write task); (3) `activeTasks[*].toolUseId` (set at
`ClaudeCodeProvider.ts:2904`) already equals the forwarded chunk's `parentToolUseId` for the owning
task, at every depth — `markTaskBlockedForToolUse` (`ClaudeCodeProvider.ts:3890-3902`) already
relies on this exact equivalence in shipped code, just entered from the opposite direction (via
`subagentToolCallOwners`'s value, not applicable here — see §6 Q5); (4) Task-chip *metadata*
already persists across restart via the same `metadata.currentTasks` mechanism PRD 002 built for
teammates; (5) `RichTranscriptView.tsx`'s `renderToolCard` resolves a custom widget purely by tool
*name* (`getCustomToolWidget(tool.toolName)`, unconditional early-return at line 1764, before any
`isSubAgent`/`isTeammate` branching) — since teammates are *also* spawned via the `Task` tool
(`TeammateManager.ts:2209` matches on `toolName === 'Task' && toolInput?.team_name`), a widget
registered bare for `'Task'` would intercept and blank out the existing teammate/sub-agent card,
not just plain Task sub-agents — this is a real regression risk this PRD must design around, not
an edge case to discover later (§6 Q6, corrected from an earlier PRD-review pass that missed it).

**What happens if we don't build this:** The trust gap PRD 002 closed for teammates stays open for
the far more common case — Task sub-agents are what the model dispatches by default. Users watching
a chip sit at "working" with no visible output have no way to tell whether it's making progress or
stuck, for the majority of sub-agent activity in a session.

**Strategic fit:** Direct continuation of PRD 002's visibility work, applied to the other half of
Nimbalyst's multi-agent surface. Backend is a near-total reuse of PRD 002's IPC/projection/live-
signal pattern; the three presentation surfaces (hover popover, inline expand, tiling pane) were
scoped and approved against user-reviewed mockups before this interview began.

**Explicitly out of scope:**
- SDK hook adoption (`SubagentStop`/`TaskCompleted`) — structurally can't observe a sub-agent
  process that dies before/at spawn, confirmed in PRD 003's research; irrelevant here anyway since
  this feature is about content, not liveness detection.
- Any change to Agent Teams / teammate code paths, including their rendering. Teammate spawn
  messages must render exactly as they do today — see task 2b's explicit exclusion of the teammate
  case.
- Reply/send capability and a stop control — Task sub-agents are one-shot, not addressable the way
  teammates are; there is no mechanism to message or interrupt one mid-flight.
- A general docking/window-management framework for the tiling surface — purpose-built minimal
  tiling for this feature only (see task 2c), not a reusable pane system.
- A visual hierarchy/nesting indicator for depth-2+ sub-agents — nested tasks already get their own
  flat `activeTasks` entry and chip today (confirmed live: `handleSystemTask` keys purely on
  `task_id`, no depth field); this PRD's per-`taskId` transcript mechanism covers them for free via
  the same chip, with no tree/nesting UI added. A depth-2 task's spawning message rendering the same
  new widget recursively (popover/inline-expand showing its own nested Task widget) is expected and
  acceptable, not a bug to suppress.
- A dedicated "view transcript after restart" entry point. See the note in §3 on the persistence
  side effect.

---

## 3. Goals, Non-Goals & Success Metrics

### Goals

1. Task sub-agent text (assistant text/thinking, already forwarded by the SDK) is retrievable by
   the renderer, correlated to the correct `activeTasks` entry by matching `parentToolUseId`
   directly against `activeTasks[*].toolUseId`, without a new copy of it existing in
   `ai_agent_messages` unless the implementation fork in task 1a determines that's genuinely
   necessary.
2. Hovering a Task chip (inline in the transcript, or its row in the Sub-agents sidebar list)
   shows a lightweight, auto-dismissing, read-only popover with the live transcript.
3. Clicking the assistant message that spawned a Task sub-agent — rendered via the existing custom
   tool-widget registry, visually distinct from the generic tool-call bubble — expands the same
   transcript inline, accordion-style, beneath that message, WITHOUT affecting how a teammate-spawn
   message (also a `Task` tool_use) renders.
4. Clicking the chip itself (inline or sidebar) opens a tiled pane beside the main thread; the main
   thread keeps height/width priority; multiple tiles can be open concurrently, side by side.
5. All three surfaces read from one shared backend (IPC fetch + live-update signal), each built
   once and consumed three ways — not three independent data paths.

### Non-Goals

- Persisted, restart-survivable transcript *as a designed feature*. If task 1a's fork resolves
  toward a new tagged write (Option A), it uses `ClaudeCodeProvider.logAgentMessageNonBlocking`,
  the same method and call shape `TeammateManager` uses for teammates; if it resolves toward
  projecting already-persisted raw rows (Option B), no new write is added at all. Either way,
  because a task's `activeTasks` entry (metadata) already persists and its chip already survives
  restart today, the transcript will, as an emergent side effect, also technically be retrievable
  after restart. This PRD does not build UI, tests, or user-facing promises around that side
  effect — no "history" affordance, no restart-recovery messaging. If it needs to become an
  intentional feature later, that's separate scope.
- Reply, resume, or stop for a Task sub-agent.
- Changes to `TeammateThreadPopover`, `TeammateManager`, or any Agent-Teams code path, or to how a
  teammate-spawn message renders in the transcript.
- A general-purpose tiling/docking system, drag-to-rearrange, or cross-session pane-layout
  persistence.
- A visual nesting/hierarchy indicator for depth-2+ sub-agents.

### Success Metrics

| Metric | Baseline | Target | How Measured |
| ------ | -------- | ------ | ------------ |
| Task sub-agent text reaching the renderer | 0% (not fetchable by taskId today) | 100% of forwarded text/thinking chunks | Unit test: a chunk with `parentToolUseId` matching a known `activeTasks[*].toolUseId` is retrievable via `ai:getTaskSubagentTranscript` and is excluded from the lead's own projected transcript |
| Hover-to-popover latency | N/A (feature doesn't exist) | Popover shows content within the existing debounce window used by `TeammateThreadPopover` (1.5s refetch) | Manual verification + existing popover pattern reuse (no new latency budget invented) |
| Teammate-spawn message rendering | Unaffected today | Unaffected after this PRD ships | Regression test: a teammate-spawn `Task` tool_use message renders via the existing subagent/teammate card, not the new widget |
| Chip → tile open, N concurrent | N/A | 2+ tiles open side by side without one displacing the other or the main thread losing size priority | Manual E2E gate (task 2c, see §5 gate note) |
| Regression on teammate paths | N/A | 0 | Existing teammate test suites unchanged and green |

---

## 4. Requirements

### Must Have (blocks launch)

| ID | Requirement | Acceptance Criteria |
| -- | ----------- | -------------------- |
| R1 | Task sub-agent text is retrievable, correlated correctly | Given a `taskId` (or the task's `toolUseId`), the backend can return that task's forwarded text/thinking, correlated by matching `parentToolUseId` against `activeTasks[*].toolUseId` — whether via a new tagged write or via projecting already-persisted raw rows (task 1a resolves which) |
| R2 | Correlation survives nesting | A depth-2+ sub-agent's text (its own `parentToolUseId` pointing at its own spawning `Task` call, itself nested under another task) is correctly attributed to its own `activeTasks`/chip entry, not merged into an ancestor's — verified since every depth already gets its own flat `activeTasks` entry keyed by `task_id`, each with its own `toolUseId` |
| R3 | Fetch IPC for a task's transcript, keyable by taskId or toolUseId | A new IPC handler (`ai:getTaskSubagentTranscript`, sibling of `ai:getTeammateTranscript`) returns the projected transcript given either a `taskId` or a `toolUseId` (the widget in task 2b only has the latter), validated for session/workspace ownership the same way the teammate handler is |
| R4 | Live-update signal | A new internal event / IPC channel (`task:transcriptUpdated` → `task:transcript-updated`), keyed by `taskId`, mirrors the teammate live-signal shape exactly — a per-task Jotai atom family bumps on new content, consumers debounce-refetch |
| R5 | Hover popover | Hovering a Task chip (inline row or sidebar row) opens a read-only popover (no input, no stop button) showing the live transcript, auto-dismissing on mouse-leave, no click required — built on the same `@floating-ui/react` pattern as `TeammateThreadPopover` |
| R6 | Inline expand, teammate-safe | A widget registered for the `'Task'` tool name via the existing tool-widget contribution registry renders in place of the generic tool card for a plain Task sub-agent's spawning message ONLY — a teammate-spawn `Task` message (`isSubAgent && isTeammate`) must continue rendering through its existing card, requiring a narrow, explicit exclusion in `RichTranscriptView.tsx` (see task 2b) since the registry has no per-message discriminator on its own |
| R7 | Tiling pane | Clicking a Task chip (inline or sidebar) opens a new pane beside the main thread. The main thread retains height/width priority. Multiple tiles can be open concurrently, arranged side by side. A tile stays open when its task completes; its status badge flips to the terminal state rather than the pane auto-closing |
| R8 | No teammate regression | No existing teammate transcript, popover, stop-control, resume-reliability, or *rendering* behavior changes as a result of this PRD |

---

## 5. Task Breakdown

Six tasks across five waves. The backend chain (1a→1b→1c) is fully sequential — mirrors PRD 002's
and PRD 003's own precedent of sequencing tasks that touch the same files
(`preload/index.ts`/`electron.d.ts` shared by 1b and 1c; `AgentMode.tsx` shared by 1c and 2b)
rather than fighting it. The three UI surfaces (2a, 2b, 2c) fan out with two real overlaps: 2a and
2c both touch `SubAgentChipRow.tsx` and `TeammatePanel.tsx` (hover-handler vs. click-handler wiring
on the same components) — resolved by sequencing 2c after 2a. 2b touches `RichTranscriptView.tsx`
(a narrow, explicit change, not the package-crossing one an earlier draft proposed — see §6 Q6) plus
a new electron-side widget file and its `AgentMode.tsx` registration call — disjoint from both 2a's
and 2c's files, runs alongside 2a in wave 4.

**Gate after wave 3 (end of backend, before UI fan-out):** `require_review` triggers automatically
— `MessageStreamingHandler.ts` and `AIService.ts` are both under `packages/electron/src/main/**`.
This also gives an explicit human-verify checkpoint before the three-surface UI investment begins,
addressing PRD 002's retrospective gap (its `manual_e2e` gate was left `PENDING` through to merge).

```yaml
# ============================================================
# NIMBLE TASK DEFINITIONS
# Parsed by the orchestrator for execution planning.
# ============================================================

metadata:
  prd_slug: "task-subagent-visibility"
  created_at: "2026-08-26T00:00:00Z"
  total_complexity: 36
  task_count: 6

tasks:
  - id: "1a"
    title: "Make Task sub-agent text retrievable and correctly correlated"
    description: |
      RESOLVE THIS FORK FIRST, before writing implementation code -- it
      changes which files this task actually touches:

      Option A -- new tagged write. Route the forwarded text in the
      provider's streaming loop (ClaudeCodeProvider.ts) and persist it via
      this.logAgentMessageNonBlocking (wired at ClaudeCodeProvider.ts:406-407
      as the same `logNonBlocking` dependency TeammateManager's own calls
      use, e.g. TeammateManager.ts:1109-1116/1893-1898/1957-1961, tagging
      _isTeammateOutput/_teammateAgentId there). Tag the Task-sub-agent
      write _isTaskSubagentOutput: true, _taskId: <owning task id>, AND
      _taskToolUseId: <the same toolUseId> (both keys -- 1b's fetch handler
      needs to be reachable by either, see R3; the inline-expand widget in
      2b only ever has the toolUseId available, not the taskId).

      Option B -- project existing raw rows, no new write. Confirmed live:
      ClaudeCodeProvider.ts:1300-1318 already persists the raw, unparsed
      SDK chunk via logAgentMessageNonBlocking for essentially every
      non-transient chunk (isTransientClaudeCodeChunk filters on
      type/subtype only, never parent_tool_use_id -- toolChunkUtils.ts:30-37),
      BEFORE ClaudeCodeTranscriptAdapter.ts:233's drop guard ever runs on
      it. slimClaudeCodeChunkForStorage (toolChunkUtils.ts:59+) only trims
      tool_use_result and thinking-signature fields, not parent_tool_use_id
      -- so a sub-agent's raw chunk, with its parent_tool_use_id intact, is
      plausibly ALREADY durably stored with no code change needed here at
      all. Under this option, task 1a becomes: verify this holds (write a
      throwaway script or test asserting a raw row for a forwarded
      sub-agent chunk exists and contains parent_tool_use_id), and if so,
      this task's only real work is making projectRawMessagesToViewMessages
      -- or a variant of it -- correctly project that generic, untagged raw
      shape (not the TeammateManager-style pre-tagged shape it currently
      expects) into a normal TranscriptViewMessage. That projection work
      may belong to 1b instead, in which case 1a is nearly a no-op provider
      change and 1a/1b should be treated as one combined unit of work by
      the implementer even though they remain two task entries here.

      Pick based on what actually works cleanly against
      projectRawMessagesToViewMessages during implementation -- don't
      guess from this description alone, verify against the real projected
      shape. State the choice made (and the volume-mitigation
      consideration below if Option A is chosen) in the commit message;
      this repo never opens a PR, so there is no PR description to write
      it into.

      Either option, the guard at ClaudeCodeTranscriptAdapter.ts:233 stays
      exactly as-is -- it correctly prevents the LEAD's own rendered
      transcript from showing sub-agent text, which is unrelated to
      whether that text is separately retrievable by taskId.

      CORRELATION -- READ CAREFULLY, an earlier draft of this task got this
      backwards: match the chunk's parentToolUseId DIRECTLY against
      activeTasks[*].toolUseId (activeTasks entries store
      toolUseId: chunk.tool_use_id at ClaudeCodeProvider.ts:2904, set when
      task_started fires). Do NOT route through subagentToolCallOwners
      (ClaudeCodeProvider.ts:329,1450,1462) -- that map's KEYS are INNER
      tool_use ids (calls issued BY a sub-agent, set at line 1450 keyed by
      toolId with subagentId as the value) and its VALUES are Task tool_use
      ids; a forwarded chunk's parentToolUseId is itself a Task tool_use id,
      which lives in that map's VALUE space, not its key space. Looking it
      up as a key there misses entirely for a depth-1 sub-agent (the lead's
      own Task call is never a key) and misattributes a depth-2 sub-agent's
      text to its ancestor (the nested Task call IS a key there, resolving
      to the wrong owner). subagentToolCallOwners exists for a different
      purpose (attributing a still-in-flight tool call to its owning
      sub-agent for permission-prompt routing, see markTaskBlockedForToolUse
      at ClaudeCodeProvider.ts:3890-3902, which already does the correct
      half of this pattern: resolve a value out of subagentToolCallOwners,
      then match it against task.toolUseId in activeTasks) -- it is not the
      mechanism for THIS task's correlation. The direct
      activeTasks[*].toolUseId match already handles nesting correctly by
      construction, since every depth gets its own activeTasks entry keyed
      by its own task_id with its own toolUseId -- verify this with a
      depth-2 fixture in the task's tests rather than assuming it from the
      code read.

      Volume mitigation (Should, not blocking, Option A only): Task
      sub-agents fire far more often than teammates in a session. Consider
      skipping thinking blocks for this path, or another cheap cap. Under
      Option B this concern doesn't apply -- no new rows are added.

      Fulfills R1, R2.
    depends_on: []
    complexity: 7
    priority: "must"
    success_criteria:
      - "A concrete decision is made and stated (commit message) between Option A (new tagged write) and Option B (project existing raw rows) -- not left ambiguous for 1b to guess at"
      - "A chunk with parentToolUseId set that matches a known activeTasks[*].toolUseId is retrievable via the mechanism chosen, correlated correctly, and does NOT appear in the lead's own projected transcript (existing guard behavior preserved either way)"
      - "A depth-2 sub-agent's text (its parentToolUseId matching its OWN activeTasks entry's toolUseId, not an ancestor's) is correlated to its OWN activeTasks entry -- covered by an explicit nested fixture, not inferred"
      - "The fix does NOT route through subagentToolCallOwners for this correlation -- that map is left untouched by this task, used only for its existing permission-prompt-attribution purpose"
      - "A chunk whose parentToolUseId does not match any known activeTasks[*].toolUseId (e.g. a teammate's own chunk, or a race before task_started registers the entry) is not misattributed to the wrong task"
      - "If Option A is chosen: volume mitigation choice (or explicit deferral) is stated in the commit message"
    files_affected:
      - "packages/runtime/src/ai/server/providers/claudeCode/ClaudeCodeTranscriptAdapter.ts (read/verify only under Option B; may be genuinely unmodified)"
      - "packages/runtime/src/ai/server/providers/ClaudeCodeProvider.ts"
    deliverables:
      - artifact: "Task sub-agent text retrievable and correctly correlated, via Option A or B"
        path: "packages/runtime/src/ai/server/providers/ClaudeCodeProvider.ts"
        done_when: "Unit test asserts correct correlation via activeTasks[*].toolUseId, correct exclusion from the lead transcript, and correct depth-2 correlation, per success_criteria above, regardless of which option was chosen"

  - id: "1b"
    title: "IPC fetch handler + projection for a task's transcript"
    description: |
      Direct sibling of ai:getTeammateTranscript (AIService.ts:3303-3328).
      Add ai:getTaskSubagentTranscript(sessionId, { taskId?, toolUseId? },
      workspacePath) -- same safeHandle registration, same session/
      workspace ownership validation, same
      createRawMessageStoreAdapter().getMessages(sessionId) read (all raw
      rows for the lead session, since task chunks are interleaved into it
      same as teammate chunks are). Accept EITHER taskId or toolUseId as
      the lookup key -- 2b's inline-expand widget only ever has the
      toolUseId (from the spawning message's own tool_use id), not the
      taskId, so a toolUseId-only lookup path is required, not optional.

      Add projectTaskSubagentRawMessages(rawMessages, { taskId?,
      toolUseId? }), whose exact matching/parsing logic depends on which
      option 1a resolved to (a cheap tag pre-filter + exact-id match if
      Option A; matching parent_tool_use_id directly in the generic raw
      chunk shape, then adapting/reusing projectRawMessagesToViewMessages,
      if Option B). Coordinate directly with however 1a actually landed --
      do not assume Option A's shape without checking.

      Fulfills R3.
    depends_on: ["1a"]
    complexity: 4
    priority: "must"
    success_criteria:
      - "ai:getTaskSubagentTranscript returns the correct projected TranscriptViewMessage[] given EITHER a taskId or a toolUseId for the same task"
      - "Unknown/absent taskId or toolUseId returns an empty array, not an error"
      - "Session/workspace ownership validation matches ai:getTeammateTranscript's existing behavior (rejects a mismatched workspacePath the same way)"
      - "projectTaskSubagentRawMessages is covered in the same test file that covers projectTeammateRawMessages (projectRawMessages.test.ts) if its shape allows reusing that pipeline, or a clearly-named sibling test file if 1a's Option B required a materially different parsing path -- either way, name the file in the commit, don't leave it implicit"
    files_affected:
      - "packages/electron/src/main/services/ai/AIService.ts"
      - "packages/runtime/src/ai/server/transcript/projectRawMessages.ts"
    deliverables:
      - artifact: "ai:getTaskSubagentTranscript IPC handler, keyable by taskId or toolUseId"
        path: "packages/electron/src/main/services/ai/AIService.ts"
        done_when: "Handler registered via safeHandle, returns correct projection for both lookup keys, covered by tests"
      - artifact: "Preload/electron.d.ts surface for the new IPC channel"
        path: "packages/electron/src (preload + electron.d.ts)"
        done_when: "electronAPI exposes the new call, typed, matching the teammate equivalent's signature shape"

  - id: "1c"
    title: "Live-update signal for task transcripts"
    description: |
      Mirror the teammate live-signal chain exactly, keyed by taskId
      instead of agentId: provider emits an internal EventEmitter event
      (task:transcriptUpdated) from the same call site(s) task 1a's chosen
      option produces new content at -> MessageStreamingHandler.ts forwards
      it to the renderer as webContents.send('task:transcript-updated',
      { sessionId, taskId }) -> a new centralized listener
      (store/listeners/taskTranscriptListeners.ts, sibling of
      teammateTranscriptListeners.ts) bumps a per-(sessionId, taskId)
      Jotai atom family (taskTranscriptSignalAtomFamily, alongside
      teammateTranscriptSignalAtomFamily in store/atoms/agentMode.ts).

      Wire the new listener's init into AgentMode.tsx, the same way
      initTeammateTranscriptListeners is already called there
      (AgentMode.tsx:58 import, :266 call site, inside a useEffect(..., []))
      -- add an initTaskTranscriptListeners() call alongside it, not a
      separate mount point.

      This task also finishes the preload/electron.d.ts surface begun in
      1b if any additional typed listener registration is needed there
      (both tasks touch that file; sequenced after 1b per PRD 002's own
      precedent for the same file pair).

      Fulfills R4.
    depends_on: ["1b"]
    complexity: 5
    priority: "must"
    success_criteria:
      - "task:transcriptUpdated fires from the correct call site(s), carrying sessionId and taskId, regardless of which option 1a chose"
      - "MessageStreamingHandler forwards it to the renderer as task:transcript-updated with the same payload shape"
      - "taskTranscriptListeners.ts (new) subscribes once at startup via a call from AgentMode.tsx (never per-component), bumping taskTranscriptSignalAtomFamily(sessionId, taskId) -- test file taskTranscriptListeners.test.ts mirrors the existing teammateTranscriptListeners.test.ts structure"
      - "No existing teammate:transcript-updated behavior changes"
    files_affected:
      - "packages/electron/src/main/services/ai/MessageStreamingHandler.ts"
      - "packages/electron/src/renderer/store/listeners/taskTranscriptListeners.ts"
      - "packages/electron/src/renderer/store/atoms/agentMode.ts"
      - "packages/electron/src/renderer/components/AgentMode/AgentMode.tsx"
    deliverables:
      - artifact: "task:transcript-updated live-signal channel, end to end"
        path: "packages/electron/src/renderer/store/listeners/taskTranscriptListeners.ts"
        done_when: "New listener test file (taskTranscriptListeners.test.ts) passes, mirroring teammateTranscriptListeners.test.ts's structure"

  - id: "2a"
    title: "Hover popover for a Task chip (inline + sidebar); retire click-to-status-popover"
    description: |
      New TaskThreadPopover.tsx, near-total reuse of
      TeammateThreadPopover.tsx's pattern (useFloating + FloatingPortal per
      this repo's floating-ui rule, RichTranscriptView fed by fetched
      TranscriptViewMessage[], fetchGenerationRef guard against
      out-of-order async responses, debounce-refetch on the taskTranscript
      signal atom from 1c) -- but READ-ONLY: no compose input, no stop
      button. Closer to SessionTranscriptPeek.tsx's shape than the
      teammate popover's compose-capable variant.

      Trigger: hover (not click) on a Task-kind chip, both the inline chip
      in SubAgentChipRow.tsx and its row in the Sub-agents sidebar section
      of TeammatePanel.tsx. Auto-dismisses on mouse-leave.

      DISPOSITION OF THE EXISTING TaskStatusPopover (SubAgentChipRow.tsx
      lines 152-204, currently rendered on click via handleChipClick's
      branch at ~264-267, which calls onTaskClick?.(entry.id) AND sets
      local popover state): remove the local popover state. Its content
      (label, status, active tool name) is a subset of what the new hover
      popover shows -- fold those fields into TaskThreadPopover's header so
      no information is lost. Leave the onTaskClick?.(entry.id) call itself
      intact (unwired to anything yet) -- task 2c wires it to open a tile.

      Fulfills R5.
    depends_on: ["1b", "1c"]
    complexity: 5
    priority: "must"
    success_criteria:
      - "Hovering a Task chip (inline) opens the popover with live transcript content, no click required"
      - "Hovering the same task's row in the Sub-agents sidebar list opens the same popover"
      - "Popover has no input field and no stop control"
      - "Popover auto-dismisses on mouse-leave"
      - "Popover content updates live via the 1c signal atom, debouncing to the same 1.5s window TeammateThreadPopover uses, not refetching on every event"
      - "TaskStatusPopover's local click-triggered popover state is removed; its status/label/tool-name fields are present in TaskThreadPopover's header; clicking a Task chip no longer opens it (onTaskClick still fires, unconsumed until 2c)"
    files_affected:
      - "packages/electron/src/renderer/components/AgentMode/TaskThreadPopover.tsx"
      - "packages/electron/src/renderer/components/AgentMode/SubAgentChipRow.tsx"
      - "packages/electron/src/renderer/components/AgentMode/TeammatePanel.tsx"
    deliverables:
      - artifact: "TaskThreadPopover.tsx"
        path: "packages/electron/src/renderer/components/AgentMode/TaskThreadPopover.tsx"
        done_when: "Component test suite (TaskThreadPopover.test.tsx) covers hover-open, mouse-leave-dismiss, live update via the signal atom, and that TaskStatusPopover no longer renders on click"

  - id: "2b"
    title: "Inline expand via the custom tool-widget registry, scoped to exclude teammates"
    description: |
      RichTranscriptView.tsx's renderToolCard resolves a custom widget
      purely by tool NAME (getCustomToolWidget(tool.toolName), line 1763,
      unconditional early-return at line 1764) BEFORE it computes or
      branches on isSubAgent/isTeammate (lines 1755-1826+, the existing
      card for sub-agent/teammate spawns: name, mode, live status, model,
      description, prompt, child events). Since teammates are ALSO spawned
      via the Task tool (TeammateManager.ts:2209 matches
      toolName === 'Task' && toolInput?.team_name), registering a widget
      bare for 'Task' would silently blank out the existing teammate card
      for every teammate spawn -- confirmed during PRD review, this is the
      one runtime-side change this task genuinely needs, not the
      package-crossing component an earlier draft proposed (see PRD §6 Q6
      for that correction) and not "no changes needed" either (a second,
      narrower correction on top of it).

      REQUIRED RichTranscriptView.tsx change (small, precise): move the
      `const CustomWidget = ...` resolution to AFTER isSubAgent/isTeammate
      are computed (they already are, lines 1755-1757), and only use it
      when `!(isSubAgent && isTeammate)` -- i.e. skip the registry lookup
      specifically for teammate-spawn Task messages, falling through to
      the existing card exactly as today. Every other tool name's widget
      resolution (e.g. capture_editor_screenshot) is completely unaffected
      by this change, since the condition only ever excludes the teammate
      case.

      Create the widget component (e.g. TaskToolWidget.tsx) under
      packages/electron/src/renderer/components/AgentMode/, using the
      CustomToolWidgetProps contract (message, isExpanded, onToggle,
      workspacePath, sessionId, readFile, loadToolCallDiffs) documented in
      docs/CUSTOM_TOOL_WIDGETS.md -- the isExpanded/onToggle props ARE the
      accordion mechanism; no separate expand-state plumbing is needed.
      The widget has access to `message.toolCall.providerToolCallId` (the
      Task tool_use id) and `sessionId`, but NOT a taskId directly -- call
      ai:getTaskSubagentTranscript(sessionId, { toolUseId:
      providerToolCallId }, workspacePath) (1b's toolUseId-keyed lookup
      exists specifically for this). Register it for the 'Task' tool name
      via setTranscriptToolWidgets, imported from the declared package
      subpath @nimbalyst/runtime/ui/AgentTranscript (whose index re-exports
      contributions) -- not a deeper internal path, since the electron
      Vite config's production module resolution only rewrites
      @nimbalyst/runtime/<subpath> for subpaths with their own index.
      Call the registration once at startup from AgentMode.tsx, alongside
      the initTaskTranscriptListeners() call 1c already adds there (both
      land in AgentMode.tsx -- sequenced after 1c, not a same-wave
      conflict since 2b depends_on 1c).

      A depth-2+ Task sub-agent's own spawning message, if surfaced inside
      a parent task's transcript (via the popover or inline-expand), will
      render through this same widget recursively -- expected and
      acceptable, not a bug to suppress.

      Fulfills R6.
    depends_on: ["1b", "1c"]
    complexity: 6
    priority: "must"
    success_criteria:
      - "A plain Task sub-agent's spawning message (isSubAgent && !isTeammate) renders via the new TaskToolWidget, registered through setTranscriptToolWidgets for the 'Task' tool name"
      - "A teammate-spawn Task message (isSubAgent && isTeammate) renders via the EXISTING subagent/teammate card in RichTranscriptView.tsx, completely unchanged -- this is the primary regression this task must not introduce, and needs an explicit test, not just a code read"
      - "Every other tool_use message type (non-Task) is unaffected by the RichTranscriptView.tsx change -- registry lookup and rendering for e.g. capture_editor_screenshot is identical to before"
      - "Clicking the widget toggles isExpanded/onToggle, expanding the transcript inline beneath the message; a second click collapses it"
      - "The widget fetches via toolUseId (message.toolCall.providerToolCallId), not a taskId it doesn't have"
      - "Widget registration happens exactly once at startup (AgentMode.tsx), imported from @nimbalyst/runtime/ui/AgentTranscript, not per-render or per-component-mount"
    files_affected:
      - "packages/runtime/src/ui/AgentTranscript/components/RichTranscriptView.tsx"
      - "packages/electron/src/renderer/components/AgentMode/TaskToolWidget.tsx"
      - "packages/electron/src/renderer/components/AgentMode/AgentMode.tsx"
    deliverables:
      - artifact: "Narrow isTeammate-exclusion fix in RichTranscriptView.tsx + TaskToolWidget.tsx, registered via setTranscriptToolWidgets"
        path: "packages/runtime/src/ui/AgentTranscript/components/RichTranscriptView.tsx"
        done_when: "Test suite covers: plain-Task-sub-agent renders new widget; teammate-spawn Task renders unchanged existing card; non-Task tools unaffected; expand/collapse toggle; one-time registration"

  - id: "2c"
    title: "Tiling pane for Task sub-agent transcripts; claim the chip's click behavior"
    description: |
      Largest single task in this PRD -- new split-pane/tiling layout,
      purpose-built for this feature (explicitly NOT a general docking
      framework; no drag-to-rearrange, no cross-session layout
      persistence, per Non-Goals). No split-pane library exists anywhere
      in this repo today (confirmed: no react-resizable-panels, allotment,
      SplitPane, or react-split dependency) -- this task builds the
      primitive from scratch using CSS flexbox/grid (flex-basis-driven
      columns is the simplest fit for "main thread keeps priority, N tiles
      beside it"), not a new npm dependency, unless an implementer-time
      spike finds a compelling reason otherwise.

      HOST: mount the tiling layout in SessionTranscript.tsx, the component
      that currently renders <AgentTranscriptPanel> (the main thread, line
      ~2502) and <SubAgentChipRow sessionId onTeammateClick> (line ~2696,
      note: onTaskClick is NOT passed today -- this task adds it) side by
      side in the same tree. The tiling container wraps/sits alongside
      AgentTranscriptPanel here; do not create a new top-level mount point
      elsewhere.

      STATE HOME: add an open-tiles atom (e.g. openTaskTilesAtom, a
      per-session Set/array of open taskIds) to
      packages/electron/src/renderer/store/atoms/agentMode.ts, alongside
      the other AgentMode-scoped atoms already there
      (sessionTasksAtom, taskTranscriptSignalAtomFamily from 1c).

      Wire SubAgentChipRow's existing onTaskClick?.(entry.id) call (left
      unconsumed by task 2a) through SessionTranscript.tsx's new
      onTaskClick prop into openTaskTilesAtom, toggling the task's id
      in/out of the open set. Do the same for the equivalent click in
      TeammatePanel.tsx's sidebar row. Each open tile renders the same
      transcript content 2a/2b consume (1b fetch + 1c signal), in its own
      pane. The main thread keeps height/width priority when one or more
      tiles are open. A tile does not auto-close when its task completes
      -- it stays open with its status badge flipped to the terminal
      state.

      Sequenced after 2a specifically because both tasks add a new handler
      (hover vs. click) to the same two components (SubAgentChipRow.tsx,
      TeammatePanel.tsx) -- sequencing avoids a real merge conflict rather
      than working around one after the fact.

      Fulfills R7.
    depends_on: ["1b", "1c", "2a"]
    complexity: 9
    priority: "must"
    success_criteria:
      - "Clicking a Task chip (inline or sidebar) opens a new tile beside the main thread, hosted in SessionTranscript.tsx alongside AgentTranscriptPanel"
      - "Main thread retains height/width priority when one or more tiles are open"
      - "A second concurrent task's chip opens a second tile alongside the first, not replacing it"
      - "A tile whose task completes stays open; its status badge updates to the terminal state instead of the pane closing"
      - "openTaskTilesAtom (or equivalent) lives in store/atoms/agentMode.ts, not local component state, so tile state survives the triggering component's remount"
      - "No drag-to-rearrange, no layout persisted across app restart, no docking of arbitrary content types, no new split-pane npm dependency added without an explicit note explaining why the from-scratch CSS approach was insufficient -- purpose-built to this feature only"
    files_affected:
      - "packages/electron/src/renderer/components/UnifiedAI/SessionTranscript.tsx"
      - "packages/electron/src/renderer/store/atoms/agentMode.ts"
      - "packages/electron/src/renderer/components/AgentMode/ (new tiling components)"
      - "packages/electron/src/renderer/components/AgentMode/SubAgentChipRow.tsx"
      - "packages/electron/src/renderer/components/AgentMode/TeammatePanel.tsx"
    deliverables:
      - artifact: "Tiling pane layout + click-to-open wiring"
        path: "packages/electron/src/renderer/components/UnifiedAI/SessionTranscript.tsx"
        done_when: "Component test covers open/multi-tile-concurrent/main-thread-priority/stay-open-on-completion per success_criteria; a human manually verifies the visual layout matches the approved mockup before the end-of-PRD gate closes (see status.json verification.manual_e2e)"
```

---

## 6. Open Questions

- **Q1 (resolved during interview, kept for record):** Persist Task sub-agent text as a designed,
  restart-survivable feature, or keep it purely live? Resolved: live is the feature scope; whatever
  persistence mechanism task 1a lands on (see Q7) is an implementation detail, not a promise — see
  §3 Non-Goals for how any resulting restart-survivability side effect is bounded.
- **Q2 (resolved during interview, kept for record):** Does nested (depth-2+) sub-agent
  correlation need special handling? Resolved: no — confirmed live that every depth already gets
  its own flat `activeTasks` entry and chip (`handleSystemTask` keys purely on `task_id`), so the
  per-`taskId` mechanism this PRD builds covers nesting for free. No hierarchy/tree UI is added
  (stated Non-Goal).
- **Q3 (resolved during interview, kept for record):** Does a tiling pane auto-close on task
  completion? Resolved: no — stays open, status badge flips to terminal state. Matches teammate
  chip precedent ("terminal states are not auto-dismissed on a timer").
- **Q4 (follow-on, not this PRD):** Should the emergent restart-survivability of the transcript
  (§3) become an intentional, tested feature — a "view past sub-agent transcripts" entry point? Not
  scoped here; flagged for a future product decision if users start relying on the emergent
  behavior.
- **Q5 (resolved during first PRD review pass, kept for record):** An earlier draft of task 1a
  specified resolving `taskId` by looking up `parentToolUseId` as a *key* in
  `subagentToolCallOwners`. This was wrong: that map's keys are inner tool_use ids issued *by* a
  sub-agent, and its values are the owning Task's tool_use id — the reverse of what the lookup
  needs. It would have made the feature inert at depth 1 and misattributed text at depth 2.
  Corrected to a direct match against `activeTasks[*].toolUseId`.
- **Q6 (resolved across two PRD review passes, kept for record):** How should the inline-expand
  widget (task 2b) avoid a package-layering violation while also not breaking teammate rendering?
  First correction: an earlier draft imported a new `packages/electron` component directly into
  `packages/runtime`'s `RichTranscriptView.tsx` — a layering violation (`runtime` has no dependency
  on `electron`). Corrected to use the existing dynamic tool-widget contribution registry
  (`setTranscriptToolWidgets` et al.), self-registered from the electron side. Second correction,
  found on the follow-up review of that fix: since teammates are *also* spawned via the `Task` tool
  and render through the *same* `getCustomToolWidget`/registry call site — which returns
  unconditionally, before any teammate-specific rendering logic runs — a bare `'Task'`-keyed widget
  registration would have silently blanked out the existing teammate card for every teammate spawn.
  Final resolution: a small, explicit, narrowly-scoped change *is* needed in
  `RichTranscriptView.tsx` (gate the widget lookup on `!(isSubAgent && isTeammate)`), which is not
  the layering violation the first correction ruled out — it is a one-line conditional inside a file
  `runtime` already owns, not a new cross-package import.
- **Q7 (raised during the second PRD review pass, deliberately left open for implementation):**
  Does task 1a need a new persistence write at all? `ClaudeCodeProvider.ts:1300-1318` appears to
  already persist the raw SDK chunk (parent_tool_use_id field intact) for sub-agent chunks before
  the adapter's drop guard runs — which would mean the text is already durably stored, and the only
  real work is on the projection/read side (1b), not a new write in 1a. This wasn't resolved
  definitively during PRD review (it requires confirming the existing projection pipeline can
  handle the generic raw shape, which is implementation-level verification, not a planning-level
  fact). Task 1a is written to require the implementer to check this and pick explicitly (Option A:
  new tagged write; Option B: project existing raw rows) rather than defaulting silently to the more
  complex option.
