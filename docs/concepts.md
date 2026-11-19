# Concepts

eqc-kit helps you and your AI coding agent raise a project's compliance with a written quality standard. This page is the mental model. Every term here is used the same way across the rest of the docs.

## The loop

```
Standard --> Index --> Audit --> Verdicts --> Compliance level
   ^                                               |
   |                                               v
   +------ (edit the doc, re-index)     Fix --> re-Audit --> ...
```

1. You supply a **Standard**: a Markdown document of tiers and numbered rules.
2. The agent turns it into an **Index** (`.eqc/rules.json`).
3. The agent **Audits** rules against your code and records a **Verdict** for each, with evidence.
4. The **Engine** computes the **Compliance level** from the Verdicts.
5. The agent **Fixes** failing rules, one at a time, and re-audits them. The level goes up.
6. Between Audits, **guardrails** keep the level from slipping: agents read the Rule digest (`.eqc/RULES.md`) before writing code, and `verify` (run by git hooks and CI) re-runs the **Verify commands** of passing Rules.

## Division of labor

| Who | Does | Never does |
|---|---|---|
| The **Engine** (`.eqc/bin/eqc.mjs`) | Stores state, validates input, merges Verdicts, computes the Compliance level, ranks fixes, writes the report and Rule digest, runs Verify commands the Index defines | Judge your code against prose Rules |
| The **agent**, following **Prompts** (`.eqc/prompts/*.md`) | Reads the Standard, inspects code, decides pass/partial/fail, writes fixes | Compute the level or hand-edit state files |

The split keeps the maths reproducible: two teammates with the same Verdicts always get the same level. It also keeps the judgment where an AI agent is useful. See [engine-commands.md](engine-commands.md) for the Engine.

## The terms

**Standard.** Your document. Example: `standards/example.md`, with Bronze, Silver and Gold sections. See [writing-a-standard.md](writing-a-standard.md).

**Tier.** One ordered section of the Standard, lowest first. The Standard names them (Bronze/Silver/Gold, L1-L3, anything). 2 to 5 tiers is normal.

**Rule.** A numbered entry in a Tier. Its ID is `<TIERID>-<number printed in the doc>`: `SILVER-2` is entry `2.` under the Silver heading. IDs are never renumbered.

**Applicability tag.** A stack label such as `[web]` or `[backend]` on a Rule. At Index time, Rules whose tags do not match your project's stack are left out. `[all]` or no tag means every project.

**Index.** `.eqc/rules.json`: every Rule with its ID, Tier, tags, detail and the line it came from.

**Audit.** The agent evaluates a list of Rules against the codebase.

**Verdict.** The result for one Rule, with evidence:

| Verdict | Meaning |
|---|---|
| `pass` | Fully met across the codebase |
| `partial` | Met in some places or in part |
| `fail` | Not met |
| `na` | Rule does not apply to this project (e.g. DB migrations in a service with no database). The evidence must say why. Never a fail, and skipped by `rank` and `ids recheck` |

Example: `{"id":"BRONZE-6","status":"partial","evidence":"npm audit runs in CI but only warns."}`.

**Compliance level.** The highest Tier reached. See below.

**Effort tier, Blast radius, Gate.** How big a fix is, how far it reaches, and when to stop and ask. See below.

**Plan and Chunk.** A reviewable, resumable fix for a big Rule. See below.

**Milestone.** A log entry for a finished fix attempt.

**Prompt.** A Markdown playbook the agent follows. They never name a specific AI tool.

## How the Compliance level is computed

Rules:

- Count `fail` Verdicts per Tier. Partials and `na` do not count.
- If the lowest Tier has any fail, the level is `HARD_FAIL`.
- Otherwise the level is the highest Tier reached. A Tier is reached when every Rule in it and in every Tier below it has a Verdict and none is a fail. `partial` and `na` do not block; unaudited Rules do.
- If the lowest Tier has no fail but is not fully audited, the level is `NONE`, reported as "not reached — N rules not audited". `merge` and the report show the unaudited count whenever it is above 0.

Worked example, using the example Standard after a real, complete audit (all 17 Rules have a Verdict) (from the [engine-commands](engine-commands.md) walkthrough):

| Tier | Pass | Partial | Fail | N/A | Total |
|---|---|---|---|---|---|
| Bronze | 5 | 1 | 0 | 0 | 6 |
| Silver | 4 | 0 | 2 | 0 | 6 |
| Gold | 4 | 0 | 1 | 0 | 5 |

- Bronze has 0 fails, so it is reached. The one partial does not block it.
- Silver has 2 fails, so it is not reached.
- Gold has 1 fail, but that does not matter: Silver already stopped the climb.
- Level: **Bronze**. Fixing `SILVER-2` and `SILVER-3` would reach Silver. Gold is then blocked only by `GOLD-1`.

HARD_FAIL case: if `BRONZE-1` is re-audited as `fail`, Bronze has a fail. The lowest Tier is broken, so nothing is reached, whatever Silver and Gold say. The Engine prints `level: HARD_FAIL` and the report shows `Compliance level: HARD_FAIL`.

## Effort tier, Blast radius and Gates

For each `fail` or `partial` Verdict the auditor adds:

- `file_count`: distinct files that must change.
- `effort_tier`: `trivial` (1 file or config), `small` (2-5 files), `medium` (6-30), `large` (30+ files, or a new package, or an architecture change).
- `blast_radius`: zero or more tags.

| Blast radius tag | Meaning | Gate |
|---|---|---|
| `ci-config` | Fix touches CI/pipeline files | Asks for approval if `gates.ci_config` is true |
| `package-install` | Fix adds, removes or upgrades a dependency | Asks if `gates.package_install` is true |
| `architecture` | Fix changes an already-standardised pattern (framework, state library, HTTP client, ORM, routing) | Asks if `gates.architecture` is true |
| `large-sweep` | Many files, one mechanical reason | Never gates; the file count is stated up front |

Also: a Rule in the highest Tier asks for approval if `gates.top_tier` is true. The Gates come from `.eqc/config.json`; read one with `config get`.

The effort tier also picks the route. `trivial` and `small` are fixed in a single pass. `medium` and `large` get a Plan and are fixed Chunk by Chunk. A fix that needs a package change or a new architecture is never done silently: it ends `BLOCKED` until you decide.

## Plans and Chunks

A Plan lives at `.eqc/plans/<ID>.md`. The planner reads code, never edits it, and writes:

```
# SILVER-3 — Structured logging, no stray debug prints
verify: grep -rn "console\.log" src | wc -l   (must print 0)
approach: Replace console.log with the logger wrapper in src/lib/logger.js.
recipe: console.log(x) -> logger.debug(x). Keep genuinely dynamic CLI output in scripts/ as is.
## Chunks
- [x] 1 [mechanical] src/api/a.js, src/api/b.js
- [ ] 2 [mechanical] src/ui/c.js, src/ui/d.js
- [ ] 3 [judgment] src/server.js
```

- `verify` is one command whose output proves the whole Rule is met.
- A Chunk is at most about 8 files from the same folder, and leaves the project working.
- `mechanical` means the recipe applies with no per-file decisions. `judgment` needs thought. Mechanical Chunks come first.
- The fixer ticks `[x]` when a Chunk succeeds. `chunks <ID>` reads the boxes, so a Plan can be stopped and resumed at the next unticked Chunk.

You may edit a Plan before approving it.

## Milestones

Each fix attempt ends with a Milestone in `.eqc/milestones.json`: rule, tier, date, one-line summary and status `done`, `partial`, `blocked` or `failed`. It is a history log. A rebuild from a new Standard keeps it.

## Re-index

When you edit the Standard, run `eqc check <path>` again. The agent builds a fresh Index from the edited Standard, and the Engine compares it with the current one into a **Rule delta**. Each Rule is:

- **unchanged**: same ID and same content. Keeps its Verdict and protection.
- **moved**: same content and Tier under a new ID, for example after a renumbering. Keeps its Verdict and protection under the new ID.
- **changed**: same ID, new title, detail, Tier, tags or verify command. Loses its Verdict and protection, and is audited again.
- **added**: a new Rule. Audited.
- **removed**: no longer in the Standard. Loses its Verdict and protection.

Only added and changed Rules are audited. A Re-index does not reset anything. A pass recorded against old wording proves nothing about the new wording, which is why changed Rules start again.

A Re-index sets the Baseline level to the Compliance level recomputed after carry-over, so it can go down. That is intended: when the Standard raises the bar, a lower level is not a Regression, and a strict ratchet would fail every hook and CI run until the new Rules were fixed. Later merges ratchet up again.

For a full rebuild, run `eqc reset` and then `eqc check <path>`. If a Re-index is interrupted, `eqc check recheck` finishes the Rules that have no Verdict.

## Baseline and guard

The **baseline** (`.eqc/baseline.json`) is a ratchet. Each merge records the Compliance level and every Rule that has passed so far, as the protected Rules. A protected Rule stays protected if a later audit marks it partial or fail, and the level in the baseline never goes down, except on a Re-index (see above).

The **guard** (`eqc guard`) compares the current Verdicts with the baseline. It fails when a protected Rule is now `fail`, `partial` or unaudited, or when the level drops below the baseline. `na` is not a regression. The guard checks recorded Verdicts; it does not audit, so re-audit the affected Rules first. Apart from a Re-index, the only way to lower the baseline is to delete the file by hand, which is a deliberate decision.

The agent is told to follow the same loop for any development work: re-audit affected protected Rules, run the guard, and never finish with a regression. Claude Code gets this as a managed block in `CLAUDE.md` when that file exists; otherwise it, like other agents, reads it in the `AGENTS.md` block. In CI, the guard is a single command; see [ci.md](ci.md#verify-and-guard-in-ci).

## Code map

If the project has a code map, `/eqc-check` and `/eqc-fix` use it to find related code. A map is a code-graph index (for example `graphify-out/graph.json`, or `.codegraph/`, `.gitnexus/` or `.serena/`), or a code mapper that the project's `CLAUDE.md` or `AGENTS.md` names. Each run checks the map once for freshness (its file time against the last commit and uncommitted changes) and uses it only when it is fresh. The agent confirms map facts in source. A stale map is skipped with a one-line hint to refresh it, such as `graphify update .`. The agent never builds or refreshes the map itself.

## What lives in `.eqc/`

| Path | What | Commit? |
|---|---|---|
| `bin/eqc.mjs` | The Engine, one file, Node 18+, no dependencies | Yes |
| `prompts/` | The Prompts | Yes |
| `config.json` | Report path, stack tags, Gates, `state_schema` (format of all `.eqc/` state) | Yes |
| `rules.json` | The Index | Yes |
| `compliance.json` | Latest Verdict per Rule, tier summary, level | Yes |
| `baseline.json` | Protected Rules and the highest level reached, read by `guard` | Yes |
| `milestones.json` | Fix history | Yes |
| `plans/` | Plans and Chunk progress | Yes |
| `RULES.md` | Rule digest agents read before writing code (regenerated by `merge`) | Yes |
| `hooks/` | `pre-commit` and `pre-push` scripts (enable with `npx eqc-kit hooks`) | Yes |
| `doc-meta.md` | Notes from indexing (version, skipped rules, conflicts) | Yes |
| `tmp/` | Scratch files (audit output waiting to be merged, pre-migration backups in `backup-schema-N/`) | No, ignore it |

Commit everything except `.eqc/tmp/`. Teammates then share the same Engine version, Index and Verdicts. The human-readable report is written to the path in `config.json` (`report_path`), with an HTML page beside it (`.html`), and both are regenerated by `merge`; do not edit them by hand.
