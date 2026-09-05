# Libraries worth evaluating

## File watching

| Library | Verdict | Reason |
|---|---|---|
| **chokidar** (v4, `paulmillr/chokidar`) | **Recommend** | Battle-tested (~30M repos), cross-platform event normalization, and — critically for this feature — a built-in `atomic` option (default on) that coalesces the unlink+add pair emitted by atomic-write editors into a single `change` event within a configurable window (default 100ms). This directly addresses the double-event and atomic-write-artifact problems both apps will hit. |
| `@parcel/watcher` | Reject (for this use case) | Faster on huge trees (50k+ files) via native backend, used by Nx/Tailwind/VSCode, but it's a native addon (platform-specific binaries, more fragile in an Electron+Obsidian dual-runtime setup) and its advantage only matters at a scale (tens of thousands of files) this feature won't approach — a per-vault `tracker/*.md` directory and an Obsidian vault subtree are both small. |
| raw `fs.watch` | Reject | Known cross-platform inconsistencies (duplicate events, missed events, no atomic-write handling) that chokidar exists specifically to paper over. |

## Id generation

| Library | Verdict | Reason |
|---|---|---|
| **ulidx** (maintained fork of `ulid`) | Recommend, matches existing convention | Nimbalyst already mints `tsk_<ulid>`; the original `ulid` npm package is unmaintained, `ulidx` is the maintained drop-in replacement with the same lexicographically-sortable, timestamp-prefixed 26-char Crockford-Base32 output. No reason to introduce a second id scheme for tasks crossing into Task Genius — reuse the existing ULID as the cross-system id, or map it to whatever Task Genius's own convention needs. |
| `crypto.randomUUID()` (built-in, UUID v4) | Reject as primary, fine as fallback | No install needed and cryptographically fine, but not time-sortable, and switching schemes mid-project would create two id formats to reconcile against the existing `tsk_<ulid>` convention already in use. |
| UUID v7 | Not applicable here | Solves the same time-sortable problem as ULID for *database* primary keys; no advantage over the ULID already chosen for this markdown-native use case. |

## Markdown/AST parsing (round-trip without reformatting)

| Library | Verdict | Reason |
|---|---|---|
| **remark** (`remark-parse` + `remark-stringify`, part of `unifiedjs`) | Recommend, with a caveat | Standard, actively maintained, mdast-based AST that both apps could plausibly already touch. It formats "in a way that works with most markdown parsers," but that phrasing itself is a warning: remark-stringify is a *pretty-printer*, not a byte-for-byte round-tripper — it will normalize whitespace, list markers, and emphasis style unless carefully configured (or unless the sync layer never rewrites unrelated content). **The caveat matters for this feature**: since the requirement is "don't reformat the user's file," the safer implementation is a *targeted line/region edit* (locate the exact line by id, string-replace only the metadata block on that line) rather than parse-whole-file → mutate-AST → stringify-whole-file. Reserve full AST parsing for *reading* (extracting task lines, ids, fields) rather than for *writing back*. |
| Regex/line-based parsing (no library) | Recommend for the write path specifically | Given both source formats are single-line, single-item metadata blocks (Tasks-plugin emoji fields, Nimbalyst's `#task[...]` block), a targeted regex match-and-splice on the specific line is lower-risk for formatting preservation than a full markdown AST rewrite, and is what most of the surveyed plugins actually do in practice (HTML-comment and emoji-field id injection are both single-line string edits, not AST rewrites). |

## Ready-made sync-engine libraries

| Library | Verdict | Reason |
|---|---|---|
| Yjs | Reject | Built for concurrent collaborative *text* editing (shared cursors, real-time multi-editor). This feature has no concurrent-editor scenario — one user, two apps, sequential edits — so Yjs buys conflict-free merge machinery the problem doesn't need, at the cost of a binary CRDT document format that doesn't map naturally onto "plain markdown lines a human also hand-edits." |
| Automerge | Reject, same reasoning as Yjs | Automerge stores full change history for predictable merges but has a larger storage footprint and the same mismatch: it wants to own the document's canonical representation, which conflicts with the requirement that the markdown files stay human-editable plain text as the source of truth. |
| PouchDB / RxDB / ElectricSQL | Reject | These solve sync *between a local database and a remote server* (or between database replicas). There is no database here on either side — both systems' source of truth is markdown files on the same filesystem. Pulling in a document database to mediate between two file-based systems adds a translation layer and a new failure mode (DB/file drift) without solving anything the file-watcher + mapping-store pattern doesn't already solve more directly. |
| **Custom mapping-store + chokidar + tombstones** (no framework) | Recommend | Given: single machine, two file-based systems, no concurrent-editor requirement, and an existing stable id already present on one side — the lowest-risk architecture is the hand-rolled pattern used by every real-world Obsidian task-sync plugin surveyed (CalDAV sync, Todoist sync): a small persistent id↔id mapping store, chokidar-based watchers with self-write suppression, and three-way diff against the last-synced snapshot. No general-purpose sync-engine library was found in the survey that both apps could adopt without one side rewriting its storage model. |

See best-practices.md §4 for why CRDTs are explicitly out of scope here, and references.md for the specific plugins whose (non-CRDT) approaches this recommendation is modeled on.
