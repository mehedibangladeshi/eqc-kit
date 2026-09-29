# eqc audit — check a list of rules against the codebase and return verdicts with evidence.

Inputs: a list of rule IDs.
Outputs: ONLY a `{"results":[...]}` JSON object as the final reply. Write no files. Change no code.

## Steps
1. Run `node .eqc/bin/eqc.mjs get <IDs>` (JSON `[{rule, compliance}]`). Audit exactly those rules. Prior evidence is a pointer: verify it, do not trust it blindly or re-derive from scratch.
2. Per rule, investigate read-only: read files, grep, run read-only commands (lint/test scripts, `cat`, configs). Use `detection_hint` as a start, then verify directly.
3. Verdict:
   - `pass`: requirement met across the codebase, not one sampled file. Needs concrete evidence.
   - `fail`: clearly not met.
   - `partial`: met inconsistently or partly; say what is missing.
   Be strict. A config file existing is not proof it runs clean. If the project's own docs flag a tool as broken, do not pass the rule on it. No evidence -> not pass.
4. Evidence: at most 2 sentences plus file paths (with `:line` where it points at one spot), or a command and its output. "Looks fine" is not acceptable.
5. ONLY for `fail`/`partial`, also compute (from evidence already in hand; do no extra scanning):
   - `file_count`: distinct files that must change. Files, not occurrences.
   - `effort_tier`: `trivial` (1 file / config) · `small` (2-5) · `medium` (6-30) · `large` (30+ files, OR needs a new package, OR an architecture change regardless of count).
   - `blast_radius`: array of only applicable tags (may be `[]`):
     - `ci-config`: fix touches CI/pipeline files (paths from `config get ci_paths`).
     - `package-install`: fix adds/removes/upgrades a dependency (would change the package manager lockfile).
     - `architecture`: fix changes an already-standardised pattern (framework, state management, HTTP/network client, ORM/data layer, routing/navigation) rather than working within it.
     - `large-sweep`: many files for one mechanical reason (flag for diff size).
   These tags alone decide whether a fix needs user approval. Do not under- or over-tag.
6. Omit `file_count`/`effort_tier`/`blast_radius` for `pass`.

## Output (nothing else, no preamble)
```json
{"results":[{"id":"BRONZE-1","status":"pass|fail|partial","evidence":"...","notes":"only if fail/partial","file_count":12,"effort_tier":"small","blast_radius":["package-install"]}]}
```
One entry per given ID.
