# Research Summary — Tracker Task Dispatch

## What we're building

A one-click "dispatch" action on a nimbalyst tracker item that immediately spawns an AI agent
session using the item's text as the opening prompt — the feature vibeyard ships on its kanban
board (README: "each card can spawn or resume a CLI session in one click, and tasks auto-move to
Done when their session completes").

## Key discoveries

- **This is an extension, not a new build.** nimbalyst already has 90% of the plumbing: a "Launch
  Session" button in the tracker item **detail panel** that creates a session, links it
  bidirectionally to the tracker item, and pre-fills (but does not send) a synthesized prompt.
  (`TrackerItemDetail.tsx:1614-1633`, `TrackerMainView.tsx:520-601`, `trackerSessionLaunch.ts:37-69`)
- **Auto-send is one IPC call away.** `ai:sendMessage` (`AIService.ts:2136`) exists and is
  main-process-only (no mounted-UI dependency) — the missing piece is simply calling it after
  `ai:saveDraftInput` (or instead of it).
- **The dispatch action doesn't exist outside the detail panel.** Kanban card, list row, table
  row, and their context menus all lack it — that's the actual surface-area gap.
- **No "prompt" field exists** — `TrackerRecord.fields` is a generic schema-tolerant bag,
  `description` is the closest analog and what Launch Session already uses. Decision needed:
  reuse `description` or add a dedicated `prompt` field (vibeyard's model).
- **No completion→auto-move hook exists.** `SessionMeta.phase` (`atoms/sessionKanban.ts:26`) is
  the closest analog to vibeyard's session-status signal, but only changes via manual kanban drag
  or an MCP tool call — never automatically on session completion. This must be built new, wired
  to `getWorkflowStatusFieldName` (`trackerStatusCategory.ts`) so it respects each tracker type's
  own terminal status rather than a hardcoded value.
- **Dispatch state is local-only by explicit existing design.** `shouldPersistTrackerLinkedSessions()`
  (`packages/electron/src/shared/trackerSessionLinks.ts`) strips session links from anything synced
  to a team room — a dispatched session and its resume/focus state are per-device, not
  team-visible. Only the resulting tracker-item field change (e.g. a status flip) syncs normally.

## Open decisions for the PRD interview

1. Reuse `description` as the dispatch prompt, or add a dedicated `prompt` field?
2. Auto-send by default, or keep draft-fill-only as an option (matches vibeyard's always-auto-send,
   diverges from nimbalyst's current draft-only behavior)?
3. Which surfaces get the dispatch button in v1 — kanban card only (closest vibeyard parity), or
   also list/table rows and their context menus?
4. Resume/focus semantics: match vibeyard's three-state button (run/resume/focus) or keep it
   simpler (dispatch always creates a new session)?
5. Confirm local-only session-link scope is acceptable for v1, or does team visibility of
   "who dispatched, what session is running" need to be in scope (bigger change — would require
   reworking `shouldPersistTrackerLinkedSessions()`'s exclusion, a CollabV3-sensitive area).

## Files

- `research/external/findings.md` — vibeyard reference implementation (data model, dispatch
  mechanism, auto-move-to-done, resume-by-cliSessionId)
- `research/internal/findings.md` — nimbalyst codebase mapping (existing Launch Session flow, IPC
  handlers, session status tracking, UI surfaces, CollabV3 sync exclusion)
- `research/internal/{patterns,dependencies,structure,errors}.md` — evidence trail
