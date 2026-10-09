/**
 * P11b: a SimulatedClock delivery precedes the next send.
 *
 * T3.20, SD-28, @ASSUMPTION:AS2.a. Upstream `SimulatedClock.increment` fires a due timer
 * synchronously, and the scheduler's callback relays the event, which the actor processes at
 * once, so an event sent right after the increment comes second. The port's `increment`
 * waits for the macrostep of each delivered event before it returns (SD-28), so the same
 * order holds without any extra wait.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { createActor, createMachine, raise, SimulatedClock } from "../../src/index.js"

type OrderEvent = { readonly type: "TIMER" } | { readonly type: "NEXT" }

describe("P11b A SimulatedClock delivery precedes the next send", () => {
  it.effect("[P11b] a 100 ms delayed event delivered by clock.increment(100) is processed before an event sent right after the increment", () =>
    Effect.gen(function* () {
      const order: Array<string> = []
      const machine = createMachine<object, OrderEvent>({
        id: "p11b-order",
        initial: "idle",
        context: {},
        states: {
          idle: {
            entry: raise<object, OrderEvent>({ type: "TIMER" }, { delay: 100 }),
            on: {
              TIMER: { target: "timedOut", actions: () => order.push("TIMER") },
              NEXT: { target: "early", actions: () => order.push("NEXT") },
            },
          },
          timedOut: { on: { NEXT: { target: "afterTimer", actions: () => order.push("NEXT") } } },
          early: {},
          afterTimer: {},
        },
      })
      const clock = new SimulatedClock()
      const actor = yield* createActor(machine, { clock })
      yield* actor.start

      yield* clock.increment(100)
      yield* actor.send({ type: "NEXT" })

      assert.deepStrictEqual(order, ["TIMER", "NEXT"])
      assert.strictEqual((yield* actor.getSnapshot).value, "afterTimer")
    })
  )

  it.effect("[P11b] before the increment reaches the delay, the sent event comes first", () =>
    Effect.gen(function* () {
      const order: Array<string> = []
      const machine = createMachine<object, OrderEvent>({
        id: "p11b-early",
        initial: "idle",
        context: {},
        states: {
          idle: {
            entry: raise<object, OrderEvent>({ type: "TIMER" }, { delay: 100 }),
            on: {
              TIMER: { actions: () => order.push("TIMER") },
              NEXT: { actions: () => order.push("NEXT") },
            },
          },
        },
      })
      const clock = new SimulatedClock()
      const actor = yield* createActor(machine, { clock })
      yield* actor.start

      yield* clock.increment(99)
      yield* actor.send({ type: "NEXT" })
      yield* clock.increment(1)

      assert.deepStrictEqual(order, ["NEXT", "TIMER"])
    })
  )
})
