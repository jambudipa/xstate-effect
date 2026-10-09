# scripts/upstream

The tools that pin the port to upstream XState 5.33.2. `fetch-upstream.sh` (run it as
`pnpm upstream:fetch`) clones upstream at the tag `xstate@5.33.2`, commit
`fbee62e7c1586315ed478c2fedf530d7e0ff5a3e`, into `.upstream/xstate-5.33.2` (gitignored).
`freeze-upstream.ts` reads that clone and writes the inventory to
`test/upstream/upstream-manifest.json`: every upstream test call site with its counts, the
graph snapshots, the SCXML test table, the export lists, the throw and console sites of
upstream `src/`, and the port's own export list at the start of the work.

## What belongs here

- Code that reads the upstream clone. Nothing at test time reads the clone; the suite reads the
  committed manifest only, so it needs neither the clone nor the network.
- The manifest types and the pure helpers that the checks share with the freeze: the
  `// upstream:` annotation format, comment ranges, `@ts-expect-error` detection and inline
  snapshot reading. The parity and conformance checks themselves live in `test/verify/`
  (`parity.ts`, `conformance.ts` and the PARITY, CONF and HARNESS evidence files), not here.

## Entry points

Start with the module comment of `freeze-upstream.ts`: it states the command line and what
the manifest holds. `buildManifest` and `freeze` are the two functions the rest of the file
serves.

## Constraints

- The manifest is written once and stays byte-identical. A rerun over the same clone writes
  the same bytes: keys are sorted by code point at every level, and the `portBaseline` section
  is copied from the existing file, never taken again. COMPAT-4 pins the hash of that section,
  and HARNESS-1 checks the canonical form, so never edit the manifest by hand. To confirm a
  change of the freeze, run `pnpm upstream:fetch`, then
  `node --experimental-strip-types scripts/upstream/freeze-upstream.ts`, and expect no diff.
- The freeze refuses a clone whose version is not 5.33.2 or whose HEAD is not the tag commit,
  and it throws on any upstream test shape it cannot count, rather than guess. Both scripts
  hold the tag commit; change them together.
- `freeze-upstream.ts` is pinned by a hash of its whole source in
  `test/verify/capability-pins.json` (CONF-8). Any edit, a comment included, needs that pin
  regenerated.
- The test suite imports `freeze-upstream.ts`, so importing it must have no effect: only the
  command line, which runs when Node runs the file directly, may run git. The capability scan
  of CONF-8 allows `node:child_process` in this file on that condition.
- Node runs the script with `--experimental-strip-types`, so it may use only TypeScript syntax
  that erases to JavaScript: no enums, namespaces or constructor parameter properties.
- Decision SD-2 in `docs/decisions.md` defines what the manifest must hold and how PARITY
  and CONF use it.
