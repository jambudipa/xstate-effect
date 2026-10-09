/**
 * A2: spawn inside assign returns a reference that appears in snapshot.children.
 *
 * T2.44. Upstream `createSpawner` in `src/spawn.ts` at xstate@5.33.2 gives every assigner a
 * synchronous `spawn(src, { id, systemId, input, syncSnapshot })`: it creates the child with
 * the machine actor as its parent (so the child joins the parent's system), returns the
 * child's reference at once, records it in `snapshot.children` under its id together with the
 * context update (`resolveAssign`), and starts it after the macrostep. The id defaults to the
 * child's session id. A string src names an actor implementation of the machine; an unknown
 * one throws `Actor logic '<src>' not implemented in machine '<id>'`, which sets the machine's
 * status to `error` (SD-4). A second spawn under an id in use replaces the reference in
 * `snapshot.children`; the first child keeps running (upstream keeps no other record of it).
 *
 * The port builds each child per parent (D12): its scope is a child scope of the parent's,
 * so it stops when the parent stops. The reference is the child actor itself, so a reference
 * taken from `snapshot.children` reads the child's live snapshot (T2.41). Both assigner forms
 * get `spawn`: the function form and the property-assigner form.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import type { ActorRefBase } from "../../src/ActorRef.js"
import { type ActorType, assign, createActor, createMachine, isActor } from "../../src/index.js"
import { actorLogicNotImplemented } from "./upstream-messages.js"

interface Counter {
  readonly count: number
}

type CounterEvent = { readonly type: "INC" }

/** A child that counts its `INC` events. */
const counterLogic = () =>
  createMachine<Counter, CounterEvent>({
    id: "counter",
    initial: "on",
    context: { count: 0 },
    states: {
      on: { on: { INC: { actions: assign<Counter, CounterEvent>(({ context }) => ({ count: context.count + 1 })) } } },
    },
  })

interface Refs {
  readonly ref?: ActorRefBase
  readonly other?: ActorRefBase
}

type ParentEvent = { readonly type: "RESPAWN" } | { readonly type: "BAD" }

/** The child actor behind a reference; fails the test when the reference is not an actor. */
const asActor = (ref: ActorRefBase | undefined): ActorType.Any => {
  assert.isTrue(isActor(ref), "the reference is an actor")
  return ref as ActorType.Any
}

/** The status of the snapshot the reference reads now. */
const statusOf = (ref: ActorRefBase) => Effect.map(ref.getSnapshotUntyped, (snapshot) => snapshot.status)

/** The `count` of a counter child's live snapshot. */
const countOf = (ref: ActorRefBase) =>
  Effect.map(ref.getSnapshotUntyped, (snapshot) => (snapshot as unknown as { readonly context: Counter }).context.count)

/** The message of an error value. */
const messageOf = (error: unknown): string => String((error as { readonly message?: unknown }).message)

/** Lets every other ready fiber take ten turns. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 10; turn++) {
    yield* Effect.yieldNow
  }
})

describe("A2 spawn inside assign returns a reference that appears in snapshot.children", () => {
  it.effect("[A2] assign({ ref: ({ spawn }) => spawn(logic, { id }) }) stores the child reference, and snapshot.children holds it under its id", () =>
    Effect.gen(function* () {
      const machine = createMachine<Refs, ParentEvent>({
        id: "a2-property",
        context: {},
        entry: assign<Refs, ParentEvent>({ ref: ({ spawn }) => spawn(counterLogic(), { id: "c" }) }),
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      const snapshot = yield* actor.getSnapshot
      const ref = snapshot.context.ref
      assert.isDefined(ref)
      assert.strictEqual(snapshot.children["c"], ref)
      assert.deepStrictEqual(Object.keys(snapshot.children), ["c"])
      assert.strictEqual(ref?.id, "c")
      // The reference is the child actor: it joined the parent's system, the machine actor
      // is its parent, and it runs after the macrostep that spawned it
      const child = asActor(ref)
      assert.strictEqual(child._system, actor.system)
      assert.isTrue(Option.isSome(child._parent) && child._parent.value === actor)
      assert.strictEqual(yield* statusOf(child), "active")
      yield* child.send({ type: "INC" })
      assert.strictEqual(yield* countOf(child), 1)
    })
  )

  it.effect("[A2] assign(({ spawn }) => ({ ref: spawn(logic, { id }) })) stores the child reference, and snapshot.children holds it under its id", () =>
    Effect.gen(function* () {
      const machine = createMachine<Refs, ParentEvent>({
        id: "a2-function",
        context: {},
        entry: assign<Refs, ParentEvent>(({ spawn }) => ({ ref: spawn(counterLogic(), { id: "d" }) })),
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      const snapshot = yield* actor.getSnapshot
      assert.isDefined(snapshot.context.ref)
      assert.strictEqual(snapshot.children["d"], snapshot.context.ref)
      assert.strictEqual(snapshot.context.ref?.id, "d")
      assert.strictEqual(yield* statusOf(asActor(snapshot.context.ref)), "active")
    })
  )

  it.effect("[A2] a reference taken from snapshot.children reads the child's live snapshot", () =>
    Effect.gen(function* () {
      const machine = createMachine<Refs, ParentEvent>({
        id: "a2-live",
        context: {},
        entry: assign<Refs, ParentEvent>({ ref: ({ spawn }) => spawn(counterLogic(), { id: "c" }) }),
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      const taken = yield* actor.getSnapshot
      const ref = taken.children["c"]
      assert.isDefined(ref)

      yield* asActor(ref).send({ type: "INC" })
      yield* asActor(ref).send({ type: "INC" })

      // The parent's snapshot did not change, yet its reference reads the child's new snapshot
      assert.strictEqual(yield* actor.getSnapshot, taken)
      assert.strictEqual(yield* countOf(ref!), 2)
    })
  )

  it.effect("[A2] a second spawn with the same id replaces the reference in snapshot.children; the first child keeps running and still stops with the parent", () =>
    Effect.gen(function* () {
      const machine = createMachine<Refs, ParentEvent>({
        id: "a2-replace",
        context: {},
        entry: assign<Refs, ParentEvent>({ ref: ({ spawn }) => spawn(counterLogic(), { id: "c" }) }),
        on: { RESPAWN: { actions: assign<Refs, ParentEvent>({ other: ({ spawn }) => spawn(counterLogic(), { id: "c" }) }) } },
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      const first = (yield* actor.getSnapshot).children["c"]
      assert.isDefined(first)

      yield* actor.send({ type: "RESPAWN" })

      const after = yield* actor.getSnapshot
      const second = after.children["c"]
      assert.isDefined(second)
      assert.notStrictEqual(second, first)
      assert.strictEqual(after.context.ref, first)
      assert.strictEqual(after.context.other, second)
      assert.deepStrictEqual(Object.keys(after.children), ["c"])
      assert.strictEqual(yield* statusOf(first!), "active")
      assert.strictEqual(yield* statusOf(second!), "active")
      yield* asActor(first).send({ type: "INC" })
      assert.strictEqual(yield* countOf(first!), 1)

      yield* actor.stop
      yield* settle

      assert.strictEqual(yield* statusOf(first!), "stopped")
      assert.strictEqual(yield* statusOf(second!), "stopped")
    })
  )

  it.effect("[A2] two spawns without an id in one action list get distinct session ids, the same on every run", () =>
    Effect.gen(function* () {
      const machine = () =>
        createMachine<Refs, ParentEvent>({
          id: "a2-ids",
          context: {},
          entry: [
            assign<Refs, ParentEvent>({ ref: ({ spawn }) => spawn(counterLogic()) }),
            assign<Refs, ParentEvent>({ other: ({ spawn }) => spawn(counterLogic()) }),
          ],
        })
      const run = Effect.gen(function* () {
        const actor = yield* createActor(machine())
        yield* actor.start
        const snapshot = yield* actor.getSnapshot
        return {
          root: actor.sessionId,
          ids: [snapshot.context.ref?.id, snapshot.context.other?.id],
          sessions: [snapshot.context.ref?.sessionId, snapshot.context.other?.sessionId],
          keys: Object.keys(snapshot.children),
        }
      })

      const firstRun = yield* run
      const secondRun = yield* run

      assert.strictEqual(firstRun.root, "x:0")
      assert.deepStrictEqual(firstRun.ids, ["x:1", "x:2"])
      assert.deepStrictEqual(firstRun.sessions, ["x:1", "x:2"])
      assert.deepStrictEqual(firstRun.keys, ["x:1", "x:2"])
      assert.deepStrictEqual(secondRun, firstRun)
    })
  )

  it.effect("[A2] spawn with a string src creates the machine's actor implementation of that name", () =>
    Effect.gen(function* () {
      const machine = createMachine<Refs, ParentEvent>(
        {
          id: "a2-named",
          context: {},
          entry: assign<Refs, ParentEvent>({ ref: ({ spawn }) => spawn("counter", { id: "named" }) }),
        },
        { actors: { counter: counterLogic() } }
      )
      const actor = yield* createActor(machine)
      yield* actor.start

      const snapshot = yield* actor.getSnapshot
      const ref = snapshot.children["named"]
      assert.isDefined(ref)
      assert.strictEqual(snapshot.context.ref, ref)
      assert.strictEqual(ref?.src, "counter")
      yield* asActor(ref).send({ type: "INC" })
      assert.strictEqual(yield* countOf(ref!), 1)
    })
  )

  it.effect("[A2] spawn with a string src that names no implementation sets status error with the recorded message", () =>
    Effect.gen(function* () {
      const machine = createMachine<Refs, ParentEvent>({
        id: "a2-unknown",
        context: {},
        on: { BAD: { actions: assign<Refs, ParentEvent>({ ref: ({ spawn }) => spawn("nope") }) } },
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      // The send completes although the macrostep fails (SD-23)
      yield* actor.send({ type: "BAD" })

      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.status, "error")
      assert.strictEqual(messageOf(Option.getOrUndefined(snapshot.error)), actorLogicNotImplemented("nope", "a2-unknown"))
      assert.deepStrictEqual(Object.keys(snapshot.children), [])
    })
  )
})
