# Task Brief: 1a

**Title:** Adapt the teammate spawn gate to the implicit-team protocol
**PRD:** agent-teams-cold-start-bootstrap
**Priority:** must
**Complexity:** 7/10
**Model:** opus
**Wave:** 1
**Feature Issue:** N/A — no_pull_requests mode, tracked via `.nimble/prds/005_agent-teams-cold-start-bootstrap/status.json`

---

## Objective

`TeammateManager.handlePreToolUse` intercepts teammate spawns only on `toolName === 'Task' && toolInput?.team_name && toolInput?.name` (`TeammateManager.ts:2209`). The pinned SDK (`@anthropic-ai/claude-agent-sdk@0.3.221`) renamed the model-facing spawn tool `Task` → `Agent` and deprecated `team_name` entirely ("Deprecated; ignored. The session has a single implicit team." — SDK typedef), so a schema-compliant model can never satisfy this gate. This task fixes the gate to match the implicit-team protocol and adds the session-derived team-name synthesis that everything downstream (SendMessage routing, resume, chip UI) depends on.

This is the core fix. Every other task in this PRD depends on the shapes this task lands: the corrected gate condition, the team-resolution order, the flag-plumbing mechanism, and the synthetic tool-pair shape.

---

## Context

**Parent Feature:** Agent Teams Cold-Start Bootstrap (PRD `005_agent-teams-cold-start-bootstrap`)

Nimbalyst previously shipped a full teammate stack: PRD 002 (teammate thread view — click a chip, see a live transcript), PRD 003 (teammate resume reliability), and PRD 004 (task/sub-agent visibility, the fallback surface for anonymous dispatch). All of it hangs off `TeammateManager.handlePreToolUse`'s spawn-interception gate. That gate was written against an older, explicit-team SDK protocol where the model called a `Task` tool and supplied both `team_name` and `name`. SDK 0.3.221 — the version currently pinned — retired that protocol: the tool is now called `Agent`, and `team_name` is deprecated and never sent by a schema-compliant model. The result: **every named delegation request from a cold-start session silently falls through to the plain `local_agent` path**, and PRDs 002/003 are unreachable in production. This was confirmed empirically from a live session transcript: asking Claude to "spawn an agent named git scout" produced tool `Agent` with `name: "git-scout"` and no `team_name` — a fully-formed addressable-agent request that Nimbalyst dropped at the gate.

This task is part of **Wave 1** — it has no dependencies and must land first; 1b, 2a, 2b, and 3a all build on its output shape.

---

## Research Context

### Patterns to Follow

- **Tool-name-rename precedent already exists:** `SUBAGENT_TOOLS = new Set(['Task', 'Agent'])` is already defined in two places — `packages/runtime/src/ai/server/transcript/parsers/ClaudeCodeRawParser.ts:27` and `packages/runtime/src/ai/server/providers/claudeCode/ClaudeCodeTranscriptAdapter.ts:20` (both verified live). The transcript pipeline already recognizes both names; the interception gate is the one place that doesn't.
- **Dependency-injection style for settable flags:** `this.packagedBuildOptions` is the existing pattern for injecting environment-derived config into `TeammateManager` without reading `process.env` inside the class. Plumb `enableAgentTeams` the same way (a settable property or a deps accessor) — do not read `process.env` directly inside `TeammateManager`.
- **`sanitizeName`** (`TeammateManager.ts:326-348`, verified) strips path-traversal characters, then validates against `^[a-zA-Z0-9_-]+$` and **throws** (does not normalize) if the result doesn't match, or if the input is empty/non-string. Any synthesized name must already conform to that regex before it reaches `sanitizeName`.
- **Existing team-name fallback precedent:** `TeammateManager.ts:1286` (inside `rebuildIdleTeammateFromMetadata`, verified) already does `entry.teamName ?? fallbackTeam ?? 'team'` — mirror this `'team'` fallback string when `sessionId` is undefined at synthesis time.

### Known Issues to Address

- **`spawnManagedTeammate` throws on name-only input today.** `TeammateManager.ts:1585` (verified): `const teamName = this.sanitizeName(taskInput.team_name, 'team');` — this throws immediately if `taskInput.team_name` is undefined, which it always will be under the new protocol. You must resolve the team name *before* calling `spawnManagedTeammate`, and either widen its input signature to accept a pre-resolved team name or pass the resolved value through `taskInput` — keep the change surgical (prefer passing the resolved name through rather than restructuring the function).
- **The exact-team match in `agentIdMatchesRecipient` is the reason resolution order matters.** `TeammateManager.ts:382-399` (verified): when a recipient string has no `@` and a `preferredTeam` is supplied, the match requires `team === preferredTeam` exactly (line 390-395). If synthesis ever overwrote an existing resumed session's real team context, every already-spawned teammate under the old team name (e.g. `alice@team`) would become permanently unreachable via `SendMessage({to: 'alice'})`. **This is the PRD's own stated primary risk and was caught by PRD review as a corrected defect (D10/C2) — get the resolution order right.**
- **Design-assumption comment is now stale.** `TeammateManager.ts:2271-2276` states teammates are distinguished from plain sub-agents purely by `team_name` presence — this discriminator no longer exists on the wire. You do not need to rewrite this comment as part of this task, but do not rely on its stated assumption.

### Recommended Approach

**GATE CHANGE** (`TeammateManager.ts:2209`, verified current text: `if (toolName === 'Task' && toolInput?.team_name && toolInput?.name) {`):

Change to intercept on `(toolName === 'Task' || toolName === 'Agent') && toolInput?.name`, additionally conditioned on agent-teams being enabled for the session (the injected flag from above — the old gate free-rode on `team_name`'s mere presence implying teams were active; the new gate has no such free ride since `name` alone is not team-teams-specific). `team_name`, when present, is still honored exactly as today (legacy input, old sessions, old tests).

**STEP 0 (R7 — do this before the gate change):** Add a one-line debug log of the observed `toolName` at the top of the spawn-interception branch. The SDK types `PreToolUseHookInput.tool_name` as a bare `string` (`sdk.d.ts:2248-2253`, per research) — "the hook sees `Agent`" is inferred from the assistant-message tool_use name plus the hook wiring (`ClaudeCodeProvider.ts:505-531`), not doc-confirmed. The log stays in permanently (cheap, diagnostic) — but match on **both** `'Task'` and `'Agent'` regardless of what the log shows, so the fix is correct under either observation.

**TEAM-NAME RESOLUTION ORDER (R2 — this exact order, corrected during PRD review; do not deviate):**

When `toolInput.team_name` is absent, resolve in this order, synthesizing **only** as the last resort:

1. `toolInput.team_name` (legacy, honored exactly as today, if present)
2. `this.currentTeamContext`, if already set
3. `await this.resolveTeamContext(sessionId)` (`TeammateManager.ts:515-543`, verified) — **a resumed old-protocol session has a real team here.** Overwriting it with a synthesized name would break `agentIdMatchesRecipient`'s exact-team match (`TeammateManager.ts:390-395`) and make existing teammates (e.g. `alice@team`) unreachable.
4. Synthesize a stable session-scoped name: `'team-' + <first 8 chars of the lead sessionId>`, **pre-normalized to `^[a-zA-Z0-9_-]+$` before it reaches `sanitizeName`** (sanitizeName throws on non-conforming input rather than normalizing it — see `TeammateManager.ts:326-348`). Fallback to the literal string `'team'` when `sessionId` is undefined, mirroring the existing fallback at `TeammateManager.ts:1286`.

**Why this order, specifically:** a resumed session must find the *same* synthesized (or real) team name it used before — not regenerate a new one — because `SendMessage` routing for already-running teammates keys on `name@team` matching exactly. Reusing `currentTeamContext`/`resolveTeamContext` before ever synthesizing is what guarantees a resumed session's routing stays intact. Synthesis is a *last resort*, never a default.

Set `this.currentTeamContext` to the resolved value so every consumer sees one consistent value in the same session:
- SendMessage routing via `agentIdMatchesRecipient` call sites: `TeammateManager.ts:2116, 2128, 2151, 2166, 2285, 2366, 2437` (all verified)
- Duplicate-spawn denial (`managedTeammates`/`idleTeammates` maps keyed by `name@team`)
- `updateTeamConfig`/inbox paths under `~/.claude/teams/<team>/` (call site near `TeammateManager.ts:977`)

**SYNTHETIC PAIR** (`logSyntheticToolPair`, `TeammateManager.ts:2237-2255`, verified — currently emits `'Task'` as the synthetic `tool_use` name at line 2242): **keep passing `'Task'`** as the synthetic tool_use name. Switching it to the observed `'Agent'` would shift the widget-registry key that task 2a fixes — do not change this. Include the resolved `team_name` in the result payload for log fidelity (the existing result object already includes `team_name: teamName` at line 2248 — keep that field, just feed it the resolved value).

Note for your own understanding (no action needed here): the renderer's teammate-vs-plain-task rendering discriminator derives from the tool_use **args**, not the synthetic result payload — `ClaudeCodeRawParser.ts:510-511` (verified: `const teammateName = typeof args.name === 'string' ? args.name : null;` / `const teamName = typeof args.team_name === 'string' ? args.team_name : null;`), consumed downstream by `isTeammate` in `RichTranscriptView.tsx:1756`. A name-only spawn is already `isTeammate: true` from `args.name` alone. No renderer change is needed for the discriminator as part of this task — that's verified/regression-guarded in task 2b.

**NAME-LESS PASSTHROUGH (R6):** no `name` ⇒ `{ handled: false }`, exactly as today. `run_in_background` on a name-carrying call does **not** change the decision — a named agent is a teammate regardless of whether it runs in the background (PRD decision D3): the managed pipeline already runs teammates without blocking the lead.

### Dependencies

**File Dependencies:** None upstream — this is the first task.

**Library Dependencies:** None new. Uses the already-pinned `@anthropic-ai/claude-agent-sdk@0.3.221`.

---

## Requirements

Fulfills R1 (gate matches implicit-team protocol), R2 (resolution + synthesis order), R3 partially (downstream pipeline integrity — the resume half is task 1b), R6 gate half (name-less passthrough unchanged), R7 (empirical hook-name verification/log).

**RED FIRST (repo end-to-end-verification rule — this is not optional):** Before writing any fix code, add a regression test calling `handlePreToolUse('Agent', {name: 'git-scout', description: '...', prompt: '...', subagent_type: 'general-purpose'}, toolUseId, sessionId)` — the exact empirical live-test shape — and assert it spawns a managed teammate. Run it. Confirm it fails (today it returns `{ handled: false }`). State this red-run evidence in your commit message. Only then write the fix.

**TEST UPDATES:** Existing tests hardcode the old protocol — `resumeReliability.test.ts:255` and `stallWatchdog.test.ts:124` (both verified referenced in research) pass `{team_name:'team', name:'alice'}` spawn inputs; `resumeReliability.test.ts:145` and `:286` are SendMessage tests coupled to the same team. **These must stay green** — legacy input is still honored, nothing about the old-protocol path regresses. Add name-only + `'Agent'`-toolName variants alongside them, including one test that explicitly asserts a resumed session's *existing* team context is reused rather than overwritten by synthesis (this is the regression guard for D10/C2). While in this area, audit `TeammateManager.test.ts` and `sendMessageFromHost.test.ts` for `team_name` coupling and add name-only variants if warranted.

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] Regression test written FIRST and observed failing before the fix (state red-run evidence in the commit message)
- [ ] `handlePreToolUse('Agent', {name, no team_name})` spawns a managed teammate with `agentId` `name@<synthesized-team>` when agent teams are enabled
- [ ] `handlePreToolUse('Task', {name, team_name})` behaves exactly as today (legacy input honored); existing `resumeReliability`/`stallWatchdog` tests untouched and green
- [ ] `handlePreToolUse('Agent', {no name})` returns `{ handled: false }`; agent-teams-disabled sessions never intercept
- [ ] Team resolution order honored: legacy `team_name` > existing `currentTeamContext` > `resolveTeamContext(sessionId)` > synthesis — a resumed session with a real team context spawns into THAT team, never a synthesized one (explicit test)
- [ ] Synthesized team name is stable within a session, pre-normalized so `sanitizeName` cannot throw, and set as `currentTeamContext`; duplicate-spawn denial and SendMessage routing tests pass against it
- [ ] `spawnManagedTeammate` no longer throws on name-only input

**All criteria must pass before task is complete.**

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/runtime/src/ai/server/providers/TeammateManager.ts` | modify | Gate condition (~line 2209), team-resolution/synthesis logic, `enableAgentTeams` flag plumbing, `spawnManagedTeammate` widened to accept a resolved team name (currently throws at line 1585 on missing `team_name`), debug log of observed `toolName` |
| `packages/runtime/src/ai/server/providers/__tests__/` (existing files: `TeammateManager.resumeReliability.test.ts`, `TeammateManager.stallWatchdog.test.ts`, `TeammateManager.test.ts`, `sendMessageFromHost.test.ts`) | modify | Extend with red-first regression test + name-only/`'Agent'`-toolName variants; verify legacy coupling not broken |

### File Ownership Notes

`TeammateManager.ts` is also touched by task 1b (sequenced strictly after this task via `depends_on`, never in the same wave — no concurrent-edit risk). No other task touches this file.

---

## Implementation Guidance

### Patterns to Follow

See Research Context above — dependency injection via a settable property (matching `packagedBuildOptions`), the existing `sanitizeName`/fallback precedents, and the `SUBAGENT_TOOLS` dual-name-recognition precedent already used elsewhere in the transcript pipeline.

### Code Style

Match existing `TeammateManager.ts` conventions: `console.log('[TEAM-CONTEXT] ...')` / `console.log('[MANAGED-TEAMMATE] ...')` bracketed-tag logging style is used throughout — follow it for the new debug log and any new log lines.

### Edge Cases

- `sessionId` undefined at synthesis time → fallback to the literal string `'team'` (mirrors line 1286).
- Session ID shorter than 8 characters → the synthesis spec says "first 8 chars"; if the ID is shorter, use the whole thing (JS string slicing handles this naturally — `sessionId.slice(0, 8)` never throws on a short string).
- A `sessionId` containing characters outside `^[a-zA-Z0-9_-]+$` (unlikely for a UUID-shaped session id, but pre-normalize defensively per the requirement — do not assume session IDs are already clean).
- `run_in_background: true` with a `name` present must still be treated as a teammate spawn — do not special-case it out.

### Testing Requirements

See "Requirements" section above for the red-first test and the full set of variants required. Extend existing test files; do not create new ones per repo token-discipline guidance.

---

## Boundaries

### Files You MUST NOT Touch

- `node_modules/**`, `dist/**`, `out/**`, `out2/**`, `release/**`, `.vite/**` (global `never_touch`)

### Files Requiring Review

- `package.json`, `package-lock.json`, `packages/electron/src/main/**`, `packages/runtime/src/auth/jwtScopes.ts`, `packages/electron/build/**`, `CHANGELOG.md` (global `require_review` list). This task should not need to touch any of these — `TeammateManager.ts` and its own test directory are not in the `require_review` list. If you find yourself needing to touch one of these files, stop and flag it rather than proceeding.

---

## Dependencies

### Upstream Tasks

None — this is the first task (wave 1, no `depends_on`).

### Downstream Impact

Tasks that depend on this one: **1b, 2a, 2b, 3a** (the entire rest of the PRD). Get the gate condition, resolution order, and synthetic-pair shape right — every other task builds directly on what you land here.

**Before starting:** No upstream dependency to verify.

---

## Deliverables

| Artifact | Path | Done when |
|---|---|---|
| Implicit-team spawn gate + session-derived team synthesis | `packages/runtime/src/ai/server/providers/TeammateManager.ts` | Red-first regression test flips green; all success criteria covered by unit tests in existing `TeammateManager` test files |

---

## GitHub Context

**Issue:** N/A — this PRD runs with `no_pull_requests: true` and `execution_mode: feature-branch`; work is tracked via `.nimble/prds/005_agent-teams-cold-start-bootstrap/status.json`, not GitHub Issues/PRs.
**Feature Issue (Parent):** N/A
**Branch:** `worktree/agent-teams-cold-start-bootstrap-1a`
**Target:** feature branch (base: `main`, per `status.json` execution_mode)

---

## Commit Guidelines

Use Conventional Commits, one-sentence subject, per repo `CLAUDE.md` rules:
```
fix(teammate): adapt spawn gate to implicit-team SDK protocol
```
State the red-run evidence (e.g. "regression test confirmed failing pre-fix: `{ handled: false }`") in the commit body as a short bullet. Do not add `Co-Authored-By` lines (repo rule). Do not add `NIM-###` tracker references unless one genuinely exists for this work — cite the GitHub issue if one exists instead.

---

## Validation Checklist

Before considering this task done:
- [ ] All success criteria met
- [ ] Build passes: `npm run build`
- [ ] Type check passes: `npm run typecheck`
- [ ] Test suite passes: `npm run test:prepush`
- [ ] No `never_touch` or unflagged `require_review` files modified
- [ ] Red-first regression test evidence recorded in commit message
- [ ] Existing `resumeReliability`/`stallWatchdog` legacy-protocol tests remain green, untouched in their assertions

---

*Generated by NIMBLE Brief Writer*
*PRD: agent-teams-cold-start-bootstrap | Task: 1a | Wave: 1*
