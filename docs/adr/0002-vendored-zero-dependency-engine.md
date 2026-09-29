# Engine is a vendored, zero-dependency single file

The Engine (the script that owns `rules.json`, `compliance.json`, `milestones.json`, plans and all tier maths) is one stdlib-only ESM file that the Installer copies to `.eqc/bin/eqc.mjs` and the project commits. Prompts call `node .eqc/bin/eqc.mjs <cmd>`. This works in any-language repo with only Node >=18 on PATH, needs no network per call, pins one version per repo so teammates agree, and adds no supply-chain surface. `npx eqc-kit update` refreshes it.

## Considered options

- `npx eqc-kit <cmd>` on every call — rejected: latency, network, version drift between teammates.
- devDependency — rejected: excludes repos without `package.json`.
