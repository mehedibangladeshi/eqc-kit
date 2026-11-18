# GitHub Copilot + eqc-kit

Copilot reads AGENTS.md as "agent instructions" in several places; the nearest AGENTS.md in the directory tree takes precedence.

## Setup
1. In your repo: `npx eqc-kit init` → choose the `agents-md` adapter.
2. VS Code only: enable the setting `chat.useAgentsMdFile` (Settings, search "AGENTS.md"). For nested AGENTS.md files also enable `chat.useNestedAgentsMdFiles` (disabled by default).
   ```json
   {
     "chat.useAgentsMdFile": true,
     "chat.useNestedAgentsMdFiles": true
   }
   ```
3. Commit `.eqc/` and `AGENTS.md`.

## Use
| When you ask | What happens |
| --- | --- |
| `eqc check` | Copilot follows the check prompt and reports findings |
| `eqc fix ID` | Copilot follows the fix prompt and proposes edits |
| `eqc help [question]` | Copilot reads your level and next fix, answers, changes nothing |

## What to expect
- Per GitHub's support table, AGENTS.md is read by Copilot cloud agent, Copilot code review, Copilot Chat in VS Code, and Copilot CLI.
- "Agent instructions" are not supported by every Copilot feature; check the table below if a surface ignores them.
- You review and commit changes yourself.

## Troubleshooting
- VS Code ignores AGENTS.md → the setting is off for the Local agent; enable `chat.useAgentsMdFile`.
- Nested files ignored → enable `chat.useNestedAgentsMdFiles`.
- Wrong instructions applied → the nearest AGENTS.md wins; check for a closer file.

Last verified: 2026-09-29 · Sources: [VS Code custom instructions](https://code.visualstudio.com/docs/copilot/customization/custom-instructions), [GitHub: add repository instructions](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions), [GitHub: custom instructions support](https://docs.github.com/en/copilot/reference/custom-instructions-support)
