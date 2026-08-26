# Task Brief: 1a

**Title:** Honest model-facing ack for teammate resume
**PRD:** teammate-resume-reliability
**Priority:** must
**Complexity:** 3/10
**Model:** sonnet
**Wave:** 1
**Feature Issue:** TBD — assigned by PM agent at execution start (no GitHub issue number recorded in the PRD frontmatter yet)

---

## Objective

The lead agent's own `SendMessage` tool call currently gets told, unconditionally, that a message
to an idle teammate was "delivered ... do not retry" — before the resumed teammate process has
produced a single chunk of output. Since resuming is fire-and-forget and can fail, this is a false
claim. This task rewords the two model-facing strings that make this claim so they honestly say
"resume initiated," without touching anything else in the resume path.

---

## Context

**Parent Feature:** Teammate Resume-Delivery Reliability (PRD `teammate-resume-reliability`, GitHub
feature issue TBD)

Nimbalyst's Agent Mode lets a lead agent spawn "teammates" — separate `query()` processes it can
message and that go `idle` between turns, resumed later via `--resume <sessionId>`. When the lead's
own `SendMessage` tool call targets an idle teammate, `TeammateManager.ts`'s tool-routing branch
calls `resumeIdleTeammate` (fire-and-forget, documented as such at `sendMessageFromHost`'s docstring,
`TeammateManager.ts:1185-1189`) and then immediately tells the lead the message was "delivered ...
do not retry" — via two call sites, both in the same branch:

- `logSyntheticToolPair`'s result text, `TeammateManager.ts:2389`
- `denyPreToolUse`'s response, `TeammateManager.ts:2398`

Both currently read (verbatim, confirmed by direct read 2026-08-25):
```
Message delivered to idle teammate "${recipient}" via resume. Do not retry.
```

If the resume then fails — which happens, especially after a Nimbalyst restart, when the underlying
CLI subprocess or session file is stale — the lead already believes the message landed and ends its
turn, never finding out. This PRD's later tasks (1b, 1c) build the failure-wake back to the lead;
this task's job is narrower: stop the immediate ack from overclaiming certainty the code doesn't
have.

This task is part of **Wave 1** — it has no dependencies and is the first task in this PRD's
sequential chain (1a → 1b → 1c → 2a). Task 1b depends on this task because it builds on this task's
wording and shares the same file.

---

## Requirements

Fulfills PRD requirement **R1**: *"The two model-facing strings for resuming an idle teammate
(`TeammateManager.ts` ~2389/2398) no longer state unconditional delivery ('do not retry'); they
accurately describe 'resume initiated' without claiming the message was read. `sendMessageFromHost`'s
return value is untouched."*

Concretely:

1. Reword the two strings at `TeammateManager.ts:2389` (inside `logSyntheticToolPair`'s result
   object, the `message:` field) and `TeammateManager.ts:2398` (the `denyPreToolUse(...)` argument)
   so they convey "resume was initiated" without claiming the message was delivered/read and without
   telling the model "do not retry" as an unconditional fact. Both strings currently interpolate
   `${recipient}` — preserve that interpolation. Suggested shape (not mandatory wording, but must
   satisfy the spirit): something like `Resume initiated for idle teammate "${recipient}"; message
   sent but not yet confirmed delivered.` Keep both call sites' wording consistent with each other,
   as they are today (currently identical strings — no requirement they stay byte-identical, but
   there is no reason to diverge them).
2. **Do NOT touch `sendMessageFromHost`'s `{ delivered: true, wasIdle: true }` return value**
   (`TeammateManager.ts:1213`, `:1225`) or its type signature. That boolean is already honest at the
   host/UI layer — its own docstring (`:1185-1189`) already states `delivered: true` on the idle path
   means "resume was successfully initiated, not that the teammate has necessarily read the message
   yet." It propagates through `ClaudeCodeProvider.ts`, `AIService.ts`, `electron.d.ts`, and a
   renderer consumer (`ai:sendMessageToTeammate` handler, `AIService.ts:3208-3239`, returns
   `{ success: delivered, wasIdle }`). Changing it would make a successful resume render as a failed
   send in the UI — out of scope and unnecessary; the bug is only in the two model-facing strings.
3. **Do NOT touch the shutdown-request handshake's wording.** Confirmed by direct read
   (`TeammateManager.ts:2359` and `:2369`) it never claims delivery and never says "do not retry":
   - `:2359` — `Shutdown request sent to ${recipient}. Request ID: ${requestId}` (the
     `logSyntheticToolPair` result message)
   - `:2369` — `` `Shutdown request sent to idle teammate "${recipient}" (request_id: ${requestId}) and
     awaiting approval.` `` (the `denyPreToolUse` response)
   Both are already honest ("sent ... awaiting approval," never "delivered"). Confirm this still
   holds when you look at the file (line numbers may have shifted slightly since this brief was
   written) but do not spend effort rewording it absent a concrete reason found during
   implementation.
4. **Do NOT touch `resumeIdleTeammate` itself** — it stays fire-and-forget. Only what the
   model-facing `tool_result` claims about that fact changes.

### Explicit anti-goals (rejected during PRD review — do not implement)

- **Do not implement a blocking "wait for first chunk before acking" version.** An earlier draft of
  this PRD's research proposed delaying the ack until `streamTeammateOutput` produces its first
  chunk. This was explicitly rejected during PRD review — it risks the `PreToolUse` hook's own
  timeout. The fix is the honest-immediate-ack wording change described above, not a wait.
- **Do not extend `notifyUndelivered`/the wake-delivery pattern.** That is a different requirement
  (task 1b), not this task's scope.

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] The `logSyntheticToolPair` result text and `denyPreToolUse` response for resuming an idle
      teammate (`TeammateManager.ts:2389` and `:2398`) no longer contain unconditional "delivered ...
      do not retry" language
- [ ] `sendMessageFromHost`'s `delivered: true` return value, its type signature, and all downstream
      consumers (`ClaudeCodeProvider.ts`, `AIService.ts`, `electron.d.ts`, the renderer) are
      completely unchanged by this task
- [ ] The shutdown-request handshake's wording (`TeammateManager.ts:2359`/`:2369`) is confirmed
      unchanged (already honest, verified during PRD review) — not silently rewritten
- [ ] No existing test assertions reference the old wording — confirmed by repo-wide search
      (`grep -rn "Do not retry"` / `grep -rn "delivered to idle teammate"`) before starting this
      task: only `TeammateManager.ts` itself and this PRD's own planning files
      (`PRD_teammate-resume-reliability.md`, `tasks.yaml`, `research/findings.md`) matched — no test
      file references the old strings, so there is nothing to update. If your own search at
      implementation time finds a test file that does reference the old wording (e.g. a test added
      after this brief was written), update its assertions to match the new strings.

**All criteria must pass before task is complete.**

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/runtime/src/ai/server/providers/TeammateManager.ts` | modify | Reword the two model-facing strings at lines 2389 and 2398 (SendMessage tool-routing branch, idle-teammate-resume case) |

### File Ownership Notes

- Task 1b (`depends_on: ["1a"]`) also edits `TeammateManager.ts` — its own scope is
  `handleStreamError` (~1531-1552) and the `ManagedTeammate` construction sites, textually distant
  from this task's edit (~2389/2398). Sequencing (1b depends on 1a) exists so 1b's PR always lands
  on top of this task's landed wording change, avoiding a concurrent-edit window on the same file —
  not because 1b's logic depends on the new string content itself.

---

## Implementation Guidance

### Patterns to Follow

This is a wording-only change to two strings in one method (the `SendMessage` tool-routing branch,
not `sendMessageFromHost`). Match the existing style of the surrounding strings in the same branch —
plain interpolated template literals, no i18n/translation layer in this codebase for these
model-facing tool-result strings.

### Code Style

No new patterns needed. Keep both strings consistent with each other (see Requirements item 1).

### Edge Cases

None beyond the two exact call sites — this is a narrow, mechanical wording change. The teammate
running-not-idle path (`TeammateManager.ts:2328`, `Message delivered to running teammate ... via
managed channel. Do not retry.`) is a **different** case (message queued via `streamInput` to a
teammate whose process is actually live, not a resume) and is **not** in scope for this task —
`streamInput` delivery to a running process is a materially different reliability story than
resuming a dead one, and the PRD's scope (R1) names only the two idle-resume strings. Do not reword
it.

### Testing Requirements

No pre-existing test file exercises this branch (confirmed: `TeammateManager.ts` has no test file
today apart from what other tasks in this PRD/prior PRDs may add). This task does not require adding
a new test file of its own — task 2a (this PRD's dedicated test task, gated on 1a/1b/1c) is
responsible for covering the new wording as part of its broader resume-reliability test suite (see
its own success criteria: "resume-then-fail no longer produces the old 'delivered ... do not retry'
model-facing strings"). If you want to leave a marker for that task, a one-line comment near the new
strings is fine but not required.

---

## Boundaries

### Files You MUST NOT Touch

Global `never_touch` list (from `.nimble/config.yaml`):
- `node_modules/**`
- `dist/**`
- `out/**`
- `out2/**`
- `release/**`
- `.vite/**`

PRD-specific boundaries for this task:
- Do not touch `sendMessageFromHost`'s return value/type (`TeammateManager.ts:1213`, `:1225`) or any
  of its downstream consumers (`ClaudeCodeProvider.ts`, `AIService.ts`, `electron.d.ts`, renderer).
- Do not touch the shutdown-request handshake's wording (`:2359`/`:2369`) absent a concrete reason
  found during implementation.
- Do not touch the "running teammate via managed channel" string (`:2328`) — different code path,
  out of scope.
- Do not implement a blocking/wait-for-first-chunk ack (rejected during PRD review — see "Explicit
  anti-goals" above).

### Files Requiring Review

`TeammateManager.ts` is not in `.nimble/config.yaml`'s `require_review` list
(`package.json`, `package-lock.json`, `packages/electron/src/main/**`,
`packages/runtime/src/auth/jwtScopes.ts`, `packages/electron/build/**`, `CHANGELOG.md`). This task
does not trigger the PRD's human-review gate on its own.

---

## Dependencies

### Upstream Tasks

None — this task has `depends_on: []` and is Wave 1, the first task in this PRD.

### Downstream Impact

| Task | What it needs from 1a | Why |
|------|------------------------|-----|
| 1b | This task's wording change landed on `TeammateManager.ts` first | 1b's own brief notes it "builds on 1a's wording" and shares the same file; sequencing avoids a concurrent-edit window. |

**Before starting:** No upstream dependency to verify — this task starts from the current state of
`main`/the feature branch.

---

## GitHub Context

**Issue:** TBD — created by PM agent at execution start
**Feature Issue (Parent):** TBD — created by PM agent at execution start
**Branch:** `worktree/teammate-resume-reliability-1a`
**Target:** Determined by PM agent based on execution mode (feature branch or main)

---

## Commit Guidelines

Use Conventional Commits:
```
fix(teammates): stop claiming unconditional delivery on idle-teammate resume ack
```

Types: feat, fix, refactor, test, docs, chore

---

## Deliverables

None beyond the files above (inferred — not captured at interview; `tasks.yaml` has no
`deliverables` field for this task). The reworded strings are the only artifact this task produces.

---

## Validation Checklist

Before creating PR:
- [ ] All success criteria met
- [ ] Build passes: `npm run build`
- [ ] Type check passes: `npm run typecheck`
- [ ] No `never_touch` files modified
- [ ] Tests added/updated (none required for this task; confirm no test references the old wording — see Success Criteria)
- [ ] Branch rebased on target branch (feature branch or main)

---

*Generated by NIMBLE Brief Writer*
*PRD: teammate-resume-reliability | Task: 1a | Wave: 1*
