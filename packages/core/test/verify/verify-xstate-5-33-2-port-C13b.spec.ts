/**
 * C13b: stop respects the macrostep and the scope.
 *
 * T2.44, D12, SD-23. A stop made from a subscriber while the machine runs a macrostep lets
 * that macrostep commit, then drops the events still queued (upstream `_stop` clears the
 * mailbox and the macrostep in progress runs to its end); the machine's spawned child stops
 * with it. An actor is a resource of the scope it was created in: closing that scope stops an
 * actor that was never stopped, and the actor's own scope closes with it, so its spawned
 * children stop too and their finalizers run.
 *
 * Every wait is a Deferred handshake or a bounded number of yields; no test sleeps.
 */
import { assert, describe, it } from "@effect/vitest"
import { Deferred, Effect, Fiber } from "effect"
import type { ActorRefBase } from "../../src/ActorRef.js"
import { assign, createActor, createMachine, fromCallback, spawnChild } from "../../src/index.js"

/** The status of the snapshot the reference reads now. */
const statusOf = (ref: ActorRefBase) => Effect.map(ref.getSnapshotUntyped, (snapshot) => snapshot.status)

/** Lets every other ready fiber take ten turns. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 10; turn++) {
    yield* Effect.yieldNow
  }
})

/** A callback logic that records its start and its cleanup under `name`. */
const recorded = (name: string, log: Array<string>) =>
  fromCallback(() => {
    log.push(`${name} started`)
    return () => {
      log.push(`${name} cleanup`)
    }
  })

interface Steps {
  readonly steps: ReadonlyArray<string>
}

type StepEvent =
  | { readonly type: "first" }
  | { readonly type: "second" }
  | { readonly type: "third" }
  | { readonly type: "fourth" }

describe("C13b Stop respects the macrostep and the scope", () => {
  it.effect("[C13b] a subscriber that stops the machine during a macrostep with two events queued lets that macrostep commit, drops both queued events, and the spawned child stops", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const enteredSecond = yield* Deferred.make<void>()
      const releaseSecond = yield* Deferred.make<void>()
      const record = assign<Steps, StepEvent>(({ context, event }) => ({ steps: [...context.steps, event.type] }))
      const machine = createMachine<Steps, StepEvent>({
        id: "c13b-stop",
        initial: "active",
        context: { steps: [] },
        states: {
          active: {
            entry: spawnChild<Steps, StepEvent, ReturnType<typeof recorded>>(recorded("child", log), { id: "child" }),
            on: {
              first: { actions: record },
              second: {
                actions: [() => Effect.andThen(Deferred.succeed(enteredSecond, undefined), Deferred.await(releaseSecond)), record],
              },
              third: { actions: record },
              fourth: { actions: record },
            },
          },
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      const child = (yield* actor.getSnapshot).children["child"]
      yield* actor.subscribe((snapshot) =>
        snapshot.context.steps.length === 1
          ? Effect.gen(function* () {
              // Stop while `second` runs and `third` and `fourth` wait in the mailbox
              yield* Deferred.await(enteredSecond)
              yield* actor.stop
            })
          : Effect.void
      )

      const sends = yield* Effect.forEach(["first", "second", "third", "fourth"] as const, (type) =>
        Effect.forkChild(actor.send({ type }))
      )
      yield* Deferred.await(enteredSecond)
      yield* settle
      yield* Deferred.succeed(releaseSecond, undefined)
      yield* Effect.forEach(sends, Fiber.join, { discard: true })
      yield* settle

      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.status, "stopped")
      assert.deepStrictEqual(snapshot.context.steps, ["first", "second"])
      assert.isDefined(child)
      assert.strictEqual(yield* statusOf(child!), "stopped")
      assert.deepStrictEqual(log, ["child started", "child cleanup"])
    })
  )

  it.effect("[C13b] closing the scope of an actor that was never stopped stops it and its spawned children", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const machine = createMachine<Steps, StepEvent>({
        id: "c13b-scope",
        context: { steps: [] },
        entry: [
          spawnChild<Steps, StepEvent, ReturnType<typeof recorded>>(recorded("one", log), { id: "one" }),
          spawnChild<Steps, StepEvent, ReturnType<typeof recorded>>(recorded("two", log), { id: "two" }),
        ],
      })

      const { actor, children } = yield* Effect.scoped(
        Effect.gen(function* () {
          const actor = yield* createActor(machine)
          yield* actor.start
          return { actor, children: (yield* actor.getSnapshot).children }
        })
      )
      yield* settle

      assert.strictEqual((yield* actor.getSnapshot).status, "stopped")
      assert.deepStrictEqual(Object.keys(children), ["one", "two"])
      assert.strictEqual(yield* statusOf(children["one"]!), "stopped")
      assert.strictEqual(yield* statusOf(children["two"]!), "stopped")
      assert.deepStrictEqual([...log].sort(), ["one cleanup", "one started", "two cleanup", "two started"])
    })
  )
})
