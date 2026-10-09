/**
 * C5: an actor done at its initial snapshot notifies its parent.
 *
 * T5.6 (T3.16 built the actor side of an initial done). Upstream (xstate@5.33.2): a child
 * machine whose initial microsteps reach a top-level final state is created with a `done`
 * snapshot, and its constructor gives its `systemId` up at once (`status !== 'active'`). The
 * parent's invocation starts it in the parent's deferred phase; its `start` takes the 'done'
 * branch (`update(snapshot, initEvent)` and return): the deferred initial actions run (a
 * `sendParent` is relayed), the observers receive the done snapshot, it stops and it relays
 * `xstate.done.actor.<id>` with its output to the parent. The parent's mailbox starts after
 * that, so the parent takes its `onDone` transition inside its own `start`. Any actor logic
 * whose initial snapshot is done does the same.
 *
 * Every expectation below is what upstream gives for the same machine (a tsx probe of 5.33.2,
 * `packages/core/.upstream/measure/t56/probe-up.ts`), in Effect form: `event.output` is an
 * Option (D8), `system.get` gives an Option (D7), and the child runs in its own fiber (SD-23),
 * so a test waits for the parent with `settled`.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import type { ActorRefBase } from "../../src/ActorRef.js"
import {
  type ActorType,
  createActor,
  createMachine,
  type EventObject,
  isActor,
  makeActorLogic,
  sendParent,
  Snapshot,
  type SnapshotType,
} from "../../src/index.js"

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

describe("C5 An actor done at its initial snapshot notifies its parent", () => {
  it.effect("[C5] a parent that invokes a child machine whose initial state is final takes its onDone transition at start, with the child's output", () =>
    Effect.gen(function* () {
      const seen: Array<unknown> = []
      const child = createMachine({ initial: "f", states: { f: { type: "final" } }, output: () => "early" })
      const parent = createMachine({
        initial: "w",
        states: {
          w: {
            invoke: {
              id: "child",
              src: child,
              onDone: {
                target: "done",
                actions: ({ event }) => {
                  seen.push(event)
                },
              },
            },
          },
          done: {},
        },
      })

      const actor = yield* createActor(parent)
      const before = yield* actor.getSnapshot
      assert.strictEqual(before.value, "w")
      assert.deepStrictEqual(Object.keys(before.children), ["child"])
      assert.strictEqual((yield* asActor(before.children["child"]).getSnapshotUntyped).status, "done")

      yield* actor.start
      yield* settled(valueIs(actor, "done"))

      const after = yield* actor.getSnapshot
      assert.strictEqual(after.value, "done")
      assert.deepStrictEqual(seen, [{ type: "xstate.done.actor.child", output: Option.some("early"), actorId: "child" }])
      assert.deepStrictEqual(Object.keys(after.children), [])
    }))

  it.effect("[C5] a child machine whose root is final notifies its parent at start with its root output", () =>
    Effect.gen(function* () {
      const seen: Array<unknown> = []
      const child = createMachine({ type: "final", output: () => 7 })
      const parent = createMachine({
        initial: "w",
        states: {
          w: {
            invoke: {
              id: "child",
              src: child,
              onDone: {
                target: "done",
                actions: ({ event }) => {
                  seen.push(event)
                },
              },
            },
          },
          done: {},
        },
      })

      const actor = yield* Effect.tap(createActor(parent), (started) => started.start)
      yield* settled(valueIs(actor, "done"))

      assert.strictEqual((yield* actor.getSnapshot).value, "done")
      assert.deepStrictEqual(seen, [{ type: "xstate.done.actor.child", output: Option.some(7), actorId: "child" }])
    }))

  it.effect("[C5] an initial done passes up a chain at start: the grandchild's done ends the child, whose done takes the parent's onDone", () =>
    Effect.gen(function* () {
      const seen: Array<unknown> = []
      const grandchild = createMachine({ initial: "f", states: { f: { type: "final" } }, output: () => "g" })
      const child = createMachine({
        initial: "w",
        states: { w: { invoke: { id: "grand", src: grandchild, onDone: "f" } }, f: { type: "final" } },
        output: ({ event }: { readonly event: EventObject }) => ["c", event.type],
      })
      const parent = createMachine({
        initial: "w",
        states: {
          w: {
            invoke: {
              id: "child",
              src: child,
              onDone: {
                target: "done",
                actions: ({ event }) => {
                  seen.push(event)
                },
              },
            },
          },
          done: {},
        },
      })

      const actor = yield* Effect.tap(createActor(parent), (started) => started.start)
      yield* settled(valueIs(actor, "done"))

      assert.strictEqual((yield* actor.getSnapshot).value, "done")
      assert.deepStrictEqual(seen, [
        { type: "xstate.done.actor.child", output: Option.some(["c", "xstate.done.state.(machine).f"]), actorId: "child" },
      ])
    }))

  it.effect("[C5] the events a child done at creation sends from its initial entry reach the parent before its done event, and its systemId is never registered", () =>
    Effect.gen(function* () {
      const events: Array<string> = []
      const child = createMachine({ initial: "f", states: { f: { type: "final", entry: sendParent({ type: "HI" }) } } })
      const parent = createMachine({
        initial: "w",
        on: {
          HI: {
            actions: () => {
              events.push("HI")
            },
          },
        },
        states: {
          w: {
            invoke: {
              id: "child",
              systemId: "kid",
              src: child,
              onDone: {
                target: "done",
                actions: () => {
                  events.push("onDone")
                },
              },
            },
          },
          done: {},
        },
      })

      const actor = yield* createActor(parent)
      assert.isTrue(Option.isNone(yield* actor.system.get("kid")))

      yield* actor.start
      yield* settled(valueIs(actor, "done"))
      yield* settle

      assert.deepStrictEqual(events, ["HI", "onDone"])
      assert.strictEqual((yield* actor.getSnapshot).value, "done")
      assert.isTrue(Option.isNone(yield* actor.system.get("kid")))
    }))

  it.effect("[C5] a child done at creation runs its initial custom actions before the sends its initial actions queued, and its done event comes last", () =>
    Effect.gen(function* () {
      // upstream: a built-in action's execution only queues its send, so the send goes out
      // after every initial custom action
      const events: Array<string> = []
      const child = createMachine({
        type: "final",
        entry: [
          sendParent({ type: "A" }),
          ({ self }) => Option.match(self._parent, { onNone: () => Effect.void, onSome: (parent) => parent.sendUntyped({ type: "B" }) }),
        ],
      })
      const parent = createMachine({
        initial: "w",
        on: {
          A: {
            actions: () => {
              events.push("A")
            },
          },
          B: {
            actions: () => {
              events.push("B")
            },
          },
        },
        states: {
          w: {
            invoke: {
              id: "c",
              src: child,
              onDone: {
                target: "d",
                actions: () => {
                  events.push("onDone")
                },
              },
            },
          },
          d: {},
        },
      })

      const actor = yield* Effect.tap(createActor(parent), (started) => started.start)
      yield* settled(valueIs(actor, "d"))

      assert.deepStrictEqual(events, ["B", "A", "onDone"])
      assert.strictEqual((yield* actor.getSnapshot).value, "d")
    }))

  it.effect("[C5] any actor logic whose initial snapshot is done notifies its parent at start with its output", () =>
    Effect.gen(function* () {
      const seen: Array<unknown> = []
      const logic = makeActorLogic<SnapshotType, EventObject, unknown>({
        transition: (snapshot) => Effect.succeed(snapshot),
        getInitialSnapshot: () => Effect.succeed(Snapshot.done("logic out")),
        getPersistedSnapshot: (snapshot) => Effect.succeed(snapshot),
      })
      const parent = createMachine({
        initial: "w",
        states: {
          w: {
            invoke: {
              id: "l",
              src: logic,
              onDone: {
                target: "done",
                actions: ({ event }) => {
                  seen.push(event)
                },
              },
            },
          },
          done: {},
        },
      })

      const actor = yield* Effect.tap(createActor(parent), (started) => started.start)
      yield* settled(valueIs(actor, "done"))

      assert.strictEqual((yield* actor.getSnapshot).value, "done")
      assert.deepStrictEqual(seen, [{ type: "xstate.done.actor.l", output: Option.some("logic out"), actorId: "l" }])
    }))

  it.effect("[C5] a root invocation whose child is done at creation can end the parent at start", () =>
    Effect.gen(function* () {
      const child = createMachine({ type: "final" })
      const parent = createMachine({
        invoke: { id: "c", src: child, onDone: ".done" },
        initial: "w",
        states: { w: {}, done: { type: "final" } },
      })

      const actor = yield* Effect.tap(createActor(parent), (started) => started.start)
      yield* settled(() => Effect.map(actor.getSnapshot, (snapshot) => snapshot.status === "done"))

      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.value, "done")
      assert.strictEqual(snapshot.status, "done")
    }))
})
