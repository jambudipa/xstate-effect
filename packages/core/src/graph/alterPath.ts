/**
 * @since 0.1.0
 * @module graph/alterPath
 *
 * The step form of a path (upstream `src/graph/alterPath.ts` at xstate@5.33.2).
 */
import type { EventObject } from "../Event.js"
import type { Snapshot } from "../Snapshot.js"
import type { StatePath, Steps } from "./types.js"

/**
 * Turns a path whose steps hold the event taken from each state into one whose steps hold
 * the event that led to each state: the first step is the start state with `xstate.init`,
 * and the last is the end state with the last event. A path without steps becomes the end
 * state with `xstate.init`. (Upstream: a rewrite of the algorithm should make this
 * function obsolete.)
 *
 * @since 0.1.0
 * @category Internal
 */
export const alterPath = <TSnapshot extends Snapshot, TEvent extends EventObject>(
  path: StatePath<TSnapshot, TEvent>
): StatePath<TSnapshot, TEvent> => {
  // Upstream types the init event as any event of the logic
  const initEvent = { type: "xstate.init" } as TEvent
  const lastStep = path.steps.at(-1)
  const steps: Steps<TSnapshot, TEvent> = lastStep
    ? [
        ...path.steps.map((step, i) => ({
          state: step.state,
          event: i === 0 ? initEvent : (path.steps[i - 1]?.event ?? initEvent),
        })),
        {
          state: path.state,
          event: lastStep.event,
        },
      ]
    : [
        {
          state: path.state,
          event: initEvent,
        },
      ]

  return {
    ...path,
    steps,
  }
}
