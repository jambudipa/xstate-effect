/**
 * S24: a failing action sets status error with the original error.
 *
 * T2.46, SD-4. Upstream (`createActor.ts` at xstate@5.33.2): a value thrown by user code while
 * a macrostep runs (`_process`) keeps the snapshot the actor had before the event and sets
 * `status: 'error'` with that value as `error`; `_error` then stops the actor and calls the
 * error listener of every observer with the value. The same holds for a throw while the
 * initial snapshot is computed (`_initState`), in `logic.start` (`start`) and in a deferred
 * action (`update`), which also drops the deferred actions after it. Upstream wraps a throwing
 * guard only while it selects a transition for an event (`StateNode.next`, A17); an
 * eventless guard's throw stays the raw value.
 *
 * The port has three forms of failing user code: a throw, a typed failure of an Effect the
 * user code returns (port extension), and a defect of such an Effect. Each one sets status
 * `error` with `snapshot.error = Option.some(<the original value>)` (D8), compared by
 * identity, and fails the actor's `changes` stream with that value (D6: the stream replaces
 * the observer's error listener).
 */
import { assert, describe, it } from "@effect/vitest"
import { Cause, Effect, Exit, Fiber, Option, Stream } from "effect"
import {
  type ActionDefinition,
  assign,
  createActor,
  createMachine,
  type EventObject,
  fromCallback,
  makeActorLogic,
  sendParent,
  Snapshot,
  type SnapshotType,
  spawnChild,
  Types,
} from "../../src/index.js"

/** The three forms of failing user code. */
const forms = ["throw", "typed failure", "defect"] as const
type Form = (typeof forms)[number]

/** A distinct value per case, so that `snapshot.error` is compared by identity. */
const failureValue = (site: string, form: Form) => ({ site, form })

/** An Effect that fails with `value` in `form`: a throw inside it, a typed failure, or a defect. */
const failingEffect = (form: Form, value: unknown): Effect.Effect<never> =>
  form === "throw"
    ? Effect.sync(() => {
        throw value
      })
    : form === "typed failure"
      ? // A typed failure of user code: the action and guard types do not admit one
        (Effect.fail(value) as unknown as Effect.Effect<never>)
      : Effect.die(value)

/** A user function that fails with `value` in `form`: it throws, or returns the failing Effect. */
const failingFunction = (form: Form, value: unknown) =>
  form === "throw"
    ? (): never => {
        throw value
      }
    : () => failingEffect(form, value)

/** Lets every other ready fiber take ten turns. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 10; turn++) {
    yield* Effect.yieldNow
  }
})

/** Runs the actor's `changes` stream in a fiber of the test scope, from now on. */
const watchChanges = <E>(actor: { readonly changes: Stream.Stream<unknown, E> }) =>
  Effect.forkScoped(Stream.runDrain(actor.changes), { startImmediately: true })

/**
 * `Some` of the value the watched `changes` stream failed with, once every other fiber had its
 * turns; `None` when the stream has not failed.
 */
const failureOf = <E>(watcher: Fiber.Fiber<void, E>) =>
  Effect.gen(function* () {
    yield* settle
    const exit = watcher.pollUnsafe()
    return exit !== undefined && Exit.isFailure(exit) ? Option.some<unknown>(Cause.squash(exit.cause)) : Option.none<unknown>()
  })

/** Asserts that the snapshot has status `error` and holds exactly `value` as its error. */
const assertErroredWith = (snapshot: SnapshotType, value: unknown, label: string) => {
  assert.strictEqual(snapshot.status, "error", `${label}: status`)
  assert.strictEqual(Option.getOrUndefined(snapshot.error), value, `${label}: snapshot.error is the original value`)
}

interface Ctx {
  readonly count: number
}

type Ev = { readonly type: "GO" }

/** The places of a machine where user code runs while a transition runs. */
type Site = "entry action" | "exit action" | "transition action" | "eventless guard" | "assigner"

/** A machine that runs user code failing with `value` in `form` at `site` when it takes GO from `a` to `b`. */
const machineFailingIn = (site: Site, form: Form, value: unknown) => {
  const failing = failingFunction(form, value)
  return createMachine<Ctx, Ev>({
    id: "s24",
    initial: "a",
    context: { count: 0 },
    states: {
      a: {
        exit: site === "exit action" ? [failing] : [],
        on: {
          GO: {
            target: "b",
            actions:
              site === "transition action"
                ? [failing]
                : site === "assigner"
                  ? [
                      form === "throw"
                        ? assign<Ctx, Ev>(() => {
                            throw value
                          })
                        : // An assigner may return an Effect (port extension); this one fails
                          assign<Ctx, Ev>(() => failingEffect(form, value) as unknown as Partial<Ctx>),
                    ]
                  : [],
          },
        },
      },
      b: {
        entry: site === "entry action" ? [failing] : [],
        always: site === "eventless guard" ? [{ guard: failing, target: "c" }] : [],
      },
      c: {},
    },
  })
}

/** A port action definition that defers an Effect failing with `value` in `form` until the macrostep commits. */
const deferringFailure = (form: Form, value: unknown): ActionDefinition<Ctx, Ev> => ({
  type: "s24.defer",
  exec: (ctx) => Effect.as(ctx.defer(failingEffect(form, value)), Types.ActionResult.NoOp()),
})

/** A logic whose `start` fails with `value` in `form`. */
const logicFailingAtStart = (form: Form, value: unknown) =>
  makeActorLogic<SnapshotType, EventObject, unknown>({
    transition: (snapshot) => Effect.succeed(snapshot),
    getInitialSnapshot: () => Effect.succeed(Snapshot.active()),
    getPersistedSnapshot: (snapshot) => Effect.succeed(snapshot),
    start: () => failingEffect(form, value),
  })

/** Sends GO to a started actor of `machine` and checks the error and the `changes` failure. */
const sendGoAndExpectError = (machine: ReturnType<typeof machineFailingIn>, value: unknown, label: string) =>
  Effect.gen(function* () {
    const actor = yield* createActor(machine)
    yield* actor.start
    const watcher = yield* watchChanges(actor)
    yield* actor.send({ type: "GO" })
    assertErroredWith(yield* actor.getSnapshot, value, label)
    assert.deepStrictEqual(yield* failureOf(watcher), Option.some(value), `${label}: changes fails with the value`)
  })

describe("S24 A failing action sets status error with the original error", () => {
  it.effect("[S24] a transition action that throws a value sets status error with snapshot.error Some of that value, and the subscribed changes stream fails with that value", () =>
    Effect.gen(function* () {
      const value = failureValue("transition action", "throw")
      const actor = yield* createActor(machineFailingIn("transition action", "throw", value))
      yield* actor.start
      const watcher = yield* watchChanges(actor)

      yield* actor.send({ type: "GO" })

      assertErroredWith(yield* actor.getSnapshot, value, "transition action")
      const failure = yield* failureOf(watcher)
      assert.isTrue(Option.isSome(failure), "the changes stream failed")
      assert.strictEqual(Option.getOrUndefined(failure), value)
    })
  )

  for (const site of ["entry action", "exit action", "transition action", "eventless guard", "assigner"] as const) {
    it.effect(`[S24] a throw, a typed failure and a defect in an ${site} each set status error with the original value and fail the changes stream with it`, () =>
      Effect.gen(function* () {
        for (const form of forms) {
          const value = failureValue(site, form)
          yield* sendGoAndExpectError(machineFailingIn(site, form, value), value, `${site} / ${form}`)
        }
      })
    )
  }

  it.effect("[S24] a throw in the context factory sets status error at creation with the original value; start keeps it and fails the changes stream with it", () =>
    Effect.gen(function* () {
      const value = failureValue("context factory", "throw")
      const machine = createMachine<Ctx, Ev>({
        id: "s24-context",
        initial: "a",
        context: () => {
          throw value
        },
        states: { a: {} },
      })
      const actor = yield* createActor(machine)
      assertErroredWith(yield* actor.getSnapshot, value, "at creation")
      const watcher = yield* watchChanges(actor)

      yield* actor.start

      assertErroredWith(yield* actor.getSnapshot, value, "after start")
      assert.deepStrictEqual(yield* failureOf(watcher), Option.some(value))
    })
  )

  it.effect("[S24] a throw, a typed failure and a defect in logic.start each set status error with the original value; start itself does not fail", () =>
    Effect.gen(function* () {
      for (const form of forms) {
        const value = failureValue("logic.start", form)
        const actor = yield* createActor(logicFailingAtStart(form, value))
        const watcher = yield* watchChanges(actor)

        const started = yield* Effect.exit(actor.start)

        assert.isTrue(Exit.isSuccess(started), `${form}: start succeeds`)
        assertErroredWith(yield* actor.getSnapshot, value, `logic.start / ${form}`)
        assert.deepStrictEqual(yield* failureOf(watcher), Option.some(value), `${form}: changes fails with the value`)
      }
    })
  )

  it.effect("[S24] a throw, a typed failure and a defect in a deferred effect each set status error with the original value once the macrostep commits", () =>
    Effect.gen(function* () {
      for (const form of forms) {
        const value = failureValue("deferred effect", form)
        const machine = createMachine<Ctx, Ev>({
          id: "s24-deferred",
          initial: "a",
          context: { count: 0 },
          states: { a: { on: { GO: { target: "b", actions: [deferringFailure(form, value)] } } }, b: {} },
        })
        const actor = yield* createActor(machine)
        yield* actor.start
        const watcher = yield* watchChanges(actor)

        yield* actor.send({ type: "GO" })

        assertErroredWith(yield* actor.getSnapshot, value, `deferred effect / ${form}`)
        assert.deepStrictEqual(yield* failureOf(watcher), Option.some(value), `${form}: changes fails with the value`)
      }
    })
  )

  it.effect("[S24] on error the snapshot is the pre-event snapshot with status error: no assign, state change, later action or deferred send of that macrostep remains", () =>
    Effect.gen(function* () {
      const value = failureValue("transition action", "typed failure")
      const ran: Array<string> = []
      const received: Array<string> = []
      const recipient = yield* createActor(
        fromCallback(({ receive }) => {
          receive((event) => {
            received.push(event.type)
          })
        }),
        { systemId: "s24-recipient" }
      )
      yield* recipient.start
      const machine = createMachine<Ctx, Ev>({
        id: "s24-pre-event",
        initial: "a",
        context: { count: 0 },
        states: {
          a: {
            on: {
              GO: {
                target: "b",
                actions: [
                  assign<Ctx, Ev>(({ context }) => ({ count: context.count + 1 })),
                  () => {
                    ran.push("before")
                  },
                  sendParent<Ctx, Ev>({ type: "PING" }),
                  failingFunction("typed failure", value),
                  () => {
                    ran.push("after")
                  },
                ],
              },
            },
          },
          b: {
            entry: () => {
              ran.push("entry b")
            },
          },
        },
      })
      const actor = yield* createActor(machine, { parent: recipient })
      yield* actor.start
      const before = yield* actor.getSnapshot

      yield* actor.send({ type: "GO" })
      yield* settle

      const snapshot = yield* actor.getSnapshot
      assertErroredWith(snapshot, value, "typed failure in a transition action")
      assert.deepStrictEqual(snapshot.value, before.value)
      assert.deepStrictEqual(snapshot.context, { count: 0 })
      // The actions before the failing one ran while the macrostep ran; none after it did
      assert.deepStrictEqual(ran, ["before"])
      // The parent hears of the error, and of nothing else the macrostep sent
      assert.deepStrictEqual(received, ["xstate.error.actor." + actor.id])
    })
  )

  it.effect("[S24] boundary: an error in the initial entry action gives status error at creation; start keeps it, fails changes, starts no child spawned at creation and processes no event", () =>
    Effect.gen(function* () {
      const value = failureValue("initial entry action", "throw")
      const log: Array<string> = []
      const child = fromCallback(() => {
        log.push("child started")
        return () => {
          log.push("child cleanup")
        }
      })
      const machine = createMachine<Ctx, Ev>({
        id: "s24-initial",
        initial: "a",
        context: { count: 0 },
        entry: [
          spawnChild<Ctx, Ev, typeof child>(child, { id: "child" }),
          assign<Ctx, Ev>(() => {
            throw value
          }),
        ],
        states: { a: { on: { GO: { actions: () => log.push("GO handled") } } } },
      })
      const actor = yield* createActor(machine)
      assertErroredWith(yield* actor.getSnapshot, value, "at creation")
      const watcher = yield* watchChanges(actor)

      yield* actor.start
      yield* actor.send({ type: "GO" })
      yield* settle

      assertErroredWith(yield* actor.getSnapshot, value, "after start")
      assert.deepStrictEqual(yield* failureOf(watcher), Option.some(value))
      assert.isFalse(log.includes("child started"), "the child spawned at creation never starts")
      assert.isFalse(log.includes("GO handled"), "the errored actor processes no event")
    })
  )

  it.effect("[S24] boundary: a logic whose initial snapshot has status error never runs its start", () =>
    Effect.gen(function* () {
      const value = failureValue("initial snapshot", "typed failure")
      const started: Array<string> = []
      const logic = makeActorLogic<SnapshotType, EventObject, unknown>({
        transition: (snapshot) => Effect.succeed(snapshot),
        getInitialSnapshot: () => Effect.succeed(Snapshot.error(value)),
        getPersistedSnapshot: (snapshot) => Effect.succeed(snapshot),
        start: () =>
          Effect.sync(() => {
            started.push("logic.start")
          }),
      })
      const actor = yield* createActor(logic)
      const watcher = yield* watchChanges(actor)

      yield* actor.start

      assertErroredWith(yield* actor.getSnapshot, value, "after start")
      assert.deepStrictEqual(started, [])
      assert.deepStrictEqual(yield* failureOf(watcher), Option.some(value))
    })
  )
})
