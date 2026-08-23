# Research Findings: Agent Visibility

## Scope

Verify, with file:line evidence, whether Nimbalyst already has the sub-agent visibility/control
behaviors requested in tracker item `tsk_mt1xxymgata1sw`, comparing against native Claude Code
behavior. Docs read in full: `docs/SESSION_HIERARCHY.md`, `docs/WORKTREES.md`, `docs/JOTAI.md`,
`docs/IPC_LISTENERS.md`, `docs/INTERACTIVE_PROMPTS.md`.

## Three different "spawned agent" systems exist

| System | What it is | Own `ai_sessions` row? | Where tracked |
| --- | --- | --- | --- |
| **SDK-native Task sub-agents** | Claude Agent SDK's built-in `Task` tool; runs in-process inside the lead's `query()` | No — never persisted | `TaskInfo` in session `metadata.currentTasks` |
| **Nimbalyst "Teammates"** | Nimbalyst's own team system (`TeamCreate`/`SendMessage`), spawns a separate `query()` per teammate via `TeammateManager` | No — SDK session id kept in-memory for resume only | `TeammateInfo` in session `metadata.currentTeammates` |
| **Meta-Agent child sessions** | "Meta-Agent Mode" — a dedicated mode where the lead spawns real, independent `ai_sessions` rows | Yes — full row, own transcript | `meta-agent:list-spawned-sessions` IPC, `MetaAgentMode.tsx` |

The tracker item's "in claude chat, agents will be created" most plausibly describes the first two
(Task sub-agents / Teammates spawned mid-conversation) — that's what's being compared to "native
Claude Code." Meta-Agent Mode is a separate, opt-in mode, already closer to what's asked but gated
behind switching modes.

## Per-ask status

### 1. Blocked agent asks for permission in main thread — partially exists

- SDK-native Task sub-agents inherit the same `canUseTool` callback as the lead's `query()`
  (no per-Task override) — `packages/runtime/src/ai/server/providers/ClaudeCodeProvider.ts:3648`
  (`createCanUseToolHandler`), routing at `:3705-3760`. A permission prompt from a Task sub-agent
  already surfaces through the lead session's `ToolPermissionService`.
- Teammates: the lead's `sessionId` is passed explicitly into
  `createCanUseToolHandler(sessionId, cwd, permissionsPath, name)` at
  `packages/runtime/src/ai/server/providers/TeammateManager.ts:1465` — a teammate's permission
  request is attributed to and rendered under the lead session.
- **Gap:** neither `TeammateInfo.status`
  (`packages/electron/src/renderer/components/AgentMode/TeammatePanel.tsx:30`, values
  `'running'|'completed'|'errored'|'idle'`) nor `TaskInfo.status`
  (`packages/electron/src/renderer/store/atoms/agentMode.ts:233`, values
  `'running'|'completed'|'failed'|'stopped'`) has a `blocked`/`waiting_for_permission` state. A
  blocked sub-agent's row keeps showing the "running" spinner (`TeammatePanel.tsx:343-345`) — no
  visual cue on the sub-agent's own row that it's the one waiting on you.
- Meta-Agent child sessions do carry `pendingPrompt` (`MetaAgentMode.tsx:31-34`) and render
  "Waiting for {promptType}" (`MetaAgentMode.tsx:538-542`) — the one place a blocked state is
  distinctly labeled, but only inside the Meta-Agent dashboard, and nothing pushes it proactively
  (see #5).

### 2. Agents listed as chips in a horizontal line above the chat box — missing as specified

None of Nimbalyst's three agent-list surfaces is a horizontal chip row above the message input:

- `TeammatePanel` (`packages/electron/src/renderer/components/AgentMode/TeammatePanel.tsx`) —
  vertical, collapsible list with "Teammates"/"Sub-agents" sections, rendered inside
  `FilesEditedSidebar`, the file-diff sidebar on the **right** of the workstream layout
  (`FilesEditedSidebar.tsx:57,653`; parent comment `AgentWorkstreamPanel.tsx:13` confirms "right").
  Not adjacent to the chat input.
- `AgentSessionsPopover`
  (`packages/electron/src/renderer/components/NavigationGutter/AgentSessionsPopover.tsx`) —
  click-to-open popover anchored to an icon in the left `NavigationGutter` rail
  (`NavigationGutter.tsx:342`), lists whole *sessions* (not in-conversation sub-agents), with
  awaiting/running/unread coloring (`AgentSessionsPopover.tsx:34-50`). Not persistent, not
  horizontal.
- `MetaAgentMode` dashboard (`MetaAgentMode.tsx:447-565`) — fixed right-hand aside (`w-[360px]`)
  with vertically stacked cards, only present in the dedicated mode.

Fully missing as a UI surface, though it can source data from the already-existing
`sessionTeammatesAtom`/`sessionTasksAtom` (`packages/electron/src/renderer/store/atoms/agentMode.ts:223-253`).

### 3. Agents colored based on status — partially exists, split across unrelated systems

- Session-level status-coloring infra is mature: `sessionHasPendingInteractivePromptAtom`,
  `sessionOrChildProcessingAtom`, `sessionPendingPromptAtom`, `sessionUnreadAtom`, aggregated in
  `groupSessionStatusAtom` (`packages/electron/src/renderer/store/atoms/sessions.ts:1052-1080`),
  consumed by `SessionStatusIndicator` across `SessionListItem.tsx`, `WorkstreamGroup.tsx`,
  `BlitzGroup.tsx`, `AgentSessionsPopover.tsx`, `SessionDropdown.tsx`. Good reusable pattern — but
  it's for whole sessions, not in-conversation sub-agents.
- Sub-agent-level coloring exists only in `TeammatePanel.tsx` (`:342-355` teammates, `:267-277`
  tasks): spinner=running, hollow circle=idle, filled dot=completed/errored. Missing a `blocked`
  state (see #1).
- `MetaAgentMode.tsx` has its own separate status→color mapping (`getStatusTone`/`getBarTone`,
  lines 67-104) using `'running'|'waiting_for_input'|'error'|'interrupted'` — a third, disjoint
  status vocabulary. A unifying chip feature needs to reconcile three different status enums, not
  invent a fourth.

### 4. Click an agent to load its thread and communicate directly — missing for the two systems the ticket is about; exists only for Meta-Agent Mode

- **Teammates**: `TeammateItem.handleClick` → `scrollToTeammateAtom`
  (`TeammatePanel.tsx:61-63,307-309`) — scrolls the existing single transcript to the spawn point;
  does not open a separate thread or let you message the teammate directly (no UI control wired to
  it, though `TeammateManager.flushPendingMessages`/`appendToInbox` at
  `TeammateManager.ts:957-1011` could support one).
- **SDK-native Task sub-agents**: their assistant turns are actively **hidden** from the visible
  transcript by design — `claudeCliSubAgentTracker.ts:20-22` states this explicitly ("so they
  don't pollute the visible transcript"). There is no persisted separate thread to click into.
- **Meta-Agent Mode child sessions** are real `ai_sessions` rows; "Open In Agent"
  (`MetaAgentMode.tsx:550-559`, `data-testid="meta-agent-open-session"`) does exactly what's asked
  via `onOpenSessionInAgent`. Proves the pattern is buildable — just scoped to one mode today.

### 5. Main thread always notified when an agent dies/ends/is blocked unexpectedly — missing as an automatic guarantee

- `TeammateManager.handleStreamError` (errored) and the "all completed" path both funnel into the
  same `teammates:allCompleted` event (`TeammateManager.ts:1264-1266`, `:1287-1289`). The listener
  (`onTeammatesAllCompleted`,
  `packages/electron/src/main/services/ai/MessageStreamingHandler.ts:1109-1136`) just ends the
  session and plays the same completion sound used for success — no error-specific notification. A
  teammate that crashes and happens to be the last active one produces identical UX to a clean
  finish.
- The one channel that pushes a real desktop/mobile notification is `notify_user`, an MCP tool the
  agent must **voluntarily call** (`MetaAgentService.notifyUserJson`,
  `packages/electron/src/main/services/MetaAgentService.ts:1045-1109`). Opt-in per-agent-turn, not
  a system guarantee — if the model crashes before calling it, nothing fires.
- `notificationService.showBlockedNotification` already exists and is used for top-level session
  permission/AskUserQuestion blocks
  (`packages/electron/src/main/mcp/tools/interactiveToolHandlers.ts:671,1070,1548`;
  `MessageStreamingHandler.ts:899,951,995`) but is **never called** from `TeammateManager`'s
  error/idle paths or Meta-Agent `pendingPrompt` detection — the hook point exists, it's just not
  wired to sub-agent lifecycle.

## Summary table

| # | Ask | Status | Key evidence |
| --- | --- | --- | --- |
| 1 | Blocked agent asks for permission in main thread | Partially exists | `ClaudeCodeProvider.ts:3648`, `TeammateManager.ts:1465` route correctly; no `blocked` status in `TeammatePanel.tsx:30`/`agentMode.ts:233` |
| 2 | Agents as horizontal chips above chat box | Missing (UI surface) | All existing lists are vertical/side/popover: `TeammatePanel.tsx` (right sidebar), `AgentSessionsPopover.tsx` (gutter popover), `MetaAgentMode.tsx:447` (fixed aside) |
| 3 | Colored by status | Partially exists | `sessions.ts:1052` `groupSessionStatusAtom` (session-level, reusable pattern); `TeammatePanel.tsx:342-355` (sub-agent-level, no `blocked`); 3 divergent status enums |
| 4 | Click to load agent's own thread | Missing for in-session sub-agents; exists for Meta-Agent children | `TeammatePanel.tsx:61-63` only scrolls; `claudeCliSubAgentTracker.ts:20-22` hides Task turns by design; `MetaAgentMode.tsx:550-559` has real open-thread |
| 5 | Main thread always notified on death/block | Missing as automatic guarantee | `TeammateManager.ts:1264-1289` + `MessageStreamingHandler.ts:1109-1136` don't distinguish error from success; `notify_user` is opt-in (`MetaAgentService.ts:1045`); `showBlockedNotification` unwired to sub-agent lifecycle |

## Files most relevant to implementation

- `packages/electron/src/renderer/components/AgentMode/TeammatePanel.tsx` — current sub-agent status list UI
- `packages/electron/src/renderer/store/atoms/agentMode.ts:223-253` — `sessionTeammatesAtom`, `sessionTasksAtom`, `TaskInfo` type
- `packages/runtime/src/ai/server/providers/TeammateManager.ts` — teammate lifecycle/status transitions, `emitTeammateUpdate`
- `packages/electron/src/main/services/ai/claudeCliSubAgentTracker.ts` — where Task sub-agent turns are hidden from transcript
- `packages/electron/src/main/services/NotificationService.ts` — `showBlockedNotification` (existing primitive to wire in)
- `packages/electron/src/main/services/ai/MessageStreamingHandler.ts:1109-1160` — where `teammates:allCompleted` is handled
- `packages/electron/src/renderer/components/MetaAgentMode/MetaAgentMode.tsx` — proof-of-concept for open-thread (line 550-559) and blocked-state surfacing (line 538-542)
- `packages/electron/src/renderer/store/atoms/sessions.ts:1052` — `groupSessionStatusAtom`, the derived-atom pattern to reuse for chip coloring

## Note on stale doc reference

Root `CLAUDE.md` documents `packages/collabv3/` as the collab server package, but no
`packages/collabv3` directory exists in this checkout — the actual collab-related workspaces are
`packages/collab-protocol`, `packages/collab-client`, `packages/collab-bundle`,
`packages/collab-adapters`. Unrelated to this feature but worth flagging separately.

External research: out of scope for this pass — the task was verification against a known
reference behavior (native Claude Code), not a request for external best-practice/library
research.

## Additional Research: Hang Detection and Wake-Delivery Gaps

Scoped follow-up investigating a failure mode distinct from the five asks above: "a sub-agent is
spawned to report back, and either it never reports (silent hang) or the main session never wakes
up (delivery bug)." Investigated for all three spawn paths the user named — Teammates
(`TeammateManager`), SDK-native Task sub-agents (`ClaudeCodeProvider`), and NIMBLE's own
`nimble-pm` orchestration of worker agents via the `Agent` tool — with file:line evidence for
each. Docs read in full for this pass: none new; `docs/IPC_LISTENERS.md` and
`docs/INTERACTIVE_PROMPTS.md` were grepped for a queue/badge/wake mechanism that could compensate
for the gaps found below and did not surface one beyond what's cited.

### 1. Silent hang, no emit event at all

**SDK-native Task sub-agents — a real stall watchdog exists, but it is architecturally disarmed
for exactly the "sub-agent stuck" case.**

- `ClaudeCodeProvider.ts` imports and uses a purpose-built stream-stall watchdog
  (`packages/runtime/src/ai/server/providers/claudeCode/streamStallWatchdog.ts`, referenced at
  `ClaudeCodeProvider.ts:130-134`). It races every `iterator.next()` against a stall timer
  (`raceNextChunkWithStallWatchdog`, `streamStallWatchdog.ts:84-118`) and, on timeout, aborts the
  subprocess and throws (`ClaudeCodeProvider.ts:1138-1150`). Default window is 10 minutes
  (`DEFAULT_STREAM_STALL_MS = 600_000`, `streamStallWatchdog.ts:35`, overridable via
  `NIMBALYST_CC_STREAM_STALL_MS`). This is real, tested infrastructure (NIM-1481, GitHub #802) —
  not a missing primitive.
- **But it is only armed pre-result, with no tool executing and no running task:**
  `shouldArmStreamStallWatchdog` (`streamStallWatchdog.ts:56-66`) returns `false` whenever
  `resultReceivedTime !== null` OR `outstandingToolCalls > 0` OR `hasRunningTasks` is true. Once a
  Task sub-agent starts running (`hasRunningTasks() === true`,
  `ClaudeCodeProvider.ts:2649-2651`), or once the lead's own `result` chunk has already arrived
  (which is exactly when a sub-agent typically keeps running solo,
  `ClaudeCodeProvider.ts:1118-1123`), the watchdog is **permanently disarmed for the rest of that
  turn** — the state check is `resultReceivedTime === null`, not "no chunk from this specific
  source." A Task sub-agent that goes silent mid-turn while the lead's answer is already done is
  the one case the watchdog is built to exclude, not catch.
- **The only thing left covering that window is a 5-minute reset-on-any-chunk drain timer, and it
  detects total silence, not per-sub-agent silence.** `SUBAGENT_DRAIN_GRACE_MS = 5 * 60_000`
  (`ClaudeCodeProvider.ts:1038`) governs `armPromptEndTimer`, which resets on **every** chunk of
  any kind (`ClaudeCodeProvider.ts:1196,1200`) — including chunks from an unrelated concurrent
  sub-agent or the file-watcher/task-list system reminders. With two Task sub-agents running
  concurrently, one stuck forever and one still working, the timer keeps resetting off the healthy
  one and the stuck one is never individually flagged. Even when the 5-minute timer does fire, it
  only calls `promptController.end(reason)` — closes stdin for new prompt input
  (`sdkOptionsBuilder.ts:86-133`) — it does not itself declare the sub-agent dead or notify anyone;
  detection only happens reactively, if and when that stdin closure eventually causes the SDK
  iterator itself to end or throw, which is then caught by `finalizeBackgroundDrain`
  (`ClaudeCodeProvider.ts:2668-2716`, discussed under Gap 2 below).
- **Conclusion:** partially wired, with a real gap. The watchdog primitive and pattern exist and
  are proven (NIM-1481); they are just scoped to protect the *lead's own* pre-result stream, not a
  *background sub-agent's* stream once it's running solo. No code applies the same
  race-against-a-timer pattern to an individual running Task sub-agent's chunk cadence.

**Nimbalyst Teammates — no watchdog at all; the exact NIM-1481 bug class, unfixed on this path.**

- `TeammateManager.spawnTeammate`'s core loop is a plain `for await (const chunk of teammateQuery)`
  (`packages/runtime/src/ai/server/providers/TeammateManager.ts:1493`) — no race, no timer, no
  abort-on-silence. This is the identical shape of loop the streamStallWatchdog comment
  (`streamStallWatchdog.ts:4-11`) describes as the bug: "the SDK subprocess can go silent mid-turn
  ... WITHOUT emitting a result, an error, or ending the iterator ... that await blocks forever."
  The fix built for the lead session (`raceNextChunkWithStallWatchdog`) was never applied here.
- A `lastActiveAt` timestamp is updated on every assistant/user chunk
  (`TeammateManager.ts:1524`, `managedEntry.lastActiveAt = Date.now()`), so the data needed to
  detect staleness already exists per-teammate. But it is a write-only field for this purpose: a
  repo-wide grep of `lastActiveAt` shows the **only** read site is
  `packages/electron/src/renderer/components/AgentMode/TeammatePanel.tsx:324-325`, and that read is
  purely cosmetic — `formatAgo(now - teammate.lastActiveAt)` for an already-`idle` teammate's "last
  active Xm ago" label. Nothing polls it, nothing compares it against a threshold, nothing fires
  when it goes stale for a `running` teammate.
- **Conclusion: fully missing for Teammates.** Unlike the Task sub-agent case, this isn't a
  scoping gap in an existing mechanism — there is no hang-detection mechanism on the teammate
  stream loop at all. This is the same class of bug NIM-1481 fixed for the lead, reproduced
  unfixed on `TeammateManager.ts:1493`.

**NIMBLE's own `nimble-pm` orchestration — no timeout on the worker-spawn call; monitoring only
starts after the fact, on a resumed run.**

- Source: `.claude/plugins/nimble/agents/pm.md` in the sibling `nimble` plugin repo (this project's
  worktree does not vendor `.claude/plugins/nimble` itself; `/nimble:run` in this repo loads it
  from the plugin install).
- The worker spawn is a single, unwrapped, synchronous call: "**Spawn call:** use the Agent tool
  with an explicit subagent type" (`pm.md:1627-1635`), invoked from the wave loop at `pm.md:1376`
  ("Spawn worker agent via the Agent tool"). No timeout, no polling loop, no watchdog wraps this
  call in the instructions — the PM's turn simply awaits it, exactly the pattern the user described
  ("send out an agent... and then wait").
- The only two monitoring mechanisms that exist are both **post-hoc, not concurrent**:
  - `wait_for_pr_merge()` (`pm.md:2321-2352`) polls `gh pr view` every 30s up to a 1-hour
    `max_wait`, but this runs *after* a worker has already returned and created a PR — it detects a
    stuck human/CI review, not a hung worker agent.
  - "Stall Detection" (`pm.md:2585-2591`) triggers on `loop_count >= 3` and escalates
    Sonnet→Opus or marks `needs-human-review` — but `loop_count` only increments across
    **review-revision cycles** on an already-created PR (per the adjacent status table,
    `pm.md:2600-2619`: `needs-revision` → re-spawn → review again). A worker that hangs before ever
    creating a PR never enters this counter.
  - The only place a stuck/dead worker is actually detected is **Step 2, State Reconciliation**
    (`pm.md:1275-1336`): "Git is truth. status.json is a cache." A task whose worktree branch
    exists with commits but no PR is derived as `crashed` and re-executed. Critically, this
    reconciliation runs **only at PM startup** (on a fresh or resumed `/nimble:run` invocation) —
    not while the original PM turn is still synchronously blocked inside the Agent tool call that
    spawned the hung worker. If the worker hangs and the PM's own turn never returns, nothing
    re-invokes Step 2; the user has to notice the session is stuck and manually restart
    `/nimble:run --prd {slug}` for reconciliation to even run.
- **Conclusion: fully missing.** No timeout, heartbeat, or watchdog covers the Agent-tool spawn
  call itself. The existing "crashed" detection is a resume-time reconciliation against git state,
  not a live monitor of the spawned worker — it only helps once a human (or a scheduled re-run) has
  already noticed the session is stuck and started a new PM invocation.

### 2. Agent completes/reports, but the main session's UI never wakes

**The desktop-notification primitive is robust and focus-agnostic — but it is wired into the
"all completed" sound path and the (planned) error path, not into the actual background-wake
mechanism.**

- `notificationService.showBlockedNotification` (`packages/electron/src/main/services/NotificationService.ts:607-627`)
  goes through `showNotification`/`showNotificationWithResult`
  (`NotificationService.ts:122-186` in `WindowManager`-adjacent code), which uses Electron's OS
  `Notification` API — genuinely surfaces outside the app regardless of window focus. By design it
  **skips** firing when a window is already focused on that session unless `notifyWhenFocused` is
  turned on (`NotificationService.ts:168-186`) — reasonable, not a bug, but means it is not the
  only channel the current PRD's R7/R8 wiring can rely on for the focused-but-wrong-tab case.

**The actual "wake the main session" mechanism is `onTeammateMessageWhileIdle`, and it silently
drops the wake if no window is open for the workspace — with zero notification fallback.**

- `MessageStreamingHandler.ts:1054-1106` (`onTeammateMessageWhileIdle`) is what makes "a teammate's
  inbox message actually resumes the main thread's own turn" literally true: when a teammate
  messages an idle lead, this handler calls `findWindowByWorkspace(effectiveWorkspacePath)`
  (`WindowManager.ts:810`) and, only `if (targetWindow && !targetWindow.isDestroyed())`
  (`MessageStreamingHandler.ts:1084`), fire-and-forget invokes `sendMessageHandler` on a mock IPC
  event (`MessageStreamingHandler.ts:1091-1100`) — this is the literal "inject a new turn so the
  main agent resumes" mechanism referenced in the task brief.
- **There is no `else` branch.** If `findWindowByWorkspace` returns `null` — the workspace's window
  was closed, or the workspace isn't currently open in any window — the teammate's message is
  dropped on the floor: no requeue, no persisted "pending wake" record, and critically **no call to
  `showBlockedNotification` or any other notification** from this handler. Contrast with
  `onTeammatesAllCompleted` (`MessageStreamingHandler.ts:1111-1137`), which is the *only* path in
  this handler that calls a user-visible signal (`SoundNotificationService.playCompletionSound`,
  `MessageStreamingHandler.ts:1133-1134`) — and even that is a sound, which the current PRD's task
  3a is explicitly tasked with distinguishing for the error case, not the idle-wake case.
- Even when a window *is* found, the resumed turn is delivered silently — `setImmediate` fire-and-
  forget (`MessageStreamingHandler.ts:1093-1099`) with only a `console`/logger error on failure
  (`MessageStreamingHandler.ts:1096-1097`), no notification of success or failure to the user. If
  the app window exists but is unfocused (minimized, on another desktop, user in a different app
  entirely), the only way the user learns the session resumed is by later checking the app —
  there's no sound, badge, or OS notification tied to this specific wake path today.

**The SDK-native Task sub-agent equivalent (`finalizeBackgroundDrain`'s continuation nudge) has the
same "silent unless window is open and focused" character, but is at least reactive to unexpected
death, not just idle-completion.**

- `finalizeBackgroundDrain` (`ClaudeCodeProvider.ts:2668-2716`) is the Task-sub-agent analog: when
  the drain loop exits with tasks still running because the SDK iterator itself ended/threw
  unexpectedly (not user-stop, not supersede), it marks the stranded tasks stopped and emits a
  **visible continuation turn** — `this.emit('teammate:messageWhileIdle', { sessionId, message:
  '[System: A sub-agent you launched did not finish...]' })` (`ClaudeCodeProvider.ts:2705-2716`).
  This reuses the exact same `onTeammateMessageWhileIdle` delivery path documented above, and
  inherits the exact same gap: dropped silently if `findWindowByWorkspace` returns null, no
  notification fallback either way.
- This path only fires on unexpected iterator death (a process crash) — it does **not** fire for
  the "stuck but the process never dies" stall case identified in Gap 1, because nothing detects
  that state to begin with; there's no code path to reach `finalizeBackgroundDrain` if the
  subprocess just goes quiet and stays alive.

**NIMBLE's own orchestration wake mechanism is a human, not a system.** There is no analog to
`teammate:messageWhileIdle` in `nimble-pm`. A finished worker surfaces exclusively through
`gh pr create` (`pm.md:1663-1679`) and the subsequent `wait_for_pr_merge`/reconciliation polling —
both of which require the PM's own agent turn to still be running and looping. If the PM's turn
that spawned the worker is the one that's hung (Gap 1, above), there is no separate watcher process
to notice the worker actually did finish and wake the PM up; the report is written to disk (git
commits, PR) but nothing pushes it back into the blocked PM turn.

### Summary table (this pass)

| Failure mode | System | Status | Key evidence |
| --- | --- | --- | --- |
| Silent hang detection | Task sub-agents | Partially exists, scoped wrong | `streamStallWatchdog.ts:56-66` disarms exactly while a sub-agent runs solo; `ClaudeCodeProvider.ts:1038,1118-1123` |
| Silent hang detection | Teammates | Missing | `TeammateManager.ts:1493` plain `for await`, no watchdog; `lastActiveAt` write-only (`:1524`, read only at `TeammatePanel.tsx:324-325`) |
| Silent hang detection | NIMBLE `nimble-pm` workers | Missing (live); reconciliation only on resume | `pm.md:1627-1635` unwrapped spawn call; `pm.md:1275-1336` Step 2 only runs at PM startup |
| Wake delivery | Teammate → idle lead | Partially exists, silent failure mode | `MessageStreamingHandler.ts:1054-1106`; no `else` branch when `findWindowByWorkspace` is null; no notification fallback |
| Wake delivery | Task sub-agent → idle lead (unexpected death only) | Partially exists, same silent-failure mode | `ClaudeCodeProvider.ts:2668-2716` reuses the same delivery path and gap |
| Wake delivery | NIMBLE `nimble-pm` worker → PM | Missing | No `messageWhileIdle`-equivalent in `pm.md`; PR/reconciliation requires the PM's own loop to still be running |

### Scope call: UI/notification feature vs. main-process reliability bug

This is **not** cleanly closeable inside the current PRD's UI/notification scope, and should not be
folded into tasks 3a/3b as currently written. Reasoning, not assumed:

- Tasks 3a/3b wire `showBlockedNotification` into event emit sites that already fire
  (`teammates:allCompleted`, Meta-Agent `pendingPrompt`). Both gaps found here are about
  **event sites that never fire in the first place** (Teammate/Task sub-agent hang) or an
  **existing wake path with no notification call at all** (`onTeammateMessageWhileIdle`). Wiring a
  notification into `TeammateManager.ts:1264-1289` (as 3a already does) does nothing for a
  teammate stuck at `TeammateManager.ts:1493` that never reaches that emit site.
- The Teammate hang-detection gap and the `onTeammateMessageWhileIdle` silent-drop gap are both
  small, targeted, main-process changes (a stall watchdog on one `for await` loop; an `else` branch
  plus a notification call) — closer in size to 3a/3b than to a rearchitecture, but they are
  **reliability/main-process fixes** (stream watchdog, wake-delivery correctness), not UI/chip-row
  work, and they touch files (`TeammateManager.ts`'s core spawn loop,
  `MessageStreamingHandler.ts`'s idle-wake handler) this PRD's task 3a/3b already touch adjacent
  lines of, creating real file-overlap risk if bundled in without their own task/brief.
- The Task sub-agent watchdog-scoping gap and the NIMBLE `nimble-pm` orchestration gap are larger:
  the former requires deciding how to detect per-sub-agent (not aggregate) silence without
  reaping legitimate long-running background work; the latter requires either a native
  Agent-tool-level timeout (outside this repo's control — it's the harness's own Task/Agent tool
  semantics) or a NIMBLE-side supervising process, which is an orchestration-architecture decision,
  not a wiring task.

**Recommendation:** track as its own PRD/tracker item(s), not as additional tasks under this one.
Suggested split if pursued:
1. Teammate stream-stall watchdog (`TeammateManager.ts:1493`) — same pattern as NIM-1481, reusing
   `raceNextChunkWithStallWatchdog`.
2. `onTeammateMessageWhileIdle` silent-drop fix — add the missing `else` branch, decide the
   fallback (queue for next window-open, or fire `showBlockedNotification` immediately).
3. Task sub-agent per-subagent stall detection — needs design discussion on how to key silence
   detection per running task without the aggregate-reset problem described in Gap 1.
4. NIMBLE `nimble-pm` worker liveness — separate from this codebase's runtime; would need to live
   in the `nimble` plugin repo (`.claude/plugins/nimble/agents/pm.md`), not here.
