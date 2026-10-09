/**
 * @since 0.1.0
 * @module internal/actionDelay
 *
 * The delay a `raise`, `sendTo` or `forwardTo` action was written with (upstream
 * `raise.delay` and `sendTo.delay` in `src/actions/raise.ts` and `src/actions/send.ts` at
 * xstate@5.33.2). Upstream keeps it on the action function; the port's action is a
 * definition object, which the machine definition and its JSON form show as it is, so the
 * delay is kept beside the object instead. The graph's test model reads it to reject a
 * machine with a delayed inline action (upstream `validateMachine`).
 */
import { Option } from "effect"

/**
 * The delay of each built-in action definition, keyed by the definition object itself, so an
 * entry lives no longer than its action. The value is the `delay` option as written (a number,
 * a name or a function), `undefined` when the action has none.
 */
const delays = new WeakMap<object, unknown>()

/**
 * Records the delay `action` was written with, and returns `action`.
 *
 * @since 0.1.0
 * @category Internal
 */
export const withDelay = <A extends object>(action: A, delay: unknown): A => {
  delays.set(action, delay)
  return action
}

/**
 * The delay `action` was written with; none for an action written without one, and for a
 * value that is no built-in action.
 *
 * @since 0.1.0
 * @category Internal
 */
export const delayOf = (action: object): Option.Option<unknown> => Option.fromNullishOr(delays.get(action))
