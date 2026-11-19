# Plan: Re-index follow-ups
Status: Complete

## Goal / Done when / Non-goals
Goal: close the gaps left by 2026-11-19-standard-update (commit 61d2093).
Done when: check-ids validates the new Index before it is installed; reindex regenerates the report whenever it rewrote state; stale verdicts never attach to added Rules; tests assert moved pairs in reindex stdout; docs show a real captured reindex output; `node --test` passes.
Non-goals: State schema change; new commands; changes to diffRules matching.

## Open questions
None asked — all decided from code (no user-facing trade-off):
- check-ids weakness → `check-ids <doc> [index-file]` validates `.eqc/tmp/rules.next.json` BEFORE reindex; nothing installed on mismatch.
- Baseline-only state → reindex calls writeReport whenever compliance or baseline existed. Stdout stays delta JSON only (agents parse it), so no report/html path lines.
- NEW bug found in review of cmdReindex (eqc.mjs ~L684): results whose id is in neither old nor new rules pass through; an orphan whose id matches an *added* Rule would wrongly count as that Rule's Verdict. Fix: when an old Index exists, carry only results for unchanged + moved ids (old ids in old rules); drop everything else.
- check.md minors: name `ids <id,id,...>` for grouping audit ids by tier; when `audit` is empty, still run the Guard section (reindex changed state).

## Contracts
MAP: none
- `check-ids <doc> [index-file]`: index-file defaults to `.eqc/rules.json`; same output/exit codes (missing doc/file → fail, mismatch → exit 1, NO_INDEX exit 2 only when defaulting and rules.json absent).
- `reindex`: unchanged CLI/stdout. Result carry: if old rules.json exists, keep result r only if r.id ∈ old rule ids and not changed/removed (rename moved); if no old rules.json, keep none... (no old index ⇒ no prior results meaningful; drop all). Report regenerated when prevCompliance || prevBaseline.

## Waves
| # | Task | Tier | Files owned | Depends on | Acceptance |
|---|------|------|-------------|------------|------------|
| 1.1 | Engine: check-ids index-file arg; reindex orphan-result fix; report regen in baseline-only state; tests (moved pairs in stdout, orphan not attached to added rule, baseline-only writes RULES.md, check-ids on next file) (A0 B1 R1) | sonnet | engine/eqc.mjs, test/engine.test.mjs | — | all listed tests exist; `node --test` passes |
| 1.2 | check.md Path D: index → `check-ids <doc> .eqc/tmp/rules.next.json` → reindex → audit; name `ids`; Guard on empty audit (A0 B0 R1) | haiku | prompts/check.md | — (contract) | order correct; prompt tests pass |
| 2.1 | Docs: engine-commands.md check-ids arg + reindex JSON captured from a real sandbox run; CHANGELOG Unreleased fix lines (A0 B1 R0) | haiku | docs/engine-commands.md, CHANGELOG.md | 1.1, 1.2 | JSON is real output; `node --test` passes |
Verify with: `node --test`

## Log
Baseline git status: clean (after 61d2093) + this plan file.
- Approved. W1 launched: 1.1 sonnet, 1.2 haiku.
- 1.2 done (haiku): check-ids on next file before reindex; ids grouping; Guard on empty audit. prompt tests 37/37. Awaiting 1.1.
- 1.1 done (sonnet): check-ids [index-file], carry drops ids not in old rules, report regen on prevCompliance||prevBaseline; 4 tests; node --test 90/90. Verifier+reviewer launched.
- W1 verifier: outside-own none; 90/90; 37/37. Awaiting reviewer.
- W1 review: no blockers. Minor accepted: baseline-only reindex drops level to recomputed-from-empty (state not produced by normal flow); malformed index-file w/o rules throws (exit 1). W1 verified. 2.1 haiku launched.
- 2.1 done (haiku): real captured reindex JSON in engine-commands.md, check-ids [index-file] documented, CHANGELOG ### Fixed. Final verifier launched.
- Final verify: outside-own none, 90/90, greps hit. W1 files still 60+/12- (2.1 didn't touch them). Complete. Mix: 1 sonnet · 2 haiku builders; no retries; 0 VERIFY fixes.
