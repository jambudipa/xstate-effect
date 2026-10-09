/**
 * C16: subscriptions end on completion and fail on error.
 *
 * T5.8. Upstream `src/createActor.ts` at xstate@5.33.2: `update` calls each observer's `next`
 * with an active or done snapshot; on done it then runs `_stopProcedure` and `_complete` (every
 * observer's `complete`, then the observers are dropped); `_error` hands the error to each
 * error listener; `stop` of a running actor queues `xstate.stop`, which `_process` gives to the
 * logic's `transition` like any event, then `update`, `_stopProcedure` and `_complete`. The
 * machine's `macrostep` answers `xstate.stop` with `stopChildren` (each child stopped and
 * removed from `children`) and status `stopped`; promise, callback and observable logic set
 * status `stopped`; transition logic hands the event to the reducer and keeps its status. A tsx
 * probe of 5.33.2 (`packages/core/.upstream/measure/t58/probe-up.ts`) gives: a stopped machine's
 * observers get no `next` and one `complete`, after the child's cleanup, and its snapshot has
 * no children; a transition actor's reducer sees `xstate.stop`, its observers get `next` with
 * the active result, then `complete`; a spawned transition child of a stopped machine stays
 * `active` and is completed; an observer of a done actor gets the done snapshot, then
 * `complete`; one added after done gets `complete`, one added after an error gets the error.
 *
 * Effect form (D6): the `changes` stream stands for an observer with an error listener: its
 * values are `next`, its end is `complete`, its failure is `error` (SD-4). It gives the current
 * snapshot first (SD-24), so a stream run after the actor ended gives the final snapshot, then
 * ends, or fails with the actor's error. Port choice, from the task: a plain stop ends the
 * streams too, also the stop of an actor that never started (upstream completes no observer
 * there, and a later subscriber gets nothing; a stream that never ends would hang its reader).
 * `snapshotStream.stream` is `changes`, and `snapshotStream.changes` drops its first value.
 * Closing the scope that owns a running actor (D12, SD-8) has no upstream counterpart (an
 * upstream actor that nobody stops is never stopped): it releases the actor with status
 * `stopped` and ends its streams, and its logic never takes `xstate.stop`.
 */
import { assert, describe, it } from "@effect/vitest"
import { Cause, Deferred, Effect, Exit, Fiber, Logger, Option, Scope, Stream } from "effect"
import type { ActorRefBase } from "../../src/ActorRef.js"
import {
  assign,
  createActor,
  createMachine,
  fromCallback,
  fromPromise,
  fromTransition,
  isActor,
  type SnapshotType,
  spawnChild,
} from "../../src/index.js"

/** Lets every other ready fiber take a hundred turns. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 100; turn++) {
    yield* Effect.yieldNow
  }
})

/**
 * Runs `stream` in a fiber that collects its values, and returns once the stream has given its
 * first value or ended, so the stream reads the actor before the caller goes on.
 */
const collecting = <A, E>(stream: Stream.Stream<A, E>) =>
  Effect.gen(function* () {
    const first = yield* Deferred.make<void>()
    const fiber = yield* Stream.runCollect(Stream.tap(stream, () => Deferred.succeed(first, undefined))).pipe(Effect.forkChild)
    yield* Effect.raceFirst(Deferred.await(first), Effect.asVoid(Fiber.await(fiber)))
    return fiber
  })

/** `Some` of the fiber's exit when it ends while the other fibers take turns, `None` while it still runs. */
const endedWithin = <A, E>(fiber: Fiber.Fiber<A, E>) =>
  Effect.raceFirst(Effect.map(Fiber.await(fiber), Option.some), Effect.as(settle, Option.none<Exit.Exit<A, E>>()))

/** The values of a stream that ended (`Some`), `None` when it is still running or it failed. */
const valuesOf = <A, E>(ended: Option.Option<Exit.Exit<ReadonlyArray<A>, E>>): Option.Option<ReadonlyArray<A>> =>
  Option.flatMap(ended, (exit) => (Exit.isSuccess(exit) ? Option.some(exit.value) : Option.none()))

/** The error a stream failed with (`Some`), `None` when it is still running or it ended. */
const failureOf = <A, E>(ended: Option.Option<Exit.Exit<A, E>>): Option.Option<unknown> =>
  Option.flatMap(ended, (exit) => (Exit.isFailure(exit) ? Option.some(Cause.squash(exit.cause)) : Option.none()))

/** Runs `program` with a logger that keeps every message, with its level. */
const withLogsCaptured = <A, E, R>(program: Effect.Effect<A, E, R>) => {
  const logs: Array<string> = []
  return program.pipe(
    Effect.provide(
      Logger.layer([
        Logger.make((options) => {
          const parts: ReadonlyArray<unknown> = Array.isArray(options.message) ? options.message : [options.message]
          logs.push(`${options.logLevel}: ${parts.map(String).join(" ")}`)
        }),
      ])
    ),
    Effect.map((result) => ({ result, logs }))
  )
}

/** The status and the state value of a machine snapshot, for compact comparisons. */
const statusAndValue = (snapshot: SnapshotType & { readonly value: unknown }) => `${snapshot.status}:${String(snapshot.value)}`

/** The `changes` stream of a child reference (every child of this file is an actor of this module). */
const changesOf = (ref: ActorRefBase | undefined) => {
  if (ref === undefined || !isActor(ref)) {
    return assert.fail("the child is an actor")
  }
  return ref.changes
}

type FlowEvent = { readonly type: "NEXT" } | { readonly type: "FINISH" } | { readonly type: "BOOM" }

/** a --NEXT--> b --FINISH--> done (final); BOOM throws from a transition action. */
const flowMachine = (boom: Error) =>
  createMachine<object, FlowEvent>({
    id: "c16-flow",
    initial: "a",
    context: {},
    states: {
      a: { on: { NEXT: "b" } },
      b: {
        on: {
          FINISH: "done",
          BOOM: {
            actions: () => {
              throw boom
            },
          },
        },
      },
      done: { type: "final" },
    },
  })

describe("C16 Subscriptions end on completion and fail on error", () => {
  it.effect("[C16] a changes stream gives each snapshot, the done snapshot last, then ends when the actor reaches a final state", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(flowMachine(new Error("unused")))
      yield* actor.start
      const running = yield* collecting(actor.changes)

      yield* actor.send({ type: "NEXT" })
      yield* actor.send({ type: "FINISH" })

      const values = valuesOf(yield* endedWithin(running))
      assert.deepStrictEqual(Option.map(values, (snapshots) => snapshots.map(statusAndValue)), Option.some(["active:a", "active:b", "done:done"]))

      // A stream run after done gives the done snapshot, then ends (D6: the end is `complete`)
      const late = valuesOf(yield* endedWithin(yield* collecting(actor.changes)))
      assert.deepStrictEqual(Option.map(late, (snapshots) => snapshots.map(statusAndValue)), Option.some(["done:done"]))
    }))

  it.effect("[C16] stopping a running machine ends its changes streams after the stopped snapshot, which has no children, and after the children's cleanup", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const worker = fromCallback(() => () => {
        log.push("worker cleanup")
      })
      const counter = fromTransition((count: number) => count, 0)
      const machine = createMachine<object, FlowEvent>({
        id: "c16-stop",
        initial: "a",
        context: {},
        invoke: { id: "worker", src: worker },
        entry: spawnChild(counter, { id: "counter" }),
        states: { a: { on: { NEXT: "b" } }, b: {} },
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      const children = (yield* actor.getSnapshot).children
      assert.deepStrictEqual(Object.keys(children).sort(), ["counter", "worker"])
      const observed: Array<string> = []
      yield* actor.subscribe((snapshot) => Effect.sync(() => observed.push(statusAndValue(snapshot))))

      const running = yield* collecting(
        actor.changes.pipe(Stream.ensuring(Effect.sync(() => log.push("parent stream end"))))
      )
      const workerStream = yield* collecting(changesOf(children["worker"]))
      const counterStream = yield* collecting(changesOf(children["counter"]))

      yield* actor.send({ type: "NEXT" })
      yield* actor.stop

      const values = valuesOf(yield* endedWithin(running))
      assert.deepStrictEqual(Option.map(values, (snapshots) => snapshots.map(statusAndValue)), Option.some(["active:a", "active:b", "stopped:b"]))
      const last = Option.flatMap(values, (snapshots) => Option.fromNullishOr(snapshots[snapshots.length - 1]))
      assert.deepStrictEqual(Option.map(last, (snapshot) => Object.keys(snapshot.children)), Option.some([]))

      const stopped = yield* actor.getSnapshot
      assert.strictEqual(stopped.status, "stopped")
      assert.deepStrictEqual(Object.keys(stopped.children), [])
      // Upstream: the child's cleanup runs before the parent's observers complete
      assert.deepStrictEqual(log, ["worker cleanup", "parent stream end"])
      // The `subscribe` observers get the snapshot of NEXT, not the stopped one
      assert.deepStrictEqual(observed, ["active:b"])

      // Each child's stream ends too: a callback child is `stopped`, a transition child keeps
      // its status `active` (upstream: the reducer takes `xstate.stop`)
      const workerValues = valuesOf(yield* endedWithin(workerStream))
      assert.deepStrictEqual(Option.map(workerValues, (snapshots) => snapshots.map((snapshot) => snapshot.status)), Option.some(["active", "stopped"]))
      const counterValues = valuesOf(yield* endedWithin(counterStream))
      assert.deepStrictEqual(Option.map(counterValues, (snapshots) => snapshots.map((snapshot) => snapshot.status)), Option.some(["active", "active"]))
    }))

  it.effect("[C16] stopping a transition actor hands xstate.stop to its reducer, keeps the status active, and ends its streams after that snapshot", () =>
    Effect.gen(function* () {
      const seen: Array<string> = []
      const logic = fromTransition((count: number, event: { readonly type: string }) => {
        seen.push(event.type)
        return count + 1
      }, 0)
      const actor = yield* createActor(logic)
      yield* actor.start
      const observed: Array<number> = []
      yield* actor.subscribe((snapshot) => Effect.sync(() => observed.push(snapshot.context)))
      const running = yield* collecting(actor.changes)

      yield* actor.send({ type: "INC" })
      yield* actor.stop

      const values = valuesOf(yield* endedWithin(running))
      assert.deepStrictEqual(
        Option.map(values, (snapshots) => snapshots.map((snapshot) => `${snapshot.status}:${snapshot.context}`)),
        Option.some(["active:0", "active:1", "active:2"])
      )
      assert.deepStrictEqual(seen, ["INC", "xstate.stop"])
      const after = yield* actor.getSnapshot
      assert.strictEqual(after.status, "active")
      assert.strictEqual(after.context, 2)
      // Upstream `update` calls `next` with the active snapshot of the stop event
      assert.deepStrictEqual(observed, [1, 2])

      // A later send is dropped with the stopped-actor warning; the reducer never sees it
      const { logs } = yield* withLogsCaptured(actor.send({ type: "LATE" }))
      assert.deepStrictEqual(seen, ["INC", "xstate.stop"])
      assert.strictEqual(logs.length, 1)
      assert.include(logs[0] ?? "", 'Event "LATE" was sent to stopped actor')

      // A stream run after the stop gives the final snapshot, then ends
      const late = valuesOf(yield* endedWithin(yield* collecting(actor.changes)))
      assert.deepStrictEqual(Option.map(late, (snapshots) => snapshots.map((snapshot) => snapshot.context)), Option.some([2]))
    }))

  it.effect("[C16] stopping a promise actor or a callback actor gives status stopped and ends its changes stream after that snapshot", () =>
    Effect.gen(function* () {
      const promiseActor = yield* createActor(fromPromise(() => new Promise<number>(() => {})))
      const callbackActor = yield* createActor(fromCallback(() => {}))
      yield* promiseActor.start
      yield* callbackActor.start
      const promiseStream = yield* collecting(promiseActor.changes)
      const callbackStream = yield* collecting(callbackActor.changes)

      yield* promiseActor.stop
      yield* callbackActor.stop

      const statuses = (ended: Option.Option<ReadonlyArray<SnapshotType>>) =>
        Option.map(ended, (snapshots) => snapshots.map((snapshot) => snapshot.status))
      assert.deepStrictEqual(statuses(valuesOf(yield* endedWithin(promiseStream))), Option.some(["active", "stopped"]))
      assert.deepStrictEqual(statuses(valuesOf(yield* endedWithin(callbackStream))), Option.some(["active", "stopped"]))
    }))

  it.effect("[C16] stopping an actor that never started ends a running changes stream without a new snapshot, and a later stream gives the snapshot, then ends", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(flowMachine(new Error("unused")))
      const running = yield* collecting(actor.changes)

      yield* actor.stop

      const values = valuesOf(yield* endedWithin(running))
      assert.deepStrictEqual(Option.map(values, (snapshots) => snapshots.map(statusAndValue)), Option.some(["active:a"]))
      // Upstream keeps the snapshot of an actor that never started
      assert.strictEqual((yield* actor.getSnapshot).status, "active")
      const late = valuesOf(yield* endedWithin(yield* collecting(actor.changes)))
      assert.deepStrictEqual(Option.map(late, (snapshots) => snapshots.map(statusAndValue)), Option.some(["active:a"]))
    }))

  it.effect("[C16] a changes stream run after a plain stop gives the stopped snapshot, then ends", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(flowMachine(new Error("unused")))
      yield* actor.start
      yield* actor.send({ type: "NEXT" })
      yield* actor.stop

      const late = valuesOf(yield* endedWithin(yield* collecting(actor.changes)))
      assert.deepStrictEqual(Option.map(late, (snapshots) => snapshots.map(statusAndValue)), Option.some(["stopped:b"]))
    }))

  it.effect("[C16] a changes stream fails with the actor's original error, and a stream run after the error fails with the same error", () =>
    Effect.gen(function* () {
      const boom = new Error("c16 boom")
      const { result } = yield* withLogsCaptured(
        Effect.gen(function* () {
          const actor = yield* createActor(flowMachine(boom))
          yield* actor.start
          const running = yield* collecting(actor.changes)
          yield* actor.send({ type: "NEXT" })
          yield* actor.send({ type: "BOOM" })
          const runningEnd = yield* endedWithin(running)
          const lateEnd = yield* endedWithin(yield* collecting(actor.changes))
          return { runningEnd, lateEnd, status: (yield* actor.getSnapshot).status }
        })
      )

      assert.strictEqual(result.status, "error")
      assert.isTrue(Option.exists(failureOf(result.runningEnd), (error) => error === boom), "the running stream fails with the error")
      assert.isTrue(Option.exists(failureOf(result.lateEnd), (error) => error === boom), "a later stream fails with the error")
    }))

  it.effect("[C16] snapshotStream.stream and snapshotStream.changes end on stop and on done, and fail with the actor's error", () =>
    Effect.gen(function* () {
      // Stop
      const stoppedActor = yield* createActor(flowMachine(new Error("unused")))
      yield* stoppedActor.start
      const stream = yield* collecting(stoppedActor.snapshotStream.stream)
      const changes = yield* Effect.forkChild(Stream.runCollect(stoppedActor.snapshotStream.changes))
      yield* settle
      yield* stoppedActor.send({ type: "NEXT" })
      yield* stoppedActor.stop
      assert.deepStrictEqual(
        Option.map(valuesOf(yield* endedWithin(stream)), (snapshots) => snapshots.map(statusAndValue)),
        Option.some(["active:a", "active:b", "stopped:b"])
      )
      assert.deepStrictEqual(
        Option.map(valuesOf(yield* endedWithin(changes)), (snapshots) => snapshots.map(statusAndValue)),
        Option.some(["active:b", "stopped:b"])
      )

      // Done, read after the end: the stream gives the done snapshot, `changes` nothing
      const doneActor = yield* createActor(flowMachine(new Error("unused")))
      yield* doneActor.start
      yield* doneActor.send({ type: "NEXT" })
      yield* doneActor.send({ type: "FINISH" })
      assert.deepStrictEqual(
        Option.map(valuesOf(yield* endedWithin(yield* collecting(doneActor.snapshotStream.stream))), (snapshots) => snapshots.map(statusAndValue)),
        Option.some(["done:done"])
      )
      assert.deepStrictEqual(
        Option.map(valuesOf(yield* endedWithin(yield* Effect.forkChild(Stream.runCollect(doneActor.snapshotStream.changes)))), (snapshots) => snapshots.length),
        Option.some(0)
      )

      // Error
      const boom = new Error("c16 snapshotStream boom")
      const { result } = yield* withLogsCaptured(
        Effect.gen(function* () {
          const actor = yield* createActor(flowMachine(boom))
          yield* actor.start
          const running = yield* collecting(actor.snapshotStream.stream)
          yield* actor.send({ type: "NEXT" })
          yield* actor.send({ type: "BOOM" })
          return yield* endedWithin(running)
        })
      )
      assert.isTrue(Option.exists(failureOf(result), (error) => error === boom), "snapshotStream.stream fails with the error")
    }))

  it.effect("[C16] a changes reader that fails ends only its own stream: the actor goes on, and a subscribe callback that throws is called once per snapshot", () =>
    Effect.gen(function* () {
      const readerError = new Error("c16 reader failure")
      const { result, logs } = yield* withLogsCaptured(
        Effect.gen(function* () {
          const actor = yield* createActor(flowMachine(new Error("unused")))
          yield* actor.start
          let calls = 0
          yield* actor.subscribe(() =>
            Effect.suspend(() => {
              calls++
              return Effect.die(new Error("c16 subscriber throws"))
            })
          )
          const failing = yield* Effect.forkChild(
            actor.changes.pipe(Stream.drop(1), Stream.runForEach(() => Effect.fail(readerError)))
          )
          yield* settle
          const other = yield* collecting(actor.changes)

          yield* actor.send({ type: "NEXT" })
          const failingEnd = yield* endedWithin(failing)
          yield* actor.send({ type: "FINISH" })
          return { failingEnd, otherEnd: yield* endedWithin(other), calls, status: (yield* actor.getSnapshot).status }
        })
      )

      assert.isTrue(Option.exists(failureOf(result.failingEnd), (error) => error === readerError), "the failing reader ends with its own error")
      assert.deepStrictEqual(
        Option.map(valuesOf(result.otherEnd), (snapshots) => snapshots.map(statusAndValue)),
        Option.some(["active:a", "active:b", "done:done"])
      )
      assert.strictEqual(result.status, "done")
      // The throwing subscriber saw NEXT and FINISH once each; each throw is reported (SD-21)
      assert.strictEqual(result.calls, 2)
      assert.strictEqual(logs.filter((line) => line.includes("c16 subscriber throws")).length, 2)
    }))

  it.effect("[C16] a stopped machine's assign-spawned child stays in its context while the snapshot's children are empty (upstream stopChildren)", () =>
    Effect.gen(function* () {
      const counter = fromTransition((count: number) => count, 0)
      const machine = createMachine<{ readonly ref?: ActorRefBase }, FlowEvent>({
        id: "c16-context-ref",
        context: {},
        entry: assign(({ spawn }) => ({ ref: spawn(counter, { id: "kid" }) })),
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      const kid = (yield* actor.getSnapshot).children["kid"]
      assert.isDefined(kid)

      yield* actor.stop

      const stopped = yield* actor.getSnapshot
      assert.deepStrictEqual(Object.keys(stopped.children), [])
      assert.strictEqual(stopped.context.ref, kid)
      assert.strictEqual((yield* kid!.getSnapshotUntyped).status, "active")
    }))

  it.effect("[C16] closing the scope that owns a running actor ends its changes streams after status stopped, and its logic never takes xstate.stop", () =>
    Effect.gen(function* () {
      const seen: Array<string> = []
      const logic = fromTransition((count: number, event: { readonly type: string }) => {
        seen.push(event.type)
        return count + 1
      }, 0)
      const owner = yield* Scope.make()
      const actor = yield* createActor(logic).pipe(Scope.provide(owner))
      yield* actor.start
      const running = yield* collecting(actor.changes)

      yield* actor.send({ type: "INC" })
      yield* Scope.close(owner, Exit.void)

      const values = valuesOf(yield* endedWithin(running))
      assert.deepStrictEqual(
        Option.map(values, (snapshots) => snapshots.map((snapshot) => `${snapshot.status}:${snapshot.context}`)),
        Option.some(["active:0", "active:1", "stopped:1"])
      )
      assert.deepStrictEqual(seen, ["INC"])
    }))
})
