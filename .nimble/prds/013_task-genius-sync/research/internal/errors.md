# Evidence: existing issues and hazards

## 1. Documented double-write hazard in Nimbalyst — the most important item here

`packages/extensions/planning/claude-plugin/commands/track.md`:

> "**CRITICAL: Do NOT Call tracker_create.** Never call the `tracker_create` MCP tool when executing /track. The markdown file you write is automatically synced to the tracker widget via frontmatter/inline parsing. Calling `tracker_create` in addition to writing the markdown file creates a duplicate entry — one from the file sync and one from the database insert. Only write the markdown file; the tracker system handles the rest."

A live, documented instance of the exact failure mode a two-way sync risks, in this codebase, severe enough to warrant an all-caps warning. Any design must state explicitly which layer writes and which observes.

## 2. `🆔` uniqueness is not enforced

Per the Tasks plugin's own documentation (see `../external/sources.yaml`), id uniqueness is intended but not enforced. Task Genius inherits that. A user can duplicate a line, or copy a synced task, and produce two tasks with the same id. The sync must detect duplicates rather than trust the id.

## 3. Positional writes in Task Genius

`WriteAPI` writes by file path + line number. Mitigated — `src/dataflow/api/taskLineWrite.ts` refuses a write when the target line no longer holds what was read — but a sync must handle that refusal (re-resolve and retry) rather than treat it as a hard failure.

## 4. Thin test coverage on the Task Genius write path

`WriteAPI.ts` is ~3,500 lines with few direct tests. Recent work added `taskLineWrite.test.ts` and fixed two fixtures, but the surrounding update logic remains lightly covered. Changes there need their own verification rather than relying on the suite.

## 5. Structural mismatches with no clean mapping

- **Checkbox vs no checkbox.** Nimbalyst items are plain list items; Task Genius tasks require `- [ ]` to carry status.
- **Body.** Nimbalyst items have rich Lexical bodies (`TrackerSnapshot.body` is markdown, converted on insert). Task Genius tasks are one line plus indented children. Round-tripping is lossy.
- **Status vocabularies.** Both are user-extensible — custom tracker YAML types on one side, configurable `taskStatuses` on the other. A static mapping table cannot cover user-defined states.
- **Types.** Nimbalyst has bug/task/idea/decision/plan plus custom; Task Genius has one task kind. Type must be carried in a tag or field.

## 6. Unverified

- Whether the Task Genius **task** parser can read a checkbox-less line. The recent `time-block.ts` widening applies to time blocks, not tasks.
- Whether `packages/runtime/src/sync/` or `packages/collab-*` already provides usable machinery. Not investigated this pass.
- Whether Nimbalyst's ULID generation uses a library or is inline.
