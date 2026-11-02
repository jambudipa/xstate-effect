/**
 * @since 0.1.0
 * @module internal/actionDelay
 *
 * The delay a `raise`, `sendTo` or `forwardTo` action was written with (upstream
 * `raise.delay` and `sendTo.delay` in `src/actions/raise.ts` and `src/actions/send.ts` at
 * xstate@5.33.2). Upstream keeps it on the action function; the port's action is a
 * definition object, which the machine definition and its JSON form show as it is, so the
 * delay sits on it as a non-enumerable property, which neither shows. The key is a registered
 * symbol, so a machine one copy of the library built keeps its delays for the test model of
 * another. The graph's test model reads it to reject a machine with a delayed inline action
 * (upstream `validateMachine`).
 */
import { Option } from "effect"

/**
 * The key of the delay on a built-in action definition. The value is the `delay` option as
 * written (a number, a name or a function), `undefined` when the action has none.
 */
const ActionDelay: unique symbol = Symbol.for("@jambudipa/xstate-effect/ActionDelay")

/**
 * Records the delay `action` was written with, and returns `action`.
 *
 * @since 0.1.0
 * @category Internal
 */
export const withDelay = <A extends object>(action: A, delay: unknown): A =>
  Object.defineProperty(action, ActionDelay, { value: delay, enumerable: false })

/**
 * The delay `action` was written with; none for an action written without one, and for a
 * value that is no built-in action.
 *
 * @since 0.1.0
 * @category Internal
 */
export const delayOf = (action: object): Option.Option<unknown> =>
  Option.fromNullishOr(Object.getOwnPropertyDescriptor(action, ActionDelay)?.value)
