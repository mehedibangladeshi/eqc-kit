# eqc index — parse a quality-standard document into a structured, stack-filtered rule index.

Inputs: path to the standard doc (a file; line numbers refer to it); optional indexing instructions; stack tags from `node .eqc/bin/eqc.mjs config get stack.tags`.
Outputs: `.eqc/rules.json` (you write it directly; the only prompt allowed to), `.eqc/doc-meta.md`, and a short reply.

There is no prior index; every run is a from-scratch build. Do not diff against an old one.

## Steps
1. Read the doc fully. Determine its tiers: they are DOC-DEFINED and ordered, lowest first. No fixed names.
   - `id` = short uppercase slug of the tier name; `name` = tier name; `order` = 1 for lowest; `section_heading` = exact heading text of the tier section, without `#` marks.
   - Do NOT emit rules for a "below lowest tier" section (e.g. a hard-fail summary). Compliance treats a fail in the lowest tier as the hard fail.
2. Apply indexing instructions: "skip X" -> do not emit it, record it in `doc-meta.md`; "only tier Y" -> emit only that tier. If ambiguous, take the most literal reading and say so. Never silently ignore an instruction.
3. Applicability: read the stack tags. Keep a rule if its tags intersect them, or it is tagged `all` / untagged. For multi-stack items keep only the matching sub-bullet as `detail`. List excluded rules (id, title, tags) in your reply.
4. IDs: `id = <TIERID>-<n>` where n is the number PRINTED next to the item in the doc body. `order` = n. Never renumber or fill gaps (11, 13 -> `X-11`, `X-13`). If an item has no printed number or two items in a tier share one, STOP and report it; do not invent an id.
5. The tier body wins over the changelog. Changelog/"notes" sections are history, not a second source of truth. File each rule under the tier the body places it in.
   - Note contradicts body: file per body; set `conflict_note` to a one-line explanation (e.g. "Doc notes say A->B; body lists it under A; filed under A per body; note not applied."); list under "Changelog notes NOT applied (doc body wins)" in `doc-meta.md`.
   - Note merely documents what the body already reflects (consolidation, addition, relaxation): apply normally, do not flag. Duplicates consolidated by a note: emit once, under the surviving tier.
6. `detection_hint`: a concrete, checkable signal (file, config key, dependency, code pattern) inferred by looking at this repo. Do not invent facts; the auditor verifies.
7. `source_line` = 1-based line in the doc file where the item's printed number and title appear.
8. Write `.eqc/rules.json`, replacing any existing file:
```json
{"schema":1,"standard":{"title":"","version":"","date":"","source_path":""},"stack_tags":[],"indexed_at":"YYYY-MM-DD",
 "tiers":[{"id":"BRONZE","name":"Bronze","order":1,"section_heading":"Bronze"}],
 "rules":[{"id":"BRONZE-1","tier":"BRONZE","order":1,"title":"","detail":"","detection_hint":"","applies_to":["all"],"conflict_note":null,"source_line":12}]}
```
9. Write `.eqc/doc-meta.md`: doc version/date and today's date; "Changelog notes NOT applied (doc body wins)" bullets (rule id, what the note claimed, where the body filed it); indexing instructions and what you did with each; excluded rules; one line of counts per tier.
10. Run `node .eqc/bin/eqc.mjs check-ids <doc>`; if it exits 1, fix the index (or report the doc problem) before replying.

## Reply (only this)
Doc version/date; stack tags used; rule counts per tier; excluded rules; changelog notes not applied; what you did with each instruction; any STOP problems.
