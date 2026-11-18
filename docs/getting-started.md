# Getting started

This walks through a first run in a small Next.js-style project with a GitHub Actions workflow. Shell output below is real, from running the installer in such a repo. Anything the agent does is labelled "In your agent" and is described from the Prompts, not captured output.

You need Node 18+ and a git repository. See the [README](../README.md) for what eqc-kit is.

## 1. Install into your repo

From the repo root:

```
$ npx eqc-kit init
```

The installer looks at your repo to suggest defaults, then asks each question. Press Enter to accept the value in brackets. This is the real prompt sequence, with every default accepted:

```
Standard doc: local path, http(s) URL, or "example" (private Google Docs/Confluence: export to Markdown first). [example]
Stack tags (detected, edit as comma list): [react,nextjs,web]
CI paths: [.github/workflows]
Package manager(s): [npm]
Package installs need approval? (y/n) [y]
CI config changes need approval? (y/n) [y]
Architecture changes need approval? (y/n) [y]
Top-tier rules need approval? (y/n) [y]
Auto-commit each fix? (y/n) [n]
Adapters (claude-code, agents-md): [claude-code,agents-md]
Cheaper model for mechanical fix chunks (blank = use your default):
Report path: [docs/eqc/COMPLIANCE.md]
```

What each question means:

| Question | Meaning |
|---|---|
| Standard doc | Your Standard: a local path, a URL to raw Markdown, or `example` for the bundled sample. Private Google Docs, Confluence or Notion pages cannot be fetched; export them to Markdown first ([how](writing-a-standard.md#converting-an-existing-document)). |
| Stack tags | Which Applicability tags apply to you. Rules tagged for other stacks are left out of the Index. |
| CI paths, Package manager(s) | Where your pipeline lives and which package managers you use, so fixes edit the right files. |
| The five yes/no questions | Your Gates. `y` means the agent must ask first. The last one, auto-commit, is `n` by default. |
| Adapters | `claude-code` for native skills and subagents, `agents-md` for every other agent. Both is fine. |
| Cheaper model | Optional, Claude Code only. See [claude-code.md](agents/claude-code.md#cheaper-model-for-mechanical-work). |
| Report path | Where the Markdown report is written. |

Then it prints a summary and writes the files:

```
eqc-kit 0.1.0 installed in /path/to/webapp
  standard : .eqc/standard/example.md  (source: example)
  stack    : react, nextjs, web, all
  ci       : .github/workflows   package manager: npm
  adapters : claude-code, agents-md   report: docs/eqc/COMPLIANCE.md
  wrote 14 files: .eqc/{config.json,manifest.json,bin,prompts} + adapter files

Next step:
  Claude Code: run /eqc-check
  Any AGENTS.md tool: ask 'run eqc check'
The first check indexes the standard.
```

To skip the questions (for example in CI), see [configuration.md](configuration.md#non-interactive-setup).

Confirm the install is healthy:

```
$ npx eqc-kit doctor
✔ node 25.9.0 (need >=18)
✔ config.json valid
✔ standard file .eqc/standard/example.md
✔ engine selftest passes
✔ 14 managed files present and unmodified
⚠ not indexed yet: run eqc check
```

The last line is expected until the first check.

## 2. Commit

Commit `.eqc/` (the installer already ignores `.eqc/tmp/`), `AGENTS.md` and `.claude/`. Details in [ci.md](ci.md).

## 3. Check

In your agent, ask for a check. Claude Code has a native command; other agents read `AGENTS.md`. One guide per agent:

- [Claude Code](agents/claude-code.md)
- [Codex](agents/codex.md), [Cursor](agents/cursor.md), [GitHub Copilot](agents/copilot.md), [Gemini CLI](agents/gemini-cli.md), [other agents](agents/other.md)

In your agent (described from `.eqc/prompts/check.md`, not captured output):

```
You:    /eqc-check          (other agents: "eqc check")
Agent:  indexes the Standard into .eqc/rules.json and validates it
        audits every Rule, one audit per Tier, in parallel if it can
        merges the Verdicts through the Engine
        prints the report and "next: eqc fix"
```

Running it again with no arguments just reprints the saved report and audits nothing. `recheck` re-audits only Rules that are `fail` or `partial`; `full` re-audits everything; a Tier ID or Rule IDs (`SILVER`, `BRONZE-6,GOLD-1`) re-audits just those.

### Example report

This is a real report, produced by merging a sample Verdicts file with the Engine in a test repo. Your agent's Verdicts will differ.

```
# Example Engineering Quality Standard — compliance report

Standard: Example Engineering Quality Standard v1.0
Audited: 2026-09-29
Compliance level: Bronze

| Tier | Pass | Partial | Fail | N/A | Total |
|---|---|---|---|---|---|
| Bronze | 5 | 1 | 0 | 0 | 6 |
| Silver | 4 | 0 | 2 | 0 | 6 |
| Gold | 4 | 0 | 1 | 0 | 5 |

## Fails

- **SILVER-2** — Coverage threshold enforced — No coverage threshold in jest.config.js or CI.
- **SILVER-3** — Structured logging, no stray debug prints — 41 console.log calls under src/.
- **GOLD-1** — Release automation — Releases are tagged by hand.

## Partials

- **BRONZE-6** — Dependency vulnerability audit — npm audit runs in CI but only warns.

_Generated by eqc-kit — do not edit by hand_
```

The report is saved at the `report_path` from your config and regenerated on every merge. Beside it, the same result is written as an HTML page (`COMPLIANCE.html`) that you can open in any browser. Do not edit either file by hand. Here the Compliance level is Bronze: Bronze has no fails, Silver has two. See [concepts.md](concepts.md#how-the-compliance-level-is-computed).

## 4. Fix

In your agent (described from `.eqc/prompts/fix.md`, not captured output):

```
You:    /eqc-fix            (other agents: "eqc fix")
Agent:  shows the top 10 candidates, easiest first, and asks which to fix
```

The list comes from the Engine's `rank` command. In the example repo it prints:

```
$ node .eqc/bin/eqc.mjs rank
SILVER-2 — Coverage threshold enforced — 2 files · small effort ⚠ ci-config
SILVER-3 — Structured logging, no stray debug prints — 18 files · medium effort ⚠ large-sweep
GOLD-1 — Release automation — 2 files · small effort ⚠ ci-config, package-install
```

After you pick, for each Rule, one at a time:

- If the fix touches CI config, adds a package, changes an architecture pattern, or the Rule is in the top Tier, the agent shows why and waits for your approval (your Gates). `SILVER-2` above would pause, because it touches CI config.
- Trivial and small fixes are done in one pass. Medium and large fixes get a written Plan in `.eqc/plans/` for you to approve or edit, then run Chunk by Chunk; you can stop after any Chunk and resume later.
- The agent re-audits the Rule, merges the new Verdict, and tells you the before and after and whether the Compliance level changed.
- Changes stay uncommitted in your working tree unless you set `gates.auto_commit`.

Review the diff like any other change, commit it, and run `eqc fix` again.

## 5. Keep going

- After your team edits the Standard, re-index it: [troubleshooting.md](troubleshooting.md#i-edited-the-standard-how-do-i-re-index).
- To pick up a newer eqc-kit, run `npx eqc-kit update` ([commands.md](commands.md#update)). It migrates `.eqc/` state to the new format and keeps your Verdicts, Baseline and Milestones; commit the result so teammates get the same Engine and state.
- To share results and review fixes in pull requests: [ci.md](ci.md).
- Something off? [troubleshooting.md](troubleshooting.md).
