/**
 * S26: matchesState, getStateNodes, mapState and pathToStateValue are exported.
 *
 * T3.24, SD-3, SD-11, SD-20. Upstream `src/index.ts` at xstate@5.33.2 exports from the root:
 *
 * - `matchesState(parent, child)` (`src/utils.ts`): the pattern comes first; each side may be
 *   a state value or a dotted state path; an atomic pattern matches the same atomic value or a
 *   key of a compound value; a compound pattern matches when each of its keys is in the value
 *   and matches there; a pattern more specific than the value does not match.
 * - `pathToStateValue(path)` (`src/utils.ts`): one segment is that string, more segments
 *   nest, and the empty path is the empty object.
 * - `getStateNodes(stateNode, stateValue)` (`src/stateUtils.ts`): for a string value
 *   `[stateNode, child]`; for an object value `[machine.root, stateNode, ...the node of each
 *   key, ...each of those nodes' own list]`, duplicates included (upstream callers wrap it in
 *   `getAllStateNodes`); a key may name a node by `#id`; a value that names no state throws
 *   the upstream message.
 * - `mapState(snapshot, mapper)` (`src/mapState.ts`): from each active atomic node up to the
 *   root, each node once, it collects `{ stateNode, result }` for each node whose mapper
 *   (found by the node's path through nested `states`) has a `map`, called with the snapshot.
 *   The results are leaf to root, the most specific state first.
 *
 * The port: `getStateNodes` returns an Effect that fails with `MachineDefinitionError` and the
 * upstream text, because SD-3 keeps only three synchronous throw sites. `StateValue.fromPath`
 * keeps `''` for the empty path (SD-20). The graph `getStateNodes` is another function and
 * lives only in `./graph` (SD-11). `mapState` walks the snapshot's active nodes (`_nodes`) in
 * the order they became active, as upstream (CONF-4 pins that order).
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import * as Core from "../../src/index.js"
import {
  createActor,
  createMachine,
  Errors,
  getStateNodes,
  mapState,
  matchesState,
  pathToStateValue,
  setup,
  StateValue,
} from "../../src/index.js"
import { childStateDoesNotExist, childStateNodeDoesNotExist, stateDoesNotExist } from "./upstream-messages.js"

// ---------------------------------------------------------------- fixtures

/** Nested states with a custom id on `a`: the initial value is `{ a: 'one' }`. */
const nestedMachine = () =>
  createMachine({
    id: "s26",
    initial: "a",
    states: {
      a: {
        id: "alpha",
        initial: "one",
        states: { one: {}, two: {} },
      },
      b: {},
    },
  })

/** A parallel root: the initial value is `{ region1: 'x', region2: 'p' }`. */
const parallelMachine = () =>
  createMachine({
    id: "s26-parallel",
    type: "parallel",
    states: {
      region1: { initial: "x", states: { x: {}, y: {} } },
      region2: { initial: "p", states: { p: {}, q: {} } },
    },
  })

/** Context for the mapState machines. */
interface Count {
  readonly count: number
}

/** The nested machine with a context, as the upstream mapState tests build it. */
const countMachine = () =>
  setup({ types: { context: {} as Count } }).createMachine({
    id: "s26-count",
    context: { count: 42 },
    initial: "a",
    states: {
      a: { initial: "one", states: { one: {}, two: {} } },
      b: {},
    },
  })

describe("S26 matchesState, getStateNodes, mapState and pathToStateValue are exported", () => {
  it.effect("[S26] matchesState, getStateNodes, mapState and pathToStateValue are root exports", () =>
    Effect.sync(() => {
      assert.isFunction(Core.matchesState)
      assert.isFunction(Core.getStateNodes)
      assert.isFunction(Core.mapState)
      assert.isFunction(Core.pathToStateValue)
      // The root matchesState is the StateValue one with XState semantics, not the symmetric StateValue.matches
      assert.strictEqual(Core.matchesState, StateValue.matchesState)
    })
  )

  // ---------------------------------------------------------------- matchesState

  it.effect("[S26] matchesState follows the upstream match cases", () =>
    Effect.sync(() => {
      // upstream: test/match.test.ts > matchesState() > should return true if two states are equivalent
      assert.isTrue(matchesState("a", "a"))
      assert.isTrue(matchesState("b.b1", "b.b1"))
      assert.isFalse(matchesState("B.bar", { A: "foo" }))
      // upstream: test/match.test.ts > matchesState() > should return true if two state values are equivalent
      assert.isTrue(matchesState({ a: "b" }, { a: "b" }))
      assert.isTrue(matchesState({ a: { b: "c" } }, { a: { b: "c" } }))
      // upstream: test/match.test.ts > matchesState() > should return true if two parallel states are equivalent
      assert.isTrue(matchesState({ a: { b1: "foo", b2: "bar" } }, { a: { b1: "foo", b2: "bar" } }))
      assert.isTrue(matchesState({ a: "foo", b: "bar" }, { a: "foo", b: "bar" }))
      // upstream: test/match.test.ts > matchesState() > should return true if a state is a substate of a superstate
      assert.isTrue(matchesState("b", "b.b1"))
      assert.isTrue(matchesState("foo.bar", "foo.bar.baz.quo"))
      // upstream: test/match.test.ts > matchesState() > should return true if a state value is a substate of a superstate value
      assert.isTrue(matchesState("b", { b: "b1" }))
      assert.isTrue(matchesState({ foo: "bar" }, { foo: { bar: { baz: "quo" } } }))
      // upstream: test/match.test.ts > matchesState() > should return true if a parallel state value is a substate of a superstate value
      assert.isTrue(matchesState("b", { b: "b1", c: "c1" }))
      assert.isTrue(
        matchesState({ foo: "bar", fooAgain: "barAgain" }, { foo: { bar: { baz: "quo" } }, fooAgain: { barAgain: "baz" } })
      )
      // upstream: test/match.test.ts > matchesState() > should return false if two states are not equivalent
      assert.isFalse(matchesState("a", "b"))
      assert.isFalse(matchesState("a.a1", "b.b1"))
      // upstream: test/match.test.ts > matchesState() > should return false if parent state is more specific than child state
      assert.isFalse(matchesState("a.b.c", "a.b"))
      assert.isFalse(matchesState({ a: { b: { c: "d" } } }, { a: "b" }))
      // upstream: test/match.test.ts > matchesState() > should return false if two state values are not equivalent
      assert.isFalse(matchesState({ a: "a1" }, { b: "b1" }))
      // upstream: test/match.test.ts > matchesState() > should return false if a state is not a substate of a superstate
      assert.isFalse(matchesState("a", "b.b1"))
      assert.isFalse(matchesState("foo.false.baz", "foo.bar.baz.quo"))
      // upstream: test/match.test.ts > matchesState() > should return false if a state value is not a substate of a superstate value
      assert.isFalse(matchesState("a", { b: "b1" }))
      assert.isFalse(matchesState({ foo: { false: "baz" } }, { foo: { bar: { baz: "quo" } } }))
      // upstream: test/match.test.ts > matchesState() > should mix/match string state values and object state values
      assert.isTrue(matchesState("a.b.c", { a: { b: "c" } }))
    })
  )

  // ---------------------------------------------------------------- pathToStateValue

  it.effect("[S26] pathToStateValue of an empty path is the empty object; one segment is a string, more segments nest", () =>
    Effect.sync(() => {
      assert.deepStrictEqual(pathToStateValue([]), {})
      assert.strictEqual(pathToStateValue(["a"]), "a")
      assert.deepStrictEqual(pathToStateValue(["a", "b"]), { a: "b" })
      assert.deepStrictEqual(pathToStateValue(["a", "b", "c"]), { a: { b: "c" } })
      // The port function keeps its own result for the empty path (SD-20)
      assert.strictEqual(StateValue.fromPath([]), "")
      assert.strictEqual(StateValue.pathToStateValue, pathToStateValue)
    })
  )

  // ---------------------------------------------------------------- mapState

  it.effect("[S26] mapState returns one result per active mapped node, leaf to root, each map called with the snapshot", () =>
    Effect.gen(function* () {
      const machine = countMachine()
      const snapshot = yield* (yield* createActor(machine)).getSnapshot
      const received: Array<unknown> = []

      const results = mapState(snapshot, {
        map: (s) => {
          received.push(s)
          return `root:${s.context.count}`
        },
        states: {
          a: {
            map: ({ context }) => `a:${context.count}`,
            states: { one: { map: ({ context }) => `one:${context.count}` } },
          },
        },
      })

      assert.deepStrictEqual(
        results.map((r) => r.result),
        ["one:42", "a:42", "root:42"]
      )
      // The result nodes are the machine's own nodes, typed as any node (upstream `AnyStateNode`)
      const a = machine.states["a"]!
      assert.strictEqual<unknown>(results[0]?.stateNode, a.states["one"])
      assert.strictEqual<unknown>(results[1]?.stateNode, a)
      assert.strictEqual<unknown>(results[2]?.stateNode, machine.root)
      assert.deepStrictEqual(results[2]?.stateNode.path, [])
      assert.strictEqual(received.length, 1)
      assert.strictEqual(received[0], snapshot)
    })
  )

  it.effect("[S26] mapState runs only the mappers of active nodes and skips a node whose mapper has no map", () =>
    Effect.gen(function* () {
      const snapshot = yield* (yield* createActor(countMachine())).getSnapshot
      const called: Array<string> = []
      const mark = (name: string) => () => {
        called.push(name)
        return name
      }

      const results = mapState(snapshot, {
        states: {
          a: { states: { one: { map: mark("one") }, two: { map: mark("two") } } },
          b: { map: mark("b") },
          // @ts-expect-error a key that names no state is a type error for a setup machine (upstream StateSchemaMapper); at run time it maps nothing
          nope: { map: mark("nope") },
        },
      })

      assert.deepStrictEqual(
        results.map((r) => [r.stateNode.key, r.result]),
        [["one", "one"]]
      )
      assert.deepStrictEqual(called, ["one"])
      assert.deepStrictEqual(mapState(snapshot, {}), [])
    })
  )

  it.effect("[S26] mapState visits each node once across parallel regions: each region leaf to root, the root once", () =>
    Effect.gen(function* () {
      const snapshot = yield* (yield* createActor(parallelMachine())).getSnapshot
      const called: Array<string> = []
      const mark = (name: string) => () => {
        called.push(name)
        return name
      }

      const results = mapState(snapshot, {
        map: mark("root"),
        states: {
          region1: { map: mark("region1"), states: { x: { map: mark("x") }, y: { map: mark("y") } } },
          region2: { map: mark("region2"), states: { p: { map: mark("p") }, q: { map: mark("q") } } },
        },
      })

      assert.deepStrictEqual(
        results.map((r) => r.result),
        ["x", "region1", "root", "p", "region2"]
      )
      assert.deepStrictEqual(called, ["x", "region1", "root", "p", "region2"])
    })
  )

  it.effect("[S26] mapState maps a final state", () =>
    Effect.gen(function* () {
      const machine = setup({}).createMachine({
        initial: "active",
        states: {
          active: { on: { DONE: "finished" } },
          finished: { type: "final" },
        },
      })
      const actor = yield* createActor(machine)
      yield* actor.start
      yield* actor.send({ type: "DONE" })
      const snapshot = yield* actor.getSnapshot
      assert.strictEqual(snapshot.status, "done")

      const results = mapState(snapshot, {
        map: () => "root",
        states: { active: { map: () => "active" }, finished: { map: () => "finished" } },
      })

      assert.deepStrictEqual(
        results.map((r) => r.result),
        ["finished", "root"]
      )
    })
  )

  // ---------------------------------------------------------------- getStateNodes

  it.effect("[S26] getStateNodes returns upstream's node list for a partial state value, duplicates included", () =>
    Effect.gen(function* () {
      const machine = nestedMachine()
      const root = machine.root
      const a = machine.states["a"]!
      const one = a.states["one"]!
      const two = a.states["two"]!

      assert.deepStrictEqual(yield* getStateNodes(root, "a"), [root, a])
      assert.deepStrictEqual(yield* getStateNodes(root, { a: "one" }), [root, root, a, a, one])
      assert.deepStrictEqual(yield* getStateNodes(root, {}), [root, root])
      // A key may name a node by id
      assert.deepStrictEqual(yield* getStateNodes(root, { "#alpha": "two" }), [root, root, a, a, two])
      // From a node below the root: a string value gives the node and its child; an object value starts with the root
      assert.deepStrictEqual(yield* getStateNodes(a, "two"), [a, two])
      assert.deepStrictEqual(yield* getStateNodes(a, { one: {} }), [root, a, one, root, one])

      const parallel = parallelMachine()
      const region1 = parallel.states["region1"]!
      const region2 = parallel.states["region2"]!
      assert.deepStrictEqual(yield* getStateNodes(parallel.root, { region1: "y", region2: "p" }), [
        parallel.root,
        parallel.root,
        region1,
        region2,
        region1,
        region1.states["y"]!,
        region2,
        region2.states["p"]!,
      ])
    })
  )

  it.effect("[S26] getStateNodes fails with MachineDefinitionError and the upstream message for a value that names no state", () =>
    Effect.gen(function* () {
      const machine = nestedMachine()
      const root = machine.root

      const atomic = yield* Effect.flip(getStateNodes(root, "nope"))
      assert.instanceOf(atomic, Errors.MachineDefinitionError)
      assert.strictEqual(atomic.message, stateDoesNotExist("nope", "s26"))

      const key = yield* Effect.flip(getStateNodes(root, { nope: "x" }))
      assert.strictEqual(key.message, childStateDoesNotExist("nope", "s26"))

      const deep = yield* Effect.flip(getStateNodes(root, { a: "nope" }))
      assert.strictEqual(deep.message, stateDoesNotExist("nope", "alpha"))

      const id = yield* Effect.flip(getStateNodes(root, { "#missing": "x" }))
      assert.strictEqual(id.message, childStateNodeDoesNotExist("missing", "s26"))
    })
  )
})
