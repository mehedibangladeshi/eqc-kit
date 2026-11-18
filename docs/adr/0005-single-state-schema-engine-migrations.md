# One State schema for all of `.eqc/`, migrated by the Engine during `update`

Users must be able to upgrade eqc-kit without losing Verdicts, the Baseline, Milestones or config. `.eqc/config.json` carries one integer, `state_schema` (missing means 1), naming the format of every state file together. A Migration is one ordered step N→N+1 that may touch any file. Migrations live in the Engine (`eqc.mjs migrate`), because the Engine owns all state files; the Installer's `update` only triggers them after syncing the new Engine. Before migrating, the Engine copies every `.eqc/*.json` to `.eqc/tmp/backup-schema-<N>/` and restores it if any step throws.

Any other Engine command that reads state refuses to run on a mismatch: an older schema says to run `eqc-kit update`, and a newer one says to upgrade eqc-kit. Old code never misreads or overwrites new state, at the cost of failing git hooks for a teammate on an older kit until they upgrade.

## Considered options

- Per-file `schema` integers: rejected because Migrations that span files (such as building the Baseline from `compliance.json`) get awkward, and `milestones.json` is a bare array.
- Keying on the kit's semver (`installed_version`): rejected because it ties the state format to release numbers, so every release would need checking even when no format changed.
- Lazy migration on every Engine read: rejected because it runs migration code on every command, including from git hooks, and it can partially rewrite state outside an explicit upgrade.
- Migration code in the Installer: rejected because it would split ownership of state between two programs.
