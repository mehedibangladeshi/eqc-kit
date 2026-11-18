# Plan: State migrations across eqc-kit versions
Status: Complete

## Goal / Done when / Non-goals
Goal: users can upgrade eqc-kit to a new version without losing their project state.
Done when: `eqc migrate` upgrades schema-1 state to 2 (baseline backfilled), with backup and restore on failure; `update` runs it; the engine refuses older or newer schemas; init stamps the current schema; tests cover all of these; docs updated.
Non-goals: downgrade migrations; migrating Managed files (manifest sync already handles them); lazy migration on read; per-file schemas.
ADR: 0005. CONTEXT.md: +State schema, +Migration.

## Open questions
- [x] State = .eqc/{config,rules,compliance,baseline,milestones}.json (+ plans/, standard/). Kit-owned files already handled by sha-manifest sync. (scout)
- [x] Upgrade today = `eqc-kit update` (cli.mjs:286-303): fills config defaults, stamps installed_version, no version branching. (scout)
- [x] Versioning: every state file has `schema: 1` except milestones.json (bare array); nothing reads it. 0.1→0.2 changed shapes without a bump. (scout)
- [x] Q1 Migrations run in `eqc-kit update` after engine sync; engine refuses on schema mismatch → "run update". (user)
- [x] Q2 One `state_schema` int in config.json covering all .eqc state; ordered migration list N→N+1; missing field = 1. (user)
- [x] Q1b Engine owns migration code: new `eqc migrate` cmd; `update` runs it after sync. Edge: engine copy kept (locally edited, --yes) → old engine; update must warn, not silently skip. (user)
- [x] Q3 Backup every .eqc/*.json to .eqc/tmp/backup-schema-<N>/ before migrating; any throw → restore + exit non-zero; keep backup after success. (user)
- [x] Q4 state_schema > engine's: every state-reading cmd + migrate exits non-zero "upgrade eqc-kit". state_schema < engine's: exit non-zero "run `eqc-kit update`" (except `migrate`). (user)
- [x] Q5 Ship migration 1→2: backfill baseline.json from compliance.json when missing (reuse updateBaseline), stamp state_schema: 2. (user)

## Contracts
MAP: none

Engine (engine/eqc.mjs) — owned by 1.1:
- `export const STATE_SCHEMA = 2;`
- `stateSchema(cfg)` → `cfg?.state_schema ?? 1`
- `MIGRATIONS` array; MIGRATIONS[i] migrates schema i+1 → i+2. [0] = backfill: if compliance.json exists and baseline.json missing → write baseline via existing updateBaseline.
- `eqc.mjs migrate`: no config.json → fail "run eqc-kit init". schema > STATE_SCHEMA → fail "upgrade eqc-kit". equal → print "state schema N, up to date", exit 0. lower → copy every .eqc/*.json to .eqc/tmp/backup-schema-<from>/, run steps in order, then write config.state_schema = STATE_SCHEMA. Any throw → delete .eqc/*.json not in backup, copy backup back, exit non-zero with the error. Backup kept on success.
- Schema gate in main() before every cmd except selftest, check-ids, migrate: config.json missing → no check; lower → fail "state schema N is older than this engine (M); run `npx eqc-kit update`"; higher → fail "state schema N is newer than this engine (M); upgrade eqc-kit".
Installer (bin/cli.mjs) — owned by 2.1:
- init stamps `state_schema: STATE_SCHEMA` (imported from engine/eqc.mjs). DEFAULTS never sets it; REQUIRED_KEYS unchanged.
- update: after sync, spawnSync `node .eqc/bin/eqc.mjs migrate` (cwd root); print its output; non-zero → update fails non-zero with the engine's stderr + hint that an edited/kept engine copy may be outdated.

## Waves
| # | Task | Tier | Files owned | Depends on | Acceptance |
|---|------|------|-------------|------------|------------|
| 1.1 | Engine: STATE_SCHEMA, migrate cmd, 1→2 backfill, backup/restore, schema gate | sonnet (A1 B1 R2; data migration) | engine/eqc.mjs, test/engine.test.mjs, test/fixtures/** | — | migrate 1→2 backfills baseline + stamps 2; corrupt compliance.json → restored, non-zero; gate refuses older/newer; existing tests pass |
| 1.2 | Docs: migrate cmd, update behaviour, troubleshooting, changelog | haiku (A0 B1 R0) | docs/engine-commands.md, docs/commands.md, docs/troubleshooting.md, CHANGELOG.md | — (contract) | migrate + gate messages documented; Unreleased changelog entry |
| 2.1 | Installer: init stamps schema, update runs migrate | sonnet (A1 B1 R1) | bin/cli.mjs, test/cli.test.mjs | 1.1 | init config has state_schema 2; update on schema-1 project with compliance → baseline.json + state_schema 2; failing migrate → update non-zero |

Verify with: `node --test 2>&1 | tail -n 30` · `node engine/eqc.mjs selftest`

## Log
- 2026-11-18 GRILL started. MAP: none.
- 2026-11-18 Preview approved ("go"). Baseline porcelain: ` M CONTEXT.md` · `?? docs/adr/0005-...md` · `?? docs/plans/2026-11-18-state-migrations.md`
- Launched 1.1 (sonnet, engine) and 1.2 (haiku, docs).
- Next: 2.1 (sonnet) brief = init stamps state_schema via `import { STATE_SCHEMA } from '../engine/eqc.mjs'`; update spawnSync migrate after sync; tests in test/cli.test.mjs.
- 1.2 done (haiku): 4 docs updated, no-internal-names pass. Follow-up: docs/configuration.md needs `state_schema` key → fold into 2.1 Own. Check backup path print format vs 1.1.
- 1.1 done (sonnet): engine 44/44, selftest ok. cli.test 2 fail (init lacks state_schema → gate) — expected, 2.1 fixes. Builder attempted `git stash` (outside allowlist), denied; no harm.
- Wave 1 VERIFY launched: haiku verifier (1.1, 1.2) + sonnet reviewer (1.1).
- Wave 1 verifier: OUTSIDE-OWN none; engine 44/44, selftest ok, no-internal-names 4/4. Awaiting reviewer for 1.1.
- Wave 1 reviewer (1.1): no blockers; 4 minor. VERIFY fix 1.1 (3 lines): clear stale backup dir before copy; reject non-integer/<1 state_schema. Deferred minors: unguarded restore failure (backup stays on disk), raw stack on corrupt config.json.
- Wave 1 verified. Launching 2.1 (sonnet) with docs/configuration.md added to Own.
- 2.1 done (sonnet): node --test 79/79, selftest ok. Wave 2 VERIFY launched: haiku verifier (full suite) + sonnet reviewer (2.1).
- Wave 2 verifier: OUTSIDE-OWN none; node --test 79/79; selftest ok. Awaiting reviewer (2.1).
- Wave 2 reviewer (2.1): no blockers. Minor `die` before finally: die throws Fail (cli.mjs:29), so finally runs — no issue. Optional: test for kept old engine hint.
- CLOSE: Complete. Actual mix: builders 1 haiku · 2 sonnet · 0 opus; support 2 haiku verifiers, 2 sonnet reviewers, 1 haiku scout. Escalations: none. Retries: none. VERIFY fixes: 1 (1.1, 3 lines).
