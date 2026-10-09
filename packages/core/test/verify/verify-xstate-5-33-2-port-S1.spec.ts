/**
 * S1: a sibling target resolves when the machine id prefixes the state name.
 *
 * T2.34. A port regression test (eque2-reference §6.1; no upstream test closes this row).
 * Targets resolve relative to the source's parent by key, as upstream `resolveTarget` in
 * `src/stateUtils.ts` at xstate@5.33.2 does, so a machine id that is a prefix of a state
 * name (`light` and `lightOn`) plays no part in the lookup.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option, Stream } from "effect"
import {
  type ActorLogicType,
  type ActorType,
  createActor,
  createMachine,
  type EventObject,
  getInitialSnapshot,
  getNextSnapshot,
  getTransitions,
  type MachineSnapshot,
  type SnapshotType,
} from "../../src/index.js"

/**
 * The initial snapshot of a machine through the pure `getInitialSnapshot` helper. Until
 * T2.40 makes a machine an `ActorLogic` for the type checker, the helper widens it and
 * reads the result as a machine snapshot (as the S2 and S3 specs do).
 */
const initialSnapshotOf = (machine: object): Effect.Effect<MachineSnapshot> =>
  getInitialSnapshot(machine as ActorLogicType.Any, undefined) as unknown as Effect.Effect<MachineSnapshot>

/** The next snapshot of a machine through the pure `getNextSnapshot` helper (same widening). */
const nextSnapshotOf = (machine: object, snapshot: MachineSnapshot, event: EventObject): Effect.Effect<MachineSnapshot> =>
  getNextSnapshot(machine as ActorLogicType.Any, snapshot, event) as unknown as Effect.Effect<MachineSnapshot>

/** Creates and starts an actor of `logic`. */
const startActor = <S extends SnapshotType, E extends EventObject, Em extends EventObject, R>(
  logic: ActorLogicType<S, E, unknown, Em, R>
) => Effect.tap(createActor(logic, { id: "s1" }), (actor) => actor.start)

const valueOf = (snapshot: object): unknown => ("value" in snapshot ? snapshot.value : undefined)

/** Waits until the actor's state value is `value`, and returns it. */
const reach = (actor: Pick<ActorType.Any, "changes">, value: string) =>
  actor.changes.pipe(
    Stream.map(valueOf),
    Stream.filter((current) => current === value),
    Stream.runHead,
    Effect.map(Option.getOrThrow)
  )

/** Machine `light`: `lightOff -TOGGLE-> lightOn -TOGGLE-> lightOff`. */
const lightMachine = () =>
  createMachine({
    id: "light",
    initial: "lightOff",
    context: {},
    states: {
      lightOff: { on: { TOGGLE: "lightOn" } },
      lightOn: { on: { TOGGLE: "lightOff" } },
    },
  })

describe("S1 a sibling target resolves when the machine id prefixes the state name", () => {
  it.effect("[S1] machine light moves from lightOff to lightOn and back", () =>
    Effect.gen(function* () {
      const machine = lightMachine()
      const initial = yield* initialSnapshotOf(machine)
      assert.strictEqual(initial.value, "lightOff")

      const on = yield* nextSnapshotOf(machine, initial, { type: "TOGGLE" })
      assert.strictEqual(on.value, "lightOn")

      const off = yield* nextSnapshotOf(machine, on, { type: "TOGGLE" })
      assert.strictEqual(off.value, "lightOff")
    })
  )

  it.effect("[S1] the target resolves to the sibling node, not to a path below the machine id", () =>
    Effect.sync(() => {
      const machine = lightMachine()
      const [transition] = getTransitions(machine.root.states["lightOff"]!, "TOGGLE")
      const targets = transition?.target ?? []
      assert.deepStrictEqual(
        targets.map((node) => node.id),
        ["light.lightOn"]
      )
      assert.strictEqual(targets[0], machine.root.states["lightOn"])
    })
  )

  it.effect("[S1] a sibling whose key equals the machine id is a sibling, not the root", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        id: "light",
        initial: "lightOff",
        context: {},
        states: {
          lightOff: { on: { TO_LIGHT: "light", TO_LIGHT_ON: "lightOn" } },
          light: {},
          lightOn: {},
        },
      })
      const initial = yield* initialSnapshotOf(machine)

      const toLight = yield* nextSnapshotOf(machine, initial, { type: "TO_LIGHT" })
      assert.strictEqual(toLight.value, "light")

      const toLightOn = yield* nextSnapshotOf(machine, initial, { type: "TO_LIGHT_ON" })
      assert.strictEqual(toLightOn.value, "lightOn")
    })
  )

  it.effect("[S1] an actor of machine light enters lightOn on TOGGLE", () =>
    Effect.gen(function* () {
      const actor = yield* startActor(lightMachine())
      yield* reach(actor, "lightOff")

      yield* actor.send({ type: "TOGGLE" })
      const value = yield* reach(actor, "lightOn")
      assert.strictEqual(value, "lightOn")
    })
  )
})
