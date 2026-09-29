---
name: eqc-fix
description: "Pick and fix the easiest EQC compliance gaps one rule at a time, behind approval gates (eqc-kit). Use when the user runs /eqc-fix, optionally with a rule ID or keyword, or asks to fix the next EQC gap."
---
<!-- eqc-kit:managed v1 — regenerate with npx eqc-kit update -->

# eqc-fix

Follow `.eqc/prompts/fix.md` exactly. Input = $ARGUMENTS.

Claude Code bindings:
- Plan medium/large rules by dispatching the `eqc-planner` subagent; implement by dispatching the `eqc-fixer` subagent, one rule (or chunk) at a time.
- Audit re-verification: dispatch the `eqc-audit` subagent.
{{cheap_model_note}}
- Ask the user questions with AskUserQuestion.
- Put temp files in the session scratchpad.
- Report path (from config): `{{report_path}}`.
