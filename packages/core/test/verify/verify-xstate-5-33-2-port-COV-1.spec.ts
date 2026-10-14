/**
 * COV-1: the src root modules (runtime, engine, persistence) keep their documented behaviour
 * on the paths the rest of the suite does not reach.
 *
 * Coverage layer #1 of init-testing (P0, risk 6). Each test pins a behaviour that the module
 * docs, `docs/decisions.md`, `test/upstream/CONFORMANCE.md` or upstream xstate@5.33.2 define:
 *
 * - Persistence (`src/persistence.ts`, `StateMachine.restoreSnapshot`, `ActorLogic.make`): a
 *   context that JSON cannot hold fails to persist with a `SerializationError` that names the
 *   path; a persisted form without children fails to restore with a `RestoreError`; a live
 *   snapshot restores its inline-spawned children from their logic (upstream reads the child
 *   actor as the entry); a restored delayed event whose target is gone is dropped (P4); the
 *   opt-in validation (D11) names any configuration that does not complete the machine; a
 *   logic without `restoreSnapshot` takes the persisted snapshot as it is (upstream).
 * - Runtime (`src/Actor.ts`, `src/ActorSystem.ts`, `src/ActorRef.ts`): the default clock runs
 *   on the Effect clock; a logic that fails on the stop event errors the actor (SD-4); a child
 *   stopped twice in one macrostep stops once; `createSpawnFunction` starts a child of the
 *   parent in the parent's system; the module statics and the inspect forms; an observer
 *   attached after start runs before the send returns (upstream calls observers
 *   synchronously), and an observer call that waits leaves the actor running.
 * - Engine (`src/stateUtils.ts`, `src/StateNode.ts`, `src/StateMachine.ts`, `src/StateValue.ts`):
 *   selection over a value key that names no child fails with upstream's message;
 *   a transition to the root without `reenter` re-enters the root's initial child (an `initial`
 *   key that names no child keeps the upstream message: INV-1 asserts it, 433c4de2); the
 *   helpers on node lists, paths and history defaults; the node transformations and predicates.
 * - Emitted events (`src/Actor.ts`): the `emissions` stream ends when the actor ends.
 * - Settle (`src/ActorSystem.ts`, SD-28): a `SimulatedClock` increment returns after the
 *   events that each fired delivery sent within the system are processed.
 * - Schema setup (`src/setup.ts`, `src/StateMachine.ts`): a machine from `setupWithSchema`
 *   checks each event, its context, its input and its output against the schemas' types.
 * - Requirements (`src/Types.ts`, `src/setup.ts`, `src/StateMachine.ts`, SD-8): a setup
 *   machine requires the services of its config's inline actions and inline logic, and
 *   `provide` adds the services of the given implementations.
 * - Guard names (`src/Types.ts`): an inline `and`, `or` or `not` in a setup machine's config
 *   names only the setup's guards, each with params of its type.
 * - Custom logic (`src/ActorLogic.ts`): `makeActorLogic`'s `start` runs in the actor's scope,
 *   so a fiber it forks with `Effect.forkScoped` adds no requirement and ends with the actor.
 * - Type helpers (`src/ActorLogic.ts`, `src/ActorRef.ts`): the root's `ActorLogic.SnapshotOf<T>`
 *   and `ActorRef.SnapshotOf<T>` resolve, as the namespaces' `ActorLogic.ActorLogic.SnapshotOf<T>` do.
 */
import { assert, describe, it } from "@effect/vitest"
import { Cause, Chunk, Context, Deferred, Effect, Equal, Exit, Fiber, HashMap, Inspectable, Option, Predicate, Result, Schema, Stream } from "effect"
import { TestClock } from "effect/testing"
import { ActorClass, allocateChild, buildChild, createSpawnFunction, restoreChild } from "../../src/Actor.js"
import type * as ActorLogicModule from "../../src/ActorLogic.js"
import { ActorScope, type ActorScopeService, createGuardContext } from "../../src/ActorLogic.js"
import * as ActorRefModule from "../../src/ActorRef.js"
import {
  active,
  assign,
  createActor,
  createMachine,
  emit,
  Errors,
  type EventObject,
  fromTransition,
  getInitialSnapshot,
  SimulatedClock,
  isActorRef,
  makeActorLogic,
  makeMachineSnapshot,
  type MachineSnapshot,
  sendTo,
  setup,
  setupWithSchema,
  type SnapshotType,
  spawnChild,
  stopChild,
} from "../../src/index.js"
import { and, not, or } from "../../src/guards/index.js"
import type { ActorLogic as RootActorLogic, ActorRef as RootActorRef } from "../../src/index.js"
import * as Persistence from "../../src/persistence.js"
import { resolveReferencedActor } from "../../src/spawn.js"
import * as StateNode from "../../src/StateNode.js"
import * as StateUtils from "../../src/stateUtils.js"
import * as StateValue from "../../src/StateValue.js"
import { createInertActorScope } from "../../src/testing/getNextSnapshot.js"
import * as Types from "../../src/Types.js"
import { guardEvaluationFailed } from "./upstream-messages.js"

// ---------------------------------------------------------------- helpers

/** Compiles only for `true`. */
const typeHolds = <T extends true>(holds: T): T => holds

/** True when `A` and `B` are the same type. */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

/** The services a machine's transitions require, without the actor scope every machine needs. */
type ServicesOf<TMachine> = TMachine extends { readonly transition: (...args: never) => Effect.Effect<infer _A, infer _E, infer R> }
  ? Exclude<R, ActorScope>
  : never

/** A service an inline action reads. */
class Mailbox extends Context.Service<Mailbox, { readonly sent: Array<string> }>()("cov1/Mailbox") {}

/** A service a replacement action reads. */
class Audit extends Context.Service<Audit, { readonly lines: Array<string> }>()("cov1/Audit") {}

/** A value through `JSON.stringify` and `JSON.parse`, as a stored snapshot comes back. */
const throughJson = (value: unknown): unknown => {
  const parsed: unknown = JSON.parse(JSON.stringify(value))
  return parsed
}

/** The own fields of an object value; the test fails for any other value. */
const recordOf = (value: unknown): Record<string, unknown> => {
  if (!Predicate.isObject(value)) {
    return assert.fail(`not an object: ${String(value)}`)
  }
  return Object.fromEntries(Object.entries(value))
}

/** The `context` field of a snapshot, if it has one. */
const contextOf = (snapshot: SnapshotType): unknown => (Predicate.hasProperty(snapshot, "context") ? snapshot.context : undefined)

/** Lets every other ready fiber take a bounded number of turns. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 25; turn++) {
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

/** Drains an actor's `changes` in the background, so an error has a listener (SD-21). */
const listenForErrors = (actor: { readonly changes: Stream.Stream<unknown, unknown> }) =>
  actor.changes.pipe(Stream.runDrain, Effect.ignore, Effect.forkScoped({ startImmediately: true }))

// ---------------------------------------------------------------- fixtures

/** A counter logic snapshot: a base snapshot with a count. */
interface CountSnapshot extends SnapshotType {
  readonly count: number
}

type Inc = { readonly type: "INC" }

/** The count a persisted counter holds, 0 when it holds none. */
const persistedCount = (persisted: unknown): number =>
  Predicate.hasProperty(persisted, "count") && Predicate.isNumber(persisted.count) ? persisted.count : 0

/** The members of a counter logic: `INC` adds one; it persists `{ count }`. */
const counterMembers = {
  transition: (snapshot: CountSnapshot, _event: Inc) => Effect.succeed({ ...snapshot, count: snapshot.count + 1 }),
  getInitialSnapshot: (_input: unknown) => Effect.succeed({ ...active(), count: 0 }),
  getPersistedSnapshot: (snapshot: CountSnapshot) => Effect.succeed({ count: snapshot.count }),
}

/** `ticks` counts `TICK`; nothing else. */
const ticker = createMachine({
  id: "cov1-ticker",
  context: { ticks: 0 },
  on: { TICK: { actions: assign({ ticks: ({ context }) => context.ticks + 1 }) } },
})

/**
 * `a -GO-> b`; the parallel `p` (regions `r1`, `r2`) and the root also take `GO`, so a
 * selection that finds nothing below a node falls back to the node's own transition.
 */
const selection = createMachine({
  id: "cov1-select",
  initial: "a",
  on: { GO: ".b" },
  states: {
    a: { on: { GO: "b" } },
    b: {},
    p: {
      type: "parallel",
      on: { GO: "#cov1-select.a" },
      states: {
        r1: { initial: "x", states: { x: {} } },
        r2: { initial: "y", states: { y: {} } },
      },
    },
  },
})

/** A snapshot of `machine` at `value` with `status` and `children`, and no context, history or output. */
const snapshotAt = <TChildren extends Record<string, unknown>>(
  machine: MachineSnapshot.Machine,
  value: StateValue.StateValue,
  status: "active" | "done",
  children: TChildren
) => makeMachineSnapshot({ value, context: {}, status, children, historyValue: {}, tags: [], output: Option.none(), error: Option.none(), machine })

/** A snapshot of `selection` at `value`, active, with no children. */
const selectionSnapshot = (value: StateValue.StateValue) => snapshotAt(selection, value, "active", {})

// ---------------------------------------------------------------- COV-1

describe("COV-1 src root modules: runtime, engine, persistence", () => {
  // ------------------------------------------------------------ persistence

  it.effect("[COV-1] a context with a symbol, a non-finite number or a circular reference fails to persist with a SerializationError that names the path", () =>
    Effect.gen(function* () {
      const loop: Record<string, unknown> = { name: "loop" }
      loop["self"] = loop
      const cases: ReadonlyArray<readonly [Record<string, unknown>, string]> = [
        [{ tag: Symbol("t") }, "context.tag is a symbol"],
        [{ list: [1, Number.POSITIVE_INFINITY] }, "context.list[1] is the non-finite number Infinity"],
        [{ ratio: Number.NaN }, "context.ratio is the non-finite number NaN"],
        [{ nested: loop }, "context.nested.self is a circular reference"],
      ]
      for (const [context, text] of cases) {
        const actor = yield* createActor(createMachine<Record<string, unknown>, EventObject>({ id: "cov1-persist", context }))

        const error = yield* Effect.flip(actor.getPersistedSnapshot)

        assert.strictEqual(error._tag, "SerializationError", text)
        assert.include(error.message, `${text}: a persisted context holds JSON values and actor references only`)
      }
    })
  )

  it.effect("[COV-1] a context that is itself a class instance, or an object whose prototype has no constructor, is named in the SerializationError", () =>
    Effect.gen(function* () {
      const asMap = yield* createActor(fromTransition((state: Map<string, number>, _event: EventObject) => state, new Map([["a", 1]])))
      const mapError = yield* Effect.flip(asMap.getPersistedSnapshot)
      assert.strictEqual(mapError._tag, "SerializationError")
      assert.include(mapError.message, "the context itself is an instance of Map")

      // A prototype chain that never meets `Object.prototype` and has no `constructor`
      const odd: object = Object.create(Object.create(Object.create(null)))
      const oddActor = yield* createActor(createMachine<Record<string, unknown>, EventObject>({ id: "cov1-odd", context: { odd } }))
      const oddError = yield* Effect.flip(oddActor.getPersistedSnapshot)
      assert.strictEqual(oddError._tag, "SerializationError")
      assert.include(oddError.message, "context.odd is an instance of Object")
    })
  )

  it.effect("[COV-1] a persisted machine snapshot without children fails to restore: decode gives RestoreError and the actor has status error with it", () =>
    Effect.gen(function* () {
      // The codec's issue text is the message: it names the missing key
      const decoded = yield* Effect.flip(Persistence.decodeMachineSnapshot({ status: "active", value: "idle" }))
      assert.strictEqual(decoded._tag, "RestoreError")
      assert.match(decoded.message, /^Missing key\s+at \["children"\]$/)
      const notAnObject = yield* Effect.flip(Persistence.decodeMachineSnapshot("idle"))
      assert.strictEqual(notAnObject._tag, "RestoreError")
      assert.include(notAnObject.message, "PersistedMachineSnapshot")

      const actor = yield* createActor(ticker, { snapshot: { status: "active", value: {}, context: { ticks: 3 } } })
      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.status, "error")
      const error = Option.getOrUndefined(snapshot.error)
      assert.instanceOf(error, Errors.RestoreError)
      assert.strictEqual(error.message, decoded.message)
    })
  )

  it.effect("[COV-1] a live snapshot restores its inline-spawned child from the child's logic, with that logic's initial snapshot", () =>
    Effect.gen(function* () {
      const tally = fromTransition((count: number, event: EventObject) => (event.type === "ADD" ? count + 1 : count), 0)
      const machine = createMachine({
        id: "cov1-live",
        entry: spawnChild(tally, { id: "tally" }),
        on: { ADD: { actions: sendTo("tally", { type: "ADD" }) } },
      })
      const first = yield* createActor(machine)
      yield* first.start
      yield* first.send({ type: "ADD" })
      const firstChild = (yield* first.getSnapshot).children["tally"]
      if (!isActorRef(firstChild)) {
        return assert.fail("no tally child")
      }
      assert.isTrue(yield* eventually(Effect.map(firstChild.getSnapshotUntyped, (snapshot) => contextOf(snapshot) === 1)))
      assert.strictEqual(firstChild.src, tally)

      const restored = yield* createActor(machine, { snapshot: yield* first.getSnapshot })
      const restoredChild = (yield* restored.getSnapshot).children["tally"]
      if (!isActorRef(restoredChild)) {
        return assert.fail("the restore left the inline child out")
      }
      assert.notStrictEqual(restoredChild, firstChild)
      assert.strictEqual(restoredChild.id, "tally")
      assert.strictEqual(restoredChild.src, tally)

      // An actor has no persisted snapshot field: the child starts from its logic's initial one
      yield* restored.start
      const childSnapshot = yield* restoredChild.getSnapshotUntyped
      assert.strictEqual(childSnapshot.status, "active")
      assert.strictEqual(contextOf(childSnapshot), 0)
      yield* restored.send({ type: "ADD" })
      assert.isTrue(yield* eventually(Effect.map(restoredChild.getSnapshotUntyped, (snapshot) => contextOf(snapshot) === 1)))
    })
  )

  it.effect("[COV-1] a restored delayed event to a child that is gone, to the parent of a root or to a systemId nobody holds is dropped at start; the others resume", () =>
    Effect.gen(function* () {
      const first = yield* createActor(ticker)
      yield* first.start
      const persisted = recordOf(throughJson(yield* first.getPersistedSnapshot))
      yield* first.stop
      const pending = (id: string, target: Persistence.PersistedEventTarget) => ({ id, event: { type: "TICK" }, delay: 100, startedAt: 0, target })
      const scheduledEvents = [
        pending("to-gone-child", { kind: "child", id: "gone" }),
        pending("to-no-parent", { kind: "parent" }),
        pending("to-nobody", { kind: "system", systemId: "nobody" }),
        pending("to-self", { kind: "self" }),
      ]

      const restored = yield* createActor(ticker, { snapshot: { ...persisted, scheduledEvents } })
      // Before start the restored events are kept, so a persist still holds every one
      assert.deepStrictEqual(recordOf(throughJson(yield* restored.getPersistedSnapshot))["scheduledEvents"], scheduledEvents)

      yield* restored.start
      assert.deepStrictEqual(Object.keys((yield* restored.system.getSnapshot)._scheduledEvents), [`${restored.sessionId}.to-self`])
      assert.deepStrictEqual(recordOf(throughJson(yield* restored.getPersistedSnapshot))["scheduledEvents"], [scheduledEvents[3]])

      yield* TestClock.adjust("100 millis")
      assert.isTrue(yield* eventually(Effect.map(restored.getSnapshot, (snapshot) => snapshot.context.ticks === 1)))
      yield* settle
      assert.strictEqual((yield* restored.getSnapshot).context.ticks, 1)
    })
  )

  it.effect("[COV-1] restore validation names any configuration that does not complete the machine: none at all, and a state value JSON cannot write", () =>
    Effect.gen(function* () {
      const machine = createMachine({ id: "cov1-validate", initial: "a", states: { a: {}, f: { type: "final" } } })
      const doneAt = (value: StateValue.StateValue) => snapshotAt(machine, value, "done", {})

      // A value that names no state lists no node, so it completes nothing
      const nowhere = doneAt("nowhere")
      assert.deepStrictEqual(nowhere._nodes, [])
      const error = yield* Effect.flip(Persistence.validateRestoredSnapshot({ status: "done", value: "nowhere" }, nowhere))
      assert.instanceOf(error, Errors.InvalidPersistedSnapshotError)
      assert.strictEqual(error.machineId, "cov1-validate")
      assert.strictEqual(error.stateValue, "nowhere")
      assert.strictEqual(error.status, "done")

      // A cyclic value has no JSON text: the error names it by its string form, and never throws
      const cyclic: { [key: string]: StateValue.StateValue } = {}
      cyclic["again"] = cyclic
      const cyclicError = yield* Effect.flip(Persistence.validateRestoredSnapshot({ status: "done" }, doneAt(cyclic)))
      assert.strictEqual(cyclicError.stateValue, String(cyclic))
      assert.include(cyclicError.message, `state '${String(cyclic)}' is not a final state`)

      // The same check passes a snapshot that is complete
      const complete = doneAt("f")
      assert.strictEqual(yield* Persistence.validateRestoredSnapshot({ status: "done", value: "f" }, complete), complete)
    })
  )

  it.effect("[COV-1] makeActorLogic keeps a given restoreSnapshot and config, and an actor restores through them", () =>
    Effect.gen(function* () {
      const logic = makeActorLogic<CountSnapshot, Inc, unknown>({
        ...counterMembers,
        restoreSnapshot: (persisted) => Effect.succeed({ ...active(), count: persistedCount(persisted) }),
        config: { name: "counter" },
      })
      assert.isTrue(Object.hasOwn(logic, "restoreSnapshot"))
      assert.deepStrictEqual(logic.config, { name: "counter" })

      const actor = yield* createActor(logic, { snapshot: { count: 5 } })
      assert.strictEqual((yield* actor.getSnapshot).count, 5)
      yield* actor.start
      yield* actor.send({ type: "INC" })
      assert.strictEqual((yield* actor.getSnapshot).count, 6)
      assert.deepStrictEqual(yield* actor.getPersistedSnapshot, { count: 6 })
    })
  )

  it.effect("[COV-1] an actor of a logic without restoreSnapshot takes the persisted snapshot as it is, as upstream", () =>
    Effect.gen(function* () {
      const logic = makeActorLogic<CountSnapshot, Inc, unknown>(counterMembers)
      assert.isFalse("restoreSnapshot" in logic)
      assert.isFalse("config" in logic)

      const given: CountSnapshot = { ...active(), count: 9 }
      const actor = yield* createActor(logic, { snapshot: given })
      assert.strictEqual(yield* actor.getSnapshot, given)
      yield* actor.start
      yield* actor.send({ type: "INC" })
      assert.strictEqual((yield* actor.getSnapshot).count, 10)
    })
  )

  // ------------------------------------------------------------ runtime

  it.effect("[COV-1] without a clock option an actor's clock runs its timers on the Effect clock: a timer fires once after its timeout, a cleared one never, and an unknown id clears nothing", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(ticker)
      const fired: Array<string> = []
      const kept = actor.clock.setTimeout(() => {
        fired.push("kept")
      }, 100)
      const cleared = actor.clock.setTimeout(() => {
        fired.push("cleared")
      }, 100)
      assert.notStrictEqual(kept, cleared)
      actor.clock.clearTimeout(cleared)
      actor.clock.clearTimeout("not a timer id")
      actor.clock.clearTimeout(12345)
      yield* settle

      yield* TestClock.adjust("99 millis")
      yield* settle
      assert.deepStrictEqual(fired, [])
      yield* TestClock.adjust("1 millis")
      assert.isTrue(yield* eventually(Effect.sync(() => fired.length > 0)))
      yield* TestClock.adjust("1 second")
      yield* settle
      assert.deepStrictEqual(fired, ["kept"])
    })
  )

  it.effect("[COV-1] a logic that throws on the stop event errors the actor with the thrown value and the snapshot it had, as upstream's _process catch", () =>
    Effect.gen(function* () {
      const refusal = new Error("no stopping")
      const stubborn = fromTransition((count: number, event: EventObject) => {
        if (event.type === "xstate.stop") {
          throw refusal
        }
        return count + 1
      }, 0)
      const actor = yield* createActor(stubborn)
      yield* listenForErrors(actor)
      yield* actor.start
      yield* actor.send({ type: "BUMP" })
      assert.strictEqual((yield* actor.getSnapshot).context, 1)

      yield* actor.stop
      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.status, "error")
      assert.strictEqual(Option.getOrUndefined(snapshot.error), refusal)
      assert.strictEqual(snapshot.context, 1)
    })
  )

  it.effect("[COV-1] a running child stopped twice in one macrostep stops once, and the parent goes on", () =>
    Effect.gen(function* () {
      const kid = createMachine({
        id: "cov1-kid",
        context: { pings: 0 },
        on: { PING: { actions: assign({ pings: ({ context }) => context.pings + 1 }) } },
      })
      const parent = createMachine<{ readonly kid: ActorRefModule.AnyActorRef; readonly halts: number }, EventObject>(
        {
          id: "cov1-parent",
          context: ({ spawn }) => ({ kid: spawn("kid", { id: "kid" }), halts: 0 }),
          on: {
            HALT: {
              actions: [
                stopChild(({ context }) => context.kid),
                stopChild(({ context }) => context.kid),
                assign({ halts: ({ context }) => context.halts + 1 }),
              ],
            },
          },
        },
        { actors: { kid } }
      )
      const actor = yield* createActor(parent)
      yield* actor.start
      const child = (yield* actor.getSnapshot).context.kid
      assert.strictEqual((yield* child.getSnapshotUntyped).status, "active")

      yield* actor.send({ type: "HALT" })
      assert.strictEqual((yield* child.getSnapshotUntyped).status, "stopped")
      const afterHalt = yield* actor.getSnapshot
      assert.strictEqual(afterHalt.status, "active")
      assert.strictEqual(afterHalt.context.halts, 1)
      assert.isFalse(Object.hasOwn(afterHalt.children, "kid"))

      // The parent goes on: a later stop of the stopped child changes nothing
      yield* actor.send({ type: "HALT" })
      const afterSecond = yield* actor.getSnapshot
      assert.strictEqual(afterSecond.status, "active")
      assert.strictEqual(afterSecond.context.halts, 2)
    })
  )

  it.effect("[COV-1] createSpawnFunction starts a child of the parent in the parent's system with the id, systemId and input given; only a child with syncSnapshot relays its snapshots", () =>
    Effect.gen(function* () {
      const host = yield* createActor(
        createMachine({
          id: "cov1-host",
          context: { synced: 0, plain: 0 },
          on: {
            "xstate.snapshot.synced": { actions: assign({ synced: ({ context }) => context.synced + 1 }) },
            "xstate.snapshot.plain": { actions: assign({ plain: ({ context }) => context.plain + 1 }) },
          },
        })
      )
      yield* host.start
      const spawn = createSpawnFunction(host.system, host)
      const echo = fromTransition(
        (state: { readonly seen: number; readonly input: unknown }, event: EventObject) =>
          event.type === "SEE" ? { ...state, seen: state.seen + 1 } : state,
        ({ input }) => ({ seen: 0, input })
      )

      const plain = yield* spawn(echo, { id: "plain", systemId: "plain-sys", input: "hello" })
      assert.strictEqual(plain.id, "plain")
      assert.isTrue(Option.exists(plain._parent, (parent) => parent === host))
      assert.isTrue(Option.exists(yield* host.system.get("plain-sys"), (registered) => registered === plain))
      // Started: an event sent now is processed
      yield* plain.send({ type: "SEE" })
      assert.deepStrictEqual(contextOf(yield* plain.getSnapshotUntyped), { seen: 1, input: "hello" })

      yield* spawn(echo, { id: "synced", syncSnapshot: true })
      assert.isTrue(yield* eventually(Effect.map(host.getSnapshot, (snapshot) => snapshot.context.synced >= 1)))
      yield* settle
      assert.strictEqual((yield* host.getSnapshot).context.plain, 0)
    })
  )

  it.effect("[COV-1] ActorRef.send delivers a typed event to the actor", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(ticker)
      yield* actor.start
      yield* ActorRefModule.send(actor, { type: "TICK" })
      assert.strictEqual((yield* actor.getSnapshot).context.ticks, 1)
    })
  )

  it.effect("[COV-1] an actor and a machine print as Actor(<id>) and StateMachine(<id>), inspect as their JSON forms and pipe; the Actor class exposes the child builders", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(ticker, { id: "cov1-proto" })
      assert.strictEqual(String(actor), "Actor(cov1-proto)")
      assert.deepStrictEqual(actor[Inspectable.NodeInspectSymbol](), { xstate$$type: 1, id: "cov1-proto" })
      assert.strictEqual(
        actor.pipe((self) => self.id),
        "cov1-proto"
      )

      assert.strictEqual(String(ticker), "StateMachine(cov1-ticker)")
      assert.strictEqual(JSON.stringify(ticker[Inspectable.NodeInspectSymbol]()), JSON.stringify(ticker.definition))
      assert.strictEqual(
        ticker.pipe((self) => self.id),
        "cov1-ticker"
      )

      assert.strictEqual(ActorClass.allocateChild, allocateChild)
      assert.strictEqual(ActorClass.buildChild, buildChild)
      assert.strictEqual(ActorClass.restoreChild, restoreChild)
    })
  )

  it.effect("[COV-1] an initial snapshot whose computation is interrupted interrupts createActor; it is not an actor error", () =>
    Effect.gen(function* () {
      const logic = makeActorLogic<CountSnapshot, Inc, unknown>({ ...counterMembers, getInitialSnapshot: () => Effect.interrupt })

      const exit = yield* Effect.exit(createActor(logic))

      assert.isTrue(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause), "the exit is an interruption only")
    })
  )

  it.effect("[COV-1] a logic start that is interrupted interrupts the actor's start", () =>
    Effect.gen(function* () {
      const logic = makeActorLogic<CountSnapshot, Inc, unknown>({ ...counterMembers, start: () => Effect.interrupt })
      const actor = yield* createActor(logic)

      const exit = yield* Effect.exit(actor.start)

      assert.isTrue(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause), "the exit is an interruption only")
    })
  )

  // ------------------------------------------------------------ engine

  it.effect("[COV-1] transitionNode fails with upstream's message when a value key names no child, atomic, compound and parallel, and selects the active child's transition first", () =>
    Effect.gen(function* () {
      const snapshot = selectionSnapshot("a")
      const ctx: StateUtils.EngineContext<object, EventObject> = {
        machine: selection,
        snapshot,
        event: { type: "GO" },
        actorScope: createInertActorScope(snapshot),
      }
      const sources = (definitions: ReadonlyArray<{ readonly source: string }> | undefined) =>
        (definitions ?? []).map((definition) => definition.source)
      // Upstream `getStateNode` throws; the port's selection dies with that message (S16)
      const failure = <A>(selection: Effect.Effect<A>) =>
        Effect.map(Effect.exit(selection), (exit) => (Exit.isFailure(exit) ? Option.some(String(Cause.squash(exit.cause))) : Option.none()))

      assert.deepStrictEqual(
        yield* failure(StateUtils.transitionNode(selection.root, "nowhere", ctx)),
        Option.some("MachineDefinitionError: Child state 'nowhere' does not exist on 'cov1-select'")
      )
      assert.deepStrictEqual(
        yield* failure(StateUtils.transitionNode(selection.root, { nowhere: "x" }, ctx)),
        Option.some("MachineDefinitionError: Child state 'nowhere' does not exist on 'cov1-select'")
      )
      const parallel = selection.states["p"]
      if (parallel === undefined) {
        return assert.fail("no parallel state p")
      }
      assert.deepStrictEqual(
        yield* failure(StateUtils.transitionNode(parallel, { r1: "x", nowhere: "y" }, ctx)),
        Option.some("MachineDefinitionError: Child state 'nowhere' does not exist on 'cov1-select.p'")
      )
      // A value that names the active child: that child's own transition first
      assert.deepStrictEqual(sources(yield* StateUtils.transitionNode(selection.root, "a", ctx)), ["cov1-select.a"])
    })
  )

  it.effect("[COV-1] a transition from a child to the root without reenter does not exit the root and enters the root's initial child again", () =>
    Effect.gen(function* () {
      const entries: Array<string> = []
      const track = (label: string) => () => {
        entries.push(label)
      }
      const rooted = createMachine({
        id: "cov1-root",
        initial: "a",
        exit: track("exit root"),
        states: {
          a: { entry: track("enter a"), exit: track("exit a"), on: { NEXT: "b" } },
          b: { entry: track("enter b"), exit: track("exit b"), on: { BACK: { target: "#cov1-root" } } },
        },
      })
      const actor = yield* createActor(rooted)
      yield* actor.start
      yield* actor.send({ type: "NEXT" })
      entries.length = 0

      yield* actor.send({ type: "BACK" })

      assert.strictEqual((yield* actor.getSnapshot).value, "a")
      assert.deepStrictEqual(entries, ["exit b", "enter a"])
    })
  )

  it.effect("[COV-1] a snapshot whose value names no state lists no node, and can, getTransitionData and microstep fail with upstream's message, as upstream walks the value", () =>
    Effect.gen(function* () {
      const lost = selectionSnapshot("nowhere")
      assert.deepStrictEqual(lost._nodes, [])

      const missing = Option.some("MachineDefinitionError: Child state 'nowhere' does not exist on 'cov1-select'")
      const failure = <A, E>(effect: Effect.Effect<A, E>) =>
        Effect.map(Effect.exit(effect), (exit) => (Exit.isFailure(exit) ? Option.some(String(Cause.squash(exit.cause))) : Option.none()))
      assert.deepStrictEqual(yield* failure(lost.can({ type: "GO" })), missing)
      assert.deepStrictEqual(yield* failure(selection.getTransitionData(lost, { type: "GO" })), missing)
      assert.deepStrictEqual(
        yield* failure(selection.microstep(lost, { type: "GO" }).pipe(Effect.provideService(ActorScope, createInertActorScope(lost)))),
        missing
      )
    })
  )

  it.effect("[COV-1] machine.microstep fails with the upstream TransitionError for an event of the wildcard type", () =>
    Effect.gen(function* () {
      const snapshot = selectionSnapshot("a")

      const error = yield* Effect.flip(
        selection.microstep(snapshot, { type: "*" }).pipe(Effect.provideService(ActorScope, createInertActorScope(snapshot)))
      )

      assert.strictEqual(error._tag, "TransitionError")
      assert.strictEqual(error.message, "An event cannot have the wildcard type ('*')")
    })
  )

  it.effect("[COV-1] a guard whose Effect is interrupted interrupts getTransitionData, where a guard that throws fails it with the guard-evaluation GuardError", () =>
    Effect.gen(function* () {
      const guarded = (guard: () => boolean | Effect.Effect<boolean>) => createMachine({ id: "cov1-guarded", on: { GO: { guard, actions: [] } } })
      const halting = guarded(() => Effect.interrupt)
      const haltingSnapshot = yield* getInitialSnapshot(halting)

      const halted = yield* Effect.exit(halting.getTransitionData(haltingSnapshot, { type: "GO" }))
      assert.isTrue(Exit.isFailure(halted) && Cause.hasInterruptsOnly(halted.cause), "the exit is an interruption only")

      const throwing = guarded(() => {
        throw new Error("no guard")
      })
      const thrown = yield* Effect.flip(throwing.getTransitionData(yield* getInitialSnapshot(throwing), { type: "GO" }))
      assert.strictEqual(thrown._tag, "GuardError")
      assert.strictEqual(thrown.message, guardEvaluationFailed("", "GO", "cov1-guarded", "no guard"))
    })
  )

  it.effect("[COV-1] an explicitly undefined maxIterations sets no limit, as the default Infinity", () =>
    Effect.gen(function* () {
      const unbounded = createMachine({
        id: "cov1-unbounded",
        options: { maxIterations: undefined },
        context: { n: 0 },
        always: { guard: ({ context }) => context.n < 50, actions: assign({ n: ({ context }) => context.n + 1 }) },
      })
      assert.isUndefined(unbounded.options.maxIterations)

      const actor = yield* createActor(unbounded)
      yield* actor.start
      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.status, "active")
      assert.strictEqual(snapshot.context.n, 50)
    })
  )

  it.effect("[COV-1] the machine logic's start starts each active child of an active snapshot, and nothing for a done snapshot", () =>
    Effect.gen(function* () {
      const kid = yield* createActor(ticker, { id: "kid" })
      const snapshotWith = (status: "active" | "done") => snapshotAt(selection, "a", status, { kid })
      const started: Array<string> = []
      const recording = (snapshot: SnapshotType): ActorScopeService => ({
        ...createInertActorScope(snapshot),
        startChild: (child) =>
          Effect.sync(() => {
            started.push(child.id)
          }),
      })

      const done = snapshotWith("done")
      yield* selection.start(done).pipe(Effect.provideService(ActorScope, recording(done)))
      assert.deepStrictEqual(started, [])

      const running = snapshotWith("active")
      yield* selection.start(running).pipe(Effect.provideService(ActorScope, recording(running)))
      assert.deepStrictEqual(started, ["kid"])
    })
  )

  it.effect("[COV-1] withContext and withId give new machines of the same config; the original is unchanged", () =>
    Effect.gen(function* () {
      const seeded = ticker.withContext({ ticks: 10 })
      const fromSeeded = yield* createActor(seeded)
      yield* fromSeeded.start
      yield* fromSeeded.send({ type: "TICK" })
      assert.strictEqual((yield* fromSeeded.getSnapshot).context.ticks, 11)

      const renamed = ticker.withId("cov1-renamed")
      assert.strictEqual(renamed.id, "cov1-renamed")
      assert.strictEqual(renamed.root.id, "cov1-renamed")
      const fromRenamed = yield* createActor(renamed)
      yield* fromRenamed.start
      yield* fromRenamed.send({ type: "TICK" })
      assert.strictEqual((yield* fromRenamed.getSnapshot).context.ticks, 1)

      assert.strictEqual(ticker.id, "cov1-ticker")
      const fromOriginal = yield* createActor(ticker)
      assert.strictEqual((yield* fromOriginal.getSnapshot).context.ticks, 0)
    })
  )

  it.effect("[COV-1] withContext takes a factory of { input, spawn, self }, which the machine calls for each actor as the config's context function", () =>
    Effect.gen(function* () {
      const startsAt = createMachine({
        types: {} as { context: { ticks: number }; input: { readonly from: number } },
        context: { ticks: 0 },
      }).withContext(({ input, self }) => ({ ticks: input.from + (typeof self.id === "string" ? 1 : 0) }))
      const actor = yield* createActor(startsAt, { input: { from: 41 } })

      assert.strictEqual((yield* actor.getSnapshot).context.ticks, 42)
    })
  )

  it.effect("[COV-1] a microstep into a history state without a record takes its default: none without a parent, and the upstream error for a target that names no child", () =>
    Effect.gen(function* () {
      // The history target names no child: the machine keeps that definition error, and its
      // nodes still exist for the pure helpers
      const remembering = createMachine({
        id: "cov1-history",
        initial: "a",
        states: {
          a: {},
          p: { initial: "x", states: { x: {}, hist: { type: "history", target: "nope" } } },
        },
      })
      const nodeOf = (id: string) => Option.getOrThrow(HashMap.get(remembering.idMap, id))
      const a = nodeOf("cov1-history.a")
      const definitionError = yield* Effect.flip(remembering.resolveState({ value: "a" }))

      const step = StateUtils.microstep(
        [{ source: a, target: [nodeOf("cov1-history.p.hist")], definition: Option.none(), reenter: false, actions: [] }],
        [remembering.root, a]
      )
      const stepError = Result.getOrThrow(Result.flip(step))
      assert.strictEqual(stepError.message, "Child state 'nope' does not exist on 'cov1-history.p'")
      assert.strictEqual(stepError.message, definitionError.message)

      // A history state with no parent has no default: the microstep enters nothing
      const orphan = StateNode.historyState<object, EventObject>("orphan", "", 0, "shallow", Option.none())
      const orphanStep = Result.getOrThrow(
        StateUtils.microstep([{ source: a, target: [orphan], definition: Option.none(), reenter: false, actions: [] }], [remembering.root, a])
      )
      assert.deepStrictEqual(orphanStep.entered, [])
      assert.deepStrictEqual(orphanStep.exited, [])
      assert.deepStrictEqual(orphanStep.configuration, [remembering.root, a])
    })
  )

  it("[COV-1] transitionMap keeps the position of a descriptor set twice and takes the later list (upstream Map.set)", () => {
    const listOf = (node: StateNode.StateNode<object, EventObject>) => node.on["GO"] ?? []
    const parallel = selection.states["p"]
    const a = selection.states["a"]
    if (parallel === undefined || a === undefined) {
      return assert.fail("missing states")
    }
    const map = StateUtils.transitionMap([
      ["GO", listOf(selection.root)],
      ["STAY", listOf(a)],
      ["GO", listOf(parallel)],
    ])
    assert.deepStrictEqual(
      map.map(([descriptor]) => descriptor),
      ["GO", "STAY"]
    )
    assert.strictEqual(map[0]?.[1], listOf(parallel))
    assert.strictEqual(map[1]?.[1], listOf(a))
  })

  it("[COV-1] getStateNodeByPath walks a path given as an array of keys, and fails with the upstream message for a key that names no child", () => {
    const found = StateUtils.getStateNodeByPath(selection, selection.root, ["p", "r1", "x"])
    assert.strictEqual(Result.getOrThrow(found).id, "cov1-select.p.r1.x")
    const missing = StateUtils.getStateNodeByPath(selection, selection.root, ["p", "nope"])
    assert.strictEqual(Result.getOrThrow(Result.flip(missing)), "Child state 'nope' does not exist on 'cov1-select.p'")
  })

  it("[COV-1] getAllStateNodes adds no child to a compound node that has no initial, and getStateValue gives {} for it and for no node at all", () => {
    const open = createMachine({ id: "cov1-open", states: { a: {}, b: {} } })
    assert.deepStrictEqual(StateUtils.getAllStateNodes([open.root]), [open.root])
    assert.deepStrictEqual(StateUtils.getStateValue(open.root, [open.root]), {})
    assert.deepStrictEqual(StateUtils.getStateValue(selection.root, []), {})
  })

  it("[COV-1] getCandidates gives the exact descriptor's transitions first, then each matching wildcard descriptor, longest first", () => {
    const wildcards = createMachine({
      id: "cov1-wild",
      on: { "*": { actions: [] }, "a.*": { actions: [] }, "a.b": { actions: [] }, c: { actions: [] } },
    })
    assert.deepStrictEqual(
      StateUtils.getCandidates(wildcards.root, "a.b").map((candidate) => candidate.eventType),
      ["a.b", "a.*", "*"]
    )
    assert.deepStrictEqual(
      StateUtils.getCandidates(wildcards.root, "c").map((candidate) => candidate.eventType),
      ["c", "*"]
    )
  })

  // ------------------------------------------------------------ state nodes, values, spawn, helpers

  it("[COV-1] the StateNode constructors build detached nodes of each type, and the predicates read the type", () => {
    const leaf = StateNode.atomic<object, EventObject>("leaf", "m", 0)
    const end = StateNode.final<object, EventObject>("end", "m", 1, Option.none())
    const regions = StateNode.parallel<object, EventObject>("regions", "m", 2, { leaf })
    const memory = StateNode.historyState<object, EventObject>("memory", "m", 3, "deep", Option.some("leaf"))

    assert.deepStrictEqual(
      [leaf, end, regions, memory].map((node) => [node.id, node.type]),
      [
        ["m.leaf", "atomic"],
        ["m.end", "final"],
        ["m.regions", "parallel"],
        ["m.memory", "history"],
      ]
    )
    assert.strictEqual(memory.history, "deep")
    assert.deepStrictEqual(memory.target, Option.some("leaf"))
    assert.strictEqual(regions.states["leaf"], leaf)

    assert.deepStrictEqual(
      [leaf, end, regions, memory, selection.root].map((node) => [
        StateNode.isAtomic(node),
        StateNode.isCompound(node),
        StateNode.isParallel(node),
        StateNode.isFinal(node),
        StateNode.isHistory(node),
        StateNode.isLeaf(node),
      ]),
      [
        [true, false, false, false, false, true],
        [false, false, false, true, false, true],
        [false, false, true, false, false, false],
        [false, false, false, false, true, false],
        [false, true, false, false, false, false],
      ]
    )
    assert.deepStrictEqual(StateNode.getInitialTarget(selection.root), Option.some(["a"]))
    assert.deepStrictEqual(StateNode.getInitialTarget(leaf), Option.none())
  })

  it("[COV-1] isAncestor and isDescendant read the node paths: a proper prefix only, and no relation between detached nodes", () => {
    const parallel = selection.states["p"]
    const region = parallel?.states["r1"]
    const a = selection.states["a"]
    if (parallel === undefined || region === undefined || a === undefined) {
      return assert.fail("missing states")
    }
    assert.isTrue(StateNode.isAncestor(selection.root, region))
    assert.isTrue(StateNode.isDescendant(region, parallel))
    assert.isFalse(StateNode.isAncestor(region, parallel))
    assert.isFalse(StateNode.isAncestor(parallel, parallel))
    assert.isFalse(StateNode.isDescendant(region, a))

    const leaf = StateNode.atomic<object, EventObject>("leaf", "m", 0)
    const regions = StateNode.parallel<object, EventObject>("regions", "m", 1, { leaf })
    assert.isFalse(StateNode.isAncestor(regions, leaf))
  })

  it("[COV-1] the with* transformations give a new node with one field replaced, and the tree keeps the original", () => {
    const a = selection.states["a"]
    const parallel = selection.states["p"]
    if (a === undefined || parallel === undefined) {
      return assert.fail("missing states")
    }
    const mark = () => undefined

    const entered = StateNode.withEntry(a, [mark])
    assert.deepStrictEqual(entered.entry, [mark])
    const exited = StateNode.withExit(a, [mark])
    assert.deepStrictEqual(exited.exit, [mark])
    const tagged = StateNode.withTags(a, ["busy"])
    assert.deepStrictEqual(tagged.tags, ["busy"])
    const moved = StateNode.withParent(a, parallel)
    assert.deepStrictEqual(moved.parent, Option.some(parallel))
    for (const changed of [entered, exited, tagged, moved]) {
      assert.notStrictEqual(changed, a)
      assert.strictEqual(changed.id, a.id)
      assert.deepStrictEqual(changed.path, a.path)
    }
    assert.deepStrictEqual(a.entry, [])
    assert.deepStrictEqual(a.tags, [])
    assert.deepStrictEqual(a.parent, Option.some(selection.root))
    assert.strictEqual(selection.states["a"], a)
  })

  it("[COV-1] withInvoke on a node whose config has no invoke lists each invocation in its definition with the src and id", () => {
    const invoking = createMachine(
      { id: "cov1-invoke", initial: "on", states: { on: { invoke: { id: "worker", src: "work" } }, off: {} } },
      { actors: { work: ticker } }
    )
    const on = invoking.states["on"]
    const off = invoking.states["off"]
    if (on === undefined || off === undefined) {
      return assert.fail("missing states")
    }
    const busy = StateNode.withInvoke(off, on.invoke)
    assert.strictEqual(busy.invoke, on.invoke)
    assert.deepStrictEqual(throughJson(busy.definition.invoke), [{ src: "work", type: "xstate.invoke", id: "worker" }])
    assert.deepStrictEqual(throughJson(busy.definition.invoke), throughJson(on.definition.invoke))
    assert.deepStrictEqual(off.invoke, [])
  })

  it("[COV-1] a state node is equal to itself only, prints as StateNode(<id>), inspects as its definition, and keeps its brand on the prototype", () => {
    const a = selection.states["a"]
    if (a === undefined) {
      return assert.fail("missing state a")
    }
    const twin = StateNode.make({ ...a })
    assert.isTrue(a[Equal.symbol](a))
    assert.isFalse(a[Equal.symbol](twin))
    assert.isFalse(Equal.equals(a, twin))

    assert.strictEqual(String(a), "StateNode(cov1-select.a)")
    assert.strictEqual(JSON.stringify(a[Inspectable.NodeInspectSymbol]()), JSON.stringify(a.definition))

    // The brand is a prototype getter: a spread does not copy it
    assert.isTrue(StateNode.isStateNode(a))
    assert.isFalse(StateNode.isStateNode({ ...a }))
    assert.isFalse(Object.hasOwn(a, StateNode.StateNodeTypeId))
    // Built on each read, not stored
    assert.notStrictEqual(a[StateNode.StateNodeTypeId], a[StateNode.StateNodeTypeId])
  })

  it("[COV-1] StateValue.matches is false for a compound source with several keys against an atomic target, and for a target key the source lacks", () => {
    assert.isTrue(StateValue.matches({ a: "x" }, "a"))
    assert.isFalse(StateValue.matches({ a: "x", b: "y" }, "a"))
    assert.isTrue(StateValue.matches({ a: "x", b: "y" }, { a: "x" }))
    assert.isFalse(StateValue.matches({ a: "x" }, { b: "y" }))
  })

  it("[COV-1] ActionResult.Log keeps a given label and level, and defaults to no label at level info", () => {
    const labelled = Types.ActionResult.Log("value", { label: Option.some("label"), level: "warning" })
    const plain = Types.ActionResult.Log("value")
    if (!(labelled instanceof Types.Log) || !(plain instanceof Types.Log)) {
      return assert.fail("not a Log result")
    }
    assert.deepStrictEqual([labelled.value, labelled.label, labelled.level], ["value", Option.some("label"), "warning"])
    assert.deepStrictEqual([plain.value, plain.label, plain.level], ["value", Option.none(), "info"])
  })

  it("[COV-1] resolveReferencedActor gives an implementation by name, and nothing for the invoke-source name of an invocation whose src is a name", () => {
    const invoking = createMachine({ id: "cov1-named", invoke: { src: "named" } }, { actors: { named: ticker } })
    assert.isTrue(Option.exists(resolveReferencedActor(invoking, "named"), (logic) => logic === ticker))
    assert.isTrue(Option.isNone(resolveReferencedActor(invoking, "xstate.invoke.0.cov1-named")))
    assert.isTrue(Option.isNone(resolveReferencedActor(invoking, "xstate.invoke.1.cov1-named")))
    assert.isTrue(Option.isNone(resolveReferencedActor(invoking, "unknown")))
  })

  it.effect("[COV-1] spawn with a named src calls a function input with the context, the event and self, as upstream createSpawner", () =>
    Effect.gen(function* () {
      const echo = fromTransition((state: unknown, _event: EventObject) => state, ({ input }) => input)
      const host = createMachine<{ readonly seed: number; readonly ref?: ActorRefModule.AnyActorRef }, EventObject>(
        {
          id: "cov1-spawn-input",
          context: { seed: 7 },
          entry: assign({
            ref: ({ spawn }) =>
              spawn("echo", {
                id: "echo",
                input: ({ context, event, self }: { readonly context: { readonly seed: number }; readonly event: EventObject; readonly self: ActorRefModule.ActorRefBase }) => ({
                  seed: context.seed,
                  event: event.type,
                  self: self.id,
                }),
              }),
          }),
        },
        { actors: { echo } }
      )
      const actor = yield* createActor(host, { id: "cov1-host" })
      yield* actor.start
      const ref = (yield* actor.getSnapshot).context.ref
      if (ref === undefined) {
        return assert.fail("no spawned child")
      }
      assert.deepStrictEqual(contextOf(yield* ref.getSnapshotUntyped), { seed: 7, event: "xstate.init", self: "cov1-host" })
    })
  )

  it.effect("[COV-1] createGuardContext gives the snapshot's context, the event, the scope's self and system, and the snapshot", () =>
    Effect.gen(function* () {
      const snapshot = selectionSnapshot("a")
      const scope = createInertActorScope(snapshot)
      const event: EventObject = { type: "GO" }

      const guardContext = createGuardContext(scope, snapshot, event)

      assert.strictEqual(guardContext.context, snapshot.context)
      assert.strictEqual(guardContext.event, event)
      assert.strictEqual(guardContext.self, scope.self)
      assert.strictEqual(guardContext.system, scope.system)
      assert.strictEqual(guardContext.snapshot, snapshot)
    })
  )

  it.effect("[COV-1] a subscriber attached after start runs before each send returns, as upstream calls observers synchronously; a select subscriber gives only changed values", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        types: {} as { context: { count: number; parity: string }; events: { type: "INC" } | { type: "TOUCH" } },
        context: { count: 0, parity: "even" },
        on: {
          INC: { actions: assign(({ context }) => ({ count: context.count + 1, parity: context.count % 2 === 0 ? "odd" : "even" })) },
          TOUCH: { actions: assign(({ context }) => ({ ...context })) },
        },
      })
      const seen: Array<string> = []
      const actor = yield* createActor(machine)
      yield* actor.start
      yield* actor.subscribe((snapshot) => Effect.sync(() => seen.push(`next:${snapshot.context.count}`)))
      yield* actor.select(({ context }) => context.parity).subscribe((parity) => Effect.sync(() => seen.push(`parity:${parity}`)))

      yield* actor.send({ type: "INC" })
      seen.push("sent INC")
      yield* actor.send({ type: "TOUCH" })
      seen.push("sent TOUCH")

      assert.deepStrictEqual(seen, ["next:1", "parity:odd", "sent INC", "next:1", "sent TOUCH"])
    })
  )

  it.effect("[COV-1] an observer call that waits goes on in its own fiber: the actor processes the next event, and the observer's next call waits for the call before it", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        types: {} as { context: { count: number }; events: { type: "INC" } },
        context: { count: 0 },
        on: { INC: { actions: assign(({ context }) => ({ count: context.count + 1 })) } },
      })
      const release = yield* Deferred.make<void>()
      const calls: Array<string> = []
      const actor = yield* createActor(machine)
      yield* actor.start
      yield* actor.subscribe((snapshot) =>
        Effect.gen(function* () {
          calls.push(`start:${snapshot.context.count}`)
          if (snapshot.context.count === 1) {
            yield* Deferred.await(release)
          }
          calls.push(`end:${snapshot.context.count}`)
        })
      )

      yield* actor.send({ type: "INC" })
      yield* actor.send({ type: "INC" })
      const whileWaiting = [...calls]
      const countWhileWaiting = (yield* actor.getSnapshot).context.count
      yield* Deferred.succeed(release, undefined)
      yield* Effect.yieldNow
      yield* Effect.yieldNow

      assert.deepStrictEqual(whileWaiting, ["start:1"])
      assert.strictEqual(countWhileWaiting, 2)
      assert.deepStrictEqual(calls, ["start:1", "end:1", "start:2", "end:2"])
    })
  )

  it.effect("[COV-1] the emissions stream ends when the actor stops or is done, after the last event it gives; a stream run after the end ends at once", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        types: {} as { events: { type: "PING" } | { type: "FINISH" }; emitted: { type: "pong"; n: number } },
        initial: "on",
        states: {
          on: { on: { PING: { actions: emit({ type: "pong", n: 1 }) }, FINISH: { target: "done", actions: emit({ type: "pong", n: 2 }) } } },
          done: { type: "final" },
        },
      })

      const stopped = yield* createActor(machine)
      const stoppedStream = yield* Effect.forkChild(Stream.runCollect(stopped.emissions), { startImmediately: true })
      yield* stopped.start
      yield* stopped.send({ type: "PING" })
      yield* stopped.stop
      const fromStopped = yield* Fiber.join(stoppedStream)

      const finished = yield* createActor(machine)
      const finishedStream = yield* Effect.forkChild(Stream.runCollect(finished.emissions), { startImmediately: true })
      yield* finished.start
      yield* finished.send({ type: "PING" })
      yield* finished.send({ type: "FINISH" })
      const fromFinished = yield* Fiber.join(finishedStream)
      const afterEnd = yield* Stream.runCollect(finished.emissions)

      assert.deepStrictEqual(Chunk.toReadonlyArray(Chunk.fromIterable(fromStopped)).map((event) => event.n), [1])
      assert.deepStrictEqual(Chunk.toReadonlyArray(Chunk.fromIterable(fromFinished)).map((event) => event.n), [1, 2])
      assert.strictEqual(Chunk.size(Chunk.fromIterable(afterEnd)), 0)
    })
  )

  it.effect("[COV-1] a SimulatedClock increment returns after the system settles: the parent takes its child's done event, and a timer that reaction starts within the increment fires in it", () =>
    Effect.gen(function* () {
      const child = createMachine({ initial: "waiting", states: { waiting: { after: { 3000: "done" } }, done: { type: "final" } } })
      const parent = createMachine({
        initial: "running",
        states: {
          running: { invoke: { src: child, onDone: "cooling" } },
          cooling: { after: { 500: "idle" } },
          idle: {},
        },
      })
      const clock = new SimulatedClock()
      const actor = yield* createActor(parent, { clock })
      yield* actor.start

      yield* clock.increment(3000)
      const afterChildDone = (yield* actor.getSnapshot).value
      yield* clock.increment(500)
      const afterCooling = (yield* actor.getSnapshot).value

      const again = yield* createActor(parent, { clock: new SimulatedClock() })
      yield* again.start
      const againClock = again.clock
      if (!(againClock instanceof SimulatedClock)) {
        return assert.fail("no SimulatedClock")
      }
      yield* againClock.increment(3500)

      assert.strictEqual(afterChildDone, "cooling")
      assert.strictEqual(afterCooling, "idle")
      assert.strictEqual((yield* again.getSnapshot).value, "idle")
    })
  )

  it.effect("[COV-1] a setupWithSchema machine checks each event, its context, its input and its output against the schemas' types; a mismatch fails as a throw of the SchemaError", () =>
    Effect.gen(function* () {
      const Counter = Schema.Struct({ count: Schema.Number.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))) })
      const Events = Schema.Union([
        Schema.Struct({ type: Schema.Literal("ADD"), by: Schema.Number }),
        Schema.Struct({ type: Schema.Literal("FINISH") }),
      ])
      const counter = setupWithSchema({
        context: Counter,
        events: Events,
        input: Schema.Struct({ start: Schema.Number }),
        output: Schema.Struct({ total: Schema.Number.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(10))) }),
      })
      const machine = counter.createMachine({
        context: ({ input }) => ({ count: input.start }),
        initial: "counting",
        states: {
          counting: {
            after: { 1000: "counting" },
            on: {
              ADD: { actions: assign(({ context, event }) => ({ count: context.count + event.by })) },
              FINISH: "finished",
            },
          },
          finished: { type: "final" },
        },
        output: ({ context }) => ({ total: context.count }),
      })

      // A matching event and context go through
      const ok = yield* createActor(machine, { input: { start: 1 } })
      yield* ok.start
      yield* ok.send({ type: "ADD", by: 2 })
      assert.strictEqual((yield* ok.getSnapshot).context.count, 3)

      // An event that does not match its schema: the actor errors with the SchemaError and keeps its context
      const badEvent = yield* createActor(machine, { input: { start: 1 } })
      yield* badEvent.start
      const untyped: { type: "ADD"; by: number } = JSON.parse('{"type":"ADD","by":"2"}')
      yield* badEvent.send(untyped)
      const afterBadEvent = yield* badEvent.getSnapshot
      assert.strictEqual(afterBadEvent.status, "error")
      assert.isTrue(Option.exists(afterBadEvent.error, Schema.isSchemaError))
      assert.strictEqual(afterBadEvent.context.count, 1)

      // A transition that gives a context its schema rejects errors the actor
      const badContext = yield* createActor(machine, { input: { start: 1 } })
      yield* badContext.start
      yield* badContext.send({ type: "ADD", by: -5 })
      const afterBadContext = yield* badContext.getSnapshot
      assert.strictEqual(afterBadContext.status, "error")
      assert.isTrue(Option.exists(afterBadContext.error, Schema.isSchemaError))

      // A done snapshot whose output its schema rejects errors the actor
      const badOutput = yield* createActor(machine, { input: { start: 1 } })
      yield* badOutput.start
      yield* badOutput.send({ type: "FINISH" })
      const afterBadOutput = yield* badOutput.getSnapshot
      assert.strictEqual(afterBadOutput.status, "error")
      assert.isTrue(Option.exists(afterBadOutput.error, Schema.isSchemaError))

      // An input its schema rejects gives an initial snapshot with status error
      const badInput: { start: number } = JSON.parse('{"start":"one"}')
      const rejected = yield* createActor(machine, { input: badInput })
      const initial = yield* rejected.getSnapshot
      assert.strictEqual(initial.status, "error")
      assert.isTrue(Option.exists(initial.error, Schema.isSchemaError))

      // The built-in events are not checked, and provide keeps the checks
      const provided = machine.provide({})
      const viaProvide = yield* createActor(provided, { input: { start: 4 } })
      yield* viaProvide.start
      yield* viaProvide.send(untyped)
      assert.strictEqual((yield* viaProvide.getSnapshot).status, "error")
      const finished = yield* createActor(machine, { input: { start: 12 } })
      yield* finished.start
      yield* finished.send({ type: "FINISH" })
      assert.deepStrictEqual((yield* finished.getSnapshot).output, Option.some({ total: 12 }))
    })
  )

  it.effect("[COV-1] a setup machine requires the services of its inline actions, and provide adds the services of the given implementations", () =>
    Effect.gen(function* () {
      const machine = setup({
        types: {} as { events: { type: "SEND" } },
        actions: { record: () => {} },
      }).createMachine({
        initial: "idle",
        states: {
          idle: {
            on: {
              SEND: {
                target: "sent",
                actions: [
                  "record",
                  () => Effect.gen(function* () { (yield* Mailbox).sent.push("hello") }),
                ],
              },
            },
          },
          sent: {},
        },
      })
      const audited = machine.provide({
        actions: { record: () => Effect.gen(function* () { (yield* Audit).lines.push("record") }) },
      })
      typeHolds<[ServicesOf<typeof machine>] extends [Mailbox] ? ([Mailbox] extends [ServicesOf<typeof machine>] ? true : false) : false>(true)
      typeHolds<[ServicesOf<typeof audited>] extends [Mailbox | Audit] ? ([Mailbox | Audit] extends [ServicesOf<typeof audited>] ? true : false) : false>(true)
      // The actions of an initial object and of a route count too
      const routed = setup({ types: {} as { events: { type: "GO" } } }).createMachine({
        initial: { target: "idle", actions: () => Effect.gen(function* () { (yield* Mailbox).sent.push("initial") }) },
        states: {
          idle: {},
          review: { id: "review", route: { actions: () => Effect.gen(function* () { (yield* Audit).lines.push("route") }) } },
        },
      })
      typeHolds<[Mailbox | Audit] extends [ServicesOf<typeof routed>] ? true : false>(true)

      const sent: Array<string> = []
      const lines: Array<string> = []
      yield* Effect.gen(function* () {
        const actor = yield* createActor(audited)
        yield* actor.start
        yield* actor.send({ type: "SEND" })
      }).pipe(Effect.provideService(Mailbox, { sent }), Effect.provideService(Audit, { lines }))

      const routedSent: Array<string> = []
      const routedLines: Array<string> = []
      yield* Effect.gen(function* () {
        const actor = yield* createActor(routed)
        yield* actor.start
        yield* actor.send({ type: "xstate.route", to: "#review" })
      }).pipe(Effect.provideService(Mailbox, { sent: routedSent }), Effect.provideService(Audit, { lines: routedLines }))

      assert.deepStrictEqual(sent, ["hello"])
      assert.deepStrictEqual(lines, ["record"])
      assert.deepStrictEqual(routedSent, ["initial"])
      assert.deepStrictEqual(routedLines, ["route"])
    })
  )

  it.effect("[COV-1] an inline and, or or not in a setup machine names only the setup's guards, each with params of its type", () =>
    Effect.gen(function* () {
      const guarded = setup({
        types: {} as { context: { open: boolean }; events: { type: "GO" } },
        guards: {
          isOpen: ({ context }) => context.open,
          isLocked: () => false,
          under: (_, params: { readonly max: number }) => params.max > 1,
        },
      })
      const machine = guarded.createMachine({
        context: { open: true },
        initial: "waiting",
        states: {
          waiting: {
            on: { GO: { target: "gone", guard: and(["isOpen", not("isLocked"), { type: "under", params: { max: 2 } }]) } },
          },
          gone: {},
        },
      })
      // Never called: each config is a type error, which the directive above it asserts
      const unknownNames = () => [
        guarded.createMachine({
          context: { open: true },
          // @ts-expect-error the setup has no guard named isClosed
          on: { GO: { guard: and(["isOpen", "isClosed"]) } },
        }),
        guarded.createMachine({
          context: { open: true },
          // @ts-expect-error the guard under needs its params
          on: { GO: { guard: or(["isOpen", "under"]) } },
        }),
        guarded.createMachine({
          context: { open: true },
          // @ts-expect-error the setup has no guard named isAjar
          on: { GO: { guard: not("isAjar") } },
        }),
      ]

      const actor = yield* createActor(machine)
      yield* actor.start
      yield* actor.send({ type: "GO" })

      assert.strictEqual((yield* actor.getSnapshot).value, "gone")
      assert.strictEqual(typeof unknownNames, "function")
    })
  )

  it.effect("[COV-1] makeActorLogic's start runs in the actor's scope: a fiber it forks with forkScoped adds no requirement and is interrupted when the actor stops", () =>
    Effect.gen(function* () {
      const events: Array<string> = []
      const ticking = makeActorLogic({
        transition: (snapshot: SnapshotType) => Effect.succeed(snapshot),
        getInitialSnapshot: () => Effect.succeed(active()),
        getPersistedSnapshot: (snapshot) => Effect.succeed(snapshot),
        start: () =>
          Effect.asVoid(
            Effect.forkScoped(
              Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(() => events.push("interrupted"))))
            )
          ),
      })
      typeHolds<[ActorLogicModule.ActorLogic.RequirementsOf<typeof ticking>] extends [never] ? true : false>(true)

      const actor = yield* createActor(ticking)
      yield* actor.start
      yield* Effect.yieldNow
      const beforeStop = [...events]
      yield* actor.stop

      assert.deepStrictEqual(beforeStop, [])
      assert.deepStrictEqual(events, ["interrupted"])
    })
  )

  it.effect("[COV-1] the root's ActorLogic and ActorRef modules give the type helpers at their top level, the same as their namespaces", () =>
    Effect.gen(function* () {
      const counting = fromTransition((count: number, _event: { readonly type: "ADD" }) => count + 1, 0)
      type Logic = typeof counting
      typeHolds<Equals<RootActorLogic.SnapshotOf<Logic>, RootActorLogic.ActorLogic.SnapshotOf<Logic>>>(true)
      typeHolds<Equals<RootActorLogic.EventOf<Logic>, { readonly type: "ADD" }>>(true)
      typeHolds<Equals<RootActorLogic.InputOf<Logic>, RootActorLogic.ActorLogic.InputOf<Logic>>>(true)
      typeHolds<Equals<RootActorLogic.EmittedOf<Logic>, RootActorLogic.ActorLogic.EmittedOf<Logic>>>(true)
      typeHolds<Equals<RootActorLogic.RequirementsOf<Logic>, never>>(true)

      const actor = yield* createActor(counting)
      type Ref = typeof actor
      typeHolds<Equals<RootActorRef.SnapshotOf<Ref>, RootActorRef.ActorRef.SnapshotOf<Ref>>>(true)
      typeHolds<Equals<RootActorRef.EventOf<Ref>, RootActorRef.ActorRef.EventOf<Ref>>>(true)
      typeHolds<Equals<RootActorRef.EmittedOf<Ref>, RootActorRef.ActorRef.EmittedOf<Ref>>>(true)
      yield* actor.start
      yield* actor.send({ type: "ADD" })
      assert.strictEqual((yield* actor.getSnapshot).context, 1)
    })
  )
})
