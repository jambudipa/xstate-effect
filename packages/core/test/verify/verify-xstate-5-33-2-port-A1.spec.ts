/**
 * A1: property assigners compute each key.
 *
 * T4.11. Upstream `resolveAssign` in `src/actions/assign.ts` at xstate@5.33.2:
 *
 * - a snapshot whose `context` is falsy throws `Cannot assign to undefined \`context\`.
 *   Ensure that \`context\` is defined in the machine config.` before any assigner runs;
 * - the function form is called as `assignment(assignArgs, actionParams)`;
 * - in the object form, each function-valued key is a property assigner, called as
 *   `propAssignment(assignArgs, actionParams)`, and any other value is copied as it is;
 * - every assigner of one assign reads the same `assignArgs.context`: the context from
 *   before the action, not the keys the same assign computed earlier;
 * - the update is `Object.assign({}, snapshot.context, partialUpdate)`.
 *
 * `actionParams` are the params of the use (A12): a `{ type, params }` use that names an
 * assign gives them; an inline assign and a string reference give `undefined`. What an
 * assigner throws is a defect that carries the value (SD-4, T2.46), so the actor ends with
 * status `error` and that value. The port keeps its own forms: an assigner may return an
 * Effect of the partial context, and `assignProperty(key, value)` sets one key.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import {
  assign,
  assignProperty,
  createActor,
  createMachine,
  type EventObject,
  type SnapshotType,
} from "../../src/index.js"
import { assignToUndefinedContext } from "./upstream-messages.js"

interface Ctx {
  readonly count: number
  readonly label: string
  readonly other: string
}

type Ev = { readonly type: "INC"; readonly by: number } | { readonly type: "NEXT" }

const initial: Ctx = { count: 0, label: "", other: "kept" }

/** The error the snapshot holds; fails the test when it holds none. */
const errorOf = (snapshot: SnapshotType): unknown => {
  assert.isTrue(Option.isSome(snapshot.error), "the snapshot holds an error")
  return Option.getOrUndefined(snapshot.error)
}

describe("A1 Property assigners compute each key", () => {
  it.effect("[A1] an assign with a function-valued key and a static key computes the function key and copies the static key", () =>
    Effect.gen(function* () {
      const machine = createMachine<Ctx, Ev>({
        id: "a1",
        initial: "a",
        context: initial,
        states: {
          a: {
            on: {
              INC: { actions: assign({ count: ({ context, event }) => context.count + (event.type === "INC" ? event.by : 0), label: "x" }) },
            },
          },
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      yield* actor.send({ type: "INC", by: 3 })

      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.status, "active")
      assert.deepStrictEqual(snapshot.context, { count: 3, label: "x", other: "kept" })
    })
  )

  it.effect("[A1] each property assigner receives the action context and reads the context from before the assign", () =>
    Effect.gen(function* () {
      const seen: Array<ReadonlyArray<string>> = []
      const machine = createMachine<Ctx, Ev>({
        id: "a1-args",
        initial: "a",
        context: { count: 2, label: "", other: "kept" },
        states: {
          a: {
            on: {
              NEXT: {
                actions: assign({
                  count: (args) => {
                    seen.push(Object.keys(args))
                    return args.context.count + 1
                  },
                  // Upstream passes one `assignArgs` to every key: the pre-update context
                  label: ({ context }) => `count was ${context.count}`,
                }),
              },
            },
          },
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      yield* actor.send({ type: "NEXT" })

      assert.deepStrictEqual((yield* actor.getSnapshot).context, { count: 3, label: "count was 2", other: "kept" })
      // Upstream `assignArgs` is `{ context, event, spawn, self, system }`
      assert.includeMembers([...(seen[0] ?? [])], ["context", "event", "spawn", "self", "system"])
    })
  )
})

describe("A1 params reach the assigner and each property assigner", () => {
  it.effect("[A1] a { type, params } use that names an assign gives its static params to each property assigner", () =>
    Effect.gen(function* () {
      const machine = createMachine<Ctx, Ev>(
        {
          id: "a1-static",
          initial: "a",
          context: initial,
          entry: { type: "inc", params: { by: 10 } },
          states: { a: {} },
        },
        {
          actions: {
            inc: assign<Ctx, Ev, { readonly by: number }>({
              count: ({ context }, params) => context.count + params.by,
              label: (_, params) => `by ${params.by}`,
            }),
          },
        }
      )
      const actor = yield* createActor(machine)
      yield* actor.start

      assert.deepStrictEqual((yield* actor.getSnapshot).context, { count: 10, label: "by 10", other: "kept" })
    })
  )

  it.effect("[A1] a { type, params } use with dynamic params gives their result to the function assigner", () =>
    Effect.gen(function* () {
      const machine = createMachine<Ctx, Ev>(
        {
          id: "a1-dynamic",
          initial: "a",
          context: initial,
          states: {
            a: {
              on: {
                INC: { actions: { type: "add", params: ({ context, event }) => ({ by: context.count + (event.type === "INC" ? event.by : 0) }) } },
              },
            },
          },
        },
        {
          actions: {
            add: assign<Ctx, Ev, { readonly by: number }>(({ context }, params) => ({ count: context.count + params.by })),
          },
        }
      )
      const actor = yield* createActor(machine)
      yield* actor.start

      yield* actor.send({ type: "INC", by: 4 })
      yield* actor.send({ type: "INC", by: 1 })

      // 0 + (0 + 4) = 4, then 4 + (4 + 1) = 9
      assert.strictEqual((yield* actor.getSnapshot).context.count, 9)
    })
  )

  it.effect("[A1] a parameterized action that resolves to assign() is given the params (upstream assign meta)", () =>
    Effect.gen(function* () {
      const seen: Array<unknown> = []
      const machine = createMachine(
        {
          id: "a1-meta",
          on: { EVENT: { actions: { type: "inc", params: { value: 5 } } } },
        },
        {
          actions: {
            inc: assign<unknown, EventObject, { readonly value: number }>((_, params) => {
              seen.push(params)
              return {}
            }),
          },
        }
      )
      const actor = yield* createActor(machine)
      yield* actor.start

      yield* actor.send({ type: "EVENT" })

      assert.deepStrictEqual(seen, [{ value: 5 }])
      assert.strictEqual((yield* actor.getSnapshot).status, "active")
    })
  )

  it.effect("[A1] an inline assign and a string reference to an assign give the assigners undefined params", () =>
    Effect.gen(function* () {
      const seen: Array<string> = []
      const record = (where: string, params: unknown) => {
        seen.push(`${where}:${String(params)}`)
      }
      const machine = createMachine<Ctx, Ev>(
        {
          id: "a1-none",
          initial: "a",
          context: initial,
          states: {
            a: {
              on: {
                NEXT: {
                  actions: [
                    assign({
                      count: ({ context }, params) => {
                        record("inline property", params)
                        return context.count + 1
                      },
                    }),
                    assign((_, params) => {
                      record("inline function", params)
                      return {}
                    }),
                    "named",
                  ],
                },
              },
            },
          },
        },
        {
          actions: {
            named: assign<Ctx, Ev, unknown>({
              label: (_, params) => {
                record("named property", params)
                return "named"
              },
            }),
          },
        }
      )
      const actor = yield* createActor(machine)
      yield* actor.start

      yield* actor.send({ type: "NEXT" })

      assert.deepStrictEqual(seen, ["inline property:undefined", "inline function:undefined", "named property:undefined"])
      assert.deepStrictEqual((yield* actor.getSnapshot).context, { count: 1, label: "named", other: "kept" })
    })
  )

  it.effect("[A1] the params type argument types the params of the assigner and of each property assigner; a property assigner returns its key's type", () =>
    Effect.sync(() => {
      const typed = assign<Ctx, Ev, { readonly by: number }>({
        count: ({ context }, params) => context.count + params.by,
        label: "static",
      })
      const typedFunction = assign<Ctx, Ev, { readonly by: number }>(({ context }, params) => ({
        count: context.count * params.by,
      }))
      // @ts-expect-error the params type has no `missing` key
      const missingKey = assign<Ctx, Ev, { readonly by: number }>({ count: (_, params) => params.missing })
      // @ts-expect-error `count` is a number, so its property assigner cannot return a string
      const wrongType = assign<Ctx, Ev>({ count: () => "text" })
      assert.strictEqual(typed.type, "xstate.assign")
      assert.strictEqual(typedFunction.type, "xstate.assign")
      assert.strictEqual(missingKey.type, "xstate.assign")
      assert.strictEqual(wrongType.type, "xstate.assign")
    })
  )
})

describe("A1 errors in an assign set status error", () => {
  it.effect("[A1] a throwing property assigner sets status error with the thrown value and keeps the pre-event snapshot", () =>
    Effect.gen(function* () {
      const thrown = new Error("thrown in a property assigner")
      const machine = createMachine<Ctx, Ev>({
        id: "a1-throw",
        initial: "a",
        context: initial,
        states: {
          a: {
            on: {
              NEXT: {
                target: "b",
                actions: assign({
                  label: "changed",
                  count: () => {
                    throw thrown
                  },
                }),
              },
            },
          },
          b: {},
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      yield* actor.send({ type: "NEXT" })

      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.status, "error")
      assert.strictEqual(errorOf(snapshot), thrown)
      assert.strictEqual(snapshot.value, "a")
      assert.deepStrictEqual(snapshot.context, initial)
    })
  )

  it.effect("[A1] a throwing function assigner and an assigner Effect that fails also set status error with their value", () =>
    Effect.gen(function* () {
      const thrown = new Error("thrown in an assigner")
      const failure = new Error("failed in an assigner Effect")
      const outcomes = yield* Effect.forEach(
        [
          assign<Ctx, Ev>(() => {
            throw thrown
          }),
          assign<Ctx, Ev>(() => Effect.fail(failure)),
        ],
        (action, index) =>
          Effect.gen(function* () {
            const machine = createMachine<Ctx, Ev>({
              id: `a1-fail-${index}`,
              initial: "a",
              context: initial,
              states: { a: { on: { NEXT: { actions: action } } } },
            })
            const actor = yield* createActor(machine)
            yield* actor.start
            yield* actor.send({ type: "NEXT" })
            const snapshot = yield* actor.getSnapshot
            return { status: snapshot.status, error: errorOf(snapshot) }
          })
      )

      assert.deepStrictEqual(outcomes.map((outcome) => outcome.status), ["error", "error"])
      assert.strictEqual(outcomes[0]?.error, thrown)
      assert.strictEqual(outcomes[1]?.error, failure)
    })
  )

  it.effect("[A1] an assign on a snapshot without context sets status error with the upstream message before any assigner runs", () =>
    Effect.gen(function* () {
      const calls: Array<string> = []
      const machine = createMachine<Ctx, Ev>({
        id: "a1-no-context",
        initial: "a",
        context: initial,
        states: {
          a: {
            on: {
              NEXT: {
                target: "b",
                actions: assign({
                  count: () => {
                    calls.push("count")
                    return 1
                  },
                  label: "static",
                }),
              },
            },
          },
          b: {},
        },
      })
      const first = yield* createActor(machine)
      yield* first.start
      const persisted = (yield* first.getPersistedSnapshot) as Readonly<Record<string, unknown>>
      // A persisted snapshot without a context restores without one (upstream spreads it)
      const withoutContext = Object.fromEntries(Object.entries(persisted).filter(([key]) => key !== "context"))
      const restored = yield* createActor(machine, { snapshot: withoutContext })
      yield* restored.start

      yield* restored.send({ type: "NEXT" })

      const snapshot = yield* restored.getSnapshot
      assert.strictEqual(snapshot.status, "error")
      assert.strictEqual(snapshot.value, "a")
      assert.deepStrictEqual(calls, [])
      const error = errorOf(snapshot)
      assert.instanceOf(error, Error)
      assert.strictEqual((error as Error).message, assignToUndefinedContext)
      // Upstream throws a plain `Error`, which prints as [Error: <message>]
      assert.strictEqual(String(error), `Error: ${assignToUndefinedContext}`)
    })
  )
})

describe("A1 the existing assign forms keep working", () => {
  it.effect("[A1] assign(fn), a static partial object and an Effect-returning assigner update the context in list order", () =>
    Effect.gen(function* () {
      const machine = createMachine<Ctx, Ev>({
        id: "a1-compat",
        initial: "a",
        context: initial,
        states: {
          a: {
            on: {
              NEXT: {
                actions: [
                  assign<Ctx, Ev>(({ context }) => ({ count: context.count + 1 })),
                  assign<Ctx, Ev>({ label: "static" }),
                  assign<Ctx, Ev>(({ context }) => Effect.succeed({ count: context.count * 10 })),
                ],
              },
            },
          },
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      yield* actor.send({ type: "NEXT" })

      assert.deepStrictEqual((yield* actor.getSnapshot).context, { count: 10, label: "static", other: "kept" })
    })
  )

  it.effect("[A1] assignProperty sets one key from a value, or from a function of the action context and the params", () =>
    Effect.gen(function* () {
      const machine = createMachine<Ctx, Ev>(
        {
          id: "a1-property",
          initial: "a",
          context: initial,
          states: {
            a: {
              on: {
                NEXT: {
                  actions: [
                    assignProperty<Ctx, Ev, "label">("label", "set"),
                    assignProperty<Ctx, Ev, "count">("count", ({ context }) => context.count + 2),
                    { type: "scale", params: { times: 5 } },
                  ],
                },
              },
            },
          },
        },
        {
          actions: {
            scale: assignProperty<Ctx, Ev, "count", { readonly times: number }>(
              "count",
              ({ context }, params) => context.count * params.times
            ),
          },
        }
      )
      const actor = yield* createActor(machine)
      yield* actor.start

      yield* actor.send({ type: "NEXT" })

      assert.deepStrictEqual((yield* actor.getSnapshot).context, { count: 10, label: "set", other: "kept" })
    })
  )
})
