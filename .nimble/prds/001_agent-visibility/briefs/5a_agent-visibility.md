# Task Brief: 5a

**Title:** CHANGELOG entry and final review gate
**PRD:** agent-visibility
**Priority:** must
**Complexity:** 1/10
**Model:** sonnet
**Wave:** 6 (final wave)
**Feature Issue:** Not configured — the PRD frontmatter has `links: []`; no GitHub issue tracks this feature as a whole. Reference the tracker item `tsk_mt1xxymgata1sw` (Nimbalyst's own tracker, not GitHub) if you need a human-readable origin pointer.

---

## Objective

Add exactly one user-facing bullet to `CHANGELOG.md`'s `[Unreleased]` section summarizing the **entire agent-visibility feature** shipped across this PRD's 11 prior tasks — not just this task's own (nonexistent) code slice. This task is a pure documentation edit and, because `CHANGELOG.md` is in `.nimble/config.yaml`'s `require_review` list, it is also the designated trigger for this PRD's one human-review gate (defined in `execution_plan.yaml`, `after_wave: 5`, model `pause`). Do not merge past this task without that review.

---

## Context

**Parent Feature:** Agent Visibility and Workflow Enhancement (tracker item `tsk_mt1xxymgata1sw`; no GitHub issue configured for this PRD)

Nimbalyst has three separate "spawned agent" systems (SDK-native Task sub-agents, Nimbalyst Teammates, Meta-Agent Mode child sessions), each with its own status vocabulary and UI surface. Compared to native Claude Code's sub-agent UX, none of five requested behaviors was fully implemented for the two systems used inside a normal chat conversation (Teammates, Task sub-agents): a sub-agent could block on a permission prompt or die outright with no distinct signal in the main thread, no horizontal chip row existed above the chat input, and an errored teammate produced the identical "all done" chime as a clean finish. This PRD closes that gap. A later amendment (2026-08-22, tasks 4a-4c) added a second, related fix set: sub-agents that hang silently (no error, no chunk, ever) and a wake-delivery path that silently drops a teammate's message when the target window is gone.

This task is part of **Wave 6**, the final wave — it runs only after every functional task (waves 1-5) has landed, and it is gated: `execution_plan.yaml` defines a `pause` gate after wave 5, before this task, requiring a human to review the full diff of tasks 1a through 4c before merge. This task's own success criteria are satisfied by writing the CHANGELOG bullet; the gate's precondition (full diff available for review) is not something this task itself produces or asserts — it is a property of the PM/orchestrator's merge sequencing.

### The full shipped feature set this bullet must summarize

The CHANGELOG bullet must read as a summary of the *whole* feature, because task 5a is the only task that touches `CHANGELOG.md` — no other task in this PRD adds a changelog entry (see PRD §12 Assumption 7: "deliverables are code-only for every task except 5a"). The shipped behavior, end to end:

1. **Blocked status (tasks 1a, 1b):** Both Teammates and SDK-native Task sub-agents now have a `blocked` status, set while the sub-agent's permission/prompt request is pending and cleared on resolution. For concurrent Task sub-agents, only the one actually blocked shows it — a sibling running normally is unaffected.
2. **Normalized status mapping (task 2a):** A shared status vocabulary (working / waiting / blocked / complete / error) drives consistent coloring across both systems.
3. **Horizontal chip row (task 2b):** A new chip row renders directly above the chat message input — one chip per active Teammate/Task sub-agent, colored by status, appearing and disappearing as sub-agents spawn and finish. No row renders when nothing is active.
4. **Click-to-thread for Teammates (task 2c):** Clicking a Teammate's chip opens/loads that teammate's own thread and lets you send it a message directly (not just a scroll-to-spawn-point).
5. **Read-only popover for Task sub-agents (task 2d):** Clicking a Task sub-agent's chip opens a small read-only popover showing its current status and active tool name — Task sub-agent transcripts remain intentionally hidden by design, so this is not a thread.
6. **Guaranteed distinct notification on Teammate error/crash (task 3a):** A Teammate that errors, crashes, or is silently abandoned while idle now fires a distinct notification instead of the same completion sound used for a clean finish.
7. **Same guarantee extended to Meta-Agent Mode (task 3b):** A Meta-Agent child session entering a pending-prompt state now proactively notifies, even when the Meta-Agent dashboard isn't the focused view.
8. **Concurrent Task sub-agent stall-masking fix (task 4a):** When multiple Task sub-agents drain concurrently, one genuinely stalled sub-agent is no longer masked indefinitely by a healthy sibling's activity resetting a shared timer.
9. **Teammate stream-stall watchdog (task 4b):** A teammate whose process hangs silently (no chunk, no error) now times out and transitions to `errored`, firing the same distinct notification as task 3a, instead of waiting forever.
10. **Wake-delivery silent-drop fix (task 4c):** When a completed teammate's message can't be delivered to resume the main session (workspace window closed, destroyed, or no handler), the app now notifies instead of silently dropping the message.

Do not name any of the above tasks, files, atoms, services, or classes in the CHANGELOG bullet itself — this list is context for you to synthesize a single accurate, user-facing sentence (or a short set of clauses in one bullet), not content to transcribe.

---

## Requirements

- Add **exactly one** new bullet to `CHANGELOG.md`'s `[Unreleased]` section.
- The bullet must be user-facing prose describing what changed from the architect's point of view: sub-agents (teammates and Task sub-agents) now show up as a colored chip row above the chat input, a distinct "blocked" state is visible when one is waiting on a permission prompt, clicking a teammate's chip lets you message it directly, and you get a clear notification instead of silence when a sub-agent errors, crashes, hangs, or can't be reached.
- Match the one-sentence-per-bullet voice already used in `[Unreleased]` (see examples below, read from the live file) — dense, plain, no marketing language, no internal names.
- Place the bullet in the section that best matches its nature. Since this introduces new user-visible capability (chip row, click-to-thread, blocked coloring) rather than only fixing existing broken behavior, prefer **`### Added`**. If, at the time you write this, other `[Unreleased]` entries for this exact feature already exist in a different section, follow the existing entry's placement instead of adding a duplicate — see "One feature, one bullet" below.
- **One feature, one bullet.** Do not add a separate bullet per task (1a-4c). If a prior task in this PRD already added a bullet for part of this feature (it should not have — deliverables were scoped code-only for every task except this one — but verify), edit that single existing bullet to be complete rather than appending a second one.
- No internal scaffolding: no atom/type names (`TeammateInfo`, `TaskInfo`, `SubAgentStatus`), no IPC channel names, no service/class names (`TeammateManager`, `NotificationService`, `MessageStreamingHandler`, `ClaudeCodeProvider`), no file paths, no requirement IDs (R1-R12), no task IDs.

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] Exactly one new bullet added to `CHANGELOG.md`'s `[Unreleased]` section
- [ ] Bullet describes user-visible behavior only — no atom/IPC/service/class names
- [ ] Bullet length and voice match the surrounding `[Unreleased]` entries

**All criteria must pass before task is complete.**

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `CHANGELOG.md` | modify | Add one `[Unreleased]` bullet summarizing the full agent-visibility feature (chip row, blocked status, click-to-thread, guaranteed notifications, stall-detection fixes) |

### File Ownership Notes

`CHANGELOG.md` is a shared, high-traffic file across the whole repo — other in-flight work (unrelated PRDs, manual commits) may also be adding `[Unreleased]` bullets concurrently. Add your bullet without reordering, rewording, or removing any existing bullet in any section. If a merge conflict arises against another concurrent addition to the same section, resolve by keeping both bullets (append yours), not by discarding either.

---

## Implementation Guidance

### Patterns to Follow

Read the live `[Unreleased]` section of `CHANGELOG.md` before writing — do not rely solely on the examples reproduced here, the file may have changed. As of this brief's writing, representative bullets in the same register you should match:

- "Tracker board cards now have a run/resume/focus button to start, reopen, or jump to that item's AI session without leaving the board." (`### Added`)
- "Desktop notifications now carry their own icon, so you can tell a finished agent, a question, an approval request, and a teammate's message apart at a glance." (`### Added`)
- "Push notifications now reach your phone when you walk away from your desk, and a session blocked on your answer or one that hit an error will reach you even while you are at your computer." (`### Fixed`)

Note the shape: present tense, "now," states the capability or fix in plain terms, occasionally two clauses joined by "and" or a comma when one sentence needs to cover a couple of closely related behaviors — exactly the situation here, since this bullet must cover chip row + blocked status + click-to-thread + guaranteed notification in one entry.

### Code Style

Markdown list item: `- ` followed by one sentence (or one sentence with an internal clause), ending in a period. No headers, no sub-bullets, no code spans, no bold/italic emphasis inside the bullet — match the plain-prose style of every other `[Unreleased]` line.

### Edge Cases

- If you're unsure whether a detail counts as "internal scaffolding," ask: would an architect using Nimbalyst (not reading its source) ever type or see this term? `TeammateManager` — no, cut it. "Chip row above the chat input" — yes, an architect sees exactly that, keep it.
- Do not describe the stall-detection/wake-delivery fixes (tasks 4a-4c) as a separate "bug fix" bullet under `### Fixed` — the PRD's release criteria (§8) call for **one** bullet covering the whole feature. If the single-bullet framing genuinely cannot cover both the new-capability framing (`### Added`) and the reliability framing (tasks 4a-4c) in one natural sentence, prefer folding the reliability fixes in as a trailing clause of the `### Added` bullet ("...and a stuck or unreachable sub-agent now reliably notifies you instead of hanging silently") rather than creating a second bullet.

### Testing Requirements

None. This is a documentation-only change to `CHANGELOG.md`; no runtime behavior changes, so no unit test is required or expected. This is not a test task — omit any coverage tooling.

---

## Boundaries

### Files You MUST NOT Touch

From `.nimble/config.yaml`'s global `never_touch` list:

- `package-lock.json`
- `packages/browser-extension/package-lock.json`
- `.env*`
- `.github/workflows/*`
- `packages/electron/src/database/migrations/*`
- `packages/electron/src/main/database/sqlite/schemas/*`
- `node_modules/`
- `**/dist/`
- `packages/electron/out/`
- `nimbalyst-local/`
- `.beads/`

None of these are anywhere near this task's scope (a single markdown file), but they are listed for completeness per the brief format.

### Files Requiring Review

`CHANGELOG.md` itself is on `.nimble/config.yaml`'s `require_review` list (alongside `packages/runtime/src/auth/*`, `packages/electron/src/main/database/*`, `packages/electron/src/main/index.ts`, `packages/electron/src/main/bootstrap.ts`, `packages/electron/src/main/utils/protocolRegistration.ts`, and the `collab-*` packages — none of which this task touches). **This task's edit to `CHANGELOG.md` is precisely what triggers the pre-merge human-review gate** defined in `execution_plan.yaml` (`after_wave: 5`, label "Pre-merge review: CHANGELOG entry + full chip-row/notification diff", model `pause`). Do not treat this gate as optional or as something this task can wave through — the gate's precondition (the full diff of tasks 1a-4c being available for review) must be satisfied by the orchestrator/PM before merge proceeds past this task.

---

## Dependencies

### Upstream Tasks

| Task | What It Provides | Verify Before Starting |
|------|------------------|------------------------|
| 2c | Teammate chip click-to-open-thread, wired end-to-end with an IPC-level or integration test | Confirm the task's PR/commit is merged and its regression test passes |
| 2d | Read-only status popover for Task sub-agent chips (`@floating-ui/react`) | Confirm merged; popover opens on click with status + tool name |
| 3b | Guaranteed notification extended to Meta-Agent Mode's `pendingPrompt` detection | Confirm merged; regression test for normal Meta-Agent completion passes |
| 4a | Concurrent Task sub-agent stall-masking fix | Confirm merged; regression test proves concurrent-stall detection and solo/healthy cases both pass |
| 4b | Teammate stream-stall watchdog | Confirm merged; regression test proves stalled and healthy teammate cases both pass |
| 4c | `onTeammateMessageWhileIdle` silent-drop fallback fix | Confirm merged; regression test proves all four delivery cases (window missing, destroyed, handler absent, normal) pass |

Transitively, this task also depends on the full chain beneath these six: 1a, 1b (blocked status), 2a (normalized `SubAgentStatus` mapping), 2b (chip row), and 3a (Teammate error/crash notification guarantee) — all of which must be merged for the feature described in this brief's Context section to actually be true. Read `dependencies.md` in this PRD's folder for the full dependency graph if any of the above six tasks appears incomplete.

**Before starting:** Confirm all 12 tasks' worktrees/PRs show a merged or ready-to-merge state (this task is wave 6 of 6 — every other task should already be done). If any upstream task is not actually complete, do not write a CHANGELOG bullet describing behavior that doesn't exist yet — stop and flag it rather than guessing.

### Downstream Impact

None — this is the final task in the PRD's dependency chain (wave 6 of 6, `longest_chain` per `execution_plan.yaml`: `1a -> 2a -> 2b -> 2c -> 2d -> 5a`). No task depends on 5a.

---

## Deliverables

| Artifact | Path | Done when |
|---|---|---|
| CHANGELOG.md `[Unreleased]` bullet | `CHANGELOG.md` | A single new bullet exists in the `[Unreleased]` section describing the chip row, blocked status, click-to-thread, and guaranteed-notification behavior, matching the voice of surrounding entries, with no internal symbol/file names |

None beyond the above.

---

## GitHub Context

**Issue:** Not created — no GitHub issue tracking is configured for this PRD (`links: []` in `PRD_agent-visibility.md` frontmatter). If the PM agent creates issues for this PRD's tasks despite no parent feature issue, use the tracker item `tsk_mt1xxymgata1sw` as the reference instead.
**Feature Issue (Parent):** None configured
**Branch:** `worktree/agent-visibility-5a`
**Target:** Determined by PM agent based on execution mode (feature branch or main) — per PRD §7 Rollout Plan, direct merge to `main` via feature branch is the expected mode, but this is decided at execution time, not by this brief.

---

## Commit Guidelines

Use Conventional Commits:
```
docs(changelog): summarize chip row, blocked status, and sub-agent notification work

Co-Authored-By: Claude <noreply@anthropic.com>
```

Types: feat, fix, refactor, test, docs, chore. This task is `docs` — it changes no runtime behavior.

---

## Validation Checklist

Before creating PR:
- [ ] All success criteria met
- [ ] Build passes: `npm run build`
- [ ] Type check passes: `npm run typecheck`
- [ ] No `never_touch` files modified
- [ ] `CHANGELOG.md` diff is exactly one added bullet (no reordering/rewording of existing entries)
- [ ] Branch rebased on target branch (feature branch or main)
- [ ] Pre-merge human review gate (per `execution_plan.yaml`) is satisfied before this PR merges — do not self-approve past a `require_review` file

---

*Generated by NIMBLE Brief Writer*
*PRD: agent-visibility | Task: 5a | Wave: 6*
