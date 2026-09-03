# Internal research: task-genius-sync — consolidated findings

Cross-repo discovery for a two-way sync between:

- **Nimbalyst** — `/home/jayden-eppcohen/Documents/Projects/Software/nimbalyst`
- **Task Genius fork** — `/home/jayden-eppcohen/ProtonDrive/Obsidian/Obsidian.Marvin/.obsidian/plugins/task-genius-fork` (branch `feat/series-recurrence`)

Discovery only. No solution is chosen here; options and their costs are recorded for planning.

> **Method note.** Every claim is cited `file:line` and was read in the source. Absence claims were checked with exact grep. Paths without a repo prefix are relative to the repo named in the section heading.

---

## The five findings that should shape the plan

### 1. Both codebases already have a provider/source seam, and both used GitHub as the reference implementation

This is the strongest structural argument that the two can meld rather than be bolted together.

**Nimbalyst** has a first-class tracker-importer extension point:

- `packages/extension-sdk/src/types/trackerImporter.ts:40` — `TrackerImporterContribution`, declared in a manifest under `contributions.trackerImporters[]`, routed by `urnScheme` (`:48`) and backed by a backend module (`:53`).
- `:28` — the RPC surface: `importer.isAuthenticated`, `listBindings`, `list`, `fetch`, `openExternal`.
- `packages/runtime/src/core/DocumentService.ts:55` — `TrackerItemSource = 'native' | 'inline' | 'frontmatter' | 'import'`.
- `ExternalSourceRef` (same file) carries `providerId`, `externalId`, a namespaced `urn`, `titleSnapshot`, `stateSnapshot`, `importedAt`, `lastSyncedAt`.

**Task Genius** has the mirror-image concept in its dataflow layer:

- `src/dataflow/sources/` — `ObsidianSource.ts`, `FileSource.ts`, `IcsSource.ts`, `GithubIssueSource.ts`.
- `src/managers/github-issue-manager.ts` — the manager behind that source.
- `fork-docs/specs/2026-07-14-github-issue-sync-design.md` — its design doc.

`CHANGELOG-FORK.md` records that `GithubIssueSource` was written by mirroring `IcsSource`, which is direct evidence the seam takes new sources without carving a new one.

**Implication.** A Task Genius ↔ Nimbalyst sync has a sanctioned place to live on *both* sides. This is not a greenfield integration.

### 2. Nimbalyst's importer contract is deliberately read-only — and says so, along with how to extend it

The decisive constraint, and the main scope question for planning.

`packages/extension-sdk/src/types/trackerImporter.ts:8-11`:

> "This is a strict READ-side, one-shot subset of the broader `TrackerProvider` design: `listBindings` + `list` + `fetch` are enough to power snapshot import. Write/sync/comment methods can be added later as optional methods without breaking importers written against this contract."

`:145` reinforces it: `fetch` is "One-shot read; the host decides create vs merge."

So the extension point exists but implements *half* of what this feature needs. Two-way requires extending `ImporterMethods` with write methods — which the contract's own author anticipated and designed for. That is the sanctioned path, not a workaround.

**Open question for planning:** does the sync extend `ImporterMethods` (benefits every future provider, larger blast radius, `packages/extension-sdk` is a published contract) or ship as a bespoke integration first and generalise later?

### 3. Identity: Task Genius already has a home for Nimbalyst's ULID — this is the hardest problem and it is largely solved

Task Genius has **two** distinct id concepts, and conflating them would be a serious design error:

- `src/types/task.d.ts:10` — `BaseTask.id`, "Unique identifier for the task". Internal to the index.
- `src/types/task.d.ts:57` — `metadata.id`, "Unique task identifier", sitting beside `dependsOn` (`:56`, "IDs of tasks this depends on").

`metadata.id` is the **user-facing, in-band, round-tripped** id, and it is parsed from both syntaxes:

- `src/dataflow/core/ConfigurableTaskParser.ts:2079` — `"🆔": "id"` (the Tasks-plugin emoji convention).
- `:795` — `id: "id"` in the dataview-field map, i.e. `[id:: value]`.

It is a free-text string with no format constraint, so Nimbalyst's `tsk_<ulid>` can be stored verbatim as `🆔 tsk_01H…` or `[id:: tsk_01H…]`.

Nimbalyst's id generation is `packages/runtime/src/plugins/TrackerPlugin/models/IDGenerator.ts:70` — `generateTrackerId(type)`, format `{prefix}_{ulid}` (`:67`), prefix derived by removing vowels, max 4 chars (`:50`).

**Implication.** The primary identity mechanism needs no new convention and no sidecar map. Nimbalyst mints the ULID; Task Genius carries it in a field it already parses and preserves.

**Caveat, and it matters.** The external research found the Tasks plugin's own docs state `🆔` uniqueness is *intended but not enforced*. Nothing stops a user duplicating a line. The sync must not assume the id is unique in the vault — it has to detect duplicates rather than trust them.

### 4. Task Genius identifies a task positionally at write time, but now refuses stale writes

`WriteAPI` resolves a task by id through the index, then writes by **file path + line number**. The line number is the write target, not the id.

That was recently hardened. `src/dataflow/api/taskLineWrite.ts` — `applyTaskLineChange(contents, change)` replaces the target line **only if it still holds what was read**, returning `null` otherwise; `WriteAPI.writeTaskLine` wires it to `vault.process` (Obsidian's atomic read-modify-write) and reports a stale write as a failure rather than clobbering.

**Implication.** Task Genius's write path already has optimistic-concurrency semantics, which is most of what a sync writer needs. A sync can reuse it and treat a stale result as "re-resolve and retry", instead of building its own locking.

**Also relevant:** `src/pages/blockEditHistory.ts` gives Agenda edits an undo stack of whole-file snapshots. If the sync writes to daily notes, whether sync writes should be undoable — and whether they should push onto the same history — is a real design question, not an afterthought.

### 5. Nimbalyst already does content-hash change detection and refuses to auto-overwrite

`ExternalSourceRef` (`packages/runtime/src/core/DocumentService.ts`) carries:

- `bodyHash` — "Host-computed hash of the upstream body markdown at last sync. Lets re-snapshot detect an upstream body change without storing the full body or diffing Lexical content."
- `upstreamBodyChanged` — "Set by re-snapshot when the upstream body changed since last sync. The detail view surfaces a banner so the user can apply or dismiss the change (**the body is never auto-overwritten**)."

**Implication.** Nimbalyst has already chosen a conflict posture — detect, surface, let the user decide — and built UI for it. A sync design that silently auto-merges would contradict an existing, deliberate product decision. Match it.

---

## Data model comparison

| Concern | Nimbalyst | Task Genius | Maps cleanly? |
|---|---|---|---|
| Line syntax | `- [Description] #task[id:… status:… priority:… created:…]` — **no checkbox** | `- [ ] text` + emoji or `[k:: v]` — **checkbox required** by the canonical writer | **No.** See risk below |
| Stable id | `{prefix}_{ulid}`, in-band | `metadata.id` via `🆔` / `[id:: ]`, in-band | **Yes** |
| Status | Per-type vocabulary from `.nimbalyst/trackers/*.yaml`; built-ins default `to-do` | Checkbox char (` `, `x`, `/`, `-`, `>`, …), configurable via `taskStatuses` | **No.** Needs an explicit mapping table |
| Priority | `priority:medium` free-ish string | `⏫`/`🔼`/`🔽` or `[priority:: ]`, numeric internally | Lossy both ways |
| Dates | `created:YYYY-MM-DD` | `📅` due, `🛫` start, `⏳` scheduled, `✅` completion | TG is richer; Nimbalyst has no due-date built-in |
| Types | bug / task / idea / decision / plan + custom YAML types | One task kind (plus `kind: "event"`, `task.d.ts:24`) | Nimbalyst is richer; needs a tag or field to carry type |
| Storage | `nimbalyst-local/tracker/{type}s.md` + a tracker DB/widget | Any vault file; dataflow index + `persistence/Storage.ts` | Both markdown-first |
| Body/description | Rich Lexical body, converted from markdown on import | A single line, plus indented child lines | **No.** Structural mismatch |

### The syntax mismatch is the sharpest incompatibility

Nimbalyst items are **not checkboxes**; Task Genius's canonical writer (`formatTimeBlockLine` and the task writer) always emits `- [ ]`.

Recent work in the fork softened the *reader* — `src/parsers/time-block.ts` now accepts checkbox-less list items when the time is unambiguous — but the task parser is a separate path and was not part of that change. Whether Task Genius can *read* a bare `- [Description] #task[…]` line as a task is **unverified and needs checking during planning**; it likely cannot, since a task requires a checkbox to carry status.

Options, all with real costs:
1. Nimbalyst writes checkboxes for synced items (changes its own file format).
2. Task Genius learns to read Nimbalyst's `#type[…]` form (a second grammar in the fork).
3. The sync **translates** rather than sharing a literal format, keeping each side canonical in its own house. Most likely correct — but it makes the sync stateful, since the mapping must be stored somewhere.

---

## Prior art inside the Task Genius fork — the pattern a third sync should follow

`src/managers/github-issue-manager.ts`, with `src/dataflow/sources/GithubIssueSource.ts`. Per `CHANGELOG-FORK.md`, it implements:

- Polling with `requestUrl`, pagination, and **server-derived `since` incremental sync** using a max `updated_at` watermark — the external research independently recommends watermarks over timestamps.
- Two-way close: checking the task in Obsidian closes the issue upstream; unchecking reopens it.
- **Read-only except completion.** Non-completion edits to a GitHub-backed task are rejected, diffed against the original task, in *both* `performUpdateTaskStatus` and `performUpdateTask` (`src/dataflow/api/WriteAPI.ts`).
- An **in-flight write guard** to stop a sync write echoing back as a local change — i.e. loop prevention already exists in this codebase.
- Retention pruning, per-repo timers, header-first rate-limit detection, `ProviderError`-based auth/rate-limit handling.
- Virtual, index-only tasks: GitHub issues are merged into `Repository` (`src/dataflow/indexer/Repository.ts`) without being written into vault files.

**That last point is a genuine architectural fork in the road.** GitHub issues are *index-only* — they appear in Task Genius views but never become markdown lines. A Nimbalyst sync could do the same (Nimbalyst items visible in Task Genius, no vault files written), which sidesteps the syntax mismatch and the write-back risk entirely, at the cost of those items not being real vault tasks the user can edit inline.

Options for planning: index-only projection, real markdown materialisation, or a per-binding choice.

---

## Change detection available on each side

**Task Genius:** `src/dataflow/sources/ObsidianSource.ts` (vault events), the event bus at `src/dataflow/events/Events.ts` (the GitHub sync added `GITHUB_ISSUES_UPDATED` there), persisted state at `src/dataflow/persistence/Storage.ts` (the GitHub sync added a `github:issues` namespace), and worker offload at `src/dataflow/workers/`.

**Nimbalyst:** the tracker DB is fed from markdown — `packages/extensions/planning/claude-plugin/commands/track.md` warns explicitly *not* to also call `tracker_create`, because "the markdown file you write is automatically synced to the tracker widget via frontmatter/inline parsing" and doing both "creates a duplicate entry — one from the file sync and one from the database insert."

That warning is a **live, documented instance of the exact double-write failure mode** a two-way sync must avoid. It is the single best piece of evidence for how this can go wrong in this codebase, and it already bit someone.

Supporting model code: `packages/runtime/src/plugins/TrackerPlugin/models/` (`TrackerDataModel.ts`, `ModelLoader.ts`, `YAMLParser.ts`, `trackerInbox.ts`, `trackerLifecycle.ts`, `schemaPatch.ts`), and `packages/runtime/src/core/TrackerRecord.ts` — the canonical record, splitting user data (`fields`) from infrastructure (`system`), with the rule that "no layer outside the schema may assume field names."

There is also a `packages/runtime/src/sync/trackerProtocol` (referenced from `TrackerRecord.ts:10`) and `packages/collab-*` — **not investigated in this pass**; whether the collab/sync layer is reusable for a local two-app sync is an open question worth an explicit look before planning settles.

---

## Transport options actually available today

Both apps run on one machine, one user.

| Option | Real today? | Notes |
|---|---|---|
| Shared filesystem | **Yes** | Nimbalyst can read the vault path directly; the vault is an ordinary folder |
| Nimbalyst tracker importer | **Partly** | Contract exists, read-side only — see finding 2 |
| Nimbalyst extension + backend module | **Yes** | `packages/extension-sdk`; importers already run privileged work in a utility process |
| Nimbalyst CLI | **Yes, unassessed** | `packages/cli` exists; `LiveGateway.ts` and `vendor/trackerRecord.ts` reference trackers |
| MCP | **Yes** | `.nimble/config.yaml` records a `nimbalyst-beads` MCP tier; the fork also ships `src/mcp/` |
| Obsidian plugin polling a folder | **Yes** | Mirrors how `IcsSource` and `GithubIssueSource` already work |

No network service is required, which removes auth entirely — a large simplification relative to the GitHub sync this pattern came from.

---

## Loop prevention and deletes — what already exists to reuse

- **In-flight write guard** — `src/managers/github-issue-manager.ts`. Proven in this codebase for exactly this problem.
- **Optimistic concurrency** — `src/dataflow/api/taskLineWrite.ts`, described in finding 4.
- **Tombstones** — `src/time/TimeEntryStore.ts` uses an append-only JSONL log where a deletion is a `{id, _deleted: true}` line and load is last-wins. A working local precedent for representing deletes, which the external research flags as non-optional.
- **Content hashing + user-mediated conflict** — Nimbalyst's `bodyHash` / `upstreamBodyChanged`, finding 5.

---

## Risks and unknowns to resolve during planning

1. **Can the Task Genius parser read a checkbox-less Nimbalyst line as a task?** Unverified. Determines whether option 1/2/3 above is viable.
2. **`🆔` uniqueness is not enforced** — the sync must detect duplicate ids rather than trust them.
3. **`packages/extension-sdk` is a published contract.** Extending `ImporterMethods` affects every importer and the marketplace. Needs a versioning decision.
4. **Body/description mismatch is structural** — Nimbalyst items have rich Lexical bodies; Task Genius tasks are one line plus children. Round-tripping a body through a task line is lossy in a way ids and dates are not.
5. **The collab/sync layer was not investigated.** `packages/runtime/src/sync/`, `packages/collab-protocol`, `packages/collab-adapters` may already solve part of this.
6. **Status vocabularies are open-ended on both sides** (custom tracker YAML types; configurable `taskStatuses`). A static mapping table will not cover user-defined states — the mapping probably has to be configurable too.
7. **Undo interaction** — Task Genius now has an Agenda undo stack. Whether sync writes participate is undecided.
