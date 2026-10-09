/**
 * C19b: children of a parent that errors stop with it.
 *
 * T2.46, SD-27, D12. When an actor enters status `error` — through a throw in its own code
 * or through a child's error event it does not handle — its scope closes, so its spawned
 * children stop (their finalizers run) and no fiber or timer of it stays alive: its delayed
 * events are cancelled. Upstream (`createActor.ts` at xstate@5.33.2) stops children only when a
 * macrostep ends non-active and leaves them running on the throw path and on the unhandled
 * error-event path (its `_stopProcedure` TODO notes possible orphans); that difference is a
 * ledger row.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { TestClock } from "effect/testing"
import type { ActorRefBase } from "../../src/ActorRef.js"
import {
  type ActorType,
  createActor,
  createMachine,
  type EventObject,
  fromCallback,
  isActor,
  sendTo,
  spawnChild,
} from "../../src/index.js"

/** Lets every other ready fiber take ten turns. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 10; turn++) {
    yield* Effect.yieldNow
  }
})

/** Yields until `condition` holds, at most 200 turns; gives whether it holds. */
const eventually = (condition: Effect.Effect<boolean>) =>
  Effect.gen(function* () {
    for (let turn = 0; turn < 200; turn++) {
      if (yield* condition) {
        return true
      }
      yield* Effect.yieldNow
    }
    return yield* condition
  })

/** The child actor behind a reference; fails the test when the reference is not an actor. */
const asActor = (ref: ActorRefBase | undefined): ActorType.Any => {
  assert.isTrue(isActor(ref), "the reference is an actor")
  return ref as ActorType.Any
}

/** The status the actor's snapshot has now. */
const statusOf = (actor: Pick<ActorType.Any, "getSnapshot">) => Effect.map(actor.getSnapshot, (snapshot) => snapshot.status)

/** A callback logic that records its start and its cleanup (its finalizer) under `name`. */
const recorded = (name: string, log: Array<string>) =>
  fromCallback(() => {
    log.push(`${name} started`)
    return () => {
      log.push(`${name} cleanup`)
    }
  })

/** A root actor, registered under `systemId`, that records the type of each event it receives. */
const recipient = (systemId: string, received: Array<string>) =>
  createActor(
    fromCallback(({ receive }) => {
      receive((event) => {
        received.push(event.type)
      })
    }),
    { systemId }
  )

type ParentEvent = { readonly type: "FAIL" }
type ChildEvent = { readonly type: "FAIL" }

describe("C19b Children of a parent that errors stop with it", () => {
  it.effect("[C19b] a parent with two running spawned children that enters status error through a throwing action stops both; each child is stopped, its finalizer ran, and no delayed event of the parent is delivered", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const received: Array<string> = []
      const outside = yield* recipient("c19b-outside", received)
      yield* outside.start
      const first = recorded("first", log)
      const second = recorded("second", log)
      const parent = createMachine<object, ParentEvent>({
        id: "c19b-throwing",
        context: {},
        entry: [
          spawnChild<object, ParentEvent, typeof first>(first, { id: "first" }),
          spawnChild<object, ParentEvent, typeof second>(second, { id: "second" }),
          sendTo<object, ParentEvent>("c19b-outside", { type: "LATE" }, { delay: 1000, id: "late" }),
        ],
        on: {
          FAIL: {
            actions: [
              sendTo<object, ParentEvent>("c19b-outside", { type: "LATER" }, { delay: 2000, id: "later" }),
              () => {
                throw new Error("parent failed")
              },
            ],
          },
        },
      })
      // The recipient is the parent's parent, so the parent shares its system and finds it by systemId
      const actor = yield* createActor(parent, { parent: outside })
      yield* actor.start
      const children = (yield* actor.getSnapshot).children
      const firstChild = asActor(children["first"])
      const secondChild = asActor(children["second"])
      assert.strictEqual(yield* statusOf(firstChild), "active")
      assert.strictEqual(yield* statusOf(secondChild), "active")

      yield* actor.send({ type: "FAIL" })
      yield* settle

      assert.strictEqual(yield* statusOf(actor), "error")
      assert.strictEqual(yield* statusOf(firstChild), "stopped")
      assert.strictEqual(yield* statusOf(secondChild), "stopped")
      assert.includeMembers(log, ["first cleanup", "second cleanup"])

      // After every delay, nothing the parent scheduled reaches the recipient
      yield* TestClock.adjust("5 seconds")
      yield* settle
      assert.deepStrictEqual(received.filter((type) => type === "LATE" || type === "LATER"), [])
    })
  )

  it.effect("[C19b] a parent that enters status error through an unhandled child error event stops its two other running children; each is stopped, its finalizer ran, and no delayed event of the parent is delivered", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const received: Array<string> = []
      const outside = yield* recipient("c19b-outside-2", received)
      yield* outside.start
      const first = recorded("first", log)
      const second = recorded("second", log)
      const failing = createMachine<object, ChildEvent>({
        id: "c19b-failing-child",
        context: {},
        on: {
          FAIL: {
            actions: () => {
              throw new Error("child failed")
            },
          },
        },
      })
      const parent = createMachine<object, EventObject>({
        id: "c19b-unhandled",
        context: {},
        entry: [
          spawnChild<object, EventObject, typeof first>(first, { id: "first" }),
          spawnChild<object, EventObject, typeof second>(second, { id: "second" }),
          spawnChild<object, EventObject, typeof failing>(failing, { id: "failing" }),
          sendTo<object, EventObject>("c19b-outside-2", { type: "LATE" }, { delay: 1000, id: "late" }),
        ],
      })
      // The recipient is the parent's parent, so the parent shares its system and finds it by systemId
      const actor = yield* createActor(parent, { parent: outside })
      yield* actor.start
      const children = (yield* actor.getSnapshot).children
      const firstChild = asActor(children["first"])
      const secondChild = asActor(children["second"])
      const failingChild = asActor(children["failing"])

      yield* failingChild.send({ type: "FAIL" })
      assert.isTrue(yield* eventually(Effect.map(statusOf(actor), (status) => status === "error")), "the parent errors")
      yield* settle

      assert.strictEqual(Option.getOrUndefined(Option.map((yield* actor.getSnapshot).error, (error) => (error as Error).message)), "child failed")
      assert.strictEqual(yield* statusOf(firstChild), "stopped")
      assert.strictEqual(yield* statusOf(secondChild), "stopped")
      assert.includeMembers(log, ["first cleanup", "second cleanup"])

      yield* TestClock.adjust("5 seconds")
      yield* settle
      assert.deepStrictEqual(received.filter((type) => type === "LATE"), [])
    })
  )
})
