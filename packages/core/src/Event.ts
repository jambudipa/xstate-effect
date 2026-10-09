/**
 * @since 0.1.0
 * @module Event
 *
 * Event types and built-in events for @jambudipa/xstate-effect.
 */
import type { Option } from "effect"
import { Predicate } from "effect"

// ============================================================
// EVENT OBJECT BASE TYPE
// ============================================================

/**
 * Base interface for all events. Every event must have a `type` property.
 *
 * @since 0.1.0
 * @category Event
 */
export interface EventObject {
  /**
   * The event's name: what `on` keys, wildcard descriptors (`*`, `a.*`) and `assertEvent`
   * match. The `xstate.` prefix is reserved for the built-in events below.
   */
  readonly type: string
}

/**
 * Type guard to check if a value is an EventObject.
 *
 * @since 0.1.0
 * @category Guards
 */
export const isEventObject = (u: unknown): u is EventObject =>
  Predicate.isObject(u) && "type" in u && typeof u["type"] === "string"

// ============================================================
// BUILT-IN EVENTS
// ============================================================
//
// Built-in events are plain data (SD-5): an own enumerable `type` first, then the XState
// fields in the order upstream `eventUtils.ts` builds them, and no `_tag`. Each class below
// is a constructor only: `new DoneActorEvent(...)` returns a plain object, so `toEqual`,
// spreads, inline snapshots and JSON give the XState event. `instanceof` is never true;
// test a built-in event by its `type` or with the `is*Event` guards below.

/**
 * The first event a machine processes, `{ type: "xstate.init", input }` (upstream
 * `createInitEvent`). `input` is the actor input as given, `undefined` when there is none.
 *
 * @since 0.1.0
 * @category Built-in Events
 */
export class InitEvent<TInput = unknown> {
  /** Always `"xstate.init"`. */
  declare readonly type: "xstate.init"
  /** The actor input as given to `createActor`; `undefined` when there is none. */
  declare readonly input: TInput

  /** Returns the plain event object in place of an instance (`instanceof` is never true). */
  constructor(args: { readonly input: TInput }) {
    return { type: "xstate.init", input: args.input }
  }
}

/**
 * The internal event that stops an actor, `{ type: "xstate.stop" }`.
 *
 * @since 0.1.0
 * @category Built-in Events
 */
export class StopEvent {
  /** Always `"xstate.stop"`. */
  declare readonly type: "xstate.stop"

  /** Returns the plain event object in place of an instance (`instanceof` is never true). */
  constructor() {
    return { type: "xstate.stop" }
  }
}

/**
 * The event a parent receives when a child actor is done,
 * `{ type: "xstate.done.actor.<actorId>", output, actorId }` (upstream
 * `createDoneActorEvent`). `output` is an `Option`: `Option.none()` where XState gives
 * `undefined` (D8).
 *
 * @since 0.1.0
 * @category Built-in Events
 */
export class DoneActorEvent<TOutput = unknown, TId extends string = string> {
  /** `xstate.done.actor.<actorId>`: an `onDone` of the invocation with that id matches it. */
  declare readonly type: `xstate.done.actor.${TId}`
  /** The child's output: `Option.none()` where XState gives `undefined` (D8). */
  declare readonly output: Option.Option<TOutput>
  /** The id of the child that is done, as its parent knows it. */
  declare readonly actorId: TId

  /** Returns the plain event object in place of an instance (`instanceof` is never true). */
  constructor(args: { readonly actorId: TId; readonly output: Option.Option<TOutput> }) {
    return { type: `xstate.done.actor.${args.actorId}` as const, output: args.output, actorId: args.actorId }
  }
}

/**
 * The event a parent receives when a child actor fails,
 * `{ type: "xstate.error.actor.<actorId>", error, actorId }` (upstream
 * `createErrorActorEvent`). `error` is the raw error value, not an `Option`.
 *
 * @since 0.1.0
 * @category Built-in Events
 */
export class ErrorActorEvent<TErrorData = unknown, TId extends string = string> {
  /** `xstate.error.actor.<actorId>`: an `onError` of the invocation with that id matches it. */
  declare readonly type: `xstate.error.actor.${TId}`
  /** The value the child failed with, as given: not wrapped and not an `Option`. */
  declare readonly error: TErrorData
  /** The id of the child that failed, as its parent knows it. */
  declare readonly actorId: TId

  /** Returns the plain event object in place of an instance (`instanceof` is never true). */
  constructor(args: { readonly actorId: TId; readonly error: TErrorData }) {
    return { type: `xstate.error.actor.${args.actorId}` as const, error: args.error, actorId: args.actorId }
  }
}

/**
 * The event raised when a compound or parallel state node is done,
 * `{ type: "xstate.done.state.<stateId>", output }` (upstream `createDoneStateEvent`).
 * `stateId` is the id of that state node. `output` is an `Option` (D8).
 *
 * @since 0.1.0
 * @category Built-in Events
 */
export class DoneStateEvent<TOutput = unknown> {
  /** `xstate.done.state.<stateId>`: the `onDone` of the state node with that id matches it. */
  declare readonly type: `xstate.done.state.${string}`
  /** The output the completing final state resolves: `Option.none()` where XState gives `undefined` (D8). */
  declare readonly output: Option.Option<TOutput>

  /** Returns the plain event object in place of an instance (`instanceof` is never true). */
  constructor(args: { readonly stateId: string; readonly output: Option.Option<TOutput> }) {
    return { type: `xstate.done.state.${args.stateId}` as const, output: args.output }
  }
}

/**
 * The event a delayed transition waits for, `{ type: "xstate.after.<delay>.<stateNodeId>" }`
 * (upstream `createAfterEvent`). `delay` is the key of the `after` entry: a number of
 * milliseconds, or the name of a delay, also when that delay is computed at run time.
 *
 * @since 0.1.0
 * @category Built-in Events
 */
export class AfterEvent {
  /** `xstate.after.<delay>.<stateNodeId>`: only the `after` entry that scheduled it matches it. */
  declare readonly type: `xstate.after.${string}`

  /** Returns the plain event object in place of an instance (`instanceof` is never true). */
  constructor(args: { readonly delay: number | string; readonly stateNodeId: string }) {
    return { type: `xstate.after.${args.delay}.${args.stateNodeId}` as const }
  }
}

/**
 * The event a parent receives with each active snapshot of a child that syncs its
 * snapshot, `{ type: "xstate.snapshot.<actorId>", snapshot }` (upstream `createActor`).
 *
 * @since 0.1.0
 * @category Built-in Events
 */
export class SnapshotEvent<TSnapshot = unknown> {
  /** `xstate.snapshot.<actorId>`, with the id of the child that published the snapshot. */
  declare readonly type: `xstate.snapshot.${string}`
  /** The child's snapshot as it published it. */
  declare readonly snapshot: TSnapshot

  /** Returns the plain event object in place of an instance (`instanceof` is never true). */
  constructor(args: { readonly actorId: string; readonly snapshot: TSnapshot }) {
    return { type: `xstate.snapshot.${args.actorId}` as const, snapshot: args.snapshot }
  }
}

/**
 * The internal event an observable actor sends itself for each emitted value,
 * `{ type: "xstate.observable.next", data }`.
 *
 * @since 0.1.0
 * @category Built-in Events
 * @internal
 */
export class ObservableNextEvent<TValue = unknown> {
  /** Always `"xstate.observable.next"`. */
  declare readonly type: "xstate.observable.next"
  /** The value the source emitted; a `fromObservable` actor takes it as its context. */
  declare readonly data: TValue

  /** Returns the plain event object in place of an instance (`instanceof` is never true). */
  constructor(args: { readonly data: TValue }) {
    return { type: "xstate.observable.next", data: args.data }
  }
}

// ============================================================
// SPECIAL EVENT TYPES
// ============================================================

/**
 * Wildcard event type that matches any event.
 *
 * @since 0.1.0
 * @category Event Types
 */
export type WildcardEvent = "*"

/**
 * Event type for eventless (always) transitions.
 *
 * @since 0.1.0
 * @category Event Types
 */
export type EventlessEvent = ""

// ============================================================
// TYPE UTILITIES
// ============================================================

/**
 * Extracts the type property from an event.
 *
 * @since 0.1.0
 * @category Type Utilities
 */
export type EventType<TEvent extends EventObject> = TEvent["type"]

/**
 * Filters events by type.
 *
 * @since 0.1.0
 * @category Type Utilities
 */
export type EventByType<TEvent extends EventObject, TType extends string> = Extract<
  TEvent,
  { readonly type: TType }
>

/**
 * The partial descriptors of an event type (upstream `PartialEventDescriptor`): `a.*` and
 * `a.b.*` for `a.b.c`, none for a type without `.`.
 */
type PartialEventDescriptor<TEventType extends string> = TEventType extends `${infer TLeading}.${infer TTail}`
  ? `${TLeading}.*` | `${TLeading}.${PartialEventDescriptor<TTail>}`
  : never

/**
 * An event descriptor (upstream `EventDescriptor`): an event type, a partial descriptor of
 * one (`a.*`, see {@link matchEventDescriptor}), or the wildcard `*`.
 *
 * @since 0.1.0
 * @category Type Utilities
 */
export type EventDescriptor<TEvent extends EventObject> =
  | TEvent["type"]
  | PartialEventDescriptor<TEvent["type"]>
  | WildcardEvent

/** The event types a descriptor matches, as a type (upstream `NormalizeDescriptor`). */
type NormalizeDescriptor<TDescriptor extends string> = TDescriptor extends WildcardEvent ? string
  : TDescriptor extends `${infer TLeading}.*` ? `${TLeading}.${string}`
  : TDescriptor

/**
 * `true` when the event type matches, `boolean` when only some members of a union event type
 * match (distributive, upstream `EventDescriptorMatches`).
 */
type EventDescriptorMatches<TEventType extends string, TNormalizedDescriptor> = TEventType extends
  TNormalizedDescriptor ? true : false

/**
 * The events of `TEvent` that `TDescriptor` matches (upstream `ExtractEvent`): the events of
 * that type, of every type under a partial descriptor, or every event for `*`. An event whose
 * type is a wide `string` is kept as it is.
 *
 * @since 0.1.0
 * @category Type Utilities
 */
export type ExtractEvent<TEvent extends EventObject, TDescriptor extends EventDescriptor<TEvent>> = string extends
  TEvent["type"] ? TEvent
  : NormalizeDescriptor<TDescriptor> extends infer TNormalizedDescriptor
    // `true` is the checked type, so it matches both `true` and `boolean`
    ? TEvent extends unknown ? true extends EventDescriptorMatches<TEvent["type"], TNormalizedDescriptor> ? TEvent : never
    : never
  : never

// ============================================================
// SPECIAL INTERNAL EVENTS
// ============================================================

/**
 * Internal event used for eventless transitions.
 *
 * @since 0.1.0
 * @category Internal Events
 */
export const NULL_EVENT: EventObject = { type: "" }

/**
 * Checks if an event is the null event (for eventless transitions).
 *
 * @since 0.1.0
 * @category Guards
 */
export const isNullEvent = (event: EventObject): boolean => event.type === ""

/**
 * Checks if an event type matches the wildcard.
 *
 * @since 0.1.0
 * @category Guards
 */
export const isWildcardType = (type: string): type is WildcardEvent => type === "*"

/**
 * Checks if an event is an actor done event.
 *
 * @since 0.1.0
 * @category Guards
 */
export const isDoneActorEvent = (event: EventObject): event is DoneActorEvent =>
  event.type.startsWith("xstate.done.actor.")

/**
 * Checks if an event is an actor error event.
 *
 * @since 0.1.0
 * @category Guards
 */
export const isErrorActorEvent = (event: EventObject): event is ErrorActorEvent =>
  event.type.startsWith("xstate.error.actor.")

/**
 * Checks if an event is a done state event.
 *
 * @since 0.1.0
 * @category Guards
 */
export const isDoneStateEvent = (event: EventObject): event is DoneStateEvent =>
  event.type.startsWith("xstate.done.state.")

/**
 * Checks if an event is an after event.
 *
 * @since 0.1.0
 * @category Guards
 */
export const isAfterEvent = (event: EventObject): event is AfterEvent =>
  event.type.startsWith("xstate.after.")

/**
 * Whether an event type matches an event descriptor, with the warnings upstream prints while
 * it decides (see {@link matchEventDescriptor}).
 *
 * @since 0.1.0
 * @category Matching
 */
export interface EventDescriptorMatch {
  /** Whether the descriptor selects the event type. */
  readonly matches: boolean
  /**
   * Upstream's warning texts for a malformed wildcard, in upstream order; empty for a
   * well-formed descriptor. The caller logs them (SD-21); this module never logs.
   */
  readonly warnings: ReadonlyArray<string>
}

/** Upstream's warning for a `*` that is not the last token (`src/utils.ts:314`). */
const wildcardNotLastWarning = (descriptor: string): string =>
  `Wildcards can only be the last token of an event descriptor (e.g., "event.*") or the entire event descriptor ("*"). Check the "${descriptor}" event.`

/** Upstream's warning for a `*` token that is not the last token (`src/utils.ts:334`). */
const infixWildcardWarning = (descriptor: string): string =>
  `Infix wildcards in transition events are not allowed. Check the "${descriptor}" transition.`

/**
 * Matches an event type against an event descriptor (upstream `matchesEventDescriptor`):
 *
 * - the descriptor equals the event type: a match;
 * - `*`: matches every event type;
 * - a partial descriptor, which ends in `.*`: compared token by token (tokens split on `.`)
 *   up to its first `*` token, which matches the rest of the event type, also nothing
 *   (`a.*` matches `a`, `a.b` and `a.b.c`, not `ab` or `b.a`);
 * - any other descriptor (`a*`, `a.*.b`): no match.
 *
 * A partial descriptor with a `*` that has text after it never matches, and gives the
 * warnings upstream prints for it, in upstream order: the last-token warning, then the infix
 * warning when its tokens up to the first `*` token match. The caller logs them (SD-21).
 *
 * @since 0.1.0
 * @category Matching
 */
export const matchEventDescriptor = (eventType: string, descriptor: string): EventDescriptorMatch => {
  if (descriptor === eventType || isWildcardType(descriptor)) {
    return { matches: true, warnings: [] }
  }
  if (!descriptor.endsWith(".*")) {
    return { matches: false, warnings: [] }
  }
  const notLast = /.*\*.+/.test(descriptor) ? [wildcardNotLastWarning(descriptor)] : []
  const partialTokens = descriptor.split(".")
  const eventTokens = eventType.split(".")
  // The first token that is `*` or that differs from the event's; the last token is `*`
  const stop = partialTokens.findIndex((token, index) => token === "*" || token !== eventTokens[index])
  if (partialTokens[stop] !== "*") {
    return { matches: false, warnings: notLast }
  }
  const isLastToken = stop === partialTokens.length - 1
  return isLastToken
    ? { matches: true, warnings: notLast }
    : { matches: false, warnings: [...notLast, infixWildcardWarning(descriptor)] }
}

/**
 * Checks if an event type matches an event descriptor: the exact type, `*`, or a partial
 * descriptor such as `a.*` (see {@link matchEventDescriptor}, which also gives the warnings).
 *
 * @since 0.1.0
 * @category Matching
 */
export const matchesEventDescriptor = (eventType: string, descriptor: string): boolean =>
  matchEventDescriptor(eventType, descriptor).matches
