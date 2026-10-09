/**
 * EVT-1: built-in events equal the XState event objects (SD-5, D8).
 *
 * T2.31. Every built-in event is plain data: an own enumerable `type` first, then the XState
 * fields in the order upstream builds them (`src/eventUtils.ts`, `src/createActor.ts` at
 * xstate@5.33.2), and no `_tag`. The exported constructors build such objects. `output` on
 * the done events is an `Option` (D8); `error` on the error event is the raw value.
 */
import { assert, describe, expect, it } from "@effect/vitest"
import { Effect, Equal, Option, Stream } from "effect"
import { ObservableNextEvent } from "../../src/Event.js"
import {
  type ActorLogicType,
  type ActorType,
  AfterEvent,
  createActor,
  DoneActorEvent,
  DoneStateEvent,
  ErrorActorEvent,
  Errors,
  type EventObject,
  fromObservable,
  fromTransition,
  InitEvent,
  isAfterEvent,
  isDoneActorEvent,
  isDoneStateEvent,
  isErrorActorEvent,
  isEventObject,
  makeActorLogic,
  Snapshot,
  type SnapshotType,
  SnapshotEvent,
  StopEvent,
} from "../../src/index.js"

interface Case {
  readonly name: string
  readonly event: EventObject
  readonly expected: object
  readonly keys: ReadonlyArray<string>
}

const childSnapshot = { status: "active", context: { count: 1 } }

/** One case per built-in event, each with the plain XState object and its key order. */
const cases = (): ReadonlyArray<Case> => [
  {
    name: "xstate.done.actor",
    event: new DoneActorEvent({ actorId: "child", output: Option.some(42) }),
    expected: { type: "xstate.done.actor.child", output: Option.some(42), actorId: "child" },
    keys: ["type", "output", "actorId"],
  },
  {
    name: "xstate.error.actor",
    event: new ErrorActorEvent({ actorId: "child", error: { code: "E_FAIL" } }),
    expected: { type: "xstate.error.actor.child", error: { code: "E_FAIL" }, actorId: "child" },
    keys: ["type", "error", "actorId"],
  },
  {
    name: "xstate.done.state",
    event: new DoneStateEvent({ stateId: "(machine).a", output: Option.none() }),
    expected: { type: "xstate.done.state.(machine).a", output: Option.none() },
    keys: ["type", "output"],
  },
  {
    name: "xstate.after",
    event: new AfterEvent({ delay: 1000, stateNodeId: "light.green" }),
    expected: { type: "xstate.after.1000.light.green" },
    keys: ["type"],
  },
  {
    name: "xstate.snapshot",
    event: new SnapshotEvent({ actorId: "int", snapshot: childSnapshot }),
    expected: { type: "xstate.snapshot.int", snapshot: childSnapshot },
    keys: ["type", "snapshot"],
  },
  {
    name: "xstate.init",
    event: new InitEvent({ input: { n: 1 } }),
    expected: { type: "xstate.init", input: { n: 1 } },
    keys: ["type", "input"],
  },
  {
    name: "xstate.stop",
    event: new StopEvent(),
    expected: { type: "xstate.stop" },
    keys: ["type"],
  },
  {
    name: "xstate.observable.next",
    event: new ObservableNextEvent({ data: 42 }),
    expected: { type: "xstate.observable.next", data: 42 },
    keys: ["type", "data"],
  },
]

/** The value a JSON round trip gives back. */
const jsonRoundTrip = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

// ------------------------------------------------------------
// Runtime: a parent actor that records every event it receives
// ------------------------------------------------------------

type ChildSnapshot = Snapshot.Snapshot<number>

const recorder = fromTransition<ReadonlyArray<EventObject>, EventObject>((events, event) => [...events, event], [])

const childLogic = (step: (snapshot: ChildSnapshot, event: EventObject) => Effect.Effect<ChildSnapshot, Errors.TransitionError>) =>
  makeActorLogic<ChildSnapshot, EventObject, unknown>({
    transition: step,
    getInitialSnapshot: () => Effect.succeed(Snapshot.active()),
    getPersistedSnapshot: (snapshot) => Effect.succeed(snapshot),
  })

/**
 * Creates and starts an actor, a child of `parent` when one is given: a child joins its
 * parent's system, a root actor creates its own.
 */
const startActor = <S extends SnapshotType, E extends EventObject, Em extends EventObject, R>(
  logic: ActorLogicType<S, E, unknown, Em, R>,
  id: string,
  parent?: Pick<ActorType.Any, "ref">
) => Effect.tap(createActor(logic, { id, parent: parent?.ref }), (actor) => actor.start)

/** The recorder's context: the events it received, in order. */
const recordedEvents = (snapshot: object): ReadonlyArray<EventObject> =>
  "context" in snapshot && Array.isArray(snapshot.context) ? snapshot.context.filter(isEventObject) : []

/** The parent's recorded events once it holds at least `count` of them. */
const received = (parent: Pick<ActorType.Any, "changes">, count: number): Effect.Effect<ReadonlyArray<EventObject>, unknown> =>
  parent.changes.pipe(
    Stream.map(recordedEvents),
    Stream.filter((events) => events.length >= count),
    Stream.runHead,
    Effect.map(Option.getOrElse((): ReadonlyArray<EventObject> => []))
  )

const errorOf = (event: EventObject | undefined): unknown =>
  event !== undefined && isErrorActorEvent(event) ? event.error : undefined

const outputOf = (event: EventObject | undefined): unknown =>
  event !== undefined && isDoneActorEvent(event) ? event.output : undefined

describe("EVT-1 built-in events equal the XState event objects", () => {
  it.effect("[EVT-1] each built-in event constructor builds the plain XState object", () =>
    Effect.sync(() => {
      for (const { name, event, expected } of cases()) {
        expect(event, name).toStrictEqual(expected)
        assert.strictEqual(Object.getPrototypeOf(event), Object.prototype, name)
        assert.isTrue(Equal.equals(event, expected), name)
      }
    })
  )

  it.effect("[EVT-1] no built-in event carries _tag and type is the first own enumerable key", () =>
    Effect.sync(() => {
      for (const { name, event, keys } of cases()) {
        assert.isFalse("_tag" in event, name)
        assert.deepStrictEqual(Object.keys(event), [...keys], name)
        assert.strictEqual(Object.keys(event)[0], "type", name)
        assert.isTrue(Object.getOwnPropertyDescriptor(event, "type")?.enumerable, name)
      }
    })
  )

  it.effect("[EVT-1] after events are xstate.after.<delay>.<stateNodeId> for numeric, named and dynamic delays", () =>
    Effect.sync(() => {
      // A numeric delay key, as `after: { 1000: ... }` resolves it.
      const numeric = new AfterEvent({ delay: 1000, stateNodeId: "light.green" })
      // A named delay, as `after: { TIMEOUT: ... }` with `delays: { TIMEOUT: 500 }`.
      const named = new AfterEvent({ delay: "TIMEOUT", stateNodeId: "light.yellow" })
      // A dynamic delay is a named delay whose implementation computes the time: the event
      // names the delay, never the computed milliseconds (upstream `getDelayedTransitions`).
      const dynamic = new AfterEvent({ delay: "fromContext", stateNodeId: "(machine).waiting" })
      const zero = new AfterEvent({ delay: 0, stateNodeId: "m" })

      expect(numeric).toStrictEqual({ type: "xstate.after.1000.light.green" })
      expect(named).toStrictEqual({ type: "xstate.after.TIMEOUT.light.yellow" })
      expect(dynamic).toStrictEqual({ type: "xstate.after.fromContext.(machine).waiting" })
      expect(zero).toStrictEqual({ type: "xstate.after.0.m" })
      for (const event of [numeric, named, dynamic, zero]) {
        assert.isTrue(isAfterEvent(event), event.type)
      }
    })
  )

  it.effect("[EVT-1] snapshot events are xstate.snapshot.<childId> and init events carry the input", () =>
    Effect.sync(() => {
      const snapshotEvent = new SnapshotEvent({ actorId: "int", snapshot: childSnapshot })
      assert.strictEqual(snapshotEvent.type, "xstate.snapshot.int")
      assert.strictEqual(snapshotEvent.snapshot, childSnapshot)

      expect(new InitEvent({ input: 42 })).toStrictEqual({ type: "xstate.init", input: 42 })
      // Upstream `createInitEvent(undefined)` keeps the `input` key.
      assert.deepStrictEqual(Object.keys(new InitEvent({ input: undefined })), ["type", "input"])
    })
  )

  it.effect("[EVT-1] JSON-safe events survive a JSON round trip and Option outputs encode as Option JSON", () =>
    Effect.sync(() => {
      const safe: ReadonlyArray<EventObject> = [
        new ErrorActorEvent({ actorId: "child", error: { code: "E_FAIL", details: ["a", 1] } }),
        new AfterEvent({ delay: 1000, stateNodeId: "light.green" }),
        new SnapshotEvent({ actorId: "int", snapshot: childSnapshot }),
        new InitEvent({ input: { n: 1, tags: ["a"] } }),
        new StopEvent(),
        new ObservableNextEvent({ data: [1, 2] }),
      ]
      for (const event of safe) {
        assert.deepStrictEqual(jsonRoundTrip(event), event, event.type)
      }

      assert.deepStrictEqual(jsonRoundTrip(new DoneActorEvent({ actorId: "child", output: Option.some(42) })), {
        type: "xstate.done.actor.child",
        output: { _id: "Option", _tag: "Some", value: 42 },
        actorId: "child",
      })
      assert.deepStrictEqual(jsonRoundTrip(new DoneStateEvent({ stateId: "(machine)", output: Option.none() })), {
        type: "xstate.done.state.(machine)",
        output: { _id: "Option", _tag: "None" },
      })
    })
  )

  it.effect("[EVT-1] the is*Event guards keep their prefix semantics on plain event objects", () =>
    Effect.sync(() => {
      assert.isTrue(isDoneActorEvent({ type: "xstate.done.actor.x" }))
      assert.isTrue(isErrorActorEvent({ type: "xstate.error.actor.x" }))
      assert.isTrue(isDoneStateEvent({ type: "xstate.done.state.x" }))
      assert.isTrue(isAfterEvent({ type: "xstate.after.100.x" }))
      assert.isFalse(isDoneActorEvent({ type: "xstate.done.actorx" }))
      assert.isFalse(isErrorActorEvent(new DoneActorEvent({ actorId: "x", output: Option.none() })))
      assert.isFalse(isDoneStateEvent(new DoneActorEvent({ actorId: "x", output: Option.none() })))
      assert.isFalse(isAfterEvent(new StopEvent()))
    })
  )

  it.effect("[EVT-1] a parent receives the done and error events of its children as the XState objects", () =>
    Effect.gen(function* () {
      const failure = { code: "E_FAIL", message: "boom" }
      const parent = yield* startActor(recorder, "parent")

      const finishes = childLogic((snapshot, event) => Effect.succeed(event.type === "FINISH" ? Snapshot.done(42) : snapshot))
      const fails = childLogic((snapshot, event) => Effect.succeed(event.type === "FAIL" ? Snapshot.error(failure) : snapshot))
      const child = yield* startActor(finishes, "child", parent)
      const failing = yield* startActor(fails, "failing", parent)

      yield* child.send({ type: "FINISH" })
      yield* received(parent, 1)
      yield* failing.send({ type: "FAIL" })
      const [done, failed] = yield* received(parent, 2)

      expect(done).toStrictEqual({ type: "xstate.done.actor.child", output: Option.some(42), actorId: "child" })
      expect(failed).toStrictEqual({ type: "xstate.error.actor.failing", error: failure, actorId: "failing" })
      assert.isTrue(Equal.equals(outputOf(done), Option.some(42)))
      assert.strictEqual(errorOf(failed), failure)
      for (const event of [done, failed]) {
        assert.isDefined(event)
        assert.isFalse("_tag" in (event ?? {}))
      }

      assert.deepStrictEqual(jsonRoundTrip(failed), failed)
      assert.deepStrictEqual(jsonRoundTrip(done), {
        type: "xstate.done.actor.child",
        output: { _id: "Option", _tag: "Some", value: 42 },
        actorId: "child",
      })
    })
  )

  it.effect("[EVT-1] every producer gives done events an Option output and error events the raw error", () =>
    Effect.gen(function* () {
      const failure = { code: "E_STREAM" }
      const transitionError = new Errors.TransitionError({ message: "transition failed", snapshot: undefined, event: { type: "FAIL" } })
      const parent = yield* startActor(recorder, "parent")

      // Observable logic that emits once and completes.
      const completes = fromObservable<number>(() => ({
        subscribe: (observer) => {
          observer.next?.(42)
          observer.complete?.()
          return { unsubscribe: () => undefined }
        },
      }))
      // Observable logic that errors.
      const errors = fromObservable<number>(() => ({
        subscribe: (observer) => {
          observer.error?.(failure)
          return { unsubscribe: () => undefined }
        },
      }))
      // Logic whose transition fails.
      const throwing = childLogic((snapshot, event) =>
        event.type === "FAIL" ? Effect.fail(transitionError) : Effect.succeed(snapshot)
      )

      yield* startActor(completes, "observed", parent)
      yield* received(parent, 1)
      yield* startActor(errors, "erroring", parent)
      yield* received(parent, 2)
      const thrower = yield* startActor(throwing, "thrower", parent)
      yield* thrower.send({ type: "FAIL" })
      const [observedDone, streamFailed, transitionFailed] = yield* received(parent, 3)

      assert.strictEqual(observedDone?.type, "xstate.done.actor.observed")
      assert.deepStrictEqual(Object.keys(observedDone ?? {}), ["type", "output", "actorId"])
      assert.isTrue(Option.isOption(outputOf(observedDone)))
      expect(streamFailed).toStrictEqual({ type: "xstate.error.actor.erroring", error: failure, actorId: "erroring" })
      expect(transitionFailed).toStrictEqual({
        type: "xstate.error.actor.thrower",
        error: transitionError,
        actorId: "thrower",
      })
      assert.strictEqual(errorOf(streamFailed), failure)
      assert.strictEqual(errorOf(transitionFailed), transitionError)
      assert.isFalse(Option.isOption(errorOf(transitionFailed)))
    })
  )
})
