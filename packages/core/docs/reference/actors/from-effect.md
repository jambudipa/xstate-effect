---
title: fromEffect, fromEffectBackground and fromEffectRetry
doc-type: reference
sources: [packages/core/src/actors/fromEffect.ts]
---

# fromEffect, fromEffectBackground and fromEffectRetry

> **TL;DR:** These three functions build actor logic from an Effect. The Effect runs in the
> actor's own fiber and scope from `start`, and a stop interrupts it. With `fromEffect` the
> actor is `done` with the success as an `Option` output; `fromEffectBackground` stays `active`
> until it stops or fails; `fromEffectRetry` retries typed failures on a `Schedule`. A failure
> gives status `error` with the raw value.

`fromEffect`, `fromEffectBackground`, `EffectSnapshot`, `EffectActorLogic` and `EffectActorRef`
come from `@jambudipa/xstate-effect` and from `@jambudipa/xstate-effect/actors`.
`fromEffectRetry` and `EffectActorArgs` are named exports of `@jambudipa/xstate-effect/actors`
only; the root entry point reaches them through its `actors` namespace (`actors.fromEffectRetry`).

## Summary

| Export | Kind | Description |
| --- | --- | --- |
| [`fromEffect`](#fromeffect) | function | Logic that runs an Effect and is `done` with its success. |
| [`fromEffectBackground`](#fromeffectbackground) | function | Logic that runs an Effect and stays `active` when it returns. |
| [`fromEffectRetry`](#fromeffectretry) | function | `fromEffect` with `Effect.retry` on a `Schedule`. |
| [`EffectActorArgs`](#effectactorargs) | interface | The argument of the effect creator: `{ input, system, self, emit }`. |
| [`EffectSnapshot`](#effectsnapshot) | interface | The snapshot of an effect actor. |
| [`EffectActorLogic`](#effectactorlogic) | type | The logic that the three functions return. |
| [`EffectActorRef`](#effectactorref) | type | The type of `self` in the effect creator. |

## fromEffect

### Signature

```ts
import type { EventObject } from "@jambudipa/xstate-effect"
import type { EffectActorArgs, EffectActorLogic } from "@jambudipa/xstate-effect/actors"
import type { Effect } from "effect"

export declare function fromEffect<TInput, TOutput, E, R, TEmitted extends EventObject = EventObject>(
  effectCreator: (args: EffectActorArgs<TInput, TOutput, TEmitted>) => Effect.Effect<TOutput, E, R>
): EffectActorLogic<TOutput, TInput, TEmitted, R>
```

### Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `effectCreator` | `(args: EffectActorArgs<TInput, TOutput, TEmitted>) => Effect<TOutput, E, R>` | Required. Receives `{ input, system, self, emit }` and returns the Effect to run. The annotation of `input` gives `TInput`; the annotation of `emit` gives `TEmitted`. |

### Return value

An `EffectActorLogic<TOutput, TInput, TEmitted, R>`. The failure type `E` is not part of the
logic's type: a failure reaches `snapshot.error` as `unknown`.

### Behaviour

- **Initial snapshot.** Status `active`, `output` and `error` `Option.none()`, and `input` the
  actor's input. Creating the actor or reading the snapshot runs nothing.
- **Start.** `start` calls the creator once and runs the Effect in a fiber of the actor's own
  scope. `start` returns while the Effect runs. The result reaches the snapshot through the
  actor's own event processing.
- **Success.** Status `done`, with `output` `Option.some(value)`, or `Option.none()` for
  `undefined`. A parent receives `xstate.done.actor.<id>`, whose `output` is the same `Option`.
- **Failure.** A typed failure, a defect, or a throw in the creator gives status `error`, with
  `snapshot.error` `Option.some(raw value)`. A parent receives `xstate.error.actor.<id>`, whose
  `error` is the raw value.
- **Stop.** `stop`, or a parent that stops the child, interrupts the Effect, so its finalizers
  run, and gives status `stopped`. No done event is sent. The close of the scope that owns the
  actor interrupts the Effect in the same way.
- **Input.** A `done`, `error` or `stopped` snapshot has `input` `undefined`.
- **Events.** An event sent to the actor changes nothing.
- **Requirements.** The Effect's requirements `R` are the logic's. `createActor` requires them
  of its caller, and the Effect reads them at `start`.
- **Persistence.** `getPersistedSnapshot` gives `{ status, output, error, input }` as plain values;
  a field that is `None` or `undefined` is left out. A restored `active` snapshot runs the Effect
  again at `start`, with the restored input. A restored `done` snapshot runs nothing.

### Example

```ts
import { assign, fromEffect, setup } from "@jambudipa/xstate-effect"
import { Effect, Option } from "effect"

const loadUser = fromEffect(({ input }: { input: { userId: string } }) =>
  Effect.succeed({ id: input.userId, name: "Ada" }).pipe(Effect.delay("50 millis"))
)

export const userMachine = setup({
  types: {} as {
    context: { userId: string; name: Option.Option<string> }
  },
  actors: { loadUser }
}).createMachine({
  context: { userId: "u-1", name: Option.none() },
  initial: "loading",
  states: {
    loading: {
      invoke: {
        src: "loadUser",
        input: ({ context }) => ({ userId: context.userId }),
        onDone: {
          target: "ready",
          // event.output is an Option of the Effect's success
          actions: assign({ name: ({ event }) => Option.map(event.output, (user) => user.name) })
        },
        onError: "failed"
      }
    },
    ready: {},
    failed: {}
  }
})
```

## fromEffectBackground

### Signature

```ts
import type { EventObject } from "@jambudipa/xstate-effect"
import type { EffectActorArgs, EffectActorLogic } from "@jambudipa/xstate-effect/actors"
import type { Effect } from "effect"

export declare function fromEffectBackground<TInput, TOutput, E, R, TEmitted extends EventObject = EventObject>(
  effectCreator: (args: EffectActorArgs<TInput, undefined, TEmitted>) => Effect.Effect<TOutput, E, R>
): EffectActorLogic<undefined, TInput, TEmitted, R>
```

### Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `effectCreator` | `(args: EffectActorArgs<TInput, undefined, TEmitted>) => Effect<TOutput, E, R>` | Required. Receives `{ input, system, self, emit }` and returns the Effect to run. Its success value is ignored. |

### Return value

An `EffectActorLogic<undefined, TInput, TEmitted, R>`: the output type is `undefined`.

### Behaviour

As `fromEffect`, with these differences:

- **Success.** The success of the Effect changes nothing. The actor stays `active` and keeps its
  `input`, and its `output` stays `Option.none()`.
- **End.** Only a stop, the close of the owning scope, or a failure ends the actor. It never
  reaches status `done`, so a parent receives no done event from it.
- **Failure.** A typed failure, a defect, or a throw in the creator gives status `error` with the
  raw value. A parent receives `xstate.error.actor.<id>`.

### Example

```ts
import { fromEffectBackground, setup } from "@jambudipa/xstate-effect"
import { Effect, Schedule } from "effect"

const heartbeat = fromEffectBackground(({ input }: { input: { intervalMs: number } }) =>
  Effect.logInfo("heartbeat").pipe(Effect.repeat(Schedule.spaced(input.intervalMs)))
)

export const connectionMachine = setup({
  types: {} as { events: { type: "CONNECT" } | { type: "DISCONNECT" } },
  actors: { heartbeat }
}).createMachine({
  initial: "offline",
  states: {
    offline: { on: { CONNECT: "online" } },
    online: {
      // Runs while the state is active; leaving the state stops the child and interrupts the Effect
      invoke: { src: "heartbeat", input: { intervalMs: 30_000 } },
      on: { DISCONNECT: "offline" }
    }
  }
})
```

## fromEffectRetry

### Signature

```ts
import type { EventObject } from "@jambudipa/xstate-effect"
import type { EffectActorArgs, EffectActorLogic } from "@jambudipa/xstate-effect/actors"
import type { Effect, Schedule } from "effect"

export declare function fromEffectRetry<TInput, TOutput, E, R, O, SE, SR, TEmitted extends EventObject = EventObject>(
  effectCreator: (args: EffectActorArgs<TInput, TOutput, TEmitted>) => Effect.Effect<TOutput, E, R>,
  schedule: Schedule.Schedule<O, NoInfer<E>, SE, SR>
): EffectActorLogic<TOutput, TInput, TEmitted, R | SR>
```

### Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `effectCreator` | `(args: EffectActorArgs<TInput, TOutput, TEmitted>) => Effect<TOutput, E, R>` | Required. As for `fromEffect`. |
| `schedule` | `Schedule<O, E, SE, SR>` | Required. The retry policy, passed to `Effect.retry`. Its input is the Effect's failure `E`. |

### Return value

An `EffectActorLogic<TOutput, TInput, TEmitted, R | SR>`: the services that the schedule needs
join the logic's requirements.

### Behaviour

As `fromEffect`, with the Effect wrapped in `Effect.retry(effect, schedule)`:

- **Creator.** The creator runs once, at `start`. Each retry runs the Effect that it returned
  again.
- **Attempts.** The first attempt always runs. After each typed failure the schedule decides
  whether another attempt follows: `Schedule.recurs(3)` allows three retries after the first
  attempt.
- **Success.** The first success gives status `done` with the output.
- **Failure.** When the schedule ends while the Effect still fails, the actor gets status
  `error` with the last failure. A defect, or a throw in the creator, is not retried: it gives
  status `error` at once.
- **Stop.** A stop interrupts the running attempt, or the wait between two attempts. No attempt
  follows.

### Example

```ts
import { createActor, toEffect } from "@jambudipa/xstate-effect"
import { fromEffectRetry } from "@jambudipa/xstate-effect/actors"
import { Data, Effect, Option, Random, Schedule } from "effect"

class Unavailable extends Data.TaggedError("Unavailable")<{ readonly symbol: string }> {}

const fetchQuote = fromEffectRetry(
  ({ input }: { input: { symbol: string } }) =>
    Effect.flatMap(Random.next, (roll) =>
      roll < 0.5 ? Effect.fail(new Unavailable({ symbol: input.symbol })) : Effect.succeed({ symbol: input.symbol, price: 101.5 })
    ),
  // Up to three retries after the first attempt, 100 ms, 200 ms, then 400 ms apart
  Schedule.exponential("100 millis").pipe(Schedule.upTo({ times: 3 }))
)

const program = Effect.gen(function* () {
  const actor = yield* createActor(fetchQuote, { input: { symbol: "EQU" } })
  yield* actor.start
  // Fails with the last Unavailable when every attempt fails
  const quote = yield* toEffect(actor)
  yield* Effect.log(Option.map(quote, (q) => q.price))
})

void Effect.runPromise(Effect.scoped(program))
```

## EffectActorArgs

`EffectActorArgs<TInput, TOutput = unknown, TEmitted extends EventObject = EventObject>`: the
argument that the effect creator receives.

| Field | Type | Description |
| --- | --- | --- |
| `input` | `TInput` | The actor's input. |
| `system` | `ActorSystemService` | The actor system that the actor belongs to. See [The actor system](../actor-system.md). |
| `self` | `EffectActorRef<TOutput>` | The effect actor itself. |
| `emit` | `(emitted: TEmitted) => Effect<void>` | Returns an Effect that delivers the event to the actor's `on` listeners and its `emissions` stream at once, in call order. |

### Example

```ts
import { createActor } from "@jambudipa/xstate-effect"
import { fromEffect, type EffectActorArgs } from "@jambudipa/xstate-effect/actors"
import { Effect } from "effect"

interface Progress {
  readonly type: "progress"
  readonly percent: number
}

const work = ({ emit }: EffectActorArgs<void, string, Progress>) =>
  Effect.gen(function* () {
    yield* emit({ type: "progress", percent: 50 })
    yield* emit({ type: "progress", percent: 100 })
    return "finished"
  })

export const program = Effect.gen(function* () {
  const actor = yield* createActor(fromEffect(work))
  yield* actor.on("progress", (event) => Effect.log(`${event.percent}%`))
  yield* actor.start
})
```

## EffectSnapshot

`EffectSnapshot<TOutput, TInput = unknown>` extends `Snapshot<TOutput>`.

| Field | Type | Description |
| --- | --- | --- |
| `status` | `"active" \| "done" \| "error" \| "stopped"` | The actor's status. |
| `output` | `Option<TOutput>` | `Some` of the success value once `done`; `None` before, and for an `undefined` success. Always `None` for `fromEffectBackground`. |
| `error` | `Option<unknown>` | `Some` of the raw failure once `error`; `None` otherwise. |
| `input` | `TInput \| undefined` | The input while `active`; `undefined` once `done`, `error` or `stopped`. |

### Example

```ts
import type { EffectSnapshot } from "@jambudipa/xstate-effect"
import { Option } from "effect"

export const describe = (snapshot: EffectSnapshot<number, { n: number }>): string =>
  snapshot.status === "done"
    ? `result ${Option.getOrElse(snapshot.output, () => 0)}`
    : snapshot.status
```

## EffectActorLogic

`EffectActorLogic<TOutput, TInput = unknown, TEmitted extends EventObject = EventObject, R = never>`
is `ActorLogic<EffectSnapshot<TOutput, TInput>, EventObject, TInput, TEmitted, R>`. `R` is what
the Effect, and for `fromEffectRetry` the schedule, requires. See
[Custom actor logic and createEmptyActor](./custom-logic.md) for the `ActorLogic` contract.

### Example

```ts
import { fromEffect, type EffectActorLogic } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

export const ping: EffectActorLogic<"pong", void> = fromEffect(() => Effect.succeed("pong" as const))
```

## EffectActorRef

`EffectActorRef<TOutput>` is `ActorRef<EffectSnapshot<TOutput>, EventObject>`: the type of `self`
in the effect creator. See [Actor references](../actor-refs.md).

### Example

```ts
import type { EffectActorRef } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

export const currentStatus = (self: EffectActorRef<number>) =>
  Effect.map(self.getSnapshot, (snapshot) => snapshot.status)
```

## Related

- [How to run an Effect or a Stream as an actor](../../how-to/run-an-effect-as-an-actor.md)
- [How to invoke asynchronous work](../../how-to/invoke-async.md)
- [How to retry a failing service](../../how-to/retry-pattern.md)
- [How to give a machine's actions and actors Effect services](../../how-to/provide-services-to-a-machine.md)
- [fromStream](./from-stream.md): the same model for an Effect `Stream`.
- [fromPromise](./from-promise.md): the Promise counterpart of `fromEffect`.
- [createActor and the actor](../create-actor.md)
- [How failures surface](../../explanation/failure-model.md)
