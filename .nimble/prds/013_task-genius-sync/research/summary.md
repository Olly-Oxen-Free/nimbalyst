# Research summary: task-genius-sync

**Feature.** A two-way sync between the **Task Genius fork** (an Obsidian plugin — inline markdown checkbox tasks with emoji/dataview metadata) and **Nimbalyst's** planning/tracker featureset (markdown list items carrying `#task[id:tsk_<ulid> status:… priority:… created:…]`, backed by a tracker DB and widget), so the two can meld.

Both run on one machine, for one user, and both are markdown-first. Detail and citations: `internal/findings.md`, `external/findings.md`.

---

## The shape of the problem

Structurally this is far more favourable than it looks, for one reason: **both codebases already have a provider/source extension point, and both used GitHub as the reference implementation.**

- Nimbalyst: `TrackerImporterContribution` + `ExternalSourceRef`, with `providerId` examples `'github-issues'`, `'linear'`.
- Task Genius: `src/dataflow/sources/{IcsSource,GithubIssueSource}.ts`, where `GithubIssueSource` was written by mirroring `IcsSource`.

Neither side needs a new architectural concept. The sync has a sanctioned home in both.

**The catch, and the main scope decision:** Nimbalyst's importer contract is deliberately **read-only and one-shot**, and says so — "a strict READ-side, one-shot subset of the broader `TrackerProvider` design… Write/sync/comment methods can be added later as optional methods without breaking importers written against this contract" (`packages/extension-sdk/src/types/trackerImporter.ts:8-11`). Two-way means extending that contract. The author anticipated it; it is the sanctioned path, not a hack. But `extension-sdk` is a published contract, so it needs a versioning decision.

---

## The seven findings that should shape the plan

1. **Identity is largely solved, and cheaply.** Task Genius already parses `🆔` and `[id:: value]` into `metadata.id` (`ConfigurableTaskParser.ts:2079`, `:795`) — a free-text field, distinct from the internal `BaseTask.id`. Nimbalyst's `{prefix}_{ulid}` (`IDGenerator.ts:67`) stores verbatim. No new convention, no sidecar map for the primary case.

2. **But the id cannot be trusted to be unique.** The Tasks plugin's own docs state `🆔` uniqueness is intended but *not enforced*. The sync must detect duplicates rather than assume them away.

3. **Reach for a CRDT and you will have chosen wrong.** Yjs/Automerge are built for concurrent multi-editor collaboration on shared documents. This is one user, two apps, sequential edits, one machine. The genuinely hard parts — identity, loop prevention, tombstoning deletes — are not what CRDTs solve, and adopting one pushes both stores toward a binary document, against the "stay plain, human-editable markdown" premise that is the whole point.

4. **A near-exact prior-art system exists: Tasks CalDAV Sync.** Bidirectional sync of real markdown checkboxes, using an in-band `🆔` id, a three-way diff, a per-device "sync from this device" toggle for loop prevention, and manual-review-by-default conflict handling. Closer to this feature's shape than any generic sync-engine pattern.

5. **Both sides already have the loop-prevention and conflict machinery.** Task Genius: an in-flight write guard in the GitHub sync, plus optimistic concurrency in `taskLineWrite.ts` (a write is refused when the line no longer holds what was read), plus JSONL tombstones in `TimeEntryStore.ts`. Nimbalyst: `bodyHash` + `upstreamBodyChanged`, where the body is **never auto-overwritten** — the user gets a banner and decides. That last one is a product decision already made and built; a design that silently auto-merges would contradict it.

6. **The syntax mismatch is the sharpest incompatibility.** Nimbalyst items have no checkbox; Task Genius tasks require `- [ ]` to carry status. Three options, all with real costs: Nimbalyst writes checkboxes, Task Genius learns a second grammar, or the sync *translates* and keeps each side canonical in its own house. The third is most likely right, and it makes the sync stateful.

7. **There is a genuine fork in the road on materialisation.** Task Genius's GitHub issues are **index-only** — visible in views, never written into vault files. A Nimbalyst sync could do the same, sidestepping the syntax mismatch and the write-back risk entirely, at the cost of those items not being real, inline-editable vault tasks. Or it can materialise real markdown. Or offer it per binding. This choice determines most of the rest of the design and should be made early.

---

## Warning worth reading twice

Nimbalyst's `/track` command carries an all-caps warning **not** to call `tracker_create` alongside writing the markdown file, because "the markdown file you write is automatically synced to the tracker widget… Calling `tracker_create` in addition creates a duplicate entry — one from the file sync and one from the database insert."

That is a live, documented instance of the exact double-write failure a two-way sync risks, already severe enough in this codebase to warrant the warning. Any design must state explicitly which layer writes and which merely observes.

---

## Reconciled disagreement between the two research phases

The external phase concluded that Task Genius's and Nimbalyst's id formats are "two different, non-interoperable conventions requiring an explicit mapping."

**That is not correct, and the internal phase supersedes it.** `metadata.id` is a free-text string with no format constraint (`src/types/task.d.ts:57`; parsed at `ConfigurableTaskParser.ts:795`, `:2079`), so a Nimbalyst ULID can live in it verbatim. This was verified directly in the source. It matters because it removes the need for a sidecar id-mapping store in the common case — a significant simplification the plan should assume.

---

## Recommended stack (from external research)

`chokidar` for watching (atomic-write coalescing built in, ~100ms default window; `@parcel/watcher` only wins past ~50k files), `ulidx` to match the existing `tsk_<ulid>` convention, targeted line-level string edits for writes with `remark`/mdast used only for *reading* — a full AST rewrite would reformat the user's file. No ready-made sync-engine library fits two file-based systems on one machine.

Watermarks or per-item version counters, **not wall-clock timestamps**, should drive change detection: two processes on one machine still lack a reliable shared clock domain, and filesystem timestamp resolution varies. Task Genius's GitHub sync already uses a server-derived `since` watermark, so the pattern is established locally.

---

## Open questions for planning

1. **Index-only projection or real markdown materialisation?** (finding 7) — decide first; most else follows.
2. **Extend `ImporterMethods` with write support, or ship bespoke and generalise later?** `extension-sdk` is published.
3. **Can the Task Genius *task* parser read a checkbox-less line?** Unverified. The recent `time-block.ts` widening covers time blocks, not tasks.
4. **Is `packages/runtime/src/sync/` or `packages/collab-*` already usable here?** Not investigated; worth an explicit look before the design settles.
5. **How are user-defined statuses mapped?** Both vocabularies are extensible, so the mapping probably has to be configurable rather than static.
6. **Do sync writes participate in Task Genius's Agenda undo stack?**
7. **What is the deletion contract?** Tombstones are not optional — every surveyed plugin had to solve "is this a delete, or a lost mapping?", and naive re-matching resurrects deleted items.

---

## Research provenance

- **External phase** ran as a `nimble-researcher` agent; artifacts in `research/external/`. Sources recorded in `sources.yaml` with honest `unverified` / `not individually fetched` markers.
- **Internal phase** was written directly rather than by an agent — the delegated agent produced no artifacts within its budget and was stopped. Every internal claim was read in the source and is cited `file:line`. The Task Genius side draws on extensive direct work in that codebase during the same session.
- **Not investigated:** `packages/runtime/src/sync/`, `packages/collab-*`, `packages/cli` tracker paths. Flagged above as open question 4.
