/**
 * @since 0.1.0
 * @module internal/delay
 *
 * The delay of a `raise` or a `sendTo` (upstream `resolveRaise` and `resolveSendTo` in
 * `src/actions/raise.ts` and `src/actions/send.ts` at xstate@5.33.2). A name reads the
 * `delays` implementations of the machine (`setup({ delays })`, overridden by
 * `machine.provide({ delays })`); a configured delay is a number, a function called with the
 * action arguments and the params of the use, or a `Duration` (port). A value that is not a
 * number (the port also takes a `Duration`) is no delay: upstream raises such an event at once
 * through the internal queue, and sends it at once through the system.
 */
import { Duration, Option, Predicate } from "effect"
import type { EventObject } from "../Event.js"
import type { ActionArgs, DelayConfig, MachineImplementations } from "../Types.js"

/**
 * The milliseconds a resolved delay stands for: a number as it is, a `Duration` in
 * milliseconds; none for any other value.
 *
 * @since 0.1.0
 * @category Internal
 */
export const toDelayMillis = (value: unknown): Option.Option<number> =>
  typeof value === "number"
    ? Option.some(value)
    : Duration.isDuration(value)
      ? Option.some(Duration.toMillis(value))
      : Option.none()

/**
 * What `finiteDelay` records for a wrapper it built: the function it wraps, whose source the
 * certificate hash reads, and the bound in milliseconds that the wrapper clamps to.
 *
 * @since 0.4.1
 * @category Internal
 */
export interface FiniteDelayEntry {
  /** The wrapped delay function, as the author wrote it. */
  readonly fn: (args: never, params: never) => unknown
  /** The upper bound in milliseconds: a positive safe integer. */
  readonly max: number
}

/**
 * The wrappers `finiteDelay` built, each with its entry. A marker on the function would not do:
 * user code could copy it to a plain function. A `WeakMap` entry cannot be copied, so a forged
 * wrapper, a cast included, has none, and every layer that reads {@link isFiniteDelay} refuses it.
 */
const finiteDelays = new WeakMap<object, FiniteDelayEntry>()

/**
 * Records `wrapper` as a delay that is sure to fire within `entry.max` milliseconds, and returns
 * it. Only `finiteDelay` calls this, and only for a positive safe integer bound.
 *
 * @since 0.4.1
 * @category Internal
 */
export const registerFiniteDelay = <T extends object>(wrapper: T, entry: FiniteDelayEntry): T => {
  finiteDelays.set(wrapper, entry)
  return wrapper
}

/**
 * The entry of a wrapper `finiteDelay` built; none for any other value, a copy of one included.
 *
 * @since 0.4.1
 * @category Internal
 */
export const finiteDelayOf = (value: unknown): Option.Option<FiniteDelayEntry> =>
  Predicate.isFunction(value) ? Option.fromNullishOr(finiteDelays.get(value)) : Option.none()

/**
 * The milliseconds a `finiteDelay` wrapper gives for the value its function returned: the value
 * clamped to `[0, max]`. A negative value or `-0` gives `0` and a value above `max` gives `max`,
 * `Infinity` included. `NaN` and a value that is neither a number nor a `Duration` have no order
 * against the bound, so they give the declared bound `max`: the delay still fires, at its latest.
 *
 * @since 0.4.1
 * @category Internal
 */
export const clampDelay = (value: unknown, max: number): number =>
  Option.match(toDelayMillis(value), {
    onNone: () => max,
    onSome: (millis) => (Number.isNaN(millis) ? max : Math.min(max, Math.max(0, millis))),
  })

/**
 * `true` for a delay that is sure to fire: a finite number, a finite `Duration`, or a wrapper that
 * `finiteDelay` built (its result is clamped to a literal bound). Any other function may return
 * anything, so it is not. The refusal of a machine's progress delay and the structural proof read
 * this one test (NEG-10).
 *
 * @since 0.4.0
 * @category Internal
 */
export const isFiniteDelay = (delay: unknown): boolean =>
  typeof delay === "number"
    ? Number.isFinite(delay)
    : (Duration.isDuration(delay) && Duration.isFinite(delay)) || Option.isSome(finiteDelayOf(delay))

/**
 * The delay a name configures, looked up as an own property of the `delays` implementations;
 * none for a name they lack.
 *
 * @since 0.1.0
 * @category Internal
 */
export const lookupDelay = <TContext, TEvent extends EventObject>(
  implementations: MachineImplementations<TContext, TEvent>,
  name: string
): Option.Option<DelayConfig<TContext, TEvent>> =>
  Option.flatMap(Option.fromNullishOr(implementations.delays), (delays) =>
    Object.hasOwn(delays, name) ? Option.fromNullishOr(delays[name]) : Option.none()
  )

/**
 * The milliseconds of a delay (upstream `resolveRaise` / `resolveSendTo`): a number as it is;
 * a name through the `delays` implementations, whose function form is called with the action
 * arguments and the params of the use. None for a name the implementations lack and for a
 * configured delay that gives no number, which means no delay.
 *
 * @since 0.1.0
 * @category Internal
 */
export const resolveDelay = <TContext, TEvent extends EventObject>(
  implementations: MachineImplementations<TContext, TEvent>,
  delay: number | string,
  args: ActionArgs<TContext, TEvent>,
  params: unknown
): Option.Option<number> =>
  typeof delay === "number"
    ? Option.some(delay)
    : Option.flatMap(lookupDelay(implementations, delay), (configured) =>
        // A delay function declares its own params type; the engine passes the params of the use
        toDelayMillis(typeof configured === "function" ? configured(args, params as never) : configured)
      )
