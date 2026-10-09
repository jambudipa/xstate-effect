/**
 * @since 0.1.0
 * @module graph/simplePaths
 *
 * Simple paths (upstream `src/graph/simplePaths.ts` at xstate@5.33.2): a depth-first walk of
 * the adjacency map that visits no state twice on one path. It runs the logic's transitions,
 * so it returns an Effect (SD-13).
 */
import { Effect, Function, HashSet, MutableHashMap, Option, type Scope } from "effect"
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
  Steps,
  TraversalError,
  TraversalOptions,
} from "./types.js"

/**
 * The simple paths, in the actor scope the caller provides.
 *
 * @since 0.1.0
 * @category Internal
 */
export const simplePathsIn = <TSnapshot extends Snapshot, TEvent extends EventObject, TInput, R>(
  logic: TraversableLogic<TSnapshot, TEvent, TInput, R>,
  options?: TraversalOptions<TSnapshot, TEvent, TInput>
): Effect.Effect<Array<StatePath<TSnapshot, TEvent>>, TraversalError, ActorScope | R> =>
  Effect.gen(function* () {
    const resolvedOptions = yield* resolveTraversalOptions(logic, options)
    const fromState =
      resolvedOptions.fromState ??
      // Upstream passes the input as given (`undefined` when there is none)
      (yield* logic.getInitialSnapshot(options?.input as TInput))
    const serializeState = resolvedOptions.serializeState as (
      ...args: Parameters<typeof resolvedOptions.serializeState>
    ) => SerializedSnapshot
    const adjacency = yield* adjacencyMapIn(logic, resolvedOptions)
    // The last snapshot seen for each serial (upstream's `stateMap`): the walk overwrites it
    // as it goes, and a later step reads what a deeper call wrote. It is never iterated.
    const stateMap = MutableHashMap.empty<SerializedSnapshot, TSnapshot>()
    const stateOf = (serial: SerializedSnapshot): TSnapshot | undefined =>
      Option.getOrUndefined(MutableHashMap.get(stateMap, serial))

    // Every simple path from `fromStateSerial` to `toStateSerial`, in depth-first order.
    // `steps` is the path so far and `onPath` the serials on it (upstream's path stack and
    // `visitCtx.vertices`; upstream's `visitCtx.edges` is never read, so it is not kept).
    const walk = (
      fromStateSerial: SerializedSnapshot,
      toStateSerial: SerializedSnapshot,
      steps: Steps<TSnapshot, TEvent>,
      onPath: HashSet.HashSet<SerializedSnapshot>
    ): Array<StatePath<TSnapshot, TEvent>> => {
      if (fromStateSerial === toStateSerial) {
        return [{ state: stateOf(fromStateSerial)!, weight: steps.length, steps }]
      }
      const visited = HashSet.add(onPath, fromStateSerial)
      const { transitions } = adjacency[fromStateSerial]!
      return (Object.keys(transitions) as Array<SerializedEvent>).flatMap((serializedEvent) => {
        const { state: nextState, event: subEvent } = transitions[serializedEvent]!

        const prevState = stateOf(fromStateSerial)

        const nextStateSerial = serializeState(nextState, subEvent, prevState)
        MutableHashMap.set(stateMap, nextStateSerial, nextState)

        return HashSet.has(visited, nextStateSerial)
          ? []
          : walk(
              nextStateSerial,
              toStateSerial,
              [...steps, { state: stateOf(fromStateSerial)!, event: subEvent }],
              visited
            )
      })
    }

    const fromStateSerial = serializeState(fromState, Function.constUndefined())
    MutableHashMap.set(stateMap, fromStateSerial, fromState)

    // One walk per adjacency key, in key order: upstream's `Object.values(pathMap)` order,
    // since each walk fills only the entry of its own key
    const simplePaths = (Object.keys(adjacency) as Array<SerializedSnapshot>).flatMap((toStateSerial) =>
      walk(fromStateSerial, toStateSerial, [], HashSet.empty())
    )

    const { toState } = resolvedOptions
    if (toState) {
      return simplePaths.filter((path) => toState(path.state)).map(alterPath)
    }

    return simplePaths.map(alterPath)
  })

/**
 * Every simple path (no state twice) to each state the traversal reaches from the start
 * state (`fromState`, else the initial snapshot for `input`), grouped by state in the order
 * of the adjacency map; with `toState`, only the paths to the states for which it holds.
 * Fails as {@link getAdjacencyMap} fails.
 *
 * @example
 * ```ts
 * const paths = yield* getSimplePaths(machine, { filterEvents: (state, event) => state.can(event) })
 * ```
 *
 * @since 0.1.0
 * @category Graph
 */
export const getSimplePaths = <TSnapshot extends Snapshot, TEvent extends EventObject, TInput, R = never>(
  logic: TraversableLogic<TSnapshot, TEvent, TInput, R>,
  options?: TraversalOptions<TSnapshot, TEvent, TInput>
): Effect.Effect<Array<StatePath<TSnapshot, TEvent>>, TraversalError, Exclude<Exclude<R, ActorScope>, Scope.Scope>> =>
  withMockActorScope(simplePathsIn(logic, options))
