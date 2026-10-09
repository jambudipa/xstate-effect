/**
 * @since 0.1.0
 * @module graph/TestModel
 *
 * Test models (upstream `src/graph/TestModel.ts` at xstate@5.33.2): an abstract model of a
 * system under test, whose paths test that the states of the model are reachable in the
 * system. The constructor stays synchronous (it runs no user code); the path methods,
 * `getAdjacencyMap` and the path tests return Effects (SD-13), and `createTestModel` fails its
 * Effect for a machine a test model cannot drive (SD-3).
 */
import { Effect, Function, Option, Predicate } from "effect"
import type { ActorLogic } from "../ActorLogic.js"
import type { EventObject } from "../Event.js"
import { isMachineSnapshot, type Snapshot } from "../Snapshot.js"
import { type AnyStateMachine, isStateMachine } from "../StateMachine.js"
import type { StateValue } from "../StateValue.js"
import { getAdjacencyMap } from "./adjacency.js"
import { deduplicatePaths } from "./deduplicatePaths.js"
import type { InvalidEventSequenceError, JoinPathsError, UnsupportedTestMachineError } from "./errors.js"
import { joinPaths, serializeSnapshot } from "./graph.js"
import { getPathsFromEvents } from "./pathFromEvents.js"
import { createShortestPathsGen, createSimplePathsGen } from "./pathGenerators.js"
import type {
  AdjacencyMap,
  EventExecutor,
  PathGenerator,
  SerializedSnapshot,
  StatePath,
  Step,
  TestModelOptions,
  TestParam,
  TestPath,
  TestPathResult,
  TestStepResult,
  TraversalError,
  TraversalOptions,
} from "./types.js"
import { formatPathTestResult, getAllOwnEventDescriptors, getDescription, simpleStringify } from "./utils.js"
import { validateMachine } from "./validateMachine.js"

/**
 * The options of one path query of a test model: traversal options that override the
 * model's for that query, and whether to keep the paths that a longer path contains.
 */
type GetPathOptions<TSnapshot extends Snapshot, TEvent extends EventObject, TInput> = Partial<
  TraversalOptions<TSnapshot, TEvent, TInput>
> & {
  /**
   * Whether to allow deduplicate paths so that paths that are contained by longer paths are
   * included.
   *
   * @default false
   */
  allowDuplicatePaths?: boolean
}

/** Whether the result of a user callback is an Effect to run. */
const isEffectResult = (result: void | Effect.Effect<unknown, unknown>): result is Effect.Effect<unknown, unknown> =>
  Effect.isEffect(result)

/**
 * Runs a state test or an event executor: what it throws fails the Effect with the thrown
 * value, and the Effect it returns runs (upstream awaits the returned promise).
 */
const runCallback = (callback: () => void | Effect.Effect<unknown, unknown>): Effect.Effect<void, unknown> =>
  Effect.flatMap(Effect.try({ try: callback, catch: Function.identity }), (result) =>
    isEffectResult(result) ? Effect.asVoid(result) : Effect.void
  )

/** Runs a state matcher: what it throws fails the Effect; the Effect it returns runs. */
const runMatcher = (matcher: () => boolean | Effect.Effect<boolean, unknown>): Effect.Effect<boolean, unknown> =>
  Effect.flatMap(Effect.try({ try: matcher, catch: Function.identity }), (result) =>
    typeof result === "boolean" ? Effect.succeed(result) : result
  )

/**
 * Appends the path trace to the message of what a path test failed with (upstream
 * `err.message += ...`). A thrown value that is not an `Error` has no message to extend and
 * stays as it is.
 */
const appendTrace = (err: unknown, trace: string): Effect.Effect<never, unknown> =>
  Effect.flatMap(
    Effect.sync(() => {
      if (Predicate.isError(err)) {
        err.message += trace
      }
    }),
    () => Effect.fail(err)
  )

/** The text of an event in a path description: its type, then its other fields as JSON. */
const formatEvent = (event: EventObject): string => {
  const { type, ...other } = event

  const propertyString = Object.keys(other).length ? ` (${simpleStringify(other)})` : ""

  return `${type}${propertyString}`
}

/**
 * Creates a test model that represents an abstract model of a system under test (SUT).
 *
 * The test model is used to generate test paths, which are used to verify that states in the
 * model are reachable in the SUT.
 *
 * @example
 * ```ts
 * const model = new TestModel(logic, { events: (state) => [{ type: "next" }] })
 * const paths = yield* model.getShortestPaths({ toState: (state) => state.context === 1 })
 * ```
 *
 * @since 0.1.0
 * @category Test model
 */
export class TestModel<TSnapshot extends Snapshot, TEvent extends EventObject, TInput> {
  /**
   * The model's options: {@link getDefaultOptions} under the constructor's options. Each path
   * query and path test reads them under its own options; `getPathsFromEvents` does not.
   */
  public options: TestModelOptions<TSnapshot, TEvent, TInput>
  /**
   * Traversal options under the model's `options`, for a caller to set on the instance.
   * Nothing in this package sets it (upstream keeps the same open field).
   */
  public defaultTraversalOptions?: TraversalOptions<TSnapshot, TEvent, TInput>
  /**
   * The defaults for a logic that is not a machine: states and events keyed by their JSON
   * text, no events, only the `*` state test applies, and a logger that discards.
   * `createTestModel` replaces the keys, the events and the matcher for a machine.
   */
  public getDefaultOptions(): TestModelOptions<TSnapshot, TEvent, TInput> {
    return {
      serializeState: (state) => simpleStringify(state),
      serializeEvent: (event) => simpleStringify(event),
      // For non-state-machine test models, we cannot identify separate transitions, so just
      // use event type
      serializeTransition: (state, event) => `${simpleStringify(state)}|${event?.type}`,
      events: [],
      stateMatcher: (_, stateKey) => stateKey === "*",
      // Upstream logs to the console; the test model itself never logs
      logger: {
        log: Function.constVoid,
        error: Function.constVoid,
      },
    }
  }

  /**
   * Builds the model synchronously: it runs no user code, so nothing can fail here. The logic
   * runs only when a path query or `getAdjacencyMap` runs.
   */
  constructor(
    public testLogic: ActorLogic<TSnapshot, TEvent, TInput>,
    options?: Partial<TestModelOptions<TSnapshot, TEvent, TInput>>
  ) {
    this.options = {
      ...this.getDefaultOptions(),
      ...options,
    }
  }

  /**
   * The test paths a path generator gives, deduplicated unless `allowDuplicatePaths` (a path
   * whose events start the events of a longer path is left out).
   */
  public getPaths(
    pathGenerator: PathGenerator<TSnapshot, TEvent, TInput>,
    options?: GetPathOptions<TSnapshot, TEvent, TInput>
  ): Effect.Effect<Array<TestPath<TSnapshot, TEvent>>, TraversalError> {
    const allowDuplicatePaths = options?.allowDuplicatePaths ?? false
    return Effect.map(pathGenerator(this.testLogic, this._resolveOptions(options)), (paths) =>
      (allowDuplicatePaths ? paths : deduplicatePaths(paths)).map(this._toTestPath)
    )
  }

  /** The test paths of the shortest paths ({@link getShortestPaths}). */
  public getShortestPaths(
    options?: GetPathOptions<TSnapshot, TEvent, TInput>
  ): Effect.Effect<Array<TestPath<TSnapshot, TEvent>>, TraversalError> {
    return this.getPaths(createShortestPathsGen(), options)
  }

  /** Each given path joined with each shortest path from its end state. */
  public getShortestPathsFrom(
    paths: Array<TestPath<TSnapshot, TEvent>>,
    options?: GetPathOptions<TSnapshot, TEvent, TInput>
  ): Effect.Effect<Array<TestPath<TSnapshot, TEvent>>, TraversalError | JoinPathsError> {
    return pathsFrom(paths, (fromState) => this.getShortestPaths({ ...options, fromState }), this._toTestPath)
  }

  /** The test paths of the simple paths ({@link getSimplePaths}). */
  public getSimplePaths(
    options?: GetPathOptions<TSnapshot, TEvent, TInput>
  ): Effect.Effect<Array<TestPath<TSnapshot, TEvent>>, TraversalError> {
    return this.getPaths(createSimplePathsGen(), options)
  }

  /** Each given path joined with each simple path from its end state. */
  public getSimplePathsFrom(
    paths: Array<TestPath<TSnapshot, TEvent>>,
    options?: GetPathOptions<TSnapshot, TEvent, TInput>
  ): Effect.Effect<Array<TestPath<TSnapshot, TEvent>>, TraversalError | JoinPathsError> {
    return pathsFrom(paths, (fromState) => this.getSimplePaths({ ...options, fromState }), this._toTestPath)
  }

  /** The test path of a path: its description and its test. */
  private readonly _toTestPath = (statePath: StatePath<TSnapshot, TEvent>): TestPath<TSnapshot, TEvent> => {
    const eventsString = statePath.steps.map((s) => formatEvent(s.event)).join(" → ")
    return {
      ...statePath,
      test: (params: TestParam<TSnapshot, TEvent>) => this.testPath(statePath, params),
      description: isMachineSnapshot(statePath.state)
        ? `Reaches ${getDescription(statePath.state).trim()}: ${eventsString}`
        : simpleStringify(statePath.state),
    }
  }

  /**
   * The test path of an event sequence ({@link getPathsFromEvents}). Unlike the other path
   * queries it uses the given options only, not the model's (as upstream), so a machine's
   * states are keyed by the defaults of {@link getPathsFromEvents}, without a transition part.
   */
  public getPathsFromEvents(
    events: Array<TEvent>,
    options?: GetPathOptions<TSnapshot, TEvent, TInput>
  ): Effect.Effect<Array<TestPath<TSnapshot, TEvent>>, TraversalError | InvalidEventSequenceError> {
    return Effect.map(getPathsFromEvents(this.testLogic, events, options), (paths) => paths.map(this._toTestPath))
  }

  /**
   * An array of adjacencies, which are objects that represent each `state` with the
   * `nextState` given the `event`.
   */
  public getAdjacencyMap(): Effect.Effect<AdjacencyMap<TSnapshot, TEvent>, TraversalError> {
    return getAdjacencyMap(this.testLogic, this.options)
  }

  /**
   * Runs each step of the path: the executor of its event, then the state tests of its state.
   * Fails with what the first failing executor or state test failed with, its message
   * followed by the path trace.
   */
  public testPath(
    path: StatePath<TSnapshot, TEvent>,
    params: TestParam<TSnapshot, TEvent>,
    options?: Partial<TestModelOptions<TSnapshot, TEvent, TInput>>
  ): Effect.Effect<TestPathResult<TSnapshot, TEvent>, unknown> {
    return testPathOf(this, path, params, options)
  }

  /** Runs the state tests whose keys match the state (the `*` test when none does). */
  public testState(
    params: TestParam<TSnapshot, TEvent>,
    state: TSnapshot,
    options?: Partial<TestModelOptions<TSnapshot, TEvent, TInput>>
  ): Effect.Effect<void, unknown> {
    const resolvedOptions = this._resolveOptions(options)
    return Effect.flatMap(this._getStateTestKeys(params, state, resolvedOptions), (stateTestKeys) =>
      Effect.forEach(
        stateTestKeys,
        (stateTestKey) => {
          const stateTest = params.states?.[stateTestKey]
          return stateTest ? runCallback(() => stateTest(state)) : Effect.void
        },
        { discard: true }
      )
    )
  }

  /**
   * The keys of the state tests that apply to `state`, in the key order of `params.states`:
   * those `stateMatcher` accepts, else `*` when the params have it. Fails with what a matcher
   * throws or its Effect fails with.
   */
  private _getStateTestKeys(
    params: TestParam<TSnapshot, TEvent>,
    state: TSnapshot,
    resolvedOptions: TestModelOptions<TSnapshot, TEvent, TInput>
  ): Effect.Effect<Array<string>, unknown> {
    const states = params.states ?? {}
    return Effect.map(
      Effect.filter(Object.keys(states), (stateKey) =>
        runMatcher(() => resolvedOptions.stateMatcher(state, stateKey))
      ),
      (stateTestKeys) =>
        // Fallthrough state tests
        !stateTestKeys.length && "*" in states ? [...stateTestKeys, "*"] : stateTestKeys
    )
  }

  /** The executor of the step's event type in `params.events`; undefined when there is none. */
  private _getEventExec(
    params: TestParam<TSnapshot, TEvent>,
    step: Step<TSnapshot, TEvent>
  ): EventExecutor<TSnapshot, TEvent> | undefined {
    // Upstream: the executor of each event type takes the steps of that type's events
    const events = (params.events ?? {}) as Partial<Record<string, EventExecutor<TSnapshot, TEvent>>>
    return events[step.event.type]
  }

  /** Runs the executor of the step's event, if the params have one. */
  public testTransition(params: TestParam<TSnapshot, TEvent>, step: Step<TSnapshot, TEvent>): Effect.Effect<void, unknown> {
    const eventExec = this._getEventExec(params, step)
    return eventExec ? runCallback(() => eventExec(step)) : Effect.void
  }

  /**
   * The options of one call: `defaultTraversalOptions`, then the model's `options`, then the
   * call's options, each later one winning key by key.
   */
  private _resolveOptions(
    options?: Partial<TestModelOptions<TSnapshot, TEvent, TInput>>
  ): TestModelOptions<TSnapshot, TEvent, TInput> {
    return { ...this.defaultTraversalOptions, ...this.options, ...options }
  }
}

/** Each path joined with each path `getPaths` gives from its end state, as test paths. */
const pathsFrom = <TSnapshot extends Snapshot, TEvent extends EventObject, E>(
  paths: Array<TestPath<TSnapshot, TEvent>>,
  getPaths: (fromState: TSnapshot) => Effect.Effect<Array<TestPath<TSnapshot, TEvent>>, E>,
  toTestPath: (statePath: StatePath<TSnapshot, TEvent>) => TestPath<TSnapshot, TEvent>
): Effect.Effect<Array<TestPath<TSnapshot, TEvent>>, E | JoinPathsError> =>
  // Sequential and in order, as upstream's nested loops: each path's `getPaths`, then its joins
  Effect.map(
    Effect.forEach(paths, (path) =>
      Effect.flatMap(getPaths(path.state), (fromPaths) =>
        Effect.forEach(fromPaths, (fromPath) => Effect.map(joinPaths(path, fromPath), toTestPath))
      )
    ),
    (joinedPerPath) => joinedPerPath.flat()
  )

/** {@link TestModel.testPath}. */
const testPathOf = <TSnapshot extends Snapshot, TEvent extends EventObject, TInput>(
  model: TestModel<TSnapshot, TEvent, TInput>,
  path: StatePath<TSnapshot, TEvent>,
  params: TestParam<TSnapshot, TEvent>,
  options?: Partial<TestModelOptions<TSnapshot, TEvent, TInput>>
): Effect.Effect<TestPathResult<TSnapshot, TEvent>, unknown> =>
  Effect.gen(function* () {
    const testPathResult: TestPathResult<TSnapshot, TEvent> = {
      steps: [],
      state: {
        error: Option.none(),
      },
    }

    const testSteps = Effect.gen(function* () {
      for (const step of path.steps) {
        const testStepResult: TestStepResult<TSnapshot, TEvent> = {
          step,
          state: { error: Option.none() },
          event: { error: Option.none() },
        }

        testPathResult.steps.push(testStepResult)

        yield* Effect.tapError(model.testTransition(params, step), (err) =>
          Effect.sync(() => {
            testStepResult.event.error = Option.some(err)
          })
        )

        yield* Effect.tapError(model.testState(params, step.state, options), (err) =>
          Effect.sync(() => {
            testStepResult.state.error = Option.some(err)
          })
        )
      }
    })

    // Upstream: TODO: make option
    yield* Effect.catch(testSteps, (err) =>
      appendTrace(err, formatPathTestResult(path, testPathResult, model.options))
    )

    return testPathResult
  })

/**
 * Whether two state values are equal by structure: the same string, or objects with the same
 * keys whose values are equal in turn. Key order does not matter.
 */
function stateValuesEqual(a: StateValue | undefined, b: StateValue | undefined): boolean {
  if (a === b) {
    return true
  }

  if (a === undefined || b === undefined) {
    return false
  }

  if (typeof a === "string" || typeof b === "string") {
    return a === b
  }

  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)

  return aKeys.length === bKeys.length && aKeys.every((key) => stateValuesEqual(a[key], b[key]))
}

/** The state value of a machine snapshot; none for another snapshot. */
const valueOf = (snapshot: Snapshot | undefined): StateValue | undefined =>
  isMachineSnapshot(snapshot) ? snapshot.value : Function.constUndefined()

/**
 * The transition part of a machine test model's state key: ` via <event>` and ` from
 * <previous value>`, or nothing at the start and when the value did not change.
 */
function serializeMachineTransition<TEvent extends EventObject>(
  snapshot: Snapshot,
  event: TEvent | undefined,
  previousSnapshot: Snapshot | undefined,
  { serializeEvent }: { serializeEvent: (event: TEvent) => string }
): string {
  // Upstream: TODO: the stateValuesEqual check here is very likely not exactly correct but
  // I'm not sure what the correct check is and what this is trying to do
  if (!event || (previousSnapshot && stateValuesEqual(valueOf(previousSnapshot), valueOf(snapshot)))) {
    return ""
  }

  const prevStateString = previousSnapshot ? ` from ${simpleStringify(valueOf(previousSnapshot))}` : ""

  return ` via ${serializeEvent(event)}${prevStateString}`
}

/** The snapshot type of a machine, the snapshot type of its test model. */
type MachineSnapshotOf<TMachine> = ActorLogic.SnapshotOf<TMachine>
/** The event type of a machine, the event type of its test model. */
type MachineEventOf<TMachine> = ActorLogic.EventOf<TMachine>
/**
 * The input type of a machine, which types the options `createTestModel` takes; the model it
 * returns takes any input (`unknown`).
 */
type MachineInputOf<TMachine> = ActorLogic.InputOf<TMachine>

/**
 * Creates a test model that represents an abstract model of a system under test (SUT).
 *
 * The test model is used to generate test paths, which are used to verify that states in the
 * `machine` are reachable in the SUT. Its states are keyed by value, context and the
 * transition that reached them; a state test key is a state value (`"b.b1"`), a state node
 * id (`"#id"`) or `"*"` (states no other key matches); its events are those each state takes,
 * each as given in `events` when that names its type, else `{ type }`. Fails with the
 * upstream message for a machine with an invocation, an `after` transition or a delayed
 * inline action.
 *
 * @example
 * ```ts
 * const model = yield* createTestModel(toggleMachine)
 * for (const path of yield* model.getShortestPaths()) {
 *   yield* path.test({ events: { TOGGLE: () => page.click("input") } })
 * }
 * ```
 *
 * @since 0.1.0
 * @category Test model
 */
export const createTestModel = <TMachine extends AnyStateMachine>(
  machine: TMachine,
  options?: Partial<TestModelOptions<MachineSnapshotOf<TMachine>, MachineEventOf<TMachine>, MachineInputOf<TMachine>>>
): Effect.Effect<TestModel<MachineSnapshotOf<TMachine>, MachineEventOf<TMachine>, unknown>, UnsupportedTestMachineError> =>
  Effect.gen(function* () {
    yield* validateMachine(machine)

    const serializeEvent = options?.serializeEvent ?? simpleStringify
    const serializeTransition =
      options?.serializeTransition ??
      ((
        state: MachineSnapshotOf<TMachine>,
        event: MachineEventOf<TMachine> | undefined,
        prevState?: MachineSnapshotOf<TMachine>
      ) => serializeMachineTransition(state, event, prevState, { serializeEvent }))
    const { events: getEvents, ...otherOptions } = options ?? {}

    // Upstream: the machine is the test logic, whatever its input type
    const testLogic = machine as unknown as ActorLogic<MachineSnapshotOf<TMachine>, MachineEventOf<TMachine>, unknown>

    return new TestModel<MachineSnapshotOf<TMachine>, MachineEventOf<TMachine>, unknown>(testLogic, {
      serializeState: (state, event, prevState) =>
        // Only consider the `state` if `serializeTransition()` is opted out (empty string)
        `${serializeSnapshot(state)}${serializeTransition(state, event, prevState)}` as SerializedSnapshot,
      stateMatcher: (state, key) => {
        if (!isMachineSnapshot(state)) {
          return false
        }
        if (key.startsWith("#")) {
          return isStateMachine(machine)
            ? Effect.map(machine.getStateNodeById(key), (stateNode) => state._nodes.includes(stateNode))
            : false
        }
        return state.matches(key)
      },
      events: (state) => {
        const events = typeof getEvents === "function" ? getEvents(state) : (getEvents ?? [])
        const eventTypes = isMachineSnapshot(state) ? getAllOwnEventDescriptors(state) : []

        return eventTypes.flatMap((eventType) => {
          if (events.some((e) => e.type === eventType)) {
            return events.filter((e) => e.type === eventType)
          }

          // Upstream: TODO: fix types
          return [{ type: eventType } as MachineEventOf<TMachine>]
        })
      },
      ...otherOptions,
    })
  })
