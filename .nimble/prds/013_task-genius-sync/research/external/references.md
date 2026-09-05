# Prior art — Obsidian ecosystem two-way task sync

## Tasks CalDAV Sync (obsidian-caldav-sync family) — HIGHEST VALUE REFERENCE

The closest architectural analog found: bidirectional sync between obsidian-tasks markdown checkboxes and an external system (CalDAV/VTODO), with real markdown checkboxes staying in the vault on both sides (unlike Nextcloud Tasks, see below).

- **Identity mechanism**: stable id embedded directly in the task line using obsidian-tasks' own emoji-field syntax: `- [ ] Buy groceries 🆔 20260213-a1b`. Assigned automatically on first sync, or via an explicit "Inject task IDs" command. This is structurally identical to what Nimbalyst already does with `#task[id:tsk_<ulid> ...]` — an in-band bracketed/tagged metadata block on the same line as the item text.
- **Change detection / reconciliation**: explicit **three-way diff** ("Delete detection — three-way diff detects deletions on either side") plus a **reconciliation pass** that "automatically matches identical tasks when switching calendars or after lost sync data, preventing duplicates" — i.e., they anticipated mapping-store loss/corruption as a real failure mode and designed a recovery path for it, rather than assuming the mapping store is always intact.
- **Loop prevention**: "A sync ID is still written into each task that is pushed, so it can be matched on later syncs" plus a **per-device sync toggle stored on the device itself, not in the vault** (`Sync from this device`), explicitly to guarantee only one device talks to the CalDAV server at a time and avoid competing/simultaneous syncs. This is a device-level echo-prevention mechanism, distinct from (and additional to) file-write echo suppression.
- **Conflict resolution**: two explicit modes — `Manual (default)` (sync pauses, requires human review) and `Auto-resolve Obsidian wins`. In one-way modes conflicts resolve automatically toward the source. Manual-as-default is a deliberate safety posture, not an oversight.
- Source: https://community.obsidian.md/plugins/tasks-caldav-sync

## Sync Todoist / Syncist (obsidian-todoist-plugin family)

- **Identity mechanism**: `<!-- todoist-id:123 -->` — an **HTML comment** appended to the task line, invisible in Obsidian reading/preview mode. A different embedding technique from the emoji-field approach above, but the same principle: an opaque foreign-system id lives in-band on the task's own line, not only in a side file.
- **Conflict resolution**: user-configurable policy — "Obsidian wins," "Todoist wins," or "ask." Preserves local notes, nested outlines, project metadata, labels, query blocks, and daily-note structure around the synced line (i.e., the sync writer is scoped to touch only its own metadata, not the surrounding content — supports the "targeted line edit, not whole-file rewrite" recommendation in libraries.md).
- Sources: https://community.obsidian.md/plugins/sync-todoist , https://github.com/o1xhack/obsidian-sync-todoist , https://github.com/bastiaanschonhage/syncist

## Nextcloud Tasks plugin — notable one-way-shaped exception

- **Does not copy tasks into the vault at all.** No checkboxes written to notes, no local cache file that can drift. It fetches from CalDAV live, displays, and writes changes straight back to the server. This sidesteps essentially every problem in best-practices.md (identity, change detection, loop prevention, conflicts) by **not maintaining two independent copies** — but it does so by not being a true two-way *file* sync; the vault is a view onto the remote system, not a durable second copy. Worth naming as a fundamentally different, simpler architecture class that is NOT applicable here, since Nimbalyst's tracker markdown files and the user's Obsidian notes are each real, independently-edited files (both are sources of truth), not a view over one canonical remote store.
- Source: https://www.obsidianstats.com/plugins/nextcloud-tasks

## Google Tasks sync plugins

- No public technical detail found on identity/conflict mechanism beyond "real-time syncing" and per-user OAuth credential registration (each user registers their own Google/Todoist API credentials "due to quota and security reasons" — a note relevant if Task Genius sync ever needs API quota, though this feature is local-file-only so likely N/A).
- One integration (Morgen) explicitly does **not** sync Obsidian and Google Tasks directly — both feed a third calendar layer instead. Named here as a documented instance of "looks like two-way sync, is actually hub-and-spoke," worth ruling out explicitly for this design.
- Sources: https://community.obsidian.md/plugins/obsidian-google-tasks , https://www.morgen.so/google-tasks-obsidian-integration

## Vikunja — no dedicated technical detail found

- A "Vikunja Sync" Obsidian plugin is listed on Obsidian Stats but no README/mechanism detail surfaced in this pass. Likely CalDAV-compatible (Vikunja exposes a CalDAV interface) and may share mechanism with the CalDAV plugin above — **unverified**, flagging rather than asserting.
- Source (unverified beyond listing): https://www.obsidianstats.com/plugins/vikunja-sync

## Markdown metadata conventions (Tasks plugin + Dataview)

- **Tasks plugin id/depends-on fields**: `🆔 <id>` for a stable per-task id (chars restricted to `a-z A-Z 0-9 _ -`), consumed by `⛔ depends on <id>` for dependency links. Documentation explicitly states **uniqueness across the vault is intended but not enforced** by the plugin — i.e., even the closest thing to a "standard" stable-task-id convention in the Obsidian ecosystem has no collision guarantee built in. This is a real gap, not a solved problem — see findings.md.
  Source: https://github.com/obsidian-tasks-group/obsidian-tasks/blob/main/docs/Getting%20Started/Task%20Dependencies.md
- **Dataview inline fields**: `[key:: value]` bracketed syntax; Dataview additionally recognizes (a subset of) the Tasks plugin's emoji shorthand for date fields specifically, but explicitly does **not** support the emoji shorthand for priority or recurrence — Dataview and Tasks maintain overlapping but not identical metadata vocabularies.
  Sources: https://blacksmithgu.github.io/obsidian-dataview/annotation/metadata-tasks/ , https://github.com/blacksmithgu/obsidian-dataview/blob/master/docs/docs/annotation/metadata-tasks.md
- **No emerging vault-wide standard for a stable task id** beyond the Tasks-plugin `🆔` field was found. Nimbalyst's own `#task[id:tsk_<ulid> ...]` bracketed-block convention is a third, distinct format from both `🆔` and Dataview's `[key:: value]` — none of the three are interoperable without a translation step.
