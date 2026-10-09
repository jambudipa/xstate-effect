/**
 * S3: parallel states enter every region and handle events per region.
 *
 * T2.33. The initial microstep of the ported configuration engine (`src/stateUtils.ts`;
 * upstream `getInitialStateNodes`, `getAllStateNodes`, `getStateValue` and
 * `initialMicrostep` in `src/stateUtils.ts` at xstate@5.33.2) enters every region of a
 * parallel node, nested parallel nodes included, and collects the entry actions of every
 * region in document order. An event that only one region handles changes only that
 * region, because the next state value comes from the whole configuration. A `states` map
 * without `initial` on a node that is not parallel is a compound node without an initial
 * state, a `createMachine` definition error: upstream `createMachine` throws its message
 * (`src/StateNode.ts:217`); the port's machine keeps it, and each Effect that computes a
 * snapshot of the machine fails with that message (SD-3, amended 2026-10-08; DEV-72).
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option, Result, Stream } from "effect"
import {
  ActorScope,
  type ActorLogicType,
  type ActorType,
  createActor,
  createMachine,
  Errors,
  type EventObject,
  getInitialSnapshot,
  type MachineSnapshot,
  type SnapshotType,
  type MachineConfig,
  Types,
} from "../../src/index.js"
import * as StateUtils from "../../src/stateUtils.js"
import { createInertActorScope } from "../../src/testing/getNextSnapshot.js"
import { noInitialState } from "./upstream-messages.js"

/** An action definition that appends `label` to `log` each time it runs. */
const recorder = (log: Array<string>, label: string) => ({
  type: label,
  exec: () =>
    Effect.sync(() => {
      log.push(label)
      return Types.ActionResult.NoOp()
    }),
})

/** Creates and starts an actor of `logic`. */
const startActor = <S extends SnapshotType, E extends EventObject, Em extends EventObject, R>(
  logic: ActorLogicType<S, E, unknown, Em, R>
) => Effect.tap(createActor(logic, { id: "s3" }), (actor) => actor.start)

/** The initial snapshot of a machine (or any logic without input) through the pure `getInitialSnapshot` helper. */
const initialSnapshotOf = <S extends SnapshotType, E extends EventObject, Em extends EventObject, R>(
  logic: ActorLogicType<S, E, unknown, Em, R>
) => getInitialSnapshot(logic, undefined)

const valueOf = (snapshot: object): unknown => ("value" in snapshot ? snapshot.value : undefined)

/** Waits until the actor's state value deep-equals `value`, and returns it. */
const reach = (actor: Pick<ActorType.Any, "changes">, value: unknown) =>
  actor.changes.pipe(
    Stream.map(valueOf),
    Stream.filter((current) => JSON.stringify(current) === JSON.stringify(value)),
    Stream.runHead,
    Effect.map(Option.getOrThrow)
  )

/** One region with an initial state three levels deep (upstream `initial.test.ts`). */
const deepRegion = {
  initial: "a",
  states: {
    a: { initial: "b", states: { b: { initial: "c", states: { c: {} } } } },
    leaf: {},
  },
}

/** A parallel node `p` under a compound root; each region handles its own event. */
const regionsMachine = (log: Array<string>) =>
  createMachine({
    id: "m",
    initial: "p",
    context: {},
    states: {
      p: {
        type: "parallel",
        entry: recorder(log, "en p"),
        states: {
          left: {
            initial: "l1",
            entry: recorder(log, "en left"),
            states: {
              l1: { entry: recorder(log, "en l1"), exit: recorder(log, "ex l1"), on: { LEFT: "l2" } },
              l2: { entry: recorder(log, "en l2") },
            },
          },
          right: {
            initial: "r1",
            entry: recorder(log, "en right"),
            states: {
              r1: { entry: recorder(log, "en r1"), exit: recorder(log, "ex r1"), on: { RIGHT: "r2" } },
              r2: { entry: recorder(log, "en r2") },
            },
          },
        },
      },
    },
  })

/**
 * Machine `m`: `a` (initial, `GO` to `b`) and `b`, a states map of `b1` and `b2` that has
 * `initial: "b1"` only when `withInitial` holds. The initial snapshot enters only `a`.
 */
const offPathConfig = (withInitial: boolean): MachineConfig<object, EventObject> => ({
  id: "m",
  initial: "a",
  context: {},
  states: {
    a: { on: { GO: "b" } },
    b: withInitial ? { initial: "b1", states: { b1: {}, b2: {} } } : { states: { b1: {}, b2: {} } },
  },
})

describe("S3 parallel states enter every region and handle events per region", () => {
  // upstream: test/initial.test.ts > Initial states > should return the correct initial state (parallel)
  it.effect("[S3] a parallel root enters every region and the state value lists both regions", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        id: "m",
        type: "parallel",
        context: {},
        states: { foo: deepRegion, bar: deepRegion },
      })

      const snapshot = yield* initialSnapshotOf(machine)
      assert.deepStrictEqual(snapshot.value, { foo: { a: { b: "c" } }, bar: { a: { b: "c" } } })
    })
  )

  // upstream: test/initial.test.ts > Initial states > should return the correct initial state (deep parallel)
  it.effect("[S3] nested parallel states resolve fully, below a compound node and inside a region", () =>
    Effect.gen(function* () {
      const deepParallel = createMachine({
        id: "m",
        initial: "one",
        context: {},
        states: {
          one: { type: "parallel", states: { foo: deepRegion, bar: deepRegion } },
          two: { type: "parallel", states: { foo: deepRegion, bar: deepRegion } },
        },
      })
      const fromDeep = yield* initialSnapshotOf(deepParallel)
      assert.deepStrictEqual(fromDeep.value, {
        one: { foo: { a: { b: "c" } }, bar: { a: { b: "c" } } },
      })

      const parallelInRegion = createMachine({
        id: "n",
        type: "parallel",
        context: {},
        states: {
          outer: {
            type: "parallel",
            states: {
              x: { initial: "x1", states: { x1: {}, x2: {} } },
              y: { type: "parallel", states: { y1: {}, y2: {} } },
            },
          },
          plain: { initial: "z", states: { z: {} } },
        },
      })
      const fromRegion = yield* initialSnapshotOf(parallelInRegion)
      assert.deepStrictEqual(fromRegion.value, {
        outer: { x: "x1", y: { y1: {}, y2: {} } },
        plain: "z",
      })
    })
  )

  it.effect("[S3] the initial microstep enters the regions in document order and collects their entry actions", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const machine = regionsMachine(log)
      const step = Result.getOrThrow(StateUtils.initialMicrostep(machine.root))

      assert.deepStrictEqual(
        step.configuration.map((node) => node.id),
        ["m", "m.p", "m.p.left", "m.p.left.l1", "m.p.right", "m.p.right.r1"]
      )
      assert.deepStrictEqual(
        step.actions.map((action) => (typeof action === "string" ? action : typeof action === "function" ? action.name : action.type)),
        ["en p", "en left", "en l1", "en right", "en r1"]
      )
      assert.deepStrictEqual(log, [])

      const actor = yield* startActor(machine)
      yield* reach(actor, { p: { left: "l1", right: "r1" } })
      assert.deepStrictEqual(log, ["en p", "en left", "en l1", "en right", "en r1"])
    })
  )

  it.effect("[S3] an event that only one region handles changes only that region", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const actor = yield* startActor(regionsMachine(log))
      yield* reach(actor, { p: { left: "l1", right: "r1" } })
      log.length = 0

      // The second region handles RIGHT: the first region's leaf must not hide it.
      yield* actor.send({ type: "RIGHT" })
      yield* reach(actor, { p: { left: "l1", right: "r2" } })
      assert.deepStrictEqual(log, ["ex r1", "en r2"])

      yield* actor.send({ type: "LEFT" })
      const value = yield* reach(actor, { p: { left: "l2", right: "r2" } })
      assert.deepStrictEqual(value, { p: { left: "l2", right: "r2" } })
      assert.deepStrictEqual(log, ["ex r1", "en r2", "ex l1", "en l2"])
    })
  )

  it.effect("[S3] a states map without initial on a node that is not parallel is a createMachine definition error with the recorded message", () =>
    Effect.gen(function* () {
      const nested: MachineConfig<object, EventObject> = {
        id: "m",
        initial: "a",
        context: {},
        states: { a: { states: { b: {}, c: {} } } },
      }
      // SD-3 (amended 2026-10-08): the machine keeps the definition error, and its initial
      // snapshot fails with it
      const nestedError = yield* Effect.flip(initialSnapshotOf(createMachine(nested)))
      assert.instanceOf(nestedError, Errors.InitializationError)
      assert.instanceOf(nestedError.cause, Errors.MachineDefinitionError)
      assert.strictEqual(nestedError.message, noInitialState("m.a", "b"))

      const atRoot = yield* Effect.flip(initialSnapshotOf(createMachine({ id: "r", context: {}, states: { x: {}, y: {} } })))
      assert.strictEqual(atRoot.message, noInitialState("r", "x"))

      const explicitCompound = yield* Effect.flip(
        initialSnapshotOf(
          createMachine({ id: "e", initial: "a", context: {}, states: { a: { type: "compound", states: { k: {} } } } })
        )
      )
      assert.strictEqual(explicitCompound.message, noInitialState("e.a", "k"))
    })
  )

  it.effect("[S3] each Effect that computes a snapshot of a machine with a states map without initial fails with the recorded message, and its actor has status error", () =>
    Effect.gen(function* () {
      // The states map without initial is `b`, which the initial snapshot does not enter;
      // xstate 5.33.2 `createMachine` throws this message for the config (src/StateNode.ts:217)
      const message = noInitialState("m.b", "b1")
      const invalid = createMachine(offPathConfig(false))
      // A snapshot of state `a` and its persisted form, from the same machine with `initial: "b1"` on `b`
      const valid = createMachine(offPathConfig(true))
      const snapshot = yield* valid.resolveState({ value: "a" })
      const persisted = yield* valid.getPersistedSnapshot(snapshot)
      const inert = createInertActorScope(snapshot)
      const event: EventObject = { type: "GO" }

      // getInitialSnapshot fails with an InitializationError
      const initError = yield* Effect.flip(invalid.getInitialSnapshot(undefined).pipe(Effect.provideService(ActorScope, inert)))
      assert.instanceOf(initError, Errors.InitializationError)
      assert.strictEqual(initError.message, message)
      assert.instanceOf(initError.cause, Errors.MachineDefinitionError)
      assert.strictEqual(initError.cause.message, message)

      // restoreSnapshot fails with a RestoreError
      const restoreError = yield* Effect.flip(invalid.restoreSnapshot(persisted).pipe(Effect.provideService(ActorScope, inert)))
      assert.instanceOf(restoreError, Errors.RestoreError)
      assert.strictEqual(restoreError.message, message)
      assert.instanceOf(restoreError.cause, Errors.MachineDefinitionError)
      assert.strictEqual(restoreError.cause.message, message)

      // transition and microstep fail with a TransitionError
      const transitionError = yield* Effect.flip(invalid.transition(snapshot, event).pipe(Effect.provideService(ActorScope, inert)))
      assert.instanceOf(transitionError, Errors.TransitionError)
      assert.strictEqual(transitionError.message, message)
      assert.instanceOf(transitionError.cause, Errors.MachineDefinitionError)
      assert.strictEqual(transitionError.cause.message, message)

      const microstepError = yield* Effect.flip(invalid.microstep(snapshot, event).pipe(Effect.provideService(ActorScope, inert)))
      assert.instanceOf(microstepError, Errors.TransitionError)
      assert.strictEqual(microstepError.message, message)
      assert.instanceOf(microstepError.cause, Errors.MachineDefinitionError)
      assert.strictEqual(microstepError.cause.message, message)

      // resolveState and getTransitionData fail with the MachineDefinitionError itself
      const resolveError = yield* Effect.flip(invalid.resolveState({ value: "a" }))
      assert.instanceOf(resolveError, Errors.MachineDefinitionError)
      assert.strictEqual(resolveError.message, message)

      const dataError = yield* Effect.flip(invalid.getTransitionData(snapshot, event))
      assert.instanceOf(dataError, Errors.MachineDefinitionError)
      assert.strictEqual(dataError.message, message)

      // createActor keeps its signature: the actor has status error with the InitializationError
      const actor = yield* createActor(invalid)
      const actorSnapshot = yield* actor.getSnapshot
      assert.strictEqual(actorSnapshot.status, "error")
      const actorError = Option.getOrUndefined(actorSnapshot.error)
      assert.instanceOf(actorError, Errors.InitializationError)
      assert.strictEqual(actorError.message, message)
      assert.instanceOf(actorError.cause, Errors.MachineDefinitionError)
      assert.strictEqual(actorError.cause.message, message)
    })
  )

  it.effect("[S3] a parallel node needs no initial and an empty states map is an atomic node", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        id: "ok",
        initial: "p",
        context: {},
        states: {
          p: { type: "parallel", states: { a: {}, b: {} } },
          empty: { states: {} },
        },
      })
      assert.strictEqual(machine.root.states["p"]!.type, "parallel")
      assert.strictEqual(machine.root.states["empty"]!.type, "atomic")

      const snapshot = yield* initialSnapshotOf(machine)
      assert.deepStrictEqual(snapshot.value, { p: { a: {}, b: {} } })
    })
  )
})
