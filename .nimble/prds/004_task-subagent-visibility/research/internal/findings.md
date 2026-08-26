# Internal Research: task-subagent-visibility

Seeded from live investigation performed directly in this session (2026-08-26), not
re-derived by a fresh agent. Every claim below was verified against source at the cited
file:line, not inferred from memory. A researcher agent should extend this, not restart it.

## Problem

Nimbalyst's Agent Mode has two independent multi-agent systems:

1. **Teammates** (Agent Teams / SDK's `Agent` tool with a `name`, gated by
   `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`) — already have full visibility: a chip,
   `TeammateThreadPopover` with a live transcript, stop control, resume-reliability
   (PRD 002, PRD 003, both merged to `main`).
2. **Task-tool sub-agents** (anonymous `Task`/`Agent` dispatch with no `name`, what the
   model actually uses by default — confirmed live via main.log:
   `SUBAGENT_TASK started: id=... type=local_agent desc="Research Redis alternatives"`) —
   get a chip too, but clicking it only opens `TaskStatusPopover`, a static status readout
   (label, status, active tool name). No transcript, no way to read what the sub-agent
   actually said or did.

User's explicit direction (2026-08-26): make **Task-tool sub-agents** viewable with a real
thread, matching what native Claude Code CLI gives you for its own dispatched sub-agents.
This is the primary system the user means by "sub-agent" in their own terminology (see PRD
003's summary for the user's stated mapping: "main thread" = lead session, "subagent" =
dispatched Task/Agent-tool work — a *different* thing from "teammate" in the user's mental
model, even though Nimbalyst's codebase currently conflates "teammate" with the SDK's
Agent-Teams concept only).

## Current data flow for Task sub-agents

`ClaudeCodeProvider.ts` tracks each Task sub-agent in a `private activeTasks` map
(`packages/runtime/src/ai/server/providers/ClaudeCodeProvider.ts:300-323`):

```ts
private activeTasks = new Map<string, {
  taskId: string;
  description: string;
  taskType?: string;
  status: 'running' | 'blocked' | 'completed' | 'failed' | 'stopped';
  startedAt: number;
  lastActivityAt: number;
  toolUseId?: string;
  toolCount: number;
  tokenCount: number;
  durationMs: number;
  lastToolName?: string;
  summary?: string;
  isBackgrounded?: boolean;
}>();
```

This is **metadata only** — no message content, no transcript. It's populated from
structured `system` chunks with subtype `task_started` / `task_progress` /
`task_notification` / `task_updated` (`ClaudeCodeProvider.ts:2891-2963`), which the SDK
emits regardless of `forwardSubagentText`.

The renderer's `SubAgentChipRow.tsx` (`packages/electron/src/renderer/components/AgentMode/`)
renders one chip per `activeTasks` entry (`kind: 'task'`) and one per teammate
(`kind: 'teammate'`). Clicking a `task`-kind chip opens `TaskStatusPopover`
(`SubAgentChipRow.tsx:152-204`) — a small local-state popover fed entirely from the
`activeTasks` metadata fields above. Clicking a `teammate`-kind chip calls `onTeammateClick`,
wired to open the full `TeammateThreadPopover` (built in PRD 002), which reads a real
transcript backed by `ai_agent_messages` rows tagged `_isTeammateOutput`/`_teammateAgentId`.

**No equivalent transcript-backing exists for Task sub-agents.** `activeTasks` never stores
or forwards message text.

## The data IS now available and unrouted (found + fixed live this session)

The SDK has an option, `forwardSubagentText` (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1632-1638`):

> Forward subagent text and thinking blocks as assistant/user messages with
> `parent_tool_use_id` set. By default, only tool_use/tool_result blocks from subagents are
> emitted (enough for a heartbeat counter). When true, the full subagent conversation is
> forwarded so consumers can render a nested transcript.

This was set to `true` earlier in this session (`sdkOptionsBuilder.ts:255`, commit
`b35dc86bd`) for teammate visibility, but it applies to **all** sub-agents including plain
Task-tool dispatch — the SDK doesn't distinguish "teammate" from "Task sub-agent" at the
wire level; both are `Agent`-tool dispatch, teammates are just the named/addressable case
under Agent Teams.

Consequence discovered and fixed in this same session: `ClaudeCodeTranscriptAdapter.
parseAssistantChunk()` (`packages/runtime/src/ai/server/providers/claudeCode/
ClaudeCodeTranscriptAdapter.ts:190-248`) had two existing guards for exactly this class of
problem — `session_id` capture (line 198, NIM-671) and per-step `usage` (line 216, NIM-868)
both skip when `chunk.parent_tool_use_id` is set, because the SDK relays a sub-agent's own
chunks through the *same async iterator* as the lead's. The `text` block handling had no
such guard, so once `forwardSubagentText: true` shipped, every Task sub-agent's own text
was flowing straight into the lead's visible transcript, unmarked. Fixed same-session
(commit `2e604a74b`) by adding the missing guard — sub-agent text is now dropped at that
point rather than misattributed to the lead.

**This is the exact hook point for the new feature.** Instead of dropping sub-agent text,
route it: tag with `parentToolUseId` (already extracted at `ClaudeCodeTranscriptAdapter.ts:222`),
correlate to the matching `activeTasks` entry by `toolUseId`, and either persist it
(mirroring the teammate `ai_agent_messages` pattern) or stream it live to the renderer
keyed by taskId.

## Key correlation fact

`parentToolUseId` on a forwarded sub-agent chunk is the **same id** as the `tool_use_id` of
the `Task` tool_use block that spawned it — i.e. the same id `ClaudeCodeProvider.ts`
already uses as the map key convention for `subagentToolCallOwners`
(`ClaudeCodeProvider.ts:329`, comment: "Inner tool_use id -> tool_use id of the Task
sub-agent that issued it"). This means task text chunks can be correlated to the right
`activeTasks` entry with data already flowing through the provider — no new correlation
mechanism needed, just wiring.

## What teammates have that Task sub-agents would need to gain

From PRD 002 (already built, reusable patterns):
- `TeammateThreadPopover.tsx` — live popover UI, uses `@floating-ui/react`
  (per this repo's floating-ui rule)
- IPC channel(s) for transcript fetch + live update signal (see PRD 002's tasks 1b/2a)
- Persisted storage in `ai_agent_messages`, tagged and queryable by agent id

Open question for planning: does a Task sub-agent's transcript need to be **persisted**
(so it survives after the task completes and the chip disappears / after restart), or is a
**live-only** view sufficient (transcript exists only while `activeTasks` entry is live,
gone once the task completes and its map entry evicts)? Native Claude Code CLI's own
sub-agent transcripts are NOT durably browsable after the fact in the CLI itself — they're
only visible via the live tool-call/text stream during execution. A live-only scope would
be significantly smaller than teammates' persisted-history scope and may be the more
faithful "same as native CLI" target per the user's own stated goal.

## Non-goals carried from prior PRDs (still true here)

- No hook adoption (`SubagentStop`, `TaskCompleted`) — confirmed structurally unable to
  observe a process that dies before/at spawn; irrelevant to this feature anyway since it's
  about content, not liveness.
- No changes to Agent Teams / teammate code paths — this is additive to the Task-tool path
  only, `activeTasks`/`SubAgentChipRow`'s `kind: 'task'` branch.
- Repo has a standing no-PR-ever constraint (local merges only) — irrelevant to research,
  relevant to execution planning later.

## Files most likely touched by implementation (not yet a task breakdown)

- `packages/runtime/src/ai/server/providers/claudeCode/ClaudeCodeTranscriptAdapter.ts` —
  route (not drop) sub-agent text blocks when a consumer exists
- `packages/runtime/src/ai/server/providers/ClaudeCodeProvider.ts` — `activeTasks` map,
  `subagentToolCallOwners`, chunk-to-task correlation, whatever streams to renderer
- `packages/electron/src/renderer/components/AgentMode/SubAgentChipRow.tsx` — `kind: 'task'`
  click path, `TaskStatusPopover` → new transcript-capable popover (or extend it)
- Possibly a new/extended IPC channel + preload surface for live Task-sub-agent transcript
  streaming (electron main ↔ renderer)
- Possibly `ai_agent_messages` schema/query additions if persistence is in scope (see open
  question above)

## Extended research (researcher agent, 2026-08-26)

### PRD 002's actual pattern — reusable, and it explicitly deferred this exact feature

PRD 002 (`teammate-thread-view`, merged) states as a Non-Goal (its section 3):

> **SDK-native `Task` sub-agent transcripts.** `claudeCliSubAgentTracker.ts` hides those by
> design on the CLI-proxy path; Task chips stay read-only. Separate product decision, not
> revisited here.

This PRD is that deferred decision being taken up. The mechanics PRD 002 built are a
directly reusable template:

- **IPC channel shape**: `ai:getTeammateTranscript(sessionId, agentId, workspacePath)`
  (`AIService.ts:3303-3328`, `safeHandle`) — validates session ownership (workspace or
  worktree match), pulls `createRawMessageStoreAdapter().getMessages(sessionId)` (all raw
  rows for the *lead* session, since teammate/task chunks are interleaved into it), and
  projects with `projectTeammateRawMessages(rawMessages, agentId)`
  (`packages/runtime/src/ai/server/transcript/projectRawMessages.ts:132-152`). That
  projector does a cheap string pre-filter (`msg.content.includes('_teammateAgentId')`)
  before `JSON.parse` + exact `agentId` match, then reuses the normal
  `projectRawMessagesToViewMessages` pipeline with `{ teammateProjection: true }`. A
  `projectTaskSubagentRawMessages(rawMessages, taskId)` sibling function, tagging on
  `_taskId` (or reusing the existing `toolUseId` correlation key) instead of
  `_teammateAgentId`, is a near-direct copy of this ~20-line function — same table, same
  query shape, no new store.
- **Live-update signal**: provider emits an internal EventEmitter event
  (`teammate:transcriptUpdated`, fired from `TeammateManager`'s `logNonBlocking` call
  sites) → `MessageStreamingHandler.ts:1176-1183` forwards it to the renderer as
  `webContents.send('teammate:transcript-updated', { sessionId, agentId })` → a centralized
  listener (`store/listeners/teammateTranscriptListeners.ts`) bumps a per-`(sessionId,
  agentId)` Jotai atom (`teammateTranscriptSignalAtomFamily`,
  `store/atoms/agentMode.ts:239-241`) → the open `TeammateThreadPopover` watches that atom
  and debounce-refetches 1.5s after it changes (`TeammateThreadPopover.tsx:100-112`). This
  is a per-agent fine-grained channel, distinct from and additional to the coarser
  `message:logged` → whole-session-refresh path that already drives the Task chip's status
  fields (see below) — a Task-subagent transcript feature would want its own
  `task:transcriptUpdated` internal event / `task:transcript-updated` IPC channel following
  the identical shape, keyed by `taskId` instead of `agentId`.
- **Popover pattern**: `TeammateThreadPopover.tsx` — `useFloatingMenu` +`FloatingPortal`
  (per this repo's floating-ui rule), `RichTranscriptView` fed by fetched
  `TranscriptViewMessage[]`, a `TEAMMATE_TRANSCRIPT_SETTINGS` config
  (`showToolCalls/compactMode/collapseTools/showThinking`), loading/empty states, and a
  `fetchGenerationRef` guard against out-of-order async responses when the popover
  re-fetches. Directly adaptable for a `TaskThreadPopover`; the compose/Stop controls in
  PRD 002 don't apply (Task sub-agents have no addressable send/resume path the way
  teammates do — see Non-Goals note below), so a Task version would be read-only, closer to
  `SessionTranscriptPeek.tsx` than the teammate popover's compose-capable variant.

### Task chip metadata is ALREADY persisted — corrects the seed research's framing

The seed research's open question ("does `activeTasks` survive... is a live-only view even
feasible without persistence?") is answered by code already in place, and changes the
framing:

- `activeTasks` map entries are **never deleted** (`ClaudeCodeProvider.ts` has no
  `activeTasks.delete(...)` call anywhere) — a completed/failed/stopped task's entry stays
  in the map with its terminal `status`, for the lifetime of the provider instance.
- Every `handleSystemTask` transition (`task_started`, `task_progress`, `task_notification`,
  `task_updated`) calls `this.emitTaskUpdate(sessionId)` (`ClaudeCodeProvider.ts:2891-2974`,
  `3075-3094`), which writes `Array.from(this.activeTasks.values())` into the session's
  **persisted** `metadata.currentTasks` via `AISessionsRepository.updateMetadata` — the
  exact same persistence mechanism PRD 002's R1 built for `metadata.currentTeammates`. This
  already survives a Nimbalyst restart (metadata is a DB column), which is why Task chips
  still show status after a reload today.
- The renderer already reads this back: `sessionTasksAtom` (`agentMode.ts:260-266`) derives
  `TaskInfo[]` from `session.metadata.currentTasks`, refreshed by the generic session-store
  atom (driven by the coarser `message:logged` signal, not a dedicated per-task channel).

**Conclusion: metadata (status/description/tool count) already persists and survives
restart. Only the transcript *text* is the missing, unpersisted piece** — a materially
smaller gap than the seed research's framing suggested, and the natural next step is
extending the *already-existing* `emitTaskUpdate` persistence pattern to also route
(not drop) sub-agent text, rather than inventing a new persistence point.

### Where sub-agent text is currently dropped, precisely

`ClaudeCodeTranscriptAdapter.parseAssistantChunk` (`ClaudeCodeTranscriptAdapter.ts:224-241`):
text blocks with `parentToolUseId` set hit `if (parentToolUseId) continue;` (line 233) and
are dropped outright — no persistence, no event, no consumer. This is the LEAD's own SDK
chunk parser (it runs over every chunk the SDK relays through the lead's async iterator,
which includes both teammate and plain-Task sub-agent chunks per the SDK's
`forwardSubagentText` design). Teammate text reaches the renderer through a **separate**
path — `TeammateManager`'s own explicit `logNonBlocking(...)` calls
(`TeammateManager.ts:1109-1116, 1893-1898, 1957-1961`, tagging `_isTeammateOutput` /
`_teammateAgentId`) — not through this adapter at all. That means the fix point identified
in the seed research (add routing at `ClaudeCodeTranscriptAdapter.ts:233`) is correct for
Task sub-agents specifically, since there's no `TaskManager`-equivalent already consuming
that text elsewhere; a parallel `logNonBlocking(..., { _isTaskSubagentOutput: true,
_taskId: ... })` call keyed by the same `toolUseId`/`taskId` correlation already available
(`parentToolUseId` at `ClaudeCodeTranscriptAdapter.ts:222`, matched against
`activeTasks`/`subagentToolCallOwners` in `ClaudeCodeProvider.ts`) is the direct analog of
`TeammateManager`'s existing calls.

### ai_agent_messages schema fit (open question #2, resolved: fits without migration)

`packages/electron/DATABASE.md` describes `ai_agent_messages` as a large flat per-session
table (rows can exceed 1M; `ai_sessions` holds the session/metadata row separately). There
is no per-message-type schema — content is stored as opaque JSON and filtered by
`content.includes(...)` + `JSON.parse` at read time, exactly as
`projectTeammateRawMessages` does. Tagging Task sub-agent text rows with
`_isTaskSubagentOutput`/`_taskId` inside that same JSON blob is schema-free: no migration,
no new table, same query shape as the teammate path. The only new cost is volume — Task
sub-agents can fire far more often than teammates in a given session (they're the model's
default delegation mechanism), so row growth should be a named risk for planning, not
blocking for research.

### External research pointer

See `research/external/findings.md` for how native Claude Code CLI presents sub-agent
output live in the terminal — used to calibrate scope (live-nested-stream parity vs.
teammate's fuller persisted/stoppable scope).
