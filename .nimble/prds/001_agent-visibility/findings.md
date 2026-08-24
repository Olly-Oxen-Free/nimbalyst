# Findings: Agent Visibility and Workflow Enhancement

**PRD Slug:** `agent-visibility`
**Created:** 2026-08-20

_This file tracks cross-task discoveries made by agents during execution. It is distinct from
`research/findings.md`, which captured the pre-interview investigation into the tracker item's
five asks._

<!-- FINDING_ENTRIES_START -->

### 2026-08-24 — Worker-agent isolation worktree does not honor the PM-provided worktree path

The `nimble:nimble-implementer-opus` agent spawned for task 1b was placed by the harness into its
own isolation worktree under the **main** checkout
(`/home/jayden-eppcohen/Documents/Projects/Software/nimbalyst/.claude/worktrees/agent-<id>`,
branch `worktree-agent-<id>`), not into the `.nimble/.worktrees/agent-visibility/1b` worktree the
PM pre-created on branch `worktree/agent-visibility-1b`. This appears to be a property of the
`isolation: worktree` agent definition mechanism itself (independent of NIMBLE's own worktree
scheme) and could not be overridden by prompt instruction alone.

Mitigation used successfully: since all worktrees in this environment share one git object
database, the worker fast-forwarded its own isolation worktree to the current
`feature/agent-visibility` tip before implementing, then committed there. The PM located the
resulting commit by hash (reported by the worker) and merged it into `feature/agent-visibility`
directly (`git merge --ff-only <hash>`), rather than merging from the PM-created
`.nimble/.worktrees/agent-visibility/{taskId}` path. The PM-created worktree for 1b went unused
and was removed.

**Process adjustment for remaining waves:** the PM no longer pre-creates
`.nimble/.worktrees/agent-visibility/{taskId}` worktrees before spawning workers — they go
unused. Each worker is instructed to build on top of the current `feature/agent-visibility` tip
(fast-forwarding its own isolation worktree if needed, since the object database is shared) and to
report its final commit hash. The PM merges that commit hash directly into `feature/agent-visibility`
(fast-forward when possible; a normal merge when a sibling in the same wave landed first).

<!-- FINDING_ENTRIES_END -->
