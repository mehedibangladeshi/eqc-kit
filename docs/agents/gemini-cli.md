# Gemini CLI + eqc-kit

Gemini CLI loads `GEMINI.md` by default. To read AGENTS.md, set the `context.fileName` setting.

## Setup
1. In your repo: `npx eqc-kit init` → choose the `agents-md` adapter.
2. Create or update `.gemini/settings.json` in the project root:
   ```json
   {
     "context": {
       "fileName": ["AGENTS.md", "GEMINI.md"]
     }
   }
   ```
   `fileName` accepts a single string or an array of strings.
3. Commit `.eqc/`, `AGENTS.md`, and `.gemini/settings.json`.

## Use
| When you say | What happens |
| --- | --- |
| `eqc check` | Gemini follows the check prompt and prints a report |
| `eqc fix [ID]` | Gemini follows the fix prompt and applies fixes |

Run `gemini` from the repo root.

## What to expect
- Context files load hierarchically: global `~/.gemini/`, then workspace directories and parents, then files discovered when tools access files or directories.
- Changes stay in your working tree for review.

## Troubleshooting
- AGENTS.md not loaded → check `.gemini/settings.json` is valid JSON at the project root and `context.fileName` includes `AGENTS.md`.
- Setting not recognized → update Gemini CLI.
- Project settings apply only when you run Gemini CLI from that project.

Last verified: 2026-09-29 · Sources: [GEMINI.md docs](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/gemini-md.md), [Gemini CLI configuration reference](https://geminicli.com/docs/reference/configuration/)
