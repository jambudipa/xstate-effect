/**
 * @since 0.1.0
 * @module graph/graph
 *
 * State node walks, snapshot serialization, traversal options and path joins of the graph
 * entry point (upstream `src/graph/graph.ts` at xstate@5.33.2). The functions that read a
 * logic's initial snapshot return Effects (SD-13); `getStateNodes` and `toDirectedGraph` walk
 * the state node tree only and stay synchronous.
 */
import { Effect, Predicate } from "effect"
import type { ActorLogic, ActorScope } from "../ActorLogic.js"
import type { InitializationError } from "../Errors.js"
import type { EventObject } from "../Event.js"
import { isMachineSnapshot, type Snapshot } from "../Snapshot.js"
import { type AnyStateMachine, isStateMachine, StateMachineTypeId } from "../StateMachine.js"
import { type AnyStateNode, isStateNode } from "../StateNode.js"
import type { TransitionDefinition } from "../Types.js"
import { JoinPathsError } from "./errors.js"
import type {
  DirectedGraphEdge,
  DirectedGraphNode,
  SerializedEvent,
  SerializedSnapshot,
  StatePath,
  TraversalConfig,
  TraversalOptions,
} from "./types.js"
import { getAllOwnEventDescriptors, simpleStringify } from "./utils.js"

/**
 * Any actor logic of the given snapshot, event and input types, whatever events it emits and
 * whatever services it needs (`R`). A state machine is one.
 *
 * @since 0.1.0
 * @category Models
 */
export type TraversableLogic<TSnapshot extends Snapshot, TEvent extends EventObject, TInput, R = never> =
  ActorLogic<TSnapshot, TEvent, TInput, EventObject, R>

/**
 * Whether a logic is a machine (upstream `isMachineLogic`). It narrows nothing, so the
 * logic keeps its snapshot, event and input types.
 *
 * @since 0.1.0
 * @category Internal
 */
export const isMachineLogic = (logic: unknown): boolean => isStateMachine(logic)

/** Whether a node or machine is a machine (upstream `stateMachine instanceof StateMachine`). */
const isMachine = (node: AnyStateNode | AnyStateMachine): node is AnyStateMachine =>
  Predicate.hasProperty(node, StateMachineTypeId)

/** The child state nodes of a node, in document order. */
const getChildren = (stateNode: AnyStateNode): Array<AnyStateNode> => Object.values(stateNode.states)

/** The transitions of a node, in declaration order (every node of a machine has them). */
const getTransitions = (stateNode: AnyStateNode): Array<TransitionDefinition<unknown, EventObject>> =>
  isStateNode(stateNode) ? stateNode.transitions.flatMap(([, transitions]) => transitions) : []

/**
 * Returns all state nodes of the given node or machine, below it, in document order.
 *
 * @example
 * ```ts
 * getStateNodes(machine).map((node) => node.id) // ["light.green", "light.yellow", ...]
 * ```
 *
 * @since 0.1.0
 * @category Graph
 */
export const getStateNodes = (stateNode: AnyStateNode | AnyStateMachine): Array<AnyStateNode> => {
  const { states } = isMachine(stateNode) ? stateNode.root : stateNode
  return Object.values(states).flatMap((childStateNode) => [childStateNode, ...getStateNodes(childStateNode)])
}

/**
 * The key of a machine snapshot in a traversal: its value, and its context when that has
 * keys, as JSON.
 *
 * @since 0.1.0
 * @category Graph
 */
export const serializeSnapshot = (snapshot: Snapshot): SerializedSnapshot => {
  const context: unknown = Predicate.hasProperty(snapshot, "context") ? snapshot.context : {}
  return simpleStringify({
    ...(Predicate.hasProperty(snapshot, "value") ? { value: snapshot.value } : {}),
    ...(Predicate.isNotNullish(context) && Object.keys(context).length > 0 ? { context } : {}),
  }) as SerializedSnapshot
}

const serializeEvent = <TEvent extends EventObject>(event: TEvent): SerializedEvent =>
  simpleStringify(event) as SerializedEvent

/**
 * The default traversal options of a machine: snapshots keyed by value and context, the
 * events each snapshot takes (a given event of that type, else `{ type }`), and the initial
 * snapshot for the given input as the start.
 *
 * @since 0.1.0
 * @category Graph
 */
export const createDefaultMachineOptions = <TSnapshot extends Snapshot, TEvent extends EventObject, TInput, R>(
  machine: TraversableLogic<TSnapshot, TEvent, TInput, R>,
  options?: TraversalOptions<TSnapshot, TEvent, TInput>
): Effect.Effect<TraversalOptions<TSnapshot, TEvent, TInput>, InitializationError, ActorScope | R> =>
  Effect.gen(function* () {
    const { events: getEvents, ...otherOptions } = options ?? {}
    // Upstream passes the input as given (`undefined` when there is none)
    const fromState = yield* machine.getInitialSnapshot(options?.input as TInput)
    const traversalOptions: TraversalOptions<TSnapshot, TEvent, TInput> = {
      serializeState: serializeSnapshot,
      serializeEvent,
      events: (state) => {
        const events = typeof getEvents === "function" ? getEvents(state) : (getEvents ?? [])
        const types = isMachineSnapshot(state) ? getAllOwnEventDescriptors(state) : []
        return types.flatMap((type) => {
          const matchingEvents = events.filter((event) => event.type === type)
          if (matchingEvents.length) {
            return matchingEvents
          }
          return [{ type } as TEvent]
        })
      },
      fromState,
      ...otherOptions,
    }

    return traversalOptions
  })

/**
 * The default traversal options of a logic that is not a machine: snapshots and events keyed
 * by their JSON text.
 *
 * @since 0.1.0
 * @category Graph
 */
export const createDefaultLogicOptions = <
  TSnapshot extends Snapshot,
  TEvent extends EventObject,
  TInput
>(): TraversalOptions<TSnapshot, TEvent, TInput> => ({
  serializeState: (state) => simpleStringify(state),
  serializeEvent,
})

/**
 * The directed graph of a machine or state node: each node with its children and the edges
 * of its transitions (one edge per target; a targetless transition is an edge to the node
 * itself). The JSON form holds ids and labels.
 *
 * @example
 * ```ts
 * JSON.stringify(toDirectedGraph(machine)) // {"id":"light","children":[...],"edges":[...]}
 * ```
 *
 * @since 0.1.0
 * @category Graph
 */
export const toDirectedGraph = (stateMachine: AnyStateNode | AnyStateMachine): DirectedGraphNode => {
  const stateNode = isMachine(stateMachine) ? stateMachine.root : stateMachine

  const edges: Array<DirectedGraphEdge> = getTransitions(stateNode).flatMap((t, transitionIndex) => {
    const targets: ReadonlyArray<AnyStateNode> = t.target ?? [stateNode]

    return targets.map((target, targetIndex) => {
      const edge: DirectedGraphEdge = {
        id: `${stateNode.id}:${transitionIndex}:${targetIndex}`,
        source: stateNode,
        target,
        transition: t,
        label: {
          text: t.eventType,
          toJSON: () => ({ text: t.eventType }),
        },
        toJSON: () => {
          const { label } = edge

          return { source: stateNode.id, target: target.id, label }
        },
      }

      return edge
    })
  })

  const graph: DirectedGraphNode = {
    id: stateNode.id,
    stateNode,
    children: getChildren(stateNode).map(toDirectedGraph),
    edges,
    toJSON: (): { id: string; children: Array<DirectedGraphNode>; edges: Array<DirectedGraphEdge> } => {
      const { id, children, edges: graphEdges } = graph
      return { id, children, edges: graphEdges }
    },
  }

  return graph
}

/**
 * The resolved options of a traversal: the given options over the defaults (a machine's
 * default options unless `defaultOptions` is given), with no filter, no limit, and the
 * `toState` predicate as the stop condition unless they say otherwise.
 *
 * @since 0.1.0
 * @category Graph
 */
export const resolveTraversalOptions = <TSnapshot extends Snapshot, TEvent extends EventObject, TInput, R>(
  logic: TraversableLogic<TSnapshot, TEvent, TInput, R>,
  traversalOptions?: TraversalOptions<TSnapshot, TEvent, TInput>,
  defaultOptions?: TraversalOptions<TSnapshot, TEvent, TInput>
): Effect.Effect<TraversalConfig<TSnapshot, TEvent>, InitializationError, ActorScope | R> =>
  Effect.gen(function* () {
    const resolvedDefaultOptions: TraversalOptions<TSnapshot, TEvent, TInput> =
      defaultOptions ?? (isMachineLogic(logic) ? yield* createDefaultMachineOptions(logic, traversalOptions) : {})
    const serializeState =
      traversalOptions?.serializeState ??
      resolvedDefaultOptions.serializeState ??
      ((state: TSnapshot) => simpleStringify(state))
    const traversalConfig: TraversalConfig<TSnapshot, TEvent> = {
      serializeState,
      serializeEvent,
      events: [],
      limit: Infinity,
      // Traversal should not continue past the `toState` predicate since the target state
      // has already been reached at that point
      stopWhen: traversalOptions?.toState,
      ...resolvedDefaultOptions,
      ...traversalOptions,
    }

    return traversalConfig
  })

/**
 * Joins two paths, the tail starting where the head ends: `[A, B, C] + [C, D, E]` gives
 * `[A, B, C, D, E]`. Fails with `Paths cannot be joined` when the first state of the tail is
 * not the head's end state (the same object).
 *
 * @since 0.1.0
 * @category Graph
 */
export const joinPaths = <TSnapshot extends Snapshot, TEvent extends EventObject>(
  headPath: StatePath<TSnapshot, TEvent>,
  tailPath: StatePath<TSnapshot, TEvent>
): Effect.Effect<StatePath<TSnapshot, TEvent>, JoinPathsError> =>
  Effect.suspend(() => {
    const secondPathSource = tailPath.steps[0]?.state

    if (secondPathSource !== headPath.state) {
      return Effect.fail(new JoinPathsError({ message: "Paths cannot be joined" }))
    }

    return Effect.succeed({
      state: tailPath.state,
      // e.g. [A, B, C] + [C, D, E] = [A, B, C, D, E]
      steps: headPath.steps.concat(tailPath.steps.slice(1)),
      weight: headPath.weight + tailPath.weight,
    })
  })
