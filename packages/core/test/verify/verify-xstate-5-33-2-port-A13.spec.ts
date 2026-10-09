/**
 * A13: inline function actions and plain functions in setup and provide run.
 *
 * T2.38. Upstream `resolveAndExecuteActionsWithContext` in `src/stateUtils.ts` and the
 * `actionExecutor` of `src/createActor.ts` at xstate@5.33.2: an inline function action, and a
 * plain function registered in `setup({ actions })`, `createMachine(config, { actions })` or
 * `machine.provide({ actions })`, is called as `fn({ context, event, self, system }, params)`;
 * the params are `undefined` for an inline function and for a string reference. `provide`
 * replaces the implementation of the same name and leaves the original machine unchanged.
 * An action name without an implementation is not an error: the executor sends one
 * `@xstate.action` inspection event for it and runs nothing. The port also runs the Effect
 * an inline action returns (port extension), and keeps its own `ActionDefinition` objects
 * (`exec`) working beside the XState forms (D15).
 *
 * The orchestrator gave this task the `initial: { target, actions }` config form too
 * (upstream `formatInitialTransition`): the initial transition's actions run after the
 * entry actions of its node and before the entry actions of the initial child.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Logger, Queue, Ref, Stream } from "effect"
import {
  type ActorLogicType,
  type ActorSystemService,
  type ActorType,
  createActor,
  createMachine,
  type EventObject,
  setup,
  type SnapshotType,
  Types,
} from "../../src/index.js"

/** Creates and starts an actor of `logic` with the given id. */
const startActor = <S extends SnapshotType, E extends EventObject, Em extends EventObject, R>(
  logic: ActorLogicType<S, E, unknown, Em, R>,
  id: string
) => Effect.tap(createActor(logic, { id }), (actor) => actor.start)

const valueOf = (snapshot: object): unknown => ("value" in snapshot ? snapshot.value : undefined)

/** Waits until the actor's snapshot value is `value`. */
const reach = (actor: Pick<ActorType.Any, "changes">, value: string) =>
  actor.changes.pipe(
    Stream.filter((snapshot) => valueOf(snapshot) === value),
    Stream.runHead
  )

/** An action definition (port form) that appends `label` to `log` each time it runs. */
const recorder = (log: Array<string>, label: string) => ({
  type: label,
  exec: () =>
    Effect.sync(() => {
      log.push(label)
      return Types.ActionResult.NoOp()
    }),
})

/** One `@xstate.action` inspection event: the action's type and params. */
interface InspectedAction {
  readonly type: string
  readonly params: unknown
}

/** Collects, in order, the `@xstate.action` inspection events of the actor `actorId`. */
const recordActions = (system: ActorSystemService, actorId: string) =>
  Effect.gen(function* () {
    const inspected = yield* Queue.unbounded<InspectedAction>()
    yield* system.inspect((inspectionEvent) =>
      inspectionEvent.type === "@xstate.action" && inspectionEvent.actorRef.id === actorId
        ? Queue.offer(inspected, { type: inspectionEvent.action.type, params: inspectionEvent.action.params }).pipe(
            Effect.asVoid
          )
        : Effect.void
    )
    return inspected
  })

interface Ctx {
  readonly count: number
}

type Ev = { readonly type: "GO" } | { readonly type: "NEXT" }

/** What one action call received. */
interface Call {
  readonly label: string
  readonly args: Types.ActionArgs<Ctx, Ev>
  readonly params: unknown
}

describe("A13 inline function actions and plain functions in setup and provide run", () => {
  it.effect("[A13] an inline function action receives { context, event, self, system } and undefined params", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const machine = createMachine<Ctx, Ev>({
        id: "a13",
        context: { count: 3 },
        initial: "idle",
        states: {
          idle: {
            entry: (args, params) => {
              calls.push({ label: "entry", args, params })
            },
            on: {
              GO: {
                target: "done",
                actions: [
                  (args, params) => {
                    calls.push({ label: "transition", args, params })
                  },
                ],
              },
            },
          },
          done: {},
        },
      })
      const actor = yield* startActor(machine, "a13")
      const system = actor.system

      yield* actor.send({ type: "GO" })
      yield* reach(actor, "done")

      assert.deepStrictEqual(
        calls.map(({ label, params }) => [label, params]),
        [
          ["entry", undefined],
          ["transition", undefined],
        ]
      )
      for (const { args } of calls) {
        // Exactly the XState argument object
        assert.deepStrictEqual(Object.keys(args).sort(), ["context", "event", "self", "system"])
        assert.deepStrictEqual(args.context, { count: 3 })
        assert.strictEqual(args.self, actor.ref)
        assert.strictEqual(args.system, system)
      }
      assert.strictEqual(calls[0]?.args.event.type, "xstate.init")
      assert.deepStrictEqual(calls[1]?.args.event, { type: "GO" })
    })
  )

  it.effect("[A13] a plain-function action in setup receives the arguments and its params, and machine.provide replaces it", () =>
    Effect.gen(function* () {
      const calls: Array<{ readonly source: string; readonly count: number; readonly event: string; readonly id: number }> = []
      // The whole argument object of each call, to check its keys, self and system
      const received: Array<{ readonly source: string; readonly args: object & { readonly self: unknown; readonly system: unknown } }> = []
      const base = setup({
        types: {} as { context: Ctx; events: Ev },
        actions: {
          track: (args, params: { readonly id: number }) => {
            const { context, event } = args
            received.push({ source: "setup", args })
            calls.push({ source: "setup", count: context.count, event: event.type, id: params.id })
          },
        },
      }).createMachine({
        id: "a13",
        context: { count: 1 },
        initial: "idle",
        states: {
          idle: {
            entry: { type: "track", params: { id: 1 } },
            on: { GO: { target: "done", actions: { type: "track", params: () => ({ id: 2 }) } } },
          },
          done: {},
        },
      })
      const provided = base.provide({
        actions: {
          track: (args, params: { readonly id: number }) => {
            const { context, event } = args
            received.push({ source: "provide", args })
            calls.push({ source: "provide", count: context.count, event: event.type, id: params.id })
          },
        },
      })

      const providedActor = yield* startActor(provided, "provided")
      yield* providedActor.send({ type: "GO" })
      yield* reach(providedActor, "done")
      const baseActor = yield* startActor(base, "base")
      yield* baseActor.send({ type: "GO" })
      yield* reach(baseActor, "done")

      assert.deepStrictEqual(calls, [
        { source: "provide", count: 1, event: "xstate.init", id: 1 },
        { source: "provide", count: 1, event: "GO", id: 2 },
        { source: "setup", count: 1, event: "xstate.init", id: 1 },
        { source: "setup", count: 1, event: "GO", id: 2 },
      ])

      // Each plain function receives exactly the XState argument object, with the self and the
      // system of the actor that runs it: the provided actor for provide, the base actor for setup
      assert.deepStrictEqual(
        received.map(({ source }) => source),
        ["provide", "provide", "setup", "setup"]
      )
      for (const { source, args } of received) {
        const owner = source === "provide" ? providedActor : baseActor
        assert.deepStrictEqual(Object.keys(args).sort(), ["context", "event", "self", "system"], source)
        assert.strictEqual(args.self, owner.ref, `${source}: self is the running actor`)
        assert.strictEqual(args.system, owner.system, `${source}: system is that actor's system`)
      }
      assert.notStrictEqual(providedActor.system, baseActor.system, "each root actor owns its system")
    })
  )

  it.effect("[A13] an inline action that returns an Effect has it run; one that returns undefined or another value is fine", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const ran = yield* Ref.make(0)
      const machine = createMachine<Ctx, Ev>({
        id: "a13",
        context: { count: 0 },
        initial: "idle",
        states: {
          idle: {
            entry: [
              () => Ref.update(ran, (n) => n + 1),
              () => undefined,
              () => log.push("returns a number"),
              () => Effect.sync(() => log.push("effect ran")),
            ],
            on: { GO: { target: "done", actions: () => Ref.update(ran, (n) => n + 10) } },
          },
          done: {},
        },
      })
      const actor = yield* startActor(machine, "a13")

      assert.strictEqual(yield* Ref.get(ran), 1)
      assert.deepStrictEqual(log, ["returns a number", "effect ran"])

      yield* actor.send({ type: "GO" })
      yield* reach(actor, "done")
      assert.strictEqual(yield* Ref.get(ran), 11)
    })
  )

  it.effect("[A13] an unknown named action is not a crash: it gives one @xstate.action inspection entry and no warning", () =>
    Effect.gen(function* () {
      const warnings: Array<unknown> = []
      const log: Array<string> = []
      const machine = createMachine<Ctx, Ev>(
        {
          id: "a13",
          context: { count: 0 },
          initial: "idle",
          states: {
            idle: {
              entry: ["unknownName", { type: "unknownObject", params: { x: 1 } }, "known"],
              on: { GO: { target: "done", actions: { type: "unknownOnTransition", params: () => ({ y: 2 }) } } },
            },
            done: { entry: "known" },
          },
        },
        { actions: { known: () => log.push("known") } }
      )
      const program = Effect.gen(function* () {
        // Each root actor owns its system: inspect it after creation, before start
        const actor = yield* createActor(machine, { id: "a13" })
        const inspected = yield* recordActions(actor.system, "a13")
        yield* actor.start
        yield* actor.send({ type: "GO" })
        const reached = yield* reach(actor, "done")
        return { inspected: yield* Queue.clear(inspected), reached }
      })
      const { inspected, reached } = yield* program.pipe(
        Effect.provide(
          Logger.layer([
            Logger.make((options) => {
              if (options.logLevel === "Warn") {
                warnings.push(options.message)
              }
            }),
          ])
        )
      )

      assert.isTrue(reached._tag === "Some")
      assert.deepStrictEqual(log, ["known", "known"])
      assert.deepStrictEqual(inspected, [
        { type: "unknownName", params: undefined },
        { type: "unknownObject", params: { x: 1 } },
        { type: "known", params: undefined },
        { type: "unknownOnTransition", params: { y: 2 } },
        { type: "known", params: undefined },
      ])
      assert.deepStrictEqual(warnings, [])
    })
  )

  it.effect("[A13] port action definitions keep working beside the XState forms in one action list, in order", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      // The list runs on a transition, while the actor runs. In the initial state a port
      // definition runs with the initial snapshot at creation and a custom action waits for
      // start (T2.40), so only a running actor interleaves them in list order.
      const machine = createMachine<Ctx, Ev>(
        {
          id: "a13",
          context: { count: 0 },
          initial: "idle",
          states: {
            idle: { on: { GO: "busy" } },
            busy: {
              entry: [
                recorder(log, "inline definition"),
                "namedFunction",
                { type: "namedDefinition" },
                () => {
                  log.push("inline function")
                },
                "namedDefinition",
              ],
            },
          },
        },
        {
          actions: {
            namedFunction: () => log.push("named function"),
            namedDefinition: recorder(log, "named definition"),
          },
        }
      )
      const actor = yield* startActor(machine, "a13")
      yield* actor.send({ type: "GO" })
      yield* reach(actor, "busy")

      assert.deepStrictEqual(log, [
        "inline definition",
        "named function",
        "named definition",
        "inline function",
        "named definition",
      ])
    })
  )

  it.effect("[A13] the inline actions of initial: { target, actions } run after their node's entry and before the initial child's entry", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const machine = createMachine<Ctx, Ev>(
        {
          id: "a13",
          context: { count: 0 },
          initial: { target: "idle", actions: () => log.push("initial root") },
          states: {
            idle: { entry: () => log.push("entry idle"), on: { GO: "parent" } },
            parent: {
              entry: () => log.push("entry parent"),
              initial: {
                target: "child",
                actions: [() => log.push("initial parent"), { type: "track", params: { id: 3 } }],
              },
              states: {
                child: { entry: () => log.push("entry child") },
              },
            },
          },
        },
        { actions: { track: (_, params: { readonly id: number }) => log.push(`track ${params.id}`) } }
      )
      const actor = yield* startActor(machine, "a13")

      assert.deepStrictEqual(log, ["initial root", "entry idle"])

      yield* actor.send({ type: "GO" })
      const reached = yield* actor.changes.pipe(
        Stream.filter((snapshot) => {
          const value: unknown = valueOf(snapshot)
          return typeof value === "object" && value !== null && "parent" in value
        }),
        Stream.runHead
      )
      assert.isTrue(reached._tag === "Some")
      assert.deepStrictEqual(log, [
        "initial root",
        "entry idle",
        "entry parent",
        "initial parent",
        "track 3",
        "entry child",
      ])
    })
  )
})
