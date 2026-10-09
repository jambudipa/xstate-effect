/**
 * End-to-end smoke test: runs the counter example through a live actor.
 */
import { assert, describe, it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Stream } from "effect"
import { createActor } from "../src/index.js"
import { counterMachine } from "../examples/counter.js"

describe("smoke", () => {
  it.effect("runs the counter example through createActor, send and the snapshot", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(counterMachine)
      yield* actor.start

      // Collect one count per published snapshot. `changes` emits the current snapshot
      // first, so the Deferred proves the collector is subscribed before any send.
      const subscribed = yield* Deferred.make<void>()
      const collector = yield* actor.changes.pipe(
        Stream.tap(() => Deferred.succeed(subscribed, undefined)),
        Stream.map((snapshot) => snapshot.context.count),
        Stream.take(6),
        Stream.runCollect,
        Effect.forkChild
      )
      yield* Deferred.await(subscribed)

      yield* actor.send({ type: "increment" })
      yield* actor.send({ type: "increment" })
      yield* actor.send({ type: "decrement" })
      yield* actor.send({ type: "set", value: 42 })
      yield* actor.send({ type: "reset" })

      const counts = yield* Fiber.join(collector)
      assert.deepStrictEqual(counts, [0, 1, 2, 1, 42, 0])

      const final = yield* actor.getSnapshot
      assert.strictEqual(final.status, "active")
      assert.deepStrictEqual(final.value, "active")

      yield* actor.stop
      const stopped = yield* actor.getSnapshot
      assert.strictEqual(stopped.status, "stopped")
    })
  )
})
