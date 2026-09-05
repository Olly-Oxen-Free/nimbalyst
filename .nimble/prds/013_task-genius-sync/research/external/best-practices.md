# Two-way sync fundamentals — best practices

## 1. Stable identity across systems

Every durable two-way sync scheme keys off a stable, opaque, immutable id minted once and carried unchanged in both systems, never derived from mutable content (title, line number, position in file). Position-based or content-based matching (fuzzy title match, line index) breaks the moment either side reorders or edits text. The id must be embedded in-band in the markdown line — not in a side index alone — because line reordering, cut/paste between files, and copy-paste by the user are common, and only the id survives them.

Concrete embedding mechanisms seen in the wild (see references.md for per-plugin detail):
- Emoji/inline field appended to the line (`🆔 20260213-a1b`) — obsidian-tasks native convention.
- HTML comment appended to the line (`<!-- todoist-id:123 -->`) — invisible in reading mode.
- Sidecar/mapping file keyed by generated id, vault line left untouched by the sync engine.

Nimbalyst's `#task[id:tsk_<ulid> ...]` block is already this pattern — an in-band, bracketed metadata block carrying a stable id. The open question for the sync layer is only how Task Genius mirrors/reads that id (or mints its own and maps it), not whether an id is needed.

## 2. Change detection

Never diff by re-scanning "did anything change" globally; that's O(n) per file per event and races with the editor's own writes. The established patterns, layered:
- **mtime/hash as a first-pass filter**, not a source of truth — coalesce watcher noise (see chokidar section below).
- **Per-item content hash or version counter** stored alongside the id, so an unchanged item is provably unchanged even if the file it lives in touched disk (e.g. another task in the same file edited).
- **A monotonic sync cursor ("watermark"), not wall-clock timestamps**, to decide what's new since last sync. Timestamps are unsafe as the sole cursor because: clock skew between the two apps/processes, sub-second write bursts colliding at the same timestamp, and DST/timezone bugs. A watermark is an opaque, monotonically increasing marker (a counter, a change-log sequence number, or a server-issued cursor) that the source system hands back and the sync engine persists and replays from — it does not require clocks to agree.

## 3. Loop prevention (echo suppression)

The single most common two-way-sync bug: engine writes side B → B's own file watcher fires → engine reads that write back as a "new external change" → pushes it back to A → infinite ping-pong (or duplicate items). Established fixes, used in combination:
- **Self-write suppression window**: before writing a file, register its path (or path+expected-hash) in an ignore-set; the watcher checks the set before treating an event as external, and clears the entry after the write completes (or after a short timeout as a safety net).
- **Content/hash comparison on the receiving watcher**: if the new file content, after normalizing whitespace/frontmatter, hashes identically to what the sync engine just wrote, drop the event even if the ignore-set missed it (belt and suspenders against timing races).
- **Directional version/echo tags**: stamp the write with "last writer" (or a version counter bumped once per logical change) so the other side can tell "this file changed because *I* wrote it" from "this changed because the user edited it."
- **Atomic writes** reduce the number of watcher events per logical change (see below) and make the ignore-set window shorter and more reliable.

## 4. Conflict detection and resolution strategies

Three tiers, increasing in cost and complexity:
- **Last-write-wins (LWW)**: simplest, used by nearly every real plugin surveyed (Todoist, CalDAV, Google Tasks sync). Acceptable when conflicts are rare (single user, mostly-sequential edits across two apps on one machine) and the cost of losing a field-level edit is low. Field-level LWW (per-field timestamp, not whole-record) is strictly better than whole-record LWW and cheap to add.
- **Three-way diff / merge**: compare (base version at last sync, side A now, side B now) rather than just A vs B. This is what lets a sync engine tell a genuine delete from "record missing because sync state was lost" — the Tasks-CalDAV-Sync plugin explicitly does this ("three-way diff detects deletions on either side... automatically matches identical tasks when switching calendars or after lost sync data, preventing duplicates"). This is the right altitude for two markdown-based systems: cheap enough to implement without a CRDT library, expressive enough to avoid silent data loss.
- **CRDTs (Yjs/Automerge)**: solve automatic, structural merge of concurrent edits to the *same* field/text, without a "winner." Overkill for whole-task-record sync between two local apps with no concurrent multi-editor scenario (see libraries.md) — the actual hard problem here is identity + loop-prevention + tombstones, not concurrent text merge.
- **Manual conflict mode**: several real plugins (Tasks CalDAV Sync) default to "pause and require user review" for anything not cleanly resolvable, with "X wins" as an explicit opt-in override rather than a silent default. Worth adopting as the safe default posture rather than silent LWW everywhere.

## 5. Tombstones for deletes

A delete is not "absence of a record" — in a two-way sync, absence is ambiguous between "deleted on the other side" and "never synced yet" or "sync state lost." The fix is a tombstone: when an item is deleted, keep a marker (id + deleted-at + last-known-version) for at least one full sync cycle (ideally longer, e.g. a rolling window) instead of just removing the row from the mapping store. Without tombstones, a lost/corrupted mapping file causes deleted items to reappear ("resurrect") on the next sync — this is a named failure mode in the CalDAV plugin research above ("Reconciliation ... preventing duplicates" exists specifically because naive re-matching resurrects deleted items).

## 6. Why sync tokens/watermarks beat timestamps — concretely

- Two processes on the *same machine* still don't share a clock domain reliably once sub-millisecond batched writes are involved (Node's fs timestamps have OS-dependent resolution, sometimes 1s on some filesystems).
- A watermark can be a simple "logical clock" — an integer that increments once per successful sync pass, stored per mapped item — with no dependency on wall time at all. This sidesteps DST, clock skew, and timestamp-collision problems entirely and is the cheapest correct option for two same-machine apps.
