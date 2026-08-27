# External Research Findings — agent-teams-cold-start-bootstrap

Date: 2026-08-27. Sources in `sources.yaml`. Facts vs. inference marked explicitly.

## Activation Model Under SDK 0.3.221 (fact + corroborated)

- **Env gate:** `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is the sole required environment enablement for Agent Teams (corroborated: FlorianBruniaux/claude-code-ultimate-guide, aifreeapi.com, getclaudeskills.com). Nimbalyst reads it correctly (`sdkOptionsBuilder.ts:376`, `ClaudeCodeProvider.ts:834`).
- **Per-spawn activation:** a subagent becomes a teammate when the `Agent` tool is invoked with a `name=` parameter — set by the model, not the host (GitHub anthropics/claude-code#48160 discussion). This matches the SDK typedef exactly: `AgentInput.name` — "Name for the spawned agent. Makes it addressable via SendMessage({to: name}) while running." (`sdk-tools.d.ts:505-507`, fact).
- **`team_name` was never meant to be host-supplied per spawn** and is now fully ignored: "Deprecated; ignored. The session has a single implicit team." (`sdk-tools.d.ts:509-512`, fact). Host-side `CLAUDE_CODE_TEAM_NAME` configuration is undocumented/unstabilized in every source surveyed — consistent with it no longer being load-bearing (inference from silence + typedef deprecation).
- **No `TeamCreate` tool exists in 0.3.221's model-facing tool surface** (`sdk-tools.d.ts` grep, fact). No bootstrap tool call is required; the team is implicit per session. `TeammateManager.extractTeamNameFromToolResult` (~line 550) targets a tool that no longer exists.

## Answers to the Planning Questions

- **(a) Is teammate spawning gated only on the env flag?** Yes, plus the model passing `name` — no env bootstrap of team identity is needed under implicit teams. `CLAUDE_CODE_ENABLE_TASKS`'s continued relevance in 0.3.x is not documented anywhere surveyed; it may be as stale as the rest (inference — keep setting it, it is at worst a no-op; verify empirically during implementation).
- **(b) `teammateMode`:** `'auto' | 'tmux' | 'iterm2' | 'in-process'` — "How spawned teammates execute" (`sdk.d.ts:6619-6621`, fact). `'tmux'`/`'iterm2'` open terminal panes (terminal-native Claude Code); `'in-process'` runs the teammate inside the SDK process. For an Electron host that manages its own teammate UI and processes (Nimbalyst's `spawnManagedTeammate` runs teammates via its own `query()` calls), the SDK must not try to open terminal panes. Whether Nimbalyst should set `teammateMode: 'in-process'` explicitly (and whether it applies when the host intercepts the spawn before the SDK acts) is an implementation-time verification (inference).
- **(c) Native lifecycle hooks:** `TeammateIdle` fires with required `teammate_name` (`sdk.d.ts:6935-6942`); `TaskCreated`/`TaskCompleted` carry optional `teammate_name` (`sdk.d.ts:6911-6933`); `SubagentStart`/`SubagentStop` carry `agent_id`/`agent_type` only (`sdk.d.ts:6836-6867`). These events exist since SDK 0.2.33 (SDK CHANGELOG) — long stable. Whether they fire for name-spawned agents when the host intercepts the spawn (vs. letting the SDK spawn natively) is undocumented (inference — Nimbalyst's interception replaces the SDK's own spawn, so SDK-native teammate events for that spawn likely never fire; Nimbalyst's own managed lifecycle is the event source, as built in PRD 002).

## Known Upstream Limitation (flag, not fixable here)

GitHub anthropics/claude-code#48160 (open, closed as duplicate of a tracked issue): even a correctly name-spawned teammate may lack `SendMessage` to *originate* messages to peers — asymmetric communication (lead can message teammate; teammate may not be able to message back). PRDs 002/003 assume bidirectional SendMessage. Under Nimbalyst's managed-spawn model this may not apply (Nimbalyst provides its own SendMessage routing via interception), but if the fix ever falls back to SDK-native spawning, this limitation applies. Document as a known caveat.

## What the Reference Implementation (Claude Code TUI) Does Differently

Observed from a live TUI session on the same machine (fact): the TUI's `Agent` tool schema is identical (name param, deprecated team_name) and named spawns work first-turn with no prior team history and no TeamCreate call — confirming the implicit-team model requires no host bootstrap. The difference is purely that the TUI's harness handles a name-carrying `Agent` call as a teammate spawn natively, while Nimbalyst's interception gate drops it.
