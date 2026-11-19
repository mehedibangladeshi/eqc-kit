# eqc index — parse a quality-standard document into a structured, stack-filtered rule index.

Inputs: path to the standard doc (a file; line numbers refer to it); optional indexing instructions; stack tags from `node .eqc/bin/eqc.mjs config get stack.tags`.
Outputs: `.eqc/tmp/rules.next.json` (you write it directly, creating `.eqc/tmp/` if missing; the only prompt allowed to write an Index file), `.eqc/doc-meta.md`, and a short reply. The caller installs the file with `node .eqc/bin/eqc.mjs reindex .eqc/tmp/rules.next.json`; do not run that yourself.

Every run is a from-scratch build. Never read or diff against the old `.eqc/rules.json`; the engine computes the delta.

## Steps
1. Read the doc fully. Determine its tiers: they are DOC-DEFINED and ordered, lowest first. No fixed names.
   - `id` = short uppercase slug of the tier name; `name` = tier name; `order` = 1 for lowest; `section_heading` = exact heading text of the tier section, without `#` marks.
   - Do NOT emit rules for a "below lowest tier" section (e.g. a hard-fail summary). Compliance treats a fail in the lowest tier as the hard fail.
2. Apply indexing instructions: "skip X" -> do not emit it, record it in `doc-meta.md`; "only tier Y" -> emit only that tier. If ambiguous, take the most literal reading and say so. Never silently ignore an instruction.
3. Applicability: read the stack tags. Keep a rule if ANY of its tags is in `stack.tags`, or it is tagged `all` / untagged. If a rule has per-stack sub-bullets, keep only the bullets matching `stack.tags` in `detail`; inline tags on one line are kept whole. List excluded rules (id, title, tags) in your reply.
4. IDs: `id = <TIERID>-<n>` where n is the number PRINTED next to the item in the doc body. `order` = n. Never renumber or fill gaps (11, 13 -> `X-11`, `X-13`). If an item has no printed number or two items in a tier share one, STOP and report it; do not invent an id.
5. The tier body wins over the changelog. Changelog/"notes" sections are history, not a second source of truth. File each rule under the tier the body places it in.
   - Note contradicts body: file per body; set `conflict_note` to a one-line explanation (e.g. "Doc notes say A->B; body lists it under A; filed under A per body; note not applied."); list under "Changelog notes NOT applied (doc body wins)" in `doc-meta.md`.
   - Note merely documents what the body already reflects (consolidation, addition, relaxation): apply normally, do not flag. Duplicates consolidated by a note: emit once, under the surviving tier.
6. `detection_hint`: a concrete, checkable signal (file, config key, dependency, code pattern) inferred by looking at this repo. Do not invent facts; the auditor verifies.
7. `verify` (optional): a shell command, run from the repo root, that exits 0 when the rule is met and non-zero when code breaks it. Add it ONLY for rules a command can check mechanically on the code (lint clean, no debug prints, no hardcoded URLs, formatter clean). Prefer the project's own scripts (`npm run lint`, `ruff check .`, `test -z "$(gofmt -l .)"`); otherwise a targeted search like `! git grep -nE "console\.log" -- 'src/*.ts'`. It must be read-only, fast (seconds), need no network, and work on a fresh clone with dependencies installed. Repo-level rules (CI exists, README, release process) get no `verify`. When unsure, omit it: git hooks and CI run these commands, so a noisy one blocks every commit.
8. `source_line` = 1-based line in the doc file where the item's printed number and title appear.
9. Write `.eqc/tmp/rules.next.json`, replacing any existing file there:
```json
{"schema":1,"standard":{"title":"","version":"","date":"","source_path":""},"stack_tags":[],"indexed_at":"YYYY-MM-DD",
 "tiers":[{"id":"BRONZE","name":"Bronze","order":1,"section_heading":"Bronze"}],
 "rules":[{"id":"BRONZE-1","tier":"BRONZE","order":1,"title":"","detail":"","detection_hint":"","applies_to":["all"],"conflict_note":null,"source_line":12,"verify":"npm run lint"}]}
```
   - `applies_to` = the rule's tags as printed in the doc (`["all"]` if untagged).
   - `title` = the bold text (or the text before the first tag/colon if not bold); `detail` = the rest.
   - `indexed_at` = today's local date.
   - `verify` is omitted for rules without one.
10. Write `.eqc/doc-meta.md`: doc version/date and today's date; "Changelog notes NOT applied (doc body wins)" bullets (rule id, what the note claimed, where the body filed it); indexing instructions and what you did with each; excluded rules; rules given a `verify` command (id: command); one line of counts per tier.

## Reply (only this)
Doc version/date; stack tags used; rule counts per tier; excluded rules; rules with a `verify` command; changelog notes not applied; what you did with each instruction; any STOP problems.
