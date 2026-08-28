# PRD Template (v2)

```yaml
---
feature_name: "Agent Card Identity"
feature_slug: "agent-card-identity"
owner: "jeppcohen@gmail.com"
status: "ready"
created_date: "2026-08-28"
target_date: ""
phase: ""
scope_type: "bugfix"
github_project: ""
links: [".nimble/prds/004_task-subagent-visibility", ".nimble/prds/005_agent-teams-cold-start-bootstrap", ".nimble/prds/006_teammate-idle-handoff"]
checkpoint_refs: []
cross_feature_blockers: []
---
```

---

## 1. Executive Summary

**One-liner:** Spawn cards in the transcript render fully expanded by default (dumping a
sub-agent's whole result inline, unclicked) and every spawned agent's turns are headed by a
generic "Claude Agent" label. This PRD makes every spawn card a collapsed 1-2 row summary with a
consistent anatomy across Task sub-agents and teammates, and heads spawned-agent transcripts with
the agent's real name and model ("weatherman [haiku]").

**What's changing:** Two live-observed, confirmed pre-existing defects:
(A1) `RichTranscriptView.tsx:1626-1642` — an "auto-expand sub-agent tools" `useEffect` from
commit `769a3ede5` (2026-04-02, ten months before PRD 004) adds every subagent message's
`subagentId` to `expandedTools` on every message change. `subagentId` equals the card's own
expand key (`toolUseId` == `providerToolCallId`, `ClaudeCodeRawParser.ts:524/597`), so every
spawn card mounts expanded and re-expands if collapsed mid-turn. With PRD 004's `TaskToolWidget`,
that means the full inner transcript (observed: a git-log result table) renders inline with no
click. The effect is deleted; both card kinds become collapsed-by-default, expand-on-click. The
two card headers are also unified into one shared anatomy (icon, name/type, description, model,
live status, chevron) — today `TaskToolWidget`'s header lacks icon, model, status, and chevron
that the teammate/generic card has.
(A2) `RichTranscriptView.tsx:2298-2300` heads every assistant turn with
`getProviderDisplayName(provider)` — a single per-view prop — so embedded sub-agent/teammate
transcripts (thread popovers, tile rails, inline widget) all say "Claude Agent". New optional
`agentName`/`agentModel` props override that header; the five embedded mounts pass the identity
they already hold locally.

**Who it's for:** Anyone using Agent Mode with teammates or Task sub-agents — the surfaces built
by PRDs 002/004/005/006.

**Done looks like:** Spawning a Task sub-agent or teammate shows a single collapsed summary row
(same row anatomy for both kinds); clicking expands, clicking again collapses and it stays
collapsed. Opening weatherman's thread shows its turns headed "weatherman [haiku]", and a Task
sub-agent's thread shows its agent type (plus model where available) instead of "Claude Agent".

**Primary risk:** A1 is a behavior removal in the hottest transcript component; the risk is a
hidden consumer relying on auto-expansion (none found — no test or code path reads the effect's
output besides the card render, `research/internal/errors.md`). All edits are renderer-only, no
IPC/main/sync surface. React hooks discipline is the sharpest edge (see Constraints): the
`3fa68d3c0` incident this week came from exactly this file family.

---

## 2. Problem & Context

**Problem statement:** Live screenshots (2026-08-28 session): a Task sub-agent spawned to run
`git log -1` rendered its full result as an uncollapsed markdown table directly in the transcript
— not the 1-2 row `Sub-Agent [...]` summary PRD 004 specified — while a teammate's spawn card
rendered with a different structure (icon/status/model present, different expansion content). A
teammate named "weatherman" running haiku showed generic "Claude Agent" turn headers in its
thread view.

**Root causes (verified, `research/internal/findings.md`):**
- A1: auto-expand effect at `RichTranscriptView.tsx:1626-1642`; id-chain
  `subagentId == toolUseId == providerToolCallId` confirmed via `ClaudeCodeRawParser.ts:524/597`
  and the card's key lookup at `:1752-1754`. Predates PRDs 004/005/006 (blame `769a3ede5`);
  PRD 004's widget made the long-standing bug loud by giving expansion real content.
- A1 anatomy divergence: generic card header (`RichTranscriptView.tsx:1839-1973`) = icon + name
  (+mode/[type]) + model·effort audit label + live status + chevron; `TaskToolWidget` header
  (`TaskToolWidget.tsx:116-133`) = "Sub-Agent" + [agentType] + description only.
- A2: single `provider` prop drives every assistant header (`:2298-2300`); no per-view identity
  override exists. Main transcript is unaffected (teammate turns render as compact notifications,
  `:2163-2204`); only the five embedded mounts are wrong.

**Identity data already flows — this is a rendering-location gap, not a missing-data gap:**

| Mount | Name source | Model source |
|---|---|---|
| `TeammateThreadPopover.tsx:204` | `teammate?.name ?? teammateName` | `teammate?.model` |
| `TeammateTileRail.tsx:213` | `teammate?.name ?? agentId` | `teammate?.model` |
| `TaskToolWidget.tsx:142` | `agentType` | `message.subagent?.model` |
| `TaskThreadPopover.tsx:125` | existing `label` prop threaded into `TaskThreadBody` (reviewer C1/M2: never `taskType` — it is the SDK task kind, e.g. `local_agent`) | none (`TaskInfo` has no model field — not added) |
| `TaskTileRail.tsx:168` | `TaskInfo.description` (`?? 'Sub-Agent'`), never `taskType` | none (same) |

**What happens if we don't build this:** Every Task spawn dumps its whole result into the lead
transcript, defeating PRD 004's collapsed-summary design; users cannot tell which agent said what
in multi-agent sessions.

**Explicitly out of scope:** Reviving ended agents (separate PRD `agent-revival-persistence`,
investigation only); any main-process/IPC change; adding `model` to `TaskInfo`; the main
transcript's compact teammate notifications (already correct); mobile/iOS transcript surfaces.

---

## 3. Goals, Non-Goals & Success Metrics

### Goals

1. Every spawn card (Task sub-agent, background agent, teammate) renders collapsed by default —
   a 1-2 row summary — and only expands on click; a collapse sticks.
2. Both card kinds share one header anatomy: icon, name (+type/mode), description, model (and
   effort where present), live status, chevron. Content differs by kind; structure does not.
3. Assistant turn headers in embedded agent transcripts show the agent's real name and model
   ("weatherman [haiku]"; "explore" with no model when none is known) instead of
   "Claude Agent".

### Non-Goals

- No change to what expansion *shows* (TaskToolWidget's inner transcript, generic card's
  description/prompt/result sections stay as-is).
- No new data plumbing from main: every value rendered already reaches the renderer.
- No `TaskInfo.model` field (decided in research; the transcript message's `subagent.model`
  carries it where it exists).
- No persistence of expand state across restarts (session-local `useState`, unchanged).
- No icon redesign; `ProviderIcon` in the turn-header avatar stays (surgical change — the label
  is what the user called out).

### Success Metrics

| Metric | Baseline | Target | How Measured |
| ------ | -------- | ------ | ------------ |
| Spawn cards expanded without a click | Always (all kinds) | Never | Unit test: subagent message renders with widget/card in collapsed state; collapse-after-expand persists across a messages-array change |
| Header anatomy parity | 2 disjoint anatomies | 1 shared anatomy | Unit test on the shared status/audit pieces; visual parity itself is screen-obvious (no presentation test) |
| Generic "Claude Agent" headers in embedded agent transcripts | Always | Never when identity is known | Unit test: `agentName`/`agentModel` props reach the turn header; call-site pass-through covered per mount |

---

## 4. Requirements

### Must Have (blocks launch)

| ID | Requirement | Acceptance Criteria |
| -- | ----------- | -------------------- |
| R1 | Collapsed by default | The auto-expand effect (`RichTranscriptView.tsx:1626-1642`) is deleted. `expandedTools` starts empty and is mutated only by `toggleToolExpand`. A card collapsed by the user stays collapsed when `messages` changes. Applies to Task sub-agents AND teammates — intended for both, not collateral. |
| R2 | Identity override props | `RichTranscriptViewProps` gains optional `agentName?: string` and `agentModel?: string`. When `agentName` is set, the assistant group header renders `agentName` plus ` [agentModel]` when model is set, instead of `getProviderDisplayName(provider)`. User headers ("You") and the unset case are unchanged. No hook is added conditionally. |
| R3 | Header parity | `TaskToolWidget`'s collapsed header gains the missing anatomy: leading icon (`description`, or `cloud_sync` when `run_in_background`), model from `message.subagent?.model` (audit-label form), live status chip driven by the already-fetched `sessionTasksAtom` `TaskInfo.status` (running/blocked/completed/failed/stopped mapped to the generic card's status vocabulary), and trailing expand chevron. The status-chip and audit-label pieces are extracted from the generic card path (`RichTranscriptView.tsx:1866-1874`, `:1908-1971`) into shared exported component(s) in `packages/runtime` consumed by BOTH paths — one source of truth, no copy-paste divergence. Existing selectors (`.task-tool-widget-header`, `.rich-transcript-tool-card.sub-agent`/`.teammate`) survive. |
| R4 | Call-site threading | All five embedded mounts pass `agentName`/`agentModel` per the identity table in §2. Task mounts without a model pass name only. `TaskToolWidget` passes `agentType ?? 'Sub-Agent'` + `message.subagent?.model` to its inner view. |
| R5 | Test coverage | Behavioral tests extend existing files (`RichTranscriptView.taskWidgetGate.test.tsx`, `TaskToolWidget.test.tsx` or nearest existing): collapsed-by-default + collapse-stickiness (R1), header override wiring (R2), status mapping for the extracted chip (R3). No presentation-only assertions (no icon names, no exact cosmetic strings beyond the label wiring itself). Deep-path mocks only — never the `@nimbalyst/runtime` barrel. |

### Should Have

| ID | Requirement | Acceptance Criteria |
| -- | ----------- | -------------------- |
| R6 | CHANGELOG | Handled by the coordinator at finalization: edit the existing "Teammates and sub-agents…" / "Task sub-agents…" bullets (repo rule: one feature = one bullet; never append per-commit). Not a worker task. |

---

## Interview Decisions (recorded; user absent)

- **D1 — Delete the effect, don't gate it.** The auto-expand effect has no consumer, no test,
  and contradicts PRD 004's collapsed-summary design. Gating it (e.g. only-while-running) was
  rejected: a card that expands itself at any moment steals transcript real estate and fights
  the user's collapse; the chip row (PRD 004/005) is the live-progress surface.
- **D2 — Parity by lifting TaskToolWidget up, not rewriting the generic card.** The generic
  card's anatomy is the richer, older, teammate-serving one; TaskToolWidget is the newcomer
  missing pieces. Shared pieces are extracted (status chip, audit label) rather than a whole
  shared header component: the two headers' name/content logic genuinely differs by kind, and a
  full shared header would need a config surface bigger than the duplication it removes.
- **D3 — `agentName`/`agentModel` as two plain optional props, not a `senderLabel` string.**
  Keeping name and model separate lets the header style the model bracket consistently
  (matching `TeammateThreadPopover.tsx:177`'s existing `{teammate?.model && …}` pattern) and
  keeps the fallback logic (`name only`, `name [model]`) in one place instead of five call
  sites formatting strings.
- **D4 — Task rail/popover mounts ship name-only.** `TaskInfo` has no model field and adding one
  means touching the metadata emit path in main for a label — out of proportion for this PRD.
  `TaskToolWidget` (the mount the screenshot showed) has `message.subagent?.model` and does show
  it. If model-everywhere is wanted later, that is a one-field metadata follow-up.
- **D5 — Status source for TaskToolWidget is `TaskInfo.status`, not `currentTeammates`.** The
  widget already subscribes to `sessionTasksAtom` (`TaskToolWidget.tsx:97`); teammate status
  flows through `currentTeammates` in the generic card. The extracted chip takes a plain status
  value, so each caller maps its own source — no new cross-atom coupling.
- **D6 — A2 label test is wiring, not presentation.** Repo rule bans exact-title-string tests;
  the override test asserts the *prop reaches the header* (name and model rendered when given,
  provider fallback when not) because the regression risk is the five-mount wiring, not the
  cosmetics. One dense test, not five.
- **D7 — No PRs, ever.** Standing repo constraint (same as PRDs 004/005/006): workers edit the
  main checkout on the feature branch (worktree-free-local, PRD 006's cadence), the coordinator
  reviews diffs, runs gates, and commits per task. Stop at ready-for-merge; the user performs
  the feature→main merge. `gh pr create` is forbidden at every level.

## Constraints

- **React hooks must be unconditional.** Incident `3fa68d3c0` (this week): two `useAtomValue`
  calls combined with `||` short-circuited and crashed the app ("Should have a queue"). Any
  hook in these components is called on every render; fallbacks are plain-value (`a ?? b`).
- **Test discipline:** extend existing test files; deep-path mocks only (NIM-2374);
  `// @vitest-environment node` where DOM-free; no presentation-only tests.
- **Known pre-existing failures excluded from gates:** `AgentTranscriptPanel.listenerCleanup.test.tsx`,
  `MarkdownRenderer.rtl.test.tsx` (jsdom localStorage undefined) — unrelated, tracked elsewhere.

---

## 5. Task Breakdown

Four tasks, three waves. 1a and 1b both edit `RichTranscriptView.tsx` (different regions) and are
sequenced; 2a and 2b then touch disjoint files and run in parallel. CHANGELOG is coordinator
finalization work (R6), not a task.

See `tasks.yaml` for the authoritative task definitions and `execution_plan.yaml` for waves.

## Review Outcome (opus reviewer, 2026-08-28)

Verdict: **approve-with-corrections** — all five required amendments applied to `tasks.yaml`:
C1 (`taskType` is the SDK task kind, not an agent name — Task mounts use `label`/`description`),
M2 (`TaskThreadBody` gets the popover's existing `label` threaded as a prop; no new hook),
M3 (`blocked`/`stopped` chip renderings specified from `SubAgentChipRow`'s vocabulary; the
teammate-card Blocked chip appearing is accepted as intended), M4 (1a's red-first fixture must
set `subagentId === providerToolCallId`; `StubWidget` must surface `isExpanded`), m5-m8/m11
(progress-fallback spinner stays inlined; `formatSubagentAuditLabel` stays exported from
`RichTranscriptView.tsx`; audit label keeps aria/title split and class; chip gains a stable
kebab-case root class; 1b keeps the undefined-provider fallback byte-identical). The reviewer
verified every file:line claim, all three test files and their harness feasibility, graph
acyclicity/wave correctness, and hook-safety of all four tasks (sole hazard was M2's
`TaskThreadPopover`, resolved by prop threading). Full review text retained in the coordinator
session; standalone review-file persistence is blocked by harness policy.

## Research Findings

See `research/internal/findings.md` (consolidated, with the call-site identity table),
`research/internal/patterns.md` (full header-anatomy inventory), `research/internal/errors.md`
(no-test-asserts-auto-expand verification; load-bearing selectors), and
`research/internal/structure.md` (PRD 004/006 vocabulary). External research deliberately
skipped: repo-internal UI fix, no library or API question in scope.
