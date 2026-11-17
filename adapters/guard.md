Applies to every change: features, bug fixes, config or dependency changes, refactors, file moves.
Before writing code, read `.eqc/RULES.md` (every Rule with its current status) and follow each Rule that applies.
Rules listed under `protected` in `.eqc/baseline.json` (see {{report_path}}) are achieved and must stay passing.
Before finishing:
1. Run `node .eqc/bin/eqc.mjs verify` (runs the mechanical checks of passing Rules).
2. List the protected rules the change could affect (files, configs, scripts they cite as evidence).
3. Re-audit those with {{check_cmd}} <IDs>.
4. Run `node .eqc/bin/eqc.mjs guard`.
5. If `verify` or `guard` exits 1, fix the code until it passes. Never finish with a regression. Exit 2 means the Standard is not indexed yet.
Never edit or delete `.eqc/baseline.json`. Never weaken lint, test, CI or type-check settings, skip or delete tests, or relax thresholds to make a rule, `verify` or the guard pass.
If a change cannot comply with a Rule, or a protected rule truly must change, stop and ask the user.
