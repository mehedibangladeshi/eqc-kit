# The Engine runs Verify commands, but still never judges prose Rules

To stop new code from breaking Rules between Audits, a Rule in `rules.json` may carry a `verify` shell command, and `eqc.mjs verify` runs it for passing Rules from git hooks and CI. This bends ADR 0002's "the Engine never reads code": the Engine now executes commands, but it still never interprets a Rule. The command decides, and the agent wrote it at index time. Only passing Rules are run, so a known fail never blocks a commit; only a regression does.

`rules.json` is committed and reviewed like `package.json` scripts, which carry the same trust: anyone who can change it can make hooks and CI run a command. Hooks are opt-in per clone (`npx eqc-kit hooks`), in line with ADR 0001.

## Considered options

- Run the agent (an LLM Audit) in pre-commit: rejected as slow, costly and nondeterministic, and it needs agent credentials on every machine and in CI.
- Generate native linter configs (ESLint, ruff) from Rules: rejected because a per-language mapping breaks tool-agnosticism. A `verify` command can call the project's own linter instead.
- Gate only on `compliance.json` (`gate`): kept, but on its own it is only as fresh as the last Audit and never looks at new code.
