/**
 * S12: `reenter` controls whether self and parent-to-child transitions re-enter.
 *
 * T2.34. Upstream `getTransitionDomain`, `computeExitSet` and `computeEntrySet` in
 * `src/stateUtils.ts` at xstate@5.33.2: without `reenter`, a transition whose targets are
 * the source or inside it has the source as its domain, so the source is neither exited
 * nor entered (only its active descendants are); with `reenter: true` the domain is the
 * source's parent, so the source exits and enters again.
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

/** Entry and exit recorders for a state named `name` (upstream `trackEntries` labels). */
const tracked = (log: Array<string>, name: string) => ({
  entry: recorder(log, `enter: ${name}`),
  exit: recorder(log, `exit: ${name}`),
})

/**
 * `foo (initial a) › a | b`, each state tracked. `foo` has a default self-transition, a
 * re-entering self-transition, a default parent-to-child transition and a re-entering
 * parent-to-child transition; `a` has a default and a re-entering atomic self-transition.
 */
const reenterMachine = (log: Array<string>) =>
  createMachine({
    id: "m",
    initial: "foo",
    context: {},
    states: {
      foo: {
        initial: "a",
        ...tracked(log, "foo"),
        on: {
          SELF: "foo",
          RESET: { target: "foo", reenter: true },
          TO_B: ".b",
          TO_B_REENTER: { target: ".b", reenter: true },
          NEXT: "foo.b",
        },
        states: {
          a: {
            ...tracked(log, "foo.a"),
            on: { ATOMIC_SELF: "a", ATOMIC_REENTER: { target: "a", reenter: true } },
          },
          b: tracked(log, "foo.b"),
        },
      },
    },
  })

/** The log and the next value after `events`, from the initial snapshot with its log cleared. */
const after = (...events: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const log: Array<string> = []
    const machine = reenterMachine(log)
    let snapshot = yield* initialSnapshotOf(machine)
    assert.deepStrictEqual(snapshot.value, { foo: "a" })
    for (const [index, type] of events.entries()) {
      // only the last event's actions are kept
      if (index === events.length - 1) {
        log.length = 0
      }
      snapshot = yield* nextSnapshotOf(machine, snapshot, { type })
    }
    return { log, value: snapshot.value }
  })

describe("S12 reenter controls whether self and parent-to-child transitions re-enter", () => {
  // upstream: test/internalTransitions.test.ts > internal transitions > parent state should enter child state without re-entering self
  it.effect("[S12] a default parent-to-child transition does not exit the parent", () =>
    Effect.gen(function* () {
      const { log, value } = yield* after("TO_B")
      assert.deepStrictEqual(value, { foo: "b" })
      assert.deepStrictEqual(log, ["exit: foo.a", "enter: foo.b"])
    })
  )

  // upstream: test/internalTransitions.test.ts > internal transitions > parent state should re-enter self upon transitioning to child state if transition is reentering
  it.effect("[S12] a re-entering parent-to-child transition exits and enters the parent", () =>
    Effect.gen(function* () {
      const { log, value } = yield* after("TO_B_REENTER")
      assert.deepStrictEqual(value, { foo: "b" })
      assert.deepStrictEqual(log, ["exit: foo.a", "exit: foo", "enter: foo", "enter: foo.b"])
    })
  )

  // upstream: test/internalTransitions.test.ts > internal transitions > parent state should only exit/reenter if there is an explicit self-transition
  it.effect("[S12] a re-entering self-transition exits and enters the source and enters its initial child", () =>
    Effect.gen(function* () {
      const { log, value } = yield* after("NEXT", "RESET")
      assert.deepStrictEqual(value, { foo: "a" })
      assert.deepStrictEqual(log, ["exit: foo.b", "exit: foo", "enter: foo", "enter: foo.a"])
    })
  )

  it.effect("[S12] a default self-transition on a compound state does not exit it; its active child moves to the initial child", () =>
    Effect.gen(function* () {
      const { log, value } = yield* after("NEXT", "SELF")
      assert.deepStrictEqual(value, { foo: "a" })
      assert.deepStrictEqual(log, ["exit: foo.b", "enter: foo.a"])
    })
  )

  it.effect("[S12] a default atomic self-transition exits and enters nothing; a re-entering one exits and enters the source", () =>
    Effect.gen(function* () {
      const plain = yield* after("ATOMIC_SELF")
      assert.deepStrictEqual(plain.value, { foo: "a" })
      assert.deepStrictEqual(plain.log, [])

      const reentering = yield* after("ATOMIC_REENTER")
      assert.deepStrictEqual(reentering.value, { foo: "a" })
      assert.deepStrictEqual(reentering.log, ["exit: foo.a", "enter: foo.a"])
    })
  )
})
