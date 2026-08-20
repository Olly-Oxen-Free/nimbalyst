# Internal Research — Dependencies

## Tracker item data model

- **Canonical type**: `TrackerRecord` —
  `packages/runtime/src/core/TrackerRecord.ts:77-97`.
  ```ts
  interface TrackerRecord {
    id: string;
    primaryType: string;
    typeTags: string[];
    issueNumber?: number;
    issueKey?: string;
    localKey?: string;
    source: 'native' | 'inline' | 'frontmatter' | 'import';
    sourceRef?: string;
    archived: boolean;
    syncStatus: 'local' | 'pending' | 'synced';
    content?: unknown;
    system: TrackerRecordSystem;   // infra metadata, see below
    fields: Record<string, unknown>; // ALL business data, generic bag
  }
  ```
  All business fields (`title`, `status`, `description`, `priority`, custom
  fields, and any future `prompt` field) live in the generic `fields` bag —
  there is deliberately no privileged field vocabulary at this layer
  (comment at `TrackerRecord.ts:1-7`, "No layer outside the schema may
  assume field names"). System/infra metadata (`linkedSessions`,
  `linkedCommits`, `activity`, `origin`, etc.) lives in
  `TrackerRecordSystem` (`TrackerRecord.ts:46-75`).

- **No dedicated "dispatch prompt" field exists today.** The existing
  Launch Session flow (`trackerSessionLaunch.ts:37-69`) synthesizes the
  prompt on the fly from `title` + `status`/`priority`/`type` +
  `description` (via `getRecordFieldStr(trackerItem, 'description')`) +
  `documentPath` — it does not read any `prompt`-named field. Two options
  for the PRD to weigh, both cheap given the schema-tolerant field bag:
  1. **Reuse `description`** as the dispatch prompt source (zero schema
     change, matches current Launch Session behavior exactly).
  2. **Add a dedicated `prompt` field** to relevant tracker type schemas
     (vibeyard parity) — additive schema change, so per
     `docs/TRACKER_SCHEMA_SHARING.md` ("Additive and destructive schema
     changes") it applies instantly with no confirmation/admin gate on
     either personal or team trackers (see
     `trackerSchemaChangeClassifier.ts`, `resolveTrackerSchemaChangeGate`).
     Older clients that don't know the field still preserve its value
     byte-for-byte (schema-tolerant storage guarantee, same doc).

- **PGLite/SQLite row shape**: `packages/electron/src/main/database/sqlite/schemas/0001_initial.sql:238-263`
  (`CREATE TABLE tracker_items`). Business + system data lives in a single
  `data TEXT NOT NULL` JSON column; `title`/`status`/`kanban_sort_order` are
  `GENERATED ALWAYS AS (json_extract(data, '$.x')) STORED` columns for
  indexing/sorting. `sync_status TEXT DEFAULT 'local'` is the column that
  gates whether `linkedSessions` gets persisted at all (see
  `trackerSessionLinks.ts` below) — a `prompt` field, if added, would land
  in this same `data` JSON blob like every other field, no migration
  needed beyond the type's YAML schema declaring it.

- **Row <-> record conversion**: `dbRowToRecord` / `recordToDbParams` in
  `TrackerRecord.ts:361-502`. Note the PGLite/SQLite JSONB sub-extraction
  divergence called out project-wide in `packages/electron/DATABASE.md`
  applies here too — `dbRowToRecord` already defensively parses `row.data`
  with `typeof row.data === 'string' ? JSON.parse(row.data) : row.data ||
  {}` (line 362) and `type_tags` similarly (lines 368-386). Any new
  dispatch-related read of tracker rows must follow the same defensive
  pattern per this repo's DATABASE.md rule.

- **YAML sync format** (`.nimbalyst/trackers/*.yaml`): per
  `docs/TRACKER_SCHEMA_SHARING.md:113-121`, gitignored by default; for a
  personal tracker it's the local authority, for a team tracker it's a
  writable local projection of the server-owned schema. Sharing shape and
  legacy YAML parsing: `packages/runtime/src/plugins/TrackerPlugin/models/TrackerDataModel.ts`
  and `.../YAMLParser.ts` (not read in depth this pass — cited from the doc,
  not independently verified against source; read before implementing a
  new field type if the PRD adds `prompt` as a first-class schema field
  type rather than reusing `description`).

## AI session creation dependency graph

```
Renderer (TrackerMainView.handleLaunchSession)
  -> IPC 'sessions:create'            SessionHandlers.ts:224
       -> AISessionsRepository.create(...)
  -> IPC 'tracker:link-session'       SessionHandlers.ts:1469
       -> createBidirectionalLink()   trackerToolHandlers.ts:153
  -> IPC 'ai:saveDraftInput'          AIService.ts:2497
       -> sessionManager.saveDraftInput(...)
  -> [MISSING for true auto-dispatch] IPC 'ai:sendMessage'  AIService.ts:2136
```

- `sessionManager.createSession(...)` is the shared low-level method but is
  called with **three different positional-argument shapes** by three IPC
  handlers (`session:create`, `ai:createSession`,
  `sessions:create-child` per `SessionHandlers.ts:646`). Read the exact
  call site you intend to extend before adding a fourth caller —
  positional args are easy to transpose.
- `tracker:link-session` (`SessionHandlers.ts:1469`) is the IPC surface for
  `createBidirectionalLink` — this is what a dispatch handler must call to
  get the tracker item's "Sessions" panel and the auto-move-on-complete
  hook (if built) to find each other later.
- `ai:sendMessage`'s handler is `this.sendMessageHandler` on `AIService`
  (bound method, not inlined at the `safeHandle` call site — trace via the
  class field, not the registration line, if modifying its behavior).

## Session status / phase dependency graph

```
Central listener: sessionStateListeners.ts (subscribed once at startup,
  per docs/IPC_LISTENERS.md pattern)
  - writes sessionProcessingAtom(sessionId)      atoms/sessions.ts
  - writes sessionHasPendingInteractivePromptAtom
Agent/user-driven, NOT automatic:
  - metadata.phase ('backlog'|'planning'|'implementing'|'validating'|'complete')
    set via MCP tool `update_session_meta`, or kanban drag on
    SessionKanbanBoard.tsx
  - persisted+audited via
    sessionPhaseTransition.ts: computeSessionPhaseTransition(...)
    (appends to metadata.activity[], same shape as tracker item activity)
Commit-driven, NOT session-status-driven:
  - CommitTrackerLinker.ts closes the TRACKER ITEM (not the session) on a
    `Fixes NIM-123` commit trailer, via getWorkflowStatusFieldName(type) +
    trackerStatusCategory.ts's per-type 'done' status resolution.
```

A hook for "auto-move tracker card when session completes" would need to be
a **new** listener added to (or alongside) `sessionStateListeners.ts`,
watching `metadata.phase` transitions to `'complete'` (the field already
exists and is already audited) and, for sessions with a
`linkedTrackerItemIds` entry (`readLinkedTrackerItemIds`,
`trackerToolHandlers.ts:139-145`), writing the item's type-appropriate
`done` status the same way `CommitTrackerLinker.ts` does. No such listener
exists today — confirmed by grep across `sessionStateListeners.ts` and
`CommitTrackerLinker.ts` for any tracker-status write triggered by a phase
change.

## CollabV3 / team-sync dependency

- `packages/electron/src/shared/trackerSessionLinks.ts` —
  `shouldPersistTrackerLinkedSessions(source)`: returns `false` whenever
  `syncStatus` is `'pending'` or `'synced'`. `createBidirectionalLink`
  (`trackerToolHandlers.ts:171-189`) checks this **before writing**
  `linkedSessions`, and actively **deletes** any existing `linkedSessions`
  value on a team-synced item's row if one is found (line 182-188). This is
  a deliberate, already-enforced rule: session IDs are local-only,
  per-device metadata, never sent to the team room. Any dispatch UI on a
  team-shared tracker item must not assume `linkedSessions` round-trips —
  it won't be visible to a teammate, by design (`getVisibleTrackerLinkedSessions`,
  `trackerSessionLinks.ts:20-26`, is the read-side enforcement of the same
  rule).
- Implication: whatever "auto-move to Done when session completes" hook is
  built runs **entirely on the device that owns the session** — it writes
  the tracker item's `status` field (which *does* sync for team items,
  through the normal tracker write path / TrackerRoom DO), but the
  triggering signal (session phase) and the linkage that lets the hook find
  the item (`linkedSessions` / `linkedTrackerItemIds`) are both local-only.
  If a user dispatches from Device A and the session finishes there, a
  teammate on Device B sees the resulting status change (because status
  syncs) but has no way to see which session drove it or resume it (no
  `linkedSessions` on their copy).
