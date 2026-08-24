# Brief Review Findings: agent-visibility

**Reviewed:** 2026-08-24
**Briefs reviewed:** 12/12

## Critical (1)

### Undocumented same-wave file conflict between 1a and 1b

Task 1a (add `blocked` to `TeammateInfo.status`) must edit
`packages/runtime/src/ai/server/providers/ClaudeCodeProvider.ts` to register
`toolPermission:pending`/`toolPermission:resolved` listeners — `TeammateManager` is deliberately
decoupled from `EventEmitter` (`TeammateManager.ts:59,70`) and cannot observe those events itself.
Verified necessary against source, not assumed.

`tasks.yaml`'s `1a.files_affected` doesn't list `ClaudeCodeProvider.ts`, `1a.depends_on` and
`1b.depends_on` are both `[]`, and `execution_plan.yaml` schedules them in the same wave (1) with
no ordering — but 1b already edits `ClaudeCodeProvider.ts`'s `canUseTool` routing. Every other
same-file/different-region pair in this PRD (`1b→4a`, `3a→4b`, `3a→4c`) got a `depends_on` edge
purely to avoid a concurrent edit window; 1a/1b is the one pair that didn't, because the conflict
wasn't discovered until brief-writing.

**Fix (recommended):** add `depends_on: ["1b"]` to task 1a (or the reverse), matching this PRD's
own established convention. Adds one wave to the critical path (6→7 waves).
**Alternative (schedule-preserving):** declare `ClaudeCodeProvider.ts` in `1a.files_affected` and
document the overlap in `dependencies.md`, accepting a rebase-at-merge risk instead of serializing.

## Warnings (2)

1. **`briefs/3b_agent-visibility.md` states the wrong wave.** Says "Wave 4 (depends on task 3a,
   wave 3)"; actual: 3b is wave 3, 3a is wave 2. `execution_plan.yaml` itself is correct — only the
   brief's prose is wrong. Doesn't affect orchestration (which reads `execution_plan.yaml`
   directly) but misleads a human or executing agent reasoning about concurrency with 3a.
2. **`tasks.yaml`'s `files_affected` undercounts real edits for 1a, 2b, 2c** — each brief's own
   investigation found a file `tasks.yaml` doesn't list (`ClaudeCodeProvider.ts` for 1a — see
   Critical above; `SessionTranscript.tsx` for 2b; a new IPC handler + `preload/index.ts` for 2c).
   2b/2c's additions don't collide with any other task, so only 1a's rises to Critical, but the
   artifact should reflect investigated reality.

## Observations (3)

- All file:line citations spot-checked and confirmed accurate against current source.
- All 12 briefs carry the mandatory `## Deliverables` section.
- Dependency chain, wave assignment, and the single require-review gate (CHANGELOG.md, only
  triggered by 5a) are otherwise sound.

## Verdict

Proceed with caution — one Critical finding, narrow and mechanically fixable (a `tasks.yaml` /
`dependencies.md` edit, not a redesign). Nothing else blocks execution.
