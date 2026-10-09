/**
 * @since 0.1.0
 * @module graph/pathFromEvents
 *
 * The path of an event sequence (upstream `src/graph/pathFromEvents.ts` at xstate@5.33.2). It
 * runs the logic's transitions, so it returns an Effect (SD-13).
 */
import { Effect, Function, type Scope } from "effect"
import type { ActorScope } from "../ActorLogic.js"
import type { EventObject } from "../Event.js"
import type { Snapshot } from "../Snapshot.js"
import { adjacencyMapIn } from "./adjacency.js"
import { withMockActorScope } from "./actorScope.js"
import { alterPath } from "./alterPath.js"
import { InvalidEventSequenceError } from "./errors.js"
import {
  createDefaultLogicOptions,
  createDefaultMachineOptions,
  isMachineLogic,
  resolveTraversalOptions,
  type TraversableLogic,
} from "./graph.js"
import type { SerializedEvent, SerializedSnapshot, StatePath, Steps, TraversalError, TraversalOptions } from "./types.js"

/**
 * The path of an event sequence, in the actor scope the caller provides.
 *
 * @since 0.1.0
 * @category Internal
 */
export const pathsFromEventsIn = <TSnapshot extends Snapshot, TEvent extends EventObject, TInput, R>(
  logic: TraversableLogic<TSnapshot, TEvent, TInput, R>,
  events: ReadonlyArray<TEvent>,
  options?: TraversalOptions<TSnapshot, TEvent, TInput>
): Effect.Effect<Array<StatePath<TSnapshot, TEvent>>, TraversalError | InvalidEventSequenceError, ActorScope | R> =>
  Effect.gen(function* () {
    // Upstream: the machine defaults are made without the options (so without the input)
    const defaultOptions = isMachineLogic(logic)
      ? yield* createDefaultMachineOptions<TSnapshot, TEvent, TInput, R>(logic)
      : createDefaultLogicOptions<TSnapshot, TEvent, TInput>()
    const resolvedOptions = yield* resolveTraversalOptions(
      logic,
      {
        events,
        ...options,
      },
      defaultOptions
    )
    const fromState =
      resolvedOptions.fromState ??
      // Upstream passes the input as given (`undefined` when there is none)
      (yield* logic.getInitialSnapshot(options?.input as TInput))

    const { serializeState, serializeEvent } = resolvedOptions

    const adjacency = yield* adjacencyMapIn(logic, resolvedOptions)

    let steps: Steps<TSnapshot, TEvent> = []

    const serializedFromState = serializeState(
      fromState,
      Function.constUndefined(),
      Function.constUndefined()
    ) as SerializedSnapshot

    // Upstream keeps a Map from each serialized state to its snapshot and reads the entry of
    // the current serial back. The entry it reads is always the one it set last, which is the
    // current state, so the port reads that state directly
    let stateSerial = serializedFromState
    let state = fromState
    for (const event of events) {
      steps = [...steps, { state, event }]

      const eventSerial = serializeEvent(event) as SerializedEvent
      // Upstream reads the entry without a check, so an event with no entry fails with a
      // TypeError there; here it fails as an entry without a next state does
      const nextState = adjacency[stateSerial]?.transitions[eventSerial]?.state

      if (!nextState) {
        return yield* new InvalidEventSequenceError({
          message: `Invalid transition from ${stateSerial} with ${eventSerial}`,
        })
      }
      const nextStateSerial = serializeState(nextState, event, state) as SerializedSnapshot

      stateSerial = nextStateSerial
      state = nextState
    }

    // If it is expected to reach a specific state (`toState`) and that state isn't reached,
    // there are no paths
    if (resolvedOptions.toState && !resolvedOptions.toState(state)) {
      return []
    }

    return [
      alterPath({
        state,
        steps,
        weight: steps.length,
      }),
    ]
  })

/**
 * The path that the given events take from the start state (`fromState`, else the initial
 * snapshot for `input`), as one path; no path when `toState` does not hold for the state it
 * ends in. Fails with `Invalid transition from <state> with <event>` when an event of the
 * sequence leads nowhere from the state it meets, and as {@link getAdjacencyMap} fails.
 *
 * @example
 * ```ts
 * const [path] = yield* getPathsFromEvents(machine, [{ type: "TIMER" }, { type: "TIMER" }])
 * ```
 *
 * @since 0.1.0
 * @category Graph
 */
export const getPathsFromEvents = <TSnapshot extends Snapshot, TEvent extends EventObject, TInput, R = never>(
  logic: TraversableLogic<TSnapshot, TEvent, TInput, R>,
  events: ReadonlyArray<TEvent>,
  options?: TraversalOptions<TSnapshot, TEvent, TInput>
): Effect.Effect<
  Array<StatePath<TSnapshot, TEvent>>,
  TraversalError | InvalidEventSequenceError,
  Exclude<Exclude<R, ActorScope>, Scope.Scope>
> => withMockActorScope(pathsFromEventsIn(logic, events, options))
