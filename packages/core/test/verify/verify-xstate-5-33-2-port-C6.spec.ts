/**
 * C6: a promise actor starts without blocking and aborts on stop.
 *
 * T2.48. Upstream (`actors/promise.ts` at xstate@5.33.2): `getInitialSnapshot` gives status
 * `active` with the input and runs nothing. `start` makes a new `AbortController` and calls the
 * creator with `{ input, system, self, signal, emit }`. When the promise settles while the actor
 * is still active, the actor relays `{ type: 'xstate.promise.resolve' | 'xstate.promise.reject',
 * data }` to itself, and `transition` turns it into status `done` with the output, or status
 * `error` with the error, which reaches the parent as `xstate.error.actor.<id>` (SD-4). A stop
 * aborts the controller and gives status `stopped`; a settlement after it changes nothing.
 *
 * The port runs the promise in a fiber of the actor's own scope (D12), so `start` returns while
 * the promise is pending, and the scope close of the stop aborts the signal. `output` and `error`
 * are Options, and an `undefined` value is `None` (D8, SD-7). Phase-2 children are spawned
 * (SD-15), so a parent reads its child's done and error events with `on` handlers.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Fiber, Logger, Option } from "effect"
import type { ActorRefBase } from "../../src/ActorRef.js"
import {
  type ActorType,
  type AnyActorLogic,
  assign,
  createActor,
  createMachine,
  type EventObject,
  fromPromise,
  getInitialSnapshot,
  isActor,
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

/** A promise that the test settles by hand, as upstream tests use `Promise.withResolvers()`. */
interface Gate<A> {
  readonly promise: Promise<A>
  readonly resolve: (value: A) => void
  readonly reject: (error: unknown) => void
}

const makeGate = <A>(): Gate<A> => {
  const handles: { resolve: (value: A) => void; reject: (error: unknown) => void } = {
    resolve: () => {},
    reject: () => {},
  }
  const promise = new Promise<A>((resolve, reject) => {
    handles.resolve = resolve
    handles.reject = reject
  })
  return { promise, resolve: (value) => handles.resolve(value), reject: (error) => handles.reject(error) }
}

/**
 * Creates and starts an actor in a fiber of its own, and gives the actor once both have
 * returned. A `createActor` or `start` that waits for the promise fails the test at once
 * instead of hanging it.
 */
const startedWithin = <A extends { readonly start: Effect.Effect<void> }, R>(create: Effect.Effect<A, never, R>) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(Effect.tap(create, (actor) => actor.start), { startImmediately: true })
    yield* eventually(Effect.sync(() => fiber.pollUnsafe() !== undefined))
    assert.isDefined(fiber.pollUnsafe(), "createActor and start return while the promise is pending")
    return yield* Fiber.join(fiber)
  })

/** The child actor behind a reference; fails the test when the reference is not an actor. */
const asActor = (ref: ActorRefBase | undefined): ActorType.Any => {
  assert.isTrue(isActor(ref), "the reference is an actor")
  return ref as ActorType.Any
}

/** The status the actor's snapshot has now. */
const statusOf = (actor: Pick<ActorType.Any, "getSnapshot">) => Effect.map(actor.getSnapshot, (snapshot) => snapshot.status)

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

interface Received {
  readonly received: ReadonlyArray<unknown>
}

/** Keeps every event the parent takes, in order. */
const record = assign<Received, EventObject>(({ context, event }) => ({ received: [...context.received, event] }))

/** A parent that spawns `child` as `p`, keeps the child's done and error events, and stops it on STOP. */
const parentOf = <TLogic extends AnyActorLogic>(child: TLogic) =>
  createMachine<Received, EventObject>({
    id: "c6-parent",
    context: { received: [] },
    entry: spawnChild<Received, EventObject, TLogic>(child, { id: "p" }),
    on: {
      STOP: { actions: stopChild<Received, EventObject>("p") },
      "xstate.done.actor.p": { actions: record },
      "xstate.error.actor.p": { actions: record },
    },
  })

/** An actor of a parent from `parentOf`, as the helpers read it. */
interface ParentActor {
  readonly getSnapshot: Effect.Effect<{
    readonly context: Received
    readonly children: Readonly<Record<string, ActorRefBase>>
  }>
}

/** The child `p` of a parent actor. */
const childOf = (actor: ParentActor) => Effect.map(actor.getSnapshot, (snapshot) => asActor(snapshot.children["p"]))

/** The events a parent from `parentOf` has kept. */
const receivedBy = (actor: ParentActor) => Effect.map(actor.getSnapshot, (snapshot) => snapshot.context.received)

describe("C6 A promise actor starts without blocking and aborts on stop", () => {
  it.effect("[C6] start returns while the promise is pending; the snapshot reads active, then done with output Some(value) through the internal xstate.promise.resolve event", () =>
    Effect.gen(function* () {
      const gate = makeGate<number>()
      const signals: Array<AbortSignal> = []
      const logic = fromPromise((args) => {
        signals.push(args.signal)
        return gate.promise
      })

      const actor = yield* startedWithin(createActor(logic))
      const relayed: Array<{ readonly fromSelf: boolean; readonly event: unknown }> = []
      yield* actor.system.inspect((inspection) =>
        Effect.sync(() => {
          if (inspection.type === "@xstate.event" && inspection.actorRef === actor) {
            relayed.push({ fromSelf: Option.exists(inspection.sourceRef, (source) => source === actor), event: inspection.event })
          }
        })
      )

      // The creator ran at start, and the actor waits for the promise
      assert.strictEqual(signals.length, 1)
      assert.strictEqual(yield* statusOf(actor), "active")

      yield* Effect.sync(() => gate.resolve(42))
      assert.isTrue(yield* eventually(Effect.map(statusOf(actor), (status) => status === "done")), "the actor is done")

      const done = yield* actor.getSnapshot
      assert.deepStrictEqual(done.output, Option.some(42))
      assert.deepStrictEqual(done.error, Option.none())
      assert.deepStrictEqual(
        relayed.filter((entry) => entry.fromSelf).map((entry) => entry.event),
        [{ type: "xstate.promise.resolve", data: 42 }]
      )
      // A settled promise is not aborted when the done actor ends
      yield* settle
      assert.isFalse(signals[0]?.aborted)
    })
  )

  it.effect("[C6] a rejection gives status error with the raw error, and the parent receives xstate.error.actor.<id>", () =>
    Effect.gen(function* () {
      const boom = new Error("rejected")
      const gate = makeGate<number>()
      const actor = yield* startedWithin(createActor(parentOf(fromPromise(() => gate.promise))))
      const child = yield* childOf(actor)
      assert.strictEqual(yield* statusOf(child), "active")

      yield* Effect.sync(() => gate.reject(boom))
      assert.isTrue(yield* eventually(Effect.map(receivedBy(actor), (received) => received.length > 0)), "the parent hears of it")

      const childSnapshot = yield* child.getSnapshot
      assert.strictEqual(childSnapshot.status, "error")
      assert.strictEqual(Option.getOrUndefined(childSnapshot.error), boom)
      assert.deepStrictEqual(yield* receivedBy(actor), [{ type: "xstate.error.actor.p", error: boom, actorId: "p" }])
      assert.strictEqual(yield* statusOf(actor), "active")
    })
  )

  it.effect("[C6] a synchronous throw in the creator gives status error with the thrown value, and the parent receives xstate.error.actor.<id>", () =>
    Effect.gen(function* () {
      const boom = { reason: "thrown in the creator" }
      const actor = yield* startedWithin(
        createActor(
          parentOf(
            fromPromise(() => {
              throw boom
            })
          )
        )
      )
      const child = yield* childOf(actor)
      assert.isTrue(yield* eventually(Effect.map(receivedBy(actor), (received) => received.length > 0)), "the parent hears of it")

      const childSnapshot = yield* child.getSnapshot
      assert.strictEqual(childSnapshot.status, "error")
      assert.strictEqual(Option.getOrUndefined(childSnapshot.error), boom)
      assert.deepStrictEqual(yield* receivedBy(actor), [{ type: "xstate.error.actor.p", error: boom, actorId: "p" }])
    })
  )

  it.effect("[C6] stopping a promise actor before settlement aborts its signal and sets status stopped; a late settlement changes nothing", () => {
    const entries: Entries = []
    return withLogger(
      entries,
      Effect.gen(function* () {
        const gate = makeGate<number>()
        const signals: Array<AbortSignal> = []
        const aborts: Array<AbortSignal> = []
        const logic = fromPromise((args) => {
          signals.push(args.signal)
          args.signal.addEventListener("abort", () => {
            aborts.push(args.signal)
          })
          return gate.promise
        })
        const actor = yield* startedWithin(createActor(logic))
        assert.strictEqual(signals.length, 1)
        assert.isFalse(signals[0]?.aborted)

        yield* actor.stop
        assert.strictEqual(yield* statusOf(actor), "stopped")
        assert.isTrue(signals[0]?.aborted)
        assert.strictEqual(aborts.length, 1)

        yield* Effect.sync(() => gate.resolve(42))
        yield* settle
        const after = yield* actor.getSnapshot
        assert.strictEqual(after.status, "stopped")
        assert.deepStrictEqual(after.output, Option.none())
        assert.strictEqual(aborts.length, 1)
        assert.deepStrictEqual(warnings(entries).filter((text) => text.includes("stopped actor")), [])
      })
    )
  })

  it.effect("[C6] a parent that stops its promise child before settlement aborts the child's signal, and no done event reaches the parent", () =>
    Effect.gen(function* () {
      const gate = makeGate<number>()
      const signals: Array<AbortSignal> = []
      const actor = yield* startedWithin(
        createActor(
          parentOf(
            fromPromise((args) => {
              signals.push(args.signal)
              return gate.promise
            })
          )
        )
      )
      const child = yield* childOf(actor)
      assert.strictEqual(signals.length, 1)

      yield* actor.send({ type: "STOP" })
      assert.isTrue(yield* eventually(Effect.map(statusOf(child), (status) => status === "stopped")), "the child stops")
      assert.isTrue(signals[0]?.aborted)

      yield* Effect.sync(() => gate.resolve(42))
      yield* settle
      assert.strictEqual(yield* statusOf(child), "stopped")
      assert.deepStrictEqual(yield* receivedBy(actor), [])
      assert.strictEqual(yield* statusOf(actor), "active")
    })
  )

  it.effect("[C6] each actor and each re-spawn of the same logic gets a fresh AbortSignal", () =>
    Effect.gen(function* () {
      const signals: Array<AbortSignal> = []
      const logic = fromPromise((args) => {
        signals.push(args.signal)
        return new Promise<number>(() => {})
      })

      // Two actors of one logic
      const first = yield* startedWithin(createActor(logic))
      yield* startedWithin(createActor(logic))
      assert.strictEqual(signals.length, 2)
      assert.notStrictEqual(signals[0], signals[1])
      yield* first.stop
      assert.isTrue(signals[0]?.aborted)
      assert.isFalse(signals[1]?.aborted)

      // A child spawned again with the same id after a stop
      const machine = createMachine<object, EventObject>({
        id: "c6-restart",
        context: {},
        initial: "running",
        states: {
          running: {
            entry: spawnChild<object, EventObject, typeof logic>(logic, { id: "p" }),
            exit: stopChild<object, EventObject>("p"),
            on: { cancel: "canceled" },
          },
          canceled: { on: { restart: "running" } },
        },
      })
      const actor = yield* startedWithin(createActor(machine))
      assert.strictEqual(signals.length, 3)
      yield* actor.send({ type: "cancel" })
      assert.isTrue(yield* eventually(Effect.sync(() => signals[2]?.aborted === true)), "the first child's signal aborts")
      yield* actor.send({ type: "restart" })
      assert.isTrue(yield* eventually(Effect.sync(() => signals.length === 4)), "the second child runs its creator")
      assert.notStrictEqual(signals[3], signals[2])
      assert.isFalse(signals[3]?.aborted)
    })
  )

  it.effect("[C6] reading the initial snapshot runs nothing: createActor and getInitialSnapshot give status active with the input", () =>
    Effect.gen(function* () {
      let calls = 0
      const logic = fromPromise(({ input }: { readonly input: number }) => {
        calls++
        return Promise.resolve(input)
      })

      const actor = yield* startedWithin(Effect.map(createActor(logic, { input: 7 }), (created) => ({ created, start: Effect.void })))
      const snapshot = yield* actor.created.getSnapshot
      const initial = yield* getInitialSnapshot(logic, 7)
      yield* settle

      assert.strictEqual(calls, 0)
      assert.strictEqual(snapshot.status, "active")
      assert.strictEqual(snapshot.input, 7)
      assert.deepStrictEqual(snapshot.output, Option.none())
      assert.strictEqual(initial.status, "active")
      assert.strictEqual(initial.input, 7)
    })
  )

  it.effect("[C6] the creator receives { input, system, self, signal, emit }, and emit reaches the actor's listeners", () =>
    Effect.gen(function* () {
      const seen: Array<{ readonly keys: ReadonlyArray<string>; readonly input: unknown; readonly self: unknown; readonly system: unknown; readonly signal: unknown }> = []
      // The upstream generic order: output, input, emitted events (SD-12)
      const logic = fromPromise<number, { readonly n: number }, { readonly type: "c6.emitted"; readonly n: number }>((args) => {
        seen.push({
          keys: [...Object.keys(args)].sort(),
          input: args.input,
          self: args.self,
          system: args.system,
          signal: args.signal,
        })
        args.emit({ type: "c6.emitted", n: args.input.n })
        return Promise.resolve(args.input.n)
      })
      const input = { n: 3 }
      const actor = yield* createActor(logic, { input })
      const emitted: Array<unknown> = []
      yield* actor.on("*", (event) =>
        Effect.sync(() => {
          emitted.push(event)
        })
      )
      yield* actor.start
      assert.isTrue(yield* eventually(Effect.sync(() => emitted.length > 0)), "the listener receives the emitted event")

      assert.strictEqual(seen.length, 1)
      assert.deepStrictEqual(seen[0]?.keys, ["emit", "input", "self", "signal", "system"])
      assert.strictEqual(seen[0]?.input, input)
      assert.strictEqual(seen[0]?.self, actor)
      assert.strictEqual(seen[0]?.system, actor.system)
      assert.instanceOf(seen[0]?.signal, AbortSignal)
      assert.deepStrictEqual(emitted, [{ type: "c6.emitted", n: 3 }])
    })
  )

  it.effect("[C6] a promise that resolves undefined gives output None, live and after a persisted-snapshot round trip, and the restored done actor does not run the creator again", () =>
    Effect.gen(function* () {
      let calls = 0
      const logic = fromPromise(() => {
        calls++
        return Promise.resolve(undefined)
      })
      const actor = yield* startedWithin(createActor(logic))
      assert.isTrue(yield* eventually(Effect.map(statusOf(actor), (status) => status === "done")), "the actor is done")
      assert.deepStrictEqual((yield* actor.getSnapshot).output, Option.none())

      const persisted = yield* actor.getPersistedSnapshot
      const restored = yield* createActor(logic, { snapshot: persisted })
      yield* restored.start
      yield* settle

      const snapshot = yield* restored.getSnapshot
      assert.strictEqual(snapshot.status, "done")
      assert.deepStrictEqual(snapshot.output, Option.none())
      assert.strictEqual(calls, 1)
    })
  )
})
