# src

The source of `@jambudipa/xstate-effect`: the runtime behaviour of XState 5.33.2 in
Effect-native form. The modules directly in this folder are the core that every entry point
builds on: the statechart engine, the actor runtime, the shared types and data, and the root
entry point. Each subfolder is one area with its own README.

## What belongs here

A module belongs at this level when more than one area needs it, or when it is part of the
engine or the runtime. Code for one area goes in that area's folder: action creators in
`actions/`, actor logic creators in `actors/`, guards in `guards/`, model-based testing in
`graph/`, the devtools hook in `dev/`, the testing helpers in `testing/`. A small helper that
needs neither the engine nor the runtime goes in `internal/`.

## Entry points

- `index.ts` is the root entry point (`.`). The five subpath entry points are the `index.ts`
  files of `actions/`, `actors/`, `guards/`, `graph/` and `dev/`. `package.json` `exports` maps
  all six, and nothing else is public.
- A name an entry point adds or drops changes the public surface. `test/upstream/exports.test.ts`
  checks each entry point against the names upstream exports, and a name the port leaves out
  needs a deviation row in the conformance ledger.
- To follow one event, start at `Actor.ts` (`send`, the mailbox, one macrostep per event),
  then `StateMachine.ts` (`transition`), then `stateUtils.ts` (the microsteps).

## Module layering

- **Engine**: `StateMachine.ts` (machine logic), `StateNode.ts` (the node tree) and
  `stateUtils.ts` (the upstream transition algorithm). The engine never imports `Actor.ts` at
  run time. It reaches the running actor, its children and its system only through the
  `ActorScope` service.
- **Runtime**: `Actor.ts` (`createActor`: mailbox, processing fiber, scope, subscriptions),
  `ActorSystem.ts` (registry, scheduler, clock, inspection) and `ActorRef.ts` (the reference
  interfaces). The runtime does not import the engine: a machine is one `ActorLogic` among
  the others in `actors/`.
- **Contract between them**: `ActorLogic.ts` holds the `ActorLogic` interface and the service
  interfaces (`ActorScopeService`, `ActorSystemService`, `SchedulerService`). It declares them
  ahead of their implementations so that the imports stay acyclic.
- **Persistence**: `persistence.ts` is the Schema codec that every `getPersistedSnapshot`
  encodes through and every restore decodes through.
- **Types and data**: `Types.ts` holds the config, action, guard and implementation types; at
  run time it imports only `Event.ts`. `Event.ts`, `Snapshot.ts`, `StateValue.ts` and
  `Errors.ts` are data modules that import no engine or runtime code.
- `setup.ts` adds types only: its machines are `StateMachine` machines.

## Effect-native rules

- No package code throws (SD-3). An expected failure is a typed error from `Errors.ts` in the
  Effect's error channel. What user code throws, fails or dies with becomes a defect that
  carries the original value, and the actor ends with status `error` (SD-4).
- An error that nothing handles goes to the actor's logger (SD-21). It is never rethrown.
- ESLint applies the canonical Effect rule bundle at `error` to every file here. Inline
  disable comments are ignored. The one scoped exception is `no-explicit-any` in
  `internal/anyEventObject.ts` (SD-22).
- Each actor lives in its own `Scope` (D12, SD-8). A fiber that an actor or its logic forks
  belongs to that scope, so it ends when the actor stops, is done or errors.

## Where the decisions live

- `test/upstream/CONFORMANCE.md` is the conformance ledger: each upstream test file, and each
  deviation from upstream with the decision that requires it. Read it before you change a
  behaviour that upstream defines.
- `docs/decisions.md` defines the decision ids (D-n, SD-n) that comments here cite.
- Comments cite upstream by its file at xstate@5.33.2. Keep the citation current when you
  change the ported code.
