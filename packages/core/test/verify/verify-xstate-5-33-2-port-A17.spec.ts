/**
 * A17: a throwing guard sets status error.
 *
 * T2.46, SD-4. Upstream `StateNode.next` (`src/StateNode.ts` at xstate@5.33.2) evaluates the
 * guard of each candidate transition for an event inside a `try`; whatever the guard throws
 * is rethrown as `new Error("Unable to evaluate guard '<type>' in transition for event
 * '<event>' in state node '<id>':\n<message>")`, where `<type>` (and its trailing space) is
 * left out for an inline function guard and `<message>` is the thrown value's `message`. The
 * actor then keeps the snapshot it had before the event, with status `error` and that error.
 * Eventless guards are not wrapped (S24). The upstream inline snapshots print the error as
 * `[Error: ...]`, so the port's error is an `Error` named `Error`.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { and, createActor, createMachine, type SnapshotType } from "../../src/index.js"
import { guardEvaluationFailed } from "./upstream-messages.js"

interface Ctx {
  readonly limit: number
}

type Ev = { readonly type: "NEXT" }

/** The error the snapshot holds; fails the test when it holds none. */
const errorOf = (snapshot: SnapshotType): unknown => {
  assert.isTrue(Option.isSome(snapshot.error), "the snapshot holds an error")
  return Option.getOrUndefined(snapshot.error)
}

/** The value a guard throws. */
const thrown = new Error("error_thrown_in_guard_when_transitioning")

describe("A17 A throwing guard sets status error", () => {
  it.effect("[A17] an inline guard that throws while the actor selects a transition for an event sets status error with the recorded guard-evaluation message and keeps the pre-event state", () =>
    Effect.gen(function* () {
      const machine = createMachine<Ctx, Ev>({
        id: "a17",
        initial: "a",
        context: { limit: 1 },
        states: {
          a: {
            on: {
              NEXT: {
                guard: () => {
                  throw thrown
                },
                target: "b",
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
      assert.strictEqual(snapshot.value, "a")
      const error = errorOf(snapshot)
      assert.instanceOf(error, Error)
      assert.strictEqual((error as Error).message, guardEvaluationFailed("", "NEXT", "a17.a", thrown.message))
    })
  )

  it.effect("[A17] the guard-evaluation error is an Error named Error, as upstream's `new Error`, so it prints as [Error: <message>]", () =>
    Effect.gen(function* () {
      const machine = createMachine<Ctx, Ev>({
        id: "a17-print",
        initial: "a",
        context: { limit: 1 },
        states: {
          a: {
            on: {
              NEXT: {
                guard: () => {
                  throw thrown
                },
                target: "b",
              },
            },
          },
          b: {},
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      yield* actor.send({ type: "NEXT" })

      const error = errorOf(yield* actor.getSnapshot) as Error
      assert.strictEqual(error.name, "Error")
      assert.strictEqual(
        String(error),
        `Error: ${guardEvaluationFailed("", "NEXT", "a17-print.a", thrown.message)}`
      )
    })
  )

  it.effect("[A17] a named guard and a parameterized guard that throw name their type in the recorded message", () =>
    Effect.gen(function* () {
      const machine = createMachine<Ctx, Ev>(
        {
          id: "a17-named",
          initial: "a",
          context: { limit: 1 },
          states: {
            a: { on: { NEXT: { guard: "isReady", target: "b" } } },
            b: {},
          },
        },
        {
          guards: {
            isReady: () => {
              throw new Error("not ready")
            },
          },
        }
      )
      const actor = yield* createActor(machine)
      yield* actor.start
      yield* actor.send({ type: "NEXT" })
      const named = errorOf(yield* actor.getSnapshot) as Error
      assert.strictEqual(named.message, guardEvaluationFailed("isReady", "NEXT", "a17-named.a", "not ready"))

      const parameterized = createMachine<Ctx, Ev>(
        {
          id: "a17-params",
          initial: "b",
          context: { limit: 1 },
          states: {
            b: { on: { NEXT: { guard: { type: "atLeast", params: { min: 2 } }, target: "c" } } },
            c: {},
          },
        },
        {
          guards: {
            atLeast: (_args, params: { readonly min: number }) => {
              throw new Error(`below ${params.min}`)
            },
          },
        }
      )
      const second = yield* createActor(parameterized)
      yield* second.start
      yield* second.send({ type: "NEXT" })
      const snapshot = yield* second.getSnapshot
      assert.strictEqual(snapshot.status, "error")
      assert.strictEqual((errorOf(snapshot) as Error).message, guardEvaluationFailed("atLeast", "NEXT", "a17-params.b", "below 2"))
    })
  )

  it.effect("[A17] a built-in guard over a guard that throws names no type, as upstream's built-in guards are functions", () =>
    Effect.gen(function* () {
      const machine = createMachine<Ctx, Ev>({
        id: "a17-builtin",
        initial: "a",
        context: { limit: 1 },
        states: {
          a: {
            on: {
              NEXT: {
                guard: and<Ctx, Ev>([
                  () => {
                    throw thrown
                  },
                ]),
                target: "b",
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
      assert.strictEqual((errorOf(snapshot) as Error).message, guardEvaluationFailed("", "NEXT", "a17-builtin.a", thrown.message))
    })
  )

  it.effect("[A17] a guard that throws a value without a message gives the recorded message with upstream's `undefined` message part", () =>
    Effect.gen(function* () {
      const machine = createMachine<Ctx, Ev>({
        id: "a17-value",
        initial: "a",
        context: { limit: 1 },
        states: {
          a: {
            on: {
              NEXT: {
                guard: () => {
                  throw "plain value"
                },
                target: "b",
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
      assert.strictEqual((errorOf(snapshot) as Error).message, guardEvaluationFailed("", "NEXT", "a17-value.a", "undefined"))
    })
  )

  it.effect("[A17] a guard whose Effect dies while the actor selects a transition for an event gives the recorded message too", () =>
    Effect.gen(function* () {
      const machine = createMachine<Ctx, Ev>({
        id: "a17-effect",
        initial: "a",
        context: { limit: 1 },
        states: {
          a: { on: { NEXT: { guard: () => Effect.die(thrown), target: "b" } } },
          b: {},
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      yield* actor.send({ type: "NEXT" })

      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.status, "error")
      assert.strictEqual((errorOf(snapshot) as Error).message, guardEvaluationFailed("", "NEXT", "a17-effect.a", thrown.message))
    })
  )
})
