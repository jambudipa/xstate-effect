/**
 * S15: a single non-array entry or exit action runs (SD-15), on the rebuilt state node model.
 *
 * T2.32. The machine build normalises a single `entry`/`exit` action (before, a string split
 * into its characters and an object was dropped), keeps children in config (document)
 * order and numbers the nodes in that order, honours a custom state `id` while the children
 * keep `<machineId>.<path>` ids, sets `path` as XState does (`[]` at the root), links every
 * node to its parent and its machine, accepts a forbidden transition (`on: { E: undefined }`),
 * keeps transition `meta`, and resolves targets to nodes once the whole tree exists. Built
 * nodes are instances of the root `StateNode` class (upstream `src/StateNode.ts` at
 * xstate@5.33.2), which keeps the former namespace members as static members (SD-11).
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Equal, Hash, Option, Stream } from "effect"
import {
  type ActorLogicType,
  type ActorType,
  createActor,
  createMachine,
  type EventObject,
  getChildren,
  getTransitions,
  type SnapshotType,
  StateNode,
  Types,
} from "../../src/index.js"

/** An action definition that appends `label` to `log` each time it runs. */
const recorder = (log: Array<string>, label: string) => ({
  type: label,
  exec: () =>
    Effect.sync(() => {
      log.push(label)
      return Types.ActionResult.NoOp()
    }),
})

/** `idle -GO-> a -NEXT-> b`; `a` has one named entry action and one inline exit action. */
const singleActionMachine = (log: Array<string>) => {
  const inlineExit = recorder(log, "inline exit")
  const machine = createMachine(
    {
      id: "m",
      initial: "idle",
      context: {},
      states: {
        idle: { on: { GO: "a" } },
        a: { entry: "named", exit: inlineExit, on: { NEXT: "b" } },
        b: {},
      },
    },
    { actions: { named: recorder(log, "named entry") } }
  )
  return { machine, inlineExit }
}

/** Creates and starts an actor of `logic`. */
const startActor = <S extends SnapshotType, E extends EventObject, Em extends EventObject, R>(
  logic: ActorLogicType<S, E, unknown, Em, R>
) => Effect.tap(createActor(logic, { id: "s15" }), (actor) => actor.start)

const valueOf = (snapshot: object): unknown => ("value" in snapshot ? snapshot.value : undefined)

/** Waits until the actor's snapshot value is `value`. */
const reach = (actor: Pick<ActorType.Any, "changes">, value: string) =>
  actor.changes.pipe(
    Stream.filter((snapshot) => valueOf(snapshot) === value),
    Stream.runHead
  )

/** Every node of the tree under `node`, in document (pre-)order. */
const walk = <C, E extends EventObject>(node: StateNode<C, E>): ReadonlyArray<StateNode<C, E>> => [
  node,
  ...Object.values(node.states).flatMap((child) => walk(child)),
]

const SIBLINGS = [
  "kilo", "alpha", "zulu", "echo", "bravo", "yankee", "delta",
  "xray", "charlie", "whiskey", "foxtrot", "victor", "golf", "uniform",
]

describe("S15 single entry and exit actions on the rebuilt state node model", () => {
  it.effect("[S15] a single named entry action and a single inline exit action each run once", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const { machine } = singleActionMachine(log)
      const actor = yield* startActor(machine)

      yield* actor.send({ type: "GO" })
      yield* reach(actor, "a")
      assert.deepStrictEqual(log, ["named entry"])

      yield* actor.send({ type: "NEXT" })
      yield* reach(actor, "b")
      assert.deepStrictEqual(log, ["named entry", "inline exit"])
    })
  )

  it.effect("[S15] the built node holds a single string or object action once, unchanged", () =>
    Effect.gen(function* () {
      const { machine, inlineExit } = singleActionMachine([])
      const a = yield* machine.getStateNodeById("m.a")

      assert.deepStrictEqual(Array.from(a.entry), ["named"])
      const exits = Array.from(a.exit)
      assert.strictEqual(exits.length, 1)
      assert.strictEqual(exits[0], inlineExit)
    })
  )

  it.effect("[S15] children keep config order with fourteen siblings and order numbers nodes in document order", () =>
    Effect.sync(() => {
      const machine = createMachine({
        id: "doc",
        initial: "kilo",
        context: {},
        states: Object.fromEntries(
          SIBLINGS.map((key) => [key, key === "echo" ? { initial: "two", states: { two: {}, one: {} } } : {}])
        ),
      })
      const root = machine.root

      assert.deepStrictEqual(Object.keys(root.states), SIBLINGS)
      assert.deepStrictEqual(Array.from(getChildren(root), (node) => node.key), SIBLINGS)

      const expectedKeys = ["doc", ...SIBLINGS.flatMap((key) => (key === "echo" ? ["echo", "two", "one"] : [key]))]
      const nodes = walk(root)
      assert.deepStrictEqual(
        nodes.map((node) => [node.key, node.order]),
        expectedKeys.map((key, order) => [key, order])
      )
      assert.deepStrictEqual(machine.stateIds, nodes.map((node) => node.id))
    })
  )

  it.effect("[S15] a custom id names its node, its children keep machine-id-plus-path ids, and path follows XState", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        id: "m",
        initial: "a",
        context: {},
        states: {
          a: { initial: "b", states: { b: {} } },
          c: { id: "custom", initial: "d", states: { d: {} } },
        },
      })
      const root = machine.root
      assert.strictEqual(root.id, "m")
      assert.deepStrictEqual(root.path, [])

      const b = yield* machine.getStateNodeById("m.a.b")
      assert.deepStrictEqual(b.path, ["a", "b"])

      const c = yield* machine.getStateNodeById("custom")
      assert.strictEqual(c, root.states["c"])
      assert.strictEqual(c.key, "c")
      assert.strictEqual(c.id, "custom")
      assert.deepStrictEqual(c.path, ["c"])

      const d = yield* machine.getStateNodeById("m.c.d")
      assert.strictEqual(d, c.states["d"])
      assert.deepStrictEqual(d.path, ["c", "d"])
      assert.include(machine.stateIds, "custom")
      assert.notInclude(machine.stateIds, "m.c")
    })
  )

  it.effect("[S15] on: { E: undefined } builds a forbidden transition without throwing", () =>
    Effect.sync(() => {
      const machine = createMachine({
        id: "m",
        initial: "a",
        context: {},
        states: { a: { on: { E: undefined } } },
      })
      const a = machine.root.states["a"]
      assert.isDefined(a)
      const transitions = Array.from(getTransitions(a!, "E"))

      assert.strictEqual(transitions.length, 1)
      assert.isUndefined(transitions[0]!.target)
      assert.strictEqual(Array.from(transitions[0]!.actions).length, 0)
      assert.strictEqual(transitions[0]!.eventType, "E")
    })
  )

  it.effect("[S15] every node links to its parent and machine, toJSON stops at the node, and nodes compare by reference", () =>
    Effect.sync(() => {
      const config = {
        id: "m",
        initial: "a",
        context: {},
        states: {
          a: { initial: "b", states: { b: {} } },
          p: { type: "parallel" as const, states: { x: {}, y: { id: "why" } } },
        },
      }
      const machine = createMachine(config)
      const nodes = walk(machine.root)
      assert.strictEqual(nodes.length, 6)

      for (const node of nodes) {
        assert.isTrue(Option.isSome(node.machine), node.id)
        assert.strictEqual(Option.getOrUndefined(node.machine), machine, node.id)
        for (const child of Object.values(node.states)) {
          assert.strictEqual(Option.getOrUndefined(child.parent), node, child.id)
        }
      }
      assert.isTrue(Option.isNone(machine.root.parent))

      const b = machine.root.states["a"]?.states["b"]
      assert.isDefined(b)
      // The node's JSON is its definition (upstream `toJSON`): no parent and no machine
      const json: unknown = JSON.parse(JSON.stringify(b))
      assert.deepStrictEqual(json, {
        id: "m.a.b",
        key: "b",
        type: "atomic",
        initial: { target: [], source: "#m.a.b", actions: [], eventType: null },
        history: false,
        states: {},
        on: {},
        transitions: [],
        entry: [],
        exit: [],
        order: 2,
        invoke: [],
        tags: [],
      })

      const twin = createMachine(config).root.states["a"]?.states["b"]
      assert.isTrue(Equal.equals(b, b))
      assert.isFalse(Equal.equals(b, twin))
      assert.strictEqual(typeof Hash.hash(machine.root), "number")
    })
  )

  it.effect("[S15] built nodes are instances of the root StateNode class, which keeps the namespace members", () =>
    Effect.sync(() => {
      const { machine } = singleActionMachine([])
      for (const node of walk(machine.root)) {
        assert.instanceOf(node, StateNode, node.id)
        assert.isTrue(StateNode.isStateNode(node), node.id)
      }
      assert.strictEqual(Option.getOrUndefined(StateNode.getChild(machine.root, "a")), machine.root.states["a"])
      assert.isTrue(StateNode.isAncestor(machine.root, machine.root.states["a"]!))
      assert.strictEqual(typeof StateNode.make, "function")
    })
  )

  it.effect("[S15] transition targets resolve to the target nodes once the tree exists, and meta is kept", () =>
    Effect.sync(() => {
      const machine = createMachine({
        id: "m",
        initial: "a",
        context: {},
        states: {
          a: {
            initial: "a1",
            on: { CHILD: ".a2" },
            states: {
              a1: { on: { SIB: "a2", ID: "#custom", META: { target: "a2", meta: { reason: "kept" } } } },
              a2: {},
            },
          },
          b: { id: "custom" },
        },
      })
      const a = machine.root.states["a"]!
      const a1 = a.states["a1"]!
      const a2 = a.states["a2"]!
      const b = machine.root.states["b"]!
      const targetOf = <C, E extends EventObject>(node: StateNode<C, E>, event: string) =>
        Array.from(getTransitions(node, event)).map((transition) => transition.target)

      assert.deepStrictEqual(targetOf(a1, "SIB"), [[a2]])
      assert.strictEqual(targetOf(a1, "SIB")[0]?.[0], a2)
      assert.strictEqual(targetOf(a1, "ID")[0]?.[0], b)
      assert.strictEqual(targetOf(a, "CHILD")[0]?.[0], a2)

      const [meta] = Array.from(getTransitions(a1, "META"))
      assert.deepStrictEqual(meta!.meta, { reason: "kept" })
      assert.strictEqual(meta!.target?.[0], a2)
    })
  )
})
