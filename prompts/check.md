# eqc check — entry point: show, re-audit, or rebuild the compliance report against the standard.

Inputs: optional free text after "eqc check" (empty, `recheck`, `full`, a tier id, an ID list, or a doc path / pasted text / URL).
Outputs: the markdown report (from the engine) plus a one-line "next: eqc fix". State lives in `.eqc/`.

## Rules
- All state goes through `node .eqc/bin/eqc.mjs <cmd>` (run from the repo root). Never read `rules.json` / `compliance.json` whole. Never write `compliance.json` or the human report by hand; `merge` regenerates the report.
- Do not parse or audit by hand when you can delegate: use `.eqc/prompts/index.md` and `.eqc/prompts/audit.md`.
- Sub-tasks: if you can run sub-tasks in parallel (sub-agents), run one audit per tier in parallel, each instructed to follow `.eqc/prompts/audit.md`. Otherwise run them one after another yourself. Without sub-agents, you play each role yourself: follow the sub-prompt, then continue as the orchestrator. Its "reply" becomes your intermediate result. A cheaper/faster model is acceptable for mechanical chunks (config `cheap_model`).
- Temp files: use a temporary file outside the repo, or `.eqc/tmp/` (gitignored).
- Engine exit code 2 = no index yet.

## Step 0 — classify the input (take exactly one path)
First, if `config get standard.source` is `example`, say once before indexing: "Auditing the bundled example standard — for real use, run `eqc check <path-to-your-standard.md>`." Then proceed.
- Empty and an index exists (`report` does not exit 2) -> Path A.
- Empty and no index -> Path D using `config get standard.path`.
- `recheck` or `full` (case-insensitive, nothing else) -> Path B.
- A tier id (e.g. `BRONZE`) or comma-separated rule IDs -> Path C.
- Anything else (file path, pasted text, URL, plus optional instructions) -> Path D.

## Code map (Paths B, C, D)
Follow `.eqc/prompts/codemap.md` once, then include its `MAP:` line in every audit and indexer brief.

## Path A — cached display (free)
1. Run `report`. Print it exactly as the engine outputs it: never shortened, summarized or turned into a chart.
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
4. Print a short before/after for just those rules, one line each: `ID — title: <before> → <after>`, and whether the compliance level changed (titles from `get`). Then Closing (one-line only).

## Path D — new or edited source: re-index
1. Resolve the source to a FILE (indexer line numbers refer to a file):
   - File path: use it.
   - Pasted text: write it verbatim to a temp file.
   - URL: fetch the content with whatever tool you have and write it to a temp file. If you cannot fetch it, stop and report the error; do not guess.
   - Empty input: use `config get standard.path`.
   - Text after the source that reads as instructions: keep verbatim as indexing instructions.
2. Do NOT reset. Existing verdicts are kept where the rule is unchanged.
3. Index: follow `.eqc/prompts/index.md` with the source file, the instructions, and `config get stack.tags`. It writes `.eqc/tmp/rules.next.json`. Show the user the index summary (doc version, rule counts per tier, excluded rules, conflicts) now, before the report.
4. Run `node .eqc/bin/eqc.mjs check-ids <source file> .eqc/tmp/rules.next.json`. If exit 1, stop: show the printed problems; nothing is installed and existing verdicts are untouched (fix the doc or re-run the index).
5. Run `node .eqc/bin/eqc.mjs reindex .eqc/tmp/rules.next.json`. If exit 1, stop: show the printed problems; state is untouched. Otherwise it prints the Rule delta as JSON (`unchanged`, `moved`, `changed`, `added`, `removed`, `audit`).
6. Audit exactly the `audit` ids (added + changed): run `ids <audit ids comma-separated>` to group them by tier; one audit per output line via `.eqc/prompts/audit.md`. If `audit` is empty, skip auditing and merge, but still run Guard (reindex changed the Index and Baseline).
7. Temp file -> `merge` per result.
8. Tell the user the delta counts (unchanged / moved / changed / added / removed) and how many rules were audited. A full rebuild is `eqc reset` then `eqc check <path>`.
9. Print `report`, then Closing.

## Guard
After every `merge`, and after a Path D reindex even when nothing was audited, run `node .eqc/bin/eqc.mjs guard`. Exit 1 = a previously achieved rule broke: show its lines verbatim under a `Regressions` heading before the closing line and say so. Never edit or delete `.eqc/baseline.json`.

## Closing
- Always name rules as `ID — title`, never bare IDs.
- After the report, add one line naming what blocks the next compliance level as `ID — title` (max ~5, then "+N more — see report"; from the report's `## To reach` list, plus any unaudited count; a `NONE` level means the lowest tier still has unaudited rules, so suggest `eqc check full`). If the level is HARD_FAIL, the next level is the lowest tier: name its fails.
- After the report, say once where the HTML report is: the path from `config get report_path` with `.html` instead of `.md`, as "Open <path> in a browser for the visual report."
- After Path D only, also say the Baseline level may have been lowered if the standard raised the bar, and: "Commit `.eqc/` (tmp/ is ignored) and the report so teammates share the level."
- End with: `next: eqc fix`
