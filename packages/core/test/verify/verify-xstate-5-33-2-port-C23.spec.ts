/**
 * C23: events sent before start are processed at start.
 *
 * T2.40. Upstream `Actor.start` in `src/createActor.ts` at xstate@5.33.2: the mailbox holds
 * every event sent to an actor that is created and not started, and `start` processes
 * them in send order after the initial snapshot is published (`this.mailbox.start()` comes
 * last). Upstream warns only for an event sent to a stopped actor, so nothing is logged
 * here (SD-23). A test logger captures every log entry (SD-21). Each test also lets the
 * fibers settle and reads `getSnapshot`, so an event that is processed twice fails it.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Logger, Option, Stream, SubscriptionRef } from "effect"
import { assign, createActor, createMachine, type SnapshotType } from "../../src/index.js"

interface Counter {
  readonly count: number
}

type CounterEvent = { readonly type: "increment" }

const counterMachine = () =>
  createMachine<Counter, CounterEvent>({
    id: "c23-counter",
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

interface Seen {
  readonly seen: ReadonlyArray<string>
}

type Letter = { readonly type: "A" } | { readonly type: "B" } | { readonly type: "C" }

/** Appends the type of each event it receives to `seen`. */
const recorderMachine = () => {
  const record = { actions: assign<Seen, Letter>(({ context, event }) => ({ seen: [...context.seen, event.type] })) }
  return createMachine<Seen, Letter>({
    id: "c23-recorder",
    initial: "active",
    context: { seen: [] },
    states: { active: { on: { A: record, B: record, C: record } } },
  })
}

/** Waits until the actor publishes a snapshot that satisfies `predicate`, and returns it. */
const reach = <S extends SnapshotType, E>(actor: { readonly changes: Stream.Stream<S, E> }, predicate: (snapshot: S) => boolean) =>
  actor.changes.pipe(Stream.filter(predicate), Stream.runHead, Effect.map(Option.getOrThrow))

/** Lets every other ready fiber take ten turns. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 10; turn++) {
    yield* Effect.yieldNow
  }
})

/** Runs `program` with a logger that keeps every entry at warning level or above. */
const withWarningsCaptured = <A, E, R>(program: Effect.Effect<A, E, R>) => {
  const warnings: Array<unknown> = []
  return program.pipe(
    Effect.provide(
      Logger.layer([
        Logger.make((options) => {
          if (options.logLevel === "Warn" || options.logLevel === "Error" || options.logLevel === "Fatal") {
            warnings.push(options.message)
          }
        }),
      ])
    ),
    Effect.map((result) => ({ result, warnings }))
  )
}

describe("C23 events sent before start are processed at start", () => {
  it.effect("[C23] two increments sent before start are processed at start and the count is two, with no warning", () =>
    Effect.gen(function* () {
      const { result, warnings } = yield* withWarningsCaptured(
        Effect.gen(function* () {
          const actor = yield* createActor(counterMachine())
          yield* actor.send({ type: "increment" })
          yield* actor.send({ type: "increment" })
          const beforeStart = (yield* SubscriptionRef.get(actor.snapshot)).context.count

          yield* actor.start
          const counted = yield* reach(actor, (snapshot) => snapshot.context.count >= 2)
          yield* settle
          const settled = (yield* actor.getSnapshot).context.count
          return { beforeStart, count: counted.context.count, settled }
        })
      )

      assert.strictEqual(result.beforeStart, 0)
      assert.strictEqual(result.count, 2)
      assert.strictEqual(result.settled, 2)
      assert.deepStrictEqual(warnings, [])
    })
  )

  it.effect("[C23] events sent before start are processed in send order", () =>
    Effect.gen(function* () {
      const { result, warnings } = yield* withWarningsCaptured(
        Effect.gen(function* () {
          const actor = yield* createActor(recorderMachine())
          yield* actor.send({ type: "C" })
          yield* actor.send({ type: "A" })
          yield* actor.send({ type: "B" })

          yield* actor.start
          const reached = yield* reach(actor, (snapshot) => snapshot.context.seen.length >= 3)
          yield* settle
          const settled = yield* actor.getSnapshot
          return { reached, settled }
        })
      )

      assert.deepStrictEqual(result.reached.context.seen, ["C", "A", "B"])
      assert.deepStrictEqual(result.settled.context.seen, ["C", "A", "B"])
      assert.deepStrictEqual(warnings, [])
    })
  )
})
