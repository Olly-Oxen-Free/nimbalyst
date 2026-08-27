# Pre-Execution Brief Review — PRD 005 (agent-teams-cold-start-bootstrap)

Reviewed: `tasks.yaml`, `execution_plan.yaml`, `status.json`, `.nimble/config.yaml`, all 5 briefs,
the live repo source they cite, and — since the PRD's premise rests on it — the pinned SDK's own
type declarations. Every file:line citation in every brief was checked against current `main` and the
installed SDK package, including the foundational ones (not just repo-internal line numbers):

- Repo source: gate at `TeammateManager.ts:2209`, `sanitizeName` at 322-347, `spawnManagedTeammate`
  throw at 1585, `resolveTeamContext` at 514-543, `agentIdMatchesRecipient` call sites,
  `logSyntheticToolPair` call at 2239, `sdkOptionsBuilder.ts` env block at 489-503, `prompt.ts:110` +
  all 4 provider assignment sites, `ClaudeCodeRawParser.ts:509-511`, `RichTranscriptView.tsx:1756/1766`,
  `AgentMode.tsx:279-283`, `ClaudeSettingsManager.ts:340-393`, the existing
  `resumeReliability`/`stallWatchdog` test line numbers, and the hook-wiring call site
  `ClaudeCodeProvider.ts:505-531` (`teammatePreToolHandler` passing `toolName` straight through to
  `handlePreToolUse` — confirms the hook wiring the brief describes).
- SDK premise: `@anthropic-ai/claude-agent-sdk` is pinned at `0.3.221` in root `package.json:142`
  (workspace packages use `^0.3.221`, resolving to the same installed version) — matches the PRD's
  stated pin. `node_modules/@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:512` confirms
  `team_name?: string` with doc comment "Deprecated; ignored. The session has a single implicit
  team." — matches the PRD's quoted text verbatim. The same file's `AgentInput` interface (line 484)
  confirms the spawn tool's input type carries `name?: string` ("Makes it addressable via
  SendMessage({to: name}) while running") — the tool-rename premise (`Task` → `Agent`) and the
  `team_name`-deprecation premise are both real, not inferred. `sdk.d.ts:2247-2253` confirms
  `PreToolUseHookInput.tool_name: string` (bare string, no literal-union narrowing) — matches the
  brief's "inferred, not doc-confirmed" framing for why 1a keeps a diagnostic log and matches both
  names defensively.
- Brief 1a's "TeammateManager does not currently know `enableAgentTeams`" claim: confirmed —
  zero occurrences of `enableAgentTeams` in `TeammateManager.ts` today; the flag genuinely needs to be
  plumbed in as the brief instructs, not already present.

No stale or unverifiable citations found, including the ones that point outside the repo.

**Clearance status: PROCEED WITH CAUTION** — no Critical findings that block execution as written,
but one Warning (3a's execution mechanism) should be resolved before that task starts, and it can be
resolved without touching the brief's substance (it's a tooling/scope question, not a plan defect).

---

## Task order / dependency check

Confirmed against `tasks.yaml`, `execution_plan.yaml`, and `briefs.overview.md` — all three agree:
1a (wave1, no deps) → {1b, 2a} (wave2, both `depends_on: ["1a"]` only) → 2b (wave3,
`depends_on: ["1a","2a"]`) → 3a (wave4, `depends_on: ["1b","2a","2b"]`).

No hidden interdependency between 1b and 2a: 1b touches `TeammateManager.ts` (after 1a via
`depends_on`, never same-wave as 1a) and `sdkOptionsBuilder.ts`; 2a touches `AgentMode.tsx` and
(optionally) `ClaudeSettingsManager.ts`. Zero file overlap between 1b and 2a — parallel wave-2
execution is safe as planned.

One asymmetry worth flagging as an **Observation**: 2b's `depends_on` in `tasks.yaml` is
`["1a", "2a"]`, but the prompt's stated wave graph implied 2b only needs 1a+2a — this matches; no
issue. 3a's `depends_on` is `["1b", "2a", "2b"]`, which is *not* a strict superset that includes 1a —
but 1a is a transitive dependency through both 1b and 2b, so this is correct, not a gap.

---

## Critical Findings

None. No brief contradicts the PRD, no cited line number is stale, no file-state assumption is
wrong, and no required config/command is missing.

---

## Warnings

### Finding W1 — Brief 3a does not specify how a worker agent submits the chat prompt into the running app

**Affected file:** `briefs/3a_agent-teams-cold-start-bootstrap.md`, "Recommended Approach" step 1
("Prompt: *'spawn an agent named git-scout...'*") and the whole five-step scenario.

**Actual state:** The brief instructs the executing agent to reproduce a live chat interaction —
type/submit a prompt into Agent Mode's chat, observe a reply, send a follow-up SendMessage, use the
stop control — inside the running dev Electron app. Repo tooling exposes `renderer_eval` (documented
in `docs/DEVELOPING_NIMBALYST.md:52` and `docs/THE_HARNESS.md` as "runs JavaScript in the renderer to
inspect DOM state, styles, and runtime values" — an inspection tool, not a documented action-driving
one) and `get_main_process_logs`/`get_renderer_debug_logs`/`database_query`/`restart_nimbalyst`. The
repo *does* have an established pattern for scripting a chat submission —
`docs/E2E_TESTING.md:538`, `submitChatPrompt(page, prompt, options)` — but that is a Playwright test
helper used inside `*.spec.ts` E2E test files, not something callable ad hoc against a live dev
instance via the extension-dev MCP tools the brief cites. Neither the PRD, the research findings, nor
the brief names a concrete mechanism for step 1.

**Problem:** A worker agent executing this brief literally has no specified tool to "prompt Claude" in
the running app the way the original manual bug discovery did. It could attempt to abuse
`renderer_eval` to dispatch synthetic DOM events or call an exposed chat-submit function, but that is
improvised, undocumented as an intended use of that tool, and not what the brief describes. This is
exactly the class of gap the repo's own `end-to-end-verification.md` rule exists to prevent silently
papering over — a bug "requiring a user to manually exercise a UI flow" is supposed to get a scripted
reproduction, and this brief's scenario is that manual flow, restated as if an unattended worker can
run it standalone.

**Correction needed:** Before 3a executes, resolve one of:
1. Add an explicit instruction to use `submitChatPrompt`-style Playwright scripting (point to the
   existing E2E harness pattern, e.g. a `RUN_COLLAB_TESTS`-style gated live test) as the mechanism for
   step 1, rather than an unscripted "prompt the app" instruction; or
2. Have the worker use `renderer_eval` explicitly, with the brief naming what to call (e.g. locate and
   invoke the chat-submission action/atom the UI itself calls) rather than leaving it to be improvised; or
3. Explicitly flag 3a in the brief as requiring the user's own manual verification pass (per this
   repo's `end-to-end-verification.md`), with the worker's role limited to preparing the scenario
   (clearing `~/.claude/teams/`, confirming dev mode) and recording evidence the user reports back,
   rather than performing the prompt-submission itself.

This does not block wave 1-3 execution — only 3a, the final task, needs this resolved, and it can be
resolved by the orchestrator/user at that point rather than by re-running this review.

---

## Observations

### O1 — Team-resolution steps 2 and 3 overlap in the live implementation

`resolveTeamContext(sessionId)` (`TeammateManager.ts:514-543`) already checks
`this.currentTeamContext` as its own first branch (`const existing =
this.sanitizeTeamNameOrUndefined(this.currentTeamContext); if (existing) return existing;`) before
falling through to the tracked-teammates/metadata/directory cascade. Brief 1a's resolution order lists
step 2 ("`this.currentTeamContext` if already set") and step 3 ("`await
this.resolveTeamContext(sessionId)`") as if they were two independent checks; in the landed code they
collapse into one call, since `resolveTeamContext` re-checks `currentTeamContext` internally. This is
not a correctness bug — calling `resolveTeamContext(sessionId)` alone satisfies both steps 2 and 3 of
the brief's stated order — but a worker implementing the brief literally (write an explicit `if
(this.currentTeamContext) ... else if (await this.resolveTeamContext(...))`) will produce slightly
redundant code, not wrong code. No correction needed; flagged for the implementer's awareness only.

### O2 — `updateTeamConfig`/inbox path citation ("line 977") is an approximation

1a's brief cites `TeammateManager.ts:977` as the "inbox paths" call site for
`~/.claude/teams/<team>/`. Line 977 is inside `queueMessageForIdleTeammate` (the inbox-directory
construction: `path.join(resolveClaudeConfigDir(), 'teams', teamName, 'inboxes')`), a different, related
call site from `updateTeamConfig`'s own definition (line 723) and its call site in
`spawnManagedTeammate` (line 1595). The brief's parenthetical groups "`updateTeamConfig`/inbox paths"
together under one line number, which is imprecise but not misleading — all three sites read/write
under `~/.claude/teams/<team>/` and all three need the resolved team name to be consistent, which is
the actual point being made. No correction needed.

### O3 — Deliverables sections present and adequately falsifiable in all 5 briefs

Every brief carries a `## Deliverables` table with a path and a "done when" condition. All five
"done when" conditions are falsifiable (test file green, specific criteria met) rather than
subjective ("works correctly"). No brief is missing this section.

### O4 — No missed-deliverable gaps found

Checked for the class of gap the review brief calls out specifically (schema change without fixture
regen, IPC message without doc update, config change a sibling reads): this PRD does not change any
schema, IPC message shape, or shared config format — it changes a gate condition, adds test coverage,
and registers an additional key in an in-memory widget registry object. No sibling consumer of the
`name@team` agent-id format, the `currentTeammates` metadata shape, or the widget registry is left
un-updated by the five briefs as scoped.

### O5 — Gate infrastructure the briefs reference is real and consistent

`execution_plan.yaml`'s `gate.after_wave: 2` and `status.json`'s `gate.after_wave: 2` /
`gate.status: "pending"` agree with every brief's reference to "the post-Wave-2 human-review gate."
2b's brief specifically tells the worker to check `status.json`'s `gate.status` field before starting
— that field exists exactly as named. `.nimble/config.yaml`'s `boundaries.require_review` list
matches verbatim what every brief cites (`package.json`, `package-lock.json`,
`packages/electron/src/main/**`, `packages/runtime/src/auth/jwtScopes.ts`,
`packages/electron/build/**`, `CHANGELOG.md`).

---

## Correction Summary

| # | Severity | Brief | Action |
|---|----------|-------|--------|
| W1 | Warning | 3a | Before 3a starts, specify the mechanism for chat-prompt submission (Playwright `submitChatPrompt` harness, an explicit `renderer_eval` call target, or reclassify as user-driven manual verification per `end-to-end-verification.md`). Does not block waves 1-3. |
| O1 | Observation | 1a | No action required — resolution steps 2+3 collapse into one `resolveTeamContext` call in the live code; implementer note only. |
| O2 | Observation | 1a | No action required — "line 977" is an approximate grouping citation, not wrong. |

---

## Top findings for caller

1. No Critical findings — the gate-condition fix (`Task`/`Agent` recognition, `team_name` dropped as a
   hard requirement but honored when present, `name` as sole activation signal), the resolution
   ordering (legacy → `currentTeamContext` → `resolveTeamContext` → synthesis-last), and the
   red-first regression test are all genuinely correct against live source — every cited line number
   checked out.
2. One Warning: brief 3a's live E2E scenario assumes the worker can "prompt Claude" in the running app
   but never names the tool/mechanism for doing so — this is a real gap for an unattended executor and
   should be resolved before 3a runs (it does not block earlier waves).
3. Deliverables sections, gate infrastructure, and boundary/require_review citations are all present,
   accurate, and internally consistent across `tasks.yaml`, `execution_plan.yaml`, `status.json`,
   `.nimble/config.yaml`, and all five briefs.
