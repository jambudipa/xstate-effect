/**
 * C15: getSnapshot returns the current snapshot.
 *
 * T2.41. Upstream `Actor.getSnapshot` in `src/createActor.ts` at xstate@5.33.2 returns
 * `this._snapshot`: the snapshot the actor holds now, from creation on, so it gives the
 * initial snapshot before `start` and the latest one after each processed event. The port
 * reads the actor's SubscriptionRef (D6: `getSnapshot` is an Effect value on the actor and on
 * its reference). Read-your-writes `send` is T2.43 (SD-23), so these tests wait on `changes`
 * until the events are processed, then read `getSnapshot`.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option, Stream } from "effect"
import { type ActorRefType, assign, createActor, createMachine, type MachineSnapshot, type SnapshotType } from "../../src/index.js"

interface Counter {
  readonly count: number
}

type CounterEvent = { readonly type: "increment" }

type CounterSnapshot = MachineSnapshot<Counter>

const counterMachine = () =>
  createMachine<Counter, CounterEvent>({
    id: "c15-counter",
    initial: "active",
    context: { count: 0 },
    states: {
      active: {
        on: {
          increment: { actions: assign<Counter, CounterEvent>(({ context }) => ({ count: context.count + 1 })) },
        },
      },
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
const readWithoutWaiting = <A>(effect: Effect.Effect<A>) =>
  Effect.raceFirst(Effect.map(effect, Option.some), Effect.as(settle, Option.none<A>()))

const countOf = (snapshot: SnapshotType): number => (snapshot as CounterSnapshot).context.count

describe("C15 getSnapshot returns the current snapshot", () => {
  it.effect("[C15] after two increments are processed, getSnapshot returns the snapshot with the count two", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(counterMachine())
      yield* actor.start
      yield* actor.send({ type: "increment" })
      yield* actor.send({ type: "increment" })
      yield* reach(actor, (snapshot) => snapshot.context.count >= 2)

      const snapshot = yield* actor.getSnapshot

      assert.strictEqual(snapshot.context.count, 2)
      assert.strictEqual(snapshot.status, "active")
      assert.strictEqual(snapshot.value, "active")
    })
  )

  it.effect("[C15] getSnapshot before start returns the initial snapshot and does not wait for start", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(counterMachine())

      const read = yield* readWithoutWaiting(actor.getSnapshot)

      assert.deepStrictEqual(Option.map(read, (snapshot) => snapshot.context.count), Option.some(0))
      assert.deepStrictEqual(Option.map(read, (snapshot) => snapshot.status), Option.some("active"))
    })
  )

  it.effect("[C15] the actor's reference reads the live snapshot through getSnapshot and getSnapshotUntyped", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(counterMachine())

      const beforeStart = yield* readWithoutWaiting(actor.ref.getSnapshot)
      const untypedBeforeStart = yield* readWithoutWaiting(actor.ref.getSnapshotUntyped)

      yield* actor.start
      yield* actor.send({ type: "increment" })
      yield* actor.send({ type: "increment" })
      yield* reach(actor, (snapshot) => snapshot.context.count >= 2)

      assert.deepStrictEqual(Option.map(beforeStart, countOf), Option.some(0))
      assert.deepStrictEqual(Option.map(untypedBeforeStart, countOf), Option.some(0))
      assert.strictEqual((yield* actor.ref.getSnapshot).context.count, 2)
      assert.strictEqual(countOf(yield* actor.ref.getSnapshotUntyped), 2)
    })
  )

  it.effect("[C15] a reference read back from the actor's system reads the live snapshot", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(counterMachine(), { systemId: "counter" })
      yield* actor.start

      const ref = Option.getOrThrow(yield* actor.system.get<ActorRefType<CounterSnapshot, CounterEvent>>("counter"))

      yield* actor.send({ type: "increment" })
      yield* actor.send({ type: "increment" })
      yield* reach(actor, (snapshot) => snapshot.context.count >= 2)

      assert.strictEqual(ref.sessionId, actor.sessionId)
      assert.strictEqual((yield* ref.getSnapshot).context.count, 2)
      assert.strictEqual(countOf(yield* ref.getSnapshotUntyped), 2)
    })
  )
})
