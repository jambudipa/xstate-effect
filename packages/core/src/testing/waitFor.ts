/**
 * @since 0.1.0
 * @module testing/waitFor
 *
 * Utility to wait for an actor to reach a specific state.
 */
import { Data, Deferred, Duration, Effect, Option, Stream } from "effect"
import type { Snapshot } from "../Snapshot.js"
import type { Actor } from "../Actor.js"
import type { EventObject } from "../Event.js"

/**
 * Error thrown when waitFor times out. Its message is upstream's rejection text
 * (`Timeout of <timeout> ms exceeded`).
 *
 * @since 0.1.0
 * @category Errors
 */
export class WaitForTimeoutError extends Data.TaggedError("WaitForTimeoutError")<{
  readonly timeout: number
}> {
  /** Upstream's rejection text, with the timeout in milliseconds. */
  override get message() {
    return `Timeout of ${this.timeout} ms exceeded`
  }
}

/**
 * Error thrown when actor terminates without satisfying predicate.
 *
 * @since 0.1.0
 * @category Errors
 */
export class WaitForTerminatedError extends Data.TaggedError("WaitForTerminatedError")<{}> {
  /** Upstream's rejection text for an actor that is done or stopped before the predicate holds. */
  override get message() {
    return "Actor terminated without satisfying predicate"
  }
}

/**
 * Options for waitFor.
 *
 * @since 0.1.0
 * @category Testing
 */
export interface WaitForOptions {
  /**
   * How long to wait before failing with {@link WaitForTimeoutError}, on the Effect clock
   * (SD-28); a number is milliseconds. A negative timeout is reported through the logger and
   * fails at once, unless the current snapshot satisfies the predicate (upstream).
   * @default Duration.infinity
   */
  readonly timeout?: Duration.Input
  /**
   * A signal that ends the wait when it is aborted (upstream `signal`): `waitFor` fails with
   * the signal's reason, at once when the signal is aborted already.
   */
  readonly signal?: AbortSignal
}

/** Upstream's `console.error` text for a negative `timeout` (`src/waitFor.ts`). */
const negativeTimeoutMessage =
  "`timeout` passed to `waitFor` is negative and it will reject its internal promise immediately."

/**
 * Runs `wait` until `signal` aborts, which ends it with the signal's reason (upstream
 * `abortListener`). The 'abort' listener is added once and removed once, whichever way the
 * wait ends.
 */
const untilAborted = <A, E>(signal: AbortSignal, wait: Effect.Effect<A, E>): Effect.Effect<A, unknown> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const aborted = Deferred.makeUnsafe<never, unknown>()
      const abortWith = (): void => {
        // XState does not own the signal, so the wait ends with its reason, whatever it is
        const reason: unknown = signal.reason
        Deferred.doneUnsafe(aborted, Effect.fail(reason))
      }
      signal.addEventListener("abort", abortWith)
      // An abort between the first check and the listener is not missed
      if (signal.aborted) {
        abortWith()
      }
      return { aborted, abortWith }
    }),
    ({ aborted }) => Effect.raceFirst(wait, Deferred.await(aborted)),
    ({ abortWith }) => Effect.sync(() => signal.removeEventListener("abort", abortWith))
  )

/**
 * Waits for an actor's snapshot to satisfy a predicate (upstream `waitFor`).
 *
 * This is the Effect-native version that returns an Effect instead of a Promise. In upstream
 * order, it fails at once with the reason of a `signal` that is aborted already, then gives
 * the current snapshot when it satisfies the predicate, without reading the actor's `changes`
 * and without listening to the signal. Otherwise it reads `changes` and gives the first later
 * snapshot that satisfies the predicate (a snapshot with status `stopped` is never checked:
 * upstream observers receive none). It fails with {@link WaitForTerminatedError} when the actor
 * is done or stopped first (also when it has ended already), with the actor's own error when
 * the actor errors, with {@link WaitForTimeoutError} when the `timeout` elapses on the Effect
 * clock first (SD-28), and with the signal's reason when the signal aborts first. Whichever
 * way it ends, it leaves no fiber, subscription or 'abort' listener behind.
 *
 * @example
 * ```ts
 * const snapshot = yield* waitFor(
 *   actor,
 *   (snapshot) => snapshot.matches("success"),
 *   { timeout: Duration.seconds(5) }
 * )
 * ```
 *
 * @since 0.1.0
 * @category Testing
 */
export const waitFor = <
  TSnapshot extends Snapshot,
  TEvent extends EventObject,
  TEmitted extends EventObject = EventObject
>(
  actor: Actor<TSnapshot, TEvent, TEmitted>,
  predicate: (snapshot: TSnapshot) => boolean,
  options?: WaitForOptions
): Effect.Effect<TSnapshot, unknown> =>
  Effect.gen(function* () {
    const signal = Option.fromNullishOr(options?.signal)
    if (Option.isSome(signal) && signal.value.aborted) {
      const reason: unknown = signal.value.reason
      return yield* Effect.fail(reason)
    }

    const timeout = Duration.fromInputUnsafe(options?.timeout ?? Duration.infinity)
    if (Duration.isNegative(timeout)) {
      yield* Effect.logError(negativeTimeoutMessage)
    }

    // See if the current snapshot already matches the predicate
    const current = yield* actor.getSnapshot
    if (predicate(current)) {
      return current
    }

    // The stream gives the current snapshot first: it was checked above when no snapshot came
    // in between. Its end without a match is the actor's end; its failure, the actor's error
    const firstMatch = actor.changes.pipe(
      Stream.zipWithIndex,
      Stream.filter(
        ([snapshot, index]) =>
          !(index === 0 && snapshot === current) && snapshot.status !== "stopped" && predicate(snapshot)
      ),
      Stream.runHead,
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(new WaitForTerminatedError()),
          onSome: ([snapshot]) => Effect.succeed(snapshot),
        })
      )
    )

    const timeoutMillis = Duration.toMillis(timeout)
    const bounded: Effect.Effect<TSnapshot, unknown> =
      timeoutMillis === Infinity
        ? firstMatch
        : Effect.raceFirst(
            firstMatch,
            Effect.andThen(Effect.sleep(timeout), Effect.fail(new WaitForTimeoutError({ timeout: timeoutMillis })))
          )

    return yield* Option.match(signal, {
      onNone: () => bounded,
      onSome: (abortSignal) => untilAborted(abortSignal, bounded),
    })
  })

/**
 * Promise-based version of waitFor for compatibility with non-Effect code. It rejects with
 * what {@link waitFor} fails with.
 *
 * @example
 * ```ts
 * const snapshot = await waitForPromise(
 *   actor,
 *   (snapshot) => snapshot.matches("success"),
 *   { timeout: 5000 }
 * )
 * ```
 *
 * @since 0.1.0
 * @category Testing
 */
export const waitForPromise = <
  TSnapshot extends Snapshot,
  TEvent extends EventObject,
  TEmitted extends EventObject = EventObject
>(
  actor: Actor<TSnapshot, TEvent, TEmitted>,
  predicate: (snapshot: TSnapshot) => boolean,
  options?: { readonly timeout?: number; readonly signal?: AbortSignal }
): Promise<TSnapshot> => Effect.runPromise(waitFor(actor, predicate, options))
