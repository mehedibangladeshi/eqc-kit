# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Compliance baseline (`.eqc/baseline.json`): each merge protects Rules that pass and keeps the highest level reached. `eqc guard` exits 1 when a protected Rule regresses or the level drops; `reset` removes the baseline.
- Report sections: a `Baseline:` line, `## Regressions`, `## To reach <Tier>` (blocking Rules) and `## Not audited`.
- Claude Code: a managed "EQC compliance guard" block in `CLAUDE.md`. The `AGENTS.md` block carries the same guard rules.
- Code map: `/eqc-check` and `/eqc-fix` use an existing code map when it is fresh, skip a stale one with a refresh hint, and never build one.

### Changed
- `/eqc-check` prints the report verbatim and names Rules as `ID — title`; re-checks show `before → after`; after each merge it runs the guard and shows regressions.

## [0.1.0] - 2026-09-29

### Added
- `npx eqc-kit init | update | uninstall | doctor` — interactive or `--yes --config` setup, stack/CI/package-manager detection, managed files with hash manifest (edited files are never silently overwritten or removed).
- Zero-dependency Engine (`.eqc/bin/eqc.mjs`): doc-defined tiers, verdicts `pass | partial | fail | na`, compliance level maths (unaudited rules block a tier), ranked fix candidates, chunked plans, milestones, auto-regenerated report, `check-ids` index validation, `reset`.
- Harness-neutral Prompts: check, fix, index, audit, plan, fixer.
- Adapters: Claude Code (skills + subagents, optional cheaper model for mechanical chunks) and AGENTS.md (Codex, Cursor, Copilot, Gemini CLI, others).
- Example three-tier standard and full documentation.
