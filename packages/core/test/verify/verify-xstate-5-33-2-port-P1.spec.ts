/**
 * P1: getPersistedSnapshot reflects the current state.
 *
 * T2.41. Upstream `Actor.getPersistedSnapshot` in `src/createActor.ts` at xstate@5.33.2
 * returns `this.logic.getPersistedSnapshot(this._snapshot, options)`: the persisted form of
 * the snapshot the actor holds now, so after several events it describes the current state
 * value and context. The port reads the actor's SubscriptionRef (D6: an Effect value on the
 * actor and on its reference). The Schema codec of the persisted form is T2.53, so these
 * tests compare the value and the context, and compare the whole persisted form with the
 * logic's own `getPersistedSnapshot` of the live snapshot. Read-your-writes `send` is T2.43
 * (SD-23), so the tests wait on `changes` until the events are processed.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option, Stream } from "effect"
import { assign, createActor, createMachine, type SnapshotType } from "../../src/index.js"

interface Switches {
  readonly switches: number
}

type LightEvent = { readonly type: "NEXT" }

const next = { actions: assign<Switches, LightEvent>(({ context }) => ({ switches: context.switches + 1 })) }

/** `green -NEXT-> yellow -NEXT-> red -NEXT-> green`; every switch counts. */
const lightMachine = () =>
  createMachine<Switches, LightEvent>({
    id: "p1-light",
    initial: "green",
    context: { switches: 0 },
    states: {
      green: { on: { NEXT: { target: "yellow", ...next } } },
      yellow: { on: { NEXT: { target: "red", ...next } } },
      red: { on: { NEXT: { target: "green", ...next } } },
    },
  })

/** Waits until the actor publishes a snapshot that satisfies `predicate`, and returns it. */
const reach = <S extends SnapshotType, E>(actor: { readonly changes: Stream.Stream<S, E> }, predicate: (snapshot: S) => boolean) =>
  actor.changes.pipe(Stream.filter(predicate), Stream.runHead, Effect.map(Option.getOrThrow))

/** Lets every other ready fiber take ten turns. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 10; turn++) {
    yield* Effect.yieldNow
  }
})

/**
 * `Some` of the value of `effect` when it completes while the other fibers take ten turns,
 * `None` when it is still waiting: a read that suspends until `start` gives `None`.
 */
const readWithoutWaiting = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.raceFirst(Effect.map(effect, Option.some), Effect.as(settle, Option.none<A>()))

/** The value and the context that a persisted machine snapshot describes. */
const described = (persisted: unknown) => {
  const { context, value } = persisted as { readonly value: unknown; readonly context: unknown }
  return { value, context }
}

describe("P1 getPersistedSnapshot reflects the current state", () => {
  it.effect("[P1] after several events getPersistedSnapshot describes the current state value and context", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(lightMachine())
      yield* actor.start
      yield* actor.send({ type: "NEXT" })
      yield* actor.send({ type: "NEXT" })
      yield* reach(actor, (snapshot) => snapshot.context.switches >= 2)

      const persisted = yield* actor.getPersistedSnapshot

      assert.deepStrictEqual(described(persisted), { value: "red", context: { switches: 2 } })
    })
  )

  it.effect("[P1] the actor's reference persists the current state too", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(lightMachine())
      yield* actor.start
      yield* actor.send({ type: "NEXT" })
      yield* actor.send({ type: "NEXT" })
      yield* actor.send({ type: "NEXT" })
      yield* reach(actor, (snapshot) => snapshot.context.switches >= 3)

      const persisted = yield* actor.ref.getPersistedSnapshot

      assert.deepStrictEqual(described(persisted), { value: "green", context: { switches: 3 } })
    })
  )

  it.effect("[P1] the persisted snapshot is the logic's persisted form of the live snapshot", () =>
    Effect.gen(function* () {
      const machine = lightMachine()
      const actor = yield* createActor(machine)
      yield* actor.start
      yield* actor.send({ type: "NEXT" })
      yield* reach(actor, (snapshot) => snapshot.context.switches >= 1)

      const persisted = yield* actor.getPersistedSnapshot
      const expected = yield* machine.getPersistedSnapshot(yield* actor.getSnapshot)

      assert.deepStrictEqual(persisted, expected)
      assert.deepStrictEqual(described(persisted), { value: "yellow", context: { switches: 1 } })
    })
  )

  it.effect("[P1] getPersistedSnapshot before start describes the initial state and does not wait for start", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(lightMachine())

      const fromActor = yield* readWithoutWaiting(actor.getPersistedSnapshot)
      const fromRef = yield* readWithoutWaiting(actor.ref.getPersistedSnapshot)

      assert.deepStrictEqual(Option.map(fromActor, described), Option.some({ value: "green", context: { switches: 0 } }))
      assert.deepStrictEqual(Option.map(fromRef, described), Option.some({ value: "green", context: { switches: 0 } }))
    })
  )
})
