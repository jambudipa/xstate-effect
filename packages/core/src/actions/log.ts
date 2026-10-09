/**
 * @since 0.1.0
 * @module actions/log
 *
 * The log action logs a value once, through Effect's structured logging (upstream `log`).
 */
import { Effect, Option } from "effect"
import type { EventObject } from "../Event.js"
import type { ActionDefinition, ActionContext } from "../Types.js"
import * as Types from "../Types.js"

/**
 * The value of a log (upstream `ResolvableLogValue`): a string, or a function of the action
 * arguments and the params of the use that gives the value to log, of any type (upstream
 * `LogExpr`).
 *
 * @since 0.1.0
 * @category Actions
 */
export type LogMessage<TContext, TEvent extends EventObject> =
  | string
  | ((ctx: ActionContext<TContext, TEvent>, params: unknown) => unknown)

/**
 * Log level for the log action (port).
 *
 * @since 0.1.0
 * @category Actions
 */
export type LogLevel = Types.LogLevel

/**
 * Options for log (port): the level, and the label that a string second argument gives.
 *
 * @since 0.1.0
 * @category Actions
 */
export interface LogOptions {
  /** Log level (defaults to "info") */
  readonly level?: LogLevel
  /** The label, logged before the value (upstream `log(value, label)`) */
  readonly label?: string
}

/**
 * Creates an action that logs a value once (upstream `log(value?, label?)`).
 *
 * The value is a string, or a function of the action arguments (`context`, `event`, `self`,
 * `system`) and the params of the use that gives any value; it defaults to
 * `({ context, event }) => ({ context, event })`. It is computed when the action runs, with
 * the context the earlier actions of the list left (upstream `resolveLog`). A string second
 * argument is the label: the entry's message is then `[label, value]`, else `[value]`
 * (upstream `logger(label, value)` and `logger(value)`). An object second argument holds the
 * port options: the level, and the label.
 *
 * The engine logs the entry through the actor's action executor (upstream `executeLog`):
 * at once in a running actor, and at `start` for the actions of the initial snapshot. The
 * actor's `logger` option receives `(label, value)` or `(value)`, without the level; an
 * actor without one uses its system's, which is the root actor's `logger` option (C22).
 * Without any logger the entry goes to Effect logging at the level of the action, with the
 * actorId and sessionId annotations (C12). A value function or a logger that throws sets the
 * actor's status to `error` with the thrown value (SD-4).
 *
 * @example
 * ```ts
 * // Log the context and the event
 * log()
 *
 * // Log a string with a label
 * log("State entered", "lifecycle")
 *
 * // Log a computed value - fully typed
 * log((ctx) => ctx.context.count, "count")
 *
 * // Log with a level
 * log("Something went wrong", { level: "warning" })
 * ```
 *
 * @since 0.1.0
 * @category Actions
 */
export const log: Log = (<TContext, TEvent extends EventObject>(
  value: LogMessage<TContext, TEvent> = ({ context, event }) => ({ context, event }),
  labelOrOptions?: string | LogOptions
): ActionDefinition<TContext, TEvent> => {
  const options: LogOptions = typeof labelOrOptions === "string" ? { label: labelOrOptions } : (labelOrOptions ?? {})
  return {
    type: "xstate.log",
    exec: (ctx, params) =>
      // Upstream `resolveLog`: the value only; the engine logs it (`executeLog`)
      Effect.sync(() =>
        Types.ActionResult.Log(typeof value === "function" ? value(ctx, params) : value, {
          label: Option.fromNullishOr(options.label),
          level: options.level ?? "info",
        })
      ),
  }
}) as Log

/**
 * The type of {@link log}: its first signature is the one every call resolves to; the second
 * is never callable (it takes arguments that no value has) and gives an inline call the
 * checker's deferral, for the reason `SendTo` in `sendTo.ts` gives: written inline under an
 * `on` descriptor of a typed machine, the call then reads that descriptor's events instead of
 * `EventObject`.
 *
 * @since 0.1.0
 * @category Actions
 */
export interface Log {
  <
    TContext,
    TEvent extends EventObject
  >(
    value?: LogMessage<TContext, TEvent>,
    labelOrOptions?: string | LogOptions
  ): ActionDefinition<TContext, TEvent>
  <TDeferred extends never>(first: TDeferred, second: TDeferred, third: TDeferred): (deferred: TDeferred) => never
}

/**
 * Creates a debug log action.
 *
 * @since 0.1.0
 * @category Actions
 */
export const logDebug: LogDebug = (<TContext, TEvent extends EventObject>(
  message: LogMessage<TContext, TEvent>
): ActionDefinition<TContext, TEvent> => log(message, { level: "debug" })) as LogDebug

/**
 * The type of {@link logDebug}: its first signature is the one every call resolves to; the second
 * is never callable (it takes arguments that no value has) and gives an inline call the
 * checker's deferral, for the reason `SendTo` in `sendTo.ts` gives: written inline under an
 * `on` descriptor of a typed machine, the call then reads that descriptor's events instead of
 * `EventObject`.
 *
 * @since 0.1.0
 * @category Actions
 */
export interface LogDebug {
  <
    TContext,
    TEvent extends EventObject
  >(
    message: LogMessage<TContext, TEvent>
  ): ActionDefinition<TContext, TEvent>
  <TDeferred extends never>(first: TDeferred, second: TDeferred, third: TDeferred): (deferred: TDeferred) => never
}

/**
 * Creates an info log action.
 *
 * @since 0.1.0
 * @category Actions
 */
export const logInfo: LogInfo = (<TContext, TEvent extends EventObject>(
  message: LogMessage<TContext, TEvent>
): ActionDefinition<TContext, TEvent> => log(message, { level: "info" })) as LogInfo

/**
 * The type of {@link logInfo}: its first signature is the one every call resolves to; the second
 * is never callable (it takes arguments that no value has) and gives an inline call the
 * checker's deferral, for the reason `SendTo` in `sendTo.ts` gives: written inline under an
 * `on` descriptor of a typed machine, the call then reads that descriptor's events instead of
 * `EventObject`.
 *
 * @since 0.1.0
 * @category Actions
 */
export interface LogInfo {
  <
    TContext,
    TEvent extends EventObject
  >(
    message: LogMessage<TContext, TEvent>
  ): ActionDefinition<TContext, TEvent>
  <TDeferred extends never>(first: TDeferred, second: TDeferred, third: TDeferred): (deferred: TDeferred) => never
}

/**
 * Creates a warning log action.
 *
 * @since 0.1.0
 * @category Actions
 */
export const logWarning: LogWarning = (<TContext, TEvent extends EventObject>(
  message: LogMessage<TContext, TEvent>
): ActionDefinition<TContext, TEvent> => log(message, { level: "warning" })) as LogWarning

/**
 * The type of {@link logWarning}: its first signature is the one every call resolves to; the second
 * is never callable (it takes arguments that no value has) and gives an inline call the
 * checker's deferral, for the reason `SendTo` in `sendTo.ts` gives: written inline under an
 * `on` descriptor of a typed machine, the call then reads that descriptor's events instead of
 * `EventObject`.
 *
 * @since 0.1.0
 * @category Actions
 */
export interface LogWarning {
  <
    TContext,
    TEvent extends EventObject
  >(
    message: LogMessage<TContext, TEvent>
  ): ActionDefinition<TContext, TEvent>
  <TDeferred extends never>(first: TDeferred, second: TDeferred, third: TDeferred): (deferred: TDeferred) => never
}

/**
 * Creates an error log action.
 *
 * @since 0.1.0
 * @category Actions
 */
export const logError: LogError = (<TContext, TEvent extends EventObject>(
  message: LogMessage<TContext, TEvent>
): ActionDefinition<TContext, TEvent> => log(message, { level: "error" })) as LogError

/**
 * The type of {@link logError}: its first signature is the one every call resolves to; the second
 * is never callable (it takes arguments that no value has) and gives an inline call the
 * checker's deferral, for the reason `SendTo` in `sendTo.ts` gives: written inline under an
 * `on` descriptor of a typed machine, the call then reads that descriptor's events instead of
 * `EventObject`.
 *
 * @since 0.1.0
 * @category Actions
 */
export interface LogError {
  <
    TContext,
    TEvent extends EventObject
  >(
    message: LogMessage<TContext, TEvent>
  ): ActionDefinition<TContext, TEvent>
  <TDeferred extends never>(first: TDeferred, second: TDeferred, third: TDeferred): (deferred: TDeferred) => never
}

// ============================================================
// UPSTREAM TYPE NAMES (EXP-1)
// ============================================================

/**
 * The action `log(...)` returns (upstream `LogAction`): an action definition of the context
 * and the event it reads.
 *
 * @since 0.1.0
 * @category Actions
 */
export type LogAction<TContext, TExpressionEvent extends EventObject, _TParams, _TEvent extends EventObject> =
  ActionDefinition<TContext, TExpressionEvent>
