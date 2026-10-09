/**
 * Actor tests
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Fiber, Option, Stream, SubscriptionRef } from "effect"
import { createActor } from "../src/index.js"
import { counterMachine } from "../examples/counter.js"

describe("Actor", () => {
  describe("createActor", () => {
    it.effect("should create an actor without reading the snapshot before start", () =>
      Effect.gen(function* () {
        const actor = yield* createActor(counterMachine, { id: "counter" })

        assert.strictEqual(actor.id, "counter")
      })
    )

    it.effect("should keep the snapshot accessors as getters", () =>
      Effect.gen(function* () {
        const actor = yield* createActor(counterMachine)

        for (const key of ["snapshot", "snapshotStream", "changes", "emissions"]) {
          assert.strictEqual(typeof Object.getOwnPropertyDescriptor(actor, key)?.get, "function", key)
        }
      })
    )

    it.effect("should expose the snapshot through its getters after start", () =>
      Effect.gen(function* () {
        const actor = yield* createActor(counterMachine)
        yield* actor.start

        const snapshot = yield* SubscriptionRef.get(actor.snapshot)
        const fromStream = yield* actor.snapshotStream.get
        const head = yield* Stream.runHead(actor.changes)

        assert.strictEqual(snapshot.context.count, 0)
        assert.strictEqual(fromStream.context.count, 0)
        assert.deepStrictEqual(Option.map(head, (s) => s.context.count), Option.some(0))
        assert.notStrictEqual(actor.emissions, actor.emissions)
      })
    )

    it.effect("should deliver snapshots to a changes stream built before start", () =>
      Effect.gen(function* () {
        const actor = yield* createActor(counterMachine)
        const fiber = yield* Effect.forkChild(Stream.runHead(actor.changes))
        yield* actor.start

        const head = yield* Fiber.join(fiber)

        assert.deepStrictEqual(Option.map(head, (s) => s.context.count), Option.some(0))
      })
    )

    it.effect("should give a changes stream read before start the initial snapshot once, then each change", () =>
      Effect.gen(function* () {
        const actor = yield* createActor(counterMachine)
        const fiber = yield* Effect.forkChild(Stream.runCollect(Stream.take(actor.changes, 2)), { startImmediately: true })
        yield* actor.start
        yield* actor.send({ type: "increment" })

        const counts = (yield* Fiber.join(fiber)).map((s) => s.context.count)

        // `start` notifies the subscribe observers of the snapshot it starts from; the changes
        // stream already holds it, so it does not see it a second time
        assert.deepStrictEqual(counts, [0, 1])
      })
    )
  })
})
