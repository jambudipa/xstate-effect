/**
 * @since 0.1.0
 * @module actions/emit
 *
 * The emit action emits an event to listeners.
 */
import { Effect } from "effect"
import type { EventObject } from "../Event.js"
import { warnIfInCustomAction } from "../internal/customAction.js"
import type { ActionDefinition, ActionContext, ImplementationNames } from "../Types.js"
import * as Types from "../Types.js"

/**
 * Event for emit can be an event object or a function.
 *
 * @since 0.1.0
 * @category Actions
 */
export type EmitEvent<TContext, TEvent extends EventObject, TEmitted extends EventObject = EventObject> =
  | TEmitted
  | ((ctx: ActionContext<TContext, TEvent>) => TEmitted)

/**
 * Creates an action that emits an event to listeners.
 *
 * Emitted events are broadcast to external listeners subscribed to the actor,
 * not processed by the state machine itself. The listeners receive them after the
 * macrostep commits, in action order, so a snapshot they read is the new one (upstream
 * `executeEmit`).
 *
 * Uses the fully-typed ActionContext for full type inference. Written in the config of a
 * setup machine that declares `types.emitted`, the event must be one of those events
 * (XState `DoNotInfer<TEmitted>`): `TNames` is read from the config's type, never from the
 * argument. Elsewhere any event object is taken.
 *
 * @example
 * ```ts
 * // Emit a simple event
 * emit({ type: "status.changed", status: "ready" })
 *
 * // Emit based on context - fully typed
 * emit((ctx) => ({
 *   type: "data.updated",
 *   data: ctx.context.currentData,
 *   triggeredBy: ctx.event.type
 * }))
 * ```
 *
 * @since 0.1.0
 * @category Actions
 */
export const emit: Emit = (<
  TContext,
  TEvent extends EventObject,
  TNames extends ImplementationNames = ImplementationNames
>(
  event: EmitEvent<TContext, TEvent, NoInfer<TNames>["emitted"]>
): ActionDefinition<TContext, TEvent, void, never, TNames> => {
  warnIfInCustomAction("emit")
  return {
    type: "xstate.emit",
    exec: (ctx, _params) =>
      Effect.sync(() => {
        const eventToEmit = typeof event === "function" ? event(ctx) : event
        return Types.ActionResult.EmitEvent(eventToEmit)
      }),
  }
}) as Emit

/**
 * The type of {@link emit}: its first signature is the one every call resolves to; the second
 * is never callable (it takes arguments that no value has) and gives an inline call the
 * checker's deferral, for the reason `SendTo` in `sendTo.ts` gives: written inline under an
 * `on` descriptor of a typed machine, the call then reads that descriptor's events instead of
 * `EventObject`. `TNames` comes from the config's type (see `ActionDefinition`'s `~names`), so
 * a setup's declared `emitted` events check the argument.
 *
 * @since 0.1.0
 * @category Actions
 */
export interface Emit {
  <
    TContext,
    TEvent extends EventObject,
    TNames extends ImplementationNames = ImplementationNames
  >(
    event: EmitEvent<TContext, TEvent, NoInfer<TNames>["emitted"]>
  ): ActionDefinition<TContext, TEvent, void, never, TNames>
  <TDeferred extends never>(first: TDeferred, second: TDeferred, third: TDeferred): (deferred: TDeferred) => never
}

// ============================================================
// UPSTREAM TYPE NAMES (EXP-1)
// ============================================================

/**
 * The action `emit(...)` returns (upstream `EmitAction`): an action definition of the
 * context and the event it reads, for a machine that emits `TEmitted`.
 *
 * @since 0.1.0
 * @category Actions
 */
export type EmitAction<
  TContext,
  TExpressionEvent extends EventObject,
  _TParams,
  _TEvent extends EventObject,
  TEmitted extends EventObject
> = ActionDefinition<
  TContext,
  TExpressionEvent,
  void,
  never,
  Types.MachineTypesNames<Types.ParameterizedObject, Types.ParameterizedObject, string, Types.ProvidedActor, TEmitted>
>
