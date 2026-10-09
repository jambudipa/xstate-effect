/**
 * P11: a SimulatedClock passed as the clock option drives timers.
 *
 * T3.20, SD-28. Upstream `createActor(logic, { clock })` (`src/createActor.ts` at
 * xstate@5.33.2) gives the root actor's system that clock, and the system's scheduler
 * (`src/system.ts`) starts every delayed event with `clock.setTimeout`. Upstream's
 * `SimulatedClock` (`src/SimulatedClock.ts`) fires its due timeouts when `increment(ms)` or
 * `set(ms)` moves its time, and `set` to an earlier time throws `Unable to travel back in
 * time`. In the port, SimulatedClock is a class whose `increment` and `set` return Effects:
 * they fire the due timers and wait for the macrostep of each delivered event (SD-28), and
 * `set` back in time fails its Effect with the upstream message. An actor with no clock
 * option runs its timers on the Effect clock, so `TestClock.adjust` drives them.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { createActor, createMachine, SimulatedClock, TimeTravelError } from "../../src/index.js"
import { unableToTravelBackInTime } from "./upstream-messages.js"

/** Lets every other ready fiber take a bounded number of turns. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 25; turn++) {
    yield* Effect.yieldNow
  }
})

/** `a` goes to `b` 100 ms after it is entered. */
const delayed = createMachine({
  id: "p11-delayed",
  initial: "a",
  context: {},
  states: { a: { after: { 100: "b" } }, b: {} },
})

describe("P11 A SimulatedClock passed as the clock option drives timers", () => {
  it.effect("[P11] an actor on a SimulatedClock takes its delayed transition when the clock is incremented past the delay, and TestClock.adjust alone does not fire it", () =>
    Effect.gen(function* () {
      const clock = new SimulatedClock()
      const actor = yield* createActor(delayed, { clock })
      yield* actor.start
      assert.strictEqual(actor.clock, clock)

      // The Effect clock does not drive a SimulatedClock timer
      yield* TestClock.adjust("1 second")
      yield* settle
      assert.strictEqual((yield* actor.getSnapshot).value, "a")

      yield* clock.increment(99)
      assert.strictEqual((yield* actor.getSnapshot).value, "a")
      // The increment returns after the delivered event's macrostep (SD-28)
      yield* clock.increment(1)
      assert.strictEqual((yield* actor.getSnapshot).value, "b")
      assert.strictEqual(clock.now(), 100)
    })
  )

  it.effect("[P11] an actor with no clock option takes its delayed transition when the Effect test clock advances", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(delayed)
      yield* actor.start

      yield* TestClock.adjust("99 millis")
      yield* settle
      assert.strictEqual((yield* actor.getSnapshot).value, "a")
      yield* TestClock.adjust("1 millis")
      yield* settle
      assert.strictEqual((yield* actor.getSnapshot).value, "b")
    })
  )

  it.effect("[P11] clock.set moves the time forward and fires the due timers; set to an earlier time fails with the upstream message and keeps the time", () =>
    Effect.gen(function* () {
      const clock = new SimulatedClock()
      const actor = yield* createActor(delayed, { clock })
      yield* actor.start

      yield* clock.set(100)
      assert.strictEqual((yield* actor.getSnapshot).value, "b")

      const error = yield* Effect.flip(clock.set(50))
      assert.instanceOf(error, TimeTravelError)
      assert.strictEqual(error.message, unableToTravelBackInTime)
      assert.strictEqual(clock.now(), 100)
    })
  )

  it.effect("[P11] a SimulatedClock without an actor runs a plain setTimeout callback when incremented, and clearTimeout stops it", () =>
    Effect.gen(function* () {
      const clock = new SimulatedClock()
      const fired: Array<string> = []
      clock.setTimeout(() => fired.push("kept"), 10)
      const cleared = clock.setTimeout(() => fired.push("cleared"), 10)
      clock.clearTimeout(cleared)

      yield* clock.increment(9)
      assert.deepStrictEqual(fired, [])
      yield* clock.increment(1)
      assert.deepStrictEqual(fired, ["kept"])
    })
  )
})
