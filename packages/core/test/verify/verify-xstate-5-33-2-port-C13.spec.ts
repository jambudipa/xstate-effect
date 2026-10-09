/**
 * C13: stopping an actor stops its logic, its loop and its children.
 *
 * T2.44, D12. Upstream (`createActor.ts`, `stateUtils.ts` at xstate@5.33.2) handles a stop as
 * the `xstate.stop` event: the machine stops every child in `snapshot.children`
 * (`stopChildren`), its status becomes `stopped`, its delayed events are cancelled
 * (`_stopProcedure`), and no exit action runs. A machine that reaches a final state stops its
 * children too (a macrostep that ends non-active).
 *
 * The port gives every child a scope inside its parent's scope (D12): the parent's stop, done
 * or error closes it, so each child stops, its finalizers run once (a callback logic's cleanup
 * is one) and its status becomes `stopped`. That holds for a child created with
 * `createActor(logic, { parent })` outside the parent's processing too, and for the children
 * of a child.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Logger } from "effect"
import { TestClock } from "effect/testing"
import type { ActorRefBase } from "../../src/ActorRef.js"
import {
  type ActorType,
  assign,
  createActor,
  createMachine,
  type EventObject,
  fromCallback,
  isActor,
  raise,
  sendParent,
  spawnChild,
} from "../../src/index.js"

/** The child actor behind a reference; fails the test when the reference is not an actor. */
const asActor = (ref: ActorRefBase | undefined): ActorType.Any => {
  assert.isTrue(isActor(ref), "the reference is an actor")
  return ref as ActorType.Any
}

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

/** Runs `program` with a logger that keeps the text of every warning. */
const withWarningsCaptured = <A, E, R>(program: Effect.Effect<A, E, R>) => {
  const warnings: Array<string> = []
  return program.pipe(
    Effect.provide(
      Logger.layer([
        Logger.make((options) => {
          if (options.logLevel === "Warn") {
            const parts: ReadonlyArray<unknown> = Array.isArray(options.message) ? options.message : [options.message]
            warnings.push(parts.map(String).join(" "))
          }
        }),
      ])
    ),
    Effect.map((result) => ({ result, warnings }))
  )
}

interface Refs {
  readonly first?: ActorRefBase
}

type ParentEvent = { readonly type: "TICK" } | { readonly type: "LATE" } | { readonly type: "FINISH" }

describe("C13 Stopping an actor stops its logic, its loop and its children", () => {
  it.effect("[C13] stopping the machine stops both spawned children and runs each child's finalizer once; the machine status is stopped", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const machine = createMachine<Refs, ParentEvent>({
        id: "c13-stop",
        context: {},
        entry: [
          assign<Refs, ParentEvent>({ first: ({ spawn }) => spawn(recorded("first", log), { id: "first" }) }),
          spawnChild<Refs, ParentEvent, ReturnType<typeof recorded>>(recorded("second", log), { id: "second" }),
        ],
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      const children = (yield* actor.getSnapshot).children
      assert.deepStrictEqual(Object.keys(children), ["first", "second"])
      assert.deepStrictEqual(log, ["first started", "second started"])

      yield* actor.stop
      yield* settle

      assert.strictEqual((yield* actor.getSnapshot).status, "stopped")
      assert.strictEqual(yield* statusOf(children["first"]!), "stopped")
      assert.strictEqual(yield* statusOf(children["second"]!), "stopped")
      assert.deepStrictEqual([...log].sort(), ["first cleanup", "first started", "second cleanup", "second started"])

      // A second stop runs no finalizer again
      yield* actor.stop
      yield* settle
      assert.strictEqual(log.filter((entry) => entry.endsWith("cleanup")).length, 2)
    })
  )

  it.effect("[C13] after the stop of a machine in a nested state no exit action runs and no scheduled event of the machine or its children fires", () =>
    Effect.gen(function* () {
      const exits: Array<string> = []
      const log: Array<string> = []
      const sender = createMachine<object, EventObject>({
        id: "c13-sender",
        context: {},
        entry: sendParent<object, EventObject>({ type: "LATE" }, { delay: 100 }),
      })
      const machine = createMachine<object, ParentEvent>({
        id: "c13-nested",
        initial: "outer",
        context: {},
        states: {
          outer: {
            initial: "inner",
            exit: () => {
              exits.push("outer")
            },
            states: {
              inner: {
                entry: [
                  raise<object, ParentEvent>({ type: "TICK" }, { delay: 100, id: "tick" }),
                  spawnChild<object, ParentEvent, typeof sender>(sender, { id: "sender" }),
                  spawnChild<object, ParentEvent, ReturnType<typeof recorded>>(recorded("worker", log), { id: "worker" }),
                ],
                exit: () => {
                  exits.push("inner")
                },
              },
            },
          },
        },
      })

      const { result, warnings } = yield* withWarningsCaptured(
        Effect.gen(function* () {
          const actor = yield* createActor(machine)
          yield* actor.start
          const children = (yield* actor.getSnapshot).children
          yield* actor.stop
          yield* TestClock.adjust("1 second")
          yield* settle
          return {
            status: (yield* actor.getSnapshot).status,
            sender: yield* statusOf(children["sender"]!),
            worker: yield* statusOf(children["worker"]!),
          }
        })
      )

      assert.deepStrictEqual(result, { status: "stopped", sender: "stopped", worker: "stopped" })
      assert.deepStrictEqual(exits, [])
      assert.deepStrictEqual(log, ["worker started", "worker cleanup"])
      // A delayed event that fired after the stop would warn that it reached a stopped actor
      assert.deepStrictEqual(warnings.filter((warning) => warning.includes("TICK") || warning.includes("LATE")), [])
    })
  )

  it.effect("[C13] a child created with createActor(logic, { parent }) outside the parent's processing stops when the parent stops", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const parent = yield* createActor(createMachine<object, ParentEvent>({ id: "c13-parent", context: {} }))
      yield* parent.start
      const outside = yield* createActor(recorded("outside", log), { parent: parent.ref })
      yield* outside.start

      yield* parent.stop
      yield* settle

      assert.strictEqual(yield* statusOf(outside), "stopped")
      assert.deepStrictEqual(log, ["outside started", "outside cleanup"])
    })
  )

  it.effect("[C13] stopping the machine stops the children of its children", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const middle = createMachine<object, EventObject>({
        id: "c13-middle",
        context: {},
        entry: spawnChild<object, EventObject, ReturnType<typeof recorded>>(recorded("grandchild", log), { id: "grandchild" }),
      })
      const machine = createMachine<object, ParentEvent>({
        id: "c13-tree",
        context: {},
        entry: spawnChild<object, ParentEvent, typeof middle>(middle, { id: "middle" }),
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      const middleRef = (yield* actor.getSnapshot).children["middle"]
      const grandchild = asActor(
        ((yield* asActor(middleRef).getSnapshot) as unknown as { readonly children: Record<string, ActorRefBase> }).children[
          "grandchild"
        ]
      )
      assert.deepStrictEqual(log, ["grandchild started"])

      yield* actor.stop
      yield* settle

      assert.strictEqual(yield* statusOf(middleRef!), "stopped")
      assert.strictEqual(yield* statusOf(grandchild), "stopped")
      assert.deepStrictEqual(log, ["grandchild started", "grandchild cleanup"])
    })
  )

  it.effect("[C13] a machine that reaches its final state stops its children", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const machine = createMachine<object, ParentEvent>({
        id: "c13-done",
        initial: "running",
        context: {},
        states: {
          running: {
            entry: spawnChild<object, ParentEvent, ReturnType<typeof recorded>>(recorded("worker", log), { id: "worker" }),
            on: { FINISH: "finished" },
          },
          finished: { type: "final" },
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      const worker = (yield* actor.getSnapshot).children["worker"]

      yield* actor.send({ type: "FINISH" })
      yield* settle

      assert.strictEqual((yield* actor.getSnapshot).status, "done")
      assert.strictEqual(yield* statusOf(worker!), "stopped")
      assert.deepStrictEqual(log, ["worker started", "worker cleanup"])
    })
  )
})
