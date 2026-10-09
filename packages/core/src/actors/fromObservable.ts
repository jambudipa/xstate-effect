/**
 * @since 0.1.0
 * @module actors/fromObservable
 *
 * Creates actor logic from an Observable-like source (upstream `fromObservable` and
 * `fromEventObservable`) or from an Effect Stream (`fromStream`, a port extra).
 *
 * The subscription, or the stream, lives in the actor's own scope (D12): each value reaches the
 * snapshot through the actor's own processing, and a stop unsubscribes, or interrupts the stream.
 */
import { Cause, Effect, MutableRef, Option, Predicate, Stream } from "effect"
import type { Scope } from "effect"
import type { Snapshot } from "../Snapshot.js"
import * as Snap from "../Snapshot.js"
import type { EventObject } from "../Event.js"
import { ObservableNextEvent } from "../Event.js"
import type { ActorLogic, ActorScopeService, ActorSystemService } from "../ActorLogic.js"
import { ActorLogicTypeId, ActorScope } from "../ActorLogic.js"
import type { ActorRef } from "../ActorRef.js"
import { clearedInput } from "../internal/clearedInput.js"
import * as Outbox from "../internal/outbox.js"
import { isolateCallback } from "../internal/reportError.js"
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

/**
 * The observer object an interop observable calls (upstream `Observer`): the next value, the
 * error and the completion, each optional. The port's actors take no observer object (D6,
 * DEV-3); `fromObservable` and `fromEventObservable` hand one to the source they subscribe to.
 *
 * @example
 * ```ts
 * import type { Observer } from "@jambudipa/xstate-effect"
 *
 * const values: Array<number> = []
 * const collect: Observer<number> = { next: (value) => values.push(value) }
 * ```
 *
 * @since 0.1.0
 * @category Actors
 */
export type Observer<T> = {
  next?: (value: T) => void
  error?: (err: unknown) => void
  complete?: () => void
}

/**
 * Minimal Observable interface (compatible with RxJS, xstream, etc.)
 *
 * @since 0.1.0
 * @category Actors
 */
export interface Subscribable<T> {
  /**
   * Starts delivering values to `observer` and gives the handle that stops it. The actor calls
   * `unsubscribe` at most once, at its stop, and never after the source completed or errored;
   * what `subscribe` throws is the actor's error.
   */
  subscribe(observer: Observer<T>): { unsubscribe: () => void }
}

/**
 * Snapshot for an observable actor (upstream `ObservableSnapshot`: `{ status, output, error,
 * context, input }`). `context` is the last value the source emitted, as an Option (SD-17);
 * `output` and `error` are Options (D8). `input` is the actor's input while it is active, and
 * `undefined` once it is done, errored or stopped (upstream).
 *
 * @since 0.1.0
 * @category Actors
 */
export interface ObservableSnapshot<TContext, TInput = unknown> extends Snapshot<undefined> {
  /** The source's last value; `None` before the first value, and always for an event observable. */
  readonly context: Option.Option<TContext>
  /** The input while active; `undefined` once done, errored or stopped (`clearedInput`). */
  readonly input: TInput | undefined
}

/**
 * Actor logic created by `fromObservable` or `fromEventObservable` (upstream
 * `ObservableActorLogic`).
 *
 * @since 0.1.0
 * @category Actors
 */
export type ObservableActorLogic<TContext, TInput = unknown, TEmitted extends EventObject = EventObject> = ActorLogic<
  ObservableSnapshot<TContext, TInput>,
  EventObject,
  TInput,
  TEmitted
>

/**
 * A reference to an observable actor, the type of `self` in the creator (upstream
 * `ObservableActorRef`).
 *
 * @since 0.1.0
 * @category Actors
 */
export type ObservableActorRef<TContext> = ActorRef<ObservableSnapshot<TContext>, EventObject>

/**
 * Arguments provided to the observable creator (upstream `{ input, system, self, emit }`).
 *
 * @since 0.1.0
 * @category Actors
 */
export interface ObservableActorArgs<TInput, TContext = unknown, TEmitted extends EventObject = EventObject> {
  /** The input given to the observable actor */
  readonly input: TInput
  /** The actor system the observable actor belongs to */
  readonly system: ActorSystemService
  /** The observable actor itself */
  readonly self: ObservableActorRef<TContext>
  /** Delivers an event to the actor's `on` listeners and `emissions`, at once, from any code */
  readonly emit: (emitted: TEmitted) => void
}

/**
 * Arguments provided to the stream creator of `fromStream` (a port extra).
 *
 * @since 0.1.0
 * @category Actors
 */
export interface StreamActorArgs<TInput, TOutput = unknown> {
  /** The input given to the stream actor */
  readonly input: TInput
  /** The actor system the stream actor belongs to */
  readonly system: ActorSystemService
  /** The stream actor itself */
  readonly self: ObservableActorRef<TOutput>
}

/** The event a source's error relays to its own actor (upstream `XSTATE_OBSERVABLE_ERROR`). */
const XSTATE_OBSERVABLE_ERROR = "xstate.observable.error"

/** The event a source's completion relays to its own actor (upstream `XSTATE_OBSERVABLE_COMPLETE`). */
const XSTATE_OBSERVABLE_COMPLETE = "xstate.observable.complete"

/**
 * What a source relays to its own actor: upstream `{ type, data }` for a value
 * (`xstate.observable.next`) and an error, `{ type }` for the completion; plain data.
 */
type SourceEvent =
  | ObservableNextEvent
  | { readonly type: typeof XSTATE_OBSERVABLE_ERROR; readonly data: unknown }
  | { readonly type: typeof XSTATE_OBSERVABLE_COMPLETE }

/**
 * The transition of observable logic (upstream `transition`). Only an active snapshot changes:
 * a value becomes the context (when `takesValues`; an event observable keeps its context empty),
 * an error gives status `error` with the raw error, the completion gives status `done` with no
 * output, the stop event status `stopped`; each clears the input, as upstream. An `undefined`
 * value or error is `None` (SD-7). Every other event changes nothing. The stop's unsubscribe is
 * the actor's scope closing.
 */
const observe = <TContext, TInput>(
  snapshot: ObservableSnapshot<TContext, TInput>,
  event: EventObject,
  takesValues: boolean
): ObservableSnapshot<TContext, TInput> => {
  if (snapshot.status !== "active") {
    return snapshot
  }
  if (event.type === XSTATE_OBSERVABLE_COMPLETE) {
    return { ...snapshot, status: "done", input: clearedInput }
  }
  if (isStopEvent(event)) {
    return { ...snapshot, status: "stopped", input: clearedInput }
  }
  if (!Predicate.hasProperty(event, "data")) {
    return snapshot
  }
  switch (event.type) {
    case "xstate.observable.next":
      // The next event carries a value the source of this logic emitted
      return takesValues ? { ...snapshot, context: Option.fromUndefinedOr(event.data as TContext) } : snapshot
    case XSTATE_OBSERVABLE_ERROR:
      return { ...snapshot, status: "error", error: Option.fromUndefinedOr(event.data), input: clearedInput }
    default:
      return snapshot
  }
}

/**
 * Relays `event` to the actor itself while the actor is still active (upstream
 * `system._relay(self, self, ...)`), so the actor's own processing takes it as a macrostep. A
 * stopped, done or errored actor ignores it.
 */
const relayToSelf = (actorScope: ActorScopeService, event: SourceEvent): Effect.Effect<void> =>
  Effect.flatMap(actorScope.self.getSnapshotUntyped, (snapshot) =>
    snapshot.status === "active" ? actorScope.system.relay(actorScope.self, actorScope.self, event) : Effect.void
  )

/**
 * Relays an emitted event to the parent of the actor through the system (upstream
 * `fromEventObservable`: `system._relay(self, self._parent, value)`). An actor without a parent
 * relays nothing.
 */
const relayToParent = (actorScope: ActorScopeService, event: EventObject): Effect.Effect<void> =>
  Option.match(actorScope.self._parent, {
    onNone: () => Effect.void,
    onSome: (parent) => actorScope.system.relay(actorScope.self, parent, event),
  })

/**
 * Subscribes to the source of the creator in the actor's scope (upstream `start`, D12). The
 * observer and `emit` are plain functions, so the source can call them from any code; each call
 * runs its delivery at once through the actor's outbox, as upstream relays and emits inside the
 * call, so it never waits for another event. A value goes to `onNext`; an error or the
 * completion is relayed to the actor itself. A throw in the creator or in `subscribe` is the
 * actor's error, the raw value (SD-4).
 *
 * The stop closes the scope: the outbox closes (later calls are dropped) and the subscription is
 * unsubscribed once, unless the source already completed or errored (upstream drops that
 * subscription without unsubscribing). What `unsubscribe` throws is reported through the logger
 * (SD-21), never thrown into the stop.
 */
const subscribe = <TInput, TValue, TEmitted extends EventObject>(
  observableCreator: (args: ObservableActorArgs<TInput, TValue, TEmitted>) => Subscribable<TValue>,
  input: TInput,
  onNext: (actorScope: ActorScopeService, value: TValue) => Effect.Effect<void>
): Effect.Effect<void, never, ActorScope | Scope.Scope> =>
  Effect.gen(function* () {
    const actorScope = yield* ActorScope
    const outbox = yield* Outbox.make

    // Whether the source completed or errored, so that the stop does not unsubscribe from it
    const ended = MutableRef.make(false)
    const end = (deliver: Effect.Effect<void>): void => {
      MutableRef.set(ended, true)
      outbox.post(deliver)
    }

    yield* Effect.acquireRelease(
      Effect.sync(() =>
        observableCreator({
          input,
          // The actor scope's `self` is this observable actor
          self: actorScope.self as ObservableActorRef<TValue>,
          system: actorScope.system,
          emit: (event) => outbox.post(actorScope.emit(event)),
        }).subscribe({
          next: (value) => outbox.post(onNext(actorScope, value)),
          error: (error) => end(relayToSelf(actorScope, { type: XSTATE_OBSERVABLE_ERROR, data: error })),
          complete: () => end(relayToSelf(actorScope, { type: XSTATE_OBSERVABLE_COMPLETE })),
        })
      ),
      (subscription) =>
        MutableRef.get(ended) ? Effect.void : isolateCallback(() => Effect.sync(() => subscription.unsubscribe()))
    )
  })

/** The initial snapshot of observable and stream logic: active, no context yet. */
const initialSnapshot = <TContext, TInput>(input: TInput): ObservableSnapshot<TContext, TInput> => ({
  [Snap.SnapshotTypeId]: Snap.SnapshotTypeId,
  status: "active",
  output: Option.none(),
  error: Option.none(),
  context: Option.none(),
  input,
})

/**
 * The persisted form of observable and stream logic (upstream: all but the subscription),
 * through the persisted-snapshot codec (SD-7): `{ status, output, error, context, input }`,
 * no Option objects; the context goes through the same context codec as a machine's.
 */
const persist = Persistence.persistObservableSnapshot

/**
 * Creates actor logic from an Observable-like source (upstream `fromObservable`).
 *
 * - `start` calls the creator with `{ input, system, self, emit }` and subscribes, in the
 *   actor's own scope (D12). A `done` snapshot (a restored one) does not subscribe again.
 * - Each value the source emits becomes `snapshot.context`, as `Some(value)` (SD-17), and
 *   subscribers see it.
 * - The source's completion gives status `done` (output `None`); the parent receives one
 *   `xstate.done.actor.<id>`. Its error gives status `error` with the raw error; the parent
 *   receives one `xstate.error.actor.<id>` (SD-4). A done or errored snapshot's `input` is
 *   `undefined` (upstream).
 * - A stop unsubscribes once and gives status `stopped` with the `input` `undefined` (upstream
 *   `xstate.stop`); later values change nothing.
 * - `emit(event)` delivers the event to the actor's `on` listeners and `emissions`.
 * - Generic order follows upstream: `fromObservable<TContext, TInput, TEmitted>` (SD-12).
 *
 * @example
 * ```ts
 * import { interval } from 'rxjs'
 * import { take } from 'rxjs/operators'
 *
 * const tickerActor = fromObservable(({ input }) =>
 *   interval(input.intervalMs).pipe(take(10))
 * )
 * ```
 *
 * @since 0.1.0
 * @category Actors
 */
export const fromObservable = <TContext, TInput = unknown, TEmitted extends EventObject = EventObject>(
  observableCreator: (args: ObservableActorArgs<TInput, TContext, TEmitted>) => Subscribable<TContext>
): ObservableActorLogic<TContext, TInput, TEmitted> => ({
  [ActorLogicTypeId]: makeActorLogicVariance<ObservableSnapshot<TContext, TInput>, EventObject, TInput, TEmitted, never>(),

  config: observableCreator,

  transition: (snapshot, event) => Effect.succeed(observe(snapshot, event, true)),

  getInitialSnapshot: (input) => Effect.succeed(initialSnapshot<TContext, TInput>(input)),

  start: (snapshot) =>
    snapshot.status === "done"
      ? Effect.void
      : // A snapshot that is not done holds the input it was created or restored with
        subscribe(observableCreator, snapshot.input as TInput, (actorScope, value) =>
          relayToSelf(actorScope, new ObservableNextEvent({ data: value }))
        ),

  getPersistedSnapshot: persist,

  restoreSnapshot: (persisted) => Persistence.restoreObservableSnapshot<TContext, TInput>(persisted),
})

/**
 * Creates actor logic from an Observable-like source of event objects (upstream
 * `fromEventObservable`): each event the source emits is relayed to the actor's parent, through
 * the system. The context stays `None`; the completion, an error and a stop work as in
 * `fromObservable`. Generic order follows upstream: `fromEventObservable<TEvent, TInput,
 * TEmitted>`.
 *
 * @example
 * ```ts
 * import { fromEvent } from 'rxjs'
 *
 * const clicks = fromEventObservable(() => fromEvent(document.body, 'click') as Subscribable<EventObject>)
 * ```
 *
 * @since 0.1.0
 * @category Actors
 */
export const fromEventObservable = <TEvent extends EventObject, TInput = unknown, TEmitted extends EventObject = EventObject>(
  lazyObservable: (args: ObservableActorArgs<TInput, TEvent, TEmitted>) => Subscribable<TEvent>
): ObservableActorLogic<TEvent, TInput, TEmitted> => ({
  [ActorLogicTypeId]: makeActorLogicVariance<ObservableSnapshot<TEvent, TInput>, EventObject, TInput, TEmitted, never>(),

  config: lazyObservable,

  transition: (snapshot, event) => Effect.succeed(observe(snapshot, event, false)),

  getInitialSnapshot: (input) => Effect.succeed(initialSnapshot<TEvent, TInput>(input)),

  start: (snapshot) =>
    snapshot.status === "done" ? Effect.void : subscribe(lazyObservable, snapshot.input as TInput, relayToParent),

  getPersistedSnapshot: persist,

  restoreSnapshot: (persisted) => Persistence.restoreObservableSnapshot<TEvent, TInput>(persisted),
})

/**
 * Runs the stream in a fiber of the actor's scope (D12). The fiber starts at once, so the
 * creator runs inside `start`; `start` returns while the stream runs. Each element is relayed to
 * the actor itself as a value, the end as the completion, a failure or a defect as an error with
 * the raw value (SD-4). A stop closes the scope, which interrupts the stream.
 */
const runStream = <TInput, TOutput, E, R>(
  streamCreator: (args: StreamActorArgs<TInput, TOutput>) => Stream.Stream<TOutput, E, R>,
  input: TInput
): Effect.Effect<void, never, ActorScope | Scope.Scope | R> =>
  Effect.gen(function* () {
    const actorScope = yield* ActorScope
    const stream = yield* Effect.sync(() =>
      // The actor scope's `self` is this stream actor
      streamCreator({ input, self: actorScope.self as ObservableActorRef<TOutput>, system: actorScope.system })
    )
    yield* Stream.runForEach(stream, (value) => relayToSelf(actorScope, new ObservableNextEvent({ data: value }))).pipe(
      Effect.matchCauseEffect({
        onSuccess: () => relayToSelf(actorScope, { type: XSTATE_OBSERVABLE_COMPLETE }),
        onFailure: (cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : relayToSelf(actorScope, { type: XSTATE_OBSERVABLE_ERROR, data: Cause.squash(cause) }),
      }),
      Effect.forkScoped({ startImmediately: true })
    )
  })

/**
 * Creates actor logic from an Effect Stream (a port extra).
 *
 * - `start` calls the creator with `{ input, system, self }` and runs the stream in the actor's
 *   own scope (D12); it returns while the stream runs. A `done` snapshot runs nothing.
 * - Each element becomes `snapshot.context`, as `Some(element)` (SD-17).
 * - The end of the stream gives status `done` (output `None`); a failure or a defect gives
 *   status `error` with the raw value (SD-4). The parent receives one done or error event.
 * - A stop interrupts the stream, so its finalizers run once, and gives status `stopped`, as
 *   for observable logic.
 *
 * @example
 * ```ts
 * const tickerActor = fromStream(({ input }) =>
 *   Stream.fromSchedule(Schedule.spaced(Duration.seconds(1))).pipe(
 *     Stream.take(input.count)
 *   )
 * )
 * ```
 *
 * @since 0.1.0
 * @category Actors
 */
export const fromStream = <TInput, TOutput, E, R>(
  streamCreator: (args: StreamActorArgs<TInput, TOutput>) => Stream.Stream<TOutput, E, R>
): ActorLogic<ObservableSnapshot<TOutput, TInput>, EventObject, TInput, never, R> => ({
  [ActorLogicTypeId]: makeActorLogicVariance<ObservableSnapshot<TOutput, TInput>, EventObject, TInput, never, R>(),

  config: streamCreator,

  transition: (snapshot, event) => Effect.succeed(observe(snapshot, event, true)),

  getInitialSnapshot: (input) => Effect.succeed(initialSnapshot<TOutput, TInput>(input)),

  start: (snapshot) => (snapshot.status === "done" ? Effect.void : runStream(streamCreator, snapshot.input as TInput)),

  getPersistedSnapshot: persist,

  restoreSnapshot: (persisted) => Persistence.restoreObservableSnapshot<TOutput, TInput>(persisted),
})
