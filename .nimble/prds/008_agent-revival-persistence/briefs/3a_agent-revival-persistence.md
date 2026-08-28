# Task Brief: 3a

**Title:** Revive/compose UI for ended teammates
**PRD:** agent-revival-persistence
**Priority:** must
**Complexity:** 3/10
**Model:** sonnet
**Wave:** 4
**Feature Issue:** none yet — no GitHub issue exists for this PRD. This repo never opens GitHub
PRs; land this via local merge only (see Commit Guidelines).

---

## Objective

Widen the `canCompose` gate in the two renderer surfaces that already render `completed`/`errored`
teammates (dimmed, compose box shut) so an eligible ended row opens compose like a live one; add
an explicit "Revive" confirm step for `'user-shutdown'` rows specifically, wired to the confirm
flag 2a's backend gate consumes; correct the inaccurate "no process left to receive a message"
comment both files currently carry.

---

## Context

**Parent Feature:** Agent Revival & Persistence — PRD at
`.nimble/prds/008_agent-revival-persistence/PRD_agent-revival-persistence.md`. Not filed as a
GitHub issue.

**Correction to `tasks.yaml`'s file list, verified live:** the task's stated files
(`TeammateTileRail.tsx`, `TeammatePanel.tsx`) do not match where the compose gate actually lives.
Confirmed live:
- `TeammateTileRail.tsx:110-116` (actually `:112-116` in the current file — see below) has the
  `canCompose` gate and the "no process left" comment (`:113`), consumed at `:223-227` to render
  either the inactive-notice div or the compose textarea.
- `TeammateThreadPopover.tsx:70-74` has the **identical** `canCompose` gate and comment, in the
  hover-popover surface (not `TeammateTileRail`'s inline tile) — this is the file the task's own
  description text ("TeammateTileRail.tsx:110-116; TeammatePanel equivalent") was actually
  pointing at, mislabeled in `tasks.yaml`.
- `TeammatePanel.tsx` (confirmed live) is a **list/status-badge renderer only** — it dims/strikes
  through `completed`/`errored` rows (`:373`, `:387`, `:390`) but has no `canCompose` gate and no
  compose box at all; it is not one of the two files that need the gate widened.

**This task's real file list is `TeammateTileRail.tsx` and `TeammateThreadPopover.tsx`**, both
matched in the prompt that commissioned this brief. If your task-tracking tool still shows
`TeammatePanel.tsx`, treat this brief as the authoritative correction.

This task is part of **Wave 4**, alongside 3b (restart-path test) — disjoint files, can run in
parallel with it. It depends on 2a's backend gate (the eligibility function and confirm-flag
plumbing) already existing before this UI can call into it meaningfully.

---

## Research Context

### Patterns to Follow

- **Both files' `canCompose` gate is character-for-character identical**, confirmed live:
  ```
  const canCompose = !!teammate
    && teammate.status !== 'completed'
    && teammate.status !== 'errored';
  ```
  (`TeammateTileRail.tsx:114-116`, `TeammateThreadPopover.tsx:72-74`), each preceded by the same
  comment: `// Delivery is plausible while the teammate is running/blocked/idle; a\n// completed
  or errored teammate has no process left to receive a message.` — this comment is the thing R4
  explicitly requires correcting; it is inaccurate at the SDK level (a `completed` teammate's SDK
  session file is exactly as resumable as an `idle` one).
- **`sessionTeammatesAtom`** (`TeammateThreadPopover.tsx:65`) is the Jotai atom both files read
  `TeammateInfo` rows from — the same `currentTeammates` array `emitTeammateUpdate` writes, per
  `research/internal/structure.md`'s ownership map. No new atom or storage is needed; `endReason`/
  `endedAt` (from 1a) just need to reach the `TeammateInfo` type these atoms already expose.
- **`handleSend`** in both files (`TeammateTileRail.tsx:131-146`,
  `TeammateThreadPopover.tsx:130-144`, confirmed structurally identical) calls
  `window.electronAPI.aiSendMessageToTeammate(sessionId, agentId, content)` — confirmed live
  preload signature at `packages/electron/src/preload/index.ts:710`:
  `aiSendMessageToTeammate: (sessionId: string, agentId: string, content: string) => ...` — **no
  confirm-flag parameter exists today.** You must widen this preload method, its IPC channel
  (`ai:sendMessageToTeammate`, handled at `AIService.ts:3212-3256`, confirmed live), and both
  `handleSend` call sites to thread a confirm flag through.
- **`useConfirmDialog`** (`packages/electron/src/renderer/hooks/useConfirmDialog.ts`) is this
  codebase's established confirm-dialog hook (`confirm(opts): Promise<boolean>`, `title`,
  `message`, `confirmLabel`, `cancelLabel`, `destructive`) — already used elsewhere in AgentMode
  (`GitOperationsPanel.tsx`'s `MergeConfirmDialog` is a bespoke dialog, but `useConfirmDialog` is
  the lighter-weight, reusable option; prefer it here unless a bespoke dialog is clearly warranted
  by the copy you need).

### Known Issues to Address

- ⚠️ **The IPC call has to widen, not just the UI gate.** `aiSendMessageToTeammate`'s preload
  signature (`:710`) and its handler (`AIService.ts:3212`) currently take exactly
  `(sessionId, agentId, content)`. Adding a confirm flag means: (1) preload method gains a 4th
  param; (2) the IPC handler reads it and threads it into
  `sendMessageToManagedTeammate(agentId, content, sessionId, { cwd, permissionsPath, ... })`
  (confirmed live call site, `AIService.ts:3248-3256`) — the `TeammateResumeContext` object
  built there (`:3252-3255`) is where 2a's brief recommends adding `confirmedUserShutdown`; (3)
  that flows through to `sendMessageFromHost`'s `resumeContext` parameter
  (`TeammateManager.ts:1241-1246`), which 2a's `rehydrateIdleTeammate` eligibility check reads.
  Coordinate with (or re-verify) 2a's actual landed shape before wiring this — the exact field
  name on `TeammateResumeContext` is 2a's call, confirm it did not diverge from its own brief's
  recommendation before you build against it.
- The two files' near-identical `canCompose` logic (and `handleSend`) is duplicated, not shared —
  this task does not need to deduplicate it (out of scope, surgical-change rule), but widen both
  copies identically so they do not drift into inconsistent behavior.
- `TeammateInfo`'s type (`packages/electron/src/renderer/store/atoms/agentMode.ts:364`, per
  `research/internal/structure.md`) needs `endReason`/`endedAt` added to read what 1a persists —
  verify this type still matches 1a's landed `PersistedTeammateRow` shape before building the
  eligibility check in the renderer.

### Recommended Approach

- Renderer-side eligibility mirrors 2a's backend function conceptually (do not re-derive gate
  logic independently and risk drift — keep it simple: `completed`/`errored` + `sessionId` present
  + `endReason !== 'user-shutdown'` → open compose directly; `endReason === 'user-shutdown'` → show
  a "Revive" button that opens `useConfirmDialog`, and only calls `aiSendMessageToTeammate` with
  the confirm flag set to `true` after the user confirms).
- Ordering by `endedAt` (R7) — apply wherever these components currently render teammates in list
  order (check `TeammateTileRail`'s parent/rail-ordering logic and `TeammatePanel.tsx`'s list
  rendering for where sort order is currently determined; `TeammatePanel.tsx` is in scope for this
  one sub-requirement even though it's not in scope for the compose gate).
- Correct the "no process left to receive a message" comment in both files to something accurate,
  e.g.: "A completed/errored teammate's SDK session is still resumable if it has a sessionId and
  an eligible endReason; only a user-shutdown row needs an explicit Revive confirm before compose
  opens." Cite this PRD in the corrected comment.

### Dependencies

**File Dependencies:**
- 1a's `endReason`/`endedAt` fields, surfaced through `TeammateInfo` in
  `packages/electron/src/renderer/store/atoms/agentMode.ts`.
- 2a's backend eligibility gate and the exact confirm-flag field name/shape on
  `TeammateResumeContext` — verify 2a's landed implementation before wiring the IPC call.

**Library Dependencies:** None new — `useConfirmDialog` already exists in this codebase.

---

## Requirements

1. `canCompose` in `TeammateTileRail.tsx` and `TeammateThreadPopover.tsx` admits eligible ended
   rows (per 2a's eligibility contract, mirrored client-side for gating the UI affordance — the
   backend remains the authority; the UI's job is not to offer compose for something the backend
   will refuse).
2. A `'user-shutdown'` row shows an explicit "Revive" action that opens a confirm dialog
   (`useConfirmDialog` or equivalent) before sending; the send call carries the confirm flag.
3. The inaccurate "no process left to receive a message" comment is corrected in both files.
4. Ordering by `endedAt` applied where teammates are listed (R7).
5. The preload method, IPC channel, and `AIService.ts` handler are widened to carry the confirm
   flag end-to-end into `sendMessageToManagedTeammate`'s `TeammateResumeContext`.
6. Existing render/compose behavior for live (`running`/`blocked`/`idle`) teammates is unchanged.

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] An eligible `completed`/`errored` teammate (non-`user-shutdown`) shows a working compose box
      in both `TeammateTileRail.tsx` and `TeammateThreadPopover.tsx`
- [ ] A `user-shutdown` teammate shows a "Revive" confirm action instead of a bare compose box;
      confirming sends with the confirm flag set, canceling does not send
- [ ] Send lands in the widened host-send chain — verified by confirming the IPC call reaches
      `AIService.ts`'s handler with the confirm flag present when set
- [ ] The "no process left" comment is corrected in both files
- [ ] Ended teammates render ordered by `endedAt`
- [ ] Existing live-teammate compose behavior is unchanged (regression check)
- [ ] `npm run typecheck` and `npm run test:prepush` both pass

**All criteria must pass before task is complete.**

---

## Deliverables

None beyond the files above.

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/electron/src/renderer/components/AgentMode/TeammateTileRail.tsx` | modify | Widen `canCompose`; add Revive confirm for `user-shutdown`; correct comment. |
| `packages/electron/src/renderer/components/AgentMode/TeammateThreadPopover.tsx` | modify | Same, mirrored (this file, not `TeammatePanel.tsx`, is the actual second compose surface — see Context correction above). |
| `packages/electron/src/renderer/components/AgentMode/TeammatePanel.tsx` | modify | `endedAt` ordering only (R7) — no compose gate here, it has none. |
| `packages/electron/src/preload/index.ts` | modify | Widen `aiSendMessageToTeammate`'s signature to accept the confirm flag. |
| `packages/electron/src/main/services/ai/AIService.ts` | modify | Widen `ai:sendMessageToTeammate` handler to read and thread the confirm flag into `TeammateResumeContext`. |

### File Ownership Notes

`packages/electron/src/main/**` (covers `AIService.ts`) is `require_review` per
`.nimble/config.yaml` — flag this change explicitly. Disjoint from 3b's test-only file.

---

## Implementation Guidance

### Patterns to Follow

See "Research Context" above.

### Code Style

`@nim-*` CSS variables, `select-text` opt-in for any new text content, ternaries for mutually
exclusive Tailwind states — per `UI_PATTERNS.md` / `.claude/rules/ui-patterns.md`. Add a stable
kebab-case root class to any new element per `REACT_DOM_MARKERS.md` (e.g.
`teammate-tile-revive-confirm`).

### Edge Cases

- A row eligible for silent revival (non-`user-shutdown`) whose backend confirm-flag plumbing was
  never invoked should behave identically to today's live-teammate compose (no confirm dialog
  shown at all) — only `user-shutdown` gets the extra step.
- If 2a's backend still refuses a revival the UI believed eligible (stale client state, race with
  a status change), `handleSend`'s existing `result.success` failure branch
  (`TeammateTileRail.tsx:137-141`, `TeammateThreadPopover.tsx` equivalent) already surfaces
  `sendState: 'failed'` — verify this still fires correctly for a rejected revival, no new failure
  UI needed here (2b covers the deeper no-live-lead notification case).

### Testing Requirements

Extend `packages/electron/src/renderer/components/AgentMode/__tests__/TeammateTileRail.test.tsx`
(confirmed live — it has an existing test at `:153`, `'shows no compose input for a completed
teammate, since it has no process left to receive one'`, whose title and assertion must be updated
to match the new gate, not deleted silently — same "invert openly" spirit as 2a's regression test,
even though this one is not itself the named PRD 003 regression test). Add cases: eligible
completed row shows compose; user-shutdown row shows Revive-then-confirm; ineligible states
unchanged.

---

## Boundaries

### Files You MUST NOT Touch

Per `.nimble/config.yaml`: `node_modules/**`, `dist/**`, `out/**`, `out2/**`, `release/**`,
`.vite/**`.

### Files Requiring Review

`packages/electron/src/main/**` — your `AIService.ts` change falls under this. Flag it.

---

## Dependencies

### Upstream Tasks

| Task | What It Provides | Verify Before Starting |
|------|------------------|------------------------|
| 2a | Backend eligibility gate + confirm-flag field on `TeammateResumeContext` | Read 2a's landed implementation to confirm the exact field name/shape before wiring the IPC call — do not guess at what 2a's brief recommended without checking what was actually built |

### Downstream Impact

None within this PRD's scope — 3a is a leaf UI task. (4a, Task sub-agent respawn, is explicitly
out of scope for this execution and not built.)

**Before starting:** Verify 2a has landed and confirm the exact `TeammateResumeContext` confirm-
flag field name in the current source before wiring the preload/IPC layer.

---

## GitHub Context

**Issue:** none yet
**Feature Issue (Parent):** none yet
**Branch:** `worktree/agent-revival-persistence-3a`
**Target:** Local merge only — this repo never opens a GitHub PR.

---

## Commit Guidelines

Use Conventional Commits:
```
feat(teammates): revive/compose UI for eligible ended teammates
```

---

## Validation Checklist

Before landing (local merge, not a PR):
- [ ] All success criteria met
- [ ] Build passes: `npm run build`
- [ ] Type check passes: `npm run typecheck`
- [ ] Test gate passes: `npm run test:prepush`
- [ ] No `never_touch` files modified
- [ ] Tests added/updated (existing `TeammateTileRail.test.tsx:153` case updated openly, not
      deleted)
- [ ] Branch rebased on target branch
- [ ] `AIService.ts` change flagged for review per `require_review`

---

*Generated by NIMBLE Brief Writer*
*PRD: agent-revival-persistence | Task: 3a | Wave: 4*
