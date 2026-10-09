/**
 * @since 0.1.0
 * @module graph/types
 *
 * The types of the graph entry point (upstream `src/graph/types.ts` at xstate@5.33.2). The
 * port keeps the upstream names and shapes, with these changes: the functions that run user
 * code return Effects (SD-13), so `filterEvents`, event executors, state tests and
 * `stateMatcher` may return an Effect, a path test is an Effect, and a path generator returns
 * an Effect; the error of a test result is an `Option` of what failed (upstream `null | Error`).
 */
import type { Effect, Option } from "effect"
import type { ActorLogic } from "../ActorLogic.js"
import type { GuardError, InitializationError, TransitionError } from "../Errors.js"
import type { EventObject } from "../Event.js"
import type { UpstreamAny } from "../internal/anyEventObject.js"
import type { MachineSnapshot, Snapshot } from "../Snapshot.js"
import type { AnyStateNode } from "../StateNode.js"
import type { TransitionDefinition } from "../Types.js"
import type { TraversalLimitError } from "./errors.js"

/**
 * Any state node (upstream `AnyStateNode`, re-exported by the graph entry point).
 *
 * @since 0.1.0
 * @category Models
 */
export type { AnyStateNode }

/**
 * `T` with a `toJSON` that gives `U`, so `JSON.stringify` writes `U` in place of `T`. The
 * directed graph types use it to drop the state node and transition objects, which refer
 * back to their machine and do not serialize.
 */
type JSONSerializable<T extends object, U> = T & {
  toJSON: () => U
}

/** The label of a directed graph edge: the event type of its transition, as `text`. */
type DirectedGraphLabel = JSONSerializable<
  {
    text: string
  },
  {
    text: string
  }
>

/**
 * An edge of a directed graph: one target of one transition of a state node. The transition
 * is upstream's `AnyTransitionDefinition` (`TransitionDefinition<any, any, any>`), so its
 * `meta` is upstream's `any` (SD-22 amendment, see docs/decisions.md).
 *
 * @since 0.1.0
 * @category Models
 */
export type DirectedGraphEdge = JSONSerializable<
  {
    id: string
    source: AnyStateNode
    target: AnyStateNode
    label: DirectedGraphLabel
    transition: TransitionDefinition<UpstreamAny, UpstreamAny, UpstreamAny>
  },
  {
    source: string
    target: string
    label: ReturnType<DirectedGraphLabel["toJSON"]>
  }
>

/**
 * A node of a directed graph: a state node, its child nodes and the edges of its
 * transitions (based on the ELK JSON graph format).
 *
 * @since 0.1.0
 * @category Models
 */
export type DirectedGraphNode = JSONSerializable<
  {
    id: string
    stateNode: AnyStateNode
    children: Array<DirectedGraphNode>
    /** The edges representing all transitions from this `stateNode`. */
    edges: Array<DirectedGraphEdge>
  },
  {
    id: string
    children: Array<DirectedGraphNode>
  }
>

/**
 * One entry of a {@link StatePlanMap}: a state and the paths known to reach it. The shortest
 * path walk keeps exactly one path per state and extends it to build the paths of the states
 * reached from there.
 */
interface StatePlan<TSnapshot extends Snapshot, TEvent extends EventObject> {
  /** The target state. */
  state: TSnapshot
  /** The paths that reach the target state. */
  paths: Array<StatePath<TSnapshot, TEvent>>
}

/**
 * A path to a state: the steps that reach it and their combined weight.
 *
 * @since 0.1.0
 * @category Models
 */
export interface StatePath<TSnapshot extends Snapshot, TEvent extends EventObject> {
  /** The ending state of the path. */
  state: TSnapshot
  /** The ordered array of state-event pairs (steps) which reach the ending `state`. */
  steps: Steps<TSnapshot, TEvent>
  /** The combined weight of all steps in the path. */
  weight: number
}

/**
 * The plans of a traversal, keyed by serialized state.
 *
 * @since 0.1.0
 * @category Models
 */
export interface StatePlanMap<TSnapshot extends Snapshot, TEvent extends EventObject> {
  [key: string]: StatePlan<TSnapshot, TEvent>
}

/**
 * One step of a path: the event and the state it led to.
 *
 * @since 0.1.0
 * @category Models
 */
export interface Step<TSnapshot extends Snapshot, TEvent extends EventObject> {
  /** The event that resulted in the current state */
  event: TEvent
  /** The current state after taking the event. */
  state: TSnapshot
}

/**
 * The steps of a path.
 *
 * @since 0.1.0
 * @category Models
 */
export type Steps<TSnapshot extends Snapshot, TEvent extends EventObject> = Array<Step<TSnapshot, TEvent>>

/**
 * The members of the event union `TEvent` whose `type` is `TType`, so that the executor of
 * one event type in {@link TestParam} gets that event's type. It matches the exact type only,
 * unlike the root `ExtractEvent` of `Event.ts`, which also takes wildcard descriptors.
 */
type ExtractEvent<TEvent extends EventObject, TType extends TEvent["type"]> = TEvent extends { type: TType }
  ? TEvent
  : never

/**
 * The vertices and edges a depth-first traversal has visited (upstream's simple path walk
 * state). The port exports it for type parity with upstream only: its simple path walk keeps
 * the states on the current path in a `HashSet` and no code of this package builds a
 * `VisitedContext`.
 *
 * @since 0.1.0
 * @category Models
 */
export interface VisitedContext<TState, TEvent> {
  /** The keys of the states on the current path; a state in it is not entered again. */
  vertices: Set<SerializedSnapshot>
  /** The keys of the events taken; upstream writes them and never reads them. */
  edges: Set<SerializedEvent>
  /** Unused; upstream marks it `TODO: remove`. */
  a?: TState | TEvent
}

/**
 * How a traversal turns states and events into keys.
 *
 * @since 0.1.0
 * @category Models
 */
export interface SerializationConfig<TSnapshot extends Snapshot, TEvent extends EventObject> {
  /**
   * The key of a state. `event` is the event that led to it and `prevState` the state it
   * came from; both are `undefined` for the start state. Two states with the same key are one
   * state to the traversal, which visits it once, so a key that leaves out a field merges the
   * states that differ only in that field.
   */
  serializeState: (state: TSnapshot, event: TEvent | undefined, prevState?: TSnapshot) => string
  /**
   * The key of an event. Two events of one state with the same key are one transition in the
   * adjacency map: the later one replaces the earlier.
   */
  serializeEvent: (event: TEvent) => string
}

/** The keys a caller may give in the options of a traversal; each defaults to JSON text. */
type SerializationOptions<TSnapshot extends Snapshot, TEvent extends EventObject> = Partial<
  Pick<SerializationConfig<TSnapshot, TEvent>, "serializeState" | "serializeEvent">
>

/**
 * The options of a traversal.
 *
 * @since 0.1.0
 * @category Models
 */
export type TraversalOptions<TSnapshot extends Snapshot, TEvent extends EventObject, TInput> = {
  input?: TInput
} & SerializationOptions<TSnapshot, TEvent> &
  Partial<Pick<TraversalConfig<TSnapshot, TEvent>, "events" | "filterEvents" | "limit" | "fromState" | "stopWhen" | "toState">>

/**
 * The resolved options of a traversal. The optional members are upstream's `| undefined`
 * members.
 *
 * @since 0.1.0
 * @category Models
 */
export interface TraversalConfig<TSnapshot extends Snapshot, TEvent extends EventObject>
  extends SerializationConfig<TSnapshot, TEvent>
{
  /**
   * The events the traversal sends in each state, in order: a fixed list, or a function of
   * the state. Without it, a machine sends `{ type }` for each event type the state takes,
   * and any other logic sends none.
   */
  events: ReadonlyArray<TEvent> | ((state: TSnapshot) => ReadonlyArray<TEvent>)
  /**
   * Whether the traversal takes `event` in `snapshot`. It may return an Effect, so that
   * `snapshot.can(event)` (an Effect, SD-6) is a filter as it is.
   */
  filterEvents?: ((snapshot: TSnapshot, event: TEvent) => boolean | Effect.Effect<boolean, GuardError>) | undefined
  /**
   * The maximum number of traversals to perform when calculating the state transition
   * adjacency map.
   *
   * @default `Infinity`
   */
  limit: number
  /** The state the traversal starts from; without it, the logic's initial snapshot for `input`. */
  fromState?: TSnapshot | undefined
  /** When true, traversal of the adjacency map will stop for that current state. */
  stopWhen?: ((state: TSnapshot) => boolean) | undefined
  /**
   * The target states: the path functions return only the paths that end in a state for
   * which it holds. It is also the default `stopWhen`, so no path continues past a target.
   */
  toState?: ((state: TSnapshot) => boolean) | undefined
}

/**
 * How a traversal fails: the logic's initial snapshot or transition fails, a `filterEvents`
 * Effect fails, or the traversal exceeds its `limit`.
 *
 * @since 0.1.0
 * @category Models
 */
export type TraversalError = TraversalLimitError | InitializationError | TransitionError | GuardError

/**
 * `T` marked with `Tag` for the type checker only: no value has a `__tag` field, so a key
 * becomes branded through an `as` cast. It keeps state keys and event keys apart.
 */
type Brand<T, Tag extends string> = T & { __tag: Tag }

/**
 * A serialized state.
 *
 * @since 0.1.0
 * @category Models
 */
export type SerializedSnapshot = Brand<string, "state">

/**
 * A serialized event.
 *
 * @since 0.1.0
 * @category Models
 */
export type SerializedEvent = Brand<string, "event">

/**
 * The test meta of a state node: the shape a state node's `meta` may take for a test model.
 * Of its fields, only `description` is read in this package (by the path descriptions).
 *
 * @since 0.1.0
 * @category Models
 */
export interface TestMeta<T, TContext> {
  /** A test of the state with a test context. No code of this package runs it. */
  test?: (testContext: T, state: MachineSnapshot<TContext>) => void | Effect.Effect<unknown, unknown>
  /**
   * The text that names the state node in a path description (quoted there), or a function
   * of the snapshot that gives that text (not quoted). A meta without it, or with an empty
   * string, names the node by the snapshot's value as JSON.
   */
  description?: string | ((state: MachineSnapshot<TContext>) => string)
  /** Whether to skip the state's test. No code of this package reads it. */
  skip?: boolean
}

/** The outcome of the state tests of one state in a path test. */
interface TestStateResult {
  /** What the test of the state failed with; none when it passed (upstream `null | Error`). */
  error: Option.Option<unknown>
}

/**
 * The result of one step of a path test.
 *
 * @since 0.1.0
 * @category Models
 */
export interface TestStepResult<
  TSnapshot extends Snapshot = Snapshot,
  TEvent extends EventObject = EventObject
> {
  /** The step of the path that this result is for. */
  step: Step<TSnapshot, TEvent>
  /** The outcome of the state tests of the step's state. */
  state: TestStateResult
  /** The outcome of the executor of the step's event, which runs before the state tests. */
  event: {
    /** What the event executor failed with; none when it passed (upstream `null | Error`). */
    error: Option.Option<unknown>
  }
}

/**
 * What a path test runs: the state tests, by state key, and the event executors, by event
 * type. Each may return nothing or an Effect.
 *
 * @since 0.1.0
 * @category Models
 */
export interface TestParam<TSnapshot extends Snapshot, TEvent extends EventObject> {
  /**
   * The state tests, by key. The model's `stateMatcher` decides which keys apply to a state;
   * when none does, the `*` test runs. What a test throws, or what the Effect it returns
   * fails with, fails the path test.
   */
  states?: {
    [key: string]: (state: TSnapshot) => void | Effect.Effect<unknown, unknown>
  }
  /**
   * The event executors, by event type: each drives the system under test through the event
   * of a step. A step whose event type has no executor runs no executor.
   */
  events?: {
    [TEventType in TEvent["type"]]?: EventExecutor<TSnapshot, { type: ExtractEvent<TEvent, TEventType>["type"] }>
  }
}

/**
 * A path of a test model, with its description and its test.
 *
 * @since 0.1.0
 * @category Models
 */
export interface TestPath<TSnapshot extends Snapshot, TEvent extends EventObject>
  extends StatePath<TSnapshot, TEvent>
{
  /**
   * What the path reaches and how, for a test title: `Reaches <state>: <event> → <event>`
   * for a machine snapshot, the snapshot as JSON for any other logic.
   */
  description: string
  /**
   * Tests and executes each step in `steps` sequentially, and then tests the postcondition
   * that the `state` is reached. It fails with what a state test or an event executor failed
   * with, its message followed by the path.
   */
  test: (params: TestParam<TSnapshot, TEvent>) => Effect.Effect<TestPathResult<TSnapshot, TEvent>, unknown>
}

/**
 * The result of a path test.
 *
 * @since 0.1.0
 * @category Models
 */
export interface TestPathResult<
  TSnapshot extends Snapshot = Snapshot,
  TEvent extends EventObject = EventObject
> {
  /**
   * One result for each step, in path order. A failed path test returns no result: the
   * results up to the failing step go into the trace on the failure's message instead.
   */
  steps: Array<TestStepResult<TSnapshot, TEvent>>
  /**
   * The outcome of the final state. The path test never writes it, so it stays none: a
   * failure shows in `steps` and fails the test's Effect.
   */
  state: TestStateResult
}

/**
 * Executes an effect using the `testContext` and `event` that triggers the represented
 * `event`. It may return nothing or an Effect (upstream: a `Promise`).
 *
 * @since 0.1.0
 * @category Models
 */
export type EventExecutor<TSnapshot extends Snapshot, TEvent extends EventObject> = (
  step: Step<TSnapshot, TEvent>
) => void | Effect.Effect<unknown, unknown>

/**
 * The options of a test model.
 *
 * @since 0.1.0
 * @category Models
 */
export interface TestModelOptions<TSnapshot extends Snapshot, TEvent extends EventObject, TInput>
  extends TraversalOptions<TSnapshot, TEvent, TInput>
{
  /** Whether the state test of `stateKey` applies to `state`; it may return an Effect. */
  stateMatcher: (state: TSnapshot, stateKey: string) => boolean | Effect.Effect<boolean, unknown>
  /**
   * Where a test model would log. No code of this package calls it (upstream does not
   * either); the default discards every message where upstream's writes to the console.
   */
  logger: {
    log: (msg: string) => void
    error: (msg: string) => void
  }
  /**
   * The transition part of a state key. Only `createTestModel` reads it: it appends the text
   * to the machine snapshot's key, so an empty string keys states by value and context alone.
   * A `TestModel` built directly never reads it.
   */
  serializeTransition: (state: TSnapshot, event: TEvent | undefined, prevState?: TSnapshot) => string
}

/**
 * Generates the paths of a logic.
 *
 * @since 0.1.0
 * @category Models
 */
export type PathGenerator<TSnapshot extends Snapshot, TEvent extends EventObject, TInput> = (
  behavior: ActorLogic<TSnapshot, TEvent, TInput>,
  options: TraversalOptions<TSnapshot, TEvent, TInput>
) => Effect.Effect<Array<StatePath<TSnapshot, TEvent>>, TraversalError>

/**
 * A state of an adjacency map, with its transitions keyed by serialized event.
 *
 * @since 0.1.0
 * @category Models
 */
export interface AdjacencyValue<TState, TEvent> {
  /** The state, as the traversal first reached it under its key. */
  state: TState
  /**
   * Each event the state takes, keyed by `serializeEvent`, with the state it leads to. A
   * state for which `stopWhen` holds has none.
   */
  transitions: {
    [key: SerializedEvent]: {
      event: TEvent
      state: TState
    }
  }
}

/**
 * The adjacency map of a logic, keyed by serialized state.
 *
 * @since 0.1.0
 * @category Models
 */
export interface AdjacencyMap<TState, TEvent> {
  [key: SerializedSnapshot]: AdjacencyValue<TState, TEvent>
}
