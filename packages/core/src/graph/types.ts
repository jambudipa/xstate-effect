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

type JSONSerializable<T extends object, U> = T & {
  toJSON: () => U
}

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
 * `meta` is upstream's `any` (SD-22 amendment, goal journal
 * `2026-10-07-13-node-containers-any.md`).
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

type ExtractEvent<TEvent extends EventObject, TType extends TEvent["type"]> = TEvent extends { type: TType }
  ? TEvent
  : never

/**
 * The vertices and edges a depth-first traversal has visited.
 *
 * @since 0.1.0
 * @category Models
 */
export interface VisitedContext<TState, TEvent> {
  vertices: Set<SerializedSnapshot>
  edges: Set<SerializedEvent>
  a?: TState | TEvent
}

/**
 * How a traversal turns states and events into keys.
 *
 * @since 0.1.0
 * @category Models
 */
export interface SerializationConfig<TSnapshot extends Snapshot, TEvent extends EventObject> {
  serializeState: (state: TSnapshot, event: TEvent | undefined, prevState?: TSnapshot) => string
  serializeEvent: (event: TEvent) => string
}

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
  fromState?: TSnapshot | undefined
  /** When true, traversal of the adjacency map will stop for that current state. */
  stopWhen?: ((state: TSnapshot) => boolean) | undefined
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
 * The test meta of a state node.
 *
 * @since 0.1.0
 * @category Models
 */
export interface TestMeta<T, TContext> {
  test?: (testContext: T, state: MachineSnapshot<TContext>) => void | Effect.Effect<unknown, unknown>
  description?: string | ((state: MachineSnapshot<TContext>) => string)
  skip?: boolean
}

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
  step: Step<TSnapshot, TEvent>
  state: TestStateResult
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
  states?: {
    [key: string]: (state: TSnapshot) => void | Effect.Effect<unknown, unknown>
  }
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
  steps: Array<TestStepResult<TSnapshot, TEvent>>
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
  logger: {
    log: (msg: string) => void
    error: (msg: string) => void
  }
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
  state: TState
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
