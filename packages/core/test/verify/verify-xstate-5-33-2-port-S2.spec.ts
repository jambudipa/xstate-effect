/**
 * S2: an initial state three or more levels deep gives the full state value.
 *
 * T2.33. `getInitialSnapshot` enters the initial configuration through the ported
 * configuration engine (`src/stateUtils.ts`; upstream `initialMicrostep`,
 * `getInitialStateNodes`, `getAllStateNodes` and `getStateValue` in `src/stateUtils.ts` at
 * xstate@5.33.2): every compound node on the initial path enters its initial child, the
 * state value is built from the whole configuration, the tags come from every active node,
 * and the entry actions of the configuration are collected in document order for `start`.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option, Result, Stream } from "effect"
import {
  type ActorLogicType,
  type ActorType,
  createActor,
  createMachine,
  type EventObject,
  getInitialSnapshot,
  type SnapshotType,
  Types,
} from "../../src/index.js"
import * as StateUtils from "../../src/stateUtils.js"

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
) => Effect.tap(createActor(logic, { id: "s2" }), (actor) => actor.start)

/** The initial snapshot of a machine (or any logic without input) through the pure `getInitialSnapshot` helper. */
const initialSnapshotOf = <S extends SnapshotType, E extends EventObject, Em extends EventObject, R>(
  logic: ActorLogicType<S, E, unknown, Em, R>
) => getInitialSnapshot(logic, undefined)

/** The actor's current snapshot (the first element of `changes` is the current one). */
const currentSnapshot = (actor: Pick<ActorType.Any, "changes">) =>
  actor.changes.pipe(
    Stream.runHead,
    Effect.map((snapshot) => Option.getOrThrow(snapshot) as unknown as { readonly value: unknown })
  )

/** The machine of upstream `initial.test.ts > should return the correct initial state`. */
const threeLevels = createMachine({
  id: "m",
  initial: "a",
  context: {},
  states: {
    a: {
      initial: "b",
      states: {
        b: {
          initial: "c",
          states: {
            c: {},
          },
        },
      },
    },
    leaf: {},
  },
})

/** Three nested levels below the root, with entry actions and tags on every level. */
const taggedMachine = (log: Array<string>) =>
  createMachine({
    id: "m",
    initial: "a",
    context: {},
    entry: recorder(log, "root"),
    tags: ["t-root"],
    states: {
      a: {
        initial: "b",
        entry: [recorder(log, "a1"), recorder(log, "a2")],
        tags: ["t-a"],
        states: {
          b: {
            initial: "c",
            entry: recorder(log, "b"),
            states: {
              c: { entry: recorder(log, "c"), tags: ["t-c"] },
              other: { entry: recorder(log, "b.other"), tags: ["t-other"] },
            },
          },
        },
      },
      leaf: { entry: recorder(log, "leaf"), tags: ["t-leaf"] },
    },
  })

describe("S2 an initial state three or more levels deep gives the full state value", () => {
  // upstream: test/initial.test.ts > Initial states > should return the correct initial state
  it.effect("[S2] an actor whose initial states nest three levels deep starts in the fully nested value", () =>
    Effect.gen(function* () {
      const actor = yield* startActor(threeLevels)

      const snapshot = yield* currentSnapshot(actor)
      assert.deepStrictEqual(snapshot.value, { a: { b: "c" } })
    })
  )

  it.effect("[S2] four nested initial levels give the whole path and no sibling", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        id: "deep",
        initial: "one",
        context: {},
        states: {
          one: {
            initial: "two",
            states: {
              two: {
                initial: "three",
                states: {
                  three: { initial: "four", states: { four: {}, other: {} } },
                  sibling: {},
                },
              },
            },
          },
          rest: {},
        },
      })

      const snapshot = yield* initialSnapshotOf(machine)
      assert.deepStrictEqual(snapshot.value, { one: { two: { three: "four" } } })
      assert.strictEqual(snapshot.status, "active")
    })
  )

  it.effect("[S2] the initial configuration holds every node on the initial path, in document order, with their tags", () =>
    Effect.gen(function* () {
      const machine = taggedMachine([])
      const step = Result.getOrThrow(StateUtils.initialMicrostep(machine.root))

      assert.deepStrictEqual(
        step.configuration.map((node) => node.id),
        ["m", "m.a", "m.a.b", "m.a.b.c"]
      )
      assert.deepStrictEqual(StateUtils.getStateValue(machine.root, step.configuration), { a: { b: "c" } })

      const snapshot = yield* initialSnapshotOf(machine)
      assert.deepStrictEqual(Array.from(snapshot.tags).sort(), ["t-a", "t-c", "t-root"])
    })
  )

  it.effect("[S2] the initial microstep collects the entry actions of the configuration in document order and start runs each once", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const machine = taggedMachine(log)
      const step = Result.getOrThrow(StateUtils.initialMicrostep(machine.root))

      assert.deepStrictEqual(
        step.actions.map((action) => (typeof action === "string" ? action : typeof action === "function" ? action.name : action.type)),
        ["root", "a1", "a2", "b", "c"]
      )
      assert.deepStrictEqual(log, [])

      const actor = yield* startActor(machine)
      const snapshot = yield* currentSnapshot(actor)

      assert.deepStrictEqual(snapshot.value, { a: { b: "c" } })
      assert.deepStrictEqual(log, ["root", "a1", "a2", "b", "c"])
    })
  )

  it.effect("[S2] getAllStateNodes completes a partial configuration with the initial descendants and every ancestor", () =>
    Effect.sync(() => {
      const machine = threeLevels
      const a = machine.root.states["a"]!
      const completed = StateUtils.getAllStateNodes([a])

      assert.deepStrictEqual(
        Array.from(completed, (node) => node.id).sort(),
        ["m", "m.a", "m.a.b", "m.a.b.c"]
      )
      // Upstream's native Set as a list in its insertion order (DEV-71): the given nodes, their
      // initial descendants, then the ancestors; xstate 5.33.2 gives these orders
      assert.isTrue(Array.isArray(completed))
      assert.deepStrictEqual(
        completed.map((node) => node.id),
        ["m.a", "m.a.b", "m.a.b.c", "m"]
      )
      const c = a.states["b"]!.states["c"]!
      assert.deepStrictEqual(
        StateUtils.getAllStateNodes([c]).map((node) => node.id),
        ["m.a.b.c", "m.a.b", "m.a", "m"]
      )
      assert.deepStrictEqual(StateUtils.getStateValue(machine.root, [a]), { a: { b: "c" } })
      assert.isTrue(StateUtils.isAtomicStateNode(a.states["b"]!.states["c"]!))
      assert.isFalse(StateUtils.isAtomicStateNode(a))
    })
  )

  it.effect("[S2] a root with no states starts with an empty state value and still collects its entry action", () =>
    Effect.gen(function* () {
      const machine = createMachine({ id: "empty", context: {}, entry: recorder([], "root") })

      const snapshot = yield* initialSnapshotOf(machine)
      assert.deepStrictEqual(snapshot.value, {})
      assert.strictEqual(snapshot.status, "active")

      const step = Result.getOrThrow(StateUtils.initialMicrostep(machine.root))
      assert.deepStrictEqual(step.configuration.map((node) => node.id), ["empty"])
      assert.deepStrictEqual(
        step.actions.map((action) => (typeof action === "string" ? action : typeof action === "function" ? action.name : action.type)),
        ["root"]
      )
    })
  )
})
