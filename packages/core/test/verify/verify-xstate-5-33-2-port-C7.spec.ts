/**
 * C7: a callback actor sends back from async code and cleans up on stop.
 *
 * T2.49. Upstream (`actors/callback.ts` at xstate@5.33.2): `start` calls the callback with
 * `{ input, system, self, sendBack, receive, emit }`. `sendBack` does nothing once `self` is
 * stopped; otherwise it relays the event to the parent at once through the system
 * (`system._relay(self, self._parent, event)`), from any code, a timer included. `receive` adds a
 * listener to a `Set`, and `transition` calls every listener with each event; a listener that
 * throws errors the actor. `emit` is `actorScope.emit`, delivered at once. On `xstate.stop` the
 * actor is `stopped`, its listeners are cleared and the callback's cleanup runs once. A throw in
 * the callback errors the actor inside `start`. The snapshot is `{ status, output, error, input }`.
 *
 * The port runs the cleanup when the actor's own scope closes (D12). Each send back or emit goes
 * out at once, inside the call, in a fiber of the actor's scope (T4.13), from the callback's own
 * code (so inside `start`, as upstream) and from timers, listeners and promises, so it reaches
 * the parent without waiting for another event. The parent's own start reports its init event
 * (`@xstate.event` with no source, upstream `start`); no other event reaches it before the
 * timer (T6.8; SD-20). Errors are the raw thrown values (SD-4). Phase-2 children
 * are spawned (SD-15). Timers run on the Effect clock (TestClock), never on wall-clock time.
 */
import { assert, describe, it } from "@effect/vitest"
import { Duration, Effect, Logger, Option, Scope } from "effect"
import { TestClock } from "effect/testing"
import type { ActorRefBase } from "../../src/ActorRef.js"
import {
  type ActorSystemService,
  type ActorType,
  type AnyActorLogic,
  assign,
  type CallbackActorRef,
  createActor,
  createMachine,
  Errors,
  type EventObject,
  fromCallback,
  isActor,
  sendTo,
  spawnChild,
  stopChild,
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

interface Received {
  readonly received: ReadonlyArray<unknown>
}

/** Keeps every event the parent takes, in order. */
const record = assign<Received, EventObject>(({ context, event }) => ({ received: [...context.received, event] }))

/**
 * A parent that spawns `child` as `cb` in state `a` and stops it when it leaves `a` on NEXT
 * (upstream: an invoke ends with its state). FORWARD sends PONG to the child. The parent keeps
 * every PING and LATER event and the child's error event.
 */
const parentOf = <TLogic extends AnyActorLogic>(child: TLogic) =>
  createMachine<Received, EventObject>({
    id: "c7-parent",
    context: { received: [] },
    initial: "a",
    states: {
      a: {
        entry: spawnChild<Received, EventObject, TLogic>(child, { id: "cb" }),
        exit: stopChild<Received, EventObject>("cb"),
        on: {
          NEXT: "b",
          FORWARD: { actions: sendTo<Received, EventObject>("cb", { type: "PONG" }) },
        },
      },
      b: {},
    },
    on: {
      PING: { actions: record },
      LATER: { actions: record },
      "xstate.error.actor.cb": { actions: record },
    },
  })

/** An actor of a parent from `parentOf`, as the helpers read it. */
interface ParentActor {
  readonly getSnapshot: Effect.Effect<{
    readonly context: Received
    readonly children: Readonly<Record<string, ActorRefBase>>
  }>
}

/** The child `cb` of a parent actor. */
const childOf = (actor: ParentActor) => Effect.map(actor.getSnapshot, (snapshot) => asActor(snapshot.children["cb"]))

/** The events a parent from `parentOf` has kept. */
const receivedBy = (actor: ParentActor) => Effect.map(actor.getSnapshot, (snapshot) => snapshot.context.received)

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

describe("C7 A callback actor sends back from async code and cleans up on stop", () => {
  it.effect("[C7] a sendBack from a timer reaches the parent through the system relay, with no other event arriving first", () =>
    Effect.gen(function* () {
      const setEffectTimeout = yield* effectTimers
      const logic = fromCallback(({ sendBack }) => {
        setEffectTimeout(() => sendBack({ type: "PING" }), 10)
      })
      const actor = yield* createActor(parentOf(logic))
      const inspected: Array<Inspected> = []
      yield* inspectEventsOf(actor, inspected)
      yield* actor.start
      const child = yield* childOf(actor)

      // Nothing reaches the parent before the timer fires: the only event reported to it is its
      // own init event, with no source (upstream `start`)
      yield* settle
      assert.deepStrictEqual(
        inspected.map((entry) => ({ type: entry.event.type, fromNobody: Option.isNone(entry.source) })),
        [{ type: "xstate.init", fromNobody: true }]
      )
      assert.deepStrictEqual(yield* receivedBy(actor), [])

      yield* TestClock.adjust("10 millis")
      assert.isTrue(yield* eventually(Effect.map(receivedBy(actor), (received) => received.length > 0)), "the parent receives PING")

      assert.deepStrictEqual(yield* receivedBy(actor), [{ type: "PING" }])
      assert.deepStrictEqual(inspected.map((entry) => entry.event.type), ["xstate.init", "PING"])
      assert.isTrue(relayedFrom(inspected, child), "the system relays PING from the child to the parent")
    })
  )

  it.effect("[C7] a sendBack from a receive listener reaches the parent through the system relay", () =>
    Effect.gen(function* () {
      const logic = fromCallback(({ receive, sendBack }) => {
        receive((event) => {
          if (event.type === "PONG") {
            sendBack({ type: "PING" })
          }
        })
      })
      const actor = yield* createActor(parentOf(logic))
      const inspected: Array<Inspected> = []
      yield* inspectEventsOf(actor, inspected)
      yield* actor.start
      const child = yield* childOf(actor)

      yield* actor.send({ type: "FORWARD" })
      assert.isTrue(yield* eventually(Effect.map(receivedBy(actor), (received) => received.length > 0)), "the parent receives PING")

      assert.deepStrictEqual(yield* receivedBy(actor), [{ type: "PING" }])
      assert.isTrue(relayedFrom(inspected, child), "the system relays PING from the child to the parent")
    })
  )

  it.effect("[C7] a sendBack in the callback's own code reaches the parent before an event sent after start, as upstream relays it inside start", () =>
    Effect.gen(function* () {
      const logic = fromCallback(({ sendBack }) => {
        sendBack({ type: "PING" })
      })
      const actor = yield* createActor(parentOf(logic))
      yield* actor.start
      yield* actor.send({ type: "LATER" })
      assert.isTrue(yield* eventually(Effect.map(receivedBy(actor), (received) => received.length === 2)), "the parent receives both")

      assert.deepStrictEqual(yield* receivedBy(actor), [{ type: "PING" }, { type: "LATER" }])
    })
  )

  it.effect("[C7] when the invoking state exits, the cleanup runs exactly once, and a sendBack after the stop is ignored without a warning", () => {
    const entries: Entries = []
    return withLogger(
      entries,
      Effect.gen(function* () {
        let cleanups = 0
        const sendBacks: Array<(event: EventObject) => void> = []
        const logic = fromCallback(({ sendBack }) => {
          sendBacks.push(sendBack)
          return () => {
            cleanups++
          }
        })
        const actor = yield* createActor(parentOf(logic))
        yield* actor.start
        const child = yield* childOf(actor)
        assert.isTrue(yield* eventually(Effect.sync(() => sendBacks.length === 1)), "the callback runs")

        // A sendBack from plain code (not a timer, not the actor) reaches the parent
        yield* Effect.sync(() => sendBacks[0]?.({ type: "PING" }))
        assert.isTrue(yield* eventually(Effect.map(receivedBy(actor), (received) => received.length > 0)), "the parent receives PING")
        assert.strictEqual(cleanups, 0)

        // Leaving `a` stops the child
        yield* actor.send({ type: "NEXT" })
        assert.isTrue(yield* eventually(Effect.map(statusOf(child), (status) => status === "stopped")), "the child stops")
        assert.strictEqual(cleanups, 1)

        // A sendBack after the stop is ignored
        yield* Effect.sync(() => sendBacks[0]?.({ type: "PING" }))
        yield* settle
        assert.deepStrictEqual(yield* receivedBy(actor), [{ type: "PING" }])

        // Stopping the parent afterwards runs the cleanup no more
        yield* actor.stop
        assert.strictEqual(cleanups, 1)
        assert.deepStrictEqual(warnings(entries).filter((text) => text.includes("stopped actor")), [])
      })
    )
  })

  it.effect("[C7] when the parent stops, the child's cleanup runs exactly once, and a sendBack after the stop is ignored without a warning", () => {
    const entries: Entries = []
    return withLogger(
      entries,
      Effect.gen(function* () {
        let cleanups = 0
        const sendBacks: Array<(event: EventObject) => void> = []
        const logic = fromCallback(({ sendBack }) => {
          sendBacks.push(sendBack)
          return () => {
            cleanups++
          }
        })
        const actor = yield* createActor(parentOf(logic))
        yield* actor.start
        const child = yield* childOf(actor)
        assert.isTrue(yield* eventually(Effect.sync(() => sendBacks.length === 1)), "the callback runs")
        yield* Effect.sync(() => sendBacks[0]?.({ type: "PING" }))
        assert.isTrue(yield* eventually(Effect.map(receivedBy(actor), (received) => received.length > 0)), "the parent receives PING")

        yield* actor.stop
        assert.strictEqual(yield* statusOf(child), "stopped")
        assert.strictEqual(cleanups, 1)

        yield* Effect.sync(() => sendBacks[0]?.({ type: "PING" }))
        yield* settle
        assert.strictEqual(cleanups, 1)
        assert.deepStrictEqual(yield* receivedBy(actor), [{ type: "PING" }])
        assert.deepStrictEqual(warnings(entries).filter((text) => text.includes("stopped actor")), [])
      })
    )
  })

  it.effect("[C7] two receive listeners both run, in the order they were added, the same listener added twice runs once, and no listener runs after stop", () => {
    const entries: Entries = []
    return withLogger(
      entries,
      Effect.gen(function* () {
        const calls: Array<string> = []
        const logic = fromCallback(({ receive }) => {
          const twice = (event: EventObject) => {
            calls.push(`twice ${event.type}`)
          }
          receive((event) => {
            calls.push(`first ${event.type}`)
          })
          receive(twice)
          receive((event) => {
            calls.push(`second ${event.type}`)
          })
          receive(twice)
        })
        const actor = yield* createActor(logic)
        yield* actor.start

        yield* actor.send({ type: "x" })
        assert.deepStrictEqual(calls, ["first x", "twice x", "second x"])

        yield* actor.stop
        yield* actor.send({ type: "y" })
        yield* settle
        assert.deepStrictEqual(calls, ["first x", "twice x", "second x"])
      })
    )
  })

  it.effect("[C7] a throw in the callback gives status error with the thrown value (not a StartError), and the parent receives xstate.error.actor.<id>", () =>
    Effect.gen(function* () {
      const boom = { reason: "thrown in the callback" }
      const actor = yield* createActor(
        parentOf(
          fromCallback(() => {
            throw boom
          })
        )
      )
      yield* actor.start
      const child = yield* childOf(actor)
      assert.isTrue(yield* eventually(Effect.map(receivedBy(actor), (received) => received.length > 0)), "the parent hears of it")

      const childSnapshot = yield* child.getSnapshot
      assert.strictEqual(childSnapshot.status, "error")
      assert.strictEqual(Option.getOrUndefined(childSnapshot.error), boom)
      assert.notInstanceOf(Option.getOrUndefined(childSnapshot.error), Errors.StartError)
      assert.deepStrictEqual(yield* receivedBy(actor), [{ type: "xstate.error.actor.cb", error: boom, actorId: "cb" }])
      assert.strictEqual(yield* statusOf(actor), "active")
    })
  )

  it.effect("[C7] a throw in a receive listener gives status error with the thrown value, and the parent receives xstate.error.actor.<id>", () =>
    Effect.gen(function* () {
      const boom = new Error("thrown in a receive listener")
      const actor = yield* createActor(
        parentOf(
          fromCallback(({ receive }) => {
            receive(() => {
              throw boom
            })
          })
        )
      )
      yield* actor.start
      const child = yield* childOf(actor)

      yield* actor.send({ type: "FORWARD" })
      assert.isTrue(yield* eventually(Effect.map(receivedBy(actor), (received) => received.length > 0)), "the parent hears of it")

      const childSnapshot = yield* child.getSnapshot
      assert.strictEqual(childSnapshot.status, "error")
      assert.strictEqual(Option.getOrUndefined(childSnapshot.error), boom)
      assert.deepStrictEqual(yield* receivedBy(actor), [{ type: "xstate.error.actor.cb", error: boom, actorId: "cb" }])
      assert.strictEqual(yield* statusOf(actor), "active")
    })
  )

  it.effect("[C7] the callback receives { input, system, self, sendBack, receive, emit }; an emit in its own code reaches the listeners inside start, and an emit from a timer reaches them with no other event", () =>
    Effect.gen(function* () {
      const setEffectTimeout = yield* effectTimers
      const seen: Array<{ readonly keys: ReadonlyArray<string>; readonly input: unknown; readonly self: unknown; readonly system: unknown }> = []
      // The upstream generic order: received events, input, emitted events (SD-12)
      const logic = fromCallback<{ readonly type: "c7.received" }, { readonly n: number }, { readonly type: "c7.sync" | "c7.timer" }>(
        (args) => {
          const self: CallbackActorRef<{ readonly type: "c7.received" }> = args.self
          const system: ActorSystemService = args.system
          seen.push({ keys: [...Object.keys(args)].sort(), input: args.input, self, system })
          args.emit({ type: "c7.sync" })
          setEffectTimeout(() => args.emit({ type: "c7.timer" }), 10)
        }
      )
      const input = { n: 1 }
      const actor = yield* createActor(logic, { input })
      const emitted: Array<unknown> = []
      yield* actor.on("*", (event) =>
        Effect.sync(() => {
          emitted.push(event)
        })
      )

      yield* actor.start
      assert.deepStrictEqual(emitted, [{ type: "c7.sync" }])
      yield* settle
      assert.deepStrictEqual(emitted, [{ type: "c7.sync" }])

      yield* TestClock.adjust("10 millis")
      assert.isTrue(yield* eventually(Effect.sync(() => emitted.length === 2)), "the timer's emit reaches the listener")
      assert.deepStrictEqual(emitted, [{ type: "c7.sync" }, { type: "c7.timer" }])

      assert.strictEqual(seen.length, 1)
      assert.deepStrictEqual(seen[0]?.keys, ["emit", "input", "receive", "self", "sendBack", "system"])
      assert.strictEqual(seen[0]?.input, input)
      assert.strictEqual(seen[0]?.self, actor)
      assert.strictEqual(seen[0]?.system, actor.system)
    })
  )

  it.effect("[C7] the callback snapshot is { status, output, error, input }, live and persisted, with no receive handler in it", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(
        fromCallback(({ receive }) => {
          receive(() => {})
        }),
        { input: 5 }
      )
      yield* actor.start

      const snapshot = yield* actor.getSnapshot
      assert.deepStrictEqual(Object.keys(snapshot).sort(), ["error", "input", "output", "status"])
      assert.strictEqual(snapshot.status, "active")
      assert.strictEqual(snapshot.input, 5)
      assert.deepStrictEqual(snapshot.output, Option.none())
      assert.deepStrictEqual(snapshot.error, Option.none())

      const persisted = yield* actor.getPersistedSnapshot
      assert.deepStrictEqual(Object.keys(persisted as object).sort(), ["error", "input", "output", "status"])
    })
  )
})
