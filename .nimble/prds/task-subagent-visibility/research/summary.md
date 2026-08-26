# Research Summary: task-subagent-visibility

## What's being built

Task-tool sub-agents (anonymous `Task`/`Agent` dispatch — the model's default delegation
mechanism) currently open a static `TaskStatusPopover` on chip click. This PRD gives them a
real transcript popover, matching what teammates already got in PRD 002.

## Internal research — the shape of the fix

- PRD 002 built the exact reusable template: `ai:getTeammateTranscript` IPC handler,
  `projectTeammateRawMessages` (tag-filter + reuse the standard projection pipeline),
  `teammate:transcriptUpdated` → `teammate:transcript-updated` live-signal channel, and
  `TeammateThreadPopover.tsx`'s floating-ui + `RichTranscriptView` pattern. All directly
  adaptable to Task sub-agents via a `taskId`-keyed sibling of each piece.
- PRD 002 explicitly deferred this exact feature as a non-goal ("Task chips stay
  read-only. Separate product decision, not revisited here.") — this PRD is that decision.
- **Correction to the seed research's open question:** Task-chip *metadata*
  (status/description/tool count) already persists across restart today, via
  `emitTaskUpdate` writing `activeTasks` into the session's `metadata.currentTasks` on
  every transition — the same persistence mechanism PRD 002 built for teammates. `activeTasks`
  map entries are also never evicted in-memory. Only the transcript *text* is missing —
  a smaller gap than "no persistence point exists."
- The exact drop point for sub-agent text is `ClaudeCodeTranscriptAdapter.ts:233`
  (`if (parentToolUseId) continue;`), confirmed same-session as a live bug fix. `ai_agent_messages`
  needs no schema change — it's an opaque-JSON table already filtered this way for teammates.

## External research — calibrating the target

- Native Claude Code CLI's default interactive terminal shows only agent name/elapsed
  time/token count for a sub-agent — no transcript text, confirmed by an open first-party
  feature request (anthropics/claude-code#48246) asking for exactly this gap to close
  upstream. Nimbalyst's existing `TaskStatusPopover` already roughly matches that bar.
- Full sub-agent text is only exposed via `--forward-subagent-text` (stream-json) /
  `forwardSubagentText` (SDK) — designed for client consumers to render nested transcripts,
  not native-terminal parity.
- The Agent Client Protocol (ACP) client for Claude Agent SDK is an existing consumer doing
  exactly this: correlating nested sub-agent updates via `parentToolUseId`, gating on a
  client capability flag, falling back to the flat tool_result otherwise. This validates
  Nimbalyst's planned correlation approach as the standard shape, not a workaround.
- Nesting depth (up to 5) and forwarding of depth-2+ sub-agents means the correlation
  scheme should handle chains, not just one flat hop — a real volume/complexity risk to
  flag for planning.

## Net implication for scope

"Parity with native CLI," read literally, is nearly already met by the status-only popover.
The feature that actually closes the user's stated trust gap is closer to what ACP clients
and the SDK's `forwardSubagentText` design already enable: a live, parentToolUseId-correlated
nested transcript. Because Task-chip metadata already persists but text doesn't, and because
native CLI itself has no durable post-completion transcript view, a **live-only** transcript
(visible while the chip exists, not necessarily surviving restart or offering send/stop) is
the best-fit scope — smaller than teammates' persisted/interactive scope, sufficient to close
the gap, and consistent with both external precedent and Nimbalyst's own already-persisted
metadata pattern.

## Design decision (finalized 2026-08-26)

All three presentation surfaces from the mockups are in scope, mapped to distinct triggers
rather than picked as a single option:

- **Hover** the chip (inline in transcript, or its row in the Sub-agents sidebar list) →
  lightweight **popover** peek (dismisses on mouse-leave, no click).
- **Click** the assistant message that spawned the sub-agent (a new, visually distinct
  message-bubble class — not the chip) → **inline expand** directly under that message.
- **Click** the chip itself (inline or in the sidebar list) → **tiling view**: a new pane
  opens beside the main thread, main thread keeps full height.

This is three real UI surfaces sharing one backend (the same live, taskId-correlated
transcript feed), not a single pick. Backend scope (IPC handler, transcript
projection/correlation, live-signal channel) is shared and built once; each presentation
surface is separate renderer work. PRD 002's `TeammateThreadPopover` gives near-total reuse
for the hover-popover surface only — inline expand and tiling both need new renderer layout
work, though they consume the same transcript data once it's flowing.

## Research artifacts

- `research/internal/findings.md` — full internal findings (git commit `d09f86ae1`)
- `research/external/sources.yaml` — source attribution (git commit `75e2d98bf`)
- `research/external/findings.md` — external findings (this commit)
