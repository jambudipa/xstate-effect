# test/upstream

The test files of `xstate@5.33.2`, rewritten in Effect form under their upstream names (D1):
58 files of upstream `packages/core/test` here, its 6 example files in `examples/`, and the 10
files of `packages/core/src/graph/test` in `graph/`. They are the conformance gate of the port:
each upstream test passes here, or the ledger records why it differs.

No glob of the default run collects these files. Each `CONF-n` evidence file in `test/verify/`
imports the rewrites whose ledger "Green phase" is n, each exactly once, and checks their pass
counts (SD-1, SD-2). `pnpm test:upstream test/upstream/<file>.test.ts` runs one rewrite
directly.

## The files that hold the contract

- `upstream-manifest.json` — the frozen inventory of upstream: each test's annotation,
  assertion count, inline-snapshot texts and `@ts-expect-error` count, the generator
  expansions, the export lists, the throw sites and the graph snapshot entries.
  `scripts/upstream/freeze-upstream.ts` writes it from the upstream clone. Never edit it by
  hand.
- `CONFORMANCE.md` — the ledger (D2): each upstream file and its status, the gap rows, each
  upstream test that is not ported, and each deliberate deviation. `test/verify/ledger.ts`
  reads it, so keep its headings, its column headers and the cell rules at its top. LEDGER-1
  checks it.
- `pending.json` — the rewrites that are not green yet. The default run refuses to load a
  listed file, ESLint ignores it, and `tsconfig.test.green.json` excludes it. The CONF task
  that imports a rewrite removes it from the list and from that exclude. Every rewrite is
  green now, so the list is empty.

## The rules for a rewrite

- **Annotate each test.** The line directly above each test or generator call is
  `// upstream: <file> > <describe path> > <title>`, with the manifest's annotation text.
- **Keep the upstream assertions.** Each test keeps at least the upstream number of
  assertions, each inline snapshot with the upstream text, and the upstream number of
  `@ts-expect-error` lines; an asserted error message is the upstream text, word for word
  (SD-2, SD-4, SD-26). The PARITY scenarios count these from the syntax tree, so an assertion
  in a comment or a string does not count.
- **Record each difference.** A test that differs from upstream on purpose needs a ledger row:
  a "Tests not ported" row that names its gap kind, or a deviation row. Each row cites a
  decision in `docs/decisions.md` (D-n or SD-n), or a reason that only upstream can have, such
  as "skipped upstream". Difficulty, time or a failing implementation is never a reason. A row
  for a test that has no such gap fails the parity check as stale.
- **No skipped or todo test.** An upstream `it.skip` or `it.todo` is a "Tests not ported" row
  (D19).
- **No real or fake timers.** Rewrites drive time with `TestClock` or `SimulatedClock`; ESLint
  refuses wall-clock and fake-timer waits in this folder and its subfolders (SD-22).
- **Pinned files.** `exports.test.ts` and `support/scxml.ts` are pinned by their whole source
  in `test/verify/capability-pins.json`, so any edit to them, a comment included, needs its pin
  regenerated (see `test/verify/README.md`).

## Helpers and subfolders

`utils.ts` and `trackEntries.ts` port upstream's test helpers; `exports.types.ts` is the type
half of the export-parity test (EXP-1). `fixtures/` holds the data files that the rewrites
read.

- `examples/` — the rewrites of upstream's `test/examples/`.
- `graph/` — the rewrites of upstream's graph tests, for the `./graph` entry point.
- `support/` — the SCXML converter that `scxml.test.ts` runs, kept out of `src/` (D4).
