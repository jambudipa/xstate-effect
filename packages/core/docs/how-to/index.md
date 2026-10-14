---
title: How-to guides
doc-type: index
---

# How-to guides

Task-oriented recipes for a goal you already have. Each assumes you know the basics from the [tutorials](../tutorials/index.md).

## Types and services

- [How to type a machine's context, events, input and output](./define-custom-types.md) — Declare the types once in `setup({ types: {} as { context; events; input; output } })`.
- [How to type a machine from Effect Schemas](./validate-events-with-schema.md) — Pass a context Schema and an event Schema to `setupWithSchema`; each machine it creates takes its context and event types from the Schemas' decoded types.
- [How to give a machine's actions and actors Effect services](./provide-services-to-a-machine.md) — Build the machine with `setup`.

## Machines

- [How to use delayed transitions and delayed events](./use-delayed-transitions.md) — Give a state an `after` map to leave it once a time has passed: the timer starts when the state is entered and is cancelled when the state exits.
- [How to model parallel and history states](./model-parallel-and-history-states.md) — Set `type: "parallel"` on a state to run its children as independent regions that are all active at once; its `onDone` runs when every region reaches a final state.
- [How to combine guards](./compose-guards.md) — Write small named guards in `setup({ guards })`, then combine them with `and`, `or` and `not`, which take guards in every form a transition takes: a name, `{ type, params }`, an inline function, or another combinator.
- [How to choose actions at run time with enqueueActions](./batch-actions-with-enqueue.md) — Replace a fixed `actions` list with `enqueueActions(({ context, event, enqueue, check }) => { … })`.

## Actors and events

- [How to invoke asynchronous work](./invoke-async.md) — Wrap the work in `fromPromise` or `fromEffect`, register it under `actors` in `setup`, and invoke it from the state that waits for it.
- [How to retry a failing service](./retry-pattern.md) — Retry inside the actor when the machine only needs the final result: wrap the request in `fromEffectRetry` with an Effect `Schedule`, and the machine sees one `onDone` or one `onError` after the last attempt.
- [How to run an Effect or a Stream as an actor](./run-an-effect-as-an-actor.md) — Wrap an Effect in `fromEffect`, or a Stream in `fromStream`.
- [How to send events between actors](./send-events-between-actors.md) — Use `sendTo(target, event)` to send from one actor to another, where the target is a child id, a `systemId`, a reference or a function that returns one.
- [How to spawn and stop child actors](./spawn-and-stop-children.md) — Declare the child's logic in `setup({ actors })`, then start a child with `spawnChild("<name>", { id, input })` in any action list.
- [How to emit events and listen to them](./emit-and-listen-to-events.md) — Declare the events in `types.emitted`, add `emit(event)` to an action list, and listen with `yield* actor.on("<type>", handler)`, where the handler returns an Effect.

## Running and observing actors

- [How to react to snapshot changes](./react-to-snapshot-changes.md) — Run `actor.changes` as a `Stream` to receive the current snapshot and then each new one, until the actor is done or stopped.
- [How to wait for a state or an output](./wait-for-a-state.md) — `yield* waitFor(actor, predicate, { timeout })` gives the first snapshot that satisfies the predicate, the current snapshot included.
- [How to persist and restore an actor](./persist-and-restore-an-actor.md) — Read `actor.getPersistedSnapshot`, turn it into text with `JSON.stringify`, and store the text.
- [How to handle actor errors](./handle-actor-errors.md) — Recover from a child's failure in its parent with `onError`, or with a transition on `xstate.error.actor.<id>` for a spawned child; the event's `error` is the raw value.
- [How to inspect a running actor system](./inspect-an-actor-system.md) — Pass an `inspect` function to the root actor's `createActor`.

## Testing

- [How to test a machine without running an actor](./test-machines-without-actors.md) — Compute snapshots with the pure transition functions.
- [How to test delayed transitions](./test-delayed-transitions.md) — Create a `SimulatedClock`, give it to the root actor with `createActor(machine, { clock })`, and move time with `yield* clock.increment(ms)`.
- [How to generate tests from a machine](./generate-tests-from-a-machine.md) — Build a test model with `createTestModel(machine, options)` from `@jambudipa/xstate-effect/graph`, generate its paths with `model.getShortestPaths()`, and run each one with `path.test({ events, states })`.

## Coming from XState

- [How to port XState code to this package](./migrate-from-xstate.md) — Machine configs port almost unchanged: change the imports and keep `setup`, `createMachine` and the action, guard and actor logic creators.
