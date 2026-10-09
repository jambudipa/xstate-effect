/**
 * S14: entry actions of the initial state run at start.
 *
 * T2.40. Upstream `Actor` in `src/createActor.ts` at xstate@5.33.2: the constructor
 * computes the initial snapshot (`_initState`), so the initial microstep resolves its
 * actions at creation — an `assign` changes the context there — but the `actionExecutor`
 * only queues a custom action (and its `@xstate.action` inspection event) while the actor
 * is not running; `start` flushes the queue in `update`, in the order the engine collected
 * the actions (document order), once. An actor created from a snapshot (`snapshot`
 * option) computes no initial microstep, so no initial entry action runs for it.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option, Queue, Stream, SubscriptionRef } from "effect"
import { assign, createActor, createMachine, type SnapshotType } from "../../src/index.js"

interface Ctx {
  readonly count: number
}

type Ev = { readonly type: "NEXT" }

/**
 * `#s14` (entry `enterRoot`) with initial `a` (entry `a`, then `{ type: 'withParams',
 * params: { n: 1 } }`) whose initial child `a1` assigns `count: 1`, then runs `enterA1`;
 * `NEXT` moves from `a1` (exit `exitA1`) to `a2` (entry `enterA2`).
 */
const entryMachine = (log: Array<string>) => {
  const enterRoot = () => {
    log.push("root")
  }
  const enterA1 = ({ context }: { readonly context: Ctx }) => {
    log.push(`a1:${context.count}`)
  }
  const exitA1 = () => {
    log.push("exit a1")
  }
  const enterA2 = () => {
    log.push("a2")
  }
  return createMachine<Ctx, Ev>(
    {
      id: "s14",
      context: { count: 0 },
      initial: "a",
      entry: enterRoot,
      states: {
        a: {
          entry: ["a", { type: "withParams", params: { n: 1 } }],
          initial: "a1",
          states: {
            a1: {
              entry: [assign<Ctx, Ev>({ count: 1 }), enterA1],
              exit: exitA1,
              on: { NEXT: "a2" },
            },
            a2: { entry: enterA2 },
          },
        },
      },
    },
    {
      actions: {
        a: () => {
          log.push("a")
        },
        withParams: (_args, params) => {
          log.push(`withParams:${JSON.stringify(params)}`)
        },
      },
    }
  )
}

/** The initial entry actions in document order, as they log. */
const INITIAL_ENTRIES = ["root", "a", 'withParams:{"n":1}', "a1:1"]

/** Waits until the actor publishes a snapshot that satisfies `predicate`, and returns it. */
const reach = <S extends SnapshotType, E>(actor: { readonly changes: Stream.Stream<S, E> }, predicate: (snapshot: S) => boolean) =>
  actor.changes.pipe(Stream.filter(predicate), Stream.runHead, Effect.map(Option.getOrThrow))

/** Lets every other ready fiber run, so a wrongly started action would show. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 10; turn++) {
    yield* Effect.yieldNow
  }
})

const isAt = (value: unknown) => (snapshot: { readonly value: unknown }) => JSON.stringify(snapshot.value) === JSON.stringify(value)

describe("S14 entry actions of the initial state run at start", () => {
  it.effect("[S14] creating the actor runs no initial entry action, but the initial assign resolves", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const actor = yield* createActor(entryMachine(log))
      yield* settle

      assert.deepStrictEqual(log, [])
      const snapshot = yield* SubscriptionRef.get(actor.snapshot)
      assert.deepStrictEqual(snapshot.value, { a: "a1" })
      assert.deepStrictEqual(snapshot.context, { count: 1 })
    })
  )

  it.effect("[S14] start runs each initial entry action exactly once, in document order", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const actor = yield* createActor(entryMachine(log))

      yield* actor.start
      assert.deepStrictEqual(log, INITIAL_ENTRIES)

      // A second start and later events run none of them again
      yield* actor.start
      yield* actor.send({ type: "NEXT" })
      yield* reach(actor, isAt({ a: "a2" }))
      assert.deepStrictEqual(log, [...INITIAL_ENTRIES, "exit a1", "a2"])
    })
  )

  it.effect("[S14] the @xstate.action events of the initial custom actions arrive at start, in order", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const actor = yield* createActor(entryMachine(log))
      const inspected = yield* Queue.unbounded<string>()
      yield* actor.system.inspect((inspectionEvent) =>
        inspectionEvent.type === "@xstate.action"
          ? Queue.offer(inspected, `${inspectionEvent.action.type}:${JSON.stringify(inspectionEvent.action.params)}`).pipe(Effect.asVoid)
          : Effect.void
      )
      yield* settle
      assert.deepStrictEqual(yield* Queue.clear(inspected), [])

      yield* actor.start
      assert.deepStrictEqual(yield* Queue.clear(inspected), [
        "enterRoot:undefined",
        "a:undefined",
        'withParams:{"n":1}',
        "enterA1:undefined",
      ])
    })
  )

  it.effect("[S14] an actor created from a snapshot runs no initial entry action at start", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const first = yield* createActor(entryMachine(log))
      yield* first.start
      assert.deepStrictEqual(log, INITIAL_ENTRIES)
      const snapshot = yield* SubscriptionRef.get(first.snapshot)

      const restored = yield* createActor(entryMachine(log), { snapshot })
      yield* restored.start
      yield* settle
      assert.deepStrictEqual(log, INITIAL_ENTRIES)
      assert.deepStrictEqual((yield* SubscriptionRef.get(restored.snapshot)).value, { a: "a1" })

      // The restored actor goes on from the restored state
      yield* restored.send({ type: "NEXT" })
      yield* reach(restored, isAt({ a: "a2" }))
      assert.deepStrictEqual(log, [...INITIAL_ENTRIES, "exit a1", "a2"])
    })
  )
})
