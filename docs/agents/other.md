# Other Tools + eqc-kit

These tools were checked against their vendors' own docs. Any tool not listed here: check its docs for AGENTS.md support.

## Setup
1. In your repo: `npx eqc-kit init` → choose the `agents-md` adapter.
2. Follow the section for your tool below.
3. Commit `.eqc/` and `AGENTS.md`.

## Reads AGENTS.md natively (verified)
| Tool | What its docs say | Source |
| --- | --- | --- |
| Amp | Includes AGENTS.md from the working directory and parents up to `$HOME`; subtree files are included when the agent reads a file there | [ampcode.com/docs/customize/agents-md](https://ampcode.com/docs/customize/agents-md) |
| Jules | "automatically looks for a file named AGENTS.md in the root of your repository" | [jules.google/docs](https://jules.google/docs) |
| Devin | Looks for the file before coding; includes up to 16 KiB from the start of each AGENTS.md | [docs.devin.ai/onboard-devin/agents-md](https://docs.devin.ai/onboard-devin/agents-md) |

No setup beyond the init step.

## Needs a setting (verified)
### Aider
Aider's docs describe loading convention files with `--read` or `read:`; they do not mention AGENTS.md, so load it explicitly.
```
aider --read AGENTS.md
```
or in `.aider.conf.yml`:
```yaml
read: AGENTS.md
```
Source: [aider.chat/docs/usage/conventions.html](https://aider.chat/docs/usage/conventions.html) (shows the pattern with `CONVENTIONS.md`).

## Generic fallback
For any tool without AGENTS.md support, paste or point its rules file at `.eqc/prompts/check.md` and `.eqc/prompts/fix.md`.

## Troubleshooting
- Agent ignores AGENTS.md → confirm the file is at the repo root with the eqc-kit managed block.
- Aider does not follow it → confirm `read: AGENTS.md` is set or you passed `--read AGENTS.md`.
- Tool not listed → check its docs; support was not verified here.

Last verified: 2026-09-29 · Sources: as linked in the tables above
