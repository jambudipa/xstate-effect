---
title: fromCallback
doc-type: reference
sources: [packages/core/src/actors/fromCallback.ts]
---

# fromCallback

> **TL;DR:** `fromCallback(callback)` makes actor logic from a function that runs at `start`.
> The callback sends events to the parent with `sendBack`, listens to the events that the
> actor receives with `receive`, and may return a cleanup function, which runs once when the
> actor stops. A callback actor never reaches status `done`: it is `active` until it stops or
> errors.

## Summary

| Export | Kind | Import from | Description |
|---|---|---|---|
| [`fromCallback`](#fromcallback-1) | function | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/actors` | Creates actor logic from a callback. |
| [`CallbackLogicFunction`](#callbacklogicfunction) | type | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/actors` | The type of the callback. |
| [`CallbackActorArgs`](#callbackactorargs) | type | `@jambudipa/xstate-effect/actors` | The argument that the callback receives. |
| [`CallbackSnapshot`](#callbacksnapshot) | type | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/actors` | The snapshot of a callback actor. |
| [`CallbackActorLogic`](#callbackactorlogic) | type | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/actors` | The logic that `fromCallback` returns. |
| [`CallbackActorRef`](#callbackactorref) | type | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/actors` | A reference to a callback actor, the type of `self`. |

The root entry point also holds every export of this page on its `actors` namespace
(`actors.fromCallback`).

## `fromCallback`

### Signature

```ts
import type { AnyEventObject, CallbackActorLogic, CallbackLogicFunction, EventObject } from "@jambudipa/xstate-effect"

export declare function fromCallback<
  TEvent extends EventObject = EventObject,
  TInput = unknown,
  TEmitted extends EventObject = EventObject
>(
  callback: CallbackLogicFunction<TEvent, AnyEventObject, TInput, TEmitted>
): CallbackActorLogic<TEvent, TInput, TEmitted>
```

The type parameters are in the order `TEvent` (the events that the actor receives), `TInput`,
`TEmitted`. Give them explicitly, or annotate the callback's parameter.

### Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `callback` | `CallbackLogicFunction<TEvent, AnyEventObject, TInput, TEmitted>` | required | The function that `start` calls with the fields in [`CallbackActorArgs`](#callbackactorargs). It returns a cleanup function, or nothing. |

### Returns

A `CallbackActorLogic<TEvent, TInput, TEmitted>`. Pass it to `createActor`, to `invoke.src`, to
`spawnChild`, or to the `actors` of `setup`.

### Callback argument

| Field | Type | Description |
|---|---|---|
| `input` | `TInput` | The input that the actor was created with, also for a restored snapshot. |
| `system` | `ActorSystemService` | The actor system that the actor belongs to. |
| `self` | `CallbackActorRef<TEvent>` | The callback actor itself. |
| `sendBack` | `(event: AnyEventObject) => void` | Sends the event to the actor's parent through the system, at once, from any code (a timer or a listener included). It accepts an event with any members. An actor without a parent sends nothing. A call after the stop does nothing. |
| `receive` | `(listener: (event: TEvent) => void) => void` | Adds a listener for the events that the actor receives. Each event reaches every listener once, in the order the listeners were added. The same listener added twice runs once per event. |
| `emit` | `(emitted: TEmitted) => void` | Delivers an event to the actor's `on` listeners and its `emissions` stream at once, from any code. A call after the stop is dropped. |

### Snapshot at each status

| Status | When | `output` | `error` | `input` |
|---|---|---|---|---|
| `active` | From creation until the actor stops or errors. | `Option.none()` | `Option.none()` | The actor's input. |
| `error` | The callback or a listener threw. | `Option.none()` | `Option.some(thrown)`, the raw thrown value. | The actor's input. |
| `stopped` | The actor stopped. | `Option.none()` | `Option.none()` | The actor's input, kept. |

A callback actor never has status `done`, and its `output` is always `Option.none()`.

### Behaviour

- `start` calls the callback once, in the actor's own scope.
- Each event that the actor receives goes to every `receive` listener and leaves the snapshot
  as it is.
- `sendBack` and `emit` deliver at once: they never wait for the actor's next event.

### Stop behaviour

- A stop clears the listeners, then runs the cleanup, then gives status `stopped`. A `sendBack`
  in the cleanup still reaches the parent.
- The cleanup runs once, whatever ends the actor: `stop`, the exit of the state that invoked
  it, the stop of its parent, the close of the scope that owns it, or an error.
- No listener runs after the cleanup. Later `sendBack` and `emit` calls do nothing.
- When the scope that owns the actor closes without a stop, the cleanup runs as the scope
  closes and the snapshot gets status `stopped`.

### Errors

| Condition | Result |
|---|---|
| The callback throws | Status `error` with the raw thrown value. The parent receives `xstate.error.actor.<id>`. |
| A `receive` listener throws | Status `error` with the raw thrown value; the snapshot is otherwise unchanged. The cleanup runs. The parent receives `xstate.error.actor.<id>`. |
| The cleanup throws | The value is logged through Effect logging at level Error. The stop completes and the status is `stopped`. |
| Either error in a root actor that nothing observes | The error is also logged through Effect logging at level Error. |

### Persisted form

`getPersistedSnapshot` gives `{ status, output, error, input }` with plain values. An absent
`Option` has no key: an active or stopped actor persists as `{ status, input }`.

### Example

```ts
import { assign, forwardTo, fromCallback, setup } from "@jambudipa/xstate-effect"

type TickerEvent = { type: "PAUSE" } | { type: "RESUME" }

const ticker = fromCallback<TickerEvent, { intervalMs: number }>(({ input, receive, sendBack }) => {
  let paused = false
  const timer = setInterval(() => {
    if (!paused) {
      sendBack({ type: "TICK" })
    }
  }, input.intervalMs)
  receive((event) => {
    paused = event.type === "PAUSE"
  })
  // Runs once when the actor stops
  return () => clearInterval(timer)
})

export const clock = setup({
  types: {} as {
    context: { ticks: number }
    events: { type: "TICK" } | TickerEvent
  },
  actors: { ticker }
}).createMachine({
  context: { ticks: 0 },
  invoke: { id: "ticker", src: "ticker", input: { intervalMs: 1000 } },
  on: {
    TICK: { actions: assign({ ticks: ({ context }) => context.ticks + 1 }) },
    PAUSE: { actions: forwardTo("ticker") },
    RESUME: { actions: forwardTo("ticker") }
  }
})
```

## `CallbackLogicFunction`

```ts
import type { AnyEventObject, EventObject } from "@jambudipa/xstate-effect"
import type { CallbackActorArgs } from "@jambudipa/xstate-effect/actors"

export type CallbackLogicFunction<
  TEvent extends EventObject = EventObject,
  TSentEvent extends EventObject = AnyEventObject,
  TInput = unknown,
  TEmitted extends EventObject = EventObject
> = (args: CallbackActorArgs<TEvent, TInput, TEmitted, TSentEvent>) => (() => void) | void
```

`TSentEvent` is the type of the events that `sendBack` accepts. `fromCallback` fixes it to
`AnyEventObject`.

## `CallbackActorArgs`

```ts
import type { AnyEventObject, ActorSystemService, CallbackActorRef, EventObject } from "@jambudipa/xstate-effect"

export interface CallbackActorArgs<
  TEvent extends EventObject,
  TInput,
  TEmitted extends EventObject = EventObject,
  TSentEvent extends EventObject = AnyEventObject
> {
  readonly input: TInput
  readonly system: ActorSystemService
  readonly self: CallbackActorRef<TEvent>
  readonly sendBack: (event: TSentEvent) => void
  readonly receive: (listener: (event: TEvent) => void) => void
  readonly emit: (emitted: TEmitted) => void
}
```

The fields are described in [Callback argument](#callback-argument). The parameter of the
`receive` listener is bivariant: a listener for a wider or a narrower event type is accepted.

## `CallbackSnapshot`

```ts
import type { Snapshot } from "@jambudipa/xstate-effect"

export interface CallbackSnapshot<TInput = unknown> extends Snapshot<undefined> {
  readonly input: TInput
}
```

| Field | Type | Description |
|---|---|---|
| `status` | `"active" \| "error" \| "stopped"` in practice | See [Snapshot at each status](#snapshot-at-each-status). The type is the full `SnapshotStatus`. |
| `output` | `Option.Option<undefined>` | Always `Option.none()`. |
| `error` | `Option.Option<unknown>` | The raw thrown value when the status is `error`. |
| `input` | `TInput` | The actor's input. A stop keeps it. |

## `CallbackActorLogic`

`CallbackActorLogic<TEvent extends EventObject, TInput = unknown, TEmitted extends EventObject =
EventObject>` is `ActorLogic<CallbackSnapshot<TInput>, TEvent, TInput, TEmitted>`: logic whose
snapshot is a `CallbackSnapshot`, which accepts the events `TEvent` and takes an input of type
`TInput`.

## `CallbackActorRef`

`CallbackActorRef<TEvent extends EventObject, TInput = unknown>` is
`ActorRef<CallbackSnapshot<TInput>, TEvent>`. It is the type of `self` in the callback.

## Related

- [Invoke and spawn child actors](../../tutorials/05-child-actors.md)
- [How to send events between actors](../../how-to/send-events-between-actors.md)
- [How to emit events and listen to them](../../how-to/emit-and-listen-to-events.md)
- [createActor and the actor](../create-actor.md): `start`, `stop`, `on` and `emissions`.
- [sendTo, sendParent, sendSelf and forwardTo](../actions/send-to.md): the actions that send
  events to a callback actor.
- [Actor lifetimes and scopes](../../explanation/actor-lifetimes-and-scopes.md)
