/**
 * S8: history states restore the last configuration.
 *
 * T2.35. Upstream `resolveHistoryDefaultTransition`, `getEffectiveTargetStates`,
 * `exitStates` (history recording) and `addDescendantStatesToEnter` (restore) in
 * `src/stateUtils.ts`, the history normalisation in `src/StateNode.ts`, and
 * `serializeHistoryValue` in `src/State.ts`, at xstate@5.33.2. Leaving a state records,
 * for each history child, the active direct children (shallow) or the active atomic
 * descendants (deep) in `snapshot.historyValue`, keyed by the history node id. Entering a
 * history state restores that record; a history state without a record takes its default
 * `target`, else its parent's initial state (every region for a parallel parent). The
 * persisted snapshot holds the recorded nodes as `{ id }` objects. A history `target` that
 * names no child is a `createMachine` definition error (SD-3, amended 2026-10-08: the machine
 * keeps it, and its initial snapshot fails with it).
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, HashMap, Option } from "effect"
import {
  type ActorLogicType,
  createMachine,
  Errors,
  type EventObject,
  getInitialSnapshot,
  getNextSnapshot,
  type MachineConfig,
  type MachineSnapshot,
  StateNode,
  Types,
} from "../../src/index.js"
import { childStateDoesNotExist } from "./upstream-messages.js"

/** The initial snapshot through `getInitialSnapshot`, widened until T2.40 (as S2 and S3 do). */
const initialSnapshotOf = (machine: object): Effect.Effect<MachineSnapshot> =>
  getInitialSnapshot(machine as ActorLogicType.Any, undefined) as unknown as Effect.Effect<MachineSnapshot>

/** The next snapshot through `getNextSnapshot` (same widening). */
const nextSnapshotOf = (machine: object, snapshot: MachineSnapshot, event: EventObject): Effect.Effect<MachineSnapshot> =>
  getNextSnapshot(machine as ActorLogicType.Any, snapshot, event) as unknown as Effect.Effect<MachineSnapshot>

/** The persisted form of a snapshot through the machine's `getPersistedSnapshot` (same widening). */
const persistedOf = (machine: object, snapshot: MachineSnapshot): Effect.Effect<unknown, unknown> =>
  (machine as ActorLogicType.Any).getPersistedSnapshot(snapshot)

/** The snapshot after each event in turn, from the initial snapshot. */
const afterEvents = (machine: object, types: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    let snapshot = yield* initialSnapshotOf(machine)
    for (const type of types) {
      snapshot = yield* nextSnapshotOf(machine, snapshot, { type })
    }
    return snapshot
  })

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
 * The message of the definition error that `createMachine(config)` keeps (SD-3, amended
 * 2026-10-08), or none for a valid config: the machine's initial snapshot fails with an
 * `InitializationError` of the upstream message, whose cause is the `MachineDefinitionError`.
 */
const definitionErrorOf = (config: MachineConfig<object, EventObject>): Effect.Effect<Option.Option<string>> =>
  getInitialSnapshot(createMachine(config)).pipe(
    Effect.as(Option.none<string>()),
    Effect.catch((error) =>
      Effect.sync(() => {
        assert.instanceOf(error, Errors.InitializationError)
        assert.instanceOf(error.cause, Errors.MachineDefinitionError)
        return Option.some(error.message)
      })
    )
  )

/** The ids of the nodes each history node recorded, by history node id. */
const recordedIds = (snapshot: MachineSnapshot): Record<string, ReadonlyArray<string>> =>
  Object.fromEntries(Object.entries(snapshot.historyValue).map(([key, nodes]) => [key, nodes.map((node) => node.id)]))

/**
 * `off` and `on (initial first) › first | second (initial A) › A | B (initial P) › P | Q`.
 * `on` has four history children: `shallow`, `deep`, `withDefault` (`type: 'history'`
 * with the default target `second.B`) and `plain` (`type: 'history'`, no `history` field,
 * no target). Every state is tracked.
 */
const historyMachine = (log: Array<string>) =>
  createMachine({
    id: "m",
    initial: "off",
    context: {},
    states: {
      off: {
        ...tracked(log, "off"),
        on: {
          ON: "on",
          SHALLOW: "on.shallow",
          DEEP: "on.deep",
          DEFAULT: "on.withDefault",
          PLAIN: "on.plain",
        },
      },
      on: {
        initial: "first",
        ...tracked(log, "on"),
        on: { POWER: "off" },
        states: {
          first: { ...tracked(log, "on.first"), on: { SWITCH: "second" } },
          second: {
            initial: "A",
            ...tracked(log, "on.second"),
            states: {
              A: { ...tracked(log, "on.second.A"), on: { INNER: "B" } },
              B: {
                initial: "P",
                ...tracked(log, "on.second.B"),
                states: {
                  P: { ...tracked(log, "on.second.B.P"), on: { INNER: "Q" } },
                  Q: tracked(log, "on.second.B.Q"),
                },
              },
            },
          },
          shallow: { history: "shallow" },
          deep: { history: "deep" },
          withDefault: { type: "history", target: "second.B" },
          plain: { type: "history" },
        },
      },
    },
  })

/** From `off` into `on.second.B.Q`, then back to `off`: every history child of `on` records. */
const visitDeepAndLeave = ["ON", "SWITCH", "INNER", "INNER", "POWER"]

/**
 * `off` and a parallel state `p` with regions `regA (a1 | a2)` and
 * `regB (b1 | b2 (initial x) › x | y)`, plus a deep and a shallow (`history: true`)
 * history child of `p`.
 */
const parallelMachine = (log: Array<string>) =>
  createMachine({
    id: "m",
    initial: "off",
    context: {},
    states: {
      off: { ...tracked(log, "off"), on: { GO: "p", DEEP: "p.deep", SHALLOW: "p.shallow" } },
      p: {
        type: "parallel",
        ...tracked(log, "p"),
        on: { POWER: "off" },
        states: {
          regA: {
            initial: "a1",
            ...tracked(log, "p.regA"),
            states: { a1: { ...tracked(log, "p.regA.a1"), on: { NEXT_A: "a2" } }, a2: {} },
          },
          regB: {
            initial: "b1",
            ...tracked(log, "p.regB"),
            states: {
              b1: { ...tracked(log, "p.regB.b1"), on: { NEXT_B: "b2" } },
              b2: { initial: "x", states: { x: { on: { NEXT_X: "y" } }, y: {} } },
            },
          },
          deep: { history: "deep" },
          shallow: { history: true },
        },
      },
    },
  })

describe("S8 history states restore the last configuration", () => {
  it.effect("[S8] shallow history restores the most recently active direct child with its default descendants", () =>
    Effect.gen(function* () {
      const machine = historyMachine([])
      const snapshot = yield* afterEvents(machine, [...visitDeepAndLeave, "SHALLOW"])
      assert.deepStrictEqual(snapshot.value, { on: { second: "A" } })
    })
  )

  it.effect("[S8] deep history restores the full descendant configuration", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const machine = historyMachine(log)
      const left = yield* afterEvents(machine, visitDeepAndLeave)
      log.length = 0
      const snapshot = yield* nextSnapshotOf(machine, left, { type: "DEEP" })
      assert.deepStrictEqual(snapshot.value, { on: { second: { B: "Q" } } })
      assert.deepStrictEqual(log, [
        "exit: off",
        "enter: on",
        "enter: on.second",
        "enter: on.second.B",
        "enter: on.second.B.Q",
      ])
    })
  )

  it.effect("[S8] a history state never visited takes its default target, without entering the parent's initial state", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const machine = historyMachine(log)
      const initial = yield* initialSnapshotOf(machine)
      log.length = 0
      const snapshot = yield* nextSnapshotOf(machine, initial, { type: "DEFAULT" })
      assert.deepStrictEqual(snapshot.value, { on: { second: { B: "P" } } })
      assert.deepStrictEqual(log, [
        "exit: off",
        "enter: on",
        "enter: on.second",
        "enter: on.second.B",
        "enter: on.second.B.P",
      ])
      assert.deepStrictEqual(snapshot.historyValue, {})
    })
  )

  it.effect("[S8] a history state never visited and without a default target enters its parent's initial state", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const machine = historyMachine(log)
      const initial = yield* initialSnapshotOf(machine)
      for (const type of ["SHALLOW", "DEEP", "PLAIN"]) {
        log.length = 0
        const snapshot = yield* nextSnapshotOf(machine, initial, { type })
        assert.deepStrictEqual(snapshot.value, { on: "first" })
        assert.deepStrictEqual(log, ["exit: off", "enter: on", "enter: on.first"])
      }
    })
  )

  it.effect("[S8] a history state with a default target restores its record once its parent was visited", () =>
    Effect.gen(function* () {
      const machine = historyMachine([])
      const snapshot = yield* afterEvents(machine, ["ON", "SWITCH", "POWER", "DEFAULT"])
      assert.deepStrictEqual(snapshot.value, { on: { second: "A" } })
    })
  )

  it.effect("[S8] snapshot.historyValue records the exited configuration per history node, as the machine's state nodes", () =>
    Effect.gen(function* () {
      const machine = historyMachine([])
      const initial = yield* initialSnapshotOf(machine)
      assert.deepStrictEqual(initial.historyValue, {})

      const left = yield* afterEvents(machine, visitDeepAndLeave)
      assert.deepStrictEqual(recordedIds(left), {
        "m.on.shallow": ["m.on.second"],
        "m.on.deep": ["m.on.second.B.Q"],
        "m.on.withDefault": ["m.on.second"],
        "m.on.plain": ["m.on.second"],
      })
      for (const nodes of Object.values(left.historyValue)) {
        for (const node of nodes) {
          assert.strictEqual(node, Option.getOrThrow(HashMap.get(machine.idMap, node.id)))
          assert.instanceOf(node, StateNode)
        }
      }

      // The next exit replaces each record with the configuration active at that exit.
      const again = yield* afterEvents(machine, [...visitDeepAndLeave, "SHALLOW", "POWER"])
      assert.deepStrictEqual(recordedIds(again), {
        "m.on.shallow": ["m.on.second"],
        "m.on.deep": ["m.on.second.A"],
        "m.on.withDefault": ["m.on.second"],
        "m.on.plain": ["m.on.second"],
      })
    })
  )

  it.effect("[S8] the persisted snapshot holds the history value as state node ids", () =>
    Effect.gen(function* () {
      const machine = historyMachine([])
      const left = yield* afterEvents(machine, visitDeepAndLeave)
      const persisted = yield* persistedOf(machine, left)
      const expected = {
        "m.on.shallow": [{ id: "m.on.second" }],
        "m.on.deep": [{ id: "m.on.second.B.Q" }],
        "m.on.withDefault": [{ id: "m.on.second" }],
        "m.on.plain": [{ id: "m.on.second" }],
      }
      assert.deepStrictEqual((persisted as { readonly historyValue: unknown }).historyValue, expected)
      const roundTrip: unknown = JSON.parse(JSON.stringify(persisted))
      assert.deepStrictEqual((roundTrip as { readonly historyValue: unknown }).historyValue, expected)
    })
  )

  it.effect("[S8] `history: true` normalises to 'shallow'; a `type: 'history'` node without a `history` field restores as shallow", () =>
    Effect.gen(function* () {
      const shallowByTrue = parallelMachine([]).root.states["p"]!.states["shallow"]!
      assert.strictEqual(shallowByTrue.type, "history")
      // A node's `history` is upstream's plain field: the kind, or `false` (T8.8)
      assert.strictEqual(shallowByTrue.history, "shallow")

      const machine = historyMachine([])
      const on = machine.root.states["on"]!
      assert.strictEqual(on.states["deep"]!.history, "deep")
      // Such a node has `history: false`, as upstream's; it records and restores as shallow.
      assert.strictEqual(on.states["plain"]!.type, "history")
      assert.strictEqual(on.states["plain"]!.history, false)
      const snapshot = yield* afterEvents(machine, [...visitDeepAndLeave, "PLAIN"])
      assert.deepStrictEqual(snapshot.value, { on: { second: "A" } })

      // `history: false` without a `type` is an ordinary atomic state (upstream).
      const notHistory = createMachine({
        id: "n",
        initial: "a",
        context: {},
        states: { a: {}, b: { history: false } },
      })
      assert.strictEqual(notHistory.root.states["b"]!.type, "atomic")
      assert.strictEqual(notHistory.root.states["b"]!.history, false)
    })
  )

  it.effect("[S8] a history node directly under a parallel state: never visited it enters every region's default", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const machine = parallelMachine(log)
      const initial = yield* initialSnapshotOf(machine)
      for (const type of ["DEEP", "SHALLOW"]) {
        log.length = 0
        const snapshot = yield* nextSnapshotOf(machine, initial, { type })
        assert.deepStrictEqual(snapshot.value, { p: { regA: "a1", regB: "b1" } })
        assert.deepStrictEqual(log, [
          "exit: off",
          "enter: p",
          "enter: p.regA",
          "enter: p.regA.a1",
          "enter: p.regB",
          "enter: p.regB.b1",
        ])
      }
    })
  )

  it.effect("[S8] a history node directly under a parallel state: deep restores every region's leaf, shallow every region", () =>
    Effect.gen(function* () {
      const machine = parallelMachine([])
      const visited = ["GO", "NEXT_A", "NEXT_B", "NEXT_X"]
      const active = yield* afterEvents(machine, visited)
      assert.deepStrictEqual(active.value, { p: { regA: "a2", regB: { b2: "y" } } })

      const deep = yield* afterEvents(machine, [...visited, "POWER", "DEEP"])
      assert.deepStrictEqual(deep.value, { p: { regA: "a2", regB: { b2: "y" } } })
      assert.deepStrictEqual(recordedIds(deep), {
        "m.p.deep": ["m.p.regA.a2", "m.p.regB.b2.y"],
        "m.p.shallow": ["m.p.regA", "m.p.regB"],
      })

      const shallow = yield* afterEvents(machine, [...visited, "POWER", "SHALLOW"])
      assert.deepStrictEqual(shallow.value, { p: { regA: "a1", regB: "b1" } })
    })
  )

  it.effect("[S8] a re-entering transition to a history state restores the configuration its own exit recorded", () =>
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
            on: { REENTER: { target: "#b_hist", reenter: true } },
            states: {
              a1: { ...tracked(log, "a.a1"), on: { NEXT: "a2" } },
              a2: tracked(log, "a.a2"),
              a3: { type: "history", id: "b_hist" },
            },
          },
        },
      })
      const next = yield* afterEvents(machine, ["NEXT"])
      log.length = 0
      const reentered = yield* nextSnapshotOf(machine, next, { type: "REENTER" })
      assert.deepStrictEqual(reentered.value, { a: "a2" })
      assert.deepStrictEqual(log, ["exit: a.a2", "exit: a", "enter: a", "enter: a.a2"])
    })
  )

  it.effect("[S8] entering a history state does not enter ancestors outside the transition domain", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const machine = createMachine({
        id: "m",
        initial: "closed",
        context: {},
        states: {
          closed: { ...tracked(log, "closed"), on: { CLICK: "open.hist" } },
          open: {
            initial: "first",
            ...tracked(log, "open"),
            on: { CLICK: "closed" },
            states: {
              hist: { type: "history" },
              first: { ...tracked(log, "open.first"), on: { NEXT: "second" } },
              second: tracked(log, "open.second"),
            },
          },
        },
      })
      const initial = yield* initialSnapshotOf(machine)
      log.length = 0
      yield* nextSnapshotOf(machine, initial, { type: "CLICK" })
      assert.deepStrictEqual(log, ["exit: closed", "enter: open", "enter: open.first"])

      const closedAgain = yield* afterEvents(machine, ["CLICK", "NEXT", "CLICK"])
      log.length = 0
      const restored = yield* nextSnapshotOf(machine, closedAgain, { type: "CLICK" })
      assert.deepStrictEqual(restored.value, { open: "second" })
      assert.deepStrictEqual(log, ["exit: closed", "enter: open", "enter: open.second"])
    })
  )

  it.effect("[S8] the parent's initial actions run only when an unrecorded history state without a target is entered", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const machine = createMachine({
        id: "m",
        initial: "a",
        context: {},
        states: {
          a: { on: { PLAIN: "#plain", WITH_TARGET: "#withTarget" } },
          b: {
            initial: { target: "b1", actions: recorder(log, "initial b") },
            on: { BACK: "a" },
            states: {
              b1: {},
              b2: { type: "history", id: "plain" },
              b3: { type: "history", id: "withTarget", target: "b4" },
              b4: {},
            },
          },
        },
      })

      yield* afterEvents(machine, ["PLAIN"])
      assert.deepStrictEqual(log, ["initial b"])

      log.length = 0
      yield* afterEvents(machine, ["WITH_TARGET"])
      assert.deepStrictEqual(log, [])

      const back = yield* afterEvents(machine, ["PLAIN", "BACK"])
      log.length = 0
      yield* nextSnapshotOf(machine, back, { type: "PLAIN" })
      assert.deepStrictEqual(log, [])
    })
  )

  it.effect("[S8] a history default target that names no child is a createMachine definition error with the upstream message", () =>
    Effect.gen(function* () {
      const message = yield* definitionErrorOf({
        id: "m",
        initial: "a",
        context: {},
        states: {
          a: { initial: "a1", states: { a1: {}, hist: { type: "history", target: "nope" } } },
        },
      })
      assert.deepStrictEqual(message, Option.some(childStateDoesNotExist("nope", "m.a")))
    })
  )
})
