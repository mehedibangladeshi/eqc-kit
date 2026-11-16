# eqc fix — rank compliance gaps, let the user pick, then fix and re-verify each one.

Inputs: optional rule ID or keyword. Requires a prior `eqc check` (an index).
Outputs: fixed code in the working tree, merged compliance results, milestone entries, a final summary.

## Rules
- State only via `node .eqc/bin/eqc.mjs <cmd>` from the repo root. Never read `rules.json`/`compliance.json` whole or hand-write them.
- Never hand-edit the human report; `merge` regenerates it.
- Milestones are appended only via `node .eqc/bin/eqc.mjs milestone add '<json>'`.
- Process rules strictly one at a time; never run two fixers concurrently.
- Temp files: outside the repo or `.eqc/tmp/` (gitignored).
- Sub-tasks: run the fixer/planner/audit as a sub-task (sub-agent) if you can; otherwise do it yourself by following `.eqc/prompts/fixer.md`, `plan.md`, `audit.md`. A cheaper/faster model is fine for `[mechanical]` chunks (config `cheap_model`); use the normal model for `[judgment]` chunks and retries.

## Step 1 — candidates
1. Input is a rule ID -> run `get <ID>`, skip to Step 3 with that rule.
2. Otherwise run `rank [keyword]` (keyword only if the input reads as one). Exit 2 or "no index" -> stop, tell the user to run `eqc check`.

## Code map
Once per run, before any audit/plan/fix: follow `.eqc/prompts/codemap.md` and include its `MAP:` line in every planner, fixer and audit brief.

## Guard
- After each fix (and each chunk): re-audit the touched protected rules plus the target, `merge`, then run `node .eqc/bin/eqc.mjs guard`. A fix is not done while guard exits 1: repair the regression first.
- Never edit or delete `.eqc/baseline.json`. Never weaken lint/test/CI/config thresholds to make a rule or guard pass.
- Any user-facing mention of a rule is `ID — title`, never a bare ID (titles from `get`/`rank`).

## Step 2 — pick
1. Show the top 10 ranked lines as printed; say how many more exist.
2. Ask the user to choose one or more (as a multiple-choice question if your tool supports it).

## Step 3 — per selected rule, sequentially
1. Run `get <ID>`. Route:
   - status `pass` -> print its evidence, suggest `eqc check <ID>` if a regression is suspected, go to next rule.
   - effort_tier `trivial`/`small`/missing -> Single path.
   - effort_tier `medium`/`large` -> Chunked path.
2. Gates: read `config get gates.package_install`, `gates.ci_config`, `gates.architecture`, `gates.top_tier`, `gates.auto_commit`. If a gate key is missing or `config get` exits 1, use the safe default: every gate `true`, `auto_commit` `false`. Pause and get explicit approval (say which trigger fired, show evidence/notes) if:
   - blast_radius contains `architecture` and gates.architecture is true; or
   - blast_radius contains `package-install` and gates.package_install is true; or
   - blast_radius contains `ci-config` and gates.ci_config is true; or
   - the rule's tier is the top tier (the last line printed by `ids full`) and gates.top_tier is true.
   `large-sweep` never gates; just state the file count up front. No approval -> skip this rule.

### Single path
1. Run the fixer for `Fix: <ID>` (follow `.eqc/prompts/fixer.md`). Pass `approved: <gate>` (e.g. `approved: package-install`) for every gate the user approved in Step 3.2.
2. `BLOCKED` -> relay exactly what is needed, go to next rule.
3. `FAILED` -> relay the real error; ask the user: retry, skip, or debug. To debug: debug systematically: reproduce, hypothesise, verify. Then next rule.
4. `DONE`/`DONE_WITH_DEVIATION` -> only after the fixer has finished and verified (never merge while edits are still in progress), take the COMPLIANCE json block from the reply, write it to a temp file wrapped as `{"results":[<entry>]}`, run `merge <file>`.
5. Run `milestone add '{"rule_id":"<ID>","tier":"<TIER>","status":"<status>","summary":"<one line>"}'`. Map fixer STATUS: DONE and DONE_WITH_DEVIATION -> `done`, BLOCKED -> `blocked`, FAILED -> `failed`; a chunked rule stopped early -> `partial`.
6. If other fail/partial rules cite a file you just changed in their evidence, suggest `eqc check <those IDs>`, since their evidence is now stale.
7. Report before -> after status and any compliance-level change (from the merge output).

### Chunked path
1. Run `chunks <ID>`.
   - No plan: pass the gates (Step 3.2), then follow `.eqc/prompts/plan.md` for `Plan: <ID>`. `BLOCKED` -> relay, next rule. Otherwise show the summary and plan path; ask the user Approve / Cancel (they may edit the plan first). Cancel -> stop this rule.
   - Plan exists: say "resuming".
2. Loop:
   1. `chunks <ID>` -> next unticked chunk and its tag.
   2. Run the fixer for `Fix: <ID> chunk <n>`, passing the same `approved: <gate>` lines. Relay one line.
   3. `FAILED` -> retry that chunk once (normal model); still failed -> stop, report, `milestone add` with status `partial` or `failed`, go to next rule.
   4. `DONE` -> ask the user: Continue / Stop here (resumable later via `eqc fix <ID>`). Stop -> `milestone add` status `partial`, next rule.
3. When `chunks <ID>` reports all done: run one audit of `<ID>` (`.eqc/prompts/audit.md`), temp file -> `merge`, then `milestone add`, then report before -> after.

### Commits
- If `gates.auto_commit` is true: after each rule that ends DONE, commit with message `chore(eqc): <ID> <title>`.
- Otherwise never commit; leave changes in the working tree.

## Step 4 — summary
One combined summary: fixed, blocked/failed with reasons, net compliance-level change. If gaps remain, tell the user to run `eqc fix` again.
