/**
 * S18: a forbidden transition blocks the event.
 *
 * T3.19. Upstream `toTransitionConfigArray` (`src/utils.ts` at xstate@5.33.2) turns
 * `on: { E: undefined }` into a transition with no target and no actions. `StateNode.next`
 * selects it like any other candidate, so `transitionAtomicNode` and
 * `transitionCompoundNode` never ask an ancestor: the event stops at the forbidding state and
 * nothing happens. `transitionParallelNode` collects each region's selection, so a forbidden
 * transition in one region blocks that region and the ancestors that wait for "nothing below
 * handles it", while another region still takes its own transition. Upstream `snapshot.can`
 * (`src/State.ts`) selects the transitions the same way and is true only when one of them is
 * not forbidden (`t.target !== undefined || t.actions.length`).
 *
 * `snapshot.can` itself is T3.22 (S23) and `machine.getTransitionData` is T3.23 (S25); the
 * boundary case below checks the engine query that `can` is built on,
 * `StateUtils.canTakeEvent`, with an inert actor scope.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import {
  type ActorLogicType,
  createActor,
  createMachine,
  type EventObject,
  getInitialSnapshot,
  getNextSnapshot,
  type MachineSnapshot,
} from "../../src/index.js"
import * as StateUtils from "../../src/stateUtils.js"
import { createInertActorScope } from "../../src/testing/index.js"

/** The initial snapshot through `getInitialSnapshot`, widened as S10b widens it. */
const initialSnapshotOf = (machine: object): Effect.Effect<MachineSnapshot> =>
  getInitialSnapshot(machine as ActorLogicType.Any, undefined) as unknown as Effect.Effect<MachineSnapshot>

/** The next snapshot through `getNextSnapshot` (same widening). */
const nextSnapshotOf = (machine: object, snapshot: MachineSnapshot, event: EventObject): Effect.Effect<MachineSnapshot> =>
  getNextSnapshot(machine as ActorLogicType.Any, snapshot, event) as unknown as Effect.Effect<MachineSnapshot>

/** The snapshot reached from the initial one by `types`, one event after the other, without an actor. */
const afterEvents = (machine: object, types: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    let snapshot = yield* initialSnapshotOf(machine)
    for (const type of types) {
      snapshot = yield* nextSnapshotOf(machine, snapshot, { type })
    }
    return snapshot
  })

/**
 * `p` (initial `c`) handles `E` and `F` by going to `other`; its child `c` forbids `E`, and
 * its child `d` does not. Each transition action appends its label to `log`.
 */
const parentChild = (log: Array<string>) =>
  createMachine({
    id: "s18-parent",
    initial: "p",
    context: {},
    states: {
      p: {
        initial: "c",
        on: {
          E: { target: "other", actions: () => log.push("p E") },
          F: { target: "other", actions: () => log.push("p F") },
        },
        states: {
          c: { on: { E: undefined, NEXT: "d" } },
          d: {},
        },
      },
      other: {},
    },
  })

/**
 * The parallel state `p` handles `E`, `G` and `H`; region `r1` handles `E` with an action, and
 * its state `a` forbids `E` and `G`; region `r2` handles `E` with an action, and its state `a`
 * takes `E` to `b`. Nothing in `r2` handles `G`.
 */
const regions = (log: Array<string>) =>
  createMachine({
    id: "s18-parallel",
    initial: "p",
    context: {},
    states: {
      p: {
        type: "parallel",
        on: {
          E: { target: "gone", actions: () => log.push("p E") },
          G: { target: "gone", actions: () => log.push("p G") },
          H: { target: "gone", actions: () => log.push("p H") },
        },
        states: {
          r1: {
            initial: "a",
            on: { E: { actions: () => log.push("r1 E") } },
            states: { a: { on: { E: undefined, G: undefined } } },
          },
          r2: {
            initial: "a",
            on: { E: { actions: () => log.push("r2 E") } },
            states: {
              a: { on: { E: { target: "b", actions: () => log.push("r2.a E") } } },
              b: {},
            },
          },
        },
      },
      gone: {},
    },
  })

/** Starts an actor of `machine`, sends each event of `types`, and gives the state value after them. */
const valueAfter = (machine: ReturnType<typeof parentChild>, types: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const actor = yield* createActor(machine)
    yield* actor.start
    for (const type of types) {
      yield* actor.send({ type })
    }
    const snapshot = yield* actor.getSnapshot
    return "value" in snapshot ? snapshot.value : undefined
  })

/** The engine context of a machine with an object context and plain events. */
type Engine = StateUtils.EngineContext<object, EventObject>

/** Whether `machine` in `snapshot` takes `event` (the engine query of upstream `snapshot.can`). */
const canTake = (machine: Engine["machine"], snapshot: MachineSnapshot, type: string) =>
  StateUtils.canTakeEvent<object, EventObject>({
    machine,
    snapshot: snapshot as Engine["snapshot"],
    event: { type },
    actorScope: createInertActorScope(snapshot),
  })

describe("S18 A forbidden transition blocks the event", () => {
  it.effect("[S18] on: { E: undefined } in a child blocks the parent handler for E", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const machine = parentChild(log)

      assert.deepStrictEqual(yield* valueAfter(machine, ["E"]), { p: "c" })
      assert.deepStrictEqual(log, [])

      // The same handler runs from the sibling that does not forbid E
      assert.strictEqual(yield* valueAfter(machine, ["NEXT", "E"]), "other")
      assert.deepStrictEqual(log, ["p E"])
    })
  )

  // upstream: test/deterministic.test.ts > deterministic machine > forbidden events > undefined transitions should forbid events
  it.effect("[S18] the upstream light machine stays in red.walk and red.wait on TIMER", () =>
    Effect.gen(function* () {
      const lightMachine = createMachine({
        id: "light",
        initial: "green",
        context: {},
        states: {
          green: { on: { TIMER: "yellow", POWER_OUTAGE: "red" } },
          yellow: { on: { TIMER: "red", POWER_OUTAGE: "red" } },
          red: {
            on: { TIMER: "green", POWER_OUTAGE: "red" },
            initial: "walk",
            states: {
              walk: { on: { PED_COUNTDOWN: "wait", TIMER: undefined } },
              wait: { on: { PED_COUNTDOWN: "stop", TIMER: undefined } },
              stop: {},
            },
          },
        },
      })

      assert.deepStrictEqual((yield* afterEvents(lightMachine, ["TIMER", "TIMER", "TIMER"])).value, { red: "walk" })
      assert.deepStrictEqual((yield* afterEvents(lightMachine, ["TIMER", "TIMER", "PED_COUNTDOWN", "TIMER"])).value, {
        red: "wait",
      })
      // From red.stop, which forbids nothing, TIMER reaches the red handler
      assert.strictEqual(
        (yield* afterEvents(lightMachine, ["TIMER", "TIMER", "PED_COUNTDOWN", "PED_COUNTDOWN", "TIMER"])).value,
        "green"
      )
    })
  )

  it.effect("[S18] the engine query of snapshot.can is false for a forbidden event in the child state", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const machine = parentChild(log)
      const inChild = yield* initialSnapshotOf(machine)
      const inSibling = yield* nextSnapshotOf(machine, inChild, { type: "NEXT" })

      assert.isFalse(yield* canTake(machine, inChild, "E"))
      assert.isTrue(yield* canTake(machine, inChild, "F"))
      assert.isTrue(yield* canTake(machine, inChild, "NEXT"))
      assert.isFalse(yield* canTake(machine, inChild, "UNKNOWN"))
      assert.isTrue(yield* canTake(machine, inSibling, "E"))
      // In a parallel state, the region that does not forbid E still takes it
      const parallelMachine = regions(log)
      assert.isTrue(yield* canTake(parallelMachine, yield* initialSnapshotOf(parallelMachine), "E"))
      // The query selects transitions; it runs none of their actions
      assert.deepStrictEqual(log, [])
    })
  )

  // upstream: test/state.test.ts > State > .can > should return false for a forbidden transition
  it.effect("[S18] can is false for a forbidden transition and true for a targetless transition with an action", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const machine = createMachine({
        id: "s18-can",
        initial: "a",
        context: {},
        states: {
          a: { on: { EV: undefined, ACT: { actions: () => log.push("ACT") } } },
        },
      })
      const snapshot = yield* initialSnapshotOf(machine)

      assert.isFalse(yield* canTake(machine, snapshot, "EV"))
      assert.isTrue(yield* canTake(machine, snapshot, "ACT"))
      assert.deepStrictEqual(log, [])
    })
  )

  it.effect("[S18] other events still bubble from the forbidding child to the parent", () =>
    Effect.gen(function* () {
      const log: Array<string> = []

      assert.strictEqual(yield* valueAfter(parentChild(log), ["F"]), "other")
      assert.deepStrictEqual(log, ["p F"])
    })
  )

  it.effect("[S18] in a parallel state the forbidden E blocks r1 and its ancestors while r2 takes its own E", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const machine = regions(log)

      // r2.a's own transition is taken; r1, r1's region handler and p's handler are not
      assert.deepStrictEqual(yield* valueAfter(machine, ["E"]), { p: { r1: "a", r2: "b" } })
      assert.deepStrictEqual(log, ["r2.a E"])

      // With nothing below r2 for E, r2's region handler runs, but r1's and p's still do not
      log.length = 0
      assert.deepStrictEqual(yield* valueAfter(machine, ["E", "E"]), { p: { r1: "a", r2: "b" } })
      assert.deepStrictEqual(log, ["r2.a E", "r2 E"])

      // r1.a's forbidden G alone keeps p's handler from running, as no region takes G
      log.length = 0
      assert.deepStrictEqual(yield* valueAfter(machine, ["G"]), { p: { r1: "a", r2: "a" } })
      assert.deepStrictEqual(log, [])

      // p's handler for an event no state forbids still runs
      assert.strictEqual(yield* valueAfter(machine, ["H"]), "gone")
      assert.deepStrictEqual(log, ["p H"])
    })
  )
})
