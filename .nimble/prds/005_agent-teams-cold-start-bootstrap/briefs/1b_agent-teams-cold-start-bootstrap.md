# Task Brief: 1b

**Title:** Resume/rehydration with synthesized teams; mark legacy explicit-team surface
**PRD:** agent-teams-cold-start-bootstrap
**Priority:** must
**Complexity:** 4/10
**Model:** sonnet
**Wave:** 2
**Feature Issue:** N/A — no_pull_requests mode, tracked via `.nimble/prds/005_agent-teams-cold-start-bootstrap/status.json`

---

## Objective

Task 1a made the spawn gate synthesize a session-derived team name when the model supplies none. This task proves — with a test — that a session which spawned a teammate under a synthesized team name can **resume** and find the **same** synthesized name again, not regenerate a different one (which would silently break `SendMessage` routing to already-running teammates). It also marks the now-deprecated explicit-team code surfaces as legacy, without removing or changing their behavior.

---

## Context

**Parent Feature:** Agent Teams Cold-Start Bootstrap (PRD `005_agent-teams-cold-start-bootstrap`)

PRD 003 (teammate-resume-reliability) shipped a resume flow for teammates that assumes team context can always be rehydrated after a manager restart. Under the old explicit-team protocol, the team name always came from the model (`team_name`), so resume just had to persist and re-read that value. Under the new implicit-team protocol (task 1a), a team name may instead be **synthesized** by Nimbalyst itself when the model doesn't supply one. If a resumed session's `resolveTeamContext` regenerated a *new* synthesized name instead of finding the one it used at spawn time, every persisted teammate row keyed by the old `name@team` agent-id would become permanently unaddressable — `SendMessage({to: name})` would resolve to a team that no teammate is actually running under. This task closes that gap with a round-trip test.

This is a **must-have gate item**: R4 in the PRD ("Resume reliability preserved") is not satisfied until this task's test is green.

This task is part of **Wave 2** — it runs in parallel with task 2a (file-disjoint: this task touches `packages/runtime/src/ai/server/providers/**`, 2a touches `packages/electron/src/renderer/**`). **A gate follows Wave 2**: `packages/runtime/src/ai/server/providers/**` is not itself in the repo's `require_review` boundary list, but the PRD's own execution plan schedules a human-review checkpoint after this wave specifically to eyeball task 1a's gate/resolution diff — the single most behavior-changing edit in the PRD — before the verification waves (2b, 3a) invest against its landed shape. Do not skip past this checkpoint; it is enforced by the orchestrator, not by you, but be aware later tasks in this PRD are blocked on it.

---

## Research Context

### Patterns to Follow

- **`resolveTeamContext`** (`TeammateManager.ts:515-543`, verified) is a pure rehydration cascade with this exact order: in-memory `this.currentTeamContext` → `resolveTeamContextFromTrackedTeammates()` (line 521, from in-memory `managedTeammates`/`idleTeammates` maps) → `resolveTeamContextFromSessionMetadata(sessionId)` (line 528, reads persisted `metadata.currentTeammates` rows) → `resolveTeamContextFromClaudeDirectories()` (line 535, single-directory fallback under `~/.claude/teams/`). A fresh manager instance (simulating a restart) has empty in-memory maps, so the test that matters here exercises the **metadata** branch (line 528).
- **`emitTeammateUpdate`** (`TeammateManager.ts:1373-1468`, verified) is what persists the `currentTeammates[]` rows to session metadata — it does **not** write a separate `metadata.currentTeamContext` field. The rehydration cascade's metadata branch reads `metadata.currentTeammates` (verified at `TeammateManager.ts:451`, inside `resolveTeamContextFromSessionMetadata`), not a dedicated team-context field. **Do not add a new metadata field** — the existing `currentTeammates[].teamName` cascade is the one your test must prove sufficient. Only add a new field if your test demonstrates the existing cascade is genuinely insufficient (unexpected; flag if you hit this).
- **Existing resume test setup to mirror:** the resume test in `TeammateManager.resumeReliability.test.ts` already mocks `AISessionsRepository` and exercises a fresh-manager-instance resume scenario — follow that same mocking pattern rather than inventing a new harness.
- **Fallback precedent:** `TeammateManager.ts:1286` (inside `rebuildIdleTeammateFromMetadata`, verified) does `entry.teamName ?? fallbackTeam ?? 'team'` — this is the resume-side counterpart of 1a's synthesis fallback; your test should confirm a synthesized `teamName` row round-trips through this path correctly (i.e. `entry.teamName` is populated, so this fallback chain never needs to reach `fallbackTeam`/`'team'` for a properly-synthesized name).

### Known Issues to Address

- **`enableAgentTeams` is assigned in four provider files — do not remove the declaration.** `ClaudeCodePromptOptions.enableAgentTeams` (`packages/runtime/src/ai/prompt.ts:110`, verified) is unread inside `prompt.ts` itself, which might look like dead code, but it is **assigned** at these four verified call sites: `ClaudeCodeProvider.ts:4194`, `OpenAICodexProvider.ts:1902`, `OpenAICodexACPProvider.ts:518`, `CopilotCLIProvider.ts:437`. Removing the declaration breaks typecheck in all four files. This was a corrected draft defect during PRD review (D10/W2) — do not repeat it.
- **`CLAUDE_CODE_ENABLE_TASKS`'s continued relevance in SDK 0.3.x is undocumented** (research found no source confirming or denying it's still load-bearing). Keep setting it — it is at worst a no-op. Do not remove it without evidence; this is an open question (Q1 in the PRD) that task 3a's live run is positioned to observe, not something to resolve here.

### Recommended Approach

**RESUME TEST (R4):** Write a unit test with a mocked `AISessionsRepository` (mirror the existing `resumeReliability` test setup) that exercises this exact round-trip:

1. Spawn a teammate via 1a's new name-only path → a synthesized `teamName` is produced (e.g. `team-abc12345`).
2. `emitTeammateUpdate` persists a `currentTeammates[]` row whose `teamName` is that synthesized value.
3. Construct a **fresh** `TeammateManager` instance (simulating a manager restart — in-memory state is empty).
4. Call `resolveTeamContext(sessionId)` on the fresh instance → assert it returns the **same** synthesized team name (not a newly-generated one).
5. Assert the resume path (`rebuildIdleTeammateFromMetadata` or the equivalent resume entry point already exercised by the existing `resumeReliability` suite) accepts the rehydrated team and produces a usable teammate entry.

**LEAD ENV BLOCK (R8, PRD decision D5 — mark, do not remove):** `sdkOptionsBuilder.ts:489-503` (verified: `if (enableAgentTeams) { env.CLAUDE_CODE_ENABLE_TASKS = '1'; }` at 489-491, then `effectiveTeamContext` resolution and the conditional `CLAUDE_CODE_TEAM_NAME`/`CLAUDE_CODE_TASK_LIST_ID`/`CLAUDE_CODE_AGENT_ID`/`CLAUDE_CODE_AGENT_NAME`/`CLAUDE_CODE_AGENT_TYPE` block at 497-503). Keep `CLAUDE_CODE_ENABLE_TASKS=1`. Keep the `resolveTeamContext` call and the conditional env block exactly as-is (it only fires when a team context already exists — resumed old-protocol or post-spawn sessions — the SDK ignores the deprecated vars in all other cases). **No behavior change to this block** — only add a short legacy comment.

Also add the same short legacy comment (do not change behavior) to:
- The teammate-subprocess env/`extraArgs` block, `TeammateManager.ts:1736-1752` (verified: `extraArgs: { 'agent-id', 'agent-name', 'team-name', 'agent-color', 'agent-type' }` at 1736-1742, then `env: { ...baseEnv, CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS, CLAUDE_CODE_ENABLE_TASKS, CLAUDE_CODE_TEAM_NAME, CLAUDE_CODE_TASK_LIST_ID, CLAUDE_CODE_AGENT_ID, CLAUDE_CODE_AGENT_NAME, CLAUDE_CODE_AGENT_TYPE }` at 1743-1752).
- `extractTeamNameFromToolResult` and its call sites (`TeammateManager.ts:550-660` approx, verified starting at 550 — it parses `TeamCreate` tool results, and no `TeamCreate` tool exists in SDK 0.3.221's tool surface per research).

Comment format suggestion (match existing comment style in the file): `// legacy (explicit-team protocol, SDK <0.3.x)`.

Use `npm run typecheck` to confirm the `prompt.ts:110` declaration you must NOT remove doesn't cause any issue, and that nothing else regresses.

### Dependencies

**File Dependencies:** Depends on task 1a's landed gate/resolution-order/synthesis logic in `TeammateManager.ts`. Verify 1a is complete before starting: read the current state of `handlePreToolUse` (`TeammateManager.ts:~2209`) and confirm the gate condition is `(toolName === 'Task' || toolName === 'Agent') && toolInput?.name` with the resolution order (legacy `team_name` → `currentTeamContext` → `resolveTeamContext(sessionId)` → synthesis) implemented, and that `spawnManagedTeammate` no longer throws on name-only input.

**Library Dependencies:** None new.

---

## Requirements

Fulfills R4 (resume reliability preserved), R8 (legacy surface marked), and the resume half of R3 (downstream pipeline integrity).

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] Unit test: a teammate spawned via the name-only path persists rows whose `teamName` is the synthesized team; a fresh manager's `resolveTeamContext` returns it; the resume path accepts it
- [ ] `CLAUDE_CODE_ENABLE_TASKS` still set when agent teams enabled; no env var removed
- [ ] Legacy comments present on the three explicit-team surfaces (lead env block, teammate-subprocess env/extraArgs block, `extractTeamNameFromToolResult`); no functional change to them
- [ ] `npm run typecheck` green; no existing `sdkOptionsBuilder`/`TeammateManager` test regresses
- [ ] `ClaudeCodePromptOptions.enableAgentTeams` (`prompt.ts:110`) declaration NOT removed

**All criteria must pass before task is complete.**

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/runtime/src/ai/server/providers/TeammateManager.ts` | modify | Legacy comments on teammate-subprocess env/extraArgs block (~1736-1752) and `extractTeamNameFromToolResult` (~550-660); no behavior change |
| `packages/runtime/src/ai/server/providers/claudeCode/sdkOptionsBuilder.ts` | modify | Legacy comment on lead env block (489-503); no behavior change |
| `packages/runtime/src/ai/server/providers/__tests__/` (resume test extension, e.g. `TeammateManager.resumeReliability.test.ts`) | modify | New resume round-trip test for synthesized team names |

### File Ownership Notes

`TeammateManager.ts` is also touched by task 1a, which lands strictly before this task (`depends_on: ["1a"]`) — never in the same wave, so there is no concurrent-edit conflict. `sdkOptionsBuilder.ts` is touched only by this task in this PRD.

---

## Implementation Guidance

### Patterns to Follow

Mirror the existing `resumeReliability` test file's mocking of `AISessionsRepository` and its fresh-manager-instance resume pattern. Match the file's existing bracketed-tag `console.log` style if you add any diagnostic logging (you shouldn't need to for this task — it's test-only + comments).

### Code Style

Comments should be short, single-line where possible, matching the terse inline-comment style already used throughout `TeammateManager.ts` and `sdkOptionsBuilder.ts` (see the existing multi-line explanatory comments in `sdkOptionsBuilder.ts` around the env block for tone/format, but keep your additions to one line each — this is a marking exercise, not a rewrite).

### Edge Cases

- A resumed session whose persisted `currentTeammates[]` row has `teamName: undefined` (very old data, pre-dating this PRD) should still fall back gracefully via the existing `?? fallbackTeam ?? 'team'` chain at line 1286 — this is pre-existing behavior, just confirm your test doesn't accidentally break it.
- Multiple teammates in the same session sharing one synthesized team name — the round-trip test should use at least one teammate row but does not need to enumerate every multi-teammate combination (that's out of scope; 1a's own tests cover duplicate-spawn denial).

### Testing Requirements

Extend the existing `resumeReliability` test file (or a clearly-named sibling in the same `__tests__/` directory) rather than creating a new file, per repo token-discipline guidance. The new test must exercise a genuine fresh-instance restart simulation, not just call `resolveTeamContext` on the same instance that did the spawn (that would not prove anything about rehydration).

---

## Boundaries

### Files You MUST NOT Touch

- `node_modules/**`, `dist/**`, `out/**`, `out2/**`, `release/**`, `.vite/**` (global `never_touch`)

### Files Requiring Review

- `package.json`, `package-lock.json`, `packages/electron/src/main/**`, `packages/runtime/src/auth/jwtScopes.ts`, `packages/electron/build/**`, `CHANGELOG.md`. This task's files (`TeammateManager.ts`, `sdkOptionsBuilder.ts`, and their tests) are **not** in this list, but the PRD schedules a human-review gate after Wave 2 (this wave) regardless — see Context section above. Complete your work normally; the gate is enforced by the orchestrator after both 1b and 2a land.

---

## Dependencies

### Upstream Tasks

| Task | What It Provides | Verify Before Starting |
|------|------------------|------------------------|
| 1a | The corrected spawn gate, team-resolution/synthesis order, `enableAgentTeams` flag plumbing, and a `spawnManagedTeammate` that accepts name-only input | Read `TeammateManager.ts:~2209` (`handlePreToolUse`) and confirm the gate condition and resolution order match this brief's description; confirm 1a's own tests are green |

### Downstream Impact

Tasks that depend on this one: **3a** (live cold-start E2E, which verifies post-restart rehydration in the running app — this task's unit test is the pre-flight proof that the mechanism works before 3a exercises it manually).

**Before starting:** Verify 1a is complete by reading the current `handlePreToolUse` implementation and confirming its own success criteria (listed in 1a's brief) are satisfied — do not proceed against a partially-landed 1a.

---

## Deliverables

| Artifact | Path | Done when |
|---|---|---|
| Synthesized-team resume round-trip test + legacy markers | `packages/runtime/src/ai/server/providers/__tests__/` | Resume round-trip test green in the existing `resumeReliability` (or sibling) test file; legacy comments present on all three surfaces with no functional change |

---

## GitHub Context

**Issue:** N/A — this PRD runs with `no_pull_requests: true` and `execution_mode: feature-branch`; work is tracked via `.nimble/prds/005_agent-teams-cold-start-bootstrap/status.json`, not GitHub Issues/PRs.
**Feature Issue (Parent):** N/A
**Branch:** `worktree/agent-teams-cold-start-bootstrap-1b`
**Target:** feature branch (base: `main`, per `status.json` execution_mode)

---

## Commit Guidelines

Use Conventional Commits, one-sentence subject:
```
test(teammate): verify synthesized-team resume round-trip; mark legacy explicit-team surface
```
Do not add `Co-Authored-By` lines (repo rule).

---

## Validation Checklist

Before considering this task done:
- [ ] All success criteria met
- [ ] Build passes: `npm run build`
- [ ] Type check passes: `npm run typecheck`
- [ ] Test suite passes: `npm run test:prepush`
- [ ] No `never_touch` or unflagged `require_review` files modified
- [ ] `enableAgentTeams` declaration on `prompt.ts:110` still present
- [ ] No functional change to any of the three legacy-marked surfaces (comment-only diffs)

**Note:** this task, together with 2a, is followed by a PRD-level human-review gate (after Wave 2) before tasks 2b/3a proceed — see Context section.

---

*Generated by NIMBLE Brief Writer*
*PRD: agent-teams-cold-start-bootstrap | Task: 1b | Wave: 2*
