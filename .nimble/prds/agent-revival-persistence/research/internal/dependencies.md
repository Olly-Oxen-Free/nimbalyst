# Internal Dependencies — Agent Revival & Persistence

## State required end-to-end for today's idle-teammate resume (baseline any revival feature extends)

| State | Source today | Persists across restart? |
| --- | --- | --- |
| SDK session id | `IdleTeammate.sessionId` (in-memory) or `PersistedTeammateRow.sessionId` (`AISessionsRepository`, `ai_sessions.metadata.currentTeammates[]`) | Yes, in metadata — captured mid-stream (`TeammateManager.ts:1935-1951`), written on next debounced emit (`:1456`) |
| Team name / teammate name / agentId | `IdleTeammate.teamName/.name`, or split from `agentId` string (`agentId.split('@')`, `:1325`) | Yes (metadata row + the `agentId` string itself) |
| `agentType`, `model`, `color` | `IdleTeammate` fields; `color` is NOT persisted, recomputed via `colorForAgentId` hash (`:1332`, `:1341-1347`) | Partial — color is re-derived, not stored |
| `cwd` | `IdleTeammate.cwd`; on rehydrate, falls back to `this.lastUsedCwd \|\| process.cwd()` (`:1333`) | **No** — the original teammate's own cwd is never persisted per-row; rehydration borrows the *lead's* last-used cwd, which may differ (see errors.md E4) |
| `permissionsPath` | `TeammateManager.lastUsedPermissionsPath`, filled from `TeammateResumeContext` the host passes on `sendMessageFromHost` (`:1286-1290`) | No — must be re-supplied by the caller (`ClaudeCodeProvider`/`AIService`) on every resume attempt in a fresh process |
| MCP / hook config | Rebuilt fresh every `streamTeammateOutput` call from `deps.createPreToolUseHook`/`createPostToolUseHook`/`createCanUseToolHandler` (`:1830-1836`) — not persisted at all, always reconstructed from the live host | N/A — always reconstructed, so nothing to persist here |
| `prompt` (opening prompt) | `IdleTeammate.prompt`; rehydrated rows get `prompt: ''` (`:1334`) since the original spawn prompt isn't persisted | **No** — irrelevant for resume since the *new* message content is what's passed as `prompt` to `streamTeammateOutput`'s resume call; only matters if you want to reconstruct "what was this teammate originally asked to do" for display |

## `currentTeammates` metadata — read/write dependency graph

- **Writer:** `TeammateManager.emitTeammateUpdate` (`:1415-1526`), the sole writer, via
  `AISessionsRepository.updateMetadata(sessionId, { metadata: { ...currentMetadata, currentTeammates: updatedTeammates } })`.
  Debounced through `scheduleEmitTeammateUpdate` (100ms, `:1364-1392`).
- **Readers:**
  - `resolveTeamContextFromSessionMetadata` (`:447-499`) — team-name rehydration, unrelated to
    revival but reads the same array.
  - `rehydrateIdleTeammate` (`:1298-1338`) — the only reader that reconstructs a resumable entry.
  - `TeammateTileRail.tsx` / `TeammatePanel.tsx` (via `agentMode.ts` atoms, `TeammateInfo` type,
    `agentMode.ts:364`) — renders the array for the UI; this is the same array a revival affordance
    would list "recently ended agents" from, no new storage needed.
- **Bound by session lifetime:** the array lives on one `ai_sessions` row (the lead's own session).
  If that session is deleted/archived/pruned by whatever session-retention policy exists elsewhere in
  the codebase, every teammate row it held — including any `completed` rows a revival feature would
  want to resume — disappears with it. (Retention policy itself was not located in this pass; flag as
  open question in summary.md.)

## Task sub-agent dependency shape (contrast with teammates)

- **No independent persisted identity.** `ClaudeCodeProvider.activeTasks` (in-memory,
  `taskId`/`toolUseId`/`status`, `:305-328`) is mirrored to `session.metadata.currentTasks` (`:3179`)
  for UI purposes only — there is no `sessionId` field to mirror, because none exists.
  `resolveTaskSubagentToolUseId` (`aiServiceUtils.ts:37-50`) resolves a `taskId` to a `toolUseId`
  purely to filter the **lead session's own raw message log** — the dependency is on the lead's
  transcript rows, not on any sub-agent-owned state.
- **Consequence for a revival feature:** reviving a Task sub-agent has no `sessionId`/`cwd`/
  `permissionsPath` dependency chain to restore at all — its only "state" is the reconstructed
  transcript text, which is dependency-free (already reachable via the existing
  `ai:getTaskSubagentTranscript` handler) but also not resumable in the SDK sense (see errors.md E1).

## Cross-references to prior PRDs this feature must be consistent with

- `.nimble/prds/003_teammate-resume-reliability/PRD_teammate-resume-reliability.md` — established
  that `sendMessageFromHost`'s `{ delivered: true }` on the idle path means "resume initiated, not
  confirmed," and wired `handleStreamError`'s wake-the-lead path for a `wasResumed` teammate whose
  resume dies. A revival feature reusing `resumeIdleTeammate` inherits both properties: revival
  success is not confirmed synchronously, and a revival that fails needs the lead (or a UI surface
  outside the lead entirely, since revival may happen with no lead turn active) to hear about it.
- `.nimble/prds/006_teammate-idle-handoff/PRD_teammate-idle-handoff.md` — fixed the idle→lead handoff
  (`deliverMessageToLead` on going idle) and confirmed `killAll` must not mislabel idle teammates as
  `errored`. Revival adds a second entry point into the same `deliverMessageToLead`/
  `interruptWithMessage` machinery both these PRDs already audited — worth flagging to whoever
  executes this PRD that a 5th call site into that machinery is being added (PRD 006 itself called
  its addition "a 4th call site").
