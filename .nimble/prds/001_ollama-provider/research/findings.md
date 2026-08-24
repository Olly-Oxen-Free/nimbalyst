# Research Findings — Ollama Chat Provider

## Live environment check

Ollama daemon confirmed running: `http://localhost:11434`, version `0.24.0`.
Models loaded: `qwen3:14b`, `gemma3:12b`, `deepseek-coder:1.3b`, `qwen2.5:0.5b`, `qwen2.5-coder:14b`.
`/api/tags` and `/api/version` both respond. Server has an OpenAI-compatible shim at
`/v1/chat/completions` + `/v1/models` alongside its native `/api/chat` + `/api/tags`.

## Codebase pattern: chat providers vs agent providers

`docs/AI_PROVIDER_TYPES.md` splits providers into agent providers (MCP, file tools, session
resume — Claude Agent, Codex, OpenCode, Copilot CLI) and chat providers (direct API, document
context, no tool loop beyond the base class's own tool-calling — Claude Chat, OpenAI, LM Studio).
Ollama belongs in the chat-provider category: local, HTTP, no MCP/file-agent loop needed.

## Template: LMStudioProvider

`packages/runtime/src/ai/server/providers/LMStudioProvider.ts` is the closest existing
implementation — a local, OpenAI-compatible HTTP chat provider extending `BaseAIProvider`.
Key shape to replicate:

- `initialize(config)` hits `GET {baseUrl}/v1/models`, resolves the first available model into
  `this.resolvedModel`, throws a clear connection error on failure (ECONNREFUSED / fetch failed).
- `sendMessage(...)` builds an OpenAI-style `messages[]` array (system/user/assistant/tool roles,
  image attachments as `image_url` content parts), POSTs to `{baseUrl}/v1/chat/completions` with
  `stream: true` and `stream_options: { include_usage: true }`, and parses SSE `data:` lines,
  handling both `delta.content` and `delta.tool_calls` (OpenAI streaming tool-call format) via
  `this.executeToolCall` / `this.toolHandler`.
- `getCapabilities()`: `{ streaming: true, tools: true, mcpSupport: false, edits: true,
  resumeSession: false, supportsFileTools: false }`.
- `getAgentCapabilities()` returns `BUILTIN_AGENT_CAPABILITIES.lmstudio` (currently
  `NO_AGENT_CAPABILITIES`).
- Static `getModels(baseUrl)` / `getDefaultModels()` / `getDefaultModel()` for model discovery,
  used by `ModelRegistry`.

`LMStudioProvider` does have a test file — `packages/runtime/src/ai/providers/__tests__/LMStudioProvider.test.ts`
— but it's an env-gated live-daemon integration test (`describe.skipIf(!runLmStudioIntegration)`,
gated on `RUN_LMSTUDIO_INTEGRATION=1`), not a mocked-fetch unit test. There is no unit test to
copy structurally. The Ollama provider's test (`packages/runtime/src/ai/providers/__tests__/OllamaProvider.test.ts`)
is the first mocked-fetch unit test for this provider shape — do not clone the LM Studio
integration test and call it coverage.

## Registration touch points (grep-verified)

Runtime (`packages/runtime/src/ai/server/`):
- `types.ts:193` — `AI_PROVIDER_TYPES` array (also implicitly governs `isAgentProvider()`, which
  is allow-list based — omitting `ollama` from the agent list is sufficient to keep it a chat
  provider).
- `ProviderFactory.ts:79` — `case 'lmstudio':` construction branch.
- `ModelRegistry.ts:79,108,126,171` — `shouldFetch('lmstudio')`, `getModelsForProvider('lmstudio',
  undefined, apiKeys['lmstudio_url'])` dynamic-discovery wiring.
- `agentCapabilities.ts:80` — `lmstudio: NO_AGENT_CAPABILITIES` map entry.

Electron (`packages/electron/src/`):
- `shared/settings/keys.ts` — `ai.provider.lmstudio` (ProviderConfigSchema, default `{ enabled:
  false, baseUrl, testStatus: 'idle' }`) and `ai.apiKey.lmstudio_url` (bare string setting).
- `main/services/ai/AIService.ts` — by far the largest surface: default provider-settings shape,
  `getApiKeyForProvider` (`'not-required'` sentinel, no `process.env` fallback — see CLAUDE.md
  hard rule), `hasAnyProviderConfigured`, connection test (`fetch {baseUrl}/v1/models`), init
  config baseUrl resolution, `CHAT_PROVIDERS` literal arrays (appears twice, lines ~4109 and
  ~4403 — both need `'ollama'` added), persisted-settings write path, extension completion
  provider resolution.
- `main/services/ai/MessageStreamingHandler.ts` — API-key bypass (`'not-required'`), baseUrl
  injection on reinit/refresh, provider-array membership checks (`['claude', 'openai',
  'lmstudio']`) used for model-change detection and to distinguish "has canonical transcript"
  agent providers from chat providers.
- `renderer/store/atoms/appSettings.ts`, `renderer/components/Settings/SettingsView.tsx`,
  `SettingsSidebar.tsx`, `settingsRoutes.ts`, `panels/ProjectAIProvidersPanel.tsx` — settings UI
  surface (panel, sidebar entry, route).
- `renderer/components/UnifiedAI/ModelSelector.tsx`, `renderer/utils/modelUtils.ts`,
  `renderer/utils/chatProviderVisibility.ts` — model picker and provider-visibility gating.
- `renderer/services/aiApi.ts`, `renderer/electron.d.ts`, `preload/index.ts` — IPC-typed API
  surface exposed to the renderer.
- `renderer/components/ApiKeyDialog/ApiKeyDialog.tsx` — only referenced for an external "get
  LM Studio" link; Ollama's equivalent (if any) is a doc link, not a real API-key flow.

**Correction**: LM Studio is *not* fully keyless at the settings-storage level. `ai.apiKey.lmstudio_url`
is a real stored setting (`keys.ts:167`, default `http://127.0.0.1:8234`), read by `ModelRegistry.ts:126`
and `chatProviderVisibility.ts:64`. It's a URL filed under the `apiKeys.*` namespace, not a secret
— but it must exist. Ollama needs the matching `ai.apiKey.ollama_url` setting; skipping it leaves
`apiKeys['ollama_url']` permanently `undefined` and silently degrades model discovery.

Existing tests that assert on `lmstudio` membership and will need an `ollama` counterpart or
updated fixture list: `renderer/components/Settings/__tests__/settingsRoutes.test.ts`,
`renderer/components/UnifiedAI/__tests__/modelPickerKeyboard.test.tsx`,
`renderer/utils/__tests__/chatProviderVisibility.test.ts`. `main/services/ai/__tests__/aiServiceUtils.test.ts`
turned up in the grep but its only `lmstudio` reference is a comment — verify before editing,
don't touch it just because it matched.

Additional touch points found during review, missed on first pass: `main/services/SyncManager.ts`
(mobile model-sync `enabledSet`/`modelsConfig.lmstudio_url` — needed or Ollama models never reach
the mobile app), `packages/runtime/src/ai/modelConstants.ts` (`DEFAULT_MODELS` map),
`packages/runtime/src/ui/icons/MaterialSymbol.tsx` (provider icon), `packages/runtime/src/ui/AgentTranscript/components/RichTranscriptView.tsx`
(provider display name, has a safe `default:` fallback), and the runtime barrel export
`packages/runtime/src/ai/server/index.ts` (`export * from './providers/LMStudioProvider'` — the
new provider needs the same line or nothing in `packages/electron` can import it). The new
Electron-side settings panel is `GlobalSettings/panels/LMStudioPanel.tsx`'s counterpart, not
`ProjectAIProvidersPanel.tsx` (that one is the per-project override, a separate surface).

## Decision: transport

OpenAI-compatible shim (`/v1/chat/completions`, `/v1/models`), not Ollama's native API. User's
call: reuse LM Studio's already-proven streaming/tool-call parser near-verbatim instead of
writing a new NDJSON parser for `/api/chat`. Traded away: `keep_alive` (model residency control)
and `options.num_ctx` (context-window override), neither of which the OpenAI shim exposes.

**Follow-up flagged, out of scope for this PRD**: the user runs Ollama as a shared local-inference
daemon for more than Nimbalyst (a voice assistant, search functionality). Multiple independent
consumers competing for model residency on one daemon without `keep_alive` control can cause
model-swap thrashing. Not addressed here — only relevant if it shows up in practice.

## Coding-agent capability: OpenCode bridge, not a bespoke agent-provider

User requirement: Ollama models must be usable as coding agents, not just chat. The chat provider
above is intentionally chat-only (matches `lmstudio`'s capability profile: no MCP, no file tools)
— it does not satisfy this on its own.

Considered and rejected: a bespoke `OllamaAgentProvider` extending `BaseAgentProvider` directly.
Every existing agent provider (`ClaudeCodeProvider`, `OpenAICodexProvider`, `OpenCodeProvider`,
`CopilotCLIProvider`) wraps an external CLI/SDK that already implements its own agent loop
(tool execution, permission lifecycle, file-edit application, session resume). Ollama has no such
thing — it is a bare inference endpoint. Building this from scratch means reimplementing MCP
wiring, the permission request/response lifecycle, trust-check integration, and a new transcript
raw-message parser, none of which Ollama gives you for free.

Found instead: `packages/electron/src/main/services/OpenCodeConfigService.ts` already has
`upsertLMStudioBridge()` (line 159) / `removeLMStudioBridge()` (line 186) — OpenCode (a full agent
provider already in this codebase) supports pointing its own agent loop at any local
OpenAI-compatible server via the generic `@ai-sdk/openai-compatible` npm adapter, written into
`~/.config/opencode/opencode.json` as a `provider.<key>` block. The file's own header comment
(line 33, referencing issue #284) already names Ollama as a config real users have hand-written
into `opencode.json` successfully — this is a known-working pattern, not a novel one.

Full wiring chain for the LM Studio bridge (to mirror for Ollama):
`OpenCodeConfigService.upsertLMStudioBridge()` → IPC handler `opencode-config:upsert-lmstudio` in
`OpenCodeConfigHandlers.ts` (which also does model auto-discovery via a `fetchLMStudioModels()`
helper) → `OpenCodePanel.tsx`'s dedicated LM Studio section (base URL field, connect/disconnect
buttons, bridge-active status, model group in the picker). No preload/`electron.d.ts` typing
needed — the panel calls `window.electronAPI.invoke('opencode-config:upsert-lmstudio', ...)`
directly with an untyped channel string.

No unit test exists for `upsertLMStudioBridge`/`removeLMStudioBridge` themselves — only
`OpenCodeConfigService.paths.test.ts`, which covers unrelated config-path-resolution logic. The
Ollama bridge's test will be the first of its kind for this pattern too.

Model discovery for the bridge should use Ollama's native `/api/tags` (always present,
authoritative), not `/v1/models` — even though the bridge itself talks to Ollama via the OpenAI
adapter, `/api/tags` is the more reliable listing endpoint and doesn't depend on the OpenAI-compat
shim being enabled.

## Default base URL

`http://localhost:11434` (Ollama's standard port), following the same per-provider
`baseUrl` config pattern as LM Studio's `http://127.0.0.1:8234` default.
