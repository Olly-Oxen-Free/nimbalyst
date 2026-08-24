# Task Brief: T2a

**Title:** Wire Ollama into the Electron main process (settings, AIService, sync)
**PRD:** ollama-provider
**Priority:** must
**Complexity:** 4/10
**Model:** sonnet
**Wave:** 2
**Feature Issue:** none — this PRD is tracked in aven, not GitHub Issues (tracker item `tsk_mt3lum1zoerbrt`, reused from an existing task, no new tracker item filed)

---

## Objective

Make the `ollama` chat provider (added in T1 as a runtime class, but not yet reachable from any Electron main-process code path) actually usable: add its settings schema, wire it into `AIService.ts`'s provider-dispatch logic, extend `MessageStreamingHandler.ts`'s provider special-casing, and add it to the mobile model-sync path in `SyncManager.ts`. Every change here is "add `ollama` everywhere `lmstudio` is currently special-cased" — no new architecture, pure mirroring of an existing, proven pattern.

---

## Context

**Parent Feature:** Ollama Chat Provider PRD (`ollama-provider`, tracker `tsk_mt3lum1zoerbrt`) — no GitHub feature issue exists for this PRD.

The user runs a local Ollama daemon (confirmed live at `http://localhost:11434`, v0.24.0, 5 models loaded) as their local-inference backend, also used outside Nimbalyst by a voice assistant and search tooling. This PRD closes the same gap `lmstudio` already closes for LM Studio users: chat against a local model with no API key and no cloud billing.

T1 (already merged/complete — this task depends on it) added `packages/runtime/src/ai/server/providers/OllamaProvider.ts` and registered it in the runtime layer (`AI_PROVIDER_TYPES`, `ProviderFactory`, `ModelRegistry`, `agentCapabilities`, the runtime barrel export). T1 also added the *minimal* fixups needed to keep the repo typecheck-green in the interim: a stub `ollama: { enabled: false }` entry in `AIService.ts`'s `enabledProviders` literal, and an `ollama` entry in `modelConstants.ts`'s `DEFAULT_MODELS` map.

This task is part of **Wave 2** — it is the main-process wiring that turns the registered-but-inert runtime provider into something Electron's settings, connection-test, streaming, and mobile-sync code paths actually recognize. It runs after T1 (needs the `OllamaProvider` class and its `AI_PROVIDER_TYPES` membership to exist) and before T2b (Wave 3), which builds the settings *UI* on top of the `ai.apiKey.ollama_url` setting this task creates.

**Not part of this task:** the Electron settings UI panel, model picker, and `chatProviderVisibility.ts` logic (T2b, Wave 3), and the OpenCode coding-agent bridge (T3, independent, no file overlap).

---

## Research Context

Full detail in `.nimble/prds/001_ollama-provider/research/findings.md`. Task-relevant extracts:

### Patterns to Follow

- **Settings schema shape** — `packages/electron/src/shared/settings/keys.ts:132-136` (`ai.provider.lmstudio`, a `ProviderConfigSchema` with `{ enabled: false, baseUrl, testStatus: 'idle' }`) and `keys.ts:167-171` (`ai.apiKey.lmstudio_url`, a bare `z.string()` defaulting to LM Studio's base URL). Mirror both exactly for `ollama`, with `http://localhost:11434` as the default in both places.
- **`getApiKeyForProvider` sentinel** — `AIService.ts:765-766`: `case 'lmstudio': return 'not-required';`. Add an identical `case 'ollama':` arm. This is the pattern that keeps the provider keyless-in-UI without ever touching `process.env`.
- **Connection-test branch** — `AIService.ts:3530-3538`: fetches `{baseUrl}/v1/models`, throws a clear error naming the provider and baseUrl on non-2xx. Mirror for `ollama`, reading the baseUrl from `providerSettings['ollama']?.baseUrl`.
- **Persisted-settings write path, `apiKey` slice** — `AIService.ts:3250-3253`: `ollama_url` is a *setting*, not a credential — no masking (`maskApiKey`), just a direct `safeSet('ai.apiKey.ollama_url', ...)` write, exactly like `lmstudio_url`.
- **`enabledProviders` full shape** — `AIService.ts:3764-3768`, inside the `ai:getModels` handler. T1 only stubbed `{ enabled: false }` at the analogous minimal spot; this task fills in the real shape (`enabled`, `models`, `hiddenModels`) matching the `lmstudio` entry immediately above it, plus the `modelsConfig.ollama_url` companion at `AIService.ts:3779` (mirrors `lmstudio_url` on the line above it).
- **Mobile sync gate** — `SyncManager.ts:1239-1251` (`getAvailableModelsForMobile`): `enabledSet.add('lmstudio')` gated on `providerSettings['lmstudio']?.enabled === true`, and a `modelsConfig.lmstudio_url` spread key. Add the `ollama` equivalents in both places — this is the mechanism that gets Ollama models onto the mobile app; skipping it means they silently never sync.
- **`MessageStreamingHandler.ts` API-key bypass** — lines 538-540 (`case 'lmstudio': apiKey = 'not-required';`), baseUrl injection on reinit (595-598) and on refresh (748-751, 762-764), and the chat-vs-agent-provider membership check at line 727 (`['claude', 'openai', 'lmstudio'].includes(session.provider)`). All four need an `ollama` counterpart.

### Known Issues to Address

- **Existing LM Studio baseUrl-default inconsistency — do not propagate it.** Most LM Studio call sites default to `http://127.0.0.1:8234` (`AIService.ts:2088, 3533, 3568, 3779`), but `resolveExtensionChatProvider` at `AIService.ts:4466` defaults to `http://127.0.0.1:1234` instead — an existing, undocumented divergence in the code you're mirroring. For `ollama`, use the single canonical default `http://localhost:11434` at every call site with no exceptions. Do not "fix" the LM Studio inconsistency itself — out of scope, untouched files/lines for `lmstudio` stay as they are.
- **`aiServiceUtils.test.ts` — the task description's premise about this file is not accurate; verify before touching.** The task's own description says "confirm aiServiceUtils.test.ts's only 'lmstudio' reference is a comment before touching it." Live-source check during brief-writing found this is **not** the case: `aiServiceUtils.test.ts:36` has `AI_PROVIDER_TYPES: ['claude', 'claude-code', 'openai', 'openai-codex', 'lmstudio'] as const,` — a real array literal, not a comment, inside a `vi.mock('@nimbalyst/runtime/ai/server/types', ...)` stub (the real module can't resolve under vitest for this package). However, grepping the rest of the file confirms this mocked `AI_PROVIDER_TYPES` value is never actually read or asserted on anywhere else in the file (only `ModelIdentifier.tryParse` and `OpenAICodexProvider.normalizeModelSelection` are exercised) — it's dead stub data. **Net effect: do not edit this file.** Not because the reference is "a comment" (it isn't), but because nothing in the test suite depends on `'lmstudio'` being present in that mocked array's membership. If you find this changes during implementation, flag it rather than silently editing the mock.
- **Two separate `CHAT_PROVIDERS` literals in `AIService.ts` need `'ollama'` added independently** — `line 4109` (`extensions:ai-list-models` handler) and `line 4403` (`resolveExtensionChatProvider`). They are not the same array and are not derived from one another; a grep for `CHAT_PROVIDERS` will find both.
- **`resolveExtensionChatProvider`'s baseUrl/apiKey special-casing is duplicated per-provider inline, not table-driven** — lines 4443 (`if (providerType !== 'lmstudio' && !apiKey)`) and 4464-4466 (`if (providerType === 'lmstudio') { ...baseUrl = globalApiKeys['lmstudio_url']... }`) each need an `ollama` arm/condition added alongside the existing `lmstudio` one, not a replacement.
- **`extensions:ai-list-models`'s baseUrl resolution is a ternary, not a switch** — `AIService.ts:4123`: `const baseUrl = provider === 'lmstudio' ? (globalApiKeys['lmstudio_url'] || undefined) : undefined;`. A third provider makes a ternary the wrong shape — convert to something that resolves `ollama_url` too (a small helper or an explicit `provider === 'lmstudio' ? ... : provider === 'ollama' ? ... : undefined` is acceptable; match existing style, don't over-refactor).

### Recommended Approach

- No new libraries. This is pure mirroring of an existing, already-shipped pattern (`lmstudio`) across six files.
- Do not introduce a shared `LOCAL_CHAT_PROVIDERS` constant or otherwise refactor the `lmstudio`/`ollama` duplication into a table-driven abstraction unless a reviewer asks for it — CLAUDE.md's "change surgically" rule applies; every touched line should trace directly to adding `ollama`, not to improving code you were only reading.

### Dependencies

**File Dependencies:**
- `packages/runtime/src/ai/server/providers/OllamaProvider.ts`, `types.ts` (`AI_PROVIDER_TYPES`), `ProviderFactory.ts`, `ModelRegistry.ts`, `agentCapabilities.ts`, `server/index.ts` (barrel export) — all created/modified by **T1**. This task imports/relies on `AIProviderType` already including `'ollama'` and `ModelRegistry.getModelsForProvider`/`getAllModels` already accepting it.
- `packages/runtime/src/ai/modelConstants.ts`'s `DEFAULT_MODELS.ollama` entry — added by T1, read (not modified) by this task's `ModelRegistry.getDefaultModel('ollama')` calls.

**Library Dependencies:** none new.

---

## Requirements

Add `'ollama'` everywhere `'lmstudio'` is currently special-cased in the six files below, using `http://localhost:11434` as the canonical default base URL everywhere (never `127.0.0.1:8234` or `127.0.0.1:1234` — those are LM Studio's defaults).

1. **`shared/settings/keys.ts`**
   - `ai.provider.ollama`: `ProviderConfigSchema`, store path `providerSettings.ollama`, default `{ enabled: false, baseUrl: 'http://localhost:11434', testStatus: 'idle' }` — mirrors `ai.provider.lmstudio` (lines 132-136).
   - `ai.apiKey.ollama_url`: `z.string()`, store path `apiKeys.ollama_url`, default `'http://localhost:11434'` — mirrors `ai.apiKey.lmstudio_url` (lines 167-171). This is a URL under the `apiKeys.*` namespace by convention, **not a credential** — do not add masking or treat it as a secret.

2. **`main/services/ai/AIService.ts`** (largest surface, ~14 distinct spots):
   - Expand the T1 stub `enabledProviders.ollama` entry (~line 3764, alongside `lmstudio` at 3764-3768) to the full shape: `{ enabled: providerSettings['ollama']?.enabled === true, models: providerSettings['ollama']?.models, hiddenModels: providerSettings['ollama']?.hiddenModels }`.
   - Add `ollama_url: providerSettings['ollama']?.baseUrl || 'http://localhost:11434'` to the `modelsConfig` spread object (mirrors `lmstudio_url` at line 3779, and the separate one at line 3568 in the `ai:getAllModels` handler).
   - `getApiKeyForProvider` (line 721): add `case 'ollama': return 'not-required';` alongside `case 'lmstudio':` (line 765-766).
   - `ai:hasAnyProviderConfigured`-style check (~line 1830-1833, "Check LM Studio" block): add an equivalent "Check Ollama" block (`providerSettings['ollama']?.enabled === true && providerSettings['ollama']?.models?.length > 0`).
   - `ai:initialize` provider-switch (~line 1937-1939): add `case 'ollama': break;` (no API key needed, just the base URL, same comment pattern as `lmstudio`).
   - Init-config baseUrl resolution (~line 2084-2089, "Add LMStudio-specific config"): add an equivalent `if (provider === 'ollama') { initConfig.baseUrl = ... }` block reading `providerSettings.ollama` then falling back to `apiKeys['ollama_url']` then the hardcoded default.
   - Persisted-settings write path (~line 3250-3253): add `if (settings.apiKeys.ollama_url !== undefined) { safeSet('ai.apiKey.ollama_url', settings.apiKeys.ollama_url); }` (no masking, matches the `lmstudio_url` comment and pattern exactly).
   - Connection-test provider-switch, apiKey assignment (~line 3363-3366): add `case 'ollama': apiKey = 'not-required'; break;`.
   - Connection-test endpoint probe (~line 3530-3538, "For LMStudio, test the endpoint"): add an equivalent `if (provider === 'ollama') { ...fetch(`${baseUrl}/v1/models`)... }` block.
   - `ai:getAllModels` handler enabled-set gate (~line 3554-3564): add `if (providerSettings['ollama']?.enabled === true) enabledSet.add('ollama');`.
   - `extensions:ai-list-models` `CHAT_PROVIDERS` array (line 4109): add `'ollama'`; its baseUrl ternary (line 4123) needs a third branch for `ollama_url`.
   - `resolveExtensionChatProvider`'s `CHAT_PROVIDERS` array (line 4403): add `'ollama'`; its apiKey-required check (line 4443, `providerType !== 'lmstudio' && !apiKey`) needs `ollama` added to the keyless exclusion; its baseUrl block (line 4464-4466, `if (providerType === 'lmstudio') {...}`) needs an `ollama` counterpart reading `globalApiKeys['ollama_url']`.

3. **`main/services/ai/MessageStreamingHandler.ts`**:
   - API-key bypass switch (~line 538-540): add `case 'ollama': apiKey = 'not-required'; break;`.
   - Reinit baseUrl injection (~line 595-598, "Add baseUrl for LMStudio"): add an `ollama` branch reading `providerSettings['ollama']?.baseUrl`.
   - Chat-provider membership check (line 727: `['claude', 'openai', 'lmstudio'].includes(session.provider)`): add `'ollama'`.
   - Refresh-path apiKey/baseUrl logic (~lines 748-751, 762-764): add `ollama` arms mirroring the `lmstudio` ones exactly.

4. **`main/services/SyncManager.ts`** (`getAvailableModelsForMobile`, ~line 1239-1251):
   - Add `if (providerSettings['ollama']?.enabled === true) enabledSet.add('ollama');` alongside the `lmstudio` line (1246).
   - Add `ollama_url: providerSettings['ollama']?.baseUrl || 'http://localhost:11434'` to the `modelsConfig` object (alongside `lmstudio_url` at 1250). Omitting this means Ollama models silently never reach the mobile app.

5. **`preload/index.ts`**: extend the provider union types at lines 548 (`aiCreateSession`), 585 (`testAIConnection`), and 816 (`createSession`) to include `'ollama'` alongside `'lmstudio'`.

6. **`renderer/electron.d.ts`**: extend the matching provider union types at lines 478, 499, and 591 to include `'ollama'` — must stay in sync with `preload/index.ts`'s runtime implementation.

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] `ai.apiKey.ollama_url` setting exists in `keys.ts`, defaults to `http://localhost:11434`, and is what `ModelRegistry`/`chatProviderVisibility` will read (visibility logic itself is verified in T2b, not duplicated here — this task only needs the setting to exist and be readable).
- [ ] `ai.provider.ollama` setting exists in `keys.ts`, defaults to `{ enabled: false, baseUrl: 'http://localhost:11434', testStatus: 'idle' }`.
- [ ] Both `CHAT_PROVIDERS` literal arrays in `AIService.ts` (line 4109 and line 4403) include `'ollama'`.
- [ ] Connection-test IPC path (`ai:testConnection` → the `provider === 'ollama'` branch) succeeds against the live local Ollama daemon at `http://localhost:11434`.
- [ ] `SyncManager.ts`'s `getAvailableModelsForMobile` includes `'ollama'` in the mobile model-sync `enabledSet` and `modelsConfig.ollama_url`.
- [ ] No `process.env` fallback introduced for Ollama config anywhere in this diff — this is a review-time check on the PR, not an automated test (`getApiKeyForProvider` is awkward to unit-test in isolation).
- [ ] `npm run typecheck` passes for `packages/electron`'s main process.
- [ ] `preload/index.ts` and `renderer/electron.d.ts` provider union types stay in sync (both list `'ollama'` in the same three spots).
- [ ] `aiServiceUtils.test.ts` is left untouched (confirmed during research: its sole `'lmstudio'` reference is unused mock stub data, not something any assertion depends on).

**All criteria must pass before task is complete.**

---

## Deliverables

None beyond the files above.

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/electron/src/shared/settings/keys.ts` | modify | Add `ai.provider.ollama` and `ai.apiKey.ollama_url` setting definitions, mirroring the `lmstudio` entries. |
| `packages/electron/src/main/services/ai/AIService.ts` | modify | Complete `ollama` wiring across ~14 spots: API-key sentinel, enabled-check, init, connection test, persisted-settings write, both `CHAT_PROVIDERS` arrays, `enabledProviders`/`modelsConfig` literals, extension chat-completion resolution. |
| `packages/electron/src/main/services/ai/MessageStreamingHandler.ts` | modify | Add `ollama` to the API-key bypass, baseUrl injection (reinit + refresh), and chat-provider membership check. |
| `packages/electron/src/main/services/SyncManager.ts` | modify | Add `ollama` to the mobile model-sync `enabledSet` and `modelsConfig.ollama_url` in `getAvailableModelsForMobile`. |
| `packages/electron/src/preload/index.ts` | modify | Extend provider union types (`aiCreateSession`, `testAIConnection`, `createSession`) to include `'ollama'`. |
| `packages/electron/src/renderer/electron.d.ts` | modify | Extend the matching provider union types to include `'ollama'`, kept in sync with the preload implementation. |

### File Ownership Notes

- `AIService.ts` and `keys.ts` are also touched by T1 (already merged — added the minimal typecheck-green stub) and will be touched again by T2b (settings UI reads `ai.provider.ollama`/`ai.apiKey.ollama_url` but does not modify their schema definitions). No concurrent-edit risk expected since T1 is upstream-complete and T2b is downstream (Wave 3, starts after this task closes).
- `AIService.ts` is under `packages/electron/src/main/**`, which is in this repo's `require_review` boundary list (see Boundaries below) — expect this diff to get human review regardless of size.
- Do not touch `packages/runtime/src/ai/modelConstants.ts` or any file under `packages/runtime/src/ai/server/` — those are T1's files, already complete, and out of this task's scope.

---

## Implementation Guidance

### Patterns to Follow

See the **Research Context** section above for exact file:line references for every `lmstudio` call site this task mirrors. The governing principle: **every occurrence of the string `lmstudio` in these six files that represents provider-dispatch logic (not just a comment or an unrelated fallback default) gets a parallel `ollama` arm added next to it** — never a replacement, never a shared abstraction introduced along the way.

### Code Style

- Match the existing inline `switch`/`if` special-casing style in `AIService.ts` and `MessageStreamingHandler.ts` exactly — do not refactor either file toward a provider-registry/table-driven pattern as part of this task, even though the duplication is real. That refactor (if ever done) is out of scope here and would touch far more of the diff than "add ollama."
- `camelCase` for the JSON keys written into `providerSettings.ollama` (`baseUrl`, `testStatus`, `hiddenModels`) — matches `NAMING_CONVENTIONS.md`; this is wire/settings JSON, not SQL.

### Edge Cases

- **Daemon unreachable during connection test**: the `ollama` branch in the `ai:testConnection` handler must throw a clear, named error (`Ollama server not responding at ${baseUrl}`) exactly like the LM Studio branch — the outer `try/catch` (line 3541-3543) converts it to `{ success: false, error: error.message }` for the caller; do not swallow it earlier.
- **`ollama_url` must never be masked.** `maskApiKey` exists for real credentials (`anthropic`, `openai`, etc.); `ollama_url`, like `lmstudio_url`, is a plain setting and must go through the direct `safeSet` write path with no masking logic, or the base URL round-trips corrupted through the settings UI.
- **Never add a `process.env` fallback** anywhere in `getApiKeyForProvider`, the connection test, or the init-config baseUrl resolution — this is a hard repo rule (see CLAUDE.md's "Never Use Environment Variables as Implicit API Key Sources"), not a style preference. A prior incident silently billed a user's personal Anthropic account $100+ this way.
- **Base URL default must be `http://localhost:11434` everywhere in new `ollama` code**, even where the LM Studio code you're mirroring inconsistently uses `127.0.0.1:8234` in most places and `127.0.0.1:1234` in one place (`AIService.ts:4466`). Do not copy that inconsistency forward.

### Testing Requirements

- No new automated test file is in scope for this task (unlike T1 and T3, which each add a dedicated unit-test file). Verification here is: `npm run typecheck` passing for `packages/electron`'s main process, and a manual connection-test IPC round-trip against the live local Ollama daemon.
- Do not edit `packages/electron/src/main/services/ai/__tests__/aiServiceUtils.test.ts` — see the "Known Issues to Address" note above; its `'lmstudio'` reference is unused mock stub data, not an assertion this task's changes affect.
- If any existing test elsewhere in `packages/electron` asserts on the literal contents of `CHAT_PROVIDERS`, the provider union types in `preload/index.ts`/`electron.d.ts`, or the shape of `enabledProviders`, and it breaks after adding `'ollama'`, update its fixture list only — do not add new assertions on element count/ordering per this repo's "no presentation-only tests" convention (not directly applicable here since this is backend logic, but the same "narrowest fix" principle applies: update what broke, nothing more).

---

## Boundaries

### Files You MUST NOT Touch

- `node_modules/**`, `dist/**`, `out/**`, `out2/**`, `release/**`, `.vite/**`

### Files Requiring Review

This task's diff sits entirely inside `packages/electron/src/main/**`, which is on this repo's `require_review` boundary list — expect and plan for human review before merge. `package.json`, `package-lock.json`, and `CHANGELOG.md` are also on that list; this task should not need to touch `package.json`/`package-lock.json` (no new dependency), and any `CHANGELOG.md` entry should likely be deferred to whichever task lands the user-visible surface (see Commit Guidelines below) rather than added here.

---

## Dependencies

### Upstream Tasks

| Task | What It Provides | Verify Before Starting |
|------|------------------|------------------------|
| T1 | `OllamaProvider.ts` runtime class; `'ollama'` added to `AI_PROVIDER_TYPES` in `types.ts`; `ProviderFactory.createProvider('ollama', ...)` case; `ModelRegistry` dynamic-discovery wiring keyed on `apiKeys['ollama_url']`; `agentCapabilities.ts`'s `ollama: NO_AGENT_CAPABILITIES` entry; runtime barrel export (`server/index.ts`); the minimal `AIService.ts` `enabledProviders.ollama` stub and `modelConstants.ts`'s `DEFAULT_MODELS.ollama` entry (both needed to keep T1 itself typecheck-green). | Run `npm run typecheck` and confirm it is green before starting. Grep `packages/runtime/src/ai/server/types.ts` for `'ollama'` in the `AI_PROVIDER_TYPES` array, and `packages/runtime/src/ai/server/index.ts` for an `OllamaProvider` export. |

### Downstream Impact

**T2b** (Wave 3, "Wire Ollama into Electron settings UI and model picker") depends directly on this task: it reads `ai.apiKey.ollama_url` and `ai.provider.ollama` (created here) from `chatProviderVisibility.ts`, `ModelSelector.tsx`, and the new `OllamaPanel.tsx`. T2b cannot start meaningfully until this task's settings schema and `AIService.ts` connection-test path exist.

**Before starting:** verify T1 is complete by confirming `npm run typecheck` passes repo-wide at HEAD and that `OllamaProvider` is importable from `@nimbalyst/runtime/ai/server`.

---

## GitHub Context

**Issue:** none — no GitHub Issues tracker in use for this PRD; work is tracked via aven (`tsk_mt3lum1zoerbrt`) and beads for in-repo subtasks per this repo's `bd`/aven workflow.
**Feature Issue (Parent):** none
**Branch:** `worktree/ollama-provider-T2a`
**Target:** Determined by PM agent based on execution mode (feature branch or main)

---

## Commit Guidelines

This repo has specific overrides on the generic Conventional Commits template — follow these, not the generic defaults:

```
feat(electron): wire ollama into main-process settings, AIService, and sync
```

- **One-sentence subject.** Short bullets in the body only if truly needed (e.g. one line per file group), no prose paragraphs.
- **Do NOT add a `Co-Authored-By:` trailer** — this repo explicitly forbids it (CLAUDE.md: "Don't add Co-Authored-By lines to commit messages").
- **CHANGELOG.md**: if asked to propose a commit, update `CHANGELOG.md` first per this repo's rule. However, this task alone is backend-only wiring with no user-visible surface yet (T2b, Wave 3, lands the settings UI that actually exposes `ollama` to the user) — per the "one feature = one CHANGELOG bullet" rule, prefer deferring the CHANGELOG entry to whichever task/PR makes the feature user-visible, or fold this into the existing `[Unreleased]` bullet for the Ollama provider feature if one already exists, rather than adding a new bullet describing internal wiring. Do not name internal symbols (`AIService.ts`, `SyncManager.ts`, `enabledProviders`) in any CHANGELOG line.
- If this PR includes a `Fixes #N`/`Closes #N` reference, only add it if a real GitHub issue exists for this PRD — none has been found during brief-writing.

Types: feat, fix, refactor, test, docs, chore

---

## Validation Checklist

Before creating PR:
- [ ] All success criteria met
- [ ] Build passes: `npm run build`
- [ ] Type check passes: `npm run typecheck`
- [ ] No `never_touch` files modified
- [ ] No `process.env` fallback introduced anywhere in the diff
- [ ] `preload/index.ts` and `renderer/electron.d.ts` provider unions match each other
- [ ] Manual connection-test verified against the live local Ollama daemon (`http://localhost:11434`)
- [ ] Branch rebased on target branch (feature branch or main)

---

*Generated by NIMBLE Brief Writer*
*PRD: ollama-provider | Task: T2a | Wave: 2*
