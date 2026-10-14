---
title: SimulatedClock
doc-type: reference
sources: [packages/core/src/testing/SimulatedClock.ts]
---

# SimulatedClock

> **TL;DR:** `SimulatedClock` is a clock whose time moves only when `increment` or `set` moves
> it. Give it to a root actor with `createActor(logic, { clock })`: the actor's system then
> starts every delayed event on it. `increment` and `set` return Effects that fire the due
> timers in order; after each delivered event, they wait until every actor of the system has
> processed it and the events it set off. `makeSimulatedClock` and
> `makeSimulatedClockEffect` make a separate, synchronous clock for timer tests without an
> actor.

`SimulatedClock`, `makeSimulatedClock`, `makeSimulatedClockEffect`, `TimeTravelError`,
`SyncSimulatedClock` and `SimulatedClockEffect` come from `@jambudipa/xstate-effect`, by name and
in the `testing` namespace. `createSimulatedClock`, `SimulatedTimeout` and `Clock` come from the
`testing` namespace only (`testing.createSimulatedClock`).

## Summary

| Name | Kind | Summary |
| --- | --- | --- |
| [`SimulatedClock`](#simulatedclock-1) | class | The clock for the `clock` option of `createActor`. `increment` and `set` return Effects. |
| [`makeSimulatedClock`](#makesimulatedclock) | function | Makes a `SyncSimulatedClock`, whose `increment` and `set` fire the due timeouts before they return. |
| [`createSimulatedClock`](#makesimulatedclock) | function and type | The same function as `makeSimulatedClock`; as a type, `SyncSimulatedClock`. |
| [`makeSimulatedClockEffect`](#makesimulatedclockeffect) | Effect | Makes a `SimulatedClockEffect`: a synchronous clock whose members are Effects. |
| [`TimeTravelError`](#timetravelerror) | error | The failure of a move to an earlier time. |
| [`SyncSimulatedClock`](#syncsimulatedclock) | type | The clock that `makeSimulatedClock` makes. |
| [`SimulatedClockEffect`](#simulatedclockeffect) | type | The clock that `makeSimulatedClockEffect` makes. |
| [`SimulatedTimeout`](#simulatedtimeout) | type | One pending timeout of a `SyncSimulatedClock`. |
| [`Clock`](#clock) | type | `now`, `setTimeout` and `clearTimeout`. |

## SimulatedClock

```ts
import type { Effect } from "effect"
import type { TimeTravelError, testing } from "@jambudipa/xstate-effect"

export declare class SimulatedClock implements testing.Clock {
  now(): number
  setTimeout(fn: () => void, timeout: number): number
  clearTimeout(id: unknown): void
  increment(ms: number): Effect.Effect<void>
  set(ms: number): Effect.Effect<void, TimeTravelError>
}
```

`new SimulatedClock()` takes no argument. The time starts at `0`.

### Members

| Member | Type | Description |
| --- | --- | --- |
| `now()` | `() => number` | The current time in milliseconds. |
| `setTimeout(fn, timeout)` | `(fn: () => void, timeout: number) => number` | Starts a timer that calls `fn` once the clock has moved `timeout` milliseconds. Gives the timer's id. Ids start at `0` and rise in set order. |
| `clearTimeout(id)` | `(id: unknown) => void` | Clears the timer with this id. An unknown id, a fired id and a value that is not a number change nothing. |
| `increment(ms)` | `(ms: number) => Effect.Effect<void>` | Moves the clock `ms` milliseconds forward and fires the timers that are due on the way. |
| `set(ms)` | `(ms: number) => Effect.Effect<void, TimeTravelError>` | Moves the clock to the time `ms` and fires the timers that are due on the way. |

### Behaviour

- **With an actor.** `createActor(logic, { clock })` makes the root actor's system start every
  delayed event on the clock: `after` transitions, and `raise` and `sendTo` with a delay. The
  actors that join the system use the same clock. Effect's `TestClock.adjust` does not fire
  these timers.
- **Lazy moves.** `increment` and `set` change nothing until their Effect runs.
- **Order.** A move fires the due timers one at a time: the earliest end first and, for the same
  end, the first set first.
- **Waiting.** A move waits for the macrostep of each event that a timer delivers. Then it waits
  for the actor system to settle: every actor processes the events queued for it, such as a
  child's done event to its parent, round after round until a round processes nothing. Only
  then does the move pick the next timer.
- **When the Effect completes.** Every delivered event is processed. So is every event that
  their macrosteps queued for an actor, and every event that those queued in turn: a parent has
  taken its child's done event. XState's synchronous clock gives the same result.
- **Time while a timer fires.** `now()` gives the end of the timer that fires. A timer that the
  delivered event's macrostep starts, or that another actor starts as it reacts, counts from
  that time. When it is due before the end of the move, it fires in the same move. XState's
  clock counts it from the end of the whole move.
- **After the move.** `now()` gives the target time.
- **Calls during a move.** An `increment` or `set` that a timer callback calls moves the end of
  the move and returns at once. The move that is firing fires the timers that are then due.
- **A throwing callback.** What a `setTimeout` callback throws is a defect of the `increment` or
  `set` that fires it. The clock stays usable: the next `increment` or `set` fires the timers
  that are still due. XState's clock fires no timer after a throw.

### Fails with

`set(ms)` fails with `TimeTravelError` when `ms` is earlier than the current target time. The
time does not change. `increment` never fails.

### Example

```ts
import { Effect } from "effect"
import { createActor, createMachine, SimulatedClock } from "@jambudipa/xstate-effect"

const light = createMachine({
  id: "light",
  initial: "green",
  states: {
    green: { after: { 1000: "yellow" } },
    yellow: { after: { 500: "red" } },
    red: {}
  }
})

export const program = Effect.gen(function* () {
  const clock = new SimulatedClock()
  const actor = yield* createActor(light, { clock })
  yield* actor.start

  yield* clock.increment(999)
  const before = yield* actor.getSnapshot // "green"

  // The green timer fires at 1000; the yellow timer starts then and is due at 1500
  yield* clock.increment(501)
  const after = yield* actor.getSnapshot // "red"

  return [before.value, after.value]
})

export const run = () => Effect.runPromise(Effect.scoped(program))
```

## makeSimulatedClock

```ts
import type { SyncSimulatedClock } from "@jambudipa/xstate-effect"

export declare function makeSimulatedClock(): SyncSimulatedClock
```

`testing.createSimulatedClock` is the same function. As a type, `testing.createSimulatedClock`
is `SyncSimulatedClock`.

### Returns

A new [`SyncSimulatedClock`](#syncsimulatedclock) at time `0`, with no timeout.

### Behaviour

- `increment` and `set` fire the due timeouts, the earliest end first, before they return.
- A callback that sets or clears a timeout makes the clock sort the timeouts again before it
  fires the next one.
- What a callback throws stops the firing and reaches the caller of `increment` or `set`. The
  clock stays usable: the next `increment` or `set` fires the timeouts that are still due.
- A callback that calls `increment` or `set` fires the timeouts that are then due inside that
  call.
- The clock fits the `clock` option of `createActor`. It does not wait for the delivered
  events: after `increment` returns, a delivered event can still wait for its macrostep. A
  `SimulatedClock` waits.

### Example

```ts
import { makeSimulatedClock } from "@jambudipa/xstate-effect"

const clock = makeSimulatedClock()
const fired: Array<string> = []

clock.setTimeout(() => fired.push("late"), 100)
clock.setTimeout(() => fired.push("early"), 50)
clock.increment(100)

export const result = { fired, now: clock.now() } // { fired: ["early", "late"], now: 100 }
```

## makeSimulatedClockEffect

```ts
import type { Effect } from "effect"
import type { SimulatedClockEffect } from "@jambudipa/xstate-effect"

export declare const makeSimulatedClockEffect: Effect.Effect<SimulatedClockEffect>
```

### Returns

An Effect that makes a new [`SimulatedClockEffect`](#simulatedclockeffect) each time it runs.
The clock is a `SyncSimulatedClock` whose members are Effects. It never fails.

### Behaviour

- The members behave as those of `makeSimulatedClock`, except that `set` to an earlier time
  fails with `TimeTravelError` in place of returning `false`.
- Its members return Effects, so it does not serve as the `clock` option of `createActor`. Use
  `SimulatedClock` for an actor.

### Example

```ts
import { Effect } from "effect"
import { makeSimulatedClockEffect } from "@jambudipa/xstate-effect"

export const program = Effect.gen(function* () {
  const clock = yield* makeSimulatedClockEffect
  let fired = false
  yield* clock.setTimeout(() => {
    fired = true
  }, 1000)
  yield* clock.increment(1000)
  return fired // true
})
```

## TimeTravelError

```ts
import { Data } from "effect"

export class TimeTravelError extends Data.TaggedError("TimeTravelError")<{
  readonly message: string
  readonly from: number
  readonly to: number
}> {}
```

| Field | Type | Description |
| --- | --- | --- |
| `_tag` | `"TimeTravelError"` | |
| `message` | `string` | `Unable to travel back in time`. |
| `from` | `number` | The clock's time when `set` was called. |
| `to` | `number` | The time that `set` was given. |

`SimulatedClock.set` and `SimulatedClockEffect.set` fail with it.

## SyncSimulatedClock

The clock that `makeSimulatedClock` makes. It extends [`Clock`](#clock).

| Member | Type | Description |
| --- | --- | --- |
| `now()` | `() => number` | The current time in milliseconds, from `0`. |
| `setTimeout(fn, timeout)` | `(fn: () => void, timeout: number) => number` | Starts a timeout that calls `fn` once `timeout` milliseconds have passed. Gives its id. Ids start at `0`. |
| `clearTimeout(id)` | `(id: number) => void` | Clears the timeout with this id. An unknown or fired id changes nothing. |
| `increment(ms)` | `(ms: number) => void` | Moves the time `ms` milliseconds forward and fires the due timeouts. |
| `set(ms)` | `(ms: number) => boolean` | Moves the time to `ms` and fires the due timeouts; gives `true`. Gives `false` and keeps the time when `ms` is earlier than the current time. |
| `getPendingTimeouts()` | `() => ReadonlyArray<SimulatedTimeout>` | The timeouts that have not fired and are not cleared. |
| `clearAllTimeouts()` | `() => void` | Clears every pending timeout. |

## SimulatedClockEffect

The clock that `makeSimulatedClockEffect` makes.

| Member | Type |
| --- | --- |
| `now` | `Effect.Effect<number>` |
| `setTimeout(fn, timeout)` | `(fn: () => void, timeout: number) => Effect.Effect<number>` |
| `clearTimeout(id)` | `(id: number) => Effect.Effect<void>` |
| `increment(ms)` | `(ms: number) => Effect.Effect<void>` |
| `set(ms)` | `(ms: number) => Effect.Effect<void, TimeTravelError>` |
| `getPendingTimeouts` | `Effect.Effect<ReadonlyArray<SimulatedTimeout>>` |
| `clearAllTimeouts` | `Effect.Effect<void>` |

## SimulatedTimeout

From the `testing` namespace only: `testing.SimulatedTimeout`.

| Field | Type | Description |
| --- | --- | --- |
| `id` | `number` | The id that `setTimeout` gave. |
| `start` | `number` | The clock's time when the timeout was set. |
| `timeout` | `number` | The delay in milliseconds from `start`. The timeout fires once `now() - start >= timeout`. |
| `fn` | `() => void` | The callback. The clock removes the timeout before it calls `fn`. |

## Clock

From the `testing` namespace only: `testing.Clock`.

| Member | Type | Description |
| --- | --- | --- |
| `now()` | `() => number` | The clock's time in milliseconds. |
| `setTimeout(fn, timeout)` | `(fn: () => void, timeout: number) => number` | Starts a timeout; gives its id. |
| `clearTimeout(id)` | `(id: number) => void` | Clears a timeout. |

`SimulatedClock` and `SyncSimulatedClock` implement it. The type of the `clock` option of
`createActor` is a different one, `ActorSystem.Clock`: it needs only `setTimeout` and
`clearTimeout`. See [The actor system](../actor-system.md).

## Related

- [How to test delayed transitions](../../how-to/test-delayed-transitions.md)
- [How to use delayed transitions and delayed events](../../how-to/use-delayed-transitions.md)
- [Test your machine](../../tutorials/07-testing.md)
- [createActor and the actor](../create-actor.md): the `clock` option.
- [The actor system](../actor-system.md): the scheduler of delayed events.
- [waitFor, toEffect and toPromise](./wait-for.md): the `timeout` of `waitFor` runs on the Effect
  clock, not on a `SimulatedClock`.
