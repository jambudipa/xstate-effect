/**
 * COV-4: the shared private helpers of `src/internal`, in the cases the baseline left unhit.
 *
 * init-testing layer 4 (test design R-008, P1-014, P1-015). The outbox is on the delivery path
 * of every `emit`, `sendBack` and observer call: a delivery posted from inside a delivery of
 * the same outbox runs at once, inside it (upstream's plain call, depth first); one that waits
 * goes on in its own fiber, which the close of the outbox's scope interrupts; after the close
 * every post is dropped. `isolateCallback` reports what a callback fails or dies with once
 * through the logger and swallows it (SD-21), and keeps an interruption an interruption.
 */
import { assert, describe, it } from "@effect/vitest"
import { Cause, Deferred, Effect, Exit, Logger, Scope } from "effect"
import * as Outbox from "../../src/internal/outbox.js"
import { isolateCallback, reportUnhandledError } from "../../src/internal/reportError.js"

/** Lets every other ready fiber take twenty turns. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 20; turn++) {
    yield* Effect.yieldNow
  }
})

/** One log entry as a test logger saw it. */
interface Entry {
  readonly logLevel: string
  readonly message: ReadonlyArray<unknown>
}

/** Runs `program` with a logger that keeps every log entry in `entries`. */
const withLogger = <A, E, R>(entries: Array<Entry>, program: Effect.Effect<A, E, R>) =>
  program.pipe(
    Effect.provide(
      Logger.layer([
        Logger.make((options) => {
          entries.push({
            logLevel: options.logLevel,
            message: Array.isArray(options.message) ? options.message : [options.message],
          })
        }),
      ])
    )
  )

describe("COV-4 shared private helpers (src/internal)", () => {
  it.effect("[COV-4] outbox: a delivery posted inside a delivery runs at once, depth first; one that waits goes on in its own fiber without holding later posts", () =>
    Effect.gen(function* () {
      const order: Array<string> = []
      const gate = yield* Deferred.make<void>()
      const scope = yield* Scope.make()
      const outbox = yield* Outbox.make.pipe(Scope.provide(scope))

      outbox.post(
        Effect.sync(() => {
          order.push("outer start")
          outbox.post(
            Effect.gen(function* () {
              order.push("inner start")
              yield* Deferred.await(gate)
              order.push("inner end")
            })
          )
          order.push("outer end")
        })
      )
      outbox.post(
        Effect.sync(() => {
          order.push("next")
        })
      )
      // Each post ran its delivery before it returned; the inner one waits in its own fiber
      assert.deepStrictEqual(order, ["outer start", "inner start", "outer end", "next"])

      yield* Deferred.succeed(gate, undefined)
      yield* settle
      assert.deepStrictEqual(order, ["outer start", "inner start", "outer end", "next", "inner end"])
      yield* Scope.close(scope, Exit.void)
    })
  )

  it.effect("[COV-4] outbox: the close interrupts a nested delivery that still waits, and drops every later post", () =>
    Effect.gen(function* () {
      const order: Array<string> = []
      const scope = yield* Scope.make()
      const outbox = yield* Outbox.make.pipe(Scope.provide(scope))

      outbox.post(
        Effect.sync(() => {
          outbox.post(
            Effect.never.pipe(
              Effect.onInterrupt(() =>
                Effect.sync(() => {
                  order.push("inner interrupted")
                })
              )
            )
          )
          order.push("outer end")
        })
      )
      assert.deepStrictEqual(order, ["outer end"])

      yield* Scope.close(scope, Exit.void)
      assert.deepStrictEqual(order, ["outer end", "inner interrupted"])

      outbox.post(
        Effect.sync(() => {
          order.push("after close")
        })
      )
      yield* settle
      assert.deepStrictEqual(order, ["outer end", "inner interrupted"])
    })
  )

  it.effect("[COV-4] outbox: deliveries posted from outside run one at a time in post order, and one that dies is reported and the next runs", () =>
    Effect.gen(function* () {
      const order: Array<string> = []
      const entries: Array<Entry> = []
      const gate = yield* Deferred.make<void>()
      yield* withLogger(
        entries,
        Effect.gen(function* () {
          const scope = yield* Scope.make()
          const outbox = yield* Outbox.make.pipe(Scope.provide(scope))
          outbox.post(
            Effect.gen(function* () {
              order.push("first start")
              yield* Deferred.await(gate)
              order.push("first end")
            })
          )
          outbox.post(Effect.die("dead delivery"))
          outbox.post(
            Effect.sync(() => {
              order.push("last")
            })
          )
          // The first delivery waits, so the others wait behind it
          assert.deepStrictEqual(order, ["first start"])

          yield* Deferred.succeed(gate, undefined)
          yield* settle
          yield* Scope.close(scope, Exit.void)
        })
      )

      assert.deepStrictEqual(order, ["first start", "first end", "last"])
      assert.deepStrictEqual(
        entries.map((entry) => [entry.logLevel, entry.message]),
        [["Error", ["dead delivery"]]]
      )
    })
  )

  it.effect("[COV-4] isolateCallback: a failure or a defect is reported once with the original value and goes no further; an interruption stays an interruption", () =>
    Effect.gen(function* () {
      const entries: Array<Entry> = []
      const original = new Error("listener failed")

      const failed = yield* withLogger(entries, Effect.exit(isolateCallback(() => Effect.fail(original))))
      const died = yield* withLogger(entries, Effect.exit(isolateCallback(() => Effect.die("listener died"))))
      assert.isTrue(Exit.isSuccess(failed))
      assert.isTrue(Exit.isSuccess(died))
      assert.deepStrictEqual(
        entries.map((entry) => [entry.logLevel, entry.message]),
        [
          ["Error", [original]],
          ["Error", ["listener died"]],
        ]
      )

      const interrupted = yield* withLogger(entries, Effect.exit(isolateCallback(() => Effect.interrupt)))
      assert.isTrue(Exit.isFailure(interrupted))
      assert.isTrue(Exit.isFailure(interrupted) && Cause.hasInterruptsOnly(interrupted.cause))
      assert.strictEqual(entries.length, 2, "an interruption is not reported")
    })
  )

  it.effect("[COV-4] reportUnhandledError: logs the original value once at level Error", () =>
    Effect.gen(function* () {
      const entries: Array<Entry> = []
      const original = { reason: "unhandled" }
      yield* withLogger(entries, reportUnhandledError(original))
      assert.deepStrictEqual(
        entries.map((entry) => [entry.logLevel, entry.message]),
        [["Error", [original]]]
      )
    })
  )
})
