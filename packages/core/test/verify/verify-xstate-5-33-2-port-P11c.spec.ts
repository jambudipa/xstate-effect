/**
 * P11c: timers scheduled during a SimulatedClock increment fire in the same increment.
 *
 * T3.20, SD-28. This is the port's behaviour, which SD-28 decides. The port's `increment` (and
 * `set`) fires the due timers one at a time, the earliest end first, and waits for each
 * delivered event's macrostep before it picks the next. While a timer fires, `now()` is that
 * timer's end, so a timer that the delivered event's macrostep starts counts from there and,
 * when it is due within the same increment, fires in it too: one `increment(150)` fires the
 * 100 ms timer of `a` and then the 50 ms timer that `b` starts at 100, so the actor is in `c`.
 *
 * Upstream differs here (ledger row DEV-27). Upstream `SimulatedClock.increment`
 * (`src/SimulatedClock.ts` at xstate@5.33.2) sets `_now` to the end of the whole increment
 * before `flushTimeouts` runs. A `setTimeout` made while a timeout fires restarts the flush,
 * but the new timer starts at that final time, so it is not due in the same increment:
 * upstream stays in `b` after one `increment(150)` (and after `set(150)`), reaches `c` at
 * 200 and `d` at 201.
 *
 * Ties follow upstream: `flushTimeouts` sorts the timeouts by their end time
 * (`start + timeout`), and for the same end time the sort keeps the order in which they were
 * set (V8's sort with upstream's comparator, checked for the small tables a test makes). The
 * port fires them in that order.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { createActor, createMachine, raise, SimulatedClock } from "../../src/index.js"

describe("P11c Timers scheduled during a SimulatedClock increment fire in the same increment", () => {
  it.effect("[P11c] a 100 ms after whose target has a 50 ms after reaches the second target after one clock.increment(150)", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        id: "p11c-chain",
        initial: "a",
        context: {},
        states: {
          a: { after: { 100: "b" } },
          b: { after: { 50: "c" } },
          c: { after: { 1: "d" } },
          d: {},
        },
      })
      const clock = new SimulatedClock()
      const actor = yield* createActor(machine, { clock })
      yield* actor.start

      yield* clock.increment(150)
      // c's own 1 ms timer started at 150 and is not due yet
      assert.strictEqual((yield* actor.getSnapshot).value, "c")
      yield* clock.increment(1)
      assert.strictEqual((yield* actor.getSnapshot).value, "d")
    })
  )

  it.effect("[P11c] timers with the same deadline fire in the order they were set, and earlier deadlines fire first", () =>
    Effect.gen(function* () {
      type OrderEvent =
        | { readonly type: "LATE_FIRST" }
        | { readonly type: "LATE_SECOND" }
        | { readonly type: "EARLY" }
        | { readonly type: "MORE" }
        | { readonly type: "JOINED" }
      const order: Array<string> = []
      const record = ({ event }: { readonly event: OrderEvent }) => order.push(event.type)
      const machine = createMachine<object, OrderEvent>({
        id: "p11c-ties",
        context: {},
        entry: [
          raise<object, OrderEvent>({ type: "LATE_FIRST" }, { delay: 100 }),
          raise<object, OrderEvent>({ type: "LATE_SECOND" }, { delay: 100 }),
          raise<object, OrderEvent>({ type: "EARLY" }, { delay: 40 }),
        ],
        on: {
          LATE_FIRST: { actions: record },
          LATE_SECOND: { actions: record },
          EARLY: { actions: record },
          // Sent at t = 50: a 50 ms timer whose deadline equals the two 100 ms timers'
          MORE: { actions: raise<object, OrderEvent>({ type: "JOINED" }, { delay: 50 }) },
          JOINED: { actions: record },
        },
      })
      const clock = new SimulatedClock()
      const actor = yield* createActor(machine, { clock })
      yield* actor.start

      yield* clock.increment(50)
      yield* actor.send({ type: "MORE" })
      yield* clock.increment(50)

      assert.deepStrictEqual(order, ["EARLY", "LATE_FIRST", "LATE_SECOND", "JOINED"])
    })
  )
})
