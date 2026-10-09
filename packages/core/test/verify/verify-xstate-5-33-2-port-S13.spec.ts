/**
 * S13: exit, transition and entry actions run in XState order.
 *
 * T2.34. Upstream `microstep`, `exitStates` and `enterStates` in `src/stateUtils.ts` at
 * xstate@5.33.2 (the SCXML microstep procedure): the exit actions of the states inside the
 * transition domain run in reverse document order (deepest first), then the transition
 * actions, then the entry actions of the entered states in document order.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import {
  type ActorLogicType,
  createMachine,
  type EventObject,
  getInitialSnapshot,
  getNextSnapshot,
  type MachineSnapshot,
  Types,
} from "../../src/index.js"

/** The initial snapshot through `getInitialSnapshot`, widened until T2.40 (as S2 and S3 do). */
const initialSnapshotOf = (machine: object): Effect.Effect<MachineSnapshot> =>
  getInitialSnapshot(machine as ActorLogicType.Any, undefined) as unknown as Effect.Effect<MachineSnapshot>

/** The next snapshot through `getNextSnapshot` (same widening). */
const nextSnapshotOf = (machine: object, snapshot: MachineSnapshot, event: EventObject): Effect.Effect<MachineSnapshot> =>
  getNextSnapshot(machine as ActorLogicType.Any, snapshot, event) as unknown as Effect.Effect<MachineSnapshot>

/** An action definition that appends `label` to `log` each time it runs. */
const recorder = (log: Array<string>, label: string) => ({
  type: label,
  exec: () =>
    Effect.sync(() => {
      log.push(label)
      return Types.ActionResult.NoOp()
    }),
})

/** Entry and exit recorders for a state named `name`. */
const tracked = (log: Array<string>, name: string) => ({
  entry: recorder(log, `en ${name}`),
  exit: recorder(log, `ex ${name}`),
})

/**
 * `a (initial a1) › a1 (initial a11) › a11 | a12`, `a › a2`, and `b (initial b1) ›
 * b1 (initial b11) › b11`, plus a parallel state `p` with regions `x` and `y`.
 */
const orderMachine = (log: Array<string>) =>
  createMachine({
    id: "m",
    initial: "a",
    context: {},
    states: {
      a: {
        initial: "a1",
        ...tracked(log, "a"),
        states: {
          a1: {
            initial: "a11",
            ...tracked(log, "a1"),
            on: {
              TO_B: { target: "#m.b", actions: recorder(log, "t") },
              TO_SIBLING: { target: "a2", actions: recorder(log, "t") },
              TO_P: { target: "#m.p", actions: recorder(log, "t") },
            },
            states: {
              a11: { ...tracked(log, "a11"), on: { DEEP: { target: "#m.b.b1.b11", actions: recorder(log, "t") } } },
              a12: tracked(log, "a12"),
            },
          },
          a2: tracked(log, "a2"),
        },
      },
      b: {
        initial: "b1",
        ...tracked(log, "b"),
        states: { b1: { initial: "b11", ...tracked(log, "b1"), states: { b11: tracked(log, "b11") } } },
      },
      p: {
        type: "parallel",
        ...tracked(log, "p"),
        on: { LEAVE: { target: "#m.b", actions: recorder(log, "t") } },
        states: {
          x: { initial: "x1", ...tracked(log, "x"), states: { x1: tracked(log, "x1") } },
          y: { initial: "y1", ...tracked(log, "y"), states: { y1: tracked(log, "y1") } },
        },
      },
    },
  })

/** The log and the value after `events`, keeping only the last event's actions. */
const after = (...events: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const log: Array<string> = []
    const machine = orderMachine(log)
    let snapshot = yield* initialSnapshotOf(machine)
    assert.deepStrictEqual(snapshot.value, { a: { a1: "a11" } })
    for (const [index, type] of events.entries()) {
      if (index === events.length - 1) {
        log.length = 0
      }
      snapshot = yield* nextSnapshotOf(machine, snapshot, { type })
    }
    return { log, value: snapshot.value }
  })

describe("S13 exit, transition and entry actions run in XState order", () => {
  it.effect("[S13] moving from a.a1 to b gives ex a1, ex a, t, en b, en b1", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const machine = createMachine({
        id: "m",
        initial: "a",
        context: {},
        states: {
          a: {
            initial: "a1",
            ...tracked(log, "a"),
            states: { a1: { ...tracked(log, "a1"), on: { E: { target: "#m.b", actions: recorder(log, "t") } } } },
          },
          b: { initial: "b1", ...tracked(log, "b"), states: { b1: tracked(log, "b1") } },
        },
      })
      const initial = yield* initialSnapshotOf(machine)
      log.length = 0

      const next = yield* nextSnapshotOf(machine, initial, { type: "E" })
      assert.deepStrictEqual(next.value, { b: "b1" })
      assert.deepStrictEqual(log, ["ex a1", "ex a", "t", "en b", "en b1"])
    })
  )

  it.effect("[S13] exits run deepest first to the domain, then the transition, then entries in document order", () =>
    Effect.gen(function* () {
      const { log, value } = yield* after("TO_B")
      assert.deepStrictEqual(value, { b: { b1: "b11" } })
      assert.deepStrictEqual(log, ["ex a11", "ex a1", "ex a", "t", "en b", "en b1", "en b11"])
    })
  )

  it.effect("[S13] a deep target enters its ancestors first, in document order", () =>
    Effect.gen(function* () {
      const { log, value } = yield* after("DEEP")
      assert.deepStrictEqual(value, { b: { b1: "b11" } })
      assert.deepStrictEqual(log, ["ex a11", "ex a1", "ex a", "t", "en b", "en b1", "en b11"])
    })
  )

  it.effect("[S13] the exits stop at the transition domain: a sibling move keeps the common parent", () =>
    Effect.gen(function* () {
      const { log, value } = yield* after("TO_SIBLING")
      assert.deepStrictEqual(value, { a: "a2" })
      assert.deepStrictEqual(log, ["ex a11", "ex a1", "t", "en a2"])
    })
  )

  it.effect("[S13] entering a parallel state enters its regions in document order", () =>
    Effect.gen(function* () {
      const { log, value } = yield* after("TO_P")
      assert.deepStrictEqual(value, { p: { x: "x1", y: "y1" } })
      assert.deepStrictEqual(log, ["ex a11", "ex a1", "ex a", "t", "en p", "en x", "en x1", "en y", "en y1"])
    })
  )

  it.effect("[S13] leaving a parallel state exits its regions in reverse document order", () =>
    Effect.gen(function* () {
      const { log, value } = yield* after("TO_P", "LEAVE")
      assert.deepStrictEqual(value, { b: { b1: "b11" } })
      assert.deepStrictEqual(log, ["ex y1", "ex y", "ex x1", "ex x", "ex p", "t", "en b", "en b1", "en b11"])
    })
  )
})
