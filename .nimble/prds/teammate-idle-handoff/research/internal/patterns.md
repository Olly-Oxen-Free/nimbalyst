Evidence pointers — see findings.md (consolidated). Key patterns to follow:
- deliverMessageToLead call convention: TeammateManager.ts:1564 (background result), :1981 (SendMessage routing), :2017 (approved shutdown), :1605 (PRD 003 resume-failure wake).
- Idle status emission precedent: stopByAgentId :2144-2152 and stop(name) :2172-2184 emit 'completed' for idle teammates (killAll :2108-2113 wrongly emits 'errored').
- Test mocking pattern: TeammateManager.stallWatchdog.test.ts (@vitest-environment node; narrow vi.mock of @anthropic-ai/claude-agent-sdk, AISessionsRepository, claudeConfigDir).
