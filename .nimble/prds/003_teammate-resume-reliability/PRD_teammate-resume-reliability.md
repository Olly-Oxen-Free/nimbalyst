# PRD Template (v2)

```yaml
---
feature_name: "Teammate Resume-Delivery Reliability"
feature_slug: "teammate-resume-reliability"
owner: "jeppcohen@gmail.com"
status: "draft"
created_date: "2026-08-25"
target_date: ""
phase: ""
scope_type: "bugfix"
github_project: ""
links: [".nimble/prds/002_teammate-thread-view"]
checkpoint_refs: []
cross_feature_blockers: []
---
```

---

## 1. Executive Summary

**One-liner:** When the lead messages an idle teammate and the resume silently fails, the lead
currently believes the message was delivered and never finds out — this makes that failure honest
and visible instead of silent.

**What's changing:** Resuming an idle teammate today gets an immediate, unconditional "delivered,
do not retry" response before the resumed process has produced any output. If that resume dies —
which happens, especially post-restart, when the underlying session file or subprocess is stale —
nothing tells the lead. It already believes the message landed, ends its own turn, and waits for a
reply that will never come. After this ships: the immediate response is honest about what actually
happened (resume initiated, not confirmed), and a resume that dies wakes the lead with a message
describing the failure instead of only firing a desktop notification.

**Who it's for:** Anyone using Agent Mode who messages a teammate that has gone idle — a routine
action, not an edge case, since teammates go idle constantly between turns of a longer task.

**Done looks like:** Message an idle teammate whose underlying session is dead (simulate via a
stale/invalid resume target). Instead of the lead silently hanging on a reply that never comes, the
lead's own conversation receives a clear message that the resume failed, and can react — retry,
respawn, or tell the user.

**Primary risk:** The headline scenario — a resume failing after a Nimbalyst restart — is
confirmed (not hypothetical) to silently drop the failure wake through two independent doors: a
stale-instance-state `sessionId` lookup, and `onTeammateMessageWhileIdle` bailing when the session
isn't active in `stateManager` (`ai:sendMessageToTeammate` never calls `startSession`). Worse, a
partial fix (wiring the wake without fixing both doors) would actively regress this scenario below
today's behavior — the pre-existing desktop notification gets suppressed by the same guard that
was supposed to replace it. Task 1c fixes both doors; it is not optional and must not be reduced
to "document the gap."

---

## 2. Problem & Context

**Problem statement:** `resumeIdleTeammate` (`TeammateManager.ts:1954-1998`) is fire-and-forget by
design and documented as such (`:1185-1189`), but the lead's own `SendMessage` tool-routing branch
reports success unconditionally: `"Message delivered to idle teammate ... via resume. Do not
retry."` (`:2389-2398`) — before the resumed stream has produced a single chunk. If the resume then
fails, `handleStreamError` (`:1531-1552`) flips the teammate's chip to `errored` and, if it was the
last active teammate, fires `teammates:allCompleted`. The only consumer of that event on a failure
outcome, `onTeammatesAllCompleted` (`MessageStreamingHandler.ts:1172-1210`), plays a failure sound
and shows a desktop notification — it never re-enters the lead's own conversation. (`sendMessageFromHost`'s
`{ delivered: true }` return, by contrast, is already honestly documented as "resume initiated, not
read" — `:1185-1189` — and is not part of this bug; see Non-Goals.)

**Supporting data / evidence:** Directly reproduced and root-caused this session, full trace with
file:line citations in `research/findings.md`. Independently pressure-tested twice: once confirming
a blocking "wait for first chunk before acking" variant risks the PreToolUse hook's own timeout
(hence the honest-immediate-ack shape below instead of a blocking wait), and once by a PRD-review
pass that found the correct fix mechanism already exists in the codebase —
`deliverMessageToLead` (`TeammateManager.ts:1090`) plus `interruptWithMessage`
(`ClaudeCodeProvider.ts:2326-2360`) — rather than the `teammates:allCompleted` aggregate path this
PRD originally (incorrectly) targeted. See `tasks.yaml` task 1b for the corrected mechanism.

**What happens if we don't build this:** Every resume-to-an-idle-teammate that fails is invisible.
The lead's turn ends believing work is in progress; the user sees nothing until they notice the
teammate chip has silently gone to `errored`, or the app just stops responding to that thread of
work. This directly undermines the trust case `002_teammate-thread-view` was built to establish.

**Strategic fit:** Direct continuation of the reliability half of `002_teammate-thread-view` — that
PRD made teammate state visible; this one makes teammate *failure* visible, closing the specific
gap surfaced by using the shipped feature.

**Explicitly out of scope:** Adopting the SDK's native completion hooks (`SubagentStop`,
`TaskCompleted`, `TeammateIdle`) as a unified replacement for Nimbalyst's hand-rolled completion
detection. A scope review found hooks cannot observe this bug's failure mode at all — a resume that
dies at or before spawn fires no hook, only a rejected query iterator, which is exactly what
`handleStreamError` already catches — so hook adoption would not fix this problem, and carries its
own unresolved risk (per-teammate-process hook scoping is unverified). Filed as a separate
follow-on PRD (see Open Questions) with a scoping spike as its entry gate, not bundled here.

---

## 3. Goals, Non-Goals & Success Metrics

### Goals

1. The immediate response to resuming an idle teammate accurately reflects what's known at that
   moment (resume initiated, not confirmed) rather than overclaiming "delivered."
2. A resume that fails wakes the lead's own conversation with a message describing the failure,
   via the existing `deliverMessageToLead` mechanism, not only a desktop notification.
3. This works for the post-restart case specifically — the scenario this PRD exists for — not just
   the same-process case, verified rather than assumed.

### Non-Goals

- Adopting SDK-native completion hooks (`SubagentStop`/`TaskCompleted`/`TeammateIdle`) — separate
  follow-on PRD, see above.
- Any change to how a teammate is spawned fresh. `handleStreamError` reports a fresh-spawn failure
  to the lead's conversation no better than a resume failure today — but a fresh spawn was never
  preceded by a premature "delivered" claim the way a resume is, so there's no honesty bug to fix
  on that path, and adding a lead-wake for fresh-spawn failures too is a separate, reasonable but
  out-of-scope improvement.
- Changing `sendMessageFromHost`'s `delivered: true` return value or type — already honest at that
  layer, and changing it would regress the UI (see task 1a).
- UI/chip changes — the chip already correctly flips to `errored`; this PRD is entirely about what
  reaches the lead's conversation.

### Success Metrics

| Metric | Baseline | Target | How Measured |
| ------ | -------- | ------ | ------------ |
| Resume failures that reach the lead's conversation | 0% (silent) | 100%, including post-restart | Unit test: resume query rejects before first chunk → `deliverMessageToLead` called, both live-process (1b) and post-restart with the session inactive in `stateManager` (1c) |
| False "delivered" claims on a resume that later fails | Always (unconditional) | Never | Unit test asserting the model-facing strings no longer say "do not retry" unconditionally |
| Duplicate notification on a resume failure | N/A | 0 (single signal reaches the lead, no separate desktop notification) | Unit test asserting `announceTeammatesCompletion`'s failure notification does not also fire |

---

## 4. Requirements

### Must Have (blocks launch)

| ID | Requirement | Acceptance Criteria |
| -- | ----------- | -------------------- |
| R1 | Honest model-facing ack on resume | The two model-facing strings for resuming an idle teammate (`TeammateManager.ts` ~2389/2398) no longer state unconditional delivery ("do not retry"); they accurately describe "resume initiated" without claiming the message was read. `sendMessageFromHost`'s return value is untouched. |
| R2 | Failure re-enters the lead's conversation (lead process live) | When `handleStreamError` fires for a teammate that was resumed (not freshly spawned) while the lead's process is alive, it calls the existing `deliverMessageToLead` (`:1090`) with a message describing the failure — the same mechanism already used for background-agent results (`:1517`) and approved shutdowns (`:1942`), not a new parallel path |
| R3 | No duplicate signal spam | The desktop notification for the same failure does not also fire independently, in either the mid-turn or idle-but-live case — satisfied as an emergent property of `isLeadBusy()` returning true via two different branches (`leadQuery !== null` mid-turn, `teammateIdleMessagePending` idle-but-live), which makes `onTeammatesAllCompleted` return early before `announceTeammatesCompletion` runs. Verify both branches; it is not new code to write, but it is two mechanisms, not one. |
| R4 | Non-idle lead handled | If the lead is mid-turn when the resume failure arrives, `interruptWithMessage` (`ClaudeCodeProvider.ts` ~2326-2360) already interrupts it correctly — this requirement is satisfied by using `deliverMessageToLead` at all, not by new queueing logic |
| R5 | Idempotent, per-teammate delivery | Each failed resume independently calls `deliverMessageToLead` for its own teammate — satisfied by construction (called directly from `handleStreamError`, not through any aggregate "last teammate" check), not something to build separately |
| R6 | Post-restart delivery actually works, not just tested | Confirmed during review (not hypothetical): post-restart, the wake is silently dropped through two doors — a stale-instance-state `sessionId` lookup, and a session-active check that's never satisfied because nothing starts the session. Both must be fixed (task 1c). "Document the gap" is explicitly not an acceptable outcome here — shipping 1b without 1c makes the post-restart case strictly worse than today (drops the wake AND suppresses the pre-existing desktop notification AND never ends the session). |

---

## 5. Task Breakdown

Four tasks, four waves. 1a and 1b are sequenced (both touch TeammateManager.ts, and 1b builds on
1a's wording). 1c is its own task because the post-restart fix spans packages/electron/src/main
(require_review), unlike 1a/1b which stay entirely in packages/runtime -- confirmed during PRD
review that the same-process wake (1b) and the post-restart wake (1c) are genuinely different
fixes in different files, not one task artificially split. 2a is the end-of-work test task, gated
on all three.

```yaml
# ============================================================
# NIMBLE TASK DEFINITIONS
# Parsed by the orchestrator for execution planning.
# ============================================================

metadata:
  prd_slug: "teammate-resume-reliability"
  created_at: "2026-08-25T00:00:00Z"
  total_complexity: 17
  task_count: 4

tasks:
  - id: "1a"
    title: "Honest model-facing ack for teammate resume"
    description: |
      Change the two model-facing strings that make the lead believe a
      resumed message was definitely delivered, when resumeIdleTeammate is
      actually fire-and-forget. Both live in the SendMessage tool-routing
      branch (TeammateManager.ts ~2374-2401): the logSyntheticToolPair
      result text at ~2389 and the denyPreToolUse response at ~2398, both
      currently reading "Message delivered to idle teammate ... via
      resume. Do not retry." Reword to convey "resume initiated" without
      claiming the message was read.

      IMPORTANT: do NOT change sendMessageFromHost's delivered:true
      return value (~1213/1225) or its type signature. That boolean is
      already honest at the host/UI layer -- its own docstring
      (~1185-1189) already states delivered:true means "resume initiated,
      not necessarily read." It also propagates through
      ClaudeCodeProvider.ts, AIService.ts, electron.d.ts, and a renderer
      consumer; changing it would make a successful resume render as a
      failed send in the UI, which is out of scope and unnecessary -- the
      actual bug is only in the two model-facing strings above.

      The shutdown-request handshake (~2341-2372, wording at ~2359/2369,
      "sent ... awaiting approval") was checked during PRD review: it
      never claims delivery or says "do not retry" -- already honest,
      needs no change. Confirm this still holds at implementation time but
      do not spend effort rewording it absent a reason.

      research/findings.md's "Superseded by PRD review" section lists
      every rejected implementation shape from earlier drafts of this
      research -- read it before the rest of the document so you don't
      follow an instruction that was later reversed.

      Fulfills R1.
    depends_on: []
    complexity: 3
    priority: "must"
    success_criteria:
      - "The logSyntheticToolPair result text and denyPreToolUse response for resuming an idle teammate (TeammateManager.ts ~2389/2398) no longer contain unconditional 'delivered ... do not retry' language"
      - "sendMessageFromHost's delivered:true return value, its type signature, and all downstream consumers (ClaudeCodeProvider.ts, AIService.ts, electron.d.ts, renderer) are completely unchanged by this task"
      - "The shutdown-request handshake's wording is confirmed unchanged (already honest, verified during PRD review) -- not silently rewritten"
      - "Any existing test assertions on the old model-facing wording (if present) are updated to match the new strings"
    files_affected:
      - "packages/runtime/src/ai/server/providers/TeammateManager.ts"
    agent_context: |
      This is a wording-only change to two strings in one method
      (the SendMessage tool-routing branch, not sendMessageFromHost).
      resumeIdleTeammate itself stays fire-and-forget; only what the
      model-facing tool_result claims about that fact changes.

  - id: "1b"
    title: "Resume-failure wake for the lead's conversation (live-process case)"
    description: |
      When handleStreamError (TeammateManager.ts ~1531-1552) fires for a
      teammate that was resumed (not freshly spawned) WHILE the lead's own
      process is still alive (whether mid-turn or idle-but-not-restarted),
      call the existing deliverMessageToLead (~1090) to put a failure
      message in front of the lead -- this is the correct, already-proven
      mechanism (already used for exactly this shape of thing at ~1517 and
      ~1942), NOT teammates:allCompleted/announceTeammatesCompletion,
      which only fires when ALL teammates are done and cannot satisfy
      per-teammate, idempotent delivery.

      deliverMessageToLead calls deps.interruptWithMessage(), which
      (ClaudeCodeProvider.ts ~2326-2360) either interrupts a mid-turn lead
      (leadQuery !== null branch, ~2349-2368) or triggers a fresh
      sendMessage on an idle-but-live one (~2332-2346). This satisfies the
      non-idle-lead requirement (R4) without new queueing logic. Both
      branches make isLeadBusy() (ClaudeCodeProvider.ts ~2629-2631) return
      true for a different reason each -- mid-turn via leadQuery !== null,
      idle-but-live via teammateIdleMessagePending being set -- which in
      both cases makes onTeammatesAllCompleted return early
      (MessageStreamingHandler.ts ~1182-1185) before
      announceTeammatesCompletion's desktop notification fires. This is
      how R3 (no duplicate notification) is satisfied in this task's
      scope, by relying on the existing guard, not by building new
      suppression logic -- but note it's two different code paths
      producing the same effect, not one, so test both (2a).

      New state needed: ManagedTeammate entries created via
      resumeIdleTeammate (~1974-1989) are structurally identical to ones
      from spawnManagedTeammate today -- handleStreamError cannot tell
      them apart. Add a marker (e.g. a `wasResumed` flag), and read it
      BEFORE handleStreamError deletes the managedTeammates entry at
      ~1539 (mirror how `isBackground` is already captured at ~1537
      before the same delete). Only trigger this new wake path when
      wasResumed is true -- a fresh-spawn failure is out of scope (see
      Non-Goals).

      OUT OF SCOPE FOR THIS TASK, covered by 1c instead: the case where
      the lead's Nimbalyst process was restarted and its session is not
      marked active in stateManager. That case is confirmed (not
      hypothetical) to silently drop this task's wake call today, through
      a mechanism unrelated to anything in TeammateManager.ts -- see 1c.
      Do not attempt to fix it here; this task's scope is "the lead
      process is alive," full stop.

      Fulfills R2, R3 (live-process branches only), R4 (live-process
      case only).
    depends_on: ["1a"]
    complexity: 4
    priority: "must"
    success_criteria:
      - "A teammate resume that fails (handleStreamError fires) while the lead's process is alive calls deliverMessageToLead with a message describing the failure -- verified by asserting deliverMessageToLead was invoked with the correct sessionId/agentId/teammateName (the display name, not the team name)/content, not just that some event fired"
      - "A teammate that errors on a FRESH spawn (not a resume) does NOT trigger this new wake path -- verified via the new wasResumed marker being false/absent for spawnManagedTeammate-created entries, read before the ~1539 delete"
      - "No new desktop-notification-suppression code is added for the live-process case -- the existing isLeadBusy() guard (true via leadQuery!==null when mid-turn, via teammateIdleMessagePending when idle-but-live) is what prevents the duplicate notification in both branches; verify both, don't assume symmetry"
      - "Two teammates resumed concurrently that both fail near-simultaneously each independently call deliverMessageToLead -- no dependency on emitAllCompleted or teammates:allCompleted for this path"
    files_affected:
      - "packages/runtime/src/ai/server/providers/TeammateManager.ts"
    agent_context: |
      Do not touch teammateCompletionSignal.ts, ClaudeCodeProvider.ts, or
      MessageStreamingHandler.ts for this task -- the PRD reviewer
      confirmed the existing deliverMessageToLead + interruptWithMessage +
      isLeadBusy machinery already does everything R2-R4 need for the
      live-process case; this task wires handleStreamError into it, it
      does not add a parallel notification system and does not touch the
      post-restart path (1c's job). See ~1517 and ~1942 for two existing
      deliverMessageToLead call sites to match the calling convention
      against.

  - id: "1c"
    title: "Resume-failure wake survives a Nimbalyst restart"
    description: |
      1b's wake only reaches the lead while its process is alive. Confirmed
      (not hypothetical) during PRD review: post-restart, the wake is
      silently dropped through two independent doors, and the situation is
      WORSE than doing nothing, not neutral -- fix both, do not fall back
      to "document the gap."

      Door A -- wrong/missing sessionId. interruptWithMessage's idle
      branch calls emitTeammateMessageWhileIdle (ClaudeCodeProvider.ts
      ~2549-2555), which sources its emitted sessionId from
      this.teammateManager.lastUsedSessionId (~2552) -- a field only ever
      set while a live lead query is running (sdkOptionsBuilder.ts:333;
      also documented at TeammateManager.ts:2047). Post-restart it is
      undefined, even though a real, correct sessionId was already passed
      explicitly into deliverMessageToLead by 1b's caller. Fix: thread the
      sessionId that was actually passed in through to
      emitTeammateMessageWhileIdle's emitted payload instead of falling
      back to lastUsedSessionId -- the same "thread it explicitly, don't
      read stale instance state" pattern TeammateManager.stopByAgentId
      already uses for the same class of post-restart gap (see its
      docstring for the precedent).

      Door B -- isSessionActive false negative. Even with a correct
      sessionId, onTeammateMessageWhileIdle
      (MessageStreamingHandler.ts ~1103-1106) bails when
      stateManager.isSessionActive(sessionId) is false, before its own
      startSession call at ~1112 -- because ai:sendMessageToTeammate
      (AIService.ts ~3208-3239) never calls startSession at all. Fix this
      handler (or the AIService caller) so a post-restart failure wake
      results in the session being marked active / started as needed,
      rather than bailing.

      Why "document the gap" is not an acceptable fallback here: once
      deliverMessageToLead runs, interruptWithMessage drains the pending
      message queue (~2341) and, on the idle branch, latches
      teammateIdleMessagePending = true (~2550) BEFORE the drop happens at
      either door. That flag is only reset when the next lead query starts
      (ClaudeCodeProvider.ts:1010) -- which never happens post-restart
      until the user sends a new message. Until then, isLeadBusy() returns
      true, so onTeammatesAllCompleted returns early
      (MessageStreamingHandler.ts ~1182-1185) BEFORE endSession and BEFORE
      announceTeammatesCompletion's desktop notification. Net effect of
      shipping 1b without this task: no lead wake (still dropped), no
      desktop notification (newly suppressed), and a session that never
      ends -- strictly worse than today, where the user at least gets the
      notification. This task is not optional polish; it's required for
      1b to be a net improvement rather than a regression in the exact
      scenario this PRD exists for.

      Fulfills R2, R3, R4, R6 (post-restart specifically).
    depends_on: ["1b"]
    complexity: 6
    priority: "must"
    success_criteria:
      - "A resume-failure wake fired post-restart (session not active in stateManager, lastUsedSessionId undefined) reaches the lead's conversation -- both doors verified independently, not just the combined happy path"
      - "The sessionId emitTeammateMessageWhileIdle uses is the one explicitly passed through the call chain from deliverMessageToLead's caller, not this.teammateManager.lastUsedSessionId"
      - "onTeammateMessageWhileIdle no longer silently bails on !isSessionActive for this path -- either the session gets started/marked active as part of delivering the wake, or an equivalent fix is applied that results in the message actually reaching the user"
      - "If, after implementation, some sub-case genuinely cannot be fixed (should be rare given the above), it MUST fall back to preserving today's behavior (the desktop notification still fires, the session still ends) -- silently doing neither is not an acceptable outcome under any circumstance"
      - "teammateIdleMessagePending is not left permanently latched when a post-restart wake cannot be delivered through door A or B -- confirm the session can still end via some path"
    files_affected:
      - "packages/runtime/src/ai/server/providers/TeammateManager.ts"
      - "packages/runtime/src/ai/server/providers/ClaudeCodeProvider.ts"
      - "packages/electron/src/main/services/ai/MessageStreamingHandler.ts"
      - "packages/electron/src/main/services/ai/AIService.ts"
    agent_context: |
      This task is under require_review per .nimble/config.yaml
      boundaries (packages/electron/src/main/** for two of its files) --
      expected at the single end-of-work review, not a surprise. Read
      TeammateManager.ts's stopByAgentId docstring in full before
      starting -- it documents the exact same "lastUsedSessionId is only
      set while a live lead query is running" gap for a different action
      (Stop) and how that action's fix threads the sessionId explicitly
      instead; this task should follow the same pattern for the wake
      path rather than inventing a new one. Do not assume the fix is
      confined to TeammateManager.ts -- the PRD review traced both doors
      into packages/electron/src/main, which is why this is a separate
      task from 1b rather than folded into it.

  - id: "2a"
    title: "Tests for resume-delivery reliability"
    description: |
      Dedicated end-of-work test task, TeammateManager.resumeReliability.test.ts
      per this codebase's topic-suffixed test file convention. Since this
      task is gated behind 1a/1b/1c (wave 4), "red-first" here means:
      write each test, temporarily revert the specific change it covers,
      confirm the test fails, restore the change, confirm it passes -- not
      writing tests before the fix exists in the codebase at all.

      Must land before the single end-of-work integration review; npm run
      typecheck && npm run test:prepush must be green.
    depends_on: ["1a", "1b", "1c"]
    complexity: 4
    priority: "must"
    success_criteria:
      - "Covers: resume-then-fail no longer produces the old 'delivered ... do not retry' model-facing strings"
      - "Covers: resume-then-fail while the lead is mid-turn calls deliverMessageToLead AND suppresses the desktop notification via the leadQuery!==null branch of isLeadBusy()"
      - "Covers: resume-then-fail while the lead is idle-but-live calls deliverMessageToLead AND suppresses the desktop notification via the teammateIdleMessagePending branch of isLeadBusy() -- a DIFFERENT code path from the mid-turn case, both must be tested, not just one"
      - "Covers: resume-then-fail post-restart (session not active, lastUsedSessionId undefined) reaches the lead -- proves 1c's fix actually works, not just that it compiles"
      - "Covers: a fresh-spawn failure does NOT call the new wake path (wasResumed marker distinguishes correctly)"
      - "Covers: two concurrent resume failures each independently trigger their own deliverMessageToLead call"
      - "Confirms the shutdown-request handshake's behavior and wording are unaffected -- no pre-existing test suite covers this path today, so this task adds minimal coverage for it rather than claiming to 're-run existing tests' that don't exist"
      - "@vitest-environment node as the first line; narrow vi.mock of @anthropic-ai/claude-agent-sdk, AISessionsRepository, AND claudeConfigDir (../claudeCode/claudeConfigDir, keeps team-config writes out of ~/.claude) -- per TeammateManager.stallWatchdog.test.ts's exact pattern"
    files_affected:
      - "packages/runtime/src/ai/server/providers/__tests__/TeammateManager.resumeReliability.test.ts"
    agent_context: |
      Follow TeammateManager.stallWatchdog.test.ts's mocking pattern
      exactly (narrow mocks, literal SDK-shaped chunk fixtures, small
      tuned timing constants). Never assert on component source text;
      assert observable behavior (returned values, deliverMessageToLead
      call arguments, the wasResumed marker's effect, isSessionActive
      state transitions for the post-restart case).
```



## 6. Open Questions

- **Q1 (follow-on PRD, not this one):** Should Nimbalyst adopt the SDK's native `SubagentStop`
  hook to replace the hand-rolled `SUBAGENT_DRAIN` chunk-watching for native Task sub-agents? A
  scope review found this is safe and unambiguous (fires within the lead's own query, no
  process-scoping question) — a reasonable first slice of a separate hook-adoption PRD, whose
  entry gate should be a spike answering whether `TeammateIdle`/`TaskCompleted` even fire
  observably for a `TeammateManager` teammate, given each teammate is its own top-level `query()`
  process rather than a nested subagent of the lead.
- **Q2 (resolved during review, kept for record):** Does the shutdown-request handshake's wording
  need the R1 change too? No — checked directly (`:2359`/`:2369`), it already says "sent ...
  awaiting approval" and never claims delivery. Task 1a confirms this holds rather than re-deriving
  it, per its success criteria.
