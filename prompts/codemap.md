# eqc code map check — run once per run by the orchestrating prompt.

Outputs: one line `MAP: ...` to put in every sub-task brief, plus at most one user note. Read-only.

## Steps
1. Detect candidates:
   - Code-graph / knowledge-graph tools in your own tool list (symbol lookup, references, call graph, impact, neighbors, shortest path).
   - Graph output at the repo root: `graphify-out/graph.json` (with `graphify` on PATH); hidden index dirs such as `.codegraph/`, `.gitnexus/`, `.serena/`, code-review-graph.
   - grep the project's CLAUDE.md, AGENTS.md, .cursorrules, GEMINI.md, .github/copilot-instructions.md for a named code map / code graph / knowledge graph / codemapper tool and how to query it. Use the tool they name.
2. Freshness, per map: compare the map's output file mtime with `git log -1 --format=%ct` and with the mtime of each file in `git status --porcelain`. Older than either = stale. A tool-provided map with no file is fresh only if the tool reports an index time >= the last commit; otherwise treat it as possibly stale = not used.
3. Never build, install, refresh or update a map, even if an update command exists. Stale: do not use it (emit `MAP: none (stale <tool>)`), and tell the user one line: `code map <tool> is stale — refresh it with <its update command, e.g. graphify update .> to speed up future runs`.
4. Output exactly one line for every sub-task brief:
   `MAP: <tool> — <allowed query commands / tool names> (fresh)` or `MAP: none (<reason>)`

## Using the map (for sub-tasks whose brief has a MAP line other than none)
- Orient -> locate -> trace, with the named commands only, e.g. `graphify query "<q>"`, `graphify path "A" "B"`, `graphify explain "X"`.
- Confirm every fact in source with `path:line`. The map is never sole evidence.
- On a miss or contradiction, fall back to grep/read. Inferred edges are hints.
