# PRD 013 — task-genius-sync

```yaml
---
feature_name: "Task Genius ↔ Nimbalyst shared task substrate"
feature_slug: "task-genius-sync"
owner: "jeppcohen@gmail.com"
status: "draft"
created_date: "2026-09-03"
scope_type: "new-feature"
repos:
  - nimbalyst (this repo)
  - task-genius-fork (Obsidian plugin, separate repo)
links:
  - research/summary.md
  - research/internal/findings.md
  - research/external/findings.md
---
```

## Source

User request: *"we have an app called nimbalyst, with its own task planning featureset for coding. I want to propose a two-way sync between task genius fork and our nimbalyst fork that could allow the two to meld."*

Research ran first (`/nimble:research`, commits `cb79c6f30`, `57ee19003`, `229ba2578`). Planning was conducted as a direct interview rather than through the interviewer agent, across four rounds of decisions recorded below.

## Executive summary

Nimbalyst tracker items become **ordinary files in the Obsidian vault**, written by nimbalyst into a folder it owns, and read natively by the Task Genius fork. There is no sync engine, no reconciliation loop, and no second copy of anything. A single markdown line is valid to both parsers. Completing a task in Obsidian updates its nimbalyst status; nothing else flows back, and vault-native tasks never enter nimbalyst.

## The decision that shaped this: don't sync, share

The research assumed a sync and spent most of its length on the problems syncs have — identity, loop prevention, echo suppression, tombstones, watermarks, conflict resolution, duplicate detection. Every one of those exists **only because there are two copies of a thing**.

Both products already treat markdown as the source of truth and their database as a derived index:

- Nimbalyst's `/track` command carries an all-caps warning to write *only* the markdown file, because "the markdown file you write is automatically synced to the tracker widget via frontmatter/inline parsing" — calling `tracker_create` as well produces duplicates.
- Task Genius's storage (`src/dataflow/persistence/Storage.ts`, over `LocalStorageCache`) is a rebuildable cache over vault files.

So the shared substrate already exists in both designs. It is markdown. Sharing it deletes the entire problem class rather than solving it.

### Why not a shared SQLite database

Considered and rejected. Nimbalyst uses `better-sqlite3` 13.0.1 (native module, Electron main plus a sqlite worker). Three reasons against extending that to Task Genius:

1. **It would cost mobile.** `better-sqlite3` is a native Node module; Obsidian plugins have limited Node access on desktop and none on mobile. The fork's `manifest.json` sets `"isDesktopOnly": false` today. Browser-compatible SQLite builds (sql.js, wa-sqlite) cannot share a file with nimbalyst's build, so the migration would be paid without gaining unification.
2. **One database is tighter coupling than one markdown folder, not looser.** Two processes sharing a SQLite file must share a schema. Nimbalyst's `TrackerRecord` deliberately splits `fields` from `system` and states that "no layer outside the schema may assume field names." Two apps writing one database under different assumptions fails in ways you cannot read in a text editor.
3. **It unifies the wrong layer.** Both databases are *derived*. Unifying them would leave the two actual sources of truth separate — backwards.

## Decisions taken

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Substrate | Shared markdown files in a vault folder | Deletes the sync problem class |
| 2 | Item flow | Nimbalyst → Obsidian only | A programming task in nimbalyst should be visible in Obsidian; a personal habit in Obsidian should not reach nimbalyst |
| 3 | Filtering | The vault folder boundary | Nimbalyst indexes only its own folder, so no filter logic is needed |
| 4 | Write-back | Completion only | Matches the fork's existing GitHub-sync posture; the checkbox↔`status:` rule is the sole write |
| 5 | Storage | Unchanged on both sides | Both remain derived indexes over markdown |
| 6 | Project link | Explicit binding table | Survives renames on both sides; folder-derived linking would force vault layout to mirror workspaces forever |
| 7 | Placement | Task Genius parser addition + nimbalyst path config | No nimbalyst extension, no change to the published `extension-sdk` contract |

### On the asymmetry

The one-directional item flow is the requirement, not a limitation. Nimbalyst is the system of record for programming work; Obsidian is where that work becomes visible alongside everything else. Vault-native personal tasks stay in the vault.

## The convergence hypothesis (gates everything)

The architecture rests on a single line being valid to both parsers:

```markdown
- [ ] Fix login #task[id:tsk_01H… status:to-do priority:medium created:2026-09-03]
```

Evidence it should work:

- Nimbalyst's tracker import regex is `/^(.+?)\s+#([a-z][\w-]*)\[.+?\]$/` (`packages/runtime/src/plugins/TrackerPlugin/TrackerItemTransformer.ts:79`).
- `CHECK_LIST` is in nimbalyst's transformer set (`packages/runtime/src/editor/markdown/core-transformers.ts:13`, spread via `CORE_TRANSFORMERS` at `editor/markdown/index.ts:30`), so Lexical should consume the `- [ ]` before the tracker transformer sees the text.
- Task Genius already reads `- [ ]` lines as tasks and would treat `#task` as a tag.

**This is a hypothesis, not a verified fact.** Transformer ordering decides it. Task 1a is the gate; nothing else starts until it resolves.

**Fallback if the spike fails:** nimbalyst keeps its checkbox-less item format and Task Genius learns to read it as a task, deriving completion from `status:` rather than a checkbox. Architecturally equivalent, a somewhat larger parser change, and it makes the write rule write `status:` only.

## Identity

No new mechanism is required. Task Genius already parses `🆔` and `[id:: value]` into `metadata.id` (`src/dataflow/core/ConfigurableTaskParser.ts:2079`, `:795`) — a free-text field, distinct from the internal `BaseTask.id` (`src/types/task.d.ts:10` vs `:57`). Nimbalyst's `{prefix}_{ulid}` (`IDGenerator.ts:67`) stores verbatim.

Caveat carried from research: the Tasks-plugin `🆔` convention does **not** enforce uniqueness. Duplicate ids must be detected rather than assumed away — a user can copy a line.

## Project linking

A binding table maps each nimbalyst workspace to a vault folder and a Task Genius project string:

| Nimbalyst workspace | Vault folder | TG project |
|---|---|---|
| `Nimbalyst` | `Projects/Nimbalyst/` | `Software/Nimbalyst` |
| `Marvin` | `Projects/Marvin/` | `Obsidian` |

The binding does double duty: it decides **where nimbalyst writes** (hence what becomes visible in Obsidian at all) and **how those items group** in Task Genius views.

Correction to an earlier concern raised during planning: `TgProject.readonly` does **not** gate writes — `grep` over `src/dataflow/api/WriteAPI.ts` finds no reference to it. It is a UI hint meaning the project assignment cannot be edited inline. Path-derived projects therefore do not block completion write-back.

## Execution model

**This PRD spans two repositories, which nimble's execution model does not natively support.**

- `.nimble/config.yaml` governs nimbalyst only. Its `commands`, `boundaries` and `pre_pr_checks` do not apply to Task Genius tasks.
- Task Genius tasks must be verified with that repo's own gates: `npx tsc -noEmit -skipLibCheck` and `npx jest`, diffed against a captured baseline (that suite has ~39 pre-existing failures, so a raw pass/fail count is meaningless).
- **Task Genius has a deploy step that commits do not perform.** Its production build writes to `dist/`, while Obsidian loads the plugin-root `main.js`. After committing, `cp dist/main.js main.js && cp dist/styles.css styles.css`. A task that skips this will appear not to work.

Tasks are therefore labelled by repo. A task in `repo: task-genius-fork` must not be executed with nimbalyst's boundaries or gates.

Cadence: `worktree-free-local`, matching PRD 011/012 precedent. No PRs.

## Tasks

See `tasks.yaml`. Nine tasks across five waves, 32 complexity points.

Wave 1 is a single gating spike. Waves 2 and 3 are in different repositories and cannot conflict, so they run in parallel.

## Risks

| Risk | Mitigation |
|---|---|
| Spike fails; checkbox not tolerated | Documented fallback (checkbox-less + `status:`-derived completion), same architecture |
| Both apps write the same file concurrently | TG has atomic writes with staleness checks (`src/dataflow/api/taskLineWrite.ts`); task 3a must verify nimbalyst's write path is equally safe |
| Format coupling between two products | Accepted deliberately. A shared substrate is the feature; the alternative is a sync engine and its whole problem class |
| Obsidian mobile/sync touching files mid-write | Out of scope for v1. Note it; do not solve it speculatively |
| Duplicate ids from copied lines | Task 2a detects and reports rather than trusting uniqueness |
| Status vocabularies are user-extensible on both sides | Mapping is configurable (task 2b), not a static table |

## Out of scope for v1

- Vault-native tasks appearing in nimbalyst (deliberate — see decision 2)
- Field-level two-way sync beyond completion
- Rich body/description round-tripping (nimbalyst items have Lexical bodies; TG tasks are one line plus children — structurally lossy)
- Extending nimbalyst's `ImporterMethods` contract
- Obsidian mobile support for the shared folder

## Open questions carried from research

Not blocking, but should be checked before or during execution:

1. Is `packages/runtime/src/sync/` or `packages/collab-*` relevant here? Not investigated during research.
2. Does nimbalyst's tracker path support an arbitrary absolute path, or only workspace-relative? Task 3a resolves this.

## CHANGELOG

- 2026-09-03 — PRD created. Architecture changed from two-store sync to shared substrate during planning, after the user indicated willingness to change Task Genius. SQLite unification considered and rejected.
