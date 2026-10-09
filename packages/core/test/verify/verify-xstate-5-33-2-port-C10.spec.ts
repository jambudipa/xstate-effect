/**
 * C10: an effect actor starts without blocking and is interrupted on stop.
 *
 * T2.52. `fromEffect` is a port extra: no upstream test covers it, and eque2
 * `src/invoke/fromEffect.ts` is the behaviour reference (`research/eque2-reference.md` §5): the
 * Effect runs in a fiber of its own, a success gives `xstate.done.actor` with the output, a typed
 * failure gives `xstate.error.actor` with the failure, a defect gives it with the squashed defect,
 * and an interruption gives nothing.
 *
 * The port makes `fromEffect` real actor logic (D12): reading the initial snapshot runs nothing;
 * `start` forks the creator's Effect into the actor's own scope and returns while it runs; the
 * result reaches the snapshot through the actor's own processing, so the parent receives the
 * done or error event; a stop interrupts the Effect, so its finalizers run, and no done event is
 * sent. `output` and `error` are Options and an `undefined` output is `None` (D8, SD-7); errors
 * are the raw values (SD-4). Phase-2 children are spawned (SD-15), so a parent reads its child's
 * done and error events with `on` handlers.
 */
import { assert, describe, it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Option } from "effect"
import type { ActorRefBase } from "../../src/ActorRef.js"
import {
  type ActorType,
  type AnyActorLogic,
  assign,
  createActor,
  createMachine,
  type EventObject,
  fromEffect,
  getInitialSnapshot,
  isActor,
  spawnChild,
  stopChild,
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

/**
 * Creates and starts an actor in a fiber of its own, and gives the actor once both have
 * returned. A `createActor` or `start` that waits for the Effect fails the test at once
 * instead of hanging it.
 */
const startedWithin = <A extends { readonly start: Effect.Effect<void> }, R>(create: Effect.Effect<A, never, R>) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(Effect.tap(create, (actor) => actor.start), { startImmediately: true })
    yield* eventually(Effect.sync(() => fiber.pollUnsafe() !== undefined))
    assert.isDefined(fiber.pollUnsafe(), "createActor and start return while the effect runs")
    return yield* Fiber.join(fiber)
  })

/** The child actor behind a reference; fails the test when the reference is not an actor. */
const asActor = (ref: ActorRefBase | undefined): ActorType.Any => {
  assert.isTrue(isActor(ref), "the reference is an actor")
  return ref as ActorType.Any
}

/** The status the actor's snapshot has now. */
const statusOf = (actor: Pick<ActorType.Any, "getSnapshot">) => Effect.map(actor.getSnapshot, (snapshot) => snapshot.status)

interface Received {
  readonly received: ReadonlyArray<unknown>
}

/** Keeps every event the parent takes, in order. */
const record = assign<Received, EventObject>(({ context, event }) => ({ received: [...context.received, event] }))

/** A parent that spawns `child` as `e`, keeps the child's done and error events, and stops it on STOP. */
const parentOf = <TLogic extends AnyActorLogic>(child: TLogic) =>
  createMachine<Received, EventObject>({
    id: "c10-parent",
    context: { received: [] },
    entry: spawnChild<Received, EventObject, TLogic>(child, { id: "e" }),
    on: {
      STOP: { actions: stopChild<Received, EventObject>("e") },
      "xstate.done.actor.e": { actions: record },
      "xstate.error.actor.e": { actions: record },
    },
  })

/** An actor of a parent from `parentOf`, as the helpers read it. */
interface ParentActor {
  readonly getSnapshot: Effect.Effect<{
    readonly context: Received
    readonly children: Readonly<Record<string, ActorRefBase>>
  }>
}

/** The child `e` of a parent actor. */
const childOf = (actor: ParentActor) => Effect.map(actor.getSnapshot, (snapshot) => asActor(snapshot.children["e"]))

/** The events a parent from `parentOf` has kept. */
const receivedBy = (actor: ParentActor) => Effect.map(actor.getSnapshot, (snapshot) => snapshot.context.received)

/** What the finalizers of an Effect saw: an interruption, and the end of the Effect. */
interface Finalized {
  interrupted: number
  ended: number
}

/** Waits for `gate`, and counts the interruption and the end of the wait in `finalized`. */
const waitFor = <A>(gate: Deferred.Deferred<A>, finalized: Finalized) =>
  Deferred.await(gate).pipe(
    Effect.onInterrupt(() =>
      Effect.sync(() => {
        finalized.interrupted++
      })
    ),
    Effect.ensuring(
      Effect.sync(() => {
        finalized.ended++
      })
    )
  )

describe("C10 An effect actor starts without blocking and is interrupted on stop", () => {
  it.effect("[C10] start returns while a long effect runs; the snapshot reads active, then done with output Some(value) through the internal xstate.effect.success event", () =>
    Effect.gen(function* () {
      const gate = yield* Deferred.make<number>()
      let runs = 0
      const logic = fromEffect(() => {
        runs++
        return Deferred.await(gate)
      })

      const actor = yield* startedWithin(createActor(logic))
      const relayed: Array<{ readonly fromSelf: boolean; readonly event: unknown }> = []
      yield* actor.system.inspect((inspection) =>
        Effect.sync(() => {
          if (inspection.type === "@xstate.event" && inspection.actorRef === actor) {
            relayed.push({ fromSelf: Option.exists(inspection.sourceRef, (source) => source === actor), event: inspection.event })
          }
        })
      )

      // The creator ran at start, and the actor waits for its Effect
      assert.strictEqual(runs, 1)
      yield* settle
      assert.strictEqual(yield* statusOf(actor), "active")

      yield* Deferred.succeed(gate, 42)
      assert.isTrue(yield* eventually(Effect.map(statusOf(actor), (status) => status === "done")), "the actor is done")

      const done = yield* actor.getSnapshot
      assert.deepStrictEqual(done.output, Option.some(42))
      assert.deepStrictEqual(done.error, Option.none())
      assert.deepStrictEqual(
        relayed.filter((entry) => entry.fromSelf).map((entry) => entry.event),
        [{ type: "xstate.effect.success", data: 42 }]
      )
      assert.strictEqual(runs, 1)
    })
  )

  it.effect("[C10] a spawned effect child that succeeds is done, and the parent receives xstate.done.actor.<id> with output Some(value)", () =>
    Effect.gen(function* () {
      const gate = yield* Deferred.make<string>()
      const actor = yield* startedWithin(createActor(parentOf(fromEffect(() => Deferred.await(gate)))))
      const child = yield* childOf(actor)
      yield* settle
      assert.strictEqual(yield* statusOf(child), "active")
      assert.deepStrictEqual(yield* receivedBy(actor), [])

      yield* Deferred.succeed(gate, "fetched")
      assert.isTrue(yield* eventually(Effect.map(receivedBy(actor), (received) => received.length > 0)), "the parent hears of it")

      assert.deepStrictEqual(yield* receivedBy(actor), [{ type: "xstate.done.actor.e", output: Option.some("fetched"), actorId: "e" }])
      assert.strictEqual(yield* statusOf(child), "done")
      assert.strictEqual(yield* statusOf(actor), "active")
    })
  )

  it.effect("[C10] stopping an effect actor interrupts the effect, runs its finalizers once and sets status stopped; the effect's later result changes nothing", () =>
    Effect.gen(function* () {
      const gate = yield* Deferred.make<number>()
      const finalized: Finalized = { interrupted: 0, ended: 0 }
      const actor = yield* startedWithin(createActor(fromEffect(() => waitFor(gate, finalized))))
      yield* settle
      assert.deepStrictEqual(finalized, { interrupted: 0, ended: 0 })

      yield* actor.stop
      assert.strictEqual(yield* statusOf(actor), "stopped")
      assert.deepStrictEqual(finalized, { interrupted: 1, ended: 1 })

      yield* Deferred.succeed(gate, 42)
      yield* settle
      const after = yield* actor.getSnapshot
      assert.strictEqual(after.status, "stopped")
      assert.deepStrictEqual(after.output, Option.none())
      assert.deepStrictEqual(finalized, { interrupted: 1, ended: 1 })
    })
  )

  it.effect("[C10] a parent that stops its effect child interrupts the child's effect and runs its finalizers, and no done event reaches the parent", () =>
    Effect.gen(function* () {
      const gate = yield* Deferred.make<number>()
      const finalized: Finalized = { interrupted: 0, ended: 0 }
      const actor = yield* startedWithin(createActor(parentOf(fromEffect(() => waitFor(gate, finalized)))))
      const child = yield* childOf(actor)
      yield* settle
      assert.strictEqual(yield* statusOf(child), "active")

      yield* actor.send({ type: "STOP" })
      assert.isTrue(yield* eventually(Effect.map(statusOf(child), (status) => status === "stopped")), "the child stops")
      assert.deepStrictEqual(finalized, { interrupted: 1, ended: 1 })

      yield* Deferred.succeed(gate, 42)
      yield* settle
      assert.strictEqual(yield* statusOf(child), "stopped")
      assert.deepStrictEqual(yield* receivedBy(actor), [])
      assert.strictEqual(yield* statusOf(actor), "active")
    })
  )

  it.effect("[C10] a typed failure gives status error with the raw failure, and the parent receives xstate.error.actor.<id>", () =>
    Effect.gen(function* () {
      const failure = { reason: "the effect failed" }
      const gate = yield* Deferred.make<void>()
      const actor = yield* startedWithin(
        createActor(parentOf(fromEffect(() => Effect.flatMap(Deferred.await(gate), () => Effect.fail(failure)))))
      )
      const child = yield* childOf(actor)
      yield* settle
      assert.strictEqual(yield* statusOf(child), "active")

      yield* Deferred.succeed(gate, undefined)
      assert.isTrue(yield* eventually(Effect.map(receivedBy(actor), (received) => received.length > 0)), "the parent hears of it")

      const childSnapshot = yield* child.getSnapshot
      assert.strictEqual(childSnapshot.status, "error")
      assert.strictEqual(Option.getOrUndefined(childSnapshot.error), failure)
      assert.deepStrictEqual(yield* receivedBy(actor), [{ type: "xstate.error.actor.e", error: failure, actorId: "e" }])
      assert.strictEqual(yield* statusOf(actor), "active")
    })
  )

  it.effect("[C10] a defect inside the effect gives status error with the raw defect, and the parent receives xstate.error.actor.<id>", () =>
    Effect.gen(function* () {
      const defect = new Error("the effect died")
      const gate = yield* Deferred.make<void>()
      const actor = yield* startedWithin(
        createActor(parentOf(fromEffect(() => Effect.flatMap(Deferred.await(gate), () => Effect.die(defect)))))
      )
      const child = yield* childOf(actor)
      yield* settle
      assert.strictEqual(yield* statusOf(child), "active")

      yield* Deferred.succeed(gate, undefined)
      assert.isTrue(yield* eventually(Effect.map(receivedBy(actor), (received) => received.length > 0)), "the parent hears of it")

      const childSnapshot = yield* child.getSnapshot
      assert.strictEqual(childSnapshot.status, "error")
      assert.strictEqual(Option.getOrUndefined(childSnapshot.error), defect)
      assert.deepStrictEqual(yield* receivedBy(actor), [{ type: "xstate.error.actor.e", error: defect, actorId: "e" }])
      assert.strictEqual(yield* statusOf(actor), "active")
    })
  )

  it.effect("[C10] a throw in the creator gives status error with the thrown value, and the parent receives xstate.error.actor.<id>", () =>
    Effect.gen(function* () {
      const thrown = { reason: "thrown in the creator" }
      const actor = yield* startedWithin(
        createActor(
          parentOf(
            fromEffect((): Effect.Effect<number> => {
              throw thrown
            })
          )
        )
      )
      const child = yield* childOf(actor)
      assert.isTrue(yield* eventually(Effect.map(receivedBy(actor), (received) => received.length > 0)), "the parent hears of it")

      const childSnapshot = yield* child.getSnapshot
      assert.strictEqual(childSnapshot.status, "error")
      assert.strictEqual(Option.getOrUndefined(childSnapshot.error), thrown)
      assert.deepStrictEqual(yield* receivedBy(actor), [{ type: "xstate.error.actor.e", error: thrown, actorId: "e" }])
    })
  )

  it.effect("[C10] reading the initial snapshot runs nothing: createActor and getInitialSnapshot give status active with the input", () =>
    Effect.gen(function* () {
      let runs = 0
      const logic = fromEffect(({ input }: { readonly input: number }) =>
        Effect.sync(() => {
          runs++
          return input
        })
      )

      const actor = yield* createActor(logic, { input: 7 })
      const snapshot = yield* actor.getSnapshot
      const initial = yield* getInitialSnapshot(logic, 7)
      yield* settle

      assert.strictEqual(runs, 0)
      assert.strictEqual(snapshot.status, "active")
      assert.strictEqual(snapshot.input, 7)
      assert.deepStrictEqual(snapshot.output, Option.none())
      assert.strictEqual(initial.status, "active")
      assert.strictEqual(initial.input, 7)
      assert.deepStrictEqual(initial.output, Option.none())
    })
  )

  it.effect("[C10] the creator receives { input, system, self, emit }, and each emit reaches the actor's listeners in order before the actor is done", () =>
    Effect.gen(function* () {
      const seen: Array<{ readonly keys: ReadonlyArray<string>; readonly input: unknown; readonly self: unknown; readonly system: unknown }> = []
      const logic = fromEffect(
        (args: {
          readonly input: { readonly n: number }
          readonly self: unknown
          readonly system: unknown
          readonly emit: (event: { readonly type: "c10.progress"; readonly n: number }) => Effect.Effect<void>
        }) =>
          Effect.gen(function* () {
            seen.push({ keys: [...Object.keys(args)].sort(), input: args.input, self: args.self, system: args.system })
            yield* args.emit({ type: "c10.progress", n: 1 })
            yield* args.emit({ type: "c10.progress", n: args.input.n })
            return args.input.n * 10
          })
      )
      const input = { n: 2 }
      const actor = yield* createActor(logic, { input })
      const emitted: Array<{ readonly event: unknown; readonly status: string }> = []
      yield* actor.on("*", (event) =>
        Effect.map(actor.getSnapshot, (snapshot) => {
          emitted.push({ event, status: snapshot.status })
        })
      )
      yield* actor.start
      assert.isTrue(yield* eventually(Effect.map(statusOf(actor), (status) => status === "done")), "the actor is done")

      assert.strictEqual(seen.length, 1)
      assert.deepStrictEqual(seen[0]?.keys, ["emit", "input", "self", "system"])
      assert.strictEqual(seen[0]?.input, input)
      assert.strictEqual(seen[0]?.self, actor)
      assert.strictEqual(seen[0]?.system, actor.system)
      assert.deepStrictEqual(emitted, [
        { event: { type: "c10.progress", n: 1 }, status: "active" },
        { event: { type: "c10.progress", n: 2 }, status: "active" },
      ])
      assert.deepStrictEqual((yield* actor.getSnapshot).output, Option.some(20))
    })
  )

  it.effect("[C10] an effect that succeeds with undefined gives output None, live and after a persisted-snapshot round trip, and the restored done actor does not run the effect again", () =>
    Effect.gen(function* () {
      let runs = 0
      const logic = fromEffect(() =>
        Effect.sync(() => {
          runs++
          return undefined
        })
      )
      const actor = yield* createActor(logic)
      yield* actor.start
      assert.isTrue(yield* eventually(Effect.map(statusOf(actor), (status) => status === "done")), "the actor is done")
      assert.deepStrictEqual((yield* actor.getSnapshot).output, Option.none())

      const persisted = yield* actor.getPersistedSnapshot
      const restored = yield* createActor(logic, { snapshot: persisted })
      yield* restored.start
      yield* settle

      const snapshot = yield* restored.getSnapshot
      assert.strictEqual(snapshot.status, "done")
      assert.deepStrictEqual(snapshot.output, Option.none())
      assert.strictEqual(runs, 1)
    })
  )
})
