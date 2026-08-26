# Research Findings: Teammate Resume-Delivery Reliability

Source: live investigation this session (2026-08-25), traced directly against source, not
inferred. Follows PRD 002 (`002_teammate-thread-view`, merged to local main) and reproduces
against the same `TeammateManager.ts`/`MessageStreamingHandler.ts` files that PRD touched.

## The bug

When a message is sent to an idle teammate — from the lead's own `SendMessage` tool call
(`TeammateManager.ts:2374-2401`) or from the UI's host-initiated send (`sendMessageFromHost`,
`:1191-1229`) — the caller gets back a synchronous success signal before the resumed process has
produced a single chunk:

- Lead's own tool-call path: `denyPreToolUse("Message delivered to idle teammate ... via resume.
  Do not retry.")` (`:2389-2398`), returned immediately after calling `resumeIdleTeammate`.
- Host-initiated path: `sendMessageFromHost` returns `{ delivered: true, wasIdle: true }`
  (`:1213`, `:1225`) immediately after calling `resumeIdleTeammate`, with a docstring that
  states outright: "`delivered: true` on the idle path means resume was successfully initiated,
  not that the teammate has necessarily read the message yet -- resumeIdleTeammate is
  fire-and-forget by design" (`:1185-1189`).

`resumeIdleTeammate` (`:1954-1998`) kicks off `streamTeammateOutput` and returns without waiting
on it. If that resumed SDK process fails — `--resume <sessionId>` does not reliably succeed,
especially post-restart, when the underlying CLI subprocess may be gone or the session file
stale — `handleStreamError` fires (`:1531-1552`):

1. Marks the teammate `errored` (drives the chip UI only).
2. Calls `emitAllCompleted` if it was the last active teammate (`:1549-1551`).

`emitAllCompleted` emits `teammates:allCompleted`, consumed in
`MessageStreamingHandler.ts:1172-1210` (`onTeammatesAllCompleted`). That handler's only actions
on a failure outcome are: play a failure sound / show a desktop notification
(`announceTeammatesCompletion` → `showFailureNotification`), and end the session. **Nothing
re-enters the lead's own conversation.** The lead already told itself (via its own tool_result)
"delivered, don't retry" and typically ends its turn right after, believing the teammate will
report back later — because it will not, since the resume already died before producing output.

From inside the transcript, this reads as: says resumed, then nothing continues, ever.

## Why this is asymmetric with the opposite direction

`onTeammateMessageWhileIdle` (`MessageStreamingHandler.ts`, the path for a teammate waking an
*idle lead*) already has the pattern this bug is missing: a `notifyUndelivered` callback wired to
a real failure notification when delivery can't complete
(`packages/electron/src/main/services/ai/teammateWakeDelivery.ts`,
`classifyTeammateWakeDelivery`/`announceTeammateWakeDelivery`). The lead-messages-teammate
direction never got the equivalent treatment — it optimistically confirms before the outcome is
known, and on failure falls back to a bare desktop notification with no path back into the
conversation.

## Confirmed NOT the bug

- `rehydrateIdleTeammate` (`:1248-1287`), the PRD 002 post-restart lookup, resolves a real
  persisted `sessionId` correctly and gates on `RESUMABLE_PERSISTED_STATUSES` (`idle`, `running`,
  `blocked`) appropriately. The `prompt: ''` field on its returned template is a placeholder never
  used as the actual message — `resumeIdleTeammate`'s real `prompt` argument comes from the
  caller's `content`, not from `idleInfo.prompt`. Not implicated.
- `seedLeadContext` (`:1236-1239`) correctly backfills `lastUsedCwd`/`lastUsedPermissionsPath`
  via `??=` only when unset, so a live lead's values remain authoritative. Not implicated, though
  worth confirming during implementation that every caller of `sendMessageFromHost` actually
  passes a `resumeContext` — an omitted one degrades silently to `process.cwd()`, which is a
  separate, narrower risk worth a task success-criterion rather than a full investigation here.

## Superseded by PRD review — do not follow these sections as instructions

Two PRD-review passes corrected this document's original proposed mechanism. The sections below
are kept for historical context only; **do not implement what they describe**:

- "What 'fixed' looks like" item 1 (blocking wait for first chunk before acking) — rejected, risks
  the PreToolUse hook's own timeout. Actual fix: honest-immediate-ack (task 1a).
- "What 'fixed' looks like" item 2 (extend `notifyUndelivered`/wake-delivery pattern) — rejected.
  That pattern solves the opposite direction (teammate waking an idle lead). The actual fix routes
  through `deliverMessageToLead` (`TeammateManager.ts:1090`), called directly from
  `handleStreamError` (task 1b).
- "Additional codebase research" item 1's suggestion to extend `announceTeammatesCompletion`/
  `teammateCompletionSignal.ts` with a new outcome — rejected. That mechanism only fires via
  `teammates:allCompleted`, an aggregate "last teammate" check, which cannot satisfy per-teammate
  idempotent delivery. Not touched by this PRD at all.
- "Additional codebase research" item 2 (hook the stall-watchdog race for ack timing) — same
  rejection as the first bullet above.

Also confirmed by the second review pass, not yet reflected below: the post-restart case is not a
risk to verify, it is a confirmed fact. The lead's session is not marked active post-restart
(`ai:sendMessageToTeammate` never calls `startSession`), and the event path that would wake it
(`ClaudeCodeProvider.ts`'s `interruptWithMessage` idle branch → `emitTeammateMessageWhileIdle`)
sources its `sessionId` from `TeammateManager.lastUsedSessionId`, which is only set while a live
lead query is running — `undefined` post-restart, independent of whatever sessionId was passed
into `deliverMessageToLead` itself. See task 1c.

## What "fixed" looks like

Two independent levers, likely both wanted:

1. **Don't confirm delivery on send — confirm it on the resumed stream's first real progress.**
   Either delay the `denyPreToolUse`/`sendMessageFromHost` success response until
   `streamTeammateOutput` produces its first chunk (turns fire-and-forget into a short wait), or
   keep the immediate ack but make it honestly conditional ("resume initiated" language rather than
   "delivered... do not retry", which overclaims certainty the code doesn't have).
2. **On resume failure, re-enter the lead's conversation, not just a desktop notification.**
   Extend the existing `notifyUndelivered`/wake-delivery pattern (already proven for the opposite
   direction) to this path: when `handleStreamError` fires for a teammate that was resumed rather
   than freshly spawned, and the lead is idle, wake it with a message describing the failure
   instead of only playing a sound.

Both are scoped to `TeammateManager.ts` and `MessageStreamingHandler.ts` — no renderer/UI changes
expected, since the chip already correctly flips to `errored`; the gap is entirely in what happens
(or doesn't) in the model-facing conversation and the host-level notification path.

## Additional codebase research

**1. `teammateWakeDelivery.ts` API shape (`packages/electron/src/main/services/ai/teammateWakeDelivery.ts`).**
Two pure functions, no I/O, both reusable as-is:
- `classifyTeammateWakeDelivery(targetWindow, hasSendMessageHandler): TeammateWakeDeliveryOutcome` —
  `'delivered' | 'window_not_found' | 'window_destroyed' | 'handler_absent'` (`:34-42`).
- `announceTeammateWakeDelivery(outcome, signal): Promise<void>` where `signal` is
  `{ deliver: () => void; notifyUndelivered: (reason: string) => void|Promise<void>; logDropped: (logSuffix: string) => void }`
  (`:44-65`). On `'delivered'` calls `signal.deliver()`; otherwise looks up `{reason, log}` from the
  internal `WAKE_DROP` table and calls `logDropped(log)` then `notifyUndelivered(reason)`.
Caller wiring lives in `MessageStreamingHandler.ts:1117-1149` (`onTeammateMessageWhileIdle`):
resolves outcome from `findWindowByWorkspace` + `this.svc.sendMessageHandler`, then
`notifyUndelivered` calls `notificationService.showAgentFailureNotification(sessionId, sessionTitle, reason, workspacePath)`.
For the fix's failure-notify direction, `teammateCompletionSignal.ts` is the closer sibling:
`announceTeammatesCompletion(outcome: TeammatesCompletionOutcome|undefined, { playCompletionSound, showFailureNotification })`
(`:35-44`) maps outcome via a `FAILURE_REASON` lookup (`clean`→null, `errored`/`abandoned`→string) and
is already wired at `MessageStreamingHandler.ts:1195-1207`. A new "resume-failed, re-enter lead
conversation" outcome/branch is the natural extension point in this same file, not a new one.

**2. Existing "wait for first chunk" pattern to mirror.**
`raceNextChunkWithStallWatchdog` / `resolveStreamStallMs`
(`packages/runtime/src/ai/server/providers/claudeCode/streamStallWatchdog.ts:42,84`) is already the
shared confirm-on-progress primitive, used identically by the lead's own stream
(`ClaudeCodeProvider.ts:1083,1169`) and by teammates (`TeammateManager.ts:1763,1789`). It races
`iterator.next()` against a stall timer and returns a tagged result (`{kind: 'chunk'|'stalled'|'interrupted'|'chunk-error', ...}`).
The resume-ack fix should hook the same race rather than invent a new "first chunk" signal: delay
the `denyPreToolUse`/`sendMessageFromHost` success response until the first `raceResult.kind === 'chunk'`
inside `streamTeammateOutput`'s loop (`TeammateManager.ts:1776-1821`), not until stream completion.

**3. `streamTeammateOutput`'s first-chunk signal shape.**
No dedicated "first chunk" event exists today — `streamTeammateOutput` (`TeammateManager.ts:1672-1683`)
returns a single `Promise<{capturedSessionId, approvedShutdown, capturedResultText, sentMessageToLead}>`
only once the whole stream ends; there is no intermediate resolve/emit at chunk 1. The `while(true)`
loop at `:1776` processes each `raceResult` from `raceNextChunkWithStallWatchdog` in order — the first
iteration where `raceResult.kind === 'chunk'` is the hook point. Implementing "ack on first progress"
requires either (a) passing a resolver/callback into `streamTeammateOutput` invoked on that first
chunk, or (b) racing the callers (`resumeIdleTeammate` at `:1954-1998`, its two call sites `:1212`,
`:1224`) against a new promise that `streamTeammateOutput` resolves early. No existing plumbing does
either — this is new surface, not a reuse.

**4. Test file conventions for `TeammateManager`.**
Location: `packages/runtime/src/ai/server/providers/__tests__/TeammateManager.<topic>.test.ts` (topic-suffixed,
not one mega-file — matches `.stallWatchdog.`, `.sendMessageFromHost.`, plain `.test.ts`). House style
(from `TeammateManager.stallWatchdog.test.ts:1-60`): `// @vitest-environment node` as line 1 (no DOM);
top-of-file docblock naming the bug class and prior fix it mirrors (cites NIM-1481 by name); `vi.mock`
narrow modules only — `@anthropic-ai/claude-agent-sdk`'s `query` and `AISessionsRepository`, never the
runtime barrel; a local `queryMock = vi.fn()` fed pre-built SDK chunk fixtures (`systemChunk`,
`toolUseChunk`, `toolResultChunk` — literal SDK-shaped objects, not builders); short local constants
(`STALL_MS`, `PAST_STALL_MS`) tuned small so tests run fast, with a `sleep()` helper. A new
"ack-on-first-chunk" / "resume-failure re-enters lead" test should follow this exact shape as a new
`TeammateManager.resumeReliability.test.ts` (or similarly topic-named) file.
