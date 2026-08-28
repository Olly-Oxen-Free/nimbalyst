# External Findings — agent-card-identity

External research skipped. This feature is a repo-internal UI consistency fix for two pre-existing rendering bugs in Nimbalyst's own transcript component (`RichTranscriptView.tsx`); no third-party library, framework API, or external best-practice question is in scope — the fix is deleting a `useEffect` and unifying two internal component headers using existing internal data (`message.subagent.model`, `sessionTeammatesAtom`). Mode: INTERNAL-ONLY per coordinator instruction.
