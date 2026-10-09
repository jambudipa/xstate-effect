/**
 * S11: a targetless transition runs its actions without exit or entry.
 *
 * T2.34. Upstream `computeExitSet` and `computeEntrySet` in `src/stateUtils.ts` at
 * xstate@5.33.2: a transition without a target has an empty exit set and enters nothing,
 * so only its own actions run and the configuration stays. A `""` target is upstream's
 * `TARGETLESS_KEY` (`normalizeTarget`), which also gives a targetless transition.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import {
  type ActorLogicType,
  assign,
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

interface Counter {
  readonly count: number
}

/** `a (initial a1) › a1 | a2`, each state tracked, with targetless transitions on `a1` and `a`. */
const targetlessMachine = (log: Array<string>) =>
  createMachine<Counter, EventObject>({
    id: "m",
    initial: "a",
    context: { count: 0 },
    states: {
      a: {
        initial: "a1",
        ...tracked(log, "a"),
        on: { PARENT: { actions: recorder(log, "t a") } },
        states: {
          a1: {
            ...tracked(log, "a1"),
            on: {
              E: { actions: recorder(log, "t a1") },
              EMPTY: { target: "", actions: recorder(log, "t empty") },
              COUNT: { actions: assign<Counter, EventObject>(({ context }) => ({ count: context.count + 1 })) },
              NEXT: "a2",
            },
          },
          a2: tracked(log, "a2"),
        },
      },
    },
  })

/** The initial snapshot of `targetlessMachine` with the entry log cleared. */
const started = (log: Array<string>) =>
  Effect.gen(function* () {
    const machine = targetlessMachine(log)
    const initial = yield* initialSnapshotOf(machine)
    assert.deepStrictEqual(initial.value, { a: "a1" })
    log.length = 0
    return { machine, initial }
  })

describe("S11 a targetless transition runs actions without exit or entry", () => {
  // upstream: test/internalTransitions.test.ts > internal transitions > should work with targetless transitions (in object)
  it.effect("[S11] a targetless transition on a nested state runs its action, and no exit or entry action runs", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const { machine, initial } = yield* started(log)
      const next = yield* nextSnapshotOf(machine, initial, { type: "E" })
      assert.deepStrictEqual(next.value, { a: "a1" })
      assert.deepStrictEqual(log, ["t a1"])
    })
  )

  // upstream: test/internalTransitions.test.ts > internal transitions > should maintain the child state when targetless transition is handled by parent
  it.effect("[S11] a targetless transition on the parent keeps the active child", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const { machine, initial } = yield* started(log)
      const inA2 = yield* nextSnapshotOf(machine, initial, { type: "NEXT" })
      assert.deepStrictEqual(inA2.value, { a: "a2" })
      log.length = 0

      const next = yield* nextSnapshotOf(machine, inA2, { type: "PARENT" })
      assert.deepStrictEqual(next.value, { a: "a2" })
      assert.deepStrictEqual(log, ["t a"])
    })
  )

  it.effect("[S11] an empty target is targetless, as upstream TARGETLESS_KEY", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const { machine, initial } = yield* started(log)
      const next = yield* nextSnapshotOf(machine, initial, { type: "EMPTY" })
      assert.deepStrictEqual(next.value, { a: "a1" })
      assert.deepStrictEqual(log, ["t empty"])
    })
  )

  it.effect("[S11] a targetless assign changes the context and nothing else", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const { machine, initial } = yield* started(log)
      const next = yield* nextSnapshotOf(machine, initial, { type: "COUNT" })
      assert.deepStrictEqual(next.value, { a: "a1" })
      assert.deepStrictEqual(next.context, { count: 1 })
      assert.deepStrictEqual(log, [])
    })
  )
})
