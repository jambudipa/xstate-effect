/**
 * S20: after transitions fire on time and are cancelled on exit.
 *
 * T3.20. Upstream `getDelayedTransitions` (`src/stateUtils.ts` at xstate@5.33.2) turns each
 * key of a state's `after` map into one `raise(xstate.after.<delay>.<id>, { id, delay })`
 * appended to the state's entry actions and one `cancel(<that id>)` appended to its exit
 * actions; the transitions of the key wait for that event. A key that reads as a number is a
 * number of milliseconds (`'1000'` is `1000`); any other key names a delay of the machine's
 * `delays` implementations, a number or a function of the context and the event.
 *
 * Upstream `resolveRaise` pushes the event to the internal queue when the resolved delay is
 * not a number (an unknown delay name), so it is taken in the same macrostep; a number,
 * zero included, goes to the scheduler. `executeRaise`, `executeSendTo` and `executeCancel`
 * defer the scheduler call until the macrostep commits, so a macrostep that fails schedules
 * nothing and an initial-state delayed event is scheduled at `start`. Upstream's scheduler
 * (`src/system.ts`) keys a timer by `<sessionId>.<id>`, makes a fresh id for an anonymous
 * delayed event, keeps an older timer of the same id running (it only forgets it), and clears
 * a timer only when it knows it (issue #5001).
 *
 * Without a clock option the timers run on the Effect clock, so `TestClock.adjust` drives
 * them. A delivery from the scheduler only queues the event (SD-23), so each check yields a
 * bounded number of times first.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import {
  assign,
  cancel,
  createActor,
  createMachine,
  type EventObject,
  getInitialSnapshot,
  raise,
  sendTo,
  setup,
  spawnChild,
} from "../../src/index.js"

/** Lets every other ready fiber take a bounded number of turns. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 25; turn++) {
    yield* Effect.yieldNow
  }
})

/** The value of an actor's snapshot once every queued delivery had the chance to run. */
const valueAfterSettle = (actor: { readonly getSnapshot: Effect.Effect<{ readonly value: unknown }> }) =>
  Effect.andThen(settle, Effect.map(actor.getSnapshot, (snapshot) => snapshot.value))

/**
 * A clock option that records each timer it is asked for and never fires one: `delays` holds
 * the delay of each `setTimeout` call, `cleared` each `clearTimeout` id.
 */
const recordingClock = () => {
  const delays: Array<unknown> = []
  const cleared: Array<unknown> = []
  return {
    delays,
    cleared,
    clock: {
      setTimeout: (_fn: () => void, timeout: number) => {
        delays.push(timeout)
        return delays.length
      },
      clearTimeout: (id: unknown) => {
        cleared.push(id)
      },
    },
  }
}

interface Waiting {
  readonly wait: number
}

describe("S20 after transitions fire on time and are cancelled on exit", () => {
  it.effect("[S20] numeric, named and dynamic after delays each fire once the test clock passes the delay", () =>
    Effect.gen(function* () {
      const machine = createMachine<Waiting, EventObject>(
        {
          id: "s20-delays",
          initial: "a",
          context: { wait: 300 },
          states: {
            a: { after: { 1000: "b" } },
            b: { after: { short: "c" } },
            c: { after: { fromContext: "d" } },
            d: {},
          },
        },
        { delays: { short: 500, fromContext: ({ context }) => context.wait } }
      )
      const actor = yield* createActor(machine)
      yield* actor.start

      yield* TestClock.adjust("999 millis")
      assert.strictEqual(yield* valueAfterSettle(actor), "a")
      yield* TestClock.adjust("1 millis")
      assert.strictEqual(yield* valueAfterSettle(actor), "b")

      // The named delay: 500 ms after b was entered
      yield* TestClock.adjust("499 millis")
      assert.strictEqual(yield* valueAfterSettle(actor), "b")
      yield* TestClock.adjust("1 millis")
      assert.strictEqual(yield* valueAfterSettle(actor), "c")

      // The dynamic delay: the implementation reads the context when c is entered
      yield* TestClock.adjust("299 millis")
      assert.strictEqual(yield* valueAfterSettle(actor), "c")
      yield* TestClock.adjust("1 millis")
      assert.strictEqual(yield* valueAfterSettle(actor), "d")
    })
  )

  it.effect("[S20] a delay named in setup({ delays }) fires after that many milliseconds", () =>
    Effect.gen(function* () {
      const machine = setup({ types: { context: {} as object, events: {} as EventObject }, delays: { short: 500 } }).createMachine({
        id: "s20-setup-delay",
        initial: "a",
        context: {},
        states: { a: { after: { short: "b" } }, b: {} },
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      yield* TestClock.adjust("499 millis")
      assert.strictEqual(yield* valueAfterSettle(actor), "a")
      yield* TestClock.adjust("1 millis")
      assert.strictEqual(yield* valueAfterSettle(actor), "b")
    })
  )

  it.effect("[S20] a delayed transition whose state exited first never fires, and re-entry restarts the timer", () =>
    Effect.gen(function* () {
      const seenInB: Array<string> = []
      const machine = createMachine({
        id: "s20-exit",
        initial: "a",
        context: {},
        states: {
          a: { after: { 1000: "timedOut" }, on: { LEAVE: "b" } },
          b: {
            on: {
              BACK: "a",
              // Every other event that reaches b, the after event of a among them
              "*": { actions: ({ event }) => seenInB.push(event.type) },
            },
          },
          timedOut: {},
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      yield* TestClock.adjust("500 millis")
      yield* actor.send({ type: "LEAVE" })
      // Past the first deadline (t = 1000): the exit of a cancelled the timer
      yield* TestClock.adjust("1000 millis")
      assert.strictEqual(yield* valueAfterSettle(actor), "b")
      assert.deepStrictEqual(seenInB, [])

      // Re-entry at t = 1500 starts a new 1000 ms timer
      yield* actor.send({ type: "BACK" })
      yield* TestClock.adjust("999 millis")
      assert.strictEqual(yield* valueAfterSettle(actor), "a")
      yield* TestClock.adjust("1 millis")
      assert.strictEqual(yield* valueAfterSettle(actor), "timedOut")
      assert.deepStrictEqual(seenInB, [])
    })
  )

  // upstream: test/after.test.ts > delayed transitions > should defer a single send event for a delayed conditional transition (#886)
  it.effect("[S20] a guarded delayed transition with a fallback schedules one deferred send, at start (#886)", () =>
    Effect.gen(function* () {
      const recording = recordingClock()
      const seenInY: Array<string> = []
      const machine = createMachine({
        id: "s20-886",
        initial: "X",
        context: {},
        states: {
          X: { after: { 1: [{ target: "Y", guard: () => true }, { target: "Z" }] } },
          Y: { on: { "*": { actions: ({ event }) => seenInY.push(event.type) } } },
          Z: {},
        },
      })

      // On a recording clock: one timer for the key, asked for at start, not at creation
      const recorded = yield* createActor(machine, { clock: recording.clock })
      assert.deepStrictEqual(recording.delays, [])
      yield* recorded.start
      assert.deepStrictEqual(recording.delays, [1])

      // On the Effect clock: the one event takes the guarded transition, and no second
      // event reaches Y
      const actor = yield* createActor(machine)
      yield* actor.start
      yield* TestClock.adjust("10 millis")
      assert.strictEqual(yield* valueAfterSettle(actor), "Y")
      assert.deepStrictEqual(seenInY, [])
    })
  )

  it.effect("[S20] a numeric-string after key waits that many milliseconds, as a number", () =>
    Effect.gen(function* () {
      const recording = recordingClock()
      const machine = createMachine({
        id: "s20-string-key",
        initial: "a",
        context: {},
        states: { a: { after: { "1000": "b" } }, b: {} },
      })

      const recorded = yield* createActor(machine, { clock: recording.clock })
      yield* recorded.start
      assert.deepStrictEqual(recording.delays, [1000])

      const actor = yield* createActor(machine)
      yield* actor.start
      yield* TestClock.adjust("999 millis")
      assert.strictEqual(yield* valueAfterSettle(actor), "a")
      yield* TestClock.adjust("1 millis")
      assert.strictEqual(yield* valueAfterSettle(actor), "b")
    })
  )

  it.effect("[S20] a zero delay goes through the scheduler, not the internal queue, and an unknown delay name delivers the event in the same macrostep", () =>
    Effect.gen(function* () {
      const afterZero = createMachine({
        id: "s20-after-zero",
        initial: "a",
        context: {},
        states: { a: { after: { 0: "b" } }, b: {} },
      })
      const raiseZero = createMachine({
        id: "s20-raise-zero",
        initial: "a",
        context: {},
        states: { a: { entry: raise({ type: "GO" }, { delay: 0 }), on: { GO: "b" } }, b: {} },
      })
      const afterUnknown = createMachine({
        id: "s20-after-unknown",
        initial: "a",
        context: {},
        states: { a: { after: { notADelay: "b" } }, b: {} },
      })
      const raiseUnknown = createMachine({
        id: "s20-raise-unknown",
        initial: "a",
        context: {},
        states: { a: { entry: raise({ type: "GO" }, { delay: "notADelay" }), on: { GO: "b" } }, b: {} },
      })

      // The initial macrostep without an actor: a zero delay leaves the event to the
      // scheduler; an unknown name takes it at once
      assert.strictEqual((yield* getInitialSnapshot(afterZero, undefined)).value, "a")
      assert.strictEqual((yield* getInitialSnapshot(raiseZero, undefined)).value, "a")
      assert.strictEqual((yield* getInitialSnapshot(afterUnknown, undefined)).value, "b")
      assert.strictEqual((yield* getInitialSnapshot(raiseUnknown, undefined)).value, "b")

      // A live actor with a zero delay reaches b without any clock adjustment
      const actor = yield* createActor(afterZero)
      yield* actor.start
      assert.strictEqual(yield* valueAfterSettle(actor), "b")
      const raised = yield* createActor(raiseZero)
      yield* raised.start
      assert.strictEqual(yield* valueAfterSettle(raised), "b")
    })
  )

  it.effect("[S20] two anonymous delayed events scheduled in the same instant both arrive", () =>
    Effect.gen(function* () {
      interface Ticks {
        readonly ticks: number
      }
      type TickEvent = { readonly type: "TICK" }
      const machine = createMachine<Ticks, TickEvent>({
        id: "s20-anonymous",
        context: { ticks: 0 },
        entry: [raise<Ticks, TickEvent>({ type: "TICK" }, { delay: 100 }), raise<Ticks, TickEvent>({ type: "TICK" }, { delay: 100 })],
        on: { TICK: { actions: assign<Ticks, TickEvent>(({ context }) => ({ ticks: context.ticks + 1 })) } },
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      yield* TestClock.adjust("100 millis")
      yield* settle
      assert.strictEqual((yield* actor.getSnapshot).context.ticks, 2)
    })
  )

  it.effect("[S20] two delayed sends with one id both fire, and a later cancel of that id cancels only the latest", () =>
    Effect.gen(function* () {
      interface Pings {
        readonly pings: number
      }
      type PingEvent = { readonly type: "PING" }
      type ParentEvent = { readonly type: "SEND" } | { readonly type: "CANCEL" }
      const child = createMachine<Pings, PingEvent>({
        id: "s20-child",
        context: { pings: 0 },
        on: { PING: { actions: assign<Pings, PingEvent>(({ context }) => ({ pings: context.pings + 1 })) } },
      })
      const parent = createMachine<object, ParentEvent>({
        id: "s20-parent",
        context: {},
        entry: spawnChild<object, ParentEvent, typeof child>(child, { id: "child" }),
        on: {
          SEND: { actions: sendTo<object, ParentEvent>("child", { type: "PING" }, { id: "x", delay: 100 }) },
          CANCEL: { actions: cancel<object, ParentEvent>("x") },
        },
      })
      const pingsOf = (actor: { readonly getSnapshot: Effect.Effect<{ readonly children: Record<string, unknown> }> }) =>
        Effect.gen(function* () {
          yield* settle
          const ref = (yield* actor.getSnapshot).children["child"] as {
            readonly getSnapshot: Effect.Effect<{ readonly context: Pings }>
          }
          return (yield* ref.getSnapshot).context.pings
        })

      // Without a cancel, both timers of the id fire
      const both = yield* createActor(parent)
      yield* both.start
      yield* both.send({ type: "SEND" })
      yield* both.send({ type: "SEND" })
      yield* TestClock.adjust("100 millis")
      assert.strictEqual(yield* pingsOf(both), 2)

      // A cancel after the second send cancels the second timer only
      const latest = yield* createActor(parent)
      yield* latest.start
      yield* latest.send({ type: "SEND" })
      yield* TestClock.adjust("50 millis")
      yield* latest.send({ type: "SEND" })
      yield* latest.send({ type: "CANCEL" })
      yield* TestClock.adjust("50 millis")
      assert.strictEqual(yield* pingsOf(latest), 1)
      yield* TestClock.adjust("100 millis")
      assert.strictEqual(yield* pingsOf(latest), 1)
    })
  )

  it.effect("[S20] a delayed send of a macrostep that fails is never scheduled, and cancelling an unknown id clears no timer", () =>
    Effect.gen(function* () {
      const recording = recordingClock()
      type GoEvent =
        | { readonly type: "ARM" }
        | { readonly type: "CANCEL_UNKNOWN" }
        | { readonly type: "CANCEL_ARMED" }
        | { readonly type: "LATE" }
        | { readonly type: "GO" }
      const machine = createMachine<object, GoEvent>({
        id: "s20-failing",
        context: {},
        on: {
          ARM: { actions: sendTo<object, GoEvent>("#_self", { type: "LATE" }, { delay: 100, id: "armed" }) },
          CANCEL_UNKNOWN: { actions: cancel<object, GoEvent>("never-scheduled") },
          CANCEL_ARMED: { actions: cancel<object, GoEvent>("armed") },
          GO: {
            actions: [
              sendTo<object, GoEvent>("#_self", { type: "LATE" }, { delay: 200, id: "late" }),
              () => {
                throw new Error("boom")
              },
            ],
          },
        },
      })
      const actor = yield* createActor(machine, { clock: recording.clock })
      yield* actor.start

      // A macrostep that commits asks the clock for its timer
      yield* actor.send({ type: "ARM" })
      assert.deepStrictEqual(recording.delays, [100])

      // issue #5001: no timer of that id exists, so no clearTimeout call; the known one is cleared
      yield* actor.send({ type: "CANCEL_UNKNOWN" })
      assert.deepStrictEqual(recording.cleared, [])
      yield* actor.send({ type: "CANCEL_ARMED" })
      assert.deepStrictEqual(recording.cleared, [1])

      // The failing macrostep's delayed send never reaches the clock
      yield* actor.send({ type: "GO" })
      yield* settle
      assert.strictEqual((yield* actor.getSnapshot).status, "error")
      assert.deepStrictEqual(recording.delays, [100])
    })
  )
})
