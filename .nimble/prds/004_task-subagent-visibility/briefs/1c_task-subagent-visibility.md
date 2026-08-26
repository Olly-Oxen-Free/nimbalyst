# Task Brief: 1c

**Title:** Live-update signal for task transcripts
**PRD:** task-subagent-visibility
**Priority:** must
**Complexity:** 5/10
**Model:** opus
**Wave:** 3
**Feature Issue:** N/A (no GitHub issue tracking configured for this PRD at brief-generation time)

---

## Objective

Give the renderer a live-update signal so an open Task-transcript surface (popover in wave
4, tile in wave 5) knows to refetch when new content lands, instead of polling. Mirrors the
existing `teammate:transcriptUpdated` → `teammate:transcript-updated` chain PRD 002 built,
keyed by `taskId` instead of `agentId`.

---

## Context

**Parent Feature:** Task Sub-Agent Live Transcript Visibility (task-subagent-visibility)

This task is the third and final link in the fully sequential backend chain (1a → 1b → 1c).
Task 1a made Task sub-agent text retrievable and correlated; task 1b built the IPC fetch
path for it. This task closes the loop with a live-signal channel so consumers don't need to
poll: provider emits an event when new content lands → main process forwards it to the
renderer over IPC → a centralized listener bumps a Jotai atom → open UI surfaces watch that
atom and debounce-refetch.

This task is part of **Wave 3** — the last wave of the backend chain, and the wave that
precedes the PRD's gate. **After this task lands, the wave-3 gate applies** (this task's own
files, `MessageStreamingHandler.ts`, are under `packages/electron/src/main/**`, as is
`AIService.ts` from task 1b, matching `.nimble/config.yaml`'s `require_review` boundary) —
enforced explicitly via `.execution_config.json`'s `gates.placements` entry (`after_wave: 3`,
`model: "pause"`), not by an automated reviewer (this repo's `.nimble/config.yaml` has
`review.enabled: false` / no provider configured). It is still a real, human-verify checkpoint
before any of the three UI surfaces (waves 4-5) begin. Do not assume this gate away; it is a
deliberate design choice in this PRD, correcting a gap noted in PRD 002's own retrospective
(its equivalent gate stayed `PENDING` through to merge).

---

## Research Context

### Patterns to Follow — the exact chain to mirror

**Provider-side emit** — wherever task 1a's chosen option produces new content (an
`EventEmitter` event, sibling of teammates' own signal). Read task 1a's landed diff to find
the exact call site(s) that should emit `task:transcriptUpdated` — this depends on whether
1a chose Option A (a new write call site you can hook directly) or Option B (an existing
write call site at `ClaudeCodeProvider.ts:1301-1318` you'll need to gate on, so the event
only fires for chunks that are actually Task-sub-agent-owned, not every persisted chunk).

**Main-process forward**, direct sibling of the teammate equivalent
(`packages/electron/src/main/services/ai/MessageStreamingHandler.ts:1176-1183`, verified
live):

```ts
// Live-update signal: forward each logged teammate chunk to the session's
// window so an open teammate transcript popover can refetch. Fire-and-forget
// -- no ack, no retry; a missed bump just means the next chunk's bump catches
// the popover up.
const onTeammateTranscriptUpdated = (data: { sessionId: string; agentId: string }) => {
  if (!data.sessionId || !data.agentId) return;
  const targetWindow = findWindowByWorkspace(effectiveWorkspacePath);
  if (targetWindow && !targetWindow.isDestroyed()) {
    targetWindow.webContents.send('teammate:transcript-updated', data);
  }
};
this.installListener(provider, 'teammate:transcriptUpdated', onTeammateTranscriptUpdated);
```

Your equivalent: `onTaskTranscriptUpdated`, listening for `task:transcriptUpdated`,
forwarding `webContents.send('task:transcript-updated', { sessionId, taskId })`. Same
`installListener(provider, ...)` registration pattern, same window-resolution logic.

**Renderer-side centralized listener**, direct sibling of
`packages/electron/src/renderer/store/listeners/teammateTranscriptListeners.ts` (verified
live, full file):

```ts
import { store } from '@nimbalyst/runtime/store';
import { teammateTranscriptSignalAtomFamily, teammateTranscriptSignalKey } from '../atoms/agentMode';

export function initTeammateTranscriptListeners(): () => void {
  const cleanups: Array<() => void> = [];

  cleanups.push(
    window.electronAPI.on('teammate:transcript-updated', (data: {
      sessionId: string;
      agentId: string;
    }) => {
      const { sessionId, agentId } = data;
      if (!sessionId || !agentId) return;

      store.set(
        teammateTranscriptSignalAtomFamily(teammateTranscriptSignalKey(sessionId, agentId)),
        (prev) => prev + 1
      );
    })
  );

  return () => {
    cleanups.forEach((cleanup) => cleanup());
  };
}
```

Create `packages/electron/src/renderer/store/listeners/taskTranscriptListeners.ts` as a
direct structural copy, keyed by `taskId` instead of `agentId`, calling
`taskTranscriptSignalAtomFamily(taskTranscriptSignalKey(sessionId, taskId))` (both new,
added by this task to `store/atoms/agentMode.ts`, alongside the existing
`teammateTranscriptSignalAtomFamily` at `agentMode.ts:239-241` and its key-builder at
`agentMode.ts:228-231`).

**Wiring into `AgentMode.tsx`**, verified live at
`packages/electron/src/renderer/components/AgentMode/AgentMode.tsx:58` (import) and
`:264-268` (call site, inside its own `useEffect(..., [])`):

```tsx
// Initialize teammate transcript live-update listener (global, runs once)
useEffect(() => {
  const cleanup = initTeammateTranscriptListeners();
  return cleanup;
}, []);
```

Add an `initTaskTranscriptListeners()` call in the exact same pattern — its own
`useEffect(..., [])` block, not folded into the teammate one, matching this file's existing
convention of one `useEffect` per listener-init call (see the surrounding lines 258-274 for
several more examples of this same one-effect-per-listener pattern).

### Known Issues to Address

None specific to this task's own scope. The gate after this wave exists specifically because
this task (and 1a, 1b before it) touch `packages/electron/src/main/**` files — treat that as
a signal to be conservative and legible in this diff, not a reason to rush past it.

### Recommended Approach

Do not build a generic pub/sub abstraction "for both teammate and task channels" — the PRD
is explicit that this mirrors the teammate chain exactly as a parallel, disjoint channel, not
a refactor that unifies the two. Two independent, structurally-identical channels is the
intended shape, matching this PRD's stated non-goal of "no changes to Agent Teams / teammate
code paths."

### Dependencies

**File Dependencies:** Depends on task 1b's landed IPC/projection shape existing (though
this task's own event chain is independent of the fetch path — it only needs to know when to
tell a consumer to refetch, not fetch anything itself). Also finishes the
preload/`electron.d.ts` surface begun in 1b if any additional typed listener registration is
needed there.

---

## Requirements

Fulfills R4 ("Live-update signal").

- Provider emits an internal `EventEmitter` event, `task:transcriptUpdated`, from the same
  call site(s) task 1a's chosen option produces new content at.
- `MessageStreamingHandler.ts` forwards it to the renderer as
  `webContents.send('task:transcript-updated', { sessionId, taskId })`.
- A new centralized listener, `store/listeners/taskTranscriptListeners.ts`, sibling of
  `teammateTranscriptListeners.ts`, bumps a per-`(sessionId, taskId)` Jotai atom family,
  `taskTranscriptSignalAtomFamily`, added alongside `teammateTranscriptSignalAtomFamily` in
  `store/atoms/agentMode.ts`.
- Wire the new listener's init into `AgentMode.tsx`, the same way
  `initTeammateTranscriptListeners` is already called there (import at line 58, call site at
  line 266, inside a `useEffect(..., [])`) — add an `initTaskTranscriptListeners()` call
  alongside it, not a separate mount point.

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] `task:transcriptUpdated` fires from the correct call site(s), carrying `sessionId` and
      `taskId`, regardless of which option 1a chose
- [ ] `MessageStreamingHandler` forwards it to the renderer as `task:transcript-updated` with
      the same payload shape
- [ ] `taskTranscriptListeners.ts` (new) subscribes once at startup via a call from
      `AgentMode.tsx` (never per-component), bumping
      `taskTranscriptSignalAtomFamily(sessionId, taskId)` — test file
      `taskTranscriptListeners.test.ts` mirrors the existing
      `teammateTranscriptListeners.test.ts` structure (check whether that test file exists;
      if it doesn't, write your own to the same standard `teammateTranscriptListeners.ts`'s
      own doc comments imply)
- [ ] No existing `teammate:transcript-updated` behavior changes

**All criteria must pass before task is complete.**

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/electron/src/main/services/ai/MessageStreamingHandler.ts` | modify | Forward `task:transcriptUpdated` → `task:transcript-updated`, sibling of the existing teammate block at lines 1172-1183 |
| `packages/electron/src/renderer/store/listeners/taskTranscriptListeners.ts` | create | New centralized listener, sibling of `teammateTranscriptListeners.ts` |
| `packages/electron/src/renderer/store/atoms/agentMode.ts` | modify | Add `taskTranscriptSignalAtomFamily` + its key-builder, alongside `teammateTranscriptSignalAtomFamily` (lines 228-241) |
| `packages/electron/src/renderer/components/AgentMode/AgentMode.tsx` | modify | Add `initTaskTranscriptListeners()` call in its own `useEffect`, alongside the existing `initTeammateTranscriptListeners()` block (lines 264-268) |

### File Ownership Notes

`preload/index.ts` and `renderer/electron.d.ts` were touched by task 1b; this task may need
to finish that surface if any additional typed listener registration is needed there (both
tasks touch that file pair; sequenced after 1b per PRD 002's own precedent for the same file
pair — no same-wave conflict since 1c depends_on 1b).

`store/atoms/agentMode.ts` is also touched by task 2c (wave 5, adding `openTaskTilesAtom`) —
disjoint addition, already correctly ordered since 2c depends_on 1c.

`AgentMode.tsx` is also touched by task 2b (wave 4, `setTranscriptToolWidgets` registration
call) — disjoint addition, already correctly ordered since 2b depends_on 1c.

---

## Implementation Guidance

### Patterns to Follow

Copy the three verified code excerpts under Research Context directly — this task is a
structural mirror, not a novel design. The only real design decision left to you is the
provider-side emit call site, which depends on task 1a's landed shape.

### Code Style

Match the doc-comment style of `teammateTranscriptListeners.ts` exactly (see its own header
comment for the expected level of detail: what it subscribes to, what it bumps, what
consumes the atom, and the "never subscribe to IPC directly" cross-reference to
`docs/IPC_LISTENERS.md`).

### Edge Cases

- A `sessionId`/`taskId` pair with no matching window (session not open in any window) — the
  existing teammate forwarder's `findWindowByWorkspace` + `isDestroyed()` guard already
  handles this class of case; mirror it exactly, don't add new handling.
  the fire-and-forget nature is deliberate (see the teammate code's own comment: "no ack, no
  retry; a missed bump just means the next chunk's bump catches the popover up") — do not
  add retry logic that isn't in the teammate original.

### Testing Requirements

Write `taskTranscriptListeners.test.ts` mirroring `teammateTranscriptListeners.test.ts`'s
structure — check first whether that teammate test file exists in the repo; if so, use it as
the literal template for coverage shape (subscribe-once behavior, atom-bump-on-event,
cleanup-on-unmount).

---

## Boundaries

### Files You MUST NOT Touch

- The existing `teammate:transcriptUpdated`/`teammate:transcript-updated` chain and
  `teammateTranscriptListeners.ts` itself — read as template, do not modify.
- Any Agent Teams / teammate code path.

### Files Requiring Review

This task's own files, `MessageStreamingHandler.ts`, plus `AIService.ts` from task 1b, are
both under `packages/electron/src/main/**` — this is precisely what triggers this PRD's
`require_review` gate after wave 3. Expect this task's diff to be reviewed alongside 1a's and
1b's before wave 4 begins. This is also the PRD's explicit "PRD 002 retrospective gap"
fix — PRD 002's own equivalent gate stayed `PENDING` through merge; this PRD is designed so
that does not happen again. Do not treat the gate as a formality.

---

## Dependencies

### Upstream Tasks

| Task | What It Provides | Verify Before Starting |
|------|------------------|------------------------|
| 1b | `ai:getTaskSubagentTranscript` IPC handler + projection, and any preload/electron.d.ts groundwork | Confirm the handler exists and is callable; this task's live-signal channel is independent of it functionally but shares file ownership on preload/electron.d.ts |
| 1a (transitively) | The call site(s) where new Task sub-agent content actually lands | Read 1a's landed diff to find the correct emit point for `task:transcriptUpdated` — this brief cannot specify it exactly since it depends on 1a's Option A/B choice |

### Downstream Impact

Tasks 2a and 2b (wave 4) both depend on this task's live-signal channel to debounce-refetch
an open popover/widget. Task 2c (wave 5) also depends on it for tile content to stay live.

**Before starting:** Verify 1a and 1b are both complete and read their landed diffs — this
task cannot be written correctly from this brief alone without knowing 1a's actual emit call
site.

---

## Deliverables

| Artifact | Path | Done when |
|---|---|---|
| `task:transcript-updated` live-signal channel, end to end | `packages/electron/src/renderer/store/listeners/taskTranscriptListeners.ts` | New listener test file (`taskTranscriptListeners.test.ts`) passes, mirroring `teammateTranscriptListeners.test.ts`'s structure |

---

## GitHub Context

**Issue:** N/A — no GitHub issue configured for this PRD at brief-generation time
**Feature Issue (Parent):** N/A
**Branch:** `worktree/task-subagent-visibility-1c`
**Target:** Determined by PM agent based on execution mode (feature branch or main)

---

## Commit Guidelines

Use Conventional Commits:
```
feat(agent-mode): add task:transcript-updated live-signal channel
```

Types: feat, fix, refactor, test, docs, chore

---

## Validation Checklist

Before considering this task done:
- [ ] All success criteria met
- [ ] Typecheck passes: `npm run typecheck` (repo root)
- [ ] `taskTranscriptListeners.test.ts` passes
- [ ] No `never_touch` files modified — no changes to `teammate:transcriptUpdated`/
      `teammate:transcript-updated` behavior or `teammateTranscriptListeners.ts`
- [ ] Tests added/updated
- [ ] Branch rebased on target branch (feature branch or main)
- [ ] **This task's landing triggers the PRD's wave-3 review gate** — flag this explicitly
      at handoff; do not proceed to wave 4 work without that review completing

---

*Generated by NIMBLE Brief Writer*
*PRD: task-subagent-visibility | Task: 1c | Wave: 3*
