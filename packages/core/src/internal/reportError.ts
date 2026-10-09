/**
 * @since 0.1.0
 * @module internal/reportError
 *
 * How the port reports an error that nothing handles (SD-21). Upstream rethrows it
 * asynchronously (`reportUnhandledError`, a `setTimeout` that throws); an Effect library must
 * not do that, so the port reports it once through the logger of the fiber that meets it
 * (`Effect.logError` by default), with the original value as the logged message.
 */
import { Cause, Effect } from "effect"

/**
 * Reports an error that nothing handles once, through the logger (upstream
 * `reportUnhandledError`, SD-21). The logged message is the original value.
 *
 * @since 0.1.0
 * @category Errors
 */
export const reportUnhandledError = (error: unknown): Effect.Effect<void> => Effect.logError(error)

/**
 * Runs a user callback that observes an actor — a `subscribe` callback, an `actor.on`
 * listener, an inspection function — so that what it throws, fails or dies with is reported
 * once (`reportUnhandledError`) and goes no further: the actor's status never changes for it
 * (SD-21, upstream `createActor.ts`). An interruption stays an interruption.
 *
 * @since 0.1.0
 * @category Errors
 */
export const isolateCallback = <R>(callback: () => Effect.Effect<void, unknown, R>): Effect.Effect<void, never, R> =>
  Effect.suspend(callback).pipe(
    Effect.catchCause((cause) => (Cause.hasInterruptsOnly(cause) ? Effect.interrupt : reportUnhandledError(Cause.squash(cause))))
  )
