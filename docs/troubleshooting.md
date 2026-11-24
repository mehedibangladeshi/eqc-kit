# Troubleshooting

## My Standard is in a private Google Doc, Confluence or Notion page

The installer and the agent cannot log in to private pages. Export the page as Markdown (or copy the text into a `.md` file), fix the numbering if the export flattened it, and give eqc-kit the file path. See [writing-a-standard.md](writing-a-standard.md#converting-an-existing-document).

When `init` asks for the Standard doc, type the file path (for example `docs/quality-standard.md`). For non-interactive use, set `standard.source` in the `--config` file.

A public URL to raw Markdown works too. A URL that returns a web page (HTML) does not index cleanly.

## Node is not installed, or my repo is not JavaScript

Node 18 or newer is needed for two things only: `npx eqc-kit ...` and the Engine (`node .eqc/bin/eqc.mjs`). Your project itself can be Go, Python, Swift, Kotlin or anything else. No `package.json` is created and nothing is added to your dependencies.

If `node` is missing, install Node 18+ and rerun. If it is too old, `npx eqc-kit doctor` prints a `✖ node ... (need >=18)` line and exits 1.

## `update` kept my files, or asked about conflicts

`update` never overwrites a Managed file you edited without asking. It prints the differing lines and asks; `--yes` keeps your version. A kept file is offered again on every update.

```
.eqc/prompts/fixer.md was edited locally:
- - Always mention the ticket key.
Overwrite .eqc/prompts/fixer.md? (y/n) [n]
```

- To take the new version, answer `y` (your edit is lost). Copy it somewhere first if you want it.
- To keep your edit, answer `n`. You will not get upstream changes to that file until you accept them.
- `init` reports an existing file it did not write as "already exists and is not managed by eqc-kit" and keeps it. Use `--force` on `init` to overwrite.
- `npx eqc-kit doctor` lists modified Managed files with a `⚠` line.

More in [commands.md](commands.md#update).

## I edited the Standard. How do I re-index?

Any edit that moves lines or changes titles or numbering makes the Index stale. Two things to know:

1. `.eqc/standard/<name>.md` is a copy taken at init. If you keep the master document elsewhere, edit it there and pass its path. If you would rather treat the copy as the master, edit it in place.
2. Rebuild the Index in your agent by giving the check a path:

```
In your agent:   eqc check docs/quality-standard.md        (Claude Code: /eqc-check docs/quality-standard.md)
```

This re-indexes, validates the new Index, and keeps Verdicts: unchanged and renumbered Rules keep theirs, and only added or changed Rules are re-audited. The Baseline level can drop if the Standard raised the bar. `milestones.json` and `plans/` are kept. For a full rebuild, run `eqc reset` first. See [writing-a-standard.md](writing-a-standard.md#re-indexing-after-you-edit-the-doc).

## `check-ids` fails

`check-ids` compares the Index with the Standard file, and the agent stops before auditing when it fails. Each problem prints as `<ID>: <reason>` and the exit code is 1. This is a real failure, made by inserting one line near the top of a Standard after indexing, so every Rule below it moved down one line:

```
$ node .eqc/bin/eqc.mjs check-ids .eqc/standard/example.md
BRONZE-1: line 14 has no leading "<n>." ("")
BRONZE-2: line 15 is numbered 1, expected 2
BRONZE-3: line 16 is numbered 2, expected 3
BRONZE-4: line 17 is numbered 3, expected 4
…
```

Almost always the Index is stale, or the document is checked against the wrong copy. Re-index as above, passing the current file. If it still fails right after indexing, the document has a numbering or heading problem; see [how check-ids validates](writing-a-standard.md#how-check-ids-validates).

## The agent ignores AGENTS.md

Not every tool reads `AGENTS.md` the same way, and some load it only at the start of a session.

- Run `npx eqc-kit doctor`. Confirm `AGENTS.md` exists at the repo root and contains the block between `<!-- eqc-kit:start -->` and `<!-- eqc-kit:end -->`.
- Start a fresh session so the file is reloaded.
- Check your tool's page: [Codex](agents/codex.md), [Cursor](agents/cursor.md), [GitHub Copilot](agents/copilot.md), [Gemini CLI](agents/gemini-cli.md), [others](agents/other.md).
- As a fallback, ask directly: "Read `.eqc/prompts/check.md` and follow it exactly." The Prompts are plain Markdown and name no specific tool.
- In Claude Code, use the native `/eqc-check` and `/eqc-fix`; see [claude-code.md](agents/claude-code.md).

## Rules were wrongly left out (or wrongly included) because of stack tags

The Index only contains Rules whose Applicability tags match `stack.tags` in `.eqc/config.json`. If detection missed part of your stack, some Rules will be missing.

1. Look at the current tags: `node .eqc/bin/eqc.mjs config get stack.tags`.
2. Edit `stack.tags` in `.eqc/config.json`, for example add `backend`.
3. Re-index: in your agent, `eqc check <standard path>`.

The indexing reply lists which Rules were excluded and why. Details in [configuration.md](configuration.md#stacktags).

## The agent says there is no index

The Engine exits with code 2 when `rules.json` is missing.

```
$ node .eqc/bin/eqc.mjs report
No index yet — run `eqc check` in your AI agent first (it indexes the standard).
```

Run `eqc check` once. `doctor` shows the same state as `⚠ not indexed yet`.

## Claude Code keeps asking permission to run the Engine

Allow `node .eqc/bin/eqc.mjs` for the project. See [claude-code.md](agents/claude-code.md#permission-prompts).

## `state schema N is older than this engine`

Your `.eqc/` state was written by an older eqc-kit, and the Engine refuses to read it until it is migrated. Nothing is lost; the state is just in the old format.

```
$ node .eqc/bin/eqc.mjs report
state schema 1 is older than this engine (2); run `npx eqc-kit update`
```

Run `npx eqc-kit update`. It syncs the Engine and migrates the state. If you only need the migration, run `node .eqc/bin/eqc.mjs migrate`. See [engine-commands.md](engine-commands.md#migrate).

## `state schema N is newer than this engine`

A teammate upgraded eqc-kit and committed state in a newer format than your copy of the Engine understands. The Engine refuses to run so it does not misread or overwrite that state.

```
$ node .eqc/bin/eqc.mjs merge verdicts.json
state schema 3 is newer than this engine (2); upgrade eqc-kit
```

Upgrade eqc-kit to the version your teammate uses, then pull and rerun. Do not run `migrate` or `update` with an older kit to get past this; that would downgrade the state. Until you upgrade, git hooks that run the Engine will fail too.

## `migration failed, state restored`

`migrate` (or `update`) could not upgrade the state, so it put the old state back:

```
$ node .eqc/bin/eqc.mjs migrate
migration 1→2 failed, state restored: Unexpected token } in JSON at position 42
```

Your state is as it was before the run. The copy taken before the run is in `.eqc/tmp/backup-schema-N/` (here `N` is the schema you started from). Read the error to find the file it names. A corrupt JSON file is the usual cause, so check that file in `.eqc/` against the backup, fix the JSON by hand, and rerun `migrate`.

## Uninstall

```
$ npx eqc-kit uninstall
Remove managed files (state in .eqc/ is kept)? (y/n) [n]
```

This removes the Engine, Prompts, adapter files and the `AGENTS.md` block, and keeps your config, Index, Verdicts, Milestones, Plans and the report. Add `--purge` to delete `.eqc/` too. Edits you made to Managed files are deleted along with them, so copy them out first. Full table in [commands.md](commands.md#uninstall).
