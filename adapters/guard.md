Applies to every change: features, bug fixes, config or dependency changes, refactors, file moves.
Rules listed under `protected` in `.eqc/baseline.json` (see {{report_path}}) are achieved and must stay passing.
Before finishing:
1. List the protected rules the change could affect (files, configs, scripts they cite as evidence).
2. Re-audit those with {{check_cmd}} <IDs>.
3. Run `node .eqc/bin/eqc.mjs guard`.
4. If it exits 1, fix the code until it passes. Never finish with a regression.
Never edit or delete `.eqc/baseline.json`. Never weaken lint, test, CI or type-check settings, skip or delete tests, or relax thresholds to make a rule or the guard pass.
If a protected rule truly must change, stop and ask the user.
