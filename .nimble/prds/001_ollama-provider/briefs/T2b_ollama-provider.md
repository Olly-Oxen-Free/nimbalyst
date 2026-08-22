# Task Brief: T2b

**Title:** Wire Ollama into Electron settings UI and model picker
**PRD:** ollama-provider
**Priority:** must
**Complexity:** 3/10
**Model:** sonnet
**Wave:** 3
**Feature Issue:** Not applicable — this PRD is tracked via aven/beads, not GitHub Issues (see `status.json`: `tracker.linked_item_id = tsk_mt3lum1zoerbrt`, an existing tracker item reused, not a GitHub issue number).

---

## Objective

Make the `ollama` chat provider — already registered in the runtime (T1) and wired into the Electron main process (T2a) — actually usable from the UI: a Settings panel to enable it and set its base URL, a correct "is this provider configured" detection so it doesn't get permanently hidden, and a model picker entry that streams real responses. This is the last of the three sequential tasks that make Ollama a selectable chat provider end-to-end (a fourth task, T3, adds separate coding-agent capability via the OpenCode bridge and does not depend on this one).

---

## Context

**Parent Feature:** Ollama Chat Provider (PRD `ollama-provider`, tracker item `tsk_mt3lum1zoerbrt`)

The user runs a local Ollama daemon (`http://localhost:11434`, confirmed live, v0.24.0, 5 models loaded) also used by a voice assistant and search tooling outside this repo, and wants Nimbalyst able to chat against it without an API key or per-request cloud billing — closing the same gap the existing `lmstudio` provider already closes for LM Studio users.

The PRD splits this into four tasks: **T1** (runtime provider + registration, Wave 1), **T3** (OpenCode-Ollama coding-agent bridge, Wave 1, independent), **T2a** (Electron main-process wiring — settings schema, AIService, sync, Wave 2), and **T2b (this task)** (Electron renderer: settings UI, model picker, provider-visibility logic, Wave 3). T2a must land first because this task reads settings keys (`ai.apiKey.ollama_url`, `ai.provider.ollama`) and CHAT_PROVIDERS membership that T2a creates.

This task is part of **Wave 3** — the final wave for the chat-provider slice. It is *not* part of the coding-agent bridge (T3); the chat provider being wired here stays chat-only (no MCP, no file tools), matching `lmstudio`'s capability profile.

---

## Research Context

Full detail: `.nimble/prds/001_ollama-provider/research/findings.md`. Task-relevant extract:

### Patterns to Follow

- **Panel structure:** `packages/electron/src/renderer/components/GlobalSettings/panels/LMStudioPanel.tsx` (142 lines) is the exact template — props shape (`config`, `apiKeys`, `availableModels`, `loading`, `onToggle`, `onApiKeyChange`, `onModelToggle`, `onSelectAllModels`, `onTestConnection`, `onConfigChange`), the `SettingsToggle` enable switch, base-URL input + "Test"/"Testing.../✓ Connected/✗ Failed" button, and the model checkbox grid with Select All / Deselect All / Refresh Models.
- **Settings routing:** `SettingsView.tsx:874-875` — `case 'lmstudio': return wrapWithOverride('lmstudio', 'LM Studio', <LMStudioPanel {...commonProps} />);` is the exact shape to add for `'ollama'`.
- **Sidebar entry:** `SettingsSidebar.tsx:148` — `{ id: 'lmstudio', scope: 'application', group: 'Chat Providers', label: 'LM Studio', icon: 'memory', isAvailable: directChatProvidersVisible }`.
- **Route type + icon lookup:** `settingsRoutes.ts:17` (the `SettingsRouteId` union includes `'lmstudio'`) and `settingsRoutes.ts:42` (`routeIcon()`'s provider-icon allow-list array includes `'lmstudio'`).
- **Model formatting:** `modelUtils.ts:182,197,220,248` — four `case 'lmstudio':` branches for display name, badge text, and two model-name-cleanup functions (strip `-GGUF` suffix, truncate long names).
- **Model picker grouping:** `ModelSelector.tsx:264` (membership switch that routes `'lmstudio'` through the generic per-provider path) and `:318` (`case 'lmstudio': return 'LMStudio';` group-header label).
- **aiApi provider union:** `aiApi.ts:340` — `provider?: 'claude' | 'claude-code' | 'claude-code-cli' | 'openai' | 'lmstudio'` needs `'ollama'` added.
- **Global settings defaults:** `appSettings.ts:1203` (`lmstudio: { enabled: false, baseUrl: 'http://127.0.0.1:8234', testStatus: 'idle' }`) and `:1215` (`lmstudio_url: 'http://127.0.0.1:8234'`) — mirror both for ollama with default `http://localhost:11434`.
- **Project override list:** `ProjectAIProvidersPanel.tsx:55` — the `PROVIDERS` array entry `{ id: 'lmstudio', name: 'LM Studio', subtitle: 'Local Models' }`. This panel is the *per-project override* surface, separate from `OllamaPanel.tsx` (the global panel) — both need the ollama entry.
- **Icon:** `MaterialSymbol.tsx:53-54` — the `'lmstudio'` icon-factory entry in the provider-icon map.
- **Transcript label:** `RichTranscriptView.tsx:1735` — `case 'lmstudio':` provider-display-name switch; has a `default:` fallback so this is cosmetic, not typecheck-blocking.

### Known Issue to Address (the critical one)

`chatProviderVisibility.ts` currently has a **hardcoded provider check**, not a generic list membership check:

```ts
// chatProviderVisibility.ts
export const DIRECT_CHAT_PROVIDER_IDS = ['claude', 'openai', 'lmstudio'] as const;   // line 1
export const DEFAULT_LM_STUDIO_BASE_URL = 'http://127.0.0.1:8234';                   // line 5
...
export function isDirectChatProviderMeaningfullyConfigured(
  providerId: DirectChatProviderId,
  settings: ChatProviderSettingsSnapshot,
): boolean {
  const config = settings.providers[providerId];
  if (config?.enabled || (config?.models?.length ?? 0) > 0 || hasText(config?.apiKey)) {
    return true;
  }
  const apiKeyName = apiKeyNames[providerId];
  if (apiKeyName && hasText(settings.apiKeys[apiKeyName])) {
    return true;
  }
  if (providerId !== 'lmstudio') {           // line 59 — THE PROBLEM
    return false;
  }
  const defaultBaseUrl = normalizeBaseUrl(DEFAULT_LM_STUDIO_BASE_URL);
  return [config?.baseUrl, settings.apiKeys.lmstudio_url].some((baseUrl) =>
    hasText(baseUrl) && normalizeBaseUrl(baseUrl!) !== defaultBaseUrl,
  );
}
```

Adding `'ollama'` to `DIRECT_CHAT_PROVIDER_IDS` alone is **not sufficient**. A user who has customized `config.baseUrl` or `apiKeys.ollama_url` away from the default, but hasn't explicitly flipped the `enabled` toggle, hits the `providerId !== 'lmstudio'` early return and is reported as unconfigured — permanently, since that branch never runs for any provider except the literal string `'lmstudio'`. You must add an explicit `ollama` branch (own default-URL constant, own base-URL comparison), not extend the `if` condition to `providerId !== 'lmstudio' && providerId !== 'ollama'` with a shared LM Studio constant — the two providers have different default base URLs (`127.0.0.1:8234` vs `localhost:11434`) and must not be conflated.

### Recommended Approach

- Add `DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434'` as its own exported constant (mirrors `DEFAULT_LM_STUDIO_BASE_URL`, do not reuse or overload the LM Studio one).
- Restructure the two hardcoded early-return branches (there is only one in the current file, at line 59) into a small per-provider default-URL lookup (e.g. a `Record<'lmstudio' | 'ollama', string>` map keyed by provider id) so a future third local provider doesn't repeat the same mistake — but do not over-engineer past what's needed for two providers; this is a complexity-3 task.
- `apiKeyNames` (line 9) intentionally has no `ollama` entry, same as `lmstudio` has none — the URL-based check is the mechanism for local providers, not the `apiKeyNames`/`hasText(apiKey)` path used by `claude`/`openai`. Do not add `ollama` to `apiKeyNames`.

### Dependencies

**File dependencies (from T2a, verify before starting — see Dependencies section below):**
- `packages/electron/src/shared/settings/keys.ts` — `ai.apiKey.ollama_url` (default `http://localhost:11434`) and `ai.provider.ollama` (`ProviderConfigSchema`, default `{ enabled: false, baseUrl: 'http://localhost:11434', testStatus: 'idle' }`).
- `AIService.ts` — both `CHAT_PROVIDERS` literal arrays include `'ollama'`; connection-test IPC path works against the live daemon.

**File dependencies (from T1, further upstream):**
- `packages/runtime/src/ai/server/types.ts` — `'ollama'` in `AI_PROVIDER_TYPES`.
- `packages/runtime/src/ai/server/ProviderFactory.ts` — `createProvider('ollama', ...)` returns an `OllamaProvider`.

---

## Requirements

Source of truth: `tasks.yaml`'s `T2b` entry (refined through a PRD-review pass) — read it verbatim if this brief and `tasks.yaml` ever diverge. Summary:

1. **`GlobalSettings/panels/OllamaPanel.tsx`** (new file) — modeled directly on `LMStudioPanel.tsx`: a base-URL field defaulting to `http://localhost:11434` and a connection-test button, same enable-toggle / models-grid / Select-All-Deselect-All / Refresh-Models structure.
2. **`SettingsView.tsx`** — add a `case 'ollama':` in the provider switch (~line 874-875) returning `wrapWithOverride('ollama', 'Ollama', <OllamaPanel {...commonProps} />)`.
3. **`SettingsSidebar.tsx`** — add an `'ollama'` entry to the routes array (mirrors `lmstudio`'s at line 148: `group: 'Chat Providers'`, `isAvailable: directChatProvidersVisible`; pick a distinct icon from LM Studio's `memory`, e.g. `hub` or similar — confirm it renders via `MaterialSymbol`).
4. **`settingsRoutes.ts`** — add `'ollama'` to the `SettingsRouteId` union (~line 17) and to `routeIcon()`'s provider-icon allow-list array (~line 42).
5. **`Settings/panels/ProjectAIProvidersPanel.tsx`** (per-project override, a *separate* surface from `OllamaPanel.tsx`) — add `{ id: 'ollama', name: 'Ollama', subtitle: 'Local Models' }` to the `PROVIDERS` array (~line 55).
6. **`store/atoms/appSettings.ts`** — add `ollama: { enabled: false, baseUrl: 'http://localhost:11434', testStatus: 'idle' }` (~line 1203) and `ollama_url: 'http://localhost:11434'` (~line 1215) to the default-settings atoms, mirroring the `lmstudio` entries exactly.
7. **`UnifiedAI/ModelSelector.tsx`** — add `'ollama'` to the provider-membership switch (~line 264) and a `case 'ollama': return 'Ollama';` group-header label (~line 318).
8. **`utils/modelUtils.ts`** — add `case 'ollama':` branches alongside each of the four existing `lmstudio` branches (~lines 182, 197, 220, 248: display name, badge text, and the two model-name-cleanup helpers). Ollama model names don't carry LM Studio's `-GGUF`/`-Q*_K_*` GGUF-quantization suffixes, so decide per-branch whether the same regex cleanup applies or whether `ollama` should just return the raw tag — do not blindly copy the GGUF-stripping regex if Ollama tags don't need it.
9. **`utils/chatProviderVisibility.ts`** — see "Known Issue to Address" above. Add `'ollama'` to `DIRECT_CHAT_PROVIDER_IDS`, add `DEFAULT_OLLAMA_BASE_URL`, and add an explicit ollama branch to `isDirectChatProviderMeaningfullyConfigured` checked against `config.baseUrl` / `settings.apiKeys.ollama_url` — this is new logic, not a list-entry change.
10. **`services/aiApi.ts`** — add `'ollama'` to the provider union type (~line 340).
11. **Cosmetic, non-blocking:** `packages/runtime/src/ui/icons/MaterialSymbol.tsx` (~line 54, provider icon factory entry for `'ollama'`) and `packages/runtime/src/ui/AgentTranscript/components/RichTranscriptView.tsx` (~line 1735, `case 'ollama':` provider display name) — both have safe fallbacks already, so these don't block typecheck; do them anyway since they're one-line additions in the same file family already being touched.

---

## Deliverables

None beyond the files above.

---

## Success Criteria

Complete ALL criteria before marking task done (verbatim from `tasks.yaml`):

- [ ] OllamaPanel renders in Settings > AI Providers with an editable base URL field (default `http://localhost:11434`) and a working connection-test button.
- [ ] `chatProviderVisibility.test.ts` gets a new test case exercising the ollama branch's own logic — not just an updated fixture list (that branch is new behavior, not a data change).
- [ ] `modelPickerKeyboard.test.tsx` is updated only as an existing-fixture-list change — no new assertions on element ordering, count, or label text (presentation-only, not worth a test per repo convention).
- [ ] An Ollama-backed chat session appears in the model picker and streams a real response end-to-end in a running dev instance — manual verification, per `end-to-end-verification.md`; requires the user's dev server (do not attempt to start it yourself — ask the user to verify, or verify via the extension-dev MCP tools if the dev server is already running).
- [ ] `npm run typecheck && npm run test:prepush` pass.

**All criteria must pass before task is complete.**

---

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/electron/src/renderer/components/GlobalSettings/panels/OllamaPanel.tsx` | create | New settings panel, modeled on `LMStudioPanel.tsx` |
| `packages/electron/src/renderer/store/atoms/appSettings.ts` | modify | Add `ollama` provider default + `ollama_url` default (mirrors lines 1203, 1215) |
| `packages/electron/src/renderer/components/Settings/SettingsView.tsx` | modify | Add `case 'ollama':` to the provider-panel switch (~line 874-875) |
| `packages/electron/src/renderer/components/Settings/SettingsSidebar.tsx` | modify | Add `'ollama'` sidebar route entry (~line 148) |
| `packages/electron/src/renderer/components/Settings/settingsRoutes.ts` | modify | Add `'ollama'` to `SettingsRouteId` union and icon allow-list (~lines 17, 42) |
| `packages/electron/src/renderer/components/Settings/panels/ProjectAIProvidersPanel.tsx` | modify | Add `ollama` to the per-project `PROVIDERS` array (~line 55) |
| `packages/electron/src/renderer/components/UnifiedAI/ModelSelector.tsx` | modify | Add `ollama` to provider switch + group-header label (~lines 264, 318) |
| `packages/electron/src/renderer/utils/modelUtils.ts` | modify | Add `ollama` display/badge/cleanup branches (~lines 182, 197, 220, 248) |
| `packages/electron/src/renderer/utils/chatProviderVisibility.ts` | modify | Add `ollama` to `DIRECT_CHAT_PROVIDER_IDS`, new `DEFAULT_OLLAMA_BASE_URL`, new ollama branch in `isDirectChatProviderMeaningfullyConfigured` (~line 59 area) |
| `packages/electron/src/renderer/services/aiApi.ts` | modify | Add `'ollama'` to provider union (~line 340) |
| `packages/runtime/src/ui/icons/MaterialSymbol.tsx` | modify | Add `ollama` icon factory entry (~line 54) — cosmetic |
| `packages/runtime/src/ui/AgentTranscript/components/RichTranscriptView.tsx` | modify | Add `case 'ollama':` display-name branch (~line 1735) — cosmetic, has `default:` fallback |
| `packages/electron/src/renderer/components/Settings/__tests__/settingsRoutes.test.ts` | modify | Extend the `arrayContaining(['claude', 'openai', 'lmstudio'])` fixtures (~lines 114, 117) to include `'ollama'` |
| `packages/electron/src/renderer/components/UnifiedAI/__tests__/modelPickerKeyboard.test.tsx` | modify | Add an `ollama` entry to the models fixture (~line 234) only — no new assertions |
| `packages/electron/src/renderer/utils/__tests__/chatProviderVisibility.test.ts` | modify | Add a new `it()` (or `it.each` row) exercising the ollama branch's own default-URL detection logic |

### File Ownership Notes

All files are renderer-only; none overlap with T2a's main-process files or T3's `OpenCodeConfigService.ts`/`OpenCodeConfigHandlers.ts`/`OpenCodePanel.tsx`. No file in this list falls under `boundaries.require_review` in `config.yaml` (that list is `package.json`, `package-lock.json`, `packages/electron/src/main/**`, `packages/runtime/src/auth/jwtScopes.ts`, `packages/electron/build/**`, `CHANGELOG.md`) — this task touches none of them, so no extra review gate applies beyond normal PR review.

---

## Implementation Guidance

### Patterns to Follow

See "Research Context" above for exact file:line anchors. In one sentence: every change in this task is "find the `lmstudio` branch/entry/case and add the `ollama` equivalent next to it," with the single exception of `chatProviderVisibility.ts`, which needs new logic rather than a parallel branch copy-paste (see "Known Issue to Address").

### Code Style

- Match `LMStudioPanel.tsx`'s exact Tailwind utility structure and `--nim-*` CSS variable usage in `OllamaPanel.tsx` — do not introduce new variable names or hardcoded colors (see `UI_PATTERNS.md`).
- The root `<div>` already carries a stable kebab-case class (`provider-panel` in `LMStudioPanel.tsx`) — keep that pattern in `OllamaPanel.tsx` per `REACT_DOM_MARKERS.md`; you may want a more specific root class (e.g. `ollama-panel`) if downstream E2E/dev-tooling needs to target it specifically, but `provider-panel` on the root plus a distinguishing wrapper class is also acceptable — follow whatever `LMStudioPanel.tsx` actually does.
- Ternaries for mutually exclusive Tailwind class states (test-button color states) — copy `LMStudioPanel.tsx`'s existing pattern verbatim, don't refactor it into something else while porting.

### Edge Cases

- **Daemon unreachable:** `OllamaPanel.tsx`'s "no models found" copy should say something Ollama-specific (e.g. "No models found. Make sure Ollama is running with at least one model pulled.") — don't leave LM Studio's wording in a copy-pasted string.
- **Empty vs default base URL in visibility check:** `hasText()` already handles `undefined`/whitespace-only strings; your new ollama branch in `chatProviderVisibility.ts` should reuse `hasText()` and `normalizeBaseUrl()` exactly as the lmstudio branch does — don't write new trimming/lowercasing logic.
- **`ollama_url` vs `apiKeys.ollama_url` naming:** the settings key is `ollama_url` (bare, under the `apiKeys.*` namespace) — confirm the exact key name against what T2a actually landed in `keys.ts` before wiring `chatProviderVisibility.ts` and `appSettings.ts`; the PRD's convention is `lmstudio_url` → `ollama_url` (not `ollama_base_url` or similar).
- **Model name cleanup regexes:** Ollama tags (e.g. `qwen2.5-coder:14b`) don't carry LM Studio's `-GGUF`/`-Q4_K_M` GGUF suffixes. Don't apply `modelUtils.ts`'s GGUF-stripping regex to ollama model names unmodified — check what a live `/v1/models` response actually returns (or use the tags from `research/findings.md`: `qwen3:14b`, `gemma3:12b`, `deepseek-coder:1.3b`, `qwen2.5:0.5b`, `qwen2.5-coder:14b`) and adjust the cleanup logic (or skip cleanup) accordingly.

### Testing Requirements

- **`chatProviderVisibility.test.ts`** — add a new test case (or `it.each` row) that exercises the *ollama-specific* default-URL-override detection, structurally mirroring the existing `'non-default LM Studio URL'` and `'legacy LM Studio URL'` rows (lines 41-42 of the current file) but asserting against `DEFAULT_OLLAMA_BASE_URL` / `apiKeys.ollama_url`. This is required — a fixture-only update does not satisfy the acceptance criterion, since the ollama branch is new behavior.
- **`modelPickerKeyboard.test.tsx`** — add an `ollama` entry to the models-by-provider fixture object (mirrors the existing `lmstudio: [{ id: 'lmstudio:local', ... }]` row) and nothing else. Do not add new assertions on ordering, count, or label text for the added fixture — presentation-only, not worth testing per repo convention (explicitly called out in the acceptance criteria for this task).
- **`settingsRoutes.test.ts`** — extend the two `expect.arrayContaining([...])` fixture arrays to include `'ollama'`; this is a data/fixture change to an existing structural assertion (route visibility), not a new assertion, and is in scope.
- **File header convention:** if any touched test file already starts with `// @vitest-environment node` (confirmed true for `chatProviderVisibility.test.ts`), keep it — none of these files touch the DOM in a way that would require jsdom beyond what's already configured.
- **Manual verification (cannot be automated):** an Ollama-backed session must appear in the model picker and stream a real response in a running dev instance. Per this repo's end-to-end-verification rule, do not declare this criterion met without observing it — use the extension-dev MCP tools (`get_environment_info`, `renderer_eval`, `get_main_process_logs`) against a dev server the user has started, rather than asking the user to manually test and report back.

### Coverage Expectations

This task's `files_affected` includes three test files (`settingsRoutes.test.ts`, `modelPickerKeyboard.test.tsx`, `chatProviderVisibility.test.ts`), triggering coverage expectations even though it is not a dedicated test task.

**Target Files for Coverage:**

| File | Target | Rationale |
|------|--------|-----------|
| `packages/electron/src/renderer/utils/chatProviderVisibility.ts` | 80%+ on the new `ollama` branch specifically | This is the one piece of genuinely new logic in the task — the visibility-detection branch — and it is exactly what regressed if left untested (see "Known Issue to Address") |

**Intentionally Uncovered Lines:**

- **`OllamaPanel.tsx` (entire file)** — no dedicated component test required; `LMStudioPanel.tsx` (its template) has none either, and this repo's convention is no presentation-only tests for rendering/markup.
- **`modelUtils.ts` new `ollama` branches** — display-name/badge-text string formatting, covered by "a human would notice the breakage in one second of looking at the screen" per repo testing convention; not asserted directly.
- **`ModelSelector.tsx`, `SettingsView.tsx`, `SettingsSidebar.tsx`, `settingsRoutes.ts` route/switch additions** — structural wiring already exercised indirectly by `settingsRoutes.test.ts`'s visibility assertions; no additional dedicated unit test needed for the routing itself.

**Verification:**
```bash
npm run test:prepush --coverage
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
- `packages/electron/src/main/**`
- `packages/runtime/src/auth/jwtScopes.ts`
- `packages/electron/build/**`
- `CHANGELOG.md`

None of this task's files fall under `require_review` — this task is entirely renderer-side plus two cosmetic runtime UI files, no main-process or build/package changes.

---

## Dependencies

### Upstream Tasks

| Task | What It Provides | Verify Before Starting |
|------|------------------|------------------------|
| T2a | `ai.apiKey.ollama_url` (default `http://localhost:11434`) and `ai.provider.ollama` settings keys in `keys.ts`; both `CHAT_PROVIDERS` arrays in `AIService.ts` include `'ollama'`; connection-test IPC works against the live daemon | Read `packages/electron/src/shared/settings/keys.ts` and confirm the exact key names (`ollama_url`, not `ollama_base_url`) before wiring `appSettings.ts`/`chatProviderVisibility.ts`. Grep `AIService.ts` for `CHAT_PROVIDERS` and confirm `'ollama'` is present in both literal arrays. |
| T1 | `OllamaProvider` class registered in `AI_PROVIDER_TYPES`, `ProviderFactory`, `ModelRegistry`, `agentCapabilities.ts` (`NO_AGENT_CAPABILITIES`), and the runtime barrel export | Confirm `packages/runtime/src/ai/server/index.ts` exports `OllamaProvider` — without it, nothing in `packages/electron` can import provider types cleanly, though this task's files don't import `OllamaProvider` directly (they work off the generic `AIProviderType` union and settings). |

### Downstream Impact

None — no task in this PRD depends on T2b. T3 (OpenCode-Ollama coding-agent bridge) is fully independent, shares no files, and can run before, during, or after this task.

**Before starting:** verify T2a landed by checking `packages/electron/src/shared/settings/keys.ts` for `ai.apiKey.ollama_url` and confirming `npm run typecheck` is currently green on `packages/electron`'s main process (T2a's own acceptance criterion). If T2a is incomplete, this task's settings-key references will not resolve.

---

## GitHub Context

**Issue:** Not applicable — no GitHub Issues are used for this PRD; work is tracked via aven/beads per repository convention (`bd prime` for workflow context).
**Feature Issue (Parent):** Not applicable (see above)
**Branch:** `worktree/ollama-provider-T2b`
**Target:** Determined by PM agent based on execution mode (feature branch or main)

---

## Commit Guidelines

Use Conventional Commits:
```
feat(electron): wire ollama provider into settings UI and model picker
```

Types: feat, fix, refactor, test, docs, chore

Do not add `Co-Authored-By` lines (repository convention — see project `CLAUDE.md`). If this task closes a GitHub issue, none exists to reference here; if a bead tracks this work, cite the bead id in the commit body per repo convention, not in this brief (the executing agent resolves the specific bead id at execution time).

---

## Validation Checklist

Before creating PR:
- [ ] All success criteria met
- [ ] Build passes: `npm run build`
- [ ] Type check passes: `npm run typecheck`
- [ ] No `never_touch` files modified
- [ ] Tests added/updated (`chatProviderVisibility.test.ts` new ollama-branch case; fixture-only updates to `modelPickerKeyboard.test.tsx` and `settingsRoutes.test.ts`)
- [ ] `npm run test:prepush` passes
- [ ] Branch rebased on target branch (feature branch or main)
- [ ] Manual dev-instance verification of an Ollama-backed chat session streaming a real response (per end-to-end-verification rule — do not skip)

---

*Generated by NIMBLE Brief Writer*
*PRD: ollama-provider | Task: T2b | Wave: 3*
