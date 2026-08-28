# PRD: teammate-stream-and-lifecycle-fixes

## Status

Coordinator running autonomously (user pre-approved all gates for this session; interview
conducted from the user's own confirmed root-cause brief, not a live Q&A). Research
internal-only (repo-internal bugfixes plus one feature request, no library/external question).
Execution rule: NO PRs ever, no `gh` usage; worktree-free-local cadence (PRD 006-009 precedent)
— coordinator commits per task in the main checkout on `feature/teammate-stream-and-lifecycle-fixes`,
final `git merge --ff-only` to main performed by this session per explicit instruction.

## Problem

Live-testing PRD 009 (teammate wake-message mislabeling + wake/shutdown-handshake condensation,
merged as commit `8e085b1cf`) surfaced four further issues, two of them real gaps distinct from
PRD 009's scope, one needing live-data investigation, and one a new feature request.

### Task 1 — Teammate's own live thinking/tool-call stream leaks into lead mainline, uncollapsed

A teammate's own forwarded SDK turns (thinking blocks, SYSTEM REMINDER text, tool calls —
tagged `parent_tool_use_id`, forwarded into the lead's iterator via the `forwardSubagentText`
SDK option) render as bare, uncollapsed turns in the lead's mainline transcript, immediately
after the PRD 009 collapsed card. PRD 009's `teammateOrigin` marker only covers the two
synthetic wake-message injection sites (`deliverMessageToLead`, `deliverRevivalFailure`); it does
not cover this separate forwarded-live-stream path. User's explicit ask: fold the real live
thread (thinking + tool calls) into the same collapsible card PRD 009 built — not just suppress
it. The "View result" accordion showing only the synthetic spawn-acknowledgment string is
low-value without the real thread reachable from the same card.

### Task 2 — Teammates-menu click doesn't open tile (only chip click does)

`TeammatePanel.tsx`'s `handleTeammateClick` (line 78) only calls `setScrollTarget`
(`scrollToTeammateAtom`) — it never opens a tile. Per this session's trigger-map spec: hover
chip → popover; click the spawning message → inline-expand; click the chip OR click the agent in
the Teammates/sub-agents menu → tiling view. The Task-side sibling (`TaskItem` in the same file,
line ~275) already wires `toggleTaskTileAtom` on click. `toggleTeammateTileAtom`
(`agentMode.ts:336`) already exists and is unused by `TeammatePanel.tsx`.

### Task 3 — Revival unavailable for a normally-completed (non-user-shutdown) teammate

A teammate (cpu-scout) that completed normally (not via user shutdown) can no longer be revived.
`TeammateTileRail.tsx`'s `teammateComposeMode` should return `'compose'` directly for
`status === 'completed' && endReason !== 'user-shutdown'` as long as `sessionId` is present and
`endedAt` is within 24h — root cause not yet confirmed; investigate whether `sessionId` is
actually populated on this row, whether PRD 009 commit `541dd3c02` (revival grounding) touched
the completion/persistence path, or whether the affordance renders but silently fails.

### Task 4 — Configurable delay before an idle-completed teammate is auto-shut-down

New feature: a grace-period delay (seconds), default 0 (opt-in, no default-behavior change),
before an idle-completed teammate's shutdown executes, exposed via workspace-settings (IPC, no
`localStorage`). Investigate first whether shutdown is lead-initiated (a tool call the model
makes) or a main-process timer/policy, since that determines whether the delay holds the
shutdown's *execution* after the request, or prevents the lead from requesting it at all.

## Research Findings

Three targeted internal investigations (Explore forks), findings threaded directly into each
task's brief in `tasks.yaml` below. Summary:

- **Task 3 root cause (confirmed):** `handleStreamCompletion`'s else-branch
  (`TeammateManager.ts:1820-1826`) marks a teammate `completed`/`finished` whenever
  `!result.capturedSessionId` (stream ended before the SDK ever emitted a `session_id` chunk) or
  the teammate is background — persisting a missing `sessionId`. `teammateComposeMode`'s
  `sessionId` gate (`TeammateTileRail.tsx:81`) fires before the `endReason` check the ticket
  describes, so the UI renders "no longer active" instead of compose. Not caused by PRD 009
  commit `541dd3c02` (that commit is scoped to revival grounding, doesn't touch completion).
- **Task 4 conclusion (confirmed):** shutdown is lead-initiated (SDK `SendMessage
  type: "shutdown_request"` tool call), not a timer. No existing grace period anywhere in
  `TeammateManager.ts`. Request and execution
  (`flushPendingMessages`/`resumeIdleTeammate` at `TeammateManager.ts:2651-2696` /
  `:2735-2764`) already happen as two distinct steps back-to-back — the natural seam for a
  cancelable delay.
- **Task 1:** see `tasks.yaml` task `1a` — forwarded-stream guard investigation folded directly
  into the task brief.
