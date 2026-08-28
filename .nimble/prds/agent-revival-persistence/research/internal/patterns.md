# Internal Patterns — Agent Revival & Persistence

## P1. Resume is a real, working code path — not something to build from scratch

`TeammateManager.streamTeammateOutput` (`packages/runtime/src/ai/server/providers/TeammateManager.ts:1777-2057`)
is the single spawn/resume implementation used by both a fresh teammate spawn and a resume. The only
difference is one field on the SDK options object:

```
if (resumeSessionId) {
  options.resume = resumeSessionId;                          // :1843-1845
}
const teammateQuery = query({ prompt, options });             // :1850
```

`resumeIdleTeammate` (`:2061-2076`) is a thin wrapper: delete from `idleTeammates`, spin up a fresh
`AbortController`, call `streamTeammateOutput(..., idleInfo.sessionId)`. There is no separate
"revive" code path to invent — reviving an ended agent is architecturally the same call with a
different session id and a different source for the row (persisted `completed` metadata instead of
the live `idleTeammates` map).

## P2. The SDK session id already survives past "completed" in most cases

`emitTeammateUpdate` (`:1415-1526`) persists a `currentTeammates` array on the lead session's
`metadata` on every debounced status change, including mid-run emits while the teammate is
`running`/`blocked` (`managed.sessionId` is captured as soon as the SDK's first chunk carries
`session_id`, `:1935-1951`, and threaded into the persisted row via `activityFields.sessionId`
at `:1456`). Because these mid-run emits happen before a teammate ever reaches `completed`, the
persisted row for a **normally-completed** teammate typically still carries a valid `sessionId` —
the code just stops treating that field as usable once `status` flips to `completed`.

## P3. One gate, not a rewrite, blocks resuming a completed teammate

Two checks are the entire block:

1. `TeammateManager.RESUMABLE_PERSISTED_STATUSES = new Set(['idle', 'running', 'blocked'])`
   (`:183`) — used only by `rehydrateIdleTeammate` (`:1323`) to decide whether a persisted row is
   worth reviving after a restart. `completed`/`errored` are excluded on purpose ("terminal and
   must not be brought back").
2. `sendMessageFromHost` (`:1241-1279`) only reaches `rehydrateIdleTeammate` when the agentId is in
   neither `managedTeammates` nor `idleTeammates` — true for any teammate that ever went fully
   `completed`, since `handleStreamCompletion` (`:1533-1608`) removes it from both maps.

Widening (1) to admit `completed` (and threading a "was this a clean finish or an abort?" signal to
avoid reviving something the user explicitly killed) is the natural extension point — it reuses (2)
and (P1) unchanged.

## P4. The UI already renders completed teammates; it just refuses to compose to them

`TeammateTileRail.tsx:110-116`:

```
const canCompose = !!teammate
  && teammate.status !== 'completed'
  && teammate.status !== 'errored';
// comment: "a completed or errored teammate has no process left to receive a message."
```

This comment is the UI's own belief about the backend, and per P1–P2 it is not accurate for the SDK
— a `completed` teammate's SDK session file is exactly as resumable as an `idle` one, per Anthropic's
own docs (see external findings, "Follow up on a completed task" is a first-class documented resume
use case). `TeammateItem` (`TeammatePanel.tsx:341-410`) already dims and strikes through completed
rows and lets a click open the transcript — the render path for "revivable, recently-ended agent"
already exists; only the compose gate and the backend call it invokes need to change.

## P5. Rehydration-after-restart pattern already exists for exactly this shape of problem

`rehydrateIdleTeammate` (`:1298-1338`) already solves "the in-memory maps are empty because
Nimbalyst restarted, but the SDK's on-disk session is still resumable" for `idle`/`running`/`blocked`
rows. It reads `session.metadata.currentTeammates`, finds the row by `agentId`, and reconstructs a
synthetic `IdleTeammate` (falling back to a deterministic `colorForAgentId` hash since color isn't
persisted, and `cwd: this.lastUsedCwd || process.cwd()` since only the live lead knows its real cwd).
This is the direct template for "revive a completed agent": same reconstruction, wider status filter,
called from wherever the UI's new revival action lands instead of only from `sendMessageFromHost`.

## P6. `abandonIdleTeammates` converts recoverable state into terminal state on lead-transport death

`ClaudeCodeProvider.handlePostLeadTurnTeammateState` (`:2428-2478`) calls
`teammateManager.abandonIdleTeammates(sessionId)` when `this.transportDied` (`:2438-2441`) or when
continuation attempts are exhausted (`:2470-2475`). `abandonIdleTeammates`
(`TeammateManager.ts:280-298`) marks every still-idle teammate `completed` with the comment "lead
transport dead ... can no longer be resumed." That claim is about the *lead's* transport, not the
teammate's own SDK session — the teammate's session file is untouched and, per P2, its `sessionId`
is very likely already in the persisted row. This is the single largest source of "recently-ended
agent with revivable state" in the current codebase: every lead crash/restart that had idle
teammates waiting produces exactly this shape, today, and immediately forecloses on it.

## P7. `sendMessageFromHost` is the one call site a revival action could reuse directly

`sendMessageFromHost` (`:1241-1279`) is already the UI-invoked entry point (`ai:sendMessageToTeammate`
→ `AIService.ts` → `TeammateManager.sendMessageFromHost`) for both a running teammate (queue +
`streamInput`) and an idle one (`resumeIdleTeammate`), including the post-restart rehydration case
(P5). A revival feature's happy path is: widen P3's status set, let `rehydrateIdleTeammate` find
`completed` rows too, and this method needs no new branch — the existing idle branch already covers
it once the row is admitted.
