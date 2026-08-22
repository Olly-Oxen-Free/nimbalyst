# Task Brief: T3

**Title:** OpenCode-Ollama coding-agent bridge
**PRD:** ollama-provider
**Priority:** must
**Complexity:** 4/10
**Model:** sonnet
**Wave:** 1 (parallel with T1 — no shared files, no dependency)
**Tracker:** aven item `tsk_mt3lum1zoerbrt` (existing task item, reused per user request — no separate plan item filed). No GitHub Issues are configured for this PRD; use `bd`/aven per this repo's tracking convention, not GitHub issue numbers.

---

## Objective

Give Ollama models real coding-agent capability (MCP, file tools, permissions) by bridging them into OpenCode's existing agent harness — mirroring the codebase's proven `upsertLMStudioBridge()`/`removeLMStudioBridge()` pattern in `OpenCodeConfigService.ts`, exactly, for Ollama. This is the task that actually satisfies "Ollama models usable as coding agents"; the separate `ollama` chat provider (T1/T2a/T2b) is intentionally chat-only and does not provide this.

---

## Context

**Parent Feature:** Ollama Chat Provider PRD (`.nimble/prds/001_ollama-provider/PRD_ollama-provider.md`)

The user runs a local Ollama daemon (confirmed live at `http://localhost:11434`, v0.24.0, models `qwen3:14b`, `gemma3:12b`, `deepseek-coder:1.3b`, `qwen2.5:0.5b`, `qwen2.5-coder:14b`) also used by a voice assistant and search tooling outside this repo. The PRD adds two independent things: (1) a plain `ollama` chat provider (T1/T2a/T2b — fast, local, no MCP/file tools, good for cross-provider `create_session` dispatch), and (2) this task — the mechanism that makes Ollama models usable as *coding agents*.

OpenCode is already a full agent provider in this codebase (MCP, file tools, permissions, session resume, extends `BaseAgentProvider`). It already has a built-in bridge pattern — `OpenCodeConfigService.upsertLMStudioBridge()` — for pointing its own agent loop at any local OpenAI-compatible server via the generic `@ai-sdk/openai-compatible` npm adapter, written into the user's `~/.config/opencode/opencode.json`. The file's own header comment (line 33, referencing issue #284) already names Ollama as a config real users have hand-written into `opencode.json` successfully — this is a known-working pattern, not a novel one.

**Why not a bespoke Ollama agent provider?** Considered and rejected in planning (see PRD "Scope" section and `research/findings.md`): every existing agent provider (`ClaudeCodeProvider`, `OpenAICodexProvider`, `OpenCodeProvider`, `CopilotCLIProvider`) wraps an external CLI/SDK that already implements its own agent loop. Ollama is a bare inference endpoint with no such harness — building one from scratch means reimplementing MCP wiring, permission lifecycle, trust-check integration, and a transcript parser, all of which OpenCode already has hardened. Bridging into OpenCode's harness is both less work and lower-risk.

This task is part of **Wave 1** — it runs in parallel with T1 (the Ollama chat provider). It has no file overlap and no dependency on T1, T2a, or T2b; those three tasks wire the separate chat-provider path (`packages/runtime/src/ai/server/`, `packages/electron/src/main/services/ai/`, and the chat-provider settings UI) and never touch `OpenCodeConfigService.ts`, `OpenCodeConfigHandlers.ts`, or `OpenCodePanel.tsx`.

---

## Research Context

### Patterns to Follow

- **`upsertLMStudioBridge()` / `removeLMStudioBridge()`** (`packages/electron/src/main/services/OpenCodeConfigService.ts:159` and `:186`) — the exact shape to mirror for Ollama. Read both in full before writing `upsertOllamaBridge()`/`removeOllamaBridge()`; the new functions should differ only in provider key (`'ollama'` not `'lmstudio'`), default display name, and default base URL.
- **`normalizeOpenAICompatibleBaseUrl()`** (same file, line 229) — already generic (LM Studio-specific only in its doc comment, not its logic: strips trailing slashes, appends `/v1` if not already present). Reuse this helper as-is for Ollama; do not duplicate it.
- **`fetchLMStudioModels()`** (`packages/electron/src/main/ipc/OpenCodeConfigHandlers.ts:16`) — template for `fetchOllamaModels(baseUrl)`, but note the endpoint differs: Ollama's bridge model discovery must hit `/api/tags` (Ollama's native, always-present, authoritative model-list endpoint), **not** `/v1/models`. `/api/tags` is more reliable for this purpose because it doesn't depend on Ollama's OpenAI-compat shim being enabled. Response shape from `/api/tags` is `{ models: [{ name: string, ... }] }` — verify the field name (`name`, not `id`) against a live call to `http://localhost:11434/api/tags` before parsing.
- **IPC handler registration** (`OpenCodeConfigHandlers.ts:55-92`) — `opencode-config:upsert-lmstudio` / `opencode-config:remove-lmstudio` are the templates for `opencode-config:upsert-ollama` / `opencode-config:remove-ollama`. Same `safeHandle` wrapper, same `{ success, config, modelIds }` / `{ success, error }` response shape, same "no models discovered" guard.
- **`OpenCodePanel.tsx`'s LM Studio section** (lines 91-107, 185-226, 354-400) — state (`LMStudioStatus` union, base-URL state seeded once from existing config via a ref guard, status/message state), handlers (`handleConnectLMStudio`/`handleDisconnectLMStudio`), and JSX (base URL input, connect/refresh button, remove button, bridge-active status line, model group in the `<optgroup>` picker at lines 334-340 and the `group` field in `ModelOption`/`buildModelOptions()` at lines 44-76). Mirror this structure verbatim for an Ollama section — do not restructure or "improve" the LM Studio section while you're in the file.
- **`OpenCodeFileProvider`/`OpenCodeFileConfig` types** (`packages/runtime/src/ai/server/providers/OpenCodeProvider.ts:48-66`) are shared, provider-key-agnostic types already covering `provider.ollama` with no changes needed — do not add an Ollama-specific type.

### Known Issues to Address

- None specific to this task beyond the model-discovery endpoint distinction above (`/api/tags` vs `/v1/models`) — get this wrong and the bridge will silently under-discover models whenever the OpenAI-compat shim isn't the thing actually serving requests.

### Recommended Approach

- `@ai-sdk/openai-compatible` is referenced only as a **string literal** (the npm package name written into the user's `opencode.json` for OpenCode's own runtime to resolve) — it is not a Node dependency of this repo and does not need adding to any `package.json`. Confirm this by grepping the LM Studio bridge: it never imports the package, only writes its name.
- `buildModelOptions()` in `OpenCodePanel.tsx` already generalizes to any provider key beyond `'lmstudio'`/`'preset'` via its `'custom'` fallback group — but per the "mirror lmstudio exactly" requirement, give Ollama its own named group (`'ollama'`) alongside `'preset'`/`'lmstudio'`/`'custom'` rather than letting it fall into the generic `'custom'` bucket, so the picker shows a labeled "Ollama (local)" optgroup the same way LM Studio gets its own.

### Dependencies

**File Dependencies:** None. This task is fully independent of T1/T2a/T2b's chat-provider work — no shared types, no shared files.

**Library Dependencies:** None new. `@ai-sdk/openai-compatible` is a config string, not an import (see above).

---

## Requirements

1. **`OpenCodeConfigService.ts`** — add `upsertOllamaBridge(options: OllamaBridgeOptions)` and `removeOllamaBridge()`, modeled exactly on the LM Studio pair:
   - New `OllamaBridgeOptions` interface (`baseUrl: string`, `modelIds: string[]`, `displayName?: string`) mirroring `LMStudioBridgeOptions`.
   - New constants `OLLAMA_PROVIDER_KEY = 'ollama'` and reuse `LMSTUDIO_NPM_PACKAGE`'s value (`'@ai-sdk/openai-compatible'`) — either share the existing constant or add an equivalent; do not hardcode the string twice if a shared constant reads more cleanly.
   - `upsertOllamaBridge()` normalizes `baseUrl` via the existing `normalizeOpenAICompatibleBaseUrl()` helper (default base URL for the caller to pass is `http://localhost:11434`, which normalizes to `http://localhost:11434/v1`), dedupes `modelIds` against any existing `provider.ollama.models` entries, and default display name `'Ollama (local)'`.
   - `removeOllamaBridge()` deletes only the `provider.ollama` key, leaving `provider.lmstudio` and any other provider blocks untouched.
   - Both go through the existing `mergeConfig()`/`writeConfigRaw()` machinery — do not add new file I/O.

2. **`OpenCodeConfigHandlers.ts`** — add `fetchOllamaModels(baseUrl: string): Promise<string[]>` hitting `{root}/api/tags` (strip any trailing `/v1` from the stored base URL first, the same way `fetchLMStudioModels` strips it before appending `/v1/models` — except here you strip and do NOT re-append `/v1`, since `/api/tags` is a native-API path). Parse the `{ models: [{ name: string }] }` shape. Register `opencode-config:upsert-ollama` and `opencode-config:remove-ollama` via `safeHandle`, mirroring the lmstudio handlers' structure (auto-discover-if-empty guard, "no models discovered" error message referencing Ollama, same response envelope).

3. **`OpenCodePanel.tsx`** — add an "Ollama integration" section, structurally identical to the "LM Studio integration" section (base URL input defaulting to `http://localhost:11434`, connect/refresh + remove buttons, bridge-active status line with model count, `data-testid`s following the `opencode-ollama-*` naming convention analogous to `opencode-lmstudio-*`), plus an `'ollama'` group in `ModelOption`/`buildModelOptions()` and a corresponding labeled `<optgroup label="Ollama (local)">` in the model picker `<select>`.

---

## Success Criteria

Complete ALL criteria before marking task done:

- [ ] `upsertOllamaBridge()` writes a `provider.ollama` block (`npm: '@ai-sdk/openai-compatible'`, `options.baseURL` normalized to end in `/v1`, `models` map deduped against existing entries) without disturbing other provider blocks — an existing `provider.lmstudio` block survives untouched.
- [ ] `removeOllamaBridge()` cleanly deletes only the `provider.ollama` key.
- [ ] New unit test file `OpenCodeConfigService.ollamaBridge.test.ts` covers: upsert-creates (no prior `provider.ollama`), upsert-merges-into-existing (prior `provider.ollama` with some models, new models added, old ones preserved, `provider.lmstudio` untouched if present), and remove (deletes only `provider.ollama`). This is the first unit test of the bridge pattern at all — there is no existing LM Studio bridge test to copy structurally; only `OpenCodeConfigService.paths.test.ts` exists and covers unrelated path-resolution logic.
- [ ] `OpenCodePanel` renders an Ollama bridge section structurally mirroring the LM Studio one (base URL default `http://localhost:11434`, connect/disconnect, model count status). No new presentation-only test required for this UI addition, per repo convention (icon names, exact strings, and element ordering are not unit-tested here).
- [ ] Manual end-to-end verification, not just config-write correctness: connect the bridge, select an Ollama model (e.g. `qwen2.5-coder:14b`) in OpenCode's model picker, and run a real OpenCode agent session against it that performs an actual file edit. This proves MCP/file-tools genuinely work through Ollama as the backend — a config write alone does not prove this. Per `end-to-end-verification.md`, do not announce this criterion "done" without having personally observed the file edit happen.
- [ ] `npm run typecheck && npm run test:prepush` pass.

**All criteria must pass before task is complete.**

---

## Deliverables

| Artifact | Path | Done when |
|---|---|---|
| Bridge functions | `packages/electron/src/main/services/OpenCodeConfigService.ts` | `upsertOllamaBridge()`/`removeOllamaBridge()` exist, exported alongside the existing LM Studio pair, behave per Requirements above |
| IPC handlers | `packages/electron/src/main/ipc/OpenCodeConfigHandlers.ts` | `opencode-config:upsert-ollama` / `opencode-config:remove-ollama` registered and reachable via `window.electronAPI.invoke` |
| Bridge test | `packages/electron/src/main/services/__tests__/OpenCodeConfigService.ollamaBridge.test.ts` | covers upsert-creates, upsert-merges, remove (see Success Criteria) |
| Settings UI section | `packages/electron/src/renderer/components/GlobalSettings/panels/OpenCodePanel.tsx` | Ollama bridge section renders, structurally mirrors LM Studio section, `ollama` optgroup appears in model picker when models are configured |
| Manual E2E verification | n/a (not a file) | real OpenCode agent session, backed by an Ollama model through the bridge, performs an actual file edit — observed directly, not inferred from code review |

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/electron/src/main/services/OpenCodeConfigService.ts` | modify | Add `upsertOllamaBridge()`/`removeOllamaBridge()` + `OllamaBridgeOptions` interface, mirroring the LM Studio pair |
| `packages/electron/src/main/services/__tests__/OpenCodeConfigService.ollamaBridge.test.ts` | create | First unit test of the bridge pattern — upsert-creates, upsert-merges, remove |
| `packages/electron/src/main/ipc/OpenCodeConfigHandlers.ts` | modify | Add `fetchOllamaModels()` (hits `/api/tags`) + `opencode-config:upsert-ollama` / `opencode-config:remove-ollama` handlers |
| `packages/electron/src/renderer/components/GlobalSettings/panels/OpenCodePanel.tsx` | modify | Add Ollama bridge UI section + `'ollama'` model-picker optgroup |

### File Ownership Notes

None of these four files are touched by T1, T2a, or T2b — no coordination needed with those tasks. `OpenCodeConfigService.ts` and `OpenCodeConfigHandlers.ts` already contain the LM Studio bridge in the same file; when editing, add new functions/handlers alongside the existing ones rather than reorganizing the file (existing LM Studio code must survive untouched — verified by the "provider.lmstudio survives" success criterion).

---

## Implementation Guidance

### Patterns to Follow

See "Research Context" above — it is the authoritative source for exact line numbers and code shapes to mirror. In summary: `upsertLMStudioBridge()`/`removeLMStudioBridge()` (`OpenCodeConfigService.ts:159,186`), `fetchLMStudioModels()` (`OpenCodeConfigHandlers.ts:16`), the two `opencode-config:*-lmstudio` handlers (`OpenCodeConfigHandlers.ts:55-92`), and the full LM Studio integration section in `OpenCodePanel.tsx` (state at lines 91-107, handlers at 185-226, JSX at 354-400, plus the `ModelOption`/`buildModelOptions()` machinery at 44-76 and 334-340).

### Code Style

Match the existing file's style exactly: this repo's `camelCase` wire-format convention applies to the JSON written into `opencode.json` and to all IPC channel payloads. `snake_case` is never used except SQL columns (not touched by this task). Don't reformat or restructure the LM Studio code while adding the Ollama code next to it — surgical, additive changes only.

### Edge Cases

- **No models loaded on the Ollama daemon**: `fetchOllamaModels()` should return an empty array, and the IPC handler should return the same "no models discovered" error shape the LM Studio handler uses (adapted wording), not throw.
- **Daemon unreachable**: `fetch` to `/api/tags` will reject or return non-OK; handle the same way `fetchLMStudioModels` does — throw a clear error that the IPC handler's try/catch turns into `{ success: false, error }`.
- **Base URL already contains a path** (e.g. user pastes `http://localhost:11434/v1`): `fetchOllamaModels` must strip a trailing `/v1` (or similar version segment) before appending `/api/tags`, mirroring how `fetchLMStudioModels` strips it before appending `/v1/models`. The bridge-write path's `normalizeOpenAICompatibleBaseUrl()` is unaffected — it already handles this correctly for the `/v1` case.
- **Re-running upsert with a shrunk model list**: per the existing LM Studio behavior, upsert only *adds* new model ids into the existing map — it never removes previously-configured models that are no longer discovered. Preserve this behavior for Ollama (matches the "upsert-merges-into-existing" test case).

### Testing Requirements

New test file `OpenCodeConfigService.ollamaBridge.test.ts` is required (see Success Criteria and Deliverables). Follow this repo's testing rules from `CLAUDE.md`:
- Add `// @vitest-environment node` as the first line — this test never touches the DOM.
- Test the service's public methods directly (`upsertOllamaBridge`, `removeOllamaBridge`) against a mocked/temp-file-backed config path, not through the IPC handler layer — the IPC handler's own logic (auto-discovery, error envelopes) can be covered by direct unit tests on `fetchOllamaModels` if you choose to add them, but is not required by the stated Success Criteria; the bridge-function tests are.
- No `vi.mock('@nimbalyst/runtime', ...)` — this file doesn't touch the runtime barrel at all, so this shouldn't come up, but don't introduce it.
- Do not write a presentation-only test for the `OpenCodePanel.tsx` UI section — explicitly not required per Success Criteria and repo convention (icon names, button labels, and element ordering are not worth a unit test; the manual E2E verification step is the real check for this UI).

### Coverage Expectations

**Target Files for Coverage:**

| File | Target | Rationale |
|------|--------|-----------|
| `packages/electron/src/main/services/OpenCodeConfigService.ts` (new `upsertOllamaBridge`/`removeOllamaBridge` functions only) | 80%+ | Core logic this task introduces; directly covered by the required upsert-creates/upsert-merges/remove test cases |

No prior-wave implementation file feeds this task (T3 has no dependencies — `depends_on: []`); the coverage target above is for the functions this task itself writes, not for functions from an earlier task.

**Intentionally Uncovered Lines:**

- **`OpenCodeConfigHandlers.ts` — `fetchOllamaModels()` network-failure branch and the two new IPC handlers** — covered by the manual end-to-end verification step (connect against the live daemon), not by a mocked-fetch unit test. Not required by Success Criteria; add one only if convenient, don't block on it.
- **`OpenCodePanel.tsx` — the entire new Ollama section** — presentation code, explicitly excluded from unit testing per repo convention and the Success Criteria above; covered by manual E2E verification instead.

**Verification:**
```bash
npm run test:prepush -- --coverage
```
(Repo's configured test command is `npm run test:prepush`; there is no separate `--coverage` flag documented in `.nimble/config.yaml` beyond the base command — pass `--coverage` through if the underlying vitest config supports it, otherwise rely on the required test cases themselves as the coverage bar.)

---

## Boundaries

### Files You MUST NOT Touch

- `node_modules/**`, `dist/**`, `out/**`, `out2/**`, `release/**`, `.vite/**`

### Files Requiring Review

This task's primary file, `packages/electron/src/main/services/OpenCodeConfigService.ts`, is under `packages/electron/src/main/**`, which is in `require_review`. `package.json` / `package-lock.json` and `CHANGELOG.md` are also in `require_review` — this task should not need to touch `package.json`/`package-lock.json` (no new dependency is added; `@ai-sdk/openai-compatible` is a config string, not an import — see Research Context). If a CHANGELOG entry is requested separately, follow the repo's one-bullet, no-internal-scaffolding rule from `CLAUDE.md` — do not name `OpenCodeConfigService`, IPC channel names, or function names in the changelog line; describe the user-facing capability ("Ollama models can now be used as OpenCode coding agents via a local bridge," or similar, phrased to match existing `[Unreleased]` entries).

---

## Dependencies

### Upstream Tasks

None — `depends_on: []`. This task can start immediately, in parallel with T1.

### Downstream Impact

None — no task in this PRD depends on T3. T2a and T2b build the separate `ollama` chat-provider path and never read from or write to the files this task touches.

**Before starting:** No dependency verification needed.

---

## Commit Guidelines

Use Conventional Commits:
```
feat(opencode): add Ollama coding-agent bridge

Co-Authored-By: Claude <noreply@anthropic.com>
```

Types: feat, fix, refactor, test, docs, chore

Note: this repo's own `CLAUDE.md` says "Don't add `Co-Authored-By` lines to commit messages" for work done directly in an interactive Claude Code session. If this brief is executed by an autonomous NIMBLE worker agent under a different attribution convention, follow whatever convention the orchestrating `/nimble:run` invocation specifies; otherwise omit the `Co-Authored-By` trailer to match repo convention.

---

## Validation Checklist

Before creating a PR:
- [ ] All success criteria met
- [ ] Build passes: `npm run build`
- [ ] Type check passes: `npm run typecheck`
- [ ] Test suite passes: `npm run test:prepush`
- [ ] No `never_touch` files modified
- [ ] New bridge test added (`OpenCodeConfigService.ollamaBridge.test.ts`)
- [ ] `provider.lmstudio` block confirmed to survive an `upsertOllamaBridge()` call in a test case
- [ ] Manual E2E: OpenCode agent session against an Ollama-backed model performs a real file edit — observed directly
- [ ] If a CHANGELOG entry is warranted, it names the user-facing capability only, no internal symbol/file/channel names
- [ ] Branch rebased on target branch (feature branch or main, per PM agent's execution mode)

---

*Generated by NIMBLE Brief Writer*
*PRD: ollama-provider | Task: T3 | Wave: 1*
