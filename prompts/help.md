# eqc help — explain eqc-kit: install, upgrade and use it. Read-only.

Inputs: optional free text after "eqc help" (a question; may be empty).
Outputs: a short status, then an answer (or the loop plus ONE next command). State lives in `.eqc/`.

## Rules
- Read-only. Never run `init`, `update`, `uninstall`, `hooks`, `eqc fix`, `merge`, `reset`, `reindex`, `migrate`, `report --write` or anything else that writes files. Tell the user the command to run instead.
- Allowed: `npx eqc-kit doctor`, and Engine reads (`node .eqc/bin/eqc.mjs` + `report` without `--write`, `rank`, `get`, `ids`, `config get`, `guard`, `chunks`). Run from the repo root.
- Answer from the guide below and the project's files. Cite the exact command. Do not invent commands or flags; if unsure, say so and link the docs.
- Name rules as `ID — title`. Be terse.

## Step 1 — status (max 4 lines)
1. Run `npx eqc-kit doctor`.
2. No `.eqc/` (or doctor reports config/engine missing): say eqc-kit is not installed here. Give: `npx eqc-kit init` (answer the prompts; `--yes` takes defaults), then `eqc check` in your agent. Skip the rest of this step.
3. Installed: run `node .eqc/bin/eqc.mjs report` and read the `Compliance level:` line. Exit 2 or "No index yet" = not indexed: next step is `eqc check`. A `state schema N is older/newer` message: see Upgrading.
4. Run `node .eqc/bin/eqc.mjs rank`; the first line is the next fix candidate (`ID — title`). No output = nothing to fix.
5. Print: install health (doctor), level, next fix candidate. Mention any doctor `✖` or `⚠` line.

## Step 2 — answer
- Question given: answer from the guide, with the exact command. Keep it to what was asked.
- No question: explain the loop in 3-5 lines: `eqc check` audits the code against the standard and writes the report; `eqc fix` fixes one failing rule at a time; `guard`/`verify` (hooks or CI) stop regressions. Then suggest exactly ONE next command, based on status. Then offer example questions: "how do I upgrade?", "what do I commit?", "I edited my standard, now what?", "how do I turn on git hooks?", "why does it say no index?".

## Guide

### Installer (`npx eqc-kit <command>`, run from the repo root or pass `--cwd <dir>`)
- `init` — install into this repo. Needs a git repo (`--force` to override) and no existing `.eqc/config.json`. `--yes` accepts defaults, `--config <file>` reads answers from JSON.
- `update` — regenerate managed files after upgrading eqc-kit or editing `.eqc/config.json`. Asks before overwriting files you edited; `--yes` keeps yours, `--force` overwrites.
- `doctor` — read-only health check; exits 1 on a `✖` line.
- `hooks` — turn on git hooks (`--off` disables, `--force` enables even with other hooks).
- `uninstall` — remove managed files, keep state; `--purge` deletes `.eqc/` too.
- `help [cmd]` — list commands, or one command's flags and an example (also `--help`); `--version`.

### Agent commands (use your agent's eqc check / eqc fix / eqc help commands)
- `eqc check` — show the cached report. `eqc check recheck` re-audits failing/partial rules; `eqc check full` re-audits everything; `eqc check <TIER>` or `<ID,ID>` re-audits those; `eqc check <path-to-standard.md>` re-indexes a new or edited standard, keeping verdicts for unchanged rules and auditing only added/changed ones.
- `eqc fix` — fix the next candidate; `eqc fix <ID>` or `eqc fix <keyword>` picks one.
- `eqc help [question]` — this guide.

### What lives in `.eqc/`
`bin/eqc.mjs` (Engine), `prompts/` (agent playbooks), `standard/` (copy of your standard), `config.json`, `rules.json` (index), `compliance.json` (verdicts), `baseline.json`, `milestones.json`, `plans/`, `hooks/`, `manifest.json`, `RULES.md` (digest). Commit everything except `.eqc/tmp/` (gitignored), plus the report (`report_path`, default `docs/eqc/COMPLIANCE.md`, with an `.html` page beside it). Never hand-edit `compliance.json`, `baseline.json`, `RULES.md` or the report.

### Upgrading
1. Run `npx eqc-kit update`. It syncs the Engine and prompts, then migrates state to the current schema (backup in `.eqc/tmp/backup-schema-<N>/`).
2. Run `npx eqc-kit doctor`, then commit the result.
- `state schema N is older than this engine`: run `npx eqc-kit update` (or `node .eqc/bin/eqc.mjs migrate`).
- `state schema N is newer than this engine`: upgrade eqc-kit to your teammate's version. Never run `update`/`migrate` with an older kit.
- `migration ... failed, state restored`: state is unchanged; fix the corrupt JSON named in the error (compare with the backup), rerun `migrate`.

### Editing the standard
Any edit that moves lines or changes titles makes the index stale (`check-ids` fails). Re-index: `eqc check <path-to-standard.md>`. This keeps verdicts for unchanged and renumbered rules, re-audits only added/changed rules, and keeps milestones and plans. The Baseline level may drop if the standard raised the bar. For a clean slate run `eqc reset`, then `eqc check <path-to-standard.md>`. Wrong rules included/excluded: check `node .eqc/bin/eqc.mjs config get stack.tags`, edit `stack.tags` in `.eqc/config.json`, re-index.

### Gates
Before risky fixes `eqc fix` stops and asks, per `gates.*` in `.eqc/config.json` (`ci_config`, `package_install`, `architecture`, `top_tier`). Read one with `node .eqc/bin/eqc.mjs config get gates.ci_config`.

### Baseline, guard, hooks, CI
- Baseline: every rule that has passed is protected in `.eqc/baseline.json` (written by merge; commit it). `node .eqc/bin/eqc.mjs guard` exits 1 if a protected rule regressed or the level dropped; `guard --min TIER` also requires a tier.
- `node .eqc/bin/eqc.mjs verify` runs the verify command of each passing rule against the code.
- Hooks: `npx eqc-kit hooks` (once per clone) runs `verify` on commit and `verify` + `guard` on push. `--no-verify` skips them, so also run both in CI. `guard` reads recorded verdicts only: re-audit touched rules (`eqc check <IDs>`) and commit the updated state.

### Common problems
- "No index yet" / exit 2: run `eqc check` once.
- Standard is a private Google Doc, Confluence or Notion page: export it to Markdown, pass the file path. A URL must serve raw Markdown, not HTML.
- Node missing or old: Node 18+ is needed only for `npx eqc-kit` and the Engine; the project can be any language.
- `update` kept my edited files: answer `y` to take the new version, `n` to keep yours; `doctor` lists modified files.
- Agent ignores the AGENTS.md block: confirm the `<!-- eqc-kit:start -->` block exists (`doctor`), start a fresh session, or tell the agent "Read `.eqc/prompts/check.md` and follow it exactly."
- Agent keeps asking permission for the Engine: allow `node .eqc/bin/eqc.mjs` in your agent's settings.

More: https://github.com/mehedibangladeshi/eqc-kit#readme

## Closing
End with: `next: <the ONE command>` (Step 1 status decides it: not installed -> `npx eqc-kit init`; not indexed -> `eqc check`; failing rules -> `eqc fix`; otherwise `eqc check recheck` or `guard`).
