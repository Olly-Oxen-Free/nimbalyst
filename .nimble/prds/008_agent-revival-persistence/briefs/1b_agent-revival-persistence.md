# Task Brief: 1b

**Title:** Persist spawn cwd per teammate row
**PRD:** agent-revival-persistence
**Priority:** must
**Complexity:** 2/10
**Model:** sonnet
**Wave:** 2
**Feature Issue:** none yet — no GitHub issue exists for this PRD. This repo never opens GitHub
PRs; land this via local merge only (see Commit Guidelines).

---

## Objective

Persist the teammate's actual spawn `cwd` on its row in `currentTeammates`, and make
rehydration/revival use it instead of silently borrowing the lead's own cwd. Today, when a
process never spawned a given teammate (post-restart, or reviving a teammate ended in a prior
process), reconstruction falls back to `this.lastUsedCwd || process.cwd()` — wrong whenever the
team ran in its own worktree, and a correctness risk once revival extends the resumable window
from "still running this app session" to "the user came back hours later," by which point a
worktree may have been cleaned up or reassigned.

---

## Context

**Parent Feature:** Agent Revival & Persistence — PRD at
`.nimble/prds/008_agent-revival-persistence/PRD_agent-revival-persistence.md`. Not filed as a
GitHub issue.

Confirmed live: `TeammateManager.spawnManagedTeammate` (`:1654-1712`) and
`spawnBackgroundAgent` (`:1725-1773`) both compute `cwd = this.lastUsedCwd || process.cwd()`
(`:1668`, `:1736`) at spawn time and pass it into `streamTeammateOutput`'s `options.cwd`
(`:1789`, `options.cwd` set at `:1809`) — but this computed `cwd` is never written into the
`currentTeammates` metadata row. `rehydrateIdleTeammate` (`:1298-1338`) reconstructs a synthetic
`IdleTeammate` for a teammate this process never spawned, and its `cwd` field
(`:1333: cwd: this.lastUsedCwd || process.cwd()`) falls back to whatever the *current* process's
lead last used — which may be a different cwd than the one this specific teammate actually ran in,
if the team spawned into its own git worktree.

This task is part of **Wave 2** — sequenced immediately after 1a, in the same file. It does not
touch the resume gate itself (that's 2a); it only makes sure that when 2a later widens the gate to
admit `completed`/`errored` rows, revival resumes into the *correct* directory, and fails cleanly
(not silently into the wrong place) when that directory no longer exists.

---

## Research Context

### Patterns to Follow

- **`fsp.access(path)` is this file's established existence-check idiom** — confirmed at
  `TeammateManager.ts:505`, `:788`, `:799`, `:876` (all `import fsp from 'fs/promises'`,
  `:15`). Use this, not a new dependency, for the cwd-existence check.
- **`emitTeammateUpdate` is the sole write path** (`:1415-1526`) — same three push/spread sites 1a
  touched (`:1447-1476`, `:1478-1493`, `:1495-1510`) need a `cwd` field added alongside the
  `endReason`/`endedAt` 1a just added. `PersistedTeammateRow` (`:59-69`) needs `cwd?: string`
  added to match.
- **`rehydrateIdleTeammate`** (`:1298-1338`) is the read/reconstruction site. Its `cwd` line
  (`:1333`) is the exact line the PRD, research, and this brief all point at — change its fallback
  order to prefer `entry.cwd` (the newly-persisted per-row value) over `this.lastUsedCwd`.

### Known Issues to Address

- ⚠️ **Worktree cleanup can outlive the metadata row.**
  `extractTeamNameFromToolResult` matches a "Cleaned up directories and worktrees for team ..."
  string (`:653`), confirming worktree teardown is a real, already-observed event decoupled from a
  given teammate's own completion. If a team's worktree was cleaned up after (or independent of) a
  teammate going idle/completed, resuming into the persisted `cwd` would point the SDK session at
  a directory that either no longer exists, or — worse — has been reassigned to something else.
  This task's job is the **existence check + clean failure**, not any coupling to worktree
  lifecycle: per the resolved open question, **do not** add worktree-cleanup blocking or warning
  behavior. Fail-clean-on-revive is the entire scope here.
- The revival-time existence check this task adds must surface a **typed failure**, not throw an
  uncaught exception and not silently fall back to `process.cwd()` (which would resume the SDK
  session in a directory that has nothing to do with the original teammate — arguably worse than
  refusing outright). Task 2b consumes this failure to drive its no-live-lead delivery path — keep
  the failure shape simple and importable (e.g. a distinguishable `Error` subclass or a tagged
  return value), and document it clearly since 2b's author needs to consume it without re-reading
  this entire file.

### Recommended Approach

- Add `cwd?: string` to `PersistedTeammateRow` (`:59-69`) and the `emitTeammateUpdate` inline type
  (`:1428-1444`).
- At spawn (`spawnManagedTeammate:1654-1712`, `spawnBackgroundAgent:1725-1773`), thread the
  already-computed `cwd` (`:1668`, `:1736`) into the row the next `emitTeammateUpdate` call
  persists — likely via the same `idleTemplate`/`ManagedTeammate` shape these functions already
  build, since `emitTeammateUpdate`'s `managed` branch (`:1450-1457`) already pulls
  `activityFields` off the live `ManagedTeammate`; `cwd` isn't currently a field on
  `ManagedTeammate` (`:22-38`) — you likely need to add it there too so it's available to
  `emitTeammateUpdate` without threading a new parameter through every call site.
- At `rehydrateIdleTeammate` (`:1298-1338`), change `:1333` from
  `cwd: this.lastUsedCwd || process.cwd()` to prefer `entry.cwd`, falling back to the current
  behavior only for legacy rows written before this field existed
  (`entry.cwd ?? this.lastUsedCwd ?? process.cwd()` — order matters: the row's own cwd is now the
  most authoritative source, current-process fallback stays as the legacy-row safety net).
- Add the existence check as a small helper (`fsp.access`) called at the point revival is actually
  about to resume — likely inside or adjacent to `rehydrateIdleTeammate`, or at the `resumeIdleTeammate`
  call site, your call — and make it return/throw a typed failure 2b can catch and route to its
  fallback notification + transcript-line delivery.

### Dependencies

**File Dependencies:** Depends on 1a landing first — same file, same `PersistedTeammateRow`/
`emitTeammateUpdate` inline type this task extends. Do not start until 1a's `endReason`/`endedAt`
fields exist, to avoid a merge conflict on the same struct literals.

**Library Dependencies:** None new — `fsp` (`fs/promises`) is already imported.

---

## Requirements

1. `PersistedTeammateRow` and `emitTeammateUpdate`'s inline type both gain `cwd?: string`.
2. Spawn-time `cwd` (already computed at `:1668`/`:1736`) is threaded into the persisted row on
   the next emit — likely via adding `cwd` to `ManagedTeammate` (`:22-38`) so
   `emitTeammateUpdate`'s `managed` branch can read it.
3. `rehydrateIdleTeammate` (`:1333`) prefers the persisted row's own `cwd` over
   `this.lastUsedCwd`, falling back to current behavior only for rows written before this field
   existed.
4. A revival-time existence check (`fsp.access`, matching this file's established idiom) runs
   before a rehydrated/revived teammate is resumed into a persisted `cwd`, and surfaces a typed,
   catchable failure — not an uncaught throw, not a silent fallback to `process.cwd()` — when the
   directory does not exist.
5. No worktree-cleanup blocking/warning behavior is added (explicitly out of scope per resolved
   open question 4).
6. Red-first unit tests in `TeammateManager.resumeReliability.test.ts` (matching its existing
   `AISessionsRepository` mock pattern, `:46-53`, and `IdleTeammate`/`TeammateManagerDeps` import
   style, `:68`).

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] Spawn cwd is persisted on the teammate's row (verify by inspecting the `updateMetadata`
      payload in a test, not just by reading the code)
- [ ] `rehydrateIdleTeammate` prefers the persisted row's `cwd` over `this.lastUsedCwd` when
      present
- [ ] Legacy rows (no `cwd` field) fall back to current behavior (`this.lastUsedCwd || process.cwd()`)
      without throwing
- [ ] A missing-directory case at revival time surfaces a typed, catchable failure — verified by a
      test that points a persisted row's `cwd` at a nonexistent path and asserts the failure shape
- [ ] No worktree-cleanup coupling added
- [ ] `npm run typecheck` and `npm run test:prepush` both pass

**All criteria must pass before task is complete.**

---

## Deliverables

None beyond the files above.

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/runtime/src/ai/server/providers/TeammateManager.ts` | modify | Add `cwd` to `PersistedTeammateRow`/`ManagedTeammate`/the `emitTeammateUpdate` inline type; thread spawn-time cwd into the persisted row; prefer persisted `cwd` in `rehydrateIdleTeammate`; add the existence-check helper with a typed failure. |
| `packages/runtime/src/ai/server/providers/__tests__/TeammateManager.resumeReliability.test.ts` | modify | Red-first tests: cwd persisted and preferred on rehydration; missing-dir case surfaces the typed failure. |

### File Ownership Notes

Same file as 1a — this task is sequenced after it, not parallel. Do not re-touch the
`endReason`/`endedAt` plumbing 1a added; only add `cwd` alongside it in the same struct literals.
2a and 2b both land on top of this task's diff in wave 3.

---

## Implementation Guidance

### Patterns to Follow

See "Research Context" above.

### Code Style

camelCase wire naming. `??`/`||` defaults per `STATE_PERSISTENCE.md`.

### Edge Cases

- A teammate spawned before this task's code ships has no `cwd` on its persisted row — must not
  throw when `rehydrateIdleTeammate` reads it, must fall back exactly as it does today.
- The existence check must not be so eager that it fires for a teammate still genuinely `idle` in
  the *same* process (i.e. `sendMessageFromHost`'s live `idle` branch, `:1260-1264`, which never
  goes through `rehydrateIdleTeammate` at all) — scope the check to the rehydration/revival path
  specifically, not every message delivery.

### Testing Requirements

Two tests minimum per success criteria: (1) cwd round-trips through persist → rehydrate, preferred
over `lastUsedCwd`; (2) a rehydration attempt against a persisted `cwd` pointing at a directory
that does not exist surfaces the typed failure without throwing uncaught or silently defaulting.

---

## Boundaries

### Files You MUST NOT Touch

Per `.nimble/config.yaml`: `node_modules/**`, `dist/**`, `out/**`, `out2/**`, `release/**`,
`.vite/**`.

### Files Requiring Review

None touched by this task fall under `require_review`.

---

## Dependencies

### Upstream Tasks

| Task | What It Provides | Verify Before Starting |
|------|------------------|------------------------|
| 1a | `endReason`/`endedAt` on `PersistedTeammateRow` and the `emitTeammateUpdate` inline type, plus the widened override-map plumbing | Read the current state of `PersistedTeammateRow` (`:59-69`) and confirm `endReason`/`endedAt` are present before adding `cwd` alongside them |

### Downstream Impact

- **2a** widens the resume gate that will call into this task's rehydration path.
- **2b** consumes the typed missing-directory failure this task introduces, to drive its
  no-live-lead notification/transcript-line delivery.
- **3b** exercises the restart-shaped rehydration path this task modifies.

**Before starting:** Verify 1a has landed — `PersistedTeammateRow` should already carry
`endReason`/`endedAt` in `TeammateManager.ts:59-69`.

---

## GitHub Context

**Issue:** none yet
**Feature Issue (Parent):** none yet
**Branch:** `worktree/agent-revival-persistence-1b`
**Target:** Local merge only — this repo never opens a GitHub PR.

---

## Commit Guidelines

Use Conventional Commits:
```
feat(teammates): persist spawn cwd per teammate row, fail clean on missing dir
```

---

## Validation Checklist

Before landing (local merge, not a PR):
- [ ] All success criteria met
- [ ] Build passes: `npm run build`
- [ ] Type check passes: `npm run typecheck`
- [ ] Test gate passes: `npm run test:prepush`
- [ ] No `never_touch` files modified
- [ ] Tests added
- [ ] Branch rebased on target branch

---

*Generated by NIMBLE Brief Writer*
*PRD: agent-revival-persistence | Task: 1b | Wave: 2*
