# eqc plan — write a chunked, reviewable fix plan for one medium/large rule.

Inputs: `Plan: <ID>`.
Outputs: `.eqc/plans/<ID>.md`, or the reply `BLOCKED: <reason>`. Reply is at most 8 lines. Source code is read-only.

## Steps
1. Run `node .eqc/bin/eqc.mjs get <ID>` for the rule and its latest evidence. Read project convention docs (AGENTS.md, CONTRIBUTING.md, lint/format configs, if present) only where the fix lands.
2. Verify the evidence with read-only greps/commands to get the real, current list of files to change. Never edit source.
3. If the fix needs installing/removing a package, or replacing an already-standardised architecture (state library, network client, navigation): write nothing; reply `BLOCKED: <decision needed>`.
4. Write ONLY `.eqc/plans/<ID>.md`:
```
# <ID> — <title>
verify: <one command whose output proves the whole rule is met, e.g. a grep count that must be 0>
approach: <≤5 lines>
recipe: <per-file transform rules, conventions to follow, exceptions (e.g. keep genuinely dynamic values inline)>
## Chunks
- [ ] 1 [mechanical] path/a, path/b
- [ ] 2 [judgment] path/c
```
5. Chunk rules:
   - At most ~8 files per chunk; group files from the same folder.
   - `mechanical` only if the recipe applies with no per-file decisions (safe for a cheaper model); otherwise `judgment`.
   - Order mechanical chunks first.
   - Chunks must be independent and resumable: each leaves the project in a working state.
6. Reply (max 8 lines): plan path, chunk count, mechanical/judgment split, total files, verify command, any risk worth the user's attention.
