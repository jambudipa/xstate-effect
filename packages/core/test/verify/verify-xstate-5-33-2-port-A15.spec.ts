/**
 * A15: and, or and not resolve named guards.
 *
 * T2.39. Upstream `and`, `or`, `not` and `evaluateGuard` in `src/guards.ts` at
 * xstate@5.33.2: a combinator evaluates each of its guards with the one shared evaluator, so
 * a guard name inside it resolves against the machine's implementations at any nesting
 * depth, a `{ type, params }` guard inside it gets its own static or dynamic params, and an
 * inline function inside it gets `undefined` params. `and` is `every` (it stops at the first
 * false), `or` is `some` (it stops at the first true), `not` negates. A combinator can be a
 * named implementation itself, and an implementation can be the name of another guard
 * (resolved recursively); a combinator used by name ignores the params of that use, because
 * it carries its own guards. The `guards` entry point exports the shared `evaluateGuard`.
 * The port keeps its combinator objects (`type: 'xstate.and'`, `predicate`) and their
 * optional `implementations` argument (D15). An unknown name fails the guard Effect with
 * `GuardError` and the upstream message (S16 gives the actor its `error` status in T3.17).
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import {
  type ActorLogicType,
  and,
  createMachine,
  type EventObject,
  getInitialSnapshot,
  getNextSnapshot,
  guards,
  type MachineSnapshot,
  not,
  or,
  setup,
  stateIn,
  stateNotIn,
  type Types,
  when,
} from "../../src/index.js"

/** The initial snapshot through `getInitialSnapshot`, widened until T2.40 (as S2 and S6 do). */
const initialSnapshotOf = (machine: object): Effect.Effect<MachineSnapshot> =>
  getInitialSnapshot(machine as ActorLogicType.Any, undefined) as unknown as Effect.Effect<MachineSnapshot>

/** The next snapshot through `getNextSnapshot` (same widening). */
const nextSnapshotOf = <E extends EventObject>(machine: object, snapshot: MachineSnapshot, event: E): Effect.Effect<MachineSnapshot> =>
  getNextSnapshot(machine as ActorLogicType.Any, snapshot, event) as unknown as Effect.Effect<MachineSnapshot>

/** The state value after one event from the initial snapshot. */
const valueAfter = <E extends EventObject>(machine: object, event: E) =>
  Effect.gen(function* () {
    const initial = yield* initialSnapshotOf(machine)
    return (yield* nextSnapshotOf(machine, initial, event)).value
  })

interface Flags {
  readonly a: boolean
  readonly b: boolean
}

type FlagEvent = { readonly type: "AND" } | { readonly type: "OR" } | { readonly type: "NOT" } | { readonly type: "NESTED" }

/**
 * Setup guards `isA` and `isB` read the context; each event's transition is guarded by one
 * combination of them and is taken only when it holds.
 */
const flagsMachine = (flags: Flags) =>
  setup({
    types: {} as { context: Flags; events: FlagEvent },
    guards: {
      isA: ({ context }) => context.a,
      isB: ({ context }) => context.b,
    },
  }).createMachine({
    id: "a15",
    context: flags,
    initial: "idle",
    states: {
      idle: {
        on: {
          AND: { target: "taken", guard: and(["isA", not("isB")]) },
          OR: { target: "taken", guard: or(["isA", "isB"]) },
          NOT: { target: "taken", guard: not("isA") },
          // a == b, three levels deep
          NESTED: { target: "taken", guard: or([and(["isA", "isB"]), not(or(["isA", not(not("isB"))]))]) },
        },
      },
      taken: {},
    },
  })

interface Ctx {
  readonly count: number
}

type Ev = { readonly type: "EV"; readonly secret: number } | { readonly type: "OTHER" }

/** The secret an `EV` event carries; 0 for any other event. */
const secretOf = (event: Ev): number => (event.type === "EV" ? event.secret : 0)

/** A guard scope for direct `evaluateGuard` calls: no actor is needed by XState-form guards. */
const scopeWith = (implementations: Types.MachineImplementations<Ctx, Ev>): Types.GuardScope<Ctx, Ev> => ({
  self: {} as Types.GuardScope<Ctx, Ev>["self"],
  system: {} as Types.GuardScope<Ctx, Ev>["system"],
  implementations,
})

describe("A15 and, or and not resolve named guards", () => {
  it.effect("[A15] and, or and not over setup guard names follow the boolean combination for every input, at any depth", () =>
    Effect.gen(function* () {
      for (const a of [false, true]) {
        for (const b of [false, true]) {
          const machine = flagsMachine({ a, b })
          const expected: ReadonlyArray<readonly [FlagEvent["type"], boolean]> = [
            ["AND", a && !b],
            ["OR", a || b],
            ["NOT", !a],
            ["NESTED", a === b],
          ]
          for (const [type, holds] of expected) {
            assert.strictEqual(yield* valueAfter(machine, { type }), holds ? "taken" : "idle", `${type} with a=${a} b=${b}`)
          }
        }
      }
    })
  )

  it.effect("[A15] a combinator can be a named implementation, and a name or { type, params } implementation resolves recursively", () =>
    Effect.gen(function* () {
      const machine = createMachine<Ctx, Ev>(
        {
          id: "a15",
          context: { count: 3 },
          initial: "idle",
          states: {
            idle: {
              on: {
                EV: [
                  { target: "composite", guard: "referenced" },
                  { target: "alias", guard: "ref1" },
                ],
                OTHER: { target: "object", guard: "objectAlias" },
              },
            },
            composite: {},
            alias: {},
            object: {},
          },
        },
        {
          guards: {
            truthy: () => true,
            falsy: () => false,
            secretIsOne: ({ event }) => secretOf(event) === 1,
            atLeast: ({ context }, params: { readonly min: number }) => context.count >= params.min,
            // true exactly when the secret is 1
            referenced: or([() => false, not("truthy"), and([not("falsy"), "truthy", "secretIsOne"])]),
            ref1: "ref2",
            ref2: "ref3",
            ref3: ({ event }) => secretOf(event) === 2,
            objectAlias: { type: "atLeast", params: { min: 3 } },
          },
        }
      )

      assert.strictEqual(yield* valueAfter(machine, { type: "EV", secret: 1 }), "composite")
      assert.strictEqual(yield* valueAfter(machine, { type: "EV", secret: 2 }), "alias")
      assert.strictEqual(yield* valueAfter(machine, { type: "EV", secret: 3 }), "idle")
      assert.strictEqual(yield* valueAfter(machine, { type: "OTHER" }), "object")
    })
  )

  it.effect("[A15] static and dynamic params reach the guards inside not, and and or", () =>
    Effect.gen(function* () {
      const seen: Array<readonly [string, unknown]> = []
      const machine = createMachine<Ctx, Ev>(
        {
          id: "a15",
          context: { count: 7 },
          initial: "idle",
          states: {
            idle: {
              on: {
                EV: [
                  { target: "not", guard: not({ type: "record", params: { via: "not" } }) },
                  {
                    target: "and",
                    guard: and([
                      { type: "record", params: ({ context, event }) => ({ via: "and", sum: context.count + secretOf(event) }) },
                      () => true,
                    ]),
                  },
                ],
                OTHER: { target: "or", guard: or([{ type: "record", params: ({ context }) => ({ via: "or", count: context.count }) }]) },
              },
            },
            not: {},
            and: {},
            or: {},
          },
        },
        {
          guards: {
            record: (_, params: { readonly via: string }) => {
              seen.push([params.via, params])
              return true
            },
          },
        }
      )

      assert.strictEqual(yield* valueAfter(machine, { type: "EV", secret: 42 }), "and")
      assert.strictEqual(yield* valueAfter(machine, { type: "OTHER" }), "or")
      assert.deepStrictEqual(seen, [
        ["not", { via: "not" }],
        ["and", { via: "and", sum: 49 }],
        ["or", { via: "or", count: 7 }],
      ])
    })
  )

  it.effect("[A15] a combinator used by name ignores the params of that use: its inline guards get undefined and its { type, params } guards their own params", () =>
    Effect.gen(function* () {
      const seen: Array<readonly [string, unknown]> = []
      const machine = createMachine<Ctx, Ev>(
        {
          id: "a15",
          context: { count: 0 },
          initial: "idle",
          states: {
            idle: {
              on: {
                EV: { target: "done", guard: { type: "myNot", params: "foo" } },
                OTHER: { target: "done", guard: { type: "myAnd", params: "bar" } },
              },
            },
            done: {},
          },
        },
        {
          guards: {
            other: (_, params) => {
              seen.push(["other", params])
              return true
            },
            myNot: not((_, params) => {
              seen.push(["inline in not", params])
              return false
            }),
            myAnd: and(["other", { type: "other", params: 42 }, (_, params) => {
              seen.push(["inline in and", params])
              return true
            }]),
          },
        }
      )

      assert.strictEqual(yield* valueAfter(machine, { type: "EV", secret: 0 }), "done")
      assert.strictEqual(yield* valueAfter(machine, { type: "OTHER" }), "done")
      assert.deepStrictEqual(seen, [
        ["inline in not", undefined],
        ["other", undefined],
        ["other", 42],
        ["inline in and", undefined],
      ])
    })
  )

  it.effect("[A15] and stops at the first false and or stops at the first true", () =>
    Effect.gen(function* () {
      const evaluated: Array<string> = []
      const probe = (label: string, result: boolean) => () => {
        evaluated.push(label)
        return result
      }
      const machine = createMachine<Ctx, Ev>({
        id: "a15",
        context: { count: 0 },
        initial: "idle",
        states: {
          idle: {
            on: {
              EV: { target: "done", guard: and([probe("and 1", true), probe("and 2", false), probe("and 3", true)]) },
              OTHER: { target: "done", guard: or([probe("or 1", false), probe("or 2", true), probe("or 3", false)]) },
            },
          },
          done: {},
        },
      })

      assert.strictEqual(yield* valueAfter(machine, { type: "EV", secret: 0 }), "idle")
      assert.strictEqual(yield* valueAfter(machine, { type: "OTHER" }), "done")
      assert.deepStrictEqual(evaluated, ["and 1", "and 2", "or 1", "or 2"])
    })
  )

  it.effect("[A15] port guard definitions, when(...) and the implementations argument still combine, and not(stateIn(...)) works by name", () =>
    Effect.gen(function* () {
      // The explicit implementations argument of not() wins over the machine's implementations
      const explicit: Types.MachineImplementations<Ctx, Ev> = {
        guards: { isNegative: ({ context }) => context.count < 0 },
      }
      const machine = createMachine<Ctx, Ev>(
        {
          id: "a15",
          context: { count: 1 },
          initial: "idle",
          states: {
            idle: {
              on: {
                EV: {
                  target: "combined",
                  guard: and([
                    when<Ctx, Ev>(({ context }) => context.count === 1),
                    { type: "definition", predicate: ({ event }) => Effect.succeed(secretOf(event) === 5) },
                    not("isNegative", explicit),
                  ]),
                },
                OTHER: { target: "notIn", guard: and(["notInDone", "notInDoneToo"]) },
              },
            },
            combined: {},
            notIn: {},
            done: {},
          },
        },
        {
          guards: {
            isNegative: () => true,
            notInDone: not(stateIn("done")),
            notInDoneToo: stateNotIn("done"),
          },
        }
      )

      assert.strictEqual(yield* valueAfter(machine, { type: "EV", secret: 5 }), "combined")
      assert.strictEqual(yield* valueAfter(machine, { type: "EV", secret: 4 }), "idle")
      assert.strictEqual(yield* valueAfter(machine, { type: "OTHER" }), "notIn")

      const direct = not<Ctx, Ev>("isNegative", explicit)
      assert.isTrue(
        yield* guards.evaluateGuard(direct, { count: 1 }, { type: "OTHER" }, scopeWith({ guards: { isNegative: () => true } }))
      )
    })
  )

  it.effect("[A15] the guards entry point exports evaluateGuard for a name, { type, params }, an inline function and a built-in guard", () =>
    Effect.gen(function* () {
      const seen: Array<unknown> = []
      const scope = scopeWith({
        guards: {
          isEven: ({ context }) => context.count % 2 === 0,
          over: ({ event }, params: { readonly limit: number }) => {
            seen.push(params)
            return secretOf(event) > params.limit
          },
        },
      })
      const context: Ctx = { count: 4 }
      const event: Ev = { type: "EV", secret: 10 }

      assert.isTrue(yield* guards.evaluateGuard("isEven", context, event, scope))
      assert.isTrue(yield* guards.evaluateGuard({ type: "over", params: { limit: 9 } }, context, event, scope))
      assert.isFalse(
        yield* guards.evaluateGuard({ type: "over", params: ({ context: c }) => ({ limit: c.count * 3 }) }, context, event, scope)
      )
      assert.isTrue(yield* guards.evaluateGuard((args, params) => args.event.type === "EV" && params === undefined, context, event, scope))
      assert.isTrue(yield* guards.evaluateGuard(guards.and(["isEven", guards.not({ type: "over", params: { limit: 10 } })]), context, event, scope))
      assert.deepStrictEqual(seen, [{ limit: 9 }, { limit: 12 }, { limit: 10 }])

      // An unknown name fails the guard Effect with the upstream message, also inside a combinator
      const unknownGuards: ReadonlyArray<readonly [Types.Guard<Ctx, Ev>, Ctx]> = [
        ["nope", { count: 1 }],
        [guards.or(["isEven", { type: "nope" }]), { count: 1 }],
        [guards.and(["isEven", "nope"]), { count: 2 }],
        [guards.not("nope"), { count: 2 }],
      ]
      for (const [unknownGuard, unknownContext] of unknownGuards) {
        const error = yield* Effect.flip(guards.evaluateGuard(unknownGuard, unknownContext, event, scope))
        assert.strictEqual(error._tag, "GuardError")
        assert.strictEqual(error.message, "Guard 'nope' is not implemented.'.")
        assert.strictEqual(error.guard, "nope")
      }
    })
  )
})
