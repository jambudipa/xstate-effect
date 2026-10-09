/**
 * @since 0.1.0
 * @module actions/cancel
 *
 * The cancel action cancels a delayed event.
 */
import { Effect } from "effect"
import type { EventObject } from "../Event.js"
import type { ActionDefinition, ActionContext } from "../Types.js"
import * as Types from "../Types.js"

/**
 * Cancel ID can be a string or a function.
 *
 * @since 0.1.0
 * @category Actions
 */
export type CancelId<TContext, TEvent extends EventObject> =
  | string
  | ((ctx: ActionContext<TContext, TEvent>) => string)

/**
 * Creates an action that cancels a delayed event.
 *
 * Uses the fully-typed ActionContext - no casts needed.
 * Direct access to system.scheduler.cancel via typed context.
 *
 * @example
 * ```ts
 * // Cancel by static ID
 * cancel("timeout")
 *
 * // Cancel by dynamic ID - fully typed
 * cancel((ctx) => `retry-${ctx.context.attemptId}`)
 * ```
 *
 * @since 0.1.0
 * @category Actions
 */
export const cancel: Cancel = (<TContext, TEvent extends EventObject>(
  id: CancelId<TContext, TEvent>
): ActionDefinition<TContext, TEvent> => ({
  type: "xstate.cancel",
  exec: (ctx, _params) =>
    Effect.gen(function* () {
      const cancelId = typeof id === "function" ? id(ctx) : id

      // Upstream `executeCancel`: the scheduler cancels once the macrostep commits, in order
      // with the macrostep's delayed sends, so an exit's cancel precedes a re-entry's schedule
      yield* ctx.defer(ctx.system.scheduler.cancel(ctx.self, cancelId))

      // Upstream `resolveCancel`'s params: the engine hands them to the action executor, so
      // the `@xstate.action` inspection event carries `{ sendId }`
      return Types.ActionResult.Cancel(cancelId)
    }),
})) as Cancel

/**
 * The type of {@link cancel}: its first signature is the one every call resolves to; the second
 * is never callable (it takes arguments that no value has) and gives an inline call the
 * checker's deferral, for the reason `SendTo` in `sendTo.ts` gives: written inline under an
 * `on` descriptor of a typed machine, the call then reads that descriptor's events instead of
 * `EventObject`.
 *
 * @since 0.1.0
 * @category Actions
 */
export interface Cancel {
  <
    TContext,
    TEvent extends EventObject
  >(
    id: CancelId<TContext, TEvent>
  ): ActionDefinition<TContext, TEvent>
  <TDeferred extends never>(first: TDeferred, second: TDeferred, third: TDeferred): (deferred: TDeferred) => never
}

// ============================================================
// UPSTREAM TYPE NAMES (EXP-1)
// ============================================================

/**
 * The action `cancel(...)` returns (upstream `CancelAction`): an action definition of the
 * context and the event it reads.
 *
 * @since 0.1.0
 * @category Actions
 */
export type CancelAction<TContext, TExpressionEvent extends EventObject, _TParams, _TEvent extends EventObject> =
  ActionDefinition<TContext, TExpressionEvent>
