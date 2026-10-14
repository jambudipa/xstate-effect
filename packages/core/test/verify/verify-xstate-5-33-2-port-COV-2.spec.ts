/**
 * COV-2: the actor logic creators of `src/actors`, in the cases the baseline left unhit.
 *
 * init-testing layer 2 (test design R-005, P1). Upstream `transition` of promise, observable
 * and callback logic at xstate@5.33.2 changes only an active snapshot and returns the snapshot
 * for an event it does not know; upstream `start` of promise and observable logic runs nothing
 * for a snapshot that is done; upstream `sendBack` of an actor without a parent relays nothing.
 * The port extras (`fromEffect`, `fromEffectBackground`, `fromStream`, `fromTransitionWithInput`)
 * have no upstream tests: their JSDoc is the contract. The variance markers of each logic are
 * type-only placeholders that no code reads, so no test calls them.
 *
 * A logic's own `start` and `transition` run here with the inert actor scope of the pure
 * helpers, or with a copy of it whose `self` reads a chosen snapshot and whose system records
 * each relay: the actor runtime never calls `start` for a done snapshot, so only a direct call
 * shows the logic's own guard. Left out on purpose: a callback's cleanup that calls `sendBack`
 * at the stop. Upstream runs the cleanup inside the stop transition, before the status is
 * `stopped`, so its parent receives the event; the port runs it after, and drops the event.
 */
import { assert, describe, it } from "@effect/vitest"
import { Cause, Effect, Exit, Fiber, Layer, Logger, Option, References, Stream } from "effect"
import { type ActorLogic, ActorScope, type ActorScopeService } from "../../src/ActorLogic.js"
import { ObservableNextEvent } from "../../src/Event.js"
import type { Snapshot } from "../../src/Snapshot.js"
import { createInertActorScope } from "../../src/testing/getNextSnapshot.js"
import {
  type AnyActorRef,
  assign,
  createActor,
  createMachine,
  type EventObject,
  fromCallback,
  fromEffect,
  fromEffectBackground,
  fromEventObservable,
  fromObservable,
  fromPromise,
  fromStream,
  fromTransition,
  fromTransitionWithInput,
  getInitialSnapshot,
  getNextSnapshot,
  type Observer,
  type SnapshotType,
  StopEvent,
  type Subscribable,
} from "../../src/index.js"

/** Lets every other ready fiber take twenty turns. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 20; turn++) {
    yield* Effect.yieldNow
  }
})

/** Waits until the actor publishes a snapshot that satisfies `predicate`, and returns it. */
const reach = <S extends SnapshotType, E>(actor: { readonly changes: Stream.Stream<S, E> }, predicate: (snapshot: S) => boolean) =>
  actor.changes.pipe(Stream.filter(predicate), Stream.runHead, Effect.map(Option.getOrThrow))

/** One log entry as a test logger saw it. */
interface Entry {
  readonly logLevel: string
  readonly message: ReadonlyArray<unknown>
  readonly annotations: Readonly<Record<string, unknown>>
}

/** Runs `program` with a logger that keeps every log entry in `entries`. */
const withLogger = <A, E, R>(entries: Array<Entry>, program: Effect.Effect<A, E, R>) =>
  program.pipe(
    Effect.provide(
      Logger.layer([
        Logger.make((options) => {
          entries.push({
            logLevel: options.logLevel,
            message: Array.isArray(options.message) ? options.message : [options.message],
            annotations: options.fiber.getRef(References.CurrentLogAnnotations),
          })
        }),
      ])
    )
  )

/** A source the test drives by hand: it keeps each observer it is given. */
const manualSource = <T>(observers: Array<Observer<T>>, unsubscribe: () => void): Subscribable<T> => ({
  subscribe: (observer) => {
    observers.push(observer)
    return { unsubscribe }
  },
})

/**
 * The inert actor scope of `selfSnapshot`, whose `self` reads that snapshot and has `parent`,
 * and whose system keeps the type of every event it relays in `relayed` (the actor runtime is
 * not involved, so the logic's own checks decide what is relayed).
 */
const recordingScope = (
  selfSnapshot: Snapshot,
  relayed: Array<string>,
  parent: Option.Option<AnyActorRef> = Option.none()
): ActorScopeService => {
  const inert = createInertActorScope(selfSnapshot)
  return {
    ...inert,
    self: Option.match(parent, { onNone: () => inert.self, onSome: (ref) => ({ ...inert.self, _parent: Option.some(ref) }) }),
    system: {
      ...inert.system,
      relay: (_source, _target, event) =>
        Effect.sync(() => {
          relayed.push(event.type)
        }),
    },
  }
}

/**
 * Runs the logic's own `start` for `snapshot` with `actorScope`, in a scope that stays open
 * until `wait` has let the work `start` forks run.
 */
const runStart = <TSnapshot extends Snapshot, TEvent extends EventObject, TInput, TEmitted extends EventObject>(
  logic: ActorLogic<TSnapshot, TEvent, TInput, TEmitted>,
  snapshot: TSnapshot,
  actorScope: ActorScopeService,
  wait: Effect.Effect<void> = settle
) =>
  Effect.gen(function* () {
    const start = logic.start
    assert.isDefined(start, "the logic has a start")
    yield* Effect.scoped(Effect.andThen(start(snapshot), wait)).pipe(Effect.provide(Layer.succeed(ActorScope, actorScope)))
  })

interface Received {
  readonly received: ReadonlyArray<string>
}

/** Keeps the type of every event the parent takes, in order. */
const record = assign<Received, EventObject>(({ context, event }) => ({ received: [...context.received, event.type] }))

describe("COV-2 actor logic creators (src/actors)", () => {
  it.effect("[COV-2] fromCallback: a pure transition hands the event to no listener and keeps the snapshot; the stop event gives status stopped", () =>
    Effect.gen(function* () {
      const calls: Array<string> = []
      const logic = fromCallback(({ receive }) => {
        calls.push("start")
        receive((event) => {
          calls.push(event.type)
        })
      })
      const initial = yield* getInitialSnapshot(logic)

      // No actor runs the callback here, so no listener exists for the event
      const next = yield* getNextSnapshot(logic, initial, { type: "PING" })
      assert.strictEqual(next, initial)

      const stopped = yield* getNextSnapshot(logic, initial, new StopEvent())
      assert.strictEqual(stopped.status, "stopped")
      assert.isTrue(Option.isNone(stopped.error))
      assert.deepStrictEqual(calls, [])
    })
  )

  it.effect("[COV-2] fromCallback: sendBack of an actor without a parent relays nothing, and the actor stays active", () =>
    Effect.gen(function* () {
      const inspected: Array<string> = []
      const logic = fromCallback(({ sendBack, receive }) => {
        sendBack({ type: "HELLO" })
        receive(() => {
          sendBack({ type: "PONG" })
        })
      })
      const actor = yield* createActor(logic, {
        inspect: (event) =>
          Effect.sync(() => {
            if (event.type === "@xstate.event") {
              inspected.push(event.event.type)
            }
          }),
      })
      yield* actor.start
      yield* actor.send({ type: "PING" })
      yield* settle

      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.status, "active")
      assert.isTrue(Option.isNone(snapshot.error))
      // Only the actor's own events: neither HELLO nor PONG reached any actor
      assert.deepStrictEqual(inspected, ["xstate.init", "PING"])
    })
  )

  it.effect("[COV-2] fromEffect: only an active snapshot changes, and an event without data or of another type keeps it", () =>
    Effect.gen(function* () {
      const logic = fromEffect(({ input }: { readonly input: number }) => Effect.succeed(input * 2))
      const initial = yield* getInitialSnapshot(logic, 21)

      assert.strictEqual(yield* getNextSnapshot(logic, initial, { type: "PING" }), initial)
      const otherWithData = { type: "OTHER", data: 5 }
      assert.strictEqual(yield* getNextSnapshot(logic, initial, otherWithData), initial)

      const success = { type: "xstate.effect.success", data: 42 }
      const done = yield* getNextSnapshot(logic, initial, success)
      assert.strictEqual(done.status, "done")
      assert.deepStrictEqual(done.output, Option.some(42))
      assert.isUndefined(done.input)

      // A done snapshot keeps every later event out, a failure included
      const failure = { type: "xstate.effect.failure", data: "late" }
      assert.strictEqual(yield* getNextSnapshot(logic, done, failure), done)
      assert.strictEqual(yield* getNextSnapshot(logic, done, { type: "PING" }), done)
    })
  )

  it.effect("[COV-2] fromEffectBackground: the success event does not complete it; it stays active with its input", () =>
    Effect.gen(function* () {
      const logic = fromEffectBackground(({ input }: { readonly input: string }) => Effect.succeed(input))
      const initial = yield* getInitialSnapshot(logic, "feed")

      const success = { type: "xstate.effect.success", data: "value" }
      const next = yield* getNextSnapshot(logic, initial, success)
      assert.strictEqual(next, initial)
      assert.strictEqual(next.status, "active")
      assert.strictEqual(next.input, "feed")
    })
  )

  it.effect("[COV-2] fromEffect: an Effect that interrupts itself relays nothing, so the child stays active and its parent gets neither done nor error", () =>
    Effect.gen(function* () {
      const machine = createMachine<Received, EventObject>({
        id: "cov2-interrupt",
        initial: "running",
        context: { received: [] },
        states: {
          running: {
            invoke: {
              id: "job",
              src: fromEffect(() => Effect.interrupt),
              onDone: { target: "finished", actions: record },
              onError: { target: "failed", actions: record },
            },
          },
          finished: {},
          failed: {},
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      yield* settle

      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.value, "running")
      assert.deepStrictEqual(snapshot.context.received, [])
      const child = snapshot.children["job"]
      assert.isDefined(child)
      const childSnapshot = yield* child.getSnapshotUntyped
      assert.strictEqual(childSnapshot.status, "active")
    })
  )

  it.effect("[COV-2] fromEffect: an actor restored from a done snapshot runs no Effect at start and keeps its output", () =>
    Effect.gen(function* () {
      const runs: Array<number> = []
      const logic = fromEffect(({ input }: { readonly input: number }) =>
        Effect.sync(() => {
          runs.push(input)
          return input * 2
        })
      )
      const first = yield* createActor(logic, { input: 21 })
      yield* first.start
      yield* reach(first, (snapshot) => snapshot.status === "done")
      const persisted = yield* first.getPersistedSnapshot

      const restored = yield* createActor(logic, { input: 21, snapshot: persisted })
      yield* restored.start
      yield* settle

      assert.deepStrictEqual(runs, [21])
      const snapshot = yield* restored.getSnapshot
      assert.strictEqual(snapshot.status, "done")
      assert.deepStrictEqual(snapshot.output, Option.some(42))
    })
  )

  it.effect("[COV-2] fromPromise: only an active snapshot changes, and an event without data or of another type keeps it", () =>
    Effect.gen(function* () {
      const logic = fromPromise(({ input }: { readonly input: number }) => Promise.resolve(input))
      const initial = yield* getInitialSnapshot(logic, 1)

      assert.strictEqual(yield* getNextSnapshot(logic, initial, { type: "PING" }), initial)
      const otherWithData = { type: "OTHER", data: 5 }
      assert.strictEqual(yield* getNextSnapshot(logic, initial, otherWithData), initial)

      const reject = { type: "xstate.promise.reject", data: "nope" }
      const rejected = yield* getNextSnapshot(logic, initial, reject)
      assert.strictEqual(rejected.status, "error")
      assert.deepStrictEqual(rejected.error, Option.some("nope"))
      assert.isUndefined(rejected.input)

      // An errored snapshot keeps every later event out, a resolve included
      const resolve = { type: "xstate.promise.resolve", data: 1 }
      assert.strictEqual(yield* getNextSnapshot(logic, rejected, resolve), rejected)
    })
  )

  it.effect("[COV-2] fromPromise: an actor restored from a done snapshot calls no promise creator at start and keeps its output", () =>
    Effect.gen(function* () {
      const calls: Array<number> = []
      const logic = fromPromise(({ input }: { readonly input: number }) => {
        calls.push(input)
        return Promise.resolve(input + 1)
      })
      const first = yield* createActor(logic, { input: 1 })
      yield* first.start
      yield* reach(first, (snapshot) => snapshot.status === "done")
      const persisted = yield* first.getPersistedSnapshot

      const restored = yield* createActor(logic, { input: 1, snapshot: persisted })
      yield* restored.start
      yield* settle

      assert.deepStrictEqual(calls, [1])
      const snapshot = yield* restored.getSnapshot
      assert.strictEqual(snapshot.status, "done")
      assert.deepStrictEqual(snapshot.output, Option.some(2))
    })
  )

  it.effect("[COV-2] fromObservable: only an active snapshot changes, and an event without data or of another type keeps it", () =>
    Effect.gen(function* () {
      const logic = fromObservable(() => manualSource<number>([], () => undefined))
      const initial = yield* getInitialSnapshot(logic)

      assert.strictEqual(yield* getNextSnapshot(logic, initial, { type: "PING" }), initial)
      const otherWithData = { type: "OTHER", data: 5 }
      assert.strictEqual(yield* getNextSnapshot(logic, initial, otherWithData), initial)

      const valued = yield* getNextSnapshot(logic, initial, new ObservableNextEvent({ data: 3 }))
      assert.deepStrictEqual(valued.context, Option.some(3))
      const done = yield* getNextSnapshot(logic, valued, { type: "xstate.observable.complete" })
      assert.strictEqual(done.status, "done")
      assert.isUndefined(done.input)

      // A done snapshot keeps every later value out
      assert.strictEqual(yield* getNextSnapshot(logic, done, new ObservableNextEvent({ data: 4 })), done)
    })
  )

  it.effect("[COV-2] fromEventObservable: a value event keeps the context empty, as the values go to the parent", () =>
    Effect.gen(function* () {
      const logic = fromEventObservable(() => manualSource<EventObject>([], () => undefined))
      const initial = yield* getInitialSnapshot(logic)

      const next = yield* getNextSnapshot(logic, initial, new ObservableNextEvent({ data: { type: "CLICK" } }))
      assert.strictEqual(next, initial)
      assert.isTrue(Option.isNone(next.context))
    })
  )

  it.effect("[COV-2] fromObservable and fromEventObservable: an actor restored from a done snapshot does not subscribe again", () =>
    Effect.gen(function* () {
      const created: Array<string> = []
      const completing = <T>(name: string, value: T): Subscribable<T> => {
        created.push(name)
        return {
          subscribe: (observer) => {
            observer.next?.(value)
            observer.complete?.()
            return { unsubscribe: () => undefined }
          },
        }
      }
      const values = fromObservable(() => completing("values", 7))
      const events = fromEventObservable(() => completing<EventObject>("events", { type: "TICK" }))

      const valuesActor = yield* createActor(values)
      yield* valuesActor.start
      yield* reach(valuesActor, (snapshot) => snapshot.status === "done")
      const eventsActor = yield* createActor(events)
      yield* eventsActor.start
      yield* reach(eventsActor, (snapshot) => snapshot.status === "done")

      const restoredValues = yield* createActor(values, { snapshot: yield* valuesActor.getPersistedSnapshot })
      yield* restoredValues.start
      const restoredEvents = yield* createActor(events, { snapshot: yield* eventsActor.getPersistedSnapshot })
      yield* restoredEvents.start
      yield* settle

      assert.deepStrictEqual(created, ["values", "events"])
      const valuesSnapshot = yield* restoredValues.getSnapshot
      assert.strictEqual(valuesSnapshot.status, "done")
      assert.deepStrictEqual(valuesSnapshot.context, Option.some(7))
      assert.strictEqual((yield* restoredEvents.getSnapshot).status, "done")
    })
  )

  it.effect("[COV-2] fromObservable: a value the source gives while the stop unsubscribes it changes nothing; the actor stays stopped with its last value", () =>
    Effect.gen(function* () {
      const observers: Array<Observer<number>> = []
      const logic = fromObservable(() =>
        manualSource(observers, () => {
          observers.forEach((observer) => observer.next?.(99))
        })
      )
      const actor = yield* createActor(logic)
      yield* actor.start
      const first = observers[0]
      assert.isDefined(first)
      first.next?.(1)
      yield* reach(actor, (snapshot) => Option.isSome(snapshot.context))
      yield* actor.stop
      yield* settle

      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.status, "stopped")
      assert.deepStrictEqual(snapshot.context, Option.some(1))
    })
  )

  it.effect("[COV-2] fromStream: an actor restored from a done snapshot runs no stream at start and keeps its last element", () =>
    Effect.gen(function* () {
      const runs: Array<string> = []
      const logic = fromStream(() => {
        runs.push("run")
        return Stream.make(1, 2)
      })
      const first = yield* createActor(logic)
      yield* first.start
      yield* reach(first, (snapshot) => snapshot.status === "done")

      const restored = yield* createActor(logic, { snapshot: yield* first.getPersistedSnapshot })
      yield* restored.start
      yield* settle

      assert.deepStrictEqual(runs, ["run"])
      const snapshot = yield* restored.getSnapshot
      assert.strictEqual(snapshot.status, "done")
      assert.deepStrictEqual(snapshot.context, Option.some(2))
    })
  )

  it.effect("[COV-2] fromStream: a stream that ends by interruption gives neither done nor error; the actor stays active", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(fromStream(() => Stream.concat(Stream.make(1), Stream.fromEffect(Effect.interrupt))))
      yield* actor.start
      yield* settle

      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.status, "active")
      assert.deepStrictEqual(snapshot.context, Option.some(1))
      assert.isTrue(Option.isNone(snapshot.error))
    })
  )

  it.effect("[COV-2] fromTransition: the reducer's logger, without a logger option, logs at level Info with the actor's annotations", () =>
    Effect.gen(function* () {
      const entries: Array<Entry> = []
      const logic = fromTransition((count: number, _event: { readonly type: "INC" }, { logger }) => {
        logger("counted", count + 1)
        return count + 1
      }, 0)
      const { snapshot, sessionId } = yield* withLogger(
        entries,
        Effect.gen(function* () {
          const actor = yield* createActor(logic, { id: "counter" })
          yield* actor.start
          yield* actor.send({ type: "INC" })
          return { snapshot: yield* actor.getSnapshot, sessionId: actor.sessionId }
        })
      )

      assert.strictEqual(snapshot.context, 1)
      const counted = entries.filter((entry) => entry.message[0] === "counted")
      assert.strictEqual(counted.length, 1)
      const entry = counted[0]
      assert.isDefined(entry)
      assert.strictEqual(entry.logLevel, "Info")
      assert.deepStrictEqual(entry.message, ["counted", 1])
      assert.strictEqual(entry.annotations["actorId"], "counter")
      assert.strictEqual(entry.annotations["sessionId"], sessionId)
    })
  )

  it.effect("[COV-2] fromCallback: sendBack relays to the parent while the actor is active, and sends nothing once it is stopped", () =>
    Effect.gen(function* () {
      const parent = yield* createActor(createMachine({ id: "cov2-parent" }))
      const logic = fromCallback(({ sendBack }) => {
        sendBack({ type: "HELLO" })
      })
      const initial = yield* getInitialSnapshot(logic)

      const fromActive: Array<string> = []
      yield* runStart(logic, initial, recordingScope(initial, fromActive, Option.some(parent)))
      assert.deepStrictEqual(fromActive, ["HELLO"])

      // The same call from an actor whose snapshot is stopped (upstream's status check)
      const fromStopped: Array<string> = []
      yield* runStart(logic, initial, recordingScope({ ...initial, status: "stopped" }, fromStopped, Option.some(parent)))
      assert.deepStrictEqual(fromStopped, [])
    })
  )

  it.effect("[COV-2] fromEffect: start runs the Effect for an active snapshot only, and relays its end only while the actor is active", () =>
    Effect.gen(function* () {
      const runs: Array<number> = []
      const logic = fromEffect(({ input }: { readonly input: number }) =>
        Effect.sync(() => {
          runs.push(input)
          return input * 2
        })
      )
      const initial = yield* getInitialSnapshot(logic, 21)
      const done = { ...initial, status: "done" as const }
      const failed = { ...initial, status: "error" as const }

      const relayed: Array<string> = []
      yield* runStart(logic, done, recordingScope(done, relayed))
      yield* runStart(logic, failed, recordingScope(failed, relayed))
      assert.deepStrictEqual(runs, [])

      yield* runStart(logic, initial, recordingScope(initial, relayed))
      assert.deepStrictEqual(runs, [21])
      assert.deepStrictEqual(relayed, ["xstate.effect.success"])

      // The Effect ends after the actor stopped: nothing is relayed to it
      const afterStop: Array<string> = []
      yield* runStart(logic, initial, recordingScope({ ...initial, status: "stopped" }, afterStop))
      assert.deepStrictEqual(runs, [21, 21])
      assert.deepStrictEqual(afterStop, [])
    })
  )

  it.effect("[COV-2] fromPromise: start calls the creator for an active snapshot only, and relays the settlement only while the actor is active", () =>
    Effect.gen(function* () {
      const calls: Array<number> = []
      const settled: Array<Promise<number>> = []
      const logic = fromPromise(({ input }: { readonly input: number }) => {
        calls.push(input)
        const promise = Promise.resolve(input + 1)
        settled.push(promise)
        return promise
      })
      /** Lets the latest promise settle, then lets the fiber that waits for it relay. */
      const afterSettlement = Effect.andThen(
        Effect.promise(() => Promise.all(settled)),
        settle
      )
      const initial = yield* getInitialSnapshot(logic, 1)
      const done = { ...initial, status: "done" as const }

      const relayed: Array<string> = []
      yield* runStart(logic, done, recordingScope(done, relayed), afterSettlement)
      assert.deepStrictEqual(calls, [])

      yield* runStart(logic, initial, recordingScope(initial, relayed), afterSettlement)
      assert.deepStrictEqual(calls, [1])
      assert.deepStrictEqual(relayed, ["xstate.promise.resolve"])

      // The promise settles after the actor stopped: nothing is relayed to it
      const afterStop: Array<string> = []
      yield* runStart(logic, initial, recordingScope({ ...initial, status: "stopped" }, afterStop), afterSettlement)
      assert.deepStrictEqual(calls, [1, 1])
      assert.deepStrictEqual(afterStop, [])
    })
  )

  it.effect("[COV-2] fromObservable, fromEventObservable and fromStream: start for a done snapshot creates no source", () =>
    Effect.gen(function* () {
      const created: Array<string> = []
      const source = (name: string): Subscribable<EventObject> => {
        created.push(name)
        return manualSource<EventObject>([], () => undefined)
      }
      const values = fromObservable(() => source("values"))
      const events = fromEventObservable(() => source("events"))
      const stream = fromStream(() => {
        created.push("stream")
        return Stream.never
      })

      const relayed: Array<string> = []
      const valuesInitial = yield* getInitialSnapshot(values)
      const eventsInitial = yield* getInitialSnapshot(events)
      const streamInitial = yield* getInitialSnapshot(stream)
      const valuesDone = { ...valuesInitial, status: "done" as const }
      const eventsDone = { ...eventsInitial, status: "done" as const }
      const streamDone = { ...streamInitial, status: "done" as const }
      yield* runStart(values, valuesDone, recordingScope(valuesDone, relayed))
      yield* runStart(events, eventsDone, recordingScope(eventsDone, relayed))
      yield* runStart(stream, streamDone, recordingScope(streamDone, relayed))
      assert.deepStrictEqual(created, [])

      // An active snapshot creates each source once
      yield* runStart(values, valuesInitial, recordingScope(valuesInitial, relayed))
      yield* runStart(events, eventsInitial, recordingScope(eventsInitial, relayed))
      yield* runStart(stream, streamInitial, recordingScope(streamInitial, relayed))
      assert.deepStrictEqual(created, ["values", "events", "stream"])
      assert.deepStrictEqual(relayed, [])
    })
  )

  it.effect("[COV-2] fromTransition: interrupting a transition interrupts the work its reducer started", () =>
    Effect.gen(function* () {
      const seen: Array<string> = []
      const logic = fromTransition((count: number, event: { readonly type: "WORK" }, { actionExecutor, self, system }) => {
        actionExecutor({ type: "slow", params: undefined, info: { context: count, event, self, system }, exec: Effect.void })
        return count + 1
      }, 0)
      const initial = yield* getInitialSnapshot(logic)
      // An actor scope whose action executor never ends by itself
      const waiting: ActorScopeService = {
        ...createInertActorScope(initial),
        actionExecutor: () =>
          Effect.never.pipe(
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                seen.push("interrupted")
              })
            )
          ),
      }
      const transition = yield* Effect.forkChild(
        logic.transition(initial, { type: "WORK" }).pipe(Effect.provide(Layer.succeed(ActorScope, waiting))),
        { startImmediately: true }
      )
      yield* settle
      assert.isUndefined(transition.pollUnsafe(), "the transition waits for the work")
      assert.deepStrictEqual(seen, [])

      yield* Fiber.interrupt(transition)
      assert.deepStrictEqual(seen, ["interrupted"])
      // The transition itself ended by the interruption, with no snapshot and no other failure
      const exit = yield* Fiber.await(transition)
      assert.isTrue(Exit.hasInterrupts(exit), "the transition was interrupted")
      assert.isTrue(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause), "nothing but the interruption")
    })
  )

  it.effect("[COV-2] fromTransitionWithInput: the factory receives the raw input, and the reducer starts from what it returns", () =>
    Effect.gen(function* () {
      const logic = fromTransitionWithInput<{ readonly initial: number }>()(
        (context: { readonly count: number }, event: { readonly type: "INC" } | { readonly type: "RESET" }) =>
          event.type === "INC" ? { count: context.count + 1 } : { count: 0 },
        ({ initial }) => ({ count: initial })
      )

      const pure = yield* getInitialSnapshot(logic, { initial: 5 })
      assert.deepStrictEqual(pure.context, { count: 5 })

      const actor = yield* createActor(logic, { input: { initial: 10 } })
      yield* actor.start
      yield* actor.send({ type: "INC" })
      yield* actor.send({ type: "INC" })
      assert.deepStrictEqual((yield* actor.getSnapshot).context, { count: 12 })
      yield* actor.send({ type: "RESET" })
      assert.deepStrictEqual((yield* actor.getSnapshot).context, { count: 0 })
    })
  )
})
