/**
 * @since 0.1.0
 * @module Actor
 *
 * Actor is a running instance of an ActorLogic.
 */
import {
  Cause,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Option,
  Queue,
  Ref,
  SubscriptionRef,
  Scope,
  HashMap,
  Chunk,
  Stream,
  Layer,
  Pipeable,
  Inspectable,
  Predicate,
  pipe,
  PubSub,
} from "effect"
import type { AnyMachineSnapshot, Snapshot } from "./Snapshot.js"
import * as Snap from "./Snapshot.js"
import type { EventObject } from "./Event.js"
import { DoneActorEvent, ErrorActorEvent, InitEvent, SnapshotEvent, StopEvent } from "./Event.js"
import type { ActorLogic, ActorScopeService, ActorSystemService } from "./ActorLogic.js"
import * as AL from "./ActorLogic.js"
import type { ActorRef, SnapshotStream } from "./ActorRef.js"
import * as AR from "./ActorRef.js"
import { type Clock, makeActorSystem } from "./ActorSystem.js"
import { devToolsAdapter } from "./dev/index.js"
import type { SerializationError } from "./Errors.js"
import * as Errors from "./Errors.js"
import { isolateCallback, reportUnhandledError } from "./internal/reportError.js"
import { eventString } from "./internal/eventString.js"
import { type WaitingDelivery, WaitingDeliveryKey } from "./internal/delivery.js"
import type { InspectionEventInput } from "./inspection.js"
import {
  ACTOR_REF_TYPE,
  decodeScheduledEvents,
  type PersistedActorRef,
  type PersistedScheduledEvent,
  persistScheduledEvents,
  resolveEventTarget,
  type ScheduledEventScope,
  validateRestoredSnapshot,
  withScheduledEvents,
} from "./persistence.js"
import type { AnyStateMachine } from "./StateMachine.js"
import type { ProcessingStatus, ActorOptions, ActorOptionsArgs } from "./Types.js"
import * as Types from "./Types.js"

// ============================================================
// VARIANCE HELPERS
// ============================================================

/**
 * Creates variance markers for ActorRef TypeId.
 * @internal
 */
const makeActorRefVariance = <
  TSnapshot extends Snapshot,
  TEvent extends EventObject,
  TEmitted extends EventObject
>(): Types.Variance.ActorRef<TSnapshot, TEvent, TEmitted> => ({
  _Snapshot: (_: never): TSnapshot => _,
  _Event: (_: TEvent) => _,
  _Emitted: (_: never): TEmitted => _,
})

// ============================================================
// ACTOR TYPE ID
// ============================================================

/**
 * Type ID for Actor.
 *
 * @since 0.1.0
 * @category Type ID
 */
export const ActorTypeId: unique symbol = Symbol.for("@xstate-effect/Actor")

/**
 * Type ID type for Actor.
 *
 * @since 0.1.0
 * @category Type ID
 */
export type ActorTypeId = typeof ActorTypeId

// ============================================================
// ACTOR INTERFACE
// ============================================================

/**
 * A value derived from an actor's snapshot (upstream `Readable`, the result of
 * `actor.select`), in Effect form (D6): `get` and `subscribe` follow upstream, and `changes` is
 * the stream form of the subscription.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { assign, createActor, createMachine } from "@jambudipa/xstate-effect"
 *
 * const machine = createMachine({
 *   types: {} as { context: { count: number }; events: { type: "INC" } },
 *   context: { count: 0 },
 *   on: { INC: { actions: assign({ count: ({ context }) => context.count + 1 }) } }
 * })
 *
 * const program = Effect.gen(function* () {
 *   const actor = yield* createActor(machine)
 *   yield* actor.start
 *   const count = actor.select(({ context }) => context.count)
 *   yield* count.subscribe((value) => Effect.log(`count: ${value}`))
 *   yield* actor.send({ type: "INC" })
 *   return yield* count.get
 * })
 * ```
 *
 * @since 0.1.0
 * @category Actor
 */
export interface Readable<out T> {
  /**
   * The selected value of the snapshot the actor holds now (upstream `get()`). It never
   * waits; what the selector throws is a defect.
   *
   * @since 0.1.0
   */
  readonly get: Effect.Effect<T>

  /**
   * Subscribes to the selected value (upstream `subscribe`), as `actor.subscribe` does
   * (SD-24): `observer` receives nothing at subscription time, then, for each snapshot the
   * actor publishes, the selected value when the equality function finds it different from the
   * last value given (at first, the value selected when this subscription runs). What the
   * selector, the equality function or the observer throws, fails or dies with is reported
   * through the logger, and the subscription goes on (SD-21). The subscription ends when the
   * caller's scope closes (upstream `unsubscribe`).
   *
   * @since 0.1.0
   */
  readonly subscribe: (observer: (value: T) => Effect.Effect<void>) => Effect.Effect<void, never, Scope.Scope>

  /**
   * Stream of the selected value (port only, D6): the value of the snapshot the actor holds
   * when the stream runs, then each value that the equality function finds different from the
   * last value given. It ends and fails as the actor's `changes` stream does.
   *
   * @since 0.1.0
   */
  readonly changes: Stream.Stream<T, unknown>
}

/**
 * Actor is a running instance of an ActorLogic. An actor is also its own reference
 * (upstream `this.ref = this`): `actor.ref` is the actor, and `system.get` gives the object
 * that `createActor` returned.
 *
 * @since 0.1.0
 * @category Actor
 */
export interface Actor<
  in out TSnapshot extends Snapshot,
  in out TEvent extends EventObject,
  out TEmitted extends EventObject = EventObject
> extends ActorRef<TSnapshot, TEvent, TEmitted> {
  /** The type-level variance markers; at run time only the key's presence is read (`isActor`). */
  readonly [ActorTypeId]: Types.Variance.Actor<TSnapshot, TEvent, TEmitted>

  /** Unique actor ID */
  readonly id: string

  /** Session ID (unique per actor instance) */
  readonly sessionId: string

  /**
   * The systemId the actor is registered under (the `systemId` option), `undefined` without
   * one (upstream `Actor.systemId`).
   *
   * @since 0.1.0
   */
  readonly systemId: string | undefined

  /**
   * Whether the actor sends each snapshot to its parent (the `syncSnapshot` option; upstream
   * `Actor._syncSnapshot`). A persisted child keeps it (SD-7).
   *
   * @since 0.1.0
   */
  readonly _syncSnapshot: boolean

  /** Actor logic (its input type is not kept: the actor received its input at creation) */
  readonly logic: ActorLogic<TSnapshot, TEvent, never, TEmitted, unknown>

  /**
   * Reactive snapshot access (internal - use snapshotStream for external access). It holds
   * the snapshot from creation on: the initial snapshot until the actor processes events.
   */
  readonly snapshot: SubscriptionRef.SubscriptionRef<TSnapshot>

  /**
   * The snapshot the actor holds now (upstream `getSnapshot`): the initial snapshot before
   * `start`, then the snapshot after the last processed event. It never waits.
   *
   * @since 0.1.0
   */
  readonly getSnapshot: Effect.Effect<TSnapshot>

  /**
   * The persisted form of the snapshot the actor holds now (upstream
   * `getPersistedSnapshot`), through the logic's `getPersistedSnapshot`, with the delayed
   * events the actor scheduled that are pending under `scheduledEvents` (P4; no key when
   * there is none). It never waits.
   *
   * @since 0.1.0
   */
  readonly getPersistedSnapshot: Effect.Effect<unknown, SerializationError>

  /**
   * Covariant snapshot stream for external consumption.
   *
   * Unlike `snapshot` (SubscriptionRef which is invariant), SnapshotStream
   * is covariant in its type parameter, making it suitable for use in
   * collections and when you need `SnapshotStream<SpecificSnapshot>` to be
   * assignable to `SnapshotStream<Snapshot<unknown>>`.
   *
   * `stream` is {@link Actor.changes}: it ends when the actor is done or stopped and fails with
   * the actor's error. `changes` is the same stream without its first value (the current
   * snapshot).
   *
   * @since 0.1.0
   */
  readonly snapshotStream: SnapshotStream<TSnapshot, unknown>

  /**
   * Sends an event to this actor (SD-23). From outside every actor's processing, a send to a
   * running actor completes after the event's macrostep commits, so `getSnapshot` right after
   * it shows the result. A send made from inside an actor's processing or callbacks, or
   * before `start`, only queues the event. A send to a stopped, done or errored actor is
   * dropped with the upstream warning. A send never fails.
   */
  readonly send: (event: TEvent) => Effect.Effect<void>

  /**
   * Starts the actor: runs the logic's `start`, the initial actions queued at creation, then
   * the events sent before `start`, in the actor's own fiber and scope (D12). On an actor that
   * started, stopped, or is done or errored, `start` does nothing. It never fails: an actor
   * whose snapshot already has status `error`, or whose logic's `start` or initial actions
   * fail, ends in status `error` with the original value (SD-4), as upstream's `start` does.
   * An actor whose snapshot already has status `done` runs its initial actions, notifies its
   * observers once and ends at once: no logic `start`, no processing, later sends warn, and
   * its parent receives `xstate.done.actor.<id>` (upstream `start`, case 'done').
   */
  readonly start: Effect.Effect<void>

  /**
   * Stops the actor (D12). The queued events are dropped and later sends warn. The macrostep
   * in progress commits; then the actor's fiber ends and its logic takes the stop event
   * (upstream `xstate.stop`): machine, promise, callback and observable logic give status
   * `stopped` (a machine stops its children and keeps none in `children`), transition logic
   * gives what its reducer returns for the event and stays `active`. Then its scheduled events
   * are cancelled and its scope closes (its finalizers run once). A second stop does nothing.
   * A not-started actor keeps its snapshot and never starts (upstream). Closing the scope that
   * owns the actor stops it too, but its logic never takes the stop event (upstream has no such
   * scope): a running, active actor ends with status `stopped`. Only a root actor stops this
   * way: for an actor with a parent (a spawned or invoked child, or one created with the
   * `parent` option) the Effect dies with `A non-root actor cannot be stopped directly.` and
   * the actor goes on (upstream `stop` throws); its parent stops it (`stopChild`, its own stop).
   */
  readonly stop: Effect.Effect<void>

  /**
   * Stream of snapshots: the snapshot the actor holds when the stream runs, then each
   * snapshot the actor publishes (SD-24). It works before `start` too. When the actor is done,
   * the stream ends after the done snapshot (upstream calls each observer's `next` with it,
   * then `complete`). When the actor stops, the stream ends after the snapshot its logic gives
   * for the stop (status `stopped`, or a transition logic's `active` one), after its children
   * and its finalizers have stopped (upstream `complete`); the stop of an actor that never
   * started ends it with no new snapshot (a port choice: upstream completes no observer
   * there). A stream run after the actor ended gives the final snapshot, then ends. When the
   * actor errors, the stream fails with the actor's original error, also when it runs after
   * the error; it never gives a snapshot with status `error` (SD-4). A running stream is an
   * observer with an error listener: an actor whose errors reach one reports nothing through
   * its logger (SD-21).
   *
   * This is the Effect-idiomatic way to observe snapshot changes,
   * allowing use of all Stream combinators.
   *
   * @since 0.1.0
   */
  readonly changes: Stream.Stream<TSnapshot, unknown>

  /**
   * Subscribes to snapshots as XState does (SD-24): `observer` receives each snapshot the
   * actor publishes after this call, one per processed event, and nothing at subscription
   * time. A subscriber added before `start` receives the initial snapshot once, at `start`.
   * It never receives a snapshot with status `error` or `stopped` (upstream calls no `next`
   * for them); at a stop it receives the active snapshot that a transition logic gives for the
   * stop event (upstream). An observer that throws, fails or dies is reported through the
   * logger and keeps its subscription (SD-21). It is an observer without an error listener,
   * so an actor that errors while it is subscribed reports the error through its logger
   * (upstream `_reportError`). The subscription ends when the caller's scope closes.
   */
  readonly subscribe: (
    observer: (snapshot: TSnapshot) => Effect.Effect<void>
  ) => Effect.Effect<void, never, Scope.Scope>

  /**
   * A value derived from the actor's snapshot (upstream `select`): `selector` maps a snapshot
   * to the value, and `equalityFn` (default `Object.is`) decides whether a new value differs
   * from the last one given. It is synchronous; the selector runs only when the result is read
   * or subscribed to.
   *
   * @since 0.1.0
   */
  readonly select: <TSelected>(
    selector: (snapshot: TSnapshot) => TSelected,
    equalityFn?: (a: TSelected, b: TSelected) => boolean
  ) => Readable<TSelected>

  /**
   * Stream of emitted events.
   *
   * This is the Effect-idiomatic way to observe emitted events,
   * allowing use of all Stream combinators.
   *
   * @example
   * ```ts
   * yield* actor.emissions.pipe(
   *   Stream.filter((e) => e.type === "notification"),
   *   Stream.tap((e) => sendNotification(e)),
   *   Stream.runDrain
   * )
   * ```
   *
   * @since 0.1.0
   */
  readonly emissions: Stream.Stream<TEmitted>

  /**
   * Subscribes to emitted events (upstream `actor.on`): `handler` runs for each emitted event
   * of `type`, or of any type for `"*"`, after the macrostep that emits it commits, while the
   * `Scope` it ran in stays open. The `emissions` property gives the same events as a
   * `Stream.Stream<TEmitted>` for Effect's Stream combinators.
   */
  readonly on: <TType extends TEmitted["type"] | "*">(
    type: TType,
    handler: (event: AR.EmittedOfType<TEmitted, TType>) => Effect.Effect<void>
  ) => Effect.Effect<void, never, Scope.Scope>

  /**
   * The ActorRef for this actor: the actor itself (upstream `this.ref = this`).
   */
  readonly ref: ActorRef<TSnapshot, TEvent, TEmitted>

  /**
   * Reference to the actor system.
   */
  readonly system: ActorSystemService

  /**
   * The actor's clock (upstream `Actor.clock`): its `clock` option, else its system's clock
   * (the root's `clock` option, else a clock on the Effect clock). The system's scheduler
   * starts delayed events on the system's clock.
   *
   * @since 0.1.0
   */
  readonly clock: Clock

  /**
   * Parent actor reference, if any.
   */
  readonly _parent: Option.Option<AR.AnyActorRef>
}

/**
 * Any actor (upstream `AnyActor`, which is `Actor<any>`): every actor that `createActor`
 * returns fits it. `Actor` is invariant in its snapshot and event types, and the port has no
 * `any` (SD-22), so it is a structural supertype, as {@link AR.AnyActorRef} is: the
 * reference members, the actor's own `id`, `sessionId`, `start` and `stop`, and a snapshot
 * with the `value`, `context` and `children` a machine snapshot adds, each optional.
 *
 * @example
 * ```ts
 * let service: AnyActor
 * service = yield* createActor(machine)
 * yield* service.start
 * ```
 *
 * @since 0.1.0
 * @category Actor
 */
export interface AnyActor extends AR.AnyActorRef {
  /** The marker every actor carries; its variance is not checked here. */
  readonly [ActorTypeId]: unknown
  /** Unique actor ID */
  readonly id: string
  /** Session ID (unique per actor instance) */
  readonly sessionId: string
  /** The snapshot the actor holds now, with the fields of a machine's, if it has them */
  readonly getSnapshot: Effect.Effect<AnyActor.Snapshot>
  /** The snapshots the actor takes, as {@link Actor}'s `changes` */
  readonly changes: Stream.Stream<AnyActor.Snapshot, unknown>
  /** Starts the actor, as {@link Actor}'s `start` */
  readonly start: Effect.Effect<void>
  /** Stops the actor, as {@link Actor}'s `stop` */
  readonly stop: Effect.Effect<void>
}

/**
 * @since 0.1.0
 * @category Actor
 */
export declare namespace AnyActor {
  /**
   * The snapshot of any actor: a `Snapshot` with the `value`, `context` and `children` of a
   * machine snapshot as optional fields, which every snapshot fits.
   *
   * @since 0.1.0
   */
  export type Snapshot = import("./Snapshot.js").Snapshot & {
    readonly value?: unknown
    readonly context?: unknown
    readonly children?: Readonly<Record<string, AR.AnyActorRef>>
  }
}

/**
 * Type guard for Actor.
 *
 * @since 0.1.0
 * @category Guards
 */
export const isActor = (u: unknown): u is Actor.Any =>
  Predicate.hasProperty(u, ActorTypeId)

// ============================================================
// ACTOR NAMESPACE
// ============================================================

/**
 * @since 0.1.0
 * @category Actor
 */
export declare namespace Actor {
  /**
   * Extract the Snapshot type from an Actor.
   *
   * @since 0.1.0
   */
  export type SnapshotOf<T> = T extends { readonly snapshot: SubscriptionRef.SubscriptionRef<infer S> } ? S : never

  /**
   * Extract the Event type from an Actor.
   *
   * @since 0.1.0
   */
  export type EventOf<T> = T extends { readonly send: (event: infer E) => Effect.Effect<void> } ? E : never

  /**
   * Extract the Emitted type from an Actor.
   *
   * @since 0.1.0
   */
  export type EmittedOf<T> = T extends { readonly emissions: Stream.Stream<infer Em extends EventObject> } ? Em : never

  /**
   * Any Actor type.
   *
   * @since 0.1.0
   */
  export type Any = Actor<Snapshot, EventObject>
}

// ============================================================
// ACTOR CLASS
// ============================================================

/**
 * The type of the XState `Actor` class (upstream `export class Actor`): every actor that
 * `createActor` and a parent's `spawn` build is an instance, so `actor instanceof Actor`
 * narrows to {@link Actor.Any}. Its construct signature is abstract, so `new Actor(...)`
 * does not compile: an actor exists only inside the `createActor` Effect, in the caller's
 * `Scope` (D6, SD-8). The static members are the functions of this module, so the calls the
 * root `Actor` namespace took (`Actor.make(...)`, `Actor.isActor(...)`) keep working.
 *
 * @since 0.1.0
 * @category Actor
 */
export type ActorConstructor = (abstract new(...args: never) => Actor.Any) & ActorStatics

/**
 * The static members of the `Actor` class: the functions of this module.
 *
 * @since 0.1.0
 * @category Actor
 */
export interface ActorStatics {
  /** {@link ActorTypeId}. */
  readonly ActorTypeId: ActorTypeId
  /** {@link isActor}. */
  readonly isActor: typeof isActor
  /** {@link make}. */
  readonly make: MakeActor
  /** {@link createActor}. */
  readonly createActor: MakeActor
  /** {@link allocateChild}. */
  readonly allocateChild: typeof allocateChild
  /** {@link buildChild}. */
  readonly buildChild: typeof buildChild
  /** {@link restoreChild}. */
  readonly restoreChild: typeof restoreChild
  /** {@link createSpawnFunction}. */
  readonly createSpawnFunction: typeof createSpawnFunction
}

/**
 * XState `Actor`, the class of every actor: each actor's prototype chain holds this class's
 * prototype. The root `Actor` value is this class.
 *
 * @since 0.1.0
 * @category Actor
 */
export const ActorClass: ActorConstructor = class Actor {
  static get ActorTypeId(): ActorTypeId {
    return ActorTypeId
  }

  static get isActor(): typeof isActor {
    return isActor
  }

  static get make(): MakeActor {
    return make
  }

  static get createActor(): MakeActor {
    return createActor
  }

  static get allocateChild(): typeof allocateChild {
    return allocateChild
  }

  static get buildChild(): typeof buildChild {
    return buildChild
  }

  static get restoreChild(): typeof restoreChild {
    return restoreChild
  }

  static get createSpawnFunction(): typeof createSpawnFunction {
    return createSpawnFunction
  }
} as unknown as ActorConstructor

// ============================================================
// ACTOR PROTO
// ============================================================

/**
 * The prototype of every actor object, on top of the class's prototype (so an actor is an
 * instance of `ActorClass`): the type ID marker, `pipe`, `toJSON`, `toString` and the
 * inspect hook. `allocateChild` creates objects of it before the build gives them the rest.
 */
const ActorProto = Object.assign(Object.create(ActorClass.prototype) as object, {
  [ActorTypeId]: {
    _Snapshot: {},
    _Event: {},
    _Emitted: {},
  },
  pipe() {
    return Pipeable.pipeArguments(this, arguments)
  },
  // Upstream `toJSON() { return { xstate$$type: $$ACTOR_TYPE, id: this.id } }`: the marker a
  // persisted context holds, so `JSON.stringify` never reads the actor's own state
  toJSON(this: Actor.Any): PersistedActorRef {
    return { xstate$$type: ACTOR_REF_TYPE, id: this.id }
  },
  toString(this: Actor.Any) {
    return `Actor(${this.id})`
  },
  [Inspectable.NodeInspectSymbol](this: Actor.Any) {
    return this.toJSON()
  },
})

// ============================================================
// MAILBOX
// ============================================================

/**
 * The actors whose processing or callbacks the current fiber runs in: an actor's processing
 * fiber, its `start`, and its subscribe callbacks set it (SD-23). A send made from such a
 * fiber never waits for its macrostep, and a stop of one of these actors never waits for its
 * processing fiber, so an actor never waits for itself or for another actor.
 */
const ProcessingActors = Context.Reference<ReadonlyArray<AR.ActorRefBase>>("@xstate-effect/Actor/ProcessingActors", {
  defaultValue: () => [],
})

/** One event in an actor's mailbox. */
type Envelope<TEvent extends EventObject> =
  | {
      readonly kind: "event"
      readonly event: TEvent
      /** Completed after the event's macrostep commits, for an external send that waits for it (SD-23). */
      readonly processed: Option.Option<Deferred.Deferred<void>>
    }
  | {
      /**
       * The stop of a running child that its parent queued behind the events already sent to
       * the child (upstream `_stop` enqueues `xstate.stop`).
       */
      readonly kind: "stop"
    }
  | {
      /**
       * The end of the events queued when an external `start` returns: completed when the
       * processing reaches it, so that `start` returns after those events, as upstream `start`
       * processes its mailbox before it returns (SD-23).
       */
      readonly kind: "barrier"
      readonly processed: Deferred.Deferred<void>
    }

/** The stop entry of a mailbox. */
const stopEnvelope = { kind: "stop" } as const

/** The event the stop of a running actor hands to its logic (upstream `{ type: XSTATE_STOP }`). */
const stopEvent: EventObject = new StopEvent()

/** The upstream message for a string event given to `send` (`src/createActor.ts:759`). */
const onlyEventObjects = (eventType: string): string =>
  `Only event objects may be sent to actors; use .send({ type: "${eventType}" }) instead`

/**
 * How many observers an actor has now (upstream `observers`), by whether they have an error
 * listener (upstream `observer.error`).
 */
interface ObserverCounts {
  /** The running `changes` streams: they receive the actor's error, so it counts as handled. */
  readonly withErrorListener: number
  /** The `subscribe` callbacks: they never receive the error, so the logger reports it. */
  readonly withoutErrorListener: number
}

/** The kind of observer an attachment counts as. */
type ObserverKind = keyof ObserverCounts

/**
 * What the `changes` streams read (upstream observers' `next` and `complete`): each snapshot
 * the actor commits, then, once the actor has ended, the snapshot it ended with, marked
 * `last`. A stream ends at the last item.
 */
interface StreamItem<TSnapshot> {
  /** A committed snapshot, or the snapshot the actor ended with. */
  readonly snapshot: TSnapshot
  /** True only on the item the actor's end publishes: a stream ends there, without repeating a snapshot it just gave. */
  readonly last: boolean
}

// ============================================================
// INTERNALS (per parent, D12)
// ============================================================

/**
 * What `make` and a parent read of an actor, apart from its public members: its scope, in
 * which its children's scopes are created, so a child stops with its parent (D12, C13); its
 * processing status (upstream `_processingStatus`); and the two ways its parent stops it.
 */
interface ActorInternals {
  /** The actor's scope: closing it stops the actor and every child created in it. */
  readonly lifetime: Scope.Scope
  /** The actor's processing status now. */
  readonly processingStatus: Effect.Effect<ProcessingStatus>
  /** Stops the actor at once (the actor's `stop`). */
  readonly stop: Effect.Effect<void>
  /**
   * Stops a running actor after the events already in its mailbox (upstream `_stop`, whose
   * `xstate.stop` waits behind them), and completes once it has stopped; stops a not-started
   * actor at once.
   */
  readonly stopAfterQueued: Effect.Effect<void>
}

/** The key of an actor's internals: module-private, so only this module reads them. */
const ActorInternalsKey: unique symbol = Symbol("@xstate-effect/Actor/internals")

/** The internals of an actor this module created; none for any other reference. */
const internalsOf = (ref: unknown): Option.Option<ActorInternals> =>
  Predicate.hasProperty(ref, ActorInternalsKey) ? Option.some(ref[ActorInternalsKey] as ActorInternals) : Option.none()

/**
 * Unregisters `ref` and every actor below it from the system, the children first (upstream
 * `unregisterRecursively` in `stopChild`), so their systemIds are free at once.
 */
const unregisterRecursively = (system: ActorSystemService, ref: AR.ActorRefBase): Effect.Effect<void> =>
  Effect.gen(function* () {
    const snapshot = yield* ref.getSnapshotUntyped
    const children: Readonly<Record<string, AR.ActorRefBase>> = Predicate.hasProperty(snapshot, "children")
      ? (snapshot.children as Readonly<Record<string, AR.ActorRefBase>>)
      : {}
    yield* Effect.forEach(Object.values(children), (child) => unregisterRecursively(system, child), { discard: true })
    yield* system.unregister(ref)
  })

// ============================================================
// CREATE ACTOR
// ============================================================

/**
 * Creates an actor from any actor logic, a state machine included (upstream `createActor`
 * and the `Actor` constructor). The actor is not started.
 *
 * - The result describes the creation (D6): nothing happens until the Effect runs, and each
 *   run of the same Effect value creates a new actor.
 * - A root actor creates its own system; an actor with a `parent` joins the parent's
 *   system. No `ActorSystem` layer in scope is read, so two root actors never share a
 *   system (SD-25).
 * - The system books the session id (`x:<n>`); `id` defaults to it (SD-9).
 * - With a `systemId`, the system registers the actor under it before the snapshot is
 *   computed, and drops it again when that snapshot is not active (upstream constructor).
 *   A systemId that another actor of the system holds is a defect with the upstream message
 *   `Actor with system ID '<systemId>' already exists.`, as upstream throws.
 * - The snapshot is computed at creation (upstream `_initState`): the logic's initial
 *   snapshot for `input`, or the `snapshot` option (through the logic's `restoreSnapshot`
 *   when it has one). A logic whose input type does not take `undefined` requires the
 *   `input` option (`Types.ActorOptionsArgs`, upstream `RequiredActorOptionsKeys`). A failure or a defect while computing it gives a snapshot with
 *   status `error` and the original value as `error`; it does not fail the creation.
 * - A persisted snapshot's pending delayed events (`scheduledEvents`) resume at `start`,
 *   before the logic starts, after the time left; one whose time has passed fires at once
 *   (P4). With `validateSnapshot`, a persisted machine snapshot with status `done` on a state
 *   that does not complete the machine gives status `error` with an
 *   `InvalidPersistedSnapshotError`, in this actor and in each child its restore rehydrates
 *   (D11).
 * - Custom actions and emits of the initial snapshot wait until `start`, which runs them
 *   in order, then processes the events sent before it.
 * - A root actor lives in a child scope of the caller's scope: closing the caller's scope
 *   stops it. An actor with a `parent` lives in a child scope of the parent's scope, so the
 *   parent's stop, done or error stops it and its own children (D12, C13). A stop by a scope
 *   close gives the logic no stop event (status `stopped`); `stop` and a parent's stop of its
 *   children do (upstream `xstate.stop`). The logic's requirements are read from the caller
 *   (SD-8).
 * - With `syncSnapshot`, a child sends each active snapshot to its parent as
 *   `xstate.snapshot.<id>`, from the snapshot it starts with.
 * - After `start` it processes its events in its own fiber in that scope, one macrostep at
 *   a time (D12). `stop`, or a macrostep that ends `done` or `error`, ends that fiber and
 *   closes the scope.
 * - Errors (SD-4, upstream `_error`): what user code throws, fails or dies with while the
 *   actor computes its initial snapshot, starts (`logic.start`, the initial actions), takes a
 *   macrostep or runs a macrostep's deferred effects gives status `error` with the original
 *   value as `error` (a failed macrostep keeps the snapshot from before the event). The actor
 *   stops, its scope closes (its children stop, SD-27), its `changes` streams fail with the
 *   value, and its parent receives `xstate.error.actor.<id>` with the raw value. A root actor
 *   that no observer with an error listener watches, or that a `subscribe` callback watches,
 *   reports the value once through its logger (SD-21).
 * - It takes an `AnyStateMachine` too (upstream `createActor(machine: AnyStateMachine)`, as
 *   the SCXML runner holds one): the actor's snapshots are `AnyMachineSnapshot`s and its
 *   events `EventObject`s; and an `AnyActorLogic`, which gives the root `AnyActor` (see
 *   {@link MakeActor}).
 *
 * @example
 * ```ts
 * const program = Effect.gen(function* () {
 *   const actor = yield* createActor(toggleMachine)
 *   yield* actor.start
 *   yield* actor.send({ type: "TOGGLE" })
 * })
 *
 * Effect.runPromise(Effect.scoped(program))
 * ```
 *
 * @since 0.1.0
 * @category Constructors
 */
export const make: MakeActor = ((
  logic: AL.AnyActorLogic,
  options?: ActorOptions<ActorLogic<Snapshot, EventObject, unknown>>
) =>
  // One function serves both signatures: each hands over a logic of some snapshot, event and
  // input types, and the actor is built for those, whatever the caller knows of them. Each
  // run of the Effect allocates its own actor object, so the same Effect value creates a new
  // actor every time it runs (D6)
  Effect.suspend(() =>
    build(
      allocateChild(),
      logic as unknown as ActorLogic<Snapshot, EventObject, unknown>,
      options
    )
  )) as unknown as MakeActor

/**
 * The signatures of {@link make} and `createActor` (upstream `createActor<TLogic extends
 * AnyActorLogic>`):
 *
 * - An `AnyStateMachine`, a machine whose types the caller does not know, gives an actor of
 *   `AnyMachineSnapshot` and `EventObject`, with any input; it needs no Effect service but
 *   its scope. Upstream reads `any` for those types; the port has no `any`.
 * - An `AnyActorLogic`, a logic whose types the caller does not know (upstream
 *   `createActor<TLogic extends AnyActorLogic>`, whose actor is `Actor<any>`), gives the
 *   root {@link AnyActor}, with any input; it needs no Effect service but its scope.
 * - Actor logic of known types gives an actor of those types; it requires the `input`
 *   option when the logic's input type does not take `undefined` (`ActorOptionsArgs`).
 * - A logic whose type is a type parameter (`<T extends AnyActorLogic>(logic: T) =>
 *   createActor(logic)`, upstream `Actor<TLogic>`) gives an actor of `ActorLogic.SnapshotOf`,
 *   `EventOf` and `EmittedOf` that logic, so it is the logic's `ActorRefFromLogic`; the input
 *   rule is the same, decided once the logic is known.
 *
 * A logic of known types (every concrete machine, every other logic) never matches the first
 * two signatures: it fails them on their number of arguments (`AnyStateMachineArgs`,
 * `AnyActorLogicArgs`), which TypeScript does not report. Its own signature comes next, so it
 * decides the call and its errors (a missing input, a wrong option); the last signature
 * checks a known logic the same way, so it accepts no call that the logic's own rejects.
 *
 * @example
 * ```ts
 * const run = (machine: AnyStateMachine) =>
 *   Effect.gen(function* () {
 *     const actor = yield* createActor(machine)
 *     yield* actor.start
 *     yield* actor.send({ type: "go" })
 *     const snapshot: AnyMachineSnapshot = yield* actor.getSnapshot
 *     return snapshot.value
 *   })
 * ```
 *
 * @since 0.1.0
 * @category Constructors
 */
export interface MakeActor {
  <TLogic extends AL.AnyActorLogic>(
    ...args: AnyStateMachineArgs<TLogic>
  ): Effect.Effect<Actor<AnyMachineSnapshot, EventObject>, never, Scope.Scope>
  <TLogic extends AL.AnyActorLogic>(
    ...args: AnyActorLogicArgs<TLogic>
  ): Effect.Effect<AnyActor, never, Scope.Scope>
  <TSnapshot extends Snapshot, TEvent extends EventObject, TInput, TEmitted extends EventObject, R>(
    logic: ActorLogic<TSnapshot, TEvent, TInput, TEmitted, R>,
    ...[options]: ActorOptionsArgs<ActorLogic<TSnapshot, TEvent, TInput, TEmitted, R>>
  ): Effect.Effect<Actor<TSnapshot, TEvent, TEmitted>, never, Scope.Scope | R>
  <TLogic extends AL.AnyActorLogic>(
    logic: TLogic,
    ...[options]: GenericLogicOptionsArgs<TLogic>
  ): Effect.Effect<
    Actor<AL.ActorLogic.SnapshotOf<TLogic>, AL.ActorLogic.EventOf<TLogic>, AL.ActorLogic.EmittedOf<TLogic>>,
    never,
    Scope.Scope
  >
}

/**
 * The arguments of the `AnyStateMachine` signature of {@link MakeActor}: the machine and
 * optional options when `TLogic` is an `AnyStateMachine` that is no `ActorLogic` of its own
 * types; otherwise three arguments that no call gives. TypeScript reports a signature that
 * fails on its number of arguments only when every later one does too, so the logic's own
 * signature, the last one, reports the errors of a logic of known types.
 */
type AnyStateMachineArgs<TLogic> = TLogic extends AnyStateMachine
  ? [AL.ActorLogic.SnapshotOf<TLogic>] extends [never]
    ? [machine: TLogic, options?: ActorOptions<ActorLogic<AnyMachineSnapshot, EventObject, unknown>>]
    : NoArguments
  : NoArguments

/**
 * The arguments of the `AnyActorLogic` signature of {@link MakeActor}: the logic and optional
 * options when `TLogic` is a logic of unknown types (no machine, and no `ActorLogic` of its
 * own types); otherwise three arguments that no call gives, as {@link AnyStateMachineArgs}.
 */
type AnyActorLogicArgs<TLogic> = TLogic extends AnyStateMachine
  ? NoArguments
  : [AL.ActorLogic.SnapshotOf<TLogic>] extends [never]
    ? [logic: TLogic, options?: ActorOptions<ActorLogic<Snapshot, EventObject, unknown>>]
    : NoArguments

/** Arguments no call gives (see {@link AnyStateMachineArgs}). */
type NoArguments = [never, never, never]

/**
 * The options of the last signature of {@link MakeActor}, a logic whose type is a type
 * parameter (upstream `ConditionalRequired<[options?: ...], IsNotNever<RequiredOptions>>`):
 * written with the condition as the check type, so TypeScript compares the arguments with
 * both of its branches while `TLogic` is generic, and a call with no options fits. For a
 * known logic it is `ActorOptionsArgs`.
 */
type GenericLogicOptionsArgs<TLogic extends AL.AnyActorLogic> = RequiresOptions<TLogic> extends true
  ? Required<[options?: ActorOptions<TLogic> & { readonly [K in Types.RequiredActorOptionsKeys<TLogic>]: unknown }]>
  : [options?: ActorOptions<TLogic>]

/** Whether a logic requires an option key (upstream `IsNotNever<RequiredOptions<TLogic>>`). */
type RequiresOptions<TLogic extends AL.AnyActorLogic> = [Types.RequiredActorOptionsKeys<TLogic>] extends [never] ? false : true

/**
 * The object an actor is built into. `make` builds into a new one; a parent's synchronous
 * `spawn` hands one out at once and builds the child into it after the user function returns
 * (`ActorScopeService.allocateChild`).
 *
 * @since 0.1.0
 * @category Constructors
 * @internal
 */
export const allocateChild = (): AR.AnyActorRef => Object.create(ActorProto) as AR.AnyActorRef

/**
 * Builds a child of `parent` into `child`, an object `allocateChild` gave, from a spawn
 * request (upstream `createActor(logic, { parent, id, systemId, input, src, syncSnapshot })`
 * in `spawn` and `spawnChild`). The child is not started. A logic's requirements are the
 * parent's: the child reads the services of the fiber that builds it.
 *
 * @since 0.1.0
 * @category Constructors
 * @internal
 */
export const buildChild = (
  child: AR.ActorRefBase,
  request: AL.SpawnRequest,
  parent: AR.AnyActorRef
): Effect.Effect<Actor.Any, never, Scope.Scope> =>
  // The request holds any logic; the child is built as an actor of the base types, and its
  // logic's requirements are the parent's (SD-8)
  build(child, request.logic as unknown as ActorLogic<Snapshot, EventObject, unknown>, {
    id: Option.getOrUndefined(request.id),
    systemId: Option.getOrUndefined(request.systemId),
    input: request.input,
    src: request.src,
    syncSnapshot: request.syncSnapshot,
    parent,
  })

/**
 * Builds a child of `parent` from its entry in a persisted snapshot (upstream
 * `createActor(logic, { id, parent, syncSnapshot, snapshot, src, systemId })` in
 * `StateMachine.restoreSnapshot`): its snapshot is the persisted one, through its logic's
 * `restoreSnapshot`, or the logic's initial snapshot when the entry has none. The child is not
 * started. A logic's requirements are the parent's, as for `buildChild`. `validateSnapshot` is
 * the parent's `validateSnapshot` option, so the check of D11 reaches every rehydrated child.
 *
 * @since 0.1.0
 * @category Constructors
 * @internal
 */
export const restoreChild = (
  request: AL.RestoreChildRequest,
  parent: AR.AnyActorRef,
  validateSnapshot = false
): Effect.Effect<Actor.Any, never, Scope.Scope> =>
  build(allocateChild(), request.logic as unknown as ActorLogic<Snapshot, EventObject, unknown>, {
    id: request.id,
    systemId: Option.getOrUndefined(request.systemId),
    snapshot: Option.getOrUndefined(request.snapshot),
    src: request.src,
    syncSnapshot: request.syncSnapshot,
    parent,
    validateSnapshot,
  })

/**
 * Builds an actor into `target` (the body of `make`): `target` gets every member of the
 * actor, so a reference handed out before the build becomes the actor itself.
 */
const build = <
  TSnapshot extends Snapshot,
  TEvent extends EventObject,
  TInput,
  TEmitted extends EventObject,
  R
>(
  target: AR.ActorRefBase,
  logic: ActorLogic<TSnapshot, TEvent, TInput, TEmitted, R>,
  options?: ActorOptions<ActorLogic<TSnapshot, TEvent, TInput, TEmitted, R>>
): Effect.Effect<Actor<TSnapshot, TEvent, TEmitted>, never, Scope.Scope | R> =>
  Effect.gen(function* () {
    // Parent reference
    const parent: Option.Option<AR.AnyActorRef> = Option.fromNullishOr(options?.parent)

    // The actor's lifetime is a child scope of its parent's scope, so the parent's stop,
    // done or error stops it (D12, C13). A root actor's lifetime is a child scope of the
    // caller's scope (SD-8), and so is the lifetime of a child whose parent already ended:
    // upstream still creates it, and no parent scope is left to own it.
    const callerScope = yield* Effect.scope
    const lifetime = yield* Scope.fork(
      pipe(
        Option.flatMap(parent, internalsOf),
        Option.filter((internals) => internals.lifetime.state._tag !== "Closed"),
        Option.match({
          onNone: () => callerScope,
          onSome: (internals) => internals.lifetime,
        })
      ),
      "sequential"
    )
    // The caller's services: the logic's work after creation reads them too (SD-8)
    const services = yield* Effect.context<R>()

    // A root actor owns its system, on its clock and with its logger; a child joins its
    // parent's (upstream `createSystem`). A root's `inspect` option is the system's first
    // inspection function, for the system's lifetime, registered before the session id
    // (upstream constructor); a child ignores its own (SD-18)
    const system: ActorSystemService = yield* Option.match(parent, {
      onNone: () =>
        Effect.tap(makeActorSystem({ clock: options?.clock, logger: options?.logger }), (created) =>
          Option.match(Option.fromNullishOr(options?.inspect), {
            onNone: () => Effect.void,
            onSome: created.inspect,
          })
        ).pipe(Scope.provide(lifetime)),
      onSome: (parentRef) => Effect.succeed(parentRef._system),
    })

    // Session id from the system; the id defaults to it (SD-9)
    const sessionId = yield* system.generateId
    const id = options?.id ?? sessionId

    // The mailbox is unbounded, so a send never waits for room (D12). Stop, done and error
    // shut it down, which drops the queued events and refuses later ones.
    const mailbox = yield* Queue.unbounded<Envelope<TEvent>>()

    // The external sends that wait for their macrostep (SD-23). Each one returns at the
    // latest when the actor finishes, so no sender waits for a stopped actor.
    const pendingSends = yield* Ref.make<ReadonlyArray<Deferred.Deferred<void>>>([])

    // The processing fiber, once `start` forked it
    const processingFiber = yield* Ref.make<Option.Option<Fiber.Fiber<void>>>(Option.none())

    // Whether the stop procedure ran: it runs once
    const finished = yield* Ref.make(false)

    // Set when the scope that owns the actor closes: that stop releases the actor without
    // handing the stop event to its logic (see the finalizer at the end)
    const released = yield* Ref.make(false)

    // Completed when the stop procedure has run, so a parent can wait for its child's stop
    const ended = yield* Deferred.make<void>()

    // The `on` listeners of each event type ("*" for every type), in the order they were added
    // (upstream: a Set per type). Each registration is its own entry, so a handler added twice
    // runs twice (upstream adds `handler.bind(undefined)`)
    const eventListeners = yield* Ref.make(HashMap.empty<string, ReadonlyArray<EmitListener<TEmitted>>>())

    // Create PubSub for emissions (Effect-idiomatic API)
    const emissionsPubSub = yield* PubSub.unbounded<TEmitted>()

    // Create deferred effects queue
    const deferredEffects = yield* Ref.make(Chunk.empty<Effect.Effect<void>>())

    // Processing status
    const processingStatus = yield* Ref.make<ProcessingStatus>(Types.ProcessingStatus.NotStarted)

    // The upstream observers' `next` channel: the `subscribe` callbacks receive each snapshot
    // published here (one per processed event, and the one the actor starts from), never an
    // error or stopped snapshot. The `changes` stream reads the stream items instead.
    const observerPubSub = yield* PubSub.unbounded<TSnapshot>()

    // The observers attached now, by whether they have an error listener (upstream
    // `observer.error`): a running `changes` stream has one, a `subscribe` callback has none.
    // Which of them there are decides whether an error is reported (`_reportError`, SD-21).
    const observerCounts = yield* Ref.make<ObserverCounts>({ withErrorListener: 0, withoutErrorListener: 0 })

    // Failed with the actor's error when the actor errors (upstream `_error`): a `changes`
    // stream that reaches the error snapshot fails with it, also one that runs later
    const errored = yield* Deferred.make<never, unknown>()

    // The live snapshot (upstream `getSnapshot`). `snapshotRef` exists only once the initial
    // snapshot is computed, and that computation needs the actor as `self`, so the read waits
    // for `initialised`. A read during that computation dies with the text upstream's
    // development build throws (its production build gives `undefined`), so the actor is
    // created with status `error` unless the code that reads catches it (ledger row DEV-44;
    // D6, D8).
    const initialised = yield* Ref.make(false)
    const getSnapshot: Effect.Effect<TSnapshot> = Effect.flatMap(Ref.get(initialised), (ready) =>
      ready
        ? SubscriptionRef.get(snapshotRef)
        : Effect.die(new Errors.ActorError({ message: "Snapshot can't be read while the actor initializes itself", actorId: id }))
    )

    // The delayed events a restored snapshot held (P4): kept until `start` resumes them, so a
    // persist before `start` still holds them
    const restoredEvents = yield* Ref.make<ReadonlyArray<PersistedScheduledEvent>>([])

    /** What names the targets of this actor's delayed events: itself, its parent, its children. */
    const eventScope = (snapshot: TSnapshot): ScheduledEventScope => ({
      self: actor,
      parent,
      children: Predicate.hasProperty(snapshot, "children") && Predicate.isObject(snapshot.children) ? snapshot.children : {},
      lookup: system._lookup,
    })

    // The logic's persisted snapshot, with the delayed events this actor scheduled that are
    // still pending, or that a restore gave it and `start` has not resumed yet (P4)
    const getPersistedSnapshot: Effect.Effect<unknown, SerializationError> = Effect.gen(function* () {
      const snapshot = yield* getSnapshot
      const persisted = yield* logic.getPersistedSnapshot(snapshot)
      const pending = Object.values(yield* system.scheduler.scheduledEvents)
      const events = yield* persistScheduledEvents(pending, eventScope(snapshot), yield* Ref.get(restoredEvents))
      return withScheduledEvents(persisted, events)
    })

    /**
     * Resumes the delayed events a restored snapshot held, each to the actor its target names
     * now (P4, upstream `system.start` before `logic.start`): one whose time has passed fires
     * at once, the others after the time left. An event whose target names no actor any more
     * is dropped.
     */
    const resumeRestoredEvents = (snapshot: TSnapshot): Effect.Effect<void> =>
      Effect.flatMap(Ref.getAndSet(restoredEvents, []), (events) =>
        Effect.forEach(
          events,
          ({ id, event, delay, startedAt, target }) =>
            Option.match(resolveEventTarget(target, eventScope(snapshot)), {
              onNone: () => Effect.void,
              onSome: (to) => system.scheduler.resume({ source: actor, target: to, event, delay, id, startedAt }),
            }),
          { discard: true }
        )
      )

    /**
     * Runs `effect` at once once the actor has started; before `start` it queues it until
     * `start` (upstream `actionExecutor`), so the work of the initial snapshot waits for
     * `start`. A stop from inside a macrostep lets the rest of that macrostep's actions run in
     * order, as upstream, where the stop waits in the mailbox behind the macrostep.
     */
    const runOrDefer = (effect: Effect.Effect<void>): Effect.Effect<void> =>
      Effect.flatMap(Ref.get(processingStatus), (status) =>
        status === Types.ProcessingStatus.NotStarted ? Ref.update(deferredEffects, Chunk.append(effect)) : effect
      )

    // The systemId option (upstream `Actor.systemId`)
    const systemId: Option.Option<string> = Option.fromNullishOr(options?.systemId)

    /** Upstream's warning for an event sent to a stopped, done or errored actor (`_send`). */
    const warnStopped = (event: EventObject): Effect.Effect<void> =>
      Effect.logWarning(
        `Event "${event.type}" was sent to stopped actor "${id} (${sessionId})". This actor has already reached its final state, and will not transition.\nEvent: ${eventString(event)}`
      )

    /**
     * Queues `event` without waiting for its macrostep. A stopped, done or errored actor
     * drops it with the upstream warning; the sender never waits and never fails.
     */
    const enqueue = (event: TEvent): Effect.Effect<void> =>
      Effect.gen(function* () {
        const status = yield* Ref.get(processingStatus)
        const accepted = status === Types.ProcessingStatus.Stopped
          ? false
          : yield* Queue.offer(mailbox, { kind: "event", event, processed: Option.none() })
        if (!accepted) {
          yield* warnStopped(event)
        }
      })

    /**
     * Delivers `event` (SD-23, upstream `_send`). From outside every actor's processing, a
     * delivery to a running actor completes after the event's macrostep commits, or after the
     * event is dropped, so `getSnapshot` right after it shows the result. A delivery made from
     * inside an actor's processing or callbacks, or to an actor that has not started, only
     * queues the event.
     */
    const deliver = (event: TEvent): Effect.Effect<void> =>
      Effect.gen(function* () {
        const status = yield* Ref.get(processingStatus)
        const inside = (yield* ProcessingActors).length > 0
        if (status !== Types.ProcessingStatus.Running || inside) {
          return yield* enqueue(event)
        }
        const accepted = yield* queueAndWait((processed) => ({ kind: "event", event, processed: Option.some(processed) }))
        if (!accepted) {
          return yield* warnStopped(event)
        }
      })

    /**
     * Queues the entry that `makeEntry` builds around a new waiter and waits until the
     * processing releases it, or until the actor finishes. Gives `false` at once when the
     * mailbox refuses the entry.
     */
    const queueAndWait = (
      makeEntry: (processed: Deferred.Deferred<void>) => Envelope<TEvent>
    ): Effect.Effect<boolean> =>
      Effect.gen(function* () {
        const processed = yield* Deferred.make<void>()
        yield* Ref.update(pendingSends, (pending) => [...pending, processed])
        const accepted = yield* Queue.offer(mailbox, makeEntry(processed))
        if (!accepted) {
          yield* Ref.update(pendingSends, (pending) => pending.filter((waiting) => waiting !== processed))
          return false
        }
        yield* Deferred.await(processed)
        return true
      })

    /** Lets a waiting sender, or a waiting `start`, return. */
    const releaseWaiter = (processed: Deferred.Deferred<void>): Effect.Effect<void> =>
      Effect.andThen(
        Ref.update(pendingSends, (pending) => pending.filter((waiting) => waiting !== processed)),
        Deferred.done(processed, Exit.void)
      )

    /**
     * Runs the inspection functions for an event about this actor as the actor's callbacks
     * (SD-23): a send they make only queues its event, and a stop of this actor returns at once.
     */
    const inspectAsCallback = (event: InspectionEventInput): Effect.Effect<void> =>
      Effect.updateService(system._sendInspectionEvent(event), ProcessingActors, (actors) => [...actors, actor])

    /**
     * Sends `event` (upstream `send`, which relays it with no source). A string event (the type
     * system rejects it) is a defect with the upstream message, before the event reaches the
     * inspection functions or the actor, whatever its status (SD-3; upstream `send` throws
     * before it relays). Otherwise the inspection functions see it first (`@xstate.event` with
     * no `sourceRef`), then it is delivered (`deliver`), so an event that an inspection
     * function sends then is queued before it, as upstream.
     */
    const send = (event: TEvent): Effect.Effect<void> =>
      Effect.gen(function* () {
        const given: unknown = event
        if (typeof given === "string") {
          return yield* Effect.die(new Errors.ActorError({ message: onlyEventObjects(given), actorId: id }))
        }
        yield* inspectAsCallback({ type: "@xstate.event", sourceRef: Option.none(), actorRef: actor, event })
        yield* deliver(event)
      })

    /** Lets the sender of `envelope` return, when it waits for the macrostep. */
    const release = (envelope: Extract<Envelope<TEvent>, { readonly kind: "event" }>): Effect.Effect<void> =>
      Option.match(envelope.processed, {
        onNone: () => Effect.void,
        onSome: releaseWaiter,
      })

    /**
     * Sets the snapshot the actor holds (upstream `this._snapshot = ...`). The `changes`
     * streams receive it later, in `update`, after the deferred effects, as upstream's
     * observers do.
     */
    const hold = (snapshot: TSnapshot): Effect.Effect<void> => SubscriptionRef.set(snapshotRef, snapshot)

    /** Hands `snapshot` to the `changes` streams (upstream `observer.next`). */
    const publishChange = (snapshot: TSnapshot): Effect.Effect<void> =>
      SubscriptionRef.set(streamItems, { snapshot, last: false })

    /**
     * Sets the snapshot the actor holds and hands it to the `changes` streams at once, for a
     * snapshot with no deferred effects to run first (an error snapshot, the stop of an actor
     * that the close of its owner's scope released).
     */
    const commit = (snapshot: TSnapshot): Effect.Effect<void> => Effect.andThen(hold(snapshot), publishChange(snapshot))

    /**
     * Hands the stop event to the logic of an actor that was running and is still active
     * (upstream `_process` of `xstate.stop`, then `update`): the snapshot the logic gives is
     * held (machine, promise, callback and observable logic give status `stopped`, a machine
     * without its children; transition logic gives what its reducer returns for the event,
     * still `active`), its deferred effects run (the stops of a machine's children), then the
     * `changes` streams receive it and an active or done snapshot reaches the `subscribe`
     * observers, and the inspection functions see `@xstate.snapshot` with the stop event. What
     * the logic throws, fails or dies with is the actor's error, with the snapshot it had
     * (SD-4), and no `@xstate.snapshot`; an error or done snapshot ends the actor as a
     * macrostep's does.
     */
    const processStop = (current: TSnapshot): Effect.Effect<void> =>
      Effect.gen(function* () {
        const transitioned = yield* Effect.exit(
          logic.transition(current, stopEvent as TEvent).pipe(
            Effect.provideService(ProcessingActors, [actor]),
            Effect.provide(actorScopeLayer),
            Scope.provide(lifetime),
            Effect.provideContext(services)
          )
        )
        if (Exit.isFailure(transitioned)) {
          return yield* failWith(current, Cause.squash(transitioned.cause))
        }
        const stopped = transitioned.value
        yield* hold(stopped)
        yield* update(stopped, stopEvent)
      })

    /**
     * Ends a stopped, done or errored actor, once (upstream `_stopProcedure`): an actor that
     * was running and is still active hands the stop event to its logic (`processStop`), or,
     * released by the close of the scope that owns it, gets status `stopped` without it; its
     * scheduled events are cancelled, it leaves the system, its scope closes (its finalizers
     * run once, its children stop: SD-27), its `changes` streams end (upstream `_complete`)
     * and every send that waits for a macrostep returns. A done or errored snapshot stays as
     * it is, and so does the snapshot of an actor that never started (upstream).
     */
    const finish = (wasRunning: boolean): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (yield* Ref.getAndSet(finished, true)) {
          return
        }
        if (wasRunning) {
          const current = yield* SubscriptionRef.get(snapshotRef)
          if (current.status === "active") {
            yield* (yield* Ref.get(released))
              ? commit(Snap.withStatus(current, { status: "stopped" }))
              : processStop(current)
          }
        }
        yield* system.scheduler.cancelAll(actor)
        yield* system.unregister(actor)
        yield* Scope.close(lifetime, Exit.void)
        // The last item ends every `changes` stream, and a stream run later gives its snapshot
        yield* SubscriptionRef.set(streamItems, { snapshot: yield* SubscriptionRef.get(snapshotRef), last: true })
        const waiting = yield* Ref.getAndSet(pendingSends, [])
        yield* Effect.forEach(waiting, (processed) => Deferred.done(processed, Exit.void), { discard: true })
        yield* Deferred.done(ended, Exit.void)
      }).pipe(Effect.uninterruptible)

    /** Counts an observer of `kind` as attached until the caller's scope closes. */
    const countObserver = (kind: ObserverKind): Effect.Effect<void, never, Scope.Scope> =>
      Effect.acquireRelease(
        Ref.update(observerCounts, (counts) => ({ ...counts, [kind]: counts[kind] + 1 })),
        () => Ref.update(observerCounts, (counts) => ({ ...counts, [kind]: counts[kind] - 1 }))
      )

    /**
     * Attaches an upstream observer until the caller's scope closes: the observer that
     * `makeObserver` builds receives each snapshot published on the observers' channel after
     * this call, inside the actor's callbacks (its sends never wait, SD-23). What it throws,
     * fails or dies with is reported through the logger, and it keeps receiving snapshots
     * (SD-21). `makeObserver` runs once the subscription exists and before any snapshot reaches
     * the observer, so a value it reads from the live snapshot is never older than the first
     * snapshot the observer receives (a `select` subscription).
     */
    const observeWith = (
      makeObserver: Effect.Effect<(snapshot: TSnapshot) => Effect.Effect<void>>,
      kind: ObserverKind
    ): Effect.Effect<void, never, Scope.Scope> =>
      Effect.gen(function* () {
        yield* countObserver(kind)
        // Subscribe now, not when the forked fiber first runs, so no snapshot published after
        // this call is missed
        const subscription = yield* PubSub.subscribe(observerPubSub)
        const observer = yield* makeObserver
        yield* Stream.fromSubscription(subscription).pipe(
          Stream.runForEach((snapshot) =>
            Effect.provideService(isolateCallback(() => observer(snapshot)), ProcessingActors, [actor])
          ),
          Effect.forkScoped
        )
      })

    /** {@link observeWith} for an observer that exists already. */
    const observe = (
      observer: (snapshot: TSnapshot) => Effect.Effect<void>,
      kind: ObserverKind
    ): Effect.Effect<void, never, Scope.Scope> => observeWith(Effect.succeed(observer), kind)

    /**
     * Hands the actor's error to its observers (upstream `_reportError`): every `changes`
     * stream fails with it, now and later. It is reported through the logger (SD-21) when no
     * observer is attached and the actor has no parent (a parent hears of it through the error
     * event), or when an attached observer has no error listener (a `subscribe` callback).
     */
    const reportError = (error: unknown): Effect.Effect<void> =>
      Effect.gen(function* () {
        // The observers attached when the actor errors: read before the streams fail, since a
        // stream that fails detaches
        const counts = yield* Ref.get(observerCounts)
        yield* Deferred.fail(errored, error)
        const unhandled =
          counts.withErrorListener + counts.withoutErrorListener === 0 ? Option.isNone(parent) : counts.withoutErrorListener > 0
        if (unhandled) {
          yield* reportUnhandledError(error)
        }
      })

    /**
     * The actor errors with `error`, its snapshot already set (upstream `_error`): it stops
     * processing (later sends warn, the queued events and deferred effects are dropped), leaves
     * the system, hands the error to its observers, and relays `xstate.error.actor.<id>` with the
     * raw error to its parent through the system, so the inspection functions see it with this
     * actor as its source (SD-4, SD-5). The caller then finishes the actor, which closes its
     * scope, so its children stop and its timers end (SD-27).
     */
    const enterError = (error: unknown): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* Ref.set(processingStatus, Types.ProcessingStatus.Stopped)
        yield* Queue.shutdown(mailbox)
        yield* Ref.set(deferredEffects, Chunk.empty())
        yield* system.unregister(actor)
        yield* reportError(error)
        yield* Option.match(parent, {
          onNone: () => Effect.void,
          onSome: (parentRef) => system.relay(actor, parentRef, new ErrorActorEvent({ actorId: id, error })),
        })
      })

    /**
     * The actor is done with `snapshot` (upstream `update`, case 'done'): it stops processing
     * (later sends warn, the queued events are dropped), leaves the system before its parent
     * hears of it, so its session id and its systemId are free again, and relays
     * `xstate.done.actor.<id>` with its output to its parent through the system (SD-5). The
     * caller then finishes the actor, which cancels its scheduled events and closes its scope
     * (SD-27).
     */
    const enterDone = (snapshot: TSnapshot): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* Ref.set(processingStatus, Types.ProcessingStatus.Stopped)
        yield* Queue.shutdown(mailbox)
        yield* system.unregister(actor)
        yield* Option.match(parent, {
          onNone: () => Effect.void,
          onSome: (parentRef) =>
            system.relay(actor, parentRef, new DoneActorEvent({ actorId: id, output: snapshot.output })),
        })
      })

    /**
     * Sets `snapshot` with status `error` and `error` as its error (an Option, D8), then the
     * actor errors (`enterError`). Upstream stores `{ ...snapshot, status: 'error', error }`.
     */
    const failWith = (snapshot: TSnapshot, error: unknown): Effect.Effect<void> =>
      Effect.andThen(commit(Snap.withStatus(snapshot, { status: "error", error: Option.some(error) })), enterError(error))

    /**
     * What follows the hold of `snapshot` for `event` (upstream `update`): the deferred
     * effects run, in order, and the first one that fails is the actor's error, with
     * `snapshot`, and the ones after it never run; otherwise the `changes` streams receive
     * `snapshot` (unless `streamsHoldIt`: the snapshot an actor starts from, which they hold
     * since its creation) and an active or done snapshot reaches the `subscribe` observers,
     * so a child that the deferred effects stop is stopped when they see the snapshot
     * (upstream `observer.next` after the deferred effects); a done actor ends and its parent
     * hears of it, and an error snapshot (a child's error event that no transition takes)
     * errors the actor. Then the inspection functions see `@xstate.snapshot` with `event` and
     * `snapshot`. Gives whether the actor goes on: false once it is done or errored.
     */
    const update = (snapshot: TSnapshot, event: EventObject, streamsHoldIt = false): Effect.Effect<boolean> =>
      Effect.gen(function* () {
        const deferredFailure = yield* runDeferredEffects(deferredEffects)
        if (Option.isSome(deferredFailure)) {
          yield* failWith(snapshot, deferredFailure.value)
        } else {
          if (!streamsHoldIt) {
            yield* publishChange(snapshot)
          }
          if (snapshot.status === "active" || snapshot.status === "done") {
            yield* PubSub.publish(observerPubSub, snapshot)
          }
          if (snapshot.status === "done") {
            yield* enterDone(snapshot)
          }
          if (snapshot.status === "error") {
            yield* enterError(Option.getOrUndefined(snapshot.error))
          }
        }
        yield* system._sendInspectionEvent({ type: "@xstate.snapshot", actorRef: actor, event, snapshot })
        return Option.isNone(deferredFailure) && snapshot.status !== "done" && snapshot.status !== "error"
      })

    /**
     * Stops the actor (D12, upstream `_stop`). The queued events are dropped and later sends
     * warn. A running actor's processing fiber ends after the macrostep in progress commits;
     * then the actor finishes. Called from inside the actor's own processing or callbacks,
     * stop returns at once and the processing fiber finishes the stop after its macrostep.
     * A not-started actor keeps its snapshot and never runs its initial actions.
     */
    const stop: Effect.Effect<void> = Effect.gen(function* () {
      const previous = yield* Ref.getAndSet(processingStatus, Types.ProcessingStatus.Stopped)
      if (previous === Types.ProcessingStatus.Stopped) {
        return
      }
      yield* Queue.shutdown(mailbox)
      yield* Ref.set(deferredEffects, Chunk.empty())
      if (previous === Types.ProcessingStatus.NotStarted) {
        return yield* finish(false)
      }
      if ((yield* ProcessingActors).includes(actor)) {
        return
      }
      // The macrostep in progress is uninterruptible, so the interrupt waits for its commit
      yield* Effect.flatMap(
        Ref.get(processingFiber),
        Option.match({ onNone: () => Effect.void, onSome: Fiber.interrupt })
      )
      yield* finish(true)
    }).pipe(Effect.uninterruptible)

    // The members of the actor, which is also its own reference (upstream `this.ref = this`).
    // The actor exists before its snapshot, because the initial snapshot is computed with the
    // actor as `self`; every member that reads the snapshot reads it only when it runs.
    const members = {
      [AR.ActorRefTypeId]: makeActorRefVariance<TSnapshot, TEvent, TEmitted>(),
      id,
      sessionId,
      systemId: options?.systemId,
      _syncSnapshot: options?.syncSnapshot === true,
      logic,
      // A spawned child keeps the src its parent named (upstream `options.src ?? logic`)
      src: options?.src ?? logic,
      system,
      _system: system,
      // Upstream `options?.clock ?? this.system._clock`
      clock: options?.clock ?? system._clock,
      _parent: parent,

      get ref(): ActorRef<TSnapshot, TEvent, TEmitted> {
        return actor
      },

      get snapshot(): SubscriptionRef.SubscriptionRef<TSnapshot> {
        return snapshotRef
      },

      // The `changes` stream, which ends and fails with the actor; its `changes` drops the
      // current snapshot
      get snapshotStream(): SnapshotStream<TSnapshot, unknown> {
        return { get: getSnapshot, stream: changes, changes: Stream.drop(changes, 1) }
      },

      get changes(): Stream.Stream<TSnapshot, unknown> {
        return changes
      },

      getSnapshot,

      getSnapshotUntyped: getSnapshot,

      getPersistedSnapshot,

      get emissions(): Stream.Stream<TEmitted> {
        return Stream.fromPubSub(emissionsPubSub)
      },

      send,

      // The send of other actors, the system relay and the scheduler: it never waits (SD-23)
      sendUntyped: (event: EventObject) => enqueue(event as TEvent),

      // A start from inside an actor's processing or callbacks never waits for this actor's
      // events (SD-23); the caller's marker is read before `start` sets its own
      start: Effect.flatMap(ProcessingActors, (callers) => Effect.gen(function* () {
        // Only a not-started actor starts: on a stopped, done or errored actor `start`
        // changes nothing (SD-23), and a second `start` does nothing
        const starting = yield* Ref.modify(processingStatus, (status) =>
          status === Types.ProcessingStatus.NotStarted
            ? [true, Types.ProcessingStatus.Running] as const
            : [false, status] as const
        )
        if (!starting) {
          return
        }

        const startSnapshot = yield* SubscriptionRef.get(snapshotRef)

        // Register with the system under the session id, and again under the systemId while
        // the snapshot is active (upstream `start`: `_register`, then `_set`). Another actor
        // that took the systemId since creation is a defect, as upstream's `_set` throws from
        // `start`; a parent that starts this actor turns it into its own error (SD-4)
        yield* system.register(sessionId, actor)
        if (Option.isSome(systemId) && startSnapshot.status === "active") {
          yield* Effect.orDie(system._set(systemId.value, actor))
        }

        // A child that syncs its snapshot relays each active snapshot it publishes from now
        // on, the one it starts from included, to its parent as `xstate.snapshot.<id>`
        // (upstream `start`); the subscription ends with the actor's scope. Upstream gives
        // that observer an empty error listener, so it counts as one with an error listener.
        if (options?.syncSnapshot === true && Option.isSome(parent)) {
          const parentRef = parent.value
          yield* observe(
            (snapshot) =>
              snapshot.status === "active"
                ? system.relay(actor, parentRef, new SnapshotEvent({ actorId: id, snapshot }))
                : Effect.void,
            "withErrorListener"
          ).pipe(Scope.provide(lifetime))
        }

        // Upstream `start`: the inspection functions see the init event, with the parent as its
        // source (none for a root actor), also for an actor that ends at start
        const initEvent: EventObject = new InitEvent({ input: options?.input })
        yield* system._sendInspectionEvent({ type: "@xstate.event", sourceRef: parent, actorRef: actor, event: initEvent })

        // The error of an actor that ends at start (upstream `_error`; no `@xstate.snapshot`)
        const errorAtStart = (snapshot: TSnapshot, error: unknown) =>
          Effect.andThen(failWith(snapshot, error), finish(true))

        // A snapshot that already has status `error` (its computation failed, or it was
        // restored so) errors the actor at once (upstream `start`, case 'error'): no
        // `logic.start`, no initial action, no child spawned at creation starts, and no
        // processing fiber runs; the scope closes, so those children stop (SD-27)
        if (startSnapshot.status === "error") {
          return yield* errorAtStart(startSnapshot, Option.getOrUndefined(startSnapshot.error))
        }

        // The delayed events of a restored active snapshot resume before `logic.start` starts
        // its children (upstream `system.start`), so each child resumes its own after them (P4)
        if (startSnapshot.status === "active") {
          yield* resumeRestoredEvents(startSnapshot)
        }

        // Call logic.start if defined, in the actor's scope with the caller's services. What
        // it throws, fails or dies with is the actor's error (upstream `start` catch). A
        // snapshot that is already `done` (its initial microsteps reached a top-level final
        // state, or it was restored so) skips it (upstream `start`, case 'done')
        const startFailure = yield* pipe(
          Option.fromNullishOr(logic.start),
          Option.filter(() => startSnapshot.status !== "done"),
          Option.match({
            onNone: () => Effect.succeed(Option.none<unknown>()),
            onSome: (logicStart) =>
              failureOf(
                Effect.suspend(() => logicStart(startSnapshot)).pipe(
                  Effect.provideService(ProcessingActors, [actor]),
                  Effect.provide(actorScopeLayer),
                  Scope.provide(lifetime),
                  Effect.provideContext(services)
                )
              ),
          })
        )
        if (Option.isSome(startFailure)) {
          return yield* errorAtStart(startSnapshot, startFailure.value)
        }

        // Upstream `update` with the init event: the custom actions, emits and sends queued at
        // creation run, in order (the first one that fails is the actor's error, and the ones
        // after it never run); then every observer receives the snapshot the actor starts from,
        // so a subscriber added before `start` receives it once (SD-24; the `changes` streams
        // hold it since the creation, so a stream read before `start` sees it only once); then
        // the inspection functions see `@xstate.snapshot`. A done actor ends at start (upstream
        // `update`, case 'done'): no processing fiber runs, its parent hears of it, and it
        // finishes, so its scheduled events are cancelled and its scope closes (SD-27). An
        // initial action that fails errors the actor, which ends here too (upstream `_error`
        // inside `update`)
        const goesOn = yield* update(yield* SubscriptionRef.get(snapshotRef), initEvent, true)
        if (!goesOn) {
          yield* finish(true)
        }

        // The devTools option (upstream `attachDevTools`, after `update` and before
        // `mailbox.start`), also for an actor that an initial action errored; upstream returns
        // before it for a snapshot that is done at start. `true` registers the actor through
        // `devToolsAdapter`, a function is called instead. What the adapter fails or dies with
        // leaves `start` as a defect before the processing fiber forks, as upstream's throw
        // leaves `start` before `mailbox.start`, so the actor processes no event then
        const devTools = options?.devTools
        if (startSnapshot.status !== "done" && devTools !== undefined && devTools !== false) {
          const adapter = devTools === true ? devToolsAdapter : devTools
          yield* Effect.orDie(Effect.suspend(() => adapter(actor)))
        }
        if (!goesOn) {
          return
        }

        // The actor's own processing fiber, in its scope (D12): the events sent before start
        // come first. Forked into a scope that a stop already closed, it is interrupted at once.
        const fiber = yield* processLoop.pipe(
          Effect.provideService(ProcessingActors, [actor]),
          Scope.provide(lifetime),
          Effect.provideContext(services),
          Effect.forkIn(lifetime)
        )
        yield* Ref.set(processingFiber, Option.some(fiber))

        // Upstream `start` ends with `mailbox.start()`, which processes the events sent before
        // start and those its own children sent while they started (an initial entry `sendTo`
        // to an ancestor). An external start returns after them too, as an external send
        // returns after its macrostep (SD-23); a refused barrier means the actor already ended
        if (callers.length === 0) {
          yield* queueAndWait((processed) => ({ kind: "barrier", processed }))
        }
      }).pipe(
        // The actions, listeners and inspection functions that `start` runs are the actor's
        // own callbacks: their sends never wait (SD-23). The actor exists only when it runs.
        Effect.updateService(ProcessingActors, () => [actor])
      )),

      // Upstream `stop`: an actor with a parent throws before `_stop`, so it goes on; its
      // parent stops it through the internal stop. The type has no error channel: a defect
      stop: Option.isSome(parent)
        ? Effect.die(new Errors.ActorError({ message: "A non-root actor cannot be stopped directly.", actorId: id }))
        : stop,

      // An observer without an error listener (upstream `subscribe(fn)`)
      subscribe: (observer: (snapshot: TSnapshot) => Effect.Effect<void>) => observe(observer, "withoutErrorListener"),

      // Upstream `select`: its subscription is an observer with `next` only, so without an
      // error listener; the last value given changes only when a value is given
      select: <TSelected>(
        selector: (snapshot: TSnapshot) => TSelected,
        equalityFn: (a: TSelected, b: TSelected) => boolean = Object.is
      ): Readable<TSelected> => ({
        get: Effect.map(getSnapshot, selector),
        subscribe: (observer) =>
          observeWith(
            Effect.map(
              Effect.flatMap(getSnapshot, (current) => Ref.make(selector(current))),
              (lastGiven) => (snapshot) =>
                Effect.suspend(() => {
                  const value = selector(snapshot)
                  return Effect.flatMap(
                    Ref.modify(lastGiven, (last) => (equalityFn(last, value) ? [false, last] : [true, value])),
                    (changed) => (changed ? observer(value) : Effect.void)
                  )
                })
            ),
            "withoutErrorListener"
          ),
        // Suspended: the actor's `changes` exists only once the actor is built
        changes: Stream.suspend(() =>
          changes.pipe(
            Stream.map(selector),
            Stream.mapAccum(
              () => Option.none<TSelected>(),
              (lastGiven, value) =>
                Option.exists(lastGiven, (last) => equalityFn(last, value)) ? [lastGiven, []] : [Option.some(value), [value]]
            )
          )
        ),
      }),

      on: <TType extends TEmitted["type"] | "*">(
        type: TType,
        handler: (event: AR.EmittedOfType<TEmitted, TType>) => Effect.Effect<void>
      ) =>
        Effect.gen(function* () {
          // The listeners of `type` only receive events of that type (or every event for "*")
          const listener: EmitListener<TEmitted> = { handler: handler as (event: TEmitted) => Effect.Effect<void> }
          yield* Ref.update(eventListeners, (listeners) =>
            HashMap.set(listeners, type, [...listenersOf(listeners, type), listener])
          )

          // The scope's close removes this registration only
          yield* Effect.addFinalizer(() =>
            Ref.update(eventListeners, (listeners) =>
              HashMap.set(listeners, type, listenersOf(listeners, type).filter((other) => other !== listener))
            )
          )
        }),
    } satisfies Omit<Actor<TSnapshot, TEvent, TEmitted>, ActorTypeId | keyof Pipeable.Pipeable | keyof Inspectable.Inspectable>

    // Copy property descriptors, not values: Object.assign would run the getters here. The
    // target is a new object of the actor prototype, or the one a parent's spawn handed out
    const actor: Actor<TSnapshot, TEvent, TEmitted> = Object.defineProperties(
      target as Actor<TSnapshot, TEvent, TEmitted>,
      Object.getOwnPropertyDescriptors(members)
    )

    // What the creation of its children reads (D12), under a module-private key
    const internals: ActorInternals = {
      lifetime,
      processingStatus: Ref.get(processingStatus),
      stop,
      stopAfterQueued: Effect.gen(function* () {
        const status = yield* Ref.get(processingStatus)
        if (status === Types.ProcessingStatus.NotStarted) {
          return yield* stop
        }
        if (status === Types.ProcessingStatus.Running) {
          // A mailbox that is shut down refuses it: the actor is stopping anyway
          yield* Queue.offer(mailbox, stopEnvelope)
        }
        // Upstream processes the stop of an idle child at once, so the parent's next deferred
        // effect (the start of a child that replaces it) runs after the child's cleanup. The
        // child's processing never waits for its parent: its sends only queue (SD-23).
        yield* Deferred.await(ended)
      }),
    }
    Object.defineProperty(actor, ActorInternalsKey, { value: internals })
    // The delivery behind `send`, without its inspection event, for a relay that waits (SD-28)
    const waitingDelivery: WaitingDelivery = (event) => deliver(event as TEvent)
    Object.defineProperty(actor, WaitingDeliveryKey, { value: waitingDelivery })

    // Create actor scope
    const actorScope: ActorScopeService = {
      self: actor,
      id,
      sessionId,
      system,
      // Upstream `options?.logger ?? this.system._logger`
      logger: Option.orElse(Option.fromNullishOr(options?.logger), () => system._logger),
      // Upstream `actorScope.defer`, called by a built-in action's execution: the effect runs
      // after the current macrostep. Before `start` that execution is itself deferred
      // (`actionExecutor`), so at `start` it queues the effect behind every initial action:
      // the initial custom actions run first, and one that fails drops the effect
      defer: (effect) =>
        runOrDefer(Ref.update(deferredEffects, Chunk.append(effect))),
      // Upstream `actorScope.emit`: the delivery itself, at once. The engine defers each emit
      // of a macrostep, so the listeners run after the commit and read the new snapshot (A6)
      emit: (event) =>
        Effect.gen(function* () {
          // Publish to PubSub (Effect-idiomatic API)
          yield* PubSub.publish(emissionsPubSub, event as TEmitted)

          // Then the `on` listeners, as upstream's loop calls them: one at a time, each to its
          // end, the listeners of the event's type first and then the "*" ones, each in the order
          // they were added; the ones present now (a listener added meanwhile waits for the next
          // emit). A listener that throws, fails or dies is reported through the logger; the
          // other listeners and the actor go on (SD-21, upstream `emit`)
          const listeners = yield* Ref.get(eventListeners)
          yield* Effect.forEach(
            [...listenersOf(listeners, event.type), ...listenersOf(listeners, "*")],
            (listener) => isolateCallback(() => listener.handler(event as TEmitted)),
            { discard: true }
          )
        }),
      // Upstream `executeStop` and `actorScope.stopChild`
      stopChild: (child) =>
        Effect.gen(function* () {
          // The actor and its descendants give their systemIds up at once, so the same
          // macrostep may register another actor under them. Upstream does it before it checks
          // that the actor is a child; its session ids are global, so an actor of another
          // system is not in this one. Here they are per system (SD-9): only an actor of this
          // system is unregistered
          if (child._system === system) {
            yield* unregisterRecursively(system, child)
          }
          // Only a child may be stopped: stopping another actor is this actor's error (SD-4),
          // raised where upstream's `actorScope.stopChild` throws
          const asChild = (stopIt: Effect.Effect<void>): Effect.Effect<void> =>
            Option.exists(child._parent, (childParent) => childParent === actor)
              ? stopIt
              : Effect.die(
                  new Errors.ActorError({
                    message: `Cannot stop child actor ${child.id} of ${id} because it is not a child`,
                    actorId: id,
                  })
                )
          const childInternals = internalsOf(child)
          if (
            Option.isSome(childInternals) &&
            (yield* childInternals.value.processingStatus) === Types.ProcessingStatus.Running
          ) {
            // A running child stops after this macrostep commits and after the events already
            // sent to it, those of this macrostep's exit actions included: its stop waits behind
            // them. For an actor that is not a child, the error comes there too, with the
            // committed snapshot, after the deferred effects before it (upstream `update`)
            return yield* Ref.update(deferredEffects, Chunk.append(asChild(childInternals.value.stopAfterQueued)))
          }
          // A child that has not started (spawned in this macrostep) stops at once, so it never
          // starts; for an actor that is not a child, the error comes inside the transition
          yield* asChild(Option.match(childInternals, { onNone: () => Effect.void, onSome: (internals) => internals.stop }))
        }),
      actionExecutor: (action) =>
        runOrDefer(
          pipe(
            system._sendInspectionEvent({
              type: "@xstate.action",
              actorRef: actor,
              action: { type: action.type, params: action.params },
            }),
            Effect.andThen(action.exec)
          )
        ),
      allocateChild,
      // The child lives in this actor's scope (D12). It starts after the current macrostep, or
      // at `start` for the initial snapshot (upstream `actorScope.defer` in `spawn` and
      // `executeSpawn`); `start` does nothing for a child that was stopped before. A child
      // whose start fails errors itself and relays its error event here (SD-4).
      spawnChild: (child, request) =>
        Effect.gen(function* () {
          const built = yield* buildChild(child, request, actor).pipe(Scope.provide(lifetime))
          yield* Ref.update(deferredEffects, Chunk.append(built.start))
        }),
      // The child lives in this actor's scope (D12); the machine's `start` starts it
      // validation (D11) reaches the child with this actor's `validateSnapshot` option
      restoreChild: (request) =>
        restoreChild(request, actor, options?.validateSnapshot === true).pipe(Scope.provide(lifetime)),
      // Only an actor of this module can be started; `start` does nothing for one that started
      startChild: (child) => (isActor(child) ? child.start : Effect.void),
    }

    // Create layer for ActorScope
    const actorScopeLayer = Layer.succeed(AL.ActorScope, actorScope)

    // The inspection functions see the actor once it exists, before it registers its systemId
    // and computes its snapshot (upstream constructor): an actor that a macrostep creates is
    // reported even when that macrostep then fails
    yield* inspectAsCallback({ type: "@xstate.actor", actorRef: actor })

    // Registered under its systemId before its snapshot is computed, so the initial
    // snapshot's own actions find it (upstream constructor `_set`). A second actor under a
    // systemId in use is a defect, as the upstream constructor throws; inside a spawn or an
    // invoke the parent's transition turns it into status `error` (SD-4)
    yield* Option.match(systemId, {
      onNone: () => Effect.void,
      onSome: (key) => Effect.orDie(system._set(key, actor)),
    })

    // The snapshot at creation (upstream `_initState`); the input reaches the logic as given.
    // A restore also reads the persisted delayed events (P4), which `start` resumes, and with
    // the `validateSnapshot` option checks the restored snapshot (D11); a failure of either
    // gives status `error`, as a failed restore does
    const input = options?.input as TInput
    const computeSnapshot: Effect.Effect<TSnapshot, unknown, AL.ActorScope | Scope.Scope | R> = Option.match(
      Option.fromNullishOr(options?.snapshot),
      {
        onNone: () => logic.getInitialSnapshot(input),
        onSome: (persisted) =>
          Effect.gen(function* () {
            const events = yield* decodeScheduledEvents(persisted)
            const restored = yield* Option.match(Option.fromNullishOr(logic.restoreSnapshot), {
              // Upstream uses a snapshot as it is when the logic cannot restore one
              onNone: () => Effect.succeed(persisted as TSnapshot),
              onSome: (restore) => restore(persisted),
            })
            const checked = options?.validateSnapshot === true ? yield* validateRestoredSnapshot(persisted, restored) : restored
            yield* Ref.set(restoredEvents, events)
            return checked
          }),
      }
    )
    const initialSnapshot: TSnapshot = yield* computeSnapshot.pipe(
      Effect.provide(actorScopeLayer),
      Scope.provide(lifetime),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : // Upstream stores `{ status: 'error', error }`: the snapshot has no other field
            // to give, so it is typed as the logic's snapshot, as upstream does
            Effect.succeed(Snap.error(Cause.squash(cause)) as unknown as TSnapshot)
      )
    )
    const snapshotRef = yield* SubscriptionRef.make<TSnapshot>(initialSnapshot)
    yield* Ref.set(initialised, true)
    // What the `changes` streams read: the same snapshots in the same order, each after the
    // deferred effects of its step (`update` or `commit` sets it), then the last item (`finish`)
    const streamItems = yield* SubscriptionRef.make<StreamItem<TSnapshot>>({ snapshot: initialSnapshot, last: false })

    // An actor whose initial snapshot is not active (done or error) gives its systemId up
    // again (upstream constructor `_unregister`)
    if (Option.isSome(systemId) && initialSnapshot.status !== "active") {
      yield* system.unregister(actor)
    }

    // The current snapshot, then each published one (SD-24); live before `start` too. A
    // running stream is an observer with an error listener (upstream `subscribe({ error })`,
    // D6): an error snapshot is never one of its values; when the stream reaches it, it fails
    // with the actor's error once the actor has errored (SD-4), as upstream's `_error` calls
    // each error listener after the snapshot is set. The done snapshot is the last value
    // (upstream `update`, case 'done': `next` with it, then `_complete`): nothing follows it.
    // The last item ends the stream (upstream `_complete` after a stop): its snapshot is a
    // value only when the stream has not just given that very snapshot, so a stream run after
    // the end gives the final snapshot, and a running one ends with no repeated value.
    const changes: Stream.Stream<TSnapshot, unknown> = Stream.unwrap(
      Effect.as(
        countObserver("withErrorListener"),
        SubscriptionRef.changes(streamItems).pipe(
          Stream.takeUntil((item) => item.last),
          Stream.mapAccum(
            () => Option.none<TSnapshot>(),
            (given, item) =>
              item.last && Option.exists(given, (snapshot) => snapshot === item.snapshot)
                ? [given, []]
                : [Option.some(item.snapshot), [item.snapshot]]
          ),
          Stream.mapEffect((snapshot) => (snapshot.status === "error" ? Deferred.await(errored) : Effect.succeed(snapshot))),
          Stream.takeUntil((snapshot) => snapshot.status === "done")
        )
      )
    )

    /**
     * Processes one event (upstream `_process`): its macrostep, the commit, and the stop
     * procedure when the macrostep ends the actor. Gives whether the processing goes on.
     */
    const processEnvelope = (envelope: Envelope<TEvent>): Effect.Effect<boolean, never, R | AL.ActorScope> =>
      Effect.gen(function* () {
        // An event taken after a stop is dropped; the stop lets its sender return
        if ((yield* Ref.get(processingStatus)) === Types.ProcessingStatus.Stopped) {
          return false
        }

        // The stop its parent queued behind the events sent before it (upstream `xstate.stop`):
        // the entries after it are dropped, and the stop procedure runs as the loop ends
        if (envelope.kind === "stop") {
          yield* Ref.set(processingStatus, Types.ProcessingStatus.Stopped)
          yield* Queue.shutdown(mailbox)
          return false
        }

        // The events queued before an external `start` returned are processed: it may return
        if (envelope.kind === "barrier") {
          yield* releaseWaiter(envelope.processed)
          return true
        }

        const currentSnapshot = yield* SubscriptionRef.get(snapshotRef)

        // Skip if not active
        if (currentSnapshot.status !== "active") {
          yield* release(envelope)
          return true
        }

        // The `@xstate.event` inspection event was sent when the event was sent (upstream
        // `_relay`), so the processing reports it no more
        const event = envelope.event

        // Run the transition. What the user code in it throws, fails or dies with stops the
        // macrostep, and the actor errors with that value (upstream `_process` catch, SD-4),
        // so the sender of the event never waits for a dead actor (SD-23). The actor keeps the
        // snapshot it had before the event, so nothing the macrostep changed or spawned is in
        // it, and it drops the macrostep's deferred effects: none of its sends goes out and no
        // child it spawned starts (SD-27, A9b). As upstream, no `@xstate.snapshot` follows.
        const transitioned = yield* Effect.exit(logic.transition(currentSnapshot, event))
        if (Exit.isFailure(transitioned)) {
          const error = Cause.squash(transitioned.cause)
          yield* Ref.set(deferredEffects, Chunk.empty())
          yield* failWith(currentSnapshot, error)
          return false
        }
        const transitionResult = transitioned.value

        // Update snapshot (the `changes` streams receive it in `update`, after the deferred
        // effects, as upstream's observers do)
        yield* hold(transitionResult)

        // The deferred effects, the observers, the end of a done or errored actor (a machine
        // that took no transition for a child's error event errors with the child's raw error)
        // and the `@xstate.snapshot` inspection event (upstream `update`); the loop's end
        // finishes an actor that ended
        if (!(yield* update(transitionResult, event))) {
          return false
        }

        // A stop from inside this macrostep ends the processing after its commit; the stop
        // procedure lets the sender return once the actor is stopped
        if ((yield* Ref.get(processingStatus)) === Types.ProcessingStatus.Stopped) {
          return false
        }
        yield* release(envelope)
        return true
      })

    /**
     * The actor's processing fiber (D12): one event at a time, in mailbox order. Each event's
     * processing is uninterruptible, so a stop lets the macrostep in progress commit. However
     * the processing ends (a stop, a done or errored snapshot, the scope closing), a stopped
     * actor finishes.
     */
    const processLoop: Effect.Effect<void, never, R> = Effect.gen(function* () {
      while (true) {
        // A shut-down mailbox interrupts the take
        const envelope = yield* Queue.take(mailbox)
        const goesOn = yield* Effect.uninterruptible(processEnvelope(envelope))
        if (!goesOn) {
          return
        }
      }
    }).pipe(
      Effect.onExit((exit) =>
        Effect.gen(function* () {
          // Every error of user code is handled inside the processing (transitions, deferred
          // effects) or isolated (listeners, subscribers, inspection functions, SD-21). A
          // defect of the processing itself is still the actor's error, so no sender waits for
          // a dead actor (SD-4, SD-23)
          if (
            Exit.isFailure(exit) &&
            !Cause.hasInterruptsOnly(exit.cause) &&
            (yield* Ref.get(processingStatus)) !== Types.ProcessingStatus.Stopped
          ) {
            yield* failWith(yield* SubscriptionRef.get(snapshotRef), Cause.squash(exit.cause))
          }
          if ((yield* Ref.get(processingStatus)) === Types.ProcessingStatus.Stopped) {
            yield* finish(true)
          }
        })
      ),
      // Provide the ActorScope once for the whole loop, not per event
      Effect.provide(actorScopeLayer)
    )

    // Closing the scope that owns the actor (the caller's, or its parent's) releases it: it
    // stops as `stop` does, but its logic never takes the stop event. Upstream has no such
    // scope: an actor that nobody stops is never stopped, so its logic never sees `xstate.stop`.
    // A running, active actor ends with status `stopped`. After an explicit stop it does nothing.
    yield* Scope.addFinalizer(lifetime, Effect.andThen(Ref.set(released, true), stop))

    return actor
  })

// ============================================================
// DEFERRED EFFECTS
// ============================================================

/**
 * Runs `effect`, user code, and gives `Some` of what it failed or died with (the original
 * value, `Cause.squash`), `None` when it succeeds. An interruption stays an interruption.
 */
const failureOf = <R>(effect: Effect.Effect<unknown, unknown, R>): Effect.Effect<Option.Option<unknown>, never, R> =>
  Effect.matchCauseEffect(effect, {
    onSuccess: () => Effect.succeed(Option.none()),
    onFailure: (cause) => (Cause.hasInterruptsOnly(cause) ? Effect.interrupt : Effect.succeed(Option.some(Cause.squash(cause)))),
  })

/** One `on` registration: its own object, so the scope's close removes exactly this one. */
interface EmitListener<TEmitted> {
  /** The caller's handler; its failures are isolated and logged (SD-21). */
  readonly handler: (event: TEmitted) => Effect.Effect<void>
}

/** The listeners of `type`, in the order they were added; none when nothing listens to it. */
const listenersOf = <TEmitted>(
  listeners: HashMap.HashMap<string, ReadonlyArray<EmitListener<TEmitted>>>,
  type: string
): ReadonlyArray<EmitListener<TEmitted>> => Option.getOrElse(HashMap.get(listeners, type), () => [])

/**
 * Runs the deferred effects, in order, one at a time, until none is left (upstream `update`:
 * `while (deferredFn = this._deferred.shift())`), so an effect queued while they run, such
 * as the send that an initial built-in action queues at `start`, runs in the same pass. The
 * first one that fails or dies ends the run: the ones after it are dropped, and its error is
 * given back (`Some`, the original value) for the actor to error with (SD-4).
 */
const runDeferredEffects = (
  deferredEffects: Ref.Ref<Chunk.Chunk<Effect.Effect<void>>>
): Effect.Effect<Option.Option<unknown>> =>
  Effect.gen(function* () {
    while (true) {
      const next = yield* Ref.modify(deferredEffects, (effects) => [Chunk.head(effects), Chunk.drop(effects, 1)] as const)
      if (Option.isNone(next)) {
        return Option.none()
      }
      const failure = yield* failureOf(next.value)
      if (Option.isSome(failure)) {
        yield* Ref.set(deferredEffects, Chunk.empty())
        return failure
      }
    }
  })

/**
 * Alias for make.
 *
 * @since 0.1.0
 * @category Constructors
 */
export const createActor = make

// ============================================================
// SPAWN FUNCTION (per parent)
// ============================================================

/**
 * Creates the Effect form of a spawn function for the children of `parent` (D12): each call
 * creates a child of `parent`, which joins the parent's system and lives in the parent's
 * scope, and starts it. A child joins its parent's system (upstream), so the `system`
 * argument is not read. Actions and assigners spawn through their synchronous `spawn`, of the
 * root type `Spawner`. The result has the type of the deprecated `ActorLogic.SpawnFunction`
 * (ledger DEV-43), which this signature does not name.
 *
 * @since 0.1.0
 * @category Constructors
 */
export const createSpawnFunction = (
  _system: ActorSystemService,
  parent: AR.AnyActorRef
) => <TLogic extends AL.AnyActorLogic>(
  logic: TLogic,
  options?: Types.SpawnOptions<TLogic>
) =>
  Effect.gen(function* () {
    const child = yield* buildChild(
      allocateChild(),
      {
        logic,
        src: logic,
        id: Option.fromUndefinedOr(options?.id),
        systemId: Option.fromUndefinedOr(options?.systemId),
        input: options?.input,
        syncSnapshot: options?.syncSnapshot ?? false,
      },
      parent
    )
    // A start never fails: a child whose start fails errors itself (SD-4)
    yield* child.start
    return child
  }) as unknown as Effect.Effect<
    ActorRef<
      AL.ActorLogic.SnapshotOf<TLogic>,
      AL.ActorLogic.EventOf<TLogic>,
      AL.ActorLogic.EmittedOf<TLogic>
    >,
    never,
    Scope.Scope
  >
