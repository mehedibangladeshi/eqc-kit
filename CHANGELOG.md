# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.0] - 2026-09-29

### Added
- `npx eqc-kit init | update | uninstall | doctor` — interactive or `--yes --config` setup, stack/CI/package-manager detection, managed files with hash manifest (edited files are never silently overwritten or removed).
- Zero-dependency Engine (`.eqc/bin/eqc.mjs`): doc-defined tiers, verdicts `pass | partial | fail | na`, compliance level maths (unaudited rules block a tier), ranked fix candidates, chunked plans, milestones, auto-regenerated report, `check-ids` index validation, `reset`.
- Harness-neutral Prompts: check, fix, index, audit, plan, fixer.
- Adapters: Claude Code (skills + subagents, optional cheaper model for mechanical chunks) and AGENTS.md (Codex, Cursor, Copilot, Gemini CLI, others).
- Example three-tier standard and full documentation.
