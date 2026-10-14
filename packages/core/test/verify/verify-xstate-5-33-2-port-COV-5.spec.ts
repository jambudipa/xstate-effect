/**
 * COV-5: the graph entry point describes, keys and traces the paths of any logic.
 *
 * Coverage layer #5 (`src/graph`, risk R-006, P2). Upstream `src/graph/*.ts` at xstate@5.33.2:
 *
 * - `getDescription` (`utils.ts`) names each active atomic or final state node of a path's end
 *   state by the `description` of its test meta: a string as quoted text, a function by what
 *   it returns, and an empty or missing `description` by the JSON of the snapshot's value; a
 *   node without meta goes by its path. More than one node gives `states`, not `state`.
 * - `formatPathTestResult` (`utils.ts`) writes the trace of a path test: each step that passed
 *   in green, the first failure in red, and everything after it, the target state included,
 *   in gray; with no failing step, the target state is red when its own test failed.
 * - `createTestModel`'s state key adds ` via <event> from <previous value>` when the event
 *   changed the state value (`stateValuesEqual` compares values by structure).
 * - A `TestModel` of a logic that is not a machine keys a transition by the state's JSON and
 *   the event type, and applies only its `*` state test; `getPathsFromEvents` walks such a
 *   logic with the logic defaults (`createDefaultLogicOptions`) from its initial snapshot.
 * - A path test that fails with a value that is not an `Error` fails with that value as it
 *   is: upstream appends the trace to `err.message`, which only an `Error` has.
 * - `serializeSnapshot` writes the value and the context of a snapshot, each only when the
 *   snapshot has it; `toDirectedGraph` gives a targetless transition an edge to its own node. * - `getPathsFromEvents` gives every event of the sequence an adjacency entry, so an event the
 *   state does not take keeps the path in that state; an event `filterEvents` leaves out fails
 *   the Effect (ledger DEV-49).
 */
import { assert, describe, it } from "@effect/vitest"
import { Effect, Exit, Option } from "effect"
import {
  createTestModel,
  getPathsFromEvents,
  InvalidEventSequenceError,
  getShortestPaths,
  serializeSnapshot,
  type StatePath,
  type TestPathResult,
  TestModel,
  toDirectedGraph,
} from "../../src/graph/index.js"
import { formatPathTestResult, simpleStringify } from "../../src/graph/utils.js"
import {
  assign,
  createMachine,
  type EventObject,
  fromTransition,
  getInitialSnapshot,
  type MachineSnapshot,
  Snapshot,
  type SnapshotType,
} from "../../src/index.js"

/**
 * A counter up to 2 as transition logic: `INC` adds one, any other event keeps the count. It
 * is bounded, as every traversal walks the whole state space first.
 */
const counterLogic = fromTransition(
  (count: number, event: { readonly type: string }) => (event.type === "INC" ? Math.min(count + 1, 2) : count),
  0
)

/** `first -NEXT-> second -NEXT-> third`. */
const line = createMachine({
  id: "cov5-line",
  initial: "first",
  states: { first: { on: { NEXT: "second" } }, second: { on: { NEXT: "third" } }, third: {} },
})

/** The shortest path of `line` to `third`. */
const pathToThird = Effect.gen(function* () {
  const paths = yield* getShortestPaths(line, { toState: (state) => state.matches("third") })
  assert.strictEqual(paths.length, 1)
  return yield* Option.match(Option.fromUndefinedOr(paths[0]), {
    onNone: () => Effect.die("no path to third"),
    onSome: Effect.succeed,
  })
})

/** The result of a path test of `path` with the given errors per step, as `[state, event]`. */
const resultOf = <TSnapshot extends SnapshotType, TEvent extends EventObject>(
  path: StatePath<TSnapshot, TEvent>,
  stepErrors: ReadonlyArray<readonly [state: Option.Option<unknown>, event: Option.Option<unknown>]>,
  targetError: Option.Option<unknown>
): TestPathResult<TSnapshot, TEvent> => ({
  steps: path.steps.map((step, i) => {
    const [state, event] = stepErrors[i] ?? [Option.none(), Option.none()]
    return { step, state: { error: state }, event: { error: event } }
  }),
  state: { error: targetError },
})

/** Writes each state by its value and each event by its type, and marks each with its color. */
const traceOptions = {
  formatColor: (color: string, text: string) => `${color}(${text})`,
  serializeState: (state: MachineSnapshot<unknown>) => String(state.value),
  serializeEvent: (event: EventObject) => event.type,
}

describe("COV-5 the graph entry point describes, keys and traces the paths of any logic", () => {
  it.effect("[COV-5] a test path's description names each end state by its test meta description, a function's result, or the JSON of its value", () =>
    Effect.gen(function* () {
      const model = yield* createTestModel(
        createMachine({
          id: "cov5-meta",
          initial: "start",
          states: {
            start: {
              meta: { description: "the start" },
              on: { TO_FN: "computed", TO_BLANK: "group.blank", TO_OTHER: "group.other", TO_BOTH: "both" },
            },
            computed: { meta: { description: (snapshot: MachineSnapshot<unknown>) => `computed at ${simpleStringify(snapshot.value)}` } },
            group: {
              initial: "blank",
              states: {
                // An empty description and a meta without one fall back to the value's JSON
                blank: { meta: { description: "" } },
                other: { meta: { note: "no description here" } },
              },
            },
            both: { type: "parallel", states: { left: {}, right: {} } },
          },
        })
      )

      // The path to the start state is kept, though every other path starts with its events
      const descriptions = (yield* model.getShortestPaths({ allowDuplicatePaths: true })).map((path) => path.description)

      assert.deepStrictEqual(descriptions, [
        'Reaches state "the start": xstate.init',
        'Reaches state computed at "computed": xstate.init → TO_FN',
        'Reaches state {"group":"blank"}: xstate.init → TO_BLANK',
        'Reaches state {"group":"other"}: xstate.init → TO_OTHER',
        'Reaches states "both.left", "both.right": xstate.init → TO_BOTH',
      ])
    }))

  it.effect("[COV-5] the path trace is green with no failure, red at the target when only its own test failed, and gray after the first failure", () =>
    Effect.gen(function* () {
      const path = yield* pathToThird
      const none = Option.none()
      const failed = Option.some(new Error("failed"))

      // Every step passed and so did the target state
      assert.strictEqual(
        formatPathTestResult(path, resultOf(path, [], none), traceOptions),
        "\nPath:\n" +
          [
            "\tState: greenBright(first)\n\tEvent: green(xstate.init)",
            "\tState: greenBright(second)\n\tEvent: green(NEXT)",
            "\tState: greenBright(third)\n\tEvent: green(NEXT)",
            "\tState: green(third)",
          ].join("\n\n")
      )

      // Only the target state's own test failed
      assert.strictEqual(
        formatPathTestResult(path, resultOf(path, [], failed), traceOptions).split("\n\n").at(-1),
        "\tState: red(third)"
      )

      // The first state failed: everything after it, the target included, is gray
      assert.strictEqual(
        formatPathTestResult(path, resultOf(path, [[failed, none]], none), traceOptions),
        "\nPath:\n" +
          [
            "\tState: redBright(first)\n\tEvent: gray(xstate.init)",
            "\tState: gray(second)\n\tEvent: gray(NEXT)",
            "\tState: gray(third)\n\tEvent: gray(NEXT)",
            "\tState: gray(third)",
          ].join("\n\n")
      )
    }))

  it.effect("[COV-5] a path test that fails with a value that is not an Error fails with that value, unchanged", () =>
    Effect.gen(function* () {
      const model = yield* createTestModel(line)
      const path = yield* pathToThird
      const reason = { code: "E_STATE" }

      const error = yield* Effect.flip(model.testPath(path, { states: { third: () => Effect.fail(reason) } }))

      assert.strictEqual(error, reason)
      assert.deepStrictEqual(reason, { code: "E_STATE" })
    }))

  it.effect("[COV-5] a machine model's state key names the event and the previous value when the value changed, compared by structure", () =>
    Effect.gen(function* () {
      const model = yield* createTestModel(
        createMachine({
          id: "cov5-keys",
          initial: "a",
          states: {
            a: { initial: "a1", states: { a1: { on: { GO: "#cov5-keys.b.b1" } } } },
            b: { initial: "b1", states: { b1: { on: { STAY: "b1" } } } },
          },
        })
      )

      const keys = Object.keys(yield* model.getAdjacencyMap())

      // {"a":"a1"} and {"b":"b1"} have one key each, but not the same key: the value changed
      assert.deepStrictEqual(keys, ['{"value":{"a":"a1"}}', '{"value":{"b":"b1"}} via {"type":"GO"} from {"a":"a1"}', '{"value":{"b":"b1"}}'])
    }))

  it.effect("[COV-5] a TestModel of a logic that is not a machine keys a transition by the state's JSON and the event type, and runs only its * state test", () =>
    Effect.gen(function* () {
      const model = new TestModel(counterLogic, { events: [{ type: "INC" }] })
      const start = yield* getInitialSnapshot(counterLogic)

      const { serializeTransition, stateMatcher } = model.getDefaultOptions()
      assert.strictEqual(serializeTransition(start, { type: "INC" }), `${simpleStringify(start)}|INC`)
      assert.strictEqual(serializeTransition(start, undefined), `${simpleStringify(start)}|undefined`)
      assert.deepStrictEqual([stateMatcher(start, "*"), stateMatcher(start, "0")], [true, false])

      const tested: Array<string> = []
      const [path] = yield* model.getPathsFromEvents([{ type: "INC" }, { type: "INC" }])
      assert.isDefined(path)
      yield* Option.match(Option.fromUndefinedOr(path), {
        onNone: () => Effect.void,
        onSome: (found) =>
          Effect.asVoid(
            found.test({
              states: {
                "*": (state) => {
                  tested.push(`* ${state.context}`)
                },
                "2": () => {
                  tested.push("2")
                },
              },
            })
          ),
      })

      // The default matcher takes the * key only, so the * test runs for the state of every
      // step (the start, then the state after each INC) and the "2" test never runs
      assert.deepStrictEqual(tested, ["* 0", "* 1", "* 2"])
    }))

  it.effect("[COV-5] getPathsFromEvents walks a logic that is not a machine from its initial snapshot", () =>
    Effect.gen(function* () {
      const paths = yield* getPathsFromEvents(counterLogic, [{ type: "INC" }, { type: "NOOP" }, { type: "INC" }])

      assert.deepStrictEqual(
        paths.map((path) => [path.state.context, path.steps.map((step) => [step.event.type, step.state.context])]),
        [
          [
            2,
            [
              ["xstate.init", 0],
              ["INC", 1],
              ["NOOP", 1],
              ["INC", 2],
            ],
          ],
        ]
      )
    }))

  it.effect("[COV-5] serializeSnapshot writes a snapshot's value and context only when it has them", () =>
    Effect.gen(function* () {
      const withContext = yield* getInitialSnapshot(fromTransition((state: { readonly n: number }) => state, { n: 1 }))

      assert.strictEqual(serializeSnapshot(Snapshot.active()), "{}")
      assert.strictEqual(serializeSnapshot(withContext), '{"context":{"n":1}}')
      assert.strictEqual(serializeSnapshot(yield* getInitialSnapshot(counterLogic)), "{}")
    }))

  it("[COV-5] toDirectedGraph gives a targetless transition an edge from its node to itself", () => {
    const machine = createMachine({
      id: "cov5-graph",
      initial: "idle",
      context: { count: 0 },
      states: { idle: { on: { COUNT: { actions: assign({ count: 1 }) }, GO: "done" } }, done: {} },
    })

    const graph = toDirectedGraph(machine)

    assert.deepStrictEqual(JSON.parse(JSON.stringify(graph.children[0])), {
      id: "cov5-graph.idle",
      children: [],
      edges: [
        { source: "cov5-graph.idle", target: "cov5-graph.idle", label: { text: "COUNT" } },
        { source: "cov5-graph.idle", target: "cov5-graph.done", label: { text: "GO" } },
      ],
    })
    assert.strictEqual(graph.children[0]?.edges[0]?.target, machine.root.states.idle)
  })

  it.effect("[COV-5] getPathsFromEvents: an event the state does not take leaves the path in that state, as upstream; one that filterEvents leaves out fails with InvalidEventSequenceError (ledger DEV-49)", () =>
    Effect.gen(function* () {
      const light = createMachine({
        types: {} as { events: { type: "SWITCH" } | { type: "PAINT" } },
        initial: "off",
        states: {
          off: { on: { SWITCH: "on" } },
          on: { on: { SWITCH: "off" } },
        },
      })

      const [path] = yield* getPathsFromEvents(light, [{ type: "PAINT" }, { type: "SWITCH" }])
      const filtered = yield* Effect.exit(
        getPathsFromEvents(light, [{ type: "PAINT" }], { filterEvents: (_, event) => event.type !== "PAINT" })
      )

      assert.deepStrictEqual(path?.steps.map((step) => [step.state.value, step.event.type]), [["off", "xstate.init"], ["off", "PAINT"], ["on", "SWITCH"]])
      assert.strictEqual(path?.state.value, "on")
      assert.isTrue(Exit.isFailure(filtered))
      assert.isTrue(Exit.isFailure(filtered) && Option.exists(Exit.findErrorOption(filtered), (error) => error instanceof InvalidEventSequenceError))
    })
  )
})
