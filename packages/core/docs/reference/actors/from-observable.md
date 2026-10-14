---
title: fromObservable and fromEventObservable
doc-type: reference
sources: [packages/core/src/actors/fromObservable.ts]
---

# fromObservable and fromEventObservable

> **TL;DR:** `fromObservable(creator)` makes actor logic from an Observable-like source: each
> value that the source emits becomes the snapshot's `context`, as `Option.some(value)`.
> `fromEventObservable(creator)` relays each event that the source emits to the actor's parent
> and keeps the `context` at `Option.none()`. For both, the source's completion gives status
> `done`, its error gives status `error`, and a stop unsubscribes once.

## Summary

| Export | Kind | Import from | Description |
|---|---|---|---|
| [`fromObservable`](#fromobservable) | function | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/actors` | Creates actor logic whose context is the source's last value. |
| [`fromEventObservable`](#fromeventobservable) | function | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/actors` | Creates actor logic that relays the source's events to its parent. |
| [`ObservableActorArgs`](#observableactorargs) | type | `@jambudipa/xstate-effect/actors` | The argument that the creator receives. |
| [`Subscribable`](#subscribable) | type | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/actors` | The source that the creator returns. |
| [`Observer`](#observer) | type | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/actors` | The observer object that the actor hands to the source. |
| [`ObservableSnapshot`](#observablesnapshot) | type | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/actors` | The snapshot of an observable actor. |
| [`ObservableActorLogic`](#observableactorlogic) | type | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/actors` | The logic that both functions return. |
| [`ObservableActorRef`](#observableactorref) | type | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/actors` | A reference to an observable actor, the type of `self`. |

The root entry point also holds every export of this page on its `actors` namespace
(`actors.fromObservable`). Any source with a `subscribe(observer)` method that returns
`{ unsubscribe }` works, an RxJS `Observable` included.

## `fromObservable`

### Signature

```ts
import type { EventObject, ObservableActorLogic, Subscribable } from "@jambudipa/xstate-effect"
import type { ObservableActorArgs } from "@jambudipa/xstate-effect/actors"

export declare function fromObservable<TContext, TInput = unknown, TEmitted extends EventObject = EventObject>(
  observableCreator: (args: ObservableActorArgs<TInput, TContext, TEmitted>) => Subscribable<TContext>
): ObservableActorLogic<TContext, TInput, TEmitted>
```

The type parameters are in the order `TContext` (the type of the source's values), `TInput`,
`TEmitted`. TypeScript infers `TInput` from a type annotation on the creator's parameter, and
`TContext` from the source that the creator returns.

### Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `observableCreator` | `(args: ObservableActorArgs<TInput, TContext, TEmitted>) => Subscribable<TContext>` | required | The function that `start` calls. It receives the fields in [`ObservableActorArgs`](#observableactorargs) and returns the source. |

### Returns

An `ObservableActorLogic<TContext, TInput, TEmitted>`. Pass it to `createActor`, to
`invoke.src`, to `spawnChild`, or to the `actors` of `setup`.

### Creator argument

| Field | Type | Description |
|---|---|---|
| `input` | `TInput` | The input that the actor was created with. |
| `system` | `ActorSystemService` | The actor system that the actor belongs to. |
| `self` | `ObservableActorRef<TContext>` | The observable actor itself. |
| `emit` | `(emitted: TEmitted) => void` | Delivers an event to the actor's `on` listeners and its `emissions` stream at once, from any code. A call after the actor stopped is dropped. |

### Snapshot at each status

| Status | When | `context` | `output` | `error` | `input` |
|---|---|---|---|---|---|
| `active` | From creation until the source completes or errors, or the actor stops. | `Option.none()` before the first value, then `Option.some(value)` for the last value; `Option.none()` for an `undefined` value. | `Option.none()` | `Option.none()` | The actor's input. |
| `done` | The source completed. | The last value. | `Option.none()` | `Option.none()` | `undefined` |
| `error` | The source sent an error. | The last value. | `Option.none()` | `Option.some(error)`, the raw error; `Option.none()` for an `undefined` error. | `undefined` |
| `error` | The creator or `subscribe` threw. | `Option.none()` | `Option.none()` | `Option.some(thrown)`, the raw thrown value. | The actor's input. |
| `stopped` | The actor stopped. | The last value. | `Option.none()` | `Option.none()` | `undefined` |

### Behaviour

- `start` calls the creator, then subscribes to the source, in the actor's own scope.
- Each value goes through the actor's own processing as an `xstate.observable.next` event: one
  step of the actor per value, which its observers see.
- The completion gives status `done` with `output` `Option.none()`. A parent receives one
  `xstate.done.actor.<id>`.
- An error gives status `error`. A parent receives one `xstate.error.actor.<id>` with the raw
  error.
- After `done` or `error`, later values change nothing.
- Every other event that the actor receives leaves the snapshot as it is.
- A restored snapshot with status `done` does not subscribe again.

### Stop behaviour

- A stop calls `unsubscribe` once and gives status `stopped` with `input` `undefined`. Later
  values change nothing, and later `emit` calls are dropped.
- The actor never calls `unsubscribe` after the source completed or sent an error.
- When the scope that owns the actor closes without a stop, `unsubscribe` is called too. The
  snapshot gets status `stopped` and keeps its `input`.

### Errors

| Condition | Result |
|---|---|
| The source sends an error | Status `error` with the raw error. The parent receives `xstate.error.actor.<id>`. |
| The creator or `subscribe` throws | Status `error` inside `start`, with the raw thrown value. The parent receives `xstate.error.actor.<id>`. |
| `unsubscribe` throws | The value is logged through Effect logging at level Error. The stop completes and the status is `stopped`. |
| Either error in a root actor that nothing observes | The error is also logged through Effect logging at level Error. |

### Persisted form

`getPersistedSnapshot` gives `{ status, output, error, context, input }` with plain values. An
absent `Option` and an `undefined` input have no key: a done actor whose last value was `2`
persists as `{ status: "done", context: 2 }`. The `context` goes through the same context codec
as a machine's context.

### Example

```ts
import { Effect } from "effect"
import { createActor, fromObservable, waitFor, type Subscribable } from "@jambudipa/xstate-effect"

// A source that counts down to 0, then completes
const countdown = (from: number): Subscribable<number> => ({
  subscribe: (observer) => {
    let current = from
    const timer = setInterval(() => {
      observer.next?.(current)
      current -= 1
      if (current < 0) {
        clearInterval(timer)
        observer.complete?.()
      }
    }, 100)
    return { unsubscribe: () => clearInterval(timer) }
  }
})

const countdownLogic = fromObservable(({ input }: { input: { from: number } }) => countdown(input.from))

export const program = Effect.gen(function* () {
  const actor = yield* createActor(countdownLogic, { input: { from: 3 } })
  yield* actor.start
  const done = yield* waitFor(actor, (snapshot) => snapshot.status === "done")
  return done.context // Option.some(0)
})
```

## `fromEventObservable`

### Signature

```ts
import type { EventObject, ObservableActorLogic, Subscribable } from "@jambudipa/xstate-effect"
import type { ObservableActorArgs } from "@jambudipa/xstate-effect/actors"

export declare function fromEventObservable<
  TEvent extends EventObject,
  TInput = unknown,
  TEmitted extends EventObject = EventObject
>(
  lazyObservable: (args: ObservableActorArgs<TInput, TEvent, TEmitted>) => Subscribable<TEvent>
): ObservableActorLogic<TEvent, TInput, TEmitted>
```

The type parameters are in the order `TEvent` (the events that the source emits), `TInput`,
`TEmitted`.

### Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `lazyObservable` | `(args: ObservableActorArgs<TInput, TEvent, TEmitted>) => Subscribable<TEvent>` | required | The function that `start` calls. It receives the fields in [`ObservableActorArgs`](#observableactorargs) and returns a source of event objects. |

### Returns

An `ObservableActorLogic<TEvent, TInput, TEmitted>`.

### Creator argument

The same fields as for [`fromObservable`](#creator-argument), with `self` of type
`ObservableActorRef<TEvent>`.

### Snapshot at each status

As for [`fromObservable`](#snapshot-at-each-status), except that `context` is always
`Option.none()`.

### Behaviour

- `start` calls the creator, then subscribes to the source, in the actor's own scope.
- Each event that the source emits goes to the actor's parent through the system, at once. An
  actor without a parent relays nothing. The snapshot does not change.
- The completion, an error, the stop behaviour, the errors and the persisted form are those of
  [`fromObservable`](#fromobservable).

### Example

```ts
import { assign, fromEventObservable, setup, type Subscribable } from "@jambudipa/xstate-effect"

type ClickEvent = { type: "CLICK"; x: number }

// A source of event objects, such as a wrapper of DOM listeners
declare const clicks: Subscribable<ClickEvent>

const clickLogic = fromEventObservable(() => clicks)

export const clickCounter = setup({
  types: {} as { context: { count: number }; events: ClickEvent },
  actors: { clickLogic }
}).createMachine({
  context: { count: 0 },
  invoke: { id: "clicks", src: "clickLogic" },
  on: {
    // Each event of the source reaches the machine as if it was sent to it
    CLICK: { actions: assign({ count: ({ context }) => context.count + 1 }) }
  }
})
```

## `ObservableActorArgs`

```ts
import type { ActorSystemService, EventObject, ObservableActorRef } from "@jambudipa/xstate-effect"

export interface ObservableActorArgs<TInput, TContext = unknown, TEmitted extends EventObject = EventObject> {
  readonly input: TInput
  readonly system: ActorSystemService
  readonly self: ObservableActorRef<TContext>
  readonly emit: (emitted: TEmitted) => void
}
```

The fields are described in [Creator argument](#creator-argument).

## `Subscribable`

```ts
import type { Observer } from "@jambudipa/xstate-effect"

export interface Subscribable<T> {
  subscribe(observer: Observer<T>): { unsubscribe: () => void }
}
```

| Member | Description |
|---|---|
| `subscribe(observer)` | Starts to deliver values to `observer` and returns the handle that ends the delivery. The actor calls `unsubscribe` at most once, at its stop, and never after the source completed or sent an error. What `subscribe` throws becomes the actor's error. |

## `Observer`

```ts
export type Observer<T> = {
  next?: (value: T) => void
  error?: (err: unknown) => void
  complete?: () => void
}
```

| Member | Description |
|---|---|
| `next` | The source calls it with each value. |
| `error` | The source calls it with an error. The actor ends with status `error`. |
| `complete` | The source calls it when it has no more values. The actor ends with status `done`. |

The actor hands an observer with all three members to the source. Each call works from any
code and delivers at once.

## `ObservableSnapshot`

```ts
import type { Snapshot } from "@jambudipa/xstate-effect"
import type { Option } from "effect"

export interface ObservableSnapshot<TContext, TInput = unknown> extends Snapshot<undefined> {
  readonly context: Option.Option<TContext>
  readonly input: TInput | undefined
}
```

| Field | Type | Description |
|---|---|---|
| `status` | `SnapshotStatus` | See [Snapshot at each status](#snapshot-at-each-status). |
| `output` | `Option.Option<undefined>` | Always `Option.none()`. |
| `error` | `Option.Option<unknown>` | The raw error when the status is `error`. |
| `context` | `Option.Option<TContext>` | The source's last value; `Option.none()` before the first value, and always for `fromEventObservable`. |
| `input` | `TInput \| undefined` | The input while the actor is active; `undefined` once it is done, errored by its source, or stopped. |

`fromStream` produces the same snapshot type; see [fromStream](./from-stream.md).

## `ObservableActorLogic`

`ObservableActorLogic<TContext, TInput = unknown, TEmitted extends EventObject = EventObject>`
is `ActorLogic<ObservableSnapshot<TContext, TInput>, EventObject, TInput, TEmitted>`: logic
whose snapshot is an `ObservableSnapshot`, which accepts any event and takes an input of type
`TInput`.

## `ObservableActorRef`

`ObservableActorRef<TContext>` is `ActorRef<ObservableSnapshot<TContext>, EventObject>`. It is
the type of `self` in the creator.

## Related

- [fromStream](./from-stream.md): the same snapshot from an Effect `Stream`.
- [How to run an Effect or a Stream as an actor](../../how-to/run-an-effect-as-an-actor.md)
- [How to wait for a state or an output](../../how-to/wait-for-a-state.md)
- [createActor and the actor](../create-actor.md): `start`, `stop`, `on` and `emissions`.
- [Snapshots](../snapshots.md) and [Persisted snapshots](../persistence.md)
- [Events](../events.md): `xstate.done.actor.<id>` and `xstate.error.actor.<id>`.
