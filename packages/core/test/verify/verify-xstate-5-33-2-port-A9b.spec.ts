/**
 * A9b: a spawn inside a macrostep that errors leaves nothing behind.
 *
 * T2.44, SD-27. Upstream (`createActor.ts` `_process` at xstate@5.33.2) keeps the snapshot it
 * had before the event when a macrostep throws, so `snapshot.children` lacks a child spawned in
 * that macrostep, and the deferred start of that child never runs. Upstream leaves such a
 * child registered under its systemId (its own TODO notes possible orphans); the port closes
 * the scope of the actor that errors (D12), so the child stops before it ever started, its
 * delayed events are cancelled and its systemId is free again (SD-27; a ledger row records the
 * difference).
 *
 * Upstream creates the grandchild inside the macrostep, so its `@xstate.actor` inspection event
 * is sent (`createActor` constructor); what never happens is its start: no init `@xstate.event`
 * and no `@xstate.snapshot` names it (T6.8 moved `@xstate.actor` to creation; SD-20).
 *
 * A spawn under a systemId that another actor holds is a creation error upstream
 * (`Actor with system ID '<id>' already exists.`, `src/system.ts`), thrown inside the
 * parent's macrostep, so the parent's status becomes `error`; it is not a defect that escapes
 * the parent (SD-4).
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
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
  sendTo,
  spawnChild,
} from "../../src/index.js"
import { duplicateSystemId } from "./upstream-messages.js"

/** The child actor behind a reference; fails the test when the reference is not an actor. */
const asActor = (ref: ActorRefBase | undefined): ActorType.Any => {
  assert.isTrue(isActor(ref), "the reference is an actor")
  return ref as ActorType.Any
}

/** Lets every other ready fiber take ten turns. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 10; turn++) {
    yield* Effect.yieldNow
  }
})

/** The message of an error value. */
const messageOf = (error: unknown): string => String((error as { readonly message?: unknown }).message)

interface RootContext {
  readonly late: number
  readonly childErrors: number
}

type RootEvent =
  | { readonly type: "LATE" }
  | { readonly type: "AGAIN" }
  | { readonly type: "xstate.error.actor.child"; readonly error: unknown }

type ChildEvent = { readonly type: "GO" }

describe("A9b A spawn inside a macrostep that errors leaves nothing behind", () => {
  it.effect("[A9b] a child whose transition spawns a grandchild under systemId w and then throws ends in error without the grandchild; the grandchild never ran, delivers nothing, and w is free again", () =>
    Effect.gen(function* () {
      const boom = new Error("boom")
      const grandchildRan: Array<string> = []
      // The grandchild's initial entry runs a custom action (at its start) and schedules a
      // delayed LATE to the root by systemId (when its initial snapshot is computed)
      const grandchild = createMachine<object, EventObject>({
        id: "a9b-grandchild",
        context: {},
        entry: [
          () => {
            grandchildRan.push("entry")
          },
          sendTo<object, EventObject>("a9b-root", { type: "LATE" }, { delay: 100, id: "late" }),
        ],
      })
      const child = createMachine<object, ChildEvent>({
        id: "a9b-child",
        context: {},
        on: {
          GO: {
            actions: [
              spawnChild<object, ChildEvent, typeof grandchild>(grandchild, { id: "grand", systemId: "w" }),
              () => {
                throw boom
              },
            ],
          },
        },
      })
      const worker = fromCallback(() => undefined)
      const root = createMachine<RootContext, RootEvent>({
        id: "a9b-root",
        context: { late: 0, childErrors: 0 },
        entry: spawnChild<RootContext, RootEvent, typeof child>(child, { id: "child" }),
        on: {
          LATE: { actions: assign<RootContext, RootEvent>(({ context }) => ({ late: context.late + 1 })) },
          // The root handles its child's error event, so the error stays in the child
          "xstate.error.actor.child": {
            actions: assign<RootContext, RootEvent>(({ context }) => ({ childErrors: context.childErrors + 1 })),
          },
          AGAIN: { actions: spawnChild<RootContext, RootEvent, typeof worker>(worker, { id: "w2", systemId: "w" }) },
        },
      })
      const actor = yield* createActor(root, { systemId: "a9b-root" })
      // The actors created (`@xstate.actor`), started (the init `@xstate.event`) and published
      // (`@xstate.snapshot`), by id, from here on
      const created: Array<string> = []
      const started: Array<string> = []
      const published: Array<string> = []
      yield* actor.system.inspect((event) =>
        Effect.sync(() => {
          if (event.type === "@xstate.actor") {
            created.push(event.actorRef.id)
          }
          if (event.type === "@xstate.event" && event.event.type === "xstate.init") {
            started.push(event.actorRef.id)
          }
          if (event.type === "@xstate.snapshot") {
            published.push(event.actorRef.id)
          }
        })
      )
      yield* actor.start
      const childActor = asActor((yield* actor.getSnapshot).children["child"])

      yield* childActor.send({ type: "GO" })
      yield* settle

      const childSnapshot = yield* childActor.getSnapshot
      assert.strictEqual(childSnapshot.status, "error")
      assert.strictEqual(Option.getOrUndefined(childSnapshot.error), boom)
      assert.deepStrictEqual(Object.keys((childSnapshot as unknown as { readonly children: object }).children), [])
      // The grandchild was created (upstream sends `@xstate.actor` in its constructor) but never
      // started: its custom entry action never ran, and no init event and no snapshot of it
      // reached the inspection functions
      assert.deepStrictEqual(grandchildRan, [])
      assert.deepStrictEqual(created.filter((id) => id === "grand"), ["grand"])
      assert.deepStrictEqual(started.filter((id) => id === "grand"), [])
      assert.deepStrictEqual(published.filter((id) => id === "grand"), [])
      assert.isTrue(Option.isNone(yield* actor.system.get("w")))

      // Its delayed event was cancelled: after every delay, the root received no LATE
      yield* TestClock.adjust("1 second")
      yield* settle
      assert.strictEqual((yield* actor.getSnapshot).context.late, 0)

      // The root spawns another actor under the same systemId
      yield* actor.send({ type: "AGAIN" })
      const rootSnapshot = yield* actor.getSnapshot
      assert.strictEqual(rootSnapshot.status, "active")
      const again = yield* actor.system.get("w")
      assert.isTrue(Option.isSome(again) && again.value === rootSnapshot.children["w2"])
    })
  )

  it.effect("[A9b] a spawn under a systemId in use sets the parent's status error with the recorded message; nothing escapes the parent and the systemId ends free", () =>
    Effect.gen(function* () {
      type DupEvent = { readonly type: "DUP" }
      const worker = fromCallback(() => undefined)
      const machine = createMachine<object, DupEvent>({
        id: "a9b-dup",
        context: {},
        entry: spawnChild<object, DupEvent, typeof worker>(worker, { id: "one", systemId: "dup" }),
        on: { DUP: { actions: spawnChild<object, DupEvent, typeof worker>(worker, { id: "two", systemId: "dup" }) } },
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      const first = (yield* actor.getSnapshot).children["one"]
      const found = yield* actor.system.get("dup")
      assert.isTrue(Option.isSome(found) && found.value === first)

      // The send completes: the duplicate is the parent's error, not a defect of the caller
      yield* actor.send({ type: "DUP" })
      yield* settle

      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.status, "error")
      assert.strictEqual(messageOf(Option.getOrUndefined(snapshot.error)), duplicateSystemId("dup"))
      assert.deepStrictEqual(Object.keys(snapshot.children), ["one"])
      // The parent's scope closed, so its first child stopped and gave the systemId up
      assert.strictEqual((yield* first!.getSnapshotUntyped).status, "stopped")
      assert.isTrue(Option.isNone(yield* actor.system.get("dup")))
    })
  )
})
