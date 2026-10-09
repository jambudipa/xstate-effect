/**
 * S21: maxIterations stops an infinite microstep loop with an error.
 *
 * T2.36. Upstream `macrostep` in `src/stateUtils.ts` and `StateMachine.getInitialSnapshot`
 * in `src/StateMachine.ts` at xstate@5.33.2: `createMachine({ options: { maxIterations } })`
 * (default `Infinity`) bounds the loop of a macrostep. Each loop iteration counts, the one
 * that only finds the macrostep stable included, so a macrostep with k loop microsteps
 * needs k + 1 <= maxIterations; the initial microstep and the first microstep for an event
 * are not counted. Past the limit the macrostep fails with the upstream infinite-loop
 * message: at start the actor's snapshot gets status `error` (start itself succeeds), and
 * for an event the actor keeps its pre-event snapshot with status `error`.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Exit, Option, Stream, SubscriptionRef } from "effect"
import {
  type ActorLogicType,
  ActorScope,
  type ActorType,
  createActor,
  createMachine,
  type EventObject,
  getInitialSnapshot,
  type MachineSnapshot,
  raise,
  type SnapshotType,
} from "../../src/index.js"
import { createInertActorScope } from "../../src/testing/index.js"
import { infiniteLoop } from "./upstream-messages.js"

/** The initial snapshot through `getInitialSnapshot`, widened until T2.40 (as S2 and S3 do). */
const initialSnapshotOf = (machine: object): Effect.Effect<MachineSnapshot> =>
  getInitialSnapshot(machine as ActorLogicType.Any, undefined) as unknown as Effect.Effect<MachineSnapshot>

/** The machine logic as the engine entry points type it, widened until T2.40. */
interface MachineLogic {
  readonly transition: (snapshot: MachineSnapshot, event: EventObject) => Effect.Effect<MachineSnapshot, Error, ActorScope>
  readonly options: { readonly maxIterations?: number }
}

/** One macrostep through `machine.transition` with an inert actor scope; fails as the machine fails. */
const transitionOf = (machine: object, snapshot: MachineSnapshot, event: EventObject) =>
  (machine as MachineLogic).transition(snapshot, event).pipe(Effect.provideService(ActorScope, createInertActorScope(snapshot)))

/** An actor of `logic` with the given id, not started. */
const actorOf = <S extends SnapshotType, E extends EventObject, Em extends EventObject, R>(
  logic: ActorLogicType<S, E, unknown, Em, R>,
  id: string
) => createActor(logic, { id })

/** The actor's current snapshot. */
const currentOf = <S extends SnapshotType>(actor: Pick<ActorType<S, EventObject>, "snapshot">) =>
  SubscriptionRef.get(actor.snapshot)

/** More published snapshots than any macrostep here needs: a wrong engine stops waiting here. */
const PUBLICATION_BOUND = 25

/**
 * Waits until the actor's snapshot is no longer active, or until `PUBLICATION_BOUND`
 * snapshots went by, and returns the current snapshot. A `changes` stream that fails with
 * the actor's error (SD-4) also ends the wait.
 */
const settled = <S extends SnapshotType>(actor: Pick<ActorType<S, EventObject>, "changes" | "snapshot">) =>
  actor.changes.pipe(
    Stream.take(PUBLICATION_BOUND),
    Stream.filter((snapshot) => snapshot.status !== "active"),
    Stream.runHead,
    Effect.exit,
    Effect.andThen(currentOf(actor))
  )

/** The message of the snapshot's error, if it has one. */
const errorMessageOf = (snapshot: SnapshotType): Option.Option<string> =>
  Option.flatMap(snapshot.error, (error) =>
    error instanceof Error ? Option.some(error.message) : Option.none()
  )

const valueOf = (snapshot: object): unknown => ("value" in snapshot ? snapshot.value : undefined)

/** `a -> b -> c -> a` through `always`, with the given options. */
const alwaysCycle = (options: { readonly maxIterations?: number }) =>
  createMachine<object, EventObject>({
    id: "s21-cycle",
    initial: "a",
    context: {},
    options,
    states: {
      a: { always: "b" },
      b: { always: "c" },
      c: { always: "a" },
    },
  })

/**
 * Stable at `idle`. `TWO` goes to `x1`, then two `always` links reach `x3`; `THREE` goes to
 * `y1`, then three links reach `y4`; `ONE` goes to `z1`, then one link reaches `z2`; `GO`
 * goes to `stable`, which has no eventless transition.
 */
const chainMachine = (maxIterations: number) =>
  createMachine<object, EventObject>({
    id: "s21-chain",
    initial: "idle",
    context: {},
    options: { maxIterations },
    states: {
      idle: { on: { ONE: "z1", TWO: "x1", THREE: "y1", GO: "stable" } },
      stable: {},
      z1: { always: "z2" },
      z2: {},
      x1: { always: "x2" },
      x2: { always: "x3" },
      x3: {},
      y1: { always: "y2" },
      y2: { always: "y3" },
      y3: { always: "y4" },
      y4: {},
    },
  })

describe("S21 maxIterations stops an infinite microstep loop with an error", () => {
  it.effect("[S21] a cycle of always transitions with maxIterations 10 ends start with status error and the recorded message", () =>
    Effect.gen(function* () {
      const machine = alwaysCycle({ maxIterations: 10 })
      const actor = yield* actorOf(machine, "s21-cycle")

      const started = yield* Effect.exit(actor.start)
      assert.isTrue(Exit.isSuccess(started))
      const snapshot = yield* currentOf(actor)
      assert.strictEqual(snapshot.status, "error")
      assert.deepStrictEqual(errorMessageOf(snapshot), Option.some(infiniteLoop(10)))

      // The pure initial snapshot errors the same way (upstream getInitialSnapshot)
      const initial = yield* initialSnapshotOf(machine)
      assert.strictEqual(initial.status, "error")
      assert.deepStrictEqual(errorMessageOf(initial), Option.some(infiniteLoop(10)))
    })
  )

  it.effect("[S21] a raise cycle started by a later event errors with the recorded message and the pre-event state value", () =>
    Effect.gen(function* () {
      const machine = createMachine<object, EventObject>({
        id: "s21-ping",
        initial: "idle",
        context: {},
        options: { maxIterations: 3 },
        states: {
          idle: { on: { PING: "ping" } },
          ping: { entry: raise<object, EventObject>({ type: "PONG" }), on: { PONG: "pong" } },
          pong: { entry: raise<object, EventObject>({ type: "PING" }), on: { PING: "ping" } },
        },
      })
      const actor = yield* actorOf(machine, "s21-ping")
      yield* actor.start
      const before = yield* currentOf(actor)
      assert.strictEqual(before.status, "active")
      assert.strictEqual(valueOf(before), "idle")

      yield* actor.send({ type: "PING" })
      const after = yield* settled(actor)
      assert.strictEqual(after.status, "error")
      assert.strictEqual(valueOf(after), "idle")
      assert.deepStrictEqual(errorMessageOf(after), Option.some(infiniteLoop(3)))
    })
  )

  it.effect("[S21] the counter includes the terminating iteration: 2 loop microsteps pass and 3 fail with maxIterations 3", () =>
    Effect.gen(function* () {
      const machine = chainMachine(3)
      const initial = yield* initialSnapshotOf(machine)
      assert.strictEqual(initial.value, "idle")

      const two = yield* transitionOf(machine, initial, { type: "TWO" })
      assert.strictEqual(two.value, "x3")
      assert.strictEqual(two.status, "active")

      const three = yield* Effect.exit(transitionOf(machine, initial, { type: "THREE" }))
      assert.isTrue(Exit.isFailure(three))
      const failure = Exit.findErrorOption(three)
      assert.deepStrictEqual(
        Option.map(failure, (error) => error.message),
        Option.some(infiniteLoop(3))
      )
    })
  )

  it.effect("[S21] the initial microstep and an event's first microstep are not counted", () =>
    Effect.gen(function* () {
      const machine = chainMachine(1)
      const initial = yield* initialSnapshotOf(machine)
      assert.strictEqual(initial.status, "active")
      assert.strictEqual(initial.value, "idle")

      // GO takes one microstep and the loop only finds the snapshot stable: 1 iteration
      const go = yield* transitionOf(machine, initial, { type: "GO" })
      assert.strictEqual(go.value, "stable")

      // ONE adds one loop microstep: 2 iterations, over the limit of 1
      const one = yield* Effect.exit(transitionOf(machine, initial, { type: "ONE" }))
      assert.deepStrictEqual(
        Option.map(Exit.findErrorOption(one), (error) => error.message),
        Option.some(infiniteLoop(1))
      )
    })
  )

  it.effect("[S21] maxIterations defaults to Infinity", () =>
    Effect.gen(function* () {
      const links = 40
      const states = Object.fromEntries(
        Array.from({ length: links + 1 }, (_, index) => [`s${index}`, index < links ? { always: `s${index + 1}` } : {}])
      )
      const machine = createMachine<object, EventObject>({ id: "s21-long", initial: "s0", context: {}, states })
      assert.strictEqual((machine as unknown as MachineLogic).options.maxIterations, Infinity)

      const initial = yield* initialSnapshotOf(machine)
      assert.strictEqual(initial.status, "active")
      assert.strictEqual(initial.value, `s${links}`)
    })
  )
})
