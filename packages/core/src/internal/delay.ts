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
import { Duration, Option } from "effect"
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
