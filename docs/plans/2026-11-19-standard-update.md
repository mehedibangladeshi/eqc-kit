# Plan: Update the Standard without a full re-audit
Status: Complete

## Goal / Done when / Non-goals
Goal: when the Standard doc changes, re-index it and carry existing Verdicts over; only new/changed Rules need auditing. No full re-audit.

## Open questions
Scout facts: index.md rebuilds rules.json from scratch (agent); no doc/rule hash anywhere; check.md Path D = reset+index+full audit (loses verdicts AND baseline); merge keys by id, tolerates orphans; audit.md already audits an ID subset; baseline never shrinks, ignores missing ids.
- [x] Q1 → `eqc check <path>` keeps Verdicts by default (re-index → diff → audit added/changed only); `eqc reset` stays for full redo.
- [x] Q2 → match order: (1) same id + same content = unchanged; (2) same content, same tier, different id = moved (verdict follows); (3) same id, different content = changed; rest = added/removed. Content = title+detail+tier+applies_to+verify. (Order handles insert-shift: old B-4 text A → new B-5 text A is moved, not changed.)
- [x] Q3 → changed: drop verdict + unprotect; removed: drop verdict + unprotect; moved: rename id in verdicts + baseline.
- [x] Q4 → Re-index sets Baseline level to the recomputed level after carry-over (may lower); merges ratchet up as before. ADR 0006.
Docs touched in grill: CONTEXT.md (Re-index, Rule delta, Baseline note), docs/adr/0006-reindex-carries-verdicts.md.
- [x] Q5 (decided, ADR 0002 engine owns state) → engine computes the diff. Index agent writes `.eqc/tmp/rules.next.json` (tmp/ is gitignored, so an interrupted run never gets committed); new engine cmd `eqc reindex <file>` diffs vs rules.json, applies carry-over, installs it as rules.json, prints delta JSON incl. IDs to audit. Content compared on the fly → no rules.json field, no State schema bump.

## Contracts
MAP: none
Lock confirmed by user 2026-11-19 (scenario walkthrough + goal → "ok").

`eqc reindex <next.json>` (engine/eqc.mjs, schema-gated like merge):
- Validate next (tiers[], rules[] with id/tier/title); invalid → exit 1, no state touched.
- No current rules.json → install next, delta = all added.
- Content key = JSON of {title, detail, tier, applies_to, verify}. Match order: (1) same id + same content → unchanged; (2) remaining old/new pairs with same content (same tier implied), paired in order → moved; (3) remaining same id → changed; rest → added / removed.
- compliance.json (if present): drop results for changed+removed; rename id for moved; recompute tier_summary/current_tier against next; standard_version = next.standard.version.
- baseline.json (if present): protected −= changed+removed, rename moved; level = recomputed current level (may lower); standard_version updated.
- Write next as .eqc/rules.json, delete next file, regenerate report (as merge does).
- stdout JSON: {"unchanged":[ids],"moved":[{"from","to"}],"changed":[ids],"added":[ids],"removed":[ids],"audit":[added+changed, in next-rules order]}. Exit 0.
- Pure fn exported for tests: `diffRules(oldRules, newRules)` → the same object minus side effects.

Prompts: index.md always writes `.eqc/tmp/rules.next.json` (tmp/ is gitignored, so an interrupted run never gets committed) (still from scratch, never reads old); check.md calls `eqc reindex .eqc/tmp/rules.next.json` after every index run; edited-Standard path (Path D) = copy doc as today → index → reindex → check-ids → audit `audit` IDs (if any) → merge. First-time index uses the same steps (delta all added → full audit). `eqc reset` remains the full redo.

## Waves
| # | Task | Tier | Files owned | Depends on | Acceptance |
|---|------|------|-------------|------------|------------|
| 1.1 | Engine `reindex` + `diffRules` + tests (A1 B1 R2) | sonnet | engine/eqc.mjs, test/engine.test.mjs, test/fixtures/** | — | all 5 delta classes + first run + insert-shift + invalid input tested; compliance/baseline carry-over tested; `node --test` passes |
| 1.2 | Prompts: index→rules.next.json, check.md re-index path, help.md (A1 B1 R1) | sonnet | prompts/index.md, prompts/check.md, prompts/help.md | — (contract) | every index run followed by reindex; Path D audits only `audit` IDs; help text describes keep-verdicts + `eqc reset`; no-internal-names test passes |
| 2.1 | User docs + changelog (A0 B1 R0) | haiku | docs/commands.md, docs/engine-commands.md, docs/concepts.md, CHANGELOG.md, README.md | 1.1, 1.2 | reindex documented (summary row + section, exit codes); edited-Standard flow described; Unreleased changelog entry |
Verify with: `node --test` (npm test)

## Log
Baseline git status: M CONTEXT.md · ?? docs/adr/0006-reindex-carries-verdicts.md · ?? docs/plans/2026-11-19-standard-update.md
- Preview approved by user. Contract tweak: next file at .eqc/tmp/rules.next.json.
- W1 launched: 1.1 sonnet (engine reindex), 1.2 sonnet (prompts). Next: verifier haiku + sonnet reviewer for W1; then 2.1 haiku docs (commands.md, engine-commands.md, concepts.md, CHANGELOG Unreleased, README) using final reindex JSON + Path D steps from reports.
- 1.2 done: Path D = resolve source → index → reindex (exit1 stop) → check-ids → audit 'audit' ids → merge → report delta. 37 pass. Awaiting 1.1.
- 1.1 done: cmdReindex eqc.mjs L664-698, stdout one-line JSON, stderr+exit1 on invalid, report regen only if compliance existed, baseline level from recomputed current_tier. node --test 86 pass. W1 verifier (haiku) + reviewer (sonnet) launched.
- W1 verifier: outside-own none; node --test 86/86; prompt tests 37/37. Awaiting reviewer.
- W1 review: no blockers. Minors accepted as follow-ups: report not regenerated in baseline-only state; reindex CLI test doesn't assert moved in stdout; check-ids after reindex leaves new index installed on failure (same as old reset-first). Orphan results harmless (buildTierSummary iterates rules). W1 verified. 2.1 haiku launched.
- 2.1 done: reindex row+section in engine-commands.md, Re-index section in concepts.md, Editing the Standard section in commands.md, CHANGELOG Unreleased; README unchanged; fixed stale reset claim. Final verifier (haiku) launched.
- Final verify: outside-own none, node --test 86/86, concepts.md has ## Re-index. Complete. Actual mix: 1 haiku builder · 2 sonnet builders · 0 opus; no retries/escalations; 0 VERIFY fixes.
