# src/actions

The `@jambudipa/xstate-effect/actions` entry point: the built-in action creators of XState
5.33.2 (`assign`, `raise`, `sendTo`, `sendParent`, `forwardTo`, `emit`, `cancel`, `log`,
`spawnChild`, `stopChild`, `enqueueActions`) and the port's extras beside them (for example
`sendSelf`, `stopAllChildren`, the leveled `log` variants and `spawnChildFromRegistry`).

## What belongs here

Functions that build an action definition. A creator does no work of the action: it returns an
`ActionDefinition` whose `type` is upstream's (`xstate.assign`, `xstate.sendTo`, ...) and whose
`exec` returns an `ActionResult` that describes the effect (a context update, a send, a spawn,
and so on). The engine in `src/stateUtils.ts` applies each result in action order. So the semantics of sending,
spawning, delays and the internal queue live in the engine, not here. The `ActionDefinition`
and `ActionResult` types live in `src/Types.ts`, and the typed variants that a setup gives live
in `src/setup.ts`.

## Where to start

Read `assign.ts` for the simplest complete creator, then `enqueueActions.ts`, which collects
other creators' definitions and returns them as one `Enqueued` result.

## Rules that span the files

- **Creators stay pure.** A creator only builds a definition. `assign`, `raise`, `sendTo` and
  `emit` (with `sendParent` and `forwardTo`) call `warnIfInCustomAction`, so a call from inside a
  custom action logs upstream's warning instead of doing nothing in silence. Keep that call in
  a new creator of the same kind.
- **Delays travel with the definition.** `raise` and `sendTo` (with `sendParent`, `sendSelf`
  and `forwardTo`) also attach the delay as given through `withDelay`, as upstream sets
  `action.delay`. `validateMachine` in `src/graph` reads it to reject delayed actions in a test
  model. Do not drop it.
- **Functions of the action context.** An option that may be a function (an id, an input, a
  target, an event) is resolved inside `exec`, against the context of that point in the action
  list, never at creation.
- **Typing pattern.** Each upstream creator (and most extras) is cast to an interface whose
  first signature is the real one and whose second takes arguments that no value has. That
  second signature only makes the type checker defer an inline call until the machine has inferred its event type
  (see the `SendTo` JSDoc in `sendTo.ts`). Keep it when you change or add a creator.
- **Upstream names.** Upstream's exported type names (`SpawnAction`, `SpawnActionOptions` and
  the like) stay as aliases of the port's types, so code written against upstream's types
  still compiles.
