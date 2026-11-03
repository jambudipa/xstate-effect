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
 *   snapshot has it; `toDirectedGraph` gives a targetless transition an edge to its own node,
 *   and a node's JSON form holds its edges, as its type now says.
 * - `getPathsFromEvents` gives every event of the sequence an adjacency entry, so an event the
 *   state does not take keeps the path in that state; an event `filterEvents` leaves out fails
 *   the Effect (ledger DEV-49).
 * - `proveSettlement` (a port addition, T2.5) reads the built machine: the run-time brand, the
 *   settlement exits, stops of invoked agents, progress, reach-final, region completion, the
 *   `always` livelock, and every cycle through an agent state. Its findings are in document
 *   order within each check, and a machine with no agent logic owes it nothing.
 * - `explore` (a port addition, T2.7) drives the real machine with an environment's inputs. A
 *   Proxy records each context field the machine reads, a child's own reads stay out of it, a
 *   state's key holds its history, and a restart goes through persist and restore. DATA-2,
 *   DATA-3, S16 and S19 live in jamcode's agent-settlement suite as well; each detector of the
 *   explorer has a failing machine here, so no detector relies on that suite.
 * - A `finiteDelay` (0.4.1) is a progress guarantee to `proveSettlement` and `certify`, and a
 *   plain function or a forged wrapper is not; the certificate hash reads the wrapped function
 *   and its bound, so a change of either makes a certificate stale. `timerFirings` offers its
 *   `after` as any other timer.
 */
import { assert, describe, it } from "@effect/vitest"
import { Cause, Duration, Effect, Exit, FileSystem, Layer, Option, Path } from "effect"
import {
  certify,
  createTestModel,
  explore,
  type ExploreEnvironment,
  type ExploreResult,
  getPathsFromEvents,
  InvalidEventSequenceError,
  getShortestPaths,
  serializeSnapshot,
  processRestart,
  proveSettlement,
  SettlementProofError,
  type StatePath,
  type TestPathResult,
  TestModel,
  timerFirings,
  toDirectedGraph,
} from "../../src/graph/index.js"
import { moduleClosure, unresolvedImports } from "../../src/graph/moduleClosure.js"
import { scanImports } from "../../src/graph/importScan.js"
import { formatPathTestResult, simpleStringify } from "../../src/graph/utils.js"
import type { SettlementCheck } from "../../src/internal/settlement.js"
import { stopChild } from "../../src/actions/stopChild.js"
import { fromAgent } from "../../src/actors/fromAgent.js"
import { fromEffect } from "../../src/actors/fromEffect.js"
import { type AgentBranded, markAgentLogic } from "../../src/internal/agentBrand.js"
import {
  type AnyActorLogic,
  type AnyStateMachine,
  assign,
  createActor,
  createMachine,
  type EventObject,
  finiteDelay,
  fromTransition,
  getInitialSnapshot,
  getNextSnapshot,
  type MachineSnapshot,
  type SettlementReport,
  setup,
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

  it("[COV-5] a directed graph node's JSON form holds its id, its children and its edges, as its toJSON type says", () => {
    const machine = createMachine({ id: "door", initial: "shut", states: { shut: { on: { OPEN: "open" } }, open: {} } })
    const graph = toDirectedGraph(machine)
    const json: ReturnType<typeof graph.toJSON> = graph.toJSON()
    const parsed = JSON.parse(JSON.stringify(graph))

    assert.deepStrictEqual(json.edges, graph.edges)
    assert.deepStrictEqual(parsed.children[0].edges, [{ source: "door.shut", target: "door.open", label: { text: "OPEN" } }])
  })

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

/** Real agent logic behind a cast. */
const agent = fromAgent({ budget: 1, deadline: 1000, tools: {}, turn: () => Effect.void }) as unknown as AnyActorLogic

/** Logic that carries the brand and that `fromAgent` did not build. */
const markedLogic = markAgentLogic(fromEffect(() => Effect.void))

/** `<kind>: <path>` of each finding of the proof; none when it passes. */
const findings = (machine: AnyStateMachine) =>
  Exit.match(Effect.runSyncExit(proveSettlement(machine)), {
    onSuccess: () => [],
    onFailure: (cause) => {
      const error = Option.getOrThrow(Cause.findErrorOption(cause))
      return error.findings.map((finding) => `${finding.kind}: ${finding.path}`)
    },
  })

/** A timed exit to the final state `done` of the machine `m`. */
const exit = { after: { 10: "#m.done" } }

/** A machine `m` with `states` and a final state `done`. */
const withDone = (states: object, initial = "a", actors: object = {}) => {
  const all = { ...states, done: { type: "final" } }
  return createMachine({ id: "m", initial, states: all } as never, { actors } as never)
}

/** A machine whose one state has only the invocation of `logic` to leave it. */
const onlyProgressIs = (logic: unknown) =>
  withDone({ a: { invoke: { src: "work", id: "work", onDone: "#m.done" } } }, "a", { work: logic })

describe("proveSettlement: only fromAgent logic buys the agent progress guarantee", () => {
  it("[COV-5] a real agent counts as progress; a hand-written brand, a marked logic or a copy does not", () => {
    const real = fromAgent({ budget: 1, deadline: 1000, tools: {}, turn: () => Effect.void })
    const forged = Object.defineProperty(fromEffect(() => Effect.void), Symbol.for("@jambudipa/xstate-effect/AgentBrand"), { value: true })
    assert.deepStrictEqual(findings(onlyProgressIs(real)), [])
    for (const logic of [forged, markedLogic, { ...real }]) {
      assert.deepStrictEqual(findings(onlyProgressIs(logic)), ["NoProgressGuarantee: a"])
    }
  })

  it("[COV-5] a forged brand still costs what the brand costs: it must settle, as the proof treats it as an agent", () => {
    const forged = Object.defineProperty(fromEffect(() => Effect.void), Symbol.for("@jambudipa/xstate-effect/AgentBrand"), { value: true })
    const machine = withDone({ a: { invoke: { src: "work", id: "work" }, after: { 10: "#m.done" } } }, "a", { work: forged })
    assert.deepStrictEqual(findings(machine), ["AgentWithoutSettlement: a"])
  })
})

describe("proveSettlement", () => {
  it("fails with a named error whose message lists the findings", () => {
    const machine = withDone({ a: { invoke: { src: agent, input: 1 }, ...exit } })
    const cause = Option.getOrThrow(Exit.findErrorOption(Effect.runSyncExit(proveSettlement(machine))))
    assert.instanceOf(cause, SettlementProofError)
    assert.strictEqual(cause.machineId, "m")
    assert.include(cause.message, "AgentWithoutSettlement: invocation 0")
  })

  it("names an agent invoked by name and an agent invoked inline", () => {
    const named = withDone({ a: { invoke: { src: "x", id: "i", input: 1 }, ...exit } }, "a", { x: agent })
    assert.deepStrictEqual(findings(named), ["AgentWithoutSettlement: a"])
    assert.deepStrictEqual(findings(withDone({ a: { invoke: { src: agent, input: 1 }, ...exit } })), ["AgentWithoutSettlement: a"])
  })

  it("passes a machine with no agents, with or without a final state", () => {
    assert.deepStrictEqual(findings(createMachine({ initial: "a", states: { a: {} } })), [])
  })

  it("refuses an agent machine with no states", () => {
    assert.deepStrictEqual(findings(createMachine({ invoke: { src: agent, input: 1, onDone: {} } } as never)), ["MachineHasNoStates: "])
  })

  it("checks that the settlement leaves on every branch, through onDone only", () => {
    const stays = (onDone: unknown, extra: object = {}) =>
      findings(withDone({ a: { invoke: { src: agent, id: "i", input: 1, onDone }, ...extra, ...exit } }))
    assert.deepStrictEqual(stays({}), ["SettlementMustExit: a"])
    assert.deepStrictEqual(stays("a"), ["SettlementMustExit: a"])
    assert.deepStrictEqual(stays({ guard: () => true, target: "done" }), ["SettlementMustExit: a"])
    assert.deepStrictEqual(stays("done"), [])
    assert.deepStrictEqual(stays("done", { on: { "xstate.done.actor.i": "done" } }), ["AgentDoneOutsideOnDone: a"])
  })

  it("finds a stop of an invoked agent by id, system id or named action, and passes any other", () => {
    const stop = (actions: unknown, implementations: object = {}) =>
      findings(createMachine({
        id: "m",
        initial: "a",
        states: {
          a: { invoke: { src: agent, id: "i", systemId: "s", input: 1, onDone: "done" }, on: { X: { target: "done", actions } } },
          done: { type: "final" },
        },
      } as never, { actions: implementations } as never))
    assert.deepStrictEqual(stop(stopChild("i")), ["StopsInvokedAgent: a"])
    assert.deepStrictEqual(stop(stopChild("s")), ["StopsInvokedAgent: a"])
    assert.deepStrictEqual(stop("halt", { halt: stopChild("i") }), ["StopsInvokedAgent: a"])
    assert.deepStrictEqual(stop({ type: "halt" }, { halt: stopChild("i") }), ["StopsInvokedAgent: a"])
    assert.deepStrictEqual(stop(stopChild("other")), [])
    assert.deepStrictEqual(stop(assign({})), [])
  })

  it("refuses a machine that keeps a definition error, whose tree cannot hide an agent", () => {
    const machine = withDone({ a: { invoke: { src: agent, input: 1, onDone: "nowhere" } } })
    assert.deepStrictEqual(findings(machine), ["MachineDefinitionInvalid: "])
  })

  it("resolves every valid root: compound, parallel and empty", () => {
    const leaf = { initial: "x", states: { x: { type: "final" } } }
    assert.deepStrictEqual(findings(createMachine({ type: "parallel", states: { a: leaf, b: leaf } } as never)), [])
    assert.deepStrictEqual(findings(createMachine({})), [])
  })

  it("needs a progress guarantee, and counts neither a targetless after nor a self target", () => {
    const base = { z: { invoke: { src: agent, input: 1, onDone: "done" } } }
    const state = (config: object) => findings(withDone({ ...base, a: { ...config, on: { GO: "done" } } }, "z"))
    assert.deepStrictEqual(state({}), ["NoProgressGuarantee: a"])
    assert.deepStrictEqual(state({ after: { 10: { actions: () => undefined } } }), ["NoProgressGuarantee: a"])
    assert.deepStrictEqual(state({ after: { 10: { target: "a", reenter: true } } }), ["NoProgressGuarantee: a"])
    assert.deepStrictEqual(state({ after: { 10: { guard: () => true, target: "done" } } }), ["NoProgressGuarantee: a"])
    assert.deepStrictEqual(state({ after: { 10: "done" } }), [])
    assert.deepStrictEqual(state({ always: [{ guard: () => false, target: "done" }, { target: "done" }] }), [])
  })

  it("counts an ancestor's guarantee, unless it re-enters the state", () => {
    const outer = (target: string) =>
      findings(withDone({ a: { initial: "b", after: { 10: target }, states: { b: { on: { GO: "#m.done" } } } } }, "a", { x: agent }))
    assert.deepStrictEqual(outer("done"), [])
    assert.deepStrictEqual(outer("a"), ["NoProgressGuarantee: a.b"])
  })

  it("follows a history state: the default target, the parent's states, shallow and deep", () => {
    const history = (config: object) =>
      findings(withDone({
        a: {
          initial: "b",
          states: {
            b: { after: { 10: "c" } },
            c: { initial: "d", states: { d: { after: { 10: "#m.back" } } } },
            h: { type: "history", ...config },
          },
        },
        back: { after: { 10: "a.h" }, on: { X: "done" } },
      }, "a", { x: agent }))
    assert.deepStrictEqual(history({ target: "b" }), [])
    assert.deepStrictEqual(history({ target: "c.d" }), [])
    assert.deepStrictEqual(history({ target: "#m.a.b" }), [])
    assert.deepStrictEqual(history({ history: "deep" }), [])
    assert.deepStrictEqual(history({}), [])
  })

  it("does not leave a state through a history state that may restore it", () => {
    const machine = withDone({
      a: { initial: "b", on: { GO: "#m.done" }, states: { b: { after: { 10: "h" } }, h: { type: "history", target: "b" } } },
    }, "a", { x: agent })
    assert.deepStrictEqual(findings(machine), ["NoProgressGuarantee: a.b"])
  })

  it("reports a stuck state, and each region that cannot complete", () => {
    const machine = withDone({
      a: { after: { 10: "done" } },
      p: {
        type: "parallel",
        onDone: "done",
        states: {
          ok: { initial: "o", states: { o: { type: "final" } } },
          bad: { initial: "b", states: { b: { after: { 10: "c" } }, c: { after: { 10: "b" } } } },
        },
      },
    }, "a", { x: agent })
    assert.sameMembers(findings(machine), [
      "CannotReachFinal: p",
      "CannotReachFinal: p.ok",
      "CannotReachFinal: p.bad",
      "CannotReachFinal: p.bad.b",
      "CannotReachFinal: p.bad.c",
      "RegionCannotComplete: p.bad",
    ])
  })

  it("lets a parallel state complete, and a nested parallel region too", () => {
    const leaf = (key: string) => ({ initial: key, states: { [key]: { type: "final" } } })
    const machine = withDone({
      p: {
        type: "parallel",
        onDone: "done",
        states: { left: leaf("l"), right: { initial: "q", states: { q: { type: "parallel", onDone: "e", states: { x: leaf("x") } }, e: { type: "final" } } } },
      },
    }, "p", { x: agent })
    assert.deepStrictEqual(findings(machine), [])
  })

  it("refuses an always loop with every guard false, and lets a targetless fallback rest", () => {
    const looping = withDone({
      a: { always: [{ guard: () => false, target: "done" }, { target: "b" }] },
      b: { always: [{ guard: () => false, target: "done" }, { target: "a" }] },
    }, "a", { x: agent })
    assert.deepStrictEqual(findings(looping), ["Livelock: a", "Livelock: b"])
    const inherited = withDone({
      a: { initial: "b", always: [{ target: "c" }], states: { b: { on: { X: "#m.done" } } } },
      c: { after: { 10: "done" } },
    }, "a", { x: agent })
    assert.deepStrictEqual(findings(inherited), [])
  })

  it("does not take a state's onDone for a move of its children", () => {
    const machine = withDone({
      a: {
        initial: "b",
        onDone: "c",
        invoke: { src: agent, input: 1, onDone: "done" },
        states: { b: { after: { 10: "e" }, on: { X: "b2" } }, b2: {}, e: { type: "final" } },
      },
      c: { after: { 10: "a" } },
    }, "a", { x: agent })
    assert.deepStrictEqual(findings(machine), ["UnrankedAgentCycle: a"])
  })

  it("treats a root re-entry as a re-entry of each agent state", () => {
    const machine = createMachine({
      id: "m",
      initial: "a",
      on: { AGAIN: { target: ".a", reenter: true } },
      states: { a: { invoke: { src: agent, input: 1, onDone: "done" } }, done: { type: "final" } },
    } as never)
    assert.deepStrictEqual(findings(machine), ["UnrankedAgentCycle: a"])
  })

  it("takes a person's event, and a counter on a guarded edge, and nothing else, as a bound", () => {
    const edge = (config: object) =>
      findings(withDone({
        a: { invoke: { src: agent, input: 1, onDone: "b" } },
        b: { after: { 10: "done" }, on: { R: { target: "a", ...config } } },
      }))
    assert.deepStrictEqual(edge({ meta: { person: true } }), [])
    assert.deepStrictEqual(edge({ guard: () => true, meta: { ranking: "n" } }), [])
    assert.deepStrictEqual(edge({ guard: () => true, meta: { ranking: "" } }), ["UnrankedAgentCycle: a"])
    assert.deepStrictEqual(edge({ meta: { ranking: "n" } }), ["UnrankedAgentCycle: a"])
    assert.deepStrictEqual(edge({ meta: { person: "yes" } }), ["UnrankedAgentCycle: a"])
    assert.deepStrictEqual(edge({}), ["UnrankedAgentCycle: a"])
  })
})

/** An environment of one kind, `event`, that sends `types` in every state. */
const eventsOnly = (types: ReadonlyArray<string>, abstraction: ExploreEnvironment["abstraction"] = {}): ExploreEnvironment => ({
  catalogue: ["event"],
  inputs: { event: () => types.map((type) => ({ type })) },
  abstraction,
  timeout: "30 seconds",
})

describe("explore", () => {
  it("counts `in` as a read, and takes the machine's input", async () => {
    const machine = createMachine({
      id: "m",
      context: ({ input }: { input: number }) => ({ given: input }),
      initial: "a",
      states: { a: { on: { GO: [{ guard: ({ context }) => "given" in context, target: "b" }] } }, b: { type: "final" } },
    })
    const result = await Effect.runPromise(
      explore(machine, { ...eventsOnly(["GO"], { given: (value) => Number(value) }), input: 7 })
    )
    assert.deepStrictEqual(result.abstraction, ["given"])
    assert.include(result.keys[0], '["given",7]')
  })

  it("leaves the reads of a child machine out of the parent's read set", async () => {
    const child = createMachine({
      id: "child",
      context: { own: 1, copy: 0 },
      entry: assign({ copy: ({ context }) => context.own }),
      initial: "idle",
      states: { idle: {} },
    })
    const machine = createMachine(
      { id: "m", initial: "a", states: { a: { invoke: { src: "child" }, on: { GO: "b" } }, b: { type: "final" } } },
      { actors: { child } }
    )
    assert.deepStrictEqual((await Effect.runPromise(explore(machine, eventsOnly(["GO"])))).abstraction, [])
  })

  it("keeps a state's history in its key: two histories re-enter differently", async () => {
    const machine = createMachine({
      id: "m",
      initial: "work",
      states: {
        work: {
          initial: "one",
          states: { one: { on: { NEXT: "two" } }, two: {}, past: { type: "history" } },
          on: { PAUSE: "paused" },
        },
        paused: { on: { RESUME: "work.past", STOP: "done" } },
        done: { type: "final" },
      },
    })
    const result = await Effect.runPromise(explore(machine, eventsOnly(["NEXT", "PAUSE", "RESUME", "STOP"])))
    const paused = result.keys.filter((key) => key.includes('"paused"'))
    assert.strictEqual(paused.length, 2)
  })

  it("restarts a process through persist and restore, which keeps the state and starts no invocation", async () => {
    const machine = createMachine(
      {
        id: "m",
        initial: "a",
        states: { a: { invoke: { src: "agent", id: "mind", input: 1, onDone: "b" }, after: { 10: "b" } }, b: { type: "final" } },
      },
      { actors: { agent } }
    )
    const result = await Effect.runPromise(
      explore(machine, {
        catalogue: ["timer", "restart"],
        inputs: { timer: timerFirings, restart: processRestart(machine) },
        abstraction: {},
        timeout: "30 seconds",
      })
    )
    const restart = result.edges.find((edge) => edge.kind === "restart")
    assert.strictEqual(restart?.from, restart?.to)
    assert.isFalse(restart?.reentersAgent)
  })

  it.live("fails closed on an eventless loop inside one macrostep, which never reaches the next state", () =>
    Effect.gen(function* () {
      const looping = createMachine({
        id: "m",
        initial: "a",
        states: { a: { on: { GO: "b" } }, b: { always: { target: "c" } }, c: { always: { target: "b" } } },
      })
      const failure = yield* Effect.flip(explore(looping, { ...eventsOnly(["GO"]), timeout: "100 millis" }))
      assert.strictEqual(failure._tag, "ExploreTimeout")
    })
  )
})

/** The state value after the machine in its initial state receives the done event of the invocation `id`. */
const valueAfterDone = (machine: AnyStateMachine, id: string): unknown =>
  Effect.runSync(
    Effect.gen(function* () {
      const initial = yield* getInitialSnapshot(machine as never)
      const next = yield* getNextSnapshot(machine as never, initial as never, { type: `xstate.done.actor.${id}` } as never)
      return Reflect.get(next as object, "value")
    }) as Effect.Effect<unknown>
  )

/** An agent invocation with the id `i` that settles to `#m.done`. */
const settled = { invoke: { src: agent, id: "i", input: 1, onDone: "#m.done" } }

/** Each `on` key the engine matches to `xstate.done.actor.i`, by its own descriptor rule. */
const doneKeys = ["xstate.done.actor.i", "*", "xstate.*", "xstate.done.*", "xstate.done.actor.*", "xstate.done.actor.i.*"]

describe("proveSettlement: every node that can take an agent's done event before onDone (F1)", () => {
  /** A compound agent state whose child holds `on`. */
  const childKey = (on: object) =>
    withDone({ a: { ...settled, initial: "x", states: { x: { on, ...exit } } } })

  it("[COV-5] a child key of each matching form takes the event, the machine stays, and the proof refuses it", () => {
    for (const key of doneKeys) {
      const machine = childKey({ [key]: {} })
      assert.deepStrictEqual(valueAfterDone(machine, "i"), { a: "x" }, key)
      assert.deepStrictEqual(findings(machine), ["AgentDoneOutsideOnDone: a"], key)
    }
  })

  it("[COV-5] a guarded child key counts too: its guard can pass", () => {
    assert.deepStrictEqual(findings(childKey({ "*": { guard: () => true } })), ["AgentDoneOutsideOnDone: a"])
  })

  it("[COV-5] a key that the engine does not match to the event takes nothing and passes", () => {
    for (const key of ["xstate.done.actor.i*", "xstate.done.actor.ij.*", "xstate.*.actor.i", "xstate.done.state.*", "OTHER"]) {
      const machine = childKey({ [key]: {} })
      assert.deepStrictEqual(valueAfterDone(machine, "i"), "done", key)
      assert.deepStrictEqual(findings(machine), [], key)
    }
  })

  it("[COV-5] a generated invocation id has no literal key, so a wildcard catches it", () => {
    const machine = withDone({
      a: { invoke: { src: agent, input: 1, onDone: "#m.done" }, initial: "x", states: { x: { on: { "xstate.done.actor.*": {} }, ...exit } } },
    })
    assert.deepStrictEqual(findings(machine), ["AgentDoneOutsideOnDone: a"])
  })

  it("[COV-5] a key at any depth below the invoking node counts", () => {
    const machine = withDone({
      a: { ...settled, initial: "x", states: { x: { initial: "y", states: { y: { on: { "*": {} }, ...exit } } } } },
    })
    assert.deepStrictEqual(findings(machine), ["AgentDoneOutsideOnDone: a"])
  })

  it("[COV-5] a wildcard on the invoking node cannot take the event: the exact onDone candidate comes first", () => {
    for (const key of doneKeys.slice(1)) {
      const machine = withDone({ a: { ...settled, on: { [key]: "a" }, ...exit } })
      assert.deepStrictEqual(valueAfterDone(machine, "i"), "done", key)
      assert.deepStrictEqual(findings(machine), [], key)
    }
  })

  it("[COV-5] an ancestor cannot take the event: the invoking node's unguarded onDone is selected first", () => {
    const machine = withDone({ p: { on: { "*": "#m.done" }, initial: "a", states: { a: { ...settled, ...exit } } } }, "p")
    const key = createMachine({
      id: "m",
      initial: "p",
      states: {
        p: { on: { "*": "#m.other" }, initial: "a", states: { a: settled } },
        other: { type: "final" },
        done: { type: "final" },
      },
    } as never) as AnyStateMachine
    assert.deepStrictEqual(valueAfterDone(key, "i"), "done")
    assert.deepStrictEqual(findings(machine), [])
  })

  /** A parallel state with an agent region and a region beside it that holds `on`, in the given order. */
  const regions = (on: object, first: "left" | "right", onDone = "#m.done") => {
    const left = { initial: "w", states: { w: { invoke: { src: agent, id: "i", input: 1, onDone }, ...exit }, x: { ...exit } } }
    const right = { initial: "r", states: { r: { on, ...exit }, s: { ...exit } } }
    const states = first === "left" ? { left, right } : { right, left }
    return createMachine({
      id: "m",
      initial: "p",
      states: { p: { type: "parallel", states }, other: { type: "final" }, done: { type: "final" } },
    } as never) as AnyStateMachine
  }

  it("[COV-5] a sibling key that comes first and leaves the regions wins the conflict, so onDone never runs", () => {
    const machine = regions({ "*": "#m.other" }, "right")
    assert.deepStrictEqual(valueAfterDone(machine, "i"), "other")
    assert.deepStrictEqual(findings(machine), ["AgentDoneOutsideOnDone: p.left.w"])
  })

  it("[COV-5] a sibling key that stays in its region still conflicts with an onDone that leaves them, and can win", () => {
    const machine = regions({ "*": "s" }, "right")
    assert.deepStrictEqual(valueAfterDone(machine, "i"), { p: { left: "w", right: "s" } })
    assert.deepStrictEqual(findings(machine), ["AgentDoneOutsideOnDone: p.left.w"])
  })

  it("[COV-5] a sibling key counts in any order and in every form, as the document order can change", () => {
    for (const key of doneKeys) {
      assert.deepStrictEqual(findings(regions({ [key]: "#m.other" }, "left")), ["AgentDoneOutsideOnDone: p.left.w"], key)
    }
  })

  it("[COV-5] a sibling key that stays in its region runs beside an onDone that stays in its own", () => {
    const machine = regions({ "*": "s" }, "right", "x")
    assert.deepStrictEqual(valueAfterDone(machine, "i"), { p: { left: "x", right: "s" } })
    assert.deepStrictEqual(findings(machine), [])
  })

  it("[COV-5] a targetless sibling key exits nothing, so onDone runs beside it", () => {
    const machine = regions({ "*": {} }, "right")
    assert.deepStrictEqual(valueAfterDone(machine, "i"), "done")
    assert.deepStrictEqual(findings(machine), [])
  })

  it("[COV-5] a transition of a state outside the invoking state and its regions stays free", () => {
    const machine = withDone({ a: { ...settled, ...exit }, b: { on: { "*": "done" }, ...exit } })
    assert.deepStrictEqual(findings(machine), [])
  })
})

describe("proveSettlement: a delay buys progress only when it fires (F4)", () => {
  /** A machine that holds an agent, with a state whose only exit is `after` on `delay`. */
  const delayed = (after: object, delays: object = {}) =>
    createMachine({
      id: "m",
      initial: "a",
      states: {
        a: { invoke: { src: agent, id: "i", input: 1, onDone: "b" } },
        b: { after },
        done: { type: "final" },
      },
    } as never, { delays } as never) as AnyStateMachine

  it("[COV-5] refuses a named delay with no implementation", () => {
    assert.deepStrictEqual(findings(delayed({ slow: "done" })), ["NoProgressGuarantee: b"])
  })

  it("[COV-5] refuses an inline delay that is not finite", () => {
    for (const key of ["Infinity", "-Infinity", "NaN"]) {
      assert.deepStrictEqual(findings(delayed({ [key]: "done" })), ["NoProgressGuarantee: b"], key)
    }
  })

  it("[COV-5] counts a finite delay by number, by name and as a Duration", () => {
    assert.deepStrictEqual(findings(delayed({ 10: "done" })), [])
    assert.deepStrictEqual(findings(delayed({ slow: "done" }, { slow: 10 })), [])
    assert.deepStrictEqual(findings(delayed({ slow: "done" }, { slow: Duration.seconds(1) })), [])
  })

  it("[COV-5] refuses a named delay that may never fire", () => {
    for (const delay of [Infinity, Number.NaN, () => 10, Duration.infinity]) {
      assert.deepStrictEqual(findings(delayed({ slow: "done" }, { slow: delay })), ["NoProgressGuarantee: b"])
    }
  })
})

/** The failure of a run that must fail. */
const failure = (machine: AnyStateMachine, environment: ExploreEnvironment) =>
  Effect.runPromise(Effect.flip(explore(machine, environment) as Effect.Effect<unknown, never>)) as Promise<never>

/** Merged states with `n` from 0 to 3, where only 3 can leave: the abstraction hides `n`. */
const hidden = createMachine({
  types: {} as { context: { n: number } },
  id: "m",
  context: { n: 0 },
  initial: "a",
  states: {
    a: {
      on: {
        INC: { guard: ({ context }) => context.n < 3, actions: assign({ n: ({ context }) => context.n + 1 }) },
        CHECK: { guard: ({ context }) => context.n === 3, target: "b" },
        STOP: "done",
      },
    },
    b: { on: { STOP: "done" } },
    done: { type: "final" },
  },
})

describe("explore: only a guarded transition declares a ranking (F12)", () => {
  it("[COV-5] an unguarded meta.ranking is no ranking: it neither changes the key nor can be invalid (F12)", async () => {
    const machine = createMachine({
      types: {} as { context: { note: string } },
      id: "m",
      context: { note: "text" },
      initial: "a",
      states: { a: { on: { GO: { target: "b", meta: { ranking: "note" } } } }, b: { type: "final" } },
    } as never) as AnyStateMachine
    const result = await Effect.runPromise(explore(machine, eventsOnly(["GO"])) as Effect.Effect<ExploreResult>)
    assert.deepStrictEqual(result.abstraction, [])
    assert.notInclude(result.keys.join(), "note")
  })

  it.effect("[COV-5] a microstep's transitions hold the guard as an Option, which is what the explorer reads (F12)", () =>
    Effect.gen(function* () {
      const guards: Array<unknown> = []
      const machine = createMachine({
        id: "m",
        initial: "a",
        states: { a: { on: { GO: { target: "b", guard: () => true } } }, b: { on: { GO: "a" } } },
      })
      const actor = yield* createActor(machine, {
        inspect: (event) =>
          Effect.sync(() => {
            if (event.type === "@xstate.microstep") guards.push(...event._transitions.map((transition) => transition.guard))
          }),
      })
      yield* actor.start
      yield* actor.send({ type: "GO" })
      yield* actor.send({ type: "GO" })
      assert.lengthOf(guards, 2)
      assert.isTrue(guards.every((guard) => Option.isOption(guard)))
      assert.deepStrictEqual(guards.map((guard) => Option.isSome(guard as Option.Option<unknown>)), [true, false])
    }).pipe(Effect.scoped)
  )
})

describe("explore: every value of a merged state is compared (F2)", () => {
  it("[COV-5] CongruenceViolation: the third value of a merged state is compared, not only the second (F2)", async () => {
    const error = await failure(hidden, eventsOnly(["INC", "CHECK", "STOP"], { n: () => 0 }))
    assert.strictEqual(Reflect.get(error, "_tag"), "CongruenceViolation")
    assert.include(Reflect.get(error, "message"), "CHECK")
  })

  it("[COV-5] a merged state with an equal value is checked once: a falling cycle of two values still ends", async () => {
    const flip = createMachine({
      types: {} as { context: { n: number } },
      id: "m",
      context: { n: 0 },
      initial: "a",
      states: {
        a: { on: { FLIP: { actions: assign({ n: ({ context }) => 1 - context.n }) }, STOP: "done" } },
        done: { type: "final" },
      },
    })
    const result = await Effect.runPromise(explore(flip, eventsOnly(["FLIP", "STOP"], { n: () => 0 })))
    assert.deepStrictEqual(result.abstraction, ["n"])
  })

  it("[COV-5] a field that grows for ever gives a new merge each time, so the timeout ends the run, which fails closed", async () => {
    const fresh = createMachine({
      types: {} as { context: { n: unknown } },
      id: "m",
      context: { n: 0n },
      initial: "a",
      states: {
        a: { on: { FLIP: { actions: assign({ n: ({ context }) => (context.n as bigint) + 1n }) }, STOP: "done" } },
        done: { type: "final" },
      },
    })
    const error = await failure(fresh, { ...eventsOnly(["FLIP", "STOP"], { n: () => 0 }), timeout: "50 millis" })
    assert.strictEqual(Reflect.get(error, "_tag"), "ExploreTimeout")
  })

  it("[COV-5] a value with no canonical form never counts as seen: it is compared each time, and the timeout ends the run", async () => {
    const opaque = createMachine({
      types: {} as { context: { n: unknown } },
      id: "m",
      context: { n: new WeakMap() },
      initial: "a",
      states: {
        a: { on: { FLIP: { guard: ({ context }) => context.n !== null, actions: assign({ n: () => new WeakMap() }) }, STOP: "done" } },
        done: { type: "final" },
      },
    })
    const error = await failure(opaque, { ...eventsOnly(["FLIP", "STOP"], { n: () => 0 }), timeout: "50 millis" })
    assert.strictEqual(Reflect.get(error, "_tag"), "ExploreTimeout")
  })
})

describe("explore: each detector has a failing machine (F19)", () => {
  it("[COV-5] UndrivenInput: a kind with no driver, and a driver that never gives an input", async () => {
    const machine = createMachine({ id: "m", initial: "a", states: { a: { on: { GO: "b" } }, b: { type: "final" } } })
    const none = await failure(machine, { ...eventsOnly(["GO"]), catalogue: ["event", "person"] })
    assert.strictEqual(Reflect.get(none, "_tag"), "UndrivenInput")
    assert.strictEqual(Reflect.get(none, "kind"), "person")
    const silent = await failure(machine, { ...eventsOnly(["GO"]), catalogue: ["event", "person"], inputs: { event: () => [{ type: "GO" }], person: () => [] } })
    assert.strictEqual(Reflect.get(silent, "_tag"), "UndrivenInput")
    assert.strictEqual(Reflect.get(silent, "kind"), "person")
  })

  it("[COV-5] UnabstractedField: a read with no mapping stops the run with its field and trace", async () => {
    const error = await failure(hidden, eventsOnly(["INC", "CHECK", "STOP"]))
    assert.strictEqual(Reflect.get(error, "_tag"), "UnabstractedField")
    assert.strictEqual(Reflect.get(error, "field"), "n")
    assert.strictEqual((Reflect.get(error, "trace") as ReadonlyArray<{ kind: string }>)[0]?.kind, "initial")
  })

  it("[COV-5] InvalidRanking: a guarded ranking that is no natural number after its transition", async () => {
    const machine = createMachine({
      types: {} as { context: { n: number } },
      id: "m",
      context: { n: 0 },
      initial: "a",
      states: {
        a: { on: { GO: { guard: () => true, target: "b", meta: { ranking: "n" }, actions: assign({ n: -1 }) } } },
        b: { type: "final" },
      },
    } as never) as AnyStateMachine
    const error = await failure(machine, eventsOnly(["GO"], { n: (value) => Number(value) }))
    assert.strictEqual(Reflect.get(error, "_tag"), "InvalidRanking")
    assert.strictEqual(Reflect.get(error, "field"), "n")
  })

  it("[COV-5] UnrankedCycle: a re-entry of an agent state on a cycle that no person bounds", async () => {
    const machine = createMachine(
      {
        id: "m",
        initial: "a",
        states: {
          a: { invoke: { src: "agent", id: "mind", input: 1, onDone: "b" }, on: { DONE: "b" } },
          b: { on: { AGAIN: "a", STOP: "c" } },
          c: { type: "final" },
        },
      },
      { actors: { agent } }
    )
    const error = await failure(machine, eventsOnly(["DONE", "AGAIN", "STOP"]))
    assert.strictEqual(Reflect.get(error, "_tag"), "UnrankedCycle")
    assert.isTrue((Reflect.get(error, "edge") as { reentersAgent: boolean }).reentersAgent)
    const person = await Effect.runPromise(
      explore(machine, {
        catalogue: ["event", "person"],
        inputs: { event: () => [{ type: "DONE" }, { type: "STOP" }], person: () => [{ type: "AGAIN" }] },
        abstraction: {},
        timeout: "30 seconds",
      })
    )
    assert.isAbove(person.explored, 2)
  })

  it("[COV-5] CannotReachFinal: a sink names its state and its trace", async () => {
    const machine = createMachine({ id: "m", initial: "a", states: { a: { on: { GO: "sink", END: "b" } }, sink: {}, b: { type: "final" } } })
    const error = await failure(machine, eventsOnly(["GO", "END"]))
    assert.strictEqual(Reflect.get(error, "_tag"), "CannotReachFinal")
    assert.include((Reflect.get(error, "states") as ReadonlyArray<string>)[0], "sink")
    assert.strictEqual((Reflect.get(error, "trace") as ReadonlyArray<{ input: string }>).at(-1)?.input, '{"type":"GO"}')
  })
})

describe("explore: an assign keeps recording (F23)", () => {
  it("[COV-5] an assign keeps the recording context, so an always guard after it records its read (F23)", async () => {
    const machine = createMachine({
      types: {} as { context: { x: number; y: number } },
      id: "m",
      context: { x: 0, y: 1 },
      initial: "a",
      states: {
        a: { on: { GO: { target: "b", actions: assign({ x: 1 }) } } },
        b: { always: [{ guard: ({ context }) => context.y > 0, target: "c" }, { target: "c" }] },
        c: { type: "final" },
      },
    })
    const result = await Effect.runPromise(explore(machine, eventsOnly(["GO"], { y: (value) => Number(value) })))
    assert.deepStrictEqual(result.abstraction, ["y"])
  })
})

describe("proveSettlement: cycles through parallel regions (F21)", () => {
  /** A parallel state with an agent region, and a region whose `r` has `kick`; `q` lies outside it. */
  const parallel = (kick: object, back: object = {}) =>
    createMachine({
      id: "m",
      initial: "p",
      states: {
        p: {
          type: "parallel",
          states: {
            left: { initial: "w", states: { w: settled } },
            right: { initial: "r", states: { r: { on: { KICK: kick }, ...exit } } },
          },
        },
        q: { on: { BACK: back }, ...exit },
        done: { type: "final" },
      },
    } as never) as AnyStateMachine

  it("[COV-5] a transition of a region that re-enters the parallel state re-enters the agent beside it", () => {
    assert.deepStrictEqual(findings(parallel({ target: "#m.p", reenter: true })), ["UnrankedAgentCycle: p.left.w"])
    assert.deepStrictEqual(findings(parallel({ target: "#m.p", reenter: true, meta: { person: true } })), [])
  })

  it("[COV-5] leaving a region for a state that enters it again starts the agent beside it by default entry", () => {
    assert.deepStrictEqual(findings(parallel({ target: "#m.q" }, { target: "#m.p.right.r" })), ["UnrankedAgentCycle: p.left.w"])
    assert.deepStrictEqual(findings(parallel({ target: "#m.q" }, { target: "#m.p.right.r", meta: { person: true } })), [])
  })

  it("[COV-5] a transition inside one region leaves the agent beside it alone", () => {
    assert.deepStrictEqual(findings(parallel({ target: "r", reenter: true })), [])
  })

})

describe("proveSettlement: stops on entry and exit (F22)", () => {
  it("[COV-5] a stop of an invoked agent on entry or on exit counts as one on a transition", () => {
    const stopping = (member: "entry" | "exit") =>
      withDone({ a: { ...settled, ...exit }, b: { [member]: stopChild("i"), ...exit } })
    assert.deepStrictEqual(findings(stopping("entry")), ["StopsInvokedAgent: b"])
    assert.deepStrictEqual(findings(stopping("exit")), ["StopsInvokedAgent: b"])
    const own = (member: "entry" | "exit") =>
      withDone({ a: { ...settled, [member]: stopChild("i"), ...exit } })
    assert.deepStrictEqual(findings(own("entry")), ["StopsInvokedAgent: a"])
    assert.deepStrictEqual(findings(own("exit")), ["StopsInvokedAgent: a"])
  })
})

/** The agent actor of the cross-check, as a setup's union names it. */
type CrossCheckedActor = { readonly src: "agent"; readonly logic: AgentBranded }

/** What the compile-time checks find in a config: the proof's failures, and `Settlement` for `SettlementCheck`. */
type TypeFindings<TConfig> =
  | SettlementReport<TConfig, "agent">["failures"]
  | (unknown extends SettlementCheck<TConfig, CrossCheckedActor> ? never : "Settlement")

/** `true` when the two unions hold the same members. */
type SameUnion<A, B> = [A] extends [B] ? [B] extends [A] ? true : false : false

/**
 * Feeds one config to both proofs: the compiler checks `expected` against the type proof, this
 * run checks it against `proveSettlement`, so a test passes only when the two agree. The kinds
 * `SettlementCheck` reports by shape count as one `Settlement`.
 */
const agree = <const TConfig, const TExpected extends ReadonlyArray<string>>(
  config: TConfig,
  expected: TExpected & (SameUnion<TExpected[number], TypeFindings<TConfig>> extends true ? unknown : never)
) => {
  const found = findings(createMachine(config as never, { actors: { agent } } as never) as AnyStateMachine)
    .map((each) => (/^(SettlementMustExit|AgentDoneOutsideOnDone): /.test(each) ? "Settlement" : each))
  assert.deepStrictEqual([...new Set(found)].sort(), [...expected].sort())
}

describe("the type proof and the structural proof agree on one machine (F32)", () => {
  it("[COV-5] a machine that settles passes both", () => {
    agree({
      id: "m",
      initial: "a",
      states: { a: { invoke: { src: "agent", input: 1, onDone: "b" } }, b: { type: "final" } },
    }, [])
  })

  it("[COV-5] both find a state with no progress guarantee and no way to a final state", () => {
    agree({
      id: "m",
      initial: "a",
      states: { a: { invoke: { src: "agent", input: 1, onDone: "b" } }, b: {}, c: { type: "final" } },
    }, ["NoProgressGuarantee: b", "CannotReachFinal: a", "CannotReachFinal: b"])
  })

  it("[COV-5] both refuse an after of infinity, and take a finite one", () => {
    agree({
      id: "m",
      initial: "a",
      states: { a: { invoke: { src: "agent", input: 1, onDone: "b" } }, b: { after: { Infinity: "c" } }, c: { type: "final" } },
    }, ["NoProgressGuarantee: b"])
    agree({
      id: "m",
      initial: "a",
      states: { a: { invoke: { src: "agent", input: 1, onDone: "b" } }, b: { after: { 10: "c" } }, c: { type: "final" } },
    }, [])
  })

  it("[COV-5] both find an unguarded always loop", () => {
    agree({
      id: "m",
      initial: "a",
      states: {
        a: { invoke: { src: "agent", input: 1, onDone: "x" } },
        x: { always: "y" },
        y: { always: "x" },
        c: { type: "final" },
      },
    }, ["Livelock: x", "Livelock: y", "CannotReachFinal: a", "CannotReachFinal: x", "CannotReachFinal: y"])
  })

  it("[COV-5] both find a region that cannot complete", () => {
    agree({
      id: "m",
      initial: "p",
      states: {
        p: {
          type: "parallel",
          onDone: "c",
          states: {
            left: { initial: "w", states: { w: { invoke: { src: "agent", input: 1, onDone: "z" } }, z: { type: "final" } } },
            right: { initial: "r", states: { r: { after: { 10: "s" } }, s: { after: { 10: "r" } } } },
          },
        },
        c: { type: "final" },
      },
    }, [
      "CannotReachFinal: p",
      "CannotReachFinal: p.left",
      "CannotReachFinal: p.left.w",
      "CannotReachFinal: p.right",
      "CannotReachFinal: p.right.r",
      "CannotReachFinal: p.right.s",
      "RegionCannotComplete: p.right",
    ])
  })

  it("[COV-5] both refuse an onDone that stays", () => {
    agree({
      id: "m",
      initial: "a",
      states: { a: { invoke: { src: "agent", input: 1, onDone: {} }, after: { 10: "c" } }, c: { type: "final" } },
    }, ["Settlement"])
  })

  it("[COV-5] both refuse a child's key of each wildcard form, and take any other key", () => {
    /** An agent state whose child holds `on`. */
    const below = <const TOn>(on: TOn) => ({
      id: "m",
      initial: "a",
      states: {
        a: { invoke: { src: "agent", id: "i", input: 1, onDone: "c" }, initial: "x", states: { x: { on } } },
        c: { type: "final" },
      },
    } as const)
    agree(below({ "*": {} }), ["Settlement"])
    agree(below({ "xstate.*": {} }), ["Settlement"])
    agree(below({ "xstate.done.*": {} }), ["Settlement"])
    agree(below({ "xstate.done.actor.*": {} }), ["Settlement"])
    agree(below({ "xstate.done.actor.i.*": {} }), ["Settlement"])
    agree(below({ "xstate.done.actor.i": {} }), ["Settlement"])
    agree(below({ OTHER: {} }), [])
    agree(below({ "xstate.done.state.*": {} }), [])
  })

  it("[COV-5] both take a wildcard on the invoking state and on an ancestor", () => {
    agree({
      id: "m",
      initial: "p",
      states: {
        p: { on: { "*": {} }, initial: "a", states: { a: { invoke: { src: "agent", input: 1, onDone: "#m.c" }, on: { "*": {} } } } },
        c: { type: "final" },
      },
    }, [])
  })

  it("[COV-5] both read a key beside an agent by whether it conflicts with onDone", () => {
    /** A parallel state whose left region holds the agent, and whose right region holds `on`. */
    const beside = <const TOn, const TDone>(on: TOn, onDone: TDone) => ({
      id: "m",
      initial: "p",
      states: {
        p: {
          type: "parallel",
          states: {
            left: { initial: "w", states: { w: { invoke: { src: "agent", input: 1, onDone }, after: { 10: "#m.c" } }, x: { after: { 10: "#m.c" } } } },
            right: { initial: "r", states: { r: { on, after: { 10: "#m.c" } }, s: { after: { 10: "#m.c" } } } },
          },
        },
        c: { type: "final" },
      },
    } as const)
    agree(beside({ "*": "#m.c" }, "x"), ["Settlement"])
    agree(beside({ "*": "s" }, "#m.c"), ["Settlement"])
    agree(beside({ "*": "s" }, "x"), [])
    agree(beside({ "*": {} }, "#m.c"), [])
  })
})

/** A file system of `files` (path to text), with `links` from a path to its real path. */
const fileSystem = (files: Readonly<Record<string, string>>, links: Readonly<Record<string, string>> = {}) =>
  Layer.merge(
    Path.layer,
    FileSystem.layerNoop({
      stat: (file) =>
        Object.hasOwn(files, file)
          ? Effect.succeed({ type: "File" } as FileSystem.File.Info)
          : Effect.fail({ _tag: "PlatformError" } as never),
      readFileString: (file) => Effect.succeed(files[file] ?? ""),
      realPath: (file) => Effect.succeed(links[file] ?? file),
    })
  )

/** The module names the closure of `/app/entry.ts` gives. */
const closure = (files: Readonly<Record<string, string>>, links?: Readonly<Record<string, string>>) =>
  Effect.runSync(
    moduleClosure("/app/entry.ts").pipe(
      Effect.map((modules) => modules.map((each) => each.path)),
      Effect.provide(fileSystem(files, links))
    )
  )

/** The closure of one entry whose text is `source`, beside a file `x.ts`. */
const closureOf = (source: string) => closure({ "/app/entry.ts": source, "/app/x.ts": "" })

describe("COV-5 the import scan reads every written form (F17)", () => {
  /** Each form that names `./x` as a load. */
  const forms = [
    `import "./x"`,
    `import a from "./x"`,
    `import { a } from "./x"`,
    `import * as a from "./x"`,
    `import {\n  a,\n  b,\n} from\n  "./x"`,
    `export * from "./x"`,
    `export { a } from "./x"`,
    `import("./x")`,
    `import(/* webpackChunkName: "c" */ "./x")`,
    `import(\n  // why\n  "./x"\n)`,
    "import(`./x`)",
    `import /* c */ ("./x")`,
    `import("./x", { with: { type: "json" } })`,
    `import.defer("./x")`,
    `import.source("./x")`,
    `import a from /* c */ "./x"`,
    `import a from // c\n  "./x"`,
    `require("./x")`,
    `require(/* c */ "./x")`,
    `require.resolve("./x")`,
    `require\n  .resolve(\n  "./x")`,
    `import.meta.resolve("./x")`,
    `import.meta.resolve(/* c */ "./x")`,
    `import a = require("./x")`,
    "const a = `${await import(\"./x\")}`",
    `const a = { b: { c: () => import("./x") } }`,
  ]

  it("finds each form as a load, and the closure follows it", () => {
    for (const form of forms) {
      assert.deepStrictEqual(scanImports(form, "/a.ts").loads, ["./x"], form)
      assert.deepStrictEqual(closureOf(form), ["entry.ts", "x.ts"], form)
    }
  })

  it("finds each form as a mention too, inside a comment or a string", () => {
    for (const form of forms) {
      assert.include(scanImports(`/* ${form} */`, "/a.ts").mentions, "./x", form)
      assert.deepStrictEqual(scanImports(`/* ${form} */`, "/a.ts").loads, [], form)
    }
  })

  it("does not read a name inside a comment, a string, a template or a regular expression as a load", () => {
    for (const source of [
      `// import "./x"`,
      `/* import "./x" */`,
      `/** @example\n * import a from "./x"\n */`,
      `const a = 'import "./x"'`,
      `const a = "from './x'"`,
      "const a = `import(\"./x\")`",
      "const a = `${b} import(\"./x\") ${c}`",
      `const a = /import "\.\/x"/.test(b)`,
      `const a = [/["']/, /\//]; // import "./x"`,
      `a.from("./x")`,
      `a.import("./x")`,
      `a.require("./x")`,
      `a.require.resolve("./x")`,
      `a.meta.resolve("./x")`,
      `Promise.resolve("./x")`,
    ]) {
      assert.deepStrictEqual(scanImports(source, "/a.ts").loads, [], source)
    }
  })

  it("keeps its place after a regular expression, a division, a stray quote and a shebang", () => {
    for (const source of [
      `#!/usr/bin/env node\nimport "./x"`,
      `const a = /"/\nimport "./x"`,
      "const a = /`/\nimport \"./x\"",
      `const a = /[/"]/\nimport "./x"`,
      `const a = b / c\nimport "./x"`,
      `const a = (b) / c / d\nimport "./x"`,
      `const a = <p>don't</p>\nimport "./x"`,
      `const a = "\\""\nimport "./x"`,
      "const a = `\\``\nimport \"./x\"",
      "const a = `a${`b${c}`}d`\nimport \"./x\"",
      "const a = `${{ b: 1 }}`\nimport \"./x\"",
    ]) {
      assert.deepStrictEqual(scanImports(source, "/a.ts").loads, ["./x"], source)
    }
  })

  it("leaves a computed name to neither pass, and says so", () => {
    for (const source of [`import(name)`, `import("./" + name)`, `require("./" + name)`, "import(`./${name}.ts`)"]) {
      assert.deepStrictEqual(scanImports(source, "/a.ts").loads, [], source)
    }
    assert.deepStrictEqual(scanImports(`createRequire(url)("./x")`, "/a.ts"), { loads: [], mentions: [] })
  })

  it("keeps a lost load in the hash: a text the lexer misreads still names the file", () => {
    // A division after `)` starts no regular expression, so this quote swallows the import
    const source = `if (a) /'/.test(b); import "./x"; const c = "'"`
    assert.deepStrictEqual(scanImports(source, "/a.ts").loads, [])
    assert.deepStrictEqual(closureOf(source), ["entry.ts", "x.ts"])
  })
})

describe("COV-5 the closure tells a real import from a mention (F3)", () => {
  it("records a real missing import as unresolved, a named one as mentioned", () => {
    const modules = closureOf(`// see from "./comment"\nconst a = "import './string'"\nimport "./gone"`)
    assert.deepStrictEqual(modules, ["entry.ts", "mentioned:./comment", "mentioned:./string", "unresolved:./gone"])
  })

  it("lets a load outrank a mention of one name, in either order", () => {
    assert.deepStrictEqual(closureOf(`// import "./gone"\nimport "./gone"`), ["entry.ts", "unresolved:./gone"])
    assert.deepStrictEqual(closureOf(`import "./gone"\n// import "./gone"`), ["entry.ts", "unresolved:./gone"])
  })

  it("keeps a type-only import of a missing file from counting as a real one", () => {
    for (const source of [
      `import type { A } from "./gone"`,
      `import type A from "./gone"`,
      `import type * as A from "./gone"`,
      `import type from from "./gone"`,
      `import { type A, type B as C } from "./gone"`,
      `import { type A, } from "./gone"`,
      `export type { A } from "./gone"`,
      `export type * from "./gone"`,
      `export { type A } from "./gone"`,
      `import type A = require("./gone")`,
    ]) {
      assert.deepStrictEqual(closureOf(source), ["entry.ts", "mentioned:./gone"], source)
    }
  })

  it("counts the forms that keep a value as real, also when they name a binding `type`", () => {
    for (const source of [
      `import type from "./gone"`,
      `import type, { a } from "./gone"`,
      `import { type A, b } from "./gone"`,
      `import { type } from "./gone"`,
      `import { type as a } from "./gone"`,
      `import {} from "./gone"`,
      `import a, { type B } from "./gone"`,
      `export const type = 1\nexport { a } from "./gone"`,
      `export type A = 1\nexport { a } from "./gone"`,
      `const a: import("./gone").B = 1`,
    ]) {
      assert.deepStrictEqual(closureOf(source), ["entry.ts", "unresolved:./gone"], source)
    }
  })

  it("adds a type-only import's file to the hash, and its own missing imports do not count", () => {
    assert.deepStrictEqual(
      closure({ "/app/entry.ts": `import type { A } from "./types"`, "/app/types.ts": `import "./gone"` }),
      ["entry.ts", "mentioned:./gone", "types.ts"]
    )
  })

  it("does the same for a file that only a comment names", () => {
    assert.deepStrictEqual(
      closure({ "/app/entry.ts": `// was import "./old"`, "/app/old.ts": `import "./gone"\n// from "./older"` }),
      ["entry.ts", "mentioned:./gone", "mentioned:./older", "old.ts"]
    )
  })

  it("reads a declaration file as loading nothing, and takes it for a value import", () => {
    assert.deepStrictEqual(
      closure({ "/app/entry.ts": `import { A } from "./types"`, "/app/types.d.ts": `import { B } from "./gone"` }),
      ["entry.ts", "mentioned:./gone", "types.d.ts"]
    )
  })

  it("names only the real ones in unresolvedImports", () => {
    assert.deepStrictEqual(
      unresolvedImports([
        { path: "a.ts", source: "" },
        { path: "mentioned:./b", source: "" },
        { path: "unresolved:./c", source: "" },
      ]),
      ["./c"]
    )
  })

  it("certify fails a machine whose closure has a real unresolved import", async () => {
    const machine = createMachine({ id: "m", initial: "a", states: { a: {} } })
    const explored = () => Effect.succeed({ explored: 1 })
    const verdictOf = (path: string) =>
      Effect.runPromise(certify(machine, explored, { modules: [{ path, source: "" }] })).then((each) => each.verdict)
    assert.strictEqual(await verdictOf("mentioned:./gone"), "proved")
    assert.strictEqual(await verdictOf("unresolved:./gone"), "failed")
  })
})

describe("COV-5 the closure resolves each import form (F3)", () => {
  it("finds a source file through each compiled extension", () => {
    assert.deepStrictEqual(
      closure({
        "/app/entry.ts": `import "./a.jsx"\nimport "./b.cjs"\nimport "./c.mjs"\nimport "./d.js"\nimport "./e.js"\nimport "./f"\nimport "./g"`,
        "/app/a.tsx": "",
        "/app/b.cts": "",
        "/app/c.mts": "",
        "/app/d.tsx": "",
        "/app/e.jsx": "",
        "/app/f.cts": "",
        "/app/g.cjs": "",
      }),
      ["a.tsx", "b.cts", "c.mts", "d.tsx", "e.jsx", "entry.ts", "f.cts", "g.cjs"]
    )
  })

  it("prefers a source file over its declaration, and reads imports in .cts and .cjs", () => {
    assert.deepStrictEqual(
      closure({
        "/app/entry.ts": `import "./a"\nimport "./b.cjs"`,
        "/app/a.ts": "",
        "/app/a.d.ts": "",
        "/app/b.cts": `import "./c"`,
        "/app/c.cjs": `require("./d")`,
        "/app/d.ts": "",
      }),
      ["a.ts", "b.cts", "c.cjs", "d.ts", "entry.ts"]
    )
  })

  it("counts a builtin with no node: prefix as a builtin", () => {
    assert.deepStrictEqual(closureOf(`import "fs"\nimport "fs/promises"\nimport "node:path"`), ["builtin:fs", "builtin:fs/promises", "builtin:node:path", "entry.ts"])
  })

  it("resolves a tsconfig alias, exact and by pattern, and takes the first target with a file", () => {
    assert.deepStrictEqual(
      closure({
        "/app/entry.ts": `import "@/guards"\nimport "@/deep/x.js"\nimport "exact"\nimport "@/two"\nimport "@/gone"`,
        "/app/tsconfig.json": `{\n  // the aliases\n  "compilerOptions": { /* c */ "paths": {\n    "@/*": ["./gen/*", "./src/*",],\n    "@/deep/*": ["./deep/*"],\n    "exact": ["./exact.ts"],\n  },\n},\n}`,
        "/app/src/guards.ts": "",
        "/app/src/two.ts": "",
        "/app/gen/two.ts": "",
        "/app/deep/x.ts": "",
        "/app/exact.ts": "",
      }),
      ["deep/x.ts", "entry.ts", "exact.ts", "gen/two.ts", "src/guards.ts", "unresolved:@/gone"]
    )
  })

  it("reads paths through extends, relative to the config that holds them, and stops a cycle", () => {
    assert.deepStrictEqual(
      closure({
        "/app/deep/entry.ts": "",
        "/app/entry.ts": `import "@/guards"`,
        "/app/tsconfig.json": `{ "extends": "../base/tsconfig.base" }`,
        "/base/tsconfig.base.json": `{ "extends": "/app/tsconfig.json", "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }`,
        "/base/src/guards.ts": "",
      }),
      ["../base/src/guards.ts", "entry.ts"]
    )
  })

  it("reads extends from a package, and an extends list in which the last one wins", () => {
    assert.deepStrictEqual(
      closure({
        "/app/entry.ts": `import "@/a"\nimport "b/c"`,
        "/app/tsconfig.json": `{ "extends": ["./first.json", "shared/strict", "gone"] }`,
        "/app/first.json": `{ "compilerOptions": { "paths": { "@/*": ["./first/*"] } } }`,
        "/app/node_modules/shared/strict.json": `{ "compilerOptions": { "baseUrl": "${"$"}{configDir}/lib", "paths": { "@/*": ["./two/*"] } } }`,
        "/app/lib/two/a.ts": "",
        "/app/lib/b/c.ts": "",
      }),
      ["entry.ts", "lib/b/c.ts", "lib/two/a.ts"]
    )
  })

  it("reads a jsconfig.json, and a broken config has no aliases", () => {
    assert.deepStrictEqual(
      closure({
        "/app/entry.ts": `import "@/a"`,
        "/app/jsconfig.json": `{ "compilerOptions": { "paths": { "@/*": ["./*"] } } }`,
        "/app/a.js": "",
      }),
      ["a.js", "entry.ts"]
    )
    assert.deepStrictEqual(
      closure({ "/app/entry.ts": `import "@/a"`, "/app/tsconfig.json": `not json`, "/app/a.ts": "" }),
      ["entry.ts", "unresolved:@/a"]
    )
  })

  it("resolves a package's import of its own name, through its exports", () => {
    assert.deepStrictEqual(
      closure({
        "/app/entry.ts": `import "@me/kit"\nimport "@me/kit/sub"\nimport "@me/kit/gone"`,
        "/app/package.json": `{ "name": "@me/kit", "exports": { ".": { "types": "./types.d.ts", "import": "./main.js" }, "./sub": "./sub.ts" } }`,
        "/app/main.js": "",
        "/app/types.d.ts": "",
        "/app/sub.ts": "",
      }),
      ["entry.ts", "main.js", "sub.ts", "types.d.ts", "unresolved:@me/kit/gone"]
    )
  })

  it("resolves its own name through main with no exports, and only from the nearest package.json", () => {
    assert.deepStrictEqual(
      closure({ "/app/entry.ts": `import "me"`, "/app/package.json": `{ "name": "me", "main": "main.ts" }`, "/app/main.ts": "" }),
      ["entry.ts", "main.ts"]
    )
    assert.deepStrictEqual(
      closure({ "/app/entry.ts": `import "me"`, "/app/package.json": `{ "type": "module" }`, "/package.json": `{ "name": "me" }`, "/index.ts": "" }),
      ["entry.ts", "unresolved:me"]
    )
  })
})

// ---------------------------------------------------------------- finite delays (0.4.1)

/**
 * A machine `m` whose agent state `a` leaves for `done` only through the named delay `timebox`: its
 * logic carries the brand but `fromAgent` did not build it, so its `onDone` is no progress guarantee.
 */
const timeboxed = (timebox: unknown) =>
  withDone({ a: { invoke: { src: "work", id: "work", input: 1, onDone: "#m.done" }, after: { timebox: "#m.done" } } }, "a", { work: markedLogic })
    .provide({ delays: { timebox } } as never)

/** The certificate of `machine` with a fixed exploration and no module closure. */
const certificateOf = (machine: AnyStateMachine) =>
  Effect.runPromise(certify(machine, () => Effect.succeed({ explored: 1 }), { modules: [{ path: "entry.ts", source: "" }] }))

describe("COV-5 a finiteDelay is a progress guarantee to the proof and the certificate (0.4.1)", () => {
  it("[COV-5] proveSettlement takes a finiteDelay and refuses a plain function or a forged wrapper", () => {
    const real = finiteDelay(() => 10, { max: 1000 })
    assert.deepStrictEqual(findings(timeboxed(real)), [])
    const forged = [
      () => 10,
      Object.defineProperties(() => 10, Object.getOwnPropertyDescriptors(real)),
      real.bind(undefined),
      finiteDelay(() => 10, { max: 0 as 1 }),
    ]
    for (const delay of forged) {
      assert.deepStrictEqual(findings(timeboxed(delay)), ["NoProgressGuarantee: a"], String(delay))
    }
    // A plain function given through setup's delays (A1)
    const throughSetup = setup({ actors: { work: markedLogic }, delays: { timebox: () => 10 } }).createMachine({
      id: "m",
      initial: "a",
      states: { a: { invoke: { src: "work", id: "work", input: 1, onDone: "#m.done" }, after: { timebox: "#m.done" } }, done: { type: "final" } },
    } as never) as unknown as AnyStateMachine
    assert.deepStrictEqual(findings(throughSetup), ["NoProgressGuarantee: a"])
  })

  it("[COV-5] certify proves a finiteDelay machine, and its hash changes with the bound and with the function", async () => {
    const base = await certificateOf(timeboxed(finiteDelay(() => 10, { max: 1000 })))
    assert.strictEqual(base.verdict, "proved")
    assert.include(base.edges, "a: after timebox -> done")
    const same = await certificateOf(timeboxed(finiteDelay(() => 10, { max: 1000 })))
    const otherMax = await certificateOf(timeboxed(finiteDelay(() => 10, { max: 2000 })))
    const otherFn = await certificateOf(timeboxed(finiteDelay(() => 20, { max: 1000 })))
    assert.strictEqual(same.hash, base.hash)
    assert.notStrictEqual(otherMax.hash, base.hash)
    assert.notStrictEqual(otherFn.hash, base.hash)
    const plain = await certificateOf(timeboxed(() => 10))
    assert.strictEqual(plain.verdict, "failed")
  })

  it("[COV-5] timerFirings offers a finiteDelay's after event, and the explorer takes it", async () => {
    const machine = timeboxed(finiteDelay(() => 10, { max: 1000 }))
    const result = await Effect.runPromise(
      explore(machine, { catalogue: ["timer"], inputs: { timer: timerFirings }, abstraction: {}, timeout: "30 seconds" })
    )
    assert.isTrue(result.edges.some((edge) => edge.kind === "timer" && edge.input === `{"type":"xstate.after.timebox.m.a"}` && edge.to !== edge.from), JSON.stringify(result.edges))
  })
})
