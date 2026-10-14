---
title: fromStream
doc-type: reference
sources: [packages/core/src/actors/fromObservable.ts]
---

# fromStream

> **TL;DR:** `fromStream` builds actor logic from an Effect `Stream`. The stream runs in the
> actor's own fiber and scope from `start`, and each element becomes `snapshot.context` as
> `Option.some(element)`. The end of the stream gives status `done` with an `output` of
> `Option.none()`; a failure gives status `error`; a stop interrupts the stream.

`fromStream` comes from `@jambudipa/xstate-effect` and from `@jambudipa/xstate-effect/actors`.
`StreamActorArgs` is a named export of `@jambudipa/xstate-effect/actors` only.

## Summary

| Export | Kind | Description |
| --- | --- | --- |
| [`fromStream`](#fromstream-1) | function | Logic that runs a `Stream` and keeps its latest element. |
| [`StreamActorArgs`](#streamactorargs) | interface | The argument of the stream creator: `{ input, system, self }`. |

The snapshot type, `ObservableSnapshot`, and the reference type, `ObservableActorRef`, are the
ones of observable logic: see [fromObservable and fromEventObservable](./from-observable.md).

## fromStream

### Signature

```ts
import type { ActorLogic, EventObject, ObservableSnapshot } from "@jambudipa/xstate-effect"
import type { StreamActorArgs } from "@jambudipa/xstate-effect/actors"
import type { Stream } from "effect"

export declare function fromStream<TInput, TOutput, E, R>(
  streamCreator: (args: StreamActorArgs<TInput, TOutput>) => Stream.Stream<TOutput, E, R>
): ActorLogic<ObservableSnapshot<TOutput, TInput>, EventObject, TInput, never, R>
```

### Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `streamCreator` | `(args: StreamActorArgs<TInput, TOutput>) => Stream<TOutput, E, R>` | Required. Receives `{ input, system, self }` and returns the stream to run. The annotation of `input` gives `TInput`. |

### Return value

An `ActorLogic<ObservableSnapshot<TOutput, TInput>, EventObject, TInput, never, R>`. The logic
emits no events (`never`), and the failure type `E` is not part of its type.

### Behaviour

- **Initial snapshot.** Status `active`; `context`, `output` and `error` `Option.none()`; `input`
  the actor's input. Creating the actor runs nothing.
- **Start.** `start` calls the creator once and runs the stream in a fiber of the actor's own
  scope. `start` returns while the stream runs.
- **Elements.** Each element reaches the actor through its own event processing and becomes
  `snapshot.context` as `Option.some(element)`, or `Option.none()` for `undefined`. Each element
  publishes a new snapshot.
- **End.** The end of the stream gives status `done` with `output` `Option.none()`. The
  `context` keeps the last element. A parent receives one `xstate.done.actor.<id>`, whose
  `output` is `Option.none()`.
- **Failure.** A failure or a defect of the stream, or a throw in the creator, gives status
  `error` with `snapshot.error` `Option.some(raw value)`. The `context` keeps the last element. A
  parent receives one `xstate.error.actor.<id>`, whose `error` is the raw value.
- **Stop.** `stop`, or a parent that stops the child, interrupts the stream, so its finalizers
  run once, and gives status `stopped`. The close of the scope that owns the actor interrupts it
  in the same way.
- **Input.** A `done`, `error` or `stopped` snapshot has `input` `undefined`.
- **Events.** An event sent to the actor changes nothing.
- **Parent snapshots.** As an invoked child with `onSnapshot`, the actor sends its parent each
  active snapshot: first the initial one with `context` `None`, then one for each element.
- **Requirements.** The stream's requirements `R` are the logic's. `createActor` requires them
  of its caller.
- **Persistence.** `getPersistedSnapshot` gives `{ status, output, error, context, input }` as plain
  values; a field that is `None` or `undefined` is left out. A restored `active` snapshot runs the
  stream again from its first element at `start`, with the restored input. A restored `done`
  snapshot runs nothing.

### Example

```ts
import { assign, fromStream, setup } from "@jambudipa/xstate-effect"
import { Option, Schedule, Stream } from "effect"

const temperatures = fromStream(({ input }: { input: { readings: number } }) =>
  Stream.range(1, input.readings).pipe(
    Stream.map((reading) => 18 + reading / 10),
    Stream.schedule(Schedule.spaced("1 second"))
  )
)

export const thermostat = setup({
  types: {} as { context: { latest: Option.Option<number> } },
  actors: { temperatures }
}).createMachine({
  context: { latest: Option.none() },
  initial: "sampling",
  states: {
    sampling: {
      invoke: {
        src: "temperatures",
        input: { readings: 5 },
        // event.snapshot.context is the latest element, as an Option
        onSnapshot: { actions: assign({ latest: ({ event }) => event.snapshot.context }) },
        onDone: "finished",
        onError: "failed"
      }
    },
    finished: {},
    failed: {}
  }
})
```

## StreamActorArgs

`StreamActorArgs<TInput, TOutput = unknown>`: the argument that the stream creator receives.

| Field | Type | Description |
| --- | --- | --- |
| `input` | `TInput` | The actor's input. |
| `system` | `ActorSystemService` | The actor system that the actor belongs to. See [The actor system](../actor-system.md). |
| `self` | `ObservableActorRef<TOutput>` | The stream actor itself. |

The argument has no `emit`: a stream actor emits no events.

### Example

```ts
import { fromStream, type StreamActorArgs } from "@jambudipa/xstate-effect/actors"
import { Stream } from "effect"

const countdown = ({ input }: StreamActorArgs<{ from: number }, number>) =>
  Stream.range(0, input.from).pipe(Stream.map((step) => input.from - step))

export const countdownLogic = fromStream(countdown)
```

## Related

- [How to run an Effect or a Stream as an actor](../../how-to/run-an-effect-as-an-actor.md)
- [fromObservable and fromEventObservable](./from-observable.md): `ObservableSnapshot` and the
  logic for an Observable-like source.
- [fromEffect, fromEffectBackground and fromEffectRetry](./from-effect.md): the same model for a
  single Effect.
- [createActor and the actor](../create-actor.md): `subscribe`, `changes` and `stop`.
- [Persisted snapshots](../persistence.md)
