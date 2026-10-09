/**
 * @since 0.1.0
 * @module actions/stopChild
 *
 * The stopChild action stops a child actor.
 */
import { Effect, Option } from "effect"
import type { EventObject } from "../Event.js"
import type { ActorRefBase } from "../ActorRef.js"
import type { ActionDefinition, ActionContext } from "../Types.js"
import * as Types from "../Types.js"

/**
 * Child target can be a string ID, an ActorRef, or a function. The function may give
 * `undefined` (for example a `system.get` that finds nothing, read with
 * `Option.getOrUndefined`): the action then stops nothing, as upstream's `resolveStop` and
 * `executeStop` do for a target that resolves to no actor.
 *
 * @since 0.1.0
 * @category Actions
 */
export type StopChildTarget<TContext, TEvent extends EventObject> =
  | string
  | ActorRefBase
  | ((ctx: ActionContext<TContext, TEvent>) => string | ActorRefBase | undefined)

/**
 * Creates an action that stops a child actor (upstream `stopChild`). The target is a child's
 * id, its systemId (D7, beyond XState), a reference, or a function of the action context
 * giving one of these. The engine removes the child from `snapshot.children`, gives up its
 * systemId and those of its descendants at once, and stops it: a child that has not started
 * at once (it never starts), a running child after the events already sent to it. An unknown
 * id changes nothing; an actor that is not a child sets the machine's status to `error` with
 * `Cannot stop child actor <child> of <actor> because it is not a child`.
 *
 * @example
 * ```ts
 * // Stop by ID
 * stopChild("worker")
 *
 * // Stop by reference from context - fully typed
 * stopChild((ctx) => ctx.context.workerRef)
 *
 * // Stop by dynamic ID
 * stopChild((ctx) => `worker-${ctx.context.workerId}`)
 * ```
 *
 * @since 0.1.0
 * @category Actions
 */
export const stopChild: StopChild = (<TContext, TEvent extends EventObject>(
  child: StopChildTarget<TContext, TEvent>
): ActionDefinition<TContext, TEvent> => ({
  type: "xstate.stopChild",
  exec: (ctx, _params) =>
    // Upstream `resolveStop`: a function target receives the action arguments; the engine
    // resolves a string against the snapshot's children. A function that gives no target
    // stops nothing (upstream `executeStop` returns for an undefined actor)
    Effect.sync(() =>
      Option.match(Option.fromNullishOr(typeof child === "function" ? child(ctx) : child), {
        onNone: () => Types.ActionResult.NoOp(),
        onSome: (target) => Types.ActionResult.StopChild(target),
      })
    ),
})) as StopChild

/**
 * The type of {@link stopChild}: its first signature is the one every call resolves to; the second
 * is never callable (it takes arguments that no value has) and gives an inline call the
 * checker's deferral, for the reason `SendTo` in `sendTo.ts` gives: written inline under an
 * `on` descriptor of a typed machine, the call then reads that descriptor's events instead of
 * `EventObject`.
 *
 * @since 0.1.0
 * @category Actions
 */
export interface StopChild {
  <
    TContext,
    TEvent extends EventObject
  >(
    child: StopChildTarget<TContext, TEvent>
  ): ActionDefinition<TContext, TEvent>
  <TDeferred extends never>(first: TDeferred, second: TDeferred, third: TDeferred): (deferred: TDeferred) => never
}

/**
 * XState `stop` of the `actions` entry point: stops a child actor. It is {@link stopChild}
 * itself, as upstream's `stop` is.
 *
 * @deprecated Use `stopChild(...)` instead (upstream's own deprecation).
 * @since 0.1.0
 * @category Actions
 */
export const stop: StopChild = stopChild

/**
 * Creates an action that stops every child of the actor (a port extra): one `stopChild` per
 * child of the snapshot at this point of the action list, in the order of
 * `snapshot.children`. Each child leaves `snapshot.children`, gives its systemId (and those of
 * its descendants) up at once, and stops as `stopChild` stops it, so a child spawned earlier
 * in the same list never starts. A child without a systemId stops too.
 *
 * @example
 * ```ts
 * stopAllChildren()
 * ```
 *
 * @since 0.1.0
 * @category Actions
 */
export const stopAllChildren: StopAllChildren = (<TContext, TEvent extends EventObject>(): ActionDefinition<TContext, TEvent> => ({
  type: "xstate.stopAllChildren",
  exec: (ctx, _params) =>
    // The engine resolves the stops in place, in order, as if they stood in the list
    Effect.sync(() =>
      Types.ActionResult.Enqueued(Object.values(ctx.children).map((child) => stopChild<TContext, TEvent>(child)))
    ),
})) as StopAllChildren

/**
 * The type of {@link stopAllChildren}: its first signature is the one every call resolves to; the second
 * is never callable (it takes arguments that no value has) and gives an inline call the
 * checker's deferral, for the reason `SendTo` in `sendTo.ts` gives: written inline under an
 * `on` descriptor of a typed machine, the call then reads that descriptor's events instead of
 * `EventObject`.
 *
 * @since 0.1.0
 * @category Actions
 */
export interface StopAllChildren {
  <
    TContext,
    TEvent extends EventObject
  >(): ActionDefinition<TContext, TEvent>
  <TDeferred extends never>(first: TDeferred, second: TDeferred, third: TDeferred): (deferred: TDeferred) => never
}

// ============================================================
// UPSTREAM TYPE NAMES (EXP-1)
// ============================================================

/**
 * The action `stopChild(...)` returns (upstream `StopAction`): an action definition of the
 * context and the event it reads.
 *
 * @since 0.1.0
 * @category Actions
 */
export type StopAction<TContext, TExpressionEvent extends EventObject, _TParams, _TEvent extends EventObject> =
  ActionDefinition<TContext, TExpressionEvent>
