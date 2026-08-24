# Research Findings: Teammate Thread View

Source: live investigation during agent-visibility follow-up (2026-08-24), then a full
re-derivation against main at 55df0b909 by a thorough exploration pass. Where the two disagreed,
the later pass (verified with file:line reads) wins; superseded claims are struck below.

## Decisive discovery (supersedes the plan below where they conflict)

**Nimbalyst already persists the full teammate transcript itself.** `streamTeammateOutput` logs
every raw teammate chunk — full SDK message JSON including text, thinking, tool_use, tool_result
— into the lead session's `ai_agent_messages` via `deps.logNonBlocking(...)` with
`messageType: 'teammate_output'` and `_isTeammateOutput`/`_teammateAgentId` tags
(`TeammateManager.ts:1737-1749`; result chunks at `:1794-1812` tagged `_teammateCompleted`).
This is DB-persisted and survives restart. `SessionManager.ts:397-421` reads the tags only to
suppress teammate text from the lead's visible stream. **Consequence: history does not need the
SDK JSONL read at all** — teammates only ever run inside Nimbalyst, so the raw log is complete.
The SDK read path is dropped from scope; the persisted session id keeps it possible later.

Reuse targets verified for the read/render path:
- `projectRawMessagesToViewMessages` (`packages/runtime/src/ai/server/transcript/projectRawMessages.ts:101`)
  + `ClaudeCodeRawParser` (`parseMessage` at `parsers/ClaudeCodeRawParser.ts:59`; early-returns
  on `msg.hidden`) — the raw → `TranscriptViewMessage[]` adapter, built for mobile, never run
  over teammate-tagged chunks or the synthetic `teammate_message_to_lead` shape
  (`TeammateManager.ts:1062-1103`); fidelity work is task 1b's core.
- `SessionTranscriptPeek.tsx` (`packages/electron/src/renderer/components/AgenticCoding/`) —
  working precedent for `RichTranscriptView` (props minimum `{ sessionId, messages, settings,
  persistScrollState }`, `RichTranscriptView.tsx:469+`) inside a floating popover, with
  1.5s-debounced signal-driven refetch. Its data source `transcript:get-tail-messages`
  (`SessionHandlers.ts:1534-1551`) reads `ai_transcript_events`, which has **no rows for
  teammate chunks** — hence the new handler projects from raw instead.

Further corrections from the re-derivation:
- **No `teammate:messageToLead` renderer bridge exists** — the event name appears nowhere in the
  repo. `teammate:messageWhileIdle` (`MessageStreamingHandler.ts:1092-1154`) stays entirely in
  main. A live per-chunk signal genuinely must be added; do not piggyback on `ai:message-logged`
  (fires for all session traffic).
- **User→teammate send works end to end today**: popover → `aiSendMessageToTeammate` (preload
  `:710`) → `ai:sendMessageToTeammate` (`AIService.ts:3204`) →
  `sendMessageToManagedTeammate` (`ClaudeCodeProvider.ts:2587-2589`) → `sendMessageFromHost`
  (`TeammateManager.ts:1162-1187`) — running via `streamInput` flush, idle via
  `resumeIdleTeammate` (`:1828-1872`, SDK `resume` with the captured id). The gap is durability:
  the `currentTeammates` metadata literals (`:1302-1315`, `:1318-1329`) omit `sessionId`, and
  the maps (`:115-116`) are memory-only, so after restart Send silently returns
  `{ delivered: false }`.
- **`SDK_NATIVE_TOOLS` cleanup dropped from scope**: the array feeds the meta-agent
  `disallowedTools`/`blockedTools` set-complement at `ClaudeCodeProvider.ts:913-920` and native
  routing at `:1433-1443` — behavior-adjacent, not load-bearing here. Recorded as a PRD non-goal.
- **Stop machinery half-exists**: `streamTeammateOutput` races a stall-watchdog abort
  (`:1638-1698`, throw at `:1672-1678`); task 3a exposes a deliberate user trigger to it.
- `TeammateInfo` (`TeammatePanel.tsx:25-38`) has no `sessionId` field — the one field this PRD
  adds. Popover props (`TeammateThreadPopover.tsx:16-24`): `sessionId` is the **lead** session
  id; `agentId` identifies the teammate. SDK 0.3.221 also exports `getSubagentMessages`
  (`sdk.d.ts:796`) and `listSubagents` (`:1009`) beyond the three functions cited below.

---

The original findings follow; read them through the corrections above.

## Correction to prior PRD

`.nimble/prds/001_agent-visibility/research/findings.md` (Finding 1, now removed from the tree
post-merge but referenced in `CHANGELOG.md`/task 2c history) stated teammates have "no backing
record — the SDK session id is kept in-memory only... no backing record to open." That was true
of Nimbalyst's own `ai_sessions` table, but not of the underlying SDK. Verified against the
installed `@anthropic-ai/claude-agent-sdk@0.3.221` (`node_modules/@anthropic-ai/claude-agent-sdk`,
confirmed via `require.resolve` from `packages/runtime/src` — this is a direct dependency,
pinned in root/`runtime`/`electron` `package.json`, not a transitive resolution from an unrelated
global tool):

- `TeammateManager.ts:1435` already passes `persistSession: true` to each teammate's own
  top-level `query()` call. Each teammate is its own real SDK session (not a nested subagent),
  with its own `capturedSessionId` (captured from `chunk.session_id` at `TeammateManager.ts:1494`).
- The SDK persists that session's full transcript as a JSONL file on local disk and exports read
  functions that don't require a live `query()` handle: `getSessionInfo(sessionId)`
  (`sdk.d.ts:729`), `getSessionMessages(sessionId)` (`sdk.d.ts:759`), `listSessions()`
  (`sdk.d.ts:954`). All are plain exported functions, statically importable — no new dependency,
  no IPC-to-CLI round trip needed to read history.
- What's actually missing is a **durable pointer** from Nimbalyst's side: `capturedSessionId` only
  lives in `TeammateManager.ts`'s in-memory `idleTeammates`/`managedTeammates` maps
  (`TeammateManager.ts:106`, `:1234`). Restarting Nimbalyst loses the pointer even though the
  underlying transcript file survives on disk. This is a much smaller gap than "give teammates an
  `ai_sessions` row" — no DB migration, no new table, just a small persisted mapping.

## What's still genuinely unbuilt

1. **Live streaming.** `getSessionMessages` reads a finished/idle session's file after the fact.
   While a teammate is actively running, `TeammateManager.streamTeammateOutput` already receives
   every chunk in-process (that's how the lead's "waiting for teammates" state already works) but
   nothing forwards those chunks to the renderer. Needs a new IPC event channel following the
   centralized-listener pattern in `docs/IPC_LISTENERS.md` — components must not subscribe to IPC
   directly.
2. **UI.** `TeammateThreadPopover.tsx`
   (`packages/electron/src/renderer/components/AgentMode/TeammateThreadPopover.tsx`) is
   compose-only today: name label, status line, textarea, Send button. No transcript rendering.
   The existing `AgentTranscript`/`SessionTranscript` components
   (`packages/runtime/src/ui/AgentTranscript/`) are the intended reuse target — do not build a new
   renderer from scratch.
3. **Send-while-viewing** already exists — but via `sendMessageFromHost`, NOT
   `deliverMessageToLead` (which is teammate→lead only; see corrections above). This PRD keeps
   the compose path and adds restart durability to it (R2), plus the read side.

## Explicitly out of scope

SDK-native `Task` sub-agent transcripts. `claudeCliSubAgentTracker.ts:20-22` intentionally hides
`Task` sub-agent turns from the visible transcript by design ("so they don't pollute the visible
transcript") — this is a separate, more sensitive product decision the original PRD (task 2d)
deliberately did not make, and this PRD does not revisit it either. Teammates (spawned via
`TeammateManager`, addressable, chip-visible) and `Task` sub-agents (spawned via the SDK's
built-in `Agent`/`Task` tool, transcript hidden) remain two different UX surfaces.

## Minor cleanup identified, not required for this PRD's goals

`ClaudeCodeProvider.ts:154-177` (`SDK_NATIVE_TOOLS`) lists `TeammateTool`, `TeamCreate`,
`TeamDelete` as if they were tools the model calls directly. In SDK 0.3.221 these tool names don't
exist — `sdk.d.ts` marks `AgentInput.team_name` deprecated ("the session has a single implicit
team"); teammates spawn via the ordinary `Agent` tool's `name` field, addressed via `SendMessage`.
SUPERSEDED: the array is NOT classification-only — it feeds the meta-agent
`disallowedTools`/`blockedTools` set-complement (`ClaudeCodeProvider.ts:913-920`) and native
tool routing (`:1433-1443`). The cleanup is dropped from this PRD (see corrections above and the
PRD non-goals), not folded into any task.
