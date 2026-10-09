/**
 * CONC-3: a send made from inside the actor's own callbacks never deadlocks.
 *
 * T2.43. Upstream processes a send made from a subscribe callback, an `actor.on` listener,
 * an inspection observer or a custom action of the same actor by queueing it in the mailbox
 * that is being processed (`Mailbox.enqueue` while `_active`), so it runs in a later
 * macrostep and the call returns at once. The inspection observer here reacts to the
 * `@xstate.microstep` of `go`, which the macrostep sends; the `@xstate.event` of `go` is sent
 * by the `send` call, before the event reaches the mailbox (upstream `_relay`, T6.8), so a send
 * that reacts to it queues its event before `go`. The port keeps that (SD-23): a send made while
 * the caller runs inside the actor's processing or its callbacks enqueues without waiting
 * for its macrostep, so neither the sender nor the actor suspends. The same holds for `stop`
 * from inside a subscriber: it returns at once, the macrostep in progress commits, the
 * events still queued are dropped, and the actor ends `stopped` (upstream `_stop` clears the
 * mailbox and queues `xstate.stop`).
 *
 * Every wait is a Deferred handshake or a bounded number of yields; no test sleeps.
 * Ordering is asserted directly (@ASSUMPTION:AS2.a).
 */
import { assert, describe, it } from "@effect/vitest"
import { Deferred, Effect, Exit, Fiber, Stream } from "effect"
import { assign, createActor, createMachine, emit, type SnapshotType } from "../../src/index.js"

interface Seen {
  readonly seen: ReadonlyArray<string>
}

type ChainEvent =
  | { readonly type: "go" }
  | { readonly type: "fromInspector" }
  | { readonly type: "fromAction" }
  | { readonly type: "fromListener" }
  | { readonly type: "fromSubscriber" }

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

/** Runs `effect` in a new fiber, lets the runtime run once, and records whether it finished successfully. */
const withinOneYield = (label: string, effect: Effect.Effect<void>, returned: Array<string>) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(effect)
    yield* Effect.yieldNow
    returned.push(`${label}:${succeeded(fiber) ? "returned" : "waiting"}`)
  })

/**
 * Waits until the actor publishes a snapshot that satisfies `predicate`, or until 25
 * snapshots went by, so a wrong engine stops waiting here instead of hanging.
 */
const reachWithin = <S extends SnapshotType, E>(actor: { readonly changes: Stream.Stream<S, E> }, predicate: (snapshot: S) => boolean) =>
  actor.changes.pipe(Stream.take(25), Stream.filter(predicate), Stream.runHead)

/** The `send` of the actor, which exists only after the machine is created. */
interface Self {
  send: (event: ChainEvent) => Effect.Effect<void>
}

describe("CONC-3 A send made from inside the actor's own callbacks never deadlocks", () => {
  it.effect("[CONC-3] a subscribe callback, an actor.on listener, a system.inspect function and an inline Effect action each send to the same actor; each event runs in a later macrostep in send order and no sender suspends", () =>
    Effect.gen(function* () {
      const returned: Array<string> = []
      const self: Self = { send: () => Effect.void }
      const record = assign<Seen, ChainEvent>(({ context, event }) => ({ seen: [...context.seen, event.type] }))
      const machine = createMachine<Seen, ChainEvent>({
        id: "conc3-chain",
        initial: "active",
        context: { seen: [] },
        states: {
          active: {
            on: {
              go: {
                actions: [
                  record,
                  () => withinOneYield("action", self.send({ type: "fromAction" }), returned),
                  emit<Seen, ChainEvent>({ type: "emitted" }),
                ],
              },
              fromInspector: { actions: record },
              fromAction: { actions: record },
              fromListener: { actions: record },
              fromSubscriber: { actions: record },
            },
          },
        },
      })
      const actor = yield* createActor(machine)
      self.send = actor.send
      // The macrostep that records `n` events published the snapshot `seenAt[n - 1]` saw
      const seenAt: Array<ReadonlyArray<string>> = []

      yield* actor.system.inspect((inspectionEvent) =>
        inspectionEvent.type === "@xstate.microstep" && inspectionEvent.event.type === "go"
          ? withinOneYield("inspector", actor.send({ type: "fromInspector" }), returned)
          : Effect.void
      )
      yield* actor.on("emitted", () => withinOneYield("listener", actor.send({ type: "fromListener" }), returned))
      yield* actor.start
      yield* actor.subscribe((snapshot) =>
        Effect.gen(function* () {
          seenAt.push(snapshot.context.seen)
          if (snapshot.context.seen.length === 1 && snapshot.context.seen[0] === "go") {
            yield* withinOneYield("subscriber", actor.send({ type: "fromSubscriber" }), returned)
          }
        })
      )

      yield* actor.send({ type: "go" })
      const last = yield* reachWithin(actor, (snapshot) => snapshot.context.seen.length >= 5)
      yield* settle

      assert.isTrue(last._tag === "Some")
      const final = yield* actor.getSnapshot
      // The action list runs in order, then the macrostep's `@xstate.microstep` is inspected,
      // then the listener hears the emit and the subscriber sees `go`, after the commit
      assert.deepStrictEqual(final.context.seen, ["go", "fromAction", "fromInspector", "fromListener", "fromSubscriber"])
      // One macrostep per event, each a later one than the macrostep that sent it
      assert.deepStrictEqual(
        seenAt.map((seen) => seen.length),
        [1, 2, 3, 4, 5]
      )
      // Every re-entrant send had returned before the chain's last macrostep committed
      assert.sameMembers(returned, ["inspector:returned", "action:returned", "listener:returned", "subscriber:returned"])
    })
  )

  it.effect("[CONC-3] stop from inside a subscriber returns at once; the macrostep in progress commits, the queued event is dropped and the actor ends stopped", () =>
    Effect.gen(function* () {
      type StepEvent = { readonly type: "first" } | { readonly type: "second" } | { readonly type: "third" }
      interface Steps {
        readonly steps: ReadonlyArray<string>
      }
      const enteredSecond = yield* Deferred.make<void>()
      const releaseSecond = yield* Deferred.make<void>()
      const stopReturned = yield* Deferred.make<void>()
      const record = assign<Steps, StepEvent>(({ context, event }) => ({ steps: [...context.steps, event.type] }))
      const machine = createMachine<Steps, StepEvent>({
        id: "conc3-stop",
        initial: "active",
        context: { steps: [] },
        states: {
          active: {
            on: {
              first: { actions: record },
              second: {
                actions: [() => Effect.andThen(Deferred.succeed(enteredSecond, undefined), Deferred.await(releaseSecond)), record],
              },
              third: { actions: record },
            },
          },
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      yield* actor.subscribe((snapshot) =>
        snapshot.context.steps.length === 1
          ? Effect.gen(function* () {
              // Stop while `second` is in progress and `third` is queued
              yield* Deferred.await(enteredSecond)
              yield* actor.stop
              yield* Deferred.succeed(stopReturned, undefined)
            })
          : Effect.void
      )

      const sends = yield* Effect.forEach(["first", "second", "third"] as const, (type) => Effect.forkChild(actor.send({ type })))
      yield* Deferred.await(enteredSecond)
      yield* settle
      const returnedWhileSecondInProgress = yield* Deferred.isDone(stopReturned)

      yield* Deferred.succeed(releaseSecond, undefined)
      const exits = yield* Effect.forEach(sends, (fiber) => Fiber.await(fiber))
      const final = yield* actor.getSnapshot

      assert.isTrue(returnedWhileSecondInProgress)
      assert.isTrue(exits.every(Exit.isSuccess))
      assert.strictEqual(final.status, "stopped")
      assert.deepStrictEqual(final.context.steps, ["first", "second"])
    })
  )

  it.effect("[CONC-3] stop from inside a subscriber while the actor waits for events returns at once, and the actor ends stopped", () =>
    Effect.gen(function* () {
      type StepEvent = { readonly type: "first" } | { readonly type: "second" }
      interface Steps {
        readonly steps: ReadonlyArray<string>
      }
      const returned: Array<string> = []
      const record = assign<Steps, StepEvent>(({ context, event }) => ({ steps: [...context.steps, event.type] }))
      const machine = createMachine<Steps, StepEvent>({
        id: "conc3-idle-stop",
        initial: "active",
        context: { steps: [] },
        states: { active: { on: { first: { actions: record }, second: { actions: record } } } },
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      yield* actor.subscribe((snapshot) =>
        snapshot.status === "active" && snapshot.context.steps.length === 1
          ? withinOneYield("stop", actor.stop, returned)
          : Effect.void
      )

      yield* actor.send({ type: "first" })
      yield* settle
      const afterStop = yield* actor.getSnapshot
      yield* actor.send({ type: "second" })

      assert.deepStrictEqual(returned, ["stop:returned"])
      assert.strictEqual(afterStop.status, "stopped")
      assert.deepStrictEqual((yield* actor.getSnapshot).context.steps, ["first"])
    })
  )

  it.effect("[CONC-3] stop from an inline Effect action of the actor returns at once; that macrostep commits and the actor ends stopped", () =>
    Effect.gen(function* () {
      type StepEvent = { readonly type: "halt" } | { readonly type: "after" }
      interface Steps {
        readonly steps: ReadonlyArray<string>
      }
      const returned: Array<string> = []
      const self: { stop: Effect.Effect<void>; getSnapshot: Effect.Effect<Steps> } = {
        stop: Effect.void,
        getSnapshot: Effect.succeed({ steps: [] }),
      }
      const record = assign<Steps, StepEvent>(({ context, event }) => ({ steps: [...context.steps, event.type] }))
      const machine = createMachine<Steps, StepEvent>({
        id: "conc3-action-stop",
        initial: "active",
        context: { steps: [] },
        states: {
          active: {
            on: {
              halt: {
                actions: [
                  () => withinOneYield("stop", self.stop, returned),
                  // A custom action after the stop still runs in list order, inside the
                  // macrostep, so it reads the snapshot from before the commit (upstream)
                  () =>
                    Effect.map(self.getSnapshot, (snapshot) => {
                      returned.push(`after stop saw ${snapshot.steps.length}`)
                    }),
                  record,
                ],
              },
              after: { actions: record },
            },
          },
        },
      })
      const actor = yield* createActor(machine)
      self.stop = actor.stop
      self.getSnapshot = Effect.map(actor.getSnapshot, (snapshot) => snapshot.context)
      yield* actor.start

      const halted = yield* Effect.exit(actor.send({ type: "halt" }))
      const afterHalt = yield* actor.getSnapshot
      yield* actor.send({ type: "after" })

      assert.isTrue(Exit.isSuccess(halted))
      assert.deepStrictEqual(returned, ["stop:returned", "after stop saw 0"])
      assert.strictEqual(afterHalt.status, "stopped")
      // The action list ran to its end: the macrostep that stopped the actor committed
      assert.deepStrictEqual(afterHalt.context.steps, ["halt"])
      assert.deepStrictEqual((yield* actor.getSnapshot).context.steps, ["halt"])
    })
  )
})
