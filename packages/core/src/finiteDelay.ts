/**
 * @since 0.4.1
 * @module finiteDelay
 *
 * A delay computed at each entry of its state and proven to fire. In a machine that holds agent
 * logic, a named `after` delay that leaves its state is that state's progress delay, and a plain
 * delay function is refused there: it may return infinity or NaN, or throw (NEG-10).
 * `finiteDelay(fn, { max })` wraps `fn` in a total function whose result is clamped to
 * `[0, max]`, with `max` a positive integer literal, and records the wrapper in a private
 * registry. The run-time refusal, `proveSettlement`, `certify` and the type check of `provide`
 * accept a recorded wrapper as sure to fire; a plain function stays refused. Upstream has no
 * counterpart: agent settlement is a port addition.
 */
import type { CheckedLiteral } from "./actors/fromAgent.js"
import type { EventObject } from "./Event.js"
import { clampDelay, registerFiniteDelay } from "./internal/delay.js"
import type { ActionArgs, DelayFunction } from "./Types.js"

/**
 * The key of the type-only brand of {@link FiniteDelay}. No value has it: the brand tells the
 * type of `provide` that a delay is a wrapper, and the run time reads the private registry.
 */
declare const FiniteDelayBrand: unique symbol

/**
 * The brand a {@link FiniteDelay} carries in its type: the bound `TMax`. The type check of
 * `provide` reads it to take the delay as a progress delay.
 *
 * @since 0.4.1
 * @category Delays
 */
export interface FiniteDelayMark<TMax extends number = number> {
  /** Never present at run time; its type is the bound in milliseconds. */
  readonly [FiniteDelayBrand]: TMax
}

/**
 * A delay function that `finiteDelay` built: called with the action arguments and the params of
 * the use, it gives a number of milliseconds in `[0, TMax]`. It fits wherever a
 * `DelayConfig` goes.
 *
 * @since 0.4.1
 * @category Delays
 */
export interface FiniteDelay<TContext, TEvent extends EventObject, TMax extends number, TParams = undefined>
  extends FiniteDelayMark<TMax>
{
  /** The delay in milliseconds for this entry of the state, clamped to `[0, TMax]`. */
  (args: ActionArgs<TContext, TEvent>, params: TParams): number
}

/**
 * The options of {@link finiteDelay}.
 *
 * @since 0.4.1
 * @category Delays
 */
export interface FiniteDelayOptions<TMax extends number> {
  /**
   * The upper bound in milliseconds: a positive integer literal, checked as an agent `budget` is.
   * A wide `number`, a union, `0`, a negative or fractional value, `Infinity`, a branded or a
   * generic number fail to compile here.
   */
  readonly max: TMax & CheckedLiteral<TMax, "max">
}

/**
 * Wraps a delay function in a total one with a literal upper bound, so that a machine that holds
 * agent logic can use a delay computed per state entry as a progress delay.
 *
 * - The wrapper calls `fn` once at each entry of the state, as a delay function is called, so a
 *   restored actor waits only the time its scheduled event has left.
 * - The result is clamped to `[0, max]`: a number above `max`, and `Infinity`, give `max`; a
 *   negative number, `-0` and `-Infinity` give `0`; a `Duration` counts by its milliseconds.
 *   `NaN`, and a value that is neither a number nor a `Duration` (a JavaScript caller), give
 *   `max`: they have no order against the bound, so the delay fires at its latest.
 * - A throw in `fn` is not caught: it is a defect, and the actor ends with status `error`, as for
 *   a throwing delay function or action.
 * - `max` must be a positive integer literal. A cast past the type with a value that is no
 *   positive safe integer leaves the wrapper unrecorded, so it is refused as a plain function is.
 * - Only this function records a wrapper, in a private `WeakMap`. A plain function with a copied
 *   shape, or cast with `as unknown as FiniteDelay`, compiles, but the run-time refusal
 *   (`ProgressDelayError`) and `proveSettlement` (`NoProgressGuarantee`) see no record.
 *
 * @example
 * ```ts
 * import { finiteDelay } from "@jambudipa/xstate-effect"
 *
 * const timebox = finiteDelay(
 *   ({ context }: { context: { deadline: number; now: number } }) => context.deadline - context.now,
 *   { max: 14_400_000 }
 * )
 * ```
 *
 * @since 0.4.1
 * @category Delays
 */
export const finiteDelay = <TContext, TEvent extends EventObject, const TMax extends number, TParams = undefined>(
  fn: DelayFunction<TContext, TEvent, TParams>,
  options: FiniteDelayOptions<TMax>
): FiniteDelay<TContext, TEvent, TMax, TParams> => {
  const max: number = options.max
  const wrapper = (args: ActionArgs<TContext, TEvent>, params: TParams): number => clampDelay(fn(args, params), max)
  // The brand is type-only, as no value carries its key: the registry is what the run time reads
  const branded = wrapper as typeof wrapper & FiniteDelayMark<TMax>
  return Number.isSafeInteger(max) && max > 0 ? registerFiniteDelay(branded, { fn, max }) : branded
}
