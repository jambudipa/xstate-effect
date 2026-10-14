---
title: How to test delayed transitions
doc-type: how-to
sources: [packages/core/src/testing/SimulatedClock.ts]
---

# How to test delayed transitions

> **TL;DR:** Create a `SimulatedClock`, give it to the root actor with
> `createActor(machine, { clock })`, and move time with `yield* clock.increment(ms)`. Each
> increment fires the timers that fall due, in order, and returns after every actor has
> processed each delayed event and the events it set off, so the next `getSnapshot` shows the
> result, the parent's reaction to a child included. Effect's `TestClock` does not drive a
> `SimulatedClock`: use `TestClock.adjust` only for an actor without a `clock` option.

## When you need this

Your machine waits before it acts: an `after` transition, or a `raise` or `sendTo` with a
`delay`. A test that waits in real time is slow and can fail by chance. A simulated clock lets
the test decide when time passes, so a 30-second delay takes no time and gives the same result
on every run.

To write the delays themselves, see
[How to use delayed transitions and delayed events](use-delayed-transitions.md).

## Before you start

- You have a machine with at least one delayed transition or delayed event.
- Your test runs an Effect in a `Scope`. With `@effect/vitest`, `it.effect` gives the scope.
  With any other runner, run the test with `Effect.runPromise(Effect.scoped(test))`.

## Steps

1. Import `SimulatedClock` from `@jambudipa/xstate-effect` and create one with
   `new SimulatedClock()`. Its time starts at 0 and moves only when the test moves it.
2. Give the clock to the root actor: `createActor(machine, { clock })`. The actor's system
   then starts every delayed event on this clock, the delayed events of child actors included.
3. Start the actor with `yield* actor.start`.
4. Move time with `yield* clock.increment(ms)`. The increment fires each timer that falls due,
   the earliest first. After each delivered event, it waits for the event's macrostep and for
   every actor to process the events that the macrostep sent, before it fires the next timer.
5. Read the snapshot with `yield* actor.getSnapshot` and check it.

This test drives a traffic light through its cycle. Each `console.log` marks a check: replace
it with your test runner's assertion.

```ts
import { Effect } from "effect"
import { createActor, setup, SimulatedClock } from "@jambudipa/xstate-effect"

const trafficLight = setup({
  types: {} as { events: { type: "PEDESTRIAN" } },
  delays: { greenTime: 30_000, yellowTime: 5_000 }
}).createMachine({
  id: "light",
  initial: "green",
  states: {
    green: { after: { greenTime: "yellow" }, on: { PEDESTRIAN: "red" } },
    yellow: { after: { yellowTime: "red" } },
    red: { after: { 10_000: "green" } }
  }
})

export const lightCycleTest = Effect.gen(function* () {
  const clock = new SimulatedClock()
  const actor = yield* createActor(trafficLight, { clock })
  yield* actor.start

  // Just before the delay, then exactly at it
  yield* clock.increment(29_999)
  console.log((yield* actor.getSnapshot).value) // "green"
  yield* clock.increment(1)
  console.log((yield* actor.getSnapshot).value) // "yellow"

  // One increment fires every timer that falls due in it, in order:
  // yellow -> red at 35 000 ms, red -> green at 45 000 ms
  yield* clock.increment(15_000)
  console.log((yield* actor.getSnapshot).value) // "green"
  console.log(clock.now()) // 45000
})
```

A named delay, such as `greenTime` above, resolves to its milliseconds from `setup({ delays })`,
so the test moves the clock by that number.

## Variations

### Send events between increments

`actor.send` returns after the actor has processed the event, so you can mix events and time
in one test. A timer that a transition starts counts from the clock's time at that moment.

```ts
import { Effect } from "effect"
import { createActor, createMachine, SimulatedClock } from "@jambudipa/xstate-effect"

const session = createMachine({
  types: {} as { events: { type: "LOGIN" } | { type: "ACTIVITY" } },
  initial: "loggedOut",
  states: {
    loggedOut: { on: { LOGIN: "active" } },
    active: {
      after: { 1_000: "expired" },
      // Re-entering the state restarts its timer
      on: { ACTIVITY: { target: "active", reenter: true } }
    },
    expired: {}
  }
})

export const activityTest = Effect.gen(function* () {
  const clock = new SimulatedClock()
  const actor = yield* createActor(session, { clock })
  yield* actor.start

  yield* actor.send({ type: "LOGIN" })
  yield* clock.increment(600)
  yield* actor.send({ type: "ACTIVITY" }) // the new timer ends at 1 600 ms

  yield* clock.increment(999)
  console.log((yield* actor.getSnapshot).value) // "active"
  yield* clock.increment(1)
  console.log((yield* actor.getSnapshot).value) // "expired"
})
```

### Move the clock to a set time

`clock.set(ms)` moves the clock to an absolute time and fires the timers due by then, as
`increment` does. A time earlier than the clock's time fails the Effect with
`TimeTravelError` and leaves the time as it was.

```ts
import { Effect } from "effect"
import { createActor, createMachine, SimulatedClock } from "@jambudipa/xstate-effect"

const reminder = createMachine({
  initial: "waiting",
  states: { waiting: { after: { 60_000: "due" } }, due: {} }
})

export const setTimeTest = Effect.gen(function* () {
  const clock = new SimulatedClock()
  const actor = yield* createActor(reminder, { clock })
  yield* actor.start

  yield* clock.set(60_000)
  console.log((yield* actor.getSnapshot).value) // "due"

  const error = yield* Effect.flip(clock.set(1_000))
  console.log(error._tag, error.message) // TimeTravelError Unable to travel back in time
  console.log(clock.now()) // 60000
})
```

### Test a delay inside a child actor

Give the clock to the root actor only. A child actor joins its parent's system, so the root's
clock already drives the child's timers; a `clock` option on a child does not change that.

The increment delivers the child's delayed event, then waits until every actor of the system has
processed the events that the delivery set off. The child's done event reaches the parent, and
the parent takes its `onDone`, before the increment returns. So read the parent's snapshot at
once. A timer that the parent starts in that reaction counts from the time the child's timer
fired, and fires in the same increment when it falls due within it.

```ts
import { Effect } from "effect"
import { createActor, createMachine, SimulatedClock } from "@jambudipa/xstate-effect"

const countdown = createMachine({
  id: "countdown",
  initial: "counting",
  states: {
    counting: { after: { 3_000: "finished" } },
    finished: { type: "final" }
  }
})

const game = createMachine({
  initial: "playing",
  states: {
    playing: { invoke: { src: countdown, onDone: "over" } },
    over: {}
  }
})

export const childDelayTest = Effect.gen(function* () {
  const clock = new SimulatedClock()
  const actor = yield* createActor(game, { clock })
  yield* actor.start

  yield* clock.increment(3_000)
  // The parent has taken the child's done event already
  console.log((yield* actor.getSnapshot).value) // "over"
})
```

### Use Effect's TestClock for an actor without a clock option

An actor without a `clock` option starts its timers on the Effect clock. In a test, that clock
is `TestClock`: time stands still until the test calls `TestClock.adjust`. The delivery of a
fired timer runs in its own fiber, so wait for the expected state with `waitFor`.

`it.effect` of `@effect/vitest` provides `TestClock` already; leave out the `Effect.provide`
line there.

```ts
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { createActor, createMachine, waitFor } from "@jambudipa/xstate-effect"

const reminder = createMachine({
  initial: "waiting",
  states: { waiting: { after: { 60_000: "due" } }, due: {} }
})

export const testClockTest = Effect.gen(function* () {
  const actor = yield* createActor(reminder)
  yield* actor.start

  yield* TestClock.adjust("1 minute")
  const snapshot = yield* waitFor(actor, (current) => current.matches("due"))
  console.log(snapshot.value) // "due"
}).pipe(Effect.provide(TestClock.layer()))
```

Do not mix the two clocks. `TestClock.adjust` does not fire the timers of an actor that has a
`SimulatedClock`, and `clock.increment` does not move the Effect clock.

### Test the transitions without any clock

To check which delayed event a transition schedules, without running time at all, use the
pure transition functions: a delayed transition shows up as an `xstate.raise` action with its
`delay`. See [How to test a machine without running an actor](test-machines-without-actors.md).

## Related

- [SimulatedClock](../reference/testing/simulated-clock.md): the clock's methods and errors.
- [createActor and the actor](../reference/create-actor.md): the `clock` option.
- [How to wait for a state or an output](wait-for-a-state.md): `waitFor` and its timeout.
- [How to use delayed transitions and delayed events](use-delayed-transitions.md).
