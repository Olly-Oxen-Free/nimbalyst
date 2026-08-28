# Internal Dependencies — agent-card-identity

## Every `RichTranscriptView` call site (rtk grep, non-test, non-dist)

| Call site | What identity data it has available | Passes `provider`? |
|---|---|---|
| `packages/runtime/src/ui/AgentTranscript/components/AgentTranscriptPanel.tsx:316` | Main-session panel — the top-level, non-embedded mount. Has the real session's provider/model already (session-level, not per-sub-agent). | Not inspected in this pass (main mount — out of scope for the "generic label only in embedded views" claim, but should be confirmed unaffected by any new prop's default). |
| `packages/electron/src/renderer/components/AgentMode/TeammateThreadPopover.tsx:204` | `teammate.name`, `teammate.model` already available locally (used in popover's own header at line 173-177) but NOT forwarded to `RichTranscriptView`. | No — omitted, falls to default. |
| `packages/electron/src/renderer/components/AgentMode/TaskToolWidget.tsx:142` | `agentType` (from `message.subagent?.agentType`/`args.subagent_type`), and per-message `subagent.model` on each message in the fetched sub-transcript. Neither forwarded. | No. |
| `packages/electron/src/renderer/components/AgentMode/TaskThreadPopover.tsx:125` | Not yet inspected this pass — same family as TeammateThreadPopover (Task-specific popover). Likely has `agentType`/task metadata via its own props; needs the same identity-prop wiring as TaskToolWidget. | No (not inspected — flag for implementer to check). |
| `packages/electron/src/renderer/components/AgentMode/TaskTileRail.tsx:168` | Tile-rail view of Task sub-agents; not yet inspected — likely has `TaskInfo` (agentType, no model field per `agentMode.ts:359-372`) plus the transcript messages' own `subagent.model`. | No (not inspected). |
| `packages/electron/src/renderer/components/AgentMode/TeammateTileRail.tsx:213` | Tile-rail view of teammates; has `sessionTeammatesAtom` entries (name + model) same as the popover. | No (not inspected). |
| `packages/electron/src/renderer/components/AgenticCoding/SessionTranscriptPeek.tsx:183` | Session-level peek, not sub-agent-scoped — likely wants the session's own provider, not an override. Out of scope for A2. | Not inspected. |

**Research gap, flagged for the implementer:** `TaskThreadPopover.tsx`, `TaskTileRail.tsx`, `TeammateTileRail.tsx`, and `SessionTranscriptPeek.tsx` were located by grep but not opened in this pass — only `TeammateThreadPopover.tsx` and `TaskToolWidget.tsx` (the two sites named in the coordinator's brief) were read in full. Before wiring a `senderLabel`/`agentName`+`agentModel` override prop, re-grep these four for whether they render sub-agent/teammate transcripts (in which case they need the same override) or session-level transcripts (in which case they should NOT receive it, to avoid regressing the main session header).

## `RichTranscriptViewProps` (full prop surface, for the new-prop design)

`packages/runtime/src/ui/AgentTranscript/components/RichTranscriptView.tsx:469-538`. Relevant existing props: `sessionId`, `provider?: string`, `settings?: TranscriptSettings`, `currentTeammates?: Array<{ agentId; status }>` (used only for A1's live status, no name/model), `persistScrollState?: boolean`. No per-message or per-view identity-override prop exists today — A2's fix requires adding one (e.g. `senderLabel?: string` or `agentName?: string` + `agentModel?: string`), consumed at the `isNewGroup` header (line 2298-2300) in place of/alongside `getProviderDisplayName(provider)`.

## `TranscriptViewMessage.subagent` shape (shared by both parser and consumers)

Populated by `ClaudeCodeRawParser.ts` `subagent_started`/`subagent_completed` descriptors (lines ~510-540, ~590-600): `agentType`, `teammateName`, `teammateMode`, `teamName`, `isBackground`, plus `model`/`reasoningEffort` read elsewhere (`formatSubagentAuditLabel` call site, RichTranscriptView.tsx:1821). This is the single source both A1's audit label and A2's proposed name/model header should read from — no new backend/parser field is needed for either bug.

## `TaskInfo` (agentMode.ts:359-372) has NO model field

Per the coordinator's brief — confirmed. `TaskInfo` (session-metadata-derived, `sessionTasksAtom`) tracks `taskId, description, taskType, status, startedAt, toolUseId, toolCount, tokenCount, durationMs, lastToolName, summary` — no `model`. Do not add one; `TaskToolWidget` should source model from the transcript message's `subagent.model` (same field the generic card's audit label already reads), not from `TaskInfo`.

## Jotai atoms touched by A1 fix

`expandedTools` is local `useState`/`Set` inside `RichTranscriptView` (not a Jotai atom) — deleting the auto-expand `useEffect` is a self-contained change with no cross-atom fallout. `toggleToolExpand` (line 1604) and `setInlineExpand`/`openTaskInlineExpandAtomFamily` (agentMode.ts:304-317, consumed by `TaskToolWidget.tsx:88-93`) are unaffected — they track expand state per `toolUseId`/`sessionId`, independent of the effect being removed.

## Hooks-safety constraint (repo-wide incident, applies to both fixes)

Commit `3fa68d3c0` — `useAtomValue(a) || useAtomValue(b)` crashed the app by making a hook call conditional/short-circuited. Any new prop plumbing (e.g. reading `teammate.model` vs `message.subagent?.model` for the header label) must resolve via plain value fallback (`a ?? b`) computed from already-unconditionally-called hooks, never `hookA() || hookB()`.
