/**
 * C16b: subscription emission follows XState.
 *
 * T2.41. Upstream `Actor.subscribe` in `src/createActor.ts` at xstate@5.33.2 adds an
 * observer and calls nothing at subscription time; `update()` calls every observer once per
 * processed event (also when the event changes nothing), and `start()` calls
 * `update(this._snapshot, initEvent)`, so an observer added before `start` receives the
 * initial snapshot once, at `start` (SD-24). The port's `changes` stream keeps its
 * "current, then each published snapshot" semantics (SD-24), is live when it is read before
 * `start`, and `snapshotStream.stream` gives the current snapshot once, then each published
 * snapshot. Ordering is proved by these tests, never by fork timing (@ASSUMPTION:AS2.a):
 * each count is read after the events are processed and every fiber had its turns.
 */
import { assert, describe, it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Option, Stream } from "effect"
import { assign, createActor, createMachine, type SnapshotType } from "../../src/index.js"

interface Counter {
  readonly count: number
}

/** `ping` has no transition: processing it changes nothing. */
type CounterEvent = { readonly type: "increment" } | { readonly type: "ping" }

const counterMachine = () =>
  createMachine<Counter, CounterEvent>({
    id: "c16b-counter",
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

/** Lets every other ready fiber take ten turns, so a subscriber takes what it was sent. */
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

describe("C16b Subscription emission follows XState", () => {
  it.effect("[C16b] a subscriber added to a started actor receives exactly one snapshot for one processed event and nothing at subscription time", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(counterMachine())
      yield* actor.start
      const received: Array<number> = []

      yield* actor.subscribe((snapshot) => Effect.sync(() => received.push(snapshot.context.count)))
      yield* settle
      const atSubscription = [...received]

      yield* actor.send({ type: "increment" })
      yield* reach(actor, (snapshot) => snapshot.context.count >= 1)
      yield* settle

      assert.deepStrictEqual(atSubscription, [])
      assert.deepStrictEqual(received, [1])
    })
  )

  it.effect("[C16b] a subscriber receives one snapshot per processed event, also for an event that changes nothing", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(counterMachine())
      yield* actor.start
      const received: Array<number> = []
      yield* actor.subscribe((snapshot) => Effect.sync(() => received.push(snapshot.context.count)))

      yield* actor.send({ type: "increment" })
      yield* actor.send({ type: "ping" })
      yield* actor.send({ type: "increment" })
      yield* reach(actor, (snapshot) => snapshot.context.count >= 2)
      yield* settle

      assert.deepStrictEqual(received, [1, 1, 2])
    })
  )

  it.effect("[C16b] a subscriber added before start receives nothing before start and the initial snapshot once, at start", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(counterMachine())
      const received: Array<number> = []
      yield* actor.subscribe((snapshot) => Effect.sync(() => received.push(snapshot.context.count)))
      yield* settle
      const beforeStart = [...received]

      yield* actor.start
      yield* settle
      const atStart = [...received]

      yield* actor.send({ type: "increment" })
      yield* reach(actor, (snapshot) => snapshot.context.count >= 1)
      yield* settle

      assert.deepStrictEqual(beforeStart, [])
      assert.deepStrictEqual(atStart, [0])
      assert.deepStrictEqual(received, [0, 1])
    })
  )

  it.effect("[C16b] changes read before start gives the current snapshot at once and the snapshots published after start", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(counterMachine())
      const changes = actor.changes

      const head = yield* readWithoutWaiting(Stream.runHead(changes))

      yield* actor.start
      yield* actor.send({ type: "increment" })
      const reached = yield* changes.pipe(Stream.filter((snapshot) => snapshot.context.count >= 1), Stream.runHead)

      assert.deepStrictEqual(Option.map(Option.flatten(head), (snapshot) => snapshot.context.count), Option.some(0))
      assert.deepStrictEqual(Option.map(reached, (snapshot) => snapshot.context.count), Option.some(1))
    })
  )

  it.effect("[C16b] snapshotStream.stream gives the current snapshot once, then each published snapshot", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(counterMachine())
      yield* actor.start
      yield* actor.send({ type: "increment" })
      yield* reach(actor, (snapshot) => snapshot.context.count >= 1)

      const first = yield* Deferred.make<void>()
      const collector = yield* actor.snapshotStream.stream.pipe(
        Stream.tap(() => Deferred.succeed(first, undefined)),
        Stream.map((snapshot) => snapshot.context.count),
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild
      )
      yield* Deferred.await(first)
      yield* settle

      yield* actor.send({ type: "increment" })
      const counts = yield* Fiber.join(collector)

      assert.deepStrictEqual(counts, [1, 2])
    })
  )
})
