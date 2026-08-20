```yaml
# ============================================================
# PRD METADATA
# This block is parsed by the orchestrator for project setup.
# ============================================================
---
feature_name: "Tracker Task Dispatch"
feature_slug: "tracker-task-dispatch"
owner: "jeppcohen@gmail.com"
status: "ready"
created_date: "2026-08-20"
target_date: ""
phase: ""
scope_type: "new-feature"
github_project: ""
links: ["https://github.com/elirantutia/vibeyard"]
checkpoint_refs: []
cross_feature_blockers: []
---
```

---

## 1. Executive Summary

**One-liner:** A run/resume/focus button on a tracker kanban card dispatches the item's
synthesized prompt into an AI agent session, reusing the existing detail-panel launch flow and
the existing status-update mechanisms — no new completion-detection machinery.

**What's changing:** Today, dispatching a tracker item into an AI session requires opening the
item's detail panel and clicking "Launch Session" (`TrackerItemDetail.tsx:1614-1633`), which
creates a session, links it to the item, and pre-fills — but does not send — a synthesized prompt.
After this ships, the same action is available directly from the kanban card via a run/resume/focus
button, and — for the claude-cli provider — resuming a past session reopens the same conversation
instead of starting fresh. The tracker item still reaches its terminal status the way it already
does today: the dispatched prompt's existing trailing instruction has the agent self-report via
`tracker_update` (landing at `in-review`, per this repo's commit-is-approval rule), and
`CommitTrackerLinker.ts` auto-closes to the type's terminal status when the agent's commit lands.

**Who it's for:** The user, dispatching their own tracker items straight into an agent session
without the extra click into the detail panel.

**Why now:** Ported from vibeyard, a similar AI-agent-workspace app, where this is a core kanban
board feature. Most of the underlying plumbing (session creation, tracker↔session linking, prompt
synthesis, terminal-status resolution) already exists in nimbalyst — this closes the remaining
surface-area gap (no button outside the detail panel) and a resume gap (no resume-by-session for
card-level re-dispatch).

**Done looks like:** Open the tracker kanban board. A card shows a run/resume/focus button. Click
it — a new (or resumed, for claude-cli) AI session opens with the item's synthesized prompt
pre-filled in the input box. Review and hit send. The card shows a live status indicator while the
session is processing. The item moves through its normal status lifecycle exactly as a
detail-panel-dispatched item already does today — via the agent's own `tracker_update` call and,
on commit, `CommitTrackerLinker`.

**Primary risk:** The existing self-report (`tracker_update` instruction) and commit-triggered
close (`CommitTrackerLinker`) mechanisms were only ever exercised via the detail-panel launch path.
Card dispatch is a new call site for the same underlying link — if it produces the bidirectional
link in a subtly different shape, `CommitTrackerLinker` may silently fail to recognize
card-dispatched sessions, and the "done looks like" scenario wouldn't hold even though nothing
crashes.

---

## 2. Problem & Context

**Problem statement:** Dispatching a tracker item into an agent session requires navigating into
the item's detail panel first. There's no fast path from the board view, and re-engaging a
previously dispatched item's session means hunting for it manually rather than a single click.

**Supporting data / evidence:** Reference implementation researched in
`.karimo/prds/001_tracker-task-dispatch/research/external/findings.md` (vibeyard's kanban dispatch
feature). Existing nimbalyst plumbing mapped in
`.karimo/prds/001_tracker-task-dispatch/research/internal/findings.md` and
`.karimo/prds/001_tracker-task-dispatch/research/internal/errors.md`.

**What happens if we don't build this:** No change — current detail-panel launch flow keeps
working; this is additive.

**Strategic fit:** Closes a workflow gap between nimbalyst's tracker and its AI session system,
both of which already exist and are already linked at the data layer (`createBidirectionalLink`).

---

## 3. Goals, Non-Goals & Success Metrics

### Goals

1. Add a run/resume/focus button to the tracker kanban card that dispatches the item's synthesized
   prompt into a new or resumed AI session.
2. For the claude-cli provider, resuming a card whose linked session has a known
   `providerSessionId` reopens that session instead of creating a new one.
3. Confirm the item's existing path to Done (self-report + `CommitTrackerLinker`) actually covers
   sessions created via the new card-dispatch call site — build nothing new here unless
   verification finds a real gap.
4. Reuse existing prompt synthesis, session creation, and tracker↔session linking — no new prompt
   field, no new session-creation IPC path.

### Non-Goals

- Auto-send is explicitly out of scope — dispatch pre-fills the input box exactly as the existing
  detail-panel flow does; the user still clicks send.
- List-view and table-view dispatch buttons are out of scope for this PRD (kanban card only).
- Team visibility of dispatch/session state is out of scope — session links stay local-only per
  existing `shouldPersistTrackerLinkedSessions()` design; only the resulting status change syncs.
  **User-visible consequence:** on a team-shared tracker item, only the dispatching user can
  resume or focus the resulting session — teammates see the eventual status change but not the
  session itself. This is existing behavior, not new, but the dispatch button makes it more
  visible.
- **No new completion-detection listener.** `SessionMeta.phase` reaching `'complete'` is not an
  automatic signal (nothing sets it without an explicit `update_session_meta` call), and a
  phase-based auto-close would create a second writer of the tracker item's status field alongside
  `CommitTrackerLinker`, with no precedence rule, and would bypass this repo's
  commit-is-approval policy (CLAUDE.md: *"Never mark work done before the user approves it — a
  commit IS their approval"*). This PRD relies entirely on the two existing mechanisms instead.
- Resume is scoped to the claude-cli provider only. Other providers (e.g. Codex,
  `TrackerMainView.tsx:528-534`) always dispatch fresh in this PRD — no resume attempted, no error.

### Success Metrics

| Metric | Baseline | Target | How Measured |
| ------ | -------- | ------ | ------------ |
| Clicks to dispatch from board | 3+ (open item → find button → click) | 1 (click card button) | Manual walkthrough |
| Card-dispatched sessions correctly reach their tracker item's terminal status on commit | Unverified (only ever exercised via detail panel) | Verified equal to detail-panel behavior | Integration test in `nby-73f.3` |

---

## 4. Requirements

### Must Have (blocks launch)

| ID | Requirement | Acceptance Criteria |
| -- | ----------- | -------------------- |
| R1 | Kanban card renders a run/resume/focus button, states defined in nimbalyst's own terms (not vibeyard's `sessionId`/`cliSessionId` model — nimbalyst sessions are persisted DB rows, not torn down the same way): **run** (no linked session), **resume** (linked session exists, not currently processing), **focus** (linked session exists, currently processing) | Button icon/tooltip/aria-label matches state; clicking transitions correctly in all three cases |
| R2 | Run state: clicking creates a session via the existing `sessions:create` + `tracker:link-session` + `ai:saveDraftInput` flow (same as `TrackerMainView.tsx:520-601`), reusing `trackerSessionLaunch.ts`'s prompt synthesis **including its existing `tracker_update` trailing instruction** unmodified | No new session-creation code path; existing detail-panel Launch Session behavior is unchanged for every provider |
| R3 | Resume state, claude-cli provider only: clicking resumes the session identified by the linked session's `providerSessionId` (via `buildProviderSessionIdMap` / `resumeSessionId`); other providers reopen the existing session record without resume | Resuming a claude-cli card's session reopens that same conversation, not a new one; non-claude-cli providers never error, never attempt resume |
| R4 | Focus state: clicking a card with a currently-processing linked session focuses that session in the UI | No duplicate session created |
| R5 | Verify (do not rebuild) that a card-dispatched session's tracker item reaches Done the same way a detail-panel-dispatched one already does: agent self-report via `tracker_update` (→ `in-review`), then `CommitTrackerLinker`'s existing commit-triggered close (→ type's terminal status) | Integration test: card-dispatched session + commit referencing the item → item auto-closes to its type's terminal status via the existing `CommitTrackerLinker` path; uncommitted session → item stays at whatever the self-report set, never auto-closed |

### Should Have (important, not blocking)

| ID | Requirement | Acceptance Criteria |
| -- | ----------- | -------------------- |
| R6 | Live status indicator on the card while a linked session is currently processing | Visual only — no test required per this repo's no-presentation-tests rule |

### Could Have (nice to have, cut first)

| ID | Requirement | Acceptance Criteria |
| -- | ----------- | -------------------- |
| R7 | Extend the same run/resume/focus button to list-view and table-view rows | Deferred — flagged as future work, not built this PRD |

---

## 5. UX & Interaction Notes

**User Experience:** Card gains a single icon button (mirrors the detail panel's existing Launch
Session affordance, relocated/duplicated to card level). State-dependent icon: play (run), resume
arrow (resume), focus/jump (focus) — exact iconography follows this repo's existing icon set, no
new icon library.

**Visual Design:** Match existing `TrackerBoardCard.tsx` action-button conventions (favorite star,
chips) for sizing/placement. Any menu/tooltip uses `@floating-ui/react` per this repo's mandatory
rule (`.claude/rules/floating-ui.md`).

**Key screens & states:**

- Default (run): no session yet.
- Resumable: linked session exists, not currently processing. On claude-cli, resumes the same
  conversation; on other providers, reopens the session record fresh (no resume).
- Live (focus): linked session currently processing, status indicator visible.
- On a team-shared item: only the dispatching user sees resume/focus state for their session —
  teammates see only the eventual status field change.

**Accessibility:** Button gets an accessible label reflecting current state (`Run`, `Resume`, or
`Focus session`), not a bare icon with no `aria-label`.

**Responsive:** No new breakpoints — button fits within the existing card layout at all supported
widths.

---

## 6. Dependencies & Risks

### Cross-Feature Blockers

_None._

### External Blockers

_None._

### Internal Dependencies

- `packages/electron/src/renderer/components/TrackerMode/trackerSessionLaunch.ts` (prompt synthesis + `tracker_update` trailing instruction, line 60, reused as-is)
- `packages/electron/src/renderer/components/TrackerMode/TrackerMainView.tsx:520-601` (create/link/draft-fill orchestration, reused as-is)
- `packages/electron/src/main/mcp/tools/trackerToolHandlers.ts:153` (`createBidirectionalLink`)
- `packages/electron/src/main/services/ai/AIService.ts:2497` (`ai:saveDraftInput`)
- `packages/electron/src/main/services/ai/ClaudeCliSessionLauncher.ts:186-200` (resume-by-CLI-ID primitive)
- `packages/electron/src/main/ipc/ClaudeCodeSessionHandlers.ts:23-47` (`buildProviderSessionIdMap`)
- `packages/electron/src/preload/index.ts:2136` (`claude-cli:ensure-session` channel — the only channel exposing `resumeSessionId`)
- `packages/electron/src/renderer/store/atoms/sessionKanban.ts:26` (`SessionMeta.phase`, referenced for the status indicator only, not for completion detection)
- `packages/electron/src/renderer/store/atoms/sessions.ts` (`SessionMeta` type)
- `packages/electron/src/main/services/CommitTrackerLinker.ts:364-414` (existing commit-triggered terminal-status close, via `getWorkflowStatusFieldName` — reused unmodified, including its guards against reopening already-terminal/cancelled items and against types with no done-category status)
- `packages/runtime/src/plugins/TrackerPlugin/models/trackerStatusCategory.ts` (`getWorkflowStatusFieldName`)
- `packages/electron/src/renderer/components/TrackerMode/TrackerBoardCard.tsx` (card component to extend)

### Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| Card-dispatched sessions produce the bidirectional link in a shape `CommitTrackerLinker` doesn't recognize, silently breaking the "reaches Done" scenario | Medium | High | `R5`/`nby-73f.3` is an explicit integration test comparing card-dispatch and detail-panel-dispatch outcomes, not an assumption |
| Resume-by-session for claude-cli diverges from any existing resume UX elsewhere in the app | Low | Medium | `nby-73f.1`'s acceptance requires a smoke test of existing detail-panel behavior post-refactor |
| `nby-73f.1` and `nby-73f.2` touch shared files (`preload/index.ts`, IPC handlers) while a third task runs concurrently | Low (mitigated) | Medium | `nby-73f.3` was redesigned to be verification-only — it touches no main-process or preload files, so the only shared-file risk is within the `nby-73f.1 → nby-73f.2` chain, which is already sequenced (blocks edge), not parallel |

---

## 7. Rollout Plan

**Phase/level:** Single PRD, no slicing (see Complexity Assessment).

**Deployment strategy:** Direct merge via KARIMO worktree/PR-per-task flow (Fast Track: local
commits, no GitHub PRs — see `.karimo/config.yaml` `mode: fast-track`).

**Rollback plan:** Revert `nby-73f.1`'s and `nby-73f.2`'s commits independently (each is a separate
bead/commit per KARIMO-beads convention) — the existing detail-panel flow is untouched and keeps
working regardless. `nby-73f.3` makes no code changes to revert (verification-only) unless it finds
and fixes a real gap, in which case that fix reverts independently too.

**Monitoring:** None — no telemetry/analytics work in scope per Non-Goals.

---

## 8. Milestones & Release Criteria

| Milestone | What's True When Done | Target Date |
| --------- | ---------------------- | ----------- |
| Card button ships | R1-R4 pass, existing detail-panel flow unaffected | — |
| Done-path verified | R5 passes with integration test coverage, or a real gap is filed as a finding rather than silently patched | — |

**Release criteria:**

- All Must Have requirements (R1-R5) implemented/verified and tested per
  `npm run typecheck && npm run test:prepush`
- No change to existing detail-panel Launch Session behavior
- No new code added under `packages/electron/src/main/**` unless `nby-73f.3`'s verification finds
  an actual gap requiring it (in which case: stop, report, do not build silently — that path is
  `require_review`)

---

## 9. Open Questions

_None open — Q1 (resume-by-session precedent) resolved during Round 3; the reviewer pass's
findings (B1-B5, S1-S2, W1-W8) were resolved by redesigning R5/R1/R3 and correcting file-path
citations, reflected directly in the requirements above and in each bead's updated fields._

---

## 10. Checkpoint Learnings

**Patterns to reinforce:** N/A — first PRD in this repo under the beads-integrated KARIMO fork.

**Anti-patterns to avoid:** Porting a reference implementation's data model (vibeyard's
`sessionId`/`cliSessionId` split) verbatim instead of translating it into the target codebase's own
session-persistence model — caught by the reviewer pass on this PRD, not by the interview.

**Estimate calibration notes:** N/A — no prior PRD history in this repo yet.

---

## 11. Agent Boundaries (Phase-Specific)

**Files the agent should reference for patterns:**

- `packages/electron/src/renderer/components/TrackerMode/trackerSessionLaunch.ts`
- `packages/electron/src/renderer/components/TrackerMode/TrackerMainView.tsx`
- `packages/electron/src/renderer/components/TrackerMode/TrackerBoardCard.tsx`
- `packages/electron/src/main/services/CommitTrackerLinker.ts`
- `packages/runtime/src/plugins/TrackerPlugin/models/trackerStatusCategory.ts`

**Files the agent should NOT touch (beyond the global `never_touch` list):**

- `packages/electron/src/main/**`, `packages/electron/src/database/**`,
  `packages/runtime/src/auth/jwtScopes.ts` are `require_review` per `.karimo/config.yaml`.
  `nby-73f.1` legitimately touches `packages/electron/src/main/ipc/ClaudeCodeSessionHandlers.ts`
  (flagged, expected). `nby-73f.3` should NOT need to touch anything under
  `packages/electron/src/main/**` — if verification finds it must, stop and report rather than
  building it.

**Architecture decisions already made (don't re-decide):**

- Reuse existing prompt synthesis and session-creation flow — no new IPC handler, no new prompt
  field.
- Draft-fill only, not auto-send.
- Session-link state stays local-only (no CollabV3 sync changes).
- Kanban card only in this PRD (list/table deferred).
- Resume scoped to claude-cli provider only; other providers always dispatch fresh.
- **No new completion-detection listener.** Reuse the existing `tracker_update` self-report +
  `CommitTrackerLinker` commit-triggered close. Do not build a `SessionMeta.phase`-watching
  listener — this was the original R5 design and was explicitly rejected during review (violates
  the commit-is-approval rule, creates a second status writer with no precedence rule).
- `nby-73f.1 → nby-73f.2` is a sequenced (blocked-by) pair sharing files; `nby-73f.3` is
  independent and touches no shared files with either — no additional shared-file ownership
  decision needed.

**Known gotchas discovered since research:**

- `shouldPersistTrackerLinkedSessions()` actively strips `linkedSessions` from any tracker-item
  write once `syncStatus` is `'pending'` or `'synced'` — do not accidentally widen this exclusion
  while touching adjacent code.
- `resumeSessionId` is exposed on exactly one preload channel (`claude-cli:ensure-session`,
  `preload/index.ts:2136`) — do not assume it's available for every provider.
- `CommitTrackerLinker.ts` already guards against reopening already-terminal/cancelled items and
  against types with no done-category status — `nby-73f.3` must not weaken these guards, and must
  not add a second status writer alongside it.

---

## Research Findings

**Last Updated:** 2026-08-20
**Research Status:** Approved
**Research Rounds:** 0 (one reviewer pass corrected several citations and one requirement's design
— see Checkpoint Learnings)

### Implementation Context

**Existing Patterns (Internal Research):**

- **Launch Session flow:** Creates session, links to tracker item, pre-fills draft input.
  - **Location:** `packages/electron/src/renderer/components/TrackerMode/TrackerMainView.tsx:520-601`
  - **Usage:** Reused as-is for R2's run state.
  - **Relevance:** `nby-73f.1`, `nby-73f.2`.
- **Prompt synthesis + self-report instruction:** Builds prompt from title/type/status/priority/description, appends an instruction telling the agent to call `tracker_update` when done.
  - **Location:** `packages/electron/src/renderer/components/TrackerMode/trackerSessionLaunch.ts:37-69` (synthesis), line 60 (self-report instruction)
  - **Usage:** Reused as-is — no new prompt field, instruction must survive the extraction in `nby-73f.1`.
  - **Relevance:** `nby-73f.1`, indirectly `nby-73f.3`.
- **Per-type terminal status resolution + commit-triggered close:** Every tracker type declares its own "done" status field; `CommitTrackerLinker` already closes items to it on commit.
  - **Location:** `packages/electron/src/main/services/CommitTrackerLinker.ts:364-414` (`getWorkflowStatusFieldName`, existing guards)
  - **Usage:** Reused unmodified — `nby-73f.3` verifies it covers the new card-dispatch call site, does not rebuild it.
  - **Relevance:** `nby-73f.3`.
- **Resume primitives (generic, not yet wired to tracker):** `resumeSessionId` param, `buildProviderSessionIdMap`, `providerSessionId` field.
  - **Location:** `ClaudeCliSessionLauncher.ts:186-200`, `ClaudeCodeSessionHandlers.ts:23-47`, `preload/index.ts:2136`
  - **Usage:** Wired into the tracker launch path for the first time in `nby-73f.1`, claude-cli only.
  - **Relevance:** `nby-73f.1`, `nby-73f.2`.

**Best Practices (External Research — vibeyard):**

- **Decoupled completion signal:** vibeyard's auto-move lives in a session-status listener separate
  from the dispatch click handler.
  - **Source:** `research/external/findings.md` (vibeyard `board-session-sync.ts`)
  - **Recommendation considered and rejected:** nimbalyst already has an equivalent
    decoupled-from-dispatch mechanism (`CommitTrackerLinker`, triggered by commit rather than
    process/phase completion) — building a second, redundant listener was rejected during review.
  - **Relevance:** `nby-73f.3`.
- **Behavior-tagged terminal state, not hardcoded:** vibeyard resolves "the Done column" by a
  semantic tag on the column.
  - **Source:** `research/external/findings.md`
  - **Recommendation:** nimbalyst's `getWorkflowStatusFieldName` is the existing equivalent —
    already reused by `CommitTrackerLinker`, nothing new needed.
  - **Relevance:** `nby-73f.3`.

**Recommended Libraries:** None — no new dependencies.

**Critical Issues Identified:**

- ⚠️ **vibeyard's two-ID session model doesn't map onto nimbalyst as-is.** nimbalyst sessions are
  persisted DB rows, not torn-down/resumed the vibeyard way.
  - **Impact:** R1/R3's original draft used `cliSessionId`, a field that doesn't exist in this
    codebase — caught by reviewer finding B1, corrected to nimbalyst-native terms (see R1, R3).
  - **Affected Tasks:** `nby-73f.1`, `nby-73f.2`.
  - **Recommended Fix:** Applied — requirements and bead text now use "linked session,
    processing/not-processing" instead of `sessionId`/`cliSessionId`.
  - **Priority:** Resolved.
- ⚠️ **A phase-based auto-close would duplicate `CommitTrackerLinker` and bypass the
  commit-is-approval rule.**
  - **Impact:** Original R5 design (net-new listener on `SessionMeta.phase → 'complete'`) would
    have created a second, unordered writer of the tracker item's status field, and would have
    written a terminal status with no human commit in the loop — contradicting CLAUDE.md's
    explicit policy.
  - **Affected Tasks:** `nby-73f.3` (redesigned).
  - **Recommended Fix:** Applied — `nby-73f.3` is now verification-only; no new listener.
  - **Priority:** Resolved.

**Architectural Decisions:**

- **Decision:** Reuse `description` as the dispatch prompt source rather than adding a dedicated
  `prompt` field.
  - **Context:** vibeyard uses a dedicated field; nimbalyst's existing Launch Session flow already
    synthesizes from `description` and other fields.
  - **Choice:** Reuse existing synthesis — no schema change.
  - **Rationale:** Avoids a schema migration and a second source of truth for "what gets sent";
    user confirmed during Round 1.
  - **Affected Tasks:** All.
- **Decision:** Draft-fill only, not auto-send.
  - **Context:** vibeyard auto-sends; nimbalyst's existing flow pre-fills only.
  - **Choice:** Keep pre-fill-only behavior.
  - **Rationale:** User confirmed during Round 1 — matches existing detail-panel semantics.
  - **Affected Tasks:** `nby-73f.1`, `nby-73f.2`.
- **Decision:** No new completion-detection listener; rely entirely on existing self-report +
  commit-triggered close.
  - **Context:** Original R5 design was rejected by the reviewer pass (policy conflict + duplicate
    writer). See Critical Issues above.
  - **Choice:** Verification-only `nby-73f.3`.
  - **Rationale:** User confirmed this option explicitly when presented with the three redesign
    choices.
  - **Affected Tasks:** `nby-73f.3`.

### Research Artifacts

Full research details available in:
- Internal patterns: `.karimo/prds/001_tracker-task-dispatch/research/internal/`
- External research: `.karimo/prds/001_tracker-task-dispatch/research/external/`

---

## Task graph

This fork stores tasks as **beads**, not `tasks.yaml` (see `BEADS_AVEN.md` in the KARIMO plugin).
Epic bead: `nby-73f`. `bd graph check nby-73f` passed (no cycles) both before and after the
post-review redesign of `nby-73f.3`. Briefs live in each bead's `--description` / `--design` /
`--acceptance` fields — `bd show <id> --json` is self-contained.

**Task Summary:**

| Bead ID | Title | Complexity | Model | Priority | Depends On |
|---------|-------|------------|-------|----------|------------|
| `nby-73f.1` | Extract reusable tracker-session dispatch orchestration + wire resume (claude-cli) | 6 | Opus | must | — |
| `nby-73f.2` | Add run/resume/focus button + status indicator to TrackerBoardCard | 4 | Sonnet | must | `nby-73f.1` |
| `nby-73f.3` | Verify existing done-status mechanisms cover card-dispatched sessions | 2 | Sonnet | must | — |

Total complexity: 12 points (revised down from 16 after `nby-73f.3`'s redesign from a net-new
listener to a verification task). Sonnet: 2, Opus: 1. No slicing needed, no checkpoints.

```
📊 Dependency graph for nby-73f:

  Status: ○ open  ◐ in_progress  ● blocked  ✓ closed

  Layer 0 (ready)
  ┌────────────────────────────────────┐
  │ ○ PRD: Tracker Task Dispatch       │
  │ nby-73f                            │
  └────────────────────────────────────┘
  ┌────────────────────────────────────┐
  │ ○ Extract reusable tracker-sessio… │
  │ nby-73f.1                          │
  │ blocks:1                           │
  └────────────────────────────────────┘
  ┌────────────────────────────────────┐
  │ ○ Verify existing done-status mec… │
  │ nby-73f.3                          │
  └────────────────────────────────────┘
      │
      ▼

  Layer 1
  ┌────────────────────────────────────┐
  │ ○ Add run/resume/focus button + s… │
  │ nby-73f.2                          │
  │ needs:1                            │
  └────────────────────────────────────┘

  Dependencies: 1 blocking relationships
  Total: 4 issues across 2 layers
```

_(This corrects an inverted edge from the initial `bd create --deps "blocks:X"` call, caught by
the follow-up reviewer pass: that flag means "the new bead blocks X", not "X blocks the new bead"
— the opposite of the migration doc's illustrative comment. Fixed via `bd dep remove` +
`bd dep add --blocked-by`; `nby-73f.1` now correctly blocks `nby-73f.2`.)_

**Note for `/karimo:run`:** the epic bead (`nby-73f`) itself appears in the "ready" set alongside
its children in `bd ready`/`bd graph` output — the PM loop must filter epics (type=epic) out of
what it claims, not just filter by blocked status.

No checkpoint beads inserted — below every gate trigger threshold (3 tasks, 12 points, 0
high-risk, and `nby-73f.3` — the only task that could plausibly touch a `require_review` path —
is scoped to touch none, escalating instead of building silently if it finds it must).
`nby-73f.1` and `nby-73f.3` are both ready immediately; `nby-73f.2` releases once `nby-73f.1`
closes.

---

*Generated by KARIMO (beads fork) interview system, orchestrated directly by Claude Code per user
request. Reviewed by the karimo-reviewer agent (`nby-73f` graph + PRD validation pass); B1-B5,
S1-S2, W1-W3, W6, W8 resolved above. W4 noted as a `/karimo:run` execution-time caveat. W5, W7
were non-issues on inspection (W5: R4's mapping to `nby-73f.2` is explicit in the bead text; W7:
the fenced ```yaml frontmatter matches `PRD_TEMPLATE.md` exactly, not a deviation).*
