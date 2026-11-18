# Codex + eqc-kit

Codex reads AGENTS.md natively: it walks from the Git root down to your working directory, checking each level for `AGENTS.override.md`, then `AGENTS.md`.

## Setup
1. In your repo: `npx eqc-kit init` → choose the `agents-md` adapter.
2. Start Codex from inside the repo. No further configuration is needed.
3. Commit `.eqc/` and `AGENTS.md`.

## Use
| When you say | What happens |
| --- | --- |
| `eqc check` | Codex follows the check prompt, audits rules, prints a report |
| `eqc fix` | Codex follows the fix prompt, shows a ranked list, applies fixes |
| `eqc help [question]` | Codex reads your level and next fix, answers, changes nothing |

Changes stay uncommitted unless you commit them.

## What to expect
- Files closer to your working directory override earlier guidance.
- Combined instructions have a byte limit (default 32 KiB, `project_doc_max_bytes`); Codex stops adding files once it is reached.
- Shell commands need approval per your Codex approval settings.
- The instruction chain is rebuilt on each run; there is no cache to clear.

## Troubleshooting
- Codex ignores the eqc-kit block → confirm AGENTS.md is under the Git root and the eqc-kit managed block is present and not cut off by the size limit.
- Nested AGENTS.md or `AGENTS.override.md` overrides your rules → nearer files win; move the eqc-kit block or the conflicting text.
- Empty AGENTS.md files are skipped.

Last verified: 2026-09-29 · Source: [Codex AGENTS.md guide](https://developers.openai.com/codex/guides/agents-md) (from developers.openai.com/codex/guides/agents-md)
