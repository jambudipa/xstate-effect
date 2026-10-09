/**
 * ERR-2: unhandled root errors are reported and listener errors are isolated.
 *
 * T2.46, SD-21. Upstream (`createActor.ts` `_reportError` at xstate@5.33.2): an actor that
 * errors with no observer reports the error through `reportUnhandledError` when it has no
 * parent (its parent hears of it through the error event); with observers, it calls each
 * observer's error listener and reports the error when some observer has none. A throwing
 * `subscribe` callback or `actor.on` listener is reported the same way and leaves the actor's
 * status as it is. Upstream rethrows asynchronously; the port reports through the actor's
 * logger (`Effect.logError`), which these tests capture with a test `Logger` layer instead of a
 * DOM environment and a module mock of `reportUnhandledError`. In the port, a `changes` stream is an
 * observer with an error listener (it fails with the error, D6) and a `subscribe(fn)` callback
 * is an observer without one. Inspection functions are isolated the same way (SD-21).
 */
import { assert, describe, it } from "@effect/vitest"
import { Cause, Effect, Logger, Stream } from "effect"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import {
  assign,
  createActor,
  createMachine,
  emit,
  spawnChild,
} from "../../src/index.js"

/** The log entries a test logger kept. */
type Entries = Array<Logger.Options<unknown>>

/** Runs `program` with a logger that keeps every log entry in `entries`. */
const withLogger = <A, E, R>(entries: Entries, program: Effect.Effect<A, E, R>) =>
  program.pipe(
    Effect.provide(
      Logger.layer([
        Logger.make((options) => {
          entries.push(options)
        }),
      ])
    )
  )

/** The values one log entry carries: its message parts, then the errors and defects of its cause. */
const reportedValues = (entry: Logger.Options<unknown>): ReadonlyArray<unknown> => [
  ...(Array.isArray(entry.message) ? entry.message : [entry.message]),
  ...entry.cause.reasons.flatMap((reason) =>
    Cause.isDieReason(reason) ? [reason.defect] : Cause.isFailReason(reason) ? [reason.error] : []
  ),
]

/** The values of every Error-level entry, one list per report, in report order. */
const reports = (entries: Entries): ReadonlyArray<ReadonlyArray<unknown>> =>
  entries.filter((entry) => entry.logLevel === "Error").map(reportedValues)

/** Asserts that exactly one report was made and that it carries `error` itself. */
const assertReportedOnce = (entries: Entries, error: unknown) => {
  const made = reports(entries)
  assert.strictEqual(made.length, 1, "one report")
  assert.isTrue(made[0]!.includes(error), "the report carries the original error")
}

/** Lets every other ready fiber take ten turns. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 10; turn++) {
    yield* Effect.yieldNow
  }
})

type Ev = { readonly type: "GO" } | { readonly type: "PING" }

/** A root machine whose GO transition action throws `error`. */
const throwingOnGo = (id: string, error: unknown) =>
  createMachine<object, Ev>({
    id,
    context: {},
    on: {
      GO: {
        actions: () => {
          throw error
        },
      },
    },
  })

describe("ERR-2 Unhandled root errors are reported and listener errors are isolated", () => {
  it.effect("[ERR-2] a root machine with no parent and no error consumer whose action throws reports the original error exactly once through its logger, during an event and at start", () => {
    const entries: Entries = []
    return withLogger(
      entries,
      Effect.gen(function* () {
        const boom = new Error("unhandled in a transition")
        const actor = yield* createActor(throwingOnGo("err2-root", boom))
        yield* actor.start
        yield* actor.send({ type: "GO" })
        yield* settle
        assertReportedOnce(entries, boom)

        entries.length = 0
        const atStart = new Error("unhandled at start")
        const initial = createMachine<object, Ev>({
          id: "err2-initial",
          context: {},
          entry: () => {
            throw atStart
          },
        })
        const second = yield* createActor(initial)
        yield* second.start
        yield* settle
        assert.strictEqual((yield* second.getSnapshot).status, "error")
        assertReportedOnce(entries, atStart)
      })
    )
  })

  it.effect("[ERR-2] an emit listener that throws is reported and leaves the emitting actor active; it handles its next event", () => {
    const entries: Entries = []
    return withLogger(
      entries,
      Effect.gen(function* () {
        const oops = new Error("oops")
        const machine = createMachine<{ readonly pings: number }, Ev>({
          id: "err2-emitter",
          context: { pings: 0 },
          on: {
            PING: {
              actions: [
                emit<{ readonly pings: number }, Ev>({ type: "emitted" }),
                assign<{ readonly pings: number }, Ev>(({ context }) => ({ pings: context.pings + 1 })),
              ],
            },
          },
        })
        const actor = yield* createActor(machine)
        yield* actor.start
        let calls = 0
        yield* actor.on("emitted", () =>
          Effect.sync(() => {
            calls++
            throw oops
          })
        )

        yield* actor.send({ type: "PING" })
        yield* settle
        assert.strictEqual((yield* actor.getSnapshot).status, "active")
        assertReportedOnce(entries, oops)

        yield* actor.send({ type: "PING" })
        yield* settle
        const snapshot = yield* actor.getSnapshot
        assert.strictEqual(snapshot.status, "active")
        assert.strictEqual(snapshot.context.pings, 2)
        assert.strictEqual(calls, 2)
      })
    )
  })

  it.effect("[ERR-2] a subscribe callback and an inspection function that throw are reported and leave the actor active; the callback keeps receiving snapshots", () => {
    const entries: Entries = []
    return withLogger(
      entries,
      Effect.gen(function* () {
        const fromSubscriber = new Error("subscriber failed")
        const fromInspector = new Error("inspector failed")
        const machine = createMachine<{ readonly pings: number }, Ev>({
          id: "err2-observed",
          context: { pings: 0 },
          on: { PING: { actions: assign<{ readonly pings: number }, Ev>(({ context }) => ({ pings: context.pings + 1 })) } },
        })
        const actor = yield* createActor(machine)
        yield* actor.system.inspect((event) =>
          event.type === "@xstate.snapshot"
            ? Effect.sync(() => {
                throw fromInspector
              })
            : Effect.void
        )
        yield* actor.start
        const seen: Array<number> = []
        yield* actor.subscribe((snapshot) =>
          Effect.sync(() => {
            seen.push(snapshot.context.pings)
            if (snapshot.context.pings === 1) {
              throw fromSubscriber
            }
          })
        )

        yield* actor.send({ type: "PING" })
        yield* settle
        yield* actor.send({ type: "PING" })
        yield* settle

        const snapshot = yield* actor.getSnapshot
        assert.strictEqual(snapshot.status, "active")
        assert.strictEqual(snapshot.context.pings, 2)
        assert.deepStrictEqual(seen, [1, 2])
        const made = reports(entries)
        assert.strictEqual(made.filter((values) => values.includes(fromSubscriber)).length, 1, "the subscriber error is reported once")
        // The inspection function throws for the `@xstate.snapshot` of `start` (upstream
        // `update` with the init event) and of each PING
        assert.strictEqual(made.filter((values) => values.includes(fromInspector)).length, 3, "each inspector error is reported")
        assert.strictEqual(made.length, 4)
      })
    )
  })

  it.effect("[ERR-2] a root with a changes consumer reports nothing through the logger; the consumer receives the error", () => {
    const entries: Entries = []
    return withLogger(
      entries,
      Effect.gen(function* () {
        const boom = new Error("consumed")
        const actor = yield* createActor(throwingOnGo("err2-consumed", boom))
        const failures: Array<unknown> = []
        yield* actor.changes.pipe(
          Stream.runDrain,
          Effect.catch((error) => Effect.sync(() => failures.push(error))),
          Effect.forkScoped({ startImmediately: true })
        )
        yield* actor.start

        yield* actor.send({ type: "GO" })
        yield* settle

        assert.strictEqual((yield* actor.getSnapshot).status, "error")
        assert.deepStrictEqual(failures, [boom])
        assert.deepStrictEqual(reports(entries), [])
      })
    )
  })

  it.effect("[ERR-2] a child whose parent receives the error reports nothing through the logger, and nor does the parent that handles it", () => {
    const entries: Entries = []
    return withLogger(
      entries,
      Effect.gen(function* () {
        const boom = new Error("child failed")
        const child = throwingOnGo("err2-child", boom)
        type ParentEvent = { readonly type: "xstate.error.actor.child"; readonly error: unknown }
        const parent = createMachine<{ readonly handled: number }, ParentEvent>({
          id: "err2-parent",
          context: { handled: 0 },
          entry: spawnChild<{ readonly handled: number }, ParentEvent, typeof child>(child, { id: "child" }),
          on: {
            "xstate.error.actor.child": {
              actions: assign<{ readonly handled: number }, ParentEvent>(({ context }) => ({ handled: context.handled + 1 })),
            },
          },
        })
        const actor = yield* createActor(parent)
        yield* actor.start
        const childRef = (yield* actor.getSnapshot).children["child"]!

        yield* childRef.sendUntyped({ type: "GO" })
        yield* settle
        yield* settle

        assert.strictEqual((yield* actor.getSnapshot).context.handled, 1)
        assert.deepStrictEqual(reports(entries), [])
      })
    )
  })

  it.effect("[ERR-2] a root with only a subscribe(fn) callback, an observer without an error listener, reports the error once", () => {
    const entries: Entries = []
    return withLogger(
      entries,
      Effect.gen(function* () {
        const boom = new Error("observed without an error listener")
        const actor = yield* createActor(throwingOnGo("err2-subscribed", boom))
        yield* actor.subscribe(() => Effect.void)
        yield* actor.start

        yield* actor.send({ type: "GO" })
        yield* settle

        assert.strictEqual((yield* actor.getSnapshot).status, "error")
        assertReportedOnce(entries, boom)
      })
    )
  })

  it("[ERR-2] the test uses no DOM environment package (the one upstream names) and no module mock", () => {
    const source = readFileSync(fileURLToPath(import.meta.url), "utf8")
    // The names are built at run time, so this check does not find itself
    const environmentName = ["happy", "dom"].join("-")
    const moduleMocks = [["vi", "mock("].join("."), ["vi", "doMock("].join(".")]
    assert.isFalse(source.includes(environmentName))
    assert.isFalse(moduleMocks.some((mock) => source.includes(mock)))
    assert.isFalse("window" in globalThis, "the test runs without a DOM")
  })
})
