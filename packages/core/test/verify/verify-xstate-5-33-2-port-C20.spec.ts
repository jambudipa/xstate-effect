/**
 * C20: system.get and system.getAll find actors by systemId.
 *
 * T2.42. Upstream `createSystem` in `src/system.ts` at xstate@5.33.2 keeps every actor by
 * session id (`children`) and the actors that have a `systemId` in `keyedActors`: `get` and
 * `getAll` read `keyedActors` only, `_set` throws `Actor with system ID '<id>' already
 * exists.` for a second actor under a systemId in use, and `_unregister` drops both entries.
 * The `Actor` constructor in `src/createActor.ts` registers the `systemId` option before it
 * computes the initial snapshot and drops it again when that snapshot is not `active`; stop,
 * done and error unregister (`_stopProcedure`).
 *
 * The port reads the registry through Effects (D7): `get(systemId)` gives
 * `Effect<Option<ActorRef>>` and `getAll` an Effect of a plain record keyed by systemId; both
 * run under `Effect.runSync`, and `_lookup` is the synchronous lookup for code inside a
 * transition. A duplicate systemId is a defect of `createActor` (upstream throws from the
 * constructor; inside a spawn or an invoke the parent's transition turns it into status
 * `error`, SD-4). Invoke `systemId` is C3 (phase 5) and spawn `systemId` is T2.44, so these
 * tests register through the `systemId` option of `createActor`, and children through its
 * `parent` option. Read-your-writes `send` is T2.43, so the tests wait on `changes`.
 */
import { assert, describe, it } from "@effect/vitest"
import { Cause, Effect, Exit, Option, Stream } from "effect"
import {
  type ActorSystemService,
  type ActorType,
  createActor,
  createMachine,
  type EventObject,
  fromCallback,
  type SnapshotType,
  stopChild,
} from "../../src/index.js"
import { duplicateSystemId } from "./upstream-messages.js"

/**
 * `idle` until `FINISH` (to the final state `finished`) or `BREAK` (to `ping`, whose `always`
 * cycle with `pong` passes `maxIterations`, so the actor ends with status `error`).
 * `STOP_WORKER` stops the child registered as `worker` (`stopChild` by systemId, D7): a
 * non-root actor cannot be stopped directly (upstream `stop`), its parent stops it.
 */
const lifecycleMachine = () =>
  createMachine<object, EventObject>({
    id: "c20",
    initial: "idle",
    context: {},
    options: { maxIterations: 3 },
    on: { STOP_WORKER: { actions: stopChild("worker") } },
    states: {
      idle: { on: { FINISH: "finished", BREAK: "ping" } },
      finished: { type: "final" },
      ping: { always: "pong" },
      pong: { always: "ping" },
    },
  })

/** A callback logic that does nothing: an actor that stays active. */
const idleLogic = () => fromCallback(() => undefined)

/** Whether `system.get(key)` finds exactly `actor`. */
const finds = (system: ActorSystemService, key: string, actor: object) =>
  Effect.map(system.get(key), (found) => Option.isSome(found) && found.value === actor)

/** The systemIds of `system.getAll`, in the record's key order. */
const keysOf = (system: ActorSystemService) => Effect.map(system.getAll, (all) => Object.keys(all))

/** Lets every other ready fiber take ten turns. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 10; turn++) {
    yield* Effect.yieldNow
  }
})

/**
 * Waits until the actor publishes a snapshot with `status`, or until 25 snapshots went by,
 * then lets the actor's loop finish its turn. A `changes` stream that fails also ends it.
 */
const untilStatus = <S extends SnapshotType>(actor: Pick<ActorType<S, EventObject>, "changes">, status: string) =>
  actor.changes.pipe(
    Stream.take(25),
    Stream.filter((snapshot) => snapshot.status === status),
    Stream.runHead,
    Effect.exit,
    Effect.andThen(settle)
  )

/** The message of the error a failed exit dies or fails with. */
const failureMessage = <A>(exit: Exit.Exit<A>): Option.Option<string> =>
  Exit.isFailure(exit)
    ? Option.some(String((Cause.squash(exit.cause) as { readonly message?: unknown }).message))
    : Option.none()

describe("C20 system.get and system.getAll find actors by systemId", () => {
  it.effect("[C20] system.get gives Some of the actor registered under a systemId and None for an unknown id", () =>
    Effect.gen(function* () {
      const root = yield* createActor(lifecycleMachine(), { systemId: "root" })
      const worker = yield* createActor(idleLogic(), { parent: root.ref, systemId: "worker" })
      const plain = yield* createActor(idleLogic(), { parent: root.ref, id: "plain" })
      yield* root.start
      yield* worker.start
      yield* plain.start
      const system = root.system

      assert.strictEqual(worker.system, system)
      assert.isTrue(yield* finds(system, "root", root), "root")
      assert.isTrue(yield* finds(system, "worker", worker), "worker")
      assert.isTrue(Option.isNone(yield* system.get("nobody")), "unknown systemId")
      // The registry is keyed by systemId: neither an id nor a session id finds an actor
      assert.isTrue(Option.isNone(yield* system.get("plain")), "id without a systemId")
      for (const sessionId of [root.sessionId, worker.sessionId, plain.sessionId]) {
        assert.isTrue(Option.isNone(yield* system.get(sessionId)), `session id ${sessionId}`)
      }
    })
  )

  it.effect("[C20] system.getAll gives a plain record keyed by systemId, in registration order", () =>
    Effect.gen(function* () {
      const root = yield* createActor(lifecycleMachine(), { systemId: "root" })
      const worker = yield* createActor(idleLogic(), { parent: root.ref, systemId: "worker" })
      const plain = yield* createActor(idleLogic(), { parent: root.ref })
      yield* root.start
      yield* worker.start
      yield* plain.start

      const all = yield* root.system.getAll

      assert.strictEqual(Object.getPrototypeOf(all), Object.prototype)
      assert.deepStrictEqual(Object.keys(all), ["root", "worker"])
      assert.strictEqual(all["root"], root)
      assert.strictEqual(all["worker"], worker)
      // An actor without a systemId is not in the record
      assert.isFalse(Object.values(all).some((actor) => actor === plain))
    })
  )

  it.effect("[C20] registering a duplicate systemId fails with the recorded message and keeps the first actor", () =>
    Effect.gen(function* () {
      const root = yield* createActor(lifecycleMachine(), { systemId: "root" })
      const worker = yield* createActor(idleLogic(), { parent: root.ref, systemId: "worker" })
      yield* root.start
      yield* worker.start

      const againRoot = yield* Effect.exit(createActor(idleLogic(), { parent: root.ref, systemId: "root" }))
      const againWorker = yield* Effect.exit(createActor(idleLogic(), { parent: root.ref, systemId: "worker" }))

      assert.isTrue(Exit.isFailure(againRoot))
      assert.deepStrictEqual(failureMessage(againRoot), Option.some(duplicateSystemId("root")))
      assert.isTrue(Exit.isFailure(againWorker))
      assert.deepStrictEqual(failureMessage(againWorker), Option.some(duplicateSystemId("worker")))
      assert.isTrue(yield* finds(root.system, "root", root))
      assert.isTrue(yield* finds(root.system, "worker", worker))
      assert.deepStrictEqual(yield* keysOf(root.system), ["root", "worker"])
    })
  )

  it.effect("[C20] an actor that stops is no longer found and its systemId is free again at once", () =>
    Effect.gen(function* () {
      const root = yield* createActor(lifecycleMachine(), { systemId: "root" })
      const worker = yield* createActor(idleLogic(), { parent: root.ref, systemId: "worker" })
      yield* root.start
      yield* worker.start
      assert.isTrue(yield* finds(root.system, "worker", worker))

      // Its parent stops it (a non-root actor cannot be stopped directly)
      yield* root.send({ type: "STOP_WORKER" })

      assert.strictEqual((yield* worker.getSnapshot).status, "stopped")
      assert.isTrue(Option.isNone(yield* root.system.get("worker")))
      assert.deepStrictEqual(yield* keysOf(root.system), ["root"])
      const next = yield* createActor(idleLogic(), { parent: root.ref, systemId: "worker" })
      assert.isTrue(yield* finds(root.system, "worker", next))
    })
  )

  it.effect("[C20] an actor that reaches done is no longer found under its systemId, and the systemId can be registered again", () =>
    Effect.gen(function* () {
      const root = yield* createActor(lifecycleMachine(), { systemId: "finisher" })
      yield* root.start
      assert.isTrue(yield* finds(root.system, "finisher", root))

      yield* root.send({ type: "FINISH" })
      yield* untilStatus(root, "done")

      assert.strictEqual((yield* root.getSnapshot).status, "done")
      assert.isTrue(Option.isNone(yield* root.system.get("finisher")))
      assert.deepStrictEqual(yield* keysOf(root.system), [])
      const next = yield* createActor(idleLogic(), { parent: root.ref, systemId: "finisher" })
      assert.isTrue(yield* finds(root.system, "finisher", next))
    })
  )

  it.effect("[C20] an actor that reaches error is no longer found under its systemId, and the systemId can be registered again", () =>
    Effect.gen(function* () {
      const root = yield* createActor(lifecycleMachine(), { systemId: "breaker" })
      yield* root.start
      assert.isTrue(yield* finds(root.system, "breaker", root))

      yield* root.send({ type: "BREAK" })
      yield* untilStatus(root, "error")

      assert.strictEqual((yield* root.getSnapshot).status, "error")
      assert.isTrue(Option.isNone(yield* root.system.get("breaker")))
      assert.deepStrictEqual(yield* keysOf(root.system), [])
      const next = yield* createActor(idleLogic(), { parent: root.ref, systemId: "breaker" })
      assert.isTrue(yield* finds(root.system, "breaker", next))
    })
  )

  it.effect("[C20] an actor whose initial snapshot is done or error is not registered under its systemId", () =>
    Effect.gen(function* () {
      const bornDone = yield* createActor(
        createMachine<object, EventObject>({ id: "c20-born-done", initial: "end", context: {}, states: { end: { type: "final" } } }),
        { systemId: "born-done" }
      )
      const bornBroken = yield* createActor(
        createMachine<object, EventObject>({
          id: "c20-born-broken",
          initial: "a",
          context: {},
          options: { maxIterations: 3 },
          states: { a: { always: "b" }, b: { always: "a" } },
        }),
        { systemId: "born-broken" }
      )

      assert.strictEqual((yield* bornDone.getSnapshot).status, "done")
      assert.strictEqual((yield* bornBroken.getSnapshot).status, "error")
      assert.isTrue(Option.isNone(yield* bornDone.system.get("born-done")))
      assert.isTrue(Option.isNone(yield* bornBroken.system.get("born-broken")))

      // Starting does not register them either, and the systemId stays free
      yield* bornDone.start
      yield* bornBroken.start
      yield* settle
      assert.isTrue(Option.isNone(yield* bornDone.system.get("born-done")))
      assert.isTrue(Option.isNone(yield* bornBroken.system.get("born-broken")))
      const next = yield* createActor(idleLogic(), { parent: bornDone.ref, systemId: "born-done" })
      assert.isTrue(yield* finds(bornDone.system, "born-done", next))
    })
  )

  it.effect("[C20] closing the scope that holds a parent and its child unregisters both systemIds", () =>
    Effect.gen(function* () {
      const system = yield* Effect.scoped(
        Effect.gen(function* () {
          const parent = yield* createActor(lifecycleMachine(), { systemId: "outer" })
          const child = yield* createActor(idleLogic(), { parent: parent.ref, systemId: "inner" })
          yield* parent.start
          yield* child.start
          assert.isTrue(yield* finds(parent.system, "outer", parent))
          assert.isTrue(yield* finds(parent.system, "inner", child))
          return parent.system
        })
      )

      assert.isTrue(Option.isNone(yield* system.get("outer")))
      assert.isTrue(Option.isNone(yield* system.get("inner")))
      assert.deepStrictEqual(yield* keysOf(system), [])
    })
  )

  it.effect("[C20] registrations and ends racing from several fibers leave a consistent registry", () =>
    Effect.gen(function* () {
      const root = yield* createActor(lifecycleMachine(), { systemId: "root" })
      yield* root.start
      const ids = Array.from({ length: 20 }, (_, i) => (i < 10 ? "contested" : `w${i}`))

      const exits = yield* Effect.forEach(
        ids,
        (systemId) => Effect.exit(createActor(lifecycleMachine(), { parent: root.ref, systemId })),
        { concurrency: "unbounded" }
      )

      const contested = exits.slice(0, 10)
      const winners = contested.flatMap((exit) => (Exit.isSuccess(exit) ? [exit.value] : []))
      assert.strictEqual(winners.length, 1)
      for (const exit of contested) {
        if (Exit.isFailure(exit)) {
          assert.deepStrictEqual(failureMessage(exit), Option.some(duplicateSystemId("contested")))
        }
      }
      const created = exits.slice(10).flatMap((exit) => (Exit.isSuccess(exit) ? [exit.value] : []))
      assert.strictEqual(created.length, 10)
      const winner = winners[0]!
      assert.isTrue(yield* finds(root.system, "contested", winner))

      // The winner and half of the workers reach their final state at the same time, each in
      // its own fiber (a non-root actor cannot be stopped directly; its end unregisters it)
      const ended = [winner, ...created.slice(0, 5)]
      yield* Effect.forEach(ended, (actor) => Effect.andThen(actor.start, actor.send({ type: "FINISH" })), {
        concurrency: "unbounded",
        discard: true,
      })
      yield* Effect.forEach(ended, (actor) => untilStatus(actor, "done"), { discard: true })

      const all = yield* root.system.getAll
      assert.deepStrictEqual(Object.keys(all).sort(), ["root", "w15", "w16", "w17", "w18", "w19"])
      for (const actor of created.slice(5)) {
        assert.strictEqual(all[actor.systemId ?? ""], actor)
      }
      assert.isTrue(Option.isNone(yield* root.system.get("contested")))
    })
  )

  it.effect("[C20] system.get and system.getAll run synchronously under Effect.runSync", () =>
    Effect.gen(function* () {
      const root = yield* createActor(lifecycleMachine(), { systemId: "root" })
      const worker = yield* createActor(idleLogic(), { parent: root.ref, systemId: "worker" })

      const found = Effect.runSync(root.system.get("worker"))
      const all = Effect.runSync(root.system.getAll)

      assert.isTrue(Option.isSome(found) && found.value === worker)
      assert.isTrue(Option.isNone(Effect.runSync(root.system.get("nobody"))))
      assert.deepStrictEqual(Object.keys(all), ["root", "worker"])
    })
  )

  it.effect("[C20] the synchronous internal lookup reads the same registry as system.get", () =>
    Effect.gen(function* () {
      const root = yield* createActor(lifecycleMachine(), { systemId: "root" })
      const worker = yield* createActor(idleLogic(), { parent: root.ref, systemId: "worker" })
      yield* root.start
      yield* worker.start

      const lookup = root.system._lookup("worker")
      assert.isTrue(Option.isSome(lookup) && lookup.value === worker)
      assert.isTrue(Option.isNone(root.system._lookup("nobody")))
      assert.isTrue(Option.isNone(root.system._lookup(worker.sessionId)))

      // Its parent stops it (a non-root actor cannot be stopped directly)
      yield* root.send({ type: "STOP_WORKER" })
      assert.isTrue(Option.isNone(root.system._lookup("worker")))
    })
  )
})
