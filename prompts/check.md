# eqc check — entry point: show, re-audit, or rebuild the compliance report against the standard.

Inputs: optional free text after "eqc check" (empty, `recheck`, `full`, a tier id, an ID list, or a doc path / pasted text / URL).
Outputs: the markdown report (from the engine) plus a one-line "next: eqc fix". State lives in `.eqc/`.

## Rules
- All state goes through `node .eqc/bin/eqc.mjs <cmd>` (run from the repo root). Never read `rules.json` / `compliance.json` whole. Never write `compliance.json` or the human report by hand; `merge` regenerates the report.
- Do not parse or audit by hand when you can delegate: use `.eqc/prompts/index.md` and `.eqc/prompts/audit.md`.
- Sub-tasks: if you can run sub-tasks in parallel (sub-agents), run one audit per tier in parallel, each instructed to follow `.eqc/prompts/audit.md`. Otherwise run them one after another yourself. A cheaper/faster model is acceptable for mechanical chunks (config `cheap_model`).
- Temp files: use a temporary file outside the repo, or `.eqc/tmp/` (gitignored).
- Engine exit code 2 = no index yet.

## Step 0 — classify the input (take exactly one path)
- Empty and an index exists (`report` does not exit 2) -> Path A.
- Empty and no index -> Path D using `config get standard.path`.
- `recheck` or `full` (case-insensitive, nothing else) -> Path B.
- A tier id (e.g. `BRONZE`) or comma-separated rule IDs -> Path C.
- Anything else (file path, pasted text, URL, plus optional instructions) -> Path D.

## Path A — cached display (free)
1. Run `report`. Print verbatim.
2. Stop. Run no audit.

## Path B — re-audit, no new source
1. `recheck` -> run `ids recheck` (only rules currently fail/partial). `full` -> run `ids full` (every rule). If exit 2, stop and say there is no index.
2. Each output line is `TIERID: id,id`. Run one audit per line, each following `.eqc/prompts/audit.md` with that id list.
3. Write each audit's returned JSON to a temp file; run `merge <file>` per file (merge replaces by id; safe to repeat).
4. Print the final report (`report`), then Closing.

## Path C — scoped re-check
1. Run `get <ids>` first; keep status and current tier as the "before" snapshot.
2. Run `ids <arg>` to resolve tiers/ids. Audit only those ids (one audit per output line).
3. Temp file -> `merge` per result.
4. Print a short before/after for just those rules: status, and whether the compliance level changed. Then Closing (one-line only).

## Path D — new or missing source: reset and rebuild
1. Resolve the source to a FILE (indexer line numbers refer to a file):
   - File path: use it.
   - Pasted text: write it verbatim to a temp file.
   - URL: fetch the content with whatever tool you have and write it to a temp file. If you cannot fetch it, stop and report the error; do not guess.
   - Empty input: use `config get standard.path`.
   - Text after the source that reads as instructions: keep verbatim as indexing instructions.
2. Reset: delete `.eqc/rules.json` and `.eqc/compliance.json` only. Keep `.eqc/milestones.json` and `.eqc/plans/` as history.
3. Index: follow `.eqc/prompts/index.md` with the source file, the instructions, and `config get stack.tags`. Relay doc version, rule counts per tier, excluded rules and conflicts.
4. Run `check-ids <source file>`. If exit 1, stop: show the printed problems and do not audit.
5. Full audit: `ids full`, one audit per tier line (as in Path B step 2).
6. Temp file -> `merge` per result.
7. Print `report`, then Closing.

## Closing
- After the report, add one line naming what blocks the next compliance level (from the fail/partial lines shown).
- End with: `next: eqc fix`
