/**
 * COMPAT-3: port-only helpers run inside a live actor.
 *
 * T4.21. D15 keeps the port's extras beside the XState forms, and COMPAT-4 later checks every
 * baseline export by name. Upstream xstate@5.33.2 has none of these helpers, so this file is
 * their proof inside a running actor:
 *
 * - `assignProperty(key, value | fn)` sets one context key;
 * - `sendSelf(event, options?)` is `sendTo("#_self", ...)`: the actor receives the event after
 *   the macrostep commits, or after the delay;
 * - `logInfo(message)` is `log(message, { level: "info" })`: one Info entry;
 * - `stateNotIn(value)` negates `stateIn` against the active configuration;
 * - `spawnChildFromRegistry(name, implementations, options?)` spawns the logic that the given
 *   implementations hold under that name, and warns and spawns nothing for a missing name;
 * - `stopAllChildren()` stops every child of the snapshot at that point of the action list,
 *   as one `stopChild` per child: each child leaves `snapshot.children`, gives its systemId up
 *   at once, and stops (cleanup run, status `stopped`). It reads `snapshot.children`, not the
 *   systemId registry, so a child without a systemId stops too, and a child spawned earlier
 *   in the same list never starts.
 *
 * `setupWithSchema` keeps `validateContext` and `validateEvent` on the v4
 * `Schema.decodeUnknownEffect`: a valid value decodes, an invalid one fails with
 * `Schema.SchemaError`. The type-level cases are this file's own type check (`tsc -p
 * tsconfig.test.green.json`).
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Logger, Option, References, Schema } from "effect"
import { TestClock } from "effect/testing"
import type { ActorRefBase } from "../../src/ActorRef.js"
import {
  actions,
  assignProperty,
  createActor,
  createMachine,
  fromCallback,
  logInfo,
  sendSelf,
  setupWithSchema,
  spawnChild,
  stateNotIn,
  stopAllChildren,
  type EventObject,
} from "../../src/index.js"

// `spawnChildFromRegistry` is public through the root's `actions` namespace only (as in the baseline)
const { spawnChildFromRegistry } = actions

/** True when `A` and `B` are the same type. */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

/** Compiles only for `true`. */
const typeHolds = <T extends true>(holds: T): T => holds

/** One log entry as a test logger saw it. */
interface Entry {
  readonly logLevel: Logger.Options<unknown>["logLevel"]
  /** The message as the argument list a logger function would receive */
  readonly message: ReadonlyArray<unknown>
}

/** Runs `program` with a logger that keeps every log entry, Debug included, in `entries`. */
const withLogger = <A, E, R>(entries: Array<Entry>, program: Effect.Effect<A, E, R>) =>
  program.pipe(
    Effect.provide(
      Logger.layer([
        Logger.make((options) => {
          entries.push({
            logLevel: options.logLevel,
            message: Array.isArray(options.message) ? options.message : [options.message],
          })
        }),
      ])
    ),
    Effect.provideService(References.MinimumLogLevel, "All")
  )

/** The status of the snapshot the reference reads now. */
const statusOf = (ref: ActorRefBase) => Effect.map(ref.getSnapshotUntyped, (snapshot) => snapshot.status)

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

/** Whether the reference's status becomes `stopped`. */
const stops = (ref: ActorRefBase | undefined) => {
  assert.isDefined(ref, "the child reference exists")
  return eventually(Effect.map(statusOf(ref!), (status) => status === "stopped"))
}

/** A callback logic that records its start and its cleanup under `name`. */
const recorded = (name: string, log: Array<string>) =>
  fromCallback(() => {
    log.push(`${name} started`)
    return () => {
      log.push(`${name} cleanup`)
    }
  })

const Context = Schema.Struct({ count: Schema.Number, label: Schema.String })
const Events = Schema.Union([
  Schema.Struct({ type: Schema.Literal("SET"), label: Schema.String }),
  Schema.Struct({ type: Schema.Literal("PING") }),
  Schema.Struct({ type: Schema.Literal("PING_LATER") }),
  Schema.Struct({ type: Schema.Literal("PONG") }),
  Schema.Struct({ type: Schema.Literal("LOG") }),
  Schema.Struct({ type: Schema.Literal("CHECK") }),
  Schema.Struct({ type: Schema.Literal("SPAWN") }),
  Schema.Struct({ type: Schema.Literal("STOP_ALL") }),
])
type Ctx = Schema.Schema.Type<typeof Context>
type Ev = Schema.Schema.Type<typeof Events>

describe("COMPAT-3 Port-only helpers run inside a live actor", () => {
  it.effect("[COMPAT-3] a setupWithSchema machine handles one event per helper, and each helper takes effect in the snapshot or the test logger", () => {
    const entries: Array<Entry> = []
    return withLogger(
      entries,
      Effect.gen(function* () {
        const log: Array<string> = []
        const registry = { actors: { first: recorded("first", log), second: recorded("second", log) } }
        const helpers = setupWithSchema({ context: Context, events: Events })
        const machine = helpers.createMachine({
          id: "compat3",
          context: { count: 0, label: "" },
          initial: "idle",
          states: {
            idle: {
              on: {
                CHECK: [
                  { guard: stateNotIn("idle"), target: "wrong" },
                  { guard: stateNotIn("busy"), target: "checked" },
                ],
              },
            },
            busy: {},
            wrong: {},
            checked: {},
          },
          on: {
            SET: { actions: assignProperty<Ctx, Ev, "label">("label", ({ event }) => (event.type === "SET" ? event.label : "")) },
            PING: { actions: sendSelf<Ctx, Ev, Ev>({ type: "PONG" }) },
            PING_LATER: { actions: sendSelf<Ctx, Ev, Ev>({ type: "PONG" }, { delay: 100 }) },
            PONG: { actions: assignProperty<Ctx, Ev, "count">("count", ({ context }) => context.count + 1) },
            LOG: { actions: logInfo<Ctx, Ev>(({ context }) => `count ${context.count} label ${context.label}`) },
            SPAWN: {
              actions: [
                spawnChildFromRegistry<Ctx, Ev>("first", registry, { id: "one" }),
                spawnChildFromRegistry<Ctx, Ev>("second", registry, { id: "two" }),
                spawnChildFromRegistry<Ctx, Ev>("missing", registry, { id: "none" }),
              ],
            },
            STOP_ALL: { actions: stopAllChildren<Ctx, Ev>() },
          },
        })
        const actor = yield* createActor(machine)
        yield* actor.start
        const contextNow = Effect.map(actor.getSnapshot, (snapshot) => snapshot.context)

        // assignProperty
        yield* actor.send({ type: "SET", label: "hello" })
        assert.deepStrictEqual(yield* contextNow, { count: 0, label: "hello" })

        // sendSelf, at once and with a delay
        yield* actor.send({ type: "PING" })
        assert.isTrue(yield* eventually(Effect.map(contextNow, (context) => context.count === 1)))
        yield* actor.send({ type: "PING_LATER" })
        yield* settle
        assert.strictEqual((yield* contextNow).count, 1)
        yield* TestClock.adjust("100 millis")
        assert.isTrue(yield* eventually(Effect.map(contextNow, (context) => context.count === 2)))

        // logInfo
        yield* actor.send({ type: "LOG" })
        const infos = entries.filter((entry) => entry.logLevel === "Info").map((entry) => entry.message)
        assert.deepStrictEqual(infos, [["count 2 label hello"]])

        // stateNotIn
        yield* actor.send({ type: "CHECK" })
        assert.strictEqual((yield* actor.getSnapshot).value, "checked")

        // spawnChildFromRegistry
        yield* actor.send({ type: "SPAWN" })
        const children = (yield* actor.getSnapshot).children
        assert.deepStrictEqual(Object.keys(children), ["one", "two"])
        assert.isTrue(yield* eventually(Effect.sync(() => log.length === 2)))
        assert.deepStrictEqual(log, ["first started", "second started"])
        const warnings = entries.filter((entry) => entry.logLevel === "Warn").map((entry) => entry.message)
        assert.deepStrictEqual(warnings, [['Actor "missing" not found in implementations']])

        // stopAllChildren
        yield* actor.send({ type: "STOP_ALL" })
        assert.deepStrictEqual(Object.keys((yield* actor.getSnapshot).children), [])
        assert.isTrue(yield* stops(children["one"]))
        assert.isTrue(yield* stops(children["two"]))
        yield* settle
        assert.deepStrictEqual([...log].sort(), ["first cleanup", "first started", "second cleanup", "second started"])
        assert.strictEqual((yield* actor.getSnapshot).status, "active")
      })
    )
  })

  it.effect("[COMPAT-3] stopAllChildren stops two children spawned without a systemId (it reads snapshot.children, not the systemId registry)", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      type StopEvent = { readonly type: "STOP_ALL" }
      const machine = createMachine<object, StopEvent>({
        id: "compat3-no-system-id",
        context: {},
        entry: [
          spawnChild<object, StopEvent, ReturnType<typeof recorded>>(recorded("a", log), { id: "a" }),
          spawnChild<object, StopEvent, ReturnType<typeof recorded>>(recorded("b", log), { id: "b" }),
        ],
        on: { STOP_ALL: { actions: stopAllChildren<object, StopEvent>() } },
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      const children = (yield* actor.getSnapshot).children
      assert.deepStrictEqual(Object.keys(children), ["a", "b"])
      // Neither child is in the systemId registry
      assert.deepStrictEqual(Object.keys(yield* actor.system.getAll), [])
      assert.deepStrictEqual(log, ["a started", "b started"])

      yield* actor.send({ type: "STOP_ALL" })

      assert.deepStrictEqual(Object.keys((yield* actor.getSnapshot).children), [])
      assert.isTrue(yield* stops(children["a"]))
      assert.isTrue(yield* stops(children["b"]))
      yield* settle
      assert.deepStrictEqual([...log].sort(), ["a cleanup", "a started", "b cleanup", "b started"])
      assert.strictEqual((yield* actor.getSnapshot).status, "active")
    })
  )

  it.effect("[COMPAT-3] stopAllChildren reads the children at its point of the action list: a child spawned before it in the list never starts, and a systemId is free at once", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      type ResetEvent = { readonly type: "RESET" }
      const machine = createMachine<object, ResetEvent>({
        id: "compat3-list",
        context: {},
        entry: spawnChild<object, ResetEvent, ReturnType<typeof recorded>>(recorded("old", log), { id: "old", systemId: "worker" }),
        on: {
          RESET: {
            actions: [
              spawnChild<object, ResetEvent, ReturnType<typeof recorded>>(recorded("brief", log), { id: "brief" }),
              stopAllChildren<object, ResetEvent>(),
              spawnChild<object, ResetEvent, ReturnType<typeof recorded>>(recorded("new", log), { id: "new", systemId: "worker" }),
            ],
          },
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      const old = (yield* actor.getSnapshot).children["old"]
      assert.deepStrictEqual(log, ["old started"])

      yield* actor.send({ type: "RESET" })

      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.status, "active")
      assert.deepStrictEqual(Object.keys(snapshot.children), ["new"])
      const registered = yield* actor.system.get("worker")
      assert.isTrue(Option.isSome(registered))
      assert.strictEqual(Option.getOrUndefined(registered), snapshot.children["new"])
      assert.isTrue(yield* stops(old))
      yield* settle
      assert.deepStrictEqual([...log].sort(), ["new started", "old cleanup", "old started"])
    })
  )

  it.effect("[COMPAT-3] setupWithSchema keeps validateContext and validateEvent on the v4 Schema.decodeUnknownEffect", () =>
    Effect.gen(function* () {
      const helpers = setupWithSchema({ context: Context, events: Events })
      typeHolds<Equals<typeof helpers.validateContext, (value: unknown) => Effect.Effect<Ctx, Schema.SchemaError>>>(true)
      // The setup's event type is the schema's type as an `EventObject`
      typeHolds<Equals<typeof helpers.validateEvent, (value: unknown) => Effect.Effect<Ev & EventObject, Schema.SchemaError>>>(true)

      assert.deepStrictEqual(yield* helpers.validateContext({ count: 3, label: "x" }), { count: 3, label: "x" })
      assert.deepStrictEqual(yield* helpers.validateEvent({ type: "SET", label: "y" }), { type: "SET", label: "y" })

      const badContext = yield* Effect.flip(helpers.validateContext({ count: "three", label: "x" }))
      assert.isTrue(Schema.isSchemaError(badContext))
      const badEvent = yield* Effect.flip(helpers.validateEvent({ type: "SET" }))
      assert.isTrue(Schema.isSchemaError(badEvent))
      const unknownEvent = yield* Effect.flip(helpers.validateEvent({ type: "NOPE" }))
      assert.isTrue(Schema.isSchemaError(unknownEvent))
    })
  )

  it("[COMPAT-3] the helpers keep their types: assignProperty takes only a context key and a value of its type", () => {
    // @ts-expect-error the context has no key `missing`
    assignProperty<Ctx, Ev, "missing">("missing", 1)
    // @ts-expect-error `count` holds a number, not a string
    assignProperty<Ctx, Ev, "count">("count", "one")
    // @ts-expect-error the function form must give the key's type
    assignProperty<Ctx, Ev, "label">("label", ({ context }) => context.count)
    const action = assignProperty<Ctx, Ev, "label">("label", "ok")
    assert.strictEqual(action.type, "xstate.assign")
    assert.strictEqual(stopAllChildren<Ctx, Ev>().type, "xstate.stopAllChildren")
  })
})
