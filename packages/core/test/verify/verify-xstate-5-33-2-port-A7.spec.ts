/**
 * A7: non-machine logic emits events from async code.
 *
 * T4.13. Upstream (`actors/callback.ts`, `actors/promise.ts`, `actors/transition.ts`,
 * `actors/observable.ts` and `createActor.ts` at xstate@5.33.2): the `emit` a callback, a promise
 * creator, a reducer and an observable creator receive is `actorScope.emit`, which calls the
 * listeners of the event's type, then the `'*'` listeners, one by one, inside the call, from any
 * code and for as long as the actor runs; a listener that throws is reported
 * (`reportUnhandledError`; the port's logger, SD-21) and the rest go on. `sendBack` and an
 * observer's `next` relay at once through the system (`system._relay`). No event reaches the
 * emitting actor for an emit, so no transition is needed for it.
 *
 * The port's `emit` and `sendBack` are plain functions over Effects: each call runs its delivery
 * at once, in a fiber of the actor's scope, so a listener has run when `emit` returns (a listener
 * that waits finishes later, and the deliveries of one actor keep their order). Timers run on the
 * Effect clock (TestClock), never on wall-clock time; a timer callback runs outside every actor,
 * as upstream.
 */
import { assert, describe, it } from "@effect/vitest"
import { Cause, Duration, Effect, Logger, Option, Scope } from "effect"
import { TestClock } from "effect/testing"
import type { ActorRefBase } from "../../src/ActorRef.js"
import {
  type ActorSystemService,
  assign,
  createActor,
  createMachine,
  type EventObject,
  fromCallback,
  fromObservable,
  fromPromise,
  fromTransition,
  spawnChild,
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

/**
 * A host-style `setTimeout` on the Effect clock: `fn` runs after `ms` of TestClock time, in a
 * fiber of the test's scope, outside every actor, as a timer callback runs upstream.
 */
const effectTimers = Effect.map(Effect.context<Scope.Scope>(), (context) => {
  const runFork = Effect.runForkWith(context)
  return (fn: () => void, ms: number): void => {
    runFork(Effect.forkScoped(Effect.andThen(Effect.sleep(Duration.millis(ms)), Effect.sync(fn)), { startImmediately: true }))
  }
})

/** The log entries a test logger kept. */
type Entries = Array<Logger.Options<unknown>>

/** Runs `program` with a logger that keeps every log entry in `entries` and logs `reported` in `log`. */
const withLogger = <A, E, R>(entries: Entries, log: Array<string>, program: Effect.Effect<A, E, R>) =>
  program.pipe(
    Effect.provide(
      Logger.layer([
        Logger.make((options) => {
          entries.push(options)
          if (options.logLevel === "Error") {
            log.push("reported")
          }
        }),
      ])
    )
  )

/** The values one log entry carries: its message parts, then the errors and defects of its cause. */
const reportedValues = (entry: Logger.Options<unknown>): ReadonlyArray<unknown> => [
  ...(Array.isArray(entry.message) ? entry.message : [entry.message]),
  ...entry.cause.reasons.flatMap((reason) =>
    Cause.isDieReason(reason) ? [reason.defect] : Cause.isFailReason(reason) ? [reason.error] : []
  ),
]

/** One `@xstate.event` inspection event: who received it, who sent it, and the event. */
interface Inspected {
  readonly target: ActorRefBase
  readonly source: Option.Option<ActorRefBase>
  readonly event: EventObject
}

/** Keeps every `@xstate.event` inspection event of `actor`'s system, until the test ends. */
const inspectEvents = (actor: { readonly system: ActorSystemService }, into: Array<Inspected>) =>
  actor.system.inspect((inspection) =>
    Effect.sync(() => {
      if (inspection.type === "@xstate.event") {
        into.push({ target: inspection.actorRef, source: inspection.sourceRef, event: inspection.event })
      }
    })
  )

/** The types of the inspected events whose target is `actor`, in order. */
const eventTypesTo = (inspected: ReadonlyArray<Inspected>, actor: ActorRefBase) =>
  inspected.filter((entry) => entry.target === actor).map((entry) => entry.event.type)

/** A listener that logs `heard <type>` for each event it receives. */
const hearInto = (log: Array<string>, prefix = "heard") => (event: EventObject) =>
  Effect.sync(() => {
    log.push(`${prefix} ${event.type}`)
  })

interface Received {
  readonly received: ReadonlyArray<string>
}

describe("A7 Non-machine logic emits events from async code", () => {
  it.effect("[A7] an emit from a fromCallback timer reaches the type listeners, then the '*' listeners, inside the emit call, and no event reaches the actor", () =>
    Effect.gen(function* () {
      const setEffectTimeout = yield* effectTimers
      const log: Array<string> = []
      const logic = fromCallback<EventObject, unknown, { readonly type: "a7.timer" }>(({ emit }) => {
        setEffectTimeout(() => {
          emit({ type: "a7.timer" })
          log.push("emit returned")
        }, 10)
      })
      const actor = yield* createActor(logic)
      const inspected: Array<Inspected> = []
      yield* inspectEvents(actor, inspected)
      yield* actor.on("*", hearInto(log, "wildcard"))
      yield* actor.on("a7.timer", hearInto(log))
      yield* actor.start
      yield* settle
      assert.deepStrictEqual(log, [], "nothing is emitted before the timer")

      yield* TestClock.adjust("10 millis")
      assert.isTrue(yield* eventually(Effect.sync(() => log.includes("emit returned"))), "the timer runs")

      // Upstream `actorScope.emit` calls every listener before it returns
      assert.deepStrictEqual(log, ["heard a7.timer", "wildcard a7.timer", "emit returned"])
      // Upstream `start` reports the init event (`@xstate.event`); the emit adds none
      assert.deepStrictEqual(eventTypesTo(inspected, actor), ["xstate.init"], "the emit sends no event to the actor")
      assert.strictEqual((yield* actor.getSnapshot).status, "active")
    })
  )

  it.effect("[A7] a sendBack from a fromCallback timer is relayed to the parent inside the sendBack call, and the parent takes it with no other event", () =>
    Effect.gen(function* () {
      const setEffectTimeout = yield* effectTimers
      const log: Array<string> = []
      const child = fromCallback(({ sendBack }) => {
        setEffectTimeout(() => {
          sendBack({ type: "PING" })
          log.push("sendBack returned")
        }, 10)
      })
      const parent = createMachine<Received, EventObject>({
        id: "a7-parent",
        context: { received: [] },
        entry: spawnChild<Received, EventObject, typeof child>(child, { id: "cb" }),
        on: { PING: { actions: assign<Received, EventObject>(({ context, event }) => ({ received: [...context.received, event.type] })) } },
      })
      const actor = yield* createActor(parent)
      const inspected: Array<Inspected> = []
      // The relay's inspection event names its source; the one of the parent's own processing
      // of the event names none
      yield* actor.system.inspect((inspection) =>
        Effect.sync(() => {
          if (inspection.type === "@xstate.event" && inspection.actorRef === actor && Option.isSome(inspection.sourceRef)) {
            inspected.push({ target: inspection.actorRef, source: inspection.sourceRef, event: inspection.event })
            log.push(`relayed ${inspection.event.type}`)
          }
        })
      )
      yield* actor.start
      yield* settle
      const cb = (yield* actor.getSnapshot).children["cb"]

      yield* TestClock.adjust("10 millis")
      assert.isTrue(yield* eventually(Effect.sync(() => log.includes("sendBack returned"))), "the timer runs")

      // Upstream relays inside `sendBack`: the relay's inspection event comes before it returns
      assert.deepStrictEqual(log, ["relayed PING", "sendBack returned"])
      assert.isTrue(Option.exists(inspected[0]?.source ?? Option.none(), (source) => source === cb), "the child is the sender")
      assert.isTrue(
        yield* eventually(Effect.map(actor.getSnapshot, (snapshot) => snapshot.context.received.length === 1)),
        "the parent takes PING"
      )
      assert.deepStrictEqual((yield* actor.getSnapshot).context.received, ["PING"])
    })
  )

  it.effect("[A7] an emit in the promise creator's own code reaches the listeners before start returns, and an emit after the creator returned reaches them inside the emit call", () =>
    Effect.gen(function* () {
      const setEffectTimeout = yield* effectTimers
      const log: Array<string> = []
      const logic = fromPromise<number, unknown, { readonly type: "a7.sync" | "a7.later" }>(({ emit }) => {
        emit({ type: "a7.sync" })
        return new Promise<number>((resolve) => {
          setEffectTimeout(() => {
            emit({ type: "a7.later" })
            log.push("emit returned")
            resolve(42)
          }, 10)
        })
      })
      const actor = yield* createActor(logic)
      yield* actor.on("*", hearInto(log))

      yield* actor.start
      // Upstream calls the creator inside `start`, and its emit calls the listeners at once
      assert.deepStrictEqual(log, ["heard a7.sync"])

      yield* TestClock.adjust("10 millis")
      assert.isTrue(yield* eventually(Effect.sync(() => log.includes("emit returned"))), "the timer runs")
      assert.deepStrictEqual(log, ["heard a7.sync", "heard a7.later", "emit returned"])

      assert.isTrue(yield* eventually(Effect.map(actor.getSnapshot, (snapshot) => snapshot.status === "done")), "the promise resolves")
      assert.deepStrictEqual((yield* actor.getSnapshot).output, Option.some(42))
    })
  )

  it.effect("[A7] an emit in a fromTransition reducer reaches the listeners inside the emit call, before the reducer returns, and a listener reads the snapshot from before the event", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const logic = fromTransition<number, EventObject, ActorSystemService, unknown, { readonly type: "a7.reduced" }>((count, _event, { emit }) => {
        emit({ type: "a7.reduced" })
        log.push("emit returned")
        return count + 1
      }, 0)
      const actor = yield* createActor(logic)
      yield* actor.on("a7.reduced", (event) =>
        Effect.map(actor.getSnapshot, (snapshot) => {
          log.push(`heard ${event.type} at ${snapshot.context}`)
        })
      )
      yield* actor.start

      yield* actor.send({ type: "inc" })

      assert.deepStrictEqual(log, ["heard a7.reduced at 0", "emit returned"])
      assert.strictEqual((yield* actor.getSnapshot).context, 1)
    })
  )

  it.effect("[A7] an emit from async code after the fromTransition reducer returned reaches the listeners inside the emit call, and no event reaches the actor for it", () =>
    Effect.gen(function* () {
      const setEffectTimeout = yield* effectTimers
      const log: Array<string> = []
      const logic = fromTransition<number, EventObject, ActorSystemService, unknown, { readonly type: "a7.later" }>((count, _event, { emit }) => {
        setEffectTimeout(() => {
          emit({ type: "a7.later" })
          log.push("emit returned")
        }, 10)
        return count + 1
      }, 0)
      const actor = yield* createActor(logic)
      const inspected: Array<Inspected> = []
      yield* inspectEvents(actor, inspected)
      yield* actor.on("*", hearInto(log))
      yield* actor.start
      yield* actor.send({ type: "arm" })
      yield* settle
      assert.deepStrictEqual(log, [], "nothing is emitted before the timer")

      yield* TestClock.adjust("10 millis")
      assert.isTrue(yield* eventually(Effect.sync(() => log.includes("emit returned"))), "the timer runs")

      // Upstream's reducer receives the actor's own scope, whose emit works after the call
      assert.deepStrictEqual(log, ["heard a7.later", "emit returned"])
      // Upstream `start` reports the init event (`@xstate.event`); the emit adds none
      assert.deepStrictEqual(eventTypesTo(inspected, actor), ["xstate.init", "arm"], "only the sent event reaches the actor")
      assert.strictEqual((yield* actor.getSnapshot).context, 1)
    })
  )

  it.effect("[A7] an emit from a fromObservable source's async code reaches the listeners inside the emit call, and a value from it is relayed to the actor inside the next call", () =>
    Effect.gen(function* () {
      const setEffectTimeout = yield* effectTimers
      const log: Array<string> = []
      const logic = fromObservable<number, unknown, { readonly type: "a7.source" }>(({ emit }): Subscribable<number> => ({
        subscribe: (observer) => {
          setEffectTimeout(() => {
            emit({ type: "a7.source" })
            log.push("emit returned")
            observer.next?.(5)
            log.push("next returned")
          }, 10)
          return { unsubscribe: () => {} }
        },
      }))
      const actor = yield* createActor(logic)
      // The relay's inspection event names its source; the one of the actor's own processing of
      // the event names none
      yield* actor.system.inspect((inspection) =>
        Effect.sync(() => {
          if (inspection.type === "@xstate.event" && inspection.actorRef === actor && Option.isSome(inspection.sourceRef)) {
            log.push(`relayed ${inspection.event.type}`)
          }
        })
      )
      yield* actor.on("*", hearInto(log))
      yield* actor.start
      yield* settle
      assert.deepStrictEqual(log, [], "nothing is emitted before the timer")

      yield* TestClock.adjust("10 millis")
      assert.isTrue(yield* eventually(Effect.sync(() => log.includes("next returned"))), "the timer runs")

      assert.deepStrictEqual(log, ["heard a7.source", "emit returned", "relayed xstate.observable.next", "next returned"])
      assert.isTrue(
        yield* eventually(Effect.map(actor.getSnapshot, (snapshot) => Option.isSome(snapshot.context))),
        "the actor takes the value with no other event"
      )
      assert.deepStrictEqual((yield* actor.getSnapshot).context, Option.some(5))
    })
  )

  it.effect("[A7] a restored root callback actor emits from its own code and from a timer to the listeners registered on the restored actor", () =>
    Effect.gen(function* () {
      const setEffectTimeout = yield* effectTimers
      const log: Array<string> = []
      const logic = fromCallback<EventObject, unknown, { readonly type: "a7.sync" | "a7.timer" }>(({ emit }) => {
        emit({ type: "a7.sync" })
        setEffectTimeout(() => {
          emit({ type: "a7.timer" })
          log.push("emit returned")
        }, 10)
      })
      const persisted = yield* (yield* createActor(logic)).getPersistedSnapshot

      const restored = yield* createActor(logic, { snapshot: persisted })
      yield* restored.on("*", hearInto(log))
      yield* restored.start
      assert.deepStrictEqual(log, ["heard a7.sync"])

      yield* TestClock.adjust("10 millis")
      assert.isTrue(yield* eventually(Effect.sync(() => log.includes("emit returned"))), "the timer runs")
      assert.deepStrictEqual(log, ["heard a7.sync", "heard a7.timer", "emit returned"])
      assert.strictEqual((yield* restored.getSnapshot).status, "active")
    })
  )

  it.effect("[A7] a restored root fromTransition actor emits from its reducer inside the call and from async code after it", () =>
    Effect.gen(function* () {
      const setEffectTimeout = yield* effectTimers
      const log: Array<string> = []
      const logic = fromTransition<number, EventObject, ActorSystemService, unknown, { readonly type: "a7.reduced" | "a7.later" }>(
        (count, event, { emit }) => {
          emit({ type: "a7.reduced" })
          log.push("emit returned")
          // Only the restored actor gets "arm", so only its timer runs
          if (event.type === "arm") {
            setEffectTimeout(() => {
              emit({ type: "a7.later" })
              log.push("later emit returned")
            }, 10)
          }
          return count + 1
        },
        0
      )
      const original = yield* createActor(logic)
      yield* original.start
      yield* original.send({ type: "inc" })
      const persisted = yield* original.getPersistedSnapshot
      yield* original.stop
      log.length = 0

      const restored = yield* createActor(logic, { snapshot: persisted })
      yield* restored.on("*", hearInto(log))
      yield* restored.start
      yield* restored.send({ type: "arm" })
      assert.deepStrictEqual(log, ["heard a7.reduced", "emit returned"])

      yield* TestClock.adjust("10 millis")
      assert.isTrue(yield* eventually(Effect.sync(() => log.includes("later emit returned"))), "the timer runs")
      assert.deepStrictEqual(log, ["heard a7.reduced", "emit returned", "heard a7.later", "later emit returned"])
      assert.strictEqual((yield* restored.getSnapshot).context, 2)
    })
  )

  it.effect("[A7] a listener that throws is reported through the logger inside the emit call; the other listeners still receive the event, the actor stays active and a later emit still arrives", () => {
    const entries: Entries = []
    const log: Array<string> = []
    const boom = { reason: "thrown in a listener" }
    return withLogger(
      entries,
      log,
      Effect.gen(function* () {
        const setEffectTimeout = yield* effectTimers
        const logic = fromCallback<EventObject, unknown, { readonly type: "a7.first" | "a7.second" }>(({ emit }) => {
          setEffectTimeout(() => {
            emit({ type: "a7.first" })
            log.push("first emit returned")
          }, 10)
          setEffectTimeout(() => {
            emit({ type: "a7.second" })
            log.push("second emit returned")
          }, 20)
        })
        const actor = yield* createActor(logic)
        yield* actor.on("a7.first", () =>
          Effect.sync(() => {
            throw boom
          })
        )
        yield* actor.on("*", hearInto(log))
        yield* actor.start

        yield* TestClock.adjust("10 millis")
        assert.isTrue(yield* eventually(Effect.sync(() => log.includes("first emit returned"))), "the first timer runs")
        assert.deepStrictEqual(log, ["reported", "heard a7.first", "first emit returned"])
        const errors = entries.filter((entry) => entry.logLevel === "Error")
        assert.strictEqual(errors.length, 1, "the throw is reported once")
        assert.isTrue(reportedValues(errors[0]!).includes(boom), "the report carries the thrown value")
        assert.strictEqual((yield* actor.getSnapshot).status, "active")

        yield* TestClock.adjust("10 millis")
        assert.isTrue(yield* eventually(Effect.sync(() => log.includes("second emit returned"))), "the second timer runs")
        assert.deepStrictEqual(log.slice(3), ["heard a7.second", "second emit returned"])
        assert.strictEqual((yield* actor.getSnapshot).status, "active")
      })
    )
  })

  it.effect("[A7] the emits of one actor keep their order when a listener waits: the next emit reaches the listeners after the waiting listener ends", () =>
    Effect.gen(function* () {
      const setEffectTimeout = yield* effectTimers
      const log: Array<string> = []
      const logic = fromCallback<EventObject, unknown, { readonly type: "a7.slow" | "a7.fast" }>(({ emit }) => {
        setEffectTimeout(() => {
          emit({ type: "a7.slow" })
          emit({ type: "a7.fast" })
          log.push("emits returned")
        }, 10)
      })
      const actor = yield* createActor(logic)
      yield* actor.on("a7.slow", (event) =>
        Effect.andThen(
          Effect.sleep("5 millis"),
          Effect.sync(() => {
            log.push(`heard ${event.type}`)
          })
        )
      )
      yield* actor.on("a7.fast", hearInto(log))
      yield* actor.start

      yield* TestClock.adjust("10 millis")
      assert.isTrue(yield* eventually(Effect.sync(() => log.includes("emits returned"))), "the timer runs")
      yield* settle
      assert.deepStrictEqual(log, ["emits returned"], "the second emit waits behind the waiting listener")

      yield* TestClock.adjust("5 millis")
      assert.isTrue(yield* eventually(Effect.sync(() => log.length === 3)), "both events arrive")
      assert.deepStrictEqual(log, ["emits returned", "heard a7.slow", "heard a7.fast"])
    })
  )
})
