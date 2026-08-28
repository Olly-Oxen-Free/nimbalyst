# Internal Patterns — agent-card-identity

## A1: card anatomy comparison

### Generic sub-agent/teammate card (`renderToolCard`, shared path)

File: `packages/runtime/src/ui/AgentTranscript/components/RichTranscriptView.tsx`

Rendered for any `isSubAgent` message that is NOT a plain (non-teammate) `Task`/`Agent` spawn — i.e. teammates always render here (line 1766 gate: `CustomWidget && !(isSubAgent && isTeammate)`).

Header button (`.rich-transcript-tool-button`, lines 1839–1973), single row, `flex items-center gap-1.5`:
1. Icon (line 1840–1852): `group` (teammate) / `cloud_sync` (background sub-agent) / `description` (sync sub-agent) / `build` (plain tool) — `MaterialSymbol`, class `rich-transcript-tool-icon sub-agent-icon`.
2. Name (line 1853–1865, `.rich-transcript-tool-name`): teammate → `toolMsg.subagent?.teammateName || 'Teammate'`, optionally ` (mode)` in `.rich-transcript-tool-subagent-type`; plain sub-agent → `'Background Agent'` or `'Sub-Agent'` plus ` [agentType]`.
3. Audit label (line 1866–1874, `.rich-transcript-subagent-audit`): `{model} · {reasoningEffort}` via `formatSubagentAuditLabel(toolMsg.subagent?.model, toolMsg.subagent?.reasoningEffort)` — only rendered `isSubAgent` (covers both teammates and plain sub-agents).
4. Args preview — plain-tool only (`!isSubAgent`), skipped for sub-agents/teammates.
5. Status indicator (line 1908–1971): sub-agent/teammate branch computes `effectiveStatus` from `currentTeammates` prop matched by `agentId`, renders spinner+"Running", ○+"Idle", check_circle+"Done", cancel+"Errored", or a fallback spinner. Non-sub-agent tools show a plain success/error icon.
6. Chevron (line 1972): `expand_more`/`chevron_right`, `.rich-transcript-tool-chevron`.

Card wrapper class (line 1828–1834): `.rich-transcript-tool-card.teammate` vs `.rich-transcript-tool-card.sub-agent`.

### `TaskToolWidget` (custom widget, plain Task/Agent spawns only)

File: `packages/electron/src/renderer/components/AgentMode/TaskToolWidget.tsx`, header lines 116–133.

Header button (`.task-tool-widget-header`), single row, `flex items-center gap-1.5`:
1. NO icon.
2. Title (`.task-tool-widget-title`): literal `"Sub-Agent"` + optional ` [agentType]` (`.task-tool-widget-agent-type`) — agentType from `message.subagent?.agentType` or `args.subagent_type`.
3. Description (`.task-tool-widget-description`), from `args.description` — the generic card never shows this in the header (only in the expanded body, line 1978).
4. NO model/reasoning-effort label — `formatSubagentAuditLabel` / `toolMsg.subagent?.model` is never read here even though `message.subagent?.model` is populated identically to the generic path (same `TranscriptViewMessage.subagent` shape).
5. NO live status (Running/Idle/Done/Errored) — the widget has no `currentTeammates` prop and doesn't accept one.
6. NO chevron — expand/collapse affordance is implicit (whole header is a button), unlike the generic card's explicit chevron icon.

Divergence in card shell too: `.task-tool-widget` (`rounded border`) vs `.rich-transcript-tool-card.sub-agent` (`rounded border overflow-hidden`) — visually near-identical but a different class name entirely, so no shared selector exists for future styling.

**Confirmed fix-relevant reuse point:** `formatSubagentAuditLabel` (imported/used in RichTranscriptView.tsx only) and the status-indicator JSX block (1908–1971) are the two pieces to extract into a shared header component/hook consumed by both `TaskToolWidget` and the generic card's `isSubAgent` header branch — per the PRD's stated fix direction, unifying anatomy while content differs by kind.

## A1: auto-expand effect (root cause, confirmed)

`RichTranscriptView.tsx:1626-1642`:
```
useEffect(() => {
  const subAgentIds = new Set<string>();
  messages.forEach(msg => {
    if (msg.type === 'subagent' && msg.subagentId) {
      subAgentIds.add(msg.subagentId);
    }
  });
  if (subAgentIds.size > 0) {
    setExpandedTools(prev => { ...adds every subAgentIds entry... });
  }
}, [messages]);
```
`subagentId` is set to `toolUseId` in `ClaudeCodeRawParser.ts:524` (subagent_started descriptor) and matched against `toolUseId` again at `:597` (subagent_completed). Card expansion is keyed on `toolId = tool.providerToolCallId || tool.toolName || ...` (line 1752) which for a Task/Agent tool call equals the same `toolUseId`. Because the effect fires on every `messages` change and never removes ids, **every subagent message — teammate or plain sub-agent — ends up permanently in `expandedTools`**, i.e. spawn cards mount expanded and stay expanded regardless of user interaction. `toggleToolExpand` (line 1604) can collapse a card once, but the next `messages` array identity change (any new stream chunk) re-adds the id via this effect, functionally making user collapse un-sticky during an active turn.

Blame: commit `769a3ede5` "refactor: Transcript UI consumes TranscriptViewMessage directly" (2026-04-02) — predates PRD 004 (task-subagent-visibility) and PRD 006 (teammate-idle-handoff). Confirmed pre-existing, not introduced by either recent PRD.

## A2: identity label mechanism (root cause, confirmed)

`RichTranscriptView.tsx:2298-2300` — every assistant message group header renders:
```
{isUser ? 'You' : getProviderDisplayName(provider)}
```
`getProviderDisplayName` (line 1696-1714) maps `provider` string → generic label; `'claude-code'` → `'Claude Agent'`. `provider` comes from the `RichTranscriptView` `provider?: string` prop (line 476) — a single value for the whole mounted transcript, not per-message. Both embedded call sites mount a *second* `RichTranscriptView` instance for the sub-transcript and do NOT pass `provider`, so it falls through to the component's own default resolution (see dependencies.md) — the assistant header always reads the generic provider label, never the specific agent's own name/model.

`ProviderIcon` (line 2294) is likewise driven by the same `provider` prop, defaulting to `'claude-code'` when absent — so both A2 symptoms (name text AND icon) stem from the same single-prop-per-view design.

## A2: identity data already available at each embed site

- `TeammateThreadPopover.tsx` line 173-177 (in the popover's OWN header, not passed to the embedded `RichTranscriptView`): `teammate?.name`, `teammate?.model` already rendered directly from `sessionTeammatesAtom`.
- `TaskToolWidget.tsx` line 48-49: `agentType` already extracted from `message.subagent?.agentType` / `args.subagent_type`. Model is available via `message.subagent?.model` on each message the embedded transcript renders (same field `formatSubagentAuditLabel` reads at RichTranscriptView.tsx:1821, 1866-1874) but `TaskToolWidget` never reads or forwards it.

Neither embed site currently passes any identity override prop to `RichTranscriptView` — no such prop exists yet (see dependencies.md for full prop list).
