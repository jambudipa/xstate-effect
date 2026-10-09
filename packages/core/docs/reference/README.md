# Reference

Reference documentation is **information-oriented** and provides technical descriptions of the APIs. Use this section to look up specific functions, types, and their signatures.

## Core APIs

- [setup](./setup.md) - Type-safe machine factory
- [createMachine](./create-machine.md) - Machine configuration
- [createActor](./create-actor.md) - Actor creation and lifecycle

## Actions

- [assign](./actions/assign.md) - Context updates
- [raise](./actions/raise.md) - Self-directed events
- [sendTo](./actions/send-to.md) - Inter-actor communication
- [spawnChild](./actions/spawn-child.md) - Dynamic actor creation
- [stopChild](./actions/stop-child.md) - Actor termination
- [emit](./actions/emit.md) - External event emission
- [cancel](./actions/cancel.md) - Delayed event cancellation
- [log](./actions/log.md) - Logging utilities
- [enqueueActions](./actions/enqueue-actions.md) - Action batching

## Guards

- [guard](./guards/guard.md) - Guard definition
- [and](./guards/and.md) - Logical AND
- [or](./guards/or.md) - Logical OR
- [not](./guards/not.md) - Logical NOT
- [stateIn](./guards/state-in.md) - State checking

## Actor Creators

- [fromPromise](./actors/from-promise.md) - Promise-based actors
- [fromEffect](./actors/from-effect.md) - Effect-based actors
- [fromCallback](./actors/from-callback.md) - Callback-based actors
- [fromTransition](./actors/from-transition.md) - Transition-based actors
- [fromObservable](./actors/from-observable.md) - Observable-based actors

## Types

- [StateMachine](./types/state-machine.md) - Machine type
- [Actor](./types/actor.md) - Actor type
- [ActorRef](./types/actor-ref.md) - Actor reference type
- [Snapshot](./types/snapshot.md) - Snapshot type
- [StateValue](./types/state-value.md) - State value type
- [Events](./types/events.md) - Built-in event types
- [Errors](./types/errors.md) - Error types

## Testing

- [getNextSnapshot](./testing/get-next-snapshot.md) - Pure transition testing
- [SimulatedClock](./testing/simulated-clock.md) - Time control
- [waitFor](./testing/wait-for.md) - Async waiting
- [toPromise](./testing/to-promise.md) - Promise conversion

## Type Utilities

- [ContextFrom](./type-utilities.md#contextfrom) - Extract context type
- [EventFrom](./type-utilities.md#eventfrom) - Extract event type
- [ActorRefFrom](./type-utilities.md#actorreffrom) - Extract actor ref type
- [SnapshotFrom](./type-utilities.md#snapshotfrom) - Extract snapshot type
