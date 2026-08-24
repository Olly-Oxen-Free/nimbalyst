# Task Brief: 2c

**Title:** Wire Teammate chip click-to-open-thread
**PRD:** agent-visibility
**Priority:** must
**Complexity:** 6/10
**Model:** opus
**Wave:** 5
**Feature Issue:** _Not yet created — assigned when the PM agent files the GitHub issue for this PRD._

---

## Objective

Make clicking a Teammate chip in the new `SubAgentChipRow` open/load that teammate's own thread and
let the architect send it a message directly — replacing today's "scroll to spawn point in the
lead's transcript" behavior with a real open-and-communicate flow. This closes requirement R5 and
the last unresolved piece of the tracker item's "click an agent to load its thread" ask for the two
in-conversation sub-agent systems (Teammates, SDK-native Task sub-agents).

---

## Context

**Parent Feature:** Agent Visibility and Workflow Enhancement (tracker item `tsk_mt1xxymgata1sw`)
— GitHub issue not yet filed at brief-generation time; the PM agent creates it during Phase 2.

Nimbalyst has three separate "spawned agent" systems, each with its own status/UI story. This PRD
brings the two in-conversation systems — Teammates (`TeammateManager`) and SDK-native Task
sub-agents (SDK `Task` tool) — up to parity with native Claude Code's sub-agent visibility: a
`blocked` status, a horizontal chip row above the chat input, click-to-thread, and a guaranteed
notification on death/block. Meta-Agent Mode (a separate, opt-in mode with its own dashboard) is
explicitly out of scope beyond a notification fix (task 3b) — see PRD `Non-Goals`.

Today, clicking a teammate's row in the vertical `TeammatePanel` (in the right-hand
`FilesEditedSidebar`) only scrolls the **lead's own transcript** to the point where that teammate
was spawned (`scrollToTeammateAtom`, wired at `TeammatePanel.tsx:61-63` and consumed at
`SessionTranscript.tsx:2200-2229`). There is no way to see the teammate's own conversation or send
it a message directly from the UI. Meta-Agent Mode already has a real "Open In Agent" button
(`MetaAgentMode.tsx:550-559`) that opens a persisted `ai_sessions` row — proof the *pattern* is
buildable — but Teammates do not have a persisted session row (see Research Context below), so this
task cannot copy that implementation verbatim.

This task is part of **Wave 5** — it lands after task 2b (which builds the chip row itself) and
before task 2d (Wave 6, which adds the Task sub-agent read-only popover to the same new component
file). Task 5a (CHANGELOG + human-review gate) depends transitively on this task completing.

---

## Research Context

PRD §9 Open Question Q4 flagged this task's core mechanism as unconfirmed: "research flagged
`appendToInbox`/`flushPendingMessages` as `could support` a direct-message flow but did not confirm
a wired UI control exists end-to-end." The investigation called for in this task's `agent_context`
has been done as part of writing this brief. Findings below are concrete file:line evidence, not
speculation — treat them as a starting point, but re-verify against the checked-out code before
implementing, since `TeammateManager.ts` may have shifted under tasks 1a/3a landing first.

### Finding 1 — No persisted per-teammate thread exists to "open"

Per the PRD's own research (`research/findings.md`, "Three different spawned agent systems"
table): Teammates have **no `ai_sessions` DB row** — the SDK session id is kept in-memory only.
Concretely, in `TeammateManager.ts`, when a teammate finishes its turn and goes idle, its captured
SDK session id is stashed in the in-memory `idleTeammates` map (`TeammateManager.ts:1234-1238`,
`this.idleTeammates.set(agentId, { ...idleTemplate, sessionId: result.capturedSessionId })`) — not
written to `AISessionsRepository`. This means Meta-Agent Mode's `onOpenSessionInAgent` pattern
(open a session by DB id in a new tab) **cannot** be reused as-is: there is no DB row to open.
"Opening the thread" therefore means building a *new* lightweight surface (panel, popover, or
inline expansion) that shows the teammate's identity/status and a compose box — not navigating to
an existing persisted transcript view. Whatever UI shape you choose, it does not need to render the
teammate's own turn-by-turn transcript to satisfy the stated success criteria (which require
"opens/loads that teammate's own thread" + "a message typed... reaches the teammate" — not
"renders the teammate's own message history"). If you choose to also surface the teammate's own
messages, note there is currently no event/IPC channel that streams a teammate's own chunks to the
renderer at all — that would be new scope beyond what R5 requires; keep it out unless trivial.

### Finding 2 — Message delivery to a teammate is only reachable today from the lead's own tool call, not from the UI

`TeammateManager.appendToInbox` (`TeammateManager.ts:884-955`) and `flushPendingMessages`
(`TeammateManager.ts:957-1011`) are **private** methods. The only call sites today
(`TeammateManager.ts:992`, `:1514`, `:1886`, `:1932`) are reached exclusively through the
`SendMessage` tool-routing branch inside `handlePreToolUse`
(`TeammateManager.ts:1861-2000`, roughly) — i.e., only when the **lead agent's own model turn**
calls the `SendMessage` tool. There is no existing IPC channel, `electronAPI` method, or public
class method that lets the **renderer/human** queue a message to a specific teammate. New plumbing
is required; this is not a "wire an existing button" task.

The existing `SendMessage` routing branch (`TeammateManager.ts:1861-2000`) already contains the
exact running/idle branching logic you need, and is the pattern to extract into a shared method
rather than duplicate:

- **Running teammate** (`this.managedTeammates.has(agentId)`): call
  `this.queueLeadMessage(agentId, recipient, content, summary)` then
  `await this.flushPendingMessages(agentId, teammateQuery)` (uses `teammateQuery.streamInput` when
  available, falls back to the inbox file otherwise — see `flushPendingMessages` internals).
- **Idle teammate** (`this.idleTeammates.has(agentId)`): call `this.resumeIdleTeammate(sessionId,
  agentId, idleInfo, messageContent)` (`TeammateManager.ts:1607`, called at `:1959` and `:1993` in
  the existing routing) — this respawns a `query()` resuming the teammate's captured SDK session id
  and delivers the message as the resume prompt.

Note one simplification available to you that the existing routing doesn't have: the existing
`SendMessage` branch matches teammates by fuzzy `recipient` name
(`agentIdMatchesRecipient(agentId, recipient, this.currentTeamContext)`,
`TeammateManager.ts:1866`) because the lead model only knows a display name. A UI-initiated send
already has the exact `agentId` from `TeammateInfo` (sourced via `sessionTeammatesAtom` — see task
2b) — you can look it up directly via `this.managedTeammates.get(agentId)` /
`this.idleTeammates.get(agentId)`, no fuzzy matching needed.

### Finding 3 — The plumbing precedent to follow already exists on `ClaudeCodeProvider`

`teammateManager` is a **private** field on `ClaudeCodeProvider`
(`packages/runtime/src/ai/server/providers/ClaudeCodeProvider.ts:295`), one instance per
lead-session provider. The established pattern for exposing a teammate-lifecycle action to the rest
of the app is a thin public passthrough method on the provider:

```ts
// ClaudeCodeProvider.ts:2513-2518 — existing precedent, follow this shape
/**
 * Stop a specific managed teammate by name
 */
public stopManagedTeammate(name: string): boolean {
  return this.teammateManager.stop(name);
}
```

Add a new method of the same shape (e.g. `public async sendMessageToManagedTeammate(agentId:
string, content: string): Promise<boolean>`) that delegates into a new **public** method you add on
`TeammateManager` (extracted from Finding 2's running/idle branching), rather than making
`appendToInbox`/`flushPendingMessages`/`queueLeadMessage` themselves public — keep those private,
add one new public entry point that calls them internally.

To reach that provider instance from an IPC handler, use the existing lookup pattern used
throughout `AIService.ts` (e.g. `AIService.ts:539`):

```ts
const provider = ProviderFactory.getProvider(session.provider as AIProviderType, sessionId);
```

`session.provider` must be `'claude-code'` for `provider` to actually be a `ClaudeCodeProvider`
instance with a `teammateManager` — guard for that (Teammates only exist under the `claude-code`
provider).

### Recommended approach

1. On `TeammateManager`, add one new public method, e.g. `sendMessageFromHost(agentId: string,
   content: string): Promise<{ delivered: boolean; wasIdle: boolean }>`, that looks up `agentId` in
   `managedTeammates` (running path) or `idleTeammates` (idle path) and reuses the exact
   queue/flush or resume logic already present in the `SendMessage` routing branch — do not
   reimplement the file-lock inbox-append logic, delivery-retry, or resume-prompt formatting from
   scratch.
2. On `ClaudeCodeProvider`, add `public async sendMessageToManagedTeammate(agentId, content)`
   delegating to the above, following the `stopManagedTeammate` shape at
   `ClaudeCodeProvider.ts:2513-2518`.
3. Add a new IPC channel (main process) that looks up the live provider via
   `ProviderFactory.getProvider(...)` for the owning session and calls the new provider method.
   Follow `safeHandle`/`safeOn` (`docs/MAIN_PROCESS_INIT.md`) and the `namespace:action` channel
   naming convention (`docs/IPC_GUIDE.md`) — e.g. `teammate:send-message`. Register it alongside the
   other `ai:*`/teammate-adjacent handlers in `AIService.ts` or a small dedicated handler module,
   whichever keeps `index.ts` registration consistent with the surrounding code.
4. Add the matching `electronAPI` bridge function in `packages/preload/index.ts` and its type in
   `packages/electron/src/renderer/electron.d.ts` (per `docs/IPC_GUIDE.md`'s preload-bridge
   pattern). Components must not call `ipcRenderer` directly — this is a request/response
   `invoke`-style call, not an event stream, so it does not need a centralized listener
   (`docs/IPC_LISTENERS.md` governs *event* subscriptions, not request/response `invoke` calls).
5. Build the "open thread" UI surface (see Finding 1 for what it does and does not need to render)
   and wire the Teammate chip's click handler in `SubAgentChipRow.tsx` to open it, replacing (or
   augmenting — see Success Criteria on preserving/superseding scroll behavior) the current
   `handleTeammateClick` → `setScrollTarget` wiring in `TeammatePanel.tsx:61-63`.

---

## Requirements

Fulfills **R5** (PRD §4 Must Have):

> Click a Teammate chip → opens/loads that teammate's own thread and allows sending it a message
> directly, extending `scrollToTeammateAtom` (`TeammatePanel.tsx:61-63`) into a real
> open-and-communicate flow using `TeammateManager.appendToInbox`/`flushPendingMessages`
> (`TeammateManager.ts:957-1011`).

Scope boundaries from the PRD that apply directly to this task:

- Only **Teammate** chips get this behavior. Task sub-agent chips get a **read-only popover**
  instead (R6, task 2d, Wave 6 — do not build that here, and do not let this task's changes to
  `SubAgentChipRow.tsx` make Task-chip click handling harder for 2d to add cleanly).
- Do not un-hide SDK-native Task sub-agent transcripts (`claudeCliSubAgentTracker.ts:20-22`) — not
  in scope for this task at all, it only concerns Teammates.
- Do not build a persisted, DB-backed thread/session for Teammates. Meta-Agent Mode's persisted
  child-session model is explicitly not being extended to Teammates in this PRD (see PRD
  Non-Goals — "unifying... into one `ai_sessions`-backed representation").

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] Clicking a Teammate chip opens/loads that teammate's own thread (not just a scroll to the
      spawn point)
- [ ] A message typed after clicking a Teammate chip reaches the teammate via
      `appendToInbox`/`flushPendingMessages` or equivalent (running-teammate path) or via
      `resumeIdleTeammate` (idle-teammate path)
- [ ] Verified via an IPC-level or integration test, not only a UI/manual check — exercise the new
      provider method / IPC handler directly, asserting the teammate's inbox file or resumed query
      actually receives the content
- [ ] Existing scroll-to-spawn-point behavior in `TeammatePanel` is preserved or intentionally
      superseded, and which choice was made is documented in the PR description or a code comment
      (either is acceptable — the PRD does not mandate one)
- [ ] Only Teammate chips trigger this flow; Task sub-agent chips are unaffected by this task's
      changes (their click behavior is task 2d's responsibility, Wave 6)
- [ ] New IPC surface (if added) follows `safeHandle`/`safeOn` and does not require a new
      centralized event listener (request/response only)

**All criteria must pass before task is complete.**

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/electron/src/renderer/components/AgentMode/SubAgentChipRow.tsx` | modify | Wire the Teammate chip's click handler to the new open-thread UI instead of (or in addition to) the scroll-to-spawn behavior. Built by task 2b — read its actual click-handling shape before editing (see Dependencies). |
| `packages/electron/src/renderer/components/AgentMode/TeammatePanel.tsx` | modify | Decide fate of existing `handleTeammateClick`/`scrollToTeammateAtom` wiring (`:61-63`) per the "preserved or superseded" success criterion; `TeammateInfo.status` also lives here (added to by task 1a) — do not touch the status type itself. |
| `packages/runtime/src/ai/server/providers/TeammateManager.ts` | modify | Add the new public `sendMessageFromHost`-style method (Finding 2/3); reuse existing private `queueLeadMessage`/`flushPendingMessages`/`resumeIdleTeammate` internals, do not duplicate their logic. |
| `packages/runtime/src/ai/server/providers/ClaudeCodeProvider.ts` | modify | Add the public passthrough method (Finding 3), following the `stopManagedTeammate` (`:2513-2518`) shape. Not in this task's original `files_affected` list in `tasks.yaml` — added here based on the investigation required by this task's `agent_context`; confirm the exact call shape still matches before implementing, since task 1b also touches this file (different section, `canUseTool` routing at `:3648-3760`) and may have landed first. |
| A new or existing main-process IPC handler file (e.g. `packages/electron/src/main/services/ai/AIService.ts` or a small dedicated module under `src/main/ipc/`) | modify or create | Register the new `teammate:send-message`-style channel using `safeHandle`, looking up the live provider via `ProviderFactory.getProvider(...)`. Exact file is an implementation choice — match the surrounding registration style in `index.ts`. |
| `packages/electron/src/preload/index.ts` | modify | Add the matching `electronAPI` bridge function per `docs/IPC_GUIDE.md`'s preload pattern. |
| `packages/electron/src/renderer/electron.d.ts` | modify | Add the TypeScript type for the new bridge function. |

### File Ownership Notes

- `TeammatePanel.tsx` is also touched by task 1a (adds `blocked` to `TeammateInfo.status`) and task
  2b (builds the chip row, reads its existing spinner/dot convention). Per the PRD's dependency
  chain (2b depends on 2a which depends on 1a; 2c depends on 2b), those changes land before this
  task starts — no real conflict expected, but re-read the file's current state before editing.
- `TeammateManager.ts` is also touched by task 1a (status transition hook) and task 3a (error/crash
  notification wiring) and task 4b (stall watchdog, depends on 3a). Task 2c does not depend on 3a or
  4b in `execution_plan.yaml` — if those tasks have already landed on your branch when you start,
  re-read the file before editing to avoid clobbering their changes; if they land after you via a
  merge/rebase, resolve conflicts by keeping both sets of changes (they touch different methods).
- `ClaudeCodeProvider.ts` is also touched by task 1b (`canUseTool` routing, `:3648-3760`) and task
  4a (post-result drain-grace timer, `:1038-1052`/`:1197-1200`), both different sections from where
  this task adds its passthrough method (near `:2513-2526`, alongside `stopManagedTeammate`) — low
  conflict risk, but confirm line numbers haven't drifted before editing.

---

## Implementation Guidance

### Patterns to Follow

- **Provider passthrough method shape:** `ClaudeCodeProvider.ts:2513-2518` (`stopManagedTeammate`)
  — thin public method delegating to `this.teammateManager`. Follow this exactly for the new
  message-send method; do not expose `teammateManager` itself as public.
- **Provider lookup from an IPC handler:** `AIService.ts:539` —
  `ProviderFactory.getProvider(session.provider as AIProviderType, sessionId)`. Guard for
  `session.provider === 'claude-code'` before assuming `teammateManager` exists.
- **Running vs. idle branching for message delivery:** `TeammateManager.ts:1861-2000` (the existing
  `SendMessage` tool-routing branch) — extract this shape into your new public method rather than
  writing new branching logic.
- **IPC registration:** `docs/IPC_GUIDE.md` — `safeHandle`/`safeOn`, `namespace:action` channel
  naming, preload bridge pattern with matching `electron.d.ts` types.
- **Prior art for "open thread" interaction (pattern only, not implementation):**
  `MetaAgentMode.tsx:550-559` (`onOpenSessionInAgent`, `data-testid="meta-agent-open-session"`) —
  useful for the *button/click* interaction shape (a labeled action on a card/chip that opens
  something), not reusable for the underlying "load session by DB id" mechanism, which Teammates
  don't have (Finding 1).

### Code Style

- `--nim-*` CSS variables only for any new UI (`docs/UI_PATTERNS.md`); `@container` queries for
  responsive layout, not `@media`.
- If the open-thread surface is a popover/overlay, use `@floating-ui/react` with `FloatingPortal`
  per `.claude/rules/floating-ui.md` — never manually compute `position: fixed`. If it's an inline
  panel or docked surface instead, floating-ui does not apply; either shape is acceptable, the PRD
  does not mandate popover-vs-panel for the Teammate case (only R6/task 2d, the Task sub-agent
  popover, explicitly mandates `@floating-ui/react`).
- New root DOM elements need a stable kebab-case class per `docs/REACT_DOM_MARKERS.md`.
- IPC channel: `invoke`-style (`ipcMain.handle`/`ipcRenderer.invoke`), since this is a
  request/response send-and-confirm action, not a fire-and-forget event.

### Edge Cases

- **Teammate has already completed/errored by the time the chip is clicked** — the chip row (task
  2b) may still show a terminal-state chip briefly (see PRD §5, dismissal convention TBD by 2b).
  Clicking a completed/errored teammate's chip should not attempt delivery; surface a clear
  "no longer active" state in the open-thread UI rather than silently failing.
- **`streamInput` unavailable on a running teammate** — `flushPendingMessages` already has a
  fallback path (`appendToInbox` + inbox-file delivery, see `TeammateManager.ts:980-989` for the
  `streamInput` attempt and the surrounding logic for the inbox fallback) — reuse it, don't special
  case it again at the new call site.
- **Idle teammate whose resume fails** — `resumeIdleTeammate` (`TeammateManager.ts:1607`) already
  exists; surface its failure (if any) back through your new public method's return value so the
  UI can show a delivery failure rather than a false "sent" confirmation.
- **Provider not found / session not `claude-code`** — the IPC handler should return a clear
  failure result (not throw an unguarded error) when `ProviderFactory.getProvider(...)` returns
  undefined or the provider type doesn't match, per `docs/ERROR_HANDLING.md`'s fail-fast-at-the-
  boundary guidance — validate and return a typed error rather than silently no-op-ing.

### Testing Requirements

- Add or extend a unit test for the new `TeammateManager` public method covering both the running
  and idle branches (delivered=true) and at least one failure path (no matching `agentId`).
- Add an IPC-level or integration test proving a UI-initiated send actually reaches the teammate —
  per the explicit success criterion, a UI-only/manual verification does not satisfy this task.
  Prefer testing at the `ClaudeCodeProvider`/`TeammateManager` boundary (mock the SDK query) over
  mocking through the full Electron IPC stack, unless an existing IPC-handler test pattern for a
  similar teammate action already exists to extend.
- Per `.claude/rules/end-to-end-verification.md`: this is not a restart-to-verify bug fix, so a
  failing-test-first requirement doesn't strictly apply, but the same principle holds — don't
  declare the click-to-thread flow "done" without a test that exercises delivery, not just that the
  UI renders a panel.
- This is not itself a coverage/testing task (title/type doesn't match the detection criteria in
  the brief-writer's coverage-expectations rule) — no separate Coverage Expectations section
  applies.

---

## Boundaries

### Files You MUST NOT Touch

Global `never_touch` list from `.nimble/config.yaml`:

- `package-lock.json`, `packages/browser-extension/package-lock.json`
- `.env*`
- `.github/workflows/*`
- `packages/electron/src/database/migrations/*`
- `packages/electron/src/main/database/sqlite/schemas/*`
- `node_modules/`, `**/dist/`, `packages/electron/out/`
- `nimbalyst-local/`, `.beads/`

PRD-specific, out of scope for this task:

- `packages/electron/src/renderer/components/MetaAgentMode/MetaAgentMode.tsx` status-mapping logic
  (`getStatusTone`/`getBarTone`, lines 67-104) — do not touch, unrelated system.
- `packages/electron/src/main/services/ai/claudeCliSubAgentTracker.ts` — Task sub-agent
  transcript-hiding logic; do not modify to expose hidden turns (this task is Teammate-only anyway).

### Files Requiring Review

None of this task's touched files are in `.nimble/config.yaml`'s `require_review` list
(`packages/runtime/src/auth/*`, `packages/electron/src/main/database/*`,
`packages/electron/src/main/index.ts`, `packages/electron/src/main/bootstrap.ts`,
`packages/electron/src/main/utils/protocolRegistration.ts`, `CHANGELOG.md`, `packages/collab-*`).
This task does not trigger the PRD's designated human-review gate on its own — that happens at task
5a (CHANGELOG.md), after Wave 6.

---

## Dependencies

### Upstream Tasks

| Task | What It Provides | Verify Before Starting |
|------|------------------|------------------------|
| 2b — Build horizontal chip row above chat input | `SubAgentChipRow.tsx`: a new component rendered directly above the chat message input, sourced from `sessionTeammatesAtom`/`sessionTasksAtom` via the `SubAgentStatus` mapping from task 2a, one chip per active Teammate/Task, colored by normalized status, using `--nim-*` variables and `@container` responsive sizing, with a stable kebab-case root class. **This brief was written before 2b's own brief/implementation was necessarily final — treat 2b's actual delivered shape (exact click-handler prop names, chip component structure, whether Teammate/Task chips are already visually or structurally distinguished) as authoritative over any assumption made here.** | Read the actual `SubAgentChipRow.tsx` file as it exists on your branch before writing any click-handler code. Confirm it renders Teammate chips with the `agentId` available at the click site (needed to call the new `sendMessageToManagedTeammate` method). If 2b's chip row does not yet distinguish Teammate chips from Task chips in its click handling, you will need to add that distinction as part of this task (Task chips must remain unaffected — see Success Criteria). |
| 2a — Build normalized `SubAgentStatus` mapping | The `SubAgentStatus` derived mapping (working/waiting/blocked/complete/error) that 2b's chips are colored by. Not directly consumed by this task's own code, but relevant context for the "terminal-state chip" edge case above. | No direct action needed; informational only for this task. |
| 1a — Add `blocked` status to `TeammateInfo.status` | `blocked` is now a valid value of `TeammateInfo.status`. Relevant to this task only for the edge case of a blocked teammate's chip being clicked (should still allow opening the thread — a blocked teammate is exactly the one you'd want to message). | Confirm `blocked` doesn't need special handling in the open-thread UI beyond what's already covered by the running-teammate delivery path (a blocked teammate is still "running" from `TeammateManager`'s internal state — `blocked` is a display-only status per R3). |

### Downstream Impact

**Task 2d** (Read-only status popover for Task sub-agent chips, Wave 6) depends on this task
completing, structurally (`depends_on: ["2b", "2c"]`) — both tasks extend `SubAgentChipRow.tsx`.
Leave the Task-chip click-handling path clearly separated from the Teammate-chip path you build
here (e.g. a distinct handler prop or a status-check branch) so task 2d can add its popover without
re-deriving your changes.

**Task 5a** (CHANGELOG entry, Wave 7, human-review gate) depends on this task transitively through
the wave structure — no direct action needed here, but the CHANGELOG bullet it writes will describe
this task's user-facing behavior ("click-to-thread for Teammates") alongside the rest of the
feature.

**Before starting:** Verify task 2b's `SubAgentChipRow.tsx` exists on your branch/worktree and
renders both chip types before writing this task's click-handler code — do not assume its exact
shape from this brief's description; read the file directly.

---

## GitHub Context

**Issue:** _Not yet created — assigned by the PM agent when the GitHub issue for task 2c is filed._
**Feature Issue (Parent):** _Not yet created — assigned by the PM agent alongside the PRD's parent issue._
**Branch:** `worktree/agent-visibility-2c`
**Target:** Determined by PM agent based on execution mode (feature branch or main). Per PRD §7
Rollout Plan, this PRD uses direct merge to `main` via a feature branch (`/nimble:run`'s standard
feature-branch execution mode).

---

## Commit Guidelines

Use Conventional Commits:
```
feat(agent-mode): wire teammate chip click-to-open-thread

Co-Authored-By: Claude <noreply@anthropic.com>
```

Types: feat, fix, refactor, test, docs, chore

(Note: this repository's own `CLAUDE.md` says not to add `Co-Authored-By` trailers in normal
day-to-day commits from Claude Code sessions in this repo. This NIMBLE template's format is shown
for completeness; if the two instructions conflict at execution time, the repository's own
`CLAUDE.md` — which governs the actual commit — takes precedence over this generic template line.)

---

## Validation Checklist

Before creating PR:
- [ ] All success criteria met
- [ ] Build passes: `npm run build`
- [ ] Type check passes: `npm run typecheck`
- [ ] Full pre-push gate green: `npm run typecheck && npm run test:prepush` (this repo's actual
      required gate per its own `CLAUDE.md`, run before pushing)
- [ ] No `never_touch` files modified
- [ ] New behavioral change (message delivery, click handling) has a unit or integration test per
      this repo's "Write and Run Tests for Behavioral Changes" rule
- [ ] Branch rebased on target branch (feature branch or main)
- [ ] `CHANGELOG.md` NOT touched by this task (that's task 5a's job, gated for human review)

---

## Deliverables

| Artifact | Path | Done when |
|---|---|---|
| Code + tests | Files listed in "Files to Modify" above | All success criteria pass; new provider/manager methods and IPC surface are covered by the tests described in "Testing Requirements" |
| IPC documentation update (conditional) | `docs/IPC_GUIDE.md` and/or `docs/IPC_LISTENERS.md` | **Only if** this task adds a genuinely new IPC channel/handler pattern not already documented — per the task's own `deliverables_note` in `tasks.yaml`: "Nothing beyond the code and its test(s), unless the investigator scan surfaces a new IPC surface requiring an IPC_GUIDE.md/IPC_LISTENERS.md doc update — in that case, treat the doc update as a deliverable of this task." Since this brief's own investigation (Finding 2/3) confirms a new IPC channel is required, this condition is expected to trigger — add a short note to `docs/IPC_GUIDE.md`'s channel list or equivalent if the new `teammate:send-message`-style channel isn't self-evident from the existing doc's examples. |

If, after implementing, you determine no new IPC surface was actually needed (e.g. an existing
generic `ai:*` invoke channel turns out to be sufficient with a payload change), the doc-update
deliverable does not apply — state that explicitly in the PR description rather than silently
skipping it.

---

*Generated by NIMBLE Brief Writer*
*PRD: agent-visibility | Task: 2c | Wave: 5*
