/**
 * S16: an unknown named guard throws.
 *
 * T3.17, SD-4, SD-20. Upstream `evaluateGuard` (`src/guards.ts` at xstate@5.33.2) throws
 * `new Error("Guard '<type>' is not implemented.'.")` when a guard name, or the `type` of a
 * `{ type, params }` use, has no implementation in `machine.implementations.guards`; the
 * built-in guards `and`, `or` and `not` call the same evaluator, so a name inside them throws
 * the same error. `StateNode.next` catches it while it selects a transition for an event and
 * rethrows it as `Unable to evaluate guard '<type>' in transition for event '<event>' in state
 * node '<id>':\n<message>` (no `'<type>' ` for a function guard, which the built-ins are). The
 * actor then keeps the snapshot it had before the event, with status `error` and that error,
 * so the transition is not taken. `selectEventlessTransitions` does not wrap: the raw
 * not-implemented error reaches the actor. `machine.provide({ guards })` gives a new machine
 * whose implementations hold the name, so the name is valid there. The port's errors are
 * `Error`s named `Error`, as the upstream inline snapshots print them (`[Error: ...]`).
 *
 * SD-20: the port's former "an unknown named guard passes with a warning" behaviour is gone,
 * so these cases also assert that no warning is logged. `enqueueActions` `check` is not
 * covered here: T4.15 puts it on the shared evaluator (its "check('unknown')" case).
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Logger, Option } from "effect"
import { and, assign, createActor, createMachine, not, or, type SnapshotType } from "../../src/index.js"
import { guardEvaluationFailed, guardNotImplemented } from "./upstream-messages.js"

interface Ctx {
  readonly count: number
}

type Ev = { readonly type: "GO" }

/** The error the snapshot holds; fails the test when it holds none. */
const errorOf = (snapshot: SnapshotType): Error => {
  assert.isTrue(Option.isSome(snapshot.error), "the snapshot holds an error")
  const error = Option.getOrUndefined(snapshot.error)
  assert.instanceOf(error, Error)
  return error as Error
}

/** Runs `program` with a logger that keeps the text of every warning. */
const withWarningsCaptured = <A, E, R>(program: Effect.Effect<A, E, R>) => {
  const warnings: Array<string> = []
  return program.pipe(
    Effect.provide(
      Logger.layer([
        Logger.make((options) => {
          if (options.logLevel === "Warn") {
            const parts: ReadonlyArray<unknown> = Array.isArray(options.message) ? options.message : [options.message]
            warnings.push(parts.map(String).join(" "))
          }
        }),
      ])
    ),
    Effect.map((result) => ({ result, warnings }))
  )
}

/** A guard any transition config holds: a name, a `{ type, params }` use or a built-in guard. */
type AnyGuard = Parameters<typeof and<Ctx, Ev>>[0][number]

/**
 * A machine whose `foo` state takes GO to `bar` under `guard`, with a transition action that
 * counts, so a taken transition shows in the context as well as in the value.
 */
const machineGuardedBy = (id: string, guard: AnyGuard) =>
  createMachine<Ctx, Ev>({
    id,
    initial: "foo",
    context: { count: 0 },
    states: {
      foo: {
        on: {
          GO: {
            guard,
            target: "bar",
            actions: [assign<Ctx, Ev>(({ context }) => ({ count: context.count + 1 }))],
          },
        },
      },
      bar: {},
    },
  })

/** Starts an actor of `machine`, sends GO, and gives the snapshot after it and the warnings logged. */
const sendGo = (machine: ReturnType<typeof machineGuardedBy>) =>
  withWarningsCaptured(
    Effect.gen(function* () {
      const actor = yield* createActor(machine)
      yield* actor.start
      yield* actor.send({ type: "GO" })
      return yield* actor.getSnapshot
    })
  )

/** Asserts the snapshot of an actor that met an unknown guard: status error, the GO transition not taken. */
const assertNotTaken = (snapshot: SnapshotType & { readonly value: unknown; readonly context: Ctx }, warnings: ReadonlyArray<string>) => {
  assert.strictEqual(snapshot.status, "error")
  assert.strictEqual(snapshot.value, "foo", "the transition target is not entered")
  assert.strictEqual(snapshot.context.count, 0, "the transition action does not run")
  assert.deepStrictEqual(warnings, [], "the unknown guard logs no warning (SD-20)")
}

describe("S16 An unknown named guard throws", () => {
  it.effect("[S16] a transition guarded by a name with no implementation sets status error with the recorded not-implemented message and is not taken", () =>
    Effect.gen(function* () {
      const { result: snapshot, warnings } = yield* sendGo(machineGuardedBy("s16", "doesNotExist"))

      assertNotTaken(snapshot, warnings)
      assert.strictEqual(
        errorOf(snapshot).message,
        guardEvaluationFailed("doesNotExist", "GO", "s16.foo", guardNotImplemented("doesNotExist"))
      )
    })
  )

  it.effect("[S16] the error is an Error named Error, so it prints as upstream's [Error: <message>]", () =>
    Effect.gen(function* () {
      const { result: snapshot } = yield* sendGo(machineGuardedBy("s16-print", "doesNotExist"))

      const error = errorOf(snapshot)
      assert.strictEqual(error.name, "Error")
      assert.strictEqual(
        String(error),
        `Error: ${guardEvaluationFailed("doesNotExist", "GO", "s16-print.foo", guardNotImplemented("doesNotExist"))}`
      )
    })
  )

  it.effect("[S16] a { type, params } use whose type has no implementation names that type in the recorded message", () =>
    Effect.gen(function* () {
      const { result: snapshot, warnings } = yield* sendGo(
        machineGuardedBy("s16-params", { type: "atLeast", params: { min: 2 } })
      )

      assertNotTaken(snapshot, warnings)
      assert.strictEqual(
        errorOf(snapshot).message,
        guardEvaluationFailed("atLeast", "GO", "s16-params.foo", guardNotImplemented("atLeast"))
      )
    })
  )

  it.effect("[S16] a name whose implementation is another name with no implementation names the first in the wrapper and the second in the message", () =>
    Effect.gen(function* () {
      const machine = machineGuardedBy("s16-alias", "isReady").provide({ guards: { isReady: "doesNotExist" } })

      const { result: snapshot, warnings } = yield* sendGo(machine)

      assertNotTaken(snapshot, warnings)
      assert.strictEqual(
        errorOf(snapshot).message,
        guardEvaluationFailed("isReady", "GO", "s16-alias.foo", guardNotImplemented("doesNotExist"))
      )
    })
  )

  it.effect("[S16] an unknown name inside and, or and not sets status error; the wrapper names no type, as upstream's built-in guards are functions", () =>
    Effect.gen(function* () {
      const cases = [
        ["s16-and", and<Ctx, Ev>(["doesNotExist"])],
        ["s16-or", or<Ctx, Ev>(["doesNotExist"])],
        ["s16-not", not<Ctx, Ev>("doesNotExist")],
        ["s16-nested", and<Ctx, Ev>([() => true, or<Ctx, Ev>([() => false, not<Ctx, Ev>("doesNotExist")])])],
      ] as const
      for (const [id, guard] of cases) {
        const { result: snapshot, warnings } = yield* sendGo(machineGuardedBy(id, guard))

        assertNotTaken(snapshot, warnings)
        assert.strictEqual(
          errorOf(snapshot).message,
          guardEvaluationFailed("", "GO", `${id}.foo`, guardNotImplemented("doesNotExist")),
          id
        )
      }
    })
  )

  it.effect("[S16] and stops at its first false and or at its first true, so an unknown name after them is never evaluated", () =>
    Effect.gen(function* () {
      const notTaken = yield* sendGo(machineGuardedBy("s16-and-short", and<Ctx, Ev>([() => false, "doesNotExist"])))
      assert.strictEqual(notTaken.result.status, "active")
      assert.strictEqual(notTaken.result.value, "foo")
      assert.isTrue(Option.isNone(notTaken.result.error))

      const taken = yield* sendGo(machineGuardedBy("s16-or-short", or<Ctx, Ev>([() => true, "doesNotExist"])))
      assert.strictEqual(taken.result.status, "active")
      assert.strictEqual(taken.result.value, "bar")
      assert.strictEqual(taken.result.context.count, 1)
    })
  )

  it.effect("[S16] an unknown name on an eventless transition sets status error with the raw not-implemented message, unwrapped as upstream, and keeps the pre-event snapshot", () =>
    Effect.gen(function* () {
      const machine = createMachine<Ctx, Ev>({
        id: "s16-always",
        initial: "foo",
        context: { count: 0 },
        states: {
          foo: { on: { GO: "bar" } },
          bar: { always: { guard: "doesNotExist", target: "baz" } },
          baz: {},
        },
      })

      const { result: snapshot, warnings } = yield* withWarningsCaptured(
        Effect.gen(function* () {
          const actor = yield* createActor(machine)
          yield* actor.start
          yield* actor.send({ type: "GO" })
          return yield* actor.getSnapshot
        })
      )

      assert.strictEqual(snapshot.status, "error")
      assert.strictEqual(snapshot.value, "foo")
      assert.deepStrictEqual(warnings, [])
      const error = errorOf(snapshot)
      assert.strictEqual(error.name, "Error")
      assert.strictEqual(error.message, guardNotImplemented("doesNotExist"))
    })
  )

  it.effect("[S16] machine.provide with an implementation for the name makes the name valid; the original machine still errors", () =>
    Effect.gen(function* () {
      const original = machineGuardedBy("s16-provide", "doesNotExist")
      const provided = original.provide({ guards: { doesNotExist: ({ context }) => context.count === 0 } })

      const valid = yield* sendGo(provided)
      assert.strictEqual(valid.result.status, "active")
      assert.strictEqual(valid.result.value, "bar")
      assert.strictEqual(valid.result.context.count, 1)
      assert.deepStrictEqual(valid.warnings, [])

      const unchanged = yield* sendGo(original)
      assertNotTaken(unchanged.result, unchanged.warnings)
    })
  )
})
