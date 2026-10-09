/**
 * S4: a machine whose initial state is final is done at once.
 *
 * T3.16. Upstream (xstate@5.33.2): the initial microsteps enter the initial final state, so the
 * snapshot an actor is created with already has status `done` and the machine output
 * (`enterStates`, `getMachineOutput` in `src/stateUtils.ts`). `start` in `src/createActor.ts`
 * then takes its 'done' branch: it calls `update(snapshot, initEvent)` and returns, with no
 * `logic.start` and no mailbox. `update` runs the deferred initial actions, gives every
 * observer the done snapshot once, runs the stop procedure (`_stopProcedure`: the scheduled
 * events are cancelled, the actor leaves the system, a later send only warns), and relays
 * `xstate.done.actor.<id>` with the output to the parent.
 *
 * The port does the same in the actor's own `start` (D12): no processing fiber runs, the done
 * event is a plain object with the output as an Option (SD-5, D8), and the actor's scope
 * closes (SD-27). The end of the `changes` stream on done is C16 (T5.8), not checked here.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Logger, Option } from "effect"
import { TestClock } from "effect/testing"
import {
  type AnyActorLogic,
  assign,
  createActor,
  createMachine,
  type EventObject,
  makeActorLogic,
  sendParent,
  Snapshot,
  type SnapshotType,
  spawnChild,
} from "../../src/index.js"
import { eventSentToStoppedActor } from "./upstream-messages.js"

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

/** Runs `program` with a logger that keeps the text of every warning. */
const withWarningsCaptured = <A, E, R>(program: Effect.Effect<A, E, R>) => {
  const warnings: Array<string> = []
  return program.pipe(
    Effect.provide(
      Logger.layer([
        Logger.make((options) => {
          if (options.logLevel === "Warn") {
            const parts: ReadonlyArray<unknown> = Array.isArray(options.message) ? options.message : [options.message]
            warnings.push(parts.map(String).join(" "))
          }
        }),
      ])
    ),
    Effect.map((result) => ({ result, warnings }))
  )
}

/** A captured event: any event, with the `output` and `actorId` fields a done event carries. */
type Captured = EventObject & { readonly output?: unknown; readonly actorId?: string }

interface Received {
  readonly received: ReadonlyArray<Captured>
}

/** Keeps every event the parent takes, in order. */
const record = assign<Received, EventObject>(({ context, event }) => ({ received: [...context.received, event] }))

/** A parent that spawns `child` as `child` on entry and keeps the events it hears from it. */
const parentOf = <TLogic extends AnyActorLogic>(child: TLogic) =>
  createMachine<Received, EventObject>({
    id: "s4-parent",
    context: { received: [] },
    entry: spawnChild<Received, EventObject, TLogic>(child, { id: "child" }),
    on: {
      HELLO: { actions: record },
      LATER: { actions: record },
      "xstate.done.actor.child": { actions: record },
    },
  })

/** The events a parent from `parentOf` has kept. */
const receivedBy = (actor: { readonly getSnapshot: Effect.Effect<{ readonly context: Received }> }) =>
  Effect.map(actor.getSnapshot, (snapshot) => snapshot.context.received)

describe("S4 A machine whose initial state is final is done at once", () => {
  it.effect("[S4] a machine whose initial state is final has status done when created and after start", () =>
    Effect.gen(function* () {
      const machine = createMachine<object, EventObject>({
        id: "s4-initial",
        initial: "finished",
        context: {},
        states: { finished: { type: "final" } },
      })

      const actor = yield* createActor(machine)
      assert.strictEqual((yield* actor.getSnapshot).status, "done")
      yield* actor.start

      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.status, "done")
      assert.strictEqual(snapshot.value, "finished")
      assert.deepStrictEqual(snapshot.error, Option.none())
    })
  )

  it.effect("[S4] a root final state, a final state reached by eventless transitions and a parallel root whose regions start final are each done after start", () =>
    Effect.gen(function* () {
      // upstream: status of a machine with a root state being final should be done
      const rootFinal = createMachine<object, EventObject>({ id: "s4-root", type: "final", context: {} })
      const eventless = createMachine<object, EventObject>({
        id: "s4-eventless",
        initial: "a",
        context: {},
        states: {
          a: { always: "b" },
          b: { always: "c" },
          c: { type: "final" },
        },
      })
      const parallel = createMachine<object, EventObject>({
        id: "s4-parallel",
        type: "parallel",
        context: {},
        states: {
          left: { initial: "l", states: { l: { type: "final" } } },
          right: { initial: "r", states: { r: { type: "final" } } },
        },
      })

      for (const machine of [rootFinal, eventless, parallel]) {
        const actor = yield* createActor(machine)
        yield* actor.start
        assert.strictEqual((yield* actor.getSnapshot).status, "done", machine.id)
      }
    })
  )

  it.effect("[S4] the initial actions run once, at start, and the done snapshot holds the context they assigned", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const machine = createMachine<{ readonly count: number }, EventObject>({
        id: "s4-actions",
        initial: "finished",
        context: { count: 0 },
        entry: () => {
          log.push("root entry")
        },
        states: {
          finished: {
            type: "final",
            entry: [
              assign<{ readonly count: number }, EventObject>(() => ({ count: 1 })),
              () => {
                log.push("final entry")
              },
            ],
          },
        },
      })

      const actor = yield* createActor(machine)
      assert.deepStrictEqual(log, [])
      yield* actor.start
      yield* settle

      assert.deepStrictEqual(log, ["root entry", "final entry"])
      assert.deepStrictEqual((yield* actor.getSnapshot).context, { count: 1 })
    })
  )

  it.effect("[S4] a subscriber attached before start receives the done snapshot exactly once", () =>
    Effect.gen(function* () {
      const machine = createMachine<object, EventObject>({
        id: "s4-observer",
        initial: "finished",
        context: {},
        states: { finished: { type: "final" } },
      })
      const actor = yield* createActor(machine)
      const seen: Array<string> = []
      yield* actor.subscribe((snapshot) =>
        Effect.sync(() => {
          seen.push(snapshot.status)
        })
      )

      yield* actor.start
      yield* settle

      assert.deepStrictEqual(seen, ["done"])
    })
  )

  it.effect("[S4] a done actor stops processing at start: a later send logs the upstream warning and changes nothing, and it leaves the system", () =>
    Effect.gen(function* () {
      const machine = createMachine<{ readonly count: number }, EventObject>({
        id: "s4-stopped",
        initial: "finished",
        context: { count: 0 },
        on: { INC: { actions: assign<{ readonly count: number }, EventObject>(({ context }) => ({ count: context.count + 1 })) } },
        states: { finished: { type: "final" } },
      })

      const { result, warnings } = yield* withWarningsCaptured(
        Effect.gen(function* () {
          const actor = yield* createActor(machine, { id: "s4-stopped", systemId: "s4-system" })
          yield* actor.start
          yield* actor.send({ type: "INC" })
          yield* settle
          return {
            sessionId: actor.sessionId,
            snapshot: yield* actor.getSnapshot,
            registered: yield* actor.system.get("s4-system"),
          }
        })
      )

      assert.deepStrictEqual(warnings, [eventSentToStoppedActor({ type: "INC" }, "s4-stopped", result.sessionId)])
      assert.strictEqual(result.snapshot.status, "done")
      assert.deepStrictEqual(result.snapshot.context, { count: 0 })
      assert.deepStrictEqual(result.registered, Option.none())
    })
  )

  it.effect("[S4] the logic's own start is not called for a snapshot that is already done", () =>
    Effect.gen(function* () {
      let starts = 0
      const logic = makeActorLogic<SnapshotType, EventObject, unknown>({
        transition: (snapshot) => Effect.succeed(snapshot),
        getInitialSnapshot: () => Effect.succeed(Snapshot.done(42)),
        getPersistedSnapshot: (snapshot) => Effect.succeed(snapshot),
        start: () =>
          Effect.sync(() => {
            starts++
          }),
      })

      const actor = yield* createActor(logic)
      yield* actor.start

      assert.strictEqual(starts, 0)
      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.status, "done")
      assert.deepStrictEqual(snapshot.output, Option.some(42))
    })
  )

  it.effect("[S4] a spawned child whose initial state is final relays its outgoing events, then xstate.done.actor.<id> with its output, to the parent", () =>
    Effect.gen(function* () {
      const child = createMachine<object, EventObject>({
        id: "s4-child",
        initial: "finished",
        context: {},
        output: () => "child output",
        states: {
          finished: { type: "final", entry: sendParent<object, EventObject>({ type: "HELLO" }) },
        },
      })

      const actor = yield* createActor(parentOf(child))
      yield* actor.start

      assert.isTrue(yield* eventually(Effect.map(receivedBy(actor), (received) => received.length >= 2)), "the parent hears of it")
      yield* settle
      assert.deepStrictEqual(yield* receivedBy(actor), [
        { type: "HELLO" },
        { type: "xstate.done.actor.child", output: Option.some("child output"), actorId: "child" },
      ])
      assert.strictEqual((yield* actor.getSnapshot).status, "active")
    })
  )

  it.effect("[S4] the delayed sends of a child that is done at start are cancelled by its stop procedure", () =>
    Effect.gen(function* () {
      const child = createMachine<object, EventObject>({
        id: "s4-delayed-child",
        initial: "finished",
        context: {},
        states: {
          finished: { type: "final", entry: sendParent<object, EventObject>({ type: "LATER" }, { delay: 100 }) },
        },
      })

      const actor = yield* createActor(parentOf(child))
      yield* actor.start
      assert.isTrue(yield* eventually(Effect.map(receivedBy(actor), (received) => received.length >= 1)), "the done event arrives")

      yield* TestClock.adjust("200 millis")
      yield* settle

      assert.deepStrictEqual(
        (yield* receivedBy(actor)).map((event) => event.type),
        ["xstate.done.actor.child"]
      )
    })
  )
})
