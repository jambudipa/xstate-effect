# test/verify

The evidence of the port: one spec per scenario, and the harness modules that the specs share.
The default run collects every `*.spec.ts` here (`test/verify/**/*.spec.ts`); a harness module
has no `.spec` suffix, so it runs only when a spec or a config imports it.

## Scenario specs

Each scenario has one file, `verify-xstate-5-33-2-port-<ID>.spec.ts` (SD-1), and the title of
each of its tests starts with `[<ID>]`. The IDs are of two kinds:

- **Behaviour** — a gap row (`S`, `A`, `C`, `P`, with `b` and `c` follow-ups) proves the
  behaviour that one row of the ledger's gap table (`test/upstream/CONFORMANCE.md`) asks for;
  `API`, `CONC`, `ERR`, `EVT`, `SCXML` and `COMPAT` prove behaviour that cuts across the rows.
- **Gates** — the checks that make conformance mechanical: `CONF-n` imports the upstream
  rewrites that are green at phase n and checks their pass counts (`conformance.ts`);
  `PARITY-n` compares each rewrite with the frozen manifest (`parity.ts`); `LEDGER-1`,
  `SNAP-1`, `INV-1` and `EXP-1` check the ledger, the snapshots, the upstream messages and the
  exports; `HARNESS-1` checks the manifest and the checkers themselves; `HARNESS-2` and
  `CONF-8` check the guards of the default run; `DELIVERY-n` checks the built package; and
  `BASELINE-1` checks that the outcomes of the first phases still hold.

A spec that imports upstream rewrites must follow the CONF rules: one `describe` per rewrite,
titled `upstream/<name>.test.ts`, each rewrite imported by one CONF file only, and the count
check last (see the header of `conformance.ts`).

## Harness modules

- **The checkers** — `conformance.ts`, `parity.ts`, and `ledger.ts`, the one reader of the
  ledger. Read the ledger through `ledger.ts`, never with a parser of your own.
- **The recorded upstream texts** — `upstream-messages.ts`: each upstream message template and
  the channel the port uses for each upstream throw site (SD-3, INV-1).
- **The guards of the default run** — the no-skip reporter, the pending-rewrite guard and its
  setup file, and the flakyTest guard and its setup file. `vitest.config.ts` wires them in;
  `test/README.md` says what each refuses.
- **The static scan** — `skip-scan.ts`: the syntax-tree scan for skip, todo, focus and
  `flakyTest` forms, the import walk, and the default deny of CONF-8 (`ALLOWED_PACKAGES`,
  `CAPABILITY_HOLDERS`).
- **The tools of a few specs** — `vitest-runs.ts` runs Vitest in this process on fixture
  package roots (only CONF-8 and HARNESS-2 may import it; no test spawns a child Vitest
  process), and `delivery.ts` builds the package into a fresh folder under the gitignored
  `.delivery/`.

`fixtures/` holds the inputs of the checker specs as `.txt` files, so no glob or loader takes
them for code. `__snapshots__/` holds only the CONF-7 graph snapshot file, which SNAP-1 checks
against upstream (SD-26).

## capability-pins.json

A module that a test or a Vitest config reaches may use a capability (a builtin or package that
loads, runs or spawns code, Vitest's node API, ESLint, the TypeScript module loaders) only when
`CAPABILITY_HOLDERS` of `skip-scan.ts` names it. Each such module, and each module that
`PINNED_LOADERS` pins by its whole source, has an entry in `capability-pins.json`: its path
from the package root, mapped to the hex SHA-256 of its whole text.

CONF-8 checks that the keys are exactly those modules and that each hash matches the file. So
any edit to a pinned file, a comment included, fails CONF-8 until its entry holds the SHA-256
of the new text. The pinned files include several specs and files outside this folder;
read the JSON for the current set. A new capability holder is a change to `skip-scan.ts`
(itself pinned) and to the pins together, not a change to the module alone.
