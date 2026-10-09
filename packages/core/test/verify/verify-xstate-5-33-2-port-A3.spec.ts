/**
 * A3: a raised event is handled before the next external event.
 *
 * T2.36. Upstream `macrostep` in `src/stateUtils.ts` and `resolveRaise` in
 * `src/actions/raise.ts` at xstate@5.33.2: a `raise` without a numeric delay pushes its
 * event to the macrostep's internal queue when the action is resolved, and the macrostep
 * handles every queued internal event, in order, before it returns. The actor publishes one
 * snapshot for the whole macrostep, so an external event that was already in the mailbox
 * meets the state after the raised event. The initial macrostep shares the queue with the
 * initial microstep, so a raise in an initial entry action is handled before `start` ends.
 *
 * Ordering is proved without fork timing (AS2.a): the external events are in the mailbox
 * before `start`, and the published snapshots come from the `@xstate.snapshot` inspection
 * events, which the actor sends once per processed mailbox event. The `actor.subscribe`
 * channel is a separate publication (each observer runs in its own fiber), so the subscribe
 * tests read what a subscribe callback receives, not the inspection events.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Queue } from "effect"
import {
  type ActorLogicType,
  type ActorSystemService,
  createActor,
  createMachine,
  type EventObject,
  getInitialSnapshot,
  getNextSnapshot,
  type MachineSnapshot,
  raise,
  type SnapshotType,
  Types,
} from "../../src/index.js"

/** The initial snapshot through `getInitialSnapshot`, widened until T2.40 (as S2 and S3 do). */
const initialSnapshotOf = (machine: object): Effect.Effect<MachineSnapshot> =>
  getInitialSnapshot(machine as ActorLogicType.Any, undefined) as unknown as Effect.Effect<MachineSnapshot>

/** The next snapshot through `getNextSnapshot` (same widening). */
const nextSnapshotOf = (machine: object, snapshot: MachineSnapshot, event: EventObject): Effect.Effect<MachineSnapshot> =>
  getNextSnapshot(machine as ActorLogicType.Any, snapshot, event) as unknown as Effect.Effect<MachineSnapshot>

/** An actor of `logic` with the given id, not started. */
const actorOf = <S extends SnapshotType, E extends EventObject, Em extends EventObject, R>(
  logic: ActorLogicType<S, E, unknown, Em, R>,
  id: string
) => createActor(logic, { id })

/** An action definition that appends `label` to `log` each time it runs. */
const recorder = (log: Array<string>, label: string) => ({
  type: label,
  exec: () =>
    Effect.sync(() => {
      log.push(label)
      return Types.ActionResult.NoOp()
    }),
})

/** One snapshot the actor published: the mailbox event it processed and the state value it reached. */
interface Published {
  readonly event: string
  readonly value: unknown
}

/**
 * Collects, in order, every snapshot the actor `actorId` publishes: the system sends one
 * `@xstate.snapshot` inspection event per processed mailbox event, inline in the actor's
 * loop. Register it before `start`, so no publication is missed.
 */
const recordPublished = (system: ActorSystemService, actorId: string) =>
  Effect.gen(function* () {
    const published = yield* Queue.unbounded<Published>()
    yield* system.inspect((inspectionEvent) =>
      inspectionEvent.type === "@xstate.snapshot" && inspectionEvent.actorRef.id === actorId
        ? Queue.offer(published, {
            event: inspectionEvent.event.type,
            value: (inspectionEvent.snapshot as MachineSnapshot).value,
          }).pipe(Effect.asVoid)
        : Effect.void
    )
    return published
  })

/** Takes the published snapshots in order, up to and including the first one for `eventType`. */
const publishedThrough = (published: Queue.Queue<Published>, eventType: string) =>
  Effect.gen(function* () {
    const taken: Array<Published> = []
    for (;;) {
      const next = yield* Queue.take(published)
      taken.push(next)
      if (next.event === eventType) {
        return taken
      }
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

/** Lets every other ready fiber take a bounded number of turns, so a late extra delivery shows. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 25; turn++) {
    yield* Effect.yieldNow
  }
})

/** The published values for one event type. */
const valuesFor = (published: ReadonlyArray<Published>, eventType: string): ReadonlyArray<unknown> =>
  published.filter((entry) => entry.event === eventType).map((entry) => entry.value)

/**
 * `idle -GO-> raising`; `raising` raises `RAISED` on entry and goes to `raised` on it. A
 * `NEXT` that meets `raising` goes to `wrong`; one that meets `raised` goes to `next`.
 */
const raiseMachine = () =>
  createMachine<object, EventObject>({
    id: "a3",
    initial: "idle",
    context: {},
    states: {
      idle: { on: { GO: "raising" } },
      raising: {
        entry: raise<object, EventObject>({ type: "RAISED" }),
        on: { RAISED: "raised", NEXT: "wrong" },
      },
      raised: { on: { NEXT: "next" } },
      next: {},
      wrong: {},
    },
  })

describe("A3 a raised event is handled before the next external event", () => {
  it.effect("[A3] the raised event is handled in the same macrostep, before the already-queued external event", () =>
    Effect.gen(function* () {
      // Each root actor owns its system: inspect it after creation, before start
      const actor = yield* actorOf(raiseMachine(), "a3")
      const published = yield* recordPublished(actor.system, "a3")

      // Both external events are in the mailbox before the actor processes any event
      yield* actor.send({ type: "GO" })
      yield* actor.send({ type: "NEXT" })
      yield* actor.start

      const taken = yield* publishedThrough(published, "NEXT")
      // One snapshot for GO, already past the raised event; NEXT then meets `raised`
      assert.deepStrictEqual(valuesFor(taken, "GO"), ["raised"])
      assert.deepStrictEqual(valuesFor(taken, "NEXT"), ["next"])
      assert.deepStrictEqual(valuesFor(taken, "RAISED"), [])
    })
  )

  it.effect("[A3] a subscribe callback registered before start receives exactly one snapshot per macrostep: idle, raised, next", () =>
    Effect.gen(function* () {
      const actor = yield* actorOf(raiseMachine(), "a3-subscribe")
      const published = yield* recordPublished(actor.system, "a3-subscribe")
      const received: Array<unknown> = []
      yield* actor.subscribe((snapshot) =>
        Effect.sync(() => {
          received.push(snapshot.value)
        })
      )

      // Both external events are in the mailbox before the actor processes any event
      yield* actor.send({ type: "GO" })
      yield* actor.send({ type: "NEXT" })
      yield* actor.start

      // The actor has processed NEXT; the subscriber, in its own fiber, then hears of it
      yield* publishedThrough(published, "NEXT")
      assert.isTrue(yield* eventually(Effect.sync(() => received.length >= 3)))
      yield* settle
      // The initial snapshot, one snapshot for GO's whole macrostep (never `raising`), one for NEXT
      assert.deepStrictEqual(received, ["idle", "raised", "next"])
    })
  )

  it.effect("[A3] a subscribe callback registered after start receives exactly one snapshot for the macrostep of GO, already past the raised event", () =>
    Effect.gen(function* () {
      const actor = yield* actorOf(raiseMachine(), "a3-subscribe-started")
      const published = yield* recordPublished(actor.system, "a3-subscribe-started")
      yield* actor.start
      const received: Array<unknown> = []
      yield* actor.subscribe((snapshot) =>
        Effect.sync(() => {
          received.push(snapshot.value)
        })
      )

      yield* actor.send({ type: "GO" })

      yield* publishedThrough(published, "GO")
      assert.isTrue(yield* eventually(Effect.sync(() => received.length >= 1)))
      yield* settle
      assert.deepStrictEqual(received, ["raised"])
    })
  )

  it.effect("[A3] transition returns the state after the raised event in one call", () =>
    Effect.gen(function* () {
      const machine = raiseMachine()
      const initial = yield* initialSnapshotOf(machine)
      const next = yield* nextSnapshotOf(machine, initial, { type: "GO" })

      assert.strictEqual(next.value, "raised")
    })
  )

  it.effect("[A3] events raised in one action list are handled in order, each in its own microstep", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const machine = createMachine<object, EventObject>({
        id: "a3-order",
        initial: "idle",
        context: {},
        states: {
          idle: { on: { GO: "s" } },
          // FIRST must reach `s` and SECOND must reach `t`: a reversed or batched order ends elsewhere
          s: {
            entry: [raise<object, EventObject>({ type: "FIRST" }), raise<object, EventObject>({ type: "SECOND" })],
            on: { FIRST: { target: "t", actions: recorder(log, "first") }, SECOND: "wrong" },
          },
          t: { on: { SECOND: { target: "u", actions: recorder(log, "second") } } },
          u: {},
          wrong: {},
        },
      })
      const initial = yield* initialSnapshotOf(machine)
      const next = yield* nextSnapshotOf(machine, initial, { type: "GO" })

      assert.strictEqual(next.value, "u")
      assert.deepStrictEqual(log, ["first", "second"])
    })
  )

  it.effect("[A3] a raise in an initial entry action is handled before the initial snapshot is published", () =>
    Effect.gen(function* () {
      const machine = createMachine<object, EventObject>({
        id: "a3-init",
        initial: "boot",
        context: {},
        states: {
          boot: { entry: raise<object, EventObject>({ type: "READY" }), on: { READY: "ready" } },
          ready: {},
        },
      })

      const initial = yield* initialSnapshotOf(machine)
      assert.strictEqual(initial.value, "ready")

      const actor = yield* actorOf(machine, "a3-init")
      const published = yield* recordPublished(actor.system, "a3-init")
      yield* actor.send({ type: "PROBE" })
      yield* actor.start

      // The first event meets `ready`: the raise did not go through the mailbox
      const taken = yield* publishedThrough(published, "PROBE")
      assert.deepStrictEqual(valuesFor(taken, "READY"), [])
      assert.deepStrictEqual(valuesFor(taken, "PROBE"), ["ready"])
    })
  )
})
