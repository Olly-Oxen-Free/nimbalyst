# Internal Findings (Consolidated) — Agent Revival & Persistence

Feature: revive a recently-ended agent (teammate or Task sub-agent) so a new turn resumes as if it
were the same agent. Central question: how much is genuine extension of existing resume machinery vs.
new capability?

**Answer: for teammates, small extension of existing machinery. For Task sub-agents, no resume
machinery exists at all — "revival" there is a different, weaker feature (context-seeded respawn).**

## Teammate revival — extension, not new capability

1. **Resume is one existing code path, already used for idle teammates.**
   `TeammateManager.streamTeammateOutput` (`TeammateManager.ts:1777-2057`) both spawns fresh and
   resumes; the only difference is `options.resume = resumeSessionId` (`:1843-1845`) passed straight
   through to the Claude Agent SDK's `query()`. `resumeIdleTeammate` (`:2061-2076`) is a thin wrapper
   around it. Reviving a `completed` teammate would call exactly this same function.

2. **The SDK session id usually already survives past "completed."** `emitTeammateUpdate`
   (`:1415-1526`) persists `currentTeammates[].sessionId` to `ai_sessions.metadata` on every
   debounced status change, and that field is captured from the SDK's first chunk while the teammate
   is still `running` (`:1935-1951`) — well before it ever reaches `completed`. So the data a revival
   needs is, in most real cases, already sitting in the database.

3. **The block is one `Set` and one status check, not an architecture gap.**
   `RESUMABLE_PERSISTED_STATUSES = new Set(['idle', 'running', 'blocked'])` (`:183`), consumed only by
   `rehydrateIdleTeammate` (`:1298-1338`), is the entire gate standing between "idle teammate resume"
   (works today) and "revive a completed teammate" (does not). This is a deliberate PRD 003 decision
   ("'completed'/'errored' are terminal and must not be brought back," `:1320-1323`), not an oversight
   — and it is pinned by a named regression test
   (`TeammateManager.sendMessageFromHost.test.ts:193-200`) this feature must consciously invert.

4. **The UI already renders the exact list a revival affordance needs.** `TeammateTileRail.tsx` /
   `TeammatePanel.tsx` already show `completed` teammates (dimmed, struck through) reading the same
   `currentTeammates` array; they just gate the compose box shut for them
   (`canCompose = status !== 'completed' && status !== 'errored'`, `TeammateTileRail.tsx:110-116`,
   with a comment claiming a completed teammate "has no process left to receive a message" — not
   accurate at the SDK level, see external findings). No new list surface, no new storage, no new IPC
   channel shape is required — the existing `ai:sendMessageToTeammate` → `sendMessageFromHost` →
   `resumeIdleTeammate` chain is the delivery mechanism once the gate opens.

5. **Cross-restart rehydration is also a solved pattern to extend, not invent.**
   `rehydrateIdleTeammate` already reconstructs an `IdleTeammate` from persisted metadata for a
   process that never spawned the teammate — exactly "Nimbalyst restarted, the map is empty, the SDK
   session is still on disk." Widening its status filter covers "revive a teammate the app abandoned
   on restart" (the single largest source of revivable-but-currently-foreclosed state in this
   codebase — see point 7) with no new reconstruction logic needed.

## What is genuinely new / genuinely missing (the actual scope, not zero)

6. **A "why did this end" distinction does not exist and is load-bearing.** `completed` today covers
   three different situations with no field to tell them apart: the teammate finished cleanly and the
   user chose not to act (revivable, low risk); the user explicitly approved a shutdown request
   (revivable but arguably should not be silently offered back — the user killed it on purpose); and
   `abandonIdleTeammates` marked it completed because the *lead's* transport died, not because the
   teammate itself failed (revivable, and arguably the most important case to support, since this is
   an involuntary loss of state from the user's point of view). Building revival without this
   distinction risks either hiding the most valuable case or resurfacing teammates the user
   deliberately ended.

7. **State not persisted per-teammate today:** the original spawn `cwd` (rehydration currently
   borrows the *lead's* last-used cwd as a fallback, `:1333`, which is wrong if the team's own
   worktree differs) and `color` (recomputed via hash, cosmetic only). `cwd` is the one with real
   correctness risk — see dependencies.md notes on worktree cleanup outliving teammate rows.

8. **UI affordance to *initiate* revival does not exist**, only to view. Opening the compose box for
   a `completed` row and wiring its send action to the widened `sendMessageFromHost` path is new UI
   work, small in surface area given point 4.

9. **Resume-failure reporting has nowhere to land for a revival with no lead turn active.**
   PRD 003's fix wires resume-failure back to the lead's own conversation
   (`deliverMessageToLead`/`interruptWithMessage`, `handleStreamError:1636-1644`). That assumes a live
   lead session to interrupt. A revival triggered from a UI action when the lead itself is not
   currently running a turn (e.g., the whole session was closed) has no established delivery target
   for "the revival failed" — this needs new design, not reuse.

## Task sub-agents — no resume machinery exists; revival means something else entirely

10. **No independent session identity.** `ClaudeCodeProvider.activeTasks` (`:305-328`) has no
    `sessionId` field — a Task sub-agent is an SDK-internal tool call inside the lead's own single
    session, not a separate `query()`. `ai:getTaskSubagentTranscript` (`AIService.ts:3343-3373`)
    reconstructs sub-agent output by filtering the *lead's* raw transcript by `toolUseId`/
    `parent_tool_use_id` — there was never a second session to resume.

11. **Consequence:** "revive a Task sub-agent" cannot reuse any of points 1-5 above. The only
    technically honest interpretation is: spawn a new teammate/agent and seed its prompt with the old
    sub-agent's reconstructed transcript text as context — no real conversation state, no permission
    state, no SDK memory carries over. This is a fundamentally different, weaker guarantee than
    teammate revival and should not be described to users with the same "resumes as if it were the
    same agent" language the feature request uses, because for Task sub-agents that claim cannot be
    made true.

## Session lifecycle risk not fully resolved in this pass

12. Whether/when `ai_sessions` rows (and therefore `currentTeammates` metadata) get pruned or
    archived was not located in this research pass — flagged as an open question in `summary.md`.
    If any retention policy exists, it directly bounds how far back "recently-ended" can honestly
    reach.
