# Internal Errors / Gaps / Inconsistencies — Agent Revival & Persistence

## E1. Task sub-agents have zero resumable identity — "revival" cannot mean the same thing for them

`ClaudeCodeProvider.activeTasks` (`packages/runtime/src/ai/server/providers/ClaudeCodeProvider.ts:305-328`)
tracks Task-tool sub-agents by `taskId`/`toolUseId` only. There is no `sessionId` field anywhere on
this shape — confirmed by reading the full type at those lines. A Task sub-agent is not a separate
`query()` invocation; it is an SDK-internal tool call inside the lead's own single session
(`CLAUDE_CODE_ENABLE_TASKS=1` on the teammate spawn options, `TeammateManager.ts:1823`, is the same
mechanism nested one level deeper for teammates that themselves use Task).

The transcript UI (`ai:getTaskSubagentTranscript`, `AIService.ts:3343-3373`) confirms this
architecturally: its own comment says "A Task sub-agent has no session row of its own:
`forwardSubagentText` relays its chunks through the LEAD session's own iterator" — the sub-agent's
output is *reconstructed* by filtering the lead's raw transcript for chunks tagged with the
sub-agent's `parent_tool_use_id`, not read from an independent session file.

**Consequence:** there is no `resume`-with-session-id path the SDK exposes for a Task sub-agent,
because no such session was ever created. "Revive a Task sub-agent" cannot be a widened status
filter the way teammate revival is (P3 in patterns.md) — it can only mean: spawn a brand-new
teammate (or another Task) and seed its prompt with the old sub-agent's reconstructed transcript as
context. That is a materially different, and materially smaller-guarantee, feature than teammate
revival: the new agent has no real conversation history, permission state, or SDK-side memory of
what it already did — only whatever text the seed prompt hands it.

## E2. `abandonIdleTeammates` is a one-way door with no distinction between "user killed it" and "app crashed out from under it"

`abandonIdleTeammates` (`TeammateManager.ts:280-298`) unconditionally sets every idle teammate to
`completed`. There is no separate terminal status (e.g. `abandoned`) that would let a future revival
UI distinguish "this teammate finished its own work and went idle, then the lead's session ended
before anyone acted on it" from "the user explicitly told this teammate to shut down"
(`approvedShutdown` path, `handleStreamCompletion:1545-1550`, also lands on `completed`). Building
revival on top of `completed` as currently defined means a revival affordance would surface
teammates the user deliberately terminated right alongside ones that were abandoned by an app crash,
with no field in `currentTeammates` to tell them apart. `wasResumed` (`ManagedTeammate.wasResumed`,
`:34`) is close but is on the in-memory `ManagedTeammate`, not the persisted `PersistedTeammateRow`
(`:59-69`) — it does not survive to the metadata row a revival UI would read after restart.

## E3. `PersistedTeammateRow` has no schema versioning / validation — silently tolerates missing fields

The type's own doc comment (`TeammateManager.ts:54-58`) says: "Every field is optional: rows written
before a field existed keep their old shape, and nothing validates them on the way back in."
`rehydrateIdleTeammate` (`:1298-1338`) already defends against this (`typeof sessionId !== 'string'`
check, `:1318`), but a revival feature reading `startedAt`/`toolCallCount`/`cwd`-adjacent fields off
old rows written before this PRD should expect the same silent-gap behavior — there is no migration
path, only defensive `??`/optional-chaining at each read site.

## E4. Worktree cleanup can outlive the metadata row that would let you revive into it

`extractTeamNameFromToolResult` matches a "Cleaned up directories and worktrees for team ..." string
(`TeammateManager.ts:653`), i.e. team worktree teardown is a real, already-observed event in this
codebase, decoupled from the teammate's own completion. If a team's worktree/cwd was cleaned up
after (or independent of) a given teammate going idle/completed, `rehydrateIdleTeammate`'s
`cwd: this.lastUsedCwd || process.cwd()` fallback (`:1333`) would resume the SDK session pointed at
a cwd that either no longer exists or (worse) has been reassigned to something else. Nothing in the
current code checks worktree liveness before a resume attempt — this is a real, not hypothetical,
failure mode for revival specifically because revival extends the resumable window from "still
running this app session" to "the user came back later."

## E5. The current "no revival" behavior is already pinned by a named test — this feature must delete/invert it, not just add code

`TeammateManager.sendMessageFromHost.test.ts:193-200`, `'does not resume a teammate that already
reached a terminal status'`, asserts exactly `{ delivered: false, wasIdle: false }` for a persisted
row with `status: 'completed'`. This is the current behavior's regression test, and it is the precise
inverse of what an agent-revival feature needs to be true. Any implementation must consciously flip
this assertion (and add the "was this abandoned-by-crash vs. deliberately-shut-down" distinction from
E2 so the new passing case doesn't also silently resume teammates the user explicitly killed) — this
is not an oversight to patch around, it is a deliberate prior decision (PRD 003's "'completed'/
'errored' are terminal and must not be brought back", `TeammateManager.ts:1320-1323`) that this
feature exists to reverse.
