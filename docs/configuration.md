# Configuration

Everything lives in `.eqc/config.json`, written by `npx eqc-kit init` and committed with the rest of `.eqc/`. You can edit it by hand. Read a value the way the Prompts do:

```
$ node .eqc/bin/eqc.mjs config get gates
{"package_install":true,"ci_config":true,"architecture":true,"top_tier":true,"auto_commit":false}
$ node .eqc/bin/eqc.mjs config get stack.tags
["react","nextjs","web","all"]
```

A real file, from init in a Next.js-style repo with every default accepted:

```json
{
  "schema": 1,
  "standard": { "path": ".eqc/standard/example.md", "source": "example" },
  "stack": {
    "detected": ["react", "nextjs", "web"],
    "tags": ["react", "nextjs", "web", "all"]
  },
  "ci_paths": [".github/workflows"],
  "package_manager": ["npm"],
  "gates": {
    "package_install": true,
    "ci_config": true,
    "architecture": true,
    "top_tier": true,
    "auto_commit": false
  },
  "adapters": ["claude-code", "agents-md"],
  "report_path": "docs/eqc/COMPLIANCE.md",
  "cheap_model": null,
  "installed_version": "0.1.0"
}
```

## Keys

| Key | Type | Default | Used by |
|---|---|---|---|
| `schema` | number | `1` | Installer (validated by `doctor`). Do not change. |
| `standard.path` | string | `.eqc/standard/<name>.md` | `check`: the file indexed when you give no source |
| `standard.source` | string | what you answered | Record of where the Standard came from. Not read again. |
| `stack.detected` | string[] | detected tags | Record of what init detected. Not read again. |
| `stack.tags` | string[] | detected tags plus `all` | `check` and the indexer: which Rules apply |
| `ci_paths` | string[] | detected CI files | `audit`: what counts as a `ci-config` fix |
| `package_manager` | string[] | detected | Recorded for reference. No Prompt reads it today. |
| `gates.package_install` | boolean | `true` | `fix` |
| `gates.ci_config` | boolean | `true` | `fix` |
| `gates.architecture` | boolean | `true` | `fix` |
| `gates.top_tier` | boolean | `true` | `fix` |
| `gates.auto_commit` | boolean | `false` | `fix` and the fixer |
| `adapters` | string[] | see below | Installer: which adapter files `update` writes |
| `report_path` | string | `docs/eqc/COMPLIANCE.md` | Engine: where the report is written; the adapter files |
| `cheap_model` | string or null | `null` | `check` and `fix`, Claude Code only |
| `installed_version` | string | eqc-kit version | Installer. Set by `init` and `update`. |
| `state_schema` | integer | `2` | Written by `init`; changed only by Migrations via `update` or `migrate`. Missing means 1. Do not edit by hand. |

### Standard

`standard.path` is a copy of your Standard inside `.eqc/standard/`, made at init from a local path, a URL or the bundled `example`. Editing the original file elsewhere does not change this copy. See [troubleshooting.md](troubleshooting.md#i-edited-the-standard-how-do-i-re-index).

### stack.tags

Rules whose Applicability tags do not match are left out at indexing time. `all` is always added, and a Rule tagged `[all]` or with no tag always applies. Detection covers, among others: `react`, `nextjs`, `vue`, `nuxt`, `angular`, `svelte`, `react-native`, `expo`, `flutter`, `android`, `ios`, `node`, `python`, `go`, `java`, `kotlin`, `rust`, `php`, `ruby`, `dotnet`, plus broad tags `web`, `mobile` and `backend` derived from them.

To change: edit `stack.tags`, then re-index by running `eqc check <standard path>` in your agent. The tags are read only when indexing, so a change has no effect until you re-index.

### ci_paths

Files or folders that hold your pipeline. Detected from: `.github/workflows`, `.gitlab-ci.yml`, `Jenkinsfile`, `codemagic.yaml`, `azure-pipelines.yml`, `.circleci`, `bitbucket-pipelines.yml`, `fastlane`, `.buildkite`, `.travis.yml`. The auditor uses them to decide whether a fix touches CI, which triggers `gates.ci_config`. Edit the list if you keep pipeline code elsewhere.

### gates

The five Gates. For `package_install`, `ci_config`, `architecture` and `top_tier`, `true` means the agent stops and asks before a fix that matches; `false` lets it proceed. `top_tier` matches any Rule in the highest Tier. `auto_commit: true` makes the agent commit each finished fix as `chore(eqc): <ID> <title>`; otherwise it never commits. If a Gate key is missing, the Prompts fall back to the safe default: all `true`, `auto_commit` false. How Gates are triggered: [concepts.md](concepts.md#effort-tier-blast-radius-and-gates).

Changes take effect immediately, with no `update` needed.

### adapters

`claude-code` writes `.claude/skills/` and `.claude/agents/`. `agents-md` writes the block in `AGENTS.md`. Init picks `claude-code` if `.claude/` or `CLAUDE.md` exists, adds `agents-md` if `AGENTS.md` exists, and picks both if neither exists. To add or drop an adapter, edit the list and run `npx eqc-kit update`. Dropping one does not delete its files; run `uninstall` or delete them yourself.

### report_path

Where `merge` writes the Markdown report, relative to the repo root. The HTML report is written beside it, with `.html` instead of `.md`. The path is also written into the adapter files, so after changing it run `npx eqc-kit update`. The old report file is not moved.

### cheap_model

Claude Code only. A model name for the agent to use on mechanical work. `null` or blank means every task inherits your session model. Change it, then run `npx eqc-kit update` to regenerate the skill. See [claude-code.md](agents/claude-code.md#cheaper-model-for-mechanical-work).

## Non-interactive setup

For CI, scripts, or many repos at once, give the answers in a JSON file:

```
$ npx eqc-kit init --yes --config answers.json
```

`--yes` never prompts. Any key missing from the file takes the default, the same as `init --yes` alone: detected stack tags, CI paths and package managers, and the Gate defaults above. Keys you can set:

| Key in `answers.json` | Same as config key |
|---|---|
| `standard.source` (or `standard.path`) | a local path, an http(s) URL, or `example` |
| `stack.tags` | `stack.tags` (`all` is added for you) |
| `ci_paths`, `package_manager` | same |
| `gates` (any of the five) | same |
| `adapters` | same (`claude-code`, `agents-md`) |
| `report_path`, `cheap_model` | same (`""` means no cheaper model) |

A full example, `answers.json`, for a Go service using both adapters:

```json
{
  "standard": { "source": "docs/quality-standard.md" },
  "stack": { "tags": ["go", "backend"] },
  "ci_paths": [".github/workflows"],
  "package_manager": ["go"],
  "gates": {
    "package_install": true,
    "ci_config": true,
    "architecture": true,
    "top_tier": false,
    "auto_commit": false
  },
  "adapters": ["claude-code", "agents-md"],
  "report_path": "docs/eqc/COMPLIANCE.md",
  "cheap_model": "haiku"
}
```

Running it in a repo that has `docs/quality-standard.md`:

```
$ npx eqc-kit init --yes --config answers.json
eqc-kit 0.1.0 installed in /path/to/service
  standard : .eqc/standard/quality-standard.md  (source: docs/quality-standard.md)
  stack    : go, backend, all
  ci       : .github/workflows   package manager: go
  adapters : claude-code, agents-md   report: docs/eqc/COMPLIANCE.md
  wrote 14 files: .eqc/{config.json,manifest.json,bin,prompts} + adapter files

Next step:
  Claude Code: run /eqc-check
  Any AGENTS.md tool: ask 'run eqc check'
The first check indexes the standard.
```

Notes:

- `init` refuses to run if `.eqc/config.json` already exists. Use `update` on an existing install.
- An unreadable or invalid `--config` file stops with `error: cannot read --config file <path>`. An adapter other than `claude-code` or `agents-md` stops with `error: unknown adapter: <name>`.
- The init step does not run the audit. Indexing and auditing are done by your agent. See [ci.md](ci.md).
