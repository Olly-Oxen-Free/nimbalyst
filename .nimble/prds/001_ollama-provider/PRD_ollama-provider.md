# PRD: Ollama Chat Provider

**Slug**: ollama-provider
**Status**: draft
**Tracker**: tsk_mt3lum1zoerbrt (existing task item — updated on completion, no new tracker item filed)

## Summary

Two independent additions, both against the local Ollama daemon confirmed live at
`http://localhost:11434` (v0.24.0, 5 models loaded):

1. **`ollama` chat provider** — a new local chat provider alongside the existing `lmstudio` chat
   provider, reusing the proven `LMStudioProvider.ts` shape almost line-for-line. Fast, no
   subprocess, no MCP/file tools — good for direct chat and for cross-provider dispatch (a
   Claude-backed session handing a cheap subtask to a local model via `create_session`).
2. **OpenCode-Ollama coding-agent bridge** — the mechanism that actually satisfies "usable as
   coding agents." OpenCode (already a full agent provider here — MCP, file tools, permissions,
   session resume) has a built-in bridge (`upsertLMStudioBridge`) for pointing its own agent loop
   at any local OpenAI-compatible server. Mirroring it for Ollama gives local models real
   coding-agent capability by reusing OpenCode's already-built harness, rather than building a new
   one from scratch.

**These are not interchangeable.** #1 alone does not make Ollama models usable as coding agents —
it is intentionally chat-only, matching `lmstudio`'s capability profile. #2 is what does.

## Why

The user runs a local Ollama server as their local-inference backend (also used by a voice
assistant and search tooling outside this repo) and wants Nimbalyst able to chat against it
without an API key or per-request cloud billing — closing the same gap `lmstudio` already closes
for LM Studio users.

Secondary motivation, confirmed feasible during planning: once `ollama` is a registered provider,
Nimbalyst's existing `create_session` MCP tool (provider-agnostic child-session dispatch, already
used for e.g. Claude-orchestrating-Codex) can dispatch a subtask from a Claude-backed session to a
local Ollama model (`create_session({ provider: 'ollama', model: 'ollama:<tag>', ... })`) with no
new plumbing — `ModelIdentifier.create()` validates providers generically against
`AI_PROVIDER_TYPES`. This is a chat-provider child session (no MCP/file tools), suited to cheap
classification/summarization/drafting subtasks, not file-editing work.

## Research Findings

See `research/findings.md`. Key points:

- Transport: Ollama's OpenAI-compatible shim (`/v1/chat/completions`, `/v1/models`), not its
  native `/api/chat` NDJSON API. Chosen to reuse `LMStudioProvider.ts`'s parser almost verbatim.
  Trade-off: no `keep_alive` / `options.num_ctx` control over the shared daemon.
- Default base URL: `http://localhost:11434`.
- `ollama` is a chat provider (not agent) — no MCP, no file tools, matches `lmstudio`'s
  capability profile.
- ~25 touch points across `packages/runtime/src/ai/server/` (provider registration, factory,
  model registry, agent-capabilities map, runtime barrel export) and `packages/electron/src/`
  (settings schema, AI service, message streaming handler, mobile sync, settings UI, model
  picker, provider-visibility logic, IPC/preload surface).
- LM Studio's `lmstudio_url` is a stored setting (URL under the `apiKeys.*` namespace, not a
  credential) — Ollama needs the matching `ollama_url` setting, not a "keyless, skip it" shortcut.
- `LMStudioProvider` has no *unit* test to copy — only an env-gated live-daemon integration test.
  This PRD's provider test is the first mocked-fetch unit test for this provider shape.
- Reviewed by `nimble:nimble-reviewer` before approval; four blockers found (missing settings
  panel, missing barrel export, the `ollama_url` contradiction above, and a typecheck-scoping gap
  that would leave the repo red after task 1 alone) — all fixed in `tasks.yaml` below, along with
  a 3-way task split (Electron's main-process and renderer wiring separated) since the original
  single Electron task under-counted ~25 file touch points.

## Scope

**Coding-agent capability**: satisfied by T3 (OpenCode-Ollama bridge), not by the chat provider.
Building a bespoke Ollama agent-provider (extending `BaseAgentProvider` directly, with its own
MCP wiring, permission lifecycle, and transcript parser) was considered and rejected: Ollama has
no equivalent of Claude Agent SDK or Codex's app-server to wrap, so that path means writing an
entire agent harness from scratch and duplicating what OpenCode already has hardened. Bridging
into OpenCode's existing harness is both less work and lower-risk.

**In scope:**
- New `OllamaProvider` class + full registration (types, factory, model registry, agent
  capabilities, runtime barrel export), independently typecheck-green.
- Electron main-process wiring (`AIService.ts`, `MessageStreamingHandler.ts`, `SyncManager.ts`
  mobile sync, settings schema incl. `ollama_url`, preload/IPC types).
- Electron settings UI (new `OllamaPanel.tsx`, settings routing/sidebar, model picker,
  provider-visibility detection logic — not just a list entry) and selectability as a
  chat-session provider.
- `upsertOllamaBridge()`/`removeOllamaBridge()` in `OpenCodeConfigService.ts`, IPC handlers, and
  an OpenCode settings panel section, mirroring the existing LM Studio bridge exactly.
- Unit tests for the new chat provider, the new bridge functions, and the touched Electron
  settings/visibility logic.
- Manual end-to-end verification against the live local Ollama server for both paths: a chat
  round-trip + model discovery (chat provider), and a real OpenCode agent session performing an
  actual file edit using an Ollama-backed model (coding-agent bridge) — per repo's
  end-to-end-verification rule.

**Out of scope:**
- Ollama's native API / NDJSON transport, `keep_alive` residency control, `num_ctx` overrides, for
  the chat provider.
- Any change to the voice assistant or search tooling that also use this Ollama daemon.
- A bespoke Ollama agent-provider extending `BaseAgentProvider` directly — superseded by the
  OpenCode bridge approach (see above).

## Tasks

See `tasks.yaml`. Four tasks:

- **T1** — chat-provider runtime + registration, independently typecheck-green. Wave 1.
- **T3** — OpenCode-Ollama coding-agent bridge. Independent of T1/T2a/T2b, no shared files. Wave 1
  (parallel with T1).
- **T2a** — Electron main process wiring for the chat provider (AIService, streaming handler,
  sync, settings schema). Depends on T1. Wave 2.
- **T2b** — Electron settings UI + model picker + provider-visibility logic for the chat provider.
  Depends on T2a. Wave 3.

## Acceptance Criteria

**Chat provider:**
1. `ollama` provider selectable in Settings → AI Providers with a configurable base URL
   (default `http://localhost:11434`).
2. Model list populates dynamically from the live Ollama server's `/v1/models`.
3. A chat session against `ollama` streams a real response from one of the loaded models
   (`qwen2.5-coder:14b` or similar) end-to-end in a running dev instance.
4. `create_session({ provider: 'ollama', model: 'ollama:<tag>', ... })` successfully dispatches
   from a Claude-backed session to a local model end-to-end.

**Coding-agent bridge:**
5. OpenCode's settings panel can connect/disconnect an Ollama bridge, mirroring the LM Studio one.
6. A real OpenCode agent session, backed by an Ollama model through the bridge, performs an actual
   file edit — proving MCP/file-tools work, not just that the config write succeeded.

**Both:**
7. `npm run typecheck && npm run test:prepush` pass.
8. No `process.env` fallback introduced for provider config (repo hard rule).
