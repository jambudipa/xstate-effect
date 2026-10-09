/**
 * @since 0.1.0
 * @module graph/adjacency
 *
 * The adjacency map of a logic (upstream `src/graph/adjacency.ts` at xstate@5.33.2): a
 * breadth-first traversal from the start state over the events of each state. It runs the
 * logic's transitions, so it returns an Effect (SD-13).
 */
import { Effect, Option, type Scope } from "effect"
import type { ActorScope } from "../ActorLogic.js"
import type { EventObject } from "../Event.js"
import type { Snapshot } from "../Snapshot.js"
import { withMockActorScope } from "./actorScope.js"
import { TraversalLimitError } from "./errors.js"
import { resolveTraversalOptions, type TraversableLogic } from "./graph.js"
import type {
  AdjacencyMap,
  AdjacencyValue,
  SerializedEvent,
  SerializedSnapshot,
  TraversalError,
  TraversalOptions,
} from "./types.js"

interface QueueEntry<TSnapshot, TEvent> {
  readonly nextState: TSnapshot
  readonly event: Option.Option<TEvent>
  readonly prevState: Option.Option<TSnapshot>
}

/**
 * The adjacency map, in the actor scope the caller provides.
 *
 * @since 0.1.0
 * @category Internal
 */
export const adjacencyMapIn = <TSnapshot extends Snapshot, TEvent extends EventObject, TInput, R>(
  logic: TraversableLogic<TSnapshot, TEvent, TInput, R>,
  options: TraversalOptions<TSnapshot, TEvent, TInput>
): Effect.Effect<AdjacencyMap<TSnapshot, TEvent>, TraversalError, ActorScope | R> =>
  Effect.gen(function* () {
    const {
      serializeEvent,
      serializeState,
      events: getEvents,
      filterEvents,
      limit,
      fromState: customFromState,
      stopWhen,
    } = yield* resolveTraversalOptions(logic, options)
    const fromState =
      customFromState ??
      // Upstream passes the input as given (`undefined` when there is none)
      (yield* logic.getInitialSnapshot(options.input as TInput))
    const adj: AdjacencyMap<TSnapshot, TEvent> = {}

    let iterations = 0
    const queue: Array<QueueEntry<TSnapshot, TEvent>> = [
      { nextState: fromState, event: Option.none(), prevState: Option.none() },
    ]

    for (let next = queue.shift(); next; next = queue.shift()) {
      const { nextState: state, event, prevState } = next

      if (iterations++ > limit) {
        return yield* new TraversalLimitError({ message: "Traversal limit exceeded" })
      }

      const serializedState = serializeState(
        state,
        Option.getOrUndefined(event),
        Option.getOrUndefined(prevState)
      ) as SerializedSnapshot
      if (adj[serializedState]) {
        continue
      }

      const adjValue: AdjacencyValue<TSnapshot, TEvent> = {
        state,
        transitions: {},
      }
      adj[serializedState] = adjValue

      if (stopWhen?.(state)) {
        continue
      }

      const events = typeof getEvents === "function" ? getEvents(state) : getEvents

      for (const nextEvent of events) {
        if (filterEvents) {
          const taken = filterEvents(state, nextEvent)
          if (!(typeof taken === "boolean" ? taken : yield* taken)) {
            continue
          }
        }

        const nextSnapshot = yield* logic.transition(state, nextEvent)

        adjValue.transitions[serializeEvent(nextEvent) as SerializedEvent] = {
          event: nextEvent,
          state: nextSnapshot,
        }
        queue.push({
          nextState: nextSnapshot,
          event: Option.some(nextEvent),
          prevState: Option.some(state),
        })
      }
    }

    return adj
  })

/**
 * The adjacency map of a logic: each state the traversal reaches from the start state
 * (`fromState`, else the initial snapshot for `input`), keyed by `serializeState`, with the
 * state each of its events (`events`, kept by `filterEvents`) leads to, keyed by
 * `serializeEvent`. A state for which `stopWhen` holds is not traversed further. Fails with
 * `Traversal limit exceeded` after more than `limit` states, and with what the logic or a
 * `filterEvents` Effect fails with.
 *
 * @example
 * ```ts
 * const adjacency = yield* getAdjacencyMap(machine, { events: [{ type: "TOGGLE" }] })
 * ```
 *
 * @since 0.1.0
 * @category Graph
 */
export const getAdjacencyMap = <TSnapshot extends Snapshot, TEvent extends EventObject, TInput, R = never>(
  logic: TraversableLogic<TSnapshot, TEvent, TInput, R>,
  options: TraversalOptions<TSnapshot, TEvent, TInput>
): Effect.Effect<AdjacencyMap<TSnapshot, TEvent>, TraversalError, Exclude<Exclude<R, ActorScope>, Scope.Scope>> =>
  withMockActorScope(adjacencyMapIn(logic, options))

/**
 * The transitions of an adjacency map as a list: each state with each event it takes and
 * the state that event leads to.
 *
 * @example
 * ```ts
 * adjacencyMapToArray(yield* model.getAdjacencyMap()).map(({ state, event, nextState }) => ...)
 * ```
 *
 * @since 0.1.0
 * @category Graph
 */
export const adjacencyMapToArray = <TSnapshot, TEvent>(
  adjMap: AdjacencyMap<TSnapshot, TEvent>
): Array<{
  state: TSnapshot
  event: TEvent
  nextState: TSnapshot
}> =>
  // The keys are branded strings, which `Object.values` does not read as an index signature
  (Object.values(adjMap) as Array<AdjacencyValue<TSnapshot, TEvent>>).flatMap((adjValue) =>
    Object.values(adjValue.transitions).map((transition) => ({
      state: adjValue.state,
      event: transition.event,
      nextState: transition.state,
    }))
  )
