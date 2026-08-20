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
