---
title: Custom actor logic and createEmptyActor
doc-type: reference
sources: [packages/core/src/ActorLogic.ts, packages/core/src/actors/index.ts]
---

# Custom actor logic and createEmptyActor

> **TL;DR:** An `ActorLogic` is the contract that every actor runs: `getInitialSnapshot`,
> `transition` and `getPersistedSnapshot`, and optionally `restoreSnapshot` and `start`, each
> returning an Effect. `makeActorLogic` builds one from those functions. Inside them, the
> `ActorScope` service gives the actor itself and its system. `createEmptyActor` creates an
> actor that accepts any event and does nothing.

`makeActorLogic`, `isActorLogic`, `ActorLogicTypeId`, `ActorScope` and the types `ActorLogic`,
`ActorLogicType`, `AnyActorLogic` and `ActorScopeService` come from `@jambudipa/xstate-effect`.
`createEmptyActor` comes from `@jambudipa/xstate-effect` and from
`@jambudipa/xstate-effect/actors`. The root entry point also exports the whole module as the
namespace `ActorLogic`, so `ActorLogic.make` is `makeActorLogic`.

## Summary

| Export | Kind | Description |
| --- | --- | --- |
| [`ActorLogic`](#actorlogic) | interface | The contract of an actor's logic. |
| [`makeActorLogic`](#makeactorlogic) | function | Builds an `ActorLogic` from its functions. |
| [Type helpers](#type-helpers) | types | `SnapshotOf`, `EventOf`, `InputOf`, `EmittedOf`, `RequirementsOf` and `Any`. |
| [`AnyActorLogic`](#anyactorlogic) | interface | Any logic, whatever its types. |
| [`isActorLogic`](#isactorlogic) | function | Whether a value is actor logic. |
| [`ActorLogicTypeId`](#actorlogictypeid) | symbol | The marker that every logic carries. |
| [`ActorScope`](#actorscope) | service tag | The actor that runs the logic, its system, and its engine hooks. |
| [`createEmptyActor`](#createemptyactor) | function | Creates an actor that does nothing. |
| [Other module members](#other-module-members) | functions and types | The machine engine's helpers, reachable through the `ActorLogic` namespace. |

## ActorLogic

### Signature

```ts
import { ActorLogicTypeId, type ActorScope, type Errors, type EventObject, type Snapshot } from "@jambudipa/xstate-effect"
import type { Effect, Scope, Types } from "effect"

// The type of the marker: variance markers of the type parameters, type only
interface ActorLogicVariance<in out TSnapshot, in out TEvent, in TInput, out TEmitted, out R> {
  readonly _Snapshot: Types.Invariant<TSnapshot>
  readonly _Event: Types.Invariant<TEvent>
  readonly _Input: Types.Contravariant<TInput>
  readonly _Emitted: Types.Covariant<TEmitted>
  readonly _R: Types.Covariant<R>
}

export interface ActorLogic<
  in out TSnapshot extends Snapshot,
  in out TEvent extends EventObject,
  in TInput,
  out TEmitted extends EventObject = EventObject,
  out R = never
> {
  readonly [ActorLogicTypeId]: ActorLogicVariance<TSnapshot, TEvent, TInput, TEmitted, R>
  readonly config?: unknown
  readonly transition: (snapshot: TSnapshot, event: TEvent) => Effect.Effect<TSnapshot, Errors.TransitionError, ActorScope | R>
  readonly getInitialSnapshot: (input: TInput) => Effect.Effect<TSnapshot, Errors.InitializationError, ActorScope | R>
  readonly restoreSnapshot?: (persisted: unknown) => Effect.Effect<TSnapshot, Errors.RestoreError, ActorScope | R>
  readonly start?: (snapshot: TSnapshot) => Effect.Effect<void, Errors.StartError, ActorScope | Scope.Scope | R>
  readonly getPersistedSnapshot: (snapshot: TSnapshot) => Effect.Effect<unknown, Errors.SerializationError>
}
```

`TSnapshot` and `TEvent` are invariant, `TInput` is contravariant, and `TEmitted` and `R` are
covariant. `TEmitted` is the type of the events that the actor emits; `R` is the Effect
requirements of the logic.

### Members

| Member | Required | Description |
| --- | --- | --- |
| `[ActorLogicTypeId]` | yes | The marker. `makeActorLogic` adds it. |
| `config` | no | Any value. The built-in logics keep their creator function here. |
| `getInitialSnapshot(input)` | yes | The snapshot that the actor starts from, for its input. |
| `transition(snapshot, event)` | yes | The next snapshot for an event. |
| `getPersistedSnapshot(snapshot)` | yes | The persisted form of a snapshot. It needs no service. |
| `restoreSnapshot(persisted)` | no | The snapshot for a persisted value. Without it, the persisted value is the snapshot. |
| `start(snapshot)` | no | Work to run when the actor starts. |

### Behaviour

How an actor uses the members:

- **Creation.** `createActor` calls `getInitialSnapshot` with the `input` option. With the
  `snapshot` option, it calls `restoreSnapshot` with that value instead. An actor of a logic
  without `restoreSnapshot` takes the persisted value as its snapshot, unchanged, as in XState,
  so the persisted form must already be a valid snapshot. A failure or a defect gives a
  snapshot with status `error` and the raw value as `error`; the creation does not fail.
- **Start.** `actor.start` calls `start` with the current snapshot, in the actor's own scope: a
  fiber that `start` forks with `Effect.forkScoped`, or a finalizer that it adds, lives until the
  actor stops, is done or errors. A snapshot with status `done` skips `start`; a snapshot with
  status `error` ends the actor at once. A failure or a defect of `start` gives status `error`.
- **Events.** Each event is one macrostep: the actor calls `transition` and publishes the snapshot
  that it gives. A failure or a defect gives status `error` with the raw value.
- **Done and error.** A snapshot with status `done` or `error` ends the actor. A parent receives
  `xstate.done.actor.<id>` with the snapshot's `output`, or `xstate.error.actor.<id>` with its
  error. Later events change nothing.
- **Stop.** `stop`, or a parent that stops the child, hands the logic the event
  `{ type: "xstate.stop" }` through `transition`. A logic that does not answer it keeps its
  status: the actor ends, but the snapshot stays `active`, as in XState. The close of the scope
  that owns the actor gives status `stopped` without the event.
- **Persistence.** `actor.getPersistedSnapshot` calls `getPersistedSnapshot`.
- **Requirements.** `R` joins the requirements of `createActor`. The actor reads the services from
  the caller of `createActor`.

### Example

```ts
import { createActor, type ActorLogic, type EventObject, type Snapshot } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

// Starts a logic whose input is void, and gives the snapshot it starts with
export const startAndRead = <TSnapshot extends Snapshot, TEvent extends EventObject, R>(
  logic: ActorLogic<TSnapshot, TEvent, void, EventObject, R>
) =>
  Effect.gen(function* () {
    const actor = yield* createActor(logic)
    yield* actor.start
    return yield* actor.getSnapshot
  })
```

## makeActorLogic

### Signature

```ts
import type { ActorLogic, ActorScope, Errors, EventObject, Snapshot } from "@jambudipa/xstate-effect"
import type { Effect, Scope } from "effect"

export declare function makeActorLogic<
  TSnapshot extends Snapshot,
  TEvent extends EventObject,
  TInput,
  TEmitted extends EventObject = EventObject,
  R = never
>(config: {
  readonly transition: (snapshot: TSnapshot, event: TEvent) => Effect.Effect<TSnapshot, Errors.TransitionError, ActorScope | R>
  readonly getInitialSnapshot: (input: TInput) => Effect.Effect<TSnapshot, Errors.InitializationError, ActorScope | R>
  readonly getPersistedSnapshot: (snapshot: TSnapshot) => Effect.Effect<unknown, Errors.SerializationError>
  readonly restoreSnapshot?: (persisted: unknown) => Effect.Effect<TSnapshot, Errors.RestoreError, ActorScope | R>
  readonly start?: (snapshot: TSnapshot) => Effect.Effect<void, Errors.StartError, ActorScope | Scope.Scope | R>
  readonly config?: unknown
}): ActorLogic<TSnapshot, TEvent, TInput, TEmitted, R>
```

### Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `config.transition` | `(snapshot, event) => Effect<TSnapshot, TransitionError, ActorScope \| R>` | Required. |
| `config.getInitialSnapshot` | `(input) => Effect<TSnapshot, InitializationError, ActorScope \| R>` | Required. |
| `config.getPersistedSnapshot` | `(snapshot) => Effect<unknown, SerializationError>` | Required. |
| `config.restoreSnapshot` | `(persisted) => Effect<TSnapshot, RestoreError, ActorScope \| R>` | Optional. |
| `config.start` | `(snapshot) => Effect<void, StartError, ActorScope \| Scope \| R>` | Optional. It runs in the actor's own scope. |
| `config.config` | `unknown` | Optional. |

### Return value

An `ActorLogic<TSnapshot, TEvent, TInput, TEmitted, R>`: the functions as given, with the
`[ActorLogicTypeId]` marker added. An optional member that the config leaves out, or gives as
`undefined` or `null`, is absent from the result.

### Behaviour

- `makeActorLogic` checks nothing and runs nothing.
- `config.start` has the type of the interface's `start`: the actor provides `Scope.Scope`
  as well as `ActorScope`. A `start` that forks a fiber with `Effect.forkScoped` adds no
  requirement to `R`, and the fiber lives until the actor ends; see the example under
  [`ActorScope`](#actorscope).
- A snapshot must carry the snapshot marker. The `Snapshot` constructors `Snapshot.active()`,
  `Snapshot.done(output)`, `Snapshot.error(error)` and `Snapshot.stopped()` give one to spread.
  See [Snapshots](../snapshots.md).

### Example

```ts
import { Errors, Snapshot, makeActorLogic } from "@jambudipa/xstate-effect"
import { Effect, Option, Schema } from "effect"

interface CounterSnapshot extends Snapshot<number> {
  readonly count: number
}

type CounterEvent = { readonly type: "INC" } | { readonly type: "FINISH" }

const isStopEvent = (event: { readonly type: string }): boolean => event.type === "xstate.stop"

const step = (snapshot: CounterSnapshot, event: CounterEvent): CounterSnapshot => {
  if (snapshot.status !== "active") return snapshot
  if (isStopEvent(event)) return { ...snapshot, status: "stopped" }
  return event.type === "INC"
    ? { ...snapshot, count: snapshot.count + 1 }
    : { ...snapshot, status: "done", output: Option.some(snapshot.count) }
}

const PersistedCounter = Schema.Struct({ count: Schema.Number })

export const counter = makeActorLogic<CounterSnapshot, CounterEvent, { readonly start: number }>({
  getInitialSnapshot: (input) => Effect.succeed({ ...Snapshot.active(), count: input.start }),
  transition: (snapshot, event) => Effect.succeed(step(snapshot, event)),
  getPersistedSnapshot: (snapshot) => Effect.succeed({ count: snapshot.count }),
  restoreSnapshot: (persisted) =>
    Schema.decodeUnknownEffect(PersistedCounter)(persisted).pipe(
      Effect.map(({ count }): CounterSnapshot => ({ ...Snapshot.active(), count })),
      Effect.mapError((cause) => new Errors.RestoreError({ message: "Not a persisted counter", cause }))
    )
})
```

## Type helpers

The root name `ActorLogic` is also the namespace of the module, so the helpers resolve from the
root as `ActorLogic.SnapshotOf<T>`, and so on. `ActorLogicType` is the root name of the
`ActorLogic` interface with its type namespace: `ActorLogicType.SnapshotOf<T>` and
`ActorLogic.ActorLogic.SnapshotOf<T>` are the same types.

| Type | Gives |
| --- | --- |
| `ActorLogic.SnapshotOf<T>` | The snapshot type of the logic `T`. |
| `ActorLogic.EventOf<T>` | The event type of `T`. |
| `ActorLogic.InputOf<T>` | The input type of `T`. |
| `ActorLogic.EmittedOf<T>` | The type of the events that `T` emits. |
| `ActorLogic.RequirementsOf<T>` | The Effect requirements of `T`. |
| `ActorLogicType.Any` | `ActorLogic<Snapshot, EventObject, unknown>`. Only the interface's namespace holds it: `ActorLogic.Any` does not resolve from the root. The snapshot and event parameters are invariant, so a concrete logic is not an `ActorLogicType.Any`; use `AnyActorLogic` for any logic. |

Each helper gives `never` for a type that is not an `ActorLogic`.

### Example

```ts
import { fromEffect, type ActorLogic } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

export const greet = fromEffect(({ input }: { input: { name: string } }) => Effect.succeed(`Hello, ${input.name}`))

export type GreetInput = ActorLogic.InputOf<typeof greet> // { name: string }
export type GreetSnapshot = ActorLogic.SnapshotOf<typeof greet> // EffectSnapshot<string, { name: string }>
```

## AnyActorLogic

`AnyActorLogic` accepts every `ActorLogic`, a state machine included, whatever its snapshot,
event, input, emitted and requirement types. Its input and event are `any`. Its members are those
of `ActorLogic`, with `transition` typed as a method that takes any snapshot and gives a snapshot
with optional `value` and `context` of type `unknown`.

### Example

```ts
import { createMachine, fromEffect, type AnyActorLogic } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

export const logics: ReadonlyArray<AnyActorLogic> = [fromEffect(() => Effect.succeed(1)), createMachine({})]
```

## isActorLogic

### Signature

```ts
import type { ActorLogicType } from "@jambudipa/xstate-effect"

export declare function isActorLogic(u: unknown): u is ActorLogicType.Any
```

### Behaviour

Gives `true` when `u` is an object that has the `ActorLogicTypeId` property, and `false`
otherwise. It checks no other member.

### Example

```ts
import { isActorLogic } from "@jambudipa/xstate-effect"

export const describeValue = (value: unknown): string => (isActorLogic(value) ? "actor logic" : "something else")
```

## ActorLogicTypeId

`ActorLogicTypeId` is the symbol `Symbol.for("@jambudipa/xstate-effect/ActorLogic")`. Every logic
carries it as a property. At run time only its presence counts; its value holds the type-level
variance markers.

### Example

```ts
import { ActorLogicTypeId } from "@jambudipa/xstate-effect"

export const hasLogicMarker = (value: object): boolean => ActorLogicTypeId in value
```

## ActorScope

`ActorScope` is the service tag of the actor that runs a logic; its service type is
`ActorScopeService`. The actor provides it to `getInitialSnapshot`, `transition`,
`restoreSnapshot` and `start`, so `yield* ActorScope` reads it there.

| Member | Type | Description |
| --- | --- | --- |
| `self` | `ActorRefBase` | The actor that runs the logic. `self.sendUntyped(event)` sends it an event. |
| `id` | `string` | The actor's id. |
| `sessionId` | `string` | The actor's session id. |
| `system` | `ActorSystemService` | The actor's system. See [The actor system](../actor-system.md). |
| `logger` | `Option<(...args) => void>` | The function that `log` actions call: the actor's `logger` option, else its system's. `None` logs through Effect logging. |
| `defer` | `(effect: Effect<void>) => Effect<void>` | Runs an Effect after the current transition. |
| `emit` | `(event: EventObject) => Effect<void>` | Delivers an event to the actor's `on` listeners and `emissions` stream at once. |
| `stopChild` | `(child: ActorRefBase) => Effect<void>` | Stops a child of this actor. An actor that is not a child is a defect. |
| `actionExecutor` | `(action: CustomActionExecution) => Effect<void>` | Runs an action execution and sends its `@xstate.action` inspection event. |
| `allocateChild` | `() => AnyActorRef` | The machine engine's hook: the object that a spawned child is built into. |
| `spawnChild` | `(child, request: SpawnRequest) => Effect<void>` | The machine engine's hook: builds a child into an allocated object. |
| `restoreChild` | `(request: RestoreChildRequest) => Effect<AnyActorRef>` | The machine engine's hook: creates a child from its persisted entry. |
| `startChild` | `(child: ActorRefBase) => Effect<void>` | The machine engine's hook: starts a child that has not started. |

### Example

```ts
import { ActorScope, Snapshot, makeActorLogic } from "@jambudipa/xstate-effect"
import { Effect, Schedule } from "effect"

interface TickerSnapshot extends Snapshot<never> {
  readonly ticks: number
}

// start forks a fiber into the actor's own scope, so R stays never
export const ticker = makeActorLogic<TickerSnapshot, { readonly type: "TICK" }, void>({
  getInitialSnapshot: () => Effect.succeed({ ...Snapshot.active(), ticks: 0 }),
  transition: (snapshot, event) =>
    Effect.succeed(event.type === "TICK" ? { ...snapshot, ticks: snapshot.ticks + 1 } : snapshot),
  getPersistedSnapshot: (snapshot) => Effect.succeed({ ticks: snapshot.ticks }),
  start: () =>
    Effect.gen(function* () {
      const { self } = yield* ActorScope
      // The fiber lives until the actor stops, is done or errors
      yield* self.sendUntyped({ type: "TICK" }).pipe(Effect.repeat(Schedule.spaced("1 second")), Effect.forkScoped)
    })
})
```

## createEmptyActor

### Signature

```ts
import type { Actor, AnyEventObject, TransitionSnapshot } from "@jambudipa/xstate-effect"
import type { Effect, Scope } from "effect"

export declare function createEmptyActor(): Effect.Effect<
  Actor.Actor<TransitionSnapshot<undefined>, AnyEventObject, AnyEventObject>,
  never,
  Scope.Scope
>
```

### Return value

An Effect that gives a new, unstarted root actor with its own system. It needs a `Scope`: the
close of that scope stops the actor.

### Behaviour

- Its logic is transition logic whose reducer always gives `undefined`.
- Its snapshot has status `active` and `context` `undefined`.
- It accepts any event. An event leaves the context `undefined` and the status `active`.
- It emits nothing.
- `stop` ends the actor, but its snapshot keeps status `active`, as for any transition logic
  and as in XState.

### Example

```ts
import { createEmptyActor } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

const program = Effect.gen(function* () {
  const actor = yield* createEmptyActor()
  yield* actor.start
  yield* actor.send({ type: "ANYTHING" })
  const snapshot = yield* actor.getSnapshot
  yield* Effect.log(snapshot.status, snapshot.context) // active undefined
})

void Effect.runPromise(Effect.scoped(program))
```

## Other module members

The `ActorLogic` namespace of the root entry point also holds these members. The machine engine
uses them to run actions, guards and children; they are not needed to write a logic.

| Member | Kind | Description |
| --- | --- | --- |
| `createActionArgs` | function | Builds the `{ context, event, self, system }` argument of an action. |
| `createActionInfo` | function | Builds the `info` of an executable action. |
| `createActionContext` | function | Builds the action context that `ActionDefinition`s and assigners receive. |
| `createGuardContext` | function | Builds the context that a guard receives. |
| `resolveAction` | function | Resolves one action of a list for one use. |
| `ExecutableAction` | interface | One action, resolved for one use. |
| `ExecutableActionInfo` | interface | The arguments that an executable action runs with. |
| `CustomActionExecution` | interface | One action execution, as the actor's `actionExecutor` takes it. Also a root type export. |
| `SpawnRequest` | interface | What one spawn of a child asks for. |
| `RestoreChildRequest` | interface | What the restore of one child asks for. |
| `SpawnFunction` | type | Deprecated. The Effect form of a spawn function; the public type of a spawn is `Spawner`. |

The system members of the module (`ActorSystemService`, `ActorSystemInfo`, `TypedActorSystem`,
`SchedulerService`, `ScheduledEvent` and `SystemSnapshot`) are described in
[The actor system](../actor-system.md).

## Related

- [fromEffect, fromEffectBackground and fromEffectRetry](./from-effect.md),
  [fromStream](./from-stream.md), [fromPromise](./from-promise.md),
  [fromCallback](./from-callback.md), [fromTransition and fromTransitionWithInput](./from-transition.md)
  and [fromObservable and fromEventObservable](./from-observable.md): the built-in logics.
- [createActor and the actor](../create-actor.md)
- [Snapshots](../snapshots.md)
- [Persisted snapshots](../persistence.md)
- [How to persist and restore an actor](../../how-to/persist-and-restore-an-actor.md)
- [About the actor model](../../explanation/actor-model.md)
- [Actor lifetimes and scopes](../../explanation/actor-lifetimes-and-scopes.md)
