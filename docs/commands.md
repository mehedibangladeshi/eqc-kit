# Installer commands

The Installer is `npx eqc-kit`. It sets up `.eqc/`, writes the adapter files, and keeps them current. It never judges code. For the Engine that your agent runs (`node .eqc/bin/eqc.mjs ...`), see [engine-commands.md](engine-commands.md).

```
$ npx eqc-kit --help
eqc-kit 0.1.0
usage: eqc-kit <init|update|uninstall|doctor> [--yes] [--config file.json] [--force] [--purge] [--cwd dir]
```

Run it from the repo root, or pass `--cwd`.

## Flags

| Flag | Short | Applies to | Meaning |
|---|---|---|---|
| `--yes` | `-y` | init, update, uninstall | Accept defaults and never prompt. On conflicts, keep your file. |
| `--config <file>` | | init | Read answers from a JSON file. See [configuration.md](configuration.md#non-interactive-setup). |
| `--force` | | init, update, uninstall | `init`: install outside a git repo, and overwrite existing files that eqc-kit did not write. `update`: overwrite Managed files you edited, without asking. `uninstall`: remove Managed files you edited. |
| `--purge` | | uninstall | Also delete `.eqc/` entirely, state included. |
| `--cwd <dir>` | | all | Act on this directory instead of the current one. |
| `--help` | `-h` | | Print usage. |
| `--version` | `-v` | | Print the version. |

Running with no command prints the usage line and exits 0.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success. Also: usage printed, uninstall declined, or files kept on conflict (a warning is printed). |
| 1 | Error (message on stderr, prefixed `error:`), an unknown command, or `doctor` found a failed check. |

Prompts and summaries go to stdout; warnings and errors to stderr. When stdin is not a terminal, the prompts read answers from piped lines in order, and the question text is still printed.

## `init`

Installs eqc-kit into a repo. Refuses if `.eqc/config.json` already exists (use `update`) or if there is no `.git` in the directory or any parent (use `--force`).

```
$ npx eqc-kit init
Standard doc: local path, http(s) URL, or "example" ... [example]
Stack tags (detected, edit as comma list): [react,nextjs,web]
...
```

The full prompt sequence and what each question means are in [getting-started.md](getting-started.md#1-install-into-your-repo).

What it does:

1. Detects your stack tags, CI paths and package managers from files in the repo root and one folder down.
2. Asks the questions (or takes answers from `--config`; `--yes` takes defaults).
3. Copies the Standard to `.eqc/standard/`, writes `.eqc/config.json`, `.eqc/.gitignore` (`tmp/`) and the vendored Engine and Prompts.
4. Writes the adapter files you chose, then `.eqc/manifest.json` with a hash of every Managed file.

Defaults under `--yes`: Standard `example`, detected tags, CI paths and package managers, every Gate `true` except `auto_commit`, report at `docs/eqc/COMPLIANCE.md`, no cheaper model. The default adapters are `claude-code` if `.claude/` or `CLAUDE.md` exists plus `agents-md` if `AGENTS.md` exists; if none of those exist, both.

An existing `AGENTS.md` is kept: the eqc-kit block is appended between `<!-- eqc-kit:start -->` and `<!-- eqc-kit:end -->`. An existing file at a path eqc-kit wants to write, that it did not write, is kept and reported unless you confirm the overwrite (or pass `--force`):

```
$ npx eqc-kit init --yes
warning: kept your existing .claude/skills/eqc-check/SKILL.md (rerun without --yes to review, or use --force)
...
  skipped 1 existing file(s): .claude/skills/eqc-check/SKILL.md
```

Errors you may see:

```
error: /path/to/dir is not inside a git repo (use --force to install anyway).
error: .eqc/config.json exists: run `eqc-kit update` instead.
error: cannot read --config file nope.json
error: unknown adapter: cursor
error: cannot read standard file: missing.md
```

The adapter names are `claude-code` and `agents-md` only. Cursor, Codex and the rest use `agents-md`.

## `update`

Regenerates the Managed files from the installed eqc-kit version and your current `.eqc/config.json`. Run it after upgrading eqc-kit, and after editing `cheap_model`, `report_path` or `adapters` in the config.

```
$ npx eqc-kit update
update: 0 written, 0 kept (edited), 14 unchanged
```

It also fills in any config keys that newer versions expect and updates `installed_version`. It does not re-detect your stack: `stack.tags` stays as you left it.

If you edited a Managed file, `update` will not overwrite it silently. It shows what differs and asks:

```
$ npx eqc-kit update

.eqc/prompts/fixer.md was edited locally:
- - Always mention the ticket key.
Overwrite .eqc/prompts/fixer.md? (y/n) [n]
warning: kept your edited .eqc/prompts/fixer.md (rerun without --yes to review)
update: 0 written, 1 kept (edited), 13 unchanged
```

The diff lines starting with `-` are what is in your file and not in the new version; `+` is the reverse. Answer `y` to take the new version (your edit is lost), `n` to keep yours. With `--yes` every conflict is kept; with `--force` every conflict is overwritten without asking. A kept file stays "modified" and is offered again on the next update.

`update --force` prints the same summary and lists the overwritten files:

```
$ npx eqc-kit update --force
update: 2 written, 0 kept (edited), 12 unchanged
  wrote .eqc/prompts/fix.md
  wrote .claude/skills/eqc-fix/SKILL.md
```

A change to `cheap_model` only rewrites the Claude Code skill; see [claude-code.md](agents/claude-code.md#cheaper-model-for-mechanical-work):

```
$ npx eqc-kit update --yes
update: 1 written, 0 kept (edited), 13 unchanged
  wrote .claude/skills/eqc-fix/SKILL.md
```

## `uninstall`

Removes the Managed files. It asks first unless you pass `--yes`:

```
$ npx eqc-kit uninstall
Remove managed files (state in .eqc/ is kept)? (y/n) [n]
```

Answering `n` prints `aborted.` and exits 0.

| Removed | Kept (default) | Removed with `--purge` |
|---|---|---|
| `.eqc/bin/`, `.eqc/prompts/`, `.eqc/manifest.json` | `.eqc/config.json`, `.eqc/standard/`, `rules.json`, `compliance.json`, `milestones.json`, `plans/` | all of `.eqc/` |
| The `.claude/skills/eqc-*` and `.claude/agents/eqc-*` files | The report file (for example `docs/eqc/COMPLIANCE.md`) | |
| The eqc-kit block in `AGENTS.md`; the file itself only if nothing else is left in it | | |

```
$ npx eqc-kit uninstall --yes
uninstalled; .eqc/ state kept (use --purge to remove).
$ npx eqc-kit uninstall --yes --purge
uninstalled; .eqc/ removed.
```

Unedited Managed files are removed. A Managed file (or the eqc-kit block in `AGENTS.md`) that you edited is kept with a warning, or, in an interactive run, you are asked `remove edited <path>? [n]`. Pass `--force` to remove edited ones too. The manifest is deleted afterwards, so a kept file is no longer tracked.

```
$ npx eqc-kit uninstall --yes
warning: kept edited .claude/skills/eqc-fix/SKILL.md (use --force to remove)
uninstalled; .eqc/ state kept (use --purge to remove).
```

Files eqc-kit never wrote (for example a skill it skipped at init) are left alone. Afterwards `.claude/skills/`, `.claude/agents/` and `.claude/` are removed if they are empty; non-empty ones stay. With no `.eqc/` present, it prints `error: nothing to uninstall: no .eqc/ found.` and exits 1.

## `doctor`

Read-only health check. Takes no flags but `--cwd`. Exits 1 if any line starts with `✖`; `⚠` lines are warnings and do not change the exit code.

```
$ npx eqc-kit doctor
✔ node 25.9.0 (need >=18)
✔ config.json valid
✔ standard file .eqc/standard/example.md
✔ engine selftest passes
✔ 14 managed files present and unmodified
✔ standard indexed (rules.json)
```

| Check | Fails (`✖`) when |
|---|---|
| node | Node is older than 18 |
| config.json | Missing, invalid JSON, or missing required keys |
| standard file | The path in `standard.path` does not exist |
| engine | `.eqc/bin/eqc.mjs` is missing or its selftest fails |
| managed files | The manifest is missing or invalid, or a Managed file is gone |

Warnings (`⚠`): one or more Managed files were modified since install (listed on one line), or the Standard is not indexed yet (`not indexed yet: run eqc check`, normal before the first check).

```
⚠ 2 managed file(s) modified: .claude/skills/eqc-fix/SKILL.md, .eqc/prompts/fix.md
```

In an empty or broken install:

```
✖ .eqc/config.json missing or not valid JSON
✖ engine .eqc/bin/eqc.mjs missing
✖ .eqc/manifest.json missing or invalid
⚠ not indexed yet: run eqc check
```

When a modified file is listed, the "N managed files present and unmodified" line is not printed.
