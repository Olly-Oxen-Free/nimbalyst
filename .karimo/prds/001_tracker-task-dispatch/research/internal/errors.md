# Internal Research — Gaps, Issues, Inconsistencies

1. **No auto-send today.** The existing "Launch Session" flow
   (`TrackerMainView.tsx:520-567`) prefills the draft input
   (`ai:saveDraftInput`) but never calls `ai:sendMessage`. If "dispatch"
   means what the PRD says ("immediately spawns... using the item's text as
   the starting prompt"), this is new behavior, not a rename of existing
   behavior. Decide explicitly whether dispatch replaces or coexists with
   the current "Launch Session" (prefill-only) affordance — they read as the
   same feature to a user but behave differently, which is confusing if both
   ship.

2. **No dedicated prompt field.** `description` currently doubles as the
   dispatch source. If the PRD wants a distinct `prompt` field (closer to
   vibeyard's model, and arguably better since a task's human-readable
   description and its agent-facing instructions are different audiences),
   that's a net-new additive schema field, not present anywhere in the
   codebase today (confirmed via `NON_FIELD_KEYS`/`SYSTEM_KEYS` in
   `TrackerRecord.ts` — no `prompt` key listed, and no hit for a `prompt`
   field on any tracker type schema search this pass).

3. **No "session completed" signal maps to "task done."** `sessionProcessingAtom`
   going false fires on every idle turn, not task completion.
   `metadata.phase === 'complete'` is closer semantically but is presently
   set by the agent/user, not by any automatic process-exit or
   turn-completion detector — building "auto-move to Done" on this signal
   means the feature is only as reliable as agents remembering to call
   `update_session_meta`. This is worth surfacing as a design question
   rather than assuming the wiring is trivial: does dispatch *require* the
   agent's dispatched prompt to end with an instruction to set phase to
   `complete` (mirroring the existing `buildTrackerLaunchContext`'s trailing
   instruction to call `tracker_update`), or does it need a different
   detection mechanism (e.g., watching for the underlying CLI/provider
   process exit for `claude-code`/CLI-shelling providers specifically)?

4. **`sessionId` vs `cliSessionId`-equivalent resume semantics don't exist
   yet in this codebase in the vibeyard sense.** vibeyard's spec
   distinguishes `sessionId` (live) from `cliSessionId` (post-teardown
   resume identity). Nimbalyst's sessions are persisted rows
   (`ai_sessions` table) that don't "tear down" the same way — a session
   exists in the DB whether or not a live provider instance is currently
   attached to it (`ProviderFactory.createProvider(provider, session.id)` is
   re-creatable on demand). This is actually a simpler model than
   vibeyard's, but it means the "run / resume / focus" three-state
   affordance described in the task needs to be redefined in Nimbalyst's
   terms: something closer to "no linked session yet" -> "linked session,
   not currently processing" (resume = reopen + optionally re-send) ->
   "linked session, currently processing" (focus = just navigate). Don't
   port vibeyard's two-ID model as-is; it doesn't match this codebase's
   session persistence model.

5. **Team-tracker session visibility gap** (see dependencies.md CollabV3
   section) — `linkedSessions` never syncs for team items by design
   (`shouldPersistTrackerLinkedSessions`). A one-click dispatch on a
   team-shared tracker item will silently produce a session only the
   dispatching user can see or resume. This is consistent with existing
   behavior (not a new bug dispatch introduces) but is worth calling out
   explicitly in the PRD since the feature's core value proposition
   (resume/focus affordances) partially evaporates on team trackers for
   everyone except the original dispatcher.

6. **IPC/positional-arg inconsistency.** `sessionManager.createSession(...)`
   has at least three different call shapes across `SessionHandlers.ts`
   (`session:create`), `AIService.ts` (`ai:createSession`), and worktree
   creation. Extending this method's signature (e.g. to add an initial
   prompt parameter) risks silently breaking a caller that relies on
   positional order rather than being forced to; recommend introducing any
   new dispatch-specific parameter as an options object on whichever IPC
   handler is chosen, not as a new positional arg on the shared method.

7. **No existing per-card/list/table launch UI** — confirmed absence, not
   just "not found via grep": the prop lists of `TrackerBoardCard.tsx`,
   `TrackerGridView.tsx`, and the `TrackerRowContextMenu.tsx`/
   `KanbanContextSubmenu.tsx` menu-item sets contain no
   launch/dispatch/run action. This is real net-new UI work across three
   view surfaces (board, list, table) plus their context menus, not just a
   wiring change, if the PRD wants dispatch available outside the detail
   panel (which the feature description's "one-click... on a kanban card"
   framing implies).
