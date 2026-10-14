---
title: Reference
doc-type: index
---

# Reference

Exact descriptions of the package's API: signatures, options, behaviour and errors. Look an item
up while you work; the [how-to guides](../how-to/index.md) show how to use them together.

## Machines and actors

- [Entry points](./entry-points.md) — the six entry points and every name each one exports.
- [setup and setupWithSchema](./setup.md) — declare a machine's types and its named actors, actions, guards and delays.
- [createMachine and the machine](./create-machine.md) — the machine config and every member of a state machine.
- [createActor and the actor](./create-actor.md) — the actor options and every member of a running actor.
- [Actor references](./actor-refs.md) — the part of an actor that other code talks to, and its helpers.
- [The actor system](./actor-system.md) — the system a root actor creates: registry, scheduler and inspection.
- [Inspection events](./inspection.md) — the events an inspection function receives, and their order.

## Actions

- [assign and assignProperty](./actions/assign.md) — merge new values into the machine's context.
- [raise](./actions/raise.md) — send an event to the machine itself, at once or after a delay.
- [sendTo, sendParent, sendSelf and forwardTo](./actions/send-to.md) — send an event to another actor.
- [emit](./actions/emit.md) — send an event to the actor's listeners.
- [cancel](./actions/cancel.md) — remove a pending delayed event by its id.
- [log and the level helpers](./actions/log.md) — log a value when the action runs.
- [spawnChild](./actions/spawn-child.md) — start a child actor from a transition.
- [stopChild, stop and stopAllChildren](./actions/stop-child.md) — stop child actors.
- [enqueueActions](./actions/enqueue-actions.md) — choose the actions to run when the transition runs.

## Guards

- [Guards](./guards.md) — `stateIn`, `stateNotIn`, `and`, `or`, `not`, `evaluateGuard` and the guard types.

## Actor logic

- [fromPromise](./actors/from-promise.md) — actor logic from a function that returns a Promise.
- [fromCallback](./actors/from-callback.md) — actor logic from a callback that can send, receive and clean up.
- [fromTransition and fromTransitionWithInput](./actors/from-transition.md) — actor logic from a reducer.
- [fromObservable and fromEventObservable](./actors/from-observable.md) — actor logic from an Observable-like source.
- [fromEffect, fromEffectBackground and fromEffectRetry](./actors/from-effect.md) — actor logic from an Effect.
- [fromStream](./actors/from-stream.md) — actor logic from an Effect `Stream`.
- [Custom actor logic and createEmptyActor](./actors/custom-logic.md) — the `ActorLogic` contract and `makeActorLogic`.

## Snapshots, values and events

- [Snapshots](./snapshots.md) — snapshot statuses, the machine snapshot and its queries.
- [State values](./state-value.md) — what a state value holds and how values are compared.
- [Events](./events.md) — the event types, the built-in events and the event helpers.
- [Persisted snapshots](./persistence.md) — the JSON form of a snapshot and how a restore reads it.
- [Errors](./errors.md) — every error class of the package and what raises it.

## Testing

- [Pure transition functions](./testing/get-next-snapshot.md) — compute snapshots and actions without an actor.
- [SimulatedClock](./testing/simulated-clock.md) — a clock whose time moves only when you move it.
- [waitFor, toEffect and toPromise](./testing/wait-for.md) — wait for a snapshot or an actor's output.
- [Graph and model-based testing](./graph.md) — paths, adjacency maps and test models from a machine.

## Types and tools

- [Type utilities](./type-utilities.md) — the types that read one part of a setup, machine, logic or actor.
- [State nodes](./state-nodes.md) — the state node tree a machine builds, and its helpers.
- [XState type names](./upstream-type-names.md) — the XState type names the package exports for porting.
- [Dev tools entry point](./dev.md) — connect actors to a dev tools extension.
