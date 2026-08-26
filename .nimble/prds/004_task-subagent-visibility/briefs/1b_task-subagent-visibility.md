# Task Brief: 1b

**Title:** IPC fetch handler + projection for a task's transcript
**PRD:** task-subagent-visibility
**Priority:** must
**Complexity:** 4/10
**Model:** sonnet
**Wave:** 2
**Feature Issue:** N/A (no GitHub issue tracking configured for this PRD at brief-generation time)

---

## Objective

Give the renderer a way to fetch a Task sub-agent's transcript by IPC — a direct sibling of
the existing `ai:getTeammateTranscript` handler PRD 002 built for teammates, but keyed by
`taskId` OR `toolUseId` (the inline-expand widget in a later task only ever has the latter).

---

## Context

**Parent Feature:** Task Sub-Agent Live Transcript Visibility (task-subagent-visibility)

This task is the second link in a fully sequential backend chain (1a → 1b → 1c). Task 1a
resolved (or verified) how Task sub-agent text becomes durably retrievable and correctly
correlated to `activeTasks[*].toolUseId`. This task wires that up to an actual IPC surface
the renderer can call, projecting raw rows into the same `TranscriptViewMessage[]` shape
every other transcript surface in the app already consumes.

This task is part of **Wave 2** — depends entirely on task 1a's landed output. **Read task
1a's actual diff and commit message before writing any code here** — this brief cannot tell
you in advance whether 1a chose Option A (a new tagged write with `_isTaskSubagentOutput`,
`_taskId`, `_taskToolUseId` metadata keys) or Option B (projecting already-persisted raw
chunks with `parent_tool_use_id` intact, no new tags). Your projection function's shape
depends entirely on that choice. Do not assume Option A's shape without checking.

---

## Research Context

### Patterns to Follow — the exact sibling to build against

**IPC handler**, direct sibling of `ai:getTeammateTranscript`
(`packages/electron/src/main/services/ai/AIService.ts:3303-3328`, verified live):

```ts
safeHandle('ai:getTeammateTranscript', async (
  _event,
  sessionId: string,
  agentId: string,
  workspacePath: string,
): Promise<TranscriptViewMessage[]> => {
  if (!sessionId) throw new Error('sessionId is required');
  if (!agentId) throw new Error('agentId is required');
  if (!workspacePath) throw new Error('workspacePath is required');

  const session = await AISessionsRepository.get(sessionId);
  if (!session) return [];

  // Same ownership rule as SessionManager.loadSession: a worktree session
  // is reachable from either its parent workspace or its worktree.
  const ownsSession = session.workspacePath === workspacePath
    || (!!session.worktreePath && session.worktreePath === workspacePath);
  if (session.workspacePath && !ownsSession) {
    throw new Error(
      `Session ${sessionId} belongs to ${session.workspacePath}, not ${workspacePath}`,
    );
  }

  const rawMessages = await createRawMessageStoreAdapter().getMessages(sessionId);
  return projectTeammateRawMessages(rawMessages, agentId);
});
```

Your `ai:getTaskSubagentTranscript` handler follows this exact shape: same `safeHandle`
registration pattern, same session/workspace ownership validation, same
`createRawMessageStoreAdapter().getMessages(sessionId)` read (all raw rows for the lead
session — Task chunks are interleaved into it the same way teammate chunks are). The
difference is the lookup key: accept `{ taskId?: string; toolUseId?: string }` instead of a
bare `agentId` string, and require at least one of the two to be present.

**Projection function**, direct sibling of `projectTeammateRawMessages`
(`packages/runtime/src/ai/server/transcript/projectRawMessages.ts:132-152`, verified live):

```ts
export async function projectTeammateRawMessages(
  leadRawMessages: RawMessage[],
  agentId: string,
): Promise<TranscriptViewMessage[]> {
  const teammateMessages = leadRawMessages.filter((msg) => {
    if (typeof msg.content !== 'string' || !msg.content.includes('_teammateAgentId')) {
      return false;
    }
    try {
      return JSON.parse(msg.content)._teammateAgentId === agentId;
    } catch {
      return false;
    }
  });

  return projectRawMessagesToViewMessages(teammateMessages, 'claude-code', {
    teammateProjection: true,
  });
}
```

Your `projectTaskSubagentRawMessages(rawMessages, { taskId?, toolUseId? })`'s exact
matching/parsing logic depends on which option 1a resolved to:
- **If Option A**: a cheap string pre-filter (`msg.content.includes('_isTaskSubagentOutput')`
  or similar) + exact-id match against whichever of `_taskId`/`_taskToolUseId` was supplied,
  structurally identical to `projectTeammateRawMessages` above.
- **If Option B**: match `parent_tool_use_id` directly in the generic raw chunk shape (no
  pre-existing tag to pre-filter on cheaply — you may need a different cheap-reject
  strategy, e.g. checking for `"parent_tool_use_id"` substring presence before parsing),
  then adapt/reuse `projectRawMessagesToViewMessages`. Coordinate directly with however 1a
  actually landed; this brief cannot specify the exact filter shape for Option B in advance.
  Raw chunks only ever carry `parent_tool_use_id` (a `toolUseId`), never a bare `taskId` — so
  when the caller supplies `taskId` instead of `toolUseId`, resolve it first by reading
  `session.metadata.currentTasks` (the same array `activeTasks` persists into, per 1a) and
  finding the entry whose `taskId` matches, then use *its* `toolUseId` for the raw-chunk
  match. `TaskInfo.toolUseId` is typed optional there — handle the case where it's absent by
  returning an empty array rather than throwing.

**Preload + electron.d.ts sibling** (verified live):
- `packages/electron/src/preload/index.ts:713`:
  `ipcRenderer.invoke('ai:getTeammateTranscript', sessionId, agentId, workspacePath)`
- Type declaration lives in `packages/electron/src/renderer/electron.d.ts` (not under
  `preload/` — verify the exact declaration name/shape by grepping
  `aiGetTeammateTranscript` in that file before writing the new one).

### Known Issues to Address

None specific to this task beyond the Option A/B coordination above.

### Recommended Approach

Do not reinvent the projection pipeline. `projectRawMessagesToViewMessages` (imported and
called by `projectTeammateRawMessages`) is the shared, tested pipeline every transcript
surface in this app uses — reuse it, do not build a parallel one, even if Option B's raw
shape requires a different pre-filter step to reach it.

### Dependencies

**File Dependencies:** This task's projection function's exact shape is determined entirely
by task 1a's landed commit (Option A vs Option B). Read 1a's diff and commit message before
writing code.

---

## Requirements

Fulfills R3 ("Fetch IPC for a task's transcript, keyable by taskId or toolUseId").

- New IPC handler `ai:getTaskSubagentTranscript(sessionId, { taskId?, toolUseId? },
  workspacePath)`, sibling of `ai:getTeammateTranscript`, same `safeHandle` registration,
  same session/workspace ownership validation.
- Must accept EITHER `taskId` or `toolUseId` as the lookup key — a later task's
  inline-expand widget only ever has the `toolUseId` (from the spawning message's own
  `tool_use` id), not the `taskId`, so a `toolUseId`-only lookup path is required, not
  optional.
- New `projectTaskSubagentRawMessages(rawMessages, { taskId?, toolUseId? })` in
  `packages/runtime/src/ai/server/transcript/projectRawMessages.ts`, matching whatever
  shape task 1a's chosen option produced.

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] `ai:getTaskSubagentTranscript` returns the correct projected `TranscriptViewMessage[]`
      given EITHER a `taskId` or a `toolUseId` for the same task
- [ ] Unknown/absent `taskId` or `toolUseId` returns an empty array, not an error
- [ ] Session/workspace ownership validation matches `ai:getTeammateTranscript`'s existing
      behavior (rejects a mismatched `workspacePath` the same way)
- [ ] `projectTaskSubagentRawMessages` is covered in the same test file that covers
      `projectTeammateRawMessages` (`projectRawMessages.test.ts`) if its shape allows
      reusing that pipeline, or a clearly-named sibling test file if 1a's Option B required
      a materially different parsing path — either way, name the file in the commit, don't
      leave it implicit

**All criteria must pass before task is complete.**

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/electron/src/main/services/ai/AIService.ts` | modify | Register `ai:getTaskSubagentTranscript` `safeHandle` handler, sibling of the existing `ai:getTeammateTranscript` block at line 3303-3328 |
| `packages/runtime/src/ai/server/transcript/projectRawMessages.ts` | modify | Add `projectTaskSubagentRawMessages`, sibling of `projectTeammateRawMessages` at line 132-152 |
| `packages/electron/src/preload/index.ts` | modify | Expose the new IPC channel via `ipcRenderer.invoke`, sibling of the `aiGetTeammateTranscript` entry at line 713 |
| `packages/electron/src/renderer/electron.d.ts` | modify | Add the typed `electronAPI` surface for the new call, matching the teammate equivalent's signature shape |

### File Ownership Notes

`preload/index.ts` and `renderer/electron.d.ts` are also touched by task 1c (wave 3), which
depends on this task — sequenced correctly by the `depends_on` edge, not a same-wave
conflict. Do not assume 1c's needs in advance; land whatever this task requires and let 1c
extend it.

---

## Implementation Guidance

### Patterns to Follow

See the full verified code excerpts under Research Context above — copy their structure
directly, adapting only the lookup-key shape (dual `taskId`/`toolUseId` instead of a bare
`agentId`) and the tag/filter logic per whichever option 1a chose.

### Code Style

Match `AIService.ts`'s existing `safeHandle` registration style (see
`docs/IPC_GUIDE.md` for the general pattern) and `projectRawMessages.ts`'s existing
doc-comment style (explain the raw-row shape being filtered, per the teammate example's own
comment block).

### Edge Cases

- Both `taskId` and `toolUseId` absent: throw the same "required" style error the teammate
  handler uses for its own required params, OR treat as an invalid call — pick whichever is
  more consistent with `safeHandle`'s existing error-handling conventions in this file, and
  be consistent between the two lookup keys (i.e. don't silently succeed with an empty
  array here, that's reserved for "not found", not "not asked for anything").
- Unknown `taskId`/`toolUseId` (task not found, or race before its raw rows exist): return
  `[]`, not an error — per the explicit success criterion above.
- A `workspacePath` mismatch: reject with the same error shape as
  `ai:getTeammateTranscript`.

### Testing Requirements

Cover both lookup paths (`taskId`-keyed and `toolUseId`-keyed) resolving to the same
transcript for the same underlying task. Cover the empty-array-on-unknown-key case
explicitly — this is a named success criterion, not an incidental behavior.

---

## Boundaries

### Files You MUST NOT Touch

- `ai:getTeammateTranscript` and `projectTeammateRawMessages` themselves — read them as a
  template, do not modify their behavior. No changes to any Agent Teams / teammate code
  path.
- Root `CLAUDE.md`'s database rules apply: never directly open or query database files
  outside the existing `createRawMessageStoreAdapter()` abstraction; respect the
  PGLite/SQLite dual-backend constraint (raw `content` sub-extraction may return a parsed
  object on PGLite but a JSON string on SQLite — the teammate projection function already
  handles this correctly via `typeof msg.content !== 'string'` guarding before
  `.includes()`; follow the same defensive pattern).

### Files Requiring Review

`packages/electron/src/main/services/ai/AIService.ts` is under
`packages/electron/src/main/**` — this triggers `require_review` automatically per the PRD's
execution plan (gate after wave 3). Your change lands before that gate closes, so expect
human review of this file's diff alongside 1a's and 1c's before wave 4 (UI) begins.

---

## Dependencies

### Upstream Tasks

| Task | What It Provides | Verify Before Starting |
|------|------------------|------------------------|
| 1a | Task sub-agent text retrievable and correctly correlated (Option A or B), landed in `ClaudeCodeProvider.ts` | Read 1a's actual commit diff and commit message to determine which option was chosen and the exact retrievable shape, before writing this task's projection function |

### Downstream Impact

Tasks 1c, 2a, 2b, and 2c all depend on this task's IPC handler existing and working
correctly (1c mirrors its live-signal channel to complement it; 2a and 2b both call
`ai:getTaskSubagentTranscript` directly).

**Before starting:** Verify task 1a is complete by reading its commit and confirming the
retrievable data shape (tagged metadata under Option A, or generic raw-chunk shape under
Option B) before writing `projectTaskSubagentRawMessages`.

---

## Deliverables

| Artifact | Path | Done when |
|---|---|---|
| `ai:getTaskSubagentTranscript` IPC handler, keyable by `taskId` or `toolUseId` | `packages/electron/src/main/services/ai/AIService.ts` | Handler registered via `safeHandle`, returns correct projection for both lookup keys, covered by tests |
| Preload/electron.d.ts surface for the new IPC channel | `packages/electron/src/preload/index.ts` and `packages/electron/src/renderer/electron.d.ts` | `electronAPI` exposes the new call, typed, matching the teammate equivalent's signature shape |

---

## GitHub Context

**Issue:** N/A — no GitHub issue configured for this PRD at brief-generation time
**Feature Issue (Parent):** N/A
**Branch:** `worktree/task-subagent-visibility-1b`
**Target:** Determined by PM agent based on execution mode (feature branch or main)

---

## Commit Guidelines

Use Conventional Commits:
```
feat(agent-mode): add ai:getTaskSubagentTranscript IPC handler and projection
```

Types: feat, fix, refactor, test, docs, chore

---

## Validation Checklist

Before considering this task done:
- [ ] All success criteria met
- [ ] Typecheck passes: `npm run typecheck` (repo root)
- [ ] Relevant unit tests pass (`projectRawMessages.test.ts` or its clearly-named sibling)
- [ ] No `ai:getTeammateTranscript`/`projectTeammateRawMessages` behavior modified
- [ ] Tests added/updated for both lookup-key paths and the empty-array-on-unknown case
- [ ] Branch rebased on target branch (feature branch or main)

---

*Generated by NIMBLE Brief Writer*
*PRD: task-subagent-visibility | Task: 1b | Wave: 2*
