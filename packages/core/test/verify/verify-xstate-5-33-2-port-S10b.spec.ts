/**
 * S10b: conflicting transitions in parallel regions resolve as in SCXML.
 *
 * T2.34. Upstream `transitionNode` (with `transitionAtomicNode`, `transitionCompoundNode`,
 * `transitionParallelNode`), `StateNode.next` and `removeConflictingTransitions` in
 * `src/stateUtils.ts` and `src/StateNode.ts` at xstate@5.33.2: selection offers the deepest
 * enabled transition of each active region, in document order, and falls back to an
 * ancestor when no descendant handles the event. Two selected transitions conflict when
 * their exit sets intersect; the one whose source is a descendant of the other's source
 * wins, else the earlier one in document order wins. Each exited state runs its exit
 * actions once.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option, Result } from "effect"
import {
  type ActorLogicType,
  createMachine,
  type EventObject,
  getInitialSnapshot,
  getNextSnapshot,
  type MachineSnapshot,
  Types,
} from "../../src/index.js"
import * as StateUtils from "../../src/stateUtils.js"

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

/** A guard that never passes. */
const never = { type: "never", predicate: () => Effect.succeed(false) }

/**
 * A parallel state `p` with regions `a` (`a1 | a2`) and `b` (`b1 | b2`), and two root
 * states `out` and `out2` outside it.
 */
const regionsMachine = (log: Array<string>) =>
  createMachine({
    id: "m",
    initial: "p",
    context: {},
    states: {
      p: {
        type: "parallel",
        ...tracked(log, "p"),
        on: { UP: { target: "#m.out", actions: recorder(log, "t p") } },
        states: {
          a: {
            initial: "a1",
            ...tracked(log, "a"),
            on: { GUARDED: { actions: recorder(log, "t a") } },
            states: {
              a1: {
                ...tracked(log, "a1"),
                on: {
                  E: { target: "#m.out", actions: recorder(log, "t a1") },
                  SAME: { target: "#m.out", actions: recorder(log, "t a1") },
                  LOCAL: { target: "a2", actions: recorder(log, "t a1 local") },
                  GUARDED: { target: "a2", guard: never, actions: recorder(log, "t a1 guarded") },
                },
              },
              a2: tracked(log, "a2"),
            },
          },
          b: {
            initial: "b1",
            ...tracked(log, "b"),
            states: {
              b1: {
                ...tracked(log, "b1"),
                on: {
                  E: { target: "#m.out2", actions: recorder(log, "t b1") },
                  SAME: { target: "#m.out", actions: recorder(log, "t b1") },
                  LOCAL: { target: "b2", actions: recorder(log, "t b1 local") },
                  GUARDED: { actions: recorder(log, "t b1") },
                },
              },
              b2: tracked(log, "b2"),
            },
          },
        },
      },
      out: tracked(log, "out"),
      out2: tracked(log, "out2"),
    },
  })

/** The log and the next value after `event` from the initial snapshot of `regionsMachine`. */
const afterEvent = (event: EventObject) =>
  Effect.gen(function* () {
    const log: Array<string> = []
    const machine = regionsMachine(log)
    const initial = yield* initialSnapshotOf(machine)
    assert.deepStrictEqual(initial.value, { p: { a: "a1", b: "b1" } })
    log.length = 0
    const next = yield* nextSnapshotOf(machine, initial, event)
    return { log, value: next.value }
  })

/** The name of a planned action: the string itself, a function's name, or the definition's `type`. */
const actionType = (action: string | { readonly type: string } | ((...args: never) => unknown)): string =>
  typeof action === "string" ? action : typeof action === "function" ? action.name : action.type

describe("S10b conflicting transitions in parallel regions resolve as in SCXML", () => {
  it.effect("[S10b] two regions that leave the parallel state for different targets: the first region in document order wins", () =>
    Effect.gen(function* () {
      const { log, value } = yield* afterEvent({ type: "E" })
      assert.strictEqual(value, "out")
      assert.deepStrictEqual(log, ["ex b1", "ex b", "ex a1", "ex a", "ex p", "t a1", "en out"])
    })
  )

  it.effect("[S10b] two regions that leave for the same target: one transition runs and each state exits once", () =>
    Effect.gen(function* () {
      const { log, value } = yield* afterEvent({ type: "SAME" })
      assert.strictEqual(value, "out")
      assert.deepStrictEqual(log, ["ex b1", "ex b", "ex a1", "ex a", "ex p", "t a1", "en out"])
    })
  )

  it.effect("[S10b] transitions inside their own regions do not conflict and both run", () =>
    Effect.gen(function* () {
      const { log, value } = yield* afterEvent({ type: "LOCAL" })
      assert.deepStrictEqual(value, { p: { a: "a2", b: "b2" } })
      assert.deepStrictEqual(log, ["ex b1", "ex a1", "t a1 local", "t b1 local", "en a2", "en b2"])
    })
  )

  it.effect("[S10b] a region whose candidate guard fails offers its ancestor's transition, and every region is selected", () =>
    Effect.gen(function* () {
      const { log, value } = yield* afterEvent({ type: "GUARDED" })
      assert.deepStrictEqual(value, { p: { a: "a1", b: "b1" } })
      assert.deepStrictEqual(log, ["t a", "t b1"])
    })
  )

  it.effect("[S10b] the parallel state handles an event that no region handles", () =>
    Effect.gen(function* () {
      const { log, value } = yield* afterEvent({ type: "UP" })
      assert.strictEqual(value, "out")
      assert.deepStrictEqual(log, ["ex b1", "ex b", "ex a1", "ex a", "ex p", "t p", "en out"])
    })
  )

  it.effect("[S10b] of two conflicting transitions, the one whose source is a descendant wins in either order", () =>
    Effect.sync(() => {
      const log: Array<string> = []
      const machine = regionsMachine(log)
      const p = machine.root.states["p"]!
      const a1 = p.states["a"]!.states["a1"]!
      const configuration = Option.getOrThrow(StateUtils.resolveConfiguration(machine.root, { p: { a: "a1", b: "b1" } }))
      const fromParent = {
        source: p,
        target: [machine.root.states["out"]!],
        definition: Option.none(),
        reenter: false,
        actions: [recorder(log, "t p")],
      }
      const fromDescendant = {
        source: a1,
        target: [machine.root.states["out2"]!],
        definition: Option.none(),
        reenter: false,
        actions: [recorder(log, "t a1")],
      }

      for (const transitions of [[fromParent, fromDescendant], [fromDescendant, fromParent]]) {
        const step = Result.getOrThrow(StateUtils.microstep(transitions, configuration))
        assert.deepStrictEqual(step.actions.map(actionType), ["ex b1", "ex b", "ex a1", "ex a", "ex p", "t a1", "en out2"])
        assert.deepStrictEqual(
          step.entered.map((node) => node.id),
          ["m.out2"]
        )
        assert.deepStrictEqual(
          step.configuration.map((node) => node.id),
          ["m", "m.out2"]
        )
      }
    })
  )
})
