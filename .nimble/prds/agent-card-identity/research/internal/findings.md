# Internal Findings (Consolidated) — agent-card-identity

## A1 — spawn cards render expanded by default, header anatomy diverges by kind

**Root cause (confirmed):** `RichTranscriptView.tsx:1626-1642` — a `useEffect` keyed on `[messages]` adds every subagent message's `subagentId` to `expandedTools` on every render where messages change, and never removes entries. `subagentId` is set to `toolUseId` by `ClaudeCodeRawParser.ts:524/597`, which is the same id (`tool.providerToolCallId`) the card uses to look up its own expand state (`RichTranscriptView.tsx:1752`). Net effect: every Task/Agent/teammate spawn card mounts expanded and effectively can't be permanently collapsed during an active turn (the effect re-adds the id on the next message-array change). Blame: `769a3ede5` (2026-04-02), predates PRDs 004/006 — pre-existing, not caused by recent work.

**Fix:** delete the effect. No test asserts it (`internal/errors.md`); add a new collapsed-by-default assertion since this is a real behavior change.

**Header anatomy divergence (confirmed, full inventory in `internal/patterns.md`):**
- Generic card (teammates + any non-Task-widget-gated sub-agent), `renderToolCard` in `RichTranscriptView.tsx:1839-1973`: icon (group/cloud_sync/description) -> name (+ mode/type) -> model.effort audit label (`formatSubagentAuditLabel`) -> live status (spinner/circle/check/cancel + text, driven by `currentTeammates` prop) -> chevron.
- `TaskToolWidget.tsx:116-133` (plain Task/Agent spawns only, per PRD 004's widget gate): literal `"Sub-Agent"` + `[agentType]` -> description. No icon, no model/effort, no live status, no chevron — despite `message.subagent.model` being populated identically to the generic path and a status source existing unused (`sessionTasksAtom`'s `TaskInfo.status`, already fetched at `TaskToolWidget.tsx:97-101` for a different purpose).

**Fix direction confirmed workable:** extract the audit-label logic and the status-indicator JSX (lines 1908-1971) into a shared piece both the generic card and `TaskToolWidget` consume; preserve `.rich-transcript-tool-card.sub-agent`/`.teammate` and `.task-tool-widget-header` selectors — existing tests key on them (`internal/errors.md`).

## A2 — spawned-agent headers show generic "Claude Agent"

**Root cause (confirmed):** `RichTranscriptView.tsx:2298-2300` renders `getProviderDisplayName(provider)` (`'claude-code'` -> `'Claude Agent'`) for every assistant message group header; `provider` is a single string prop for the whole `RichTranscriptView` instance (no per-message override exists — full prop list in `internal/dependencies.md`). `ProviderIcon` at line 2294 is driven by the same prop.

This only surfaces in **embedded** sub-agent transcript mounts, because the main transcript renders teammate turns as compact notifications, not full message groups (`RichTranscriptView.tsx:2163-2204`). Confirmed affected: `TeammateThreadPopover.tsx:204` and `TaskToolWidget.tsx:142`, both of which already hold the needed identity data locally but never forward it — `teammate.name`/`teammate.model` (`TeammateThreadPopover.tsx:173-177`, from `sessionTeammatesAtom`) and `agentType`/per-message `subagent.model` (`TaskToolWidget.tsx:48-49`, `message.subagent.model`). **Unconfirmed in this pass:** `TaskThreadPopover.tsx`, `TaskTileRail.tsx`, `TeammateTileRail.tsx` were located by grep as additional `RichTranscriptView` mounts but not read — verify before scoping the fix's call-site list (`internal/dependencies.md`).

**Fix direction confirmed workable:** add an optional override prop to `RichTranscriptViewProps` (e.g. `senderLabel`/`agentName`+`agentModel`), consumed at the `isNewGroup` header instead of `getProviderDisplayName`. Source data: `teammate.name`/`teammate.model` for teammates, `agentType`/`message.subagent?.model` for Task sub-agents (`TaskInfo` has NO model field — do not add one, per `agentMode.ts:359-372`). Desired format: `"weatherman [haiku]"`.

## Cross-cutting constraints

- Hooks must be called unconditionally (`3fa68d3c0` incident) — any conditional identity-source fallback must be plain-value (`a ?? b`), not `hookA() || hookB()`.
- Extend existing test files (`RichTranscriptView.taskWidgetGate.test.tsx`, `TaskToolWidget.test.tsx`) rather than adding new ones; preserve the selectors both currently assert on.
- No PRD 004/006 code overlap in the fix area beyond PRD 004 having built the exact gate/widget this PRD unifies — see `internal/structure.md`.

## Gap closure (coordinator pass, 2026-08-28)

All five `RichTranscriptView` embedded mounts and their identity data:

| Mount | Name source | Model source |
|---|---|---|
| `TeammateThreadPopover.tsx:204` | `teammate?.name ?? teammateName` | `teammate?.model` |
| `TeammateTileRail.tsx:213` | `teammate?.name ?? agentId` (line 69) | `teammate?.model` (line 180) |
| `TaskToolWidget.tsx:142` | `agentType` (args/subagent) | `message.subagent?.model` |
| `TaskThreadPopover.tsx:125` | `TaskInfo.taskType`/`description` via props | none (TaskInfo has no model field — do not add one) |
| `TaskTileRail.tsx:168` | `TaskInfo` via `sessionTasksAtom` (line 76) | none (same) |

Consequence for A2 design: the override must be optional per part — name-only labels are valid ("explore" without model); model renders only when the mount has it, matching `{teammate?.model && <span>...}` in the popover header.
