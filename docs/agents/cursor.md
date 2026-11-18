# Cursor + eqc-kit

Cursor supports AGENTS.md in the project root as an alternative to `.cursor/rules`, and in subdirectories.

## Setup
1. In your repo: `npx eqc-kit init` → choose the `agents-md` adapter.
2. Open the repo in Cursor and use the Agent.
3. Commit `.eqc/` and `AGENTS.md`.

## Use
| When you say | What happens |
| --- | --- |
| `eqc check [arg]` | Agent follows the check prompt and audits rules |
| `eqc fix [ID]` | Agent follows the fix prompt, picks a rule, proposes edits, re-verifies |
| `eqc help [question]` | Agent reads your level and next fix, answers, changes nothing |

Changes stay in your working tree for review.

## What to expect
- Nested AGENTS.md files apply automatically when working with files in that directory or its children.
- Instructions from nested files are combined hierarchically; deeper files take precedence over parents.
- Terminal commands follow your Cursor approval settings.

## Troubleshooting
- Rules not applied → confirm AGENTS.md is in the project root and contains the eqc-kit managed block.
- A nested AGENTS.md conflicts with the root one → the deeper file wins; adjust it.
- Older Cursor versions may lack nested support → update Cursor.

Last verified: 2026-09-29 · Source: [Cursor rules docs](https://cursor.com/docs/context/rules)
