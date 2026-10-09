/**
 * P10: the toPromise equivalent succeeds with the output and fails with the actor error.
 *
 * T6.12, SD-19. Upstream `toPromise` (`src/toPromise.ts` at xstate@5.33.2) subscribes an
 * observer to the actor: on `complete` it resolves with `actor.getSnapshot().output`, on
 * `error` it rejects with the actor's error. An observer added before `start` waits for the
 * actor to run. In the port `toEffect(actor)` is that wait as an Effect (D6): it succeeds with
 * the output as the snapshot stores it, an `Option` (D8), and fails with the actor's raw error,
 * not with `ActorOutputError`. It completes for an actor that stops (with `None`, the output
 * of a stopped snapshot) and for one that ended before the call, and it forks nothing, so
 * nothing of it remains once it completes. `toPromise` resolves the same value and rejects
 * with the same error.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Fiber, Option, Stream } from "effect"
import { ActorOutputError, createActor, createMachine, toEffect, toPromise } from "../../src/index.js"

/** `pending -FINISH-> done`, where `done` is final; the machine's output is `{ count: 42 }`. */
const finishing = () =>
  createMachine({
    id: "p10-finishing",
    initial: "pending",
    states: { pending: { on: { FINISH: "done" } }, done: { type: "final" } },
    output: { count: 42 },
  })

/** A machine that starts in its final state; its output is `{ count: 100 }`. */
const doneAtOnce = () =>
  createMachine({
    id: "p10-done",
    initial: "done",
    states: { done: { type: "final" } },
    output: { count: 100 },
  })

/** A machine whose GO action throws `error`. */
const throwingOnGo = (error: unknown) =>
  createMachine({
    id: "p10-throwing",
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

/** Forks `effect` in the test's scope, started at once. */
const started = <A, E>(effect: Effect.Effect<A, E>) => Effect.forkScoped(effect, { startImmediately: true })

/** Drains the actor's `changes` in the test's scope and ignores its failure (an error consumer, SD-21). */
const consumeErrors = (actor: { readonly changes: Stream.Stream<unknown, unknown> }) =>
  actor.changes.pipe(Stream.runDrain, Effect.ignore, started)

describe("P10 The toPromise equivalent succeeds with the output and fails with the actor error", () => {
  // upstream: test/toPromise.test.ts > toPromise > should await actors
  it.effect("[P10] toEffect of a running actor succeeds with Some of the output once the actor is done", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(finishing())
      yield* actor.start

      const waiting = yield* started(toEffect(actor))
      yield* actor.send({ type: "FINISH" })
      const output = yield* Fiber.join(waiting)

      assert.deepStrictEqual(output, Option.some({ count: 42 }))
    })
  )

  // upstream: test/toPromise.test.ts > toPromise > should immediately resolve for a done actor
  it.effect("[P10] toEffect of an actor that is done already succeeds at once with Some of its output", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(doneAtOnce())
      yield* actor.start

      const output = yield* toEffect(actor)

      assert.deepStrictEqual(output, Option.some({ count: 100 }))
    })
  )

  it.effect("[P10] toEffect of a running actor fails with the actor's original error, not ActorOutputError", () =>
    Effect.gen(function* () {
      const failure = new Error("p10 boom")
      const actor = yield* createActor(throwingOnGo(failure))
      yield* actor.start

      const waiting = yield* started(Effect.flip(toEffect(actor)))
      yield* actor.send({ type: "GO" })
      const error = yield* Fiber.join(waiting)

      assert.strictEqual(error, failure)
      assert.notInstanceOf(error, ActorOutputError)
    })
  )

  // upstream: test/toPromise.test.ts > toPromise > should immediately reject for an actor that had an error
  it.effect("[P10] toEffect of an actor that has errored already fails at once with the actor's original error", () =>
    Effect.gen(function* () {
      const failure = new Error("p10 errored before")
      const actor = yield* createActor(throwingOnGo(failure))
      yield* consumeErrors(actor)
      yield* actor.start
      yield* actor.send({ type: "GO" })
      assert.strictEqual((yield* actor.getSnapshot).status, "error")

      const error = yield* Effect.flip(toEffect(actor))

      assert.strictEqual(error, failure)
    })
  )

  it.effect("[P10] toEffect completes with None when the actor stops instead of hanging, while waiting and after the stop", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(finishing())
      yield* actor.start

      const waiting = yield* started(toEffect(actor))
      yield* actor.stop
      const whileWaiting = yield* Fiber.join(waiting)
      const afterStop = yield* toEffect(actor)

      assert.deepStrictEqual(whileWaiting, Option.none())
      assert.deepStrictEqual(afterStop, Option.none())
    })
  )

  it.effect("[P10] toEffect of an actor that never started completes when the actor is stopped instead of hanging", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(finishing())

      const waiting = yield* started(toEffect(actor))
      yield* actor.stop
      const output = yield* Fiber.join(waiting)

      assert.deepStrictEqual(output, Option.none())
    })
  )

  it.effect("[P10] toEffect forked before start waits for the later output: start and FINISH give Some of it", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(finishing())

      const waiting = yield* started(toEffect(actor))
      yield* actor.start
      yield* actor.send({ type: "FINISH" })
      const output = yield* Fiber.join(waiting)

      assert.deepStrictEqual(output, Option.some({ count: 42 }))
    })
  )

  it.effect("[P10] toEffect forks nothing: it needs no Scope", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(doneAtOnce())
      yield* actor.start

      // The requirements are `never`: no subscription fiber is forked into a caller's scope
      const program: Effect.Effect<unknown, unknown, never> = toEffect(actor)

      assert.deepStrictEqual(yield* program, Option.some({ count: 100 }))
    })
  )

  // upstream: test/toPromise.test.ts > toPromise > should be awaitable
  it.effect("[P10] toPromise resolves with the same Option output and rejects with the actor's original error", () =>
    Effect.gen(function* () {
      const done = yield* createActor(doneAtOnce())
      yield* done.start
      const failure = new Error("p10 promise boom")
      const failed = yield* createActor(throwingOnGo(failure))
      yield* consumeErrors(failed)
      yield* failed.start
      yield* failed.send({ type: "GO" })

      const output = yield* Effect.promise(() => toPromise(done))
      const rejection = yield* Effect.flip(Effect.tryPromise({ try: () => toPromise(failed), catch: (error) => error }))

      assert.deepStrictEqual(output, Option.some({ count: 100 }))
      assert.strictEqual(rejection, failure)
    })
  )
})
