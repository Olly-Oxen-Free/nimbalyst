# External Findings (Consolidated) — Agent Revival & Persistence

Scope: one narrow external question per task framing — does the Claude Agent SDK support `resume`
with a session id for a session that has already completed, and what constrains it?

## Answer: yes, unconditionally, and it is the documented primary use case

Anthropic's own Agent SDK "Work with sessions" guide lists "Follow up on a completed task" as the
first reason to use `resume`, with no distinction in the API between resuming an in-progress,
idle/interrupted, or cleanly-completed session — `resume: sessionId` is the same call in every case.
This is the single most important fact for this PRD's feasibility question: **Nimbalyst's inability
to revive a `completed` teammate today is entirely self-imposed policy
(`RESUMABLE_PERSISTED_STATUSES`, `TeammateManager.ts:183`), not an SDK-level limitation.** See internal
findings for the full internal-side evidence.

## Constraints that do carry real implementation risk

1. **Same machine only.** Session `.jsonl` transcripts are local disk files under
   `~/.claude/projects/<encoded-cwd>/`; there is no built-in sync. A teammate revived on a different
   machine/install cannot resume unless Nimbalyst ships the file or adopts a `SessionStore` adapter —
   neither exists today.
2. **cwd-scoped file lookup**, with lookup scope having changed at CLI v2.1.223 (pre-223: exact
   project dir + worktrees only; post-223: broader cross-directory search). This interacts directly
   with the known codebase gap that `rehydrateIdleTeammate` guesses cwd from the *lead's*
   `lastUsedCwd`, not the teammate's own original cwd.
3. **No documented expiry** — resumability is bounded by file existence, not elapsed time, so
   "recently-ended" is a product/UX decision this feature gets to make freely, not a technical ceiling.
4. **`forkSession` exists as an alternative to in-place resume** and was not evaluated by this PRD's
   framing; worth an explicit design decision (fork vs. resume-in-place) rather than defaulting to
   whichever the existing teammate code path already does (resume-in-place, no fork).

## Task sub-agents: confirmed, no equivalent exists

The SDK's session model (`resume`/`continue`/`fork`) operates only at the `query()` level. Task-tool
sub-agents are not `query()`-level sessions in this codebase's implementation (internal findings,
points 10-11) and the SDK documentation exposes no separate resumable identity for them. This is a
convergent finding between internal (code has no `sessionId` field for tasks) and external (SDK docs
describe no such mechanism) research — high confidence.
