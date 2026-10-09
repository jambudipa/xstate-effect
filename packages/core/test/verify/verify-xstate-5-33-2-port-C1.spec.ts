/**
 * C1: createActor creates an actor from any logic.
 *
 * T2.40. Upstream `createActor` and the `Actor` constructor in `src/createActor.ts` at
 * xstate@5.33.2: `createActor(logic, options?)` builds an actor that is not started, for a
 * machine and for any other actor logic; it computes the snapshot at creation
 * (`_initState`), so the snapshot read before `start` is the initial snapshot, and a throw
 * while it computes it gives an actor in status `error`, never an exception. The port
 * returns `Effect<Actor, never, Scope | R>` (SD-8): the actor lives in a child scope of
 * the caller's scope, so closing that scope stops it. `id` defaults to the session id,
 * which a root actor's own system books as `x:0` (SD-9). `start` is idempotent.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Exit, Option, Scope, Stream, SubscriptionRef } from "effect"
import {
  assign,
  createActor,
  createMachine,
  type EventObject,
  fromCallback,
  fromPromise,
  getInitialSnapshot,
  type SnapshotType,
} from "../../src/index.js"
import { initialStateNotFound } from "./upstream-messages.js"

interface Ctx {
  readonly count: number
}

type Ev = { readonly type: "GO" }

/**
 * `idle -GO-> busy`. The initial entry assigns `count: 1`, then calls `onEntry` with the
 * context it sees.
 */
const goMachine = (onEntry: (count: number) => void) =>
  createMachine<Ctx, Ev>({
    id: "c1",
    initial: "idle",
    context: { count: 0 },
    states: {
      idle: {
        entry: [
          assign<Ctx, Ev>({ count: 1 }),
          ({ context }) => {
            onEntry(context.count)
          },
        ],
        on: { GO: "busy" },
      },
      busy: {},
    },
  })

/** Waits until the actor publishes a snapshot that satisfies `predicate`, and returns it. */
const reach = <S extends SnapshotType, E>(actor: { readonly changes: Stream.Stream<S, E> }, predicate: (snapshot: S) => boolean) =>
  actor.changes.pipe(Stream.filter(predicate), Stream.runHead, Effect.map(Option.getOrThrow))

/** The message of the snapshot's error, if it has one. */
const errorMessageOf = (snapshot: SnapshotType): Option.Option<string> =>
  Option.flatMap(snapshot.error, (error) => (error instanceof Error ? Option.some(error.message) : Option.none()))

/** Lets every other ready fiber run, so a wrongly started actor would show its work. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 10; turn++) {
    yield* Effect.yieldNow
  }
})

describe("C1 createActor creates an actor from any logic", () => {
  it.effect("[C1] createActor(machine) with no options succeeds and returns an actor that is not started", () =>
    Effect.gen(function* () {
      const entries: Array<number> = []
      const created = yield* Effect.exit(createActor(goMachine((count) => entries.push(count))))
      assert.isTrue(Exit.isSuccess(created))
      const actor = yield* created

      // Not started: no entry action ran and an event sent now waits in the mailbox
      yield* actor.send({ type: "GO" })
      yield* settle
      assert.deepStrictEqual(entries, [])
      assert.strictEqual((yield* SubscriptionRef.get(actor.snapshot)).value, "idle")

      // A root actor's own system books its session id; `id` defaults to it (SD-9)
      assert.strictEqual(actor.sessionId, "x:0")
      assert.strictEqual(actor.id, actor.sessionId)

      yield* actor.start
      const busy = yield* reach(actor, (snapshot) => snapshot.value === "busy")
      assert.strictEqual(busy.value, "busy")
      assert.deepStrictEqual(entries, [1])
    })
  )

  it.effect("[C1] reading the snapshot of a machine actor before start gives the initial snapshot", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(goMachine(() => undefined), { id: "c1-machine" })
      const before = yield* SubscriptionRef.get(actor.snapshot)
      const initial = yield* getInitialSnapshot(goMachine(() => undefined), undefined)

      assert.strictEqual(actor.id, "c1-machine")
      assert.strictEqual(before.status, "active")
      assert.strictEqual(before.value, "idle")
      // The initial assign resolved at creation, as upstream computes the snapshot there
      assert.deepStrictEqual(before.context, { count: 1 })
      assert.deepStrictEqual(
        { status: before.status, value: before.value, context: before.context },
        { status: initial.status, value: initial.value, context: initial.context }
      )
    })
  )

  it.effect("[C1] createActor(fromPromise(...)) with no options succeeds, runs no promise creator and reads the logic's initial snapshot before start", () =>
    Effect.gen(function* () {
      const calls: Array<string> = []
      const logic = fromPromise(() => {
        calls.push("creator")
        return Promise.resolve(42)
      })
      const created = yield* Effect.exit(createActor(logic))
      assert.isTrue(Exit.isSuccess(created))
      const actor = yield* created

      // Not started: other fibers ran, and the promise creator did not
      yield* settle
      assert.deepStrictEqual(calls, [])
      const before = yield* SubscriptionRef.get(actor.snapshot)
      const initial = yield* getInitialSnapshot(logic, undefined)
      assert.deepStrictEqual({ status: before.status, output: before.output }, { status: initial.status, output: initial.output })
      assert.strictEqual(actor.id, actor.sessionId)

      // `start` calls the creator, once (upstream `start`)
      yield* actor.start
      assert.deepStrictEqual(calls, ["creator"])
      const done = yield* reach(actor, (snapshot) => snapshot.status === "done")
      assert.deepStrictEqual(done.output, Option.some(42))
      assert.deepStrictEqual(calls, ["creator"])
    })
  )

  it.effect("[C1] createActor(fromCallback(...)) with no options succeeds and the callback runs only at start", () =>
    Effect.gen(function* () {
      const calls: Array<string> = []
      const logic = fromCallback(() => {
        calls.push("callback")
      })
      const created = yield* Effect.exit(createActor(logic))
      assert.isTrue(Exit.isSuccess(created))
      const actor = yield* created

      yield* settle
      assert.deepStrictEqual(calls, [])
      const before = yield* SubscriptionRef.get(actor.snapshot)
      assert.strictEqual(before.status, "active")
      const initial = yield* getInitialSnapshot(logic, undefined)
      assert.deepStrictEqual(
        { status: before.status, output: before.output, error: before.error, input: before.input },
        { status: initial.status, output: initial.output, error: initial.error, input: initial.input }
      )

      yield* actor.start
      assert.deepStrictEqual(calls, ["callback"])
    })
  )

  it.effect("[C1] start is idempotent", () =>
    Effect.gen(function* () {
      const calls: Array<string> = []
      const callbackActor = yield* createActor(
        fromCallback(() => {
          calls.push("callback")
        })
      )
      const entries: Array<number> = []
      const machineActor = yield* createActor(goMachine((count) => entries.push(count)))

      yield* callbackActor.start
      yield* callbackActor.start
      yield* machineActor.start
      yield* machineActor.start
      yield* settle

      assert.deepStrictEqual(calls, ["callback"])
      assert.deepStrictEqual(entries, [1])
      assert.strictEqual((yield* SubscriptionRef.get(machineActor.snapshot)).status, "active")
    })
  )

  it.effect("[C1] an input that the context factory rejects gives an actor with status error, not a failure", () =>
    Effect.gen(function* () {
      const rejection = new RangeError("the input must be a positive number")
      const machine = createMachine<Ctx, Ev, number>({
        id: "c1-input",
        initial: "idle",
        context: () => {
          throw rejection
        },
        states: { idle: {} },
      })

      const created = yield* Effect.exit(createActor(machine, { input: -1 }))
      assert.isTrue(Exit.isSuccess(created))
      const actor = yield* created
      const snapshot = yield* SubscriptionRef.get(actor.snapshot)

      assert.strictEqual(snapshot.status, "error")
      // The original thrown value (SD-4), not a wrapper
      assert.strictEqual(Option.getOrUndefined(snapshot.error), rejection)
    })
  )

  it.effect("[C1] an initial key that names no child gives status error at creation with the recorded message", () =>
    Effect.gen(function* () {
      const machine = createMachine<object, EventObject>({
        id: "fetchMachine",
        initial: "create",
        context: {},
        states: {
          edit: {
            initial: "idle",
            states: {
              idle: { on: { FETCH: "pending" } },
              pending: {},
            },
          },
        },
      })

      const created = yield* Effect.exit(createActor(machine))
      assert.isTrue(Exit.isSuccess(created))
      const actor = yield* created
      const snapshot = yield* SubscriptionRef.get(actor.snapshot)

      assert.strictEqual(snapshot.status, "error")
      assert.deepStrictEqual(errorMessageOf(snapshot), Option.some(initialStateNotFound("create", "fetchMachine")))
    })
  )

  it.effect("[C1] closing the caller's scope stops the actor and runs its cleanup", () =>
    Effect.gen(function* () {
      const cleanups: Array<string> = []
      const scope = yield* Scope.make()
      const callbackActor = yield* createActor(
        fromCallback(() => () => {
          cleanups.push("cleanup")
        })
      ).pipe(Scope.provide(scope))
      const machineActor = yield* createActor(goMachine(() => undefined)).pipe(Scope.provide(scope))
      yield* callbackActor.start
      yield* machineActor.start
      assert.deepStrictEqual(cleanups, [])

      yield* Scope.close(scope, Exit.void)

      assert.deepStrictEqual(cleanups, ["cleanup"])
      assert.strictEqual((yield* SubscriptionRef.get(callbackActor.snapshot)).status, "stopped")
      assert.strictEqual((yield* SubscriptionRef.get(machineActor.snapshot)).status, "stopped")
    })
  )
})
