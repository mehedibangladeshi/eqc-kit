# eqc-kit

eqc-kit helps you and your AI coding agent raise a project's compliance with a written engineering-quality Standard. You supply the Standard: a Markdown document of ordered Tiers (say Bronze, Silver, Gold) with numbered Rules. The agent audits your code against it, reports your Compliance level, and fixes the gaps one Rule at a time, asking before anything risky. It works in any language and with any AI coding agent.

## How it works

- You bring a **Standard**. The agent turns it into an **Index** of Rules, filtered to your stack by Applicability tags.
- The agent **audits** the code and records a **Verdict** (`pass`, `partial`, `fail`, or `na` when the Rule does not apply) with evidence for each Rule.
- A small vendored **Engine** (`.eqc/bin/eqc.mjs`) does the tier maths and writes the report. It never judges your code; it only runs the Verify commands your Index defines.
- Your **Compliance level** is the highest Tier reached: every Rule in that Tier and every lower one has a Verdict and none is `fail`. Partials and `na` do not block; unaudited Rules do.
- The agent then **fixes** the easiest failing Rules first, using Gates to pause for approval on risky changes, and re-audits each one.

- Between audits, **guardrails** keep the level from slipping: the `AGENTS.md`/`CLAUDE.md` block tells agents to follow the Rules in `.eqc/RULES.md` while writing code, and opt-in git hooks plus a CI step run `verify` (the Rules' Verify commands) and `gate` (no passing Rule may regress).

More in [docs/concepts.md](docs/concepts.md).

## Quickstart

1. In your repo root, run `npx eqc-kit init`.
2. Answer the wizard. Every question has a default; press Enter to accept it.
3. Commit what it wrote (see [docs/ci.md](docs/ci.md)).
4. In your agent, say `eqc check` (in Claude Code, type `/eqc-check`). The first run indexes the Standard and audits every Rule.
5. Say `eqc fix` (Claude Code: `/eqc-fix`). Pick a Rule from the ranked list and review the change.
6. Repeat 4 and 5 until you reach the Tier you want.
7. Optional: run `npx eqc-kit hooks` so commits and pushes that break a passing Rule are blocked, and add the CI step from [docs/ci.md](docs/ci.md#running-in-a-pipeline).

Full walkthrough with real output: [docs/getting-started.md](docs/getting-started.md).

## Supported agents

| Agent | How it is wired | Guide |
|---|---|---|
| Claude Code | Native skills (`/eqc-check`, `/eqc-fix`) and subagents that run in parallel | [docs/agents/claude-code.md](docs/agents/claude-code.md) |
| Codex | `AGENTS.md` | [docs/agents/codex.md](docs/agents/codex.md) |
| Cursor | `AGENTS.md` | [docs/agents/cursor.md](docs/agents/cursor.md) |
| GitHub Copilot | `AGENTS.md` | [docs/agents/copilot.md](docs/agents/copilot.md) |
| Gemini CLI | `AGENTS.md` | [docs/agents/gemini-cli.md](docs/agents/gemini-cli.md) |
| Any other agent | `AGENTS.md`, or point it at `.eqc/prompts/` | [docs/agents/other.md](docs/agents/other.md) |

## What gets written to your repo

```
.eqc/
  bin/eqc.mjs        the Engine
  prompts/           the Prompts the agent follows
  hooks/             pre-commit and pre-push (enable with npx eqc-kit hooks)
  standard/          your copy of the Standard
  config.json        stack tags, Gates, report path
  manifest.json      hashes of the Managed files
  .gitignore         ignores tmp/
  rules.json         the Index (after the first check)
  compliance.json    latest Verdicts (after the first check)
  RULES.md           Rule digest agents read before writing code (after the first check)
  milestones.json    fix history (after the first fix)
  plans/             chunked fix Plans (medium and large fixes)
AGENTS.md            a marked block, appended to your file if you have one
CLAUDE.md            the same block, only if you already have a CLAUDE.md (Claude Code)
.claude/             Claude Code adapter only: skills/ and agents/
docs/eqc/COMPLIANCE.md   the report (path is configurable)
```

## Safety

- **Gates.** By default the agent stops for approval before changing CI config, adding or upgrading packages, changing an established architecture pattern, or touching top-Tier Rules. See [docs/configuration.md](docs/configuration.md).
- **Never commits by default.** Fixes stay in your working tree unless you turn on `gates.auto_commit`.
- **Never installs packages without approval.** A fix that needs a new package ends `BLOCKED` until you decide.
- **Hooks are opt-in.** Git hooks run only after `npx eqc-kit hooks`, and never replace Husky, Lefthook or existing hooks.
- **No postinstall.** Nothing runs when the package is fetched; setup happens only when you run `init`. See [ADR 0001](docs/adr/0001-no-postinstall.md).
- **Zero dependencies.** The installer and the Engine use only Node's standard library.
- **Vendored Engine.** The Engine is copied into `.eqc/bin/` and committed, so every teammate runs the same version with no network calls. See [ADR 0002](docs/adr/0002-vendored-zero-dependency-engine.md).

## Bring your own standard

Any Markdown document with tier headings and numbered Rules works. See [docs/writing-a-standard.md](docs/writing-a-standard.md) for the format and [standards/example.md](standards/example.md) for a complete three-Tier example. Pass it at init, or later with `eqc check path/to/standard.md`.

## Docs

| Page | Covers |
|---|---|
| [Getting started](docs/getting-started.md) | First run, start to finish |
| [Concepts](docs/concepts.md) | Terms and how the Compliance level is computed |
| [Installer commands](docs/commands.md) | `init`, `update`, `uninstall`, `doctor`, `hooks` and their flags |
| [Configuration](docs/configuration.md) | Every `.eqc/config.json` key; CI setup with `--config` |
| [Engine commands](docs/engine-commands.md) | `node .eqc/bin/eqc.mjs ...` |
| [Writing a Standard](docs/writing-a-standard.md) | Document format and indexing |
| [Claude Code](docs/agents/claude-code.md) | Skills, subagents, cheap model |
| [Other agents](docs/agents/other.md) | Codex, Cursor, Copilot, Gemini CLI, others |
| [CI and teams](docs/ci.md) | What to commit, sharing results, reviewing fixes |
| [Troubleshooting](docs/troubleshooting.md) | FAQ |
| [Decisions](docs/adr/) | Why it is built this way |

## Requirements

- Node 18 or newer. For repos that are not JavaScript, Node is needed only to run the installer and the Engine.
- A git repository. (`init --force` skips this check.)
- An AI coding agent that can read files and run shell commands.

## License

MIT. See [LICENSE](LICENSE).
