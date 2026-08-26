# External Research: task-subagent-visibility

Scope: calibrate "parity with native Claude Code CLI" against what the CLI's terminal UI
and the underlying Agent SDK actually expose for Task/Agent-tool sub-agents, to size the
feature honestly rather than over-scope it toward the teammate feature's fuller bar.

## Finding 1: The native interactive terminal shows status only, not transcript text

The CLI's own collapsed sub-agent display is minimal — an open first-party feature request
(anthropics/claude-code#48246) documents the current state: agent name/description,
elapsed time, and token count only — "no tool-call detail, no text, no thinking." The
request itself asks Anthropic to surface data the CLI already tracks internally (from
`TaskCreate`/`TaskUpdate`) but doesn't render.

**Implication:** Nimbalyst's existing `TaskStatusPopover` (label, status, active tool name)
already roughly matches or exceeds the native CLI's *default* terminal display. The user's
"parity with native CLI" framing, taken literally against the default interactive TUI, is
close to already met — the actual gap this PRD closes (readable transcript text) is a step
*beyond* native-CLI-default parity, not a return to it.

## Finding 2: Ctrl+T task list is the CLI's closest built-in analog, and it's status-only too

Community documentation describes `Ctrl+T` as the CLI's toggle for an in-session task list
— again status, not transcript content. It requires an explicit user action and shifts
focus away from the live conversation, rather than appearing inline. No first-party CLI
surface renders a sub-agent's actual assistant text/tool calls inline during a run.

## Finding 3: Full sub-agent text exists only behind explicit forwarding, for programmatic consumers

- CLI: `--forward-subagent-text` (stream-json output mode) forwards subagent text/thinking
  into the stream, including depth-2+ nested sub-agents, each keyed by the spawning
  `tool_use` id. Stream-json only — does not change the interactive TUI.
- SDK: `forwardSubagentText` (already enabled in Nimbalyst's `sdkOptionsBuilder.ts`) is
  documented as existing specifically so consumers can render a nested transcript — i.e.
  it targets exactly this PRD's use case, not passive CLI-parity imitation.
- ACP (`agentclientprotocol/claude-agent-acp`): a real existing consumer of this same data.
  Correlates nested updates to their parent Agent/Task call via
  `_meta.claudeCode.parentToolUseId` — the same field Nimbalyst's adapter already extracts
  as `parentToolUseId` — and gates nested rendering behind a client capability flag with a
  flattened fallback otherwise. External validation that the parentToolUseId correlation
  approach from internal research is the standard shape other Claude Code clients use, not
  a Nimbalyst-specific workaround.

## Finding 4: Depth and volume are real constraints, not just Nimbalyst's own

Nested sub-agents (agents spawning agents) are supported to a capped depth (community
sources cite depth 5), and forwarding now includes depth-2+ sub-agents, each keyed by their
own spawning tool_use id. Corroborates the internal-research risk that Task-sub-agent chunk
volume can exceed teammate volume in a session — correlation needs to handle nesting, not
just one flat lead→sub-agent hop.

## Scope calibration for planning

Given findings 1–3, "parity with native CLI" most defensibly means: surface what the SDK
already forwards (text/thinking/tool calls, correlated by parentToolUseId) in a client UI —
what ACP-compatible clients already do — rather than literally replicating the CLI's sparse
default terminal output. A live-only view (transcript exists while the chip is visible, per
internal research's persistence findings) is consistent with this framing and doesn't need
to match teammates' persisted/restart-survivable/stoppable scope to feel like a faithful
"native CLI, but visible" experience.

## Sources

See `sources.yaml` for full attribution.
