/**
 * A19: setup().extend, createStateConfig, createAction and the bound helpers work.
 *
 * T4.17. Upstream `src/setup.ts` at xstate@5.33.2: the object `setup(...)` returns has, beside
 * `createMachine`,
 *
 * - `extend({ actions, guards, delays })`: a new setup with the same types, schemas and
 *   actors, whose actions, guards and delays are `{ ...base, ...extended }`, so an extension
 *   wins over a base implementation of the same name; the base setup is unchanged;
 * - `createStateConfig(config)` and `createAction(action)`: they give their argument back,
 *   typed by the setup, for use in that setup's machines;
 * - the bound `assign`, `sendTo`, `raise`, `log`, `cancel`, `stopChild`, `enqueueActions`,
 *   `emit` and `spawnChild`: the module functions, with the setup's context, events and
 *   names as type arguments.
 *
 * Port: `setupWithSchema` returns the same members, and its `extend` keeps the schemas and the
 * validators. The type-level case is this file's own type check (`tsc -p
 * tsconfig.test.green.json`): a setup machine config, a state config and the bound helpers
 * reject an unknown action name, wrong params, an event outside the union and an unknown
 * delay name (`@ts-expect-error`). T8.8: they also reject a tag that the setup's
 * `types.tags` does not declare, as upstream's `TTag` does, and a built-in action in an
 * `extend`'s actions may name a sibling extension action (upstream `TActions & TExtendActions`).
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Logger, References, Schema } from "effect"
import { TestClock } from "effect/testing"
import {
  createActor,
  enqueueActions,
  fromCallback,
  raise,
  sendTo,
  setup,
  setupWithSchema,
  spawnChild,
  type EventObject,
} from "../../src/index.js"

/** Lets every other ready fiber take a bounded number of turns. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 25; turn++) {
    yield* Effect.yieldNow
  }
})

/** Moves the test clock by `millis` and lets each delivery it caused run. */
const advance = (millis: number) => Effect.andThen(TestClock.adjust(`${millis} millis`), settle)

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

/** A callback logic that records the type of each event it receives. */
const recorder = (log: Array<string>) =>
  fromCallback(({ receive }) => {
    receive((event) => {
      log.push(event.type)
    })
  })

/** Runs `program` with a logger that keeps the message of every entry. */
const withMessages = <A, E, R>(messages: Array<ReadonlyArray<unknown>>, program: Effect.Effect<A, E, R>) =>
  program.pipe(
    Effect.provide(
      Logger.layer([
        Logger.make((options) => {
          messages.push(Array.isArray(options.message) ? options.message : [options.message])
        }),
      ])
    ),
    Effect.provideService(References.MinimumLogLevel, "All")
  )

interface Ctx {
  readonly count: number
}

type Ev =
  | { readonly type: "INC"; readonly by: number }
  | { readonly type: "GO" }
  | { readonly type: "PING" }
  | { readonly type: "CANCEL" }
  | { readonly type: "CHECK" }
  | { readonly type: "STOP" }

describe("A19 setup().extend, createStateConfig, createAction and the bound helpers work", () => {
  it.effect("[A19] extend merges actions, guards and delays, the extension wins on a clash, and the base setup is unchanged", () =>
    Effect.gen(function* () {
      const calls: Array<string> = []
      const base = setup({
        types: { context: {} as Ctx, events: {} as Ev },
        actions: {
          fromBase: () => {
            calls.push("base")
          },
          clash: () => {
            calls.push("base clash")
          },
        },
        guards: { allow: () => false },
        delays: { soon: 100, clashDelay: 1000 },
      })
      const extended = base.extend({
        actions: {
          fromExtension: () => {
            calls.push("extension")
          },
          clash: () => {
            calls.push("extension clash")
          },
        },
        guards: { allow: () => true },
        delays: { clashDelay: 300 },
      })
      assert.deepStrictEqual(Object.keys(extended.actions).sort(), ["clash", "fromBase", "fromExtension"])
      assert.deepStrictEqual(Object.keys(base.actions).sort(), ["clash", "fromBase"])

      const machine = extended.createMachine({
        id: "a19-extend",
        context: { count: 0 },
        initial: "a",
        entry: ["fromBase", "fromExtension", "clash"],
        states: {
          a: { on: { GO: { guard: "allow", target: "b" } } },
          b: { after: { soon: "c" } },
          c: { after: { clashDelay: "d" } },
          d: {},
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      assert.deepStrictEqual(calls, ["base", "extension", "extension clash"])

      yield* actor.send({ type: "GO" })
      assert.strictEqual((yield* actor.getSnapshot).value, "b", "the extension's guard decides")
      yield* advance(100)
      assert.strictEqual((yield* actor.getSnapshot).value, "c", "a base delay still resolves")
      yield* advance(299)
      assert.strictEqual((yield* actor.getSnapshot).value, "c")
      yield* advance(1)
      assert.strictEqual((yield* actor.getSnapshot).value, "d", "the extension's delay wins")

      // The base setup keeps its own implementations
      calls.length = 0
      const baseMachine = base.createMachine({
        id: "a19-base",
        context: { count: 0 },
        initial: "a",
        entry: "clash",
        states: { a: { on: { GO: { guard: "allow", target: "b" } } }, b: {} },
      })
      const baseActor = yield* createActor(baseMachine)
      yield* baseActor.start
      yield* baseActor.send({ type: "GO" })
      assert.deepStrictEqual(calls, ["base clash"])
      assert.strictEqual((yield* baseActor.getSnapshot).value, "a")
    })
  )

  it.effect("[A19] extend chains, and a further extension reads the names of every earlier one", () =>
    Effect.gen(function* () {
      const calls: Array<string> = []
      const machine = setup({ types: { context: {} as Ctx, events: {} as Ev }, delays: { short: 10 } })
        .extend({ actions: { first: () => void calls.push("first") }, delays: { medium: 100 } })
        .extend({ actions: { second: () => void calls.push("second") }, delays: { long: 1000 } })
        .createMachine({
          id: "a19-chain",
          context: { count: 0 },
          initial: "a",
          entry: ["first", "second"],
          states: {
            a: { after: { short: "b" } },
            b: { after: { medium: "c" } },
            c: { after: { long: "d" } },
            d: {},
          },
        })
      const actor = yield* createActor(machine)
      yield* actor.start
      assert.deepStrictEqual(calls, ["first", "second"])
      yield* advance(10)
      yield* advance(100)
      yield* advance(999)
      assert.strictEqual((yield* actor.getSnapshot).value, "c")
      yield* advance(1)
      assert.strictEqual((yield* actor.getSnapshot).value, "d")
    })
  )

  it.effect("[A19] setupWithSchema(...).extend merges the same way and keeps the schemas and the validators", () =>
    Effect.gen(function* () {
      const calls: Array<string> = []
      const Context = Schema.Struct({ count: Schema.Number })
      const Events = Schema.Union([
        Schema.Struct({ type: Schema.Literal("INC"), by: Schema.Number }),
        Schema.Struct({ type: Schema.Literal("GO") }),
      ])
      const base = setupWithSchema({
        context: Context,
        events: Events,
        actions: { fromBase: () => void calls.push("base") },
        guards: { allow: () => false },
      })
      const extended = base.extend({
        actions: { fromExtension: () => void calls.push("extension") },
        guards: { allow: () => true },
      })
      assert.strictEqual(extended.contextSchema, Context)
      assert.strictEqual(extended.eventSchema, Events)
      assert.deepStrictEqual(yield* extended.validateContext({ count: 1 }), { count: 1 })
      const invalid = yield* Effect.exit(extended.validateEvent({ type: "NOPE" }))
      assert.strictEqual(invalid._tag, "Failure")

      const machine = extended.createMachine({
        id: "a19-schema",
        context: { count: 0 },
        initial: "a",
        entry: ["fromBase", "fromExtension"],
        states: { a: { on: { GO: { guard: "allow", target: "b" } } }, b: {} },
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      yield* actor.send({ type: "GO" })
      assert.deepStrictEqual(calls, ["base", "extension"])
      assert.strictEqual((yield* actor.getSnapshot).value, "b")
    })
  )

  it.effect("[A19] createStateConfig gives its config back, and a machine built from such configs runs with the setup's names", () =>
    Effect.gen(function* () {
      const calls: Array<string> = []
      const lights = setup({
        types: { context: {} as Ctx, events: {} as Ev },
        actions: { note: () => void calls.push("note") },
        guards: { isPositive: ({ context }) => context.count > 0 },
      })
      const greenConfig = { on: { GO: { target: "yellow", actions: "note" } } } as const
      const green = lights.createStateConfig(greenConfig)
      assert.strictEqual(green, greenConfig)
      const yellow = lights.createStateConfig({
        on: { GO: [{ guard: "isPositive", target: "red" }, { target: "green" }] },
      })
      const red = lights.createStateConfig({ entry: "note" })

      const machine = lights.createMachine({
        id: "a19-states",
        context: { count: 0 },
        initial: "green",
        states: { green, yellow, red },
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      yield* actor.send({ type: "GO" })
      assert.strictEqual((yield* actor.getSnapshot).value, "yellow")
      yield* actor.send({ type: "GO" })
      assert.strictEqual((yield* actor.getSnapshot).value, "green", "the guard fails at count 0")
      assert.deepStrictEqual(calls, ["note"])
    })
  )

  it.effect("[A19] createAction gives its action back, and the action receives the setup's context and event", () =>
    Effect.gen(function* () {
      const seen: Array<string> = []
      const counter = setup({ types: { context: {} as Ctx, events: {} as Ev } })
      const record = (args: { readonly context: Ctx; readonly event: Ev }) => {
        seen.push(`${args.event.type} ${args.context.count}`)
      }
      const action = counter.createAction(record)
      assert.strictEqual(action, record)

      const machine = counter.createMachine({
        id: "a19-action",
        context: { count: 7 },
        on: { GO: { actions: action } },
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      yield* actor.send({ type: "GO" })
      assert.deepStrictEqual(seen, ["GO 7"])
    })
  )

  it.effect("[A19] the bound assign, raise, sendTo, emit, log, cancel, spawnChild, stopChild and enqueueActions each build a working machine part", () => {
    const messages: Array<ReadonlyArray<unknown>> = []
    return withMessages(
      messages,
      Effect.gen(function* () {
        const childLog: Array<string> = []
        const marks: Array<string> = []
        const heard: Array<string> = []
        const s = setup({
          types: { context: {} as Ctx, events: {} as Ev },
          actors: { worker: recorder(childLog) },
          actions: { mark: () => void marks.push("mark") },
          guards: { isPositive: ({ context }) => context.count > 0 },
          delays: { soon: 100 },
        })
        const machine = s.createMachine({
          id: "a19-bound",
          context: { count: 0 },
          entry: [s.spawnChild("worker", { id: "w" }), s.emit({ type: "started" })],
          on: {
            INC: { actions: s.assign(({ context, event }) => (event.type === "INC" ? { count: context.count + event.by } : {})) },
            GO: { actions: s.raise({ type: "PING" }, { delay: "soon", id: "ping" }) },
            CANCEL: { actions: s.cancel("ping") },
            PING: { actions: [s.sendTo("w", { type: "PING" }), s.log(({ context }) => context.count, "count")] },
            CHECK: {
              actions: s.enqueueActions(({ check, enqueue }) => {
                if (check("isPositive")) {
                  enqueue("mark")
                }
                enqueue.emit({ type: "checked" })
              }),
            },
            STOP: { actions: s.stopChild("w") },
          },
        })
        const actor = yield* createActor(machine)
        yield* actor.on("*", (event: EventObject) => Effect.sync(() => void heard.push(event.type)))
        yield* actor.start
        assert.isDefined((yield* actor.getSnapshot).children["w"], "spawnChild spawned the setup actor")
        assert.deepStrictEqual(heard, ["started"])

        yield* actor.send({ type: "INC", by: 2 })
        assert.strictEqual((yield* actor.getSnapshot).context.count, 2)

        yield* actor.send({ type: "GO" })
        yield* advance(99)
        assert.deepStrictEqual(childLog, [])
        yield* advance(1)
        assert.isTrue(yield* eventually(Effect.sync(() => childLog.length === 1)))
        assert.deepStrictEqual(childLog, ["PING"], "raise with the setup delay, then sendTo the child")
        assert.deepStrictEqual(messages, [["count", 2]])

        yield* actor.send({ type: "GO" })
        yield* actor.send({ type: "CANCEL" })
        yield* advance(200)
        assert.deepStrictEqual(childLog, ["PING"], "the cancelled raise never arrives")

        yield* actor.send({ type: "CHECK" })
        assert.deepStrictEqual(marks, ["mark"])
        assert.deepStrictEqual(heard, ["started", "checked"])

        yield* actor.send({ type: "STOP" })
        assert.isUndefined((yield* actor.getSnapshot).children["w"], "stopChild stopped the child")
      })
    )
  })

  it.effect("[A19] an extended setup's createStateConfig, createAction and bound helpers build working machine parts with the merged names: a base one and an extension-only one each", () =>
    Effect.gen(function* () {
      const calls: Array<string> = []
      const childLog: Array<string> = []
      const base = setup({
        types: { context: {} as Ctx, events: {} as Ev },
        actors: { worker: recorder(childLog) },
        actions: { fromBase: () => void calls.push("base") },
        guards: { baseAllows: ({ context }) => context.count >= 0 },
        delays: { soon: 100 },
      })
      const extended = base.extend({
        actions: { fromExtension: () => void calls.push("extension") },
        guards: { extensionAllows: ({ context }) => context.count > 0 },
        delays: { late: 300 },
      })

      // createAction of the extended setup: an inline function, and its bound enqueueActions
      // that checks a base and an extension-only guard and enqueues a base and an extension-only action
      const report = (args: { readonly context: Ctx }) => {
        calls.push(`report ${args.context.count}`)
      }
      const reportAction = extended.createAction(report)
      assert.strictEqual(reportAction, report)
      const both = extended.createAction(
        extended.enqueueActions(({ check, enqueue }) => {
          if (check("baseAllows") && check("extensionAllows")) {
            enqueue("fromBase")
            enqueue("fromExtension")
          }
        })
      )

      // createStateConfig of the extended setup, naming base and extension-only implementations
      const idleConfig = {
        entry: ["fromBase", "fromExtension"],
        on: {
          GO: { guard: "extensionAllows", target: "early" },
          INC: { actions: extended.assign(({ context, event }) => (event.type === "INC" ? { count: context.count + event.by } : {})) },
        },
      } as const
      const idle = extended.createStateConfig(idleConfig)
      assert.strictEqual(idle, idleConfig)
      const early = extended.createStateConfig({ after: { soon: "later" } })
      const later = extended.createStateConfig({ after: { late: "helpers" } })
      const helpers = extended.createStateConfig({
        entry: [
          both,
          reportAction,
          // The bound raise with the extension-only delay, the bound sendTo with the base delay
          extended.raise({ type: "PING" }, { delay: "late" }),
          extended.sendTo("w", { type: "PING" }, { delay: "soon" }),
        ],
        on: { PING: "pinged" },
      })

      const machine = extended.createMachine({
        id: "a19-extended-helpers",
        context: { count: 0 },
        initial: "idle",
        entry: extended.spawnChild("worker", { id: "w" }),
        states: { idle, early, later, helpers, pinged: {} },
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      assert.deepStrictEqual(calls, ["base", "extension"], "the state config's base and extension-only entry actions run")
      assert.isDefined((yield* actor.getSnapshot).children["w"], "the bound spawnChild spawned the setup actor")

      yield* actor.send({ type: "GO" })
      assert.strictEqual((yield* actor.getSnapshot).value, "idle", "the extension-only guard is false at count 0")
      yield* actor.send({ type: "INC", by: 1 })
      assert.strictEqual((yield* actor.getSnapshot).context.count, 1, "the bound assign ran")
      yield* actor.send({ type: "GO" })
      assert.strictEqual((yield* actor.getSnapshot).value, "early", "the extension-only guard decides")

      yield* advance(99)
      assert.strictEqual((yield* actor.getSnapshot).value, "early")
      yield* advance(1)
      assert.strictEqual((yield* actor.getSnapshot).value, "later", "the base delay of the state config resolves")
      yield* advance(299)
      assert.strictEqual((yield* actor.getSnapshot).value, "later")
      yield* advance(1)
      assert.strictEqual((yield* actor.getSnapshot).value, "helpers", "the extension-only delay of the state config resolves")
      assert.deepStrictEqual(
        calls,
        ["base", "extension", "base", "extension", "report 1"],
        "the bound enqueueActions checked both guards and enqueued both actions; the created inline action ran"
      )

      assert.deepStrictEqual(childLog, [])
      yield* advance(100)
      assert.isTrue(yield* eventually(Effect.sync(() => childLog.length === 1)))
      assert.deepStrictEqual(childLog, ["PING"], "the bound sendTo waited the base delay")
      yield* advance(199)
      assert.strictEqual((yield* actor.getSnapshot).value, "helpers")
      yield* advance(1)
      assert.strictEqual((yield* actor.getSnapshot).value, "pinged", "the bound raise waited the extension-only delay")
    })
  )

  it.effect("[A19] the test type-check rejects an unknown action name, wrong params, an event outside the union and an unknown delay name", () =>
    Effect.sync(() => {
      const typed = setup({
        types: { context: {} as Ctx, events: {} as Ev },
        actions: {
          track: (_, params: { readonly id: number }) => {
            void params.id
          },
          plain: () => {},
        },
        guards: { isPositive: ({ context }) => context.count > 0 },
        delays: { soon: 100 },
      })

      // Known names, with the params they require, are accepted
      typed.createMachine({
        context: { count: 0 },
        entry: ["plain", { type: "track", params: { id: 1 } }],
        on: { GO: { guard: "isPositive", actions: "plain" } },
        initial: "a",
        states: { a: { after: { soon: "b" } }, b: {} },
      })

      typed.createMachine({
        context: { count: 0 },
        // @ts-expect-error an unknown action name
        entry: "unknown",
      })

      typed.createMachine({
        context: { count: 0 },
        // @ts-expect-error a parameterized action named without its params
        entry: "track",
      })

      typed.createMachine({
        context: { count: 0 },
        // @ts-expect-error wrong params
        entry: { type: "track", params: { id: "one" } },
      })

      typed.createMachine({
        context: { count: 0 },
        on: {
          // @ts-expect-error an unknown guard name
          GO: { guard: "unknown" },
        },
      })

      typed.createMachine({
        context: { count: 0 },
        initial: "a",
        states: {
          a: {
            after: {
              soon: "b",
              // @ts-expect-error an unknown delay name
              never: "b",
            },
          },
          b: {},
        },
      })

      typed.createStateConfig({
        // @ts-expect-error an unknown action name in a state config
        entry: "unknown",
      })

      typed.raise({
        // @ts-expect-error an event outside the union
        type: "NOPE",
      })

      typed.raise(
        { type: "PING" },
        {
          // @ts-expect-error an unknown delay name
          delay: "never",
        }
      )

      typed.enqueueActions(({ enqueue, check }) => {
        enqueue("plain")
        check("isPositive")
        // @ts-expect-error an unknown action name
        enqueue("unknown")
        // @ts-expect-error an unknown guard name
        check("unknown")
      })

      typed.extend({ actions: { added: () => {} } }).createMachine({
        context: { count: 0 },
        entry: ["plain", "added"],
      })

      typed.extend({ actions: { added: () => {} } }).createMachine({
        context: { count: 0 },
        // @ts-expect-error an unknown action name after extend
        entry: "unknown",
      })

      // An extended setup's createStateConfig and bound helpers take the base and the added names
      const extendedTyped = typed.extend({
        actions: { added: () => {} },
        guards: { addedGuard: () => true },
        delays: { later: 200 },
      })
      extendedTyped.createStateConfig({
        entry: ["plain", "added"],
        on: { GO: [{ guard: "isPositive", target: "a" }, { guard: "addedGuard", target: "b" }] },
        after: { soon: "a", later: "b" },
      })
      extendedTyped.raise({ type: "PING" }, { delay: "later" })
      extendedTyped.enqueueActions(({ enqueue, check }) => {
        enqueue("plain")
        enqueue("added")
        check("addedGuard")
      })

      extendedTyped.createStateConfig({
        // @ts-expect-error an unknown action name in an extended setup's state config
        entry: "unknown",
      })

      extendedTyped.createStateConfig({
        on: {
          // @ts-expect-error an unknown guard name in an extended setup's state config
          GO: { guard: "unknown" },
        },
      })

      extendedTyped.raise(
        { type: "PING" },
        {
          // @ts-expect-error an unknown delay name in an extended setup's bound raise
          delay: "never",
        }
      )

      extendedTyped.enqueueActions(({ enqueue }) => {
        // @ts-expect-error an unknown action name in an extended setup's bound enqueueActions
        enqueue("unknown")
      })
    })
  )

  it.effect("[A19] the test type-check rejects unknown names in a raise, sendTo, spawnChild or enqueueActions written inline in a setup machine config", () =>
    Effect.sync(() => {
      const typed = setup({
        types: { context: {} as Ctx, events: {} as Ev },
        actors: { worker: fromCallback(() => {}) },
        actions: { plain: () => {} },
        guards: { isPositive: ({ context }) => context.count > 0 },
        delays: { soon: 100 },
      })

      // Known names are accepted
      typed.createMachine({
        context: { count: 0 },
        entry: [
          raise({ type: "PING" }, { delay: "soon" }),
          sendTo(({ self }) => self, { type: "PING" }, { delay: "soon" }),
          spawnChild("worker"),
          enqueueActions(({ enqueue, check }) => {
            if (check("isPositive")) {
              enqueue("plain")
            }
          }),
        ],
      })

      typed.createMachine({
        context: { count: 0 },
        entry: [
          raise(
            { type: "PING" },
            {
              // @ts-expect-error an unknown delay name
              delay: "never",
            }
          ),
          sendTo(
            ({ self }) => self,
            { type: "PING" },
            {
              // @ts-expect-error an unknown delay name
              delay: "never",
            }
          ),
          spawnChild(
            // @ts-expect-error an unknown actor name
            "unknown"
          ),
          enqueueActions(({ enqueue, check }) => {
            // @ts-expect-error an unknown action name
            enqueue("unknown")
            // @ts-expect-error an unknown guard name
            check("unknown")
          }),
        ],
      })
    })
  )

  it.effect("[A19] the test type-check rejects a tag the setup's types.tags does not declare, in a machine config, a state config and after extend", () =>
    Effect.sync(() => {
      // Upstream: setup's `TTag` types the `tags` of its machine and state configs
      const tagged = setup({ types: { tags: {} as "busy" | "idle" } })
      tagged.createMachine({ initial: "a", states: { a: { tags: ["busy", "idle"] }, b: { tags: "idle" } } })
      tagged.createMachine({
        initial: "a",
        states: {
          // @ts-expect-error a tag that types.tags does not declare
          a: { tags: ["busy", "unknown"] },
        },
      })
      tagged.createStateConfig({
        // @ts-expect-error a tag that types.tags does not declare, in a state config
        tags: "unknown",
      })
      tagged.extend({ actions: { noop: () => {} } }).createMachine({
        initial: "a",
        states: {
          // @ts-expect-error a tag that types.tags does not declare, after extend
          a: { tags: "unknown" },
        },
      })
      // A setup that declares no tags takes any tag
      setup({}).createMachine({ initial: "a", states: { a: { tags: ["anything"] } } })
    })
  )

  it.effect("[A19] a built-in action in an extend's actions may name a sibling extension action, and an unknown name stays a type error", () =>
    Effect.gen(function* () {
      // Upstream types an extension's built-ins by `ToParameterizedObject<TActions & TExtendActions>`
      const calls: Array<string> = []
      const extended = setup({ actions: { base: () => void calls.push("base") } }).extend({
        actions: {
          sibling: () => void calls.push("sibling"),
          both: enqueueActions(({ enqueue }) => {
            enqueue("base")
            enqueue("sibling")
          }),
        },
      })
      setup({ actions: { base: () => {} } }).extend({
        actions: {
          sibling: () => {},
          broken: enqueueActions(({ enqueue }) => {
            // @ts-expect-error an unknown action name in an extension's built-in
            enqueue("nonexistent")
          }),
        },
      })
      const actor = yield* createActor(extended.createMachine({ entry: "both" }))
      yield* actor.start
      assert.deepStrictEqual(calls, ["base", "sibling"])
    })
  )

  it.effect("[A19] a built-in action in setup's own actions names only the record's actions, and siblings take any params (DEV-63)", () =>
    Effect.gen(function* () {
      // Upstream types setup's own built-ins by `ToParameterizedObject<TActions>` and an
      // extension's by `ToParameterizedObject<TActions & TExtendActions>`: the port checks the
      // names of both records, not a sibling's params (ledger row DEV-63)
      const calls: Array<string> = []
      const own = setup({
        actions: {
          known: () => void calls.push("known"),
          withParams: (_: unknown, params: { readonly n: number }) => void calls.push(`withParams ${params.n}`),
          both: enqueueActions(({ enqueue }) => {
            enqueue("known")
            enqueue({ type: "withParams", params: { n: 1 } })
          }),
        },
      })
      setup({
        actions: {
          known: () => {},
          withParams: (_: unknown, _params: { readonly n: number }) => {},
          broken: enqueueActions(({ enqueue }) => {
            // @ts-expect-error an unknown action name in a built-in of setup's own actions
            enqueue("nonexistent")
            // @ts-expect-error an unknown action object in a built-in of setup's own actions
            enqueue({ type: "nonexistent" })
          }),
        },
      })
      const extended = setup({}).extend({
        actions: {
          withParams: (_: unknown, params: { readonly n: number }) => void calls.push(`extended ${params.n}`),
          both: enqueueActions(({ enqueue }) => {
            enqueue({ type: "withParams", params: { n: 2 } })
          }),
        },
      })

      yield* Effect.flatMap(createActor(own.createMachine({ entry: "both" })), (actor) => actor.start)
      yield* Effect.flatMap(createActor(extended.createMachine({ entry: "both" })), (actor) => actor.start)
      assert.deepStrictEqual(calls, ["known", "withParams 1", "extended 2"])
    })
  )
})
