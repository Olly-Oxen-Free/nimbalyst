```yaml
# ============================================================
# PRD METADATA
# ============================================================
---
feature_name: "Agent Visibility and Workflow Enhancement"
feature_slug: "agent-visibility"
owner: "jeppcohen@gmail.com"
status: "draft"
created_date: "2026-08-20"
target_date: ""
phase: ""
scope_type: "gap-closure"
github_project: ""
links: []
checkpoint_refs: []
cross_feature_blockers: []
source_tracker_item: "tsk_mt1xxymgata1sw"
interview_mode: "non-interactive-synthesis"
---
```

---

## Interview Note

This PRD was produced by a non-interactive interview session (no round-by-round human replies).
Research findings (`.nimble/prds/agent-visibility/research/findings.md`) served as the Round 1.5
investigator scan. Every open question that would normally be put to the architect was resolved
with a stated default and recorded in **§12 Assumptions & Defaults (Flagged for Review)**. Read
that section before approving execution — it is not boilerplate, it is where the scope decisions
live.

**HYPOTHESIS:** You want Nimbalyst's in-conversation sub-agents (Teammates and SDK-native Task
sub-agents) to be as visible and controllable as native Claude Code's sub-agents — a chip row,
status coloring including a `blocked` state, click-to-thread, and a guaranteed notification when
one dies or blocks — without taking on a full architectural unification of all three "spawned
agent" systems in this one PRD.
**CONFIDENCE:** ~75% — missing: whether the architect wants Meta-Agent Mode's chip-row/click-to-thread
brought into scope too (research shows it already has both, so this PRD treats it as prior art, not
a gap), and whether cutting the status-vocabulary unification to "two systems share one normalized
mapping, Meta-Agent keeps its own" is acceptable long-term or just an MVP cut.

---

## 1. Executive Summary

**One-liner:** Give the architect real-time visibility into and control over Nimbalyst's
in-conversation sub-agents (Teammates and SDK-native Task sub-agents) — a horizontal status-chip
row above the chat input, a `blocked` status with distinct coloring, click-through to a
teammate's own thread, and a guaranteed main-thread notification whenever a sub-agent dies, ends
unexpectedly, or blocks — closing the gap against native Claude Code behavior identified in
tracker item `tsk_mt1xxymgata1sw`.

**What's changing:** Today, sub-agent status lives in three disconnected places (a vertical
`TeammatePanel` in the right-hand `FilesEditedSidebar`, a left-gutter `AgentSessionsPopover`, and a
separate Meta-Agent Mode dashboard), none of which is a chip row above the chat box, none of which
has a `blocked` status, and a teammate that errors produces the same completion chime as a clean
finish. After this ships: an always-visible chip row above the chat input shows every active
teammate/Task sub-agent, colored by a normalized status that includes `blocked`; clicking a
teammate chip opens/loads its thread for direct messaging; and an errored, crashed, or blocked
sub-agent always produces a distinct main-thread notification.

**Who it's for:** The architect running multi-agent Nimbalyst chat sessions (Teammates,
SDK-native Task sub-agents) who currently has no way to tell, without scrolling the transcript,
that a sub-agent is stuck waiting on a permission prompt or has silently died.

**Why now:** Verified via research against tracker item `tsk_mt1xxymgata1sw` (five asks): none are
fully implemented; two are fully missing (chip row, guaranteed notification); two are partially
implemented with a clear closing gap (`blocked` status, click-to-thread); one already exists but
only inside a separate, opt-in mode (Meta-Agent Mode's open-thread and pending-prompt label).

**Done looks like:** Start a multi-teammate task from the Nimbalyst chat panel. A horizontal chip
row appears above the message input, one chip per active teammate/Task sub-agent, colored by
status. A teammate hits a permission prompt — its chip turns to the `blocked` color and a
notification fires in the main thread asking how to proceed. Clicking that teammate's chip opens
its thread and lets you message it directly. A different teammate crashes mid-run — the main
thread gets a distinct notification instead of the same "all completed" chime a clean finish
produces.

**Amendment note:** This PRD was later extended (2026-08-22) to also cover stall/hang detection
and wake-delivery reliability for Teammates and Task sub-agents (R10-R12), alongside the original
status/chip-row/notification scope.

**Primary risk:** `TeammateManager`'s error/idle paths and `MessageStreamingHandler.onTeammatesAllCompleted`
are tightly coupled to the existing "clean finish" completion-sound behavior
(`TeammateManager.ts:1264-1289`, `MessageStreamingHandler.ts:1109-1136`). Wiring in a
distinct error/blocked notification risks regressing the common case (a normal multi-teammate run
completing cleanly) if the two paths aren't cleanly separated. Second-order risk: three
independent status vocabularies exist (`TeammateInfo.status`, `TaskInfo.status`,
`MetaAgentMode`'s `getStatusTone`/`getBarTone` enum) — the chip row must normalize the first two
without inventing a fourth incompatible enum, and without silently swallowing a future new status
value in an unexhausted mapping.

---

## 2. Problem & Context

**Problem statement:** Nimbalyst has three separate "spawned agent" systems (SDK-native Task
sub-agents, Nimbalyst Teammates, Meta-Agent Mode child sessions), each with its own status
vocabulary and UI surface. None of the five behaviors requested in tracker item
`tsk_mt1xxymgata1sw` — modeled on native Claude Code's sub-agent UX — is fully implemented for the
two systems used inside a normal chat conversation (Teammates, Task sub-agents). A sub-agent can
block on a permission prompt or die outright with no distinct signal in the main thread.

**Supporting data / evidence:** Full verification in `.nimble/prds/agent-visibility/research/findings.md`,
with file:line evidence for all five asks. Summary table reproduced in §9 Open Questions
resolution and in the task `agent_context` fields below.

**What happens if we don't build this:** The architect continues to lose track of blocked or dead
sub-agents mid-session, discovering the problem only by manually scrolling the transcript or
noticing a stalled task — the exact failure mode the tracker item was filed to close.

**Strategic fit:** Direct resolution of an open tracker item; brings Nimbalyst's core multi-agent
chat experience to parity with native Claude Code sub-agent visibility, which the tracker item
calls "native functionality... lacking in nimbalyst."

### Amendment Context (2026-08-22): Stall/Hang Detection and Wake-Delivery Gaps

This amendment (R10-R12, tasks 4a-4c) was triggered by a user-reported recurring failure: "a
spawned agent designed to report back either never reports, or the main session never wakes." The
motivating example was observed concretely in this project's own NIMBLE agent-orchestration
workflow — `/nimble:run`'s `nimble-pm` agent spawning worker agents via the `Agent` tool with no
timeout on the spawn call (see `research/findings.md`, "Additional Research" section). However,
NIMBLE's own worker-liveness gap lives in a separate sibling repo (the `nimble` plugin itself,
`.claude/plugins/nimble/agents/pm.md`) and is explicitly **out of scope** for this PRD/codebase —
it needs to be raised separately in that other project.

---

## 3. Goals, Non-Goals & Success Metrics

### Goals

1. Add a `blocked` status to both `TeammateInfo.status` and `TaskInfo.status`, set when a
   sub-agent's permission/prompt request is pending.
2. Ship a horizontal chip row above the chat input, one chip per active Teammate/Task sub-agent,
   colored by a normalized status (working / waiting / blocked / complete / error).
3. Make a Teammate chip clickable to open/load that teammate's own thread and send it a message
   directly.
4. Guarantee a distinct main-thread notification whenever a Teammate errors, crashes, or blocks —
   not the same completion sound used for a clean finish — and extend the same guarantee to
   Meta-Agent Mode's existing `pendingPrompt` detection.

### Non-Goals

- Unifying Meta-Agent Mode's independent status enum (`getStatusTone`/`getBarTone`,
  `MetaAgentMode.tsx:67-104`) into the same atom family as Teammates/Task sub-agents. Meta-Agent
  Mode keeps its own dashboard and status model in this PRD; see §12 for the scoping decision.
- Un-hiding SDK-native Task sub-agent transcripts or building a persisted thread for them. That
  hiding is deliberate (`claudeCliSubAgentTracker.ts:20-22`, "so they don't pollute the visible
  transcript") and is not reversed here.
- Building a single cross-system "agent registry" merging Teammates, Task sub-agents, and
  Meta-Agent child sessions into one data model or one `ai_sessions`-backed representation.
- Redesigning or removing the existing `TeammatePanel` / `FilesEditedSidebar`. It stays; the chip
  row is additive.
- Bringing Meta-Agent Mode's chip row / click-to-thread into scope — it already has both
  (`MetaAgentMode.tsx:550-559` open-in-agent, `:538-542` pending-prompt label); only its
  notification gap is closed here (Goal 4).
- NIMBLE's own `nimble-pm` worker-liveness gap (the `Agent`-tool spawn call in
  `.claude/plugins/nimble/agents/pm.md` has no timeout/watchdog). This lives in a separate sibling
  repo (the `nimble` plugin), not this codebase, and must be raised as its own item in that
  project — see §2 Amendment Context.

### Success Metrics

| Metric | Baseline | Target | How Measured |
| ------ | -------- | ------ | ------------ |
| Sub-agent statuses exposing `blocked` | 0 of 2 systems (`TeammateInfo`, `TaskInfo`) | 2 of 2 | Type/enum inspection + unit test asserting transition |
| Chip row present above chat input | Does not exist | Renders for every active session with ≥1 teammate/task | Manual verification + component test |
| Errored/crashed teammate produces distinct notification | 0% (same chime as success) | 100% | Unit/integration test on `TeammateManager` error path + `MessageStreamingHandler` |
| Teammate chip click opens thread | Scroll-only today | Opens thread, message reaches teammate | Manual verification + IPC-level test |

---

## 4. Requirements

### Must Have (blocks launch)

| ID | Requirement | Acceptance Criteria |
| -- | ----------- | ------------------- |
| R1 | Add `blocked` status to `TeammateInfo.status` (`packages/electron/src/renderer/components/AgentMode/TeammatePanel.tsx:30`, values today `'running'\|'completed'\|'errored'\|'idle'`), set when the teammate's permission/prompt request is pending via `createCanUseToolHandler` routing in `TeammateManager.ts:1465`. | `blocked` value exists on the type; is set on pending prompt and cleared on resolution; existing values unaffected; unit test covers the transition in both directions. |
| R2 | Add `blocked` status to `TaskInfo.status` (`packages/electron/src/renderer/store/atoms/agentMode.ts:233`, values today `'running'\|'completed'\|'failed'\|'stopped'`), set via the same `canUseTool` routing Task sub-agents already inherit (`ClaudeCodeProvider.ts:3648`, `:3705-3760`). No proven correlation key attributes a blocked prompt to the specific Task sub-agent that triggered it today — `options.toolUseID` in the `canUseTool` callback is the inner tool call's id, not the Task's own `tool_use_id`; before writing attribution logic, confirm whether `parent_tool_use_id` (seen on stream chunks, `ClaudeCodeRawParser.ts:200`) or an equivalent is threadable into the `canUseTool` closure. | `blocked` value exists on the type; is set/cleared correctly; existing values unaffected; unit test covers the transition; when two Task sub-agents are running concurrently and one hits a permission prompt, only that sub-agent's status transitions to `blocked` — the other remains `running`. |
| R3 | New normalized `SubAgentStatus` mapping (derived-atom pattern, not a new raw enum stored on either type) that maps every `TeammateInfo.status` and `TaskInfo.status` value — including `blocked` — to one of: working / waiting / blocked / complete / error. Follows the reusable pattern in `groupSessionStatusAtom` (`sessions.ts:1052`). | Mapping is exhaustive (compiler/test enforced — no silent fallthrough); unit test asserts every current status value maps correctly. |
| R4 | Horizontal chip row rendered directly above the chat message input (not inside `FilesEditedSidebar`), sourced from `sessionTeammatesAtom`/`sessionTasksAtom`, one chip per active Teammate/Task sub-agent, colored per `SubAgentStatus`. | Chips appear/disappear as teammates/tasks spawn and finish; row is horizontal and positioned above the input; uses `--nim-*` theme variables; root has a stable kebab-case class per `REACT_DOM_MARKERS.md`; `@container` query used for responsive chip sizing, not `@media`. |
| R5 | Click a Teammate chip → opens/loads that teammate's own thread and allows sending it a message directly, extending `scrollToTeammateAtom` (`TeammatePanel.tsx:61-63`) into a real open-and-communicate flow using `TeammateManager.appendToInbox`/`flushPendingMessages` (`TeammateManager.ts:957-1011`). | Clicking a teammate chip navigates to/opens its thread (not just scrolls); a message typed and sent reaches the teammate; verified via IPC-level or integration test, not just a UI screenshot. |
| R6 | Click a Task sub-agent chip → shows a read-only status/tool-use popover (`@floating-ui/react`, per `floating-ui.md`), not a thread — Task sub-agent transcripts stay hidden by design. | Clicking a Task chip opens a popover with current status/tool name only; no navigation; no attempt to surface the hidden transcript. |
| R7 | Wire `notificationService.showBlockedNotification` into `TeammateManager`'s error/crash paths (`TeammateManager.ts:1264-1289`) and `MessageStreamingHandler.onTeammatesAllCompleted` (`:1109-1136`) so an errored or crashed teammate produces a distinct main-thread notification, never the same completion sound as a clean finish. | A teammate that errors triggers `showBlockedNotification` (or equivalent distinct signal), not the success chime; a teammate that crashes without an explicit error also notifies; regression test confirms a clean multi-teammate run still plays the unchanged success sound. |
| R10 | **Teammate stream-stall watchdog.** `TeammateManager.spawnTeammate`'s core loop (`packages/runtime/src/ai/server/providers/TeammateManager.ts:1493`, a plain `for await`) has no timeout — a teammate whose process hangs with no error and no chunk produces no signal at all. `lastActiveAt` is tracked per-chunk (`TeammateManager.ts:1524`) but its only read site is a cosmetic "last active Xm ago" label (`TeammatePanel.tsx:324-325`); nothing polls it. Add a watchdog reusing the pattern/helper already used for the lead session's own stall detection (`streamStallWatchdog.ts`, e.g. `raceNextChunkWithStallWatchdog`) so a stalled teammate transitions to `errored` and fires the distinct notification established by R7/task 3a — not left waiting forever. | A teammate whose stream produces no chunk within the timeout window transitions to `errored` and fires `showBlockedNotification` (or equivalent); a healthy teammate producing chunks normally is unaffected; regression test proves both. |
| R11 | **Concurrent Task sub-agent stall masking.** After the lead's own result arrives, `armPromptEndTimer`'s grace timer (`ClaudeCodeProvider.ts:1038-1052`, `SUBAGENT_DRAIN_GRACE_MS` = 5 min) resets on ANY subsequent chunk regardless of which concurrent Task sub-agent produced it (`ClaudeCodeProvider.ts:1197-1200`, `grace-period-reset-on-activity`). The pre-result `shouldArmStreamStallWatchdog` (`streamStallWatchdog.ts:56-66`) is a different, correctly-scoped mechanism and is NOT the bug — the solo-sub-agent case is already covered correctly by the existing 5-minute post-result grace timer, since nothing else resets it when only one sub-agent is running. The real gap: when multiple Task sub-agents drain concurrently post-result, one genuinely stalled sub-agent is masked indefinitely by a healthy sibling's activity resetting the single shared timer. Add per-task-id last-activity tracking (mirroring the `lastActiveAt` pattern already used for Teammates, `TeammateManager.ts:1524`) so a stalled task can be individually detected even while siblings remain healthy. | With two concurrent Task sub-agents, one stalled and one healthy, the stalled one is still detected within a bounded window, not masked by the healthy sibling; a solo sub-agent's existing 5-minute reap behavior is unaffected; the pre-result watchdog's arming condition is not modified; regression test proves both. |
| R12 | **`onTeammateMessageWhileIdle` silent-drop fallback.** `onTeammateMessageWhileIdle` (`packages/electron/src/main/services/ai/MessageStreamingHandler.ts:1054-1106`) is the real mechanism that resumes the main session when a completed teammate's message arrives — but delivery is silently dropped in three cases: `findWindowByWorkspace` (`packages/electron/src/main/window/WindowManager.ts:810`) returns null (workspace's window closed), the found window is destroyed, or `sendMessageHandler` is absent. None of these fire a notification today. Add a fallback: when delivery isn't possible for any of these reasons, fire `showBlockedNotification` (or equivalent) instead of silently dropping the message. | Each of the three drop cases (no window, destroyed window, no handler) fires a notification instead of silent drop; the working case (window exists, not destroyed, handler present) is unchanged; regression test proves all four cases. |

### Should Have (important, not blocking)

| ID | Requirement | Acceptance Criteria |
| -- | ----------- | ------------------- |
| R8 | Extend the R7 notification wiring to Meta-Agent Mode's `pendingPrompt` detection. The implementation anchor is `packages/electron/src/main/services/MetaAgentService.ts`, where `pendingPrompt` is actually produced — `MetaAgentMode.tsx:31-34` is only a renderer view-model type declaration and cannot fire a notification when the dashboard isn't mounted/focused. `MetaAgentMode.tsx:538-542` remains useful as the existing renderer *display* pattern to stay consistent with (for when the dashboard IS focused), not as the fix location. | A Meta-Agent child session entering `pendingPrompt` fires `showBlockedNotification` (or equivalent) even if the Meta-Agent dashboard isn't focused; regression test confirms normal Meta-Agent completion is unaffected. |

### Could Have (nice to have, cut first)

| ID | Requirement | Acceptance Criteria |
| -- | ----------- | ------------------- |
| R9 | Visually distinguish a blocked Task sub-agent chip from a blocked Teammate chip (same color family, different icon/shape) so the architect can tell which system is blocked at a glance. | Both use the `blocked` color from `SubAgentStatus`; icon/shape differs; cut first under time pressure since color alone already communicates the state. |

---

## 5. UX & Interaction Notes

**Visual Assets:** None provided — this is an architect-facing developer-tool surface; no
mockups/wireframes were supplied during the interview. No `assets/` folder was created for this
PRD.

**User Experience:**
- Chip row sits directly above the chat message input, horizontal, one chip per active
  Teammate/Task sub-agent for the current session.
- Chip color follows the normalized `SubAgentStatus`: working (active/spinner), waiting (idle,
  hollow), blocked (distinct color, e.g. amber/red, pulsing or otherwise visually urgent), complete
  (filled/green), error (filled/red or with an error glyph).
- Clicking a Teammate chip opens its thread inline or navigates to it, with a way to type and send
  a message directly to that teammate.
- Clicking a Task sub-agent chip opens a small read-only popover (via `@floating-ui/react`,
  `FloatingPortal`) showing current status and active tool name — no navigation.
- When a chip enters `blocked`, in addition to the color change, a main-thread notification fires
  (reusing the existing `showBlockedNotification` pattern already used for top-level session
  permission/`AskUserQuestion` blocks).

**Visual Design:** Use only canonical `--nim-*` CSS variables (per `UI_PATTERNS.md`); chip sizing
responsive via `@container` queries, not `@media`; ternary Tailwind classes for the mutually
exclusive status-color states.

**Design references:** `SessionStatusIndicator`'s existing coloring pattern
(`sessions.ts:1052` `groupSessionStatusAtom`) is the closest prior art for a derived,
multi-source status→color mapping — reuse the pattern, not the atom itself (that atom is
session-level; this feature is sub-agent-level).

**Key screens & states:**
- Empty state: no chip row rendered when no teammates/tasks are active for the session (not an
  empty placeholder row).
- Loading/working state: spinner or animated chip for `working`.
- Blocked state: distinct color + main-thread notification.
- Error/complete states: distinct terminal colors, chip persists briefly (existing
  `TeammatePanel` terminal-state convention) or per whatever the investigator/brief-writer finds
  as current dismissal behavior — flagged as an open question in §9.

**Accessibility:** Chips need accessible labels (status + agent name) for screen readers; color is
not the only signal — pair with icon/shape (also serves R9).

**Responsive:** Chip row must degrade gracefully (horizontal scroll or wrap) when many
teammates/tasks are active; container-query driven per `UI_PATTERNS.md`.

---

## 6. Dependencies & Risks

### Cross-Feature Blockers

_None identified._ No other in-progress NIMBLE PRD in this codebase overlaps this feature's file
set as of the research pass.

### External Blockers

_None._ This is entirely internal wiring of existing services (`NotificationService`,
`TeammateManager`, `ClaudeCodeProvider`, existing Jotai atoms) — no new external API or library
dependency identified.

### Internal Dependencies

- `sessionTeammatesAtom` / `sessionTasksAtom` (`agentMode.ts:223-253`) — existing data source for
  the chip row; no new atom family required beyond the R3 normalization layer.
- `notificationService.showBlockedNotification` (`NotificationService.ts`) — existing primitive,
  reused rather than rebuilt, for R7/R8.
- `@floating-ui/react` — already a dependency in `packages/electron/package.json`; used for the
  Task sub-agent status popover (R6) and any chip tooltips.

### File Overlaps

| Files | Tasks | Note |
| ----- | ----- | ---- |
| `packages/electron/src/renderer/components/AgentMode/TeammatePanel.tsx` | 1a, 2b, 2c | `TeammateInfo.status` is actually declared here (not in `agentMode.ts`, which only imports the type); 1a adds the `blocked` value here, and 2b/2c both extend this file later. Sequential per the dependency chain (2b depends on 2a which depends on 1a; 2c depends on 2b) — no real conflict. |
| `packages/runtime/src/ai/server/providers/TeammateManager.ts` | 1a, 3a, 4b | 3a depends on 1a; 4b depends on 3a — 4b adds a stall watchdog to the same spawn loop 3a's error-path notification wiring touches; sequential by construction. |
| `packages/runtime/src/ai/server/providers/ClaudeCodeProvider.ts` | 1b, 4a | 4a depends on 1b — 1b touches the canUseTool routing (:3648/:3705-3760), 4a touches the post-result drain-grace timer (:1038-1052/:1197-1200), different sections of the same file; sequential by construction. |
| `packages/electron/src/main/services/NotificationService.ts` | 3a, 3b | 3b depends on 3a; sequential by construction. |
| `packages/electron/src/main/services/ai/MessageStreamingHandler.ts` | 3a, 4c | 4c depends on 3a — 3a wires notification into `onTeammatesAllCompleted`, 4c adds the missing `else` branch/fallback notification to `onTeammateMessageWhileIdle`; sequential by construction. |
| New chip-row component file (path TBD by investigator/brief-writer, e.g. `packages/electron/src/renderer/components/AgentMode/SubAgentChipRow.tsx`) | 2b, 2c, 2d | 2c and 2d both extend the same new component; sequencing is now enforced structurally via `2d depends_on 2c` (2c in wave 4, 2d in wave 5) rather than left as prose-only PM guidance. |

### Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| Notification wiring (R7) regresses the clean-finish completion sound | Medium | High | Task 3a's success criteria explicitly require a regression test proving the unchanged clean-finish path still plays the existing sound; write that test first per `end-to-end-verification.md`. |
| Three status vocabularies produce an unexhausted/incorrect mapping in `SubAgentStatus` | Medium | Medium | R3 requires an exhaustive mapping enforced by a test (or a TypeScript exhaustiveness check via `never`) covering every current value of both source enums. |
| Chip row placement above the chat input collides with existing layout (input toolbar, attachment UI) | Low-Medium | Medium | Task 2b's `agent_context` flags this as the first thing to verify with the investigator scan before implementation; not resolved definitively in this PRD (see §9). |
| Teammate "open thread and message directly" (R5) surfaces an IPC/main-process wiring gap not visible from `TeammateManager.appendToInbox`/`flushPendingMessages` alone | Medium | Medium | Investigator scan recommended before writing task 2c's brief; flagged in §9 as an open question requiring codebase confirmation, not a judgment call for the architect. |

---

## 7. Rollout Plan

**Phase/level:** Single PRD, no phased rollout — this is an additive UI surface plus targeted
bug/gap fixes; no feature flag identified as necessary (chip row only renders when teammates/tasks
are active; no behavior change when the feature is unused).

**Deployment strategy:** Direct merge to `main` via feature branch, following the project's
standard `/nimble:run` feature-branch execution mode (per `.nimble/config.yaml` — no
`review.enabled` provider configured, so review defaults to manual).

**Rollback plan:** Revert the merge PR; no data migration or schema change is introduced (no
tasks touch `packages/electron/src/main/database/*` or migration files), so rollback carries no
data-loss risk.

**Monitoring:** No new PostHog analytics event is specified in this PRD (see §9 open question on
whether chip-row interactions should be tracked); manual verification per task's acceptance
criteria substitutes for monitoring given the small blast radius.

---

## 8. Milestones & Release Criteria

| Milestone | What's True When Done | Target Date |
| --------- | ---------------------- | ----------- |
| M1 — Status foundation | `blocked` exists on both `TeammateInfo.status` and `TaskInfo.status`, and a normalized `SubAgentStatus` mapping exists and is exhaustively tested (R1-R3 / tasks 1a, 1b, 2a) | — |
| M2 — Chip row UI | Chip row renders above the chat input, colored per `SubAgentStatus`, click-to-thread works for Teammates, read-only popover works for Task sub-agents (R4-R6 / tasks 2b, 2c, 2d) | — |
| M3 — Guaranteed notification | Errored/crashed/blocked Teammates and blocked Meta-Agent sessions produce a distinct main-thread notification, clean-finish path unregressed (R7-R8 / tasks 3a, 3b) | — |
| M4 — Ship | CHANGELOG entry added, full diff reviewed at the require-review gate, merged | — |

**Release criteria (what must be true to ship):**

- All Must Have requirements (R1-R7) implemented with a passing unit test per behavioral change.
- `npm run typecheck && npm run test:prepush` green.
- CHANGELOG.md carries one user-facing bullet (task 5a) summarizing the chip row, blocked status,
  and guaranteed-notification behavior — no internal scaffolding named per the project's CHANGELOG
  rules.
- No regression in existing `TeammatePanel`/`AgentSessionsPopover`/Meta-Agent Mode clean-completion
  behavior.

---

## 9. Open Questions

| # | Question | Status | Resolution |
| - | -------- | ------ | ---------- |
| Q1 | Should this PRD cover all three "spawned agent" systems (Task sub-agents, Teammates, Meta-Agent Mode) uniformly, or a narrower scope? | Resolved (assumption) | Scoped to Teammates + SDK-native Task sub-agents for the chip row/click-to-thread/status work; Meta-Agent Mode gets only the notification-guarantee fix (R8), since it already has a working chip-equivalent dashboard and click-to-open-thread. See §12. |
| Q2 | Does unifying all three status enums into one model belong in this PRD? | Resolved (assumption) | No — a new normalized `SubAgentStatus` display mapping is introduced for Teammates + Task sub-agents only; Meta-Agent Mode's independent `getStatusTone`/`getBarTone` enum is left untouched. See §12. |
| Q3 | Exact placement/collision behavior of the chip row against existing chat-input toolbar/attachment UI | Open | Requires an investigator codebase scan before task 2b's brief is finalized — not resolved by this interview. |
| Q4 | Whether `TeammateManager.appendToInbox`/`flushPendingMessages` already expose enough surface for R5's "open thread and message directly," or whether new IPC plumbing is required | Open | Requires an investigator codebase scan before task 2c's brief is finalized — research flagged this as "could support one" but did not confirm a wired UI control exists. |
| Q5 | Should chip-row interactions (click-to-thread, blocked-notification dismissal) get a new PostHog event per `POSTHOG_EVENTS.md`? | Open | Deferred to the architect at PR review time — not blocking for this PRD's Must Have scope. |
| Q6 | Terminal-state chip dismissal behavior (does a `complete`/`error` chip disappear immediately, after a delay, or persist until dismissed?) | Open | Task 2b's `agent_context` directs the investigator/brief-writer to match whatever convention `TeammatePanel.tsx` already uses for completed/errored teammates, rather than inventing a new one. |

---

## 10. Checkpoint Learnings

**First PRD in this project.** No `.nimble/learnings/` entries and no prior PRDs exist yet in
`.nimble/prds/` at the time of this interview — this section will start collecting data after this
feature's first task completes, per the interview protocol's first-PRD flow.

**Patterns to reinforce:** None yet (first PRD).

**Anti-patterns to avoid:** None yet (first PRD).

**Estimate calibration notes:** None yet — this PRD's own task loop counts/model accuracy should
seed the first calibration entry for future PRDs in this project.

---

## 11. Agent Boundaries (Phase-Specific)

**Files the agent should reference for patterns:**

- `packages/electron/src/renderer/store/atoms/sessions.ts:1052` — `groupSessionStatusAtom`, the
  derived-atom status-mapping pattern to reuse for `SubAgentStatus` (task 2a).
- `packages/electron/src/renderer/components/AgentMode/TeammatePanel.tsx` — current sub-agent
  status list UI and its existing spinner/dot status-coloring convention (tasks 2b, 2d).
- `packages/electron/src/renderer/components/MetaAgentMode/MetaAgentMode.tsx:550-559` — proof of
  concept for "open thread in agent" (informs task 2c's approach).
- `packages/electron/src/main/services/MetaAgentService.ts` — where `pendingPrompt` is actually
  produced; this is the implementation anchor for task 3b's notification wiring, not
  `MetaAgentMode.tsx` (a renderer view-model type declaration at `:31-34` cannot fire a
  notification when the dashboard isn't mounted). `MetaAgentMode.tsx:538-542`'s pending-prompt
  label remains useful only as the existing renderer *display* pattern to stay consistent with.
- `packages/electron/src/main/mcp/tools/interactiveToolHandlers.ts:671,1070,1548` and
  `MessageStreamingHandler.ts:899,951,995` — existing call sites of
  `showBlockedNotification`, the primitive to reuse for tasks 3a/3b.

**Files the agent should NOT touch (beyond the global `never_touch` list):**

- `packages/electron/src/renderer/components/MetaAgentMode/MetaAgentMode.tsx` status-mapping logic
  (`getStatusTone`/`getBarTone`, lines 67-104) — do not fold this into `SubAgentStatus`; out of
  scope per §3 Non-Goals.
- `packages/electron/src/main/services/ai/claudeCliSubAgentTracker.ts` transcript-hiding logic —
  do not modify to expose Task sub-agent turns; deliberate design, out of scope.

**Architecture decisions already made (don't re-decide):**

- The chip row is a new, additive UI surface above the chat input — it does not replace or absorb
  `TeammatePanel`/`FilesEditedSidebar`.
- `SubAgentStatus` is a derived/display-only mapping, not a new field persisted on
  `TeammateInfo`/`TaskInfo` beyond the `blocked` addition itself.
- Meta-Agent Mode is explicitly out of scope for the chip row and status unification; only its
  notification gap is closed.

**Known gotchas discovered since the implementation plan:**

- `TeammateManager`'s "all completed" event (`teammates:allCompleted`,
  `TeammateManager.ts:1264-1266`, `:1287-1289`) currently fires identically for a clean finish and
  for a crash where the crashing teammate happened to be the last active one — task 3a must
  separate these paths, not just add a notification alongside the existing one.
- Task sub-agent turns are hidden from the transcript by explicit design comment
  (`claudeCliSubAgentTracker.ts:20-22`) — do not "fix" this as part of R6; the read-only popover is
  the intended ceiling for Task sub-agent visibility in this PRD.

---

## Research Findings

**Last Updated:** 2026-08-20
**Research Status:** Approved (used as Round 1.5 investigator scan substitute)

Full findings: `.nimble/prds/agent-visibility/research/findings.md`. Summary reproduced in §2 and
cited throughout §4/§6/§11 with file:line evidence. No external library research was conducted —
this is an internal verification/gap-closure PRD; no new dependency is introduced.

---

## Agent Tasks

> Tasks are stored in `./tasks.yaml`. Execution plan is in `./execution_plan.yaml`.

**Task Summary:**

| ID | Title | Complexity | Model | Priority | Dependencies |
|----|-------|------------|-------|----------|--------------|
| 1a | Add `blocked` status to `TeammateInfo.status` | 5 | opus | must | - |
| 1b | Add `blocked` status to `TaskInfo.status` | 6 | opus | must | - |
| 2a | Build normalized `SubAgentStatus` mapping | 4 | sonnet | must | 1a, 1b |
| 2b | Build horizontal chip row above chat input | 6 | opus | must | 2a |
| 2c | Wire Teammate chip click-to-open-thread | 6 | opus | must | 2b |
| 2d | Read-only status popover for Task sub-agent chips | 3 | sonnet | should | 2b |
| 3a | Guarantee distinct notification on Teammate error/crash | 6 | opus | must | 1a |
| 3b | Extend guaranteed notification to Meta-Agent Mode | 5 | opus | should | 3a |
| 4a | Fix concurrent Task sub-agent stall masking | 6 | opus | must | 1b |
| 4b | Add Teammate stream-stall watchdog | 6 | opus | must | 3a |
| 4c | Fix onTeammateMessageWhileIdle silent-drop fallback | 3 | sonnet | must | 3a |
| 5a | CHANGELOG entry and final review gate | 1 | sonnet | must | 2c, 2d, 3b, 4a, 4b, 4c |

---

## 12. Assumptions & Defaults (Flagged for Review)

Because this interview ran end-to-end without round-by-round human replies, every decision below
was made by default rather than asked. **Review this section before approving execution.**

1. **Scope: two systems, not three.** The chip row, click-to-thread, and status-mapping work
   (R1-R6, R9) cover Teammates and SDK-native Task sub-agents only — the two systems spawned
   "mid-conversation" that the tracker item's "in claude chat, agents will be created" most
   plausibly describes. Meta-Agent Mode is treated as prior art (it already has a working
   dashboard, click-to-open-thread, and a pending-prompt label) and only gets the
   notification-guarantee fix (R8). *Alternative not taken:* building a uniform chip
   row/click-to-thread for Meta-Agent Mode too, which the research explicitly notes is
   "already closer to what's asked but gated behind switching modes" — could be pulled forward if
   the architect wants full parity rather than gap-closure.

2. **No status-vocabulary unification across all three systems.** A new `SubAgentStatus` display
   mapping normalizes `TeammateInfo.status` and `TaskInfo.status` only. Meta-Agent Mode's
   independent `getStatusTone`/`getBarTone` enum is left untouched. *Alternative not taken:*
   collapsing all three into one persisted status enum, which the research flagged as needed "to
   reconcile three different status enums, not invent a fourth" — this PRD reconciles two of the
   three at the display layer and defers the third.

3. **Click-to-thread for Task sub-agents is a read-only popover, not a real thread.** Because
   Task sub-agent transcripts are intentionally hidden (`claudeCliSubAgentTracker.ts:20-22`), R6
   caps Task sub-agent chip interaction at a status/tool-use popover rather than un-hiding the
   transcript. *Alternative not taken:* reversing the hiding design decision — explicitly rejected
   as out of scope (§3 Non-Goals), since it was a deliberate choice elsewhere in the codebase.

4. **No visual assets / no UX mockup round.** No screenshots or mockups were available in this
   non-interactive session; the UX notes in §5 are text-only. If the architect has visual
   preferences for chip shape/color, they should be added to `.nimble/prds/agent-visibility/assets/`
   before task 2b's brief is finalized.

5. **Orchestration and complexity assessment (Round 2.5/2.6), computed rather than asked:**
   12 tasks, 6 waves, 57 total complexity points, 0 high-risk (7+) tasks — below all three
   points/task/wave slicing thresholds. (Complexity was 41/5 waves at initial planning; task 1b
   was bumped from 5 to 6 to account for the added investigation step required to confirm a
   correlation key for attributing blocked permission prompts to individual Task sub-agents, and
   waves 4-5 were split so task 2d — which now structurally depends on 2c, not just 2b, since both
   extend the same new `SubAgentChipRow.tsx` file — runs after it rather than in parallel.)
   However, task 5a touches `CHANGELOG.md`, which is in
   `require_review` per `.nimble/config.yaml` — this **auto-triggers a gate** regardless of the
   points threshold. Recommendation: **1 gate, after wave 5, before wave 6** (`pause` model, since
   no automated review provider is configured), labeled "Pre-merge review: CHANGELOG entry + full
   chip-row/notification diff." Integration cadence defaulted to `worktree` (no high-risk tasks to
   justify heavier `wave` cadence); review trigger defaulted to `per-task`/`pr-diff` (no configured
   review provider — see `.nimble/config.yaml`, no `review:` block present — so review is manual
   regardless of trigger granularity).
   Estimated PRD token usage: ~625K tokens (60K PM bootstrap + 85K across 3 Sonnet tasks + 480K
   across 6 Opus tasks). Against the `max-5x` subscription plan found configured in this repo's
   `.karimo/config.yaml` (~220K tokens/5hr window — note: `.nimble/config.yaml` for this project
   does not itself declare a subscription plan; this figure is carried over from the sibling
   `.karimo/config.yaml` in the same repo as the best available signal), this PRD is estimated at
   **~284% of one capacity window — it will span multiple 5hr windows.** No model overrides
   applied; complexity-based Sonnet/Opus assignment accepted as-is (6 Opus tasks, none reduced to
   Sonnet, since none of the six is a low-risk mechanical change).

6. **No cross-feature blockers, no external blockers.** No other in-progress PRD in this repo
   overlaps this feature's file set as of the research pass; this is entirely internal wiring of
   already-existing services and atoms. If a second in-flight PRD also touches `TeammateManager.ts`
   or `agentMode.ts`, this assumption should be revisited before execution starts.

7. **Deliverables are code-only for every task except 5a.** Per protocol, each task's
   `deliverables[]` was captured explicitly as "nothing beyond the code" (tests included) rather
   than left blank, except task 5a, whose deliverable *is* the CHANGELOG.md bullet itself.

8. **No PostHog analytics event added.** Chip-row interactions are not instrumented in this PRD
   (Q5 in §9); deferred to the architect's judgment at PR review rather than assumed either way.

9. **Amendment recorded (2026-08-22), human-directed.** R10-R12 and tasks 4a-4c were added by
   explicit human direction, not as a default resolved during a non-interactive interview round —
   unlike items 1-8 above. `total_complexity` changed from 42 to 57 as a result; `task_count`
   changed from 9 to 12. See §2 Amendment Context for the triggering report and the NIMBLE
   worker-liveness non-goal it surfaced.

10. **R11 re-scoped after re-review (2026-08-22).** The first draft of R11/task 4a targeted the
    wrong mechanism — it claimed a lone Task sub-agent running solo had no stall protection and
    proposed changing `shouldArmStreamStallWatchdog`'s arming condition. Re-review against the
    actual code showed the solo case is already handled correctly by the existing 5-minute
    post-result `SUBAGENT_DRAIN_GRACE_MS` grace timer; the real, evidenced gap is that the same
    shared timer resets on ANY concurrent sub-agent's activity, masking one stalled sibling while
    another stays healthy. R11 and task 4a were corrected to target that instead — see R11's text
    above for the corrected mechanism.
```
