/**
 * C14: a send to a stopped, done or errored actor is ignored with a warning.
 *
 * T2.43. Upstream `Actor._send` in `src/createActor.ts` at xstate@5.33.2 drops an event sent
 * to an actor whose processing status is `Stopped` — after `stop`, and after
 * `_stopProcedure` ran because a macrostep ended `done` or `error` — and warns
 * `Event "<type>" was sent to stopped actor "<id> (<sessionId>)". ...`. The port logs that
 * text with `Effect.logWarning` (SD-21) and never suspends or interrupts the sender (D12);
 * `start` on such an actor changes nothing (SD-23).
 *
 * Stop (D12): the actor's processing fiber ends, its scope closes once (its finalizers run
 * once), its status becomes `stopped` and its scheduled events are cancelled. The system of
 * a stopped root keeps no timer pending: timers fork into the system's scope, not into a
 * detached fiber (RES-02). A not-started actor that is stopped keeps its snapshot (upstream
 * `_stop` only marks it stopped) and never runs its initial actions.
 *
 * Every wait is a Deferred handshake, a bounded number of yields or TestClock time; no test
 * sleeps.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Exit, type Fiber, Logger, Option, Scope, Stream } from "effect"
import { TestClock } from "effect/testing"
import {
  assign,
  createActor,
  createMachine,
  fromCallback,
  raise,
  type SnapshotType,
} from "../../src/index.js"
import { eventSentToStoppedActor } from "./upstream-messages.js"

/** More sends than the former bounded mailbox (1,000) holds. */
const SENDS = 1500

interface Counter {
  readonly count: number
}

type CounterEvent =
  | { readonly type: "increment" }
  | { readonly type: "finish" }
  | { readonly type: "PING" }
  | { readonly type: "PONG" }

/**
 * `active -increment-> active (count + 1)`, `active -finish-> done (final)`, and a raise
 * cycle `PING -> ping <-> pong` that exceeds `maxIterations: 3` and ends in status `error`
 * (S21). `onEntry` runs on each entry of `active`.
 */
const counterMachine = (id: string, onEntry: () => void = () => undefined) =>
  createMachine<Counter, CounterEvent>({
    id,
    initial: "active",
    context: { count: 0 },
    options: { maxIterations: 3 },
    states: {
      active: {
        entry: () => {
          onEntry()
        },
        on: {
          increment: { actions: assign<Counter, CounterEvent>(({ context }) => ({ count: context.count + 1 })) },
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

/**
 * Waits until the actor's snapshot is no longer active, or until 25 snapshots went by, so a
 * wrong engine stops waiting here instead of hanging.
 */
const leftActive = <S extends SnapshotType, E>(actor: { readonly changes: Stream.Stream<S, E> }) =>
  actor.changes.pipe(
    Stream.take(25),
    Stream.filter((snapshot) => snapshot.status !== "active"),
    Stream.runHead,
    // An actor that errors fails its `changes` stream with the error (SD-4): it left active too
    Effect.exit
  )

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

/** Whether the fiber has ended with a success. */
const succeeded = (fiber: Fiber.Fiber<unknown, unknown>): boolean => {
  const exit = fiber.pollUnsafe()
  return exit !== undefined && Exit.isSuccess(exit)
}

/**
 * Forks one fiber per send, lets the runtime run once (one `yieldNow`, so every forked fiber
 * gets its first turn), and counts the sends that finished successfully in that turn.
 */
const sendsFinishedWithinOneYield = (send: Effect.Effect<void>, count: number) =>
  Effect.gen(function* () {
    const fibers = yield* Effect.forEach(Array.from({ length: count }), () => Effect.forkChild(send))
    yield* Effect.yieldNow
    return fibers.filter(succeeded).length
  })

describe("C14 A send to a stopped, done or errored actor is ignored with a warning", () => {
  it.effect("[C14] 1,500 sends to a stopped actor each finish within one yield and each logs the upstream warning", () =>
    Effect.gen(function* () {
      const { result, warnings } = yield* withWarningsCaptured(
        Effect.gen(function* () {
          const actor = yield* createActor(counterMachine("c14-stopped"), { id: "c14-stopped" })
          yield* actor.start
          yield* actor.stop
          const finished = yield* sendsFinishedWithinOneYield(actor.send({ type: "increment" }), SENDS)
          return { finished, sessionId: actor.sessionId, snapshot: yield* actor.getSnapshot }
        })
      )

      const expected = eventSentToStoppedActor({ type: "increment" }, "c14-stopped", result.sessionId)
      assert.strictEqual(result.finished, SENDS)
      assert.strictEqual(warnings.length, SENDS)
      assert.isTrue(warnings.every((warning) => warning === expected))
      assert.strictEqual(result.snapshot.status, "stopped")
      assert.strictEqual(result.snapshot.context.count, 0)
    })
  )

  it.effect("[C14] 1,500 sends to a done actor each finish within one yield and each logs the upstream warning", () =>
    Effect.gen(function* () {
      const { result, warnings } = yield* withWarningsCaptured(
        Effect.gen(function* () {
          const actor = yield* createActor(counterMachine("c14-done"), { id: "c14-done" })
          yield* actor.start
          yield* actor.send({ type: "finish" })
          yield* leftActive(actor)
          const finished = yield* sendsFinishedWithinOneYield(actor.send({ type: "increment" }), SENDS)
          return { finished, sessionId: actor.sessionId, snapshot: yield* actor.getSnapshot }
        })
      )

      const expected = eventSentToStoppedActor({ type: "increment" }, "c14-done", result.sessionId)
      assert.strictEqual(result.snapshot.status, "done")
      assert.strictEqual(result.finished, SENDS)
      assert.strictEqual(warnings.length, SENDS)
      assert.isTrue(warnings.every((warning) => warning === expected))
    })
  )

  it.effect("[C14] 1,500 sends to an errored actor each finish within one yield and each logs the upstream warning", () =>
    Effect.gen(function* () {
      const { result, warnings } = yield* withWarningsCaptured(
        Effect.gen(function* () {
          const actor = yield* createActor(counterMachine("c14-error"), { id: "c14-error" })
          yield* actor.start
          yield* actor.send({ type: "PING" })
          yield* leftActive(actor)
          const finished = yield* sendsFinishedWithinOneYield(actor.send({ type: "increment" }), SENDS)
          return { finished, sessionId: actor.sessionId, snapshot: yield* actor.getSnapshot }
        })
      )

      const expected = eventSentToStoppedActor({ type: "increment" }, "c14-error", result.sessionId)
      assert.strictEqual(result.snapshot.status, "error")
      assert.strictEqual(result.finished, SENDS)
      assert.strictEqual(warnings.length, SENDS)
      assert.isTrue(warnings.every((warning) => warning === expected))
    })
  )

  it.effect("[C14] start on a stopped, done or errored actor runs no entry action, keeps the status, and a send still drops with the warning", () =>
    Effect.gen(function* () {
      let entries = 0
      const { result, warnings } = yield* withWarningsCaptured(
        Effect.gen(function* () {
          const stopped = yield* createActor(counterMachine("c14-restart", () => entries++), { id: "stopped" })
          const done = yield* createActor(counterMachine("c14-restart", () => entries++), { id: "done" })
          const errored = yield* createActor(counterMachine("c14-restart", () => entries++), { id: "errored" })
          yield* stopped.start
          yield* done.start
          yield* errored.start
          yield* stopped.stop
          yield* done.send({ type: "finish" })
          yield* leftActive(done)
          yield* errored.send({ type: "PING" })
          yield* leftActive(errored)
          const entriesBefore = entries

          const outcomes: Array<{ readonly id: string; readonly sessionId: string; readonly status: string; readonly count: number }> = []
          for (const actor of [stopped, done, errored]) {
            yield* actor.start
            yield* actor.send({ type: "increment" })
            yield* settle
            const snapshot = yield* actor.getSnapshot
            outcomes.push({ id: actor.id, sessionId: actor.sessionId, status: snapshot.status, count: snapshot.context.count })
          }
          return { entriesBefore, outcomes }
        })
      )

      assert.strictEqual(result.entriesBefore, 3)
      assert.strictEqual(entries, 3)
      assert.deepStrictEqual(
        result.outcomes.map(({ count, id, status }) => ({ id, status, count })),
        [
          { id: "stopped", status: "stopped", count: 0 },
          { id: "done", status: "done", count: 0 },
          { id: "errored", status: "error", count: 0 },
        ]
      )
      assert.deepStrictEqual(
        warnings,
        result.outcomes.map(({ id, sessionId }) => eventSentToStoppedActor({ type: "increment" }, id, sessionId))
      )
    })
  )

  it.effect("[C14] stop ends the processing fiber, runs the actor's scope finalizers once, sets status stopped and cancels its scheduled events", () =>
    Effect.gen(function* () {
      let finalized = 0
      const captured: { fiber: Option.Option<Fiber.Fiber<unknown, unknown>> } = { fiber: Option.none() }
      type ArmEvent = { readonly type: "arm" } | { readonly type: "tick" }
      const machine = createMachine<Counter, ArmEvent>({
        id: "c14-stop",
        initial: "idle",
        context: { count: 0 },
        states: {
          idle: {
            on: {
              arm: {
                target: "armed",
                actions: [
                  // An inline action runs in the actor's processing fiber, inside its scope
                  () =>
                    Effect.map(Effect.fiber, (fiber) => {
                      captured.fiber = Option.some(fiber)
                    }),
                  () =>
                    Effect.addFinalizer(() =>
                      Effect.sync(() => {
                        finalized++
                      })
                    ),
                  raise<Counter, ArmEvent>({ type: "tick" }, { delay: 1000 }),
                ],
              },
            },
          },
          armed: {
            on: { tick: { actions: assign<Counter, ArmEvent>(({ context }) => ({ count: context.count + 1 })) } },
          },
        },
      })

      const { result, warnings } = yield* withWarningsCaptured(
        Effect.gen(function* () {
          const actor = yield* createActor(machine, { id: "c14-stop" })
          yield* actor.start
          yield* actor.send({ type: "arm" })
          yield* settle
          const fiberBeforeStop = Option.map(captured.fiber, (fiber) => fiber.pollUnsafe() === undefined)
          const finalizedBeforeStop = finalized

          yield* actor.stop
          const fiberAfterStop = Option.map(captured.fiber, (fiber) => fiber.pollUnsafe() !== undefined)
          const finalizedAfterStop = finalized
          const stopped = yield* actor.getSnapshot

          // A timer that is still pending would deliver `tick` now
          yield* TestClock.adjust(5000)
          yield* settle
          return { fiberBeforeStop, fiberAfterStop, finalizedBeforeStop, finalizedAfterStop, stopped, last: yield* actor.getSnapshot }
        })
      )

      assert.deepStrictEqual(result.fiberBeforeStop, Option.some(true))
      assert.deepStrictEqual(result.fiberAfterStop, Option.some(true))
      assert.strictEqual(result.finalizedBeforeStop, 0)
      assert.strictEqual(result.finalizedAfterStop, 1)
      assert.strictEqual(result.stopped.status, "stopped")
      assert.strictEqual(result.last.status, "stopped")
      assert.strictEqual(result.last.context.count, 0)
      assert.deepStrictEqual(warnings, [])
      assert.strictEqual(finalized, 1)
    })
  )

  it.effect("[C14] stopping a root actor leaves no timer of its system pending, also one that a child in that system scheduled (RES-02)", () =>
    Effect.gen(function* () {
      type ArmEvent = { readonly type: "arm" } | { readonly type: "tick" }
      const childMachine = createMachine<Counter, ArmEvent>({
        id: "c14-child",
        initial: "idle",
        context: { count: 0 },
        states: {
          idle: {
            on: {
              arm: { actions: raise<Counter, ArmEvent>({ type: "tick" }, { delay: 1000 }) },
              tick: { actions: assign<Counter, ArmEvent>(({ context }) => ({ count: context.count + 1 })) },
            },
          },
        },
      })

      const { result, warnings } = yield* withWarningsCaptured(
        Effect.gen(function* () {
          const root = yield* createActor(counterMachine("c14-root"), { id: "root" })
          const child = yield* createActor(childMachine, { id: "child", parent: root })
          yield* root.start
          yield* child.start
          yield* child.send({ type: "arm" })
          yield* settle
          const pending = Effect.map(root.system.getSnapshot, ({ _scheduledEvents }) =>
            Object.values(_scheduledEvents).map(({ event, source }) => `${source.id}:${event.type}`)
          )
          const pendingBeforeStop = yield* pending

          yield* root.stop
          const pendingAfterStop = yield* pending
          // The child's timer was forked into the stopped root's system: a timer still pending
          // would deliver `tick` now, and a delivery to the stopped child would warn (C14)
          yield* TestClock.adjust(5000)
          yield* settle

          return { pendingAfterStop, pendingBeforeStop, childSnapshot: yield* child.getSnapshot }
        })
      )

      assert.deepStrictEqual(result.pendingBeforeStop, ["child:tick"])
      assert.deepStrictEqual(result.pendingAfterStop, [])
      assert.deepStrictEqual(warnings, [])
      assert.strictEqual(result.childSnapshot.context.count, 0)
    })
  )

  it.effect("[C14] stop twice closes the actor's scope once: the cleanup runs once, and closing the caller's scope afterwards runs it no more", () =>
    Effect.gen(function* () {
      let cleanups = 0
      const scope = yield* Scope.make()
      const actor = yield* createActor(
        fromCallback(() => () => {
          cleanups++
        }),
        { id: "c14-callback" }
      ).pipe(Scope.provide(scope))
      yield* actor.start
      assert.strictEqual(cleanups, 0)

      yield* actor.stop
      const afterFirstStop = cleanups
      yield* actor.stop
      const afterSecondStop = cleanups
      yield* Scope.close(scope, Exit.void)

      assert.strictEqual(afterFirstStop, 1)
      assert.strictEqual(afterSecondStop, 1)
      assert.strictEqual(cleanups, 1)
      assert.strictEqual((yield* actor.getSnapshot).status, "stopped")
    })
  )

  it.effect("[C14] stop before start runs no entry action, keeps the snapshot as upstream does, and the actor never starts", () =>
    Effect.gen(function* () {
      let entries = 0
      const { result, warnings } = yield* withWarningsCaptured(
        Effect.gen(function* () {
          const actor = yield* createActor(counterMachine("c14-unstarted", () => entries++), { id: "c14-unstarted" })
          yield* actor.send({ type: "increment" })
          yield* actor.stop
          const afterStop = yield* actor.getSnapshot
          yield* actor.start
          yield* actor.send({ type: "increment" })
          yield* settle
          return { afterStop, last: yield* actor.getSnapshot, sessionId: actor.sessionId }
        })
      )

      assert.strictEqual(entries, 0)
      // Upstream `_stop` marks a not-started actor stopped and leaves its snapshot
      assert.strictEqual(result.afterStop.status, "active")
      assert.strictEqual(result.last.status, "active")
      assert.strictEqual(result.last.context.count, 0)
      assert.deepStrictEqual(warnings, [eventSentToStoppedActor({ type: "increment" }, "c14-unstarted", result.sessionId)])
    })
  )
})
