# Internal Research Findings — agent-teams-cold-start-bootstrap

Date: 2026-08-27. All claims verified against live source this session (file:line cited). SDK pinned: `@anthropic-ai/claude-agent-sdk@0.3.221`.

## Root Cause (confirmed, corrected from initial hypothesis)

`TeammateManager.handlePreToolUse` gates teammate-spawn interception on:

```ts
toolName === 'Task' && toolInput?.team_name && toolInput?.name   // TeammateManager.ts:2209
```

This fails on **two independent counts** against SDK 0.3.221:

1. **`team_name` is deprecated and never sent.** `AgentInput.team_name` (`node_modules/@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:509-512`): "Deprecated; ignored. The session has a single implicit team." A schema-compliant model never emits it.
2. **The spawn tool is now named `Agent`, not `Task`.** Verified empirically from the live-test session transcript (`~/.claude/projects/-home-jayden-eppcohen-Documents-Projects-Software-nimbalyst/5aa68ce2-5e6b-4483-b3de-5070527a7c3a.jsonl`): the model's spawn call was tool `Agent` with input `{description: "Get latest git commit", name: "git-scout", subagent_type: "general-purpose", model: "haiku", run_in_background: false}` — `name` present, no `team_name`.

So Nimbalyst **received a fully-formed addressable-agent request and dropped it at the gate**, falling through to the plain-subagent path (`type=local_agent` in main.log, observed at main.log:542 and main.log:643 during live tests).

The original hypothesis (missing team-lead env bootstrap: `CLAUDE_CODE_TEAM_NAME`/`CLAUDE_CODE_AGENT_ID` never set because `resolveTeamContext` can only rehydrate) accurately describes the code but describes a **symptom of an obsolete protocol**, not the fix. Under the implicit-team model those env vars are no longer load-bearing for team membership. Proactively setting them would build deeper on deprecated surface.

The codebase partially knows about the rename already: `ClaudeCodeTranscriptAdapter.ts:20` and `ClaudeCodeRawParser.ts:27` both define `SUBAGENT_TOOLS = new Set(['Task', 'Agent'])`. `TeammateManager.ts:2209` and `packages/electron/src/main/services/ClaudeSettingsManager.ts:381` (`case 'Task':`) still hardcode `'Task'` only.

Caveat: `PreToolUseHookInput.tool_name` is a plain `string` in `sdk.d.ts:2248-2253`; "the hook sees `Agent`" is inferred from the assistant-message tool_use name plus the hook wiring path (`ClaudeCodeProvider.ts:505-531` -> `teammatePreToolHandler` -> raw hook `tool_name`), not independently instrumented. Cheap to confirm by logging `toolName` during a live spawn — scoped as an early verification step in the fix task.

## Pipeline Map

1. **Lead env bootstrap** — `sdkOptionsBuilder.ts:489-503`. `enableAgentTeams` (from `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === '1'`, line 376; also `ClaudeCodeProvider.ts:834`) sets only `CLAUDE_CODE_ENABLE_TASKS=1` and calls `teammateManager.resolveTeamContext(sessionId)` (494). If undefined — true for any session without prior team history — none of `CLAUDE_CODE_TEAM_NAME`/`CLAUDE_CODE_TASK_LIST_ID`/`CLAUDE_CODE_AGENT_ID`/`CLAUDE_CODE_AGENT_NAME`/`CLAUDE_CODE_AGENT_TYPE` are set (497-503). Under the implicit-team model this block is likely unnecessary rather than needing a "fix".
2. **`resolveTeamContext`** (`TeammateManager.ts:515-548`) — pure rehydration cascade: in-memory `currentTeamContext` -> tracked teammates -> session metadata (`metadata.currentTeamContext`) -> single-dir `~/.claude/teams/` fallback. No creation path; all branches require prior history.
3. **System prompt is silent on teams.** `enableAgentTeams` is declared on `ClaudeCodePromptOptions` (`prompt.ts:110`) but referenced nowhere else in `prompt.ts` — dead parameter. The model's only source of truth for spawn behavior is the SDK's own tool schema (which deprecates `team_name`). Nimbalyst never taught the model the old protocol; the assumption lived only in interception code.
4. **`handlePreToolUse`** (`TeammateManager.ts:2201-2269`); design-assumption comment at 2271-2276 states teammates are distinguished from plain sub-agents purely by `team_name` presence — a discriminator that no longer exists on the wire.
5. **`spawnManagedTeammate`** (1584-1637) -> `streamTeammateOutput` (1702-1763): builds the teammate subprocess via SDK `query()` with `extraArgs: {agent-id, agent-name, team-name, agent-color, agent-type}` (1736-1742) and the full old-protocol env block (1743-1752). Downstream of the broken gate, so unreachable from cold start; needs re-evaluation (harmless-if-ignored vs. drop) once the gate is fixed.
6. **SendMessage routing** (2278+) keys on `this.currentTeamContext` via `agentIdMatchesRecipient` (2116, 2128, 2151, 2166, 2285, 2366, 2437) — `agent_id` format is `name@team`. With no model-supplied team name, a session-derived team name must be synthesized (the SDK's own deprecation notes call the team name "session-derived"). Every consumer of the `name@team` format and `~/.claude/teams/<team>/` paths (PRD 003 resume path especially) must be audited against the synthesized name.
7. **Hook registration gap.** Nimbalyst registers only `PreToolUse`/`PostToolUse` (lead: `sdkOptionsBuilder.ts:304-306`; teammate subprocess: `TeammateManager.ts:1753-1755`) plus `PermissionDenied` (`sdkOptionsBuilder.ts:313`). Nothing subscribes to `TeammateIdle`, `TaskCreated`, `TaskCompleted`, `SubagentStart`, `SubagentStop`. `TeammateIdleHookInput` carries required `teammate_name` (`sdk.d.ts:6935-6942`); `TaskCreated`/`TaskCompleted` carry optional `teammate_name` (`sdk.d.ts:6911-6933`); `SubagentStart/Stop` carry only `agent_id`/`agent_type` (`sdk.d.ts:6836-6867`). All teammate visibility currently depends on pre-tool-call interception with zero fallback to native lifecycle events.

## PRD 002/003/004 Coupling

- **002 (teammate-thread-view)**, **003 (teammate-resume-reliability)**: both assume spawn already works; they build strictly on top of the managed spawn/resume path. Neither touches the spawn gate. Both are inert from cold start until this gap closes — this PRD is their missing prerequisite.
- **004 (task-subagent-visibility)**: built polished visibility for the plain `Task`/`Agent` dispatch path — i.e., the fallback this bug forces everything into. Overlap risk: 004's premise ("anonymous dispatch is the norm") is partly an artifact of this bug for name-carrying spawns. 004's PRD cites `TeammateManager.ts:2209` (`toolName === 'Task' && toolInput?.team_name`) as the teammate discriminator; that discriminator changes under this PRD, so 004's teammate-exclusion logic in `RichTranscriptView.tsx` (gate on `isSubAgent && isTeammate`) must be re-verified after the fix.

## Test Coverage to Scope

- `packages/runtime/src/ai/server/providers/__tests__/TeammateManager.resumeReliability.test.ts:145,255,286` and `TeammateManager.stallWatchdog.test.ts:124` call `handlePreToolUse`/`spawnManagedTeammate` with explicit `{team_name:'team', name:'alice'}` — old protocol hardcoded; need name-only + `Agent`-tool-name variants.
- No existing test exercises `handlePreToolUse` with a name-only, no-`team_name` `Agent` input — the cold-start failure mode is untested. Per repo policy (end-to-end-verification rule) a red-to-green regression test is the first deliverable.
- `TeammateManager.sendMessageFromHost.test.ts` and `TeammateManager.test.ts` not yet audited for `team_name` coupling — audit is in-scope for the fix task.
