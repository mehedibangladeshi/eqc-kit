# Plan: Code-map exploration, readable check report, compliance guardrails
Status: Complete
## Goal / Done when / Non-goals
1. Workflow uses a code map (codemapper / code graph / graphify) when present during exploration, after verifying it is up to date.
2. `/eqc-check` report names every missing compliance by ID + title, not just IDs/chart.
3. Guardrail: once a compliance is achieved, later work (features, fixes, config, refactor, reorg) must not regress it.
## Open questions
## Contracts
MAP: none (no graphify-out/, code-graph index dirs, or graph MCP tools in repo; checked 2026-11-16)
## Waves
Rough split: T1 map-aware exploration (prompts) · T2 check report ID+title · T3 regression guardrail (baseline + gate)
## Log
- [x] Q1 map tools → generic detection (graphify-out/+CLI, other index dirs, graph MCP tools) AND grep project CLAUDE.md/AGENTS.md for a named code mapper; verify freshness vs last commit; fall back to grep.
- Scout: report already lists fails/partials as `ID — title` (eqc.mjs:274-276); unaudited only a count; check.md path C before/after + closing blocker line have no titles. No guardrail/baseline in engine; docs/ci.md plans `report --check-tier`. Adapter claude-code writes no CLAUDE.md block.
- [x] Q2 missing list → "To reach <next tier>" blocker section (fail + unaudited, ID — title — status), full Unaudited list with titles, every rule mention in /eqc-check output as `ID — title`, report printed verbatim.
- [x] Q3 guardrail → baseline.json ratchet + `eqc guard` (exit 1 on regression) + CLAUDE.md/AGENTS.md managed guard blocks. No Stop hook.
- [x] Q4 stale map → never refresh; skip stale map, tell user to refresh with its update command; fall back to grep.
- Settled (orchestrator): pass→na is not a regression; baselined IDs absent from index are ignored; `reset` deletes baseline.json; baseline.json is committed (not in .eqc/.gitignore); no escape hatch beyond hand-deleting baseline.json (documented); map detection runs once per /eqc-check|/eqc-fix run in check.md/fix.md, sub-agents get a MAP line.

### Contracts (detail)
C1 `.eqc/baseline.json`: `{schema:1, standard_version, level, updated_at, protected:[ruleId...]}`. Written by `merge`: protected = prev ∪ ids now pass; level = higher of prev and current by tier order (HARD_FAIL/NONE rank below every tier). Created on first merge.
C2 `eqc guard`: no index → exit 2 (existing). No baseline → prints `guard: no baseline yet` exit 0. OK → `guard: ok · baseline <level> · <n> protected rules` exit 0. Regression → `guard: REGRESSION` then `- <ID> — <title> — now <status|not audited>` per regressed rule and `- level <current> below baseline <level>` if dropped; exit 1. Export pure `findRegressions(rulesDoc, compliance, baseline)` → `{rules:[{id,title,status}], levelDrop:{current,baseline}|null}` and `updateBaseline(prev, rulesDoc, compliance, nowIso)`.
C3 buildReport adds (after tier table): `Baseline: <level> · <n> protected · guard: ok | <k> regressions` line when baseline exists (buildReport gets optional 3rd arg baseline); `## To reach <next tier>` listing blockers in tiers ≤ next tier: `- **ID** — title — fail|not audited` (omit when top tier reached); `## Not audited` listing every unaudited rule `- **ID** — title`. Existing Fails/Partials/N/A sections unchanged.
C4 merge also prints `baseline: <level> · <n> protected` and, if regressions, `guard: <k> regressions — run eqc guard`.
C5 Prompt MAP line (from new prompts/codemap.md): `MAP: <tool> — <allowed commands/tools> (fresh)` or `MAP: none (<reason>)`.
C6 Managed blocks: CLAUDE.md key `CLAUDE.md#eqc-kit` (claude-code adapter), same markers as AGENTS.md; both contain the guard rules text.

## Waves
W1: 1.1 opus engine · 1.2 sonnet prompts · 1.3 sonnet adapters/cli   W2: 2.1 haiku docs
## Log
- Approved 2026-11-16 ("ok go"). Baseline porcelain: ` M CONTEXT.md`, `?? docs/plans/`
- C7: shared guard rules text lives in adapters/guard.md (owned by 1.3), injected into both managed blocks.
- W1 launched: 1.1 opus (engine), 1.2 sonnet (prompts), 1.3 sonnet (adapters/cli)
- Next: verifier (haiku) + reviewer (sonnet) over W1; then 2.1 haiku docs (docs/engine-commands.md, ci.md, concepts.md, commands.md, CHANGELOG.md, README.md) using builders' exact output formats.
- 1.2 reported partial: prompts done; npm test failing in cli tests (in-flight 1.3 edits). Recheck at verify.
- 1.3 done: CLAUDE.md#eqc-kit block, adapters/guard.md single-source, npm test 56/56 (at its time).
- 1.1 done (opus): 60/60 tests, selftest ok. Levels printed as raw tier ids. W1 → verify.
- W1 verifier: OUTSIDE-OWN none; npm test 60/60; selftest ok; e2e init writes CLAUDE.md guard block. Awaiting reviewer.
- VERIFY fix 1.2 (2 lines): fixer.md step 6 clarified; codemap.md stale → MAP: none. Reviewer: no blockers. W1 verified.
- W2 launched: 2.1 haiku docs.
- 2.1 done: docs updated, npm test 60/60. Report example hand-written → final verifier checks formats against real engine run.
- Final verifier: OUTSIDE-OWN none; npm test 60/60; selftest ok; e2e engine run matches doc formats except Baseline case.
- VERIFY fix 2.1 (1 line): docs/engine-commands.md:144 Bronze→BRONZE. (merge "· N rules not audited" suffix is pre-existing and correctly omitted in the fully-audited example.)
- Complete. Actual mix: 1 opus · 2 sonnet · 1 haiku builders; verifiers haiku ×2, reviewer sonnet ×1, scout sonnet ×1. No escalations.
