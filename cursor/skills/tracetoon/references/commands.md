# Other Tracetoon commands

- `tracetoon query [name] --run <id>`: ask the run's evidence graph. Named
  queries: `brief` (start here), `outline`, `why <path|path:line|H#|diff:N>`, `verified [path]`,
  `unverified`, `unexplained`, `turn <S#>`, `stale <R#>`, `dead-ends`,
  `pushback`, `schema`; or `--cypher "MATCH … RETURN …"` (read-only). Output is
  compact TOON; add `--json` for JSON and `--all` past the row cap.

- `tracetoon export --agent-trace`: line-level attribution as an Agent Trace
  record, if the user asks for one.
- `tracetoon images`: image routes for comics, whether each can draw, and the
  next step; `--approve <route>` (after the user agrees) and `--test`.
- `tracetoon config set <key> <value>`: `style` (pin a house style, or `auto`),
  `comic` (`off`, `allowed`, `always`), `promptQuoting`, `hosting`.
- `tracetoon render --check --run <id>`, `tracetoon render --run <id>`,
  `tracetoon review-packet --lean [--lens <x>] --run <id>`, `tracetoon review
  merge --run <id>`, `tracetoon review import --run <id> --rebind`: the single
  steps `tracetoon finish` runs for you; they keep working on their own.
- `--verbose` on `doctor`, `render`, `finish` and `review import` prints the
  full report; `--json` prints the structured result.
- `tracetoon check ... --progress`: echo the first output lines while the check
  runs (by default it is quiet until its one-line summary; the live output is
  in `<run>/check-logs/running.log`).
