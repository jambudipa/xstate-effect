/**
 * COV-3: the test helpers of `src/testing`, in the cases the baseline left unhit.
 *
 * init-testing layer 3 (test design R-007, P1). `createInertActorScope` is production code: the
 * pure helpers run every logic with it, so each of its members must do nothing and hold nothing
 * (upstream `createInertActorScope`, P1-016). `getNextSnapshot` and `getInitialMicrosteps` fail
 * with what upstream throws and keep any other throw a defect (SD-3). The `SimulatedClock`
 * class follows its JSDoc (SD-28, P11c, DEV-75): an unknown id clears nothing, and a move made
 * while the clock fires its timers moves the end of the move that is firing. `waitFor` ends
 * with the signal's reason when the signal aborts, also when it aborts during the first check.
 * The pure transition functions type a machine's named actions with their params beside the
 * special built-in actions (upstream `ExecutableActionsFrom`).
 */
import { assert, describe, it } from "@effect/vitest"
import { Cause, Effect, Exit, Logger, Option } from "effect"
import { TestClock } from "effect/testing"
import { GuardError, TransitionError } from "../../src/Errors.js"
import { ACTOR_REF_TYPE } from "../../src/persistence.js"
import * as Snap from "../../src/Snapshot.js"
import { createInertActorScope } from "../../src/testing/getNextSnapshot.js"
import {
  assign,
  createActor,
  createMachine,
  fromPromise,
  fromTransition,
  getInitialMicrosteps,
  getInitialSnapshot,
  getMicrosteps,
  getNextSnapshot,
  initialTransition,
  makeSimulatedClockEffect,
  SimulatedClock,
  raise,
  setup,
  TimeTravelError,
  transition,
  waitFor,
} from "../../src/index.js"
import { guardEvaluationFailed, infiniteLoop } from "./upstream-messages.js"

/** Lets every other ready fiber take twenty turns. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 20; turn++) {
    yield* Effect.yieldNow
  }
})

/** The defect an exit dies with; fails the test when the exit is not a defect. */
const defectOf = <A, E>(exit: Exit.Exit<A, E>): unknown => {
  assert.isTrue(Exit.isFailure(exit), "the Effect failed")
  const cause = Exit.isFailure(exit) ? exit.cause : Cause.empty
  assert.isTrue(Cause.hasDies(cause), "the failure is a defect")
  assert.isFalse(Cause.hasFails(cause), "the failure is not a typed failure")
  return Cause.squash(cause)
}

describe("COV-3 test helpers (src/testing)", () => {
  it.effect("[COV-3] createInertActorScope: each of the 14 members of its system does nothing and holds nothing, but generateId, which numbers ids from x:0 in each new scope", () =>
    Effect.gen(function* () {
      const scope = createInertActorScope(Snap.active())
      const { self, system } = scope
      const ran: Array<string> = []

      // These are all its members: the checks below reach each one
      assert.deepStrictEqual(Object.keys(system).sort(), [
        "_clock",
        "_logger",
        "_lookup",
        "_sendInspectionEvent",
        "_set",
        "generateId",
        "get",
        "getAll",
        "getSnapshot",
        "inspect",
        "register",
        "relay",
        "scheduler",
        "unregister",
      ])
      assert.deepStrictEqual(Object.keys(system.scheduler).sort(), ["cancel", "cancelAll", "resume", "schedule", "scheduledEvents"])

      // Its ids come from a counter of its own fresh system: a new scope starts again at x:0
      assert.strictEqual(yield* system.generateId, "x:0")
      assert.strictEqual(yield* system.generateId, "x:1")
      assert.strictEqual(yield* createInertActorScope(Snap.active()).system.generateId, "x:0")

      // Registering gives the inert session id and books nothing
      assert.strictEqual(yield* system.register("x:7", self), "inert-session")
      yield* system._set("job", self)
      assert.isTrue(Option.isNone(yield* system.get("job")))
      assert.isTrue(Option.isNone(system._lookup("job")))
      assert.deepStrictEqual(yield* system.getAll, {})
      yield* system.unregister(self)

      // Relays and scheduled events go nowhere
      yield* system.relay(self, self, { type: "PING" })
      yield* system.scheduler.schedule(self, self, { type: "LATER" }, 10, Option.some("later"))
      yield* system.scheduler.resume({ source: self, target: self, event: { type: "LATER" }, delay: 10, id: "later", startedAt: 0 })
      assert.deepStrictEqual(yield* system.scheduler.scheduledEvents, {})
      assert.deepStrictEqual(yield* system.getSnapshot, { _scheduledEvents: {} })
      yield* system.scheduler.cancel(self, "later")
      yield* system.scheduler.cancelAll(self)

      // Its clock never fires a timeout
      const id = system._clock.setTimeout(() => {
        ran.push("timeout")
      }, 10)
      assert.strictEqual(id, 0)
      yield* TestClock.adjust("1 minute")
      system._clock.clearTimeout(id)

      // Inspection reaches no observer: not even an event sent while one is registered
      yield* Effect.scoped(
        Effect.andThen(
          system.inspect(() =>
            Effect.sync(() => {
              ran.push("inspected")
            })
          ),
          system._sendInspectionEvent({ type: "@xstate.actor", actorRef: self })
        )
      )
      assert.isTrue(Option.isNone(system._logger))
      assert.deepStrictEqual(ran, [])
    })
  )

  it.effect("[COV-3] createInertActorScope: its self and its actor-scope members run nothing they are given", () =>
    Effect.gen(function* () {
      const snapshot = Snap.active()
      const scope = createInertActorScope(snapshot)
      const { self } = scope
      const ran: Array<string> = []
      const record = (name: string) =>
        Effect.sync(() => {
          ran.push(name)
        })

      assert.strictEqual(self.id, "inert")
      assert.strictEqual(self.sessionId, "inert-session")
      yield* self.sendUntyped({ type: "PING" })
      assert.strictEqual(yield* self.getSnapshotUntyped, snapshot)
      assert.strictEqual(self.pipe(), self)
      assert.deepStrictEqual(self.toJSON(), { xstate$$type: ACTOR_REF_TYPE, id: "inert" })
      assert.isTrue(Option.isNone(self._parent))

      // Upstream's inert scope logs nothing (`logger: () => {}`) and runs no action: a reducer
      // takes its logger from the scope, so a reducer the pure helpers run writes no log entry
      assert.isTrue(Option.isSome(scope.logger))
      const logged: Array<unknown> = []
      const logging = fromTransition((count: number, _event: { readonly type: "GO" }, { logger }) => {
        logger("counted", count + 1)
        return count + 1
      }, 0)
      const next = yield* getNextSnapshot(logging, yield* getInitialSnapshot(logging), { type: "GO" }).pipe(
        Effect.provide(
          Logger.layer([
            Logger.make((options) => {
              logged.push(options.message)
            }),
          ])
        )
      )
      assert.strictEqual(next.context, 1)
      assert.deepStrictEqual(logged, [])
      yield* scope.defer(record("deferred"))
      yield* scope.emit({ type: "EMITTED" })
      yield* scope.stopChild(self)
      yield* scope.actionExecutor({
        type: "custom",
        params: undefined,
        info: { context: undefined, event: { type: "PING" }, self: scope.allocateChild(), system: scope.system },
        exec: record("exec"),
      })
      assert.deepStrictEqual(ran, [])
    })
  )

  it.effect("[COV-3] createInertActorScope: restoreChild creates the child, and neither it nor startChild starts it", () =>
    Effect.gen(function* () {
      const calls: Array<string> = []
      const logic = fromPromise(() => {
        calls.push("promise")
        return Promise.resolve("value")
      })
      const scope = createInertActorScope(Snap.active())

      const child = yield* scope.restoreChild({
        logic,
        src: "job",
        id: "job",
        systemId: Option.none(),
        syncSnapshot: false,
        snapshot: Option.none(),
      })
      assert.strictEqual(child.id, "job")
      assert.strictEqual(child.src, "job")
      yield* scope.startChild(child)
      yield* settle

      assert.deepStrictEqual(calls, [])
      assert.strictEqual((yield* child.getSnapshotUntyped).status, "active")
    })
  )

  it.effect("[COV-3] getNextSnapshot: a throw in a reducer stays a defect with the thrown value, unlike a guard's GuardError", () =>
    Effect.gen(function* () {
      const boom = new Error("reducer failed")
      const logic = fromTransition((_count: number, _event: { readonly type: "GO" }): number => {
        throw boom
      }, 0)
      const initial = yield* getInitialSnapshot(logic)

      const exit = yield* Effect.exit(getNextSnapshot(logic, initial, { type: "GO" }))
      assert.strictEqual(defectOf(exit), boom)

      // A guard that throws fails the Effect with the guard-evaluation error instead
      const machine = createMachine({
        id: "cov3-guard",
        initial: "a",
        states: {
          a: {
            on: {
              GO: {
                guard: () => {
                  throw new Error("guard failed")
                },
                target: "b",
              },
            },
          },
          b: {},
        },
      })
      const failure = yield* Effect.flip(getNextSnapshot(machine, yield* getInitialSnapshot(machine), { type: "GO" }))
      assert.instanceOf(failure, GuardError)
      assert.strictEqual(failure.message, guardEvaluationFailed("", "GO", "cov3-guard.a", "guard failed"))
    })
  )

  it.effect("[COV-3] getInitialMicrosteps: a guard that throws on an event the initial macrostep raises fails with GuardError", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        id: "cov3-initial-guard",
        initial: "a",
        states: {
          a: {
            entry: raise({ type: "GO" }),
            on: {
              GO: {
                guard: () => {
                  throw new Error("guard failed")
                },
                target: "b",
              },
            },
          },
          b: {},
        },
      })

      const failure = yield* Effect.flip(getInitialMicrosteps(machine))
      assert.instanceOf(failure, GuardError)
      assert.strictEqual(failure.message, guardEvaluationFailed("", "GO", "cov3-initial-guard.a", "guard failed"))
    })
  )

  it.effect("[COV-3] getInitialMicrosteps: an initial macrostep past maxIterations fails with TransitionError", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        id: "cov3-loop",
        initial: "a",
        options: { maxIterations: 10 },
        states: {
          a: { always: { target: "b" } },
          b: { always: { target: "a" } },
        },
      })

      const failure = yield* Effect.flip(getInitialMicrosteps(machine))
      assert.instanceOf(failure, TransitionError)
      assert.strictEqual(failure.message, infiniteLoop(10))
    })
  )

  it.effect("[COV-3] getInitialMicrosteps: any other throw in the initial macrostep is a defect with the thrown value", () =>
    Effect.gen(function* () {
      const boom = new Error("assign failed")
      const machine = createMachine({
        id: "cov3-assign",
        initial: "a",
        context: { count: 0 },
        states: {
          a: {
            entry: assign((): { count: number } => {
              throw boom
            }),
          },
        },
      })

      const exit = yield* Effect.exit(getInitialMicrosteps(machine))
      assert.strictEqual(defectOf(exit), boom)
    })
  )

  it.effect("[COV-3] makeSimulatedClockEffect: its Effects set, list, clear and fire timeouts, and set to an earlier time fails", () =>
    Effect.gen(function* () {
      const clock = yield* makeSimulatedClockEffect
      const fired: Array<string> = []
      const first = yield* clock.setTimeout(() => {
        fired.push("first")
      }, 100)
      const second = yield* clock.setTimeout(() => {
        fired.push("second")
      }, 200)

      const pending = yield* clock.getPendingTimeouts
      assert.deepStrictEqual(
        pending.map((timeout) => [timeout.id, timeout.start, timeout.timeout]).sort(([a], [b]) => Number(a) - Number(b)),
        [
          [first, 0, 100],
          [second, 0, 200],
        ]
      )

      yield* clock.clearTimeout(first)
      yield* clock.increment(150)
      assert.deepStrictEqual(fired, [])
      assert.strictEqual(yield* clock.now, 150)

      yield* clock.clearAllTimeouts
      assert.deepStrictEqual(yield* clock.getPendingTimeouts, [])
      yield* clock.set(300)
      assert.deepStrictEqual(fired, [])

      const travel = yield* Effect.flip(clock.set(250))
      assert.instanceOf(travel, TimeTravelError)
      assert.strictEqual(travel.message, "Unable to travel back in time")
      assert.strictEqual(travel.from, 300)
      assert.strictEqual(travel.to, 250)

      yield* clock.setTimeout(() => {
        fired.push("third")
      }, 50)
      yield* clock.increment(50)
      assert.deepStrictEqual(fired, ["third"])
      assert.strictEqual(yield* clock.now, 350)
    })
  )

  it.effect("[COV-3] SimulatedClock: clearTimeout with an id that is not a number clears nothing", () =>
    Effect.gen(function* () {
      const clock = new SimulatedClock()
      const fired: Array<string> = []
      const id = clock.setTimeout(() => {
        fired.push("kept")
      }, 100)

      clock.clearTimeout(String(id))
      clock.clearTimeout(undefined)
      yield* clock.increment(100)
      assert.deepStrictEqual(fired, ["kept"])
    })
  )

  it.effect("[COV-3] SimulatedClock: an increment made while a timer fires returns at once, and the timers then due fire in the increment that is firing", () =>
    Effect.gen(function* () {
      const clock = new SimulatedClock()
      const fired: Array<string> = []
      clock.setTimeout(() => {
        fired.push(`first at ${clock.now()}`)
        Effect.runSync(clock.increment(1000))
        fired.push("inner increment returned")
      }, 100)
      clock.setTimeout(() => {
        fired.push(`second at ${clock.now()}`)
      }, 600)

      yield* clock.increment(100)
      assert.deepStrictEqual(fired, ["first at 100", "inner increment returned", "second at 600"])
      assert.strictEqual(clock.now(), 1100)
    })
  )

  it.effect("[COV-3] waitFor: a signal that aborts while the predicate first runs ends the wait with its reason", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        id: "cov3-wait",
        initial: "idle",
        states: { idle: { on: { GO: "busy" } }, busy: {} },
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      const controller = new AbortController()

      const reason = yield* Effect.flip(
        waitFor(
          actor,
          () => {
            controller.abort("stop waiting")
            return false
          },
          { signal: controller.signal }
        )
      )
      assert.strictEqual(reason, "stop waiting")
    })
  )

  it.effect("[COV-3] the pure transition functions type a machine's named actions with their params, beside the special built-in actions", () =>
    Effect.gen(function* () {
      const machine = setup({
        types: {} as { events: { type: "GO" } },
        actions: { track: (_, params: { readonly id: number }) => void params },
      }).createMachine({
        entry: { type: "track", params: { id: 1 } },
        on: { GO: { actions: [{ type: "track", params: { id: 2 } }, raise({ type: "GO" }, { delay: 10 })] } },
      })

      // Each `action.type === "track"` compiles only when the action type names `track` with its params
      const [initial, initialActions] = yield* initialTransition(machine)
      const initialIds = initialActions.flatMap((action) => (action.type === "track" ? [action.params.id] : []))
      const [, nextActions] = yield* transition(machine, initial, { type: "GO" })
      const nextIds = nextActions.flatMap((action) => (action.type === "track" ? [action.params.id] : []))
      const delays = nextActions.flatMap((action) => (action.type === "xstate.raise" ? [action.params.delay] : []))
      const steps = yield* getMicrosteps(machine, initial, { type: "GO" })
      const stepIds = steps.flatMap(([, actions]) => actions.flatMap((action) => (action.type === "track" ? [action.params.id] : [])))
      const initialSteps = yield* getInitialMicrosteps(machine)
      const initialStepIds = initialSteps.flatMap(([, actions]) =>
        actions.flatMap((action) => (action.type === "track" ? [action.params.id] : []))
      )

      assert.deepStrictEqual(initialIds, [1])
      assert.deepStrictEqual(nextIds, [2])
      assert.deepStrictEqual(delays, [10])
      assert.deepStrictEqual(stepIds, [2])
      assert.deepStrictEqual(initialStepIds, [1])
    })
  )
})
