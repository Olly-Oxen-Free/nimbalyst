# Pre-Execution Review — PRD 001 ollama-provider

Reviewed briefs: `briefs/T1_ollama-provider.md`, `briefs/T2a_ollama-provider.md`,
`briefs/T2b_ollama-provider.md`, `briefs/T3_ollama-provider.md`, against the live
codebase at HEAD. Scope per instructions: cross-brief agreement, brief-writer
inference errors introduced in isolation, and task-boundary/file-ownership
correctness — not a full re-verification of every anchor already verified by
the brief writers (spot-checked ~45 file:line citations across all four briefs;
all but one were accurate).

## Critical Findings

### Finding 1 — T2b swaps `SettingsSidebar.tsx` and `settingsRoutes.ts` for the sidebar-entry and icon-lookup changes

**Affected File:** `briefs/T2b_ollama-provider.md` — Research Context ("Sidebar entry" /
"Route type + icon lookup" bullets), Requirements items 3–4, Files to Modify table.

**Actual State:**
- The routes array containing `{ id: 'lmstudio', scope: 'application', group: 'Chat
  Providers', label: 'LM Studio', icon: 'memory', isAvailable: directChatProvidersVisible }`
  lives in `packages/electron/src/renderer/components/Settings/settingsRoutes.ts:148`
  (inside `builtinSettingsRouteDefinitions`) — **not** in `SettingsSidebar.tsx`.
- `routeIcon()` — the function with the provider-icon allow-list array
  (`['claude-code', 'claude', 'openai', 'openai-codex', 'opencode', 'copilot-cli',
  'lmstudio']`) — is defined in `packages/electron/src/renderer/components/Settings/
  SettingsSidebar.tsx:41-42` — **not** in `settingsRoutes.ts`.
- The union type at `settingsRoutes.ts:17` that needs `'ollama'` added is named
  `ApplicationSettingsCategory`. No type named `SettingsRouteId` exists anywhere in the
  codebase (`grep -rn "SettingsRouteId"` returns zero hits).

**Problem:** T2b's brief has the two files reversed: it tells the executor to add the
routes-array entry to `SettingsSidebar.tsx` (no such array exists there — that file only
imports `getSettingsRoutesForScope` from `settingsRoutes.ts`) and to add to `routeIcon()`'s
allow-list inside `settingsRoutes.ts` (no such function exists there). Followed literally,
this either produces a compile error (pushing an object literal into a file with no array
to receive it) or forces the executing agent to rediscover the correct location mid-task,
burning time/turns on a task explicitly rated complexity 3/10. The `SettingsRouteId` name
will also send a `grep` search for the wrong identifier.

**Correction Needed:**
- Requirements item 3 → retarget to `settingsRoutes.ts`: add an `'ollama'` entry to
  `builtinSettingsRouteDefinitions` (~line 148) and to the `ApplicationSettingsCategory`
  union (~line 17).
- Requirements item 4 → retarget to `SettingsSidebar.tsx`: add `'ollama'` to `routeIcon()`'s
  provider-icon id array (~line 42).
- Fix the "Sidebar entry" / "Route type + icon lookup" Research Context bullets and the
  Files to Modify table to match (file names are currently swapped in the table too).
- Replace every reference to `SettingsRouteId` with `ApplicationSettingsCategory`.

## Warnings

### Finding 2 — T1's typecheck-blocking claim for `modelConstants.ts` is not accurate

**Affected File:** `briefs/T1_ollama-provider.md` — Known Issues, Requirements,
Success Criteria ("the enabledProviders and DEFAULT_MODELS fixups are what make this true").

**Actual State:** `packages/runtime/src/ai/modelConstants.ts:480`'s `DEFAULT_MODELS` is a
plain inferred object literal — no `Record<AIProviderType, string>` annotation, no
`satisfies` clause. Its only exhaustive-style consumer, `ModelIdentifier.ts:238`, indexes it
via `provider as keyof typeof DEFAULT_MODELS` (a cast, not a check), so a missing key causes
no compile error anywhere outside code that references `DEFAULT_MODELS.ollama` directly. By
contrast, `AIService.ts:3724`'s `enabledProviders: Record<AIProviderType, {...}> = {...}`
**is** genuinely exhaustively typed and would fail to typecheck without an `ollama` entry —
that half of T1's claim is correct.

**Problem:** Not execution-blocking — adding the `ollama` entry to `DEFAULT_MODELS` is still
the right thing to do (it's what `OllamaProvider.DEFAULT_MODEL`/`getDefaultModel()` should
stay consistent with), so no plan change is needed. But the brief overstates why, which could
mislead triage if the `DEFAULT_MODELS` edit is ever dropped under time pressure on the
assumption "typecheck will catch it if I forget."

**Correction Needed:** Reword the Known Issues/Success Criteria bullets to say only
`AIService.ts`'s `enabledProviders` literal is typecheck-blocking; the `DEFAULT_MODELS`
entry is required for behavioral consistency (matching `OllamaProvider.DEFAULT_MODEL`), not
for `npm run typecheck` to pass.

### Finding 3 — T3's commit-message example still contains the forbidden `Co-Authored-By` trailer

**Affected File:** `briefs/T3_ollama-provider.md` — Commit Guidelines code block.

**Actual State:** The example commit reads:
```
feat(opencode): add Ollama coding-agent bridge

Co-Authored-By: Claude <noreply@anthropic.com>
```
followed by a caveat paragraph explaining the repo's `CLAUDE.md` forbids this trailer and
to omit it. `T1`/`T2a`/`T2b`'s Commit Guidelines sections correctly omit the trailer from
their example blocks outright.

**Problem:** A copy-paste-shaped example with the trailer physically present in the fenced
block is a stronger signal than a prose caveat below it — an executor skimming for "the
commit message to use" can copy the block verbatim and violate the repo's explicit
"never add Co-Authored-By" rule.

**Correction Needed:** Delete the `Co-Authored-By` line from the example block; keep only
the explanatory sentence noting the repo forbids it.

### Finding 4 — T3's "known-working pattern" framing overstates what the cited comment shows

**Affected File:** `briefs/T3_ollama-provider.md` — Context section: "The file's own header
comment (line 33, referencing issue #284) already names Ollama as a config users have gotten
working manually this way... a known-working pattern, not a novel one."

**Actual State:** `OpenCodeConfigService.ts:28-33`'s comment describes a *bug*: before issue
#284's fix, the config path was hardcoded wrong on Windows, so a user (AnisminC) who had
configured several providers — including Ollama — via this generic `provider.*` mechanism
found **none of them** appearing in OpenCode's model picker. The comment is evidence a user
attempted to hand-write a `provider.ollama` block, not evidence that the resulting bridge
worked end-to-end for Ollama specifically.

**Problem:** Doesn't change the engineering plan (mirroring `upsertLMStudioBridge` is sound
regardless), and the brief still correctly requires a full manual E2E verification (real
OpenCode session + file edit) before the task can close. Low risk, but the "already proven,
not novel" framing could reduce scrutiny during that verification step if taken at face
value.

**Correction Needed:** Soften the claim — e.g. "the header comment shows a user had
configured (attempted, not confirmed-working) an Ollama block via this same generic
mechanism before a path bug was fixed; this task is what makes doing so reliable and
UI-driven, not proof the bridge shape was already validated for Ollama."

### Finding 5 — Hardcoded chat-provider error message omits Ollama; not called out in T2a

**Affected File:** `packages/electron/src/main/services/ai/AIService.ts:4438` (inside
`resolveExtensionChatProvider`), not mentioned in `briefs/T2a_ollama-provider.md`.

**Actual State:** `throw new Error('No chat provider available. Enable Claude, OpenAI, or LM
Studio in Settings > AI.')` — a hardcoded, provider-name-listing string in the same function
T2a's brief otherwise itemizes exhaustively (its `CHAT_PROVIDERS` array, the `apiKey`-required
check, and the `baseUrl` block are all called out at lines 4403/4443/4464-4466, but not this
message at line 4438).

**Problem:** Cosmetic only — the function will still work correctly for `ollama` once
`CHAT_PROVIDERS` includes it; this is purely a stale error-message string a user could see
when zero chat providers are enabled.

**Correction Needed:** Add this line as an optional cosmetic touch-up in T2a's Requirements
(or explicitly note it's deferred) so it isn't silently missed during review.

## Observations

1. **Strong cross-brief agreement on the load-bearing shared concepts.** `ollama_url` naming
   (`apiKeys.ollama_url`, bare string, no masking), the canonical default base URL
   (`http://localhost:11434`, used consistently in T1/T2a/T2b/T3 with no `127.0.0.1:*` leaks,
   unlike LM Studio's own documented inconsistency which T2a explicitly avoids propagating),
   `providerSettings.ollama` shape, `NO_AGENT_CAPABILITIES` registration, and the
   `ProviderCapabilities` field set (`streaming/tools/mcpSupport/edits/resumeSession/
   supportsFileTools`) all match exactly across T1 → T2a → T2b and against the live
   `LMStudioProvider.ts` / `chatProviderVisibility.ts` they're modeled on.

2. **File ownership and wave sequencing hold up.** The only file shared across a wave
   boundary is `AIService.ts` (T1's minimal stub → T2a's full wiring); both briefs describe
   the handoff identically and correctly. T3 shares zero files with T1/T2a/T2b — confirmed by
   grepping `OpenCodeConfigService.ts`, `OpenCodeConfigHandlers.ts`, and `OpenCodePanel.tsx`
   against T1/T2a/T2b's file lists.

3. **T2a's `aiServiceUtils.test.ts` "don't touch it, it's dead stub data" claim is verified
   correct.** `aiServiceUtils.test.ts:36` does contain a real `AI_PROVIDER_TYPES` array
   literal (not a comment, contradicting the task-description premise the brief itself flags
   as inaccurate) inside a `vi.mock`, and nothing else in the file reads or asserts on it.

4. **Model tier assignment is inconsistent with the repo's own subagent-selection guidance,
   though this is a NIMBLE/orchestration concern, not a codebase-state issue.** T1 is
   assigned `Model: opus` while T2a/T2b/T3 (comparable or lower complexity, and T1 is
   explicitly framed as "clone and substitute the provider name," not novel design) are
   `sonnet`. `config.yaml`'s `execution.default_model` is `sonnet`. Worth a second look before
   execution, not a blocker.

5. **~40 other file:line anchors checked across all four briefs (types.ts, ProviderFactory.ts,
   ModelRegistry.ts, agentCapabilities.ts, modelConstants.ts, keys.ts, AIService.ts,
   MessageStreamingHandler.ts, SyncManager.ts, preload/index.ts, electron.d.ts,
   chatProviderVisibility.ts + its test, LMStudioPanel.tsx, modelUtils.ts, ModelSelector.tsx,
   aiApi.ts, appSettings.ts, ProjectAIProvidersPanel.tsx, MaterialSymbol.tsx,
   RichTranscriptView.tsx, settingsRoutes.test.ts, modelPickerKeyboard.test.tsx,
   OpenCodeConfigService.ts, OpenCodeConfigHandlers.ts, OpenCodePanel.tsx) all matched the
   live codebase exactly** — the brief writers' own source-verification pass was thorough;
   Finding 1 above is the one place two of those anchors were swapped between files.

## Correction Summary

| # | Severity | File | Action |
|---|---|---|---|
| 1 | Critical | `briefs/T2b_ollama-provider.md` | Swap file attributions back: routes-array entry → `settingsRoutes.ts` (~line 148, plus `ApplicationSettingsCategory` union ~line 17); `routeIcon()` allow-list → `SettingsSidebar.tsx` (~line 42). Replace `SettingsRouteId` with `ApplicationSettingsCategory` throughout. |
| 2 | Warning | `briefs/T1_ollama-provider.md` | Reword Known Issues/Success Criteria: only `AIService.ts`'s `enabledProviders` literal is typecheck-blocking; `DEFAULT_MODELS.ollama` is a behavioral-consistency requirement, not a compile requirement. No code-plan change needed. |
| 3 | Warning | `briefs/T3_ollama-provider.md` | Remove the `Co-Authored-By` line from the example commit block. |
| 4 | Warning | `briefs/T3_ollama-provider.md` | Soften the "known-working pattern, not novel" framing of the issue #284 comment — it documents an attempted-but-broken config, not a validated bridge. |
| 5 | Warning | `briefs/T2a_ollama-provider.md` | Optionally add the `resolveExtensionChatProvider` error string (`AIService.ts:4438`) to the touch-point list, or explicitly note it's deferred. |

## Execution Clearance

**PROCEED WITH CAUTION** — one Critical finding (Finding 1) should be corrected in
`T2b_ollama-provider.md` before T2b executes (T1/T2a/T3 can proceed as-is; T2b is Wave 3,
so there is no urgency blocking Waves 1–2). The Warnings are non-blocking polish/accuracy
items that do not require a brief-correction pass before starting execution, but should be
folded in opportunistically (Findings 2, 4, 5 are one-line rewording/additions; Finding 3
is a one-line deletion).
