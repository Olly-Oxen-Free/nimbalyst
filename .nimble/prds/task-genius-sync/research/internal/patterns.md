# Evidence: patterns

## Nimbalyst — tracker importer contribution (the provider seam)

`packages/extension-sdk/src/types/trackerImporter.ts`

- `:28` `TRACKER_IMPORTER_RPC_METHODS` — `importer.isAuthenticated | listBindings | list | fetch | openExternal`
- `:40` `TrackerImporterContribution` — `id` (becomes `providerId`), `displayName`, `icon`, `urnScheme` (`:48`, routes by URN), `backendModuleId` (`:53`), `importsAs?`, `settingsPanelId?`
- `:61` `ImporterBinding` — a configured target (a repo, a team)
- `:78` `ImporterListEntry` — `externalId`, `urn`, `url`, `title`, `state`, `updatedAt`
- `:104` `ImporterExternalRef` — the pointer minus host-stamped timestamps
- `:118` `TrackerSnapshot` — `external`, `primaryType`, `title`, `body?` (markdown, host converts to Lexical), `status?`, `priority?`, `labels?`, `authorIdentity?`, `upstreamCreatedAt?`, `upstreamUpdatedAt?`
- `:138` `ImporterMethods` — the RPC surface

Runtime model (`:13-24`): importers do privileged work, so they run in the extension's **backend module** (utility process), not the renderer. The host's `TrackerImporterRegistry` turns a `TrackerSnapshot` into a real tracker item "through the normal create path (so sync, body Y.Doc, activity, and issue-key allocation all fire identically to a hand-created item)."

**Read-only by design** (`:8-11`): "a strict READ-side, one-shot subset of the broader `TrackerProvider` design… Write/sync/comment methods can be added later as optional methods without breaking importers written against this contract."

## Nimbalyst — external source pointer

`packages/runtime/src/core/DocumentService.ts`

- `:55` `TrackerItemSource = 'native' | 'inline' | 'frontmatter' | 'import'`
- `:99` `TrackerOrigin = { kind: 'native' } | { kind: 'inline'; filePath: string } | …`
- `ExternalSourceRef`: `providerId`, `externalId`, `urn` (namespaced, e.g. `github://owner/repo#42`), `url`, `titleSnapshot`, `stateSnapshot?`, `importedAt`, `lastSyncedAt`, `bodyHash?`, `upstreamBodyChanged?`

`bodyHash` doc: "Lets re-snapshot detect an upstream body change without storing the full body or diffing Lexical content."
`upstreamBodyChanged` doc: "The detail view surfaces a banner so the user can apply or dismiss the change (the body is never auto-overwritten)."

## Nimbalyst — canonical record

`packages/runtime/src/core/TrackerRecord.ts:1-7` — "the single authoritative shape for tracker items. All user-defined business data lives in `fields`. System/infrastructure metadata lives in `system`. **No layer outside the schema may assume field names.**"

Also defines `LinkedCommit` and `LinkedPullRequest` — existing precedent for linking a tracker item to external artifacts.

## Nimbalyst — markdown tracker item syntax

`packages/extensions/planning/claude-plugin/commands/track.md`

- Item form: `- [Brief description] #[type][id:[idPrefix]_[ulid] status:[default-status] priority:medium created:YYYY-MM-DD]`
- Built-in types: bug, task, idea, decision, plan → `nimbalyst-local/tracker/{type}s.md`
- Custom types: `.nimbalyst/trackers/*.yaml`, each with `type`, `idPrefix`, and its own status options
- **No checkbox** in the item syntax

## Nimbalyst — id generation

`packages/runtime/src/plugins/TrackerPlugin/models/IDGenerator.ts`

- `:2` "ID Generation system using ULID with type prefixes"
- `:50` `generatePrefix(type)` — first char always kept, then consonants, max 4 chars, lowercased
- `:67` format `{prefix}_{ulid}`
- `:70` `generateTrackerId(type)`

## Task Genius — dataflow source pattern

`src/dataflow/sources/` — `ObsidianSource.ts`, `FileSource.ts`, `IcsSource.ts`, `GithubIssueSource.ts`
`src/dataflow/Orchestrator.ts` instantiates, initialises, subscribes and cleans up each source.
`src/dataflow/events/Events.ts` — the event bus; the GitHub sync added `GITHUB_ISSUES_UPDATED`.
`src/dataflow/indexer/Repository.ts` — the index; the GitHub sync added a `githubIssues` field merged into `all`, `getTotalTaskCount` and `byProject`.
`src/dataflow/persistence/Storage.ts` — namespaced persistence; the GitHub sync added `github:issues`.

Per `CHANGELOG-FORK.md`, `GithubIssueSource` "mirrors `IcsSource`" — evidence the seam absorbs new sources.

## Task Genius — task identity

`src/types/task.d.ts`
- `:10` `BaseTask.id` — internal index identifier
- `:57` `metadata.id` — "Unique task identifier", beside `dependsOn` (`:56`)
- `:24` `kind?: "task" | "event"`

`src/dataflow/core/ConfigurableTaskParser.ts`
- `:2079` `"🆔": "id"` — Tasks-plugin emoji convention
- `:795` `id: "id"` — dataview `[id:: value]`

Free-text; no format constraint. Nimbalyst's `tsk_<ulid>` stores verbatim.
