# Cross-task findings — tracker-task-dispatch

## nby-73f.1 (dispatch orchestration + resume)

- The bead's acceptance criteria assumed `resumeSessionId` needed wiring through
  `ClaudeCodeSessionHandlers.ts` and `preload/index.ts` — it was already fully wired end to end.
  Used the existing `sessions:get` IPC call for the single-item `providerSessionId` lookup instead
  of `buildProviderSessionIdMap` (a bulk-scan helper, would have been an N+1 for a single lookup).
  Result: zero `require_review` files touched, better than the PRD anticipated.
- `resumeTrackerSession` does not re-fill the draft input on resume — the resumed conversation
  already carries prior context; re-filling would clobber an in-progress draft. Deliberate.
- For non-claude-cli providers, `resumeTrackerSession` falls back to `launchTrackerSession`
  (creates a **new** session), which doesn't literally match the PRD's "reopen without resume, no
  error" framing for that path. `nby-73f.2` worked around this at the call site (see below) rather
  than changing the shared function, since modifying it was out of `nby-73f.1`'s scope.

## nby-73f.2 (card button)

- Added a sibling module `trackerCardSessionAction.ts` beyond the bead's literal single-file
  scope, matching this directory's existing `trackerXxx.ts` convention (e.g.
  `trackerCardStaleness.ts`), so the pure state-derivation function's unit test doesn't drag in
  `TrackerBoardCard.tsx`'s `@nimbalyst/runtime` barrel import (~2.6s/file per this repo's testing
  rule). Reasonable scope extension, not flagged as an issue.
- Because of the `nby-73f.1` divergence noted above, the card never calls `resumeTrackerSession`
  for non-claude-cli providers — it navigates straight to the existing linked session instead,
  which actually satisfies "reopen without resume, no error, no duplicate" more precisely than
  calling the shared function would have.
- Focus state's icon becomes a spinning `progress_activity` symbol, doubling as the live status
  indicator (R6) rather than a separate element.

## nby-73f.3 (verification)

- No production gap found. `createBidirectionalLink` and `CommitTrackerLinker.linkBySession` share
  the exact same field (`ai_sessions.metadata.linkedTrackerItemIds`) and array shape — the "second
  writer with no precedence rule" concern from the plan-time review doesn't apply; there's only
  one writer of terminal status. Verified with a real integration test over the actual tracker
  schema registry, not a mocked one.

## Cross-cutting: pre-existing test failures, corrected diagnosis

All three tasks independently observed `npm run test:prepush` failing on 3 files (6 tests)
unrelated to their own changes. Initially filed as a suspected code bug (bead `nby-6el`,
promoted to aven `NMB-XW2J`), then corrected after reproducing directly in the main repo tree
(not a worktree):

1. `AgentTranscriptPanel.listenerCleanup` + `MarkdownRenderer.rtl` (6 tests): this machine's
   active `node` is v26.7.0, repo pins v24 (`.nvmrc`). Node 26's built-in global `localStorage`
   shadows jsdom's polyfill. **Local environment issue, not a code defect.**
2. `docsUiStoreBinding.test.tsx`: `packages/collab-bundle/dist/` doesn't exist on this checkout —
   needs `npm run build` in that package first. **Missing local build step, not a code defect.**

Final combined test run (all 3 tasks merged): 1279 passed / 3 failed test files (the same 3,
unchanged) / 10182 tests passed / 6 failed (the same 6, unchanged). No new failures from this PRD.

## Final state

All 3 tasks closed. Epic `nby-73f` left open (per KARIMO-beads convention, `/karimo:merge` closes
it after the feature branch merges to main). Branch `feature/tracker-task-dispatch`, 3 task
commits + the PM's merge commits, ready for `/karimo:merge --prd tracker-task-dispatch`.
