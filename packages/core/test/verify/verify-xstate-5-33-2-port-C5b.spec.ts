/**
 * C5b: an actor in error at its initial snapshot notifies its parent.
 *
 * T5.6. Upstream (xstate@5.33.2): a child machine's custom initial entry action runs in the
 * deferred phase of its `start` (`update`), since the child is not running yet when its
 * initial snapshot is computed. When it throws, `update` drops the deferred effects that
 * remain (`this._deferred.length = 0`), stores `{ ...snapshot, status: 'error', error }` and
 * calls `_error`: the child stops (`_stopProcedure`, so it leaves the system and its
 * `systemId` is free) and relays `xstate.error.actor.<id>` with the raw error to its parent.
 * The parent's invocation turns that event into its `onError` transition at its own start.
 * A built-in initial entry action that throws when it is resolved (`assign`) errors the child
 * at creation instead: its constructor gives its `systemId` up at once, and its `start` takes
 * the 'error' branch (`_error`), with the same event to the parent. Without `onError` the
 * parent errors with the child's error.
 *
 * Every expectation below is what upstream gives for the same machine (a tsx probe of 5.33.2,
 * `packages/core/.upstream/measure/t56/probe-up.ts`), in Effect form: an error is the status
 * `error` with the error as an Option (D8, SD-4), `system.get` gives an Option (D7), and the
 * child runs in its own fiber (SD-23), so a test waits for the parent with `settled`.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import type { ActorRefBase } from "../../src/ActorRef.js"
import { type ActorType, assign, createActor, createMachine, isActor, sendParent } from "../../src/index.js"

/**
 * Yields the test's fiber until `holds` is true, at most 1000 times and never on wall-clock
 * time: the invoked child runs in its own fiber and reaches the parent through its mailbox.
 */
const settled = (holds: () => Effect.Effect<boolean>) => Effect.yieldNow.pipe(Effect.repeat({ until: holds, times: 1000 }))

/** Lets every other ready fiber take a hundred turns. */
const settle = Effect.yieldNow.pipe(Effect.repeat({ times: 100 }))

/** The child actor behind a reference; fails the test when the reference is not an actor. */
const asActor = (ref: ActorRefBase | undefined): ActorType.Any => {
  assert.isTrue(isActor(ref), "the reference is an actor")
  return ref as ActorType.Any
}

/** Whether the actor's snapshot has the `value` now. */
const valueIs = (actor: { readonly getSnapshot: Effect.Effect<{ readonly value: unknown }> }, value: unknown) => () =>
  Effect.map(actor.getSnapshot, (snapshot) => snapshot.value === value)

describe("C5b An actor in error at its initial snapshot notifies its parent", () => {
  it.effect("[C5b] a child whose initial entry action throws takes the parent's onError at start with the original error, and leaves the system registry", () =>
    Effect.gen(function* () {
      const seen: Array<unknown> = []
      const boom = new Error("boom at entry")
      const child = createMachine({
        entry: () => {
          throw boom
        },
      })
      const parent = createMachine({
        initial: "w",
        states: {
          w: {
            invoke: {
              id: "child",
              systemId: "kid",
              src: child,
              onError: {
                target: "failed",
                actions: ({ event }) => {
                  seen.push(event)
                },
              },
            },
          },
          failed: {},
        },
      })

      const actor = yield* createActor(parent)
      const kid = asActor((yield* actor.getSnapshot).children["child"])
      assert.isTrue(Option.isSome(yield* actor.system.get("kid")))
      assert.strictEqual((yield* kid.getSnapshotUntyped).status, "active")

      yield* actor.start
      yield* settled(valueIs(actor, "failed"))

      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.value, "failed")
      assert.strictEqual(snapshot.status, "active")
      assert.deepStrictEqual(seen, [{ type: "xstate.error.actor.child", error: boom, actorId: "child" }])
      assert.strictEqual((seen[0] as { readonly error: unknown }).error, boom)
      assert.isTrue(Option.isNone(yield* actor.system.get("kid")))
      assert.deepStrictEqual(Object.keys(snapshot.children), [])

      const kidSnapshot = yield* kid.getSnapshotUntyped
      assert.strictEqual(kidSnapshot.status, "error")
      assert.strictEqual(Option.getOrUndefined(kidSnapshot.error), boom)
    }))

  it.effect("[C5b] with an onError that has no target the parent stays in its state and keeps the errored child, which is gone from the registry", () =>
    Effect.gen(function* () {
      const seen: Array<string> = []
      const child = createMachine({
        entry: () => {
          throw new Error("boom2")
        },
      })
      const parent = createMachine({
        initial: "w",
        states: {
          w: {
            invoke: {
              id: "child",
              systemId: "kid2",
              src: child,
              onError: {
                actions: ({ event }) => {
                  seen.push(event.type)
                },
              },
            },
          },
        },
      })

      const actor = yield* Effect.tap(createActor(parent), (started) => started.start)
      yield* settled(() => Effect.sync(() => seen.length >= 1))
      yield* settle

      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.value, "w")
      assert.strictEqual(snapshot.status, "active")
      assert.deepStrictEqual(seen, ["xstate.error.actor.child"])
      assert.isTrue(Option.isNone(yield* actor.system.get("kid2")))
      assert.deepStrictEqual(Object.keys(snapshot.children), ["child"])
      assert.strictEqual((yield* asActor(snapshot.children["child"]).getSnapshotUntyped).status, "error")
    }))

  it.effect("[C5b] a child whose initial built-in entry action throws when resolved is in error at creation, is never registered under its systemId, and takes the parent's onError at start", () =>
    Effect.gen(function* () {
      const seen: Array<unknown> = []
      const boom = new Error("boom3")
      const child = createMachine({
        entry: assign(() => {
          throw boom
        }),
      })
      const parent = createMachine({
        initial: "w",
        states: {
          w: {
            invoke: {
              id: "child",
              systemId: "kid3",
              src: child,
              onError: {
                target: "failed",
                actions: ({ event }) => {
                  seen.push(event)
                },
              },
            },
          },
          failed: {},
        },
      })

      const actor = yield* createActor(parent)
      assert.isTrue(Option.isNone(yield* actor.system.get("kid3")))
      assert.strictEqual((yield* asActor((yield* actor.getSnapshot).children["child"]).getSnapshotUntyped).status, "error")

      yield* actor.start
      yield* settled(valueIs(actor, "failed"))

      assert.strictEqual((yield* actor.getSnapshot).value, "failed")
      assert.deepStrictEqual(seen, [{ type: "xstate.error.actor.child", error: boom, actorId: "child" }])
      assert.strictEqual((seen[0] as { readonly error: unknown }).error, boom)
      assert.isTrue(Option.isNone(yield* actor.system.get("kid3")))
    }))

  it.effect("[C5b] the initial actions after the one that throws never run, and an event a sendParent before it queued is dropped", () =>
    Effect.gen(function* () {
      const events: Array<string> = []
      const child = createMachine({
        entry: [
          sendParent({ type: "BEFORE" }),
          () => {
            throw new Error("boom4")
          },
          () => {
            events.push("after-throw ran")
          },
        ],
      })
      const parent = createMachine({
        initial: "w",
        on: {
          BEFORE: {
            actions: () => {
              events.push("BEFORE")
            },
          },
        },
        states: {
          w: {
            invoke: {
              id: "child",
              src: child,
              onError: {
                target: "failed",
                actions: () => {
                  events.push("onError")
                },
              },
            },
          },
          failed: {},
        },
      })

      const actor = yield* Effect.tap(createActor(parent), (started) => started.start)
      yield* settled(valueIs(actor, "failed"))
      yield* settle

      assert.deepStrictEqual(events, ["onError"])
      assert.strictEqual((yield* actor.getSnapshot).value, "failed")
    }))

  it.effect("[C5b] without onError the parent errors at start with the child's original error", () =>
    Effect.gen(function* () {
      const boom = new Error("boom5")
      const child = createMachine({
        entry: () => {
          throw boom
        },
      })
      const parent = createMachine({ initial: "w", states: { w: { invoke: { id: "child", src: child } } } })

      const actor = yield* Effect.tap(createActor(parent), (started) => started.start)
      yield* settled(() => Effect.map(actor.getSnapshot, (snapshot) => snapshot.status === "error"))

      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.status, "error")
      assert.strictEqual(Option.getOrUndefined(snapshot.error), boom)
    }))
})
