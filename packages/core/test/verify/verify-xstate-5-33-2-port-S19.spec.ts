/**
 * S19: eventless transitions run on the initial state, after entry, chained and guarded.
 *
 * T2.36. Upstream `macrostep` and `selectEventlessTransitions` in `src/stateUtils.ts` at
 * xstate@5.33.2: after the first microstep of a macrostep (or after the initial microstep),
 * the macrostep takes the enabled `always` transitions of the active atomic states and
 * their ancestors, one microstep at a time, before it handles the next internal event, and
 * stops when none is enabled and the internal queue is empty. Guards and actions of an
 * eventless transition see the event that started the macrostep, or the internal event
 * handled last. An eventless microstep that returns the identical snapshot suspends
 * eventless selection until an internal event is processed. The actor publishes one
 * snapshot for the whole macrostep.
 *
 * Counts come from the `@xstate.snapshot` inspection events, which the actor sends once per
 * processed mailbox event (AS2.a: no fork timing). The `actor.subscribe` channel is a separate
 * publication (each observer runs in its own fiber), so the subscribe tests read what a
 * subscribe callback receives, not the inspection events.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Queue, SubscriptionRef } from "effect"
import {
  type ActorLogicType,
  type ActorSystemService,
  assign,
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

/** Entry and exit recorders for a state named `name`. */
const tracked = (log: Array<string>, name: string) => ({
  entry: recorder(log, `en ${name}`),
  exit: recorder(log, `ex ${name}`),
})

/** One snapshot the actor published: the mailbox event it processed, the value and the context. */
interface Published {
  readonly event: string
  readonly value: unknown
  readonly context: unknown
}

/**
 * Collects, in order, every snapshot the actor `actorId` publishes (one `@xstate.snapshot`
 * inspection event per processed mailbox event, sent inline in the actor's loop).
 */
const recordPublished = (system: ActorSystemService, actorId: string) =>
  Effect.gen(function* () {
    const published = yield* Queue.unbounded<Published>()
    yield* system.inspect((inspectionEvent) =>
      inspectionEvent.type === "@xstate.snapshot" && inspectionEvent.actorRef.id === actorId
        ? Queue.offer(published, {
            event: inspectionEvent.event.type,
            value: (inspectionEvent.snapshot as MachineSnapshot).value,
            context: (inspectionEvent.snapshot as MachineSnapshot).context,
          }).pipe(Effect.asVoid)
        : Effect.void
    )
    return published
  })

/** Whether `condition` holds within a bounded number of fiber turns (a subscriber runs in its own fiber). */
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

/** Takes the published snapshots in order, up to and including the `occurrences`-th one for `eventType`. */
const publishedThrough = (published: Queue.Queue<Published>, eventType: string, occurrences = 1) =>
  Effect.gen(function* () {
    const taken: Array<Published> = []
    for (;;) {
      const next = yield* Queue.take(published)
      taken.push(next)
      if (taken.filter((entry) => entry.event === eventType).length === occurrences) {
        return taken
      }
    }
  })

interface Counter {
  readonly count: number
}

/** A guard that passes once `count` is at least `min`. */
const countAtLeast = (min: number) => ({
  type: `countAtLeast${min}`,
  predicate: ({ context }: { readonly context: Counter }) => Effect.succeed(context.count >= min),
})

const increment = assign<Counter, EventObject>(({ context }) => ({ count: context.count + 1 }))

/**
 * `start` has an `always` to `checking`; `checking` increments `count` on entry and has an
 * `always` guarded by `count >= 1` to `chain1`; `chain1` has an `always` to `chain2`;
 * `chain2` increments on `BUMP` (targetless) and has an `always` guarded by `count >= 3`
 * to `done`. Every state is tracked.
 */
const eventlessMachine = (log: Array<string>) =>
  createMachine<Counter, EventObject>({
    id: "s19",
    initial: "start",
    context: { count: 0 },
    states: {
      start: { ...tracked(log, "start"), always: "checking" },
      checking: {
        entry: [recorder(log, "en checking"), increment],
        exit: recorder(log, "ex checking"),
        always: { guard: countAtLeast(1), target: "chain1" },
      },
      chain1: { ...tracked(log, "chain1"), always: { target: "chain2" } },
      chain2: {
        ...tracked(log, "chain2"),
        on: { BUMP: { actions: increment } },
        always: { guard: countAtLeast(3), target: "done" },
      },
      done: tracked(log, "done"),
    },
  })

/** `idle -GO-> one`; `one` and `two` each have an `always` to the next state; `three -NEXT-> four`. */
const alwaysChainMachine = () =>
  createMachine<object, EventObject>({
    id: "s19-chain",
    initial: "idle",
    context: {},
    states: {
      idle: { on: { GO: "one" } },
      one: { always: "two" },
      two: { always: "three" },
      three: { on: { NEXT: "four" } },
      four: {},
    },
  })

describe("S19 eventless transitions run on the initial state, after entry, chained and guarded", () => {
  it.effect("[S19] an always transition on the initial state, after entry and in a chain runs in the initial macrostep", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const initial = yield* initialSnapshotOf(eventlessMachine(log))

      assert.strictEqual(initial.value, "chain2")
      assert.deepStrictEqual(initial.context, { count: 1 })
      assert.deepStrictEqual(log, [
        "en start",
        "ex start",
        "en checking",
        "ex checking",
        "en chain1",
        "ex chain1",
        "en chain2",
      ])
    })
  )

  it.effect("[S19] an always guard that an assign makes true is taken in the same macrostep", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const machine = eventlessMachine(log)
      const initial = yield* initialSnapshotOf(machine)

      const once = yield* nextSnapshotOf(machine, initial, { type: "BUMP" })
      assert.strictEqual(once.value, "chain2")
      assert.deepStrictEqual(once.context, { count: 2 })

      log.length = 0
      const twice = yield* nextSnapshotOf(machine, once, { type: "BUMP" })
      assert.strictEqual(twice.value, "done")
      assert.deepStrictEqual(twice.context, { count: 3 })
      assert.deepStrictEqual(log, ["ex chain2", "en done"])
    })
  )

  it.effect("[S19] the actor publishes one snapshot per macrostep for an always chain", () =>
    Effect.gen(function* () {
      // Each root actor owns its system: inspect it after creation, before start
      const actor = yield* actorOf(eventlessMachine([]), "s19")
      const published = yield* recordPublished(actor.system, "s19")
      yield* actor.send({ type: "BUMP" })
      yield* actor.send({ type: "BUMP" })

      // The initial macrostep (computed at creation, SD-8) took the whole chain before the
      // first snapshot was set. Read it before start: like upstream `start`, which processes
      // its mailbox, `start` returns after the two queued BUMP events (SD-23)
      const initial = (yield* SubscriptionRef.get(actor.snapshot)) as MachineSnapshot
      assert.strictEqual(initial.value, "chain2")
      yield* actor.start

      const bumps = (yield* publishedThrough(published, "BUMP", 2)).filter((entry) => entry.event === "BUMP")
      assert.deepStrictEqual(bumps, [
        { event: "BUMP", value: "chain2", context: { count: 2 } },
        { event: "BUMP", value: "done", context: { count: 3 } },
      ])
    })
  )

  it.effect("[S19] a subscribe callback registered before start receives exactly one snapshot per macrostep of the always chain", () =>
    Effect.gen(function* () {
      const actor = yield* actorOf(eventlessMachine([]), "s19-subscribe")
      const published = yield* recordPublished(actor.system, "s19-subscribe")
      const received: Array<{ readonly value: unknown; readonly context: unknown }> = []
      yield* actor.subscribe((snapshot) =>
        Effect.sync(() => {
          const machineSnapshot = snapshot as MachineSnapshot
          received.push({ value: machineSnapshot.value, context: machineSnapshot.context })
        })
      )

      // Both BUMP events are in the mailbox before the actor processes any event
      yield* actor.send({ type: "BUMP" })
      yield* actor.send({ type: "BUMP" })
      yield* actor.start

      // The actor has processed the second BUMP; the subscriber, in its own fiber, then hears of it
      yield* publishedThrough(published, "BUMP", 2)
      assert.isTrue(yield* eventually(Effect.sync(() => received.length >= 3)))
      yield* settle
      // The initial snapshot after the whole initial chain (never start, checking or chain1),
      // then one snapshot for each BUMP: the second BUMP's assign makes the guard to done true,
      // and its macrostep gives one snapshot, done, with no chain2 snapshot of count 3 before it
      assert.deepStrictEqual(received, [
        { value: "chain2", context: { count: 1 } },
        { value: "chain2", context: { count: 2 } },
        { value: "done", context: { count: 3 } },
      ])
    })
  )

  it.effect("[S19] a subscribe callback registered after start receives exactly one snapshot, three, for the always chain that GO starts", () =>
    Effect.gen(function* () {
      const actor = yield* actorOf(alwaysChainMachine(), "s19-chain-subscribe")
      const published = yield* recordPublished(actor.system, "s19-chain-subscribe")
      yield* actor.start
      const received: Array<unknown> = []
      yield* actor.subscribe((snapshot) =>
        Effect.sync(() => {
          received.push((snapshot as MachineSnapshot).value)
        })
      )

      yield* actor.send({ type: "GO" })

      yield* publishedThrough(published, "GO")
      assert.isTrue(yield* eventually(Effect.sync(() => received.length >= 1)))
      yield* settle
      // Never one or two: the whole chain is one macrostep and one snapshot
      assert.deepStrictEqual(received, ["three"])
    })
  )

  it.effect("[S19] an always chain started by an event takes every link in one macrostep and one published snapshot", () =>
    Effect.gen(function* () {
      const actor = yield* actorOf(alwaysChainMachine(), "s19-chain")
      const published = yield* recordPublished(actor.system, "s19-chain")
      yield* actor.send({ type: "GO" })
      yield* actor.send({ type: "NEXT" })
      yield* actor.start

      const taken = yield* publishedThrough(published, "NEXT")
      assert.deepStrictEqual(
        taken.filter((entry) => entry.event !== "xstate.init").map((entry) => [entry.event, entry.value]),
        [
          ["GO", "three"],
          ["NEXT", "four"],
        ]
      )
    })
  )

  it.effect("[S19] an always guard and its actions see the external event, or the raised event handled last", () =>
    Effect.gen(function* () {
      const seen: Array<string> = []
      const describeEvent = (event: EventObject): string =>
        `${event.type}:${"value" in event ? String(event.value) : "-"}`
      const guardRecorder = (label: string) => ({
        type: `${label} guard`,
        predicate: ({ event }: { readonly event: EventObject }) =>
          Effect.sync(() => {
            seen.push(`${label} guard ${describeEvent(event)}`)
            return true
          }),
      })
      const actionRecorder = (label: string) => ({
        type: `${label} action`,
        exec: ({ event }: { readonly event: EventObject }) =>
          Effect.sync(() => {
            seen.push(`${label} action ${describeEvent(event)}`)
            return Types.ActionResult.NoOp()
          }),
      })
      // Events with a payload, held in variables: `EventObject` has only `type`
      const raised: EventObject = { type: "R", value: 2 } as EventObject
      const external: EventObject = { type: "E", value: 1 } as EventObject
      const machine = createMachine<object, EventObject>({
        id: "s19-events",
        initial: "idle",
        context: {},
        states: {
          idle: { on: { E: "afterE", GO: "raising" } },
          afterE: { always: { guard: guardRecorder("e"), actions: actionRecorder("e"), target: "settled" } },
          raising: {
            entry: raise<object, EventObject>(raised),
            on: { R: "afterR" },
          },
          afterR: { always: { guard: guardRecorder("r"), actions: actionRecorder("r"), target: "settled" } },
          settled: {},
        },
      })
      const initial = yield* initialSnapshotOf(machine)

      const afterE = yield* nextSnapshotOf(machine, initial, external)
      assert.strictEqual(afterE.value, "settled")
      assert.deepStrictEqual(seen, ["e guard E:1", "e action E:1"])

      seen.length = 0
      const afterGo = yield* nextSnapshotOf(machine, initial, { type: "GO" })
      assert.strictEqual(afterGo.value, "settled")
      assert.deepStrictEqual(seen, ["r guard R:2", "r action R:2"])
    })
  )

  it.effect("[S19] an eventless microstep that leaves the snapshot identical suspends eventless selection until an internal event", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const machine = createMachine<object, EventObject>({
        id: "s19-identical",
        initial: "a",
        context: {},
        // A selection that never suspends would loop; the limit turns that into an error
        options: { maxIterations: 10 },
        states: {
          a: {
            always: { actions: recorder(log, "always") },
            on: {
              E: { actions: raise<object, EventObject>({ type: "INTERNAL" }) },
              INTERNAL: { actions: recorder(log, "internal") },
            },
          },
        },
      })

      const initial = yield* initialSnapshotOf(machine)
      assert.strictEqual(initial.status, "active")
      assert.deepStrictEqual(log, ["always"])

      log.length = 0
      const next = yield* nextSnapshotOf(machine, initial, { type: "E" })
      assert.strictEqual(next.status, "active")
      // once after E, suspended; resumed after the internal event, then suspended again
      assert.deepStrictEqual(log, ["always", "internal", "always"])
    })
  )

  it.effect("[S19] a targetless always that assigns is selected again until its guard fails", () =>
    Effect.gen(function* () {
      const machine = createMachine<Counter, EventObject>({
        id: "s19-assign",
        initial: "a",
        context: { count: 0 },
        states: {
          a: {
            always: {
              guard: {
                type: "below5",
                predicate: ({ context }: { readonly context: Counter }) => Effect.succeed(context.count < 5),
              },
              actions: increment,
            },
          },
        },
      })

      const initial = yield* initialSnapshotOf(machine)
      assert.strictEqual(initial.value, "a")
      assert.deepStrictEqual(initial.context, { count: 5 })
    })
  )
})
