/**
 * @since 0.1.0
 * @module Snapshot
 *
 * Snapshot types representing the state of actors.
 */
import { Predicate, Option, Schema } from "effect"
import type { Effect, Result } from "effect"
import type { AnyActorRef } from "./ActorRef.js"
import type { GuardError } from "./Errors.js"
import type { EventObject } from "./Event.js"
import type { AnyEventObject, UpstreamAny } from "./internal/anyEventObject.js"
import type { AnyStateMachine } from "./StateMachine.js"
import type { AnyStateNode, StateNode } from "./StateNode.js"
import type { StateValue } from "./StateValue.js"
import type { StateId, StateSchema, ToTestStateValue } from "./Types.js"
import { matchesState } from "./StateValue.js"

// ============================================================
// SNAPSHOT STATUS
// ============================================================

/**
 * The status of an actor snapshot.
 *
 * @since 0.1.0
 * @category Snapshot
 */
export type SnapshotStatus = "active" | "done" | "error" | "stopped"

/**
 * Schema for snapshot status.
 *
 * @since 0.1.0
 * @category Schema
 */
export const SnapshotStatusSchema = Schema.Literals(["active", "done", "error", "stopped"])

// ============================================================
// SNAPSHOT TYPE ID
// ============================================================

/**
 * Type ID for Snapshot.
 *
 * @since 0.1.0
 * @category Type ID
 */
export const SnapshotTypeId: unique symbol = Symbol.for("@xstate-effect/Snapshot")

/**
 * Type ID type for Snapshot.
 *
 * @since 0.1.0
 * @category Type ID
 */
export type SnapshotTypeId = typeof SnapshotTypeId

// ============================================================
// SNAPSHOT INTERFACE
// ============================================================

/**
 * Base snapshot interface for all actor types.
 *
 * @since 0.1.0
 * @category Snapshot
 */
export interface Snapshot<out TOutput = unknown> {
  readonly [SnapshotTypeId]: SnapshotTypeId
  readonly status: SnapshotStatus
  readonly output: Option.Option<TOutput>
  readonly error: Option.Option<unknown>
}

/**
 * Type guard for Snapshot.
 *
 * @since 0.1.0
 * @category Guards
 */
export const isSnapshot = (u: unknown): u is Snapshot =>
  Predicate.hasProperty(u, SnapshotTypeId)

// ============================================================
// SNAPSHOT NAMESPACE
// ============================================================

/**
 * @since 0.1.0
 * @category Snapshot
 */
export declare namespace Snapshot {
  /**
   * Extract the output type from a Snapshot.
   *
   * @since 0.1.0
   */
  export type Output<T> = T extends Snapshot<infer O> ? O : never

  /**
   * Any Snapshot type.
   *
   * @since 0.1.0
   */
  export type Any = Snapshot
}

// ============================================================
// SNAPSHOT CONSTRUCTORS
// ============================================================

/**
 * Creates an active snapshot.
 *
 * @since 0.1.0
 * @category Constructors
 */
export const active = (): Snapshot<never> => ({
  [SnapshotTypeId]: SnapshotTypeId,
  status: "active",
  output: Option.none(),
  error: Option.none(),
})

/**
 * Creates a done snapshot with output.
 *
 * @since 0.1.0
 * @category Constructors
 */
export const done = <TOutput>(output: TOutput): Snapshot<TOutput> => ({
  [SnapshotTypeId]: SnapshotTypeId,
  status: "done",
  output: Option.some(output),
  error: Option.none(),
})

/**
 * Creates an error snapshot.
 *
 * @since 0.1.0
 * @category Constructors
 */
export const error = (err: unknown): Snapshot<never> => ({
  [SnapshotTypeId]: SnapshotTypeId,
  status: "error",
  output: Option.none(),
  error: Option.some(err),
})

/**
 * Creates a stopped snapshot.
 *
 * @since 0.1.0
 * @category Constructors
 */
export const stopped = (): Snapshot<never> => ({
  [SnapshotTypeId]: SnapshotTypeId,
  status: "stopped",
  output: Option.none(),
  error: Option.none(),
})

// ============================================================
// SNAPSHOT PREDICATES
// ============================================================

/**
 * Check if snapshot is active.
 *
 * @since 0.1.0
 * @category Predicates
 */
export const isActive = <TOutput>(snapshot: Snapshot<TOutput>): boolean =>
  snapshot.status === "active"

/**
 * Check if snapshot is done.
 *
 * @since 0.1.0
 * @category Predicates
 */
export const isDone = <TOutput>(snapshot: Snapshot<TOutput>): boolean =>
  snapshot.status === "done"

/**
 * Check if snapshot has an error.
 *
 * @since 0.1.0
 * @category Predicates
 */
export const isError = <TOutput>(snapshot: Snapshot<TOutput>): boolean =>
  snapshot.status === "error"

/**
 * Check if snapshot is stopped.
 *
 * @since 0.1.0
 * @category Predicates
 */
export const isStopped = <TOutput>(snapshot: Snapshot<TOutput>): boolean =>
  snapshot.status === "stopped"

// ============================================================
// MACHINE SNAPSHOT TYPE ID
// ============================================================

/**
 * Type ID for MachineSnapshot.
 *
 * @since 0.1.0
 * @category Type ID
 */
export const MachineSnapshotTypeId: unique symbol = Symbol.for("@xstate-effect/MachineSnapshot")

/**
 * Type ID type for MachineSnapshot.
 *
 * @since 0.1.0
 * @category Type ID
 */
export type MachineSnapshotTypeId = typeof MachineSnapshotTypeId

// ============================================================
// HISTORY VALUE
// ============================================================

/**
 * A state node that a history state recorded: the machine's own `StateNode` instance
 * (XState), as {@link AnyStateNode}, the supertype of the nodes of every machine, whose meta
 * is upstream's `any` (upstream `HistoryValue<any, any>` holds `StateNode`s).
 *
 * @since 0.1.0
 * @category Snapshot
 */
export type RecordedStateNode = AnyStateNode

/**
 * The configuration each history state recorded when its parent last exited (XState
 * `HistoryValue`), keyed by the history state node's id: the active direct children of
 * the parent for a shallow history, its active atomic descendants for a deep history.
 *
 * @since 0.1.0
 * @category Snapshot
 */
export interface HistoryValue {
  readonly [historyStateNodeId: string]: ReadonlyArray<RecordedStateNode>
}

/**
 * The history value of any machine (upstream `AnyHistoryValue`, `HistoryValue<any, any>`):
 * the port's {@link HistoryValue}, whose recorded nodes are every machine's (their meta is
 * upstream's `any`).
 *
 * @since 0.1.0
 * @category Snapshot
 */
export type AnyHistoryValue = HistoryValue

/**
 * What a machine snapshot is made from (upstream `StateConfig`): the context, the history
 * value, the active state nodes (`_nodes`, of upstream's `any` meta), the children, the
 * status, the output and error (`Option`s, D8) and the machine.
 *
 * @since 0.1.0
 * @category Snapshot
 */
export interface StateConfig<TContext, TEvent extends EventObject> {
  readonly context: TContext
  readonly historyValue?: HistoryValue
  readonly _nodes: ReadonlyArray<StateNode<TContext, TEvent, UpstreamAny, UpstreamAny>>
  readonly children: Readonly<Record<string, AnyActorRef>>
  readonly status: SnapshotStatus
  readonly output?: Option.Option<unknown>
  readonly error?: Option.Option<unknown>
  readonly machine?: AnyStateMachine
}

/**
 * The config of any machine snapshot (upstream `AnyStateConfig`, `StateConfig<any,
 * AnyEventObject>`; SD-22 amendment, goal journal `2026-10-07-13-node-containers-any.md`).
 *
 * @since 0.1.0
 * @category Snapshot
 */
export type AnyStateConfig = StateConfig<UpstreamAny, AnyEventObject>

// ============================================================
// MACHINE SNAPSHOT INTERFACE
// ============================================================

/**
 * Snapshot interface for state machines. The query methods `matches`, `hasTag`, `can`,
 * `getMeta` and `toJSON` (XState) are non-enumerable own properties that
 * {@link makeMachineSnapshot} attaches (SD-6), so spreads and equality checks see only the
 * data fields, and every snapshot the engine builds has them.
 *
 * `_TStateSchema` is the state schema of the machine that produced the snapshot (XState's
 * `TStateSchema`, which upstream reads through `snapshot.machine`): only the keys of
 * `getMeta` depend on it (the machine's state ids, each optional), and it carries no value.
 * `mapState` reads it to check a mapper's keys. It has no variance annotation on purpose, so
 * snapshots of any two schemas stay assignable to each other, as XState's `any` schemas are,
 * while `MachineSnapshot.StateSchemaOf` still reads it. `TStateValue` types `value` and what
 * `matches` takes (XState `ToTestStateValue`); `matches` is a method, so a snapshot of a
 * typed state value is still a snapshot of the wide `StateValue`. `TTag` and `TEvent` are the
 * machine's tags and events (XState `MachineSnapshot<..., TTag, ...>`), which `hasTag` and
 * `can` take; both are methods for the same reason. The type parameters are in upstream's
 * order: `TContext`, `TEvent`, `TChildren`, `TStateValue`, `TTag`, `TOutput`, `TMeta`,
 * `TStateSchema` (XState `src/State.ts`).
 *
 * @since 0.1.0
 * @category Snapshot
 */
export interface MachineSnapshot<
  out TContext = unknown,
  TEvent extends EventObject = EventObject,
  out TChildren extends Record<string, unknown> = Record<string, unknown>,
  TStateValue extends StateValue = StateValue,
  TTag extends string = string,
  out TOutput = unknown,
  out TMeta = unknown,
  _TStateSchema extends StateSchema = StateSchema
> extends Snapshot<TOutput> {
  readonly [MachineSnapshotTypeId]: MachineSnapshotTypeId

  /** Current state value */
  readonly value: TStateValue

  /** Current context */
  readonly context: TContext

  /** Child actors */
  readonly children: TChildren

  /** History values for history states */
  readonly historyValue: HistoryValue

  /**
   * The tags of the active state nodes, each once, in the order of `_nodes`: upstream's native
   * `Set` as the list of its members in its order (SD-22, amended 2026-10-08); `hasTag` reads
   * membership, and the persisted form holds the same array.
   */
  readonly tags: ReadonlyArray<string>

  /**
   * The active state nodes, in the order they became active (XState `_nodes`): a microstep
   * keeps the nodes it does not exit in their places and adds the nodes it enters after them,
   * in document order, and a microstep that completes the machine leaves every node in
   * reverse document order; `resolveState` and a restore list the nodes the value names in
   * upstream `getAllStateNodes(getStateNodes(root, value))` order. The state value's key
   * order, the tags, `getMeta`, `mapState`, `stateIn` and eventless selection follow it. A
   * data field, as upstream; `toJSON` and the persisted form leave it out.
   */
  readonly _nodes: ReadonlyArray<StateNode.Any>

  /**
   * The machine that produced this snapshot (XState `snapshot.machine`, SD-6): at run time
   * the whole `StateMachine` object. The persisted form leaves it out.
   */
  readonly machine: MachineSnapshot.Machine

  /**
   * Whether the state value matches `partialStateValue` (XState `snapshot.matches`):
   * `StateValue.matchesState(partialStateValue, value)`, so a dotted string is a path, one
   * region of a parallel state matches, and a pattern more specific than the value does not.
   * A `setup` machine takes only its own state keys, as deep as its states go
   * ({@link ToTestStateValue}); a machine built without `setup` takes any state value.
   */
  matches(partialStateValue: ToTestStateValue<TStateValue>): boolean

  /**
   * Whether an active state node has the tag (XState `snapshot.hasTag`): one of the
   * machine's tags (`TTag`, `types.tags`; any string by default). A method, as `matches`, so
   * a snapshot of typed tags is still a snapshot of any tag.
   */
  hasTag(tag: TTag): boolean

  /**
   * Whether the event selects a transition that is not forbidden (XState `snapshot.can`),
   * even one that changes nothing: `{ target: [] }` and a transition with only actions
   * count, `on: { E: undefined }` does not. Guards run; no action runs and nothing is
   * spawned. It is an Effect because a guard can be one (SD-6); a guard that throws, dies or
   * names no implementation fails it with the guard-evaluation `GuardError`. The event is one
   * of the machine's events (`TEvent`; a method, so a snapshot of typed events is still a
   * snapshot of any event).
   */
  can(event: TEvent): Effect.Effect<boolean, GuardError>

  /**
   * The meta of each active state node that has one, keyed by state node id (XState
   * `snapshot.getMeta`), of the machine's state meta type (`types.meta`). The keys of a
   * `setup` machine are its state ids ({@link StateId} of the schema), so an id the machine
   * does not have is a type error; a machine built without `setup` takes any key.
   */
  readonly getMeta: () => Readonly<Partial<Record<StateId<_TStateSchema>, TMeta>>>

  /**
   * The JSON form (XState `snapshot.toJSON`, which `JSON.stringify` reads): the data fields
   * without the machine and the methods, the tags as an array, and `output` and `error` in
   * the persisted form (no key for `None`, the value for `Some`, SD-7).
   */
  readonly toJSON: () => unknown
}

/**
 * Type guard for MachineSnapshot.
 *
 * @since 0.1.0
 * @category Guards
 */
export const isMachineSnapshot = (u: unknown): u is MachineSnapshot =>
  Predicate.hasProperty(u, MachineSnapshotTypeId)

// ============================================================
// MACHINE SNAPSHOT NAMESPACE
// ============================================================

/**
 * @since 0.1.0
 * @category Snapshot
 */
export declare namespace MachineSnapshot {
  /**
   * Extract the context type from a MachineSnapshot.
   *
   * @since 0.1.0
   */
  export type Context<T> = T extends MachineSnapshot<infer C> ? C : never

  /**
   * Extract the state value type from a MachineSnapshot.
   *
   * @since 0.1.0
   */
  export type Value<T> = T extends MachineSnapshot<unknown, EventObject, Record<string, unknown>, infer V> ? V : never

  /**
   * Extract the children type from a MachineSnapshot.
   *
   * @since 0.1.0
   */
  export type Children<T> = T extends MachineSnapshot<unknown, EventObject, infer Ch> ? Ch : never

  /**
   * Extract the output type from a MachineSnapshot.
   *
   * @since 0.1.0
   */
  export type Output<T> = T extends MachineSnapshot<unknown, EventObject, Record<string, unknown>, StateValue, string, infer O> ? O : never

  /**
   * Extract the state schema of the machine that produced a MachineSnapshot (XState
   * `StateSchemaFrom<snapshot['machine']>`): the wide `StateSchema` for a machine built
   * without `setup`.
   *
   * @since 0.1.0
   */
  export type StateSchemaOf<T> = T extends MachineSnapshot<unknown, EventObject, Record<string, unknown>, StateValue, string, unknown, unknown, infer S>
    ? S
    : StateSchema

  /**
   * Any MachineSnapshot type.
   *
   * @since 0.1.0
   */
  export type Any = MachineSnapshot

  /**
   * The parts of the machine that a snapshot reads (SD-6). At run time `snapshot.machine`
   * holds the whole `StateMachine` object that produced the snapshot, as in XState; the type
   * keeps only the members that do not depend on the machine's context and event types, so
   * the machine of every snapshot fits it (as `StateNode.Machine` does for a node).
   *
   * @since 0.1.0
   */
  export interface Machine {
    readonly id: string
    /** What the snapshot queries read of the machine (internal, not XState API). */
    readonly _snapshotQueries: Queries
  }

  /**
   * The machine side of the snapshot queries (SD-6, internal): what needs the machine's state
   * nodes or its transition engine. Upstream snapshots read the nodes from their `_nodes`;
   * the port's snapshots carry the state value, so the machine reads the nodes back from it.
   *
   * @since 0.1.0
   */
  export interface Queries {
    /**
     * The state nodes `value` names, the full configuration in upstream
     * `getAllStateNodes(getStateNodes(root, value))` order (the `_nodes` of a snapshot built
     * from a value); empty when it names no state.
     */
    readonly nodes: (value: StateValue) => ReadonlyArray<StateNode.Any>
    /**
     * The state node an id names (upstream `snapshot.machine.getStateNodeById`): a custom or
     * full id, `#` optional, then an optional key path below that node (`#b.B1`); the
     * upstream message for an id or path that names no node.
     */
    readonly stateNodeById: (id: string) => Result.Result<StateNode.Any, string>
    /** The tags of the state nodes `value` names, none when it names no state. */
    readonly tags: (value: StateValue) => ReadonlyArray<string>
    /** {@link MachineSnapshot.can} for a snapshot of this machine. */
    readonly can: (snapshot: MachineSnapshot, event: EventObject) => Effect.Effect<boolean, GuardError>
  }
}

/**
 * Any machine snapshot (upstream `AnyMachineSnapshot`), whatever its context, state value,
 * children, output and meta types. Every parameter of {@link MachineSnapshot} is covariant
 * and defaults to its widest type, so the default snapshot takes every machine snapshot.
 *
 * @since 0.1.0
 * @category Snapshot
 */
export type AnyMachineSnapshot = MachineSnapshot

// ============================================================
// MACHINE SNAPSHOT CONSTRUCTORS
// ============================================================

/**
 * The JSON form of a machine snapshot (upstream `toJSON` drops `_nodes`, `machine` and the
 * methods and turns the tags into an array): the data fields, with `output` and `error` as
 * the persisted form writes an `Option` (no key for `None`), so the JSON holds no Option
 * object form and restores through the snapshot codec.
 */
const machineSnapshotJson = (snapshot: MachineSnapshot): unknown => ({
  status: snapshot.status,
  ...Option.match(snapshot.output, { onNone: () => ({}), onSome: (output) => ({ output }) }),
  ...Option.match(snapshot.error, { onNone: () => ({}), onSome: (error) => ({ error }) }),
  context: snapshot.context,
  value: snapshot.value,
  children: snapshot.children,
  historyValue: snapshot.historyValue,
  tags: Array.from(snapshot.tags),
})

/**
 * The meta of each active state node that has one (not `undefined`), keyed by state node id,
 * in the order of the snapshot's `_nodes` (upstream `getMeta`: `_nodes.reduce(...)`).
 */
const metaOfNodes = (stateNodes: ReadonlyArray<StateNode.Any>): Readonly<Record<string, unknown>> =>
  Object.fromEntries(
    stateNodes.flatMap((stateNode) =>
      Option.match(Option.fromUndefinedOr(stateNode.meta), {
        onNone: () => [],
        onSome: (meta) => [[stateNode.id, meta] as const],
      })
    )
  )

/**
 * Creates a new MachineSnapshot. It attaches the query methods as non-enumerable own
 * properties (SD-6); every engine path builds its snapshots here, so no spread drops them.
 * `TMeta` is the machine's state meta type: `getMeta` reads the meta of the machine's
 * nodes, which the machine config typed. Without `_nodes` the snapshot lists the nodes
 * `value` names (`machine`'s `nodes` query); the engine always gives them.
 *
 * @since 0.1.0
 * @category Constructors
 */
export const makeMachineSnapshot = <
  TContext,
  TStateValue extends StateValue,
  TChildren extends Record<string, unknown>,
  TOutput,
  TMeta = unknown
>(options: {
  readonly value: TStateValue
  readonly context: TContext
  readonly status: SnapshotStatus
  readonly children: TChildren
  readonly historyValue: HistoryValue
  readonly tags: ReadonlyArray<string>
  readonly _nodes?: ReadonlyArray<StateNode.Any>
  readonly output: Option.Option<TOutput>
  readonly error: Option.Option<unknown>
  readonly machine: MachineSnapshot.Machine
}): MachineSnapshot<TContext, EventObject, TChildren, TStateValue, string, TOutput, TMeta> => {
  // The queries see the snapshot as one of any state value: only the type of `matches`
  // depends on the value type, and its argument is any state value at run time
  const value: StateValue = options.value
  const fields = {
    [SnapshotTypeId]: SnapshotTypeId,
    [MachineSnapshotTypeId]: MachineSnapshotTypeId,
    ...options,
    value,
    _nodes: options._nodes ?? options.machine._snapshotQueries.nodes(options.value),
  }
  const snapshot: MachineSnapshot<TContext, EventObject, TChildren, StateValue, string, TOutput, TMeta> = Object.defineProperties(fields, {
    matches: { value: (partialStateValue: StateValue): boolean => matchesState(partialStateValue, fields.value) },
    hasTag: { value: (tag: string): boolean => fields.tags.includes(tag) },
    can: {
      value: (event: EventObject): Effect.Effect<boolean, GuardError> => fields.machine._snapshotQueries.can(snapshot, event),
    },
    getMeta: { value: (): Readonly<Record<string, unknown>> => metaOfNodes(fields._nodes) },
    toJSON: { value: (): unknown => machineSnapshotJson(snapshot) },
  }) as MachineSnapshot<TContext, EventObject, TChildren, StateValue, string, TOutput, TMeta>
  return snapshot as MachineSnapshot<TContext, EventObject, TChildren, TStateValue, string, TOutput, TMeta>
}

/**
 * Creates an initial MachineSnapshot: status `active`, no children, no history, no output
 * or error, and the tags of the state nodes `value` names in `machine` (none when it names
 * no state).
 *
 * @since 0.1.0
 * @category Constructors
 */
export const initialMachineSnapshot = <TContext>(
  value: StateValue,
  context: TContext,
  machine: MachineSnapshot.Machine
): MachineSnapshot<TContext, EventObject, Record<string, never>, StateValue, string, never> =>
  makeMachineSnapshot({
    value,
    context,
    status: "active",
    children: {},
    historyValue: {},
    tags: machine._snapshotQueries.tags(value),
    output: Option.none(),
    error: Option.none(),
    machine,
  })

// ============================================================
// MACHINE SNAPSHOT METHODS
// ============================================================

/**
 * Check if a MachineSnapshot matches a state value, as `snapshot.matches(stateValue)` does
 * (XState `matchesState(stateValue, snapshot.value)`).
 *
 * @since 0.1.0
 * @category Matching
 */
export const matches = <TContext, TStateValue extends StateValue, TChildren extends Record<string, unknown>, TOutput>(
  snapshot: MachineSnapshot<TContext, EventObject, TChildren, TStateValue, string, TOutput>,
  stateValue: StateValue
): boolean => matchesState(stateValue, snapshot.value)

/**
 * Check if a MachineSnapshot has a specific tag.
 *
 * @since 0.1.0
 * @category Tags
 */
export const hasTag = <TContext, TStateValue extends StateValue, TChildren extends Record<string, unknown>, TOutput>(
  snapshot: MachineSnapshot<TContext, EventObject, TChildren, TStateValue, string, TOutput>,
  tag: string
): boolean => snapshot.tags.includes(tag)

/**
 * Get all tags from a MachineSnapshot.
 *
 * @since 0.1.0
 * @category Tags
 */
export const getTags = <TContext, TStateValue extends StateValue, TChildren extends Record<string, unknown>, TOutput>(
  snapshot: MachineSnapshot<TContext, EventObject, TChildren, TStateValue, string, TOutput>
): ReadonlyArray<string> => Array.from(snapshot.tags)

/**
 * Updates the context of a MachineSnapshot.
 *
 * @since 0.1.0
 * @category Transformations
 */
export const updateContext = <
  TContext,
  TStateValue extends StateValue,
  TChildren extends Record<string, unknown>,
  TOutput,
  TNewContext
>(
  snapshot: MachineSnapshot<TContext, EventObject, TChildren, TStateValue, string, TOutput>,
  context: TNewContext
): MachineSnapshot<TNewContext, EventObject, TChildren, TStateValue, string, TOutput> =>
  makeMachineSnapshot({
    ...snapshot,
    context,
  })

/**
 * Updates the value of a MachineSnapshot.
 *
 * @since 0.1.0
 * @category Transformations
 */
export const updateValue = <
  TContext,
  TStateValue extends StateValue,
  TChildren extends Record<string, unknown>,
  TOutput,
  TNewStateValue extends StateValue
>(
  snapshot: MachineSnapshot<TContext, EventObject, TChildren, TStateValue, string, TOutput>,
  value: TNewStateValue
): MachineSnapshot<TContext, EventObject, TChildren, TNewStateValue, string, TOutput> =>
  makeMachineSnapshot({
    ...snapshot,
    value,
    // The active nodes follow the new value
    _nodes: snapshot.machine._snapshotQueries.nodes(value),
  })

/**
 * Updates the status of a MachineSnapshot.
 *
 * @since 0.1.0
 * @category Transformations
 */
export const updateStatus = <
  TContext,
  TStateValue extends StateValue,
  TChildren extends Record<string, unknown>,
  TOutput
>(
  snapshot: MachineSnapshot<TContext, EventObject, TChildren, TStateValue, string, TOutput>,
  status: SnapshotStatus
): MachineSnapshot<TContext, EventObject, TChildren, TStateValue, string, TOutput> =>
  makeMachineSnapshot({
    ...snapshot,
    status,
  })

/**
 * Transitions a MachineSnapshot to the done status with output.
 *
 * @since 0.1.0
 * @category Transformations
 */
export const complete = <
  TContext,
  TStateValue extends StateValue,
  TChildren extends Record<string, unknown>,
  TOutput,
  TNewOutput
>(
  snapshot: MachineSnapshot<TContext, EventObject, TChildren, TStateValue, string, TOutput>,
  output: TNewOutput
): MachineSnapshot<TContext, EventObject, TChildren, TStateValue, string, TNewOutput> =>
  makeMachineSnapshot({
    ...snapshot,
    status: "done",
    output: Option.some(output),
  })

/**
 * Transitions a MachineSnapshot to the error status.
 *
 * @since 0.1.0
 * @category Transformations
 */
export const fail = <
  TContext,
  TStateValue extends StateValue,
  TChildren extends Record<string, unknown>,
  TOutput
>(
  snapshot: MachineSnapshot<TContext, EventObject, TChildren, TStateValue, string, TOutput>,
  err: unknown
): MachineSnapshot<TContext, EventObject, TChildren, TStateValue, string, TOutput> =>
  makeMachineSnapshot({
    ...snapshot,
    status: "error",
    error: Option.some(err),
  })

/**
 * Transitions a MachineSnapshot to the stopped status.
 *
 * @since 0.1.0
 * @category Transformations
 */
export const stop = <
  TContext,
  TStateValue extends StateValue,
  TChildren extends Record<string, unknown>,
  TOutput
>(
  snapshot: MachineSnapshot<TContext, EventObject, TChildren, TStateValue, string, TOutput>
): MachineSnapshot<TContext, EventObject, TChildren, TStateValue, string, TOutput> =>
  makeMachineSnapshot({
    ...snapshot,
    status: "stopped",
  })

/**
 * A copy of a snapshot with its status, and its error, replaced (upstream
 * `{ ...snapshot, status, error }`). A machine snapshot is rebuilt through
 * {@link makeMachineSnapshot}, so it keeps its query methods (SD-6), which a spread would
 * drop; any other snapshot is spread.
 *
 * @since 0.1.0
 * @category Transformations
 */
export const withStatus = <TSnapshot extends Snapshot>(
  snapshot: TSnapshot,
  fields: { readonly status: SnapshotStatus; readonly error?: Option.Option<unknown> }
): TSnapshot =>
  isMachineSnapshot(snapshot) ? (makeMachineSnapshot({ ...snapshot, ...fields }) as unknown as TSnapshot) : { ...snapshot, ...fields }
