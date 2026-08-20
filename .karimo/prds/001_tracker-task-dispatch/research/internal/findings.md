# Internal Research — Tracker Task Dispatch

## Headline finding

Not greenfield. A near-complete precedent — **"Launch Session"** — already ships, but only inside
the tracker item **detail panel**:

- `packages/electron/src/renderer/components/TrackerMode/TrackerItemDetail.tsx:1614-1633` — the button
- `packages/electron/src/renderer/components/TrackerMode/TrackerMainView.tsx:520-601` — orchestrates: create session → link to item → seed input
- `packages/electron/src/renderer/components/TrackerMode/trackerSessionLaunch.ts:37-69` — prompt synthesis from title/type/status/priority/description

Flow today: `sessions:create` (IPC) → `tracker:link-session` (IPC → `createBidirectionalLink`,
`packages/electron/src/main/mcp/tools/trackerToolHandlers.ts:153`) → `ai:saveDraftInput` (IPC,
`AIService.ts:2497`) to **pre-fill** the session's input box. It does **not** auto-send.

The PRD's job is mostly:
1. Add a genuine auto-send step — call `ai:sendMessage` (`AIService.ts:2136`) after creation,
   instead of (or in addition to, per user preference) `ai:saveDraftInput`.
2. Surface the action on the kanban card, list row, and table row + their context menus — none
   expose it today; only the detail panel does.
3. Build a "session completed → move tracker item" hook — does not exist in any form today.
4. Decide the dispatch prompt source: reuse the existing `description` field (what Launch Session
   already uses) or add a dedicated `prompt` field, mirroring vibeyard's model.

## 1. Tracker item data model

`TrackerRecord` (`packages/runtime/src/core/TrackerRecord.ts:77-97`) is schema-tolerant — business
data lives in a generic `fields: Record<string, unknown>` bag, no privileged field names at this
layer. No existing "prompt" field. `description` is the closest fit and is already what Launch
Session uses.

Storage: single JSON `data` column
(`packages/electron/src/main/database/sqlite/schemas/0001_initial.sql:238-263`). Adding a `prompt`
field is an additive schema change per `docs/TRACKER_SCHEMA_SHARING.md` — applies instantly, no
confirmation gate on personal or team trackers, no migration needed.

## 2. AI session creation

Two competing session-creation IPC handlers:
- `ai:createSession` (`AIService.ts:1850`) — full provider-init, no initial-prompt param.
- `sessions:create` (`SessionHandlers.ts:224`) — lighter-weight repository write; what the
  existing tracker-launch flow uses.

Neither accepts an initial prompt. A caller must follow with a separate `ai:sendMessage`
(`AIService.ts:2136`) call, which the existing flow deliberately skips (draft-only). `ai:sendMessage`
is a plain main-process IPC call independent of any mounted UI — auto-send after creation needs no
"replay when ready" machinery.

## 3. Session status tracking

No analog to vibeyard's "status flips to completed on process exit." Two existing signals:
- `sessionProcessingAtom(sessionId)` — per-turn busy/idle, flips constantly; wrong granularity.
- `SessionMeta.phase` (`'backlog'|'planning'|'implementing'|'validating'|'complete'`,
  `atoms/sessionKanban.ts:26`) — set manually via the `update_session_meta` MCP tool or a kanban
  drag (`services/session/sessionPhaseTransition.ts`), never automatically.

No "auto-move tracker card to Done when session completes" hook exists anywhere. New work should
watch `metadata.phase → 'complete'` transitions for sessions with a linked tracker item, and reuse
`CommitTrackerLinker.ts`'s existing per-type "done" status resolution
(`getWorkflowStatusFieldName` / `packages/runtime/src/plugins/TrackerPlugin/models/trackerStatusCategory.ts`)
rather than hardcoding a status value — every tracker type declares its own terminal status.

## 4. Tracker UI components

- Kanban card: `TrackerBoardCard.tsx` (props lines 29-52) — favorite star, milestone chip,
  staleness chip; no launch affordance.
- List view: `TrackerGridView.tsx`.
- Table view: `packages/runtime/src/plugins/TrackerPlugin/components/TrackerTable.tsx` (both
  confirmed current renderers via commit `3cb746451`).
- Context menus: `TrackerRowContextMenu.tsx` (runtime) and `KanbanContextSubmenu.tsx` (electron
  board) — both already use `@floating-ui/react` (`useFloating`/`FloatingPortal`) per this repo's
  mandatory rule. Any new dispatch menu item must match.

None of these four surfaces expose launch/dispatch today — confirmed absent by grep, not merely
unsearched.

## 5. CollabV3 implications

`packages/electron/src/shared/trackerSessionLinks.ts`: `shouldPersistTrackerLinkedSessions()`
returns false whenever a tracker item's `syncStatus` is `'pending'` or `'synced'` — session links
never sync to the team room by explicit existing design, and any `linkedSessions` found on a
team-synced row is actively deleted on write.

Only the underlying field write (e.g. a status change from an auto-move hook) goes through normal
team sync. Dispatch's session linkage, and its resume/focus affordances, are therefore
**local-only per device** — a teammate sees the eventual status change but never who dispatched it
or what session is running.

## 6. "Open file at line" precedent (git log lead) — considered and rejected

`packages/electron/src/renderer/components/TabEditor/editorRevealCommand.ts` is a "pending
request, replay on target-mount" registry for a different problem (scrolling to a line in an
editor tab that may not exist yet). Not applicable here: `ai:sendMessage` is main-process-only and
needs no mounted renderer target, so there's no "target isn't ready" problem to solve the same way.

## Comparison to vibeyard (external findings)

| vibeyard | nimbalyst equivalent | Gap |
|---|---|---|
| `BoardTask.prompt` (first-class field) | `TrackerRecord.fields.description` (reused, no dedicated field) | Decision needed — see above |
| `runTask()` one-button dispatch/resume/focus | `TrackerItemDetail`'s Launch Session button (create + link + draft-fill only) | No resume/focus state machine; no auto-send; no card/list/table surfacing |
| `setPendingPrompt` → spawn-time CLI arg | `ai:saveDraftInput` → sits in input box, unsent | Needs `ai:sendMessage` call, or explicit user choice to keep draft-only |
| `behavior`-tagged column, `getColumnByBehavior('terminal')` | `getWorkflowStatusFieldName` / per-type terminal status in `trackerStatusCategory.ts` | Equivalent concept already exists — reuse, don't reinvent |
| `board-session-sync.ts` status-change listener | none | Net-new: needs a `phase → 'complete'` watcher keyed by linked tracker item |
| Session link stored on task, resumable via `cliSessionId` | `createBidirectionalLink` (tracker↔session), but CollabV3-excluded from sync | Local-only by existing design — must stay local-only or be explicitly reworked (bigger scope) |

## Source files (evidence)

Full grep/read trail: `research/internal/patterns.md`, `dependencies.md`, `structure.md`,
`errors.md` in this folder.
