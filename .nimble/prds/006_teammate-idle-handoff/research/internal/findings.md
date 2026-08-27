# Internal Research — teammate-idle-handoff

Three live-observed bugs in the TEAMMATE lifecycle (TeammateManager.ts / ClaudeCodeProvider.ts
teammate path — NOT the Task-subagent system of PRD 004; do not conflate). Found 2026-08-27
testing teammate "weatherman" (haiku) in lead session c29787e7-8328-4694-8875-f0b45a6a947b,
immediately after PRD 005 made real teammate spawning reachable. All three predate PRD 005 but
were unobservable until it landed. Researched by the coordinator (direct code reads + primary
evidence) plus an independent researcher pass that confirmed every mechanism below against the
code; no corrections were needed.

## Coordinator-verified evidence

### Bug 2 sub-question resolved definitively: weatherman never called SendMessage

Raw teammate transcript read directly from
`~/.claude/projects/-home-jayden-eppcohen-Documents-Projects-Software-nimbalyst/a4844735-e983-4caf-a40b-e7604fafb48a.jsonl`
(24 lines). Tool sequence:

1. 15:47:07 user prompt: "Find current weather for Miami, FL ... Report back ..."
2. 15:47:10 `ToolSearch` (select:WebSearch,WebFetch)
3. 15:47:12 `WebSearch` "current weather Miami Florida today"
4. 15:47:18 `WebFetch` https://www.weather.gov/mfl/
5. 15:47:25 final ASSISTANT TEXT: "**Current Weather for Miami, FL:** It's currently around
   78F in Miami with partly cloudy conditions. ..." — then the turn ended.

No `SendMessage` tool call anywhere. Bug 2 therefore has TWO contributors: (a) the teammate
ended without SendMessage (model-behavior contributor), and (b) the Nimbalyst-side race below.
The teammate made 3 real tool calls — baseline for bug 3's "0 tool calls".

### Bug 2 mechanism (code-verified)

- `ClaudeCodeProvider.handlePostLeadTurnTeammateState` (ClaudeCodeProvider.ts:2424-2474): at
  continuation exhaustion (`continuationCount >= MAX_CONTINUATIONS` = 3 at :268) it calls
  `teammateManager.abandonIdleTeammates(sessionId)` (:2470) then resets
  `continuationCount = 0` (:2471) unconditionally.
- `TeammateManager.abandonIdleTeammates` (TeammateManager.ts:277-295) early-returns when
  `idleTeammates.size === 0`. In the live trace, exhaustion fired at 11:47:24.048 while
  weatherman was still RUNNING (in `managedTeammates`, not `idleTeammates`) — the abandon was
  a silent no-op. Weatherman went idle at 11:47:25.563 (1.5 s later).
- `TeammateManager.handleStreamCompletion` idle branch (TeammateManager.ts:1542-1549): a
  non-background teammate ending with a captured session id is moved to `idleTeammates` with
  only a UI status emit — NOTHING notifies the lead. `deliverMessageToLead` with
  `capturedResultText` exists ONLY in the background-agent branch (:1562-1569, guarded by
  `isBackground && result.capturedResultText && !result.sentMessageToLead`). Idle counts as
  active (`hasActiveTeammates` :233) so `emitAllCompleted` does not fire. Net: teammate idle
  + lead turn already over = permanent silence.
- The 11:59:02 "Clearing 1 idle teammate(s)" / "Removing idle teammate" log lines are
  `TeammateManager.killAll()` (:2093-2100) — NOT a periodic sweep; killAll is called only from
  `ClaudeCodeProvider.abort()` (ClaudeCodeProvider.ts:2227), i.e. a user/system abort ~12 min
  later. There is no periodic idle sweep.

### Bug 3 mechanism (code-verified, two independent defects)

1. "Error" status: `killAll()` (TeammateManager.ts:2078-2115) emits a blanket `'errored'`
   status override for ALL cleared agents including idle ones (:2108-2113). Contrast
   `stopByAgentId` (:2144-2152) and `stop(name)` (:2172-2184), which emit `'completed'` for
   idle teammates. Aborting a session with an idle (finished-work) teammate paints it Error.
2. "0 tool calls": the `scheduleEmitTeammateUpdate` idle-teammates loop
   (TeammateManager.ts:1488-1501) builds the metadata entry WITHOUT `toolCallCount` (and
   without `lastActiveAt`) — running entries (:1474-1484) include it. Also
   `resumeIdleTeammate` re-registers with `toolCallCount: 0` (:2064).
3. Sidebar shows agentType "general-purpose" rather than the spawn model —
   `spawnManagedTeammate` defaults `agentType = taskInput.subagent_type || 'general-purpose'`
   (:1632); `model` is carried separately (:1633) and IS emitted for idle entries (:1496) but
   unused by the panel row.

### Bug 1 mechanism (code-verified)

ClaudeCodeProvider.ts:2465 injects per continuation (up to 3):
`'[System: Your previous turn ended but you still have active agents. Wait for their results, or take other actions as needed.]'`
Live effect: the lead treated "or take other actions as needed" as license to redo the
teammate's own task itself (ToolSearch/WebSearch/WebFetch for the same Miami weather query,
once per continuation, rendered in its own transcript). Fix is wording-only (see target 8):
instruct the lead to WAIT and explicitly NOT duplicate the teammates' work, while still
allowing genuinely-other actions (messaging/stopping a teammate).

### Root-cause structure

One PRD, three sibling defects around one seam — the teammate running→idle transition drops
the handoff on the floor. Bug 2 IS the gap; bug 1 is the continuation loop compensating badly
for it; bug 3 is the same transition losing/miscoloring metadata. Not one literal root cause —
recorded as siblings, deliberately not forced into a single-cause narrative.

## Researcher-verified answers (targets 1-8)

**T1 — capturedResultText/sentMessageToLead are NOT background-only.** `streamTeammateOutput`
(TeammateManager.ts:1745-2025) is the single shared implementation for spawn, resume, and
background paths; both fields populate identically regardless of `isBackground`. Only the
caller `handleStreamCompletion` (:1524-1576) discriminates — the background branch
(:1562-1569) reads them, the idle branch (:1542-1549) does not. No new state tracking needed;
the fix reads fields that already exist.

**T2 — the idle-wake DOES deliver in the observed trace.** After continuation exhaustion the
session stays deferred (`isSessionActive() === true`; `endSession` never called because
`hasActiveTeammates()` still true). `continuationCount`/`teammateIdleMessagePending` reset at
each new lead turn start (ClaudeCodeProvider.ts:1027), so both are clean at exhaustion. A
`deliverMessageToLead` call in the idle branch routes through `interruptWithMessage`'s idle
path (:2385-2399) → `emitTeammateMessageWhileIdle` with correctly-threaded sessionId →
`MessageStreamingHandler.onTeammateMessageWhileIdle` (:1092-1169), whose `isSessionActive`
check (:1103) passes. PRD 003's Door A/B (post-restart) do not apply to this live-process case.

**T3 — latch safety: no new risk.** `teammateIdleMessagePending` resets only when a new
leadQuery starts. A 4th `deliverMessageToLead` call site (existing: SendMessage routing :1981,
background-result :1564, approved-shutdown :2017) uses the same already-audited mechanism,
including the existing `releaseIdleWakeLatch()` safety valve. PRD 003 task 1c's
no-permanent-latch criterion is satisfied by construction.

**T4 — spam guard sound.** `sentMessageToLead` resets to false on every
`streamTeammateOutput` call (spawn, and each resume independently), so gating the new call on
`!result.sentMessageToLead` (mirroring :1562) prevents duplicate wakes across repeated idle
cycles and resumes; no cross-resume state leakage.

**T5 — no Nimbalyst-side report-back instruction exists.** `spawnManagedTeammate` passes
`taskInput.prompt` through verbatim; no systemPrompt override in the SDK options. Nimbalyst
relies entirely on the SDK's own agent-teams system prompt to demand SendMessage — haiku
ignored it. Justifies capture-on-idle over a prompt-only fix; Nimbalyst has no prompt lever.

**T6 — renderer: no distinct "abandoned/no-result" display state exists; 'completed' is the
viable terminal reuse.** `mapTeammateStatus` (subAgentStatus.ts:33-48) has exactly 5 buckets.
TeammateThreadPopover.tsx header/tool-count/footer read the emitted `status`/`toolCallCount`
directly, so fixing killAll's emission ('errored' → 'completed' for idle teammates, matching
stop/stopByAgentId) fixes the header; the "no longer active" footer already treats completed
as inactive — no regression. TeammatePanel.tsx: "0 tool calls" is an OMISSION — idle metadata
entries lack `toolCallCount` entirely so the `> 0` guard (TeammatePanel.tsx:365) renders no
stat. The agentType label (:403) is a pre-existing display choice; `model` is present on the
object but unused in that row.

**T7 — zero existing coverage of bugs 1 and 3.** Repo-wide grep: no test references
`killAll`, `MAX_CONTINUATIONS`, or `handlePostLeadTurnTeammateState`. Extend:
TeammateManager.test.ts (has abandonIdleTeammates/stopByAgentId describe blocks — natural
home for killAll status-emission tests), TeammateManager.resumeReliability.test.ts (PRD 003's
pattern for asserting deliverMessageToLead call arguments),
TeammateManager.stallWatchdog.test.ts (canonical mocking: `@vitest-environment node` first
line; narrow vi.mock of @anthropic-ai/claude-agent-sdk, AISessionsRepository, claudeConfigDir).
No ClaudeCodeProvider test covers continuation wording either.

**T8 — continuation message has no hide mechanism; it becomes a real prompt.** The
`'[System: ...]'` string flows through `emitTeammateMessageWhileIdle` →
`teammate:messageWhileIdle` → `sendMessageHandler(mockEvent, data.message, ...)` as a new
prompt, indistinguishable from a user message at that layer. `hideMessages`/
`markMessagesAsHidden` (used for /context auto-fetch bookkeeping) is never threaded through
this path. Bug 1's fix must be wording-only; there is no hide-on-render lever.

## Open risks carried into planning

- Bug 2's fix depends on `capturedResultText` being non-empty when the teammate never called
  SendMessage — confirmed present for weatherman (SDK end-of-turn result chunk), but a
  teammate whose turn produces no final assistant text has nothing to deliver; scope that
  residual case as a known gap (deliver a bare idle notice, or document), never silently
  claim it covered.
- No test exercises killAll/MAX_CONTINUATIONS/handlePostLeadTurnTeammateState at all —
  greenfield test coverage, raising task complexity relative to a pure bugfix.
- T2's conclusion is specific to the deferred-session, no-restart case. The
  post-restart-then-idle-transition combination is unverified and per PRD 003's own notes may
  not be reachable today (ProviderFactory does not recreate a provider before a lead turn
  post-restart) — explicit non-goal, not silently assumed covered.
