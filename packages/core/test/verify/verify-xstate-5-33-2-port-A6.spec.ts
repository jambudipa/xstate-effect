/**
 * A6: emit is delivered after the transition.
 *
 * T2.47. Upstream (`actions/emit.ts` `executeEmit` and `createActor.ts` `update` at
 * xstate@5.33.2): an `emit` action defers `actorScope.emit(event)` with `actorScope.defer`, as
 * `executeSendTo` defers its relay. After a macrostep, `update` sets the new snapshot, runs the
 * deferred functions in order, then calls `observer.next`. So an `actor.on` listener runs after
 * the whole macrostep commits, a snapshot it reads is the new one, and it runs before the
 * observers hear of that snapshot. `actorScope.emit` calls the listeners of the event's type and
 * the `'*'` listeners; a listener that throws is reported (`reportUnhandledError`; the port's
 * logger, SD-21) and the rest go on. A deferred function that throws drops the ones after it and
 * gives status `error` (SD-4). An emitted event goes to the listeners only, never to the
 * machine's own queue.
 *
 * The port's hand-written action definitions follow the same order for an `EmitEvent` result and
 * for `ctx.emit` (COMPAT-2). Ordering is proved without fork timing (AS2.a): an external `send`
 * returns after its macrostep and that macrostep's deferred effects (SD-23), so each test reads
 * its log right after the `send`.
 *
 * T8.8: `actor.on` is current API, as upstream's (no `@deprecated` tag).
 */
import { assert, describe, it } from "@effect/vitest"
import { Cause, Effect, Logger, Option } from "effect"
import { readFileSync } from "node:fs"
import ts from "typescript"
import {
  type ActionDefinition,
  assign,
  createActor,
  createMachine,
  emit,
  type EventObject,
  fromCallback,
  raise,
  sendTo,
  spawnChild,
  Types,
} from "../../src/index.js"

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

/** The values one log entry carries: its message parts, then the errors and defects of its cause. */
const reportedValues = (entry: Logger.Options<unknown>): ReadonlyArray<unknown> => [
  ...(Array.isArray(entry.message) ? entry.message : [entry.message]),
  ...entry.cause.reasons.flatMap((reason) =>
    Cause.isDieReason(reason) ? [reason.defect] : Cause.isFailReason(reason) ? [reason.error] : []
  ),
]

/** The values of every Error-level entry, one list per report, in report order. */
const reports = (entries: Entries): ReadonlyArray<ReadonlyArray<unknown>> =>
  entries.filter((entry) => entry.logLevel === "Error").map(reportedValues)

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

/** Lets every other ready fiber take ten turns. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 10; turn++) {
    yield* Effect.yieldNow
  }
})

interface Count {
  readonly count: number
}

type GoEvent = { readonly type: "GO" }

/** An assign that adds one to `count`. */
const increment = <E extends EventObject>() => assign<Count, E>(({ context }) => ({ count: context.count + 1 }))

/** A callback child that records each event it receives as `<name> <type>`. */
const recorder = (name: string, log: Array<string>) =>
  fromCallback(({ receive }) => {
    receive((event) => {
      log.push(`${name} ${event.type}`)
    })
  })

describe("A6 emit is delivered after the transition", () => {
  it.effect("[A6] a listener registered with actor.on runs after the transition commits: a snapshot read inside it shows the new state and the assigned context", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      // A hand-written definition that returns an emit result, and one that calls ctx.emit
      const emitResult: ActionDefinition<Count, GoEvent> = {
        type: "a6.emitResult",
        exec: () => Effect.succeed(Types.ActionResult.EmitEvent({ type: "fromResult" })),
      }
      const ctxEmit: ActionDefinition<Count, GoEvent> = {
        type: "a6.ctxEmit",
        exec: (ctx) => Effect.as(ctx.emit({ type: "fromContext" }), Types.ActionResult.NoOp()),
      }
      const machine = createMachine<Count, GoEvent>({
        id: "a6-after-commit",
        initial: "a",
        context: { count: 0 },
        states: {
          // The emits come before the assign in the list, and the transition leaves `a`
          a: { on: { GO: { target: "b", actions: [emit<Count, GoEvent>({ type: "evt" }), emitResult, ctxEmit, increment<GoEvent>()] } } },
          b: {},
        },
      })
      const actor = yield* createActor(machine)
      const heard = (event: EventObject) =>
        Effect.map(actor.getSnapshot, (snapshot) => {
          log.push(`${event.type} ${String(snapshot.value)} ${snapshot.context.count}`)
        })
      yield* actor.on("evt", heard)
      yield* actor.on("fromResult", heard)
      yield* actor.on("fromContext", heard)
      yield* actor.start
      assert.deepStrictEqual(log, [], "no listener runs before the event")

      yield* actor.send({ type: "GO" })

      // The send returns after the macrostep and its deferred effects: no wait is needed
      assert.deepStrictEqual(log, ["evt b 1", "fromResult b 1", "fromContext b 1"])
      assert.strictEqual((yield* actor.getSnapshot).status, "active")
    })
  )

  it.effect("[A6] an emit in an initial entry action reaches a listener registered before start, at start, with the initial snapshot", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const machine = createMachine<Count, GoEvent>({
        id: "a6-initial",
        initial: "a",
        context: { count: 0 },
        states: { a: { entry: [emit<Count, GoEvent>({ type: "ready" }), increment<GoEvent>()] } },
      })
      const actor = yield* createActor(machine)
      yield* actor.on("ready", (event) =>
        Effect.map(actor.getSnapshot, (snapshot) => {
          log.push(`${event.type} ${String(snapshot.value)} ${snapshot.context.count}`)
        })
      )
      assert.deepStrictEqual(log, [], "nothing is emitted before start")

      yield* actor.start

      assert.deepStrictEqual(log, ["ready a 1"])
    })
  )

  it.effect("[A6] deferred effects run after the new snapshot is set and before observers are notified: a sendTo recipient reads the sender's updated snapshot, and the listener runs before the subscriber", () =>
    Effect.gen(function* () {
      interface Stage {
        readonly stage: string
      }
      const log: Array<string> = []
      // The child reads its parent's live snapshot when it receives PEEK
      const peeker = fromCallback(({ receive, self }) => {
        receive((event) => {
          // The untyped read gives a base snapshot; the parent's is a machine snapshot of Stage
          const parentSnapshot = Effect.runSync(Option.getOrThrow(self._parent).getSnapshotUntyped) as unknown as {
            readonly context: Stage
          }
          log.push(`child ${event.type} ${parentSnapshot.context.stage}`)
        })
      })
      const machine = createMachine<Stage, GoEvent>({
        id: "a6-order",
        context: { stage: "before" },
        entry: spawnChild<Stage, GoEvent, typeof peeker>(peeker, { id: "child" }),
        on: {
          GO: {
            actions: [
              sendTo<Stage, GoEvent>("child", { type: "PEEK" }),
              emit<Stage, GoEvent>({ type: "evt" }),
              assign<Stage, GoEvent>(() => ({ stage: "after" })),
            ],
          },
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.on("evt", () =>
        Effect.map(actor.getSnapshot, (snapshot) => {
          log.push(`listener ${snapshot.context.stage}`)
        })
      )
      yield* actor.start
      yield* actor.subscribe((snapshot) =>
        Effect.sync(() => {
          log.push(`subscriber ${snapshot.context.stage}`)
        })
      )

      yield* actor.send({ type: "GO" })

      assert.isTrue(yield* eventually(Effect.sync(() => log.some((entry) => entry.startsWith("child")))))
      assert.deepStrictEqual(
        log.filter((entry) => !entry.startsWith("child")),
        ["listener after", "subscriber after"],
        "the listener reads the committed snapshot, before the subscriber hears of it"
      )
      assert.deepStrictEqual(log.filter((entry) => entry.startsWith("child")), ["child PEEK after"])
    })
  )

  it.effect("[A6] a failing deferred effect sets status error with the committed snapshot, and the emit after it reaches no listener", () => {
    const entries: Entries = []
    return withLogger(
      entries,
      Effect.gen(function* () {
        const boom = new Error("deferred effect failed")
        const log: Array<string> = []
        const failingDeferred: ActionDefinition<Count, GoEvent> = {
          type: "a6.failingDeferred",
          exec: (ctx) =>
            Effect.as(
              ctx.defer(
                Effect.sync(() => {
                  throw boom
                })
              ),
              Types.ActionResult.NoOp()
            ),
        }
        const machine = createMachine<Count, GoEvent>({
          id: "a6-deferred-failure",
          context: { count: 0 },
          on: {
            GO: {
              actions: [
                emit<Count, GoEvent>({ type: "first" }),
                failingDeferred,
                emit<Count, GoEvent>({ type: "second" }),
                increment<GoEvent>(),
              ],
            },
          },
        })
        const actor = yield* createActor(machine)
        yield* actor.on("*", (event) =>
          Effect.map(actor.getSnapshot, (snapshot) => {
            log.push(`${event.type} ${snapshot.context.count}`)
          })
        )
        yield* actor.start

        yield* actor.send({ type: "GO" })

        // The first emit was deferred before the failing effect: it ran, with the committed
        // snapshot; the second one was deferred after it and was dropped
        assert.deepStrictEqual(log, ["first 1"])
        const snapshot = yield* actor.getSnapshot
        assert.strictEqual(snapshot.status, "error")
        assert.isTrue(Option.isSome(snapshot.error) && snapshot.error.value === boom, "error is the original value")
        assert.strictEqual(snapshot.context.count, 1, "the error snapshot is the committed one")
        assert.strictEqual(reports(entries).length, 1, "the root reports the error once")
      })
    )
  })

  it.effect("[A6] an emit listener that throws is reported through the logger and leaves the actor working: the rest of the macrostep's deferred effects still run", () => {
    const entries: Entries = []
    return withLogger(
      entries,
      Effect.gen(function* () {
        const oops = new Error("listener failed")
        const log: Array<string> = []
        const machine = createMachine<Count, GoEvent>({
          id: "a6-throwing-listener",
          context: { count: 0 },
          entry: spawnChild<Count, GoEvent, ReturnType<typeof recorder>>(recorder("child", log), { id: "child" }),
          on: {
            GO: {
              actions: [
                emit<Count, GoEvent>({ type: "boom" }),
                emit<Count, GoEvent>({ type: "after" }),
                sendTo<Count, GoEvent>("child", { type: "PING" }),
                increment<GoEvent>(),
              ],
            },
          },
        })
        const actor = yield* createActor(machine)
        yield* actor.on("boom", () =>
          Effect.sync(() => {
            throw oops
          })
        )
        yield* actor.on("*", (event) =>
          Effect.sync(() => {
            log.push(`wildcard ${event.type}`)
          })
        )
        yield* actor.start

        yield* actor.send({ type: "GO" })
        assert.isTrue(yield* eventually(Effect.sync(() => log.includes("child PING"))))
        yield* settle

        assert.deepStrictEqual(log, ["wildcard boom", "wildcard after", "child PING"])
        const made = reports(entries)
        assert.strictEqual(made.length, 1, "one report")
        assert.isTrue(made[0]!.includes(oops), "the report carries the listener's error")
        assert.strictEqual((yield* actor.getSnapshot).status, "active")

        yield* actor.send({ type: "GO" })
        assert.strictEqual((yield* actor.getSnapshot).context.count, 2, "the actor handles its next event")
      })
    )
  })

  it.effect("[A6] actor.on('*') receives every emitted event, a typed listener only its type, and no emitted event enters the machine's own queue", () =>
    Effect.gen(function* () {
      type Ev = GoEvent | { readonly type: "a" } | { readonly type: "b" }
      const wildcard: Array<string> = []
      const typed: Array<string> = []
      const machine = createMachine<Count, Ev>({
        id: "a6-wildcard",
        context: { count: 0 },
        on: {
          GO: { actions: [emit<Count, Ev>({ type: "a" }), emit<Count, Ev>({ type: "b" })] },
          // Taken only if an emitted event reached the machine itself
          a: { actions: increment<Ev>() },
          b: { actions: increment<Ev>() },
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.on("*", (event) =>
        Effect.sync(() => {
          wildcard.push(event.type)
        })
      )
      yield* actor.on("a", (event) =>
        Effect.sync(() => {
          typed.push(event.type)
        })
      )
      yield* actor.start

      yield* actor.send({ type: "GO" })
      yield* settle

      assert.deepStrictEqual(wildcard, ["a", "b"])
      assert.deepStrictEqual(typed, ["a"])
      assert.strictEqual((yield* actor.getSnapshot).context.count, 0, "the machine took no emitted event")
    })
  )

  it.effect("[A6] a macrostep whose first microstep emits a and raises R and whose second microstep assigns and emits b delivers a then b after the whole macrostep commits, both with the final context", () =>
    Effect.gen(function* () {
      type Ev = GoEvent | { readonly type: "R" }
      const log: Array<string> = []
      const machine = createMachine<Count, Ev>({
        id: "a6-macrostep",
        initial: "idle",
        context: { count: 0 },
        states: {
          idle: { on: { GO: { target: "first", actions: [emit<Count, Ev>({ type: "a" }), raise<Count, Ev>({ type: "R" })] } } },
          first: { on: { R: { target: "second", actions: [increment<Ev>(), emit<Count, Ev>({ type: "b" })] } } },
          second: {},
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.on("*", (event) =>
        Effect.map(actor.getSnapshot, (snapshot) => {
          log.push(`${event.type} ${String(snapshot.value)} ${snapshot.context.count}`)
        })
      )
      yield* actor.start

      yield* actor.send({ type: "GO" })

      assert.deepStrictEqual(log, ["a second 1", "b second 1"])
    })
  )

  it("[A6] actor.on is current API, as upstream's: its declaration on the Actor interface has no @deprecated tag", () => {
    // Upstream's `Actor.on` carries no deprecation and the emit rewrite listens through it; a
    // tag would make every listener a `no-deprecated` lint error for a consumer
    const source = readFileSync(new URL("../../src/Actor.ts", import.meta.url), "utf8")
    const file = ts.createSourceFile("Actor.ts", source, ts.ScriptTarget.Latest, true)
    const actor = file.statements.find(
      (statement): statement is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(statement) && statement.name.text === "Actor"
    )
    const on = actor?.members.find((member) => member.name !== undefined && ts.isIdentifier(member.name) && member.name.text === "on")
    assert.isDefined(on, "the Actor interface declares on")
    assert.notInclude(
      ts.getJSDocTags(on!).map((tag) => tag.tagName.text),
      "deprecated"
    )
  })
})
