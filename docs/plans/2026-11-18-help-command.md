# Plan: Help command and /eqc-help
Status: Complete

## Goal / Done when / Non-goals
Goal: users can get help installing and using eqc-kit: from the CLI (`npx eqc-kit help`) and from their AI agent (`/eqc-help`, `eqc help` in AGENTS.md).
Done when: `help` / `help <cmd>` / `--help` print as contracted; install adds .eqc/prompts/help.md, .claude/skills/eqc-help/SKILL.md and the AGENTS.md `eqc help` row; init next steps mention help; update/uninstall handle the new files; tests cover these; `node --test` passes.
Non-goals: a remote pre-install prompt; agent running init/update/fix from help; Engine changes.

## Open questions
- [x] Wiring: every prompts/*.md is copied to .eqc/prompts/ (cli.mjs:141); Claude skills list at cli.mjs:151; AGENTS block table in adapters/agents-md/block.md. (orchestrator grep)
- [x] CLI today: USAGE one line (cli.mjs:14-15); `--help`/no cmd prints it (cli.mjs:424); no `help` subcommand. docs/ is NOT shipped in the npm package.
- [x] Q1 `eqc-kit help`: overview (quick start, every command + key flags, agent hint, docs URL); `help <cmd>` = that command's flags + example; `--help`/no cmd = overview. (user)
- [x] Q2 /eqc-help + `eqc help [question]`: follow .eqc/prompts/help.md — run doctor + engine status, then answer the question (or explain check→fix loop + one next step). Self-contained guide (docs/ not shipped). Read-only: never runs init/update/fix. (user)
- [x] Q3 Pre-install: CLI help works with nothing installed; init next-steps mention /eqc-help; README + getting-started "Getting help" with a paste-into-agent line. No remote prompt. (user)
- No new domain terms; no ADR (easily reversible).

## Contracts
MAP: none

CLI (bin/cli.mjs) — 1.1:
- `eqc-kit help` = `eqc-kit --help` = `eqc-kit` (no cmd) → OVERVIEW: title line `eqc-kit <ver> — …`; "Quick start" (init → eqc check → eqc fix, showing `/eqc-check` and `"eqc check"`); "Commands": init, update, doctor, hooks, uninstall, help [cmd], each one line + key flags; "In your agent: /eqc-help or \"eqc help\""; "Docs: https://github.com/mehedibangladeshi/eqc-kit#readme". Exit 0. Works with no .eqc/.
- `eqc-kit help <cmd>` → that command's purpose, its flags, one example. Unknown cmd → stderr "unknown command: X" + overview hint, exit non-zero.
- Unknown top-level cmd keeps current behaviour.
- Claude skill list (cli.mjs:151) adds 'eqc-help'. init "Next step" adds a help line (Claude Code: /eqc-help; AGENTS.md: 'eqc help').
Agent files:
- prompts/help.md (installed to .eqc/prompts/help.md automatically, cli.mjs:141) — tool-agnostic: never names a specific AI tool; refers to checks as "eqc check"/"eqc fix".
- adapters/claude-code/skills/eqc-help.md — same shape as eqc-check.md: name eqc-help, description triggering on /eqc-help or "how do I use/install/upgrade eqc-kit", managed marker line, "Follow `.eqc/prompts/help.md` exactly. Input = $ARGUMENTS."
- adapters/agents-md/block.md — row: `eqc help [question]` → `.eqc/prompts/help.md`.

## Waves
| # | Task | Tier | Files owned | Depends on | Acceptance |
|---|------|------|-------------|------------|------------|
| 1.1 | CLI help + install wiring | sonnet (A1 B1 R1) | bin/cli.mjs, test/cli.test.mjs, adapters/claude-code/skills/eqc-help.md, adapters/agents-md/block.md | — | help/--help/help <cmd>/unknown as contracted; init writes eqc-help skill + help.md + AGENTS row; uninstall removes them; node --test passes |
| 1.2 | Agent help prompt | sonnet (A1 B1 R1) | prompts/help.md | — (contract) | status step (doctor + report/rank) then answer; no-question path; self-contained guide (commands, files, upgrade, re-index, hooks/CI, troubleshooting); read-only; no AI-tool names |
| 1.3 | Docs | haiku (A0 B1 R0) | README.md, docs/commands.md, docs/getting-started.md, docs/agents/*.md, CHANGELOG.md | — (contract) | `help` documented; /eqc-help + `eqc help` in agent guides; "Getting help" section with paste-into-agent line; file counts updated; Unreleased entry |

Verify with: `node --test 2>&1 | tail -n 30` · `node bin/cli.mjs help` · `node engine/eqc.mjs selftest`

## Log
- 2026-11-18 GRILL started. MAP: none.
- Lock confirmed ("go"). Plan drafted.
- Preview approved ("go"). Baseline porcelain: `?? docs/plans/2026-11-18-help-command.md`
- Launched 1.1 (sonnet), 1.2 (sonnet), 1.3 (haiku).
- 1.2 done (sonnet): prompts/help.md 70 lines, naming test pass. Gap: omits `npx eqc-kit help` (1.1 adds it) — fix in VERIFY. Check migrate-by-hand advice vs troubleshooting.
- 1.1 done (sonnet): node --test 81/81; help/help <cmd>/unknown; skill + AGENTS row; init "Need help?" line.
- 1.3 done (haiku): docs updated, 6 agent guides, counts 14→16, naming pass. Left getting-started init Next-step block without help line.
- Wave 1 VERIFY launched: haiku verifier + sonnet reviewer (1.1, 1.2, 1.3 consistency).
- Wave 1 verifier: OUTSIDE-OWN none; node --test 81/81; selftest ok; naming 4/4.
- Wave 1 reviewer: 1.1 minors (USAGE lacks help; init flag column misaligned) → VERIFY fix 1.1 (3 lines). 1.2 minor (installer list lacks help) → VERIFY fix 1.2 (1 line). 1.3 blockers: file counts are 19 not 16 (also docs/configuration.md:141), commands.md help block shows old usage, getting-started Next-step lacks help line → retry 1.3 on haiku.
- 1.3 retry done (haiku): counts 19 from real temp install (same adapters in configuration.md example), real help/unknown output pasted, init Next-step help line added. Final verifier launched.
- Final verifier: OUTSIDE-OWN none; node --test 81/81; help ok; selftest ok.
- CLOSE: Complete. Actual mix: builders 1 haiku · 2 sonnet · 0 opus (+1 haiku retry of 1.3); support 2 haiku verifiers, 1 sonnet reviewer. Escalations: none. Retries: 1 (1.3 docs). VERIFY fixes: 1.1 (3 lines), 1.2 (1 line).
