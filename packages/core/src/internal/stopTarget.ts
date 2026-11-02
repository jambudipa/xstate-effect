/**
 * @since 0.4.0
 * @module internal/stopTarget
 *
 * The target a `stopChild` action was written with. The action's own `exec` closes over it, and
 * the machine definition and its JSON form show the action as it is, so the target sits on the
 * definition object as a non-enumerable property, which neither shows. The key is a registered
 * symbol: a machine that one copy of the library built keeps its targets for the proof of
 * another, where a module-local record reads nothing and `StopsInvokedAgent` passes silently.
 * The target is no secret: a value forged here can only add a finding or hide a stop in the
 * user's own action, which a cast does anyway. The structural settlement proof reads it to find
 * a stop of an invoked agent (NEG-9), which a cast or a name the types do not declare hides from
 * the type check. Upstream has no counterpart: agent settlement is a port addition.
 */
import { Option } from "effect"

/** The key of the target. Registered, so two copies of the library read each other's actions. */
const StopTarget: unique symbol = Symbol.for("@jambudipa/xstate-effect/StopTarget")

/**
 * Records the target `action` was written with, and returns `action`.
 *
 * @since 0.4.0
 * @category Internal
 */
export const withStopTarget = <A extends object>(action: A, target: unknown): A =>
  Object.defineProperty(action, StopTarget, { value: target, enumerable: false })

/**
 * The target `action` was written with; none for a value that is no `stopChild` definition.
 *
 * @since 0.4.0
 * @category Internal
 */
export const stopTargetOf = (action: object): Option.Option<unknown> =>
  Option.fromNullishOr(Object.getOwnPropertyDescriptor(action, StopTarget)?.value)
