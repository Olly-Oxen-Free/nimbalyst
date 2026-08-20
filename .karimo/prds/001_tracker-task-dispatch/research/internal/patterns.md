# Internal Research — Patterns

## 1. An almost-complete precedent already exists: "Launch Session" / "Launch Worktree"

The requested feature (one-click dispatch from a tracker item into a new AI
session seeded with the item's text) is **not greenfield**. A materially
similar flow already ships, gated behind the tracker item **detail panel**
only — it is not on the kanban card, list row, or table row.

- `packages/electron/src/renderer/components/TrackerMode/trackerSessionLaunch.ts:37`
  — `buildTrackerLaunchContext(trackerItemId, trackerItem)` builds the prompt
  text: `implement tracker item {issueKey}: {title}` + type/status/priority
  line + `description` field + a trailing instruction telling the agent to
  call `tracker_update` on completion. Returns `{ trackerLinkId, draftInput,
  worktreeName }`.
- `packages/electron/src/renderer/components/TrackerMode/TrackerMainView.tsx:520-567`
  — `handleLaunchSession(trackerItemId)`: creates a session via IPC
  `sessions:create`, links it to the tracker item via IPC
  `tracker:link-session`, then **saves the built prompt as the session's
  draft input** via IPC `ai:saveDraftInput` (does NOT send it), refreshes the
  session list, and navigates to Agent mode.
- `packages/electron/src/renderer/components/TrackerMode/TrackerMainView.tsx:570-601`
  — `handleLaunchWorktree` / `handleCreateTrackerWorktree`: same shape, but
  routes through `createNewWorktreeSessionActionAtom` with
  `initialDraft: pendingWorktreeLaunch.draftInput` to spin up an isolated git
  worktree session instead of a plain session.
- Both handlers are wired only into
  `packages/electron/src/renderer/components/TrackerMode/TrackerItemDetail.tsx:1614-1633`
  as "Launch Session" / "Launch Worktree" buttons in the item detail panel's
  Sessions section (props `onLaunchSession` / `onLaunchWorktree`, declared at
  lines 68-69, invoked at 1617/1627, and again as a fallback at line 1820 when
  a file-backed document's "switch to agent mode" affordance has no session
  yet).

**Critical gap vs. the requested feature:** the existing flow calls
`ai:saveDraftInput` (`packages/electron/src/main/services/ai/AIService.ts:2497`,
which delegates to `sessionManager.saveDraftInput`, the same store as the
`sessions:update-draft-input` IPC handler at
`packages/electron/src/main/ipc/SessionHandlers.ts:307`). This **pre-fills**
the chat input box; it does not call `ai:sendMessage`. The user still has to
open Agent mode and press Send. The vibeyard-style "immediately spawns a
session using the task's prompt as the *opening message*" requirement is a
genuine delta — dispatch must additionally call `ai:sendMessage` (or an
equivalent) to auto-send, not just pre-fill.

## 2. Session creation IPC — two competing entry points

- **`ai:createSession`** — `packages/electron/src/main/services/ai/AIService.ts:1850`
  (renderer surface: `window.electronAPI.ai.createSession(...)`,
  `packages/electron/src/preload/index.ts:816-817`, also duplicated at
  550/553 in an older namespace). Takes
  `(provider, documentContext?, workspacePath?, modelId?, sessionType?, worktreeId?)`.
  Resolves provider/model, validates API key/auth per provider, then calls
  `sessionManager.createSession(...)` and initializes the actual provider
  instance (`ProviderFactory.createProvider` / `createExtensionAgentProvider`).
  **No initial-prompt parameter** — callers must follow up with a separate
  `ai:sendMessage` call.
- **`sessions:create`** — `packages/electron/src/main/ipc/SessionHandlers.ts:224-266`
  (renderer surface: `window.electronAPI.invoke('sessions:create', { session,
  workspaceId })`). This is the one `TrackerMainView.handleLaunchSession`
  actually uses. It writes directly to `AISessionsRepository.create(...)`
  with a caller-supplied `session.id` (`crypto.randomUUID()` at
  TrackerMainView.tsx:532), `provider`, `model`, `title`, `mode`, etc., and
  fires the `trackCreateAISession` analytics event. It does **not**
  initialize a live provider instance the way `ai:createSession` does — that
  happens lazily on first `ai:sendMessage`. Also has no initial-prompt param.
- **`ai:sendMessage`** — handler registered at
  `packages/electron/src/main/services/ai/AIService.ts:2136`
  (`this.sendMessageHandler`), renderer surface
  `window.electronAPI.ai.sendMessage(message, documentContext?, sessionId?,
  workspacePath?)` (`preload/index.ts:818-819`). This is the call dispatch
  needs to add after session creation to actually auto-send the prompt as the
  opening message. It is a plain IPC call, independent of any mounted chat
  UI — the central `sessionStateListeners.ts` (below) picks up the resulting
  streaming state regardless of which panel is focused, so dispatch does not
  need the "reveal registry / replay on mount" pattern from item 6.

There is a third creation path (`session:create`,
`SessionHandlers.ts:218-221`) used for document-attached editor sessions
(`sessionManager.createSession(type, documentContext, source)` — different
positional-arg shape than `ai:createSession`'s call into the same method).
Not relevant to dispatch, but exists — do not confuse with `ai:createSession`
or `sessions:create` when reading `sessionManager.createSession`'s signature
(it accepts up to 10 positional args across these three callers, and they
disagree on order).

## 3. Session workflow "phase" is a manual/agent-set field, NOT a live process-status signal

vibeyard's model (from the task spec) is: `session.status` flips to
`'completed'` when the CLI/agent process exits, and that event is what moves
the kanban card. Nimbalyst's closest analog is materially different in one
important way — **no code path in this codebase treats "the AI turn
finished" or "the CLI session exited" as "the task is done."**

- `SessionMeta.phase: 'backlog' | 'planning' | 'implementing' | 'validating' |
  'complete'` — `packages/electron/src/renderer/store/atoms/sessionKanban.ts:26`.
  This already exists as its own kanban board
  (`SessionKanbanBoard.tsx`, distinct from the tracker item kanban board) and
  is set explicitly, by the agent calling the `update_session_meta` MCP tool
  or by a user dragging a session card between phase columns — see the
  doc comment in `packages/electron/src/main/services/session/sessionPhaseTransition.ts:1-27`.
  Per this repo's own CLAUDE.md convention (see "Never mark work done before
  the user approves it"), `phase: 'complete'` is meant to be set once the
  user has *committed* the work, not when the agent stops talking.
- `sessionProcessingAtom(sessionId)` — boolean, per-session, in
  `packages/electron/src/renderer/store/atoms/sessions.ts`, flipped by the
  central listener `packages/electron/src/renderer/store/sessionStateListeners.ts`
  (true at lines 317/328/347/1020 when a turn starts streaming, false at
  lines 288/1040 when it ends). This is a **per-turn busy/idle flag**, not a
  "task finished" signal — it goes false the instant the agent's response
  ends even if the agent is only pausing for the next user message, or is
  awaiting an interactive tool-permission prompt
  (`sessionHasPendingInteractivePromptAtom`, imported alongside it in
  `sessionKanban.ts:18`).
- **A grep false lead worth flagging explicitly**: `MessageStreamingHandler.ts:2298`
  sets `phase: 'complete'` inside an `ai:performanceMetrics` IPC payload.
  This is an unrelated field on a perf-telemetry event (marks "the streaming
  perf-measurement phase completed"), not the session's workflow `phase`.
  Do not conflate the two when grepping this codebase for "session complete."
- The one place this codebase closes a tracker item automatically today is
  commit-driven, not session-status-driven:
  `packages/electron/src/main/services/CommitTrackerLinker.ts` — a commit
  message carrying `Fixes NIM-123` moves that tracker item to whichever
  status its own type's schema declares as "done" (see Pattern 4 below). It
  does not touch the *session's* phase at all in this file; per CLAUDE.md,
  setting session phase to `complete` at that point is left to the agent /
  is a separate manual step.

**Implication for the "auto-move tracker item to Done when session
completes" requirement:** there is no existing "session completed" event to
subscribe to that means what the PRD wants. The closest true signal in this
codebase for "this unit of work is done" is a commit landing with a closing
reference — which already auto-moves the tracker item, independent of
session state. If dispatch wants an automatic move driven by *session*
state (mirroring vibeyard), it will need a **new** signal — most plausibly
"session phase transitioned to `complete`" (already-existing atom/DB field,
just not currently wired to tracker item status), rather than
"`sessionProcessingAtom` went false" (too noisy — flips every turn) or
"CLI process exited" (no such concept exists for the in-process providers;
only `claude-code`/`openai-codex`/CLI-shelling providers have an OS process
at all, and even for those exit doesn't imply success).

## 4. Terminal/"Done" status is per-type, resolved through a registry — never hardcode `'done'`

`packages/runtime/src/plugins/TrackerPlugin/models/trackerStatusCategory.ts`
is "the one place the product answers 'is this item finished'" (doc comment,
lines 1-22). Every status option on every tracker type declares its own
`category: 'backlog' | 'unstarted' | 'started' | 'done' | 'cancelled'`
(`StatusCategory`, line 26). A `plan` closes on `completed`, a `decision` on
`decided`/`implemented`, an `idea` on `rejected` — there is no single "Done"
column name across types.

`CommitTrackerLinker.ts` (around lines 364-414) already implements exactly
the resolution dispatch would need: `getWorkflowStatusFieldName(type)` to
find which field on the item's schema carries workflow status, then look up
that type's `done`-category status value, and write it — falling back to
"leave it open" (with a log line) for a type with no done-category status at
all (e.g. an idea that only ever ends `cancelled`, never `done`). **Any
"move tracker card to Done when session completes" implementation should
reuse this resolution logic** (or extract it into a shared helper) rather
than reimplementing "what does done mean for this item's type."

## 5. Tracker card / list / table view components (where a dispatch action would render)

- **Kanban card**: `packages/electron/src/renderer/components/TrackerMode/TrackerBoardCard.tsx`
  (props at lines 29-52). Currently renders: select checkbox, unread dot,
  favorite star (`TrackerFavoriteStar`), title/key line, type/tag/priority
  chips, `TrackerCardStalenessChip`, `TrackerCardMilestoneChip`, owner
  avatar. **No run/launch/dispatch affordance exists on the card today** —
  `onLaunchSession`/`onLaunchWorktree` are not among its props. Adding a
  dispatch button here means extending `TrackerBoardCardProps` and the
  render, following the existing chip/button patterns already in the file
  (e.g. `TrackerCardMilestoneChip.tsx`, `TrackerFavoriteStar` — small
  icon-buttons that `event.stopPropagation()` before doing their own thing,
  since the whole card has an `onClick`/`onDoubleClick`/drag handlers that
  would otherwise fire — see `TrackerBoardCard.tsx:111-115` for the
  `stopPropagation` idiom to copy).
- **List/table view**: `packages/runtime/src/plugins/TrackerPlugin/components/TrackerTable.tsx`
  and `packages/electron/src/renderer/components/TrackerMode/TrackerGridView.tsx`
  (both recently touched by commit `3cb746451` "show collection names in the
  tracker list and table views" — confirms these two files are the current
  list/table renderers). Neither currently takes an `onLaunchSession` prop
  (grep of `onLaunchSession`/`onLaunchWorktree`/"Launch Session" across
  `TrackerMode/*.tsx` only matches `TrackerItemDetail.tsx` and
  `TrackerMainView.tsx`).
- **Row context menu**: `packages/runtime/src/plugins/TrackerPlugin/components/TrackerRowContextMenu.tsx`
  uses `@floating-ui/react` (`useFloating`, `offset`, `flip`, `shift`,
  `FloatingPortal` — imported at line 12) per this repo's mandatory
  floating-ui rule. `KanbanContextSubmenu.tsx` (board's own right-click
  submenu) follows the identical pattern (`useFloating`/`FloatingPortal` at
  lines 9/20/38). Neither menu currently lists a launch/dispatch action —
  confirms the detail panel is genuinely the only surface with this feature
  today. Any new per-row "Dispatch" menu item must follow this same
  floating-ui composition, not a manually-positioned popup.
- All are driven off the canonical `TrackerRecord` type (not the legacy
  `TrackerItem`) — imports like
  `import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord'`
  (`TrackerBoardCard.tsx:15`) and accessor helpers from
  `@nimbalyst/runtime/plugins/TrackerPlugin/trackerRecordAccessors`
  (`getRecordTitle`, `getRecordStatus`, `getRecordPriority`,
  `getRecordFieldStr`, `getFieldByRole`, `getRecordExternalKey` — all used
  across `TrackerBoardCard.tsx` and `trackerSessionLaunch.ts`). Any new
  dispatch code should read the prompt field the same way — through an
  accessor, not `item.fields.whatever` directly.

## 6. "Open file at line" registry (git log lead) — reusable pattern, but likely NOT needed

`packages/electron/src/renderer/components/TabEditor/editorRevealCommand.ts`
implements a "pending request, replayed once the target subscribes" registry
(doc comment lines 1-16): a reveal-to-line request that arrives before the
target editor tab exists is held with a TTL (`PENDING_REVEAL_TTL_MS =
10_000`, line 28) and replayed when the tab mounts and registers a handler.
This is the reusable shape for "the target of an action isn't ready yet."

It is **not needed for dispatch's auto-send**, because `ai:sendMessage` is a
plain main-process IPC call keyed by `sessionId` — it does not require any
renderer component to be mounted first (unlike a reveal-to-line command,
which genuinely needs a live Monaco/Lexical instance to scroll). The central
`sessionStateListeners.ts` listener (already subscribed at app startup, per
this repo's IPC_LISTENERS.md pattern) picks up the resulting stream/session
metadata regardless of whether Agent mode is currently showing that session.
Dispatch can safely: create session -> `ai:sendMessage` -> (optionally)
navigate to Agent mode — in that order, without a replay registry. Flag this
as a considered-and-rejected pattern in the PRD rather than silently omitting
it, since the git-log lead pointed here.
