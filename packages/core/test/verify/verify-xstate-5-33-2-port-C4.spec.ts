/**
 * C4: an invoked child machine's final state triggers the parent's onDone.
 *
 * T5.6. Upstream (xstate@5.33.2): a child machine that reaches a top-level final state is done
 * (`update` in `src/createActor.ts`, case 'done'): its observers receive the done snapshot, it
 * stops (`_stopProcedure`), and it relays `xstate.done.actor.<id>` with its output
 * (`createDoneActorEvent`) to its parent through the system. The parent's invocation turns
 * that event into its `onDone` transition through the normal selection. The child's own
 * outgoing events of that macrostep (a final entry `sendParent`, a root exit `sendParent`) are
 * relayed while the macrostep runs, so they reach the parent's mailbox before the done event
 * (final.test "should deliver final outgoing events ... before delivering the
 * `xstate.done.actor.*` event"). A done child with no `onDone` changes nothing in the parent,
 * which keeps its reference until the invoking state exits.
 *
 * Every expectation below is what upstream gives for the same machine (a tsx probe of 5.33.2,
 * `packages/core/.upstream/measure/t56/probe-up.ts`), in Effect form: `event.output` is an
 * Option (D8), and the child runs in its own fiber (SD-23), so a test waits for the parent
 * with `settled`.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import type { ActorRefBase } from "../../src/ActorRef.js"
import { type ActorType, createActor, createMachine, type EventObject, isActor, sendParent } from "../../src/index.js"

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

describe("C4 An invoked child machine's final state triggers the parent onDone", () => {
  it.effect("[C4] when the child reaches its final state the parent's onDone receives the child's output, and the parent leaves the invoking state", () =>
    Effect.gen(function* () {
      const seen: Array<unknown> = []
      const child = createMachine({
        id: "kid",
        initial: "working",
        context: { n: 2 },
        states: { working: { on: { FINISH: "finished" } }, finished: { type: "final" } },
        output: ({ context }: { readonly context: { readonly n: number } }) => ({ total: context.n * 21 }),
      })
      const parent = createMachine({
        initial: "waiting",
        states: {
          waiting: {
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
      const kid = asActor((yield* actor.getSnapshot).children["child"])
      assert.strictEqual((yield* actor.getSnapshot).value, "waiting")
      assert.strictEqual((yield* kid.getSnapshotUntyped).status, "active")

      yield* kid.sendUntyped({ type: "FINISH" })
      yield* settled(() => Effect.map(actor.getSnapshot, (snapshot) => snapshot.value === "done"))

      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.value, "done")
      assert.deepStrictEqual(seen, [{ type: "xstate.done.actor.child", output: Option.some({ total: 42 }), actorId: "child" }])
      assert.deepStrictEqual(Object.keys(snapshot.children), [])
      const kidSnapshot = yield* kid.getSnapshotUntyped
      assert.strictEqual(kidSnapshot.status, "done")
      assert.deepStrictEqual(kidSnapshot.output, Option.some({ total: 42 }))
    }))

  it.effect("[C4] a final state's own output reaches onDone through the child's root output mapper; without a root mapper the output is None", () =>
    Effect.gen(function* () {
      const seen: Array<unknown> = []
      const withOutput = createMachine({
        initial: "a",
        states: { a: { on: { GO: "b" } }, b: { type: "final", output: { x: 1 } } },
        // The done-state event carries the final state's output as an Option (D8)
        output: ({ event }: { readonly event: EventObject & { readonly output?: Option.Option<unknown> } }) =>
          Option.getOrUndefined(event.output ?? Option.none()),
      })
      const withoutOutput = createMachine({
        initial: "a",
        states: { a: { on: { GO: "b" } }, b: { type: "final", output: { x: 1 } } },
      })
      const record = ({ event }: { readonly event: unknown }) => {
        seen.push(event)
      }
      const parent = createMachine({
        type: "parallel",
        states: {
          r1: { initial: "w", states: { w: { invoke: { id: "one", src: withOutput, onDone: { target: "d", actions: record } } }, d: {} } },
          r2: { initial: "w", states: { w: { invoke: { id: "two", src: withoutOutput, onDone: { target: "d", actions: record } } }, d: {} } },
        },
      })

      const actor = yield* Effect.tap(createActor(parent), (started) => started.start)
      const children = (yield* actor.getSnapshot).children
      yield* asActor(children["one"]).sendUntyped({ type: "GO" })
      yield* settled(() => Effect.sync(() => seen.length >= 1))
      yield* asActor(children["two"]).sendUntyped({ type: "GO" })
      yield* settled(() => Effect.sync(() => seen.length >= 2))

      assert.deepStrictEqual((yield* actor.getSnapshot).value, { r1: "d", r2: "d" })
      assert.deepStrictEqual(seen, [
        { type: "xstate.done.actor.one", output: Option.some({ x: 1 }), actorId: "one" },
        { type: "xstate.done.actor.two", output: Option.none(), actorId: "two" },
      ])
    }))

  it.effect("[C4] a done child without onDone leaves the parent in its state, and the parent keeps the child's reference until the state exits", () =>
    Effect.gen(function* () {
      const child = createMachine({ initial: "a", states: { a: { on: { GO: "b" } }, b: { type: "final" } } })
      const parent = createMachine({
        initial: "w",
        states: { w: { invoke: { id: "c", src: child }, on: { LEAVE: "x" } }, x: {} },
      })

      const actor = yield* Effect.tap(createActor(parent), (started) => started.start)
      const kid = asActor((yield* actor.getSnapshot).children["c"])
      yield* kid.sendUntyped({ type: "GO" })
      yield* settled(() => Effect.map(kid.getSnapshotUntyped, (snapshot) => snapshot.status === "done"))
      yield* settle

      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.value, "w")
      assert.strictEqual(snapshot.status, "active")
      assert.deepStrictEqual(Object.keys(snapshot.children), ["c"])
      assert.strictEqual(snapshot.children["c"], kid)

      yield* actor.send({ type: "LEAVE" })
      assert.deepStrictEqual(Object.keys((yield* actor.getSnapshot).children), [])
    }))

  it.effect("[C4] the child's final outgoing events (final entry, then root exit) reach the parent before xstate.done.actor.<id>", () =>
    Effect.gen(function* () {
      const events: Array<string> = []
      const child = createMachine({
        initial: "a",
        states: {
          a: { on: { GO: "b" } },
          b: { type: "final", entry: sendParent({ type: "BYE" }) },
        },
        exit: sendParent({ type: "EXIT" }),
      })
      const parent = createMachine({
        initial: "w",
        on: {
          BYE: {
            actions: () => {
              events.push("BYE")
            },
          },
          EXIT: {
            actions: () => {
              events.push("EXIT")
            },
          },
        },
        states: {
          w: {
            invoke: {
              id: "c",
              src: child,
              onDone: {
                target: "x",
                actions: ({ event }) => {
                  events.push(`onDone ${event.type}`)
                },
              },
            },
          },
          x: {},
        },
      })

      const actor = yield* Effect.tap(createActor(parent), (started) => started.start)
      yield* asActor((yield* actor.getSnapshot).children["c"]).sendUntyped({ type: "GO" })
      yield* settled(() => Effect.map(actor.getSnapshot, (snapshot) => snapshot.value === "x"))

      assert.deepStrictEqual(events, ["BYE", "EXIT", "onDone xstate.done.actor.c"])
      assert.strictEqual((yield* actor.getSnapshot).value, "x")
    }))

  it.effect("[C4] a final entry event that moves the parent out of the invoking state wins over the done event that follows it", () =>
    Effect.gen(function* () {
      // upstream final.test: if `xstate.done.actor.*` were delivered first the value would be `completed`
      const child = createMachine({
        initial: "start",
        states: {
          start: { on: { CANCEL: "canceled" } },
          canceled: { type: "final", entry: sendParent({ type: "CHILD_CANCELED" }) },
        },
      })
      const parent = createMachine({
        initial: "start",
        states: {
          start: { invoke: { id: "child", src: child, onDone: "completed" }, on: { CHILD_CANCELED: "canceled" } },
          canceled: {},
          completed: {},
        },
      })

      const actor = yield* Effect.tap(createActor(parent), (started) => started.start)
      yield* asActor((yield* actor.getSnapshot).children["child"]).sendUntyped({ type: "CANCEL" })
      yield* settled(() => Effect.map(actor.getSnapshot, (snapshot) => snapshot.value !== "start"))
      yield* settle

      assert.strictEqual((yield* actor.getSnapshot).value, "canceled")
    }))
})
