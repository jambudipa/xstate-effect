/**
 * @since 0.1.0
 * @module actors/fromCallback
 *
 * Creates actor logic from a callback-based function (upstream `fromCallback`).
 *
 * The callback runs at `start`, in the actor's own scope (D12): its `sendBack` and `emit` work
 * from any code, a timer included, and its cleanup runs once when the actor stops.
 */
import { Effect, MutableRef, Option } from "effect"
import type { Scope } from "effect"
import type { Snapshot } from "../Snapshot.js"
import * as Snap from "../Snapshot.js"
import type { EventObject } from "../Event.js"
import type { ActorLogic, ActorScopeService, ActorSystemService } from "../ActorLogic.js"
import { ActorLogicTypeId, ActorScope } from "../ActorLogic.js"
import type { ActorRef, ActorRefBase } from "../ActorRef.js"
import type { AnyEventObject } from "../internal/anyEventObject.js"
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
 * Snapshot for a callback actor (upstream `CallbackSnapshot`: `{ status, output, error, input }`).
 * `output` and `error` are Options (D8).
 *
 * @since 0.1.0
 * @category Actors
 */
export interface CallbackSnapshot<TInput = unknown> extends Snapshot<undefined> {
  readonly input: TInput
}

/**
 * Actor logic created by `fromCallback` (upstream `CallbackActorLogic`).
 *
 * @since 0.1.0
 * @category Actors
 */
export type CallbackActorLogic<TEvent extends EventObject, TInput = unknown, TEmitted extends EventObject = EventObject> = ActorLogic<
  CallbackSnapshot<TInput>,
  TEvent,
  TInput,
  TEmitted
>

/**
 * A reference to a callback actor, the type of `self` in the callback (upstream
 * `CallbackActorRef`).
 *
 * @since 0.1.0
 * @category Actors
 */
export type CallbackActorRef<TEvent extends EventObject, TInput = unknown> = ActorRef<CallbackSnapshot<TInput>, TEvent>

/** A receive listener of a callback actor. */
type Receiver<TEvent extends EventObject> = (event: TEvent) => void

/**
 * The argument of the callback (upstream `{ input, system, self, sendBack, receive, emit }`).
 *
 * @since 0.1.0
 * @category Actors
 */
export interface CallbackActorArgs<
  TEvent extends EventObject,
  TInput,
  TEmitted extends EventObject = EventObject,
  TSentEvent extends EventObject = AnyEventObject
> {
  /** The input given to the callback actor */
  readonly input: TInput
  /** The actor system the callback actor belongs to */
  readonly system: ActorSystemService
  /** The callback actor itself */
  readonly self: CallbackActorRef<TEvent>
  /**
   * Sends an event to the parent through the system, at once, from any code. `fromCallback`
   * takes an event with any other members (upstream `AnyEventObject`).
   */
  readonly sendBack: (event: TSentEvent) => void
  /**
   * Adds a listener for the events the actor receives; each listener runs once per event. The
   * listener's parameter is bivariant, as upstream's `Receiver`.
   */
  readonly receive: (listener: { bivarianceHack(event: TEvent): void }["bivarianceHack"]) => void
  /** Delivers an event to the actor's listeners, at once, from any code */
  readonly emit: (emitted: TEmitted) => void
}

/**
 * The function `fromCallback` takes (upstream `CallbackLogicFunction`). It may return a cleanup
 * function, which runs once when the actor stops.
 *
 * @since 0.1.0
 * @category Actors
 */
export type CallbackLogicFunction<
  TEvent extends EventObject = EventObject,
  TSentEvent extends EventObject = AnyEventObject,
  TInput = unknown,
  TEmitted extends EventObject = EventObject
> = (args: CallbackActorArgs<TEvent, TInput, TEmitted, TSentEvent>) => (() => void) | void

/** The receive listeners of each running callback actor of one logic, keyed by the actor itself. */
type Instances<TEvent extends EventObject> = WeakMap<ActorRefBase, MutableRef.MutableRef<ReadonlyArray<Receiver<TEvent>>>>

/** The listeners `self` has added, in order; none for an actor that is not running. */
const receiversOf = <TEvent extends EventObject>(
  instances: Instances<TEvent>,
  self: ActorRefBase
): ReadonlyArray<Receiver<TEvent>> =>
  Option.match(Option.fromUndefinedOr(instances.get(self)), {
    onNone: () => [],
    onSome: MutableRef.get,
  })

/**
 * Sends `event` to the parent of the actor through the system (upstream `sendBack`:
 * `system._relay(self, self._parent, event)`), unless the actor is stopped. An actor without a
 * parent sends nothing.
 */
const relayToParent = (actorScope: ActorScopeService, event: EventObject): Effect.Effect<void> =>
  Option.match(actorScope.self._parent, {
    onNone: () => Effect.void,
    onSome: (parent) =>
      Effect.flatMap(actorScope.self.getSnapshotUntyped, (snapshot) =>
        snapshot.status === "stopped" ? Effect.void : actorScope.system.relay(actorScope.self, parent, event)
      ),
  })

/**
 * Runs the callback in the actor's scope (upstream `start`, D12). `sendBack` and `emit` are plain
 * functions, so the callback can call them from any code (its own code, a timer, a receive
 * listener, a promise); each call runs its delivery at once through the actor's outbox, as
 * upstream relays and emits inside the call, so it never waits for another event. A throw in the
 * callback is the actor's error, the raw value (SD-4).
 *
 * The stop closes the scope: the listeners are cleared and the cleanup runs once; what the
 * cleanup throws is reported through the logger (SD-21), never thrown into the stop. Later sends
 * and emits are ignored.
 */
const runCallback = <TEvent extends EventObject, TInput, TEmitted extends EventObject>(
  callback: CallbackLogicFunction<TEvent, AnyEventObject, TInput, TEmitted>,
  instances: Instances<TEvent>,
  input: TInput
): Effect.Effect<void, never, ActorScope | Scope.Scope> =>
  Effect.gen(function* () {
    const actorScope = yield* ActorScope
    const self = actorScope.self
    const receivers = MutableRef.make<ReadonlyArray<Receiver<TEvent>>>([])
    // The stop closes the outbox, so a send or an emit after it is dropped
    const outbox = yield* Outbox.make

    // Upstream `instanceStates.set(self, ...)`; the stop removes the entry again
    yield* Effect.sync(() => instances.set(self, receivers))
    yield* Effect.addFinalizer(() => Effect.sync(() => instances.delete(self)))

    yield* Effect.acquireRelease(
      Effect.sync(() =>
        callback({
          input,
          // The actor scope's `self` is this callback actor
          self: self as CallbackActorRef<TEvent>,
          system: actorScope.system,
          // Upstream keeps the listeners in a `Set`: the same listener added twice runs once
          receive: (listener) => {
            MutableRef.update(receivers, (current) => (current.includes(listener) ? current : [...current, listener]))
          },
          sendBack: (event) => outbox.post(relayToParent(actorScope, event)),
          emit: (event) => outbox.post(actorScope.emit(event)),
        })
      ),
      (cleanup) =>
        Effect.andThen(
          Effect.sync(() => MutableRef.set(receivers, [])),
          typeof cleanup === "function" ? isolateCallback(() => Effect.sync(cleanup)) : Effect.void
        )
    )
  })

/**
 * Creates actor logic from a callback-based function (upstream `fromCallback`).
 *
 * - `start` calls the callback with `{ input, system, self, sendBack, receive, emit }`.
 * - `sendBack(event)` sends the event to the parent through the system relay, at once, from any
 *   code; it does nothing once the actor is stopped (SD-23: the send only queues).
 * - `receive(listener)` adds a listener; each event the actor receives reaches every listener,
 *   in the order they were added. A listener that throws errors the actor: status `error` with
 *   the thrown value, and `xstate.error.actor.<id>` at the parent (SD-4).
 * - `emit(event)` delivers the event to the actor's `on` listeners and `emissions`.
 * - A throw in the callback errors the actor in the same way.
 * - The callback may return a cleanup function: it runs once when the actor stops, when the
 *   state that spawned it exits, or when its parent stops (D12). No listener runs after it.
 * - Generic order follows upstream: `fromCallback<TEvent, TInput, TEmitted>` (SD-12).
 *
 * @example
 * ```ts
 * const webSocketActor = fromCallback(({ input, sendBack, receive }) => {
 *   const ws = new WebSocket(input.url)
 *
 *   ws.onmessage = (event) => {
 *     sendBack({ type: "MESSAGE", data: event.data })
 *   }
 *
 *   receive((event) => {
 *     if (event.type === "SEND") {
 *       ws.send(event.data)
 *     }
 *   })
 *
 *   return () => ws.close()
 * })
 * ```
 *
 * @since 0.1.0
 * @category Actors
 */
export const fromCallback = <
  TEvent extends EventObject = EventObject,
  TInput = unknown,
  TEmitted extends EventObject = EventObject
>(
  callback: CallbackLogicFunction<TEvent, AnyEventObject, TInput, TEmitted>
): CallbackActorLogic<TEvent, TInput, TEmitted> => {
  // Upstream `instanceStates`: keyed by the actor itself, so two actors whose session ids are
  // equal (one per system) never share listeners
  const instances: Instances<TEvent> = new WeakMap()

  return {
    [ActorLogicTypeId]: makeActorLogicVariance<CallbackSnapshot<TInput>, TEvent, TInput, TEmitted, never>(),

    config: callback,

    // Upstream `transition`: the stop event gives status `stopped` and no error, and no listener
    // receives it (the cleanup is the actor's scope closing); every listener receives any other
    // event, in order, and a throw is the actor's error (SD-4), the snapshot unchanged
    transition: (snapshot, event) =>
      Effect.gen(function* () {
        if (isStopEvent(event)) {
          return { ...snapshot, status: "stopped", error: Option.none() }
        }
        const actorScope = yield* ActorScope
        const receivers = yield* Effect.sync(() => receiversOf(instances, actorScope.self))
        yield* Effect.forEach(receivers, (receiver) => Effect.sync(() => receiver(event)), { discard: true })
        return snapshot
      }),

    getInitialSnapshot: (input) =>
      Effect.succeed<CallbackSnapshot<TInput>>({
        [Snap.SnapshotTypeId]: Snap.SnapshotTypeId,
        status: "active",
        output: Option.none(),
        error: Option.none(),
        input,
      }),

    start: (snapshot) => runCallback(callback, instances, snapshot.input),

    // The persisted-snapshot codec (SD-7): `{ status, output, error, input }`, no Option objects
    getPersistedSnapshot: Persistence.persistLogicSnapshot,

    restoreSnapshot: (persisted) => Persistence.restoreLogicSnapshot<undefined, TInput>(persisted),
  }
}
