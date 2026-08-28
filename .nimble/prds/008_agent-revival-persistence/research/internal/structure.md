# Internal Structure — Agent Revival & Persistence

## Ownership map

| Layer | File | Role relative to revival |
| --- | --- | --- |
| Lifecycle owner | `packages/runtime/src/ai/server/providers/TeammateManager.ts` (2548 lines) | All spawn/resume/completion/persistence logic. Everything in patterns.md/errors.md lives here. |
| Host provider | `packages/runtime/src/ai/server/providers/ClaudeCodeProvider.ts` | Owns `activeTasks` (Task sub-agents, no session id — errors.md E1), calls `abandonIdleTeammates` on transport death (errors.md P6/E2), supplies `TeammateManagerDeps` (hooks, `interruptWithMessage`, `canUseTool`). |
| IPC surface | `packages/electron/src/main/services/ai/AIService.ts` | `ai:sendMessageToTeammate` → `TeammateManager.sendMessageFromHost`; `ai:getTeammateTranscript` / `ai:getTaskSubagentTranscript` (transcript projection, read-only, no lifecycle action). |
| Preload | `packages/electron/src/preload/index.ts:711` | Exposes `aiSendMessageToTeammate`. |
| UI list/compose | `packages/electron/src/renderer/components/AgentMode/TeammateTileRail.tsx`, `TeammatePanel.tsx` | Renders `currentTeammates` (all statuses, including `completed`, dimmed). Gates compose box on `status !== 'completed' && status !== 'errored'` (patterns.md P4). |
| State atoms | `packages/electron/src/renderer/store/atoms/agentMode.ts` | `TeammateInfo` type (`status: 'running'|'blocked'|'completed'|'errored'|'idle'`), reads the persisted array into Jotai. |
| Persistence | `AISessionsRepository` (`packages/runtime/src/storage/repositories/...`) | Generic session metadata read/write; `currentTeammates` is just one key inside `ai_sessions.metadata`, no dedicated table. |

## Naming/vocabulary already established (reuse, don't reinvent)

- **"idle"** = teammate finished a turn, SDK session on disk, resumable. **"completed"** = terminal,
  currently un-resumable by design. **"resume"** (not "revive", not "restart") is the SDK's and this
  codebase's term for reattaching to a session id — PRD naming ("agent-revival-persistence") should
  expect to talk about "reviving a `completed` teammate via `resume`" internally, not invent a new
  verb for the mechanism itself.
- **`rehydrate`** is the established verb for "reconstruct in-memory state from persisted metadata
  after a restart" (`rehydrateIdleTeammate`, `resolveTeamContextFromSessionMetadata`'s log line
  "Rehydrated team context..."). A revival feature's equivalent function should keep this name rather
  than introduce "revive"/"restore" as a second verb for the same operation.
- **`wasResumed`** (`ManagedTeammate.wasResumed`) already marks "this run came from a resume, not a
  fresh spawn" for in-flight error-handling purposes (errors.md E2 notes it doesn't persist).

## Directory/module conventions relevant to implementation

- Teammate lifecycle code is intentionally isolated in one class (`TeammateManager`) injected via a
  `TeammateManagerDeps` interface to keep it decoupled from `ClaudeCodeProvider`/`BaseAIProvider`
  (file header comment, `TeammateManager.ts:1-6`). A revival feature should add methods to
  `TeammateManager`, not to `ClaudeCodeProvider`, consistent with this separation. Note the file is
  already 2548 lines — adding a revival section pushes it further past a size any future refactor
  discussion would flag; not a reason to avoid the file, just a heads-up for whoever executes.
- Tests for this subsystem already follow a per-concern-file convention:
  `TeammateManager.sendMessageFromHost.test.ts`, `TeammateManager.resumeReliability.test.ts`,
  `TeammateManager.idleHandoff.test.ts`, `TeammateManager.stallWatchdog.test.ts`, plus the general
  `TeammateManager.test.ts`. A revival feature's tests should follow the same
  `TeammateManager.<concern>.test.ts` naming rather than growing the general file.
