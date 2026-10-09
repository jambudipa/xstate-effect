/**
 * S10: a transition can enter multiple targets.
 *
 * T2.34. Upstream `computeEntrySet`, `addAncestorStatesToEnter` and `getTransitionDomain` in
 * `src/stateUtils.ts` at xstate@5.33.2: each target is entered with its ancestors up to the
 * transition domain, and a parallel ancestor gets every region that no target lies in,
 * entered by default. The machine is upstream `multiple.test.ts`. Upstream skips its six
 * "should reject ..." tests (invalid target sets are not enforced); the port builds such
 * machines as upstream does, and the six tests stay ledgered (`CONFORMANCE.md`, D19).
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import {
  type ActorLogicType,
  createMachine,
  type EventObject,
  getInitialSnapshot,
  getNextSnapshot,
  getTransitions,
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

/** Upstream `multiple.test.ts`: `simple` targets states inside the parallel state `para`. */
const multipleMachine = (log: Array<string>) =>
  createMachine({
    id: "m",
    initial: "simple",
    context: {},
    states: {
      simple: {
        ...tracked(log, "simple"),
        on: {
          DEEP_M: "para.K.M",
          DEEP_CM: [{ target: ["para.A.C", "para.K.M"] }],
          DEEP_MR: [{ target: ["para.K.M", "para.P.R"] }],
          DEEP_CMR: [{ target: ["para.A.C", "para.K.M", "para.P.R"] }],
          INITIAL: "para",
        },
      },
      para: {
        type: "parallel",
        ...tracked(log, "para"),
        states: {
          A: { initial: "B", ...tracked(log, "A"), states: { B: tracked(log, "B"), C: tracked(log, "C") } },
          K: { initial: "L", ...tracked(log, "K"), states: { L: tracked(log, "L"), M: tracked(log, "M") } },
          P: { initial: "Q", ...tracked(log, "P"), states: { Q: tracked(log, "Q"), R: tracked(log, "R") } },
        },
      },
    },
  })

describe("S10 a transition can enter multiple targets", () => {
  // upstream: test/multiple.test.ts > multiple > transitions to parallel states > should enter initial states of parallel states
  // upstream: test/multiple.test.ts > multiple > transitions to parallel states > should enter specific states in one region
  // upstream: test/multiple.test.ts > multiple > transitions to parallel states > should enter specific states in all regions
  // upstream: test/multiple.test.ts > multiple > transitions to parallel states > should enter specific states in some regions
  it.effect("[S10] targets in different regions of a parallel state are all entered; the other regions start at their initial states", () =>
    Effect.gen(function* () {
      const machine = multipleMachine([])
      const initial = yield* initialSnapshotOf(machine)

      const cases: ReadonlyArray<readonly [string, unknown]> = [
        ["INITIAL", { para: { A: "B", K: "L", P: "Q" } }],
        ["DEEP_M", { para: { A: "B", K: "M", P: "Q" } }],
        ["DEEP_CM", { para: { A: "C", K: "M", P: "Q" } }],
        ["DEEP_CMR", { para: { A: "C", K: "M", P: "R" } }],
        ["DEEP_MR", { para: { A: "B", K: "M", P: "R" } }],
      ]
      for (const [type, value] of cases) {
        const next = yield* nextSnapshotOf(machine, initial, { type })
        assert.deepStrictEqual(next.value, value, type)
      }
    })
  )

  it.effect("[S10] a multi-target transition resolves every target to its node", () =>
    Effect.sync(() => {
      const machine = multipleMachine([])
      const [transition] = getTransitions(machine.root.states["simple"]!, "DEEP_CMR")
      assert.deepStrictEqual(
        (transition?.target ?? []).map((node) => node.id),
        ["m.para.A.C", "m.para.K.M", "m.para.P.R"]
      )
    })
  )

  it.effect("[S10] the entered states run their entry actions once each, in document order", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const machine = multipleMachine(log)
      const initial = yield* initialSnapshotOf(machine)
      log.length = 0

      const next = yield* nextSnapshotOf(machine, initial, { type: "DEEP_CM" })
      assert.deepStrictEqual(next.value, { para: { A: "C", K: "M", P: "Q" } })
      assert.deepStrictEqual(log, ["ex simple", "en para", "en A", "en C", "en K", "en M", "en P", "en Q"])
    })
  )

  it.effect("[S10] a target set that upstream does not validate still builds, as upstream (six skipped upstream tests stay ledgered)", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        id: "m",
        initial: "simple",
        context: {},
        states: {
          simple: { on: { SAME_REGION: [{ target: ["para.A.C", "para.A.B"] }] } },
          para: {
            type: "parallel",
            states: {
              A: { initial: "B", states: { B: {}, C: {} } },
              K: { initial: "L", states: { L: {}, M: {} } },
            },
          },
        },
      })
      const initial = yield* initialSnapshotOf(machine)
      assert.strictEqual(initial.value, "simple")
    })
  )
})
