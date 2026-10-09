/**
 * P9: waitFor supports a signal and rejects on termination.
 *
 * T6.11. Upstream `waitFor` (`src/waitFor.ts` at xstate@5.33.2) rejects at once with the
 * reason of a signal that is aborted already; resolves at once when the current snapshot
 * satisfies the predicate, without subscribing and without listening to the signal; otherwise
 * it subscribes and resolves with the first later snapshot that satisfies the predicate. It
 * rejects with "Actor terminated without satisfying predicate" on the observer's `complete`,
 * with the actor's own error on its `error`, with the signal's reason on 'abort', and on its
 * timeout; it removes the 'abort' listener once, whichever way it ends, and logs a negative
 * timeout. In the port `waitFor` is an Effect (D6) that fails with the same values; the
 * termination and timeout failures are the tagged `WaitForTerminatedError` and
 * `WaitForTimeoutError` with upstream's texts, and the timeout runs on the Effect clock, also
 * for an actor on a SimulatedClock (SD-28). The port also ends the wait on an actor that is
 * stopped already (upstream subscribes to a stopped actor and waits for ever; ledger DEV-41).
 */
import { assert, describe, it, vi } from "@effect/vitest"
import { Effect, Exit, Fiber, Logger, Option } from "effect"
import { TestClock } from "effect/testing"
import {
  createActor,
  createMachine,
  SimulatedClock,
  waitFor,
  WaitForTerminatedError,
  WaitForTimeoutError,
} from "../../src/index.js"
import { actorTerminatedWithoutPredicate, negativeWaitForTimeout, waitForTimeout } from "./upstream-messages.js"

/** Lets every other ready fiber take ten turns. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 10; turn++) {
    yield* Effect.yieldNow
  }
})

/** `Some` of the exit of `fiber` when it ends while the other fibers take ten turns, `None` while it waits. */
const exitWithoutWaiting = <A, E>(fiber: Fiber.Fiber<A, E>) =>
  Effect.raceFirst(Effect.map(Fiber.await(fiber), Option.some), Effect.as(settle, Option.none<Exit.Exit<A, E>>()))

/** Forks `effect` in the test's scope, started at once. */
const started = <A, E>(effect: Effect.Effect<A, E>) => Effect.forkScoped(effect, { startImmediately: true })

/** `a -NEXT-> b -NEXT-> c`, none of them final. */
const steps = () =>
  createMachine({
    id: "p9-steps",
    initial: "a",
    states: { a: { on: { NEXT: "b" } }, b: { on: { NEXT: "c" } }, c: {} },
  })

/** `a -NEXT-> b`, where `b` is final. */
const finishing = () =>
  createMachine({
    id: "p9-finishing",
    initial: "a",
    states: { a: { on: { NEXT: "b" } }, b: { type: "final" } },
  })

/** A machine whose GO action throws `error`. */
const throwingOnGo = (error: unknown) =>
  createMachine({
    id: "p9-throwing",
    initial: "a",
    states: {
      a: {
        on: {
          GO: {
            actions: () => {
              throw error
            },
          },
        },
      },
    },
  })

/** An `AbortSignal` whose 'abort' listener calls the test spies on. */
const spiedSignal = () => {
  const controller = new AbortController()
  const added = vi.spyOn(controller.signal, "addEventListener")
  const removed = vi.spyOn(controller.signal, "removeEventListener")
  return { controller, signal: controller.signal, added, removed }
}

describe("P9 waitFor supports a signal and rejects on termination", () => {
  // upstream: test/waitFor.test.ts > waitFor > should resolve correctly when the predicate immediately matches the current state
  it.effect("[P9] waitFor gives the current snapshot at once when it satisfies the predicate, without reading changes", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(steps())
      yield* actor.start
      const changes = vi.spyOn(actor, "changes", "get")

      const snapshot = yield* waitFor(actor, (s) => s.matches("a"))

      assert.strictEqual(snapshot.value, "a")
      assert.strictEqual(changes.mock.calls.length, 0)
    })
  )

  // upstream: test/waitFor.test.ts > waitFor > should wait for a condition to be true and return the emitted value
  it.effect("[P9] waitFor gives the first later snapshot that satisfies the predicate", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(steps())
      yield* actor.start

      const waiting = yield* started(waitFor(actor, (s) => s.matches("c")))
      yield* actor.send({ type: "NEXT" })
      yield* actor.send({ type: "NEXT" })
      const snapshot = yield* Fiber.join(waiting)

      assert.strictEqual(snapshot.value, "c")
    })
  )

  // upstream: test/waitFor.test.ts > waitFor > should throw an error when reaching a final state that does not match the predicate
  it.effect("[P9] an actor that is done without a match fails the wait with WaitForTerminatedError", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(finishing())
      yield* actor.start

      const waiting = yield* started(Effect.flip(waitFor(actor, (s) => s.matches("never"))))
      yield* actor.send({ type: "NEXT" })
      const error = yield* Fiber.join(waiting)

      assert.instanceOf(error, WaitForTerminatedError)
      assert.strictEqual((error as WaitForTerminatedError).message, actorTerminatedWithoutPredicate)
    })
  )

  it.effect("[P9] an actor that is stopped without a match fails the wait with WaitForTerminatedError, and the predicate never sees the stopped snapshot", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(steps())
      yield* actor.start
      const statuses: Array<string> = []

      const waiting = yield* started(
        Effect.flip(
          waitFor(actor, (s) => {
            statuses.push(s.status)
            return s.matches("never")
          })
        )
      )
      yield* settle
      yield* actor.stop
      const error = yield* Fiber.join(waiting)

      assert.instanceOf(error, WaitForTerminatedError)
      assert.notInclude(statuses, "stopped")
    })
  )

  // upstream: test/waitFor.test.ts > waitFor > should immediately reject for an actor in its final state that does not match the predicate
  // The done actor is upstream's case. Upstream waits for ever on the two stopped actors (its
  // `subscribe` on a stopped actor calls no `complete`); the port ends the wait (DEV-41).
  it.effect("[P9] an actor that has ended already fails the wait at once with WaitForTerminatedError", () =>
    Effect.gen(function* () {
      const done = yield* createActor(finishing())
      yield* done.start
      yield* done.send({ type: "NEXT" })
      const stopped = yield* createActor(steps())
      yield* stopped.start
      yield* stopped.stop
      const stoppedBeforeStart = yield* createActor(steps())
      yield* stoppedBeforeStart.stop

      const afterDone = yield* Effect.flip(waitFor(done, (s) => s.matches("a")))
      const afterStop = yield* Effect.flip(waitFor(stopped, (s) => s.matches("b")))
      const afterStopBeforeStart = yield* Effect.flip(waitFor(stoppedBeforeStart, (s) => s.matches("b")))

      assert.instanceOf(afterDone, WaitForTerminatedError)
      assert.instanceOf(afterStop, WaitForTerminatedError)
      assert.instanceOf(afterStopBeforeStart, WaitForTerminatedError)
    })
  )

  it.effect("[P9] an actor that errors fails the wait with the actor's own error", () =>
    Effect.gen(function* () {
      const failure = new Error("p9 boom")
      const actor = yield* createActor(throwingOnGo(failure))
      yield* actor.start

      const waiting = yield* started(Effect.flip(waitFor(actor, (s) => s.matches("never"))))
      yield* actor.send({ type: "GO" })
      const error = yield* Fiber.join(waiting)

      assert.strictEqual(error, failure)
    })
  )

  // upstream: test/waitFor.test.ts > waitFor > should immediately reject when it receives an aborted signal
  it.effect("[P9] a signal aborted already fails the wait at once with its reason, before the predicate, without listening or reading changes", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(steps())
      yield* actor.start
      const { controller, signal, added } = spiedSignal()
      const reason = new Error("Aborted!")
      controller.abort(reason)
      const changes = vi.spyOn(actor, "changes", "get")
      const predicate = vi.fn(() => true)

      const error = yield* Effect.flip(waitFor(actor, predicate, { signal }))

      assert.strictEqual(error, reason)
      assert.strictEqual(predicate.mock.calls.length, 0)
      assert.strictEqual(added.mock.calls.length, 0)
      assert.strictEqual(changes.mock.calls.length, 0)
    })
  )

  // upstream: test/waitFor.test.ts > waitFor > should reject when the signal is aborted while waiting
  it.effect("[P9] an abort while waiting ends the wait with the abort reason and removes the 'abort' listener once", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(steps())
      yield* actor.start
      const { controller, signal, added, removed } = spiedSignal()
      const reason = new Error("Aborted!")

      const waiting = yield* started(Effect.flip(waitFor(actor, (s) => s.matches("c"), { signal })))
      yield* settle
      controller.abort(reason)
      const error = yield* Fiber.join(waiting)

      assert.strictEqual(error, reason)
      assert.strictEqual(added.mock.calls.length, 1)
      assert.strictEqual(removed.mock.calls.length, 1)
    })
  )

  // upstream: test/waitFor.test.ts > waitFor > should stop listening for the "abort" event upon successful completion
  it.effect("[P9] the 'abort' listener is removed once when the wait succeeds and once when it fails", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(finishing())
      yield* actor.start
      const success = spiedSignal()
      const failure = spiedSignal()

      const matched = yield* started(waitFor(actor, (s) => s.matches("b"), { signal: success.signal }))
      const unmatched = yield* started(Effect.flip(waitFor(actor, (s) => s.matches("never"), { signal: failure.signal })))
      yield* actor.send({ type: "NEXT" })
      yield* Fiber.join(matched)
      yield* Fiber.join(unmatched)

      assert.strictEqual(success.removed.mock.calls.length, 1)
      assert.strictEqual(failure.removed.mock.calls.length, 1)
      assert.strictEqual(success.removed.mock.calls[0]?.[1], success.added.mock.calls[0]?.[1])
    })
  )

  // upstream: test/waitFor.test.ts > waitFor > should throw an error after a timeout
  it.effect("[P9] a timeout fails the wait with WaitForTimeoutError and upstream's text when it elapses on the TestClock", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(steps())
      yield* actor.start

      const waiting = yield* started(Effect.flip(waitFor(actor, (s) => s.matches("c"), { timeout: 100 })))
      yield* TestClock.adjust("99 millis")
      const before = yield* exitWithoutWaiting(waiting)
      yield* TestClock.adjust("1 millis")
      const error = yield* Fiber.join(waiting)

      assert.isTrue(Option.isNone(before))
      assert.instanceOf(error, WaitForTimeoutError)
      assert.strictEqual((error as WaitForTimeoutError).timeout, 100)
      assert.strictEqual((error as WaitForTimeoutError).message, waitForTimeout(100))
    })
  )

  // upstream: test/waitFor.test.ts > waitFor > should not reject immediately when passing Infinity as timeout
  it.effect("[P9] an Infinity timeout never fails the wait", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(steps())
      yield* actor.start

      const waiting = yield* started(waitFor(actor, (s) => s.matches("b"), { timeout: Infinity }))
      yield* TestClock.adjust("1 hour")
      const before = yield* exitWithoutWaiting(waiting)
      yield* actor.send({ type: "NEXT" })
      const snapshot = yield* Fiber.join(waiting)

      assert.isTrue(Option.isNone(before))
      assert.strictEqual(snapshot.value, "b")
    })
  )

  it.effect("[P9] a negative timeout is reported through the logger and fails the wait at once, after a current match", () =>
    Effect.gen(function* () {
      const messages: Array<unknown> = []
      const logger = Logger.layer([
        Logger.make((options) => {
          if (options.logLevel === "Error") {
            messages.push(...(Array.isArray(options.message) ? options.message : [options.message]))
          }
        }),
      ])
      const actor = yield* createActor(steps())
      yield* actor.start

      const error = yield* Effect.flip(waitFor(actor, (s) => s.matches("c"), { timeout: -1 })).pipe(Effect.provide(logger))
      const current = yield* waitFor(actor, (s) => s.matches("a"), { timeout: -1 }).pipe(Effect.provide(logger))

      assert.instanceOf(error, WaitForTimeoutError)
      assert.strictEqual(current.value, "a")
      assert.deepStrictEqual(messages, [negativeWaitForTimeout, negativeWaitForTimeout])
    })
  )

  it.effect("[P9] on an actor driven by a SimulatedClock the timeout runs on the Effect clock, not on clock.increment (SD-28)", () =>
    Effect.gen(function* () {
      const clock = new SimulatedClock()
      const actor = yield* createActor(steps(), { clock })
      yield* actor.start

      const waiting = yield* started(Effect.flip(waitFor(actor, (s) => s.matches("c"), { timeout: 100 })))
      yield* clock.increment(1000)
      const afterIncrement = yield* exitWithoutWaiting(waiting)
      yield* TestClock.adjust("100 millis")
      const error = yield* Fiber.join(waiting)

      assert.isTrue(Option.isNone(afterIncrement))
      assert.instanceOf(error, WaitForTimeoutError)
    })
  )

  // upstream: test/waitFor.test.ts > waitFor > should internally unsubscribe when the predicate immediately matches the current state
  it.effect("[P9] nothing of the wait remains once it has given its snapshot: later snapshots reach no predicate", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(steps())
      yield* actor.start
      const predicate = vi.fn((s: { readonly matches: (value: string) => boolean }) => s.matches("b"))

      const waiting = yield* started(waitFor(actor, predicate))
      yield* actor.send({ type: "NEXT" })
      yield* Fiber.join(waiting)
      const calls = predicate.mock.calls.length
      yield* actor.send({ type: "NEXT" })
      yield* settle

      assert.strictEqual(predicate.mock.calls.length, calls)
    })
  )
})
