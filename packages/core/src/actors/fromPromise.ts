/**
 * @since 0.1.0
 * @module actors/fromPromise
 *
 * Creates actor logic from a Promise-returning function (upstream `fromPromise`).
 *
 * The promise runs in the actor's own fiber and scope (D12): `start` returns while it is
 * pending, and a stop before it settles aborts its `signal`.
 */
import { Effect, Option, Predicate } from "effect"
import type { Scope } from "effect"
import type { Snapshot } from "../Snapshot.js"
import * as Snap from "../Snapshot.js"
import type { EventObject } from "../Event.js"
import type { ActorLogic, ActorScopeService, ActorSystemService } from "../ActorLogic.js"
import { ActorLogicTypeId, ActorScope } from "../ActorLogic.js"
import type { ActorRef } from "../ActorRef.js"
import type { Variance } from "../Types.js"
import { clearedInput } from "../internal/clearedInput.js"
import * as Outbox from "../internal/outbox.js"
import { isStopEvent } from "../internal/stopEvent.js"
import * as Persistence from "../persistence.js"

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

/** The event a resolved promise relays to its own actor (upstream `XSTATE_PROMISE_RESOLVE`). */
const XSTATE_PROMISE_RESOLVE = "xstate.promise.resolve"

/** The event a rejected promise relays to its own actor (upstream `XSTATE_PROMISE_REJECT`). */
const XSTATE_PROMISE_REJECT = "xstate.promise.reject"

/** What a settled promise relays to its own actor: upstream `{ type, data }`, plain data. */
interface PromiseSettledEvent extends EventObject {
  /** Which way the promise settled; `settle` reads it to pick `done` or `error`. */
  readonly type: typeof XSTATE_PROMISE_RESOLVE | typeof XSTATE_PROMISE_REJECT
  /** The resolved value, or the raw rejection reason (SD-4). */
  readonly data: unknown
}

/**
 * Snapshot for a promise actor (upstream `PromiseSnapshot`). `output` and `error` are
 * Options (D8). `input` is the actor's input while it is active, and `undefined` once its
 * promise settled or it stopped (upstream); an actor whose creator threw keeps it.
 *
 * @since 0.1.0
 * @category Actors
 */
export interface PromiseSnapshot<TOutput, TInput = unknown> extends Snapshot<TOutput> {
  /** The input while active; `undefined` once settled or stopped (`clearedInput`). */
  readonly input: TInput | undefined
}

/**
 * Actor logic created by `fromPromise` (upstream `PromiseActorLogic`).
 *
 * @since 0.1.0
 * @category Actors
 */
export type PromiseActorLogic<TOutput, TInput = unknown, TEmitted extends EventObject = EventObject> = ActorLogic<
  PromiseSnapshot<TOutput, TInput>,
  EventObject,
  TInput,
  TEmitted
>

/**
 * A reference to a promise actor, the type of `self` in the promise creator (upstream
 * `PromiseActorRef`).
 *
 * @since 0.1.0
 * @category Actors
 */
export type PromiseActorRef<TOutput> = ActorRef<PromiseSnapshot<TOutput>, EventObject>

/**
 * The argument of the promise creator (upstream `{ input, system, self, signal, emit }`).
 *
 * @since 0.1.0
 * @category Actors
 */
export interface PromiseActorInput<TInput, TOutput = unknown, TEmitted extends EventObject = EventObject> {
  /** The input given to the promise actor */
  readonly input: TInput
  /** The actor system the promise actor belongs to */
  readonly system: ActorSystemService
  /** The promise actor itself */
  readonly self: PromiseActorRef<TOutput>
  /** Aborted when the actor stops before the promise settles; a new one for each start */
  readonly signal: AbortSignal
  /** Delivers an event to the actor's `on` listeners and `emissions` at once */
  readonly emit: (emitted: TEmitted) => void
}

/**
 * The transition of promise logic (upstream `transition`). Only an active snapshot changes:
 * the resolve event gives status `done` with the output, the reject event status `error`
 * with the error, the stop event status `stopped`; each clears the input. An `undefined`
 * value is `None` (SD-7). Every other event changes nothing. The stop's abort is the actor's
 * scope closing (the `signal` of the start).
 */
const settle = <TOutput, TInput>(
  snapshot: PromiseSnapshot<TOutput, TInput>,
  event: EventObject
): PromiseSnapshot<TOutput, TInput> => {
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
    case XSTATE_PROMISE_RESOLVE:
      // The resolve event carries the value the promise of this logic resolved with; the
      // input is cleared, as upstream
      return { ...snapshot, status: "done", output: Option.fromUndefinedOr(event.data as TOutput), input: clearedInput }
    case XSTATE_PROMISE_REJECT:
      return { ...snapshot, status: "error", error: Option.fromUndefinedOr(event.data), input: clearedInput }
    default:
      return snapshot
  }
}

/**
 * Relays a settlement to the actor itself while the actor is still active (upstream
 * `system._relay(self, self, ...)` after its status check), so the actor's own processing
 * takes it as a macrostep. A stopped actor ignores it.
 */
const relayToSelf = (actorScope: ActorScopeService, event: PromiseSettledEvent): Effect.Effect<void> =>
  Effect.flatMap(actorScope.self.getSnapshotUntyped, (snapshot) =>
    snapshot.status === "active" ? actorScope.system.relay(actorScope.self, actorScope.self, event) : Effect.void
  )

/**
 * Calls the creator inside `start` and waits for its promise in a fiber of the actor's scope
 * (upstream `start`, D12): `start` returns while the promise is pending. What the creator
 * throws is a defect of `start`, which the actor makes its error at start with the raw value
 * and the snapshot it started from, so the input stays (upstream `start` catch). Each start
 * has its own `AbortController` (upstream `controllerMap`): a stop closes the scope, which
 * interrupts the fiber and aborts the signal while the promise is pending; a promise that
 * already settled is not aborted. `emit` is a plain function, so the creator can call it from
 * any code, its own synchronous code included; each call delivers the event at once through
 * the actor's outbox (upstream `actorScope.emit`). An emit after the actor stopped, or ended,
 * is dropped.
 */
const runPromise = <TOutput, TInput, TEmitted extends EventObject>(
  promiseCreator: (args: PromiseActorInput<TInput, TOutput, TEmitted>) => PromiseLike<TOutput>,
  input: TInput
): Effect.Effect<void, never, ActorScope | Scope.Scope> =>
  Effect.gen(function* () {
    const actorScope = yield* ActorScope
    const outbox = yield* Outbox.make
    const controller = new AbortController()
    const promise = yield* Effect.sync(() =>
      promiseCreator({
        input,
        system: actorScope.system,
        // The actor scope's `self` is this promise actor
        self: actorScope.self as PromiseActorRef<TOutput>,
        signal: controller.signal,
        emit: (event) => outbox.post(actorScope.emit(event)),
      })
    )
    yield* Effect.tryPromise({
      try: () => promise,
      // The raw rejection is the actor's error (SD-4)
      catch: (error) => error,
    }).pipe(
      Effect.onInterrupt(() => Effect.sync(() => controller.abort())),
      Effect.matchEffect({
        onSuccess: (output) => relayToSelf(actorScope, { type: XSTATE_PROMISE_RESOLVE, data: output }),
        onFailure: (error) => relayToSelf(actorScope, { type: XSTATE_PROMISE_REJECT, data: error }),
      }),
      Effect.forkScoped({ startImmediately: true })
    )
  })

/**
 * Creates actor logic from a Promise-returning function (upstream `fromPromise`).
 *
 * - The initial snapshot has status `active` and the input; reading it runs nothing.
 * - `start` calls the creator with `{ input, system, self, signal, emit }` and returns while
 *   the promise is pending; the promise runs in the actor's own fiber and scope (D12). A
 *   snapshot that is not active (a restored `done` or `error` one) runs nothing.
 * - When the promise resolves, the actor relays `xstate.promise.resolve` to itself and is
 *   done with `output` `Some(value)` (`None` for `undefined`, SD-7); its parent receives
 *   `xstate.done.actor.<id>`. A rejection relays `xstate.promise.reject` and gives status
 *   `error` with the raw value; the parent receives `xstate.error.actor.<id>` (SD-4). A done
 *   or rejected snapshot's `input` is `undefined` (upstream).
 * - A throw in the creator errors the actor inside `start`, with the raw value and the input
 *   kept (upstream `start` catch); its parent receives `xstate.error.actor.<id>`.
 * - A stop before the promise settles aborts `signal` and gives status `stopped` with the
 *   `input` `undefined` (upstream `xstate.stop`); a later settlement changes nothing. Each start has its own `AbortSignal`.
 * - Generic order follows upstream: `fromPromise<TOutput, TInput, TEmitted>` (SD-12).
 *
 * @example
 * ```ts
 * const fetchUser = fromPromise(async ({ input, signal }: { input: { userId: string }; signal: AbortSignal }) => {
 *   const response = await fetch(`/api/users/${input.userId}`, { signal })
 *   return response.json()
 * })
 * ```
 *
 * @since 0.1.0
 * @category Actors
 */
export const fromPromise = <TOutput, TInput = unknown, TEmitted extends EventObject = EventObject>(
  promiseCreator: (args: PromiseActorInput<TInput, TOutput, TEmitted>) => PromiseLike<TOutput>
): PromiseActorLogic<TOutput, TInput, TEmitted> => ({
  [ActorLogicTypeId]: makeActorLogicVariance<PromiseSnapshot<TOutput, TInput>, EventObject, TInput, TEmitted, never>(),

  config: promiseCreator,

  transition: (snapshot, event) => Effect.succeed(settle(snapshot, event)),

  getInitialSnapshot: (input) =>
    Effect.succeed<PromiseSnapshot<TOutput, TInput>>({
      [Snap.SnapshotTypeId]: Snap.SnapshotTypeId,
      status: "active",
      output: Option.none(),
      error: Option.none(),
      input,
    }),

  // An active snapshot holds the input it was created or restored with (upstream `input!`)
  start: (snapshot) => (snapshot.status === "active" ? runPromise(promiseCreator, snapshot.input as TInput) : Effect.void),

  // The persisted-snapshot codec (SD-7): `{ status, output, error, input }`, no Option objects
  getPersistedSnapshot: Persistence.persistLogicSnapshot,

  restoreSnapshot: (persisted) => Persistence.restoreLogicSnapshot<TOutput, TInput>(persisted),
})
