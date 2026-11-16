# CI and teams

eqc-kit keeps its state in files, so a team shares it through git. This page covers what to commit, how teammates see the Compliance level, and how to review agent fixes.

## What to commit

Commit:

| Path | Why |
|---|---|
| `.eqc/` (everything except `tmp/`) | The Engine, Prompts, config, Index, Verdicts, Milestones and Plans. Teammates then run the same Engine version and see the same results. |
| `AGENTS.md` | The block tells non-Claude agents how to run `eqc check` and `eqc fix`. |
| `.claude/skills/eqc-*` and `.claude/agents/eqc-*` | The Claude Code adapter files. |
| `CLAUDE.md` (if eqc-kit wrote its block there) | Tells Claude Code to follow the Rules while writing code. |
| The report, for example `docs/eqc/COMPLIANCE.md` | The readable result. |

Do not commit `.eqc/tmp/`. `init` writes `.eqc/.gitignore` containing `tmp/`, so a plain `git add .eqc` is safe. Scratch files there are audit output waiting to be merged.

The full list of what lives in `.eqc/` is in [concepts.md](concepts.md#what-lives-in-eqc).

## Share the Compliance level with the team

The report is regenerated on every merge and is plain Markdown. Its header carries the level:

```
Standard: Example Engineering Quality Standard v1.0
Audited: 2026-09-29
Compliance level: Bronze
```

Because it is committed, anyone can read the current level from the default branch, and every change to it shows up as a diff in review. To publish a badge or a status line, read `current_tier` from `.eqc/compliance.json` (a Tier ID, `HARD_FAIL`, or `NONE` when the lowest Tier is not fully audited) in whatever tool you use. Do not edit either file by hand; only `merge` writes them.

Two teammates who each run `eqc check` may get slightly different Verdicts, because an agent judges the code. Agree on one person (or one PR) who refreshes the report, and merge that first. After a merge conflict in `compliance.json` or the report, do not resolve it by hand: keep either side and re-run `eqc check recheck`.

## Review agent fixes in a PR

`eqc fix` leaves changes uncommitted unless you set `gates.auto_commit`. A convenient flow:

1. Create a branch, run `eqc fix`, and fix one Rule (or a few).
2. Commit. The diff contains the code change, the updated `.eqc/compliance.json`, `.eqc/milestones.json` and the regenerated report.
3. In the PR, review the code like any other change. Then read the report diff: the Rule should move from `fail` to `pass`, and the Compliance level should stay the same or go up.
4. The Milestone in `.eqc/milestones.json` records what the agent says it did, with a status of `done`, `partial`, `blocked` or `failed`. `partial` and `blocked` mean the Rule is not finished.

Things worth checking in review:

- A fix marked `pass` has evidence you agree with. Evidence is in `.eqc/compliance.json`; run `node .eqc/bin/eqc.mjs get <ID>` to see it.
- CI config, dependency and lockfile changes. These are the ones your Gates exist for.
- For a large fix, the Plan in `.eqc/plans/<ID>.md` shows the intended approach and which Chunks are done.
- No regression: `node .eqc/bin/eqc.mjs guard` prints `ok`. Ask the agent for `eqc check recheck`, or `full` before a release.

## Running in a pipeline

The installer works without prompts: `npx eqc-kit init --yes --config answers.json`, see [configuration.md](configuration.md#non-interactive-setup). `npx eqc-kit doctor` exits 1 when the install is broken, so it can gate a job cheaply. The audit itself needs an agent, so it is not run in CI by eqc-kit. Two Engine commands are cheap and deterministic, and do belong in CI. They are the build-time guard that `--no-verify` cannot skip:

## Verify and guard in CI

Two Engine commands run without an agent, so they are cheap on every PR:

- `verify` re-runs the Verify commands of passing Rules against the code in the PR. It catches code that breaks a mechanically checkable Rule even when nobody re-audited.
- `guard` compares the committed `.eqc/compliance.json` with `.eqc/baseline.json`. It exits 1 when a protected Rule is now `fail`, `partial` or unaudited, or when the level dropped below the baseline. `guard --min TIER` also fails below a Tier you require.

GitHub Actions example:

```yaml
eqc:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: 20 }
    # install your project's dependencies here if your verify commands need them (e.g. npm ci for npm run lint)
    - run: node .eqc/bin/eqc.mjs verify
    - run: node .eqc/bin/eqc.mjs guard --min BRONZE
```

Both exit 2 when the Standard is not indexed yet; treat that as a pass or index first. Before the first merge there is no `baseline.json`, and `guard` passes with `guard: no baseline yet`.

`guard` reads recorded Verdicts only; it does not audit. So a PR that touches Rules must include a re-audit of them: run `eqc check <IDs>` (or `eqc check recheck`) in your agent, merge, and commit the updated `.eqc/compliance.json`, `.eqc/baseline.json` and report. Otherwise CI checks stale results. Details are in [engine-commands.md](engine-commands.md#guard). For local hooks see [commands.md](commands.md#hooks).
