/**
 * ERR-1: a typed failure in an exit action halts the macrostep.
 *
 * T2.46, SD-4, ERR-04. An inline action may return an Effect (port extension); a typed failure
 * of that Effect is the actor's error, as a throw is upstream (`createActor.ts` `_process` at
 * xstate@5.33.2): the macrostep stops at that action, so no later exit, transition or entry
 * action of it runs and no later microstep is taken, and the actor keeps the snapshot it had
 * before the event with status `error` and `snapshot.error = Option.some(<that typed error>)`.
 * The engine never swallows the failure; only the actor boundary catches it.
 */
import { assert, describe, it } from "@effect/vitest"
import { Data, Effect, Option } from "effect"
import { createActor, createMachine, raise } from "../../src/index.js"

/** A typed error an exit action fails with. */
class ExitFailed extends Data.TaggedError("ExitFailed")<{ readonly state: string }> {}

type Ev = { readonly type: "GO" } | { readonly type: "NEXT" }

/** An inline action that records `entry` in `log`. */
const record = (log: Array<string>, entry: string) => () => {
  log.push(entry)
}

describe("ERR-1 A typed failure in an exit action halts the macrostep", () => {
  it.effect("[ERR-1] a typed failure in an exit action halts the macrostep: no later exit, transition or entry action runs, and snapshot.error is Some of that typed error", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const failure = new ExitFailed({ state: "a" })
      const machine = createMachine<object, Ev>({
        id: "err1",
        initial: "a",
        context: {},
        states: {
          a: {
            exit: [record(log, "exit a 1"), () => Effect.fail(failure), record(log, "exit a 2")],
            on: { GO: { target: "b", actions: record(log, "transition") } },
          },
          b: { entry: record(log, "entry b"), always: "c" },
          c: { entry: record(log, "entry c") },
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      yield* actor.send({ type: "GO" })

      const snapshot = yield* actor.getSnapshot
      assert.deepStrictEqual(log, ["exit a 1"])
      assert.strictEqual(snapshot.status, "error")
      assert.strictEqual(snapshot.value, "a")
      assert.isTrue(Option.isSome(snapshot.error))
      assert.strictEqual(Option.getOrUndefined(snapshot.error), failure)
    })
  )

  it.effect("[ERR-1] a typed failure in an exit action of a later microstep halts the whole macrostep: the actor keeps the snapshot before the event", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const failure = new ExitFailed({ state: "b" })
      const machine = createMachine<object, Ev>({
        id: "err1-later",
        initial: "a",
        context: {},
        states: {
          a: { on: { GO: "b" } },
          b: {
            entry: [record(log, "entry b"), raise<object, Ev>({ type: "NEXT" })],
            exit: [() => Effect.fail(failure), record(log, "exit b")],
            on: { NEXT: { target: "c", actions: record(log, "transition NEXT") } },
          },
          c: { entry: record(log, "entry c") },
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start

      yield* actor.send({ type: "GO" })

      const snapshot = yield* actor.getSnapshot
      // The first microstep ran its entry action; the failure stopped the second microstep
      assert.deepStrictEqual(log, ["entry b"])
      assert.strictEqual(snapshot.status, "error")
      assert.strictEqual(snapshot.value, "a")
      assert.strictEqual(Option.getOrUndefined(snapshot.error), failure)
    })
  )
})
