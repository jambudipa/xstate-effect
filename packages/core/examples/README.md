# examples

Ports of the official XState examples (`statelyai/xstate`, folder `examples/`) to
`@jambudipa/xstate-effect`. Each file keeps the state machine of one upstream example and drops its
UI: the React and Vue parts are gone, so what remains is framework-agnostic machine code. The
examples show the port's API on familiar machines, and the test suite runs every one of them.

## What belongs here

- One module for each upstream example, named after the upstream folder, usually without the
  framework suffix (`tic-tac-toe-react` becomes `tic-tac-toe.ts`). A module exports its machine or machines,
  their context, event and input types, and the actor logic the machine invokes.
- Mock services only. The actors simulate work with `setTimeout`, random failures and
  `console.log`; nothing reaches a network or a disk.
- Upstream examples built on `@xstate/store` do not belong: they have no state machine to port.
  `STORE_EXAMPLES_NOT_PORTED.md` records which ones and why.
- Library code belongs in `src/`, and tests belong in `test/`. An example never holds a fix or a
  helper that the library needs.

## Entry points

- `index.ts` re-exports every example module. Where two modules export the same name, the index
  renames one (for example `guisCounterMachine`, `timerTicksActor`, `CloudEventOrder`).
- `counter.ts`, `toggle.ts`, `stopwatch.ts` and `fetch.ts` are the smallest examples and carry an
  `@example` block that shows how to run a machine with `createActor` or with the pure
  `getInitialSnapshot` and `getNextSnapshot`.

## How to read an example

The header block of each file names the upstream folder ("Ported from xstate/examples/..."), the
source of the scenario where there is one (a 7GUIs task or a Serverless Workflow specification
example), and the features it demonstrates. A "Note:" in the header or above a state says where the
port differs from the original and why the result is the same.

Then come the types, the mock actors, and the machine, built with `setup(...).createMachine(...)` or
with `createMachine(...)`. Three behaviours of this port show up in almost every file:

- The output of a done event is an `Option` (D8), so an `onDone` action reads it with
  `Option.getOrElse`, `Option.match` or a similar function.
- `createActor` returns an Effect that needs a `Scope` (SD-8), and the pure transition functions
  return Effects (SD-13).
- Several workflow examples replace an upstream delay with a manual event (`END_BIDDING`,
  `ADD_WATER`, `GENERATE_REPORT`) or with an immediate `always` transition, and keep the upstream
  `after` form in a comment.

## How the examples are run and checked

- `test/examples.test.ts` steps the counter, toggle, stopwatch and fetch machines through
  `getInitialSnapshot` and `getNextSnapshot` and checks the state values and context.
- `test/smoke.test.ts` and `test/actor.test.ts` run the counter machine in a live actor.
- The COMPAT-1 evidence file (`test/verify/verify-xstate-5-33-2-port-COMPAT-1.spec.ts`) covers
  every example. It compiles all of them with the test compiler options (`declaration` on, so an
  exported type that cannot be named fails). It checks the initial status and state value of each
  machine that the index exports, against a table in that file. It also starts and stops each
  machine in a live actor, with every invoked actor replaced by one that never settles, so the run
  reaches no mock service.
- The upstream example rewrites in `test/upstream/examples/` are a different thing: they rewrite
  XState's own `test/examples` suite (the numbered statechart examples and the CD player), define
  their machines inline, and do not import this folder. The default `pnpm test` runs them through
  the CONF evidence files under `test/verify/`; `vitest.upstream.config.ts` runs one by name.

## Constraints across files

- An example imports only from `effect` and from `../src/index.js`, and only names that upstream
  XState also exports from its root (D15). Port-only helpers such as `action`, `guard` and `when`
  are not allowed; use the XState action and guard forms. COMPAT-1 checks this against the frozen
  upstream manifest.
- A new module must be re-exported from `index.ts`: COMPAT-1 checks that the index re-exports
  exactly the modules in this folder.
- A new machine in the index needs a row in the COMPAT-1 initial-snapshot table, and an input row
  when its context reads `input`. Otherwise the COMPAT-1 run fails.
- The root `tsconfig.json` covers `src/` only, and the ESLint config has no block for this folder,
  so `eslint examples` ignores these files. The type check reaches the examples through the test
  files that import the index.
