<!-- eqc-kit:start -->
## EQC compliance (eqc-kit)

| When the user says | Read and follow |
| --- | --- |
| `eqc check [arg]` | `.eqc/prompts/check.md` |
| `eqc fix [ID\|keyword]` | `.eqc/prompts/fix.md` |

Read the prompt file and follow it exactly; when it says to run a sub-task, read that prompt file and do it yourself (sequentially) unless your tool supports sub-agents.

### When writing or changing code

- Before writing code, read `.eqc/RULES.md` (the project's engineering quality Rules) and follow every Rule that applies to the change.
- Don't regress a Rule marked `pass` in `.eqc/RULES.md` or {{report_path}}.
- If the change cannot comply with a Rule, say which Rule and why before finishing; do not work around it silently.
- Before finishing, run `node .eqc/bin/eqc.mjs verify` and fix anything it reports (exit 2 means the Standard is not indexed yet).
<!-- eqc-kit:end -->
