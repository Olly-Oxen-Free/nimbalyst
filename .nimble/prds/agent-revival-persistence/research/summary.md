# Research Summary — Agent Revival & Persistence (Feasibility Scoping)

Mode: internal-only + one narrow external question. This PRD is scoping only, not scheduled for
execution.

## The one-line answer

**Teammate revival is a small, well-bounded extension of existing resume machinery. Task sub-agent
revival is a different, weaker feature with no existing machinery to extend — it would mean
"spawn new, seed with old transcript," not "resume."**

## Why teammate revival is mostly extension (high confidence)

- `TeammateManager.streamTeammateOutput` already spawns and resumes through one function; resume is
  just `options.resume = sessionId` passed to the SDK's `query()` (`TeammateManager.ts:1777-2057`,
  `:1843-1845`).
- The SDK session id is already persisted to `ai_sessions.metadata.currentTeammates[].sessionId` for
  most teammates well before they reach `completed` (`:1935-1951`, `:1456`).
- Anthropic's own docs confirm resuming a *completed* SDK session is a first-class, documented use
  case, identical in mechanics to resuming an idle one — Nimbalyst's refusal to do so is entirely a
  self-imposed gate: `RESUMABLE_PERSISTED_STATUSES = new Set(['idle', 'running', 'blocked'])`
  (`TeammateManager.ts:183`), consumed only by `rehydrateIdleTeammate` (`:1298-1338`).
- The UI already lists `completed` teammates from the exact array a revival feature would read; it
  only refuses to open the compose box for them (`TeammateTileRail.tsx:110-116`), on the strength of a
  comment ("no process left to receive a message") that this research shows is not accurate at the
  SDK level.
- This gate is deliberate and tested: `TeammateManager.sendMessageFromHost.test.ts:193-200` pins
  today's refusal as a named regression test the feature must consciously invert, not route around.

## Why it is not zero net-new work (genuine gaps, not oversold)

- **No "why did this end" distinction exists.** `completed` today conflates a clean finish, a
  user-approved shutdown, and an app-crash/lead-transport-death abandonment
  (`abandonIdleTeammates`, `:280-298`) into one status with no field to tell them apart. Revival
  without this distinction either hides the most valuable case (crash recovery) or resurrects
  teammates the user deliberately killed.
- **cwd is not persisted per-teammate**; rehydration falls back to the *lead's* last-used cwd, which
  can be wrong if the teammate's worktree differs — and worktree cleanup is a real, independently
  observed event in this codebase (`extractTeamNameFromToolResult`'s "Cleaned up directories and
  worktrees for team" match, `:653`) that can outlive the metadata row.
- **No delivery target for a revival-failure when no lead turn is active.** PRD 003's fix wires
  resume failures back into the lead's live conversation; a revival UI action fired when the lead
  session itself isn't running has nothing today to report failure into.
- **UI compose affordance for completed rows does not exist**, only the read path does — small but
  real net-new UI work.
- **Unresolved:** whether/when `ai_sessions` rows get pruned or archived was not located in this pass
  and directly bounds how far back "recently-ended" can honestly reach — flagged as an open question
  below.

## Task sub-agents: confirmed no resume mechanism, converging internal + external evidence

- Internal: `ClaudeCodeProvider.activeTasks` has no `sessionId` field at all (`:305-328`); Task
  sub-agent output is reconstructed by filtering the *lead's own* raw transcript
  (`ai:getTaskSubagentTranscript`, `AIService.ts:3343-3373`), because a Task sub-agent never was an
  independent SDK session.
- External: Anthropic's session-management docs describe `resume`/`continue`/`fork` exclusively at
  the `query()` level, with no mechanism for resuming an in-session Task-tool sub-agent.
- Consequence: "revive a Task sub-agent" can only honestly mean spawning a *new* agent seeded with the
  old sub-agent's reconstructed transcript as prompt context — no real session, permission, or memory
  continuity. Any product framing should not promise "resumes as if it were the same agent" for this
  path, because that claim is true for teammates and false for Task sub-agents.

## Open questions for the human (genuinely open, not rhetorical)

1. **Session/metadata retention:** is there any existing pruning/archival of `ai_sessions` rows that
   would silently cap how far back a "recently-ended agents" list can reach? Not located in this pass.
2. **Product framing for the two revival guarantees:** should teammate revival and Task-sub-agent
   "revival" be presented identically to the user, or does the weaker guarantee for Task sub-agents
   need distinct language/UX (e.g. "restart with context" vs. "resume")?
3. **Which `completed` sub-cases should be revivable by default?** Clean finish and crash-abandoned
   both seem safe; user-approved shutdown is more debatable — does the user want a way to bring back
   something they explicitly told to stop?
4. **cwd/worktree correctness:** does the team's worktree need to still exist for revival, and if it
   was cleaned up, should revival be blocked, or re-provisioned?
5. **Cross-machine/cross-restart scope:** is revival meant to work only within the same Nimbalyst
   install (same machine, same `~/.claude/projects` tree), or does it need to survive a workspace
   being reopened from a synced/cloned copy — the SDK's session files are local-disk only and would
   not travel with either.

## Artifacts

- `research/internal/patterns.md` — 7 patterns, all file:line cited
- `research/internal/errors.md` — 5 gaps/inconsistencies, all file:line cited
- `research/internal/dependencies.md` — full state-required table + module dependency graph
- `research/internal/structure.md` — ownership map + naming conventions to reuse
- `research/internal/findings.md` — consolidated internal findings (12 points)
- `research/external/best-practices.md`, `references.md`, `sources.yaml` — SDK resume semantics
- `research/external/findings.md` — consolidated external findings
