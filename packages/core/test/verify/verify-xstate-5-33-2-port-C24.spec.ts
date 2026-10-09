/**
 * C24: fromEffectBackground and fromEffectRetry follow the actor lifecycle.
 *
 * T2.52. Both are port extras with no upstream test. `fromEffectBackground` runs its Effect as a
 * side job of the actor: it gets the actor's input, the actor stays `active` when the Effect
 * returns (it never completes by itself), and a failure or a defect of the Effect gives status
 * `error` (SD-4). `fromEffectRetry` is `fromEffect` with `Effect.retry(schedule)`: each failed
 * attempt is retried while the schedule allows, the first success gives `done` with
 * `Some(output)`, and the last failure gives `error`. Both run in a fiber of the actor's own
 * scope (D12, no `forkDetach`), so `start` returns while they run, and a stop interrupts them
 * and runs their finalizers. The retry delays run on the test clock (`TestClock`).
 */
import { assert, describe, it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Option, Schedule } from "effect"
import { TestClock } from "effect/testing"
import type { ActorLogic } from "../../src/ActorLogic.js"
import type { ActorRefBase } from "../../src/ActorRef.js"
import {
  type ActorType,
  type AnyActorLogic,
  assign,
  createActor,
  createMachine,
  type EventObject,
  fromEffectBackground,
  isActor,
  spawnChild,
  stopChild,
} from "../../src/index.js"
import { fromEffectRetry } from "../../src/actors/fromEffect.js"

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

/** A parent that spawns `child` as `job`, keeps the child's done and error events, and stops it on STOP. */
const parentOf = <TLogic extends AnyActorLogic>(child: TLogic, input: ActorLogic.InputOf<TLogic>) =>
  createMachine<Received, EventObject>({
    id: "c24-parent",
    context: { received: [] },
    entry: spawnChild<Received, EventObject, TLogic>(child, { id: "job", input }),
    on: {
      STOP: { actions: stopChild<Received, EventObject>("job") },
      "xstate.done.actor.job": { actions: record },
      "xstate.error.actor.job": { actions: record },
    },
  })

/** An actor of a parent from `parentOf`, as the helpers read it. */
interface ParentActor {
  readonly getSnapshot: Effect.Effect<{
    readonly context: Received
    readonly children: Readonly<Record<string, ActorRefBase>>
  }>
}

/** The child `job` of a parent actor. */
const childOf = (actor: ParentActor) => Effect.map(actor.getSnapshot, (snapshot) => asActor(snapshot.children["job"]))

/** The events a parent from `parentOf` has kept. */
const receivedBy = (actor: ParentActor) => Effect.map(actor.getSnapshot, (snapshot) => snapshot.context.received)

/** What the finalizers of an Effect saw: an interruption, and the end of the Effect. */
interface Finalized {
  interrupted: number
  ended: number
}

/** Runs forever, and counts the interruption and the end in `finalized`. */
const forever = (finalized: Finalized) =>
  Effect.never.pipe(
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

/** At most two retries, one second apart. */
const twoRetries = Schedule.recurs(2).pipe(Schedule.addDelay(() => Effect.succeed("1 second")))

describe("C24 fromEffectBackground and fromEffectRetry follow the actor lifecycle", () => {
  it.effect("[C24] fromEffectBackground: start returns while status is active, and the effect receives the actor's input", () =>
    Effect.gen(function* () {
      const inputs: Array<unknown> = []
      const finalized: Finalized = { interrupted: 0, ended: 0 }
      const logic = fromEffectBackground(({ input }: { readonly input: { readonly feed: string } }) =>
        Effect.flatMap(
          Effect.sync(() => {
            inputs.push(input)
          }),
          () => forever(finalized)
        )
      )
      const input = { feed: "prices" }

      const actor = yield* startedWithin(createActor(logic, { input }))
      yield* settle

      assert.deepStrictEqual(inputs, [input])
      assert.strictEqual(inputs[0], input)
      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.status, "active")
      assert.strictEqual(snapshot.input, input)
      assert.deepStrictEqual(finalized, { interrupted: 0, ended: 0 })
    })
  )

  it.effect("[C24] fromEffectBackground: stop interrupts the effect and runs its finalizers once; the actor is stopped", () =>
    Effect.gen(function* () {
      const finalized: Finalized = { interrupted: 0, ended: 0 }
      const actor = yield* startedWithin(createActor(fromEffectBackground(() => forever(finalized))))
      yield* settle
      assert.strictEqual(yield* statusOf(actor), "active")

      yield* actor.stop
      assert.strictEqual(yield* statusOf(actor), "stopped")
      assert.deepStrictEqual(finalized, { interrupted: 1, ended: 1 })
      yield* settle
      assert.deepStrictEqual(finalized, { interrupted: 1, ended: 1 })
    })
  )

  it.effect("[C24] fromEffectBackground: a parent that stops its background child interrupts the child's effect and runs its finalizers", () =>
    Effect.gen(function* () {
      const finalized: Finalized = { interrupted: 0, ended: 0 }
      const actor = yield* startedWithin(createActor(parentOf(fromEffectBackground(() => forever(finalized)), undefined)))
      const child = yield* childOf(actor)
      yield* settle
      assert.strictEqual(yield* statusOf(child), "active")

      yield* actor.send({ type: "STOP" })
      assert.isTrue(yield* eventually(Effect.map(statusOf(child), (status) => status === "stopped")), "the child stops")
      assert.deepStrictEqual(finalized, { interrupted: 1, ended: 1 })
      assert.deepStrictEqual(yield* receivedBy(actor), [])
    })
  )

  it.effect("[C24] fromEffectBackground never completes by itself: the actor stays active when its effect returns", () =>
    Effect.gen(function* () {
      const gate = yield* Deferred.make<number>()
      const actor = yield* startedWithin(createActor(parentOf(fromEffectBackground(() => Deferred.await(gate)), undefined)))
      const child = yield* childOf(actor)

      yield* Deferred.succeed(gate, 1)
      yield* settle
      yield* settle

      assert.strictEqual(yield* statusOf(child), "active")
      assert.deepStrictEqual((yield* child.getSnapshot).output, Option.none())
      assert.deepStrictEqual(yield* receivedBy(actor), [])
    })
  )

  it.effect("[C24] fromEffectBackground: a failure of its effect gives status error with the raw failure, and the parent receives xstate.error.actor.<id>", () =>
    Effect.gen(function* () {
      const failure = { reason: "the feed broke" }
      const gate = yield* Deferred.make<void>()
      const actor = yield* startedWithin(
        createActor(parentOf(fromEffectBackground(() => Effect.flatMap(Deferred.await(gate), () => Effect.fail(failure))), undefined))
      )
      const child = yield* childOf(actor)
      yield* settle
      assert.strictEqual(yield* statusOf(child), "active")

      yield* Deferred.succeed(gate, undefined)
      assert.isTrue(yield* eventually(Effect.map(receivedBy(actor), (received) => received.length > 0)), "the parent hears of it")

      const childSnapshot = yield* child.getSnapshot
      assert.strictEqual(childSnapshot.status, "error")
      assert.strictEqual(Option.getOrUndefined(childSnapshot.error), failure)
      assert.deepStrictEqual(yield* receivedBy(actor), [{ type: "xstate.error.actor.job", error: failure, actorId: "job" }])
    })
  )

  it.effect("[C24] fromEffectRetry with a two-retry schedule: start returns while status is active, the effect receives its input, and the actor is done with Some of the output as the test clock advances through the retries", () =>
    Effect.gen(function* () {
      const attempts: Array<unknown> = []
      const logic = fromEffectRetry(
        ({ input }: { readonly input: { readonly base: number } }) =>
          Effect.suspend(() => {
            attempts.push(input)
            return attempts.length < 3 ? Effect.fail(`attempt ${attempts.length} failed`) : Effect.succeed(input.base * 2)
          }),
        twoRetries
      )
      const input = { base: 21 }
      const actor = yield* startedWithin(createActor(parentOf(logic, input)))
      const child = yield* childOf(actor)
      yield* settle

      // The first attempt ran at start and failed; the retry waits for the clock
      assert.strictEqual(attempts.length, 1)
      assert.strictEqual(attempts[0], input)
      assert.strictEqual(yield* statusOf(child), "active")

      yield* TestClock.adjust("1 second")
      assert.isTrue(yield* eventually(Effect.sync(() => attempts.length === 2)), "the first retry runs")
      yield* settle
      assert.strictEqual(yield* statusOf(child), "active")

      yield* TestClock.adjust("1 second")
      assert.isTrue(yield* eventually(Effect.map(receivedBy(actor), (received) => received.length > 0)), "the parent hears of it")

      assert.strictEqual(attempts.length, 3)
      assert.strictEqual(yield* statusOf(child), "done")
      assert.deepStrictEqual((yield* child.getSnapshot).output, Option.some(42))
      assert.deepStrictEqual(yield* receivedBy(actor), [{ type: "xstate.done.actor.job", output: Option.some(42), actorId: "job" }])
    })
  )

  it.effect("[C24] fromEffectRetry keeps its retry semantics: when the schedule ends, the last failure gives status error and the parent receives xstate.error.actor.<id>", () =>
    Effect.gen(function* () {
      let attempts = 0
      const logic = fromEffectRetry(
        () =>
          Effect.suspend(() => {
            attempts++
            return Effect.fail({ attempt: attempts })
          }),
        twoRetries
      )
      const actor = yield* startedWithin(createActor(parentOf(logic, undefined)))
      const child = yield* childOf(actor)

      yield* TestClock.adjust("1 second")
      yield* settle
      yield* TestClock.adjust("1 second")
      assert.isTrue(yield* eventually(Effect.map(receivedBy(actor), (received) => received.length > 0)), "the parent hears of it")

      assert.strictEqual(attempts, 3)
      const childSnapshot = yield* child.getSnapshot
      assert.strictEqual(childSnapshot.status, "error")
      assert.deepStrictEqual(Option.getOrUndefined(childSnapshot.error), { attempt: 3 })
      assert.deepStrictEqual(yield* receivedBy(actor), [{ type: "xstate.error.actor.job", error: { attempt: 3 }, actorId: "job" }])
    })
  )

  it.effect("[C24] fromEffectRetry: stop interrupts the running attempt and runs its finalizers once; no done event reaches the parent", () =>
    Effect.gen(function* () {
      let attempts = 0
      const finalized: Finalized = { interrupted: 0, ended: 0 }
      const logic = fromEffectRetry(
        () =>
          Effect.suspend(() => {
            attempts++
            return attempts < 2 ? Effect.fail("first attempt failed") : forever(finalized)
          }),
        twoRetries
      )
      const actor = yield* startedWithin(createActor(parentOf(logic, undefined)))
      const child = yield* childOf(actor)

      yield* TestClock.adjust("1 second")
      assert.isTrue(yield* eventually(Effect.sync(() => attempts === 2)), "the retry runs")
      yield* settle
      assert.deepStrictEqual(finalized, { interrupted: 0, ended: 0 })

      yield* actor.send({ type: "STOP" })
      assert.isTrue(yield* eventually(Effect.map(statusOf(child), (status) => status === "stopped")), "the child stops")
      assert.deepStrictEqual(finalized, { interrupted: 1, ended: 1 })

      yield* TestClock.adjust("10 seconds")
      yield* settle
      assert.strictEqual(attempts, 2)
      assert.deepStrictEqual(yield* receivedBy(actor), [])
    })
  )

  it.effect("[C24] fromEffectRetry: a stop while the retry waits for the clock ends the actor, and no later attempt runs", () =>
    Effect.gen(function* () {
      let attempts = 0
      const logic = fromEffectRetry(
        () =>
          Effect.suspend(() => {
            attempts++
            return Effect.fail("always fails")
          }),
        twoRetries
      )
      const actor = yield* startedWithin(createActor(logic))
      yield* settle
      assert.strictEqual(attempts, 1)

      yield* actor.stop
      assert.strictEqual(yield* statusOf(actor), "stopped")
      yield* TestClock.adjust("10 seconds")
      yield* settle
      assert.strictEqual(attempts, 1)
      assert.strictEqual(yield* statusOf(actor), "stopped")
    })
  )
})
