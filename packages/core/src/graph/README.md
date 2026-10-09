# src/graph

The `@jambudipa/xstate-effect/graph` entry point: the port of upstream `xstate/graph`
(`src/graph/` at xstate@5.33.2). It walks a logic's transitions to build adjacency maps,
shortest paths, simple paths and the path of an event sequence, draws a machine as a directed
graph, and runs model-based tests (`TestModel`, `createTestModel`).

## What belongs here

Code that reads a logic through `getInitialSnapshot` and `transition` only, to enumerate its
states and paths, and the test model built on those paths. Each file ports the upstream file of
the same name.

It does not hold engine semantics (`src/stateUtils.ts`), the inert actor scope it borrows
(`createInertActorScope` in `src/testing/`), or anything that starts a live actor. A traversal
never starts an actor.

## Where to start

- `index.ts` is the public surface of the subpath. The root entry point also re-exports
  `getAllOwnEventDescriptors` from `utils.ts` as `__unsafe_getAllOwnEventDescriptors`.
- `graph.ts` holds `resolveTraversalOptions`, which every traversal calls first: it merges the
  caller's options over a machine's defaults (keys by value and context, the event types each
  state takes, the initial snapshot as the start).
- `adjacency.ts` is the breadth-first walk that the path functions build on.
- `TestModel.ts` holds the test model and `createTestModel`.

## Rules that span the files

- **Upstream order and text.** The upstream graph tests compare paths and messages as inline
  snapshots, so a change must keep upstream's path order, step order, error messages and
  description text. Comments marked "Upstream" record where the port reproduces an upstream
  quirk on purpose.
- **Collections.** The canonical Effect lint rules apply to every file here at error, with no
  scoped exception (SD-22, amendment 2026-10-08, see docs/decisions.md). So no native `Set` or
  `Map`. The traversals keep upstream's path order in ordered arrays (or a `Chunk`) and use
  `MutableHashMap` and `HashSet` only for lookup and membership, never for iteration, so their
  order never shows. The shortest and simple path walks change no array in place. A few local
  arrays still do where upstream's do: the breadth-first queue in `adjacency.ts`, the sort and
  the kept list in `deduplicatePaths.ts`, and the step results of a path test. The
  array-mutation rule matches by variable name and does not flag them. Do not add more; use
  spreads, `flatMap` or `Chunk`.
- **Effects where user code runs (SD-13).** A function that runs a logic's transitions, a
  `filterEvents` Effect, a state test or an event executor returns an Effect. Functions that
  only walk the state node tree or a built map (`getStateNodes`, `toDirectedGraph`,
  `adjacencyMapToArray`, `alterPath`, `deduplicatePaths`) stay synchronous.
- **Failures (SD-3).** Nothing throws. Each failure is a tagged error in `errors.ts` whose
  `name` is `Error` and whose message is upstream's, so it prints as upstream's plain `Error`.
- **One mock actor scope per call.** Each public traversal wraps its `...In` variant in
  `withMockActorScope`. A traversal that needs another one calls the `...In` variant, so one
  scope serves the whole call and closes at its end.
- **Coupling with `src/actions`.** `validateMachine` finds a delayed `raise` or `sendTo` through
  the delay that `withDelay` attaches to the action definition. An action creator that drops
  that delay makes `createTestModel` accept a machine it cannot drive.
