/**
 * @since 0.1.0
 * @module actors/fromEffect
 *
 * Creates actor logic from an Effect (port extras: `fromEffect`, `fromEffectBackground`,
 * `fromEffectRetry`).
 *
 * The Effect runs in the actor's own fiber and scope (D12): `start` returns while it runs, its
 * result reaches the snapshot through the actor's own processing, and a stop interrupts it, so
 * its finalizers run. The Effect's requirements become the logic's requirements, which
 * `createActor` asks of its caller (SD-8).
 */
import { Cause, Effect, Option, Predicate } from "effect"
import type { Schedule, Scope } from "effect"
import type { Snapshot } from "../Snapshot.js"
import * as Snap from "../Snapshot.js"
import type { EventObject } from "../Event.js"
import type { ActorLogic, ActorScopeService, ActorSystemService } from "../ActorLogic.js"
import { ActorLogicTypeId, ActorScope } from "../ActorLogic.js"
import type { ActorRef } from "../ActorRef.js"
import { clearedInput } from "../internal/clearedInput.js"
import { isStopEvent } from "../internal/stopEvent.js"
import * as Persistence from "../persistence.js"
import type { Variance } from "../Types.js"

/**
 * Creates variance markers for ActorLogic TypeId.
 * @internal
 */
const makeActorLogicVariance = <
  TSnapshot extends Snapshot,
  TEvent extends EventObject,
  TInput,
  TEmitted extends EventObject,
  R
>(): Variance.ActorLogic<TSnapshot, TEvent, TInput, TEmitted, R> => ({
  _Snapshot: (_: TSnapshot): TSnapshot => _,
  _Event: (_: TEvent): TEvent => _,
  _Input: (_: TInput) => _,
  _Emitted: (_: never): TEmitted => _,
  _R: (_: never): R => _,
})

/** The event a successful Effect relays to its own actor (port, after `xstate.promise.resolve`). */
const XSTATE_EFFECT_SUCCESS = "xstate.effect.success"

/** The event a failed Effect relays to its own actor (port, after `xstate.promise.reject`). */
const XSTATE_EFFECT_FAILURE = "xstate.effect.failure"

/** What an ended Effect relays to its own actor: `{ type, data }`, plain data. */
interface EffectEndedEvent extends EventObject {
  readonly type: typeof XSTATE_EFFECT_SUCCESS | typeof XSTATE_EFFECT_FAILURE
  readonly data: unknown
}

/**
 * Snapshot for an effect actor. `output` and `error` are Options (D8). `input` is the actor's
 * input while it is active, and `undefined` once it is done, errored or stopped, as for
 * promise logic (upstream `PromiseSnapshot`).
 *
 * @since 0.1.0
 * @category Actors
 */
export interface EffectSnapshot<TOutput, TInput = unknown> extends Snapshot<TOutput> {
  readonly input: TInput | undefined
}

/**
 * Actor logic created by `fromEffect`, `fromEffectBackground` or `fromEffectRetry`; `R` is
 * what the Effect requires.
 *
 * @since 0.1.0
 * @category Actors
 */
export type EffectActorLogic<TOutput, TInput = unknown, TEmitted extends EventObject = EventObject, R = never> = ActorLogic<
  EffectSnapshot<TOutput, TInput>,
  EventObject,
  TInput,
  TEmitted,
  R
>

/**
 * A reference to an effect actor, the type of `self` in the effect creator.
 *
 * @since 0.1.0
 * @category Actors
 */
export type EffectActorRef<TOutput> = ActorRef<EffectSnapshot<TOutput>, EventObject>

/**
 * Arguments provided to the effect creator: `{ input, system, self, emit }`, as the other
 * logics' creators get them.
 *
 * @since 0.1.0
 * @category Actors
 */
export interface EffectActorArgs<TInput, TOutput = unknown, TEmitted extends EventObject = EventObject> {
  /** The input given to the effect actor */
  readonly input: TInput
  /** The actor system the effect actor belongs to */
  readonly system: ActorSystemService
  /** The effect actor itself */
  readonly self: EffectActorRef<TOutput>
  /**
   * Delivers an event to the actor's `on` listeners and `emissions` at once, inside the Effect
   * that runs it (upstream `actorScope.emit`), so the events reach them in order.
   */
  readonly emit: (emitted: TEmitted) => Effect.Effect<void>
}

/**
 * The transition of effect logic. Only an active snapshot changes: the success event gives
 * status `done` with the output (when `completes`; background logic ignores it), the failure
 * event status `error` with the raw failure, the stop event status `stopped`; each clears the
 * input, as promise logic does. An `undefined` value is `None` (SD-7). Every other event
 * changes nothing.
 */
const settle = <TOutput, TInput>(
  snapshot: EffectSnapshot<TOutput, TInput>,
  event: EventObject,
  completes: boolean
): EffectSnapshot<TOutput, TInput> => {
  if (snapshot.status !== "active") {
    return snapshot
  }
  if (isStopEvent(event)) {
    return { ...snapshot, status: "stopped", input: clearedInput }
  }
  if (!Predicate.hasProperty(event, "data")) {
    return snapshot
  }
  switch (event.type) {
    case XSTATE_EFFECT_SUCCESS:
      // The success event carries the value the Effect of this logic succeeded with
      return completes
        ? { ...snapshot, status: "done", output: Option.fromUndefinedOr(event.data as TOutput), input: clearedInput }
        : snapshot
    case XSTATE_EFFECT_FAILURE:
      return { ...snapshot, status: "error", error: Option.fromUndefinedOr(event.data), input: clearedInput }
    default:
      return snapshot
  }
}

/**
 * Relays the end of the Effect to the actor itself while the actor is still active, so the
 * actor's own processing takes it as a macrostep (as `fromPromise` does). A stopped actor
 * ignores it.
 */
const relayToSelf = (actorScope: ActorScopeService, event: EffectEndedEvent): Effect.Effect<void> =>
  Effect.flatMap(actorScope.self.getSnapshotUntyped, (snapshot) =>
    snapshot.status === "active" ? actorScope.system.relay(actorScope.self, actorScope.self, event) : Effect.void
  )

/**
 * Runs the creator's Effect in a fiber of the actor's scope (D12). The fiber starts at once, so
 * the creator runs inside `start`; `start` returns while the Effect runs. A success is relayed
 * to the actor itself when `completes`; a typed failure, a defect or a throw in the creator is
 * relayed as the failure, the raw value (`Cause.squash`, SD-4); an interruption relays nothing.
 * A stop closes the scope, which interrupts the fiber, so the Effect's finalizers run.
 */
const runEffect = <TInput, TOutput, E, R, TEmitted extends EventObject>(
  effectCreator: (args: EffectActorArgs<TInput, TOutput, TEmitted>) => Effect.Effect<unknown, E, R>,
  input: TInput,
  completes: boolean
): Effect.Effect<void, never, ActorScope | Scope.Scope | R> =>
  Effect.gen(function* () {
    const actorScope = yield* ActorScope
    yield* Effect.suspend(() =>
      effectCreator({
        input,
        system: actorScope.system,
        // The actor scope's `self` is this effect actor
        self: actorScope.self as EffectActorRef<TOutput>,
        emit: actorScope.emit,
      })
    ).pipe(
      Effect.matchCauseEffect({
        onSuccess: (output) => (completes ? relayToSelf(actorScope, { type: XSTATE_EFFECT_SUCCESS, data: output }) : Effect.void),
        onFailure: (cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : relayToSelf(actorScope, { type: XSTATE_EFFECT_FAILURE, data: Cause.squash(cause) }),
      }),
      Effect.forkScoped({ startImmediately: true })
    )
  })

/**
 * Builds the logic of `fromEffect` and `fromEffectBackground`: an active initial snapshot with
 * the input, and `start` running the Effect for an active snapshot only (a restored `done` or
 * `error` one runs nothing).
 */
const makeEffectLogic = <TInput, TOutput, E, R, TEmitted extends EventObject>(
  effectCreator: (args: EffectActorArgs<TInput, TOutput, TEmitted>) => Effect.Effect<unknown, E, R>,
  completes: boolean
): EffectActorLogic<TOutput, TInput, TEmitted, R> => ({
  [ActorLogicTypeId]: makeActorLogicVariance<EffectSnapshot<TOutput, TInput>, EventObject, TInput, TEmitted, R>(),

  config: effectCreator,

  transition: (snapshot, event) => Effect.succeed(settle(snapshot, event, completes)),

  getInitialSnapshot: (input) =>
    Effect.succeed<EffectSnapshot<TOutput, TInput>>({
      [Snap.SnapshotTypeId]: Snap.SnapshotTypeId,
      status: "active",
      output: Option.none(),
      error: Option.none(),
      input,
    }),

  // An active snapshot holds the input it was created or restored with
  start: (snapshot) =>
    snapshot.status === "active" ? runEffect(effectCreator, snapshot.input as TInput, completes) : Effect.void,

  // The persisted-snapshot codec (SD-7): `{ status, output, error, input }`, no Option objects
  getPersistedSnapshot: Persistence.persistLogicSnapshot,

  restoreSnapshot: (persisted) => Persistence.restoreLogicSnapshot<TOutput, TInput>(persisted),
})

/**
 * Creates actor logic from an Effect, the Effect-native actor type.
 *
 * - The initial snapshot has status `active` and the input; reading it runs nothing.
 * - `start` calls the creator with `{ input, system, self, emit }` and runs the Effect in the
 *   actor's own fiber and scope (D12); it returns while the Effect runs.
 * - A success gives status `done` with `output` `Some(value)` (`None` for `undefined`, SD-7);
 *   the parent receives `xstate.done.actor.<id>`. A typed failure, a defect or a throw in the
 *   creator gives status `error` with the raw value; the parent receives
 *   `xstate.error.actor.<id>` (SD-4). A done, errored or stopped snapshot's `input` is
 *   `undefined`, as for promise logic.
 * - A stop interrupts the Effect, so its finalizers run, and gives status `stopped`; no done
 *   event is sent.
 * - The Effect's requirements `R` are the logic's: `createActor` asks them of its caller and the
 *   Effect reads them at `start` (SD-8).
 *
 * @example
 * ```ts
 * const fetchUserActor = fromEffect(({ input }: { input: { userId: string } }) =>
 *   Effect.gen(function* () {
 *     const response = yield* HttpClient.get(`/api/users/${input.userId}`)
 *     return yield* response.json
 *   })
 * )
 * ```
 *
 * @since 0.1.0
 * @category Actors
 */
export const fromEffect = <TInput, TOutput, E, R, TEmitted extends EventObject = EventObject>(
  effectCreator: (args: EffectActorArgs<TInput, TOutput, TEmitted>) => Effect.Effect<TOutput, E, R>
): EffectActorLogic<TOutput, TInput, TEmitted, R> => makeEffectLogic(effectCreator, true)

/**
 * Creates actor logic from an Effect that runs in the background of the actor.
 *
 * Unlike `fromEffect`, the actor does not complete when the Effect returns: it stays `active`
 * until it is stopped. The Effect gets the actor's input and runs in the actor's own fiber and
 * scope (D12), so a stop interrupts it and runs its finalizers. A typed failure or a defect of
 * the Effect gives status `error` with the raw value; the parent receives
 * `xstate.error.actor.<id>` (SD-4).
 *
 * @example
 * ```ts
 * const pollerActor = fromEffectBackground(({ input }: { input: { url: string } }) =>
 *   Effect.gen(function* () {
 *     while (true) {
 *       yield* fetchData(input.url)
 *       yield* Effect.sleep(Duration.seconds(30))
 *     }
 *   })
 * )
 * ```
 *
 * @since 0.1.0
 * @category Actors
 */
export const fromEffectBackground = <TInput, TOutput, E, R, TEmitted extends EventObject = EventObject>(
  effectCreator: (args: EffectActorArgs<TInput, undefined, TEmitted>) => Effect.Effect<TOutput, E, R>
): EffectActorLogic<undefined, TInput, TEmitted, R> => makeEffectLogic(effectCreator, false)

/**
 * Creates actor logic from an Effect with retry capabilities: `fromEffect` with
 * `Effect.retry(schedule)`. Each failed attempt is retried while the schedule allows; the first
 * success gives status `done`, the last failure status `error`. A stop interrupts the running
 * attempt or the wait between attempts. The services the schedule needs join the logic's
 * requirements.
 *
 * @example
 * ```ts
 * const resilientFetchActor = fromEffectRetry(
 *   ({ input }: { input: { url: string } }) => fetchData(input.url),
 *   Schedule.recurs(3).pipe(Schedule.addDelay(() => Effect.succeed(Duration.seconds(1))))
 * )
 * ```
 *
 * @since 0.1.0
 * @category Actors
 */
export const fromEffectRetry = <TInput, TOutput, E, R, O, SE, SR, TEmitted extends EventObject = EventObject>(
  effectCreator: (args: EffectActorArgs<TInput, TOutput, TEmitted>) => Effect.Effect<TOutput, E, R>,
  schedule: Schedule.Schedule<O, NoInfer<E>, SE, SR>
): EffectActorLogic<TOutput, TInput, TEmitted, R | SR> =>
  makeEffectLogic((args: EffectActorArgs<TInput, TOutput, TEmitted>) => Effect.retry(effectCreator(args), schedule), true)
