/**
 * COV-7: a guard that refers back to itself in the `{ type, params }` form stops.
 *
 * Coverage layer #7 (`src/guards`, risk R-010, P1-020). Upstream `evaluateGuard`
 * (`src/guards.ts` at xstate@5.33.2) evaluates guards on the call stack, so a guard that
 * refers back to itself through a built-in guard overflows it with `RangeError: Maximum call
 * stack size exceeded`. The port's evaluator does not grow the call stack, so it stops at
 * 10,000 nested evaluations with a `GuardError` of that message, whose `guard` names the guard
 * it met there: the name, the `type` of a `{ type, params }` use, or `""` for a function.
 *
 * The CONF-4 rewrites reach the limit with a name (`a: not("a")`) and with a function; this
 * spec reaches it with the `{ type, params }` form, the third form a guard can take.
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { GuardError } from "../../src/Errors.js"
import { evaluateGuard, not } from "../../src/guards/index.js"
import { createActor, createMachine, type EventObject, type GuardScope } from "../../src/index.js"
import { guardEvaluationFailed } from "./upstream-messages.js"

/** The message upstream's guard cycle overflows the call stack with (V8). */
const stackOverflow = "Maximum call stack size exceeded"

/** `a` is true when `a` is not, through its own `{ type, params }` use. */
const cycle = { a: not<unknown, EventObject>({ type: "a", params: { from: "a" } }) }

describe("COV-7 a self-referring guard in the { type, params } form stops", () => {
  it.effect("[COV-7] evaluateGuard fails with GuardError, the stack-overflow message and the type of the { type, params } use", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(createMachine({ id: "cov7-scope" }))
      const scope: GuardScope<unknown, EventObject> = { self: actor, system: actor.system, implementations: { guards: cycle } }

      const error = yield* Effect.flip(evaluateGuard<unknown, EventObject>({ type: "a" }, {}, { type: "EV" }, scope))

      assert.instanceOf(error, GuardError)
      assert.strictEqual(error._tag, "GuardError")
      assert.strictEqual(error.message, stackOverflow)
      assert.strictEqual(error.guard, "a")
    }))

  it.effect("[COV-7] a transition guarded by it ends the macrostep with the guard-evaluation error, whose cause names the guard", () =>
    Effect.gen(function* () {
      const machine = createMachine(
        {
          id: "cov7",
          initial: "idle",
          states: { idle: { on: { EV: { target: "done", guard: { type: "a" } } } }, done: {} },
        },
        { guards: cycle }
      )
      const actor = yield* createActor(machine)
      yield* actor.start

      yield* actor.send({ type: "EV" })

      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.status, "error")
      assert.notStrictEqual(snapshot.value, "done")
      const error = Option.getOrThrow(snapshot.error)
      assert.instanceOf(error, GuardError)
      assert.strictEqual(error.message, guardEvaluationFailed("a", "EV", "cov7.idle", stackOverflow))
      assert.strictEqual(error.guard, "a")
      assert.instanceOf(error.cause, GuardError)
      assert.deepStrictEqual([error.cause.message, error.cause.guard], [stackOverflow, "a"])
    }))
})
