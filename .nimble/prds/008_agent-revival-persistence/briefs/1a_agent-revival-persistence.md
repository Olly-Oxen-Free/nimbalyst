# Task Brief: 1a

**Title:** End-reason taxonomy on persisted teammate rows
**PRD:** agent-revival-persistence
**Priority:** must
**Complexity:** 4/10
**Model:** sonnet
**Wave:** 1
**Feature Issue:** none yet — no GitHub issue exists for this PRD. This repo never opens GitHub
PRs; land this via local merge only (see Commit Guidelines).

---

## Objective

Give persisted teammate rows a real "why did this end" field. Today every terminal teammate —
one that finished cleanly, one the user explicitly told to shut down, and one the app abandoned
because the lead's transport died — all collapse into `status: 'completed'` with no way to tell
them apart. This task adds `endReason` and `endedAt` to the persisted row shape and writes them
at every place a teammate goes terminal, so a later task (2a) can gate revival eligibility on the
distinction instead of guessing.

---

## Context

**Parent Feature:** Agent Revival & Persistence — PRD at
`.nimble/prds/008_agent-revival-persistence/PRD_agent-revival-persistence.md`. Not filed as a
GitHub issue.

Nimbalyst's Agent Mode lets a lead agent spawn "teammates" (parallel Claude Agent SDK sessions).
A teammate that finishes goes `idle` (still resumable) or, once no more work is coming,
`completed`/`errored` (currently terminal, un-resumable). The user asked for "recent agents to be
revived with their original context" — a `completed` teammate's SDK session file is usually still
resumable on disk (confirmed: `TeammateManager.emitTeammateUpdate`, `:1415-1526`, persists
`sessionId` on every debounced status change, well before a teammate ever reaches `completed`).
The single largest source of prematurely-terminal-but-actually-revivable teammates is
`abandonIdleTeammates` (`TeammateManager.ts:280-298`), which fires whenever the lead's own
transport dies (restart, abort) and marks every still-viable idle teammate `completed` — an
involuntary loss from the user's point of view, and the case this whole PRD exists to recover.

Building revival on top of bare `completed` would either resurrect teammates the user
deliberately killed, or hide the lead-abandoned case that motivated the request. This task is the
foundation both later tasks (2a's gate, 3a's UI) depend on.

This task is part of **Wave 1** — the sole task in it; nothing else in this PRD can start until
the taxonomy exists, since 1b (cwd persistence), 2a (gate widening), and 3a (UI) all read/write
the same persisted row shape this task defines.

---

## Research Context

### Patterns to Follow

- **`streamTeammateOutput`/`resumeIdleTeammate` are the one spawn/resume code path** —
  `TeammateManager.ts:1777` (confirmed live) both spawns fresh and resumes; not touched by this
  task, but the shape you're adding here (`endReason`/`endedAt`) is what 2a will later read to
  decide whether to call it. Do not add any resume logic in this task — 1a is persistence-only.
- **`scheduleEmitTeammateUpdate` / `emitTeammateUpdate` is the sole write path** for
  `currentTeammates` (`:1364-1392` debounced wrapper, `:1415-1526` the actual writer via
  `AISessionsRepository.updateMetadata`). All five terminal-transition call sites already funnel
  through one of these two functions with a `Map<agentId, status>` override — you are widening
  what travels through that pipe, not adding a new one.
- **`PersistedTeammateRow`** (`TeammateManager.ts:59-69`) is the type describing what a row looks
  like once persisted (it has no `endReason`/`endedAt`/`cwd` fields today — you're adding the
  first two here; `cwd` is task 1b, sequenced after this one in the same file). Its own doc
  comment (`:54-58`) states the contract you must honor: "every field is optional... nothing
  validates them on the way back in" — legacy rows read after this change must default cleanly.

### Known Issues to Address

- The five terminal-transition call sites currently pass **only a status** through the override
  pipe, typed narrowly per call site (e.g. `killAll`'s `Map<string, 'errored' | 'completed'>` at
  `:2112`, `stopByAgentId`'s inline `Map<string, ...>` literals at `:2171`/`:2182`). Carrying
  `endReason`/`endedAt` alongside `status` requires widening the override value type consistently
  across `scheduleEmitTeammateUpdate` (`:1364-1392`), `emitTeammateUpdate` (`:1415-1526`, three
  push/spread sites at `:1447-1476`, `:1478-1493`, `:1495-1510`), and all five call sites. This is
  real surface area — budget for it; it is the actual work of this task, not incidental.
- **Live-verified ambiguity the task description does not resolve — flag before writing the
  `stop`/`stopByAgentId` write site.** The task's write-site list says `stop`/`stopByAgentId` →
  `'finished'`, and "approved shutdown request" (i.e. `result.approvedShutdown`,
  `handleStreamCompletion:1545-1550`) → `'user-shutdown'`. But `stop(name)` (`:2190-2210+`) and
  `stopByAgentId` (`:2164-2188`) are *also* a direct, deliberate user action — the user clicking
  "Stop" on a running or idle teammate — mechanically no less deliberate than an approved
  shutdown-request handshake. The PRD's own success metric table requires "deliberately shut-down
  teammates" to **never** silently resurface. If `stop`/`stopByAgentId` writes `'finished'`, those
  rows become silently revivable under 2a's gate (R2 excludes only `'user-shutdown'`), which
  appears to contradict R1/R2's own stated intent.
  **Decision (settled, not a recommendation — implement this, do not re-litigate):** write
  `'user-shutdown'` for both `stop`/`stopByAgentId` write sites (both the running-teammate branch
  and the idle-teammate branch — `:2164-2188`, `:2190-2210`), matching the success-metric intent,
  not `'finished'` as the task's literal wording states. A UI Stop click is exactly the
  "deliberately shut down" case R1/R2 exist to protect — treating it as `'finished'` would let it
  silently resurface under 2a's gate, which directly contradicts the PRD's own success metric.
- `PersistedTeammateRow` and the inline type in `emitTeammateUpdate` (`:1428-1444`) are two
  separate type declarations describing the same wire shape — historically kept in sync by hand.
  Add `endReason`/`endedAt` to both.

### Recommended Approach

- `endReason` type: `'finished' | 'user-shutdown' | 'lead-abandoned' | 'errored'`. Wire format is
  camelCase (`NAMING_CONVENTIONS.md`) — `endReason`, `endedAt`, not `end_reason`/`ended_at`.
- `endedAt`: epoch ms (`Date.now()`), matching `startedAt`/`lastActiveAt`'s existing convention on
  `ManagedTeammate`/`IdleTeammate` (`:35-37`, `:49-51`).
- Legacy rows (no `endReason` field, or any row written before this change) must default to
  `'finished'` on read, via `??`, per `STATE_PERSISTENCE.md` and this repo's own
  `.claude/rules/state-persistence.md` — do this at the read site(s) that will consume the field
  (2a's gate, 3a's UI), and also consider defaulting defensively wherever this task itself reads
  an existing row back (e.g. the `...tm` spreads in `emitTeammateUpdate`).
- Five write sites, confirmed live and exact:
  1. `abandonIdleTeammates` (`:280-298`) → `'lead-abandoned'`, `endedAt: Date.now()`.
  2. `handleStreamCompletion`'s `result.approvedShutdown` branch (`:1545-1550`) →
     `'user-shutdown'`.
  3. `handleStreamCompletion`'s clean/no-session-id branch (`:1582-1588`) → `'finished'` (this is
     the case where a teammate finished without going idle — either background-agent completion or
     "no session ID" — genuinely a clean finish, not user action).
  4. `handleStreamError` (`:1610-1650`, specifically the `scheduleEmitTeammateUpdate` call at
     `:1627`) → `'errored'`.
  5. `killAll`'s error-path override (`:2110-2146`, specifically the `managedTeammates` loop
     `:2114-2122` which sets `'errored'`) → `'errored'`. The `idleTeammates` loop in the same
     method (`:2125-2133`, which sets `'completed'`) is a `stop`-shaped teammate-kill, not a
     stream error — apply the same `stop`/`stopByAgentId` reasoning above (recommend
     `'user-shutdown'`) for consistency, since `killAll` on an idle teammate is mechanically
     identical to `stopByAgentId` on one; write `'user-shutdown'` here too.
  6. `stop`/`stopByAgentId` (`:2164-2210`) — see "Known Issues" above for the `'finished'` vs
     `'user-shutdown'` call.

### Dependencies

**File Dependencies:** None upstream — this is the first task in the PRD. 1b, 2a, and 3a all
depend on this task's output (the `endReason`/`endedAt` fields existing on `PersistedTeammateRow`
and being written correctly).

**Library Dependencies:** None new.

---

## Requirements

1. Add `endReason: 'finished' | 'user-shutdown' | 'lead-abandoned' | 'errored'` and
   `endedAt?: number` to `PersistedTeammateRow` (`TeammateManager.ts:59-69`) and to the matching
   inline type inside `emitTeammateUpdate` (`:1428-1444`).
2. Write `endReason`/`endedAt` at all five terminal-transition sites listed above, resolving the
   `stop`/`stopByAgentId`/`killAll`-idle-branch ambiguity per the recommendation above (or your
   deliberate, documented deviation from it).
3. Widen `scheduleEmitTeammateUpdate`'s and `emitTeammateUpdate`'s override parameter type from a
   bare status map to something that carries `endReason`/`endedAt` alongside `status` for terminal
   transitions — the exact shape (e.g. `Map<string, { status; endReason?; endedAt? }>`, or a
   parallel map) is your call; keep it minimal and consistent with the existing debounce-merge
   semantics (`:1381-1391`, later overrides win).
4. Legacy rows with no `endReason` field read as `'finished'` via `??` at every read site you
   touch in this task (there should be none yet reading `endReason` for eligibility — that's 2a —
   but make sure nothing you write here can produce an `undefined` `endReason` on a row this task
   itself writes).
5. Red-first unit tests, one per write site (five total), following
   `TeammateManager.stallWatchdog.test.ts`'s mocking pattern (mock
   `../../../../storage/repositories/AISessionsRepository` the way
   `TeammateManager.sendMessageFromHost.test.ts:19-24` and
   `TeammateManager.resumeReliability.test.ts:46-53` both do — capture `updateMetadata`'s payload
   and assert on the persisted `endReason`/`endedAt`).

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] `PersistedTeammateRow` and `emitTeammateUpdate`'s inline type both carry `endReason` and
      `endedAt`
- [ ] All five terminal-transition call sites write a correct `endReason` (with the
      `stop`/`stopByAgentId`/`killAll`-idle-branch decision made explicitly and documented, per
      "Known Issues" above)
- [ ] `endedAt` is persisted alongside `endReason` at every one of the five sites
- [ ] Legacy rows (no `endReason` field) default cleanly to `'finished'` wherever read
- [ ] Five red-first unit tests exist, one per write site, in
      `packages/runtime/src/ai/server/providers/__tests__/TeammateManager.test.ts` (or a
      per-concern file if you judge the general file too crowded — see structure.md's naming
      convention note)
- [ ] `npm run typecheck` and `npm run test:prepush` both pass

**All criteria must pass before task is complete.**

---

## Deliverables

None beyond the files above.

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/runtime/src/ai/server/providers/TeammateManager.ts` | modify | Add `endReason`/`endedAt` to `PersistedTeammateRow` and the `emitTeammateUpdate` inline type; write both at all five terminal-transition sites; widen the override-map plumbing that carries them from call site to writer. |
| `packages/runtime/src/ai/server/providers/__tests__/TeammateManager.test.ts` | modify | Five red-first tests, one per write site. |

### File Ownership Notes

`TeammateManager.ts` is also touched by 1b (immediately after this task, same file, sequenced —
not parallel), 2a, and 2b. This task lands first in the dependency chain; 1b's diff will sit on
top of yours. Keep your diff narrowly scoped to `endReason`/`endedAt` — do not touch `cwd`
persistence (1b's job) or the resume gate (2a's job) even though you'll be looking at adjacent
code.

---

## Implementation Guidance

### Patterns to Follow

See "Research Context" above — it is exhaustive for this task. In short: widen the override-map
type once, thread it through `scheduleEmitTeammateUpdate`/`emitTeammateUpdate`, write at the five
sites.

### Code Style

camelCase wire naming (`NAMING_CONVENTIONS.md`). `??` for defaults on read
(`STATE_PERSISTENCE.md`, `.claude/rules/state-persistence.md`). Match this file's existing
console-log-per-transition convention (`[MANAGED-TEAMMATE] ...`) if you add any new log lines.

### Edge Cases

- A row that reaches `completed` via a path this task does not enumerate (if one exists — verify
  by grepping every `scheduleEmitTeammateUpdate(...'completed'...)` and
  `scheduleEmitTeammateUpdate(...'errored'...)` call site in the file, not just the five named in
  the task, in case the task's own enumeration missed one) must still get a sensible `endReason` —
  do not leave a sixth silent path.
- `emitTeammateUpdate`'s existing `...tm` spread (`:1459`, `:1464`, `:1472`) means a row that
  already has an `endReason` from a prior terminal transition and is then re-emitted (e.g. an
  unrelated status override touching a different agentId in the same debounced batch) must not
  have its `endReason` silently overwritten or dropped by the spread — verify your widened
  override map only sets `endReason`/`endedAt` when the specific agentId's status is actually
  transitioning terminal in that emit, not on every row in the array.

### Testing Requirements

Five red-first tests per success criteria above. Mock `AISessionsRepository` exactly as
`TeammateManager.resumeReliability.test.ts:46-53` does (capture `updateMetadata`'s patch into a
local array so assertions can inspect the persisted row directly, rather than asserting on the
override map's internal shape).

---

## Boundaries

### Files You MUST NOT Touch

Per `.nimble/config.yaml`: `node_modules/**`, `dist/**`, `out/**`, `out2/**`, `release/**`,
`.vite/**`.

### Files Requiring Review

`packages/electron/src/main/**`, `package.json`, `package-lock.json`, `CHANGELOG.md` — this task
does not touch any of these, but note them for awareness if your investigation crosses into
`ClaudeCodeProvider.ts` (that file is `packages/runtime`, not `electron/src/main`, so it is not
review-gated, but double-check before editing anything under `electron/src/main`).

---

## Dependencies

### Upstream Tasks

None — this is the first task in the PRD (Wave 1).

### Downstream Impact

- **1b** (same file, sequenced immediately after) reads/writes the same `PersistedTeammateRow`
  shape to add `cwd`.
- **2a** reads `endReason` to widen the revival gate — verify your `endReason` values are exactly
  the four-member union 2a's brief expects before considering this task done.
- **3a** reads `endReason`/`endedAt` to render the UI's "eligible for revival" state and the
  `user-shutdown` confirm gate.

**Before starting:** No dependencies to verify — this task can start immediately.

---

## GitHub Context

**Issue:** none yet
**Feature Issue (Parent):** none yet
**Branch:** `worktree/agent-revival-persistence-1a`
**Target:** Local merge only — this repo never opens a GitHub PR. The PM agent merges locally
into whatever integration branch the execution mode calls for.

---

## Commit Guidelines

Use Conventional Commits:
```
feat(teammates): add endReason/endedAt taxonomy to persisted teammate rows
```

Types: feat, fix, refactor, test, docs, chore. If you deviate from the `stop`/`stopByAgentId`
recommendation above, say so explicitly in the commit body.

---

## Validation Checklist

Before landing (local merge, not a PR):
- [ ] All success criteria met
- [ ] Build passes: `npm run build`
- [ ] Type check passes: `npm run typecheck`
- [ ] Test gate passes: `npm run test:prepush`
- [ ] No `never_touch` files modified
- [ ] Tests added (five, red-first, one per write site)
- [ ] Branch rebased on target branch

---

*Generated by NIMBLE Brief Writer*
*PRD: agent-revival-persistence | Task: 1a | Wave: 1*
