# PRD: teammate-wake-transcript-integration

## Status

Coordinator running autonomously (user pre-approved all gates for this session; interview
conducted from the user's own confirmed root-cause brief, not a live Q&A — no interactive
interview was possible in this harness). Research internal-only by deliberate decision
(repo-internal bugfix, no library/external question). Execution rule: NO PRs ever;
worktree-free-local cadence (PRD 006/007/008 precedent) — coordinator commits per task in the main
checkout on `feature/teammate-wake-transcript-integration`, stops at ready-for-merge, user (or
this session, per explicit instruction) performs `git merge --ff-only` to main.

## Problem

Three related bugs share one root cause: teammate-to-lead wake messages are injected through the
exact same code path as real user keyboard input, with no distinguishing marker anywhere
downstream.

`TeammateManager.deliverMessageToLead` and `deliverRevivalFailure`
(`packages/runtime/src/ai/server/providers/TeammateManager.ts:1202-1244`, `:1263-1309`) call
`interruptWithMessage`, which — when the lead is idle — routes through
`ClaudeCodeProvider.emitTeammateMessageWhileIdle` → `MessageStreamingHandler.ts`'s
`onTeammateMessageWhileIdle` listener (`:1092-1170`) → calls
`this.svc.sendMessageHandler!(mockEvent, data.message, {} as any, data.sessionId, effectiveWorkspacePath)`
— the same handler real user input goes through. The injected strings
(`[Teammate message from "X"]\n\n${content}`, `[Teammate revival failed: "X"]\n\n${reason}`) become
literal `user`-role SDK turns with no marker once they leave `MessageStreamingHandler`.

### Bug A — mislabeled as "You"

In the lead's mainline transcript, these injected turns render with the same "You" header as real
user messages (`RichTranscriptView.tsx:2243`: `isUser ? 'You' : (agentName ?? getProviderDisplayName(provider))`).
Confirmed via user screenshot: a mainline row labeled "You 2:07:05 PM" containing
`[Teammate message from "cpu-recorder"]` content.

### Bug B — not condensed into the teammate's own thread

User: "im just still not seeing the entire agent thread condensed into a single thread from when
it was invoked - instead it bleeds directly into the main thread. it should be condensed until the
user decides to open it." Also: "many of these messages should have been in the condensed agent
view, not included mainline. specifically a lot of the shutdown messages or other things form the
inter-communication." Applies to the wake message itself and the shutdown-handshake plumbing
(SendMessage/`shutdown_response` tool calls and their results).

### Bug C — revival resumes into stale shutdown-handshake context

Confirmed via main.log (session `cpu-scout@team-ae31beba`, 14:06:41-14:11:50): teammate spawned,
idled, got a shutdown request, approved, shut down cleanly at 14:07:08 (normal sequence, not a
duplicate/race). Revived via PRD 008's revival UI at 14:11:24, idled again at 14:11:28, got a
second legitimate user-initiated shutdown request at 14:11:46. The revived teammate's transcript
showed confusion: "I've already sent the shutdown response and the system has confirmed I'm
exiting... Did you mean to ask about GPU processes before shutdown, or did you need something else
clarified?" — the SDK replays the session whose last turns were the prior shutdown handshake, and
generation continues from that stale context instead of reacting to the real new instruction.

## Research (internal, condensed — see task briefs for exact citations)

**Resolved architectural question (would have invalidated a wrong-pipeline fix):** the desktop
mainline `RichTranscriptView` is fed by `SessionManager.loadSession` →
`loadCanonicalTranscript` → the canonical `ai_transcript_events` table, parsed by
`ClaudeCodeRawParser`/TranscriptTransformer. A second, separate function,
`SessionManager.transformAgentMessagesToUI` (role-shaped, regex-tags
`metadata.isTeammateMessage`), is **iOS-only** per its own doc comment ("Used by iOS transcript
which doesn't have access to the canonical transcript pipeline") — confirmed dead for desktop by
tracing `loadSession`. Consequence: `RichTranscriptView.tsx:2107-2148`'s existing `<details>`
collapse, gated on `metadata.isTeammateMessage`, is **dead code on desktop mainline today** — it
only ever fires on the iOS path. Any fix operates on the canonical pipeline, not the iOS-only regex
tagging.

`sendMessageHandler`'s signature (`AIService.ts:219`) has no metadata channel — its third argument
is a typed `DocumentContext`, not a generic bag. The fix threads a new optional origin parameter
through the call chain (`onTeammateMessageWhileIdle` → `sendMessageHandler` → the raw
`ai_agent_messages` write → `TranscriptTransformer`/`ClaudeCodeRawParser` → the canonical event type
`RichTranscriptView` actually reads).

Nearest prior art for origin-tagging: `messageType: 'teammate_message_injected'`, written only at
`ClaudeCodeProvider.ts:956`/`:1870` in the *active-lead mid-turn* injection path — not the idle-wake
path this PRD concerns, but the closest existing precedent to extend.

For Bug C: `rehydrateIdleTeammate` (`:1437-1487`) → `resumeIdleTeammate` (`:2269-2274`) →
`query({prompt, options:{resume:resumeSessionId}})` (`:2050-2058`). The resume call always carries
the real new prompt — never blank — so the bug is missing grounding, not a missing prompt. An
injection primitive already exists in-file: `createInjectedUserMessageStream(content):
AsyncIterable<SDKUserMessage>` (`:366-380`), currently used only for `streamInput` into an
already-running query, never to seed `query()`'s initial `prompt`. `revivedFromTerminal` is already
threaded (`IdleTeammate:1485`, `ManagedTeammate:2306`) but currently unused — natural gate for
"inject grounding only on revival." Open question deferred to task 1b: whether the installed
`@anthropic-ai/claude-agent-sdk`'s `query()` `prompt` param accepts an `AsyncIterable` (same shape
already used for `streamInput`); if not, fall back to a `streamInput`-shaped follow-up call
immediately after `query()` starts, before the real prompt is delivered.

Risks (carried into briefs): (1) `emitTeammateMessageWhileIdle`/`drainAndFormatPendingTeammateMessages`
may batch multiple queued teammate messages into one delivered string — a per-message marker must
survive or apply per-segment if batched. (2) `deliverMessageToLead` vs `deliverRevivalFailure` are
distinguishable at the call site (both already known to the caller) — derive the marker there, not
by re-parsing string content downstream. (3) `TaskToolWidget.tsx` deliberately excludes teammate
spawns from its widget lookup — do not touch that exclusion as a side effect of building the new
condensation card.

## Decisions

- **D1 (pipeline):** Fix targets the canonical `ClaudeCodeRawParser`/TranscriptTransformer pipeline
  exclusively. The iOS-only `transformAgentMessagesToUI`/`isTeammateMessage` path is out of scope —
  it is a different, already-broken-independently surface; touching it risks an iOS regression this
  PRD has no way to test.
- **D2 (marker mechanism):** New optional parameter threaded through `sendMessageHandler` down to
  the raw-message write, not a regex/string-content sniff downstream. Distinguishes
  `deliverMessageToLead` from `deliverRevivalFailure` at the source.
- **D3 (condensation UI):** Extend the existing `<details>`/`<summary>` in-list collapse pattern in
  `RichTranscriptView.tsx` (re-gated on the new canonical-path marker) rather than building a
  second-fetch widget (`TaskToolWidget` family) — content is already resident in `messages`, and
  the `TaskToolWidget` family explicitly excludes teammates by design.
- **D4 (Bug C mechanism):** Try `query()` prompt-as-AsyncIterable first (matches existing
  `createInjectedUserMessageStream` primitive); fall back to a `streamInput` follow-up if SDK types
  disallow. Implementer's call, made and documented in task 1b's commit, not gated back to the
  user — this is a routine SDK-capability check, not a product decision.
- **D5 (no-PR execution):** Consistent with PRD 006/007/008 and this session's explicit instruction:
  no `gh pr create` anywhere. Coordinator merges task branches into
  `feature/teammate-wake-transcript-integration` locally, runs `npm run typecheck && npm run
  test:prepush` itself after every task (visible output required — no trusting a worker's claim),
  and stops at ready-for-merge; final `git merge --ff-only` to `main` per this session's explicit
  instruction to proceed through to a fully-merged state.

## Scope

In scope: the three bugs above, confined to the files named in Research/task briefs. Out of scope:
the iOS-only transcript path, the `TaskToolWidget` teammate exclusion, any change to
`TeammateTileRail`/`TeammateThreadPopover`'s own side-rail surfaces (they already work correctly —
this PRD is about the LEAD's mainline view only).

## Success Criteria

1. A teammate wake message or revival-failure notice in the lead's mainline transcript never
   renders under a "You" header.
2. The wake message and its associated shutdown-handshake plumbing (SendMessage/shutdown_response
   tool calls and results) render as a single collapsed card in the lead's mainline, expandable on
   click, consistent with the existing teammate-thread condensation pattern.
3. Reviving a teammate that ended via an approved shutdown handshake does not produce a
   next-turn response confused about "already shut down" — the model receives grounding that the
   revival is deliberate and new.
4. All new behavior ships with red-first unit tests per this repo's CLAUDE.md testing rule; no
   presentation-only tests, no barrel-mocking `@nimbalyst/runtime`.

## Known false positives to exclude from pass/fail judgment

`AgentTranscriptPanel.listenerCleanup.test.tsx`, `MarkdownRenderer.rtl.test.tsx` (jsdom
localStorage), `BodyDocCache.remountPaint.test.ts` (flaky under load — rerun isolated before
treating as real).
