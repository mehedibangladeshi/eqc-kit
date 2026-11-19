# Re-index carries Verdicts over and may lower the Baseline

Editing the Standard used to mean reset, re-index and a full Audit, losing every Verdict and the Baseline. Now `eqc check <path>` on an edited Standard runs a Re-index: the index agent writes a fresh Index to `.eqc/rules.next.json`, and the Engine (`eqc reindex`) compares it with the current Index into a Rule delta. Matching is by content first, so a Rule that only got renumbered keeps its Verdict and protection under its new ID. Changed and removed Rules lose their Verdict and Baseline protection, because a pass recorded against old wording proves nothing about the new one. Only added and changed Rules are audited.

A Re-index sets the Baseline level to the Compliance level recomputed after carry-over, so it can go down. The ratchet exists to catch code getting worse; when the Standard raises the bar, a lower level is not a Regression, and a strict ratchet would fail every git hook and CI run until the new Rules were fixed. Later merges ratchet up as before.

The Engine computes the delta, not the index agent, because the Engine owns all state (ADR 0002) and the comparison must be deterministic. The index agent still builds every Index from scratch and never sees the old one.

## Considered options

- Match by ID only: rejected because inserting one Rule mid-Tier shifts every later printed number and would force re-auditing all of them.
- Keep a stale Verdict on changed Rules until re-audit: rejected because a pass against old wording could keep a Tier reached that the new Standard does not support.
- Store per-Rule content hashes in `rules.json`: not needed; the Engine compares both files directly, so no State schema change.
