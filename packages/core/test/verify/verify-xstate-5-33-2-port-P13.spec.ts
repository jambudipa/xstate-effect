/**
 * P13: The graph entry point computes paths and test models.
 *
 * T7.11 (the traversals), T7.12 (the test models). Upstream `src/graph/*.ts` at
 * xstate@5.33.2 (`xstate/graph`) traverses a logic breadth-first from its initial snapshot (or
 * `fromState`) over the events each snapshot takes (`getAdjacencyMap`), with a mock actor
 * scope whose `actionExecutor` runs no custom action. `getShortestPaths` walks that map with
 * weight 1 per transition, `getSimplePaths` walks it depth-first without revisiting a state,
 * and `getPathsFromEvents` follows one event sequence; each path starts with `xstate.init`.
 * `filterEvents` (5.30) leaves an event out of the traversal, `stopWhen` (and `toState`) stops
 * it at a state, and a traversal of more than `limit` states throws `Traversal limit
 * exceeded`. `joinPaths` throws `Paths cannot be joined` for a tail that does not start where
 * the head ends. `createTestModel` throws for a machine with an invocation, an `after`
 * transition or a delayed inline action; a path test runs, for each step, the executor of its
 * event and then the state tests whose key matches the state (a state value, a `#id`, or `*`
 * when no other key matches), and appends the path trace to the message of what failed.
 *
 * In the port (SD-13) the traversals, `joinPaths`, `createTestModel`, the model's path methods
 * and the path tests return Effects; they fail where upstream throws, with the upstream
 * messages (SD-3), and they run synchronously, so `Effect.runSync` can build paths and test
 * models while Vitest collects tests (the dieHard rewrite does). `filterEvents`, event
 * executors and state tests may return an Effect, so `snapshot.can(event)` (an Effect, SD-6)
 * is a filter as it is; a state test that throws fails the path test with the thrown value.
 * The `TestModel` constructor, `getStateNodes`, `toDirectedGraph`, `serializeSnapshot` and
 * `adjacencyMapToArray` stay synchronous. `getPathsFromEvents` with an event that has no entry
 * in the adjacency map fails with upstream's "Invalid transition" message, where upstream
 * meets a `TypeError` first (ledger DEV-49).
 */
import { assert, describe, it, vi } from "@effect/vitest"
import { Effect, Option } from "effect"
import { assign, createMachine, fromTransition, isMachineSnapshot, raise, sendTo } from "../../src/index.js"
import {
  type AdjacencyMap,
  adjacencyMapToArray,
  createShortestPathsGen,
  createSimplePathsGen,
  createTestModel,
  getAdjacencyMap,
  getPathsFromEvents,
  getShortestPaths,
  getSimplePaths,
  getStateNodes,
  joinPaths,
  serializeSnapshot,
  TestModel,
  toDirectedGraph,
} from "../../src/graph/index.js"
import {
  invalidGraphTransition,
  pathsCannotBeJoined,
  testModelAfter,
  testModelDelayedActions,
  testModelInvocations,
  traversalLimitExceeded,
} from "./upstream-messages.js"

// ---------------------------------------------------------------- fixtures

/** `green -TIMER-> yellow -TIMER-> red -TIMER-> green`. */
const trafficLight = createMachine({
  id: "p13-light",
  initial: "green",
  states: {
    green: { on: { TIMER: "yellow" } },
    yellow: { on: { TIMER: "red" } },
    red: { on: { TIMER: "green" } },
  },
})

/** `a -EVENT-> b -EVENT-> c`, then `c -EVENT-> d` or `c -EVENT_2-> e`. */
const multiPath = createMachine({
  id: "p13-multi",
  initial: "a",
  states: {
    a: { on: { EVENT: "b" } },
    b: { on: { EVENT: "c" } },
    c: { on: { EVENT: "d", EVENT_2: "e" } },
    d: {},
    e: {},
  },
})

/** `start -NEXT-> idle`; in `idle`, `PROCEED` to `done` needs `allowed`, which `ALLOW` sets. */
const guarded = createMachine({
  id: "p13-guarded",
  initial: "start",
  context: { allowed: false },
  states: {
    start: { on: { NEXT: "idle" } },
    idle: {
      on: {
        PROCEED: { target: "done", guard: ({ context }) => context.allowed },
        ALLOW: { actions: assign({ allowed: true }) },
      },
    },
    done: { type: "final" },
  },
})

/** One state whose `INC` counts without end. */
const counter = createMachine({
  types: {} as { context: { count: number } },
  id: "p13-counter",
  context: { count: 0 },
  on: { INC: { actions: assign({ count: ({ context }) => context.count + 1 }) } },
})

/** The event types of each step of each path. */
const eventTypes = (
  paths: ReadonlyArray<{ readonly steps: ReadonlyArray<{ readonly event: { readonly type: string } }> }>
) => paths.map((path) => path.steps.map((step) => step.event.type))

describe("P13 The graph entry point computes paths and test models", () => {
  // ---------------------------------------------------------------- traversals

  it.effect("[P13] getShortestPaths gives one shortest path to each reachable state, each starting with xstate.init", () =>
    Effect.gen(function* () {
      const paths = yield* getShortestPaths(multiPath)

      assert.deepStrictEqual(
        paths.map((path) => path.state.value),
        ["a", "b", "c", "d", "e"]
      )
      assert.deepStrictEqual(eventTypes(paths), [
        ["xstate.init"],
        ["xstate.init", "EVENT"],
        ["xstate.init", "EVENT", "EVENT"],
        ["xstate.init", "EVENT", "EVENT", "EVENT"],
        ["xstate.init", "EVENT", "EVENT", "EVENT_2"],
      ])
      assert.deepStrictEqual(
        paths.map((path) => path.weight),
        [0, 1, 2, 3, 3]
      )
    }))

  it.effect("[P13] getShortestPaths with toState keeps the paths to the matching states and does not traverse past them", () =>
    Effect.gen(function* () {
      // Upstream shortestPaths.test.ts: `d` loops on itself and would traverse forever
      const loop = createMachine({
        types: {} as { context: { count: number } },
        id: "p13-loop",
        initial: "a",
        context: { count: 0 },
        states: {
          a: { on: { NEXT: "b" } },
          b: { on: { NEXT: "c" } },
          c: { on: { NEXT: "d" } },
          d: { on: { NEXT: { target: "d", actions: assign({ count: ({ context }) => context.count + 1 }) } } },
        },
      })

      const paths = yield* getShortestPaths(loop, { toState: (state) => state.matches("c") })

      assert.deepStrictEqual(eventTypes(paths), [["xstate.init", "NEXT", "NEXT"]])
    }))

  it.effect("[P13] getSimplePaths gives every path that visits no state twice, grouped by end state", () =>
    Effect.gen(function* () {
      // Upstream graph.test.ts > should return multiple paths for equivalent transitions
      const equivalent = createMachine({
        id: "p13-equivalent",
        initial: "a",
        states: {
          a: { on: { FOO: "b", BAR: "b" } },
          b: { on: { FOO: "a", BAR: "a" } },
        },
      })

      const paths = yield* getSimplePaths(equivalent)

      assert.deepStrictEqual(eventTypes(paths), [["xstate.init"], ["xstate.init", "FOO"], ["xstate.init", "BAR"]])
    }))

  it.effect("[P13] the path generators give the shortest and the simple paths", () =>
    Effect.gen(function* () {
      const shortest = yield* createShortestPathsGen<
        Effect.Success<ReturnType<typeof multiPath.resolveState>>,
        { readonly type: string },
        unknown
      >()(multiPath, {})
      const simple = yield* createSimplePathsGen<
        Effect.Success<ReturnType<typeof multiPath.resolveState>>,
        { readonly type: string },
        unknown
      >()(multiPath, {})

      assert.deepStrictEqual(eventTypes(shortest), eventTypes(yield* getShortestPaths(multiPath)))
      assert.deepStrictEqual(eventTypes(simple), eventTypes(yield* getSimplePaths(multiPath)))
    }))

  it.effect("[P13] filterEvents removes the disabled events from the traversal, with snapshot.can as the filter", () =>
    Effect.gen(function* () {
      // The serialized events `idle` (not allowed yet) takes in the map
      const idle = serializeSnapshot((yield* guarded.resolveState({ value: "idle", context: { allowed: false } })))
      const idleTransitions = <S, E>(adjacency: AdjacencyMap<S, E>) => Object.keys(adjacency[idle]?.transitions ?? {})

      const unfiltered = yield* getAdjacencyMap(guarded, {})
      assert.deepStrictEqual(idleTransitions(unfiltered), ['{"type":"PROCEED"}', '{"type":"ALLOW"}'])

      const filtered = yield* getAdjacencyMap(guarded, {
        filterEvents: (state, event) => (isMachineSnapshot(state) ? state.can(event) : Effect.succeed(true)),
      })
      assert.deepStrictEqual(idleTransitions(filtered), ['{"type":"ALLOW"}'])

      // A plain boolean filter works too
      const noAllow = yield* getAdjacencyMap(guarded, { filterEvents: (_state, event) => event.type !== "ALLOW" })
      assert.deepStrictEqual(idleTransitions(noAllow), ['{"type":"PROCEED"}'])

      // Upstream graph.test.ts > should support filtering disabled events
      const paths = yield* getSimplePaths(guarded, {
        filterEvents: (state, event) => state.can(event),
        toState: (state) => state.status === "done",
      })
      assert.deepStrictEqual(eventTypes(paths), [["xstate.init", "NEXT", "ALLOW", "PROCEED"]])
    }))

  it.effect("[P13] getPathsFromEvents follows the event sequence from the initial state or from fromState", () =>
    Effect.gen(function* () {
      const [path] = yield* getPathsFromEvents(trafficLight, [{ type: "TIMER" }, { type: "TIMER" }])
      assert.isDefined(path)
      assert.strictEqual(path?.state.value, "red")
      assert.deepStrictEqual(eventTypes(path ? [path] : []), [["xstate.init", "TIMER", "TIMER"]])

      const [fromYellow] = yield* getPathsFromEvents(trafficLight, [{ type: "TIMER" }], {
        fromState: (yield* trafficLight.resolveState({ value: "yellow" })),
      })
      assert.strictEqual(fromYellow?.state.value, "red")

      // A sequence that does not end in the toState state gives no path
      const none = yield* getPathsFromEvents(trafficLight, [{ type: "TIMER" }], {
        toState: (state) => state.matches("red"),
      })
      assert.deepStrictEqual(none, [])
    }))

  it.effect("[P13] getPathsFromEvents fails with the recorded message for an event that leads nowhere (DEV-49)", () =>
    Effect.gen(function* () {
      const machine = createMachine({ id: "p13-invalid", initial: "a", states: { a: { on: { NEXT: "b" } }, b: {} } })

      const error = yield* Effect.flip(
        getPathsFromEvents(machine, [{ type: "NEXT" }], { filterEvents: () => false })
      )

      assert.strictEqual(error._tag, "InvalidEventSequenceError")
      assert.strictEqual(error.message, invalidGraphTransition('{"value":"a"}', '{"type":"NEXT"}'))
    }))

  it.effect("[P13] getAdjacencyMap and adjacencyMapToArray list each state with each event and its next state", () =>
    Effect.gen(function* () {
      const rows = <S extends { readonly value: unknown }, E extends { readonly type: string }>(
        adjacency: AdjacencyMap<S, E>
      ) => adjacencyMapToArray(adjacency).map(({ state, event, nextState }) => [state.value, event.type, nextState.value])

      assert.deepStrictEqual(rows(yield* getAdjacencyMap(trafficLight, {})), [
        ["green", "TIMER", "yellow"],
        ["yellow", "TIMER", "red"],
        ["red", "TIMER", "green"],
      ])

      // A serializeState that keys a state by the event that reached it too (as a test model
      // keys its transitions) visits `green` again: upstream adjacency.test.ts > function
      // generates an adjacency map (converted to an array)
      const byTransition = yield* getAdjacencyMap(trafficLight, {
        serializeState: (state, event) => `${serializeSnapshot(state)} via ${event ? event.type : "start"}`,
      })
      const fourRows = [
        ["green", "TIMER", "yellow"],
        ["yellow", "TIMER", "red"],
        ["red", "TIMER", "green"],
        ["green", "TIMER", "yellow"],
      ]
      assert.deepStrictEqual(rows(byTransition), fourRows)

      // A test model keys its states that way: the same four rows from its adjacency map
      const model = yield* createTestModel(trafficLight)
      assert.deepStrictEqual(rows(yield* model.getAdjacencyMap()), fourRows)
    }))

  it.effect("[P13] a traversal that exceeds its limit fails with the recorded message", () =>
    Effect.gen(function* () {
      // Upstream index.test.ts > prevents infinite recursion based on a provided limit
      const error = yield* Effect.flip(getShortestPaths(counter, { events: [{ type: "INC" }], limit: 100 }))
      assert.strictEqual(error._tag, "TraversalLimitError")
      assert.strictEqual(error.message, traversalLimitExceeded)
      // It prints as upstream's plain Error: `[Error: Traversal limit exceeded]`
      assert.strictEqual(error.name, "Error")

      // Every traversal stops the same way
      const simpleError = yield* Effect.flip(getSimplePaths(counter, { limit: 100 }))
      const adjacencyError = yield* Effect.flip(getAdjacencyMap(counter, { limit: 100 }))
      assert.deepStrictEqual(
        [simpleError._tag, simpleError.message, adjacencyError._tag, adjacencyError.message],
        ["TraversalLimitError", traversalLimitExceeded, "TraversalLimitError", traversalLimitExceeded]
      )

      // A test model takes the events of each state from the machine, and stops the same way
      const model = yield* createTestModel(counter)
      const modelError = yield* Effect.flip(model.getShortestPaths({ limit: 100 }))
      assert.deepStrictEqual(
        [modelError._tag, modelError.message, modelError.name],
        ["TraversalLimitError", traversalLimitExceeded, "Error"]
      )

      // stopWhen stops the same traversal within the limit
      const stopped = yield* getShortestPaths(counter, {
        events: [{ type: "INC" }],
        limit: 100,
        stopWhen: (state) => state.context.count === 5,
      })
      assert.deepStrictEqual(
        stopped.map((path) => path.state.context.count),
        [0, 1, 2, 3, 4, 5]
      )
    }))

  it.effect("[P13] the traversals take delayed transitions, transition-function logic and a from-state", () =>
    Effect.gen(function* () {
      // Upstream shortestPaths.test.ts > should work for machines with delays
      const delayed = createMachine({ initial: "a", states: { a: { after: { 1000: "b" } }, b: {} } })
      assert.deepStrictEqual(eventTypes(yield* getShortestPaths(delayed)), [
        ["xstate.init"],
        ["xstate.init", "xstate.after.1000.(machine).a"],
      ])

      // Upstream graph.test.ts > simple paths for transition functions
      const logic = fromTransition((state: number, event: { readonly type: string }) => {
        if (event.type === "a") return 1
        if (event.type === "b" && state === 1) return 2
        if (event.type === "reset") return 0
        return state
      }, 0)
      const paths = yield* getShortestPaths(logic, { events: [{ type: "a" }, { type: "b" }, { type: "reset" }] })
      assert.deepStrictEqual(
        paths.map((path) => path.state.context),
        [0, 1, 2]
      )

      // Upstream graph.test.ts > from-state can be specified
      const fromB = yield* getShortestPaths(multiPath, { fromState: (yield* multiPath.resolveState({ value: "b" })) })
      assert.deepStrictEqual(eventTypes(fromB)[0], ["xstate.init"])
      assert.strictEqual(fromB[0]?.state.value, "b")
    }))

  it.effect("[P13] a traversal runs no custom action, as upstream's mock actor scope", () =>
    Effect.gen(function* () {
      const ran: Array<string> = []
      const machine = createMachine({
        id: "p13-actions",
        initial: "a",
        entry: () => {
          ran.push("entry")
        },
        states: {
          a: {
            on: {
              NEXT: {
                target: "b",
                actions: () => {
                  ran.push("NEXT")
                },
              },
            },
          },
          b: {},
        },
      })

      const paths = yield* getShortestPaths(machine)

      assert.deepStrictEqual(eventTypes(paths), [["xstate.init"], ["xstate.init", "NEXT"]])
      assert.deepStrictEqual(ran, [])
    }))

  it("[P13] the graph Effects run synchronously, so Effect.runSync builds paths while tests are collected", () => {
    const paths = Effect.runSync(getShortestPaths(trafficLight))
    assert.deepStrictEqual(
      paths.map((path) => path.state.value),
      ["green", "yellow", "red"]
    )
    assert.strictEqual(Effect.runSync(getSimplePaths(trafficLight)).length, 3)
    const [path] = Effect.runSync(getPathsFromEvents(trafficLight, [{ type: "TIMER" }]))
    assert.strictEqual(path?.state.value, "yellow")
    assert.strictEqual(Object.keys(Effect.runSync(getAdjacencyMap(trafficLight, {}))).length, 3)

    // A test model, its paths and its path tests need no service either
    const model = Effect.runSync(createTestModel(trafficLight))
    const modelPaths = Effect.runSync(model.getSimplePaths())
    assert.strictEqual(modelPaths.length, 1)
    const tested: Array<string> = []
    for (const modelPath of modelPaths) {
      Effect.runSync(
        modelPath.test({
          states: {
            "*": (state) => {
              tested.push(String(state.value))
            },
          },
        })
      )
    }
    // The model keys `green` by the transition that reached it, so the one path ends in it again
    assert.deepStrictEqual(tested, ["green", "yellow", "red", "green"])
  })

  // ---------------------------------------------------------------- structure

  it.effect("[P13] joinPaths joins a tail that starts where the head ends, and fails with the recorded message otherwise", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        id: "p13-join",
        initial: "a",
        states: { a: { on: { NEXT: "b" } }, b: { on: { TO_C: "c" } }, c: {} },
      })
      const [toB] = yield* getPathsFromEvents(machine, [{ type: "NEXT" }])
      assert.isDefined(toB)
      if (!toB) return
      const [toC] = yield* getPathsFromEvents(machine, [{ type: "TO_C" }], { fromState: toB.state })
      const [toCFromA] = yield* getPathsFromEvents(machine, [{ type: "TO_C" }])
      assert.isDefined(toC)
      assert.isDefined(toCFromA)
      if (!toC || !toCFromA) return

      const joined = yield* joinPaths(toB, toC)
      assert.deepStrictEqual(eventTypes([joined]), [["xstate.init", "NEXT", "TO_C"]])
      assert.strictEqual(joined.state.value, "c")
      assert.strictEqual(joined.weight, toB.weight + toC.weight)

      const error = yield* Effect.flip(joinPaths(toB, toCFromA))
      assert.strictEqual(error._tag, "JoinPathsError")
      assert.strictEqual(error.message, pathsCannotBeJoined)
      assert.strictEqual(error.name, "Error")
    }))

  it.effect("[P13] getStateNodes, toDirectedGraph and serializeSnapshot read the machine synchronously", () =>
    Effect.gen(function* () {
      const machine = createMachine({
        id: "light",
        initial: "green",
        context: {},
        states: {
          green: { on: { TIMER: "yellow" } },
          yellow: { on: { TIMER: "red" } },
          red: {
            initial: "walk",
            states: { walk: { on: { COUNTDOWN: "stop" } }, stop: { type: "final" } },
            onDone: "green",
          },
        },
      })

      assert.deepStrictEqual(
        getStateNodes(machine).map((node) => node.id),
        ["light.green", "light.yellow", "light.red", "light.red.walk", "light.red.stop"]
      )
      assert.deepStrictEqual(
        getStateNodes(machine.root.states.red!).map((node) => node.id),
        ["light.red.walk", "light.red.stop"]
      )

      // Upstream graph.test.ts > toDirectedGraph: the JSON form holds ids, children and edges
      const graph = toDirectedGraph(machine.root.states.red!)
      assert.deepStrictEqual(JSON.parse(JSON.stringify(graph)), {
        id: "light.red",
        children: [
          {
            id: "light.red.walk",
            children: [],
            edges: [{ source: "light.red.walk", target: "light.red.stop", label: { text: "COUNTDOWN" } }],
          },
          { id: "light.red.stop", children: [], edges: [] },
        ],
        edges: [{ source: "light.red", target: "light.green", label: { text: "xstate.done.state.light.red" } }],
      })
      // The live form holds the state nodes and the transition of each edge
      assert.strictEqual(graph.stateNode, machine.root.states.red)
      assert.strictEqual(graph.edges[0]?.target, machine.root.states.green)
      assert.strictEqual(graph.edges[0]?.transition.eventType, "xstate.done.state.light.red")
      assert.strictEqual(toDirectedGraph(machine).id, "light")

      assert.strictEqual(serializeSnapshot((yield* machine.resolveState({ value: "green" }))), '{"value":"green"}')
      assert.strictEqual(
        serializeSnapshot((yield* counter.resolveState({ value: {}, context: { count: 2 } }))),
        '{"value":{},"context":{"count":2}}'
      )
    }))

  // ---------------------------------------------------------------- test models

  it.effect("[P13] a test model's path test runs each step's event executor, then the state tests of its state", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const model = yield* createTestModel(
        createMachine({ id: "p13-steps", initial: "a", states: { a: { on: { EVENT: "b" } }, b: {} } })
      )
      const [path] = yield* model.getShortestPaths({ toState: (state) => state.matches("b") })
      assert.isDefined(path)
      if (!path) return

      assert.strictEqual(path.description, 'Reaches state "b": xstate.init → EVENT')
      const result = yield* path.test({
        events: {
          EVENT: ({ event }) => {
            log.push(`exec ${event.type}`)
          },
        },
        states: {
          a: (state) => {
            log.push(`state ${String(state.value)}`)
          },
          // A state test may return an Effect, which runs
          b: (state) => Effect.sync(() => log.push(`state ${String(state.value)}`)),
        },
      })

      assert.deepStrictEqual(log, ["state a", "exec EVENT", "state b"])
      // Each step passed: no error of its event or its state
      assert.deepStrictEqual(
        result.steps.map((step) => [step.step.event.type, Option.isNone(step.event.error), Option.isNone(step.state.error)]),
        [
          ["xstate.init", true, true],
          ["EVENT", true, true],
        ]
      )

      // testTransition runs the executor of one step's event, testState the tests of one state
      const [, eventStep] = path.steps
      assert.isDefined(eventStep)
      if (!eventStep) return
      log.length = 0
      yield* model.testTransition({ events: { EVENT: () => Effect.sync(() => log.push("exec only")) } }, eventStep)
      yield* model.testState({ states: { b: () => Effect.sync(() => log.push("state only")) } }, path.state)
      assert.deepStrictEqual(log, ["exec only", "state only"])
    }))

  it.effect("[P13] state tests match by state key, nested key, #id, and * for the states no other key matches", () =>
    Effect.gen(function* () {
      const tested: Array<string> = []
      const model = yield* createTestModel(
        createMachine({
          id: "p13-keys",
          initial: "a",
          states: {
            a: { on: { EVENT: "b", OTHER: "c" } },
            b: { id: "state_b", initial: "b1", states: { b1: {} } },
            c: {},
          },
        })
      )

      for (const path of yield* model.getShortestPaths()) {
        yield* path.test({
          states: {
            a: () => {
              tested.push("a")
            },
            "b.b1": () => {
              tested.push("b.b1")
            },
            "#state_b": () => {
              tested.push("#state_b")
            },
            "*": (state) => {
              tested.push(`* ${JSON.stringify(state.value)}`)
            },
          },
        })
      }

      assert.deepStrictEqual(tested, ["a", "b.b1", "#state_b", "a", '* "c"'])
    }))

  it.effect("[P13] a failing state test fails the path test with the original error, its message followed by the path", () =>
    Effect.gen(function* () {
      // Upstream dieHard.test.ts > error path trace > should show an error path trace
      const model = yield* createTestModel(
        createMachine({
          id: "p13-trace",
          initial: "first",
          states: { first: { on: { NEXT_1: "second" } }, second: { on: { NEXT_2: "third" } }, third: {} },
        })
      )
      const [path] = yield* model.getShortestPaths({ toState: (state) => state.matches("third") })
      assert.isDefined(path)
      if (!path) return
      const thrown = new Error("test error")

      const error = yield* Effect.flip(
        model.testPath(path, {
          states: {
            third: () => {
              throw thrown
            },
          },
        })
      )

      assert.strictEqual(error, thrown)
      assert.strictEqual(
        thrown.message,
        [
          "test error",
          "Path:",
          '\tState: {"value":"first"}',
          '\tEvent: {"type":"xstate.init"}',
          "",
          '\tState: {"value":"second"} via {"type":"xstate.init"}',
          '\tEvent: {"type":"NEXT_1"}',
          "",
          '\tState: {"value":"third"} via {"type":"NEXT_1"}',
          '\tEvent: {"type":"NEXT_2"}',
          "",
          '\tState: {"value":"third"} via {"type":"NEXT_2"}',
        ].join("\n")
      )

      // An event executor's Effect that fails fails the path test the same way
      const failed = yield* Effect.flip(
        model.testPath(path, { events: { NEXT_1: () => Effect.fail(new Error("exec error")) } })
      )
      assert.isTrue(failed instanceof Error && failed.message.startsWith("exec error\nPath:\n"))
    }))

  it.effect("[P13] createTestModel fails with the recorded message for an invocation, an after transition or a delayed action", () =>
    Effect.gen(function* () {
      // Upstream forbiddenAttributes.test.ts, and a delayed sendTo in a child state
      const invoking = createMachine({ invoke: { src: "myInvoke" } })
      const after = createMachine({ after: { 5000: { actions: () => {} } } })
      const delayedRaise = createMachine({ entry: [raise({ type: "EVENT" }, { delay: 1000 })] })
      const delayedSendTo = createMachine({
        initial: "a",
        states: { a: { on: { GO: { actions: sendTo("other", { type: "PING" }, { delay: 10 }) } } } },
      })

      const failures = yield* Effect.forEach([invoking, after, delayedRaise, delayedSendTo], (machine) =>
        Effect.map(Effect.flip(createTestModel(machine)), (error) => [error._tag, error.message, error.name])
      )
      assert.deepStrictEqual(failures, [
        ["UnsupportedTestMachineError", testModelInvocations, "Error"],
        ["UnsupportedTestMachineError", testModelAfter, "Error"],
        ["UnsupportedTestMachineError", testModelDelayedActions, "Error"],
        ["UnsupportedTestMachineError", testModelDelayedActions, "Error"],
      ])

      // A raise without a delay is no delayed action, and (as upstream) neither is a named delay
      const model = yield* createTestModel(createMachine({ entry: [raise({ type: "EVENT" })] }))
      assert.instanceOf(model, TestModel)
      const named = yield* createTestModel(createMachine({ entry: [raise({ type: "EVENT" }, { delay: "later" })] }))
      assert.instanceOf(named, TestModel)
    }))

  it.effect("[P13] a TestModel drives any logic with its own events and state matcher", () =>
    Effect.gen(function* () {
      // Upstream testModel.test.ts > tests states for any logic
      const collatz = fromTransition(
        (value: number, event: { readonly type: string }) => (event.type === "even" ? value / 2 : value * 3 + 1),
        15
      )
      const tested: Array<string> = []
      const model = new TestModel(collatz, {
        events: (state) => [{ type: state.context % 2 === 0 ? "even" : "odd" }],
        stateMatcher: (state, key) => (key === "even" ? state.context % 2 === 0 : key === "odd" && state.context % 2 === 1),
      })

      const paths = yield* model.getShortestPaths({ toState: (state) => state.context === 1 })
      assert.strictEqual(paths.length, 1)

      for (const path of paths) {
        yield* path.test({
          states: {
            even: () => {
              tested.push("even")
            },
            odd: () => {
              tested.push("odd")
            },
          },
        })
      }
      assert.includeMembers(tested, ["even", "odd"])
    }))

  it("[P13] a test model's default logger writes nothing to the console, and a given logger is used (DEV-51)", () => {
    // Upstream's default is `console.log` and `console.error`; the model itself never calls it
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {})
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      const model = new TestModel(fromTransition((state: number) => state, 0))
      model.options.logger.log("p13 log")
      model.options.logger.error("p13 error")
      assert.deepStrictEqual([consoleLog.mock.calls, consoleError.mock.calls], [[], []])

      const logged: Array<string> = []
      const withLogger = new TestModel(fromTransition((state: number) => state, 0), {
        logger: { log: (msg) => logged.push(`log ${msg}`), error: (msg) => logged.push(`error ${msg}`) },
      })
      withLogger.options.logger.log("a")
      withLogger.options.logger.error("b")
      assert.deepStrictEqual(logged, ["log a", "error b"])
    } finally {
      consoleLog.mockRestore()
      consoleError.mockRestore()
    }
  })

  it.effect("[P13] the model's paths are deduplicated unless allowDuplicatePaths, and paths extend from given paths", () =>
    Effect.gen(function* () {
      // Upstream paths.test.ts > getSimplePaths and getShortestPathsFrom
      const model = yield* createTestModel(multiPath)
      assert.strictEqual((yield* model.getSimplePaths()).length, 2)
      assert.strictEqual((yield* model.getSimplePaths({ allowDuplicatePaths: true })).length, 5)

      const branching = yield* createTestModel(
        createMachine({
          id: "p13-from",
          initial: "a",
          states: {
            a: { on: { NEXT: "b", OTHER: "b", TO_C: "c", TO_D: "d", TO_E: "e" } },
            b: { on: { TO_C: "c", TO_D: "d" } },
            c: {},
            d: {},
            e: {},
          },
        })
      )
      const toB = yield* branching.getShortestPaths({ toState: (state) => state.matches("b") })
      assert.strictEqual(toB.length, 2)
      const extended = yield* branching.getShortestPathsFrom(toB)
      assert.strictEqual(extended.length, 4)
      assert.isTrue(extended.every((path) => path.steps.length === 3))
    }))
})
