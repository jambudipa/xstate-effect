---
title: waitFor, toEffect and toPromise
doc-type: reference
sources: [packages/core/src/testing/waitFor.ts, packages/core/src/testing/toPromise.ts]
---

# waitFor, toEffect and toPromise

> **TL;DR:** `waitFor(actor, predicate, options?)` returns an Effect that succeeds with the first
> snapshot that satisfies the predicate: the current one, or a later one. `toEffect(actor)`
> returns an Effect that succeeds with the actor's `output`, an `Option`, once the actor is done
> or stopped. Both fail with the actor's own error when the actor errors. `waitForPromise` and
> `toPromise` are the Promise forms.

All names on this page come from `@jambudipa/xstate-effect`, by name and in the `testing`
namespace.

## Summary

| Name | Kind | Summary |
| --- | --- | --- |
| [`waitFor`](#waitfor) | function | Waits for a snapshot that satisfies a predicate. Returns `Effect.Effect<TSnapshot, unknown>`. |
| [`waitForPromise`](#waitforpromise) | function | The Promise form of `waitFor`. |
| [`toEffect`](#toeffect) | function | Waits for the actor to end. Returns `Effect.Effect<TSnapshot["output"], unknown>`. |
| [`toPromise`](#topromise) | function | The Promise form of `toEffect`. |
| [`WaitForOptions`](#waitforoptions) | type | The `timeout` and `signal` options of `waitFor`. |
| [`WaitForTimeoutError`](#waitfortimeouterror) | error | The `timeout` elapsed first. |
| [`WaitForTerminatedError`](#waitforterminatederror) | error | The actor was done or stopped first. |
| [`ActorOutputError`](#actoroutputerror) | error | Exported; no function of the package fails with it. |

## waitFor

```ts
import type { Effect } from "effect"
import type { Actor, EventObject, Snapshot, WaitForOptions } from "@jambudipa/xstate-effect"

export declare function waitFor<
  TSnapshot extends Snapshot,
  TEvent extends EventObject,
  TEmitted extends EventObject = EventObject
>(
  actor: Actor.Actor<TSnapshot, TEvent, TEmitted>,
  predicate: (snapshot: TSnapshot) => boolean,
  options?: WaitForOptions
): Effect.Effect<TSnapshot, unknown>
```

### Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `actor` | `Actor.Actor<TSnapshot, TEvent, TEmitted>` | The actor to watch. |
| `predicate` | `(snapshot: TSnapshot) => boolean` | The condition that the snapshot must satisfy. |
| `options` | [`WaitForOptions`](#waitforoptions) | Optional: `timeout` and `signal`. |

### Returns

An Effect that succeeds with the first snapshot that satisfies `predicate`.

**Fails with:** the error channel is `unknown`.

| Condition | Failure |
| --- | --- |
| The `signal` is already aborted when the Effect runs. | The signal's `reason`, before any other check. |
| The actor is done or stopped before a snapshot satisfies the predicate, also when it has ended before the call. | `WaitForTerminatedError` |
| The actor errors first. | The actor's own error. |
| The `timeout` elapses first. | `WaitForTimeoutError` |
| The `signal` aborts first. | The signal's `reason`. |

**Requires:** nothing.

### Behaviour

- The checks run in this order: an aborted `signal`, then the current snapshot. When the current
  snapshot satisfies the predicate, the Effect succeeds with it at once. It does not read the
  actor's `changes` and does not listen to the signal.
- Otherwise it reads the actor's `changes` stream and succeeds with the first later snapshot that
  satisfies the predicate. A snapshot with status `stopped` is never checked.
- The `timeout` runs on the Effect clock. Under `TestClock`, as in `it.effect` of
  `@effect/vitest`, it elapses only when the test adjusts that clock. A `SimulatedClock` given to
  the actor does not move it.
- A negative `timeout` writes this message to the logger at error level:
  ``"`timeout` passed to `waitFor` is negative and it will reject its internal promise immediately."``
  The Effect then fails at once, unless the current snapshot satisfies the predicate.
- The stream runs in the caller's fiber. However the Effect ends, it leaves no fiber,
  subscription or `abort` listener behind.
- Nothing happens until the Effect runs.

### Example

```ts
import { Duration, Effect } from "effect"
import { createActor, createMachine, fromPromise, waitFor } from "@jambudipa/xstate-effect"

const loader = createMachine({
  initial: "loading",
  states: {
    loading: { invoke: { src: fromPromise(() => Promise.resolve(42)), onDone: "ready" } },
    ready: {}
  }
})

export const program = Effect.gen(function* () {
  const actor = yield* createActor(loader)
  yield* actor.start
  const snapshot = yield* waitFor(actor, (current) => current.matches("ready"), {
    timeout: Duration.seconds(5)
  })
  return snapshot.value // "ready"
})

export const run = () => Effect.runPromise(Effect.scoped(program))
```

## waitForPromise

```ts
import type { Actor, EventObject, Snapshot } from "@jambudipa/xstate-effect"

export declare function waitForPromise<
  TSnapshot extends Snapshot,
  TEvent extends EventObject,
  TEmitted extends EventObject = EventObject
>(
  actor: Actor.Actor<TSnapshot, TEvent, TEmitted>,
  predicate: (snapshot: TSnapshot) => boolean,
  options?: { readonly timeout?: number; readonly signal?: AbortSignal }
): Promise<TSnapshot>
```

### Parameters

The parameters of [`waitFor`](#waitfor), except that `timeout` is a number of milliseconds.

### Returns

A Promise that runs `waitFor` with `Effect.runPromise`. It resolves with the snapshot that
`waitFor` succeeds with, and rejects with what `waitFor` fails with: the
`WaitForTimeoutError` or `WaitForTerminatedError` instance, the actor's own error, or the
signal's reason.

### Example

```ts
import { Effect } from "effect"
import { createActor, createMachine, fromPromise, waitForPromise } from "@jambudipa/xstate-effect"

const loader = createMachine({
  initial: "loading",
  states: {
    loading: { invoke: { src: fromPromise(() => Promise.resolve(42)), onDone: "ready" } },
    ready: {}
  }
})

export const program = Effect.gen(function* () {
  const actor = yield* createActor(loader)
  yield* actor.start
  // For code that works with Promises: the actor is the one this program created
  const snapshot = yield* Effect.promise(() =>
    waitForPromise(actor, (current) => current.matches("ready"), { timeout: 5000 })
  )
  return snapshot.value // "ready"
})
```

## toEffect

```ts
import type { Effect, Stream } from "effect"
import type { Snapshot } from "@jambudipa/xstate-effect"

// What `toEffect` reads from an actor; every actor fits it
interface SnapshotSource<TSnapshot extends Snapshot> {
  readonly getSnapshot: Effect.Effect<TSnapshot>
  readonly changes: Stream.Stream<TSnapshot, unknown>
}

export declare function toEffect<TSnapshot extends Snapshot>(
  actor: SnapshotSource<TSnapshot>
): Effect.Effect<TSnapshot["output"], unknown>
```

### Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `actor` | an actor | Any actor, or any value with the actor's `getSnapshot` and `changes`. The package does not export the name `SnapshotSource`. |

### Returns

An Effect that succeeds with the `output` of the actor's snapshot once the actor's `changes`
stream ends. The value is an `Option`: `Option.some(output)` for an actor that is done, and
`Option.none()` for an actor that is stopped.

**Fails with:** the actor's own error, when the actor errors, also when it errored before the
call. The error channel is `unknown`.

**Requires:** nothing.

### Behaviour

- An actor that has ended before the call gives its result at once.
- An actor that has not started yet is waited for until it ends.
- An actor that is stopped, also before `start`, gives `Option.none()`. XState's `toPromise`
  waits for ever on such an actor.
- The stream runs in the caller's fiber. Nothing of it remains once the Effect completes.

### Example

```ts
import { Effect, Option } from "effect"
import { createActor, fromPromise, toEffect } from "@jambudipa/xstate-effect"

export const program = Effect.gen(function* () {
  const actor = yield* createActor(fromPromise(() => Promise.resolve(42)))
  yield* actor.start
  const output = yield* toEffect(actor) // Option.some(42)
  return Option.getOrElse(output, () => 0)
})

export const run = () => Effect.runPromise(Effect.scoped(program))
```

## toPromise

```ts
import type { Effect, Stream } from "effect"
import type { Snapshot } from "@jambudipa/xstate-effect"

// What `toPromise` reads from an actor; every actor fits it
interface SnapshotSource<TSnapshot extends Snapshot> {
  readonly getSnapshot: Effect.Effect<TSnapshot>
  readonly changes: Stream.Stream<TSnapshot, unknown>
}

export declare function toPromise<TSnapshot extends Snapshot>(
  actor: SnapshotSource<TSnapshot>
): Promise<TSnapshot["output"]>
```

### Returns

A Promise that runs `toEffect` with `Effect.runPromise`. It resolves with the `Option` that
`toEffect` succeeds with, and rejects with the actor's own error.

### Example

```ts
import { Effect } from "effect"
import { createActor, fromPromise, toPromise } from "@jambudipa/xstate-effect"

export const program = Effect.gen(function* () {
  const actor = yield* createActor(fromPromise(() => Promise.resolve("done")))
  yield* actor.start
  return yield* Effect.promise(() => toPromise(actor)) // Option.some("done")
})
```

## WaitForOptions

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `timeout` | `Duration.Input` | `Duration.infinity` | How long to wait before the Effect fails with `WaitForTimeoutError`, on the Effect clock. A number is milliseconds. |
| `signal` | `AbortSignal` | none | Ends the wait when it aborts: the Effect fails with the signal's `reason`. |

## WaitForTimeoutError

```ts
import { Data } from "effect"

export declare class WaitForTimeoutError extends Data.TaggedError("WaitForTimeoutError")<{
  readonly timeout: number
}> {
  get message(): string
}
```

| Field | Type | Description |
| --- | --- | --- |
| `_tag` | `"WaitForTimeoutError"` | |
| `timeout` | `number` | The timeout in milliseconds. |
| `message` | `string` | `Timeout of <timeout> ms exceeded`. |

## WaitForTerminatedError

```ts
import { Data } from "effect"

export declare class WaitForTerminatedError extends Data.TaggedError("WaitForTerminatedError")<{}> {
  get message(): string
}
```

| Field | Type | Description |
| --- | --- | --- |
| `_tag` | `"WaitForTerminatedError"` | |
| `message` | `string` | `Actor terminated without satisfying predicate`. |

## ActorOutputError

```ts
import { Data } from "effect"

export declare class ActorOutputError extends Data.TaggedError("ActorOutputError")<{
  readonly cause: unknown
}> {
  get message(): string
}
```

| Field | Type | Description |
| --- | --- | --- |
| `_tag` | `"ActorOutputError"` | |
| `cause` | `unknown` | The value given at construction. |
| `message` | `string` | `Actor errored before producing output`. |

No function of the package fails with `ActorOutputError`. `toEffect` and `toPromise` fail with
the actor's own error.

## Related

- [How to wait for a state or an output](../../how-to/wait-for-a-state.md)
- [Test your machine](../../tutorials/07-testing.md)
- [createActor and the actor](../create-actor.md): the `changes` stream and `getSnapshot`.
- [Snapshots](../snapshots.md): `status`, `output` and `error`.
- [SimulatedClock](./simulated-clock.md)
- [How to handle actor errors](../../how-to/handle-actor-errors.md)
