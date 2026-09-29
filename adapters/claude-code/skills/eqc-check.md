---
name: eqc-check
description: "Check this project's compliance level against its engineering quality standard (eqc-kit). Use when the user runs /eqc-check, optionally with recheck, full, a tier or rule IDs, or a standard doc path, or asks what the EQC/compliance level is."
---
<!-- eqc-kit:managed v1 — regenerate with npx eqc-kit update -->

# eqc-check

Follow `.eqc/prompts/check.md` exactly. Input = $ARGUMENTS.

Claude Code bindings:
- Run audits in parallel: dispatch the `eqc-audit` subagent once per tier line, all in a single message.
- Build the index by dispatching the `eqc-index` subagent.
- Ask the user questions with AskUserQuestion.
- Put temp files in the session scratchpad.
- Report path (from config): `{{report_path}}`.
