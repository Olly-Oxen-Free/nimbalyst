# PRD Template (v2)

```yaml
---
feature_name: "Agent Teams Cold-Start Bootstrap"
feature_slug: "agent-teams-cold-start-bootstrap"
owner: "jeppcohen@gmail.com"
status: "ready"
created_date: "2026-08-27"
target_date: ""
phase: ""
scope_type: "bug fix / protocol adaptation"
github_project: ""
links: [".nimble/prds/002_teammate-thread-view", ".nimble/prds/003_teammate-resume-reliability", ".nimble/prds/004_task-subagent-visibility"]
checkpoint_refs: ["002_teammate-thread-view", "003_teammate-resume-reliability", "004_task-subagent-visibility"]
cross_feature_blockers: []
---
```

---

## 1. Executive Summary

**One-liner:** Named teammate spawning never activates from a cold start because Nimbalyst's spawn
interception still speaks the SDK's retired explicit-team protocol; this PRD adapts the gate to the
implicit-team protocol of the pinned SDK (0.3.221) so the shipped teammate stack (PRDs 002/003)
becomes reachable.

**What's changing:** `TeammateManager.handlePreToolUse` intercepts teammate spawns only on
`toolName === 'Task' && toolInput?.team_name && toolInput?.name` (`TeammateManager.ts:2209`). The
pinned SDK renamed the model-facing spawn tool to `Agent` and deprecated `team_name` ("Deprecated;
ignored. The session has a single implicit team." — `sdk-tools.d.ts:509-512`), so a schema-compliant
model can never satisfy the gate. Empirically confirmed (live session transcript): "spawn an agent
named git scout" produced tool `Agent` with `name: "git-scout"` and no `team_name` — a fully-formed
addressable-agent request that Nimbalyst dropped to the plain `local_agent` path. The fix: gate on
`(toolName === 'Task' || toolName === 'Agent') && toolInput?.name` (with agent-teams enablement),
synthesize a session-derived team name for the `name@team` agent-id format the shipped managed
pipeline is built around, and keep everything downstream (chip UI, thread view, SendMessage routing,
resume) intact.

**Who it's for:** Anyone running Agent Mode who asks Claude to delegate to a named agent — the
entire PRD 002/003 feature set (click a teammate chip, read its live thread, message it directly,
stop it) is currently unreachable for every session without prior team history, i.e. all of them.

**Done looks like:** In a fresh session with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, saying
"spawn an agent named git scout to do X" produces a real managed teammate: chip appears, hover/click
opens its live thread, SendMessage round-trips, stop works — first turn, no prior team history.

**Primary risk:** The synthesized team name flows into every consumer of the `name@team` agent-id
format and the `~/.claude/teams/<team>/` config/inbox paths (SendMessage routing, idle tracking,
PRD 003's resume). A wrong or unstable synthesis silently breaks resume or message routing. Mitigated
by keeping the existing `currentTeamContext` persistence path (teammate rows in session metadata
already carry `teamName`; `resolveTeamContext` already rehydrates from them) and by an explicit
resume-with-synthesized-team test in task 1b.

---

## 2. Problem & Context

**Problem statement:** `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set and read correctly
(`sdkOptionsBuilder.ts:376`, `ClaudeCodeProvider.ts:834`), but no session ever enters teammate
territory from a cold start. All delegation — even with an explicit name in the user's prompt —
lands as anonymous one-shot `type=local_agent` dispatch (observed in main.log across three live
tests). The teammate systems built and shipped in PRDs 002 (thread view) and 003 (resume
reliability) are dead code from the user's perspective.

**Root cause (confirmed, corrected from the initial hypothesis):** two independent failures in one
gate, `TeammateManager.ts:2209`:

1. **Tool rename.** The pinned SDK's model-facing spawn tool is `Agent`, not `Task`. The transcript
   pipeline already knows (`SUBAGENT_TOOLS = new Set(['Task', 'Agent'])` in
   `ClaudeCodeTranscriptAdapter.ts:20` and `ClaudeCodeRawParser.ts:27`); the interception gate does
   not.
2. **Protocol retirement.** `AgentInput.team_name` is deprecated and ignored — the session has a
   single implicit team; `AgentInput.name` alone makes a spawned agent addressable via
   `SendMessage({to: name})` (`sdk-tools.d.ts:505-512`). No `TeamCreate` tool exists in 0.3.221's
   tool surface; `extractTeamNameFromToolResult` (~`TeammateManager.ts:550`) targets a tool that no
   longer exists. The design-assumption comment at `TeammateManager.ts:2271-2276` — teammates are
   distinguished from plain sub-agents purely by `team_name` presence — describes a discriminator
   that no longer exists on the wire.

The initially hypothesized gap ("no path bootstraps team-lead env vars from cold start") accurately
describes `resolveTeamContext`'s rehydrate-only design (`TeammateManager.ts:515-543`) and the unset
`CLAUDE_CODE_TEAM_NAME`/`CLAUDE_CODE_AGENT_ID` block (`sdkOptionsBuilder.ts:497-503`), but that is a
symptom of the same obsolete protocol, not the fix: under the implicit-team model those env vars are
not load-bearing, and proactively setting them would deepen dependence on deprecated surface
(interview decision D2, §6).

**Supporting evidence:** full trail in `research/internal/findings.md` and
`research/external/findings.md`, all file:line-cited and verified against live source this session.
Empirical anchor: the live-test session transcript shows the model's exact spawn input
(`{description: "Get latest git commit", name: "git-scout", subagent_type: "general-purpose",
model: "haiku", run_in_background: false}`, tool `Agent`). The reference implementation (Claude Code
TUI, same machine, same SDK schema) spawns named addressable agents first-turn with no team history
and no TeamCreate call — confirming no host-side bootstrap step exists to copy; the TUI simply
honors name-carrying `Agent` calls.

**What happens if we don't build this:** PRDs 002 and 003 stay unreachable; every delegation
degrades to the PRD 004 fallback surface; the user-visible goal (navigate into a spawned agent and
chat with it directly) never activates.

**Strategic fit:** This is the missing prerequisite under PRDs 002/003 — both assumed team context
already existed and built strictly downstream of the (unreachable) spawn gate. Neither scoped the
gate itself; this PRD is deliberately gate-and-plumbing only, reusing everything they shipped.

**Explicitly out of scope:**
- Rewiring to SDK-native teammate spawning / lifecycle hooks (`TeammateIdle`, `TaskCreated`,
  `TaskCompleted`, `SubagentStart/Stop` — none currently registered). Considered and rejected for
  this PRD (decision D2, §6).
- System-prompt guidance pushing the model toward named spawns. The tool schema alone suffices — the
  model passes `name` when the user asks for a named agent (empirically confirmed), same as the TUI
  (decision D8, §6).
- Removing the deprecated explicit-team surface (`CLAUDE_CODE_TEAM_NAME` env block,
  `extractTeamNameFromToolResult`, TeamCreate/TeamDelete handling, `~/.claude/teams/` directory
  fallback in `resolveTeamContext`). Kept and marked legacy per surgical-change rules (decision D5,
  §6); no retro sweep.
- Fixing the upstream SDK asymmetric-SendMessage bug (anthropics/claude-code#48160) — outside
  Nimbalyst's control; likely moot under the managed pipeline (Nimbalyst provides its own routing),
  documented as a known caveat only.
- Any change to PRD 004's Task-subagent visibility surfaces beyond regression verification. Unnamed
  dispatch remains the (correct) plain-subagent path; 004 stays fully valid for it.

---

## 3. Goals, Non-Goals & Success Metrics

### Goals

1. A name-carrying spawn call (`Agent` or `Task` tool, `name` present, no `team_name`) in an
   agent-teams-enabled session is intercepted and spawns a managed teammate — first turn, no prior
   team history.
2. A session-derived team name is synthesized when the model supplies none, producing a stable
   `name@team` agent id that works across the existing SendMessage routing, idle tracking, team
   config/inbox paths, and PRD 003's resume flow.
3. Legacy explicit-team inputs (`team_name` present) keep working — old sessions and old-protocol
   tests are not broken.
4. Name-less spawn calls continue to the plain-subagent path untouched — PRD 004's surfaces are the
   correct destination for them and must not regress.
5. The fix is proven by a red-to-green regression test written before the fix (repo
   end-to-end-verification rule) plus a live cold-start E2E pass.

### Non-Goals

- SDK-native lifecycle-hook consumption as a parallel/fallback teammate detection layer.
- Removing deprecated explicit-team code paths.
- Prompting/steering the model toward using teams.
- Any change to teammate UI components (chip, thread popover, panel) — they are downstream
  consumers and must work unmodified.
- Upgrading the pinned SDK version (the fix targets 0.3.221 as pinned; `/update-libs` is separate).

### Success Metrics

| Metric | Baseline | Target | How Measured |
| ------ | -------- | ------ | ------------ |
| Named spawn -> managed teammate from cold start | 0% (all fall through to `local_agent`) | 100% | Regression test: `handlePreToolUse('Agent', {name, ...})` with no `team_name` returns `handled: true` and registers a managed teammate; live E2E in task 3a |
| Old-protocol spawn (`team_name` present) | works (in tests only) | still works | Existing `TeammateManager.resumeReliability` / `stallWatchdog` tests stay green |
| Name-less spawn -> plain subagent | works | unchanged | Regression test: no `name` => `handled: false`; PRD 004 test suites unchanged and green |
| Resume with synthesized team name | N/A | works | Unit test: teammate rows persisted with synthesized `teamName` rehydrate via `resolveTeamContext` after manager restart |
| Teammate rendering discriminator | works for old protocol | works for name-only spawns | Test: synthetic `teammate_task` pair emitted for a name-only spawn renders the teammate card, not PRD 004's TaskToolWidget |

---

## 4. Requirements

### Must Have (blocks launch)

| ID | Requirement | Acceptance Criteria |
| -- | ----------- | -------------------- |
| R1 | Gate matches the implicit-team protocol | `handlePreToolUse` intercepts on `(toolName === 'Task' \|\| toolName === 'Agent') && toolInput?.name`, only when agent teams are enabled for the session; `team_name` is honored when present (legacy) but never required |
| R2 | Team-name resolution with last-resort synthesis | Resolution order: legacy `team_name` if present -> existing `currentTeamContext` -> `resolveTeamContext(sessionId)` (a resumed session's real team is reused, never overwritten) -> synthesize a stable, pre-normalized session-derived name. Same value for every spawn in a session; survives in `currentTeamContext` and persisted teammate rows; `spawnManagedTeammate` no longer throws on name-only input (`sanitizeName(undefined)` throws today, `TeammateManager.ts:1585`) |
| R3 | Downstream pipeline integrity | SendMessage routing (`agentIdMatchesRecipient` sites), idle tracking, `updateTeamConfig`/inbox paths (`~/.claude/teams/<synthesized>/...`), and duplicate-spawn denial all work with the synthesized team name |
| R4 | Resume reliability preserved | PRD 003's resume flow works for teammates spawned under a synthesized team name: `resolveTeamContext` rehydrates it from persisted `currentTeammates[].teamName` metadata after a manager restart |
| R5 | Electron tool-name-keyed surfaces recognize `Agent` | `AgentMode.tsx:281` registers PRD 004's TaskToolWidget under the `'Task'` key only — the live SDK tool is `Agent`, so 004's inline-expand widget is ALREADY unreachable for real dispatches (found during PRD review, §6 D10) — register it for both names with a live-`Agent`-shape test; audit `packages/electron/src` (main + renderer) for other `'Task'`-only tool-name hardcodes and align or document each (`ClaudeSettingsManager.ts:381` is confirmed a behavioral no-op — its `default:` returns `toolName` anyway — audit-note it, do not add an identity test) |
| R6 | No regression on unnamed dispatch or PRD 004 surfaces | Name-less `Agent`/`Task` calls pass through untouched; teammate-vs-task rendering discriminators (synthetic `teammate_task` pair -> teammate card; plain task -> TaskToolWidget) verified for the name-only spawn shape |

### Should Have

| ID | Requirement | Acceptance Criteria |
| -- | ----------- | -------------------- |
| R7 | Empirical hook-name verification | Before relying on the gate change, log the observed `toolName` at `handlePreToolUse` during a live named spawn once (the SDK types `tool_name` as bare `string`; "hook sees `Agent`" is inferred, not doc-confirmed — cheap to confirm, task 1a step 0) |
| R8 | Legacy surface marked | The deprecated env block (`sdkOptionsBuilder.ts:497-503`), teammate-subprocess old-protocol env (`TeammateManager.ts:1743-1752`), and TeamCreate/TeamDelete result handling get a short `// legacy (explicit-team protocol, SDK <0.3.x)` comment — kept functional, not removed |

---

## 5. Task Breakdown

Five tasks, four waves. 1a is the core fix (runtime only, fast-track). 1b and 2a are file-disjoint
and run in parallel in wave 2; 2a touches `packages/electron/src/main/**`, so the config's
`require_review` boundary applies — gate after wave 2, before the verification fan-out. 2b verifies
rendering/regression downstream of the new spawn shape; 3a is the live cold-start E2E that closes
the PRD (the exact scenario that exposed the bug).

```yaml
# ============================================================
# NIMBLE TASK DEFINITIONS
# Parsed by the orchestrator for execution planning.
# ============================================================

metadata:
  prd_slug: "agent-teams-cold-start-bootstrap"
  created_at: "2026-08-27T00:00:00Z"
  total_complexity: 20
  task_count: 5

tasks:
  - id: "1a"
    title: "Adapt the teammate spawn gate to the implicit-team protocol"
    description: |
      RED FIRST (repo end-to-end-verification rule): before any fix, add a
      regression test calling handlePreToolUse('Agent', {name: 'git-scout',
      description: '...', prompt: '...', subagent_type: 'general-purpose'},
      toolUseId, sessionId) -- the exact empirical live-test shape -- and
      assert it spawns a managed teammate. Run it; confirm it fails
      (today it returns { handled: false }). Only then fix.

      STEP 0 (R7): add a one-line debug log of the observed toolName at the
      top of the spawn-interception branch. The SDK types
      PreToolUseHookInput.tool_name as bare string (sdk.d.ts:2248-2253);
      "the hook sees 'Agent'" is inferred from the assistant-message
      tool_use name plus the hook wiring (ClaudeCodeProvider.ts:505-531),
      not doc-confirmed. The log stays in (it is cheap and diagnostic);
      match on BOTH 'Task' and 'Agent' regardless so the fix is correct
      under either observation.

      GATE CHANGE (TeammateManager.ts:2209): intercept on
      (toolName === 'Task' || toolName === 'Agent') && toolInput?.name,
      additionally conditioned on agent teams being enabled for the
      session. TeammateManager does not currently know enableAgentTeams --
      the old gate free-rode on team_name only appearing when teams were
      active. Plumb the flag in (a settable property or a deps accessor,
      matching how packagedBuildOptions is already injected) rather than
      re-reading process.env inside the manager. team_name, when present,
      is still honored exactly as today (legacy input, old sessions).

      TEAM NAME RESOLUTION ORDER (R2 -- ordering corrected during PRD
      review, see section 6 D10/C2): when toolInput.team_name is absent,
      resolve the team in this order, and ONLY synthesize as the last
      resort:
        1. toolInput.team_name (legacy, honored as today);
        2. this.currentTeamContext if already set;
        3. await this.resolveTeamContext(sessionId) (a resumed
           old-protocol session has a real team here -- overwriting it
           with a synthesized name would break agentIdMatchesRecipient's
           exact-team match at TeammateManager.ts:390-395 and make
           existing teammates like alice@team unreachable);
        4. synthesize a stable session-scoped name: 'team-' + first 8
           chars of the lead sessionId, PRE-NORMALIZED to
           ^[a-zA-Z0-9_-]+$ BEFORE it reaches sanitizeName (sanitizeName
           throws on non-conforming input rather than normalizing,
           :326-348); fallback 'team' when sessionId is undefined --
           mirror the existing fallback at TeammateManager.ts:1286.
      Set this.currentTeamContext to the resolved value so SendMessage
      routing (agentIdMatchesRecipient sites: 2116, 2128, 2151, 2166,
      2285, 2366, 2437), duplicate-spawn denial (managedTeammates/
      idleTeammates keyed by name@team), and updateTeamConfig/inbox paths
      (~/.claude/teams/<team>/, line 977) all see one consistent value.
      spawnManagedTeammate currently throws on a missing team_name
      (sanitizeName(undefined) throws, line 1585) -- pass the resolved
      name through (widen spawnManagedTeammate's input or resolve before
      the call; keep the change surgical).

      SYNTHETIC PAIR (logSyntheticToolPair, ~2239-2254): keep passing
      'Task' as the synthetic tool_use name (switching it to the observed
      'Agent' would shift the widget-registry key -- see 2a); include the
      resolved team_name in the result payload for log fidelity. Note the
      renderer's isTeammate discriminator derives from the tool_use ARGS
      (ClaudeCodeRawParser.ts:510-511, args.name || args.team_name), not
      the result payload -- a name-only spawn is isTeammate: true from
      args.name alone, so no renderer change is needed for the
      discriminator (verified during PRD review).

      NAME-LESS PASSTHROUGH (R6): no name => { handled: false }, exactly as
      today. run_in_background on a name-carrying call does NOT change the
      decision: a named agent is a teammate (interview decision D3, PRD
      section 6) -- the managed pipeline already runs teammates without
      blocking the lead.

      TEST UPDATES: existing tests hardcode the old protocol
      (resumeReliability.test.ts:255 and stallWatchdog.test.ts:124 pass
      {team_name:'team', name:'alice'} spawn inputs; resumeReliability
      :145/:286 are SendMessage tests coupled to the same team) -- they
      must stay green (legacy input still honored). Add name-only +
      'Agent'-toolName variants alongside, including one asserting a
      resumed session's EXISTING team context is reused rather than
      overwritten by synthesis. Audit TeammateManager.test.ts and
      sendMessageFromHost.test.ts for team_name coupling while there.

      Fulfills R1, R2, R3 (partially -- resume half is 1b), R6 (gate
      half), R7.
    depends_on: []
    complexity: 7
    priority: "must"
    success_criteria:
      - "Regression test written FIRST and observed failing before the fix (state red-run evidence in the commit message)"
      - "handlePreToolUse('Agent', {name, no team_name}) spawns a managed teammate with agentId name@<synthesized-team> when agent teams are enabled"
      - "handlePreToolUse('Task', {name, team_name}) behaves exactly as today (legacy input honored); existing resumeReliability/stallWatchdog tests untouched and green"
      - "handlePreToolUse('Agent', {no name}) returns { handled: false }; agent-teams-disabled sessions never intercept"
      - "Team resolution order honored: legacy team_name > existing currentTeamContext > resolveTeamContext(sessionId) > synthesis -- a resumed session with a real team context spawns into THAT team, never a synthesized one (explicit test)"
      - "Synthesized team name is stable within a session, pre-normalized so sanitizeName cannot throw, and set as currentTeamContext; duplicate-spawn denial and SendMessage routing tests pass against it"
      - "spawnManagedTeammate no longer throws on name-only input"
    files_affected:
      - "packages/runtime/src/ai/server/providers/TeammateManager.ts"
      - "packages/runtime/src/ai/server/providers/__tests__/ (existing TeammateManager test files, extended)"
    deliverables:
      - artifact: "Implicit-team spawn gate + session-derived team synthesis"
        path: "packages/runtime/src/ai/server/providers/TeammateManager.ts"
        done_when: "Red-first regression test flips green; all success_criteria covered by unit tests in existing TeammateManager test files"

  - id: "1b"
    title: "Resume/rehydration with synthesized teams; mark legacy explicit-team surface"
    description: |
      RESUME (R4): PRD 003's resume flow must work for teammates spawned
      under a synthesized team name. resolveTeamContext
      (TeammateManager.ts:515-543) already rehydrates from persisted
      currentTeammates[].teamName rows (written by emitTeammateUpdate,
      1373-1479) -- verify the synthesized name round-trips: spawn (1a's
      new path) -> metadata persisted -> fresh manager instance ->
      resolveTeamContext returns the synthesized team ->
      rebuildIdleTeammateFromMetadata / resume path works. Unit test with
      a mocked AISessionsRepository, mirroring the existing
      resumeReliability test setup. Note emitTeammateUpdate never writes
      metadata.currentTeamContext (only currentTeammates rows) -- the
      teammates-array branch of the rehydration cascade is the one that
      must carry this; do not add a new metadata field unless the test
      proves the existing cascade insufficient.

      LEAD ENV BLOCK (R8, decision D5): sdkOptionsBuilder.ts:489-503 --
      keep CLAUDE_CODE_ENABLE_TASKS=1 (undocumented whether still
      load-bearing in 0.3.x; at worst a no-op -- do not remove without
      evidence). Keep the resolveTeamContext call and the conditional env
      block (it only fires when a team context exists, i.e. resumed
      old-protocol or post-spawn sessions; the SDK ignores the deprecated
      vars). Add the short legacy comment to the env block, to the
      teammate-subprocess env/extraArgs block (TeammateManager.ts:
      1736-1752), and to the TeamCreate/TeamDelete tool-result handling
      (extractTeamNameFromToolResult and its call sites, ~550-660) --
      marked, not removed, per surgical-change rules. No behavior change
      in this half of the task; test coverage is the resume test above.

      Do NOT remove the enableAgentTeams declaration on
      ClaudeCodePromptOptions (prompt.ts:110). It is unread inside
      prompt.ts but ASSIGNED at ClaudeCodeProvider.ts:4194,
      OpenAICodexProvider.ts:1902, OpenAICodexACPProvider.ts:518, and
      CopilotCLIProvider.ts:437 -- removal breaks typecheck in four files
      (found during PRD review, section 6 D10/W2).

      Fulfills R4, R8, and the resume half of R3.
    depends_on: ["1a"]
    complexity: 4
    priority: "must"
    success_criteria:
      - "Unit test: teammate spawned via the name-only path persists rows whose teamName is the synthesized team; a fresh manager's resolveTeamContext returns it; the resume path accepts it"
      - "CLAUDE_CODE_ENABLE_TASKS still set when agent teams enabled; no env var removed"
      - "Legacy comments present on the three explicit-team surfaces; no functional change to them"
      - "npm run typecheck green; no existing sdkOptionsBuilder/TeammateManager test regresses"
    files_affected:
      - "packages/runtime/src/ai/server/providers/TeammateManager.ts"
      - "packages/runtime/src/ai/server/providers/claudeCode/sdkOptionsBuilder.ts"
      - "packages/runtime/src/ai/server/providers/__tests__/ (resume test extension)"
    deliverables:
      - artifact: "Synthesized-team resume round-trip test + legacy markers"
        path: "packages/runtime/src/ai/server/providers/__tests__/"
        done_when: "Resume round-trip test green in the existing resumeReliability (or sibling) test file"

  - id: "2a"
    title: "Recognize 'Agent' alongside 'Task' in electron tool-name-keyed surfaces"
    description: |
      PRIMARY FIX (found during PRD review, section 6 D10/C1):
      AgentMode.tsx:281 registers PRD 004's inline-expand widget under the
      'Task' key only:
        setTranscriptToolWidgets(TASK_TOOL_WIDGET_SOURCE,
                                 { Task: TaskToolWidget });
      The live SDK spawn tool is 'Agent', so 004's TaskToolWidget is
      ALREADY unreachable for real name-less dispatches today -- they fall
      through to the generic sub-agent card. Register the widget for both
      names ({ Task: TaskToolWidget, Agent: TaskToolWidget }), and add a
      LIVE-SHAPE test: a tool_use named 'Agent' with no name arg renders
      TaskToolWidget (extend 004's existing widget test file; do not add a
      new file). This is a real user-facing regression fix that 004's
      'Task'-keyed fixtures could not catch.

      AUDIT: sweep packages/electron/src (main AND renderer) for other
      'Task'-only tool-name hardcodes; align or document each in the
      commit message. Known finding, already reviewed:
      ClaudeSettingsManager.ts:381's bare `case 'Task':` is a behavioral
      NO-OP -- its default: branch returns toolName for unknown names
      anyway (:343-393). Adding `case 'Agent':` there is optional clarity;
      do NOT write a test for it (it would assert an identity, contrary to
      repo testing rules -- section 6 D10/W1).

      Renderer file => fast-track; if the audit ends up touching any file
      under packages/electron/src/main/**, the require_review boundary
      applies (gate after wave 2 covers it).

      Small task by design -- every changed line must be a
      'Task'-vs-'Agent' recognition fix.

      Fulfills R5.
    depends_on: ["1a"]
    complexity: 3
    priority: "must"
    success_criteria:
      - "TaskToolWidget registered for both 'Task' and 'Agent' keys; live-shape test (tool named 'Agent', no name arg) renders it"
      - "A name-carrying 'Agent' tool_use still renders the teammate card, not TaskToolWidget (isTeammate gate from args.name -- regression guard)"
      - "Audit result across packages/electron/src (sites found/aligned/no-op-documented) stated in the commit message"
      - "No identity-asserting test added for the ClaudeSettingsManager no-op"
    files_affected:
      - "packages/electron/src/renderer/components/AgentMode/AgentMode.tsx"
      - "packages/electron/src/main/services/ClaudeSettingsManager.ts (optional clarity case, audit)"
    deliverables:
      - artifact: "'Agent' recognized in widget registration + audit"
        path: "packages/electron/src/renderer/components/AgentMode/AgentMode.tsx"
        done_when: "Live-shape widget test green; audit documented"

  - id: "2b"
    title: "Rendering and downstream regression verification for name-only spawns"
    description: |
      A name-only spawn now produces the synthetic teammate_task tool pair
      (from 1a, tool name kept as 'Task'). Verify the rendering
      discriminators built in PRDs 002/004 hold for the LIVE shapes:

      1. The teammate-spawn message renders the existing teammate card in
         RichTranscriptView.tsx -- NOT PRD 004's TaskToolWidget. The
         isTeammate signal derives from the tool_use ARGS
         (ClaudeCodeRawParser.ts:510-511, args.name || args.team_name) --
         a name-only spawn is isTeammate: true from args.name alone
         (verified during PRD review; the synthetic result payload is not
         the discriminator). Extend the existing RichTranscriptView /
         TaskToolWidget test coverage with the name-only spawn fixture --
         prefer extending 004's regression test file over creating a new
         one.
      2. A name-LESS dispatch renders through 004's TaskToolWidget path
         under BOTH tool names -- 2a adds the 'Agent'-shape test; here
         confirm the 'Task'-keyed fixtures also still pass (green-suite
         confirmation only for the 'Task' half).
      3. Teammate chip + NotificationService agent-notification behavior
         for the new spawn shape: runtime-side verification only. Do NOT
         touch packages/electron/src/main/** test files in this task --
         that crosses the require_review boundary post-gate (section 6
         D10/W3). If the spawn shape reaches NotificationService
         differently and its test needs extending, flag it in findings.md
         for the final merge gate instead of editing it here.

      Pure verification/extension task -- if a discriminator breaks, the
      fix belongs in 1a's payload/args shape (coordinate back), not in
      new renderer branching.

      Fulfills R6 (rendering half).
    depends_on: ["1a", "2a"]
    complexity: 3
    priority: "must"
    success_criteria:
      - "Name-only spawn fixture renders the teammate card, not TaskToolWidget (isTeammate true from args.name)"
      - "Name-less dispatch rendering verified under both tool names (2a's 'Agent' test + existing 'Task' fixtures green)"
      - "Existing teammate test suites green; all extensions land in existing runtime-side files; no packages/electron/src/main/** file touched"
    files_affected:
      - "packages/runtime/src/ui/AgentTranscript/components/__tests__/ (existing files, extended)"
    deliverables:
      - artifact: "Name-only spawn rendering regression coverage"
        path: "packages/runtime/src/ui/AgentTranscript/components/__tests__/"
        done_when: "New fixture green in existing test files; no renderer source change (or, if one was needed, it landed in 1a and is noted)"

  - id: "3a"
    title: "Live cold-start end-to-end verification"
    description: |
      Reproduce the exact scenario that exposed the bug, in the running
      dev app (agent teams enabled, fresh session, NO prior team history
      -- verify ~/.claude/teams/ state beforehand; a leftover single team
      dir would mask the cold-start path via resolveTeamContext's
      directory fallback):

      1. "spawn an agent named git-scout to get the most recent git
         commit" -> main.log shows the teammate spawn path (TEAM-CONTEXT /
         MANAGED-TEAMMATE log lines), NOT 'SUBAGENT_TASK started:
         type=local_agent'.
      2. Teammate chip appears; thread view opens with live transcript
         (PRD 002 surface).
      3. SendMessage round-trip: message the teammate from the lead,
         observe delivery; observe the teammate's reply reaching the lead
         (if the upstream asymmetric-SendMessage limitation,
         anthropics/claude-code#48160, manifests under the managed
         pipeline, document the observed behavior in the PRD's Open
         Questions rather than failing the gate -- Nimbalyst-side routing
         is what this PRD owns).
      4. Stop control works; restart the app; teammate resumes/rehydrates
         (PRD 003 surface) under the synthesized team name.
      5. Control: an un-named delegation request still produces the plain
         local_agent path and PRD 004's chip/popover surfaces.

      Record evidence (log excerpts, redacted per repo rules) in
      status.json verification.manual_e2e. Path note: the deliverable
      path assumes the folder is renamed to 005_ at PRD approval (next
      free number after 004_); if numbering differs at save time, the
      actual folder wins. The agent runs its own
      observation commands (get_main_process_logs etc.) -- never asks the
      user to paste logs. Restart requires explicit user permission per
      repo rules.

      Fulfills the end-to-end half of R1-R4; closes the PRD gate.
    depends_on: ["1b", "2a", "2b"]
    complexity: 3
    priority: "must"
    success_criteria:
      - "Cold-start named spawn produces a managed teammate (log-evidenced), not local_agent"
      - "Chip, thread view, SendMessage, stop all function on the spawned teammate"
      - "Post-restart rehydration works under the synthesized team name"
      - "Un-named delegation control case unchanged (local_agent + 004 surfaces)"
      - "Evidence recorded in status.json verification.manual_e2e"
    files_affected:
      - ".nimble/prds/005_agent-teams-cold-start-bootstrap/status.json (evidence only)"
    deliverables:
      - artifact: "Cold-start E2E evidence"
        path: ".nimble/prds/005_agent-teams-cold-start-bootstrap/status.json"
        done_when: "All five scenario steps evidenced; any upstream-limitation observation filed in section 6"
```

---

## 6. Open Questions & Interview Decisions

Interview conducted non-interactively (user absent); each round's decisions recorded here with
reasoning, per the planning instruction to resolve rather than defer where the context allows.

- **D1 (Framing — root cause):** The commissioning hypothesis ("no cold-start bootstrap of
  team-lead env vars") is *corrected*, not confirmed: the env-var gap is real but is a symptom of
  the retired explicit-team protocol. The fix targets the spawn gate, not env bootstrap. Evidence:
  §2, `research/summary.md`.
- **D2 (Approach):** Adapt the existing interception/managed pipeline (chosen) vs. drop
  interception and consume SDK-native teammate spawning + lifecycle hooks (rejected). The managed
  pipeline is what PRDs 002/003 shipped and tested — chip UI, thread transcripts, SendMessage
  routing, stop, resume all hang off `spawnManagedTeammate`'s lifecycle. SDK-native spawning would
  orphan all of it and depends on undocumented behavior (whether native teammate events even fire
  when the host is an SDK embedder). Hook consumption as a *resilience layer* is deliberately
  deferred, not designed here — it would be new scope with unclear payoff while interception works.
- **D3 (Background flag):** A name-carrying call is a teammate regardless of `run_in_background` —
  the managed pipeline never blocks the lead anyway, and `name` is the SDK's own definition of
  addressability. (`AgentInput.name`: "Makes it addressable via SendMessage({to: name}) while
  running.")
- **D4 (Team-name synthesis):** Session-derived (`team-<sessionId prefix>`, sanitized, fallback
  `'team'`), mirroring the SDK's own language ("this carries the session-derived team name") and
  the existing fallback at `TeammateManager.ts:1286`. Stable within a session so all `name@team`
  consumers agree; persisted implicitly via `currentTeammates[].teamName` rows, which
  `resolveTeamContext` already rehydrates from (tested in 1b).
- **D5 (Deprecated surface):** Keep and mark legacy; do not remove. Removal is a retro sweep the
  surgical-change rule forbids, the SDK ignores the extra env vars, and old-protocol sessions/tests
  still exercise the paths. Revisit removal when the SDK pin moves past the deprecation window.
- **D6 (Teams-enablement plumbing):** The new gate must consult `enableAgentTeams` explicitly (the
  old gate free-rode on `team_name`'s presence implying teams were active). Injected into
  TeammateManager rather than read from `process.env` inside it — matches existing dependency
  injection style (`packagedBuildOptions`).
- **D7 (Hook tool-name caveat):** "The PreToolUse hook sees `Agent`" is inferred (typedef types
  `tool_name` as bare `string`); task 1a logs the observed value and matches both names, so the fix
  is correct under either observation. Not left open — designed around.
- **D8 (Model discoverability):** No system-prompt steering toward named spawns. The TUI proves the
  schema alone suffices; live test 2 proves the model passes `name` when the user asks. If usage
  data later shows the model under-using names for delegation the user wanted addressable, that is
  a separate, evidence-driven prompt-design decision.
- **D9 (PRD 004 interplay):** 004 remains fully valid — it owns the (correct) unnamed-dispatch
  surface. Named spawns re-routing to teammates changes which surface renders them; 2b regression-
  verifies both discriminator directions. 004 is not paused or rescoped.
- **D10 (resolved during PRD review, kept for record):** The reviewer pass corrected four draft
  defects, all folded into the task text above. **C1:** the draft assumed PRD 004's TaskToolWidget
  path worked for live dispatches; in fact `AgentMode.tsx:281` registers the widget under the
  `'Task'` key only while the live tool is `Agent` — 004's inline-expand is already unreachable in
  production, an independent live regression this PRD now fixes in task 2a (with a live-`Agent`-
  shape test replacing the draft's "confirm 004's suites green", which would have certified stale
  fixtures). **C2:** the draft's "set `currentTeamContext` on first spawn" would have overwritten a
  resumed legacy session's real team and broken `agentIdMatchesRecipient`'s exact-team match
  (`TeammateManager.ts:390-395`), making existing teammates unreachable — exactly the PRD's own
  stated primary risk; corrected to the resolution order legacy `team_name` → existing context →
  `resolveTeamContext(sessionId)` → synthesize last. **W1:** `ClaudeSettingsManager.ts:381` is a
  behavioral no-op (its `default:` returns `toolName` anyway); demoted to audit-note, mandated
  identity test dropped. **W2:** the draft offered removing `prompt.ts:110`'s `enableAgentTeams` as
  "dead"; it is assigned in four provider files and removal breaks typecheck — removal struck.
  Also: 2b barred from touching `packages/electron/src/main/**` test files post-gate (W3), minor
  line-ref drifts fixed, synthetic pair keeps `'Task'` as its tool name, and the `isTeammate`
  discriminator was pinned to tool_use args (`ClaudeCodeRawParser.ts:510-511`), not the synthetic
  result payload.
- **Q1 (open, minor):** Is `CLAUDE_CODE_ENABLE_TASKS` still load-bearing in SDK 0.3.x? No source
  documents it either way. Decision: keep setting it (at worst a no-op); task 3a's live run is the
  natural observation point. Not blocking.
- **Q2 (open, upstream):** anthropics/claude-code#48160 — teammates spawned via `name=` may lack
  the ability to *originate* SendMessage back to the lead in the native SDK flow. Under Nimbalyst's
  managed pipeline (own routing) this likely does not apply; task 3a observes and records the
  actual behavior. Nimbalyst cannot fix the upstream half; documented as a known limitation if
  observed.
- **Q3 (open, follow-on):** Whether to eventually consume SDK-native lifecycle hooks
  (`TeammateIdle` etc.) as a resilience layer against future protocol drift — this bug existed
  precisely because interception is a single point of coupling to the SDK's tool surface. Filed as
  future scope, not this PRD.

## Research Findings

See `research/summary.md` (executive), `research/internal/findings.md` (pipeline map, file:line
evidence, test-coverage audit), `research/external/findings.md` + `research/external/sources.yaml`
(SDK typedef facts, community/issue-tracker corroboration, fact-vs-inference marking).
