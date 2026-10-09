/**
 * A12: parameterized actions receive their per-use params.
 *
 * T2.38. Upstream `resolveAndExecuteActionsWithContext` in `src/stateUtils.ts` at
 * xstate@5.33.2: for a `{ type, params }` action the engine looks the implementation up by
 * `type` and calls it with the params of that use, as its second argument: a static value
 * as written, or the result of `params({ context, event })`, computed with the context that
 * the earlier actions of the same list left. A string reference gets `undefined`. Params
 * stored on the implementation play no part (the port's `ActionDefinition` has a `params`
 * slot; upstream implementations have none).
 *
 * The specs run real actors, not `getNextSnapshot`, because the pure functions stop running
 * custom actions in T6.9 (P7).
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Stream } from "effect"
import {
  type ActorLogicType,
  type ActorType,
  assign,
  createActor,
  createMachine,
  type EventObject,
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

interface Ctx {
  readonly count: number
}

type Ev = { readonly type: "GO"; readonly n: number } | { readonly type: "NEXT" }

describe("A12 parameterized actions receive their per-use params", () => {
  it.effect("[A12] a named action used twice with static params and once with dynamic params gets the params of each use", () =>
    Effect.gen(function* () {
      const calls: Array<unknown> = []
      const machine = createMachine<Ctx, Ev>(
        {
          id: "a12",
          context: { count: 5 },
          initial: "idle",
          states: {
            idle: {
              on: {
                GO: {
                  target: "done",
                  actions: [
                    { type: "track", params: { id: 1 } },
                    { type: "track", params: { id: 2 } },
                    {
                      type: "track",
                      params: ({ context, event }) => ({ id: context.count + (event.type === "GO" ? event.n : 0) }),
                    },
                  ],
                },
              },
            },
            done: {},
          },
        },
        { actions: { track: (_, params) => calls.push(params) } }
      )
      const actor = yield* startActor(machine, "a12")

      const go: Ev = { type: "GO", n: 10 }
      yield* actor.send(go)
      yield* reach(actor, "done")

      assert.deepStrictEqual(calls, [{ id: 1 }, { id: 2 }, { id: 15 }])
    })
  )

  it.effect("[A12] dynamic params are computed from the context the earlier actions left and from the event", () =>
    Effect.gen(function* () {
      const calls: Array<unknown> = []
      const paramsArgs: Array<ReadonlyArray<string>> = []
      const machine = createMachine<Ctx, Ev>(
        {
          id: "a12",
          context: { count: 0 },
          initial: "idle",
          states: {
            idle: {
              entry: [
                assign<Ctx, Ev>({ count: 7 }),
                {
                  type: "track",
                  params: (args) => {
                    paramsArgs.push(Object.keys(args).sort())
                    return { count: args.context.count, event: args.event.type }
                  },
                },
              ],
              on: {
                NEXT: {
                  target: "done",
                  actions: [
                    assign<Ctx, Ev>(({ context }) => ({ count: context.count + 1 })),
                    { type: "track", params: ({ context, event }) => ({ count: context.count, event: event.type }) },
                  ],
                },
              },
            },
            done: {},
          },
        },
        { actions: { track: (_, params) => calls.push(params) } }
      )
      const actor = yield* startActor(machine, "a12")

      assert.deepStrictEqual(calls, [{ count: 7, event: "xstate.init" }])

      yield* actor.send({ type: "NEXT" })
      yield* reach(actor, "done")

      assert.deepStrictEqual(calls, [
        { count: 7, event: "xstate.init" },
        { count: 8, event: "NEXT" },
      ])
      // The params function receives `{ context, event }` only (upstream)
      assert.deepStrictEqual(paramsArgs, [["context", "event"]])
    })
  )

  it.effect("[A12] a named port definition receives the use-site params, not the params stored on it", () =>
    Effect.gen(function* () {
      const calls: Array<unknown> = []
      // A port `ActionDefinition` with params of its own; the use site's params win
      const stored = {
        type: "track",
        params: { id: "stored" },
        exec: (_ctx: unknown, params: unknown) =>
          Effect.sync(() => {
            calls.push(params)
            return Types.ActionResult.NoOp()
          }),
      }
      const machine = createMachine<Ctx, Ev>(
        {
          id: "a12",
          context: { count: 0 },
          initial: "idle",
          states: {
            idle: {
              on: {
                GO: {
                  target: "done",
                  actions: [{ type: "track", params: { id: "use" } }, { type: "track", params: ({ event }) => ({ id: event.type }) }],
                },
              },
            },
            done: {},
          },
        },
        { actions: { track: stored } }
      )
      const actor = yield* startActor(machine, "a12")

      const go: Ev = { type: "GO", n: 1 }
      yield* actor.send(go)
      yield* reach(actor, "done")

      assert.deepStrictEqual(calls, [{ id: "use" }, { id: "GO" }])
    })
  )

  it.effect("[A12] a string reference gives the implementation undefined params", () =>
    Effect.gen(function* () {
      const calls: Array<{ readonly name: string; readonly params: unknown }> = []
      const stored = {
        type: "storedDefinition",
        params: { id: "stored" },
        exec: (_ctx: unknown, params: unknown) =>
          Effect.sync(() => {
            calls.push({ name: "storedDefinition", params })
            return Types.ActionResult.NoOp()
          }),
      }
      // The list runs on a transition, while the actor runs: in the initial state the port
      // definition would run with the initial snapshot at creation and the plain functions
      // at start (T2.40), out of list order.
      const machine = createMachine<Ctx, Ev>(
        {
          id: "a12",
          context: { count: 0 },
          initial: "idle",
          states: {
            idle: { on: { NEXT: "done" } },
            done: {
              entry: ["plainFunction", "storedDefinition", { type: "plainFunction" }],
            },
          },
        },
        {
          actions: {
            plainFunction: (_, params) => calls.push({ name: "plainFunction", params }),
            storedDefinition: stored,
          },
        }
      )
      const actor = yield* startActor(machine, "a12")
      yield* actor.send({ type: "NEXT" })
      yield* reach(actor, "done")

      assert.deepStrictEqual(calls, [
        { name: "plainFunction", params: undefined },
        { name: "storedDefinition", params: undefined },
        { name: "plainFunction", params: undefined },
      ])
    })
  )
})
