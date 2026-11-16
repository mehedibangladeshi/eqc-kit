# eqc audit — check a list of rules against the codebase and return verdicts with evidence.

Inputs: a list of rule IDs.
Outputs: ONLY a `{"results":[...]}` JSON object as the final reply. Change no project files. Return the JSON; the orchestrator (possibly you) writes it to a temp file for merge.

## Steps
1. Run `node .eqc/bin/eqc.mjs get <IDs>` (JSON `[{rule, compliance}]`). Audit exactly those rules. Prior evidence is a pointer: verify it, do not trust it blindly or re-derive from scratch. On a first audit `get` returns no prior compliance; that is expected.
2. Per rule, investigate read-only: read files, grep, run read-only commands (lint/test scripts, `cat`, configs). Do not install dependencies or run commands with side effects. If a check cannot run for that reason, write "not run: <reason>" in the evidence and judge from config/code. Use `detection_hint` as a start, then verify directly. If the rule has a `verify` command, run it and cite its result; a non-zero exit means not `pass` (unless it is clearly broken, then say so in `notes`).
   If the brief has a `MAP:` line other than `none`, explore with the map first per "Using the map" in `.eqc/prompts/codemap.md`, then verify in source; otherwise grep/read as before.
3. Verdict:
   - `pass`: requirement met across the codebase, not one sampled file. Needs concrete evidence.
   - `fail`: clearly not met.
   - `partial`: met inconsistently or partly; say what is missing.
   - `na`: the rule does not apply to this project (e.g. DB migrations in a service with no database). Use only when the project demonstrably lacks the thing the rule governs, and cite the evidence (e.g. "no DB dependency, no SQL/ORM files"). Never use it to dodge a hard rule; if unsure, use `fail`/`partial`.
   Be strict. A config file existing is not proof it runs clean. If the project's own docs flag a tool as broken, do not pass the rule on it. No evidence -> not pass.
4. Evidence: at most 2 sentences plus file paths (with `:line` where it points at one spot), or a command and its output. "Looks fine" is not acceptable.
5. ONLY for `fail`/`partial`, also compute (from evidence already in hand; do no extra scanning):
   - `file_count`: distinct files that must change. Files, not occurrences.
   - `effort_tier`: `trivial` (1 file / config) · `small` (2-5) · `medium` (6-30) · `large` (30+ files). Sized by `file_count` only, except an architecture change is always `large`. A new package does not force `large`; the `package-install` blast radius already gates it.
   - `blast_radius`: array of only applicable tags (may be `[]`):
     - `ci-config`: fix touches CI/pipeline files (paths from `config get ci_paths`).
     - `package-install`: fix adds/removes/upgrades a dependency (manifests/lockfiles of `config get package_manager`). Regenerating a lockfile without dependency changes is not package-install.
     - `architecture`: fix changes an already-standardised pattern (framework, state management, HTTP/network client, ORM/data layer, routing/navigation) rather than working within it.
     - `large-sweep`: many files for one mechanical reason (flag for diff size).
   These tags alone decide whether a fix needs user approval. Do not under- or over-tag.
6. Omit `file_count`/`effort_tier`/`blast_radius` for `pass` and `na`.

## Output (nothing else, no preamble)
```json
{"results":[{"id":"BRONZE-1","status":"pass|fail|partial|na","evidence":"...","notes":"only if fail/partial","file_count":12,"effort_tier":"small","blast_radius":["package-install"]}]}
```
One entry per given ID.
