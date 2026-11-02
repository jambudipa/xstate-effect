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
import { Cause, Effect, Exit, Fiber, Layer, Logger, Option, Predicate, References, Schedule, Scheduler, Schema, type Scope, Stream } from "effect"
import { TestClock } from "effect/testing"
import { type ActorLogic, ActorLogicTypeId, ActorScope, type ActorScopeService, type AnyActorLogic } from "../../src/ActorLogic.js"
import { AgentRunError } from "../../src/Errors.js"
import { ObservableNextEvent } from "../../src/Event.js"
import { logicCapability } from "../../src/internal/logicCapability.js"
import { type Snapshot, SnapshotTypeId } from "../../src/Snapshot.js"
import { createInertActorScope } from "../../src/testing/getNextSnapshot.js"
import {
  type AgentActorLogic,
  type AgentAttemptEvent,
  type AgentSnapshot,
  AgentTurn,
  type AgentTurnService,
  type AnyActorRef,
  assign,
  createActor,
  createMachine,
  type EventObject,
  fromAgent,
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
  setup,
  setupWithSchema,
  type SnapshotType,
  StopEvent,
  type Subscribable,
  type TransitionReply,
  type TurnOutcome,
  type Unsettled,
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

// ============================================================
// fromAgent (agent-settlement T1.3)
// ============================================================

/** The events the agent host takes: a move, a move out of `moved`, and four that leave `thinking` in place. */
type HostEvent =
  | { readonly type: "GO" }
  | { readonly type: "NEXT" }
  | { readonly type: "IGNORED" }
  | { readonly type: "GUARDED" }
  | { readonly type: "STAY" }
  | { readonly type: "INNER" }

/**
 * The host agent's tools (S21): the four events `thinking` accepts. `IGNORED` and `NEXT` are no
 * tools, so a call that names them through the untyped `AgentTurn` is illegal and never
 * reaches the machine.
 */
const hostTools = {
  GO: Schema.Struct({ type: Schema.Literal("GO") }),
  GUARDED: Schema.Struct({ type: Schema.Literal("GUARDED") }),
  STAY: Schema.Struct({ type: Schema.Literal("STAY") }),
  INNER: Schema.Struct({ type: Schema.Literal("INNER") }),
}

/** Agent logic the host invokes. */
type HostAgent = AgentActorLogic<number, never, typeof hostTools>

/**
 * The same agent logic seen without its brand. The pure helpers refuse agent logic by type
 * (NEG-4), as it runs only as an invocation; these cases drive its internals directly, so they
 * read it through this view, which passes the runtime's capability as the actor runtime does.
 */
const unbranded = (agent: HostAgent): ActorLogic<AgentSnapshot<number>, EventObject, number, AgentAttemptEvent> => ({
  [ActorLogicTypeId]: agent[ActorLogicTypeId],
  getInitialSnapshot: agent.getInitialSnapshot,
  transition: (snapshot, event) => agent.transition(snapshot, event, logicCapability),
  start: (snapshot) => agent.start(snapshot, logicCapability),
  restoreSnapshot: (persisted) => agent.restoreSnapshot(persisted, logicCapability),
  getPersistedSnapshot: (snapshot) => agent.getPersistedSnapshot(snapshot, logicCapability),
})

/** The fields of an active agent snapshot that no agent test varies. */
const agentSnapshotShape = {
  [SnapshotTypeId]: SnapshotTypeId,
  status: "active",
  output: Option.none(),
  error: Option.none(),
  input: 1,
} as const

/** One prompt the agent's turn received. */
interface Prompt {
  readonly attempt: number
  readonly feedback: Option.Option<TurnOutcome>
}

/**
 * A machine that invokes `agent` in `thinking`. `GO` moves to `moved`; `IGNORED` is not handled,
 * `GUARDED` has a false guard, `STAY` is targetless and `INNER` targets a child of `thinking`, so
 * none of the four leaves the state. The agent's `onDone` goes to `stalled`, keeps each output
 * in `outputs`, and writes it to the context as plain JSON, so the host can be persisted. `STAY`
 * runs `macrostep` inside the host's macrostep, so a case can make that macrostep outlast a turn.
 */
const agentHost = (agent: HostAgent, outputs: Array<Option.Option<Unsettled>> = [], macrostep: Effect.Effect<void> = Effect.void) => {
  const hostSetup = setup({
    types: {} as { context: { readonly unsettled: Unsettled | null }; events: HostEvent },
    actors: { agent },
  })
  return hostSetup.createMachine({
    id: "host",
    context: { unsettled: null },
    initial: "thinking",
    states: {
      thinking: {
        initial: "idle",
        states: { idle: {}, inner: {} },
        invoke: {
          src: "agent",
          id: "agent",
          input: 1,
          onDone: {
            target: "stalled",
            actions: assign(({ event }) => {
              outputs.push(event.output)
              return { unsettled: Option.getOrNull(event.output) }
            }),
          },
        },
        on: {
          GO: "moved",
          GUARDED: { guard: () => false, target: "moved" },
          STAY: { actions: () => macrostep },
          INNER: ".inner",
        },
      },
      // The timed close is the progress guarantee of `moved` (settlement proof)
      moved: { on: { NEXT: "further" }, after: { 600000: "further" } },
      further: { type: "final" },
      stalled: { type: "final" },
    },
  })
}

/** Agent logic with budget 3 and deadline 1000 whose turn records each prompt, then runs `act`. */
const scriptedAgent = (prompts: Array<Prompt>, act: (agent: AgentTurnService, attempt: number) => Effect.Effect<unknown>) =>
  fromAgent({
    budget: 3,
    deadline: 1000,
    tools: hostTools,
    turn: (_input: number, attempt, feedback) =>
      Effect.gen(function* () {
        prompts.push({ attempt, feedback })
        const agent = yield* AgentTurn
        return yield* act(agent, attempt)
      }),
  })

/** Starts the host of `agent` and waits until its state matches `done`. */
const runHost = (
  agent: HostAgent,
  done: (value: unknown) => boolean,
  outputs: Array<Option.Option<Unsettled>> = []
) =>
  Effect.gen(function* () {
    const actor = yield* createActor(agentHost(agent, outputs))
    yield* actor.start
    return yield* reach(actor, (snapshot) => done(snapshot.value))
  })

/** The feedback each prompt received, in order. */
const feedbackOf = (prompts: ReadonlyArray<Prompt>) => prompts.map((prompt) => Option.getOrUndefined(prompt.feedback))

/** A small seeded generator (mulberry32), so a seed replays the same order (TS-119). */
const seeded = (seed: number) => {
  const state = { value: seed >>> 0 }
  return () => {
    state.value = (state.value + 0x6d2b79f5) >>> 0
    const mixed = Math.imul(state.value ^ (state.value >>> 15), 1 | state.value)
    const next = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296
  }
}

/** The first item of a list a turn filled; a missing one fails the test. */
const firstOf = <T>(items: ReadonlyArray<T>): T => {
  const first = items[0]
  assert.isDefined(first, "the turn captured its capability")
  return first
}

/** Fifty seeds, for the order and timing cases (TS-119). */
const seeds = Array.from({ length: Number(process.env.AGENT_SEEDS ?? 50) }, (_, index) => index + 1)

describe("COV-2 fromAgent (agent-settlement T1.3)", () => {
  it.effect("[COV-2] fromAgent: a move on turn 1 exits the state, so the agent is prompted once and outputs nothing (S5, CONC-1)", () =>
    Effect.gen(function* () {
      const prompts: Array<Prompt> = []
      const outputs: Array<Option.Option<Unsettled>> = []
      const after: Array<string> = []
      const agent = scriptedAgent(prompts, (turn) =>
        Effect.andThen(turn.transition({ type: "GO" }), Effect.sync(() => after.push("returned")))
      )
      const snapshot = yield* runHost(agent, (value) => value === "moved", outputs)
      yield* settle
      assert.deepStrictEqual(prompts.map((prompt) => prompt.attempt), [1])
      assert.deepStrictEqual(after, [], "a move stops the agent before the delivery returns")
      assert.deepStrictEqual(outputs, [])
      assert.deepStrictEqual(Object.keys(snapshot.children), [])
    })
  )

  it.effect("[COV-2] fromAgent: a silent model with budget 3 is prompted exactly 3 times and settles Unsettled{silent, 3} (S3)", () =>
    Effect.gen(function* () {
      const prompts: Array<Prompt> = []
      const snapshot = yield* runHost(scriptedAgent(prompts, () => Effect.void), (value) => value === "stalled")
      assert.deepStrictEqual(prompts.map((prompt) => prompt.attempt), [1, 2, 3])
      assert.deepStrictEqual(feedbackOf(prompts), [undefined, { reason: "silent" }, { reason: "silent" }])
      assert.deepStrictEqual(snapshot.context.unsettled, ({ reason: "silent", attempts: 3 }))
      assert.strictEqual(snapshot.status, "done")
    })
  )

  it.effect("[COV-2] fromAgent: a turn that succeeds with no state exit is silent and uses an attempt; success is never settlement (broken run 19890cbe)", () =>
    Effect.gen(function* () {
      const prompts: Array<Prompt> = []
      const agent = scriptedAgent(prompts, () => Effect.succeed({ exitCode: 0, completed: true }))
      const snapshot = yield* runHost(agent, (value) => value === "stalled")
      assert.deepStrictEqual(prompts.length, 3)
      assert.deepStrictEqual(snapshot.context.unsettled, ({ reason: "silent", attempts: 3 }))
    })
  )

  it.effect("[COV-2] fromAgent: a turn whose returned text names a transition, with no event sent, is silent, not moved (broken run 19890cbe)", () =>
    Effect.gen(function* () {
      const prompts: Array<Prompt> = []
      const agent = scriptedAgent(prompts, (_turn, attempt) =>
        Effect.succeed(attempt === 1 ? "I called the GO tool: transition GO" : { type: "GO" })
      )
      const snapshot = yield* runHost(agent, (value) => value === "stalled")
      assert.deepStrictEqual(feedbackOf(prompts), [undefined, { reason: "silent" }, { reason: "silent" }])
      assert.deepStrictEqual(snapshot.context.unsettled, ({ reason: "silent", attempts: 3 }))
    })
  )

  it.effect("[COV-2] fromAgent: an ignored event, a false guard, a targetless and a child-target transition each leave the state, so each is illegal and names the event (S20)", () =>
    Effect.gen(function* () {
      const prompts: Array<Prompt> = []
      const replies: Array<TransitionReply> = []
      const events = ["IGNORED", "GUARDED", "STAY"] as const
      const agent = scriptedAgent(prompts, (turn, attempt) =>
        Effect.map(turn.transition({ type: events[attempt - 1] ?? "IGNORED" }), (reply) => replies.push(reply))
      )
      const snapshot = yield* runHost(agent, (value) => value === "stalled")
      // IGNORED is no tool of the agent (S21), so it never reaches the machine; the others are delivered and stay
      assert.deepStrictEqual(replies, events.map((event) => ({ status: "illegal", event, delivered: event !== "IGNORED" })))
      assert.deepStrictEqual(feedbackOf(prompts), [undefined, { reason: "illegal", event: "IGNORED" }, { reason: "illegal", event: "GUARDED" }])
      assert.deepStrictEqual(snapshot.context.unsettled, ({ reason: "illegal", attempts: 3 }))

      const inner: Array<Prompt> = []
      const toChild = fromAgent({
        budget: 1,
        deadline: 1000,
        tools: hostTools,
        turn: (_input: number, attempt, feedback) =>
          Effect.gen(function* () {
            inner.push({ attempt, feedback })
            const agent = yield* AgentTurn
            yield* agent.transition({ type: "INNER" })
          }),
      })
      const settled = yield* runHost(toChild, (value) => value === "stalled")
      assert.deepStrictEqual(settled.context.unsettled, ({ reason: "illegal", attempts: 1 }))
    })
  )

  it.effect("[COV-2] fromAgent: each failed outcome is the next feedback and, when the budget is spent, the reason; no actor error is sent (S4)", () =>
    Effect.gen(function* () {
      const cases: ReadonlyArray<readonly [TurnOutcome, (turn: AgentTurnService) => Effect.Effect<unknown>]> = [
        [{ reason: "illegal", event: "IGNORED" }, (turn) => turn.transition({ type: "IGNORED" })],
        [{ reason: "malformed", event: "GO", detail: "missing field reason" }, (turn) => turn.malformed("GO", "missing field reason")],
        [{ reason: "crashed", detail: "boom" }, () => Effect.die(new Error("boom"))],
      ]
      for (const [outcome, act] of cases) {
        const prompts: Array<Prompt> = []
        const agent = fromAgent({
          budget: 2,
          deadline: 1000,
          tools: hostTools,
          turn: (_input: number, attempt, feedback) =>
            Effect.gen(function* () {
              prompts.push({ attempt, feedback })
              return yield* act(yield* AgentTurn)
            }),
        })
        const snapshot = yield* runHost(agent, (value) => value === "stalled")
        assert.deepStrictEqual(feedbackOf(prompts), [undefined, outcome])
        assert.deepStrictEqual(snapshot.context.unsettled, ({ reason: outcome.reason, attempts: 2 }))
        assert.strictEqual(snapshot.status, "done", "no xstate.error.actor event errored the host")
      }
    })
  )

  it.effect("[COV-2] fromAgent: an overrun interrupts the turn, is the next feedback, and is the reason when spent (S4, CONC-3)", () =>
    Effect.gen(function* () {
      const prompts: Array<Prompt> = []
      const cancelled: Array<number> = []
      const agent = fromAgent({
        budget: 2,
        deadline: 1000,
        tools: hostTools,
        turn: (_input: number, attempt, feedback) =>
          Effect.sync(() => prompts.push({ attempt, feedback })).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Effect.sync(() => cancelled.push(attempt)))
          ),
      })
      const host = yield* Effect.forkChild(runHost(agent, (value) => value === "stalled"), { startImmediately: true })
      yield* settle
      yield* TestClock.adjust(1000)
      yield* settle
      yield* TestClock.adjust(1000)
      const snapshot = yield* Fiber.join(host)
      assert.deepStrictEqual(cancelled, [1, 2])
      assert.deepStrictEqual(feedbackOf(prompts), [undefined, { reason: "overdue", deadline: 1000 }])
      assert.deepStrictEqual(snapshot.context.unsettled, ({ reason: "overdue", attempts: 2 }))
    })
  )

  it.effect("[COV-2] fromAgent: budget 1 gives exactly one prompt, no feedback prompt, and Unsettled{attempts: 1}", () =>
    Effect.gen(function* () {
      const prompts: Array<Prompt> = []
      const agent = fromAgent({
        budget: 1,
        deadline: 1000,
        tools: hostTools,
        turn: (_input: number, attempt, feedback) => Effect.sync(() => prompts.push({ attempt, feedback })),
      })
      const snapshot = yield* runHost(agent, (value) => value === "stalled")
      assert.deepStrictEqual(feedbackOf(prompts), [undefined])
      assert.deepStrictEqual(snapshot.context.unsettled, ({ reason: "silent", attempts: 1 }))
    })
  )

  it.effect("[COV-2] fromAgent: silent, then illegal, then overdue gives reason overdue, and each feedback names only the outcome before it", () =>
    Effect.gen(function* () {
      const prompts: Array<Prompt> = []
      const agent = scriptedAgent(prompts, (turn, attempt) =>
        attempt === 1 ? Effect.void : attempt === 2 ? turn.transition({ type: "IGNORED" }) : Effect.never
      )
      const host = yield* Effect.forkChild(runHost(agent, (value) => value === "stalled"), { startImmediately: true })
      yield* settle
      yield* TestClock.adjust(1000)
      const snapshot = yield* Fiber.join(host)
      assert.deepStrictEqual(feedbackOf(prompts), [undefined, { reason: "silent" }, { reason: "illegal", event: "IGNORED" }])
      assert.deepStrictEqual(snapshot.context.unsettled, ({ reason: "overdue", attempts: 3 }))
    })
  )

  it.effect("[COV-2] fromAgent: a turn that throws before it returns an Effect is crashed, with no actor error", () =>
    Effect.gen(function* () {
      const agent = fromAgent({
        budget: 1,
        deadline: 1000,
        tools: hostTools,
        turn: (_input: number) => {
          throw new Error("thrown before the Effect")
        },
      })
      const snapshot = yield* runHost(agent, (value) => value === "stalled")
      assert.strictEqual(snapshot.status, "done")
      assert.deepStrictEqual(snapshot.context.unsettled, ({ reason: "crashed", attempts: 1 }))
    })
  )

  it.effect("[COV-2] fromAgent: of two transitions in flight in one turn the first wins and the second is illegal and never delivered (S22)", () =>
    Effect.gen(function* () {
      const prompts: Array<Prompt> = []
      const replies: Array<TransitionReply> = []
      const agent = scriptedAgent(prompts, (turn) =>
        Effect.all(
          [turn.transition({ type: "GO" }), Effect.tap(turn.transition({ type: "NEXT" }), (reply) => Effect.sync(() => replies.push(reply)))],
          { concurrency: "unbounded" }
        )
      )
      const snapshot = yield* runHost(agent, (value) => value === "moved")
      yield* settle
      assert.strictEqual((yield* Effect.succeed(snapshot)).value, "moved")
      assert.deepStrictEqual(replies, [{ status: "illegal", event: "NEXT", delivered: false }])
      assert.deepStrictEqual(prompts.length, 1)
    })
  )

  it.effect("[COV-2] fromAgent: a legal move after an ignored one in the same turn still moves; a progress-only turn is silent and does not reset attempts (S22)", () =>
    Effect.gen(function* () {
      const prompts: Array<Prompt> = []
      const progress: Array<number> = []
      const agent = scriptedAgent(prompts, (turn, attempt) =>
        attempt < 3
          ? Effect.sync(() => progress.push(attempt))
          : Effect.andThen(turn.transition({ type: "IGNORED" }), turn.transition({ type: "GO" }))
      )
      yield* runHost(agent, (value) => value === "moved")
      assert.deepStrictEqual(progress, [1, 2])
      assert.deepStrictEqual(feedbackOf(prompts), [undefined, { reason: "silent" }, { reason: "silent" }])
    })
  )

  it.effect("[COV-2] fromAgent: a call through attempt 1's capability in attempt 2, or after Unsettled, is refused and does not move the machine (CONC-2)", () =>
    Effect.gen(function* () {
      const captured: Array<AgentTurnService> = []
      const replies: Array<TransitionReply> = []
      const agent = fromAgent({
        budget: 2,
        deadline: 1000,
        tools: hostTools,
        turn: (_input: number, attempt) =>
          Effect.gen(function* () {
            const agent = yield* AgentTurn
            if (attempt === 1) {
              captured.push(agent)
              return
            }
            replies.push(yield* firstOf(captured).transition({ type: "GO" }))
          }),
      })
      const snapshot = yield* runHost(agent, (value) => value === "stalled")
      replies.push(yield* firstOf(captured).transition({ type: "GO" }))
      assert.deepStrictEqual(replies, [
        { status: "refused", event: "GO", reason: "stale" },
        { status: "refused", event: "GO", reason: "settled" },
      ])
      assert.deepStrictEqual(snapshot.context.unsettled, ({ reason: "silent", attempts: 2 }))
    })
  )

  it.effect("[COV-2] fromAgent: a legal move queued as the final turn ends is resolved the same way across 50 seeded runs (CONC-2, TS-119)", () =>
    Effect.gen(function* () {
      const results: Array<string> = []
      for (const seed of seeds) {
        const random = seeded(seed)
        const yields = Math.floor(random() * 10)
        const agent = fromAgent({
          budget: 1,
          deadline: 1000,
          tools: hostTools,
          turn: (_input: number) =>
            Effect.gen(function* () {
              const agent = yield* AgentTurn
              yield* Effect.forkDetach(agent.transition({ type: "GO" }), { startImmediately: true })
              for (let turn = 0; turn < yields; turn++) yield* Effect.yieldNow
            }),
        })
        const outputs: Array<Option.Option<Unsettled>> = []
        const snapshot = yield* Effect.scoped(runHost(agent, (value) => value === "moved" || value === "stalled", outputs))
        results.push(`${String(snapshot.value)}:${outputs.length}`)
      }
      assert.deepStrictEqual(new Set(results), new Set(["moved:0"]), `seeds ${seeds.join(",")}`)
    })
  )

  it.effect("[COV-2] fromAgent: the deadline cancels the request in flight and no later call reaches the machine (CONC-3)", () =>
    Effect.gen(function* () {
      const captured: Array<AgentTurnService> = []
      const cancelled: Array<number> = []
      const agent = fromAgent({
        budget: 2,
        deadline: 1000,
        tools: hostTools,
        turn: (_input: number, attempt) =>
          Effect.gen(function* () {
            captured.push(yield* AgentTurn)
            return yield* Effect.never
          }).pipe(Effect.onInterrupt(() => Effect.sync(() => cancelled.push(attempt)))),
      })
      const actor = yield* createActor(agentHost(agent))
      yield* actor.start
      yield* settle
      yield* TestClock.adjust(1000)
      yield* settle
      assert.deepStrictEqual(cancelled, [1])
      const reply = yield* firstOf(captured).transition({ type: "GO" })
      assert.deepStrictEqual(reply, { status: "refused", event: "GO", reason: "overdue" })
      assert.deepStrictEqual((yield* actor.getSnapshot).value, { thinking: "idle" })
    })
  )

  it.effect("[COV-2] fromAgent: a tool call that arrives at the deadline instant never moves the machine, whichever timer fires first, across 50 seeded runs (CONC-3, TS-119)", () =>
    Effect.gen(function* () {
      const results: Array<string> = []
      for (const seed of seeds) {
        // The seed decides whether the provider stream's timer is registered before or after the
        // agent's deadline timer, and how many turns the fibers take first
        const random = seeded(seed)
        const streamFirst = random() < 0.5
        const yields = Math.floor(random() * 10)
        const captured: Array<AgentTurnService> = []
        const replies: Array<TransitionReply> = []
        // Budget 2: the second attempt is still running, so the refusal can only be the deadline
        const agent = fromAgent({
          budget: 2,
          deadline: 1000,
          tools: hostTools,
          turn: (_input: number) =>
            Effect.gen(function* () {
              captured.push(yield* AgentTurn)
              return yield* Effect.never
            }),
        })
        // The provider stream delivers its tool call exactly at the deadline instant
        const stream = Effect.gen(function* () {
          yield* Effect.sleep(1000)
          replies.push(yield* firstOf(captured).transition({ type: "GO" }))
        })
        const run = Effect.gen(function* () {
          const early = streamFirst ? Option.some(yield* Effect.forkChild(stream, { startImmediately: true })) : Option.none()
          const actor = yield* createActor(agentHost(agent))
          yield* actor.start
          for (let turn = 0; turn < yields; turn++) yield* Effect.yieldNow
          const late = streamFirst ? early : Option.some(yield* Effect.forkChild(stream, { startImmediately: true }))
          yield* TestClock.adjust(1000)
          if (Option.isSome(late)) yield* Fiber.join(late.value)
          if (Option.isSome(early)) yield* Fiber.join(early.value)
          yield* settle
          return yield* actor.getSnapshot
        })
        const snapshot = yield* Effect.scoped(run)
        results.push(`${JSON.stringify(snapshot.value)}:${replies.map((reply) => (reply.status === "refused" ? reply.reason : reply.status)).join(",")}`)
      }
      assert.deepStrictEqual(new Set(results), new Set(['{"thinking":"idle"}:overdue']), `seeds ${seeds.join(",")}`)
    })
  )

  it.effect("[COV-2] fromAgent: a delivery that outlasts the deadline and then moves stops the agent with one prompt (CONC-3)", () =>
    Effect.gen(function* () {
      const prompts: Array<Prompt> = []
      const outputs: Array<Option.Option<Unsettled>> = []
      // The host is busy with an outside macrostep, so the agent's GO waits in its mailbox
      const agent = scriptedAgent(prompts, (turn) => Effect.andThen(Effect.sleep(100), turn.transition({ type: "GO" })))
      const actor = yield* createActor(agentHost(agent, outputs, Effect.sleep(1500)))
      yield* actor.start
      yield* settle
      yield* Effect.forkChild(actor.send({ type: "STAY" }), { startImmediately: true })
      yield* settle
      yield* TestClock.adjust(100)
      yield* settle
      yield* TestClock.adjust(900)
      yield* settle
      assert.strictEqual(prompts.length, 1, "the attempt waits for its delivery at the deadline")
      yield* TestClock.adjust(1000)
      const snapshot = yield* reach(actor, (current) => current.value === "moved")
      yield* settle
      assert.strictEqual(snapshot.value, "moved")
      assert.strictEqual(prompts.length, 1)
      assert.deepStrictEqual(outputs, [])
    })
  )

  it.effect("[COV-2] fromAgent: a delivery that outlasts the deadline and stays gives overdue, and only then attempt 2 (CONC-3)", () =>
    Effect.gen(function* () {
      const prompts: Array<Prompt> = []
      const agent = scriptedAgent(prompts, (turn, attempt) => (attempt === 1 ? turn.transition({ type: "STAY" }) : Effect.void))
      const actor = yield* createActor(agentHost(agent, [], Effect.sleep(1500)))
      yield* actor.start
      yield* settle
      yield* TestClock.adjust(1000)
      yield* settle
      assert.strictEqual(prompts.length, 1, "attempt 2 waits for the delivery in flight")
      yield* TestClock.adjust(500)
      const snapshot = yield* reach(actor, (current) => current.value === "stalled")
      assert.deepStrictEqual(feedbackOf(prompts), [undefined, { reason: "overdue", deadline: 1000 }, { reason: "silent" }])
      assert.deepStrictEqual(snapshot.context.unsettled, { reason: "silent", attempts: 3 })
    })
  )

  it.effect("[COV-2] fromAgent: a malformed report during a delivery that stays leaves the outcome illegal (S22)", () =>
    Effect.gen(function* () {
      const prompts: Array<Prompt> = []
      const agent = scriptedAgent(prompts, (turn, attempt) =>
        attempt > 1
          ? Effect.void
          : Effect.gen(function* () {
              const delivery = yield* Effect.forkChild(turn.transition({ type: "STAY" }), { startImmediately: true })
              yield* Effect.sleep(100)
              yield* turn.malformed("GO", "during the delivery")
              yield* Fiber.join(delivery)
            })
      )
      const actor = yield* createActor(agentHost(agent, [], Effect.sleep(500)))
      yield* actor.start
      yield* settle
      yield* TestClock.adjust(100)
      yield* settle
      yield* TestClock.adjust(400)
      yield* reach(actor, (current) => current.value === "stalled")
      assert.deepStrictEqual(feedbackOf(prompts)[1], { reason: "illegal", event: "STAY" })
    })
  )

  it.effect("[COV-2] fromAgent: a turn that times out its own transition still records it, and the next call finds no delivery in flight (S20, S22)", () =>
    Effect.gen(function* () {
      const prompts: Array<Prompt> = []
      const replies: Array<TransitionReply> = []
      const agent = scriptedAgent(prompts, (turn, attempt) =>
        Effect.gen(function* () {
          if (attempt === 3) return
          yield* Effect.timeoutOption(turn.transition({ type: "STAY" }), 100)
          if (attempt === 1) return
          yield* Effect.sleep(600)
          replies.push(yield* turn.transition({ type: "GUARDED" }))
        })
      )
      const actor = yield* createActor(agentHost(agent, [], Effect.sleep(500)))
      yield* actor.start
      yield* settle
      for (let step = 0; step < 15; step++) {
        yield* TestClock.adjust(100)
        yield* settle
      }
      const snapshot = yield* reach(actor, (current) => current.value === "stalled")
      assert.deepStrictEqual(feedbackOf(prompts), [undefined, { reason: "illegal", event: "STAY" }, { reason: "illegal", event: "STAY" }])
      assert.deepStrictEqual(replies, [{ status: "illegal", event: "GUARDED", delivered: true }])
      assert.deepStrictEqual(snapshot.context.unsettled, { reason: "silent", attempts: 3 })
    })
  )

  it.effect("[COV-2] fromAgent: a transition interrupted at any step is delivered and tracked whole, or not at all", () =>
    Effect.gen(function* () {
      const results: Array<string> = []
      for (let yields = 0; yields < 60; yields++) {
        const order: Array<string> = []
        const prompts: Array<Prompt> = []
        const ended = { turn: false }
        const agent = scriptedAgent(prompts, (turn, attempt) =>
          Effect.gen(function* () {
            if (attempt > 1) {
              order.push(`attempt ${attempt}`)
              return
            }
            // A yield every three ops, the fewest that still makes progress (the resume spends
            // two), so the interrupt can land between two steps of the call
            const call = yield* turn.transition({ type: "STAY" }).pipe(
              Effect.provideService(Scheduler.MaxOpsBeforeYield, 3),
              Effect.forkChild({ startImmediately: true })
            )
            for (let turns = 0; turns < yields; turns++) yield* Effect.yieldNow
            yield* Fiber.interrupt(call)
            ended.turn = true
          })
        )
        const macrostep = Effect.andThen(
          Effect.sync(() => order.push("delivered")),
          Effect.andThen(Effect.sleep(500), Effect.sync(() => order.push("macrostep done")))
        ).pipe(Effect.asVoid)
        const run = Effect.gen(function* () {
          const actor = yield* createActor(agentHost(agent, [], macrostep))
          yield* actor.start
          // The call yields at each op, so wait for the turn itself before the clock moves
          while (!ended.turn) yield* Effect.yieldNow
          yield* settle
          yield* TestClock.adjust(500)
          yield* reach(actor, (current) => current.value === "stalled")
        })
        yield* Effect.scoped(run)
        const delivered = order.includes("delivered")
        assert.deepStrictEqual(
          order,
          delivered ? ["delivered", "macrostep done", "attempt 2", "attempt 3"] : ["attempt 2", "attempt 3"],
          `${yields} yields: the next attempt waits for a delivery that started`
        )
        assert.deepStrictEqual(
          feedbackOf(prompts)[1],
          delivered ? { reason: "illegal", event: "STAY" } : { reason: "silent" },
          `${yields} yields: a delivered event is classified`
        )
        results.push(delivered ? "delivered" : "dropped")
      }
      assert.deepStrictEqual(new Set(results), new Set(["delivered", "dropped"]), "the interrupt landed on both sides of the claim")
    })
  )

  it.effect("[COV-2] fromAgent: provider retries that succeed use no attempt; spent retries count as crashed (WAIT-2)", () =>
    Effect.gen(function* () {
      const calls = { count: 0 }
      const flaky = Effect.suspend(() => {
        calls.count++
        return calls.count < 3 ? Effect.fail("rate limited") : Effect.succeed("ok")
      })
      const prompts: Array<Prompt> = []
      const retried = scriptedAgent(prompts, (turn) =>
        Effect.andThen(Effect.orDie(Effect.retry(flaky, Schedule.recurs(3))), turn.transition({ type: "GO" }))
      )
      yield* runHost(retried, (value) => value === "moved")
      assert.strictEqual(calls.count, 3)
      assert.strictEqual(prompts.length, 1)

      const spent = fromAgent({
        budget: 1,
        deadline: 1000,
        tools: hostTools,
        turn: (_input: number) => Effect.orDie(Effect.retry(Effect.fail("server error"), Schedule.recurs(2))),
      })
      const snapshot = yield* runHost(spent, (value) => value === "stalled")
      assert.deepStrictEqual(snapshot.context.unsettled, ({ reason: "crashed", attempts: 1 }))
    })
  )

  it.effect("[COV-2] fromAgent: stopping the host mid-turn outputs nothing and no Unsettled (TS-117)", () =>
    Effect.gen(function* () {
      const outputs: Array<Option.Option<Unsettled>> = []
      const cancelled: Array<number> = []
      const agent = scriptedAgent([], (_turn, attempt) =>
        Effect.onInterrupt(Effect.never, () => Effect.sync(() => cancelled.push(attempt)))
      )
      yield* Effect.scoped(
        Effect.gen(function* () {
          const actor = yield* createActor(agentHost(agent, outputs))
          yield* actor.start
          yield* settle
        })
      )
      assert.deepStrictEqual(cancelled, [1])
      assert.deepStrictEqual(outputs, [])
    })
  )

  it.effect("[COV-2] fromAgent: the persisted snapshot carries the attempts, the restore resumes after them, and each attempt is emitted", () =>
    Effect.gen(function* () {
      const prompts: Array<Prompt> = []
      const emitted: Array<number> = []
      const mode = { blockAt: 2 }
      const agent = scriptedAgent(prompts, (_turn, attempt) => (attempt === mode.blockAt ? Effect.never : Effect.void))
      const machine = agentHost(agent)
      const first = yield* createActor(machine)
      yield* first.start
      const child = (yield* first.getSnapshot).children.agent
      assert.isDefined(child)
      yield* child.on("attempt", (event: EventObject) => Effect.sync(() => emitted.push(Number(Reflect.get(event, "attempt")))))
      yield* settle
      assert.deepStrictEqual(prompts.map((prompt) => prompt.attempt), [1, 2])
      assert.deepStrictEqual(emitted, [2], "attempt 2 was emitted ahead of its turn")
      const persisted = yield* first.getPersistedSnapshot
      assert.nestedPropertyVal(persisted, "children.agent.snapshot.attempts", 2)

      mode.blockAt = 0
      const restored = yield* createActor(machine, { snapshot: persisted })
      yield* restored.start
      const snapshot = yield* reach(restored, (current) => current.value === "stalled")
      assert.deepStrictEqual(prompts.slice(2), [
        { attempt: 3, feedback: Option.some<TurnOutcome>({ reason: "crashed", detail: "the process stopped during attempt 2" }) },
      ])
      assert.deepStrictEqual(snapshot.context.unsettled, ({ reason: "silent", attempts: 3 }))
    })
  )

  it("[COV-2] fromAgent: a budget or deadline that is no positive integer literal, and AgentTurn outside a turn, fail to compile (NEG-5, decision 19)", () => {
    const turn = (_input: number) => Effect.void
    const wide: number = 3
    const union: 2 | 3 = 2
    const brand = 3 as number & { readonly brand: "budget" }
    const refused = [
      // @ts-expect-error a wide number is no literal budget
      () => fromAgent({ budget: wide, deadline: 1000, tools: hostTools, turn }),
      // @ts-expect-error zero is no positive budget
      () => fromAgent({ budget: 0, deadline: 1000, tools: hostTools, turn }),
      // @ts-expect-error a negative budget
      () => fromAgent({ budget: -1, deadline: 1000, tools: hostTools, turn }),
      // @ts-expect-error a fractional budget
      () => fromAgent({ budget: 1.5, deadline: 1000, tools: hostTools, turn }),
      // @ts-expect-error 1e21 is written 1e+21, no integer literal
      () => fromAgent({ budget: 1e21, deadline: 1000, tools: hostTools, turn }),
      // @ts-expect-error a union is no single literal
      () => fromAgent({ budget: union as 2 | 3, deadline: 1000, tools: hostTools, turn }),
      // @ts-expect-error number & {} is wide
      () => fromAgent({ budget: wide as number & {}, deadline: 1000, tools: hostTools, turn }),
      // @ts-expect-error a branded number is no literal
      () => fromAgent({ budget: brand, deadline: 1000, tools: hostTools, turn }),
      // @ts-expect-error Infinity is typed number
      () => fromAgent({ budget: Infinity, deadline: 1000, tools: hostTools, turn }),
      // @ts-expect-error the deadline is required
      () => fromAgent({ budget: 3, tools: hostTools, turn }),
      // @ts-expect-error an infinite deadline
      () => fromAgent({ budget: 3, deadline: Infinity, tools: hostTools, turn }),
      // @ts-expect-error a wide deadline
      () => fromAgent({ budget: 3, deadline: wide, tools: hostTools, turn }),
      // @ts-expect-error a zero deadline
      () => fromAgent({ budget: 3, deadline: 0, tools: hostTools, turn }),
      // @ts-expect-error a fractional deadline
      () => fromAgent({ budget: 3, deadline: 2.5, tools: hostTools, turn }),
    ]
    const generic = <N extends number>(budget: N) =>
      // @ts-expect-error a generic number is no literal budget
      fromAgent({ budget, deadline: 1000, tools: hostTools, turn })

    // A function that needs AgentTurn compiles inside a turn, and the agent needs nothing
    const needsTurn = Effect.map(AgentTurn, (agent) => agent.attempt)
    const inTurn: AgentActorLogic<unknown> = fromAgent({ budget: 1, deadline: 10, tools: hostTools, turn: () => needsTurn })
    const plain = fromEffect(() => needsTurn)
    // @ts-expect-error a plain fromEffect that needs AgentTurn cannot run: nothing provides it
    const run: Effect.Effect<unknown, never, Scope.Scope> = createActor(plain)
    // @ts-expect-error no value of AgentTurnService is built by hand
    const forged: AgentTurnService = { attempt: 1, transition: () => Effect.die("no"), malformed: () => Effect.void }
    assert.strictEqual(refused.length, 14)
    assert.isFunction(generic)
    assert.isDefined(inTurn)
    assert.isDefined(run)
    assert.isDefined(forged)
  })

  it.effect.each([
    ["budget NaN", { budget: Number.NaN, deadline: 1000 }],
    ["budget Infinity", { budget: Number.POSITIVE_INFINITY, deadline: 1000 }],
    ["budget 0", { budget: 0, deadline: 1000 }],
    ["budget -1", { budget: -1, deadline: 1000 }],
    ["budget 1.5", { budget: 1.5, deadline: 1000 }],
    ["an unsafe budget", { budget: Number.MAX_SAFE_INTEGER + 1, deadline: 1000 }],
    ["a text budget", { budget: "3", deadline: 1000 }],
    ["deadline NaN", { budget: 3, deadline: Number.NaN }],
    ["deadline Infinity", { budget: 3, deadline: Number.POSITIVE_INFINITY }],
    ["deadline 0", { budget: 3, deadline: 0 }],
    ["deadline -1", { budget: 3, deadline: -1 }],
    ["deadline 2.5", { budget: 3, deadline: 2.5 }],
    ["an unsafe deadline", { budget: 3, deadline: Number.MAX_SAFE_INTEGER + 1 }],
  ] as const)("[COV-2] fromAgent: %s is refused at run time with AgentRunError, and no turn runs (NEG-5)", ([name, literals]) =>
    Effect.gen(function* () {
      const prompts: Array<Prompt> = []
      const field = name.includes("budget") ? "budget" : "deadline"
      // The cast is the case under test: it reaches what the literal check of the types refuses
      const untyped = fromAgent as unknown as (config: unknown) => HostAgent
      const agent = untyped({
        ...literals,
        tools: hostTools,
        turn: (_input: number, attempt: number, feedback: Option.Option<TurnOutcome>) => Effect.sync(() => prompts.push({ attempt, feedback })),
      })
      const logic = unbranded(agent)
      const initial: AgentSnapshot<number> = { ...agentSnapshotShape, attempts: 0, last: Option.none() }
      const scope = Layer.succeed(ActorScope, createInertActorScope(initial))
      const restoreSnapshot = logic.restoreSnapshot
      const start = logic.start
      assert.isDefined(restoreSnapshot)
      assert.isDefined(start)
      const persisted = { status: "active", input: 1, attempts: 0, last: null }
      const defectOf = (effect: Effect.Effect<unknown, unknown>) =>
        Effect.map(Effect.exit(effect), (exit) => (Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined))
      const defects = [
        yield* defectOf(Effect.provide(logic.getInitialSnapshot(1), scope)),
        yield* defectOf(Effect.provide(restoreSnapshot(persisted), scope)),
        yield* defectOf(Effect.scoped(Effect.provide(start(initial), scope))),
      ]
      for (const defect of defects) {
        assert.instanceOf(defect, AgentRunError)
        assert.include(defect.message, field)
      }

      const host = yield* createActor(agentHost(agent))
      yield* host.start
      yield* settle
      assert.strictEqual((yield* host.getSnapshot).status, "error")
      assert.deepStrictEqual(prompts, [])
    })
  )

  it.effect("[COV-2] fromAgent: a defect that is a string, or no Error, is crashed with its text", () =>
    Effect.gen(function* () {
      const prompts: Array<Prompt> = []
      const agent = scriptedAgent(prompts, (_turn, attempt) => (attempt === 1 ? Effect.die("text defect") : Effect.die(42)))
      const snapshot = yield* runHost(agent, (value) => value === "stalled")
      assert.deepStrictEqual(feedbackOf(prompts), [undefined, { reason: "crashed", detail: "text defect" }, { reason: "crashed", detail: "42" }])
      assert.deepStrictEqual(snapshot.context.unsettled, { reason: "crashed", attempts: 3 })
    })
  )

  it.effect.each([
    ["an object with no prototype", () => Object.create(null)],
    ["an object whose toString throws", () => ({ toString: () => assert.fail("no text") })],
    ["an Error whose message getter throws", () => Object.defineProperty(new Error("x"), "message", { get: () => assert.fail("no text") })],
    ["a proxy that refuses every read", () => new Proxy({}, { get: () => assert.fail("no text"), getPrototypeOf: () => assert.fail("no text") })],
  ] as const)("[COV-2] fromAgent: a defect that is %s still reaches Unsettled with reason crashed", ([_name, defect]) =>
    Effect.gen(function* () {
      const prompts: Array<Prompt> = []
      const agent = scriptedAgent(prompts, () => Effect.die(defect()))
      const snapshot = yield* runHost(agent, (value) => value === "stalled")
      assert.deepStrictEqual(snapshot.context.unsettled, { reason: "crashed", attempts: 3 })
      assert.deepStrictEqual(feedbackOf(prompts)[1], { reason: "crashed", detail: "a defect with no text" })
    })
  )

  it.effect("[COV-2] fromAgent: an Error whose message is no string gives crashed text that a restore accepts", () =>
    Effect.gen(function* () {
      const prompts: Array<Prompt> = []
      const hostile = Object.defineProperty(new Error("x"), "message", { value: 42 })
      const snapshot = yield* runHost(scriptedAgent(prompts, () => Effect.die(hostile)), (value) => value === "stalled")
      assert.deepStrictEqual(feedbackOf(prompts)[1], { reason: "crashed", detail: "42" })
      assert.strictEqual(snapshot.status, "done")
    })
  )

  it.effect("[COV-2] fromAgent: a restored snapshot resumes from its recorded attempts, settles at once when they are spent, and refuses agent fields that do not decode", () =>
    Effect.gen(function* () {
      const prompts: Array<Prompt> = []
      const agent = scriptedAgent(prompts, (_turn, attempt) => (attempt === 1 ? Effect.never : Effect.void))
      const machine = agentHost(agent)
      const first = yield* createActor(machine)
      yield* first.start
      yield* settle
      const persisted = yield* first.getPersistedSnapshot
      /** The persisted host with the agent's attempts and last outcome replaced. */
      const withAgent = (attempts: unknown, last: unknown) => {
        const copy = structuredClone(persisted)
        const field = (value: unknown, key: string): unknown => (Predicate.isObjectKeyword(value) ? Reflect.get(value, key) : undefined)
        const snapshot = field(field(field(copy, "children"), "agent"), "snapshot")
        if (!Predicate.isObjectKeyword(snapshot)) return assert.fail("the host persisted its agent")
        Reflect.set(snapshot, "attempts", attempts)
        Reflect.set(snapshot, "last", last)
        return copy
      }
      const restore = (snapshot: unknown) =>
        Effect.gen(function* () {
          const actor = yield* createActor(machine, { snapshot })
          yield* actor.start
          return yield* reach(actor, (current) => current.value === "stalled")
        })

      prompts.length = 0
      const resumed = yield* restore(withAgent(1, { attempt: 1, outcome: { reason: "silent" } }))
      assert.deepStrictEqual(feedbackOf(prompts), [{ reason: "silent" }, { reason: "silent" }])
      assert.deepStrictEqual(resumed.context.unsettled, { reason: "silent", attempts: 3 })

      prompts.length = 0
      const spent = yield* restore(withAgent(3, { attempt: 3, outcome: { reason: "illegal", event: "IGNORED" } }))
      assert.deepStrictEqual(prompts, [])
      assert.deepStrictEqual(spent.context.unsettled, { reason: "illegal", attempts: 3 })

      // A redeploy lowered the budget from 5 to 3: the output reports the 5 turns used
      prompts.length = 0
      const lowered = yield* restore(withAgent(5, { attempt: 5, outcome: { reason: "silent" } }))
      assert.deepStrictEqual(prompts, [])
      assert.deepStrictEqual(lowered.context.unsettled, { reason: "silent", attempts: 5 })

      const unfinished = yield* restore(withAgent(3, null))
      assert.deepStrictEqual(prompts, [])
      assert.deepStrictEqual(unfinished.context.unsettled, { reason: "crashed", attempts: 3 })

      const restoreSnapshot = unbranded(agent).restoreSnapshot
      assert.isDefined(restoreSnapshot)
      const refused = yield* Effect.flip(
        restoreSnapshot({ status: "active", output: null, error: null, input: 1, attempts: "two", last: null }).pipe(
          Effect.provide(Layer.succeed(ActorScope, createInertActorScope(yield* getInitialSnapshot(unbranded(agent), 1))))
        )
      )
      assert.strictEqual(refused._tag, "RestoreError")
    })
  )

  it.effect.each([
    ["negative attempts", { attempts: -10 }],
    ["NaN attempts", { attempts: Number.NaN }],
    ["infinite attempts", { attempts: Number.POSITIVE_INFINITY }],
    ["fractional attempts", { attempts: 1.5 }],
    ["unsafe attempts", { attempts: Number.MAX_SAFE_INTEGER + 1 }],
    ["a negative last attempt", { last: { attempt: -1, outcome: { reason: "silent" } } }],
    ["a zero last attempt", { last: { attempt: 0, outcome: { reason: "silent" } } }],
    ["a NaN last attempt", { last: { attempt: Number.NaN, outcome: { reason: "silent" } } }],
    ["a fractional last attempt", { last: { attempt: 1.5, outcome: { reason: "silent" } } }],
    ["a NaN overdue deadline", { last: { attempt: 1, outcome: { reason: "overdue", deadline: Number.NaN } } }],
    ["a zero overdue deadline", { last: { attempt: 1, outcome: { reason: "overdue", deadline: 0 } } }],
    ["a negative overdue deadline", { last: { attempt: 1, outcome: { reason: "overdue", deadline: -1 } } }],
    ["a fractional overdue deadline", { last: { attempt: 1, outcome: { reason: "overdue", deadline: 2.5 } } }],
    ["a negative output count", { status: "done", output: { reason: "silent", attempts: -1 } }],
    ["a fractional output count", { status: "done", output: { reason: "silent", attempts: 1.5 } }],
    ["an unknown output reason", { status: "done", output: { reason: "moved", attempts: 1 } }],
  ] as const)("[COV-2] fromAgent: a restore refuses %s with RestoreError", ([_name, fields]) =>
    Effect.gen(function* () {
      const prompts: Array<Prompt> = []
      const agent = unbranded(scriptedAgent(prompts, () => Effect.void))
      const restoreSnapshot = agent.restoreSnapshot
      assert.isDefined(restoreSnapshot)
      const persisted = { status: "active", output: null, error: null, input: 1, attempts: 1, last: null, ...fields }
      const refused = yield* Effect.flip(
        restoreSnapshot(persisted).pipe(Effect.provide(Layer.succeed(ActorScope, createInertActorScope(yield* getInitialSnapshot(agent, 1)))))
      )
      assert.strictEqual(refused._tag, "RestoreError")
      assert.deepStrictEqual(prompts, [])
    })
  )

  it.effect("[COV-2] fromAgent: a restore keeps the fields a real agent persists, a settled output among them", () =>
    Effect.gen(function* () {
      const agent = unbranded(scriptedAgent([], () => Effect.void))
      const restoreSnapshot = agent.restoreSnapshot
      assert.isDefined(restoreSnapshot)
      const persisted = { status: "done", output: { reason: "overdue", attempts: 3 }, attempts: 3, last: { attempt: 3, outcome: { reason: "overdue", deadline: 1000 } } }
      const restored = yield* restoreSnapshot(persisted).pipe(
        Effect.provide(Layer.succeed(ActorScope, createInertActorScope(yield* getInitialSnapshot(agent, 1))))
      )
      assert.deepStrictEqual(restored.output, Option.some({ reason: "overdue", attempts: 3 }))
      assert.strictEqual(restored.attempts, 3)
    })
  )

  it.effect("[COV-2] fromAgent: the pure transition ignores a foreign event and an ended snapshot, and start runs nothing for an ended snapshot", () =>
    Effect.gen(function* () {
      const prompts: Array<Prompt> = []
      const agent = unbranded(scriptedAgent(prompts, () => Effect.void))
      const initial = yield* getInitialSnapshot(agent, 1)
      const foreign = { type: "xstate.agent.unsettled", unsettled: { reason: "silent", attempts: 1 } }
      assert.strictEqual(yield* getNextSnapshot(agent, initial, foreign), initial, "a look-alike self event changes nothing")
      const stopped = yield* getNextSnapshot(agent, initial, new StopEvent())
      assert.strictEqual(stopped.status, "stopped")
      assert.strictEqual(yield* getNextSnapshot(agent, stopped, new StopEvent()), stopped)
      yield* runStart(agent, stopped, createInertActorScope(stopped))
      assert.deepStrictEqual(prompts, [])
    })
  )
})

// ============================================================
// fromAgent capability refusal (agent-settlement T1.10)
// ============================================================

/** An agent's own methods, each called with the values in `capability` after its usual arguments. */
const ownMethods: ReadonlyArray<readonly [string, (logic: AnyActorLogic, snapshot: Snapshot<unknown>, capability: ReadonlyArray<never>) => unknown]> = [
  ["transition", (logic, snapshot, capability) => logic.transition(snapshot, { type: "GO" }, ...capability)],
  ["start", (logic, snapshot, capability) => logic.start?.(snapshot as never, ...capability)],
  ["restoreSnapshot", (logic, snapshot, capability) => logic.restoreSnapshot?.(snapshot as never, ...capability)],
  ["getPersistedSnapshot", (logic, snapshot, capability) => logic.getPersistedSnapshot(snapshot as never, ...capability)],
]

/** Each value that is not the runtime's capability, a same-keyed copy of it included. */
const notCapabilities: ReadonlyArray<readonly [string, ReadonlyArray<unknown>]> = [
  ["no value", []],
  ["undefined", [undefined]],
  ["an invented object", [{}]],
  ["a copy of the capability", [{ ...logicCapability }]],
]

describe("COV-2 src/actors: fromAgent refuses a call without the runtime's capability", () => {
  const cases = ownMethods.flatMap(([method, call]) => notCapabilities.map(([given, capability]) => [method, given, call, capability] as const))

  it.effect.each(cases)("[COV-2] fromAgent: %s with %s dies with AgentRunError before a turn starts", ([_method, _given, call, capability]) =>
    Effect.gen(function* () {
      const prompts: Array<Prompt> = []
      const logic = scriptedAgent(prompts, () => Effect.void)
      const initial = yield* getInitialSnapshot(unbranded(logic), 1)
      const hidden = logic as unknown as AnyActorLogic
      const refused = call(hidden, initial, capability as ReadonlyArray<never>) as Effect.Effect<unknown, unknown, ActorScope>
      const exit = yield* Effect.exit(Effect.scoped(refused).pipe(Effect.provide(Layer.succeed(ActorScope, createInertActorScope(initial)))))
      assert.isTrue(Exit.isFailure(exit))
      if (Exit.isFailure(exit)) assert.instanceOf(Cause.squash(exit.cause), AgentRunError)
      assert.deepStrictEqual(prompts, [])
    })
  )

  it.effect("[COV-2] fromAgent: a copy of agent logic, invoked by a machine, gets no capability and runs no turn", () =>
    Effect.gen(function* () {
      const prompts: Array<Prompt> = []
      const logic = scriptedAgent(prompts, () => Effect.void)
      const copy = { ...logic } as unknown as AnyActorLogic
      const machine = createMachine({
        id: "copy",
        initial: "thinking",
        states: { thinking: { invoke: { src: copy, input: 1 } } },
      } as never)
      const running = Effect.gen(function* () {
        const actor = yield* createActor(machine as never)
        yield* (actor as unknown as { readonly start: Effect.Effect<void> }).start
        yield* settle
      }) as Effect.Effect<void, never, Scope.Scope>
      yield* Effect.exit(Effect.scoped(running))
      assert.deepStrictEqual(prompts, [])
    })
  )

  it("[COV-2] fromAgent: agent logic cannot be changed in place, so the runtime's capability reaches only its own methods", () => {
    const logic = scriptedAgent([], () => Effect.void)
    assert.isTrue(Object.isFrozen(logic))
    assert.isFalse(Reflect.set(logic, "transition", () => Effect.void))
  })
})

// ============================================================
// fromAgent tool menu (agent-settlement T1.5)
// ============================================================

/** The tool `REPORT`: its `count` arrives as text and decodes to a number. */
const ReportTool = Schema.Struct({ type: Schema.Literal("REPORT"), count: Schema.FiniteFromString })

/** The tool `SIDE`, which a sibling region handles without leaving the agent state. */
const SideTool = Schema.Struct({ type: Schema.Literal("SIDE") })

/** The tools of the menu host's agent, by event type. */
const menuTools = { REPORT: ReportTool, SIDE: SideTool }

/**
 * A schema setup machine with two regions. `work.asking` invokes `agent` and leaves on
 * `REPORT`, which writes the decoded count; the `side` region counts `SIDE` and never leaves
 * `asking`. The machine checks every event against the decoded event types, so a payload that
 * reached it undecoded would kill it.
 */
const menuHost = (agent: AgentActorLogic<number, never, typeof menuTools>) =>
  setupWithSchema({
    context: Schema.Struct({ count: Schema.Number, sides: Schema.Number, unsettled: Schema.NullOr(Schema.Unknown) }),
    events: Schema.Union([ReportTool, SideTool]),
    actors: { agent },
  }).createMachine({
    id: "menu",
    context: { count: 0, sides: 0, unsettled: null },
    type: "parallel",
    states: {
      work: {
        initial: "asking",
        states: {
          asking: {
            invoke: {
              // This runtime-negative fixture offers SIDE only in a sibling region.
              // @ts-expect-error AgentToolNotAccepted: the sibling handler cannot settle work.asking.
              src: "agent",
              input: 1,
              onDone: { target: "stalled", actions: assign(({ event }) => ({ unsettled: Option.getOrNull(event.output) })) },
            },
            on: { REPORT: { target: "reported", actions: assign(({ event }) => ({ count: event.count })) } },
          },
          reported: { type: "final" },
          stalled: { type: "final" },
        },
      },
      // `side` counts `SIDE` anywhere in its region; its timed close is its progress guarantee (settlement proof)
      side: {
        on: { SIDE: { actions: assign(({ context }) => ({ sides: context.sides + 1 })) } },
        initial: "open",
        states: { open: { after: { 600000: "closed" } }, closed: { type: "final" } },
      },
    },
  })

/** Agent logic with the menu tools, budget 2, whose turn records each prompt and runs `act` with the typed capability. */
const menuAgent = (
  prompts: Array<Prompt>,
  act: (agent: AgentTurnService<keyof typeof menuTools>, attempt: number) => Effect.Effect<unknown>
) =>
  fromAgent({
    budget: 2,
    deadline: 1000,
    tools: menuTools,
    turn: (_input: number, attempt, feedback, agent) =>
      Effect.suspend(() => {
        prompts.push({ attempt, feedback })
        return act(agent, attempt)
      }),
  })

/** Starts the menu host of `agent` and waits until its `work` region matches `done`. */
const runMenuHost = (agent: AgentActorLogic<number, never, typeof menuTools>, done: (work: unknown) => boolean) =>
  Effect.gen(function* () {
    const actor = yield* createActor(menuHost(agent))
    yield* actor.start
    return yield* reach(actor, (snapshot) => done(Reflect.get(Object(snapshot.value), "work")))
  })

describe("COV-2 fromAgent tool menu (agent-settlement T1.5)", () => {
  it.effect("[COV-2] fromAgent: a payload that fails its tool's schema is malformed, with the decode issues in the reply and the feedback, and never reaches the machine (S21)", () =>
    Effect.gen(function* () {
      const prompts: Array<Prompt> = []
      const replies: Array<TransitionReply> = []
      const agent = menuAgent(prompts, (turn) =>
        Effect.map(turn.transition({ type: "REPORT", count: "many" }), (reply) => replies.push(reply))
      )
      const snapshot = yield* runMenuHost(agent, (work) => work === "stalled")
      const reply = firstOf(replies)
      assert.strictEqual(reply.status, "malformed")
      assert.strictEqual(reply.event, "REPORT")
      assert.include(Reflect.get(reply, "detail"), "count")
      assert.deepStrictEqual(feedbackOf(prompts), [undefined, { reason: "malformed", event: "REPORT", detail: Reflect.get(reply, "detail") }])
      assert.deepStrictEqual(snapshot.context, { count: 0, sides: 0, unsettled: { reason: "malformed", attempts: 2 } })
      assert.strictEqual(snapshot.status, "active", "no undecoded event errored the host")
    })
  )

  it.effect("[COV-2] fromAgent: a payload that decodes is delivered decoded, once, so the machine's schema check passes and the state moves (S21)", () =>
    Effect.gen(function* () {
      const prompts: Array<Prompt> = []
      const agent = menuAgent(prompts, (turn) => turn.transition({ type: "REPORT", count: "7" }))
      const snapshot = yield* runMenuHost(agent, (work) => work === "reported")
      assert.strictEqual(snapshot.context.count, 7)
      assert.deepStrictEqual(prompts.map((prompt) => prompt.attempt), [1])
    })
  )

  it.effect("[COV-2] fromAgent: a sibling region's tool is delivered and, as it does not leave the agent state, is illegal (S21, decision 17)", () =>
    Effect.gen(function* () {
      const replies: Array<TransitionReply> = []
      const agent = menuAgent([], (turn) => Effect.map(turn.transition({ type: "SIDE" }), (reply) => replies.push(reply)))
      const snapshot = yield* runMenuHost(agent, (work) => work === "stalled")
      assert.deepStrictEqual(replies, [
        { status: "illegal", event: "SIDE", delivered: true },
        { status: "illegal", event: "SIDE", delivered: true },
      ])
      assert.strictEqual(snapshot.context.sides, 2)
      assert.deepStrictEqual(snapshot.context.unsettled, { reason: "illegal", attempts: 2 })
    })
  )

  it.effect("[COV-2] fromAgent: an event that is no tool, an xstate. event among them, is illegal and never delivered (S21, S20)", () =>
    Effect.gen(function* () {
      const prompts: Array<Prompt> = []
      const replies: Array<TransitionReply> = []
      const events = ["UNKNOWN", "xstate.done.actor.agent"]
      const agent = fromAgent({
        budget: 2,
        deadline: 1000,
        tools: menuTools,
        turn: (_input: number, attempt, feedback) =>
          Effect.gen(function* () {
            prompts.push({ attempt, feedback })
            const untyped = yield* AgentTurn
            replies.push(yield* untyped.transition({ type: events[attempt - 1] ?? "UNKNOWN" }))
          }),
      })
      const snapshot = yield* runMenuHost(agent, (work) => work === "stalled")
      assert.deepStrictEqual(replies, events.map((event) => ({ status: "illegal", event, delivered: false })))
      assert.deepStrictEqual(feedbackOf(prompts), [undefined, { reason: "illegal", event: "UNKNOWN" }])
      assert.deepStrictEqual(snapshot.context.unsettled, { reason: "illegal", attempts: 2 })
    })
  )

  it("[COV-2] fromAgent: the typed capability takes only the agent's tools, and tools are keyed by their event type (S21)", () => {
    const refused = [
      // @ts-expect-error GO is no tool of this agent
      () => menuAgent([], (turn) => turn.transition({ type: "GO" })),
      // @ts-expect-error a tool's key must be its event's type
      () => fromAgent({ budget: 1, deadline: 10, tools: { WRONG: SideTool }, turn: () => Effect.void }),
      // @ts-expect-error an agent needs its tools
      () => fromAgent({ budget: 1, deadline: 10, turn: () => Effect.void }),
    ]
    assert.strictEqual(refused.length, 3)
  })
})
