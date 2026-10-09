/**
 * C19: unhandled child errors escalate to the parent.
 *
 * T2.46, SD-4. Upstream (`createActor.ts` `_error` at xstate@5.33.2) relays
 * `{ type: 'xstate.error.actor.<id>', error, actorId: <id> }` with the raw error to the parent
 * of an actor that errors. A machine that takes no transition for such an event
 * (`stateUtils.macrostep`) gets status `error` with `error: event.error`, so the error climbs
 * until an ancestor handles it; each actor's error listeners receive the original value. Phase-2
 * children are spawned, not invoked (SD-15), so a parent handles a child's error event with an
 * `on` handler for `xstate.error.actor.<id>`, where upstream tests use an invoke `onError`.
 */
import { assert, describe, it } from "@effect/vitest"
import { Cause, Effect, Exit, Fiber, Option, Stream } from "effect"
import type { ActorRefBase } from "../../src/ActorRef.js"
import { type ActorType, assign, createActor, createMachine, type EventObject, isActor, spawnChild } from "../../src/index.js"

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

/** The status the actor's snapshot has now. */
const statusOf = (actor: Pick<ActorType.Any, "getSnapshot">) => Effect.map(actor.getSnapshot, (snapshot) => snapshot.status)

/** The child actor behind a reference; fails the test when the reference is not an actor. */
const asActor = (ref: ActorRefBase | undefined): ActorType.Any => {
  assert.isTrue(isActor(ref), "the reference is an actor")
  return ref as ActorType.Any
}

/** Runs the actor's `changes` stream in a fiber of the test scope, from now on. */
const watchChanges = <E>(actor: { readonly changes: Stream.Stream<unknown, E> }) =>
  Effect.forkScoped(Stream.runDrain(actor.changes), { startImmediately: true })

/** `Some` of the value the watched stream failed with once the other fibers had their turns, else `None`. */
const failureOf = <E>(watcher: Fiber.Fiber<void, E>) =>
  Effect.gen(function* () {
    yield* settle
    const exit = watcher.pollUnsafe()
    return exit !== undefined && Exit.isFailure(exit) ? Option.some<unknown>(Cause.squash(exit.cause)) : Option.none<unknown>()
  })

type ChildEvent = { readonly type: "FAIL" }

/** A child machine whose FAIL transition action throws `error`. */
const failingChild = (error: unknown) =>
  createMachine<object, ChildEvent>({
    id: "c19-child",
    context: {},
    on: {
      FAIL: {
        actions: () => {
          throw error
        },
      },
    },
  })

/** A child machine whose initial custom entry action throws `error` when the child starts. */
const failingAtStart = (error: unknown) =>
  createMachine<object, EventObject>({
    id: "c19-child-at-start",
    context: {},
    entry: () => {
      throw error
    },
  })

interface Received {
  readonly received: ReadonlyArray<unknown>
}

/** The children of an actor's snapshot, for an actor typed with the base snapshot. */
const childrenOf = (actor: Pick<ActorType.Any, "getSnapshot">) =>
  Effect.map(actor.getSnapshot, (snapshot) => (snapshot as unknown as { readonly children: Readonly<Record<string, ActorRefBase>> }).children)

type ParentEvent = { readonly type: "xstate.error.actor.child"; readonly error: unknown; readonly actorId: string }
type GrandparentEvent = { readonly type: "xstate.error.actor.parent"; readonly error: unknown; readonly actorId: string }

describe("C19 Unhandled child errors escalate to the parent", () => {
  it.effect("[C19] a parent with no error handling for a spawned child errors with the child's original error when the child fails, and its changes stream fails with that error", () =>
    Effect.gen(function* () {
      const boom = new Error("child failed")
      const child = failingChild(boom)
      const parent = createMachine<object, EventObject>({
        id: "c19-parent",
        context: {},
        entry: spawnChild<object, EventObject, typeof child>(child, { id: "child" }),
      })
      const actor = yield* createActor(parent)
      yield* actor.start
      const watcher = yield* watchChanges(actor)
      const childActor = asActor((yield* actor.getSnapshot).children["child"])

      yield* childActor.send({ type: "FAIL" })
      assert.isTrue(yield* eventually(Effect.map(statusOf(actor), (status) => status === "error")), "the parent errors")

      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(Option.getOrUndefined((yield* childActor.getSnapshot).error), boom)
      assert.strictEqual(snapshot.status, "error")
      assert.strictEqual(Option.getOrUndefined(snapshot.error), boom)
      assert.deepStrictEqual(yield* failureOf(watcher), Option.some<unknown>(boom))
    })
  )

  it.effect("[C19] the parent of a spawned child that fails receives { type: 'xstate.error.actor.<id>', error, actorId } with the original error and stays active when it handles it", () =>
    Effect.gen(function* () {
      const boom = { reason: "child failed" }
      const child = failingChild(boom)
      const parent = createMachine<Received, ParentEvent>({
        id: "c19-handler",
        context: { received: [] },
        entry: spawnChild<Received, ParentEvent, typeof child>(child, { id: "child" }),
        on: {
          "xstate.error.actor.child": {
            actions: assign<Received, ParentEvent>(({ context, event }) => ({ received: [...context.received, event] })),
          },
        },
      })
      const actor = yield* createActor(parent)
      yield* actor.start
      const watcher = yield* watchChanges(actor)
      const childActor = asActor((yield* actor.getSnapshot).children["child"])

      yield* childActor.send({ type: "FAIL" })
      assert.isTrue(yield* eventually(Effect.map(actor.getSnapshot, (snapshot) => snapshot.context.received.length > 0)))

      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.status, "active")
      assert.deepStrictEqual(snapshot.context.received, [{ type: "xstate.error.actor.child", error: boom, actorId: "child" }])
      assert.strictEqual((snapshot.context.received[0] as ParentEvent).error, boom)
      assert.deepStrictEqual(yield* failureOf(watcher), Option.none())
    })
  )

  it.effect("[C19] a grandparent that handles the error event receives the child's original error through the parent that errors", () =>
    Effect.gen(function* () {
      const boom = new Error("grandchild-level failure")
      const child = failingChild(boom)
      const parent = createMachine<object, EventObject>({
        id: "c19-middle",
        context: {},
        entry: spawnChild<object, EventObject, typeof child>(child, { id: "child" }),
      })
      const grandparent = createMachine<Received, GrandparentEvent>({
        id: "c19-grandparent",
        context: { received: [] },
        entry: spawnChild<Received, GrandparentEvent, typeof parent>(parent, { id: "parent" }),
        on: {
          "xstate.error.actor.parent": {
            actions: assign<Received, GrandparentEvent>(({ context, event }) => ({ received: [...context.received, event] })),
          },
        },
      })
      const actor = yield* createActor(grandparent)
      yield* actor.start
      const parentActor = asActor((yield* actor.getSnapshot).children["parent"])
      const childActor = asActor((yield* childrenOf(parentActor))["child"])

      yield* childActor.send({ type: "FAIL" })
      assert.isTrue(yield* eventually(Effect.map(actor.getSnapshot, (snapshot) => snapshot.context.received.length > 0)))

      const parentSnapshot = yield* parentActor.getSnapshot
      assert.strictEqual(parentSnapshot.status, "error")
      assert.strictEqual(Option.getOrUndefined(parentSnapshot.error), boom)
      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.status, "active")
      assert.deepStrictEqual(snapshot.context.received, [{ type: "xstate.error.actor.parent", error: boom, actorId: "parent" }])
      assert.strictEqual((snapshot.context.received[0] as GrandparentEvent).error, boom)
    })
  )

  it.effect("[C19] a child whose initial custom entry action throws at its start errors, and its parent with no error handling errors with the same value", () =>
    Effect.gen(function* () {
      const boom = new Error("failed at start")
      const child = failingAtStart(boom)
      const parent = createMachine<object, EventObject>({
        id: "c19-at-start",
        context: {},
        entry: spawnChild<object, EventObject, typeof child>(child, { id: "child" }),
      })
      const actor = yield* createActor(parent)
      const childActor = asActor((yield* actor.getSnapshot).children["child"])
      const watcher = yield* watchChanges(actor)

      yield* actor.start
      assert.isTrue(yield* eventually(Effect.map(statusOf(actor), (status) => status === "error")), "the parent errors")

      assert.strictEqual(yield* statusOf(childActor), "error")
      assert.strictEqual(Option.getOrUndefined((yield* childActor.getSnapshot).error), boom)
      assert.strictEqual(Option.getOrUndefined((yield* actor.getSnapshot).error), boom)
      assert.deepStrictEqual(yield* failureOf(watcher), Option.some<unknown>(boom))
    })
  )
})
