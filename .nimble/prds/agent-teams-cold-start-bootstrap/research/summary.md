# Research Summary — agent-teams-cold-start-bootstrap

Date: 2026-08-27. Detail: `internal/findings.md`, `external/findings.md`, `external/sources.yaml`.

## Root Cause (one paragraph)

Nimbalyst's teammate-spawn interception (`TeammateManager.handlePreToolUse`, `TeammateManager.ts:2209`) fires only on `toolName === 'Task' && toolInput?.team_name && toolInput?.name`. Against the pinned SDK (`@anthropic-ai/claude-agent-sdk@0.3.221`) this can never fire from a cold start: (1) the model-facing spawn tool is now named `Agent`, not `Task`; (2) `AgentInput.team_name` is "Deprecated; ignored. The session has a single implicit team." — a schema-compliant model never sends it. Empirically confirmed: a live "spawn an agent named git scout" request produced tool `Agent` with `name: "git-scout"` and no `team_name` — a fully-formed addressable-agent request that Nimbalyst dropped at the gate, falling through to plain `local_agent` dispatch. The originally hypothesized missing env bootstrap (`CLAUDE_CODE_TEAM_NAME`/`CLAUDE_CODE_AGENT_ID` never set) is real but is a symptom of the same obsolete explicit-team protocol; under the implicit-team model those vars are not load-bearing, and setting them proactively would deepen the dependence on deprecated surface. There is no `TeamCreate` tool in 0.3.221 and no bootstrap step: the team is implicit per session, and `name` on the `Agent` call is the entire activation signal.

## Correct Design Direction

Adapt the interception gate to the implicit-team protocol: intercept on `(toolName === 'Task' || toolName === 'Agent') && toolInput?.name` (with `enableAgentTeams` env gate), synthesize a session-derived team name for the `name@team` agent-id format the existing managed pipeline (PRDs 002/003: chip UI, thread view, SendMessage routing, resume) is built around, and keep that shipped pipeline intact. The alternative — dropping interception and consuming SDK-native teammate lifecycle hooks (`TeammateIdle` etc., none of which Nimbalyst currently registers) — would rewire the entire shipped teammate stack and is rejected for this PRD (recorded as a decision).

## What Breaks If Unfixed

The entire teammate feature set (PRDs 002/003) is unreachable for every new session. All delegation, even explicitly named, degrades to anonymous one-shot `local_agent` dispatch (PRD 004's surface). The user-visible goal — arrow-key/click into a named agent and chat with it — never activates.

## Open Questions Needing Human Input

1. Whether to keep emitting the deprecated team env vars (likely-harmless no-op) or remove them — leaning keep-and-mark-legacy per surgical-change rules.
2. Upstream SDK asymmetric-SendMessage bug (#48160) — document as known limitation.
3. PRD 004 interplay: named spawns will now route to teammates instead of Task chips; 004's teammate-exclusion rendering logic must be regression-verified.
