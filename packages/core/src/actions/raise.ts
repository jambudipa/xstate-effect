/**
 * @since 0.1.0
 * @module actions/raise
 *
 * The raise action raises an internal event.
 */
import { Effect, Option } from "effect"
import type { EventObject } from "../Event.js"
import { ActorError } from "../Errors.js"
import { withDelay } from "../internal/actionDelay.js"
import { warnIfInCustomAction } from "../internal/customAction.js"
import { toDelayMillis } from "../internal/delay.js"
import type { ActionDefinition, ActionContext, ImplementationNames } from "../Types.js"
import * as Types from "../Types.js"

/**
 * The event of a raise: an event object, or a function of the action arguments and the
 * params of the use that gives one (upstream `SendExpr`).
 *
 * @since 0.1.0
 * @category Actions
 */
export type RaiseEvent<TContext, TEvent extends EventObject, TRaisedEvent extends EventObject = TEvent> =
  | TRaisedEvent
  | ((ctx: ActionContext<TContext, TEvent>, params: unknown) => TRaisedEvent)

/**
 * Options for raise (upstream `RaiseActionOptions`). `TDelay` is the delay names the delay may
 * name (any name by default; a setup's bound `raise` takes the setup's delays).
 *
 * @since 0.1.0
 * @category Actions
 */
export interface RaiseOptions<TContext = unknown, TEvent extends EventObject = EventObject, TDelay extends string = string> {
  /**
   * The delay: milliseconds, the name of a delay of the machine's `delays` implementations
   * (`setup({ delays })`, `provide({ delays })`), or a function of the action context and
   * the params of the use that gives milliseconds. A numeric delay, zero included, sends the
   * event through the scheduler once the macrostep commits; a delay that does not resolve to
   * a number (a name that names no delay, a function that gives no number) raises it at
   * once, as no delay does (upstream `resolveRaise`).
   */
  readonly delay?: number | TDelay | ((ctx: ActionContext<TContext, TEvent>, params: unknown) => number)
  /** ID for the delayed event (for cancellation) */
  readonly id?: string
}

/** The upstream message for a string event (`src/actions/raise.ts:56`). */
const onlyEventObjects = (eventType: string): string =>
  `Only event objects may be used with raise; use raise({ type: "${eventType}" }) instead`

/**
 * Creates an action that raises an internal event.
 *
 * Raised events are processed before external events. A delayed raise reaches the actor
 * itself through the scheduler once the macrostep commits (upstream `executeRaise`), so a
 * macrostep that fails schedules nothing. A string event (the type system rejects it) sets
 * the machine's status to `error` with the upstream message `Only event objects may be used
 * with raise; use raise({ type: "<x>" }) instead`.
 *
 * @example
 * ```ts
 * // Raise an event immediately
 * raise({ type: "INTERNAL_DONE" })
 *
 * // Raise based on context - fully typed
 * raise((ctx) => ({
 *   type: ctx.context.shouldRetry ? "RETRY" : "ABORT"
 * }))
 *
 * // Raise after delay
 * raise({ type: "TIMEOUT" }, { delay: 5000, id: "timeout" })
 * ```
 *
 * @since 0.1.0
 * @category Actions
 */
export const raise: Raise = (<
  TContext,
  TEvent extends EventObject,
  TRaisedEvent extends EventObject = TEvent,
  TNames extends ImplementationNames = ImplementationNames
>(
  event: RaiseEvent<TContext, TEvent, TRaisedEvent>,
  options?: RaiseOptions<TContext, TEvent, NoInfer<TNames>["delays"]>
): ActionDefinition<TContext, TEvent, void, never, TNames> => {
  warnIfInCustomAction("raise")
  const definition: ActionDefinition<TContext, TEvent, void, never, TNames> = {
    type: "xstate.raise",
    exec: (ctx, params) =>
      Effect.gen(function* () {
        // Upstream `resolveRaise`: a string event first, an error of the raising actor (SD-3,
        // SD-4); then the event, then the delay: a function's result, a number, or a name
        // through the machine's `delays`. A delay that is not a number is no delay. The engine
        // chooses between the internal queue and the scheduler
        const raw: unknown = event
        if (typeof raw === "string") {
          return yield* Effect.die(new ActorError({ message: onlyEventObjects(raw), actorId: ctx.self.id }))
        }
        const eventToRaise = typeof event === "function" ? event(ctx, params) : event
        const delay = Option.flatMap(Option.fromNullishOr(options?.delay), (given) =>
          typeof given === "function"
            ? toDelayMillis(given(ctx, params))
            : typeof given === "number"
              ? Option.some(given)
              : ctx.resolveDelay(given, params)
        )
        return Types.ActionResult.RaiseEvent(eventToRaise, { delay, id: Option.fromNullishOr(options?.id) })
      }),
  }
  // Upstream `raise.delay = options?.delay`, which the graph's test model reads
  return withDelay(definition, options?.delay)
}) as Raise

/**
 * The events a raise may raise: the machine's (`TSelfEvent`), or any event object where the
 * place the call is written in does not give them (`never`).
 */
type RaisableEvent<TSelfEvent extends EventObject> = [TSelfEvent] extends [never] ? EventObject : TSelfEvent

/**
 * The default of the raised and computed events: the machine's events, or the action's own
 * (`TEvent`) where none are known, as for a call with explicit type arguments
 * (`raise<C, E>(...)`).
 */
type SelfEventOr<TSelfEvent extends EventObject, TEvent extends EventObject> = [TSelfEvent] extends [never] ? TEvent : TSelfEvent

/**
 * The type of {@link raise}: its first signature is the one every call resolves to. A raised
 * event object (`TRaisedEvent`, inferred from the argument) is one of the events of the
 * machine the action belongs to (`TSelfEvent`; XState raises a `DoNotInfer<TEvent>` of the
 * machine's events), which the place the call is written in gives: a setup's `actions`
 * record, an `enqueue`, a machine config whose events are known. Where it gives none (the
 * call written alone or with explicit type arguments, or under an invocation's `onDone`,
 * `onError` or `onSnapshot` while an untyped machine's events are still inferred),
 * `TSelfEvent` stays `never`: the call takes any event object, as XState's `EventObject`
 * constraint does, and its definition fits any machine. The event a function gives
 * (`TComputedEvent`) is checked the same way: one of the machine's events where the place
 * gives them. The second signature is never callable (it takes arguments
 * that no value has) and gives an inline call the checker's deferral, for the reason `SendTo`
 * in `sendTo.ts` gives: written inline under an `on` descriptor of a typed machine, the call
 * then reads that descriptor's events instead of `EventObject`.
 *
 * @since 0.1.0
 * @category Actions
 */
export interface Raise {
  <
    TContext,
    TEvent extends EventObject,
    TSelfEvent extends EventObject = never,
    TNames extends ImplementationNames = ImplementationNames,
    TRaisedEvent extends RaisableEvent<TSelfEvent> = SelfEventOr<TSelfEvent, TEvent>,
    TComputedEvent extends RaisableEvent<TSelfEvent> = SelfEventOr<TSelfEvent, TEvent>
  >(
    event: TRaisedEvent | ((ctx: ActionContext<TContext, TEvent>, params: unknown) => TComputedEvent),
    options?: RaiseOptions<TContext, TEvent, NoInfer<TNames>["delays"]>
  ): ActionDefinition<TContext, TEvent, void, never, TNames, TSelfEvent>
  <TDeferred extends never>(first: TDeferred, second: TDeferred, third: TDeferred): (deferred: TDeferred) => never
}

// ============================================================
// UPSTREAM TYPE NAMES (EXP-1)
// ============================================================

/**
 * The action `raise(...)` returns (upstream `RaiseAction`): an action definition of the
 * context and the event it reads, which raises an event of the machine (`TEvent`) with a
 * delay of `TDelay`.
 *
 * @since 0.1.0
 * @category Actions
 */
export type RaiseAction<
  TContext,
  TExpressionEvent extends EventObject,
  _TParams,
  TEvent extends EventObject,
  TDelay extends string
> = ActionDefinition<
  TContext,
  TExpressionEvent,
  void,
  never,
  Types.MachineTypesNames<Types.ParameterizedObject, Types.ParameterizedObject, TDelay, Types.ProvidedActor, EventObject>,
  TEvent
>
