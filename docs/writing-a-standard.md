# Writing a Standard

The Standard is a Markdown document you own. The agent reads it once and builds the Index from it. The clearer the shape, the more reliable the Index and the more consistent every later Audit. This page says what shape to use.

## Required shape

```markdown
# My Engineering Standard
Version: 1.0
Date: 2026-01-15

## Bronze
Optional intro sentence.

1. **CI runs on every pull request** [all] A pipeline builds and tests each pull request. Merging is blocked when it fails.
2. **No committed secrets** [all] ...

## Silver
1. **Unit tests exist** [all] ...
```

| Part | Requirement |
|---|---|
| Tiers | One heading per Tier (`#`, `##`, any depth), **ordered lowest first**. The heading text becomes the Tier name; its uppercase form is the ID prefix (`Bronze` gives `BRONZE`). |
| Rules | Numbered `1.`, `2.`, `3.` under the Tier heading. |
| Title | A bold title at the start of each Rule: `**Linter enforced**`. |
| Applicability tag | Optional, in square brackets after the title: `[all]`, `[web]`, `[backend]`, `[mobile]`, or specific ones such as `[react]`, `[python]`, `[go]`, `[ios]`. Several are allowed: `[web][mobile]`. No tag means `all`. |
| Detail | 1 to 3 sentences after the tag saying what "pass" means. |

Version and date lines at the top are recorded in the Index and the report. They are optional but useful.

## What the indexer does with it

- **IDs are the printed number.** `3.` under `## Silver` is always `SILVER-3`. The indexer never renumbers.
- **Gaps are fine.** If you delete rule 4 and keep 3 and 5, the IDs stay `SILVER-3` and `SILVER-5`. Old Verdicts and Milestones keep pointing at the right Rule.
- **Two Rules with the same number in one Tier, or a Rule with no number, is an error.** The indexer stops and reports it instead of inventing an ID.
- **The body wins over a changelog.** If a "changes in v2" section says a Rule moved from Silver to Gold but the body still lists it under Silver, it is indexed under Silver and the conflict is noted in `.eqc/doc-meta.md`. Edit the body, not the changelog, to move a Rule.
- **A section below the lowest Tier is not indexed.** For example a closing "Hard failures" summary. Nothing special is needed: a fail in the lowest Tier already produces `HARD_FAIL`.
- **Tags filter by stack.** Rules whose tags do not match your project's stack tags are left out and listed in the indexing reply. See `config get stack.tags`.

## Write rules that can be audited

An Audit gives a Verdict from evidence in the code: a file, a config key, a dependency, a command's output. So each Rule should name something checkable.

| Weak | Strong |
|---|---|
| Code quality is high | A linter is configured and runs in CI with zero errors |
| Tests are good | Core logic has unit tests that run in CI and pass reliably |
| Secrets are handled properly | Source control contains no API keys or tokens; secrets come from the environment or a secret manager |

Also:

- One requirement per Rule. "Accessibility and crash reporting" (as in the example Standard) will often come out `partial`; split it if you want clean Verdicts.
- Say where it applies: "in CI", "in every service", "on every pull request".
- State the pass condition, not the ideal. `pass` means met across the codebase, not in one sampled file.
- Prefer wording a machine can confirm over words like "appropriate" or "sufficient".

## A minimal complete example

```markdown
# Tiny Standard
Version: 0.1
Date: 2026-01-01

## Basic
1. **CI runs on every pull request** [all] A pipeline builds and tests each pull request. Merging is blocked when it fails.
2. **README has setup instructions** [all] A new developer can install, run and test the project from the README alone.

## Solid
1. **Coverage threshold enforced** [all] CI fails when test coverage drops below a set percentage.
2. **Database migrations are versioned** [backend] Schema changes are applied through migration files in source control.
```

This gives two Tiers (`BASIC`, `SOLID`) and the IDs `BASIC-1`, `BASIC-2`, `SOLID-1`, `SOLID-2`. `SOLID-2` is dropped for a mobile-only project.

## Before you index

- [ ] Tier headings are in order, lowest first
- [ ] Every Rule is numbered `1.`, `2.`, ... within its Tier, with no duplicates
- [ ] Every Rule starts with a bold title
- [ ] Tags, where used, are in square brackets and use consistent names
- [ ] Each Rule says in 1 to 3 sentences what pass means
- [ ] Each Rule can be confirmed from code, config or command output
- [ ] Changelog or notes sections agree with the body (or you are happy for the body to win)

## Converting an existing document

From Google Docs, Confluence or Notion: export as Markdown, or copy the text into a `.md` file. Then:

1. Make sure the Tiers are headings and the Rules are numbered lists. Exports often turn numbering into plain text or nested bullets; fix these by hand.
2. Keep it as a file. Line numbers in the Index point into this file, so pass the agent a path, not pasted text in chat (the agent will write pasted text to a file for you).
3. Bold, links and escaped characters from an export are tolerated when matching lines: `\*\*` markup, `[text](url)` and `&nbsp;` are stripped before comparison.

## Re-indexing after you edit the doc

Any edit that changes line numbers, titles or numbering makes the Index stale. In your agent, run the `eqc check` Prompt with the path to the doc, for example `eqc check standards/my-standard.md`. That rebuilds the Index from scratch, validates it, and re-audits every Rule. `milestones.json` and `plans/` are kept as history; `rules.json` and `compliance.json` are replaced.

To validate without re-auditing, run the Engine yourself (from the repo root):

```
$ node .eqc/bin/eqc.mjs check-ids standards/my-standard.md
check-ids: 17 rules OK
```

## How `check-ids` validates

For every Rule in the Index, the Engine opens the recorded `source_line` in the doc and confirms that:

1. the line is inside the Rule's Tier section,
2. it starts with `<n>.` and `<n>` equals the number in the Rule ID,
3. it contains the first 20 characters of the Rule's title (case and markup ignored).

Any mismatch is printed as `<ID>: <reason>` and the exit code is 1. If everything matches it prints `check-ids: N rules OK` and exits 0. The indexing Prompt runs this before finishing, and the check Prompt runs it again after indexing and stops before auditing if it fails.

A real failure: in a copy of the Index, `source_line` of `BRONZE-3` was changed from 16 to 17, so it points one line too low:

```
$ node .eqc/bin/eqc.mjs check-ids standards/example.md
BRONZE-3: line 17 is numbered 4, expected 3
$ echo $?
1
```

Other messages you may see:

```
BRONZE-2: line 15 doesn't contain title "Linter enforced"
SILVER-1: source_line 25 is not inside the SILVER section
check-ids: doc not found: missing.md
```

The first appears when a title was renamed after indexing (`Linter enforced` became `Lint rule`). The second appears when the Tier heading changed (`## Silver` became `## Silver tier`) so the section could no longer be found. In both cases, re-index.
