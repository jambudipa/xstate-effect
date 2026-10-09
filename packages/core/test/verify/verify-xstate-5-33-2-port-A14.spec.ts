/**
 * A14: inline, plain-function and parameterized guards decide transitions.
 *
 * T2.39. Upstream `evaluateGuard` in `src/guards.ts` at xstate@5.33.2: an inline guard
 * function is called as `guard({ context, event }, undefined)`; a string names an
 * implementation in `setup({ guards })`, `createMachine(config, { guards })` or
 * `machine.provide({ guards })`, called with `undefined` params; a `{ type, params }` guard
 * calls the implementation named `type` with the params of that use: the static value as
 * written, or `params({ context, event })`. A transition is taken only when its guard
 * returns true; a candidate list takes its first enabled transition, and an eventless
 * transition is guarded the same way. The port also accepts an inline guard that returns an
 * `Effect<boolean>`, and keeps its own `GuardDefinition` objects (`predicate`) and the
 * `when(...)` and `guard(...)` factories working beside the XState forms (D15); a named
 * definition, like a named function, receives the params of each use.
 *
 * The specs read the snapshots through `getInitialSnapshot`/`getNextSnapshot`, which run
 * guards (SD-13), and run one real actor for a setup guard.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Stream } from "effect"
import {
  type ActorLogicType,
  type ActorType,
  createActor,
  createMachine,
  type EventObject,
  getInitialSnapshot,
  getNextSnapshot,
  guard,
  type MachineSnapshot,
  setup,
  type SnapshotType,
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

type Ev = { readonly type: "GO"; readonly amount: number } | { readonly type: "NEXT" }

/** The amount a `GO` event carries; 0 for any other event. */
const amountOf = (event: Ev): number => (event.type === "GO" ? event.amount : 0)

/** What one guard call received. */
interface GuardCall {
  readonly args: Types.GuardArgs<Ctx, Ev>
  readonly params: unknown
}

describe("A14 inline, plain-function and parameterized guards decide transitions", () => {
  it.effect("[A14] an inline guard receives exactly { context, event } and undefined params, and the transition is taken only when it returns true", () =>
    Effect.gen(function* () {
      const calls: Array<GuardCall> = []
      const machine = createMachine<Ctx, Ev>({
        id: "a14",
        context: { count: 2 },
        initial: "idle",
        states: {
          idle: {
            on: {
              GO: [
                {
                  target: "big",
                  guard: (args, params) => {
                    calls.push({ args, params })
                    return amountOf(args.event) > 10
                  },
                },
                { target: "some", guard: ({ context, event }) => amountOf(event) > context.count },
              ],
            },
          },
          big: {},
          some: {},
        },
      })

      assert.strictEqual(yield* valueAfter(machine, { type: "GO", amount: 20 }), "big")
      assert.strictEqual(yield* valueAfter(machine, { type: "GO", amount: 3 }), "some")
      assert.strictEqual(yield* valueAfter(machine, { type: "GO", amount: 1 }), "idle")

      assert.strictEqual(calls.length, 3)
      for (const { args, params } of calls) {
        assert.deepStrictEqual(Object.keys(args).sort(), ["context", "event"])
        assert.deepStrictEqual(args.context, { count: 2 })
        assert.strictEqual(params, undefined)
      }
      assert.deepStrictEqual(
        calls.map(({ args }) => args.event),
        [
          { type: "GO", amount: 20 },
          { type: "GO", amount: 3 },
          { type: "GO", amount: 1 },
        ]
      )
    })
  )

  it.effect("[A14] a plain-function guard in setup decides the transition by name with undefined params, and machine.provide replaces it", () =>
    Effect.gen(function* () {
      const calls: Array<{ readonly source: string; readonly count: number; readonly amount: number; readonly params: unknown }> = []
      const base = setup({
        types: {} as { context: Ctx; events: Ev },
        guards: {
          isLarge: ({ context, event }, params) => {
            calls.push({ source: "setup", count: context.count, amount: amountOf(event), params })
            return amountOf(event) > context.count
          },
        },
      }).createMachine({
        id: "a14",
        context: { count: 5 },
        initial: "idle",
        states: {
          idle: { on: { GO: { target: "large", guard: "isLarge" } } },
          large: {},
        },
      })
      const provided = base.provide({
        guards: {
          isLarge: ({ event }, params) => {
            calls.push({ source: "provide", count: -1, amount: amountOf(event), params })
            return false
          },
        },
      })

      assert.strictEqual(yield* valueAfter(base, { type: "GO", amount: 9 }), "large")
      assert.strictEqual(yield* valueAfter(base, { type: "GO", amount: 4 }), "idle")
      assert.strictEqual(yield* valueAfter(provided, { type: "GO", amount: 9 }), "idle")

      assert.deepStrictEqual(calls, [
        { source: "setup", count: 5, amount: 9, params: undefined },
        { source: "setup", count: 5, amount: 4, params: undefined },
        { source: "provide", count: -1, amount: 9, params: undefined },
      ])
    })
  )

  it.effect("[A14] in a running actor a setup guard is evaluated for each event and the transition is taken once it returns true", () =>
    Effect.gen(function* () {
      const amounts: Array<number> = []
      const machine = setup({
        types: {} as { context: Ctx; events: Ev },
        guards: {
          isLarge: ({ context, event }) => {
            amounts.push(amountOf(event))
            return amountOf(event) > context.count
          },
        },
      }).createMachine({
        id: "a14",
        context: { count: 5 },
        initial: "idle",
        states: {
          idle: { on: { GO: { target: "large", guard: "isLarge" } } },
          large: {},
        },
      })
      const actor = yield* startActor(machine, "a14")

      const small: Ev = { type: "GO", amount: 1 }
      const large: Ev = { type: "GO", amount: 7 }
      yield* actor.send(small)
      yield* actor.send(large)
      const reached = yield* reach(actor, "large")

      assert.isTrue(reached._tag === "Some")
      // The guard ran for both events, so the first one did not take the transition
      assert.deepStrictEqual(amounts, [1, 7])
    })
  )

  it.effect("[A14] a { type, params } guard receives its static params, and its dynamic params computed from the context and the event", () =>
    Effect.gen(function* () {
      const seen: Array<unknown> = []
      const machine = createMachine<Ctx, Ev>(
        {
          id: "a14",
          context: { count: 4 },
          initial: "idle",
          states: {
            idle: {
              on: {
                GO: [
                  { target: "static", guard: { type: "atLeast", params: { min: 100 } } },
                  {
                    target: "dynamic",
                    guard: { type: "atLeast", params: ({ context, event }) => ({ min: context.count + amountOf(event) }) },
                  },
                ],
                NEXT: { target: "static", guard: { type: "atLeast", params: { min: 4 } } },
              },
            },
            static: {},
            dynamic: {},
          },
        },
        {
          guards: {
            atLeast: ({ context }, params: { readonly min: number }) => {
              seen.push(params)
              return context.count >= params.min
            },
          },
        }
      )

      // GO 0: static 4 >= 100 fails, dynamic 4 >= 4 + 0 passes
      assert.strictEqual(yield* valueAfter(machine, { type: "GO", amount: 0 }), "dynamic")
      // GO 1: both fail
      assert.strictEqual(yield* valueAfter(machine, { type: "GO", amount: 1 }), "idle")
      // NEXT: static 4 >= 4 passes
      assert.strictEqual(yield* valueAfter(machine, { type: "NEXT" }), "static")

      assert.deepStrictEqual(seen, [{ min: 100 }, { min: 4 }, { min: 100 }, { min: 5 }, { min: 4 }])
    })
  )

  it.effect("[A14] an inline guard and a plain-function implementation may return an Effect<boolean>", () =>
    Effect.gen(function* () {
      const machine = createMachine<Ctx, Ev>(
        {
          id: "a14",
          context: { count: 3 },
          initial: "idle",
          states: {
            idle: {
              on: {
                GO: [
                  { target: "never", guard: () => Effect.succeed(false) },
                  { target: "named", guard: "isPositive" },
                ],
                NEXT: { target: "inline", guard: ({ context }) => Effect.succeed(context.count === 3) },
              },
            },
            never: {},
            named: {},
            inline: {},
          },
        },
        { guards: { isPositive: ({ event }) => Effect.sync(() => amountOf(event) > 0) } }
      )

      assert.strictEqual(yield* valueAfter(machine, { type: "GO", amount: 1 }), "named")
      assert.strictEqual(yield* valueAfter(machine, { type: "GO", amount: 0 }), "idle")
      assert.strictEqual(yield* valueAfter(machine, { type: "NEXT" }), "inline")
    })
  )

  it.effect("[A14] port GuardDefinition objects and when(...) keep working inline and by name; a named definition receives the use-site params", () =>
    Effect.gen(function* () {
      const seen: Array<unknown> = []
      const machine = createMachine<Ctx, Ev>(
        {
          id: "a14",
          context: { count: 2 },
          initial: "idle",
          states: {
            idle: {
              on: {
                GO: [
                  { target: "definition", guard: { type: "inlineDefinition", predicate: ({ event }) => Effect.succeed(amountOf(event) === 1) } },
                  { target: "when", guard: when<Ctx, Ev>(({ event }) => amountOf(event) === 2) },
                  { target: "named", guard: "namedDefinition" },
                  { target: "parameterized", guard: { type: "withParams", params: { equals: 4 } } },
                ],
              },
            },
            definition: {},
            when: {},
            named: {},
            parameterized: {},
          },
        },
        {
          guards: {
            namedDefinition: when<Ctx, Ev>(({ event }) => amountOf(event) === 3),
            withParams: guard<Ctx, Ev, { readonly equals: number }>("withParams", ({ event }, params) =>
              Effect.sync(() => {
                seen.push(params)
                return amountOf(event) === params.equals
              })
            ),
          },
        }
      )

      assert.strictEqual(yield* valueAfter(machine, { type: "GO", amount: 1 }), "definition")
      assert.strictEqual(yield* valueAfter(machine, { type: "GO", amount: 2 }), "when")
      assert.strictEqual(yield* valueAfter(machine, { type: "GO", amount: 3 }), "named")
      assert.strictEqual(yield* valueAfter(machine, { type: "GO", amount: 4 }), "parameterized")
      assert.strictEqual(yield* valueAfter(machine, { type: "GO", amount: 5 }), "idle")
      assert.deepStrictEqual(seen, [{ equals: 4 }, { equals: 4 }])
    })
  )

  it.effect("[A14] guards decide eventless transitions, and a candidate list falls back to an unguarded target", () =>
    Effect.gen(function* () {
      const machine = createMachine<Ctx, Ev>({
        id: "a14",
        context: { count: 2 },
        initial: "check",
        states: {
          check: {
            always: [
              { target: "no", guard: () => false },
              { target: "ready", guard: ({ context }) => context.count === 2 },
            ],
          },
          no: {},
          ready: { on: { GO: [{ target: "guarded", guard: () => false }, "fallback"] } },
          guarded: {},
          fallback: {},
        },
      })

      const initial = yield* initialSnapshotOf(machine)
      assert.strictEqual(initial.value, "ready")
      assert.strictEqual((yield* nextSnapshotOf(machine, initial, { type: "GO", amount: 0 })).value, "fallback")
    })
  )
})
