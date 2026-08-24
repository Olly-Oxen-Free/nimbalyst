# Task Brief: 4c

**Title:** Fix onTeammateMessageWhileIdle silent-drop fallback
**PRD:** agent-visibility
**Priority:** must
**Complexity:** 3/10
**Model:** sonnet
**Wave:** 4
**Feature Issue:** Not yet created — GitHub issue numbers are assigned by the PM agent at
issue-creation time for this PRD (no `github_project` configured, `links: []` in PRD metadata).

---

## Objective

`onTeammateMessageWhileIdle` in `MessageStreamingHandler.ts` is the mechanism that resumes the
main session's turn when a completed/idle teammate's message arrives — but delivery is silently
dropped in three distinct cases, with zero user-visible signal in any of them. This task adds a
notification fallback so all three drop cases surface to the user instead of vanishing.

---

## Context

**Parent Feature:** Agent Visibility and Workflow Enhancement (PRD `agent-visibility`,
`.nimble/prds/001_agent-visibility/PRD_agent-visibility.md`)

This task is part of the PRD's 2026-08-22 amendment (R10-R12), which added stall/hang-detection
and wake-delivery-reliability scope to the original chip-row/notification PRD. The amendment was
triggered by a user-reported recurring failure: "a spawned agent designed to report back either
never reports, or the main session never wakes." This task closes the second half of that
report — the "main session never wakes" case for Teammates — by fixing requirement **R12**.

`onTeammateMessageWhileIdle` (`packages/electron/src/main/services/ai/MessageStreamingHandler.ts:1058-1106`)
is the literal implementation of "a teammate's inbox message resumes the main thread's own turn."
When a Teammate messages an idle lead session, this handler looks up the workspace's window and,
if found, fire-and-forget invokes `sendMessageHandler` to inject a new turn. Today, if that lookup
or handler check fails for any of three reasons, the teammate's message is dropped on the floor:
no requeue, no persisted "pending wake" record, and no notification of any kind. The user has no
way to discover that a teammate reported back and nothing happened — the exact silent-hang failure
mode the amendment was written to close.

**Bonus scope, not extra work:** SDK-native Task sub-agents' unexpected-death path
(`finalizeBackgroundDrain`, `ClaudeCodeProvider.ts:2668-2716`) emits the same
`'teammate:messageWhileIdle'` event and is handled by this exact same code path. Fixing this
handler transparently fixes the equivalent silent-drop gap for Task sub-agents too — no separate
code change is needed or expected for that path.

This task is part of **Wave 4** — it runs alongside `2b`, `3b`, and `4b`, after Wave 3 (`2a`, `3a`)
completes (and after Wave 2's `4a`), before Wave 5 (`2c`).

---

## Assumed Precondition: Task 3a's Distinct-Notification Pattern

**This task depends on `3a` ("Guarantee distinct notification on Teammate error/crash").** Do not
begin implementation without first reading whatever `3a` actually built — the description below is
the pattern 3a is *expected* to establish, not a guarantee of its exact final shape. Verify before
reusing it.

**Expected shape of 3a's output:**

- `3a` wires `notificationService.showBlockedNotification(sessionId, sessionName, blockingType, workspacePath)`
  (`packages/electron/src/main/services/NotificationService.ts:607-627`) into every
  `teammates:allCompleted` emit site in `TeammateManager.ts` (lines 205, 1265, 1288, 1740, 1757 as
  of this PRD's research pass) and into `MessageStreamingHandler.ts`'s
  `onTeammatesAllCompleted` handler (`:1109-1137` as of this pass), so a teammate that errors or is
  silently abandoned fires a distinct notification instead of the same completion sound used for a
  clean finish.
- `showBlockedNotification`'s `blockingType` parameter is currently typed as
  `BlockingType = 'permission' | 'question' | 'plan_approval' | 'git_commit'`
  (`NotificationService.ts:79`) — none of these four values describes "teammate error" or "message
  delivery failed." **3a most likely needs to add a new `BlockingType` value** (e.g.
  `'teammate_error'` or similar) to make its own notification distinguishable, or it may use a
  different distinct-signal mechanism entirely (a different service method, a different IPC event).

**What to do in this task:**

1. Before writing any code, read `TeammateManager.ts`'s emit sites and
   `MessageStreamingHandler.ts`'s `onTeammatesAllCompleted` handler as they exist *after* 3a has
   landed, and read the current value of `BlockingType` in `NotificationService.ts`.
2. Reuse whatever distinct-notification mechanism 3a actually established — same function, same
   `BlockingType` value if one was added for this purpose, same call signature. **Do not invent a
   second, divergent notification path for this task's three drop cases.**
3. If 3a added a `BlockingType` value specifically for "teammate error/abandoned," it is
   semantically close to — but not identical to — this task's "delivery failed, message dropped"
   case. If reusing that exact value would be misleading to the user (e.g. the message reads "your
   teammate crashed" when actually the teammate finished fine and only *delivery* failed), it is
   acceptable to add a second, distinct `BlockingType` value (e.g. `'teammate_message_undelivered'`)
   following the same enum/switch-statement pattern 3a used — do not silently reuse a
   semantically-wrong label just to avoid touching the enum a second time.
4. If, after reading 3a's actual diff, `showBlockedNotification`/`BlockingType` turns out not to be
   the right primitive at all (e.g. 3a used something else), follow that mechanism instead and note
   the deviation from this brief's assumption in your final report.

---

## Requirements

Fulfills **R12** (PRD §4, Must Have):

> `onTeammateMessageWhileIdle` (`packages/electron/src/main/services/ai/MessageStreamingHandler.ts:1054-1106`)
> is the real mechanism that resumes the main session when a completed teammate's message
> arrives — but delivery is silently dropped in three cases: `findWindowByWorkspace`
> (`packages/electron/src/main/window/WindowManager.ts:810`) returns null (workspace's window
> closed), the found window is destroyed, or `sendMessageHandler` is absent. None of these fire a
> notification today. Add a fallback: when delivery isn't possible for any of these reasons, fire
> `showBlockedNotification` (or equivalent) instead of silently dropping the message.

### The current code (as of this research pass) — read before editing

`MessageStreamingHandler.ts:1058-1106`:

```ts
const onTeammateMessageWhileIdle = async (data: {
  sessionId: string;
  message: string;
}) => {
  if (!data.sessionId) {
    logger.main.warn('[AIService] teammate:messageWhileIdle with no sessionId');
    return;
  }
  const sessionStateManager = getSessionStateManager();
  if (!sessionStateManager.isSessionActive(data.sessionId)) {
    logger.main.info(`[AIService] Ignoring teammate message for ended session ${data.sessionId}`);
    return;
  }
  logger.main.info(`[AIService] Teammate message while lead idle, triggering sendMessage for session ${data.sessionId}`);
  try {
    await sessionStateManager.startSession({
      sessionId: data.sessionId,
      workspacePath: effectiveWorkspacePath,
    });

    const targetWindow = findWindowByWorkspace(effectiveWorkspacePath);
    if (targetWindow && !targetWindow.isDestroyed()) {
      const mockEvent = {
        sender: targetWindow.webContents,
        senderFrame: targetWindow.webContents.mainFrame,
      } as Electron.IpcMainInvokeEvent;

      if (this.svc.sendMessageHandler) {
        setImmediate(async () => {
          try {
            await this.svc.sendMessageHandler!(mockEvent, data.message, {} as any, data.sessionId, effectiveWorkspacePath);
          } catch (err) {
            logger.main.error('[AIService] Failed to process teammate message while idle:', err);
          }
        });
      }
    }
  } catch (error) {
    logger.main.error('[AIService] Failed to handle teammate message while idle:', error);
  }
};
this.installListener(provider, 'teammate:messageWhileIdle', onTeammateMessageWhileIdle);
```

### The three silent-drop cases (all must be fixed — not just the first)

1. **Window not found.** `findWindowByWorkspace(effectiveWorkspacePath)` returns `null` — the
   workspace's window was closed, or the workspace isn't currently open in any window. The outer
   `if (targetWindow && !targetWindow.isDestroyed())` is false; execution falls through with no
   `else` and no signal of any kind.
2. **Window destroyed.** `findWindowByWorkspace` returns a `BrowserWindow`, but
   `targetWindow.isDestroyed()` is `true` (window in the process of closing/already closed at the
   Electron level). Same outer `if` is false for this reason instead; same silent fallthrough.
3. **`sendMessageHandler` absent.** The outer `if` is `true` (a live, non-destroyed window exists),
   but `this.svc.sendMessageHandler` is falsy — the inner `if (this.svc.sendMessageHandler)` is
   false. This is a distinct code path from cases 1-2: the outer branch was entered, but the inner
   guard silently no-ops with no `else` either.

All three must gain an `else`/fallback branch that fires the distinct notification established by
3a (see "Assumed Precondition" above), using `data.sessionId` for the session id and
`effectiveWorkspacePath` for the workspace path. Use `getCurrentSessionTitle(data.sessionId)`
(`MessageStreamingHandler.ts:220`, already used at the three existing `showBlockedNotification`
call sites in this same file, e.g. `:898-904`) to resolve a human-readable session name for the
notification body.

### The one case that must NOT change

**Working case:** `targetWindow` exists, is not destroyed, and `this.svc.sendMessageHandler` is
present. The existing fire-and-forget `setImmediate` delivery — including its existing
`catch`-and-`logger.main.error` on failure — must remain unchanged. Do not add a notification to
the success path; only the three failure branches get one.

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] When the target window doesn't exist (`findWindowByWorkspace` returns `null`), a notification
      fires instead of silent drop
- [ ] When the target window exists but is destroyed (`targetWindow.isDestroyed()` is `true`), a
      notification fires instead of silent drop
- [ ] When `sendMessageHandler` is absent (window exists and is not destroyed, but
      `this.svc.sendMessageHandler` is falsy), a notification fires instead of silent drop
- [ ] When the window exists, is not destroyed, and the handler is present, existing resume
      behavior is unchanged (same fire-and-forget `setImmediate` call, same error handling)
- [ ] Regression test proves all four cases (the three failure branches plus the unchanged success
      case)

**All criteria must pass before task is complete.**

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/electron/src/main/services/ai/MessageStreamingHandler.ts` | modify | Add `else`/fallback branches to `onTeammateMessageWhileIdle` (lines ~1058-1106) firing a distinct notification for each of the three silent-drop cases. |
| Test file for `MessageStreamingHandler.ts` (find/extend existing spec; do not create a new file if one already covers this handler) | modify | Add the regression test proving the bug (silent drop, no notification) and the fix (notification fires) for all three failure cases plus the unchanged success case. |

### File Ownership Notes

`MessageStreamingHandler.ts` is also touched by task `3a` (wires `showBlockedNotification` into
`onTeammatesAllCompleted`, a different function in the same file). This task depends on `3a`
specifically to avoid a file conflict — `3a` must land first. Do not touch
`onTeammatesAllCompleted` itself in this task; your edits are scoped to
`onTeammateMessageWhileIdle` only.

---

## Implementation Guidance

### Patterns to Follow

- **Write the regression test FIRST**, per `end-to-end-verification.md`: reproduce "window not
  found → message silently dropped, no notification" as a failing test, then make the fix flip it
  green. Do not declare this task done on "the code path looks right" — this is exactly the class
  of bug that rule exists for.
- **Reuse 3a's exact distinct-notification mechanism.** See "Assumed Precondition" above — do not
  build a second, divergent notification primitive for this task.
- **Existing `showBlockedNotification` call sites in this same file** (`:898-904`, `:950-956`,
  `:994-1000`) are the pattern to match for call shape: resolve `sessionTitle` via
  `getCurrentSessionTitle(data.sessionId)` first, then call
  `notificationService.showBlockedNotification(sessionId, sessionTitle, blockingType, workspacePath)`.
  These calls are fire-and-forget (not awaited) in the existing code — match that unless 3a's
  established pattern awaits it.
- Structure the fix as explicit `else` branches (or early-return guards with logging + notification
  before each), not a single catch-all at the end of the function — the three cases are logically
  distinct and the test suite needs to exercise each independently.

### Code Style

- Match the existing logging convention in this handler: `logger.main.info(...)` for expected/logged
  state transitions, `logger.main.error(...)` for failures. Log each of the three drop cases with a
  distinguishable message (e.g. `'[AIService] Teammate message dropped: workspace window not found'`
  vs `'...window destroyed'` vs `'...sendMessageHandler not available'`) so `main.log` triage can
  tell them apart.
- Fire-and-forget the notification call the same way the existing three call sites in this file do
  (not awaited inline in the hot path) unless doing so would race with the `try`/`catch` around it.

### Edge Cases

- `data.sessionId` is already guarded at the top of the function (empty string / falsy returns
  early with a warning) — do not duplicate that guard.
- The early return for an already-ended session (`!sessionStateManager.isSessionActive(...)`) is
  intentional, pre-existing behavior and is **not** one of the three drop cases to fix — do not add
  a notification there; a message arriving for a session the user has already ended is not a
  failure to surface.
- `sessionStateManager.startSession(...)` is called before the window lookup and is unrelated to
  this task's fix — leave it untouched.
- If `getCurrentSessionTitle` itself can throw or fail to resolve, make sure the failure path still
  fires *a* notification (with a fallback session name) rather than the notification silently
  failing to fire because title resolution errored — check `getCurrentSessionTitle`'s existing
  fallback parameter (`MessageStreamingHandler.ts:220`, default `'AI Session'`) and use it.

### Testing Requirements

- Regression test must cover all four cases independently:
  1. `findWindowByWorkspace` mocked to return `null` → assert notification fires, assert
     `sendMessageHandler` is never called.
  2. `findWindowByWorkspace` mocked to return a window where `.isDestroyed()` returns `true` →
     assert notification fires, assert `sendMessageHandler` is never called.
  3. `findWindowByWorkspace` mocked to return a live window, but `this.svc.sendMessageHandler` is
     unset/undefined → assert notification fires.
  4. `findWindowByWorkspace` mocked to return a live window and `sendMessageHandler` is present →
     assert the existing fire-and-forget delivery still happens, assert no notification fires.
- Mock the narrowest module needed (`notificationService`, `findWindowByWorkspace`) — do not mock
  the `@nimbalyst/runtime` barrel; see the project's testing rule in the root `CLAUDE.md`.
- Extend the existing test file for `MessageStreamingHandler.ts` if one exists rather than creating
  a new one, per the project's "prefer extending an existing test file" rule.
- Add `// @vitest-environment node` as the first line if the test file doesn't already touch the
  DOM (this handler is pure main-process logic).

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

Also, per this PRD's own scope boundaries (§11):
- Do not modify `MetaAgentMode.tsx`'s `getStatusTone`/`getBarTone` status-mapping logic — out of
  scope, unrelated to this task.
- Do not modify `claudeCliSubAgentTracker.ts`'s transcript-hiding logic — out of scope, unrelated
  to this task.
- Do not touch `TeammateManager.ts`'s `teammates:allCompleted` emit sites or
  `onTeammatesAllCompleted` — that is task `3a`'s scope, already landed by the time this task
  starts; do not re-edit it here.

### Files Requiring Review

None of this task's files (`MessageStreamingHandler.ts` and its test file) are on
`.nimble/config.yaml`'s `require_review` list. Only `CHANGELOG.md` (task `5a`) triggers the
project's pre-merge human-review gate for this PRD.

---

## Dependencies

### Upstream Tasks

| Task | What It Provides | Verify Before Starting |
|------|------------------|------------------------|
| `3a` | The distinct-notification wiring pattern (`showBlockedNotification` call shape, and likely a new `BlockingType` value) used to distinguish a teammate error/crash from a clean finish. This task reuses that same pattern for its three silent-drop cases. | Read `3a`'s actual diff on `TeammateManager.ts` and `MessageStreamingHandler.ts`'s `onTeammatesAllCompleted` before writing this task's code — do not assume the exact `BlockingType` value or call shape described in this brief's "Assumed Precondition" section; confirm it against what actually landed. |

### Downstream Impact

Task `5a` (CHANGELOG entry and final review gate) depends on this task (along with `2c`, `2d`,
`3b`, `4a`, `4b`) — it is the PRD's final gate task and will not run until this task's PR is
merged/complete.

**Before starting:** Verify `3a` is complete by checking:
- `TeammateManager.ts`'s `teammates:allCompleted` emit sites (lines 205, 1265, 1288, 1740, 1757 as
  of the research pass) call `notificationService.showBlockedNotification` (or 3a's chosen
  equivalent) on error/abandon paths, not just on clean finish.
- `MessageStreamingHandler.ts`'s `onTeammatesAllCompleted` handler (`:1109-1137` as of this pass)
  distinguishes the error/abandon case from the clean-finish sound.
- `NotificationService.ts`'s `BlockingType` type (`:79` as of this pass) to see whether a new value
  was added for the teammate-error case.

---

## GitHub Context

**Issue:** Not yet created — assigned by the PM agent at issue-creation time.
**Feature Issue (Parent):** Not yet created — assigned by the PM agent at issue-creation time.
**Branch:** `worktree/agent-visibility-4c`
**Target:** Determined by PM agent based on execution mode (feature branch or main). Per PRD §7,
this PRD deploys via feature branch and direct merge to `main`, no phased rollout/feature flag.

---

## Commit Guidelines

Use Conventional Commits:
```
fix(ai): notify user when teammate wake-delivery silently fails
```

Types: feat, fix, refactor, test, docs, chore

Per this project's `CLAUDE.md`: one-sentence commit subject, short bullets for distinct changes if
needed, no prose paragraphs. Do not add a `Co-Authored-By` line (repo convention forbids it). If
this fix is tied to a tracked GitHub issue number once one exists, include a closing reference
(`Fixes #123`) — none exists as of this brief's generation.

---

## Validation Checklist

Before creating PR:
- [ ] All success criteria met
- [ ] Build passes: `npm run build`
- [ ] Type check passes: `npm run typecheck`
- [ ] Test suite passes: `npm run test:unit` (or `npm run typecheck && npm run test:prepush` per
      the project's pre-push gate)
- [ ] No `never_touch` files modified
- [ ] Regression test added covering all four cases (three failure branches + unchanged success
      case)
- [ ] Branch rebased on target branch (feature branch or main)
- [ ] Confirmed 3a's actual notification pattern was reused, not reinvented (see "Assumed
      Precondition" section)

---

## Deliverables

None beyond the files above.

---

*Generated by NIMBLE Brief Writer*
*PRD: agent-visibility | Task: 4c | Wave: 4*
