/**
 * @since 0.1.0
 * @module graph/shortestPaths
 *
 * Shortest paths (upstream `src/graph/shortestPaths.ts` at xstate@5.33.2): a Dijkstra walk of
 * the adjacency map, with each transition of weight 1. It runs the logic's transitions, so it
 * returns an Effect (SD-13).
 */
import { Chunk, Effect, Function, MutableHashMap, Option, type Scope } from "effect"
import type { ActorScope } from "../ActorLogic.js"
import type { EventObject } from "../Event.js"
import type { Snapshot } from "../Snapshot.js"
import { adjacencyMapIn } from "./adjacency.js"
import { withMockActorScope } from "./actorScope.js"
import { alterPath } from "./alterPath.js"
import { resolveTraversalOptions, type TraversableLogic } from "./graph.js"
import type {
  SerializedEvent,
  SerializedSnapshot,
  StatePath,
  StatePlanMap,
  Steps,
  TraversalError,
  TraversalOptions,
} from "./types.js"

/** The shortest known path to one state: its length and the step it ends with. */
interface Weight<TEvent> {
  /** The number of transitions on the shortest known path from the start state. */
  readonly weight: number
  /**
   * The state the shortest known path comes from, and the event it takes there; none for the
   * start state (upstream `state: undefined, event: undefined`).
   */
  readonly from: Option.Option<{ readonly state: SerializedSnapshot; readonly event: TEvent }>
}

/**
 * The shortest paths, in the actor scope the caller provides.
 *
 * @since 0.1.0
 * @category Internal
 */
export const shortestPathsIn = <TSnapshot extends Snapshot, TEvent extends EventObject, TInput, R>(
  logic: TraversableLogic<TSnapshot, TEvent, TInput, R>,
  options?: TraversalOptions<TSnapshot, TEvent, TInput>
): Effect.Effect<Array<StatePath<TSnapshot, TEvent>>, TraversalError, ActorScope | R> =>
  Effect.gen(function* () {
    const resolvedOptions = yield* resolveTraversalOptions(logic, options)
    const serializeState = resolvedOptions.serializeState as (
      ...args: Parameters<typeof resolvedOptions.serializeState>
    ) => SerializedSnapshot
    const fromState =
      resolvedOptions.fromState ??
      // Upstream passes the input as given (`undefined` when there is none)
      (yield* logic.getInitialSnapshot(options?.input as TInput))
    const adjacency = yield* adjacencyMapIn(logic, resolvedOptions)

    // weight, state, event. Upstream keeps both as native Maps; here they are MutableHashMaps
    // read by key only, so their iteration order never shows.
    const weightMap = MutableHashMap.empty<SerializedSnapshot, Weight<TEvent>>()
    const stateMap = MutableHashMap.empty<SerializedSnapshot, TSnapshot>()
    const serializedFromState = serializeState(fromState, Function.constUndefined(), Function.constUndefined())
    MutableHashMap.set(stateMap, serializedFromState, fromState)

    MutableHashMap.set(weightMap, serializedFromState, {
      weight: 0,
      from: Option.none(),
    })

    // Upstream walks a native `unvisited` Set while it grows, with a `visited` Set beside it. A
    // state joins that Set once, when the walk first reaches it, which is exactly when it has no
    // weight yet; the walk takes the states in that order, which is also the weight map's order.
    // So `visit` reports the states it reaches first, and the walk takes them one generation
    // (the states first reached from the previous generation) at a time, in the same order.
    const visit = (serializedState: SerializedSnapshot): ReadonlyArray<SerializedSnapshot> => {
      const prevState = Option.getOrUndefined(MutableHashMap.get(stateMap, serializedState))
      const { weight } = Option.getOrUndefined(MutableHashMap.get(weightMap, serializedState))!
      const { transitions } = adjacency[serializedState]!
      return (Object.keys(transitions) as Array<SerializedEvent>).flatMap((event) => {
        const { state: nextState, event: eventObject } = transitions[event]!
        const nextSerializedState = serializeState(nextState, eventObject, prevState)
        MutableHashMap.set(stateMap, nextSerializedState, nextState)
        const known = Option.getOrUndefined(MutableHashMap.get(weightMap, nextSerializedState))
        if (!known || known.weight > weight + 1) {
          MutableHashMap.set(weightMap, nextSerializedState, {
            weight: weight + 1,
            from: Option.some({ state: serializedState, event: eventObject }),
          })
        }
        return known ? [] : [nextSerializedState]
      })
    }

    let reached = Chunk.empty<SerializedSnapshot>()
    for (
      let generation: ReadonlyArray<SerializedSnapshot> = [serializedFromState];
      generation.length > 0;
      generation = generation.flatMap(visit)
    ) {
      reached = Chunk.appendAll(reached, Chunk.fromIterable(generation))
    }

    const statePlanMap: StatePlanMap<TSnapshot, TEvent> = {}

    const paths = Chunk.toReadonlyArray(reached).map((stateSerial): StatePath<TSnapshot, TEvent> => {
      const { weight, from } = Option.getOrUndefined(MutableHashMap.get(weightMap, stateSerial))!
      const state = Option.getOrUndefined(MutableHashMap.get(stateMap, stateSerial))!
      const steps: Steps<TSnapshot, TEvent> = Option.match(from, {
        onNone: () => [],
        onSome: ({ state: fromStateSerial, event: fromEvent }) =>
          statePlanMap[fromStateSerial]!.paths[0]!.steps.concat({
            state: Option.getOrUndefined(MutableHashMap.get(stateMap, fromStateSerial))!,
            event: fromEvent,
          }),
      })

      statePlanMap[stateSerial] = {
        state,
        paths: [
          {
            state,
            steps,
            weight,
          },
        ],
      }
      return {
        state,
        steps,
        weight,
      }
    })

    const { toState } = resolvedOptions
    if (toState) {
      return paths.filter((path) => toState(path.state)).map(alterPath)
    }

    return paths.map(alterPath)
  })

/**
 * The shortest path to each state the traversal reaches from the start state (`fromState`,
 * else the initial snapshot for `input`), in the order the states are first reached; with
 * `toState`, only the paths to the states for which it holds (the traversal does not
 * continue past them). Fails as {@link getAdjacencyMap} fails.
 *
 * @example
 * ```ts
 * const paths = yield* getShortestPaths(machine, { toState: (state) => state.matches("done") })
 * ```
 *
 * @since 0.1.0
 * @category Graph
 */
export const getShortestPaths = <TSnapshot extends Snapshot, TEvent extends EventObject, TInput, R = never>(
  logic: TraversableLogic<TSnapshot, TEvent, TInput, R>,
  options?: TraversalOptions<TSnapshot, TEvent, TInput>
): Effect.Effect<Array<StatePath<TSnapshot, TEvent>>, TraversalError, Exclude<Exclude<R, ActorScope>, Scope.Scope>> =>
  withMockActorScope(shortestPathsIn(logic, options))
