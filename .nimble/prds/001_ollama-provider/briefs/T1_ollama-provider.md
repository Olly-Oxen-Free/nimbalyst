# Task Brief: T1

**Title:** Ollama runtime chat provider
**PRD:** ollama-provider
**Priority:** must
**Complexity:** 5/10
**Model:** opus
**Wave:** 1
**Feature Issue:** None — this PRD has no GitHub issue. Existing tracker item `tsk_mt3lum1zoerbrt` (aven) is updated on completion; no new tracker item is filed for this task.

---

## Objective

Add a new `ollama` chat provider to the runtime AI-provider system, modeled almost line-for-line on the existing `LMStudioProvider`, so Nimbalyst can chat against a local Ollama daemon (default `http://localhost:11434`) with no API key. This task must leave the repo fully typecheck-green on its own — it is Wave 1, has no dependencies, and T2a/T2b (Electron wiring) build on top of it in later waves.

---

## Context

**Parent Feature:** Ollama Chat Provider (PRD: `ollama-provider`, tracker item `tsk_mt3lum1zoerbrt`). No GitHub issue exists for this PRD in this run — do not invent an issue number.

The user runs a local Ollama server (confirmed live at `http://localhost:11434`, v0.24.0, 5 models loaded: `qwen3:14b`, `gemma3:12b`, `deepseek-coder:1.3b`, `qwen2.5:0.5b`, `qwen2.5-coder:14b`) as their local-inference backend — also used by a voice assistant and search tooling outside this repo. They want Nimbalyst able to chat against it without an API key or cloud billing, closing the same gap `lmstudio` already closes for LM Studio users.

Secondary motivation: once `ollama` is a registered `AIProviderType`, the existing `create_session` MCP tool (provider-agnostic child-session dispatch) can dispatch a subtask from a Claude-backed session to a local Ollama model — `create_session({ provider: 'ollama', model: 'ollama:<tag>', ... })` — with no new plumbing, because `ModelIdentifier.create()` validates providers generically against `AI_PROVIDER_TYPES`.

**`ollama` is a chat provider, not an agent provider** — no MCP, no file tools, same capability profile as `lmstudio`. Real coding-agent capability for Ollama comes from a separate, independent task (T3, the OpenCode-Ollama bridge) — do not conflate the two. This task's job is exclusively the chat provider and its registration.

This task is part of **Wave 1** — it runs in parallel with T3 (OpenCode-Ollama bridge, no file overlap, no dependency). T2a (Electron main-process wiring) depends on this task; T2b (Electron settings UI) depends on T2a.

---

## Research Context

### Patterns to Follow

- **Template provider:** `packages/runtime/src/ai/server/providers/LMStudioProvider.ts` — the closest existing implementation: a local, OpenAI-compatible HTTP chat provider extending `BaseAIProvider`. Copy its shape near-verbatim; see Implementation Guidance below for exact behavior to replicate.
- **Chat vs agent provider split:** `docs/AI_PROVIDER_TYPES.md` — agent providers (MCP, file tools, session resume: Claude Agent, Codex, OpenCode, Copilot CLI) vs chat providers (direct API, no tool loop beyond the base class: Claude Chat, OpenAI, LM Studio). Ollama belongs in the chat-provider category.
- **Registration touch points (grep-verified, exact lines as of research):** `types.ts:193` (`AI_PROVIDER_TYPES`), `ProviderFactory.ts:79` (`case 'lmstudio':`), `ModelRegistry.ts:79,108,126,171` (`shouldFetch`, `getModelsForProvider`, `getDefaultModel`), `agentCapabilities.ts:80` (`lmstudio: NO_AGENT_CAPABILITIES`). Lines will shift slightly once earlier edits land — treat as "near this anchor," not exact.

### Known Issues to Address

- Adding `'ollama'` to `AI_PROVIDER_TYPES` makes two exhaustive object literals **outside this provider's own files** fail to typecheck: `AIService.ts`'s `enabledProviders: Record<AIProviderType, ...>` literal (~line 3724) and `modelConstants.ts`'s `DEFAULT_MODELS` map (~line 491). Both must be fixed in **this task**, not deferred to T2a — otherwise the repo is red between T1 landing and T2a merging. This was a reviewer-flagged blocker on the PRD.
- `LMStudioProvider` has **no unit test** to copy — only an env-gated live-daemon integration test (`describe.skipIf(!runLmStudioIntegration)`, gated on `RUN_LMSTUDIO_INTEGRATION=1`) in `packages/runtime/src/ai/providers/__tests__/LMStudioProvider.test.ts`. Do not clone that file's structure and call it coverage — `OllamaProvider.test.ts` must be a real mocked-`fetch` unit test, the first of its kind for this provider shape.

### Recommended Approach

- Reuse LM Studio's already-proven streaming/tool-call parser near-verbatim rather than writing a new parser. Transport is the OpenAI-compatible shim (`/v1/chat/completions`, `/v1/models`), not Ollama's native `/api/chat` NDJSON API — this is a deliberate PRD-level decision, not something to reconsider in this task. Traded away (out of scope): `keep_alive` residency control and `options.num_ctx`, neither of which the OpenAI shim exposes.
- Default base URL: `http://localhost:11434` (Ollama's standard port) — note this differs from LM Studio's default (`http://127.0.0.1:8234`); do not copy that literal.

### Dependencies

**File Dependencies:**
- `AIService.ts`'s `enabledProviders` literal is also touched more extensively by T2a (full settings wiring). This task adds only a minimal `ollama: { enabled: false }` stub entry — T2a replaces it with real wiring. Keep this task's diff to that one entry to minimize rebase conflict with T2a.

**Library Dependencies:** None — no new npm packages. Uses the built-in `fetch`/`AbortSignal` already used by `LMStudioProvider`.

---

## Requirements

Add `packages/runtime/src/ai/server/providers/OllamaProvider.ts`, extending `BaseAIProvider`, modeled on `LMStudioProvider.ts`:

1. **`initialize(config)`** — connection-tests against `baseUrl` (default `http://localhost:11434`) via `GET /v1/models`; resolves the first available model into `this.resolvedModel`; throws a clear, actionable error when the daemon is unreachable (map `ECONNREFUSED` / `fetch failed` to a human-readable message telling the user to start Ollama and load a model) or when it's reachable but has zero models loaded.
2. **`sendMessage(...)`** — streams SSE chat completions from `POST /v1/chat/completions` with the same OpenAI-style `messages[]` construction (system/user/assistant/tool roles, image attachments as `image_url` content parts), the same `delta.content` / `delta.tool_calls` streaming-tool-call handling (including the `streamContent` incremental-streaming special case), and the same `this.executeToolCall` / `this.toolHandler` dispatch as `LMStudioProvider`.
3. **`getCapabilities()`** returns exactly: `{ streaming: true, tools: true, mcpSupport: false, edits: true, resumeSession: false, supportsFileTools: false }`.
4. **`getAgentCapabilities()`** returns `BUILTIN_AGENT_CAPABILITIES.ollama`.
5. **Static `getModels(baseUrl)` / `getDefaultModels()` / `getDefaultModel()`** for dynamic model discovery, used by `ModelRegistry`.

Register the new provider across every touch point below (see Files to Modify and Implementation Guidance for exact anchors):

- `types.ts` — add `'ollama'` to `AI_PROVIDER_TYPES`. **Do NOT** add it to any agent-provider allow-list — it stays a chat provider.
- `ProviderFactory.ts` — add a construction case.
- `ModelRegistry.ts` — wire dynamic discovery (`shouldFetch`/`getModelsForProvider`/`getDefaultModel`), keyed on `apiKeys['ollama_url']`, mirroring the `lmstudio_url` pattern.
- `agentCapabilities.ts` — add `ollama: NO_AGENT_CAPABILITIES`.
- `server/index.ts` — export the new provider from the runtime barrel so `packages/electron` can import it.
- `modelConstants.ts` — add an `ollama` entry to `DEFAULT_MODELS` alongside `lmstudio`.
- `AIService.ts` — add a minimal `ollama: { enabled: false }` entry to the `enabledProviders` exhaustive literal (T2a fills in the real wiring around it later).

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] `OllamaProvider.initialize()` throws a clear error when the daemon is unreachable, and resolves a real model list when it is — verified live against `http://localhost:11434`.
- [ ] `ProviderFactory.createProvider('ollama', ...)` returns an `OllamaProvider` instance, and `BUILTIN_AGENT_CAPABILITIES.ollama === NO_AGENT_CAPABILITIES`.
- [ ] Unit tests in `OllamaProvider.test.ts` stub `global.fetch` only (no `vi.mock('@nimbalyst/runtime', ...)` — import from the deep path, not the barrel) and cover: successful model discovery, connection failure, and a streamed chat completion with a tool call. File starts with `// @vitest-environment node`.
- [ ] `npm run typecheck` passes repo-wide, with only this task's changes applied (before T2a/T2b exist) — the `enabledProviders` and `DEFAULT_MODELS` fixups are what make this true.
- [ ] Manual verification: from a Claude-backed session, `create_session({ provider: 'ollama', model: 'ollama:<a loaded tag>', prompt: '...' })` successfully spins up a working child session that streams a real response from the local daemon — confirms cross-provider subagent dispatch (Claude orchestrator → local Ollama model) end-to-end, not just that `OllamaProvider` works in isolation.

**All criteria must pass before task is complete.**

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/runtime/src/ai/server/providers/OllamaProvider.ts` | create | New chat provider, modeled on `LMStudioProvider.ts` |
| `packages/runtime/src/ai/providers/__tests__/OllamaProvider.test.ts` | create | First mocked-`fetch` unit test for this provider shape |
| `packages/runtime/src/ai/server/index.ts` | modify | Add `export * from './providers/OllamaProvider';` alongside the `LMStudioProvider` export (line 12) |
| `packages/runtime/src/ai/server/types.ts` | modify | Add `'ollama'` to `AI_PROVIDER_TYPES` (line 193) |
| `packages/runtime/src/ai/server/ProviderFactory.ts` | modify | Import `OllamaProvider`; add `case 'ollama':` construction branch (alongside `case 'lmstudio':`, ~line 79) |
| `packages/runtime/src/ai/server/ModelRegistry.ts` | modify | Add `case 'ollama':` in `getModelsForProvider` (~line 79), `if (shouldFetch('ollama'))` in `getAllModels` (~line 126), `case 'ollama':` in `getDefaultModel` (~line 171) |
| `packages/runtime/src/ai/server/agentCapabilities.ts` | modify | Add `ollama: NO_AGENT_CAPABILITIES,` to `BUILTIN_AGENT_CAPABILITIES` (~line 80, grouped with the other chat providers) |
| `packages/runtime/src/ai/modelConstants.ts` | modify | Add `ollama: 'ollama:local-model',` to `DEFAULT_MODELS` (~line 491, alongside `lmstudio`) |
| `packages/electron/src/main/services/ai/AIService.ts` | modify | Add minimal `'ollama': { enabled: false }` entry to the `enabledProviders` exhaustive literal (~lines 3724–3769) — nothing more |

### File Ownership Notes

`AIService.ts`'s `enabledProviders` literal is shared with T2a, which replaces this task's minimal stub entry with full settings-backed wiring (base URL, connection test, `models`/`hiddenModels`). Keep this task's edit to exactly the one stub entry described above — do not add `baseUrl` resolution, `modelsConfig`, or any `apiKeys['ollama_url']` reads here, that's T2a's surface and expanding scope here increases merge/rebase risk with T2a. `AIService.ts` also falls under this repo's `require_review` boundary (`packages/electron/src/main/**`) — see Boundaries below.

---

## Implementation Guidance

### Patterns to Follow

Replicate `LMStudioProvider.ts` (`packages/runtime/src/ai/server/providers/LMStudioProvider.ts`) near-verbatim, with these substitutions:

- Provider name string: `'ollama'` everywhere `LMStudioProvider` uses `'lmstudio'` — including every `this.logAgentMessage(sessionId, 'lmstudio', ...)` and `this.logError(sessionId, 'lmstudio', ...)` call. Log prefixes (`console.log('[LMStudio] ...')`) should read `[Ollama]` for consistency, though this is cosmetic.
- `baseUrl` default: `'http://localhost:11434'` (not LM Studio's `'http://127.0.0.1:8234'`).
- `static readonly DEFAULT_MODEL = 'ollama:local-model';` (mirrors `LMStudioProvider.DEFAULT_MODEL = 'lmstudio:local-model'`, and must match the value you add to `modelConstants.ts`'s `DEFAULT_MODELS.ollama`).
- `initialize(config)`: `GET {baseUrl}/v1/models`, `AbortSignal.timeout(5000)`, resolve `this.resolvedModel = data.data[0].id`, throw a clear connection error mapping `error.cause?.code === 'ECONNREFUSED'` / `error.message?.includes('fetch failed')` to a message telling the user Ollama must be running with a model loaded (`ollama pull <model>` / `ollama run <model>`), and throw a distinct clear error if the daemon responds but `data.data.length === 0`.
- `sendMessage(...)`: identical `apiMessages` construction (system prompt, prior `messages[]` with tool/user/assistant role handling and image attachments as `image_url` parts), identical request body (`stream: true`, `stream_options: { include_usage: true }`, `tools: this.getToolsInOpenAIFormat()`, `tool_choice: 'auto'`), identical SSE `data:` line parsing loop including the `streamContent` incremental-streaming branch (partial-buffer JSON extraction) — this logic is intricate; copy it structurally rather than reimplementing, since Ollama's OpenAI-compat shim emits the same delta shape.
- `abort()` / `this.abortController` pattern: copy verbatim.
- `getCapabilities()`, `getAgentCapabilities()` (`BUILTIN_AGENT_CAPABILITIES.ollama`), `destroy()`, `buildSystemPrompt()`: copy verbatim, substituting the provider name.
- Static `getModels(baseUrl)`: `GET {baseUrl}/v1/models`, map via `ModelIdentifier.create('ollama', model.id).combined`, `provider: 'ollama' as const`; on failure, return `this.getDefaultModels()` (empty array, matching LM Studio's behavior — do not hardcode fallback model names).

### Registration — exact call sites

1. **`types.ts:193`** — add `'ollama'` to the `AI_PROVIDER_TYPES` tuple (position doesn't affect behavior; grouping it near `'lmstudio'` aids readability).
2. **`ProviderFactory.ts`** — `import { OllamaProvider } from './providers/OllamaProvider';` at the top; add `case 'ollama': provider = new OllamaProvider(); break;` in the `createProvider` switch, alongside `case 'lmstudio':` (~line 79).
3. **`ModelRegistry.ts`** — three separate spots:
   - `getModelsForProvider` switch (~line 79): `case 'ollama': const { OllamaProvider } = await import('./providers/OllamaProvider'); models = await OllamaProvider.getModels(baseUrl || 'http://localhost:11434'); break;`
   - `getAllModels` (~line 126): `if (shouldFetch('ollama')) promises.push(this.getModelsForProvider('ollama', undefined, apiKeys['ollama_url']));`
   - `getDefaultModel` switch (~line 171): `case 'ollama': const { OllamaProvider } = await import('./providers/OllamaProvider'); return OllamaProvider.getDefaultModel();`
4. **`agentCapabilities.ts`** (~line 80) — add `ollama: NO_AGENT_CAPABILITIES,` to `BUILTIN_AGENT_CAPABILITIES`, grouped under the existing "Chat providers: no agent surfaces at all" comment alongside `claude`, `openai`, `lmstudio`.
5. **`modelConstants.ts`** (~line 491) — add `ollama: 'ollama:local-model',` to the `DEFAULT_MODELS` map alongside `lmstudio`.
6. **`server/index.ts`** (~line 12) — add `export * from './providers/OllamaProvider';` alongside `export * from './providers/LMStudioProvider';`.
7. **`AIService.ts`** (~lines 3724–3769) — add `'ollama': { enabled: false },` to the `enabledProviders` literal, matching the shape of the other minimal (no-API-key) entries like `'opencode'` or `'copilot-cli'`. Do not add `baseUrl`/`modelsConfig` handling — see File Ownership Notes.

### Code Style

Match the existing file's conventions exactly: `console.log`/`console.error` with a bracketed provider-name prefix, `any` types for loosely-shaped OpenAI wire-format objects (as `LMStudioProvider` does), no new abstractions or refactors of the copied logic. This is a "clone and substitute the provider name" task — do not "improve" the streaming parser while porting it.

### Edge Cases

- Unreachable daemon → clear, actionable thrown error (see above).
- Daemon reachable but zero models loaded → clear, distinct thrown error (mirrors LM Studio's "no model loaded" case).
- Empty message passed to `sendMessage` → throw (mirror LM Studio's `Cannot send empty message`).
- `AbortError` during streaming → yield a `complete` chunk with `isComplete: true`, do not surface as an error (mirror LM Studio's `abort()`/catch-block handling).
- Streamed tool-call JSON that arrives in partial chunks → accumulate in a buffer and only parse/dispatch once complete (copy the existing accumulation loop, including the `streamContent` special-cased incremental-streaming path).

### Testing Requirements

New file: `packages/runtime/src/ai/providers/__tests__/OllamaProvider.test.ts`.

- First line: `// @vitest-environment node` (this test never touches the DOM).
- Import `OllamaProvider` via the deep path (`../../server/providers/OllamaProvider` or via `../../server/ProviderFactory`, as `LMStudioProvider.test.ts` does) — **never** `from '@nimbalyst/runtime'`. The barrel drags in the full Lexical editor tree (~2.6s/file) that `OllamaProvider` (extending `BaseAIProvider`) doesn't need.
- Stub `global.fetch` directly (e.g. `vi.spyOn(global, 'fetch')` or `vi.stubGlobal('fetch', ...)`) — no mocking of `@nimbalyst/runtime` at all.
- Three required scenarios (exactly matching the acceptance criteria — do not skip any):
  1. **Successful model discovery** — mock a `200` response from `GET {baseUrl}/v1/models` with a models array; assert `OllamaProvider.getModels()` returns `AIModel[]` with `provider: 'ollama'` and IDs built via `ModelIdentifier.create('ollama', ...)`.
  2. **Connection failure** — mock `fetch` rejecting (simulate `ECONNREFUSED` / "fetch failed"); assert `initialize()` throws a clear, human-readable error.
  3. **Streamed chat completion with a tool call** — mock `fetch` resolving with a `ReadableStream` body emitting SSE `data:` lines that include a `delta.tool_calls` sequence followed by `data: [DONE]`; assert `sendMessage()` yields a `tool_call` chunk and a final `complete` chunk.
- Do not clone `LMStudioProvider.test.ts`'s `describe.skipIf(!runLmStudioIntegration)` live-daemon integration-test structure — that file has no unit-test shape to copy. This is the first mocked-`fetch` unit test for this provider shape in the repo.
- Any change to runtime behavior ships with a test per repo convention — this task's entire deliverable is new behavior, so full coverage of the three scenarios above is mandatory, not optional.

### Coverage Expectations

This task's `files_affected` includes a new test file (`__tests__/OllamaProvider.test.ts`), which triggers this section mechanically — note there is no upstream implementation task here; the target file is created within this same task.

**Target Files for Coverage:**

| File | Target | Rationale |
|------|--------|-----------|
| `packages/runtime/src/ai/server/providers/OllamaProvider.ts` | 80%+ | Core new implementation, built and tested within this task |

**Intentionally Uncovered Lines:**

- **Abort-mid-stream branch (`abort()` / `AbortError` catch path)** — not exercised by the three required scenarios (model discovery, connection failure, streamed tool call); would need a fourth in-flight-abort test not required by the acceptance criteria.
- **Image-attachment file-read branch** (`attachments` with `type: 'image'`, reading via `fs.readFile`) — requires filesystem fixtures; out of scope for the three specified test scenarios.
- **`streamContent` partial-buffer incremental-parsing branches** — the required tool-call test only needs to reach a complete tool call; the partial-buffer edge cases are copied verbatim from `LMStudioProvider`, which itself has no unit coverage of these branches either.

**Verification:**
```bash
npm run test:prepush -- --coverage
```

---

## Boundaries

### Files You MUST NOT Touch

- `node_modules/**`
- `dist/**`
- `out/**`
- `out2/**`
- `release/**`
- `.vite/**`

### Files Requiring Review

- `package.json`
- `package-lock.json`
- `packages/electron/src/main/**` — **this task touches `AIService.ts`, which falls under this pattern.** Flag it explicitly in the PR description; keep the diff to the single minimal stub entry described above.
- `packages/runtime/src/auth/jwtScopes.ts` — not touched by this task.
- `packages/electron/build/**`
- `CHANGELOG.md`

Do not add a `CHANGELOG.md` entry for this task alone: the `ollama` provider is not yet user-visible (no settings UI exists until T2b lands). A single user-facing CHANGELOG line for "Ollama chat provider" belongs with whichever task actually surfaces it in the UI — flag this for the PM/reviewer rather than adding a premature entry here.

---

## Dependencies

### Upstream Tasks

None — `depends_on: []`. This is a Wave 1 task with no prerequisites.

### Downstream Impact

- **T2a** ("Wire Ollama into the Electron main process") depends on this task. It needs `OllamaProvider`, the `AI_PROVIDER_TYPES` entry, and the `enabledProviders` stub in place before it can add settings-schema and full main-process wiring.
- **T2b** ("Wire Ollama into Electron settings UI and model picker") depends on T2a, transitively on this task.
- **T3** ("OpenCode-Ollama coding-agent bridge") has no dependency on this task and no file overlap — it can and does run in parallel (also Wave 1).

**Before starting:** No verification needed — this task has no dependencies and can start immediately.

---

## GitHub Context

**Issue:** None — this PRD has no GitHub issue in this run. Do not fabricate an issue number in commit messages.
**Feature Issue (Parent):** None. Existing tracker item `tsk_mt3lum1zoerbrt` is updated on completion instead.
**Branch:** `worktree/ollama-provider-T1`
**Target:** Determined by PM agent based on execution mode (feature branch or main)

---

## Deliverables

None beyond the files above.

---

## Commit Guidelines

Use Conventional Commits. Per this repo's `CLAUDE.md`, **do not** add a `Co-Authored-By` trailer to any commit — that is a hard repo-level rule that overrides generic template guidance.

```
feat(ai): add ollama chat provider and registration
```

Keep the subject to one sentence; use short bullet points in the body only for genuinely distinct changes (e.g. one bullet for the new provider, one for the `enabledProviders`/`DEFAULT_MODELS` typecheck fixups). No prose paragraphs. There is no GitHub issue to reference for this task — do not include a `Fixes #...` trailer.

Types: feat, fix, refactor, test, docs, chore.

---

## Validation Checklist

Before creating PR:
- [ ] All success criteria met
- [ ] Build passes: `npm run build`
- [ ] Type check passes: `npm run typecheck` (repo-wide, with only this task's changes applied)
- [ ] No `never_touch` files modified
- [ ] Tests added/updated: `OllamaProvider.test.ts` covers all three required scenarios
- [ ] `AIService.ts` diff is limited to the single minimal `enabledProviders.ollama` stub entry
- [ ] No `process.env` fallback introduced anywhere for Ollama config (repo hard rule)
- [ ] No `CHANGELOG.md` entry added for this task alone (feature isn't user-visible until T2b)
- [ ] Branch rebased on target branch (feature branch or main)

---

*Generated by NIMBLE Brief Writer*
*PRD: ollama-provider | Task: T1 | Wave: 1*
