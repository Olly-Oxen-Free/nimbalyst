# Evidence: project organisation

## Nimbalyst

Monorepo, npm workspaces, `node>=24`. Packages relevant here:

- `packages/extension-sdk` — the published extension contract, incl. `types/trackerImporter.ts`
- `packages/runtime` — core app logic: `core/` (DocumentService, TrackerRecord), `plugins/TrackerPlugin/` (models, transformer, atoms), `sync/`
- `packages/extensions/planning` — the `/design`, `/implement`, `/track` Claude-plugin commands; ships as a marketplace extension (`manifest.json`, `id: com.nimbalyst.planning`)
- `packages/collab-*` — protocol, adapters, client, bundle
- `packages/electron` — main + renderer; `src/main/services/tracker`, `src/renderer/components/TrackerMode`
- `packages/cli`, `packages/browser-extension`, `packages/android`, `packages/ios`, `packages/marketplace`

Tracker data lives in `nimbalyst-local/tracker/{type}s.md`; custom tracker type definitions in `.nimbalyst/trackers/*.yaml`.

NIMBLE is configured (`.nimble/config.yaml`, fast-track mode, 14 prior PRDs in `.nimble/prds/`).

## Task Genius fork

Single Obsidian plugin, pnpm workspace with `packages/calendar` and an esbuild worker plugin. TypeScript 5.9, esbuild, jest.

- `src/dataflow/` — the engine: `sources/`, `indexer/Repository.ts`, `api/{QueryAPI,WriteAPI,taskLineWrite}.ts`, `core/ConfigurableTaskParser.ts`, `persistence/Storage.ts`, `events/Events.ts`, `augment/`, `recurrence/`, `project/`, `workers/`
- `src/managers/` — long-lived services incl. `github-issue-manager.ts`, `ics-manager.ts`, `timer-manager.ts`
- `src/parsers/` — `ics-parser.ts`, `ics-recurrence.ts`, `time-block.ts`, `file-metadata-parser.ts`
- `src/pages/` — views: `AgendaDayTimeline.ts`, `TrackedTimeView.ts`, `timeBlockApplier.ts`, `blockEditHistory.ts`
- `src/time/` — Marvin Time: `TimeEntryStore.ts` (JSONL + tombstones), aggregation, reporting, ActivityWatch
- `src/types/task.d.ts` — the task model
- `fork-docs/` — dated `specs/`, `plans/`, `research/`. **Convention worth following:** the GitHub sync has both a design spec and a plan doc there.

Build note recorded in `fork-docs/`: the production build writes to `dist/`, while Obsidian loads the plugin-root `main.js`. Committing does not deploy.
