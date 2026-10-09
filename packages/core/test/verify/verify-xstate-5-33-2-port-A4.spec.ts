/**
 * A4: named delays resolve for raise, sendTo and after.
 *
 * T4.12. Upstream `resolveRaise` (`src/actions/raise.ts`) and `resolveSendTo`
 * (`src/actions/send.ts`) at xstate@5.33.2 resolve the delay of the action while the
 * transition runs:
 *
 * - a string event is an error: "Only event objects may be used with raise; use
 *   raise({ type: "<x>" }) instead" (the sendTo message for sendTo);
 * - the event expression and a delay function are called as `(args, actionParams)`;
 * - a delay name reads `snapshot.machine.implementations.delays`, so `setup({ delays })`
 *   and `machine.provide({ delays })` (which overrides it) decide it; a configured delay is a
 *   number or a function called as `(args, actionParams)`;
 * - a delay that does not resolve to a number (an unknown name, or a function that gives no
 *   number) is no delay: raise puts the event on the internal queue, so the same macrostep
 *   takes it, and sendTo relays it at once, which `cancel` cannot stop.
 *
 * Upstream's scheduler (`src/system.ts`) keys a delayed event by its send id: a second
 * schedule under a pending id leaves the first timer running and forgets it, so both events
 * fire, and `cancel(id)` then stops only the latest one. `after` keys name delays the same
 * way (upstream `getDelayedTransitions` raises with the key as the delay). The port also
 * keeps the `implementations` option of `sendTo` (a port extra): when it names the delay it
 * decides it, and any other name reads the machine's delays.
 *
 * The timers run on the Effect clock, so `TestClock.adjust` drives them. A delivery from the
 * scheduler only queues the event (SD-23), so each check yields a bounded number of times
 * first.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option, Predicate } from "effect"
import { TestClock } from "effect/testing"
import {
  cancel,
  createActor,
  createMachine,
  type EventObject,
  raise,
  sendTo,
  setup,
} from "../../src/index.js"
import { onlyEventObjectsRaise } from "./upstream-messages.js"

/** Lets every other ready fiber take a bounded number of turns. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 25; turn++) {
    yield* Effect.yieldNow
  }
})

/** Moves the test clock by `millis` and lets each delivery it caused run. */
const advance = (millis: number) => Effect.andThen(TestClock.adjust(`${millis} millis`), settle)

/** The `ms` of a params value; 0 when it has none (a delay function that got no params). */
const msOf = (params: unknown): number =>
  Predicate.hasProperty(params, "ms") && typeof params.ms === "number" ? params.ms : 0

/** The message of an error value. */
const messageOf = (error: unknown): string => String((error as { readonly message?: unknown }).message)

type Ev =
  | { readonly type: "GO" }
  | { readonly type: "RAISED" }
  | { readonly type: "SENT" }
  | { readonly type: "NAMED" }
  | { readonly type: "PING" }
  | { readonly type: "STOP" }
  | { readonly type: "SEND_A" }
  | { readonly type: "SEND_B" }
  | { readonly type: "A" }
  | { readonly type: "B" }
  | { readonly type: "CANCEL" }

/**
 * A setup machine that, on GO, enters `waiting`, whose entry raises RAISED and sends SENT to
 * itself, both after the delay named `short`, and whose `after` key `short` leads to `done`.
 * Each arrival is recorded.
 */
const namedDelayMachine = (arrivals: Array<string>) =>
  setup({
    types: { context: {} as object, events: {} as Ev },
    delays: { short: 100 },
  }).createMachine({
    id: "a4-named",
    context: {},
    initial: "idle",
    on: {
      RAISED: { actions: () => arrivals.push("RAISED") },
      SENT: { actions: () => arrivals.push("SENT") },
    },
    states: {
      idle: { on: { GO: "waiting" } },
      waiting: {
        entry: [
          raise({ type: "RAISED" }, { delay: "short" }),
          sendTo(({ self }) => self, { type: "SENT" }, { delay: "short" }),
        ],
        after: { short: "done" },
      },
      done: {},
    },
  })

describe("A4 Named delays resolve for raise, sendTo and after", () => {
  it.effect("[A4] raise, sendTo and after use the delay named in setup({ delays }): each event arrives after it", () =>
    Effect.gen(function* () {
      const arrivals: Array<string> = []
      const actor = yield* createActor(namedDelayMachine(arrivals))
      yield* actor.start
      yield* actor.send({ type: "GO" })

      yield* advance(99)
      assert.deepStrictEqual(arrivals, [])
      assert.strictEqual((yield* actor.getSnapshot).value, "waiting")

      yield* advance(1)
      assert.deepStrictEqual(arrivals, ["RAISED", "SENT"])
      assert.strictEqual((yield* actor.getSnapshot).value, "done")
    })
  )

  it.effect("[A4] provide({ delays }) overrides the setup delay for raise, sendTo and after, a number or a function", () =>
    Effect.gen(function* () {
      const byNumber: Array<string> = []
      const numbered = yield* createActor(namedDelayMachine(byNumber).provide({ delays: { short: 300 } }))
      yield* numbered.start
      yield* numbered.send({ type: "GO" })

      yield* advance(299)
      assert.deepStrictEqual(byNumber, [])
      yield* advance(1)
      assert.deepStrictEqual(byNumber, ["RAISED", "SENT"])
      assert.strictEqual((yield* numbered.getSnapshot).value, "done")

      // A provided delay function: called with the action arguments of each use
      const byFunction: Array<string> = []
      const seen: Array<string> = []
      const functional = yield* createActor(
        namedDelayMachine(byFunction).provide({
          delays: {
            short: ({ event }) => {
              seen.push(event.type)
              return 50
            },
          },
        })
      )
      yield* functional.start
      yield* functional.send({ type: "GO" })

      yield* advance(49)
      assert.deepStrictEqual(byFunction, [])
      yield* advance(1)
      assert.deepStrictEqual(byFunction, ["RAISED", "SENT"])
      assert.strictEqual((yield* functional.getSnapshot).value, "done")
      // raise, sendTo and the after key each resolved it with the event being handled
      assert.deepStrictEqual(seen, ["GO", "GO", "GO"])
    })
  )

  it.effect("[A4] cancel by id stops a pending sendTo whose delay is named", () =>
    Effect.gen(function* () {
      const machine = setup({
        types: { context: {} as object, events: {} as Ev },
        delays: { short: 100 },
      }).createMachine({
        id: "a4-cancel",
        context: {},
        initial: "a",
        states: {
          a: {
            entry: sendTo(({ self }) => self, { type: "PING" }, { delay: "short", id: "ping" }),
            on: { STOP: { actions: cancel("ping") }, PING: "pinged" },
          },
          pinged: {},
        },
      })

      // Not cancelled: the PING arrives after the named delay
      const kept = yield* createActor(machine)
      yield* kept.start
      yield* advance(99)
      assert.strictEqual((yield* kept.getSnapshot).value, "a")
      yield* advance(1)
      assert.strictEqual((yield* kept.getSnapshot).value, "pinged")

      // Cancelled at 50 ms: the PING never arrives
      const cancelled = yield* createActor(machine)
      yield* cancelled.start
      yield* advance(50)
      yield* cancelled.send({ type: "STOP" })
      yield* advance(500)
      assert.strictEqual((yield* cancelled.getSnapshot).value, "a")
    })
  )

  it.effect("[A4] two delayed sends with the same id both fire, and cancel by that id stops only the latest one", () =>
    Effect.gen(function* () {
      const sameIdMachine = (arrivals: Array<string>) =>
        setup({
          types: { context: {} as object, events: {} as Ev },
          delays: { short: 100 },
        }).createMachine({
          id: "a4-same-id",
          context: {},
          on: {
            SEND_A: { actions: sendTo(({ self }) => self, { type: "A" }, { delay: "short", id: "dup" }) },
            SEND_B: { actions: sendTo(({ self }) => self, { type: "B" }, { delay: "short", id: "dup" }) },
            CANCEL: { actions: cancel("dup") },
            A: { actions: () => arrivals.push("A") },
            B: { actions: () => arrivals.push("B") },
          },
        })

      // A is due at 100 ms and B at 150 ms; both fire
      const both: Array<string> = []
      const actor = yield* createActor(sameIdMachine(both))
      yield* actor.start
      yield* actor.send({ type: "SEND_A" })
      yield* advance(50)
      yield* actor.send({ type: "SEND_B" })
      yield* advance(49)
      assert.deepStrictEqual(both, [])
      yield* advance(1)
      assert.deepStrictEqual(both, ["A"])
      yield* advance(50)
      assert.deepStrictEqual(both, ["A", "B"])

      // cancel("dup") at 60 ms stops B, the latest; A still fires
      const one: Array<string> = []
      const cancelling = yield* createActor(sameIdMachine(one))
      yield* cancelling.start
      yield* cancelling.send({ type: "SEND_A" })
      yield* advance(50)
      yield* cancelling.send({ type: "SEND_B" })
      yield* advance(10)
      yield* cancelling.send({ type: "CANCEL" })
      yield* advance(500)
      assert.deepStrictEqual(one, ["A"])
    })
  )
})

describe("A4 delay functions and delays that do not resolve to a number", () => {
  it.effect("[A4] a delay function, inline or named, receives the action arguments and the params of the use", () =>
    Effect.gen(function* () {
      interface Ctx {
        readonly base: number
      }
      const arrivals: Array<string> = []
      const seenArgs: Array<ReadonlyArray<string>> = []
      const machine = setup({
        types: { context: {} as Ctx, events: {} as Ev },
        actions: {
          raiseLater: raise<Ctx, Ev>({ type: "RAISED" }, { delay: ({ context }, params) => context.base + msOf(params) }),
          sendLater: sendTo<Ctx, Ev>(({ self }) => self, { type: "SENT" }, {
            delay: ({ context }, params) => context.base + msOf(params),
          }),
          raiseNamed: raise<Ctx, Ev>({ type: "NAMED" }, { delay: "fromParams" }),
        },
        delays: {
          fromParams: (args, params: { readonly ms: number }) => {
            seenArgs.push(Object.keys(args))
            return args.context.base + params.ms
          },
        },
      }).createMachine({
        id: "a4-params",
        context: { base: 100 },
        on: {
          RAISED: { actions: () => arrivals.push("RAISED") },
          SENT: { actions: () => arrivals.push("SENT") },
          NAMED: { actions: () => arrivals.push("NAMED") },
        },
        entry: [
          { type: "raiseLater", params: { ms: 10 } },
          { type: "sendLater", params: { ms: 20 } },
          { type: "raiseNamed", params: { ms: 30 } },
        ],
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      assert.strictEqual((yield* actor.getSnapshot).status, "active")
      yield* advance(109)
      assert.deepStrictEqual(arrivals, [])
      yield* advance(1)
      assert.deepStrictEqual(arrivals, ["RAISED"])
      yield* advance(10)
      assert.deepStrictEqual(arrivals, ["RAISED", "SENT"])
      yield* advance(10)
      assert.deepStrictEqual(arrivals, ["RAISED", "SENT", "NAMED"])
      // Upstream `args` holds at least `{ context, event, self, system }`
      assert.includeMembers([...(seenArgs[0] ?? [])], ["context", "event", "self", "system"])
    })
  )

  it.effect("[A4] a delay that does not resolve to a number is no delay: raise takes the internal queue and sendTo sends at once", () =>
    Effect.gen(function* () {
      const arrivals: Array<string> = []
      const machine = setup({
        types: { context: {} as object, events: {} as Ev },
        // A function that gives no number at run time (the type system asks for one)
        delays: { nothing: () => undefined as unknown as number },
      }).createMachine({
        id: "a4-no-number",
        context: {},
        initial: "idle",
        on: {
          RAISED: { actions: () => arrivals.push("RAISED") },
          NAMED: { actions: () => arrivals.push("NAMED") },
          SENT: { actions: () => arrivals.push("SENT") },
          PING: { actions: () => arrivals.push("PING") },
        },
        states: {
          idle: { on: { GO: "go" } },
          go: {
            entry: [
              raise({ type: "RAISED" }, { delay: "nothing", id: "r1" }),
              // @ts-expect-error the setup has no delay of this name: a type error (T4.17), and no delay at run time
              raise({ type: "NAMED" }, { delay: "unknownName", id: "r2" }),
              sendTo(({ self }) => self, { type: "SENT" }, { delay: "nothing", id: "s1" }),
              // @ts-expect-error the setup has no delay of this name: a type error (T4.17), and no delay at run time
              sendTo(({ self }) => self, { type: "PING" }, { delay: "unknownName", id: "s2" }),
              // Nothing was scheduled, so nothing is cancelled
              cancel("r1"),
              cancel("r2"),
              cancel("s1"),
              cancel("s2"),
            ],
          },
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      yield* actor.send({ type: "GO" })
      yield* settle

      // The raised events in the same macrostep, then the sent ones; the clock never moved
      assert.deepStrictEqual(arrivals, ["RAISED", "NAMED", "SENT", "PING"])
      assert.strictEqual((yield* actor.getSnapshot).status, "active")
    })
  )

  it.effect("[A4] the implementations option of sendTo still decides a name it holds; any other name reads the machine's delays", () =>
    Effect.gen(function* () {
      const arrivals: Array<string> = []
      const machine = setup({
        types: { context: {} as object, events: {} as Ev },
        delays: { short: 100, own: 400 },
      }).createMachine({
        id: "a4-option",
        context: {},
        on: {
          A: { actions: () => arrivals.push("A") },
          B: { actions: () => arrivals.push("B") },
        },
        entry: [
          // A port extra: the option's `own` (70 ms) wins over the machine's (400 ms)
          sendTo(({ self }) => self, { type: "A" }, { delay: "own", implementations: { delays: { own: 70 } } }),
          // The option lacks `short`: the machine's 100 ms
          sendTo(({ self }) => self, { type: "B" }, { delay: "short", implementations: { delays: { own: 70 } } }),
        ],
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      yield* advance(69)
      assert.deepStrictEqual(arrivals, [])
      yield* advance(1)
      assert.deepStrictEqual(arrivals, ["A"])
      yield* advance(29)
      assert.deepStrictEqual(arrivals, ["A"])
      yield* advance(1)
      assert.deepStrictEqual(arrivals, ["A", "B"])
    })
  )
})

describe("A4 raise rejects a string event", () => {
  it.effect("[A4] raise with a string event sets status error with the upstream message", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        id: "a4-string-event",
        context: {},
        // The type system rejects a string event; upstream's test reaches it the same way
        entry: raise("a string" as unknown as EventObject),
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.status, "error")
      assert.strictEqual(Option.match(snapshot.error, { onNone: () => "(no error)", onSome: messageOf }), onlyEventObjectsRaise("a string"))
    })
  )
})
