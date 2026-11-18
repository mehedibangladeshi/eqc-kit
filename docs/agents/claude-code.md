# Claude Code

Claude Code gets the native adapter: three skills you type as slash commands, four subagents they dispatch, and a managed guard block in `CLAUDE.md` (when one exists). Other agents use `AGENTS.md` instead; see the [README](../../README.md#supported-agents). You can install both.

Select the `claude-code` adapter at `npx eqc-kit init` (it is the default when `.claude/` or `CLAUDE.md` exists, or when nothing else exists).

## Files written

```
.claude/
  skills/
    eqc-check/SKILL.md
    eqc-fix/SKILL.md
    eqc-help/SKILL.md
  agents/
    eqc-index.md
    eqc-audit.md
    eqc-planner.md
    eqc-fixer.md
CLAUDE.md          eqc-kit guard block (only if CLAUDE.md exists, or agents-md is off)
```

- **Skills are the entry points.** `/eqc-check`, `/eqc-fix` and `/eqc-help` are thin wrappers. Each says "follow `.eqc/prompts/check.md` (or `fix.md`) exactly" and adds Claude Code specifics: dispatch subagents, use AskUserQuestion for choices, put temp files in the session scratchpad.
- **Agents are the sub-tasks.** Each subagent is another thin wrapper that follows one Prompt: `eqc-index` (`index.md`), `eqc-audit` (`audit.md`), `eqc-planner` (`plan.md`), `eqc-fixer` (`fixer.md`). Their tool lists are limited to what the job needs; only the fixer can edit existing files (the indexer and planner can only write their own output).
- **Parallel per Tier.** `/eqc-check` dispatches one `eqc-audit` per Tier in a single message, so Tiers are audited at the same time. Fixes are the opposite: one Rule at a time, never two fixers at once.
- **CLAUDE.md guard block.** A managed block between `<!-- eqc-kit:start -->` and `<!-- eqc-kit:end -->`, titled "EQC compliance guard". For any development work (features, fixes, config or dependency changes, refactors, file moves), it tells Claude to read `.eqc/RULES.md` before writing code, run `node .eqc/bin/eqc.mjs verify`, re-audit affected protected Rules, run `node .eqc/bin/eqc.mjs guard`, never finish with a regression, never edit `.eqc/baseline.json` or weaken lint, test, CI or type-check settings, and ask you before a protected Rule must change. `uninstall` removes only this block.
  Claude Code reads `AGENTS.md` only when the repo has no `CLAUDE.md`, so eqc-kit writes this block only when `CLAUDE.md` already exists (or the `agents-md` adapter is off). It never creates a `CLAUDE.md` that would hide your `AGENTS.md`; without one, Claude reads the same guard text in the `AGENTS.md` block. If you add a `CLAUDE.md` later, run `npx eqc-kit update`.

All the real logic lives in the Prompts in `.eqc/prompts/`, which are the same ones every other agent follows.

## /eqc-check

In Claude Code (this is an agent conversation, described from [check.md](../../prompts/check.md), not shell output):

| You type | What happens |
|---|---|
| `/eqc-check` | With an existing Index: prints the saved report and audits nothing (free). Without one: indexes the Standard at `standard.path`, validates it, audits every Rule. |
| `/eqc-check recheck` | Re-audits only Rules that are `fail` or `partial`, or have no Verdict. |
| `/eqc-check full` | Re-audits every Rule. |
| `/eqc-check SILVER` or `/eqc-check BRONZE-6,GOLD-1` | Re-audits one Tier or the listed Rules, and shows each as `ID — title: before → after`. |
| `/eqc-check docs/my-standard.md` | Rebuilds the Index from that file and re-audits everything. Text after the path is passed to the indexer as instructions. A URL or pasted text also works. |

The report is printed verbatim: the level, the `Baseline:` line with guard status, `## Regressions` when any, `## To reach <Tier>` and `## Not audited`. Rules are named `ID — title`. The closing line names the blocking Rules the same way, then `next: eqc fix`. See [engine-commands.md](../engine-commands.md#report---write) for the report layout.

## /eqc-fix

Also an agent conversation, described from [fix.md](../../prompts/fix.md):

| You type | What happens |
|---|---|
| `/eqc-fix` | Shows the top 10 candidates, easiest first, and asks which to fix. |
| `/eqc-fix SILVER-2` | Skips the list and fixes that Rule. |
| `/eqc-fix logging` | Filters the list to Rules mentioning that word. |

Per Rule: Gates first (it asks if the fix touches CI, packages, architecture, or the top Tier), then a single fixer pass for small fixes, or a Plan you approve and Chunks run one at a time for medium and large ones. After each it re-audits, merges the Verdict and tells you before and after, then runs `guard` and shows any regression as `ID — title — now fail|partial|not audited`. Changes are left uncommitted unless `gates.auto_commit` is true. See [getting-started.md](../getting-started.md#4-fix).

## /eqc-help

Also an agent conversation, described from [help.md](../../prompts/help.md). The skill is in `.claude/skills/eqc-help/SKILL.md`:

| You type | What happens |
|---|---|
| `/eqc-help` | Runs `npx eqc-kit doctor`, reads your current Compliance level and next fix from the Engine, and explains the check → fix loop with one suggested next command. |
| `/eqc-help why is SILVER-2 failing?` | Same check, then answers your question. |

It is read-only. It never runs `init`, `update`, `fix` or another writing command; it tells you the command to run instead. See [commands.md](../commands.md#help).

## Cheaper model for mechanical work

Plans split a fix into `[mechanical]` Chunks (a recipe applies with no per-file decisions) and `[judgment]` Chunks. Mechanical ones can run on a cheaper, faster model to save time and cost.

- **At init:** the wizard asks "Cheaper model for mechanical fix chunks (blank = use your default)". Enter a model name your Claude Code accepts, such as `haiku` or `sonnet`.
- **Later:** edit `cheap_model` in `.eqc/config.json`, then run `npx eqc-kit update` to regenerate the skill:

```
$ npx eqc-kit update --yes
update: 1 written, 0 kept (edited), 13 unchanged
  wrote .claude/skills/eqc-fix/SKILL.md
```

With a model set, the generated `eqc-fix` skill says to dispatch `[mechanical]` Chunks with that model, and to use the session model for `[judgment]` Chunks and for retries. With it blank (`null`), the skill says to pass no model, so every task inherits the model of your session. Setting it does not change anything until the skill is regenerated.

## Permission prompts

The skills call the Engine as `node .eqc/bin/eqc.mjs <command>` many times per run, so Claude Code will ask permission each time until you allow it. It reads and writes `.eqc/` state and the report, and `verify` runs the Verify commands in `rules.json`; it never judges your code itself (see [engine-commands.md](../engine-commands.md)). To allow it for this project, add a rule to `.claude/settings.json` (or `.claude/settings.local.json` if you do not want to commit it):

```json
{
  "permissions": {
    "allow": ["Bash(node .eqc/bin/eqc.mjs:*)"]
  }
}
```

The `/permissions` command in Claude Code can add the same rule interactively. Subagents that edit files (the fixer) still follow your normal edit permissions.

## Customising

The skills and agents are Managed files: each carries a marker comment (`eqc-kit:managed`) and its hash is recorded in `.eqc/manifest.json`. `npx eqc-kit update` regenerates them from the installed eqc-kit version.

- **To change behaviour for everyone**, edit the Prompt in `.eqc/prompts/*.md`. That changes what Claude Code and every other agent do. The Prompts are Managed files too.
- **To change Claude-specific wiring**, edit the file in `.claude/skills/` or `.claude/agents/`.
- **Your edits are not lost silently.** On `update`, an edited Managed file is shown as a diff and you are asked whether to overwrite; the default answer keeps your version. `--yes` always keeps it. A kept file will be offered again on every later update, and you will not receive upstream fixes for it until you accept them.
- Settings you should change through config, not by editing: the cheaper model, the report path and the Gates. See [configuration.md](../configuration.md).

Warning: `uninstall` deletes Managed files, edited or not.
