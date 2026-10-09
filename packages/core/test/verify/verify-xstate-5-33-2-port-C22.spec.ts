/**
 * C22: clock and logger propagate to children.
 *
 * T5.12. Upstream `src/createActor.ts` at xstate@5.33.2: a root actor creates its system
 * with `{ clock, logger }` (`createSystem`, `src/system.ts`; defaults: a clock on the global
 * timers and `console.log`); a child joins its parent's system. Each actor's logger is
 * `options?.logger ?? system._logger` and its clock `options?.clock ?? system._clock`; the
 * actor scope hands the logger to `executeLog` (`src/actions/log.ts`), which calls
 * `logger(label, value)` for a label that is not empty and `logger(value)` without one. The
 * system's scheduler starts every delayed event of the system on the system's clock. A tsx
 * probe of 5.33.2 (`packages/core/.upstream/measure/t512/probe-up.ts`) gives: the root, an
 * invoked child, its spawned grandchild and a spawned child all call the root logger, once
 * per log action (at start: grandchild, child, root, because the machine's `start` starts its
 * children before the deferred phase runs its own initial actions); a child created with
 * `{ parent, logger }` calls its own; a logger that throws gives the actor status `error`
 * with the thrown value, and in an invoked child it takes the parent's `onError`; the
 * children's `after` and delayed `raise` follow the root `SimulatedClock` and `child.clock` is
 * the root clock; a child created with `{ parent, clock }` has that `clock` member, but its
 * timers run on the system's clock.
 *
 * The port's default logger is Effect logging at the action's level with the actorId and
 * sessionId annotations (C12), not `console.log` (SD-21); without a clock option every timer
 * runs on the Effect clock, so `TestClock.adjust` drives the children's timers too. A user
 * logger receives no level (upstream has none). Children start in their own fibers (D12),
 * so the tests wait with bounded yields; none sleeps.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Logger, Option, References } from "effect"
import { TestClock } from "effect/testing"
import type { ActorRefBase } from "../../src/ActorRef.js"
import {
  type ActorType,
  createActor,
  createMachine,
  isActor,
  log,
  raise,
  SimulatedClock,
  spawnChild,
} from "../../src/index.js"

/** Lets every other ready fiber take a bounded number of turns. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 25; turn++) {
    yield* Effect.yieldNow
  }
})

/** Yields until `check` holds, at most 200 times; gives whether it held. */
const eventually = (check: () => boolean | Effect.Effect<boolean>) =>
  Effect.gen(function* () {
    for (let turn = 0; turn < 200; turn++) {
      const held = check()
      if (typeof held === "boolean" ? held : yield* held) {
        return true
      }
      yield* Effect.yieldNow
    }
    return false
  })

/** The child actor behind a reference; fails the test when the reference is not an actor. */
const asActor = (ref: ActorRefBase | undefined): ActorType.Any => {
  assert.isTrue(isActor(ref), "the reference is an actor")
  return ref as ActorType.Any
}

/** Any actor, read through its snapshot only. */
interface Readable {
  readonly getSnapshot: Effect.Effect<object>
}

/** The child of `actor` under `id`. */
const childOf = (actor: Readable, id: string) =>
  Effect.map(actor.getSnapshot, (snapshot) =>
    asActor("children" in snapshot ? (snapshot.children as Readonly<Record<string, ActorRefBase>>)[id] : undefined)
  )

/** The state value of `actor`. */
const valueOf = (actor: Readable) =>
  Effect.map(actor.getSnapshot, (snapshot): unknown => ("value" in snapshot ? snapshot.value : undefined))

/** A logger option that keeps each call's argument list in `calls`. */
const recordInto = (calls: Array<ReadonlyArray<unknown>>) => (...args: ReadonlyArray<unknown>) => {
  calls.push(args)
}

/** One log entry as a test Effect logger saw it. */
interface Entry {
  readonly logLevel: Logger.Options<unknown>["logLevel"]
  readonly message: ReadonlyArray<unknown>
  readonly annotations: Readonly<Record<string, unknown>>
}

/** Runs `program` with an Effect logger that keeps every entry, Debug included, in `entries`. */
const withLogger = <A, E, R>(entries: Array<Entry>, program: Effect.Effect<A, E, R>) =>
  program.pipe(
    Effect.provide(
      Logger.layer([
        Logger.make((options) => {
          entries.push({
            logLevel: options.logLevel,
            message: Array.isArray(options.message) ? options.message : [options.message],
            annotations: options.fiber.getRef(References.CurrentLogAnnotations),
          })
        }),
      ])
    ),
    Effect.provideService(References.MinimumLogLevel, "All")
  )

/** A machine whose entry logs `value`, under `label` when one is given. */
const logging = (value: string, label?: string) => createMachine({ entry: log(value, label) })

/** `a` raises GO after 50 ms and takes it to `b`; `b` goes to `c` 100 ms after it is entered. */
const timed = createMachine({
  initial: "a",
  states: {
    a: { entry: raise({ type: "GO" }, { delay: 50 }), on: { GO: "b" } },
    b: { after: { 100: "c" } },
    c: {},
  },
})

/** A root that invokes `timed` as `inv` and spawns it as `sp`. */
const timedParent = createMachine({
  invoke: { id: "inv", src: timed },
  entry: spawnChild(timed, { id: "sp" }),
})

/**
 * `timed` with a log on entry to each state, prefixed with `name`: `a` logs at start, `b` when
 * the delayed raise fires and `c` when the `after` timer fires.
 */
const loggingTimed = (name: string) =>
  createMachine({
    initial: "a",
    states: {
      a: { entry: [log(`${name} a`), raise({ type: "GO" }, { delay: 50 })], on: { GO: "b" } },
      b: { entry: log(`${name} b`), after: { 100: "c" } },
      c: { entry: log(`${name} c`) },
    },
  })

describe("C22 clock and logger propagate to children", () => {
  it.effect("[C22] invoked and spawned child machines, and a grandchild, log through the root logger option, once per log action, with upstream's arguments", () =>
    Effect.gen(function* () {
      const calls: Array<ReadonlyArray<unknown>> = []
      const child = createMachine({
        entry: [log("child-value", "child-label"), spawnChild(logging("grandchild"), { id: "gc" })],
      })
      const machine = createMachine({
        entry: log("root"),
        invoke: { id: "inv", src: child },
        on: { SPAWN: { actions: spawnChild(logging("spawned"), { id: "sp" }) } },
      })
      const actor = yield* createActor(machine, { logger: recordInto(calls) })
      assert.deepStrictEqual(calls, [], "nothing logs before start")

      yield* actor.start
      assert.isTrue(yield* eventually(() => calls.length >= 3), "the root, the child and the grandchild log")
      yield* actor.send({ type: "SPAWN" })
      assert.isTrue(yield* eventually(() => calls.length >= 4), "the spawned child logs")
      yield* settle

      // Upstream's order: the machine's start starts its children before its own initial
      // actions run, so the grandchild logs first and the root last
      assert.deepStrictEqual(calls, [["grandchild"], ["child-label", "child-value"], ["root"], ["spawned"]])
      assert.strictEqual((yield* actor.getSnapshot).status, "active")
    })
  )

  it.effect("[C22] a log with an empty label calls the logger with the value alone, and a value function's result is passed unchanged", () =>
    Effect.gen(function* () {
      const calls: Array<ReadonlyArray<unknown>> = []
      const machine = createMachine({
        context: { n: 1 },
        entry: [log(({ context }) => context, ""), log(() => 42, "num")],
      })
      const actor = yield* createActor(machine, { logger: recordInto(calls) })
      yield* actor.start

      assert.deepStrictEqual(calls, [[{ n: 1 }], ["num", 42]])
    })
  )

  it.effect("[C22] a user logger receives no level: a level option logs the label and the value through it, and nothing reaches the Effect logger", () => {
    const entries: Array<Entry> = []
    return withLogger(
      entries,
      Effect.gen(function* () {
        const calls: Array<ReadonlyArray<unknown>> = []
        const machine = createMachine({ entry: log("careful", { level: "warning", label: "L" }) })
        const actor = yield* createActor(machine, { logger: recordInto(calls) })
        yield* actor.start

        assert.deepStrictEqual(calls, [["L", "careful"]])
        assert.deepStrictEqual(entries, [])
      })
    )
  })

  it.effect("[C22] a child created with a parent and its own logger logs through its own; one created with a parent alone through the root's", () =>
    Effect.gen(function* () {
      const rootCalls: Array<ReadonlyArray<unknown>> = []
      const ownCalls: Array<ReadonlyArray<unknown>> = []
      const root = yield* createActor(createMachine({}), { logger: recordInto(rootCalls) })
      yield* root.start

      const own = yield* createActor(logging("own"), { parent: root, logger: recordInto(ownCalls) })
      yield* own.start
      const inherited = yield* createActor(logging("inherit"), { parent: root })
      yield* inherited.start

      assert.deepStrictEqual(ownCalls, [["own"]])
      assert.deepStrictEqual(rootCalls, [["inherit"]])
    })
  )

  it.effect("[C22] a logger that throws gives the actor status error with the thrown value", () =>
    Effect.gen(function* () {
      const boom = new Error("logger boom")
      const actor = yield* createActor(logging("x"), {
        logger: () => {
          throw boom
        },
      })
      yield* actor.start

      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.status, "error")
      assert.deepStrictEqual(snapshot.error, Option.some(boom))
    })
  )

  it.effect("[C22] the root logger throwing inside an invoked child errors the child, and the parent takes its onError", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        initial: "a",
        states: {
          a: { invoke: { id: "c", src: logging("x"), onError: "failed" } },
          failed: {},
        },
      })
      const actor = yield* createActor(machine, {
        logger: () => {
          throw new Error("child logger boom")
        },
      })
      yield* actor.start

      assert.isTrue(yield* eventually(() => Effect.map(valueOf(actor), (value) => value === "failed")), "the parent takes onError")
      assert.strictEqual((yield* actor.getSnapshot).status, "active")
    })
  )

  it.effect("[C22] invoked and spawned children's delayed raise and after timers follow the root SimulatedClock, and each child's clock is the root clock", () =>
    Effect.gen(function* () {
      const clock = new SimulatedClock()
      const actor = yield* createActor(timedParent, { clock })
      yield* actor.start
      const invoked = yield* childOf(actor, "inv")
      const spawned = yield* childOf(actor, "sp")
      const values = Effect.all([valueOf(invoked), valueOf(spawned)])

      assert.strictEqual(invoked.clock, clock)
      assert.strictEqual(spawned.clock, clock)
      assert.deepStrictEqual(yield* values, ["a", "a"])

      // The Effect clock drives none of them
      yield* TestClock.adjust("1 second")
      yield* settle
      assert.deepStrictEqual(yield* values, ["a", "a"])

      yield* clock.increment(50)
      assert.deepStrictEqual(yield* values, ["b", "b"])
      yield* clock.increment(99)
      assert.deepStrictEqual(yield* values, ["b", "b"])
      yield* clock.increment(1)
      assert.deepStrictEqual(yield* values, ["c", "c"])
    })
  )

  it.effect("[C22] a child created with a parent and its own clock has that clock member, and its timers run on the system's clock", () =>
    Effect.gen(function* () {
      const rootClock = new SimulatedClock()
      const ownClock = new SimulatedClock()
      const root = yield* createActor(createMachine({}), { clock: rootClock })
      yield* root.start
      const child = yield* createActor(createMachine({ initial: "a", states: { a: { after: { 10: "b" } }, b: {} } }), {
        parent: root,
        clock: ownClock,
      })
      yield* child.start

      assert.strictEqual(child.clock, ownClock)
      yield* ownClock.increment(10)
      yield* settle
      assert.strictEqual((yield* child.getSnapshot).value, "a")
      yield* rootClock.increment(10)
      assert.strictEqual((yield* child.getSnapshot).value, "b")
    })
  )

  it.effect("[C22] without a logger option the children log through the Effect logger at the action's level, with their own actorId and sessionId annotations", () => {
    const entries: Array<Entry> = []
    return withLogger(
      entries,
      Effect.gen(function* () {
        const machine = createMachine({
          invoke: { id: "inv", src: createMachine({ entry: log("invoked", { level: "warning" }) }) },
          entry: spawnChild(createMachine({ entry: log("spawned", "label") }), { id: "sp" }),
        })
        const actor = yield* createActor(machine)
        yield* actor.start
        assert.isTrue(yield* eventually(() => entries.length >= 2), "both children log")
        yield* settle
        const invoked = yield* childOf(actor, "inv")
        const spawned = yield* childOf(actor, "sp")

        const byMessage = (first: unknown) => entries.filter((entry) => entry.message[0] === first)
        assert.strictEqual(entries.length, 2)
        assert.deepStrictEqual(
          byMessage("invoked").map((entry) => [entry.logLevel, entry.message, entry.annotations]),
          [["Warn", ["invoked"], { actorId: "inv", sessionId: invoked.sessionId }]]
        )
        assert.deepStrictEqual(
          byMessage("label").map((entry) => [entry.logLevel, entry.message, entry.annotations]),
          [["Info", ["label", "spawned"], { actorId: "sp", sessionId: spawned.sessionId }]]
        )
      })
    )
  })

  it.effect("[C22] without a clock option the children's timers follow the Effect clock, and each child's clock is the system's clock", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(timedParent)
      yield* actor.start
      const invoked = yield* childOf(actor, "inv")
      const spawned = yield* childOf(actor, "sp")
      const values = Effect.all([valueOf(invoked), valueOf(spawned)])

      assert.strictEqual(invoked.clock, actor.clock)
      assert.strictEqual(spawned.clock, actor.clock)
      assert.strictEqual(actor.clock, actor.system._clock)

      yield* TestClock.adjust("50 millis")
      yield* settle
      assert.deepStrictEqual(yield* values, ["b", "b"])
      yield* TestClock.adjust("99 millis")
      yield* settle
      assert.deepStrictEqual(yield* values, ["b", "b"])
      yield* TestClock.adjust("1 millis")
      yield* settle
      assert.deepStrictEqual(yield* values, ["c", "c"])
    })
  )

  it.effect("[C22] one root created with both a clock and a logger: its invoked and spawned children log through the root logger, and the logs their delayed raise and after timers cause follow the root clock", () => {
    const entries: Array<Entry> = []
    return withLogger(
      entries,
      Effect.gen(function* () {
        const calls: Array<ReadonlyArray<unknown>> = []
        const clock = new SimulatedClock()
        const machine = createMachine({
          invoke: { id: "inv", src: loggingTimed("inv") },
          entry: spawnChild(loggingTimed("sp"), { id: "sp" }),
        })
        const actor = yield* createActor(machine, { clock, logger: recordInto(calls) })
        assert.deepStrictEqual(calls, [], "nothing logs before start")

        yield* actor.start
        assert.isTrue(yield* eventually(() => calls.length >= 2), "both children log on entry")
        yield* settle
        const invoked = yield* childOf(actor, "inv")
        const spawned = yield* childOf(actor, "sp")
        const values = Effect.all([valueOf(invoked), valueOf(spawned)])

        assert.strictEqual(invoked.clock, clock)
        assert.strictEqual(spawned.clock, clock)
        assert.deepStrictEqual(yield* values, ["a", "a"])
        // Upstream's order (tsx probe of 5.33.2 with this machine): the root's entry spawns
        // `sp` before the state's invoke creates `inv`
        assert.deepStrictEqual(calls, [["sp a"], ["inv a"]])

        // The Effect clock moves no child, so no timer-driven log appears
        yield* TestClock.adjust("1 second")
        yield* settle
        assert.deepStrictEqual(yield* values, ["a", "a"])
        assert.deepStrictEqual(calls, [["sp a"], ["inv a"]])

        // The root clock fires both delayed raises, and the entry logs of `b` reach the root logger
        yield* clock.increment(50)
        assert.deepStrictEqual(yield* values, ["b", "b"])
        assert.deepStrictEqual(calls, [["sp a"], ["inv a"], ["sp b"], ["inv b"]])
        yield* clock.increment(99)
        assert.deepStrictEqual(yield* values, ["b", "b"])
        assert.deepStrictEqual(calls, [["sp a"], ["inv a"], ["sp b"], ["inv b"]])
        // It fires both after timers, and the entry logs of `c` reach the root logger
        yield* clock.increment(1)
        assert.deepStrictEqual(yield* values, ["c", "c"])
        assert.deepStrictEqual(calls, [["sp a"], ["inv a"], ["sp b"], ["inv b"], ["sp c"], ["inv c"]])

        // Every log went to the root logger option; none reached the Effect logger
        assert.deepStrictEqual(entries, [])
        assert.strictEqual((yield* actor.getSnapshot).status, "active")
      })
    )
  })
})
