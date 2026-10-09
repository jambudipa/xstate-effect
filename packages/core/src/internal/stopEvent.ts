/**
 * @since 0.1.0
 * @module internal/stopEvent
 *
 * The event an actor's stop hands to its logic (upstream `XSTATE_STOP`, `src/constants.ts` at
 * xstate@5.33.2): `_process` gives `{ type: "xstate.stop" }` to the logic's `transition` like
 * any event. Machine logic answers it with status `stopped` and no children; promise,
 * callback and observable logic with status `stopped`; transition logic hands it to the
 * reducer.
 */
import type { EventObject } from "../Event.js"

/**
 * The type of the stop event (upstream `XSTATE_STOP`).
 *
 * @since 0.1.0
 * @category Constants
 */
export const XSTATE_STOP = "xstate.stop"

/**
 * Whether `event` is the stop event.
 *
 * @since 0.1.0
 * @category Guards
 */
export const isStopEvent = (event: EventObject): boolean => event.type === XSTATE_STOP
