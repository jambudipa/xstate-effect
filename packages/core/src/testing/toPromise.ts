/**
 * @since 0.1.0
 * @module testing/toPromise
 *
 * Converts an actor's output to a Promise or Effect.
 */
import { Data, Effect, Stream } from "effect"
import type { Snapshot } from "../Snapshot.js"

/**
 * Error thrown when actor errors instead of completing. `toEffect` and `toPromise` no longer
 * fail with it: they fail with the actor's own error (SD-19).
 *
 * @since 0.1.0
 * @category Errors
 */
export class ActorOutputError extends Data.TaggedError("ActorOutputError")<{
  readonly cause: unknown
}> {
  override get message() {
    return "Actor errored before producing output"
  }
}

/**
 * What `toEffect` and `toPromise` read from an actor: the stream of its snapshots (an
 * `Actor`'s `changes`), which ends when the actor is done or stopped and fails with the
 * actor's error, and its live snapshot. Every `Actor` and an `AnyActor` fit it (upstream
 * `toPromise` takes any actor reference).
 *
 * @since 0.1.0
 * @category Models
 */
export interface SnapshotSource<TSnapshot extends Snapshot> {
  readonly getSnapshot: Effect.Effect<TSnapshot>
  readonly changes: Stream.Stream<TSnapshot, unknown>
}

/**
 * Waits for an actor to complete and returns its output as an Effect (upstream `toPromise`,
 * SD-19). Once the actor's `changes` stream ends (the actor is done or stopped, also when it
 * ended before the call) it succeeds with the `output` of the actor's snapshot as stored: an
 * `Option` (D8), `Some` for a done actor and `None` for a stopped one. When the actor errors
 * (also before the call) it fails with the actor's original error. An actor that has not
 * started yet is waited for until it ends. Upstream waits for ever on an actor that is
 * stopped already or stopped before `start`; here the wait ends with `None` (ledger row
 * DEV-42). The stream runs in the caller's fiber, so nothing of it remains once the Effect
 * completes.
 *
 * @example
 * ```ts
 * const output = yield* toEffect(actor)
 * ```
 *
 * @since 0.1.0
 * @category Testing
 */
export const toEffect = <TSnapshot extends Snapshot>(
  actor: SnapshotSource<TSnapshot>
): Effect.Effect<TSnapshot["output"], unknown> =>
  // Upstream resolves `actor.getSnapshot().output` on the observer's `complete`
  Effect.andThen(
    Stream.runDrain(actor.changes),
    Effect.map(actor.getSnapshot, (snapshot) => snapshot.output)
  )

/**
 * Waits for an actor to complete and returns its output as a Promise.
 *
 * This is the XState-compatible version that returns a Promise. It resolves with the value
 * {@link toEffect} succeeds with and rejects with the actor's original error (SD-19).
 *
 * @example
 * ```ts
 * const actor = yield* createActor(machine)
 * yield* actor.start
 *
 * const output = yield* Effect.promise(() => toPromise(actor))
 * console.log(output) // Option.some(the actor's output)
 * ```
 *
 * @since 0.1.0
 * @category Testing
 */
export const toPromise = <TSnapshot extends Snapshot>(
  actor: SnapshotSource<TSnapshot>
): Promise<TSnapshot["output"]> => Effect.runPromise(toEffect(actor))
