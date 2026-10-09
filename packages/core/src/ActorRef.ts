/**
 * @since 0.1.0
 * @module ActorRef
 *
 * ActorRef is a reference to an actor that can be used for communication.
 */
import { Effect, Option, Predicate, Pipeable, Inspectable, SubscriptionRef, Stream } from "effect"
import type { Scope } from "effect"
import type { Snapshot } from "./Snapshot.js"
import type { EventObject } from "./Event.js"
import type { AnyEventObject, UpstreamAny } from "./internal/anyEventObject.js"
import type { AnyActorLogic, ActorSystemService } from "./ActorLogic.js"
import type { SerializationError } from "./Errors.js"
import type { PersistedActorRef } from "./persistence.js"
import type { Variance } from "./Types.js"

// ============================================================
// ACTOR REF TYPE ID
// ============================================================

/**
 * Type ID for ActorRef.
 *
 * @since 0.1.0
 * @category Type ID
 */
export const ActorRefTypeId: unique symbol = Symbol.for("@xstate-effect/ActorRef")

/**
 * Type ID type for ActorRef.
 *
 * @since 0.1.0
 * @category Type ID
 */
export type ActorRefTypeId = typeof ActorRefTypeId

// ============================================================
// ACTOR REF BASE INTERFACE
// ============================================================

/**
 * Base interface for all ActorRefs.
 *
 * This interface contains only the non-generic parts of ActorRef,
 * allowing functions to accept any ActorRef without type parameters.
 * This eliminates the need for ActorRef.Any casts in most cases.
 *
 * @since 0.1.0
 * @category Actor Ref
 */
export interface ActorRefBase extends Pipeable.Pipeable, Inspectable.Inspectable {
  readonly [ActorRefTypeId]: unknown

  /** Unique actor ID */
  readonly id: string

  /** Session ID (unique per actor instance) */
  readonly sessionId: string

  /** Source logic or string reference */
  readonly src: string | AnyActorLogic

  /**
   * Sends an event to this actor (untyped version for cross-actor communication).
   */
  readonly sendUntyped: (event: EventObject) => Effect.Effect<void>

  /**
   * Gets the current snapshot (as base Snapshot type).
   */
  readonly getSnapshotUntyped: Effect.Effect<Snapshot>

  /**
   * Gets a serialized snapshot for persistence.
   */
  readonly getPersistedSnapshot: Effect.Effect<unknown, SerializationError>

  /**
   * Parent actor reference, if any.
   */
  readonly _parent: Option.Option<AnyActorRef>

  /**
   * Reference to the actor system.
   */
  readonly _system: ActorSystemService

  /**
   * The JSON form of the actor (upstream `toJSON`): `{ xstate$$type: 1, id }`, the marker a
   * persisted context holds for an actor reference. `JSON.stringify` writes an actor, alone or
   * in a snapshot's `children` or `context`, as this marker and never reads its state.
   *
   * @example
   * ```ts
   * const actor = yield* createActor(machine, { id: "counter" })
   * JSON.stringify(actor) // '{"xstate$$type":1,"id":"counter"}'
   * ```
   *
   * @since 0.1.0
   */
  toJSON(): PersistedActorRef
}

// ============================================================
// ACTOR REF INTERFACE
// ============================================================

/**
 * The emitted event an `on` handler of `type` receives (upstream `EmittedFrom<TLogic> & {
 * type: TType }`): the emitted events of that type; every emitted event for `"*"`, or when
 * the emitted events take any type. An emitted event whose `type` is a union of names is
 * narrowed to `type` (the upstream intersection).
 *
 * @example
 * ```ts
 * type Click = EmittedOfType<{ type: "click"; x: number } | { type: "change" }, "click">
 * // { type: "click"; x: number }
 * ```
 *
 * @since 0.1.0
 * @category Types
 */
export type EmittedOfType<TEmitted extends EventObject, TType> = TType extends "*" ? TEmitted
  : string extends TEmitted["type"] ? TEmitted
  : [Extract<TEmitted, { readonly type: TType }>] extends [never] ? TEmitted & { readonly type: TType }
  : Extract<TEmitted, { readonly type: TType }>

/**
 * A reference to an actor that can be used for communication.
 *
 * ActorRef provides:
 * - Event sending (fire-and-forget)
 * - Snapshot observation
 * - Serialization for persistence
 * - Parent relationship
 *
 * @since 0.1.0
 * @category Actor Ref
 */
export interface ActorRef<
  out TSnapshot extends Snapshot,
  in TEvent extends EventObject,
  out TEmitted extends EventObject = EventObject,
> extends ActorRefBase {
  readonly [ActorRefTypeId]: Variance.ActorRef<TSnapshot, TEvent, TEmitted>

  /**
   * Sends an event to this actor (SD-23). From outside every actor's processing, the send
   * completes after the event's macrostep commits (or after the event is dropped). A send
   * made from inside an actor's processing or callbacks only queues the event, so it never
   * waits.
   */
  readonly send: (event: TEvent) => Effect.Effect<void>

  /**
   * Gets the current snapshot.
   */
  readonly getSnapshot: Effect.Effect<TSnapshot>

  /**
   * Calls `handler` with each event of `type` the actor emits (`"*"`: every event), until the
   * scope closes (upstream `actorRef.on`; a scope replaces the `Subscription`, D6).
   */
  readonly on: <TType extends TEmitted["type"] | "*">(
    type: TType,
    handler: (event: EmittedOfType<TEmitted, TType>) => Effect.Effect<void>
  ) => Effect.Effect<void, never, Scope.Scope>

  /**
   * The actor's snapshots, current first, then each change: the stream fails with the actor's
   * error and ends when the actor is done or stopped. A consumer of it is an observer with an
   * error listener (upstream `actorRef.subscribe({ next, error, complete })`, D6).
   */
  readonly changes: Stream.Stream<TSnapshot, unknown>

  /**
   * Calls `observer` with each snapshot the actor publishes after this call, and nothing at
   * subscription time (the actor's `subscribe`, SD-24; upstream `actorRef.subscribe(fn)`),
   * until the caller's scope closes. The observer-object form is not ported (D6, DEV-3).
   */
  readonly subscribe: (observer: (snapshot: TSnapshot) => Effect.Effect<void>) => Effect.Effect<void, never, Scope.Scope>

  /**
   * Parent actor reference, if any (typed version).
   */
  readonly _parent: Option.Option<AnyActorRef>
}

/**
 * A reference to an actor whose snapshot and events are not known (upstream
 * `UnknownActorRef`): its `getSnapshot` gives a `Snapshot`, and it takes any event.
 *
 * @example
 * ```ts
 * const ref: UnknownActorRef = yield* createEmptyActor()
 * const snapshot = yield* ref.getSnapshot
 * ```
 *
 * @since 0.1.0
 * @category Actor Ref
 */
export type UnknownActorRef = ActorRef<Snapshot, EventObject>

/**
 * A reference to any actor (upstream `AnyActorRef`, which is `ActorRef<any, any, any>`):
 * every actor reference fits it, its `send` takes any event object and its `getSnapshot`
 * gives the actor's snapshot. Upstream's `any` lets a reference that takes fewer events
 * fit; here `send` is a method, whose parameter TypeScript compares both ways, so it does
 * the same without `any` (SD-22). Its snapshot is upstream's `any` (`UpstreamAny`, SD-22 amendment
 * 2026-10-07), so a test reads the `value`, `context` and `children` of the snapshot of a
 * child it finds in `snapshot.children`, as upstream, and every reference fits. Its `on`
 * listens to the actor's emitted events (upstream `actorRef.on`), which it gives as
 * `AnyEventObject`; it is a method for the reason `send` is. Its `changes` stream gives the
 * actor's snapshots and fails with its error, where upstream subscribes an observer object
 * with an `error` callback to the reference (D6); its `subscribe` takes an observer function
 * of the later snapshots (upstream `actorRef.subscribe(fn)`).
 *
 * @example
 * ```ts
 * type Context = { readonly child?: AnyActorRef }
 * const forward = (ref: AnyActorRef) => ref.send({ type: "PING", from: "parent" })
 * const listen = (ref: AnyActorRef) => ref.on("done", (event) => Effect.log(event.type))
 * const failure = (ref: AnyActorRef) => Effect.flip(Stream.runDrain(ref.changes))
 * ```
 *
 * @since 0.1.0
 * @category Actor Ref
 */
export interface AnyActorRef extends ActorRefBase {
  /** Sends an event to the actor (SD-23), as {@link ActorRef}'s `send` does. */
  send(event: AnyEventObject): Effect.Effect<void>
  /** Gets the current snapshot: upstream's `any` (`AnyActorRef = ActorRef<any, any, any>`). */
  readonly getSnapshot: Effect.Effect<UpstreamAny>
  /**
   * Calls `handler` with each event of `type` the actor emits (`"*"`: every event), until the
   * scope closes (the actor's `on`).
   */
  on(type: string, handler: (event: AnyEventObject) => Effect.Effect<void>): Effect.Effect<void, never, Scope.Scope>
  /**
   * The actor's snapshots, current first, then each change (the actor's `changes`): the stream
   * fails with the actor's error and ends when the actor is done or stopped. A consumer of it
   * is an observer with an error listener (upstream `actorRef.subscribe({ error })`, D6).
   */
  readonly changes: Stream.Stream<UpstreamAny, unknown>
  /**
   * Calls `observer` with each snapshot the actor publishes after this call (the actor's
   * `subscribe`, SD-24; upstream `actorRef.subscribe(fn)`), until the caller's scope closes.
   * It is a method for the reason `send` is; the observer-object form is not ported (D6).
   */
  subscribe(observer: (snapshot: UpstreamAny) => Effect.Effect<void>): Effect.Effect<void, never, Scope.Scope>
}

/**
 * Type guard for ActorRef.
 *
 * @since 0.1.0
 * @category Guards
 */
export const isActorRef = (u: unknown): u is ActorRefBase =>
  Predicate.hasProperty(u, ActorRefTypeId)

// ============================================================
// ACTOR REF NAMESPACE
// ============================================================

/**
 * @since 0.1.0
 * @category Actor Ref
 */
export declare namespace ActorRef {
  /**
   * Extract the Snapshot type from an ActorRef.
   *
   * @since 0.1.0
   */
  export type SnapshotOf<T> = T extends ActorRef<infer S, EventObject> ? S : never

  /**
   * Extract the Event type from an ActorRef.
   *
   * @since 0.1.0
   */
  export type EventOf<T> = T extends ActorRef<Snapshot, infer E> ? E : never

  /**
   * Extract the Emitted type from an ActorRef.
   *
   * @since 0.1.0
   */
  export type EmittedOf<T> = T extends ActorRef<Snapshot, EventObject, infer Em> ? Em : never

  /**
   * Any ActorRef type (fully typed).
   *
   * @since 0.1.0
   * @deprecated Use ActorRefBase for accepting any actor reference
   */
  export type Any = ActorRef<Snapshot, EventObject>
}

// ============================================================
// SNAPSHOT STREAM - COVARIANT READ-ONLY ACCESS
// ============================================================

/**
 * SnapshotStream provides covariant (read-only) snapshot access.
 *
 * The 'out' keyword in the type parameter makes this covariant,
 * meaning `SnapshotStream<Snapshot<Foo>>` IS assignable to
 * `SnapshotStream<Snapshot<unknown>>`.
 *
 * Use this for external snapshot observation to avoid variance issues
 * with SubscriptionRef which is invariant.
 *
 * `E` is what the streams fail with: an actor's `snapshotStream` ends when the actor is done
 * or stopped and fails with the actor's error (`E` is `unknown`, D6: the end and the failure
 * replace an observer's `complete` and `error`); one made from a plain `SubscriptionRef`
 * never ends (`E` is `never`).
 *
 * @since 0.1.0
 * @category Snapshot Stream
 */
export interface SnapshotStream<out TSnapshot, out E = never> {
  /** Get current snapshot (once) */
  readonly get: Effect.Effect<TSnapshot>

  /** Stream of snapshot changes (after current) */
  readonly changes: Stream.Stream<TSnapshot, E>

  /** Stream starting with current value then changes */
  readonly stream: Stream.Stream<TSnapshot, E>
}

/**
 * Create a SnapshotStream from a SubscriptionRef. Its streams never end: the ref has no end.
 *
 * @since 0.1.0
 * @category Snapshot Stream
 */
export const toSnapshotStream = <TSnapshot>(
  ref: SubscriptionRef.SubscriptionRef<TSnapshot>
): SnapshotStream<TSnapshot> => ({
  get: SubscriptionRef.get(ref),
  // `SubscriptionRef.changes` starts with the current value; `changes` gives only the later ones
  changes: Stream.drop(SubscriptionRef.changes(ref), 1),
  // `SubscriptionRef.changes` already starts with the current value: prepending it again
  // would emit it twice
  stream: SubscriptionRef.changes(ref),
})

// ============================================================
// ACTOR REF UTILITIES
// ============================================================

/**
 * Gets the ID from an ActorRef or ID string.
 *
 * @since 0.1.0
 * @category Utilities
 */
export const getId = (refOrId: ActorRefBase | string): string =>
  typeof refOrId === "string" ? refOrId : refOrId.id

/**
 * Checks if two ActorRefs are the same actor: the same session id in the same system.
 *
 * A session id is unique within its system only (SD-9): each root actor owns its system
 * (SD-25) and numbers its actors from `x:0`, so two roots of two systems share a session id.
 * Upstream's counter is module-wide, so a session id names one actor there.
 *
 * @since 0.1.0
 * @category Utilities
 */
export const equals = (a: ActorRefBase, b: ActorRefBase): boolean =>
  a._system === b._system && a.sessionId === b.sessionId

/**
 * Checks if an ActorRef is a child of another ActorRef.
 *
 * @since 0.1.0
 * @category Utilities
 */
export const isChildOf = (
  child: ActorRefBase,
  parent: ActorRefBase
): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    return Option.match(child._parent, {
      onNone: () => false,
      onSome: (p) => equals(p, parent),
    })
  })

/**
 * Sends an event to an ActorRef (untyped).
 *
 * @since 0.1.0
 * @category Utilities
 */
export const sendUntyped = (
  ref: ActorRefBase,
  event: EventObject
): Effect.Effect<void> => ref.sendUntyped(event)

/**
 * Sends an event to an ActorRef (typed).
 *
 * @since 0.1.0
 * @category Utilities
 */
export const send = <TEvent extends EventObject>(
  ref: ActorRef<Snapshot, TEvent>,
  event: TEvent
): Effect.Effect<void> => ref.send(event)
