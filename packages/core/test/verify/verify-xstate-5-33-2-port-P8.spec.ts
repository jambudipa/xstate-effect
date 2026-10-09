/**
 * P8: getMicrosteps, getInitialMicrosteps and getNextTransitions work.
 *
 * T6.10. Upstream `src/transition.ts` at xstate@5.33.2: `getMicrosteps(machine, snapshot,
 * event)` gives `macrostep(...).microsteps`, one `[snapshot, actions]` per microstep (the
 * first for the event, then each eventless and raised-event microstep), each with the actions
 * its `microstep` handed to the action executor, against an inert actor scope that runs none.
 * `getInitialMicrosteps(machine, input?)` gives the initial microstep (entry actions of the
 * initial states) and then the microsteps of the initial macrostep. `getNextTransitions(
 * snapshot)` lists, for each active atomic node in `_nodes` order, the transitions of the node
 * and then of each ancestor not visited yet: each node's `transitions` map (event, done,
 * invoke and delayed transitions) in order, then its `always` transitions, guards not
 * evaluated. Each listed transition definition holds its `target` as upstream's
 * `TransitionDefinition` does: the array of target state nodes, or `undefined` for a
 * targetless transition (upstream `transition.test.ts` reads `t.target?.[0]?.key`). What
 * upstream throws (a guard that throws, a macrostep past `maxIterations`) fails the port's
 * Effect (SD-3, SD-13).
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import {
  createActor,
  createMachine,
  getInitialMicrosteps,
  getMicrosteps,
  getNextTransitions,
  initialTransition,
  raise,
} from "../../src/index.js"
import { guardEvaluationFailed, infiniteLoop } from "./upstream-messages.js"

/** The type of each action, in order. */
const typesOf = (actions: ReadonlyArray<{ readonly type: string }>): ReadonlyArray<string> => actions.map((action) => action.type)

/** A named function action that does nothing (its name is its action type). */
const named = (name: string) => ({ [name]: () => {} })[name]!

describe("P8 getMicrosteps, getInitialMicrosteps and getNextTransitions work", () => {
  it.effect("[P8] getMicrosteps gives one [snapshot, actions] per microstep, raised and always microsteps included", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        id: "p8",
        initial: "a",
        states: {
          a: { on: { GO: { target: "b", actions: [named("toB"), raise({ type: "NEXT" })] } } },
          b: { entry: named("enterB"), on: { NEXT: { target: "c", actions: named("toC") } } },
          c: { always: { target: "d", actions: named("toD") } },
          d: { entry: named("enterD") },
        },
      })
      const [initial] = yield* initialTransition(machine)
      const microsteps = yield* getMicrosteps(machine, initial, { type: "GO" })
      assert.deepStrictEqual(
        microsteps.map(([snapshot, actions]) => [snapshot.value, typesOf(actions)]),
        [
          ["b", ["toB", "xstate.raise", "enterB"]],
          ["c", ["toC"]],
          ["d", ["toD", "enterD"]],
        ]
      )
    })
  )

  it.effect("[P8] getInitialMicrosteps starts with the initial microstep and its entry actions, with the input in the context", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        id: "p8-initial",
        context: ({ input }: { input: { readonly start: number } }) => ({ count: input.start }),
        initial: "a",
        entry: named("enterRoot"),
        states: {
          a: { entry: named("enterA"), always: { target: "b", actions: named("toB") } },
          b: { entry: named("enterB") },
        },
      })
      const microsteps = yield* getInitialMicrosteps(machine, { start: 7 })
      assert.deepStrictEqual(
        microsteps.map(([snapshot, actions]) => [snapshot.value, snapshot.context, typesOf(actions)]),
        [
          ["a", { count: 7 }, ["enterRoot", "enterA"]],
          ["b", { count: 7 }, ["toB", "enterB"]],
        ]
      )
    })
  )

  it.effect("[P8] getNextTransitions lists guarded, always and after transitions, each atomic node before its ancestors, regions in document order, each node once", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        id: "p8-next",
        type: "parallel",
        on: { ROOT: {} },
        states: {
          left: {
            initial: "one",
            on: { LEFT: ".two" },
            states: {
              one: {
                after: { 1000: "two" },
                always: { guard: () => false, target: "two" },
                on: { GUARDED: [{ guard: () => false, target: "two" }, { target: "two" }] },
              },
              two: {},
            },
          },
          right: {
            initial: "three",
            on: { RIGHT: ".four" },
            states: { three: { on: { THREE: "four" } }, four: {} },
          },
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      const transitions = yield* getNextTransitions(yield* actor.getSnapshot)
      assert.deepStrictEqual(
        transitions.map((t) => t.eventType),
        ["GUARDED", "GUARDED", "xstate.after.1000.p8-next.left.one", "", "LEFT", "ROOT", "THREE", "RIGHT"]
      )
    })
  )

  it.effect("[P8] each transition getNextTransitions lists holds its target nodes as upstream: an array of nodes, undefined for a targetless transition", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        id: "p8-target",
        initial: "a",
        states: {
          a: {
            on: {
              GO: "b",
              STAY: { actions: named("stay") },
              BOTH: { target: ["#p8-target.p.left", "#p8-target.p.right"] },
            },
          },
          b: {},
          p: { type: "parallel", states: { left: {}, right: {} } },
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      const transitions = yield* getNextTransitions(yield* actor.getSnapshot)
      assert.deepStrictEqual(
        transitions.map((t) => [t.eventType, t.target?.map((node) => node.id)]),
        [
          ["GO", ["p8-target.b"]],
          ["STAY", undefined],
          ["BOTH", ["p8-target.p.left", "p8-target.p.right"]],
        ]
      )
      assert.deepStrictEqual(
        transitions.map((t) => t.target?.[0]?.key),
        ["b", undefined, "left"]
      )
      assert.isTrue(transitions.every((t) => t.target === undefined || Array.isArray(t.target)))
    })
  )

  it.effect("[P8] a throwing guard fails getMicrosteps with the guard-evaluation text, a maxIterations loop fails it, and a final state has no next transitions", () =>
    Effect.gen(function* () {
      const guarded = createMachine({
        id: "p8-guard",
        initial: "a",
        states: {
          a: {
            on: {
              GO: {
                target: "b",
                guard: () => {
                  throw new Error("guard broke")
                },
              },
            },
          },
          b: {},
        },
      })
      const [initial] = yield* initialTransition(guarded)
      const guardError = yield* Effect.flip(getMicrosteps(guarded, initial, { type: "GO" }))
      assert.strictEqual(guardError.message, guardEvaluationFailed("", "GO", "p8-guard.a", "guard broke"))

      const looping = createMachine({
        id: "p8-loop",
        initial: "a",
        options: { maxIterations: 10 },
        states: {
          a: { on: { GO: "b" } },
          b: { always: "c" },
          c: { always: "b" },
        },
      })
      const [start] = yield* initialTransition(looping)
      const loopError = yield* Effect.flip(getMicrosteps(looping, start, { type: "GO" }))
      assert.strictEqual(loopError.message, infiniteLoop(10))

      const finished = createMachine({
        id: "p8-final",
        initial: "a",
        states: { a: { on: { DONE: "end" } }, end: { type: "final" } },
      })
      const actor = yield* createActor(finished)
      yield* actor.start
      yield* actor.send({ type: "DONE" })
      const done = yield* actor.getSnapshot
      assert.strictEqual(done.status, "done")
      assert.deepStrictEqual(yield* getNextTransitions(done), [])
    })
  )
})
