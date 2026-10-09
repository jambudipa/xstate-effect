/**
 * C8: observable and stream actors update their snapshot and unsubscribe on stop.
 *
 * T2.50. Upstream (`actors/observable.ts` at xstate@5.33.2): `start` (skipped for a `done`
 * snapshot) calls the creator with `{ input, system, self, emit }` and subscribes. The observer
 * relays `xstate.observable.next`, `xstate.observable.error` and `xstate.observable.complete` to
 * the actor itself through the system. `transition` changes only an active snapshot: a value
 * becomes `context`, an error gives status `error` with the error, completion gives `done` with
 * no output; `xstate.stop` unsubscribes and gives `stopped`. A source that completed or errored
 * is never unsubscribed. `fromEventObservable` relays each emitted event to the parent and keeps
 * `context` empty. The parent hears of done and error through the actor's own status routing,
 * so it gets exactly one event.
 *
 * The port keeps `context` as an Option (SD-17) and the error as the raw value (SD-4). The
 * subscription lives in the actor's own scope (D12): a stop closes the scope, which
 * unsubscribes. Values the source pushes from plain code go out at once, inside the call, in a
 * fiber of that scope (T4.13), so they never wait for another event. `fromStream` (a port extra) runs its stream in the actor's
 * scope with the same events: each element is the context, the end is `done`, a failure is
 * `error`, and a stop interrupts the stream. Phase-2 children are spawned (SD-15).
 */
import { assert, describe, it } from "@effect/vitest"
import { Cause, Effect, Logger, Option, Queue, Stream } from "effect"
import type { ActorRefBase } from "../../src/ActorRef.js"
import {
  type ActorSystemService,
  type ActorType,
  type AnyActorLogic,
  assign,
  createActor,
  createMachine,
  Errors,
  type EventObject,
  fromEventObservable,
  fromObservable,
  fromStream,
  isActor,
  type ObservableActorRef,
  spawnChild,
  stopChild,
  type Subscribable,
} from "../../src/index.js"

/** Lets every other ready fiber take ten turns. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 10; turn++) {
    yield* Effect.yieldNow
  }
})

/** Yields until `condition` holds, at most 200 turns; gives whether it holds. */
const eventually = (condition: Effect.Effect<boolean>) =>
  Effect.gen(function* () {
    for (let turn = 0; turn < 200; turn++) {
      if (yield* condition) {
        return true
      }
      yield* Effect.yieldNow
    }
    return yield* condition
  })

/** The log entries a test logger kept. */
type Entries = Array<Logger.Options<unknown>>

/** Runs `program` with a logger that keeps every log entry in `entries`. */
const withLogger = <A, E, R>(entries: Entries, program: Effect.Effect<A, E, R>) =>
  program.pipe(
    Effect.provide(
      Logger.layer([
        Logger.make((options) => {
          entries.push(options)
        }),
      ])
    )
  )

/** The text of every Warn-level entry. */
const warnings = (entries: Entries): ReadonlyArray<string> =>
  entries
    .filter((entry) => entry.logLevel === "Warn")
    .map((entry) => (Array.isArray(entry.message) ? entry.message : [entry.message]).map(String).join(" "))

/** The child actor behind a reference; fails the test when the reference is not an actor. */
const asActor = (ref: ActorRefBase | undefined): ActorType.Any => {
  assert.isTrue(isActor(ref), "the reference is an actor")
  return ref as ActorType.Any
}

/** The status the actor's snapshot has now. */
const statusOf = (actor: Pick<ActorType.Any, "getSnapshot">) => Effect.map(actor.getSnapshot, (snapshot) => snapshot.status)

/** The context the actor's snapshot has now (an Option for observable and stream logic). */
const contextOf = (actor: Pick<ActorType.Any, "getSnapshot">) =>
  Effect.map(actor.getSnapshot, (snapshot): unknown => (snapshot as { readonly context?: unknown }).context)

/** Whether the actor's context is `Some(value)` now. */
const hasContext = (actor: Pick<ActorType.Any, "getSnapshot">, value: unknown) =>
  Effect.map(contextOf(actor), (context) => Option.isOption(context) && Option.contains(context, value))

/** An observer as a source calls it. */
interface Observer<T> {
  readonly next?: (value: T) => void
  readonly error?: (error: unknown) => void
  readonly complete?: () => void
}

/**
 * A source the test drives from plain code, outside every actor. It counts subscriptions and
 * unsubscriptions, and it keeps calling an observer after its unsubscription, so a test can
 * prove that the actor ignores such a call.
 */
const makeSource = <T>() => {
  const observers: Array<Observer<T>> = []
  const counts = { subscribed: 0, unsubscribed: 0 }
  const observable: Subscribable<T> = {
    subscribe: (observer) => {
      counts.subscribed++
      observers.push(observer)
      return {
        unsubscribe: () => {
          counts.unsubscribed++
        },
      }
    },
  }
  return {
    observable,
    counts,
    subscribed: Effect.sync(() => counts.subscribed > 0),
    next: (value: T) =>
      Effect.sync(() => {
        for (const observer of observers) {
          observer.next?.(value)
        }
      }),
    error: (error: unknown) =>
      Effect.sync(() => {
        for (const observer of observers) {
          observer.error?.(error)
        }
      }),
    complete: Effect.sync(() => {
      for (const observer of observers) {
        observer.complete?.()
      }
    }),
  }
}

interface Received {
  readonly received: ReadonlyArray<unknown>
}

/** Keeps every event the parent takes, in order. */
const record = assign<Received, EventObject>(({ context, event }) => ({ received: [...context.received, event] }))

/**
 * A parent that spawns `child` as `obs` in state `a` and stops it when it leaves `a` on NEXT
 * (upstream: an invoke ends with its state). The parent keeps the child's done and error events
 * and every COUNT event.
 */
const parentOf = <TLogic extends AnyActorLogic>(child: TLogic) =>
  createMachine<Received, EventObject>({
    id: "c8-parent",
    context: { received: [] },
    initial: "a",
    states: {
      a: {
        entry: spawnChild<Received, EventObject, TLogic>(child, { id: "obs" }),
        exit: stopChild<Received, EventObject>("obs"),
        on: { NEXT: "b" },
      },
      b: {},
    },
    on: {
      COUNT: { actions: record },
      "xstate.done.actor.obs": { actions: record },
      "xstate.error.actor.obs": { actions: record },
    },
  })

/** An actor of a parent from `parentOf`, as the helpers read it. */
interface ParentActor {
  readonly getSnapshot: Effect.Effect<{
    readonly context: Received
    readonly children: Readonly<Record<string, ActorRefBase>>
  }>
}

/** The child `obs` of a parent actor. */
const childOf = (actor: ParentActor) => Effect.map(actor.getSnapshot, (snapshot) => asActor(snapshot.children["obs"]))

/** The events a parent from `parentOf` has kept. */
const receivedBy = (actor: ParentActor) => Effect.map(actor.getSnapshot, (snapshot) => snapshot.context.received)

/** Waits until the parent has kept `count` events, then lets any further delivery run. */
const receivedCount = (actor: ParentActor, count: number) =>
  Effect.gen(function* () {
    const reached = yield* eventually(Effect.map(receivedBy(actor), (received) => received.length >= count))
    yield* settle
    return reached
  })

/** One `@xstate.event` inspection event of an actor: who sent it, and the event. */
interface Inspected {
  readonly source: Option.Option<ActorRefBase>
  readonly event: EventObject
}

/** Keeps every `@xstate.event` inspection event whose target is `actor`, until the test ends. */
const inspectEventsOf = (actor: ActorRefBase & Pick<ActorType.Any, "system">, into: Array<Inspected>) =>
  actor.system.inspect((inspection) =>
    Effect.sync(() => {
      if (inspection.type === "@xstate.event" && inspection.actorRef === actor) {
        into.push({ source: inspection.sourceRef, event: inspection.event })
      }
    })
  )

/** Whether one of the inspected events came from `source` through the system relay. */
const relayedFrom = (inspected: ReadonlyArray<Inspected>, source: ActorRefBase) =>
  inspected.some((entry) => Option.exists(entry.source, (sender) => sender === source))

describe("C8 Observable and stream actors update their snapshot and unsubscribe on stop", () => {
  it.effect("[C8] each value an observable emits sets the snapshot context to Some(value), and a subscriber sees each value", () =>
    Effect.gen(function* () {
      const source = makeSource<number>()
      const actor = yield* createActor(fromObservable(() => source.observable))
      const seen: Array<unknown> = []
      yield* actor.subscribe((snapshot) =>
        Effect.sync(() => {
          seen.push(snapshot.context)
        })
      )
      yield* actor.start
      assert.isTrue(yield* eventually(source.subscribed), "the actor subscribes")

      for (const value of [1, 2, 3]) {
        yield* source.next(value)
        assert.isTrue(yield* eventually(hasContext(actor, value)), `the context becomes Some(${value})`)
      }
      assert.isTrue(yield* eventually(Effect.sync(() => seen.length === 4)), "the subscriber sees every value")

      assert.deepStrictEqual(seen, [Option.none(), Option.some(1), Option.some(2), Option.some(3)])
      assert.strictEqual(yield* statusOf(actor), "active")
    })
  )

  it.effect("[C8] completion gives status done with output None, and the parent receives exactly one xstate.done.actor.<id>", () =>
    Effect.gen(function* () {
      const source = makeSource<number>()
      const actor = yield* createActor(parentOf(fromObservable(() => source.observable)))
      yield* actor.start
      const child = yield* childOf(actor)
      assert.isTrue(yield* eventually(source.subscribed), "the child subscribes")

      yield* source.next(7)
      yield* source.complete
      assert.isTrue(yield* receivedCount(actor, 1), "the parent hears of it")

      assert.deepStrictEqual(yield* receivedBy(actor), [{ type: "xstate.done.actor.obs", output: Option.none(), actorId: "obs" }])
      const snapshot = yield* child.getSnapshot
      assert.strictEqual(snapshot.status, "done")
      assert.deepStrictEqual(yield* contextOf(child), Option.some(7))
      assert.deepStrictEqual(snapshot.output, Option.none())
      // A source that completed is not unsubscribed (upstream drops the subscription)
      assert.strictEqual(source.counts.unsubscribed, 0)
    })
  )

  it.effect("[C8] an error gives status error with the raw value, and the parent receives exactly one xstate.error.actor.<id>", () =>
    Effect.gen(function* () {
      const failure = { reason: "the observable failed" }
      const source = makeSource<number>()
      const actor = yield* createActor(parentOf(fromObservable(() => source.observable)))
      yield* actor.start
      const child = yield* childOf(actor)
      assert.isTrue(yield* eventually(source.subscribed), "the child subscribes")

      yield* source.next(1)
      yield* source.error(failure)
      assert.isTrue(yield* receivedCount(actor, 1), "the parent hears of it")

      assert.deepStrictEqual(yield* receivedBy(actor), [{ type: "xstate.error.actor.obs", error: failure, actorId: "obs" }])
      const snapshot = yield* child.getSnapshot
      assert.strictEqual(snapshot.status, "error")
      assert.strictEqual(Option.getOrUndefined(snapshot.error), failure)
      assert.notInstanceOf(Option.getOrUndefined(snapshot.error), Errors.StartError)
      assert.strictEqual(yield* statusOf(actor), "active")
      // A source that errored is not unsubscribed (upstream drops the subscription)
      assert.strictEqual(source.counts.unsubscribed, 0)
    })
  )

  it.effect("[C8] stopping the actor unsubscribes once, and a value after the stop changes nothing and reaches no subscriber", () => {
    const entries: Entries = []
    return withLogger(
      entries,
      Effect.gen(function* () {
        const source = makeSource<number>()
        const actor = yield* createActor(fromObservable(() => source.observable))
        const seen: Array<unknown> = []
        yield* actor.subscribe((snapshot) =>
          Effect.sync(() => {
            seen.push(snapshot.context)
          })
        )
        yield* actor.start
        assert.isTrue(yield* eventually(source.subscribed), "the actor subscribes")
        yield* source.next(1)
        assert.isTrue(yield* eventually(hasContext(actor, 1)), "the context becomes Some(1)")
        assert.isTrue(yield* eventually(Effect.sync(() => seen.length === 2)), "the subscriber sees the value")

        yield* actor.stop
        assert.strictEqual(yield* statusOf(actor), "stopped")
        assert.strictEqual(source.counts.unsubscribed, 1)

        // The source ignores the unsubscription; the actor ignores the calls
        yield* source.next(2)
        yield* source.complete
        yield* settle
        assert.strictEqual(yield* statusOf(actor), "stopped")
        assert.deepStrictEqual(yield* contextOf(actor), Option.some(1))
        assert.deepStrictEqual(seen, [Option.none(), Option.some(1)])
        assert.strictEqual(source.counts.unsubscribed, 1)
        assert.deepStrictEqual(warnings(entries).filter((text) => text.includes("stopped actor")), [])
      })
    )
  })

  it.effect("[C8] when the state that spawned it exits, the observable is unsubscribed exactly once, and the parent receives nothing from it afterwards", () =>
    Effect.gen(function* () {
      const source = makeSource<number>()
      const actor = yield* createActor(parentOf(fromObservable(() => source.observable)))
      yield* actor.start
      const child = yield* childOf(actor)
      assert.isTrue(yield* eventually(source.subscribed), "the child subscribes")
      yield* source.next(1)
      assert.isTrue(yield* eventually(hasContext(child, 1)), "the child's context becomes Some(1)")

      // Leaving `a` stops the child
      yield* actor.send({ type: "NEXT" })
      assert.isTrue(yield* eventually(Effect.map(statusOf(child), (status) => status === "stopped")), "the child stops")
      assert.strictEqual(source.counts.unsubscribed, 1)

      yield* source.next(2)
      yield* source.complete
      yield* settle
      assert.deepStrictEqual(yield* receivedBy(actor), [])
      assert.deepStrictEqual(yield* contextOf(child), Option.some(1))

      // Stopping the parent afterwards unsubscribes no more
      yield* actor.stop
      assert.strictEqual(source.counts.unsubscribed, 1)
    })
  )

  it.effect("[C8] the creator receives { emit, input, self, system }; an emit in its own code reaches the listeners inside start, and a later emit reaches them with no other event", () =>
    Effect.gen(function* () {
      const source = makeSource<number>()
      const seen: Array<{ readonly keys: ReadonlyArray<string>; readonly input: unknown; readonly self: unknown; readonly system: unknown }> = []
      const emits: Array<(event: { readonly type: "c8.sync" | "c8.later" }) => void> = []
      // The upstream generic order: context, input, emitted events (SD-12)
      const logic = fromObservable<number, { readonly n: number }, { readonly type: "c8.sync" | "c8.later" }>((args) => {
        const self: ObservableActorRef<number> = args.self
        const system: ActorSystemService = args.system
        seen.push({ keys: [...Object.keys(args)].sort(), input: args.input, self, system })
        args.emit({ type: "c8.sync" })
        emits.push(args.emit)
        return source.observable
      })
      const input = { n: 1 }
      const actor = yield* createActor(logic, { input })
      const emitted: Array<unknown> = []
      yield* actor.on("*", (event) =>
        Effect.sync(() => {
          emitted.push(event)
        })
      )

      yield* actor.start
      assert.deepStrictEqual(emitted, [{ type: "c8.sync" }])

      yield* Effect.sync(() => emits[0]?.({ type: "c8.later" }))
      assert.isTrue(yield* eventually(Effect.sync(() => emitted.length === 2)), "the later emit reaches the listener")
      assert.deepStrictEqual(emitted, [{ type: "c8.sync" }, { type: "c8.later" }])

      assert.strictEqual(seen.length, 1)
      assert.deepStrictEqual(seen[0]?.keys, ["emit", "input", "self", "system"])
      assert.strictEqual(seen[0]?.input, input)
      assert.strictEqual(seen[0]?.self, actor)
      assert.strictEqual(seen[0]?.system, actor.system)
    })
  )

  it.effect("[C8] a throw in the creator gives status error with the thrown value (not a StartError), and the parent receives xstate.error.actor.<id>", () =>
    Effect.gen(function* () {
      const boom = { reason: "thrown in the creator" }
      const actor = yield* createActor(
        parentOf(
          fromObservable((): Subscribable<number> => {
            throw boom
          })
        )
      )
      yield* actor.start
      const child = yield* childOf(actor)
      assert.isTrue(yield* receivedCount(actor, 1), "the parent hears of it")

      const snapshot = yield* child.getSnapshot
      assert.strictEqual(snapshot.status, "error")
      assert.strictEqual(Option.getOrUndefined(snapshot.error), boom)
      assert.deepStrictEqual(yield* receivedBy(actor), [{ type: "xstate.error.actor.obs", error: boom, actorId: "obs" }])
    })
  )

  it.effect("[C8] a done snapshot given at creation does not subscribe to the observable again", () =>
    Effect.gen(function* () {
      const source = makeSource<number>()
      const logic = fromObservable(() => source.observable)
      const first = yield* createActor(logic)
      yield* first.start
      assert.isTrue(yield* eventually(source.subscribed), "the first actor subscribes")
      yield* source.next(3)
      yield* source.complete
      assert.isTrue(yield* eventually(Effect.map(statusOf(first), (status) => status === "done")), "the first actor is done")
      const persisted = yield* first.getPersistedSnapshot

      const restored = yield* createActor(logic, { snapshot: persisted })
      yield* restored.start
      yield* settle

      assert.strictEqual(source.counts.subscribed, 1)
      assert.strictEqual(yield* statusOf(restored), "done")
      assert.deepStrictEqual(yield* contextOf(restored), Option.some(3))
    })
  )

  it.effect("[C8] an event observable relays each emitted event to its parent through the system relay, and its own context stays None", () =>
    Effect.gen(function* () {
      const source = makeSource<{ readonly type: "COUNT"; readonly val: number }>()
      const actor = yield* createActor(parentOf(fromEventObservable(() => source.observable)))
      const inspected: Array<Inspected> = []
      yield* inspectEventsOf(actor, inspected)
      yield* actor.start
      const child = yield* childOf(actor)
      assert.isTrue(yield* eventually(source.subscribed), "the child subscribes")

      yield* source.next({ type: "COUNT", val: 1 })
      yield* source.next({ type: "COUNT", val: 2 })
      assert.isTrue(yield* receivedCount(actor, 2), "the parent receives both events")

      assert.deepStrictEqual(yield* receivedBy(actor), [{ type: "COUNT", val: 1 }, { type: "COUNT", val: 2 }])
      assert.isTrue(relayedFrom(inspected, child), "the system relays the events from the child to the parent")
      assert.deepStrictEqual(yield* contextOf(child), Option.none())

      yield* source.complete
      assert.isTrue(yield* receivedCount(actor, 3), "the parent hears of the completion")
      assert.deepStrictEqual((yield* receivedBy(actor)).slice(2), [{ type: "xstate.done.actor.obs", output: Option.none(), actorId: "obs" }])
      assert.strictEqual(yield* statusOf(child), "done")
    })
  )

  it.effect("[C8] a stream actor sets the context per element, ends done with output None, and the parent receives exactly one done event", () =>
    Effect.gen(function* () {
      const queue = yield* Queue.unbounded<number, Cause.Done>()
      const actor = yield* createActor(parentOf(fromStream(() => Stream.fromQueue(queue))))
      yield* actor.start
      const child = yield* childOf(actor)

      for (const value of [1, 2]) {
        yield* Queue.offer(queue, value)
        assert.isTrue(yield* eventually(hasContext(child, value)), `the context becomes Some(${value})`)
      }
      yield* Queue.end(queue)
      assert.isTrue(yield* receivedCount(actor, 1), "the parent hears of the end")

      assert.deepStrictEqual(yield* receivedBy(actor), [{ type: "xstate.done.actor.obs", output: Option.none(), actorId: "obs" }])
      const snapshot = yield* child.getSnapshot
      assert.strictEqual(snapshot.status, "done")
      assert.deepStrictEqual(yield* contextOf(child), Option.some(2))
      assert.deepStrictEqual(snapshot.output, Option.none())
    })
  )

  it.effect("[C8] a failing stream gives status error with the raw failure, and the parent receives exactly one error event", () =>
    Effect.gen(function* () {
      const failure = { reason: "the stream failed" }
      const queue = yield* Queue.unbounded<number, typeof failure | Cause.Done>()
      const actor = yield* createActor(parentOf(fromStream(() => Stream.fromQueue(queue))))
      yield* actor.start
      const child = yield* childOf(actor)

      yield* Queue.offer(queue, 1)
      assert.isTrue(yield* eventually(hasContext(child, 1)), "the context becomes Some(1)")
      yield* Queue.fail(queue, failure)
      assert.isTrue(yield* receivedCount(actor, 1), "the parent hears of the failure")

      assert.deepStrictEqual(yield* receivedBy(actor), [{ type: "xstate.error.actor.obs", error: failure, actorId: "obs" }])
      const snapshot = yield* child.getSnapshot
      assert.strictEqual(snapshot.status, "error")
      assert.strictEqual(Option.getOrUndefined(snapshot.error), failure)
    })
  )

  it.effect("[C8] start returns while a stream runs, and stopping the actor interrupts the stream once, with no element after the stop", () =>
    Effect.gen(function* () {
      let finalized = 0
      const queue = yield* Queue.unbounded<number, Cause.Done>()
      const logic = fromStream(() =>
        Stream.fromQueue(queue).pipe(
          Stream.ensuring(
            Effect.sync(() => {
              finalized++
            })
          )
        )
      )
      const actor = yield* createActor(logic)
      yield* actor.start
      assert.strictEqual(yield* statusOf(actor), "active")

      yield* Queue.offer(queue, 1)
      assert.isTrue(yield* eventually(hasContext(actor, 1)), "the context becomes Some(1)")

      yield* actor.stop
      assert.isTrue(yield* eventually(Effect.sync(() => finalized === 1)), "the stop interrupts the stream")
      assert.strictEqual(yield* statusOf(actor), "stopped")

      yield* Queue.offer(queue, 2)
      yield* settle
      assert.deepStrictEqual(yield* contextOf(actor), Option.some(1))
      assert.strictEqual(finalized, 1)
    })
  )
})
