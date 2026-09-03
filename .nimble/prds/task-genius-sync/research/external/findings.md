# External research: task-genius-sync — consolidated findings

Scope: external best practices and prior art for a two-way sync between a Task Genius Obsidian fork (emoji/dataview markdown tasks) and Nimbalyst's `#task[id:tsk_<ulid> ...]` tracker markdown. No solution design here — see best-practices.md, references.md, libraries.md, sources.yaml for full detail and citations.

## Top findings, ranked by decision relevance

1. **A near-identical prior-art system exists and should be the primary model: Tasks CalDAV Sync.** It syncs real markdown checkboxes bidirectionally with an external system, using an in-band stable id (`🆔 <id>` on the task line), a three-way diff for change/delete detection, a per-device "sync from this device" toggle for loop prevention, and a manual-review-by-default conflict mode with explicit opt-in auto-resolution. This is closer to Nimbalyst's actual shape than any generic sync-engine pattern. (references.md)

2. **CRDTs (Yjs/Automerge) are very likely the wrong tool here — this contradicts the "obvious" instinct to reach for one.** Every CRDT library found is built for concurrent multi-editor collaboration on shared documents. This feature is one user, two apps, sequential (not concurrent) edits, on one machine. The real hard problems are identity, loop prevention, and tombstoning deletes — none of which CRDTs solve, and adopting one forces both apps' storage model toward a binary CRDT document, conflicting with "stay plain, human-editable markdown." (libraries.md)

3. **Watermarks/logical version counters, not timestamps, should drive change detection**, because two same-machine processes still don't share a reliable clock domain (OS filesystem timestamp resolution varies, sub-second write bursts collide). A per-item version counter or vault-wide sync cursor sidesteps this entirely and is what watermark-based systems use instead of wall-clock diffing. (best-practices.md §2, §6)

4. **No universal stable-task-id standard exists in the Obsidian ecosystem — and the closest one has no uniqueness enforcement.** The Tasks plugin's own `🆔` id field documentation states uniqueness is "intended but not enforced." Nimbalyst's `tsk_<ulid>` is already a stronger scheme (ULID collision probability is negligible) — the gap is only that Task Genius's native id format and Nimbalyst's are two different, non-interoperable conventions requiring an explicit mapping, not a shared standard to adopt.

5. **Tombstones are not optional — every real plugin surveyed had to solve "how do I tell a delete from a lost mapping."** The CalDAV plugin's "reconciliation... after lost sync data, preventing duplicates" feature exists specifically because naive re-matching resurrects deleted items when the mapping store is stale or corrupted. Any design skipping explicit delete-tombstones will hit this failure mode in practice, not just in theory.

## Secondary but notable
- Nextcloud Tasks sidesteps sync entirely by not duplicating storage (view-over-remote, not two-way file sync) — an architecture class ruled out here since both markdown stores are independently user-edited sources of truth.
- Recommended stack: chokidar (atomic-write coalescing built in) + ulidx (matches existing `tsk_<ulid>` convention) + targeted line-level regex/string edits for writes (not full remark AST rewrite) + remark only for reading/extraction. No ready-made sync-engine library fits two file-based systems on one machine.
