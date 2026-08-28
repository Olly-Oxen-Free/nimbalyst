# External Best Practices — Agent Revival & Persistence

## Resuming a completed session is a first-class, documented SDK pattern — not a workaround

Per Anthropic's own Agent SDK "Work with sessions" guide, the first listed reason to use `resume` is
explicitly: **"Follow up on a completed task. The agent already analyzed something; now you want it
to act on that analysis without re-reading files."** This directly answers the narrow external
question this PRD's scoping poses: the SDK does not distinguish "resume an idle session" from
"resume a completed session" at the API or transcript level — both are just `resume: sessionId` on a
fresh `query()` call. Nimbalyst's own `RESUMABLE_PERSISTED_STATUSES` gate (internal findings, point 3)
is a Nimbalyst-side policy decision, not a technical constraint imposed by the SDK.

## Constraints that do apply, and matter for a revival feature specifically

- **Same-machine requirement.** "Same machine only: the session file still needs to exist on the
  current machine." A teammate revived from a different machine (a different Nimbalyst install, a
  synced workspace opened elsewhere) cannot resume — the session's `.jsonl` transcript is local disk
  state, not synced by Nimbalyst's collab layer. Cross-host resume requires either shipping the
  transcript file or a `SessionStore` adapter — neither exists in this codebase today.
- **cwd-scoped lookup.** Session files live under a directory keyed by the *encoded absolute cwd* the
  session was created in (`~/.claude/projects/<encoded-cwd>/`). As of CLI v2.1.223+, lookup searches
  beyond the exact directory (git worktrees and beyond); before that, lookup was scoped to the exact
  project directory and its worktrees. This directly interacts with the codebase's own known gap
  (internal findings point 7 / errors.md E4): if `rehydrateIdleTeammate`'s cwd fallback doesn't match
  the teammate's original cwd, resume can silently fail to find the session even though the
  `sessionId` is correct.
- **No documented expiry.** The guide describes no TTL/expiry on session files themselves — resumability
  is bounded by "does the file still exist," not by elapsed time. This means "recently-ended" in the
  feature's framing is a UX/product choice (how far back to surface in a revival list), not a
  technical deadline imposed by the SDK.
- **`forkSession` is a distinct, unused-here option** worth flagging as a design choice, not a
  requirement: resuming in place (current teammate behavior) continues the *same* history; forking
  would let a revived agent branch from the old history while leaving the original session intact.
  Nimbalyst's teammate resume today always resumes in place (`options.resume` without `forkSession`);
  a revival feature could choose either, but should be an explicit decision, not a default carried
  over by omission.

## No best-practice guidance found for the Task-sub-agent case, because none applies

Task-tool sub-agents, as documented and as implemented in this codebase, are not independent SDK
sessions (internal findings points 10-11). There is no external SDK guidance on "resuming a Task
sub-agent" because the SDK does not expose Task sub-agents as resumable entities at all — this is
confirmed by the sessions doc's exclusive framing of `resume`/`continue`/`fork` around `query()`-level
sessions, with no mention of an equivalent for in-session tool-level sub-agents.
