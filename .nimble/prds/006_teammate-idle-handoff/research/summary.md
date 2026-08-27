# Research Summary — teammate-idle-handoff

Three sibling bugs around one seam: the teammate running→idle transition drops the handoff to
the lead. Live evidence: session c29787e7, teammate weatherman (haiku), 2026-08-27.

1. **Bug 1 — lead duplicates teammate work.** Continuation prompt (ClaudeCodeProvider.ts:2465)
   says "or take other actions as needed"; the lead redid the teammate's task three times.
   Fix: wording only (no hide mechanism exists — T8).
2. **Bug 2 — silent handoff drop / stuck session.** handleStreamCompletion's idle branch
   (TeammateManager.ts:1542-1549) never notifies the lead; abandonIdleTeammates no-ops when
   exhaustion races the idle transition. Weatherman never called SendMessage (transcript
   proof) and its real answer was dropped. Fix: mirror the background-agent pattern — on idle
   with !sentMessageToLead, deliverMessageToLead with an idle notice wrapping
   capturedResultText. Verified deliverable end-to-end live-process (T2); fields already
   populated for teammates (T1); latch-safe (T3); spam-guarded (T4).
3. **Bug 3 — Error status + 0 tool calls.** killAll (called from abort(), not a sweep) blanket
   emits 'errored' for idle teammates; idle metadata entries omit toolCallCount/lastActiveAt;
   resume resets toolCallCount. Fix: emit 'completed' for idle in killAll (matching
   stop/stopByAgentId), carry toolCallCount/lastActiveAt through the idle entry and resume.

Open risks: teammate with no final text has nothing to deliver (bare idle notice fallback);
zero existing test coverage on killAll/continuations (greenfield tests); post-restart+idle
combination out of scope (unreachable today per PRD 003 notes).
