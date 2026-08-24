---
feature_name: "Teammate Thread View"
feature_slug: "teammate-thread-view"
owner: "jeppcohen@gmail.com"
status: "draft"
created_date: "2026-08-24"
target_date: ""
phase: ""
scope_type: "follow-on"
github_project: ""
links: [".nimble/prds/001_agent-visibility"]
checkpoint_refs: []
cross_feature_blockers: []
---

## 1. Executive Summary

**One-liner:** Clicking a teammate's chip opens its real conversation — assistant turns, tool
calls, and thinking — backfilled from what Nimbalyst already recorded and updating live while the
teammate runs, with working intervention (message or stop) that survives an app restart.

**What's changing:** `TeammateThreadPopover.tsx` today is compose-only: name, status line,
textarea, Send button. After this ships, the popover becomes a transcript panel modeled on
`SessionTranscriptPeek.tsx` — full-fidelity turns rendered through the existing
`RichTranscriptView`, refreshed live via a small signal channel, with the compose box preserved.
Two intervention gaps close alongside: messaging an idle teammate works after a Nimbalyst restart
(today the resume pointer dies with the process), and a running teammate can be stopped from the
UI.

**Who it's for:** Anyone using Agent Mode who spawns teammates and currently cannot see what a
teammate said, thought, or did — the trust gap the merged `001_agent-visibility` PRD deliberately
scoped out.

**Done looks like:** Spawn a teammate, click its chip mid-run — its turns, tool calls, and
thinking appear and keep updating as it works. Let it go idle, restart Nimbalyst, reopen the chip
— full history is still there, and Send still reaches it (SDK resume). If a teammate runs away,
Stop halts it and the transcript shows where it stopped.

**Primary risk:** Transcript fidelity. Teammate chunks were persisted for bookkeeping, not
display — the projection path (`projectRawMessagesToViewMessages` + `ClaudeCodeRawParser`) was
built for mobile and has never been run over `_isTeammateOutput`-tagged chunks or the synthetic
`teammate_message_to_lead` entries. Task 1b owns making that projection genuinely readable
(tool_use/tool_result pairing, thinking blocks, lead-injected messages appearing as user turns),
not just "renders without crashing." Second risk: the restart-safe resume (task 1a) touches
provider instance state (`currentSessionId`, `lastUsedCwd`, `lastUsedPermissionsPath`) that is
only populated during a live lead query — the fix threads explicit values instead of widening
that implicit state, and the task's tests must cover the "two boots" case.

---

## 2. Problem & Context

**Problem statement:** The `001_agent-visibility` PRD shipped chips, blocked-status detection,
and click-to-message, but explicitly cut transcript rendering on the premise that teammates have
"no backing record." Direct investigation (research/findings.md) shows that premise is stale in
both directions:

1. **The record exists.** `TeammateManager.streamTeammateOutput` already logs every raw teammate
   chunk — assistant text, thinking, tool_use, tool_result — into the lead session's
   `ai_agent_messages` (`logNonBlocking(...)` with `messageType: 'teammate_output'`, tagged
   `_isTeammateOutput`/`_teammateAgentId`, `TeammateManager.ts:1737-1749`). It survives restart.
   `SessionManager.ts:397-421` deliberately suppresses these from the lead's visible stream; no
   code path reads them back for display.
2. **Intervention half-exists.** `ai:sendMessageToTeammate` → `sendMessageFromHost`
   (`TeammateManager.ts:1162-1187`) delivers to a running teammate (`streamInput`) and resumes an
   idle one (SDK `resume` with the captured session id) — but `idleTeammates` and
   `managedTeammates` are in-memory maps, so after a restart the Send button silently returns
   `{ delivered: false }`. There is also no way to stop a running teammate; only the internal
   stall watchdog can abort it.

**What happens if we don't build this:** Users can spawn teammates but cannot inspect or debug
them — the delegation trust case stays broken, and a stuck or runaway teammate can only be
observed via its status chip and killed by restarting the app (which also severs the idle-resume
pointer).

**Strategic fit:** Direct continuation of `001_agent-visibility`, same surface, deferred by that
PRD's own scoping. Target bar: parity with what native Claude Code gives you for its own spawned
agents — watch the work happen, read the full record, intervene mid-task.

---

## 3. Goals, Non-Goals & Success Metrics

### Goals

1. Opening a teammate's chip renders its actual conversation — assistant turns, tool calls with
   results, thinking — for running, idle, completed, and errored teammates alike.
2. The thread updates live while the teammate works (per-chunk cadence, debounced refresh).
3. Teammate history and idle-resume both survive a Nimbalyst restart.
4. A running teammate can be stopped from the popover.

### Non-Goals

- **SDK-native `Task` sub-agent transcripts.** `claudeCliSubAgentTracker.ts` hides those by
  design on the CLI-proxy path; Task chips stay read-only. Separate product decision, not
  revisited here.
- **Reading the SDK's on-disk JSONL transcripts** (`getSessionMessages`/`getSubagentMessages`).
  Teammates only ever run inside Nimbalyst, so the lead session's raw log already contains
  everything; a second read path off `~/.claude/projects/` would add a process-boundary concern
  (main-only filesystem read) for no additional data. The durable session id this PRD persists
  keeps that door open later.
- **Token-level streaming.** Live updates arrive per logged chunk (whole messages), not partial
  deltas — teammate queries don't enable `includePartialMessages` and this PRD doesn't change
  that.
- **`SDK_NATIVE_TOOLS` cleanup in `ClaudeCodeProvider.ts`.** Removing the stale
  `TeammateTool`/`TeamCreate`/`TeamDelete` entries would also change the meta-agent
  `disallowedTools`/`blockedTools` complement computed at `ClaudeCodeProvider.ts:913-920`.
  Not load-bearing for this feature; deliberately dropped rather than folded in as a drive-by.
- **A new DB table or migration.** The durable pointer rides in the already-persisted
  `metadata.currentTeammates` array.

### Success Metrics

| Metric | Baseline | Target | How Measured |
| ------ | -------- | ------ | ------------ |
| Teammate turns visible in popover | 0 (compose-only) | Full history incl. tool calls + thinking | Unit test on projection + manual spawn test |
| Live update latency while running | n/a | Within one debounce window (~1.5s) of chunk logging | Listener unit test + manual observation |
| Send to idle teammate after restart | Fails silently | Delivers via SDK resume | Rehydration unit test (write → reload → resume path resolves sessionId) |
| Stop a running teammate | Not possible | Halts within the current chunk; status → errored/stopped | Unit test on abort path |

---

## 4. Requirements

### Must Have (blocks launch)

| ID | Requirement | Acceptance Criteria |
| -- | ----------- | -------------------- |
| R1 | Durable teammate session id | `sessionId` is persisted on **every** `emitTeammateUpdate` path — the common map branch (`TeammateManager.ts:1281-1300`, incl. `activityFields` and the idle transition) and both push literals (`:1302-1329`) — plus the inline row type at `:1268-1278` and the `TeammateInfo` type; a teammate first emitted while running still ends up with `sessionId` persisted after capture and after going idle; readable after a full restart |
| R2 | Idle-resume survives restart | When both in-memory maps miss, `sendMessageFromHost` lazily resolves the teammate from persisted `currentTeammates` (reusing the `AISessionsRepository.get` read at `:1264-1265`) and takes the existing `resumeIdleTeammate` path — with the lead `sessionId` threaded explicitly from the IPC handler (no reliance on `ClaudeCodeProvider.currentSessionId`, which is unset post-restart) and `lastUsedCwd`/`lastUsedPermissionsPath` seeded from the session record, so the resumed run logs its chunks and runs in the right cwd |
| R3 | Main-process transcript read | A new IPC handler (invoke-style, e.g. `ai:getTeammateTranscript(sessionId, agentId, workspacePath)`) filters the lead session's raw `ai_agent_messages` on `_teammateAgentId` and returns `TranscriptViewMessage[]` produced through the existing raw-message projection path (`projectRawMessages.ts`), never a bespoke shape; the renderer never touches the filesystem or DB directly |
| R4 | Projection fidelity | The returned messages render assistant text, thinking blocks, and paired tool_use/tool_result cards through `RichTranscriptView`; messages the lead/user injected into the teammate (`[Message from team-lead]` user chunks) appear as user turns; synthetic `teammate_message_to_lead` entries are represented legibly, not dropped or crashed on |
| R5 | Live update signal | A lightweight main→renderer event (e.g. `teammate:transcript-updated { sessionId, agentId }`) fires when a teammate chunk is logged, forwarded through a centralized listener into a Jotai signal atom per `docs/IPC_LISTENERS.md` (components never subscribe to IPC directly), debounced like `SessionTranscriptPeek`'s 1.5s refresh |
| R6 | Popover renders the thread | `TeammateThreadPopover.tsx` becomes a transcript panel modeled on `SessionTranscriptPeek.tsx` — `RichTranscriptView` with fetched messages, refetch on the signal atom, a status header (name, status, model, started, tool-call count from `TeammateInfo`), sized for reading — with the transcript visible for **all** statuses (running/idle/blocked/completed/errored), and the existing compose + Send path preserved when delivery is possible |
| R7 | Stop a running teammate | A Stop control in the popover (running/blocked teammates only) invokes a new IPC (`ai:stopTeammate(sessionId, agentId, workspacePath)`) plumbed to the **existing** `TeammateManager.stop()` (`:1915-1942`) via an agentId-exact overload that takes the lead `sessionId` explicitly (today's `stop()` leans on `lastUsedSessionId`, unset post-restart); the teammate halts, its status updates, and a user stop is distinguishable from a stall-watchdog abort |

### Should Have

| ID | Requirement | Acceptance Criteria |
| -- | ----------- | -------------------- |
| R8 | Graceful empty/degraded states | A teammate with no logged chunks yet shows an explicit "no activity yet" state (not an error); a completed/errored teammate shows its transcript with compose disabled or the existing inactive notice; pre-feature sessions (no persisted `sessionId`) still render their transcript (R3 doesn't need the id) and simply lose post-restart resume |

---

## 5. Architecture Notes (binding for implementers)

- **Single source of truth for transcript data** is the lead session's raw `ai_agent_messages`
  rows tagged `_teammateAgentId`. Do not add a second store, do not read SDK JSONL files.
- **Reuse, don't rebuild:** `projectRawMessagesToViewMessages`
  (`packages/runtime/src/ai/server/transcript/projectRawMessages.ts:101`) for projection —
  extend it/`ClaudeCodeRawParser` where teammate-specific chunk shapes need handling;
  `SessionTranscriptPeek.tsx` for the popover rendering pattern (`RichTranscriptView` + peek
  settings + debounced signal-driven refetch); `useFloatingMenu`/`FloatingPortal` stays.
- **Do not disturb the lead transcript.** `SessionManager.ts:397-421`'s suppression of teammate
  chunks from the lead's visible stream must keep working — the new read path filters *for*
  teammate chunks in a separate handler; it never changes what the lead view shows.
- **IPC conventions:** `safeHandle` for invoke handlers, `workspacePath` passed explicitly,
  preload + `electron.d.ts` updated, centralized listeners in `store/listeners/` for events.
- **Main-process files are under `require_review`** per `.nimble/config.yaml` — expected at the
  single end-of-work review, not a surprise.

---

## 6. Open Questions

- **Q1 (task 1b, open):** Does `ClaudeCodeRawParser.parseMessage` handle the tagged teammate
  chunks as-is (the `_isTeammateOutput` extras ride inside the stored JSON), or does the
  teammate projection need a pre-strip/normalize step? Resolve by running the parser over real
  logged chunks early in 1b, before building the handler around it. (Known good: teammate rows
  are written `hidden: false` — `BaseAgentProvider.ts:358` — so the `msg.hidden` early return
  does not eat them.)
- **Q2 (RESOLVED — lazy):** Rehydration is a lazy fallback inside `sendMessageFromHost`,
  reusing the `AISessionsRepository.get` read the same class already performs in
  `emitTeammateUpdate` (`TeammateManager.ts:1264-1265`). No eager provider-init seeding, no new
  deps accessor.
- **Q3 (RESOLVED — reuse `'errored'`):** A user-stopped teammate reuses the `'errored'`
  terminal status with a user-stop-distinguishing message; no new status value, so
  `subAgentStatus.ts` and the chip class/icon/label maps stay untouched.
