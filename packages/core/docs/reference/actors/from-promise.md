---
title: fromPromise
doc-type: reference
sources: [packages/core/src/actors/fromPromise.ts]
---

# fromPromise

> **TL;DR:** `fromPromise(creator)` makes actor logic from a function that returns a Promise.
> `start` calls the function and returns while the Promise is pending. A resolve gives status
> `done` with `output` `Option.some(value)`, a rejection gives status `error` with the raw
> reason, and a stop before the Promise settles aborts the creator's `signal`.

## Summary

| Export | Kind | Import from | Description |
|---|---|---|---|
| [`fromPromise`](#frompromise-1) | function | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/actors` | Creates actor logic from a Promise-returning function. |
| [`PromiseActorInput`](#promiseactorinput) | type | `@jambudipa/xstate-effect/actors` | The argument that the creator receives. |
| [`PromiseSnapshot`](#promisesnapshot) | type | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/actors` | The snapshot of a promise actor. |
| [`PromiseActorLogic`](#promiseactorlogic) | type | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/actors` | The logic that `fromPromise` returns. |
| [`PromiseActorRef`](#promiseactorref) | type | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/actors` | A reference to a promise actor, the type of `self`. |

The root entry point also holds every export of this page on its `actors` namespace
(`actors.fromPromise`).

## `fromPromise`

### Signature

```ts
import type { EventObject, PromiseActorLogic } from "@jambudipa/xstate-effect"
import type { PromiseActorInput } from "@jambudipa/xstate-effect/actors"

export declare function fromPromise<TOutput, TInput = unknown, TEmitted extends EventObject = EventObject>(
  promiseCreator: (args: PromiseActorInput<TInput, TOutput, TEmitted>) => PromiseLike<TOutput>
): PromiseActorLogic<TOutput, TInput, TEmitted>
```

The type parameters are in the order `TOutput`, `TInput`, `TEmitted`. TypeScript infers
`TInput` from a type annotation on the creator's parameter, and `TOutput` from the value that
the Promise resolves with.

### Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `promiseCreator` | `(args: PromiseActorInput<TInput, TOutput, TEmitted>) => PromiseLike<TOutput>` | required | The function that `start` calls. It receives the fields in [`PromiseActorInput`](#promiseactorinput). |

### Returns

A `PromiseActorLogic<TOutput, TInput, TEmitted>`. Pass it to `createActor`, to `invoke.src`, to
`spawnChild`, or to the `actors` of `setup`.

### Creator argument

| Field | Type | Description |
|---|---|---|
| `input` | `TInput` | The input that the actor was created with. |
| `system` | `ActorSystemService` | The actor system that the actor belongs to. |
| `self` | `PromiseActorRef<TOutput>` | The promise actor itself. |
| `signal` | `AbortSignal` | Aborted when the actor stops before the Promise settles. Each start has its own signal. |
| `emit` | `(emitted: TEmitted) => void` | Delivers an event to the actor's `on` listeners and its `emissions` stream at once. It works from any code, the creator's synchronous code included. A call after the actor stopped, is done or errored is dropped. |

### Snapshot at each status

| Status | When | `output` | `error` | `input` |
|---|---|---|---|---|
| `active` | From creation until the Promise settles or the actor stops. | `Option.none()` | `Option.none()` | The actor's input. |
| `done` | The Promise resolved. | `Option.some(value)`; `Option.none()` when the value is `undefined`. | `Option.none()` | `undefined` |
| `error` | The Promise rejected. | `Option.none()` | `Option.some(reason)`, the raw rejection reason; `Option.none()` when the reason is `undefined`. | `undefined` |
| `error` | The creator threw before it returned a Promise. | `Option.none()` | `Option.some(thrown)`, the raw thrown value. | The actor's input, kept. |
| `stopped` | The actor stopped before the Promise settled. | `Option.none()` | `Option.none()` | `undefined` |

### Behaviour

- Reading the initial snapshot runs nothing. The creator runs only at `start`.
- `start` calls the creator, then returns while the Promise is pending. The Promise runs in a
  fiber of the actor's own scope.
- When the Promise resolves, the actor sends itself the event `xstate.promise.resolve` and
  ends with status `done`. A parent receives `xstate.done.actor.<id>`, whose `output` is the
  same `Option`.
- When the Promise rejects, the actor sends itself the event `xstate.promise.reject` and ends
  with status `error`. A parent receives `xstate.error.actor.<id>`, whose `error` is the raw
  reason.
- Every other event that the actor receives leaves the snapshot as it is.
- A restored snapshot with status `done` or `error` runs nothing at `start`.

### Stop behaviour

- A stop before the Promise settles aborts `signal` and gives status `stopped` with `input`
  `undefined`. A later resolve or rejection changes nothing.
- A stop after the Promise settled does not abort `signal`.
- When the scope that owns the actor closes without a stop, `signal` is aborted too. The
  snapshot gets status `stopped` and keeps its `input`.

### Errors

| Condition | Result |
|---|---|
| The Promise rejects | Status `error` with the raw reason. The parent receives `xstate.error.actor.<id>`. |
| The creator throws | Status `error` inside `start`, with the raw thrown value. The `input` stays. The parent receives `xstate.error.actor.<id>`. |
| Either error in a root actor that nothing observes | The error is also logged through Effect logging at level Error. |

### Persisted form

`getPersistedSnapshot` gives `{ status, output, error, input }` with plain values. An absent
`Option` and an `undefined` input have no key: an active actor persists as
`{ status: "active", input }`, a done actor as `{ status: "done", output }`.

### Example

```ts
import { Effect } from "effect"
import { createActor, fromPromise, toEffect } from "@jambudipa/xstate-effect"

const double = fromPromise(async ({ input }: { input: { n: number } }) => input.n * 2)

export const program = Effect.gen(function* () {
  const actor = yield* createActor(double, { input: { n: 21 } })
  yield* actor.start
  // The snapshot's `output` once the actor is done
  return yield* toEffect(actor) // Option.some(42)
})
```

## `PromiseActorInput`

```ts
import type { ActorSystemService, EventObject, PromiseActorRef } from "@jambudipa/xstate-effect"

export interface PromiseActorInput<TInput, TOutput = unknown, TEmitted extends EventObject = EventObject> {
  readonly input: TInput
  readonly system: ActorSystemService
  readonly self: PromiseActorRef<TOutput>
  readonly signal: AbortSignal
  readonly emit: (emitted: TEmitted) => void
}
```

The fields are described in [Creator argument](#creator-argument).

## `PromiseSnapshot`

```ts
import type { Snapshot } from "@jambudipa/xstate-effect"

export interface PromiseSnapshot<TOutput, TInput = unknown> extends Snapshot<TOutput> {
  readonly input: TInput | undefined
}
```

| Field | Type | Description |
|---|---|---|
| `status` | `"active" \| "done" \| "error" \| "stopped"` | See [Snapshot at each status](#snapshot-at-each-status). |
| `output` | `Option.Option<TOutput>` | The resolved value when the status is `done`. |
| `error` | `Option.Option<unknown>` | The raw rejection reason or thrown value when the status is `error`. |
| `input` | `TInput \| undefined` | The input while the actor is active; `undefined` once the Promise settled or the actor stopped. |

## `PromiseActorLogic`

`PromiseActorLogic<TOutput, TInput = unknown, TEmitted extends EventObject = EventObject>` is
`ActorLogic<PromiseSnapshot<TOutput, TInput>, EventObject, TInput, TEmitted>`: logic whose
snapshot is a `PromiseSnapshot`, which accepts any event and takes an input of type `TInput`.

## `PromiseActorRef`

`PromiseActorRef<TOutput>` is `ActorRef<PromiseSnapshot<TOutput>, EventObject>`. It is the type
of `self` in the creator.

## Related

- [How to invoke asynchronous work](../../how-to/invoke-async.md)
- [fromEffect, fromEffectBackground and fromEffectRetry](./from-effect.md): the same role for an
  Effect.
- [createActor and the actor](../create-actor.md): `start`, `stop`, `on` and `emissions`.
- [Snapshots](../snapshots.md) and [Persisted snapshots](../persistence.md)
- [Events](../events.md): `xstate.done.actor.<id>` and `xstate.error.actor.<id>`.
- [How failures surface](../../explanation/failure-model.md)
