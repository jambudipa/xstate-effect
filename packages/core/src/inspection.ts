/**
 * @since 0.1.0
 * @module inspection
 *
 * The inspection events an actor system sends to its inspection functions (upstream
 * `src/inspection.ts`): the `inspect` option of a root actor and `system.inspect(fn)` receive
 * them. Each event names the actor it is about (`actorRef`) and the session id of the system's
 * root actor (`rootId`).
 */
import type { Option } from "effect"
import type { ActorRefBase } from "./ActorRef.js"
import type { EventObject } from "./Event.js"
import type { Snapshot } from "./Snapshot.js"
import type { TransitionDefinition } from "./Types.js"

/**
 * The fields every inspection event has (upstream `BaseInspectionEventProperties`).
 *
 * @since 0.1.0
 * @category Inspection
 */
export interface BaseInspectionEventProperties {
  /** The session id of the root actor of the system that sent the event. */
  readonly rootId: string
  /**
   * The actor the event is about: the actor of the snapshot (`@xstate.snapshot`,
   * `@xstate.microstep`), the recipient of the event (`@xstate.event`), the created actor
   * (`@xstate.actor`), or the actor that runs the action (`@xstate.action`).
   */
  readonly actorRef: ActorRefBase
}

/**
 * An actor published a snapshot after it processed an event (upstream
 * `InspectedSnapshotEvent`): at `start` with the init event, after each macrostep, and after
 * a stop with the stop event.
 *
 * @since 0.1.0
 * @category Inspection
 */
export interface InspectedSnapshotEvent extends BaseInspectionEventProperties {
  readonly type: "@xstate.snapshot"
  /** The event the actor processed. */
  readonly event: EventObject
  /** The snapshot the actor published. */
  readonly snapshot: Snapshot
}

/**
 * Upstream's `InspectedTransitionEvent`. It is in the union as upstream has it, and, as
 * upstream, no actor ever sends it.
 *
 * @since 0.1.0
 * @category Inspection
 */
export interface InspectedTransitionEvent extends BaseInspectionEventProperties {
  readonly type: "@xstate.transition"
  readonly event: EventObject
  readonly snapshot: Snapshot
}

/**
 * A state machine took one microstep (upstream `InspectedMicrostepEvent`): the snapshot after
 * it, the event it handled, and the transitions it took, none for an event that selects no
 * transition and for the stop event.
 *
 * @since 0.1.0
 * @category Inspection
 */
export interface InspectedMicrostepEvent extends BaseInspectionEventProperties {
  readonly type: "@xstate.microstep"
  /** The event the microstep handled. */
  readonly event: EventObject
  /** The snapshot after the microstep. */
  readonly snapshot: Snapshot
  /** The transition definitions the microstep took, in selection order. */
  readonly _transitions: ReadonlyArray<TransitionDefinition<unknown, EventObject>>
}

/**
 * An actor runs an action that has an execution (upstream `InspectedActionEvent`): a custom
 * action, or a built-in action other than `assign` and `enqueueActions`.
 *
 * @since 0.1.0
 * @category Inspection
 */
export interface InspectedActionEvent extends BaseInspectionEventProperties {
  readonly type: "@xstate.action"
  readonly action: {
    /** The action's type: its name, or the built-in action's `xstate.*` type. */
    readonly type: string
    /** The params of this use; `undefined` when it has none. */
    readonly params: unknown
  }
}

/**
 * An event was sent to an actor (upstream `InspectedEventEvent`). `sourceRef` is the sender
 * (an actor's send, relay or scheduled event, or the parent for a child's init event), and
 * none for an event sent from outside every actor and for a root actor's init event; it is an
 * `Option` (D8, DEV-7).
 *
 * @since 0.1.0
 * @category Inspection
 */
export interface InspectedEventEvent extends BaseInspectionEventProperties {
  readonly type: "@xstate.event"
  readonly sourceRef: Option.Option<ActorRefBase>
  readonly event: EventObject
}

/**
 * An actor was created in the system (upstream `InspectedActorEvent`).
 *
 * @since 0.1.0
 * @category Inspection
 */
export interface InspectedActorEvent extends BaseInspectionEventProperties {
  readonly type: "@xstate.actor"
}

/**
 * Every inspection event (upstream `InspectionEvent`).
 *
 * @since 0.1.0
 * @category Inspection
 */
export type InspectionEvent =
  | InspectedSnapshotEvent
  | InspectedEventEvent
  | InspectedActorEvent
  | InspectedTransitionEvent
  | InspectedMicrostepEvent
  | InspectedActionEvent

/**
 * An inspection event as an actor sends it to its system (upstream
 * `HomomorphicOmit<InspectionEvent, 'rootId'>`): the system adds `rootId`.
 *
 * @since 0.1.0
 * @category Inspection
 */
export type InspectionEventInput = InspectionEvent extends infer E
  ? E extends InspectionEvent
    ? Omit<E, "rootId">
    : never
  : never
