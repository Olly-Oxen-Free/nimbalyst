# Task Brief: 3a

**Title:** Live cold-start end-to-end verification
**PRD:** agent-teams-cold-start-bootstrap
**Priority:** must
**Complexity:** 3/10
**Model:** sonnet
**Wave:** 4
**Feature Issue:** N/A — no_pull_requests mode, tracked via `.nimble/prds/005_agent-teams-cold-start-bootstrap/status.json`

---

## Objective

Reproduce, in the running dev app, the exact scenario that originally exposed this bug: a fresh session with no prior team history, asking Claude to spawn a named agent, and verifying it becomes a real addressable teammate — not a plain anonymous Task. This bug was found via manual testing, not a pre-existing failing test; this task's job is closing that verification gap for good by recording durable evidence, per the repo's end-to-end-verification rule (any bug requiring `/restart` or manual UI exercise needs observed red→green evidence before "fixed" is declared, and this closes the PRD).

---

## Context

**Parent Feature:** Agent Teams Cold-Start Bootstrap (PRD `005_agent-teams-cold-start-bootstrap`)

Every prior task in this PRD (1a, 1b, 2a, 2b) is unit/integration-test verified. None of them proves the fix works in the actual running application, end to end, the way the original bug was discovered — a live user prompt in a fresh session with no team history, hitting the real SDK, the real hooks, the real UI. This task is that proof. It is also the PRD's closing gate: all of R1-R4's end-to-end half is only satisfied once this task's evidence is recorded.

This task is part of **Wave 4** — the final wave, depending on 1b, 2a, and 2b. All prior waves (including the post-Wave-2 human-review gate) must be complete and cleared before starting this task.

**Repo rules that govern how you execute this task (not optional):**
- You run your own observation commands — `get_main_process_logs`, `get_renderer_debug_logs`, `database_query`, etc. **Never ask the user to paste logs or run commands for you.**
- **Restarting the app requires explicit user permission.** Ask before calling `restart_nimbalyst` or any equivalent restart action. Do not restart unilaterally.
- Verify Nimbalyst is running in **dev mode** first (`get_environment_info`) — code changes from 1a/1b/2a/2b won't take effect against a packaged build.
- Redact any secrets/credentials from log excerpts before writing them into `status.json` (per repo redaction rules).

---

## Research Context

### Patterns to Follow

None — this is a live-verification task, not a code-pattern task. The "pattern" to follow is the exact reproduction scenario documented in the PRD (see Requirements below), which mirrors the original live-test session that discovered this bug (session transcript at `~/.claude/projects/-home-jayden-eppcohen-Documents-Projects-Software-nimbalyst/5aa68ce2-5e6b-4483-b3de-5070527a7c3a.jsonl`, per research — you do not need to read this file, it's cited for provenance only).

### Known Issues to Address

- **A leftover `~/.claude/teams/` directory would mask the cold-start path.** `resolveTeamContext`'s directory-fallback branch (`resolveTeamContextFromClaudeDirectories`, called from `TeammateManager.ts:535`, verified) returns a team name if exactly one directory exists under `~/.claude/teams/`. If a stale single-team directory is sitting there from prior manual testing, your "fresh session, no prior team history" scenario would actually exercise the directory-fallback rehydration path instead of the cold-start synthesis path this PRD is meant to prove. **Check `~/.claude/teams/` state before starting** (you have filesystem access via Bash) and clear/rename it aside if a stale single-team directory would interfere — or note in your evidence if you deliberately left it and are testing the fallback path instead.
- **Upstream asymmetric-SendMessage limitation (Q2 in the PRD, GitHub anthropics/claude-code#48160):** a teammate spawned via `name=` may lack the ability to *originate* `SendMessage` back to the lead under the SDK's native flow. Nimbalyst's managed pipeline provides its own routing, so this likely doesn't apply — but if you observe it during step 3 below, **do not fail the task for it**. Document the observed behavior instead (this PRD owns Nimbalyst-side routing only; the upstream half is out of Nimbalyst's control).

### Recommended Approach

**Mechanism check first, before attempting step 1.** This scenario requires submitting a live chat prompt into the running Electron app and observing the model's actual tool call. Confirm you have a real way to do that (an available MCP tool that submits a chat prompt to a running Nimbalyst session — check your own tool list; `submitChatPrompt` is documented in `docs/E2E_TESTING.md:538` as a Playwright E2E helper only, not something callable ad hoc). `get_main_process_logs`/`get_renderer_debug_logs`/`database_query`/`renderer_eval` let you *observe* state but do not *drive* the UI or originate a prompt.

**If no such mechanism is available to you:** do not attempt to fake or skip this step. Instead:
1. Write the five-step scenario below into `status.json`'s `verification.manual_e2e` field as a ready-to-follow script (prompt text, exact log lines to check for, exact pass/fail criteria per step) rather than executed evidence.
2. Set `verification.manual_e2e` to `"AWAITING_USER_EXECUTION"` (not `PENDING`, not a fabricated pass) and note explicitly which step blocked automated execution and why.
3. This is a legitimate, complete way to finish this task — per `.claude/rules/end-to-end-verification.md`, a bug found via manual testing needs observed red→green evidence before "fixed" is declared, and if you cannot personally observe it, saying so plainly is the correct behavior, not a task failure. Do not mark this task `done` implying the live verification happened if it didn't — mark it done as "verification script prepared, execution pending the user."

**If you do have a way to submit a chat prompt**, execute this exact five-step scenario, agent teams enabled, in a **fresh session** with **no prior team history**:

1. **Cold-start named spawn:** Prompt: *"spawn an agent named git-scout to get the most recent git commit"*. Pull `main.log` via `get_main_process_logs` and confirm it shows the teammate spawn path — look for `TEAM-CONTEXT` / `MANAGED-TEAMMATE` log lines (these are the bracketed tags used throughout `TeammateManager.ts`, confirmed live) — and explicitly confirm it does **NOT** show `'SUBAGENT_TASK started: type=local_agent'` (the old failure signature).
2. **UI surfaces:** Confirm the teammate chip appears; open the thread view and confirm it shows a live transcript (PRD 002 surface).
3. **SendMessage round-trip:** Message the teammate from the lead; observe delivery in the logs/UI. Observe whether the teammate's reply reaches the lead. If the upstream asymmetric-SendMessage limitation (see above) manifests, document the observed behavior — do not fail the gate on it.
4. **Stop + resume:** Use the stop control on the teammate; confirm it works. **Ask the user for explicit permission before restarting the app.** After restart (once permitted), confirm the teammate resumes/rehydrates (PRD 003 surface) under the same synthesized team name it used before restart (this is what task 1b's unit test proved in isolation — this step proves it live).
5. **Control case:** Issue an **un-named** delegation request (no name in the prompt) and confirm it still produces the plain `local_agent` path and PRD 004's chip/popover surfaces — i.e. confirm nothing in this PRD broke the existing, correct anonymous-dispatch behavior.

Record evidence (redacted log excerpts, screenshots if useful, explicit pass/fail per step) into `status.json`'s `verification.manual_e2e` field.

### Dependencies

**File Dependencies:** Depends on the fully-landed state of 1a, 1b, 2a, and 2b — this task exercises their combined output live. No source file dependency of its own; it reads and modifies only `status.json`.

**Library Dependencies:** None.

---

## Requirements

Fulfills the end-to-end half of R1-R4; closes the PRD's overall verification gate.

**Path note (informational only):** the PRD's task text notes the deliverable path assumes the PRD folder is numbered `005_` — it is (confirmed: `.nimble/prds/005_agent-teams-cold-start-bootstrap/` exists and is the folder you're reading this brief from). No action needed; this note is preserved from the PRD for completeness.

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] Cold-start named spawn produces a managed teammate (log-evidenced), not `local_agent`
- [ ] Chip, thread view, SendMessage, stop all function on the spawned teammate
- [ ] Post-restart rehydration works under the synthesized team name
- [ ] Un-named delegation control case unchanged (`local_agent` + PRD 004 surfaces)
- [ ] Evidence recorded in `status.json` `verification.manual_e2e`

**All criteria must pass before task is complete.** If the upstream SendMessage-origination limitation (Q2) manifests in step 3, document it as an observation rather than treating it as a failed criterion — it is explicitly carved out above.

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `.nimble/prds/005_agent-teams-cold-start-bootstrap/status.json` | modify | Record `verification.manual_e2e` evidence for all five scenario steps |

### File Ownership Notes

No other task in this PRD touches `status.json`. Update only the `verification.manual_e2e` field (currently `"PENDING (task 3a: ...)"`, verified) — do not alter other fields (`gate`, `tasks`, `approval_note`) as part of this task unless instructed by the orchestrator.

---

## Implementation Guidance

### Patterns to Follow

Use the agent log-access tools directly (`get_main_process_logs`, `get_renderer_debug_logs`) — never ask the user to paste logs, per repo `CLAUDE.md` "Always Run Your Own Observation Commands" rule. Use `database_query` (via the MCP tool) rather than any direct filesystem/CLI DB access if you need to inspect persisted session/teammate metadata — never open the PGLite/SQLite files directly (repo database rule).

### Code Style

N/A — this task's only artifact is a JSON evidence record.

### Edge Cases

- If step 1 fails (still shows `local_agent` path), do not proceed to steps 2-5 as if they passed — stop, record the failure, and flag that an upstream task (most likely 1a) has a landed-but-broken fix that its own unit tests didn't catch. This would be a genuine PRD-blocking finding, not something to work around here.
- If `~/.claude/teams/` state is ambiguous (partial, corrupted, or from an unrelated feature), note what you found and how you handled it in the evidence record — don't silently delete user data (repo destructive-data-paths rule applies even to test artifacts under this path if they could contain real session state).

### Testing Requirements

None — no automated test artifact from this task; the evidence itself is the deliverable.

---

## Boundaries

### Files You MUST NOT Touch

- `node_modules/**`, `dist/**`, `out/**`, `out2/**`, `release/**`, `.vite/**` (global `never_touch`)
- No source files in this task — if you find yourself editing any `.ts`/`.tsx` file to make the scenario pass, stop: that means a prior task's fix is incomplete, and the fix belongs in that task, not here.

### Files Requiring Review

- `package.json`, `package-lock.json`, `packages/electron/src/main/**`, `packages/runtime/src/auth/jwtScopes.ts`, `packages/electron/build/**`, `CHANGELOG.md`. This task should not touch any of these — its only file is `status.json`.

---

## Dependencies

### Upstream Tasks

| Task | What It Provides | Verify Before Starting |
|------|------------------|------------------------|
| 1a | Corrected spawn gate + team synthesis | Confirm 1a's success criteria met |
| 1b | Resume round-trip for synthesized teams | Confirm 1b's success criteria met |
| 2a | `TaskToolWidget` registered for `'Agent'` | Confirm 2a's success criteria met |
| 2b | Rendering discriminator regression coverage | Confirm 2b's success criteria met |

### Downstream Impact

None — this is the final task in the PRD. Its completion closes the PRD's overall gate.

**Before starting:** Confirm all four upstream tasks (1b, 2a, 2b — and transitively 1a) are complete via `status.json`'s `tasks` field. Confirm Nimbalyst is running in dev mode (`get_environment_info`) before starting the live scenario — code changes from prior tasks won't be reflected in a packaged build.

---

## Deliverables

| Artifact | Path | Done when |
|---|---|---|
| Cold-start E2E evidence | `.nimble/prds/005_agent-teams-cold-start-bootstrap/status.json` | All five scenario steps evidenced in `verification.manual_e2e`; any upstream-limitation observation (e.g. Q2/#48160) filed alongside rather than silently dropped |

---

## GitHub Context

**Issue:** N/A — this PRD runs with `no_pull_requests: true` and `execution_mode: feature-branch`; work is tracked via `.nimble/prds/005_agent-teams-cold-start-bootstrap/status.json`, not GitHub Issues/PRs.
**Feature Issue (Parent):** N/A
**Branch:** `worktree/agent-teams-cold-start-bootstrap-3a`
**Target:** feature branch (base: `main`, per `status.json` execution_mode)

---

## Commit Guidelines

Use Conventional Commits, one-sentence subject:
```
docs(nimble): record cold-start E2E verification evidence for agent-teams bootstrap
```
Do not add `Co-Authored-By` lines (repo rule).

---

## Validation Checklist

Before considering this task done:
- [ ] All success criteria met
- [ ] `status.json` is valid JSON and only the intended field was modified
- [ ] No `never_touch` or `require_review` file modified
- [ ] No code changes made in this task (any needed code fix was routed back to the owning upstream task, not made here)
- [ ] Restart step (if reached) was performed only with explicit user permission
- [ ] All log excerpts in the evidence record are redacted per repo rules

---

*Generated by NIMBLE Brief Writer*
*PRD: agent-teams-cold-start-bootstrap | Task: 3a | Wave: 4*
