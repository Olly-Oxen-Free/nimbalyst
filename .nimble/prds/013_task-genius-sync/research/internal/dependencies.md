# Evidence: dependencies and integration points

## What a sync would touch — Nimbalyst

| Path | Role | Risk |
|---|---|---|
| `packages/extension-sdk/src/types/trackerImporter.ts` | The contract to extend for write support | **Published contract.** Affects every importer + marketplace; needs a versioning decision |
| `packages/extension-sdk/src/manifestValidation.ts` | Validates `contributions.trackerImporters[]` (`:313`, `:416` reference `providerId`) | Must accept any new contribution fields |
| `packages/runtime/src/core/DocumentService.ts` | `TrackerItemSource`, `TrackerOrigin`, `ExternalSourceRef` | Adding a source kind touches read paths |
| `packages/runtime/src/core/TrackerRecord.ts` | Canonical record | "No layer outside the schema may assume field names" — respect it |
| `packages/runtime/src/plugins/TrackerPlugin/models/` | `TrackerDataModel`, `ModelLoader`, `YAMLParser`, `trackerInbox`, `trackerLifecycle`, `schemaPatch` | Where markdown becomes records |
| `packages/runtime/src/sync/trackerProtocol` | Referenced from `TrackerRecord.ts:10` | **Not investigated.** May already solve part of this |
| `packages/collab-protocol`, `packages/collab-adapters`, `packages/collab-client` | Existing sync machinery | **Not investigated** |
| `packages/cli` | `gateway/LiveGateway.ts`, `vendor/trackerRecord.ts` | Alternative transport, unassessed |
| `nimbalyst-local/tracker/*.md` | The markdown store | User-editable source of truth |

Config note: `.nimble/config.yaml` lists `packages/electron/src/main/**` and `package.json` under `require_review`, and `work_tracking.beads.tier: mcp`.

## What a sync would touch — Task Genius fork

| Path | Role | Risk |
|---|---|---|
| `src/dataflow/sources/` | Where a `NimbalystSource` would live | Low — established pattern |
| `src/managers/github-issue-manager.ts` | The closest prior art to copy | Read before writing anything new |
| `src/dataflow/Orchestrator.ts` | Source lifecycle | Low |
| `src/dataflow/events/Events.ts` | Event constants | Low |
| `src/dataflow/indexer/Repository.ts` | Index merge | Medium — affects counts and grouping |
| `src/dataflow/persistence/Storage.ts` | Watermarks, mapping state | Low |
| `src/dataflow/api/WriteAPI.ts` | Write-back, and the GitHub read-only guards | **High.** 3,500 lines, thin test coverage |
| `src/dataflow/api/taskLineWrite.ts` | Atomic line write + staleness check | Reuse rather than reinvent |
| `src/dataflow/core/ConfigurableTaskParser.ts` | Would need to emit/read the sync id | Medium |
| `src/types/fork-settings.ts`, `src/components/features/settings/ForkSettingsTab.ts` | Settings surface | Low — `githubSync` is the template |

## Third-party

Nimbalyst runtime `node>=24`, npm. Task Genius uses esbuild + jest, TypeScript 5.9, and already depends on `rrule`, `date-fns`, `chrono-node`, `localforage`.

Neither side currently depends on a file watcher usable for this (`chokidar` is recommended by the external research). Neither has a ULID library in the sync path — Nimbalyst generates ULIDs in `IDGenerator.ts`; whether via a dependency or inline was not checked.
