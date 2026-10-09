/**
 * CONC-2: an external send is read-your-writes and actor-to-actor sends never deadlock.
 *
 * T2.43. Upstream `Actor.send` in `src/createActor.ts` at xstate@5.33.2 processes the event
 * synchronously, so `getSnapshot()` right after `send` shows its macrostep. The port keeps
 * that contract (SD-23): an external `send` completes after its macrostep commits, or after
 * the event is dropped — also when the macrostep sets status `error` or `done`, and when
 * `stop` drops it. A send made from inside an actor (an inline action, a `sendTo`) never
 * waits, so two machines that send to each other and to themselves never deadlock. Stop
 * during a transition lets the macrostep in progress commit and drops the events still
 * queued (upstream `_stop` clears the mailbox; the transition in progress is synchronous).
 *
 * Every wait is a Deferred handshake or a bounded number of yields; no test sleeps.
 */
import { assert, describe, it } from "@effect/vitest"
import { Deferred, Effect, Exit, Fiber, Logger } from "effect"
import { assign, createActor, createMachine, raise } from "../../src/index.js"
import { eventSentToStoppedActor } from "./upstream-messages.js"

interface Counter {
  readonly count: number
  readonly blocked: boolean
}

type CounterEvent =
  | { readonly type: "increment" }
  | { readonly type: "block" }
  | { readonly type: "finish" }
  | { readonly type: "PING" }
  | { readonly type: "PONG" }

/** Handshakes for a macrostep that waits inside an inline action. */
interface Gate {
  /** Completed when the `block` macrostep reached its inline action. */
  readonly entered: Deferred.Deferred<void>
  /** The `block` macrostep waits for this before it commits. */
  readonly release: Deferred.Deferred<void>
}

const makeGate = Effect.gen(function* () {
  return { entered: yield* Deferred.make<void>(), release: yield* Deferred.make<void>() } satisfies Gate
})

/**
 * `increment` adds one; `block` waits on the gate in an inline action, then sets `blocked`;
 * `finish` reaches a top-level final state; `PING` starts a raise cycle that exceeds
 * `maxIterations: 3` and ends in status `error` (S21).
 */
const counterMachine = (gate: Gate) =>
  createMachine<Counter, CounterEvent>({
    id: "conc2-counter",
    initial: "active",
    context: { count: 0, blocked: false },
    options: { maxIterations: 3 },
    states: {
      active: {
        on: {
          increment: { actions: assign<Counter, CounterEvent>(({ context }) => ({ count: context.count + 1 })) },
          block: {
            actions: [
              () => Effect.andThen(Deferred.succeed(gate.entered, undefined), Deferred.await(gate.release)),
              assign<Counter, CounterEvent>({ blocked: true }),
            ],
          },
          finish: "done",
          PING: "ping",
        },
      },
      ping: { entry: raise<Counter, CounterEvent>({ type: "PONG" }), on: { PONG: "pong" } },
      pong: { entry: raise<Counter, CounterEvent>({ type: "PING" }), on: { PING: "ping" } },
      done: { type: "final" },
    },
  })

/** Lets every other ready fiber take ten turns. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 10; turn++) {
    yield* Effect.yieldNow
  }
})

/** Whether the fiber has ended with a success. */
const succeeded = (fiber: Fiber.Fiber<unknown, unknown>): boolean => {
  const exit = fiber.pollUnsafe()
  return exit !== undefined && Exit.isSuccess(exit)
}

/** Whether the fiber has ended. */
const ended = (fiber: Fiber.Fiber<unknown, unknown>): boolean => fiber.pollUnsafe() !== undefined

/** Runs `send` in a new fiber, lets the runtime run once, and records whether it finished successfully. */
const sendWithinOneYield = (send: Effect.Effect<void>, returned: Array<boolean>) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(send)
    yield* Effect.yieldNow
    returned.push(succeeded(fiber))
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

interface Exchange {
  readonly log: ReadonlyArray<string>
}

type ExchangeEvent = { readonly type: "kick" } | { readonly type: "ping" } | { readonly type: "pong" } | { readonly type: "note" }

/** The `send` of an actor that is created after the machine that sends to it. */
interface Peer {
  send: (event: ExchangeEvent) => Effect.Effect<void>
}

const recordEvent = assign<Exchange, ExchangeEvent>(({ context, event }) => ({ log: [...context.log, event.type] }))

describe("CONC-2 An external send is read-your-writes and actor-to-actor sends never deadlock", () => {
  it.effect("[CONC-2] getSnapshot right after an external send shows that event's macrostep", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(counterMachine(yield* makeGate))
      yield* actor.start
      const counts: Array<number> = []

      for (let sent = 0; sent < 3; sent++) {
        yield* actor.send({ type: "increment" })
        counts.push((yield* actor.getSnapshot).context.count)
      }

      assert.deepStrictEqual(counts, [1, 2, 3])
    })
  )

  it.effect("[CONC-2] machines A and B that send to each other and to themselves complete an A-B-A exchange, each internal send returning within one yield", () =>
    Effect.gen(function* () {
      const returned: Array<boolean> = []
      const exchanged = yield* Deferred.make<void>()
      const peerA: Peer = { send: () => Effect.void }
      const peerB: Peer = { send: () => Effect.void }
      const machineA = createMachine<Exchange, ExchangeEvent>({
        id: "conc2-a",
        initial: "active",
        context: { log: [] },
        states: {
          active: {
            on: {
              kick: { actions: [recordEvent, () => sendWithinOneYield(peerB.send({ type: "ping" }), returned)] },
              pong: { actions: [recordEvent, () => sendWithinOneYield(peerA.send({ type: "note" }), returned)] },
              note: { actions: [recordEvent, () => Deferred.succeed(exchanged, undefined)] },
            },
          },
        },
      })
      const machineB = createMachine<Exchange, ExchangeEvent>({
        id: "conc2-b",
        initial: "active",
        context: { log: [] },
        states: {
          active: {
            on: {
              ping: {
                actions: [
                  recordEvent,
                  () => sendWithinOneYield(peerA.send({ type: "pong" }), returned),
                  () => sendWithinOneYield(peerB.send({ type: "note" }), returned),
                ],
              },
              note: { actions: recordEvent },
            },
          },
        },
      })
      const a = yield* createActor(machineA)
      const b = yield* createActor(machineB)
      peerA.send = a.send
      peerB.send = b.send
      yield* a.start
      yield* b.start

      yield* a.send({ type: "kick" })
      const afterKick = yield* a.getSnapshot
      yield* settle
      const done = yield* Deferred.isDone(exchanged)

      assert.deepStrictEqual(afterKick.context.log, ["kick"])
      assert.isTrue(done)
      assert.deepStrictEqual((yield* a.getSnapshot).context.log, ["kick", "pong", "note"])
      assert.deepStrictEqual((yield* b.getSnapshot).context.log, ["ping", "note"])
      assert.deepStrictEqual(returned, [true, true, true, true])
    })
  )

  it.effect("[CONC-2] an external send whose macrostep sets status error completes with void, and getSnapshot right after shows error", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(counterMachine(yield* makeGate))
      yield* actor.start

      const sent = yield* Effect.exit(actor.send({ type: "PING" }))
      const snapshot = yield* actor.getSnapshot

      assert.isTrue(Exit.isSuccess(sent))
      assert.strictEqual(snapshot.status, "error")
    })
  )

  it.effect("[CONC-2] an external send that reaches a top-level final state completes with void, and getSnapshot right after shows done", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(counterMachine(yield* makeGate))
      yield* actor.start

      const sent = yield* Effect.exit(actor.send({ type: "finish" }))
      const snapshot = yield* actor.getSnapshot

      assert.isTrue(Exit.isSuccess(sent))
      assert.strictEqual(snapshot.status, "done")
    })
  )

  it.effect("[CONC-2] an external send whose macrostep dies (a guard that throws) completes with void, and getSnapshot right after shows error", () =>
    Effect.gen(function* () {
      const machine = createMachine<Counter, CounterEvent>({
        id: "conc2-throwing-guard",
        initial: "active",
        context: { count: 0, blocked: false },
        states: {
          active: {
            on: {
              increment: {
                guard: () => {
                  throw new Error("guard failed")
                },
                actions: assign<Counter, CounterEvent>(({ context }) => ({ count: context.count + 1 })),
              },
            },
          },
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      const sent = yield* Effect.exit(actor.send({ type: "increment" }))
      const snapshot = yield* actor.getSnapshot

      assert.isTrue(Exit.isSuccess(sent))
      assert.strictEqual(snapshot.status, "error")
      assert.strictEqual(snapshot.context.count, 0)
    })
  )

  it.effect("[CONC-2] an external send completes with void when an inspection function of the actor dies while the event is processed", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(counterMachine(yield* makeGate))
      yield* actor.system.inspect((inspectionEvent) =>
        inspectionEvent.type === "@xstate.snapshot" ? Effect.die(new Error("inspector failed")) : Effect.void
      )
      yield* actor.start

      const sending = yield* Effect.forkChild(actor.send({ type: "increment" }))
      yield* settle

      assert.isTrue(succeeded(sending))
    })
  )

  it.effect("[CONC-2] stop during a transition lets that macrostep commit; a send still queued completes with void, and getSnapshot right after shows stopped", () =>
    Effect.gen(function* () {
      const gate = yield* makeGate
      const actor = yield* createActor(counterMachine(gate))
      yield* actor.start

      const blocking = yield* Effect.forkChild(actor.send({ type: "block" }))
      const queued = yield* Effect.forkChild(actor.send({ type: "increment" }))
      yield* Deferred.await(gate.entered)
      const stopping = yield* Effect.forkChild(actor.stop)
      yield* settle
      // Stop waits for the macrostep in progress; the queued send waits for the stop
      const stopEndedBeforeRelease = ended(stopping)
      const queuedEndedBeforeRelease = ended(queued)

      yield* Deferred.succeed(gate.release, undefined)
      const queuedExit = yield* Fiber.await(queued)
      const afterQueued = yield* actor.getSnapshot
      const blockingExit = yield* Fiber.await(blocking)
      const stopExit = yield* Fiber.await(stopping)

      assert.isFalse(stopEndedBeforeRelease)
      assert.isFalse(queuedEndedBeforeRelease)
      assert.isTrue(Exit.isSuccess(queuedExit))
      assert.isTrue(Exit.isSuccess(blockingExit))
      assert.isTrue(Exit.isSuccess(stopExit))
      assert.strictEqual(afterQueued.status, "stopped")
      // The macrostep in progress committed; the queued increment was dropped
      assert.isTrue(afterQueued.context.blocked)
      assert.strictEqual(afterQueued.context.count, 0)
    })
  )

  it.effect("[CONC-2] a send racing stop completes with void whichever runs first; a send after stop drops with the warning", () =>
    Effect.gen(function* () {
      for (let offset = 0; offset < 4; offset++) {
        const { result, warnings } = yield* withWarningsCaptured(
          Effect.gen(function* () {
            const actor = yield* createActor(counterMachine(yield* makeGate), { id: `race-${offset}` })
            yield* actor.start
            const sending = yield* Effect.forkChild(actor.send({ type: "increment" }))
            for (let turn = 0; turn < offset; turn++) {
              yield* Effect.yieldNow
            }
            const stopping = yield* Effect.forkChild(actor.stop)
            yield* settle
            const racedEnded = { send: succeeded(sending), stop: succeeded(stopping) }
            const raced = yield* actor.getSnapshot

            yield* actor.send({ type: "increment" })
            return { racedEnded, raced, sessionId: actor.sessionId, last: yield* actor.getSnapshot }
          })
        )

        assert.deepStrictEqual(result.racedEnded, { send: true, stop: true }, `offset ${offset}`)
        assert.strictEqual(result.raced.status, "stopped", `offset ${offset}`)
        assert.isAtMost(result.raced.context.count, 1, `offset ${offset}`)
        assert.strictEqual(result.last.context.count, result.raced.context.count, `offset ${offset}`)
        // The raced send dropped after stop warns too; the send after stop always warns
        const expected = eventSentToStoppedActor({ type: "increment" }, `race-${offset}`, result.sessionId)
        assert.isTrue(warnings.length >= 1 && warnings.length <= 2, `offset ${offset}`)
        assert.isTrue(warnings.every((warning) => warning === expected), `offset ${offset}`)
      }
    })
  )
})

