# PRD Template (v2)

```yaml
---
feature_name: "Teammate Idle Handoff"
feature_slug: "teammate-idle-handoff"
owner: "jeppcohen@gmail.com"
status: "ready"
created_date: "2026-08-27"
target_date: ""
phase: ""
scope_type: "bugfix"
github_project: ""
links: [".nimble/prds/003_teammate-resume-reliability", ".nimble/prds/005_agent-teams-cold-start-bootstrap"]
checkpoint_refs: []
cross_feature_blockers: []
---
```

---

## 1. Executive Summary

**One-liner:** A teammate's running-to-idle transition currently drops the handoff to the lead on
the floor — the lead never receives the teammate's result, redoes the work itself, and the UI then
mislabels the finished teammate as an Error with zero tool calls. This PRD closes that seam.

**What's changing:** Three sibling fixes around one seam, all observed live in one session
(c29787e7, teammate "weatherman", 2026-08-27, the first real teammate spawn after PRD 005):
(1) when a non-background teammate goes idle without having sent the lead a message, its captured
final output is delivered to the lead via the existing `deliverMessageToLead` machinery (PRD 003's
pattern), instead of nothing; (2) the continuation system prompt no longer invites the lead to
"take other actions" — which it interpreted as redoing the teammate's own task three times — and
instead instructs it to wait and explicitly not duplicate in-flight teammate work; (3) `killAll`
stops painting idle (finished-work) teammates as `errored`, and the teammate's real
`toolCallCount`/`lastActiveAt` survive the idle transition and resume instead of being dropped.

**Who it's for:** Anyone using Agent Mode teammates — reachable in practice for the first time
since PRD 005 fixed the spawn gate.

**Done looks like:** Re-run the weatherman scenario ("fetch Miami weather, report back"). Even if
the teammate never calls SendMessage, its final answer reaches the lead's conversation when it
goes idle; the lead does not re-fetch the weather itself; after a session abort, the popover and
panel show the teammate as completed with its real tool-call count.

**Primary risk:** The new idle-wake is a 4th call site into `deliverMessageToLead` →
`interruptWithMessage` → `isLeadBusy()` — machinery PRD 003 just audited. Research verified the
live-process delivery chain end-to-end (session stays deferred, `isSessionActive` passes, latch
resets on next lead turn, `releaseIdleWakeLatch()` safety valve exists), and the spam guard
(`!sentMessageToLead`, reset per stream) is confirmed sound. Mid-turn, the idle handoff interrupts the lead's active turn
(`ClaudeCodeProvider.ts:2406-2421`) exactly as a teammate SendMessage does; the message is
re-drained by `handlePostLeadTurnTeammateState` (`:2428`/`:2448`) if `streamInput` fails — this
is accepted, not a bug, and no batching/debounce is added. Residual gap: a teammate whose turn
produces no final text delivers a bare idle notice, not a result — see R1.

---

## 2. Problem & Context

**Problem statement:** `handleStreamCompletion`'s idle branch (`TeammateManager.ts:1542-1549`)
moves a finished non-background teammate to `idleTeammates` and emits only a UI status update —
nothing notifies the lead. `deliverMessageToLead` with `capturedResultText` exists only in the
background-agent branch (`:1562-1569`). If the lead's turn is already over (in the live trace: its
continuation budget was exhausted 1.5 s before the teammate went idle, making
`abandonIdleTeammates` a silent no-op on a still-running teammate), the session sits deferred
forever with the teammate's finished answer dropped. Downstream, the continuation prompt's "or
take other actions as needed" (`ClaudeCodeProvider.ts:2465`) invited the lead to redo the
teammate's task once per continuation, and `killAll` (fired by `abort()` 12 minutes later)
blanket-emitted `errored` for the idle teammate while the idle metadata path had already dropped
its `toolCallCount`.

**Supporting data / evidence:** Full live trace and code-verified mechanisms in
`research/internal/findings.md`, including the definitive answer to the open investigation
question: the teammate's raw transcript (session a4844735, 24 lines) shows it made 3 real tool
calls and ended with a complete plain-text answer — it never called SendMessage. Both
contributors (model behavior AND the Nimbalyst race) are real; the capture-on-idle fix covers
both in one move. An independent researcher pass confirmed every mechanism and verified the four
gating questions (fields populated for non-background streams; live-process delivery chain works;
latch-safe; spam-guarded).

**What happens if we don't build this:** Every teammate that finishes without SendMessage — a
routine haiku/small-model behavior, and Nimbalyst has no prompt lever to prevent it (no
Nimbalyst-side system prompt exists for teammates) — silently wastes its work, wedges the session
until user intervention, and then lies about what happened in the UI.

**Strategic fit:** Direct continuation of PRD 002 (visibility) and PRD 003 (failure honesty),
using PRD 003's exact `deliverMessageToLead`/`isLeadBusy` vocabulary. This is the third variant
of the same bug class: (1) live-process resume failure, (2) post-restart resume failure — both
PRD 003 — and now (3) a live-process teammate going idle with nobody listening.

**Explicitly out of scope:** Anything in the Task-subagent system (`activeTasks`, PRD 004 UI) —
these are teammate-lifecycle fixes only. Post-restart-then-idle-transition combination (per PRD
003's notes, unreachable today because ProviderFactory does not recreate a provider before a lead
turn post-restart). SDK-hook adoption (PRD 003 Open Q1, still a separate follow-on).

---

## 3. Goals, Non-Goals & Success Metrics

### Goals

1. A non-background teammate that goes idle without having messaged the lead delivers its
   captured final output (or an explicit idle notice when none exists) into the lead's
   conversation via `deliverMessageToLead`.
2. The continuation prompt directs the lead to wait for and integrate teammate results and
   explicitly forbids duplicating their in-flight work, while still permitting teammate
   management (message/stop/shutdown).
3. Session abort paints idle teammates as `completed` (matching `stop`/`stopByAgentId`), not
   `errored`; `toolCallCount`/`lastActiveAt` survive the idle transition and resume.

### Non-Goals

- No new suppression/queueing logic — the existing `isLeadBusy()` machinery from PRD 003 is
  relied on as-is.
- No Nimbalyst-side teammate system prompt ("always SendMessage before finishing") — the SDK owns
  that prompt; capture-on-idle makes it unnecessary. Recorded as considered-and-rejected.
- No change to `abandonIdleTeammates`'s exhaustion semantics beyond what the idle-wake makes moot
  (see Decision D3).
- No Task-subagent (PRD 004) changes; no post-restart-then-idle work.

### Success Metrics

| Metric | Baseline | Target | How Measured |
| ------ | -------- | ------ | ------------ |
| Idle-without-SendMessage results reaching the lead | 0% (dropped) | 100% (result text; bare notice when no text) | Unit test: idle completion with `!sentMessageToLead` → `deliverMessageToLead` called with the captured text |
| Lead redoing teammate work during continuations | Observed 3x/session | 0 by instruction | Continuation message content test + live verification script |
| Idle teammates shown as Error after abort | Always | Never (`completed`) | Unit test on `killAll` emission split |
| Tool-call count lost across idle/resume | Always | Never | Unit test: idle metadata entry carries `toolCallCount`; resume seeds from prior count |

---

## 4. Requirements

### Must Have (blocks launch)

| ID | Requirement | Acceptance Criteria |
| -- | ----------- | -------------------- |
| R1 | Idle handoff delivery | In `handleStreamCompletion`'s idle branch, for every `!isBackground` idle transition, call `deliverMessageToLead` with a message identifying the teammate and stating it went idle (resumable via SendMessage, or shut-downable). The message includes `capturedResultText` only when `!result.sentMessageToLead` (a teammate that already messaged the lead does not get its result re-delivered — but the idle notice itself is always delivered, so a teammate that sent a mid-stream progress message and then finished still hands off its idle state); when no captured text exists and nothing was sent, the notice explicitly says the teammate reported no result. Reviewer-verified: double delivery is impossible (per-stream `sentMessageToLead` local at `:1828`; queued messages merge into one drained batch). |
| R2 | Latch & spam safety | No new suppression code; the existing `isLeadBusy()`/`teammateIdleMessagePending`/`releaseIdleWakeLatch()` machinery is used unchanged. Repeated idle cycles and resumes each gate independently on their own stream's `sentMessageToLead`. |
| R3 | Continuation prompt rewording | The `ClaudeCodeProvider.ts:2465` message instructs the lead to wait for teammate results, explicitly forbids performing or duplicating the teammates' assigned work itself, and permits messaging/stopping/shutting down teammates. Wording-only — the message remains a visible injected prompt (no hide mechanism exists, verified). |
| R4 | Truthful abort status | `killAll` emits `completed` for teammates cleared from `idleTeammates` and `errored` only for those aborted from `managedTeammates`, matching `stop`/`stopByAgentId` precedent. |
| R5 | Tool-count continuity | Both idle-entry paths in `emitTeammateUpdate` — the push loop (`:1488-1501`) AND the `existingTeammates.map` idle branch (`:1461-1466`) — carry `toolCallCount` and `lastActiveAt`; `IdleTeammate` carries them across the transition (sourced from the `managed` entry captured at `:1531`, before the `:1534` delete); `resumeIdleTeammate` seeds `toolCallCount` from the idle record instead of 0; `PersistedTeammateRow`/`rehydrateIdleTeammate` carry the count across a restart for the host-send resume path. |
| R6 | Test coverage | Greenfield unit coverage for R1-R5 (none exists for `killAll`, `MAX_CONTINUATIONS`, or `handlePostLeadTurnTeammateState` today), following `TeammateManager.stallWatchdog.test.ts`'s mocking pattern, red-first via targeted revert per PRD 003 task 2a's precedent. |

### Should Have

| ID | Requirement | Acceptance Criteria |
| -- | ----------- | -------------------- |
| R7 | Model visible in panel row | The Teammates panel row shows the teammate's `model` when present (currently only `agentType`, e.g. "general-purpose"). Visual-only; no unit test per repo testing rules. |

---

## Interview Decisions (recorded; user absent)

- **D1 — One PRD, three sibling defects.** They share one seam (running-to-idle drops the
  handoff) but are not one literal root cause; bug 1 is the continuation loop compensating badly
  for the gap, bug 3 is the same transition losing/miscoloring metadata. Splitting into three
  PRDs would triple ceremony for fixes that co-locate in two files and share one test harness.
- **D2 — Capture-on-idle over prompt engineering.** Nimbalyst has no system-prompt lever for
  teammates (verified: `taskInput.prompt` passes through verbatim; SDK owns the agent-teams
  prompt, and haiku ignored its SendMessage instruction). Delivering the captured result is
  robust to model behavior; a prompt-only fix would not be.
- **D3 — Leave `abandonIdleTeammates`/exhaustion reset alone.** The observed no-op race is made
  moot by R1: the idle transition itself now wakes the lead, and its delivery routes through
  `interruptWithMessage`, which resets `continuationCount` at `ClaudeCodeProvider.ts:2383` —
  every idle handoff resets the budget. Post-fix, an ignored idle teammate still terminates via
  exhaustion → abandon (now genuinely idle) → `emitAllCompleted('abandoned')`. Extra hardening
  (conditional reset) rejected as speculative.
- **D4 — killAll idle status is `completed`, not a new "abandoned" display state.**
  `mapTeammateStatus` has exactly 5 buckets and the popover footer already treats `completed` as
  inactive; `stop`/`stopByAgentId` already chose `completed` for idle teardown. A new
  wire+renderer status for this edge is not warranted.
- **D5 — R7 (model in panel row) included as should-have.** One-line renderer change; `model` is
  already on the emitted object and unused. Excluded from test scope (visual).
- **D7 — Idle notice is unconditional; only the result body is gated (reviewer M2, option a).**
  Gating the whole delivery on `!sentMessageToLead` would drop the FINAL answer of a teammate
  that sent a mid-stream progress message — the same bug shape minus the wedge. Instead the
  idle notice always fires and `capturedResultText` is included only when nothing was sent.
  Cost: a teammate that SendMessage'd right before idling produces one extra short notice,
  which merges into the same drained batch. Accepted.
- **D6 — Live end-to-end verification cannot be executed by workers** (no chat-prompt-submission
  mechanism — same limitation as PRD 005 task 3a). A ready-to-follow manual verification script
  is prepared into `status.json` instead; unit tests cover every code path.

---

## 5. Task Breakdown

Five tasks. 1a (ClaudeCodeProvider wording), 1b (TeammateManager idle handoff), and 1c (renderer
model display) are independent — wave 1. 2a (killAll + tool-count continuity) touches the same
file as 1b, so it is sequenced after it. 3a is the end-of-work test task, gated on all runtime
changes.

```yaml
# ============================================================
# NIMBLE TASK DEFINITIONS
# ============================================================

metadata:
  prd_slug: "teammate-idle-handoff"
  created_at: "2026-08-27T00:00:00Z"
  total_complexity: 17
  task_count: 5

tasks:
  - id: "1a"
    title: "Continuation prompt: wait, don't duplicate teammate work"
    description: |
      Reword the continuation system message injected at
      ClaudeCodeProvider.ts:2465 (currently '[System: Your previous turn
      ended but you still have active agents. Wait for their results, or
      take other actions as needed.]'). Live-observed failure: the lead
      read "or take other actions as needed" as license to redo the
      teammate's own task itself (same web queries, once per continuation,
      3x). New wording must: (1) instruct the lead to WAIT for its
      teammates' results; (2) explicitly forbid performing or duplicating
      the work the teammates are already doing; (3) still permit teammate
      management actions (SendMessage to a teammate, stopping or shutting
      one down) and answering the user. Keep the '[System: ...]' framing.

      Extract the message to an exported constant (e.g.
      TEAMMATE_CONTINUATION_MESSAGE) near MAX_CONTINUATIONS so 3a can
      assert its content without a full provider harness — PRD 003's R1
      established the model-facing-string test precedent.

      Verified during research (target 8): there is no hide mechanism for
      this message — it becomes a real prompt via
      emitTeammateMessageWhileIdle -> sendMessageHandler. Wording-only is
      the correct fix shape; do not attempt to hide or suppress it.

      Fulfills R3.
    depends_on: []
    complexity: 2
    priority: "must"
    success_criteria:
      - "The continuation message no longer contains open-ended 'take other actions' language; it instructs waiting and explicitly forbids duplicating the teammates' assigned work, while permitting teammate management and user-facing replies"
      - "Message text lives in an exported constant used by handlePostLeadTurnTeammateState; no other behavior of the continuation branch changes (count, reset, abandon call sites untouched)"
    files_affected:
      - "packages/runtime/src/ai/server/providers/ClaudeCodeProvider.ts"
    agent_context: |
      Wording + constant extraction only. Do not touch the
      continuation-count logic, abandonIdleTeammates calls, or anything
      in the teammate idle branch (task 1b's territory, different file).

  - id: "1b"
    title: "Idle handoff: deliver the teammate's captured result to the lead"
    description: |
      In TeammateManager.handleStreamCompletion's idle branch
      (TeammateManager.ts:1542-1549), after the teammate is moved to
      idleTeammates and the UI emit is scheduled, deliver the handoff to
      the lead: for EVERY !isBackground idle transition, call
      this.deliverMessageToLead(sessionId, agentId, displayName, content,
      summary) mirroring the background-branch calling convention at
      :1562-1569. displayName is idleTemplate.name (the display name, not
      the agentId). Per PRD decision D7 the notice is unconditional; only
      the result body is gated: include result.capturedResultText ONLY
      when !result.sentMessageToLead (a teammate that already messaged
      the lead does not get its result re-delivered).

      Content: identify the teammate, state that it finished its turn and
      is now idle (can be resumed via SendMessage or shut down). With
      !sentMessageToLead and captured text: include the text. With
      !sentMessageToLead and no text: explicitly say it reported no
      result — never skip delivery silently. With sentMessageToLead: a
      bare idle notice only. Summary shape: '{displayName} idle' /
      '{displayName} idle (no result)'.

      Verified by research — rely on these, do not re-litigate:
      - capturedResultText/sentMessageToLead are populated by
        streamTeammateOutput for ALL paths (spawn, resume, background);
        no new tracking needed (target 1).
      - The live-process delivery chain works end-to-end from this exact
        call site: session stays deferred after continuation exhaustion,
        isSessionActive passes, interruptWithMessage handles both
        mid-turn and idle lead (target 2).
      - Latch safety: 4th deliverMessageToLead call site uses the same
        audited machinery incl. releaseIdleWakeLatch(); add no new
        suppression or queueing (targets 3-4).

      The approved-shutdown and background branches are untouched.
      Reviewer-verified: double delivery is impossible (sentMessageToLead
      is a per-stream local declared at :1828, set at :1982; queued
      teammate messages merge into one drained batch at
      :2394/:2429/:2452, they do not duplicate).

      Fulfills R1, R2.
    depends_on: []
    complexity: 5
    priority: "must"
    success_criteria:
      - "Idle completion with !sentMessageToLead and non-empty capturedResultText calls deliverMessageToLead with the display name and a content string containing the captured text"
      - "Idle completion with !sentMessageToLead and no capturedResultText calls deliverMessageToLead with an explicit no-result idle notice (never silent)"
      - "Idle completion with sentMessageToLead === true delivers a bare idle notice and does NOT include capturedResultText (D7: notice unconditional, result body gated)"
      - "Background-agent and approved-shutdown branches byte-identical in behavior; no new suppression/queueing code anywhere"
    files_affected:
      - "packages/runtime/src/ai/server/providers/TeammateManager.ts"
    agent_context: |
      Read the background-result call at TeammateManager.ts:1562-1569 and
      PRD 003's wake call at :1604-1612 for the calling convention. Do
      not touch ClaudeCodeProvider.ts or MessageStreamingHandler.ts —
      research confirmed the delivery chain needs no changes for the
      live-process case. Do not modify abandonIdleTeammates (PRD decision
      D3: the exhaustion race is made moot by this task). Mid-turn, this
      delivery interrupts the lead's active turn
      (ClaudeCodeProvider.ts:2406-2421) exactly as a teammate SendMessage
      does — accepted behavior, add no batching/debounce. sessionId may
      be undefined at this call site; deliverMessageToLead tolerates it
      (:1144 gates logging, :1163/:1171 tolerate undefined) — add no
      redundant guard. Place the call BEFORE the hasActiveTeammates()
      check at :1573, matching the load-bearing ordering documented at
      :1600-1603.

  - id: "1c"
    title: "Teammates panel row: show model"
    description: |
      TeammatePanel.tsx's row currently shows agentType (e.g.
      "general-purpose") with the model unused despite being present on
      the teammate object. Show the model alongside the type when
      present (e.g. "general-purpose - haiku"), matching the panel's
      existing text styling. Visual-only change; per repo testing rules
      (no presentation-only tests) this task ships no unit test.
      Fulfills R7.
    depends_on: []
    complexity: 1
    priority: "should"
    success_criteria:
      - "Panel row displays the model string when the teammate object carries one; layout unchanged when model is absent"
      - "No changes outside TeammatePanel.tsx; no new tests"
    files_affected:
      - "packages/electron/src/renderer/components/AgentMode/TeammatePanel.tsx"
    agent_context: |
      This is the TEAMMATE panel (PRD 002 surface), not the Task-subagent
      tile/popover from PRD 004 — do not touch anything under the
      sub-agent task UI.

  - id: "2a"
    title: "Truthful abort status and tool-count continuity"
    description: |
      Two metadata fixes in TeammateManager.ts (sequenced after 1b, same
      file):

      (1) killAll (:2078-2115) currently emits a blanket 'errored'
      override for ALL cleared agents (:2108-2113). Split it: agents
      cleared from managedTeammates (actually aborted mid-run) stay
      'errored'; agents cleared from idleTeammates (finished their turn)
      emit 'completed' — matching stopByAgentId (:2144-2152) and
      stop(name) (:2172-2184) precedent. PRD decision D4: reuse
      'completed', do not invent a new wire/display status.

      (2) Tool-count continuity, four coordinated pieces:
      - IdleTeammate gains OPTIONAL fields (toolCallCount?: number;
        lastActiveAt?: number) — the type is exported (:40) and
        constructed as bare literals in stallWatchdog.test.ts:105 and
        resumeReliability.test.ts:119; required fields would break
        typecheck in files this task does not own.
      - In handleStreamCompletion's idle branch, populate them from the
        `managed` entry captured at :1531 (BEFORE the delete at :1534):
        toolCallCount: managed?.toolCallCount ?? 0, lastActiveAt:
        managed?.lastActiveAt. Do NOT source from idleTemplate — it is a
        spawn-time literal (:1674, :1735) and on the resume path it is
        the PREVIOUS idle record (:2068).
      - Both idle-entry paths in emitTeammateUpdate must carry the
        fields: the push loop (:1488-1501, fires only for agents with no
        persisted row) AND the existingTeammates.map idle branch
        (:1461-1466, fires whenever a row already exists — e.g. after a
        resume's running emit) — the map branch currently spreads the
        stale previous row.
      - resumeIdleTeammate (:2064) seeds toolCallCount from
        idleInfo.toolCallCount ?? 0 instead of 0, so the count
        accumulates across resume cycles; PersistedTeammateRow (:57-66)
        and rehydrateIdleTeammate (:1323-1333) gain the count so a
        post-restart host-send resume (sendMessageFromHost third branch,
        :1266) does not reset to 0.

      Fulfills R4, R5.
    depends_on: ["1b"]
    complexity: 4
    priority: "must"
    success_criteria:
      - "killAll with one running and one idle teammate emits 'errored' for the running one and 'completed' for the idle one"
      - "Idle metadata entries in emitTeammateUpdate include toolCallCount and lastActiveAt with the values from the teammate's run, in BOTH the push loop and the existingTeammates.map idle branch"
      - "A resume->re-idle cycle emits the accumulated count (row already present in currentTeammates), not the pre-resume value"
      - "resumeIdleTeammate registers the resumed teammate with the accumulated prior toolCallCount, not 0; the count survives a restart via PersistedTeammateRow/rehydrateIdleTeammate"
      - "IdleTeammate type changes are confined to TeammateManager.ts (or its types module); no wire-protocol/renderer changes needed"
    files_affected:
      - "packages/runtime/src/ai/server/providers/TeammateManager.ts"
    agent_context: |
      Renderer needs no changes for these fixes (verified, target 6): the
      popover header and panel stat read the emitted status/toolCallCount
      directly, and the '> 0' guard at TeammatePanel.tsx:365 renders the
      stat once the field exists (popover renders on !== undefined, so a
      zero-tool teammate reading '0 tool calls' there is truthful, not a
      regression). killAll split: collect running vs idle ids into one
      Map<string,'errored'|'completed'> for the existing single
      emitTeammateUpdate call at :2111 (widen the 'as const' at :2109);
      lastUsedSessionId-undefined still gates the whole emit at :2108 —
      unchanged.

  - id: "3a"
    title: "Tests for idle handoff, abort status, and continuation wording"
    description: |
      End-of-work test task. New file
      TeammateManager.idleHandoff.test.ts (topic-suffixed convention)
      following TeammateManager.stallWatchdog.test.ts's exact mocking
      pattern; killAll emission tests may extend the existing
      abandonIdleTeammates/stopByAgentId describe blocks in
      TeammateManager.test.ts where that is cheaper than re-mocking.
      Continuation-wording assertions import 1a's exported constant.

      Red-first (PRD 003 task 2a precedent): write each test, temporarily
      revert the specific change it covers, confirm it fails, restore,
      confirm green. npm run typecheck && npm run test:prepush green
      before handoff (two known pre-existing failures excluded:
      AgentTranscriptPanel.listenerCleanup.test.tsx,
      MarkdownRenderer.rtl.test.tsx - jsdom localStorage).

      Fulfills R6.
    depends_on: ["1a", "1b", "2a"]
    complexity: 5
    priority: "must"
    success_criteria:
      - "Covers: idle with result text and !sentMessageToLead -> deliverMessageToLead called with display name and captured text (assert arguments, not just invocation)"
      - "Covers: idle with NO result text -> explicit no-result notice delivered"
      - "Covers: idle with sentMessageToLead === true -> bare idle notice delivered, capturedResultText NOT included (D7)"
      - "Covers: background-agent completion path unchanged (still delivers via its own branch, no double delivery)"
      - "Covers: killAll emits 'errored' for running, 'completed' for idle teammates"
      - "Covers: idle metadata entry carries toolCallCount/lastActiveAt in both emitTeammateUpdate paths (push loop and map branch, i.e. resume->re-idle keeps the accumulated count); resume seeds accumulated toolCallCount"
      - "Covers: continuation message constant contains the wait/no-duplication instruction and no open-ended 'other actions' invitation"
      - "@vitest-environment node first line; narrow vi.mock of @anthropic-ai/claude-agent-sdk, AISessionsRepository, claudeConfigDir; no @nimbalyst/runtime barrel mock"
    files_affected:
      - "packages/runtime/src/ai/server/providers/__tests__/TeammateManager.idleHandoff.test.ts"
      - "packages/runtime/src/ai/server/providers/__tests__/TeammateManager.test.ts"
    agent_context: |
      Assert observable behavior (deliverMessageToLead call arguments,
      emitted status overrides, registered toolCallCount), never
      component source text. If a source import specifier changed in
      1a/1b/2a, grep the test tree for stale vi.mock specifiers in the
      same commit (NIM mock-drift lesson).
```

## 6. Open Questions

- **Q1 (explicitly deferred, needs human):** Should teammate idle-handoff messages be visually
  distinguished in the lead's transcript (they arrive as injected user-role prompts today, same
  as PRD 003's failure wakes)? Cosmetic; not blocking.
- **Q2 (resolved during planning, kept for record):** Does fixing the idle handoff require also
  fixing the `abandonIdleTeammates` exhaustion race directly? No — see Decision D3; the wake
  fires from the idle transition itself, which is the racing side, and exhaustion-then-abandon
  now only triggers on teammates that are already idle AND whose handoff was already delivered.
- **Q3 (resolved):** Did weatherman ever SendMessage? No — transcript-proven (24-line JSONL,
  3 tool calls, final plain-text answer, no SendMessage). Both contributors real; fix covers both.
