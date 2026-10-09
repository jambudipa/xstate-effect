/**
 * @since 0.1.0
 * @module StateMachine
 *
 * StateMachine is the core type that defines a state machine.
 */
import {
  Effect,
  Option,
  Chunk,
  HashMap,
  Pipeable,
  Inspectable,
  Predicate,
  Result,
} from "effect"
import { cancel } from "./actions/cancel.js"
import { raise } from "./actions/raise.js"
import { and } from "./guards/and.js"
import type { EventObject } from "./Event.js"
import type { AnyEventObject, UpstreamAny } from "./internal/anyEventObject.js"
import { AfterEvent, InitEvent } from "./Event.js"
import * as Persistence from "./persistence.js"
import * as StateUtils from "./stateUtils.js"
import { createInertActorScope } from "./testing/getNextSnapshot.js"
import type { SpawningMachine } from "./spawn.js"
import { createSpawner, resolveReferencedActor } from "./spawn.js"
import type { StateValue } from "./StateValue.js"
import type { MachineSnapshot } from "./Snapshot.js"
import * as Snapshot from "./Snapshot.js"
import type { StateNode } from "./StateNode.js"
import * as SN from "./StateNode.js"
import type { ActorLogic, ActorScope } from "./ActorLogic.js"
import * as AL from "./ActorLogic.js"
import type { ActorRefBase, AnyActorRef } from "./ActorRef.js"
import { isActorRef } from "./ActorRef.js"
import type {
  GuardError,
  MachineDefinitionError,
  TransitionError,
  InitializationError,
  RestoreError,
  SerializationError,
  StateNodeNotFoundError,
} from "./Errors.js"
import * as Errors from "./Errors.js"
import type {
  MachineConfig,
  MachineImplementations,
  DeclaredImplementations,
  StateSchema,
  MachineOptions,
  MachineContext,
  MachineTypes,
  MachineTypesNames,
  ParameterizedObject,
  ProvidedActor,
  ToChildren,
  TransitionConfig,
  TransitionDefinition,
  DelayedTransitionDefinition,
  Action,
  InitialTransition,
  InitialTransitionConfig,
  Guard,
  InvokeConfig,
  InvokeDefinition,
  InvokeTransitionsConfig,
  HistoryType,
  RouteTransitionConfig,
  ContextFactory,
  StateNodeConfig,
  StateNodeType,
  TransitionTarget,
  Variance,
} from "./Types.js"

// ============================================================
// STATE MACHINE TYPE ID
// ============================================================

/**
 * Type ID for StateMachine.
 *
 * @since 0.1.0
 * @category Type ID
 */
export const StateMachineTypeId: unique symbol = Symbol.for("@xstate-effect/StateMachine")

/**
 * Type ID type for StateMachine.
 *
 * @since 0.1.0
 * @category Type ID
 */
export type StateMachineTypeId = typeof StateMachineTypeId

// ============================================================
// STATE MACHINE INTERFACE
// ============================================================

/**
 * StateMachine is the core type that defines a state machine. It is an `ActorLogic` whose
 * snapshot is a `MachineSnapshot` (upstream `StateMachine implements ActorLogic`), so
 * `createActor` and the pure snapshot helpers take a machine as it is.
 *
 * `TStateSchema` is the machine's state schema (XState `TStateSchema`): the state keys of
 * the config for a `setup(...).createMachine` machine, the wide `StateSchema` otherwise. The
 * machine passes it to its snapshot type and keeps it through `provide`, `withContext` and
 * `withId`. Like the snapshot's, it has no variance annotation, so machines of any two
 * schemas stay assignable to each other and a helper that names the other nine parameters
 * still takes every machine.
 *
 * `TProvided` is what {@link StateMachine.provide} takes (XState
 * `InternalMachineImplementations` of the machine's types): for a `setup(...).createMachine`
 * machine, the setup's names, each with the type of its implementation; the wide
 * `MachineImplementations` (any name, any actor logic) otherwise. It has no variance
 * annotation either, and `provide` is a method, so machines that differ only in it stay
 * assignable to each other.
 *
 * `TStateValue` is the state value of the machine's snapshots (XState `TStateValue`): the
 * value of the config as written for a `setup(...).createMachine` machine (XState
 * `ToStateValue`), the wide `StateValue` otherwise. It types the snapshot's `value` and what
 * its `matches` takes. `TChildren` is the snapshot's `children` (XState `ToChildren`): by
 * child id, the references of the actors a setup declares; any id of any reference
 * otherwise.
 *
 * @since 0.1.0
 * @category State Machine
 */
export interface StateMachine<
  out Id extends string,
  in out TContext,
  in out TEvent extends EventObject,
  in TInput,
  in out TOutput,
  out TEmitted extends EventObject = EventObject,
  out R = never,
  in out TStateMeta = unknown,
  in out TTransitionMeta = TStateMeta,
  TStateSchema extends StateSchema = StateSchema,
  TProvided = MachineImplementations<TContext, TEvent>,
  TStateValue extends StateValue = StateValue,
  TChildren extends Record<string, unknown> = Record<string, AnyActorRef>,
  TTag extends string = string
> extends
    ActorLogic<MachineSnapshot<TContext, TEvent, TChildren, TStateValue, TTag, TOutput, TStateMeta, TStateSchema>, TEvent, TInput, TEmitted, R>,
    Pipeable.Pipeable,
    Inspectable.Inspectable {
  readonly [StateMachineTypeId]: Variance.StateMachine<Id, TContext, TEvent, TInput, TOutput, TEmitted, R, TStateMeta, TTransitionMeta>

  /** Machine ID */
  readonly id: Id

  /** Root state node */
  readonly root: StateNode<TContext, TEvent, TStateMeta, TTransitionMeta>

  /** The root's child state nodes, in config order (XState `machine.states`, the root's `states`). */
  readonly states: StateNode<TContext, TEvent, TStateMeta, TTransitionMeta>["states"]

  /**
   * The event descriptors the machine takes (XState `machine.events`, the root's `events`):
   * each node's own, in document order, each once; a forbidden event (`on: { E: undefined }`)
   * alone does not count.
   */
  readonly events: ReadonlyArray<string>

  /** The machine's own version, from the config (XState `machine.version`). */
  readonly version: string | undefined

  /** The schemas `setup({ schemas })` passed to the machine, as given (XState `machine.schemas`). */
  readonly schemas: unknown

  /** The root's definition (XState `machine.definition`): the machine's well-structured form. */
  readonly definition: SN.StateNode.Definition<TContext, TEvent, TStateMeta, TTransitionMeta>

  /** The JSON form of the machine (XState): its {@link definition}. */
  toJSON(): SN.StateNode.Definition<TContext, TEvent, TStateMeta, TTransitionMeta>

  /** Map of state IDs to state nodes */
  readonly idMap: HashMap.HashMap<string, StateNode<TContext, TEvent, TStateMeta, TTransitionMeta>>

  /** Machine implementations */
  readonly implementations: MachineImplementations<TContext, TEvent>

  /**
   * Run-time options (XState `machine.options`): the config's `options` over the defaults,
   * so `maxIterations` is `Infinity` unless the config sets it.
   */
  readonly options: MachineOptions

  /** Original machine config */
  readonly config: MachineConfig<TContext, TEvent, TInput, TOutput, TStateMeta, TTransitionMeta>

  /**
   * Computes the next snapshot given current snapshot and event. A machine whose config has a
   * definition error fails it with a `TransitionError` whose message is the upstream one and
   * whose `cause` is the `MachineDefinitionError` (SD-3, amended 2026-10-08).
   */
  readonly transition: (
    snapshot: MachineSnapshot<TContext, TEvent, TChildren, TStateValue, TTag, TOutput, TStateMeta, TStateSchema>,
    event: TEvent
  ) => Effect.Effect<
    MachineSnapshot<TContext, TEvent, TChildren, TStateValue, TTag, TOutput, TStateMeta, TStateSchema>,
    TransitionError,
    ActorScope | R
  >

  /**
   * The snapshot of a state value (XState `machine.resolveState`): the value, which may be
   * partial, is completed to a full configuration (a compound state the value leaves open
   * enters its initial child, a parallel state every region; a `#id` key names the node with
   * that id). The status is `done` when the value is final, else the given status or
   * `active`; the context is the given one, `{}` for a missing or falsy one; output and error
   * are `Option`s of the given values (D8); there are no children. An Effect (SD-3, amended
   * 2026-10-08): a value that names no state, or a machine whose config has a definition
   * error, fails it with `MachineDefinitionError` and the upstream message, where upstream
   * throws.
   */
  readonly resolveState: (config: StateMachine.ResolveStateConfig<TContext, TOutput>) => Effect.Effect<
    MachineSnapshot<TContext, EventObject, TChildren, TStateValue, string, TOutput, TStateMeta, TStateSchema>,
    MachineDefinitionError
  >

  /**
   * The snapshot after each microstep of the macrostep that processes `event` (XState
   * `machine.microstep`), in order; an event that selects no transition gives one microstep
   * with the snapshot unchanged. An Effect (SD-13) that reads the actor scope from the
   * context, as {@link transition} does, and fails as it fails.
   */
  readonly microstep: (
    snapshot: MachineSnapshot<TContext, TEvent, TChildren, TStateValue, TTag, TOutput, TStateMeta, TStateSchema>,
    event: TEvent
  ) => Effect.Effect<
    ReadonlyArray<MachineSnapshot<TContext, TEvent, TChildren, TStateValue, TTag, TOutput, TStateMeta, TStateSchema>>,
    TransitionError,
    ActorScope | R
  >

  /**
   * The transition definitions `event` selects in `snapshot` (XState
   * `machine.getTransitionData`), in selection order: one per node that takes the event, a
   * forbidden transition included, none when nothing takes it. Guards run with an inert
   * actor scope; no action runs. An Effect (SD-13) that fails with the guard-evaluation
   * `GuardError` when a guard throws or names no implementation (SD-3), and with the
   * `MachineDefinitionError` of a config that has a definition error (SD-3, amended
   * 2026-10-08).
   */
  readonly getTransitionData: (
    snapshot: MachineSnapshot<TContext, TEvent, TChildren, TStateValue, TTag, TOutput, TStateMeta, TStateSchema>,
    event: TEvent
  ) => Effect.Effect<ReadonlyArray<TransitionDefinition<TContext, TEvent, TTransitionMeta>>, GuardError | MachineDefinitionError>

  /**
   * Creates the initial snapshot for this machine. A machine whose config has a definition
   * error (upstream `createMachine` throws it) fails it with an `InitializationError` whose
   * message is the upstream one and whose `cause` is the `MachineDefinitionError` (SD-3,
   * amended 2026-10-08), so an actor of the machine has status `error` with it.
   */
  readonly getInitialSnapshot: (
    input: TInput
  ) => Effect.Effect<
    MachineSnapshot<TContext, TEvent, TChildren, TStateValue, TTag, TOutput, TStateMeta, TStateSchema>,
    InitializationError,
    ActorScope | R
  >

  /**
   * Serializes a snapshot for persistence.
   */
  readonly getPersistedSnapshot: (
    snapshot: MachineSnapshot<TContext, TEvent, TChildren, TStateValue, TTag, TOutput, TStateMeta, TStateSchema>
  ) => Effect.Effect<unknown, SerializationError>

  /**
   * Restores a snapshot from its persisted form (upstream `restoreSnapshot`), through the
   * persisted-snapshot codec; a live snapshot is read as it is. The persisted children become
   * children of the actor, not started; a child whose `src` names no implementation is left
   * out. The history value is revived by state-node id (an unknown id is dropped with the
   * upstream warning), the state value names the configuration and its tags, and each actor
   * marker of the context becomes the child it names (`undefined` when none). A value the
   * codec rejects, a state value that names no state, or a machine whose config has a
   * definition error (its `cause`, SD-3, amended 2026-10-08) fails with `RestoreError`.
   */
  readonly restoreSnapshot: (
    persisted: unknown
  ) => Effect.Effect<
    MachineSnapshot<TContext, TEvent, TChildren, TStateValue, TTag, TOutput, TStateMeta, TStateSchema>,
    RestoreError,
    ActorScope | R
  >

  /**
   * Starts each active child of the snapshot the actor starts from (upstream `start`): the
   * restored children, and the children spawned while the initial snapshot was computed. A
   * done snapshot starts nothing, as the upstream actor does not start a done logic.
   */
  readonly start: (
    snapshot: MachineSnapshot<TContext, TEvent, TChildren, TStateValue, TTag, TOutput, TStateMeta, TStateSchema>
  ) => Effect.Effect<void, never, ActorScope>

  /**
   * A new machine of the same config whose implementations are this machine's with the given
   * ones in place (XState `machine.provide`): `{ ...old, ...provided }` for each of `actions`,
   * `guards`, `actors` and `delays`, so a provided implementation replaces the one of the
   * same name and the others stay. This machine is unchanged, and a further `provide` builds
   * on the result.
   *
   * An action, guard or delay may be a plain function of `({ context, event, self, system },
   * params)`; an actor is any actor logic, which a string src then names. The names and their
   * types are the machine's (`TProvided`): a setup machine takes only the setup's names, an
   * action or guard function with the params of that action or guard, and for an actor a
   * logic of the setup's type for that name.
   *
   * @example
   * ```ts
   * const machine = setup({ actions: { track: (_, params: { id: number }) => {} } }).createMachine({
   *   entry: { type: "track", params: { id: 1 } }
   * })
   * const tested = machine.provide({ actions: { track: (_, params) => console.log(params.id) } })
   * ```
   */
  provide(
    implementations: TProvided
  ): StateMachine<Id, TContext, TEvent, TInput, TOutput, TEmitted, R, TStateMeta, TTransitionMeta, TStateSchema, TProvided, TStateValue, TChildren, TTag>

  /**
   * Creates a new machine with different context. Its {@link provide} takes the wide
   * implementations of the new context (any name), not the names of this machine.
   */
  readonly withContext: <TNewContext>(
    context: TNewContext | ((input: TInput) => TNewContext)
  ) => StateMachine<
    Id,
    TNewContext,
    TEvent,
    TInput,
    TOutput,
    TEmitted,
    R,
    TStateMeta,
    TTransitionMeta,
    TStateSchema,
    MachineImplementations<TNewContext, TEvent>,
    TStateValue,
    TChildren,
    TTag
  >

  /**
   * Creates a new machine with different ID.
   */
  readonly withId: <TNewId extends string>(
    id: TNewId
  ) => StateMachine<TNewId, TContext, TEvent, TInput, TOutput, TEmitted, R, TStateMeta, TTransitionMeta, TStateSchema, TProvided, TStateValue, TChildren, TTag>

  /**
   * The state node an id names (XState `machine.getStateNodeById`): a custom or full id, with
   * or without `#`, then an optional key path below that node (`#id.child`). An Effect (D6):
   * an id or path that names no node fails with `StateNodeNotFoundError`, whose message is the
   * upstream one (`Child state node '#<id>' does not exist on machine '<machine id>'`, or
   * `Child state '<key>' does not exist on '<id>'` for a path).
   */
  readonly getStateNodeById: (
    id: string
  ) => Effect.Effect<StateNode<TContext, TEvent, TStateMeta, TTransitionMeta>, StateNodeNotFoundError>

  /**
   * Gets all state node IDs.
   */
  readonly stateIds: ReadonlyArray<string>

  /**
   * What the snapshots of this machine read of it (SD-6, internal, not XState API): the
   * snapshot queries that need the machine's state nodes.
   */
  readonly _snapshotQueries: MachineSnapshot.Queries
}

/**
 * Type guard for StateMachine.
 *
 * @since 0.1.0
 * @category Guards
 */
export const isStateMachine = (u: unknown): u is StateMachine.Any =>
  Predicate.hasProperty(u, StateMachineTypeId)

// ============================================================
// STATE MACHINE NAMESPACE
// ============================================================

/**
 * @since 0.1.0
 * @category State Machine
 */
export declare namespace StateMachine {
  /**
   * Extract the Id type from a StateMachine.
   *
   * @since 0.1.0
   */
  export type IdOf<T> = T extends StateMachine<infer Id, infer _C, infer _E, infer _I, infer _O, infer _Em, infer _R, infer _SM, infer _TM, infer _SS, infer _P, infer _SV, infer _Ch, infer _Tg> ? Id : never

  /**
   * Extract the Context type from a StateMachine.
   *
   * @since 0.1.0
   */
  export type ContextOf<T> = T extends StateMachine<infer _Id, infer C, infer _E, infer _I, infer _O, infer _Em, infer _R, infer _SM, infer _TM, infer _SS, infer _P, infer _SV, infer _Ch, infer _Tg> ? C : never

  /**
   * Extract the Event type from a StateMachine.
   *
   * @since 0.1.0
   */
  export type EventOf<T> = T extends StateMachine<infer _Id, infer _C, infer E, infer _I, infer _O, infer _Em, infer _R, infer _SM, infer _TM, infer _SS, infer _P, infer _SV, infer _Ch, infer _Tg> ? E : never

  /**
   * Extract the Input type from a StateMachine.
   *
   * @since 0.1.0
   */
  export type InputOf<T> = T extends StateMachine<infer _Id, infer _C, infer _E, infer I, infer _O, infer _Em, infer _R, infer _SM, infer _TM, infer _SS, infer _P, infer _SV, infer _Ch, infer _Tg> ? I : never

  /**
   * Extract the Output type from a StateMachine.
   *
   * @since 0.1.0
   */
  export type OutputOf<T> = T extends StateMachine<infer _Id, infer _C, infer _E, infer _I, infer O, infer _Em, infer _R, infer _SM, infer _TM, infer _SS, infer _P, infer _SV, infer _Ch, infer _Tg> ? O : never

  /**
   * Extract the Emitted type from a StateMachine.
   *
   * @since 0.1.0
   */
  export type EmittedOf<T> = T extends StateMachine<infer _Id, infer _C, infer _E, infer _I, infer _O, infer Em, infer _R, infer _SM, infer _TM, infer _SS, infer _P, infer _SV, infer _Ch, infer _Tg> ? Em : never

  /**
   * Extract the Requirements type from a StateMachine.
   *
   * @since 0.1.0
   */
  export type RequirementsOf<T> = T extends StateMachine<infer _Id, infer _C, infer _E, infer _I, infer _O, infer _Em, infer R, infer _SM, infer _TM, infer _SS, infer _P, infer _SV, infer _Ch, infer _Tg> ? R : never

  /**
   * Any StateMachine type.
   *
   * @since 0.1.0
   */
  export type Any = StateMachine<string, unknown, EventObject, unknown, unknown, EventObject, unknown>

  /**
   * What `machine.resolveState` takes (XState): the state value, and the snapshot fields to
   * keep.
   *
   * @since 0.1.0
   */
  export interface ResolveStateConfig<TContext, TOutput> {
    readonly value: StateValue
    readonly context?: TContext
    readonly historyValue?: Snapshot.HistoryValue
    readonly status?: Snapshot.SnapshotStatus
    readonly output?: TOutput
    readonly error?: unknown
  }
}

/**
 * Any state machine (upstream `AnyStateMachine`), whatever its id, context, event, input,
 * output, emitted and meta types.
 *
 * Upstream writes it as a `StateMachine` of `any`s. The port has no `any`, and the parameters
 * of {@link StateMachine} are invariant, so no instantiation of it takes every machine.
 * `AnyStateMachine` is a structural supertype instead, as `AnyActorLogic` is: it keeps the
 * members a helper reads from a machine of unknown types, and its members that take a
 * snapshot, an event or a config are method signatures, which TypeScript checks
 * bivariantly, so every machine has them. Its `root` is an `AnyStateNode`, the same kind of
 * supertype for state nodes. `getNextSnapshot` and `createActor` take one.
 *
 * A machine whose transitions need Effect services (its `R`) is not an `AnyStateMachine`:
 * XState machines need none, and a helper that takes an `AnyStateMachine` provides the actor
 * scope only.
 *
 * @since 0.1.0
 * @category State Machine
 */
export interface AnyStateMachine extends AL.AnyActorLogic {
  readonly [StateMachineTypeId]: unknown

  /** The machine id. */
  readonly id: string

  /** The root state node, as any state node (upstream `AnyStateMachine['root']`). */
  readonly root: SN.AnyStateNode

  /**
   * The config the machine was built from. Its types depend on the machine's context and
   * events, which an `AnyStateMachine` does not know, so it is any object here.
   */
  readonly config: object

  /** {@link StateMachine.transition} of the machine, for any snapshot of it. */
  transition(snapshot: Snapshot.AnyMachineSnapshot, event: EventObject): Effect.Effect<
    Snapshot.AnyMachineSnapshot,
    TransitionError,
    ActorScope
  >

  /** {@link StateMachine.resolveState} of the machine. */
  resolveState(
    config: StateMachine.ResolveStateConfig<unknown, unknown>
  ): Effect.Effect<Snapshot.AnyMachineSnapshot, MachineDefinitionError>
}

// ============================================================
// STATE MACHINE CLASS
// ============================================================

/**
 * The type of the XState `StateMachine` class (upstream `export class StateMachine`): `new`
 * builds a machine from a config and its implementations, as {@link createMachine} does
 * (upstream `createMachine` is `new StateMachine(config, implementations)`), and every
 * machine of this module is an instance (`machine instanceof StateMachine`). The static
 * members are the functions of this module, so the calls the root `StateMachine` namespace
 * took (`StateMachine.make(...)`, `StateMachine.isStateMachine(...)`) keep working.
 *
 * @since 0.1.0
 * @category State Machine
 */
export interface StateMachineConstructor {
  new<
    TContext extends MachineContext,
    TEvent extends EventObject = AnyEventObject,
    TInput = unknown,
    TOutput = unknown,
    TEmitted extends EventObject = EventObject,
    R = never,
    TStateMeta = unknown,
    TTransitionMeta = TStateMeta,
    TAction extends ParameterizedObject = ParameterizedObject,
    TGuard extends ParameterizedObject = ParameterizedObject,
    TDelay extends string = string,
    TActor extends ProvidedActor = ProvidedActor,
    TTag extends string = string
  >(
    ...args: Parameters<
      typeof createMachine<
        TContext,
        TEvent,
        TInput,
        TOutput,
        TEmitted,
        R,
        TStateMeta,
        TTransitionMeta,
        TAction,
        TGuard,
        TDelay,
        TActor,
        TTag
      >
    >
  ): ReturnType<
    typeof createMachine<
      TContext,
      TEvent,
      TInput,
      TOutput,
      TEmitted,
      R,
      TStateMeta,
      TTransitionMeta,
      TAction,
      TGuard,
      TDelay,
      TActor,
      TTag
    >
  >
  /** Every machine: `machine instanceof StateMachine` narrows to {@link StateMachine.Any}. */
  readonly prototype: StateMachine.Any
  /** {@link StateMachineTypeId}. */
  readonly StateMachineTypeId: StateMachineTypeId
  /** {@link isStateMachine}. */
  readonly isStateMachine: typeof isStateMachine
  /** {@link normalizeTarget}. */
  readonly normalizeTarget: typeof normalizeTarget
  /** {@link make}. */
  readonly make: typeof make
  /** {@link createMachine}. */
  readonly createMachine: typeof createMachine
}

/**
 * XState `StateMachine`, the class of every machine: `new StateMachine(config,
 * implementations)` builds the machine `make(config, implementations)` builds, whose
 * prototype chain holds this class's prototype. The root `StateMachine` value is this class.
 *
 * @since 0.1.0
 * @category State Machine
 */
export const StateMachineClass: StateMachineConstructor = class StateMachine {
  // Upstream `createMachine` is `new StateMachine(config, implementations)`: the constructor
  // gives the machine `make` builds, an instance of this class through its prototype chain
  constructor(config: MachineConfig<unknown, EventObject>, implementations?: MachineImplementations<unknown, EventObject>) {
    return make(config, implementations)
  }

  static get StateMachineTypeId(): StateMachineTypeId {
    return StateMachineTypeId
  }

  static get isStateMachine(): typeof isStateMachine {
    return isStateMachine
  }

  static get normalizeTarget(): typeof normalizeTarget {
    return normalizeTarget
  }

  static get make(): typeof make {
    return make
  }

  static get createMachine(): typeof createMachine {
    return createMachine
  }
} as unknown as StateMachineConstructor

// ============================================================
// STATE MACHINE PROTO
// ============================================================

// The members every machine shares, on top of the class's prototype (so a machine is an
// instance of `StateMachineClass`)
const StateMachineProto = Object.defineProperties(Object.assign(Object.create(StateMachineClass.prototype) as object, {
  [StateMachineTypeId]: {
    _Id: {},
    _Context: {},
    _Event: {},
    _Input: {},
    _Output: {},
    _Emitted: {},
    _R: {},
    _StateMeta: {},
    _TransitionMeta: {},
  },
  // A machine is an actor logic (upstream), so `isActorLogic` holds for it
  [AL.ActorLogicTypeId]: {
    _Snapshot: {},
    _Event: {},
    _Input: {},
    _Emitted: {},
    _R: {},
  },
  pipe() {
    return Pipeable.pipeArguments(this, arguments)
  },
  // Upstream `toJSON() { return this.definition }`
  toJSON(this: StateMachine.Any) {
    return this.definition
  },
  toString(this: StateMachine.Any) {
    return `StateMachine(${this.id})`
  },
  [Inspectable.NodeInspectSymbol](this: StateMachine.Any) {
    return this.toJSON()
  },
}), {
  // Upstream `get definition() { return this.root.definition }`, read on each access
  definition: {
    get(this: StateMachine.Any) {
      return this.root.definition
    },
  },
})

// ============================================================
// INTERNAL: BUILD STATE TREE
// ============================================================

/** A single action as written in a config: any XState action form, or a port definition. */
type ActionLike<TContext, TEvent extends EventObject> = Action<TContext, TEvent>

/** One transition as written in a config: an object, a target string, or `undefined` (forbidden). */
type TransitionConfigInput<TContext, TEvent extends EventObject, TMeta = unknown> =
  | TransitionConfig<TContext, TEvent, TMeta>
  | string
  | undefined

/** The transitions of one key of a config's `on`, `onDone` or `always`: one or a list. */
type TransitionListInput<TContext, TEvent extends EventObject, TMeta = unknown> =
  | TransitionConfigInput<TContext, TEvent, TMeta>
  | ReadonlyArray<TransitionConfigInput<TContext, TEvent, TMeta>>

const isList = <A>(value: A | ReadonlyArray<A>): value is ReadonlyArray<A> => Array.isArray(value)

/** XState `toArray` for a value that is a single item or a list of items. */
const toList = <A>(value: A | ReadonlyArray<A>): ReadonlyArray<A> => (isList(value) ? value : [value])

/**
 * A single action or a list of them as a new array (XState `toArray(...).slice()`), so a
 * single string or object stays one action and the node never shares the config's array.
 */
const toActionList = <TContext, TEvent extends EventObject>(
  actions: ActionLike<TContext, TEvent> | ReadonlyArray<ActionLike<TContext, TEvent>> | undefined
): ReadonlyArray<ActionLike<TContext, TEvent>> =>
  Option.match(Option.fromNullishOr(actions), {
    onNone: () => [],
    onSome: (value) => [...toList<ActionLike<TContext, TEvent>>(value)],
  })

/** A single action or a list of them as a Chunk, as a transition definition holds them. */
const toActions = <TContext, TEvent extends EventObject>(
  actions: ActionLike<TContext, TEvent> | ReadonlyArray<ActionLike<TContext, TEvent>> | undefined
): Chunk.Chunk<ActionLike<TContext, TEvent>> => Chunk.fromIterable(toActionList(actions))

/**
 * The history kind a config declares (upstream `StateNode` constructor, `config.history ===
 * true ? 'shallow' : config.history || false`): `true` is `'shallow'`; `false` or no
 * `history` field is `false`. A `type: 'history'` node without a `history` field therefore
 * has `false`, and the engine records and restores it as shallow.
 */
const historyKind = <TContext, TEvent extends EventObject>(config: StateNodeConfig<TContext, TEvent>): false | HistoryType =>
  config.history === true ? "shallow" : (config.history ?? false)

/**
 * The node type a config declares or implies (upstream `StateNode` constructor): the
 * explicit `type`, else `compound` for a non-empty `states` map, else `history` when
 * `history` is truthy, else `atomic`. A `states` map never implies `parallel`.
 */
const nodeType = <TContext, TEvent extends EventObject>(config: StateNodeConfig<TContext, TEvent>): StateNodeType =>
  Option.match(Option.fromNullishOr(config.type), {
    onSome: (type) => type,
    onNone: () =>
      Object.keys(config.states ?? {}).length > 0 ? "compound" : historyKind(config) !== false ? "history" : "atomic",
  })

/**
 * A node's initial transition (upstream `formatInitialTransition`): the target key, with no
 * actions for the string form, and the config's actions, meta and description for the
 * object form. The key stays a string; the engine resolves it when it enters the node.
 */
const formatInitialTransition = <TContext, TEvent extends EventObject, TMeta>(
  initial: string | InitialTransitionConfig<TContext, TEvent, TMeta>
): InitialTransition<TContext, TEvent, TMeta> =>
  typeof initial === "string"
    ? { target: [initial], actions: Chunk.empty() }
    : {
        target: [initial.target],
        actions: toActions(initial.actions),
        meta: initial.meta,
        description: initial.description,
      }

/** A built node with the config it came from, which the transition pass reads. */
interface BuiltNode<TContext, TEvent extends EventObject, TStateMeta = unknown, TTransitionMeta = TStateMeta> {
  readonly node: StateNode<TContext, TEvent, TStateMeta, TTransitionMeta>
  readonly config: StateNodeConfig<TContext, TEvent, TStateMeta, TTransitionMeta>
}

/**
 * The id of a machine with no id or the empty id (XState `config.id || '(machine)'`, SD-10).
 */
const DEFAULT_MACHINE_ID = "(machine)"

/**
 * A config id that counts as given: XState reads `config.id || <default>`, so the empty id
 * falls back to the default as a missing one does.
 */
const givenId = (id: string | undefined): Option.Option<string> =>
  Option.filter(Option.fromUndefinedOr(id), (value) => value.length > 0)

/** What the tree pass needs: the machine the nodes link to, and its id (not assigned yet). */
interface BuildContext<TContext, TEvent extends EventObject> {
  readonly machine: SN.StateNode.Machine<TContext, TEvent>
  readonly machineId: string
}

/**
 * Builds the node for `config` and all its descendants (upstream `StateNode` constructor).
 * Returns them in document (pre-)order, the node first; `order` is the node's position in
 * that order. Each child links to its parent, so the parent gets its `states` object once
 * the children exist; the children keep config order.
 */
const buildStateNodes = <TContext, TEvent extends EventObject, TStateMeta, TTransitionMeta>(
  ctx: BuildContext<TContext, TEvent>,
  key: string,
  config: StateNodeConfig<TContext, TEvent, TStateMeta, TTransitionMeta>,
  parent: Option.Option<StateNode<TContext, TEvent, TStateMeta, TTransitionMeta>>,
  order: number
): readonly [
  BuiltNode<TContext, TEvent, TStateMeta, TTransitionMeta>,
  ...ReadonlyArray<BuiltNode<TContext, TEvent, TStateMeta, TTransitionMeta>>,
] => {
  const path = Option.match(parent, {
    onNone: (): ReadonlyArray<string> => [],
    onSome: (parentNode) => [...parentNode.path, key],
  })
  const node = SN.make<TContext, TEvent, TStateMeta, TTransitionMeta>({
    type: nodeType(config),
    key,
    id: Option.getOrElse(givenId(config.id), () => [ctx.machineId, ...path].join(".")),
    path,
    description: config.description,
    order,
    states: {},
    _initial: Option.map(Option.fromNullishOr(config.initial), formatInitialTransition),
    transitions: StateUtils.transitionMap([]),
    always: [],
    after: [],
    entry: toActionList(config.entry),
    exit: toActionList(config.exit),
    invoke: [],
    meta: config.meta,
    // One tag string is one tag, in config order (upstream `toArray(config.tags).slice()`)
    tags: Option.match(Option.fromNullishOr(config.tags), {
      onNone: (): ReadonlyArray<string> => [],
      onSome: (tags) => [...toList<string>(tags)],
    }),
    // Only a final node and the root keep the config's output (upstream `StateNode`), and only
    // an absent output is none: upstream tests `output !== undefined`, so `null` is an output
    output: Option.filter(Option.fromUndefinedOr(config.output), () => nodeType(config) === "final" || Option.isNone(parent)),
    history: historyKind(config),
    target: Option.fromNullishOr(config.target),
    parent,
    machine: Option.some(ctx.machine),
    // The config object itself, not a copy (upstream `this.config`)
    config,
  })
  const childConfigs = Object.entries(Option.getOrElse(Option.fromNullishOr(config.states), () => ({})))
  const descendants = childConfigs.reduce(
    (built: ReadonlyArray<BuiltNode<TContext, TEvent, TStateMeta, TTransitionMeta>>, [childKey, childConfig]) => [
      ...built,
      ...buildStateNodes(ctx, childKey, childConfig, Option.some(node), order + 1 + built.length),
    ],
    []
  )
  const children = descendants
    .filter((built) => built.node.path.length === path.length + 1)
    .map((built) => [built.node.key, built.node] as const)
  Object.assign(node, { states: Object.fromEntries(children) })
  return [{ node, config }, ...descendants]
}

/** The upstream message for a compound state node without `initial` (`src/StateNode.ts:217`). */
const noInitialStateMessage = (stateNodeId: string, firstChildKey: string): string =>
  `No initial state specified for compound state node "#${stateNodeId}". Try adding { initial: "${firstChildKey}" } to the state config.`

/** A definition error with the upstream message (SD-3). */
const definitionError = (message: string): MachineDefinitionError => new Errors.MachineDefinitionError({ message })

/**
 * The definition error of the first compound state node without `initial` below and at
 * `node` (upstream `StateNode` constructor). Upstream checks a node after its children are
 * built, so the deepest offender, in document order, comes first.
 */
const missingInitial = <TContext, TEvent extends EventObject, TStateMeta, TTransitionMeta>(
  node: StateNode<TContext, TEvent, TStateMeta, TTransitionMeta>
): Option.Option<MachineDefinitionError> =>
  Option.orElse(
    Object.values(node.states).reduce(
      (found: Option.Option<MachineDefinitionError>, child) => Option.orElse(found, () => missingInitial(child)),
      Option.none()
    ),
    () =>
      node.type === "compound" && !node.config.initial
        ? Option.some(definitionError(noInitialStateMessage(node.id, String(Object.keys(node.states)[0]))))
        : Option.none()
  )

/**
 * The targets of a transition config as a list (upstream `normalizeTarget` in `utils.ts`):
 * `undefined` for no target or the empty target (upstream `TARGETLESS_KEY`), else the target
 * list; a target is a string or a state node of any meta (SD-22 amendment, goal journal
 * `2026-10-07-13-node-containers-any.md`).
 *
 * @example
 * ```ts
 * normalizeTarget("next") // ["next"]
 * normalizeTarget("") // undefined
 * ```
 *
 * @since 0.1.0
 * @category Utils
 */
export const normalizeTarget = <
  TContext,
  TEvent extends EventObject,
  TTarget extends string | StateNode<TContext, TEvent, UpstreamAny, UpstreamAny> =
    | string
    | StateNode<TContext, TEvent, UpstreamAny, UpstreamAny>
>(
  target: TTarget | ReadonlyArray<TTarget> | undefined
): ReadonlyArray<TTarget> | undefined =>
  Option.getOrUndefined(
    Option.map(
      Option.filter(Option.fromNullishOr(target), (value) => value !== ""),
      (value) => toList<TTarget>(value)
    )
  )

/** The target strings of a transition config (`normalizeTarget`), none for no target. */
const targetStrings = (target: TransitionTarget): Option.Option<ReadonlyArray<string>> =>
  Option.fromUndefinedOr(normalizeTarget<unknown, EventObject, string>(target))

/** A transition as a config writes it, a target string or `undefined` made an object. */
const toTransitionConfig = <TContext, TEvent extends EventObject, TMeta>(
  input: TransitionConfigInput<TContext, TEvent, TMeta>
): TransitionConfig<TContext, TEvent, TMeta> => (typeof input === "string" ? { target: input } : (input ?? {}))

/**
 * The fields a definition keeps as the config writes them (upstream `formatTransition`
 * spreads the config): `description` and `meta`, each there exactly when the config has it.
 */
const writtenFields = <TContext, TEvent extends EventObject, TMeta>(
  config: TransitionConfig<TContext, TEvent, TMeta>
): Pick<TransitionDefinition<TContext, TEvent, TMeta>, "description" | "meta"> => ({
  ...(Object.hasOwn(config, "description") ? { description: config.description } : {}),
  ...(Object.hasOwn(config, "meta") ? { meta: config.meta } : {}),
})

/**
 * The JSON form of a transition definition (upstream `formatTransition`'s `toJSON`:
 * `{ ...transition, source: '#<id>', target }`, where the transition spreads its config).
 * The config's own keys come first, then the definition's, so `toJSON` itself, `reenter`
 * and the event type are there; the actions and the guard are as written (`undefined` for
 * no guard) and the targets are `#<id>` (`undefined` for a targetless transition).
 */
const transitionJson = <TContext, TEvent extends EventObject, TMeta>(
  config: TransitionConfig<TContext, TEvent, TMeta>,
  transition: TransitionDefinition<TContext, TEvent, TMeta>
): Readonly<Record<string, unknown>> => ({
  ...config,
  ...transition,
  actions: Array.from(transition.actions),
  guard: Option.getOrUndefined(transition.guard),
  source: `#${transition.source}`,
  target: transition.target?.map((target) => `#${target.id}`),
})

/**
 * One resolved transition of `source` (upstream `formatTransition`), or the definition error
 * of its first target that names no node or of a legacy `cond` (SD-3).
 */
const formatTransition = <TContext, TEvent extends EventObject, TMeta>(
  machine: StateUtils.NodeLookup<TContext, TEvent>,
  source: StateNode<TContext, TEvent>,
  eventType: string,
  input: TransitionConfigInput<TContext, TEvent, TMeta>
): Result.Result<TransitionDefinition<TContext, TEvent, TMeta>, MachineDefinitionError> => {
  const config = toTransitionConfig(input)
  // Every target resolves to its node, or the machine is invalid (SD-3); a targetless
  // transition has no target list (upstream `undefined`)
  return Result.flatMap(StateUtils.resolveTarget(machine, source, targetStrings(config.target)), (targets) => {
    // The v4 `cond` is a definition error once the target resolved, as upstream checks it
    // (its type has no `cond`; upstream reads the config at run time)
    if (Predicate.hasProperty(config, "cond") && Boolean(config.cond)) {
      return Result.fail(
        definitionError(
          `State "${source.id}" has declared \`cond\` for one of its transitions. This property has been renamed to \`guard\`. Please update your code.`
        )
      )
    }
    const transition: TransitionDefinition<TContext, TEvent, TMeta> = {
      ...writtenFields(config),
      target: Option.getOrUndefined(targets),
      guard: Option.fromNullishOr(config.guard),
      actions: toActions(config.actions),
      reenter: config.reenter ?? false,
      eventType,
      source: source.id,
      toJSON: () => transitionJson(config, transition),
    }
    return Result.succeed(transition)
  })
}

/** The transitions of `source` for one event descriptor, as written in a config. */
const formatTransitionList = <TContext, TEvent extends EventObject, TMeta>(
  machine: StateUtils.NodeLookup<TContext, TEvent>,
  source: StateNode<TContext, TEvent>,
  eventType: string,
  transitions: TransitionConfigInput<TContext, TEvent, TMeta> | ReadonlyArray<TransitionConfigInput<TContext, TEvent, TMeta>>
): Result.Result<ReadonlyArray<TransitionDefinition<TContext, TEvent, TMeta>>, MachineDefinitionError> =>
  Result.all(
    toList<TransitionConfigInput<TContext, TEvent, TMeta>>(transitions).map((transition) =>
      formatTransition(machine, source, eventType, transition)
    )
  )

/** One key of a node's `after` map: its delay, the event it waits for, and its transitions. */
interface DelayedTransitions<TContext, TEvent extends EventObject, TMeta> {
  readonly delay: number | string
  readonly event: AfterEvent
  readonly transitions: ReadonlyArray<DelayedTransitionDefinition<TContext, TEvent, TMeta>>
}

/**
 * The delayed transitions of a node (upstream `getDelayedTransitions`), one entry per key of
 * its `after` map in key order: a key that reads as a number is that many milliseconds, any
 * other key names a delay; the transitions wait for `xstate.after.<delay>.<node id>`. As
 * upstream, each transition config gets `event` and `delay` before it is formatted (so its
 * JSON form has them) and the definition gets its `delay`.
 */
const delayedTransitionsOf = <TContext, TEvent extends EventObject, TStateMeta, TTransitionMeta>(
  machine: StateUtils.NodeLookup<TContext, TEvent>,
  node: StateNode<TContext, TEvent>,
  config: StateNodeConfig<TContext, TEvent, TStateMeta, TTransitionMeta>
): Result.Result<ReadonlyArray<DelayedTransitions<TContext, TEvent, TTransitionMeta>>, MachineDefinitionError> =>
  Result.all(
    Object.entries(Option.getOrElse(Option.fromNullishOr(config.after), () => ({}))).map(([key, transitions]) => {
      const delay = Number.isNaN(Number(key)) ? key : Number(key)
      const event = new AfterEvent({ delay, stateNodeId: node.id })
      const formatted = Result.all(
        toList<TransitionConfigInput<TContext, TEvent, TTransitionMeta>>(transitions).map((transition) => {
          const delayedConfig = { ...toTransitionConfig(transition), event: event.type, delay }
          return Result.map(
            formatTransition(machine, node, event.type, delayedConfig),
            (definition): DelayedTransitionDefinition<TContext, TEvent, TTransitionMeta> => ({ ...definition, delay })
          )
        })
      )
      return Result.map(
        formatted,
        (delayedTransitions): DelayedTransitions<TContext, TEvent, TTransitionMeta> => ({
          delay,
          event,
          transitions: delayedTransitions,
        })
      )
    })
  )

/**
 * Gives a built node its event, invoke and eventless transitions, in upstream
 * `StateNode._initialize` order, or the definition error of the first invalid one (the one
 * upstream throws for, SD-3). It runs once the whole tree exists, so every target, including
 * a later sibling or a `#id` further down, resolves to its node. `onDone` becomes the node's
 * transitions on `xstate.done.state.<node id>` (upstream `formatTransitions`), after the
 * `on` entries, so it replaces an `on` entry for the same descriptor. The delayed
 * transitions come last and join an `on` entry for their event; for each `after` key the
 * node raises that event with the delay on entry and cancels it on exit (upstream
 * `getDelayedTransitions`), after the node's own entry and exit actions, so a list of
 * guarded transitions under one key schedules one event.
 */
const initializeTransitions = <TContext, TEvent extends EventObject, TStateMeta, TTransitionMeta>(
  machine: StateUtils.NodeLookup<TContext, TEvent>,
  { node, config }: BuiltNode<TContext, TEvent, TStateMeta, TTransitionMeta>
): Result.Result<void, MachineDefinitionError> =>
  Result.gen(function* () {
    // The config gives each descriptor's transitions the events it matches (upstream
    // `TransitionsConfig`); the engine reads them over the node's whole event type, as it
    // selects them by descriptor at run time
    const on: Readonly<Record<string, TransitionListInput<TContext, TEvent, TTransitionMeta>>> = Option.getOrElse(
      Option.fromNullishOr(config.on as Readonly<Record<string, TransitionListInput<TContext, TEvent, TTransitionMeta>>> | undefined),
      () => ({})
    )
    const eventTransitions = yield* Result.all(
      Object.entries(on).map(([eventType, transitions]) =>
        // The empty descriptor is a definition error, checked in key order before its
        // transitions are formatted (upstream `formatTransitions`)
        eventType === ""
          ? Result.fail(definitionError('Null events ("") cannot be specified as a transition key. Use `always: { ... }` instead.'))
          : Result.map(formatTransitionList(machine, node, eventType, transitions), (list) => [eventType, list] as const)
      )
    )
    const doneStateDescriptor = `xstate.done.state.${node.id}`
    // The config types `onDone` by the `xstate.done.state.*` event it reads (upstream
    // `DoneStateEvent`); the engine keeps every transition of the node under the machine's
    // event type, as it does the `on` transitions above
    const onDoneConfig = config.onDone as TransitionListInput<TContext, TEvent, TTransitionMeta> | undefined
    const doneTransitions = yield* Option.match(Option.fromNullishOr(onDoneConfig), {
      onNone: () => Result.succeed([]),
      onSome: (onDone) =>
        Result.map(formatTransitionList(machine, node, doneStateDescriptor, onDone), (list) => [[doneStateDescriptor, list] as const]),
    })
    const invoke = Option.match(Option.fromNullishOr(config.invoke), {
      onNone: (): ReadonlyArray<InvokeConfig<TContext, TEvent, TTransitionMeta>> => [],
      onSome: (invocations) => toList(invocations),
    }).map((inv, index): InvokeDefinition<TContext, TEvent, TTransitionMeta> => {
        // Upstream `createInvokeId`: an invocation without an id is `<index>.<node id>`
        const id = Option.getOrElse(Option.fromNullishOr(inv.id), () => StateUtils.createInvokeId(node.id, index))
        // The config types each result transition by the event it takes (upstream: done,
        // error and snapshot events); the definition keeps them on the machine's events, as
        // `on` does
        type ResultTransitions = InvokeTransitionsConfig<TContext, TEvent, TTransitionMeta>
        return {
          src: inv.src,
          id,
          systemId: Option.fromNullishOr(inv.systemId),
          input: Option.fromNullishOr(inv.input),
          // The config's transitions as written, each key there when the config has it
          // (upstream spreads the invoke config)
          ...(Object.hasOwn(inv, "onDone") ? { onDone: inv.onDone as ResultTransitions | undefined } : {}),
          ...(Object.hasOwn(inv, "onError") ? { onError: inv.onError as ResultTransitions | undefined } : {}),
          ...(Object.hasOwn(inv, "onSnapshot") ? { onSnapshot: inv.onSnapshot as ResultTransitions | undefined } : {}),
        }
      })
    // Each invocation's `onDone`, `onError` and `onSnapshot` transitions (each one transition
    // or a list of them, as an `on` key: upstream `SingleOrArray`), keyed by their event type
    const invokeTransitions = yield* Result.all(
      invoke.flatMap(({ id, onDone, onError, onSnapshot }) =>
        (
          [
            [`xstate.done.actor.${id}`, onDone],
            [`xstate.error.actor.${id}`, onError],
            [`xstate.snapshot.${id}`, onSnapshot],
          ] as const
        ).flatMap(([eventType, written]) =>
          Option.toArray(
            Option.map(Option.fromNullishOr(written), (transitions) =>
              Result.map(formatTransitionList(machine, node, eventType, transitions), (list) => [eventType, list] as const)
            )
          )
        )
      )
    )
    const delayed = yield* delayedTransitionsOf(machine, node, config)
    // Upstream `formatTransitions`: the `on` descriptors, then `onDone`, then the invocations'
    // transitions, then each delayed transition joined to its event's list
    const transitions = StateUtils.transitionMap(
      [...eventTransitions, ...doneTransitions, ...invokeTransitions],
      delayed.map(({ event, transitions: waiting }) => [event.type, waiting] as const)
    )
    const entry: ReadonlyArray<Action<TContext, TEvent>> = [
      ...node.entry,
      ...delayed.map(({ delay, event }): Action<TContext, TEvent> =>
        // The delayed event is the machine's own (`xstate.after.*`), not one of its declared
        // events; the machine takes any event at run time
        raise<TContext, TEvent>(event as TEvent, { id: event.type, delay })
      ),
    ]
    const exit: ReadonlyArray<Action<TContext, TEvent>> = [
      ...node.exit,
      ...delayed.map(({ event }): Action<TContext, TEvent> => cancel<TContext, TEvent>(event.type)),
    ]
    const always = yield* Result.all(
      Option.match(Option.fromNullishOr(config.always), {
        onNone: (): ReadonlyArray<TransitionConfigInput<TContext, TEvent, TTransitionMeta>> => [],
        onSome: (transitions) => toList<TransitionConfigInput<TContext, TEvent, TTransitionMeta>>(transitions),
      }).map((transition) => formatTransition(machine, node, "", transition))
    )
    const fields: Pick<
      SN.StateNode.Options<TContext, TEvent, TStateMeta, TTransitionMeta>,
      "transitions" | "always" | "after" | "invoke" | "entry" | "exit"
    > = {
      transitions,
      always,
      // Upstream `stateNode.after`: the delayed transitions in key order, the same objects as
      // the transitions on their events
      after: delayed.flatMap(({ transitions: waiting }) => waiting),
      invoke,
      entry,
      exit,
    }
    Object.assign(node, fields)
  })

/** The event a route transition waits for (upstream `{ type: 'xstate.route', to: '#<id>' }`). */
const ROUTE_EVENT_TYPE = "xstate.route"

/**
 * The transition config of the route to the node with the explicit id `id` (upstream
 * `formatRouteTransitions`): the route config, with the target `#<id>` and a guard that
 * passes only for a route event whose `to` is exactly `#<id>`, and, when the route has a
 * guard of its own, only when that guard passes too (`and`, so a guard name resolves
 * against the machine's implementations).
 */
const routeTransitionConfig = <TContext, TEvent extends EventObject, TMeta>(
  route: RouteTransitionConfig<TContext, TEvent, TMeta>,
  id: string
): TransitionConfig<TContext, TEvent, TMeta> => {
  const target = `#${id}`
  const routeMatches: Guard<TContext, TEvent> = ({ event }) => Predicate.hasProperty(event, "to") && event.to === target
  return {
    ...route,
    // Upstream tests the route's guard for truthiness
    guard: Option.match(Option.filter(Option.fromNullishOr(route.guard), Boolean), {
      onNone: () => routeMatches,
      // Explicit type arguments: both guards are any guard of the machine
      onSome: (guard) => and<TContext, TEvent>([routeMatches, guard]),
    }),
    target,
  }
}

/**
 * Gives the root its route transitions (upstream `formatRouteTransitions`, run once after
 * the root is initialized): for each node below the root, in document order, that has a
 * `route` config and an explicit id, a transition of the ROOT on `xstate.route` to that
 * node. A non-empty list replaces the root's own `xstate.route` transitions; a node without
 * an explicit id, and the root itself, are not routable. The root is the source, so the
 * transition domain is the root (a route to the current state re-enters it).
 */
const formatRouteTransitions = <TContext, TEvent extends EventObject, TStateMeta, TTransitionMeta>(
  machine: StateUtils.NodeLookup<TContext, TEvent>,
  root: StateNode<TContext, TEvent, TStateMeta, TTransitionMeta>,
  descendants: ReadonlyArray<BuiltNode<TContext, TEvent, TStateMeta, TTransitionMeta>>
): Result.Result<void, MachineDefinitionError> =>
  Result.map(
    Result.all(
      descendants.flatMap(({ config }) =>
        Option.match(Option.all({ route: Option.fromNullishOr(config.route), id: givenId(config.id) }), {
          onNone: (): ReadonlyArray<Result.Result<TransitionDefinition<TContext, TEvent, TTransitionMeta>, MachineDefinitionError>> => [],
          onSome: ({ route, id }) => [formatTransition(machine, root, ROUTE_EVENT_TYPE, routeTransitionConfig(route, id))],
        })
      )
    ),
    (routes) => {
      if (routes.length > 0) {
        // Upstream `rootStateNode.transitions.set('xstate.route', routeTransitions)`
        const fields: Pick<SN.StateNode.Options<TContext, TEvent, TStateMeta, TTransitionMeta>, "transitions"> = {
          transitions: StateUtils.transitionMap([...root.transitions, [ROUTE_EVENT_TYPE, routes]]),
        }
        Object.assign(root, fields)
      }
    }
  )

/**
 * Checks the default target of a history state (SD-3): it must name a node by a path below
 * the history state's parent, or by `#id`, else the machine has the definition error of the
 * upstream message (`Child state 'x' does not exist on '<parent id>'`). Upstream resolves the
 * target only when the history state is first entered.
 */
const checkHistoryTarget = <TContext, TEvent extends EventObject>(
  machine: StateUtils.NodeLookup<TContext, TEvent>,
  { node }: BuiltNode<TContext, TEvent>
): Result.Result<void, MachineDefinitionError> => {
  const target = Option.filter(node.target, (value) => value !== "")
  return node.type === "history" && Option.isSome(node.parent) && Option.isSome(target)
    ? Result.flatMap(
        Result.mapError(StateUtils.getStateNodeByPath(machine, node.parent.value, target.value), definitionError),
        () => Result.void
      )
    : Result.void
}

// ============================================================
// INTERNAL: RESTORE
// ============================================================

/** A recorded state node of a history value to revive: a `{ id }` entry, or a state node. */
interface RecordedEntry {
  readonly id: string
}

/** One child to restore, as upstream `restoreSnapshot` reads its entry. */
interface RestorableChild {
  /** The child's persisted snapshot; none gives the logic's initial snapshot. */
  readonly snapshot: Option.Option<unknown>
  readonly src: string | AL.AnyActorLogic
  readonly systemId: Option.Option<string>
  readonly syncSnapshot: boolean
}

/** What `restoreSnapshot` reads of a snapshot: the decoded persisted form, or a live snapshot. */
interface RestorableSnapshot {
  readonly status: Snapshot.SnapshotStatus
  readonly value: StateValue
  readonly context: unknown
  readonly output: Option.Option<unknown>
  readonly error: Option.Option<unknown>
  readonly historyValue: Readonly<Record<string, ReadonlyArray<RecordedEntry>>>
  readonly children: Readonly<Record<string, RestorableChild>>
}

/** The decoded persisted form as restore reads it: each child with its persisted snapshot. */
const restorableOfPersisted = (decoded: Persistence.DecodedMachineSnapshot): RestorableSnapshot => ({
  ...decoded,
  // A persisted snapshot without a context restores without one, as upstream spreads it
  context: decoded.context,
  children: Object.fromEntries(
    Object.entries(decoded.children).map(([childId, entry]) => [
      childId,
      {
        snapshot: Option.fromNullishOr(entry.snapshot),
        src: entry.src,
        systemId: entry.systemId,
        syncSnapshot: entry.syncSnapshot,
      },
    ])
  ),
})

/**
 * A live snapshot as restore reads it (upstream passes any snapshot to `restoreSnapshot`):
 * its fields as they are. Upstream reads each child actor as an entry: its `src` and
 * `systemId`, and no persisted snapshot or `syncSnapshot` (an actor has neither field), so the
 * child is created again from its logic's initial snapshot.
 */
const restorableOfLive = (snapshot: MachineSnapshot): RestorableSnapshot => ({
  ...snapshot,
  children: Object.fromEntries(
    Object.entries(snapshot.children)
      .filter((entry): entry is [string, ActorRefBase] => isActorRef(entry[1]))
      .map(([childId, child]) => [
        childId,
        {
          snapshot: Option.none(),
          src: child.src,
          systemId: Predicate.hasProperty(child, "systemId") && Predicate.isString(child.systemId)
            ? Option.some(child.systemId)
            : Option.none(),
          syncSnapshot: false,
        },
      ])
  ),
})

/** The upstream warning for a history entry whose id names no state node (`src/StateMachine.ts:641`). */
const unresolvedHistoryStateNode = (id: string): string => `Could not resolve StateNode for id: ${id}`

/**
 * The history value with each entry as the machine's state node (upstream
 * `reviveHistoryValue`): a state node stays as it is; an `{ id }` entry is looked up by id,
 * and one that names no state node is dropped with the upstream warning. A history state
 * whose entries are all dropped has no record.
 */
const reviveHistoryValue = <TContext, TEvent extends EventObject>(
  machine: StateUtils.NodeLookup<TContext, TEvent>,
  historyValue: Readonly<Record<string, ReadonlyArray<RecordedEntry>>>
): Effect.Effect<Snapshot.HistoryValue> =>
  Effect.map(
    Effect.forEach(Object.entries(historyValue), ([historyStateNodeId, recorded]) =>
      Effect.map(
        Effect.forEach(recorded, (entry): Effect.Effect<Option.Option<Snapshot.RecordedStateNode>> =>
          SN.isStateNode(entry)
            ? Effect.succeed(Option.some(entry))
            : Result.match(StateUtils.getStateNodeById(machine, entry.id), {
                onFailure: () => Effect.as(Effect.logWarning(unresolvedHistoryStateNode(entry.id)), Option.none()),
                onSuccess: (stateNode) => Effect.succeed(Option.some(stateNode)),
              })
        ),
        (resolved) => [historyStateNodeId, resolved.flatMap(Option.toArray)] as const
      )
    ),
    (entries) => Object.fromEntries(entries.filter(([, stateNodes]) => stateNodes.length > 0))
  )

/**
 * Creates the actor's children from their entries (upstream `restoreSnapshot`): a string
 * `src` names a logic of the machine's implementations; an entry whose `src` names none is
 * left out. Each child gets its entry's id, systemId, `syncSnapshot` and persisted snapshot.
 */
const restoreChildren = (
  actorScope: AL.ActorScopeService,
  machine: SpawningMachine,
  children: Readonly<Record<string, RestorableChild>>
): Effect.Effect<Readonly<Record<string, AnyActorRef>>> =>
  Effect.map(
    Effect.forEach(Object.entries(children), ([childId, entry]) =>
      Option.match(typeof entry.src === "string" ? resolveReferencedActor(machine, entry.src) : Option.some(entry.src), {
        onNone: () => Effect.succeed(Option.none<readonly [string, AnyActorRef]>()),
        onSome: (logic) =>
          Effect.map(
            actorScope.restoreChild({
              logic,
              src: entry.src,
              id: childId,
              systemId: entry.systemId,
              syncSnapshot: entry.syncSnapshot,
              snapshot: entry.snapshot,
            }),
            (child) => Option.some([childId, child] as const)
          ),
      })
    ),
    (restored) => Object.fromEntries(restored.flatMap(Option.toArray))
  )

// ============================================================
// STATE MACHINE CONSTRUCTOR
// ============================================================

/**
 * Creates a StateMachine from a config.
 *
 * It never throws (SD-3, amended 2026-10-08). Where upstream `createMachine` throws a
 * definition error (a compound state without `initial`, a target that names no state, a
 * legacy `cond`, the empty event key, a history target that names no state), the machine
 * keeps the first one, in upstream order, and each Effect that computes a snapshot of it
 * fails with it: `getInitialSnapshot` (an `InitializationError`), `restoreSnapshot` (a
 * `RestoreError`), `transition` and `microstep` (a `TransitionError`), each with the upstream
 * message and the `MachineDefinitionError` as its `cause`, and `resolveState` and
 * `getTransitionData` with the `MachineDefinitionError`.
 *
 * The Effect requirement `R` is never inferred: the config holds no place for it, so it is
 * `never` unless given as a type argument. `NoInfer` keeps the call's context from choosing
 * it, so `createActor(make({ ... }))` gives the same machine type as a machine built first,
 * and its actor needs only a `Scope`.
 *
 * @since 0.1.0
 * @category Constructors
 */
export const make = <
  TContext,
  TEvent extends EventObject,
  TInput = unknown,
  TOutput = unknown,
  TEmitted extends EventObject = EventObject,
  R = never,
  TStateMeta = unknown,
  TTransitionMeta = TStateMeta
>(
  config: MachineConfig<TContext, TEvent, TInput, TOutput, TStateMeta, TTransitionMeta>,
  implementations?: MachineImplementations<TContext, TEvent>
): StateMachine<string, TContext, TEvent, TInput, TOutput, TEmitted, NoInfer<R>, TStateMeta, TTransitionMeta> => {
  // Every node links to the machine, so the machine object exists before the tree; it gets
  // its fields once the tree is built.
  const self: StateMachine<string, TContext, TEvent, TInput, TOutput, TEmitted, R, TStateMeta, TTransitionMeta> =
    Object.create(StateMachineProto)

  // Build the state tree in document order, then the transitions, whose targets resolve
  // against the finished tree. A machine with no id (or the empty id) has the id
  // `(machine)`, as upstream (SD-10).
  const machineId = Option.getOrElse(givenId(config.id), () => DEFAULT_MACHINE_ID)
  const built = buildStateNodes<TContext, TEvent, TStateMeta, TTransitionMeta>(
    { machine: self, machineId },
    machineId,
    config,
    Option.none(),
    0
  )
  const root = built[0].node
  const idMap = HashMap.fromIterable(built.map(({ node }) => [node.id, node] as const))
  const lookup: StateUtils.NodeLookup<TContext, TEvent> = { id: machineId, idMap }
  // The first definition error, in upstream order (SD-3, amended 2026-10-08): a compound node
  // without `initial` (the deepest first), then each node's transitions in document order,
  // then the route transitions, then the history targets; nothing after it runs. Upstream
  // `createMachine` throws it. Here the machine keeps it, and each Effect that computes a
  // snapshot of the machine fails with it (`definitionFailure`).
  const definition = [
    () => Option.match(missingInitial(root), { onNone: () => Result.void, onSome: Result.fail }),
    ...built.map((node) => () => initializeTransitions(lookup, node)),
    () => formatRouteTransitions(lookup, root, built.slice(1)),
    ...built.map((node) => () => checkHistoryTarget(lookup, node)),
  ].reduce(
    (done: Result.Result<void, MachineDefinitionError>, step) => Result.flatMap(done, step),
    Result.void
  )
  const definitionFailure: Effect.Effect<void, MachineDefinitionError> = Effect.fromResult(definition)
  // The definition error as the failure of a transition from `snapshot` on `event`
  const asTransitionFailure = (snapshot: unknown, event: unknown): Effect.Effect<void, TransitionError> =>
    Effect.mapError(
      definitionFailure,
      (error) => new Errors.TransitionError({ message: error.message, snapshot, event, cause: error })
    )

  // Upstream `this.options`: the config's options over the defaults
  const options: MachineOptions = { maxIterations: Infinity, ...config.options }

  // What the transition engine reads of this machine
  const transitionMachine: SN.StateNode.Machine<TContext, TEvent> = {
    root,
    idMap,
    implementations: Option.getOrElse(Option.fromNullishOr(implementations), (): MachineImplementations<TContext, TEvent> => ({})),
    id: machineId,
    version: config.version,
    options,
  }

  // The state nodes a value names, in the order a snapshot built from it holds them (upstream
  // `getAllStateNodes(getStateNodes(root, value))`); none for a value that names no state
  const configurationOfValue = (value: StateValue): ReadonlyArray<StateNode<TContext, TEvent>> =>
    Result.getOrElse(StateUtils.configurationOfValue(transitionMachine, value), (): ReadonlyArray<StateNode<TContext, TEvent>> => [])

  // A configuration as a snapshot's `_nodes`: `StateNode` is invariant in its context and
  // event, so the nodes are widened to `StateNode.Any` (upstream `AnyStateNode`)
  const asSnapshotNodes = (configuration: ReadonlyArray<StateNode<TContext, TEvent>>): ReadonlyArray<StateNode.Any> =>
    configuration as unknown as ReadonlyArray<StateNode.Any>

  // The transition data of a snapshot of this machine (upstream `getTransitionData`):
  // selection runs the guards and no action, and the inert actor scope gives the guards a self
  // and a system that do nothing
  const transitionDataContext = (
    snapshot: MachineSnapshot,
    event: EventObject
  ): StateUtils.EngineContext<TContext, TEvent> => ({
    machine: transitionMachine,
    // A snapshot of this machine: its context and events are the machine's own
    snapshot: snapshot as MachineSnapshot<TContext, EventObject, Record<string, AnyActorRef>>,
    event: event as TEvent,
    actorScope: createInertActorScope(snapshot),
  })

  // What the snapshots of this machine read of it (SD-6). `can` is upstream
  // `machine.getTransitionData` with the non-forbidden filter.
  const snapshotQueries: MachineSnapshot.Queries = {
    nodes: (value) => asSnapshotNodes(configurationOfValue(value)),
    // Widened as `nodes` is: the node of this machine's tree as `StateNode.Any`
    stateNodeById: (id) =>
      Result.map(StateUtils.getStateNodeById(transitionMachine, id), (node) => node as unknown as StateNode.Any),
    tags: (value) => StateUtils.getConfigurationTags(configurationOfValue(value)),
    can: (snapshot, event) => StateUtils.canTakeEvent(transitionDataContext(snapshot, event)),
  }

  const machine: StateMachine<string, TContext, TEvent, TInput, TOutput, TEmitted, R, TStateMeta, TTransitionMeta> = Object.assign(
    self,
    {
      id: machineId,
      root,
      // Upstream `this.states = this.root.states`, `this.events = this.root.events` (after the
      // route transitions), `this.version = this.config.version`, `this.schemas =
      // this.config.schemas`
      states: root.states,
      events: root.events,
      version: config.version,
      schemas: config.schemas,
      idMap,
      implementations: Option.getOrElse(Option.fromNullishOr(implementations), (): MachineImplementations<TContext, TEvent> => ({})),
      options,
      config,
      stateIds: built.map(({ node }) => node.id),
      _snapshotQueries: snapshotQueries,

      // Upstream `resolveState`: the snapshot of the completed configuration, with no children
      resolveState: (
        resolveConfig: StateMachine.ResolveStateConfig<TContext, TOutput>
      ): Effect.Effect<
        MachineSnapshot<TContext, EventObject, Record<string, AnyActorRef>, StateValue, string, TOutput, TStateMeta>,
        MachineDefinitionError
      > =>
        Effect.map(
          Effect.flatMap(definitionFailure, () =>
            Effect.fromResult(StateUtils.resolveStateNodes(transitionMachine, resolveConfig.value))
          ),
          (resolved) =>
            Snapshot.makeMachineSnapshot<TContext, StateValue, Record<string, AnyActorRef>, TOutput, TStateMeta>({
              value: resolved.value,
              // Upstream `config.context || {}`
              context: Option.getOrElse(Option.filter(Option.fromUndefinedOr(resolveConfig.context), Boolean), () => ({}) as TContext),
              status: resolved.done ? "done" : (resolveConfig.status ?? "active"),
              children: {},
              historyValue: resolveConfig.historyValue ?? {},
              _nodes: asSnapshotNodes(resolved.configuration),
              tags: StateUtils.getConfigurationTags(resolved.configuration),
              output: Option.fromUndefinedOr(resolveConfig.output),
              error: Option.fromUndefinedOr(resolveConfig.error),
              // The machine object itself (XState `snapshot.machine`, SD-6)
              machine: self,
            })
        ),

      transition: (
        snapshot: MachineSnapshot<TContext, EventObject, Record<string, AnyActorRef>, StateValue, string, TOutput, TStateMeta>,
        event: TEvent
      ): Effect.Effect<
        MachineSnapshot<TContext, EventObject, Record<string, AnyActorRef>, StateValue, string, TOutput, TStateMeta>,
        TransitionError,
        ActorScope | R
      > =>
        Effect.gen(function* () {
          yield* asTransitionFailure(snapshot, event)
          const actorScope = yield* AL.ActorScope
          return yield* StateUtils.macrostep(transitionMachine, snapshot, event, actorScope)
        }) as Effect.Effect<
          MachineSnapshot<TContext, EventObject, Record<string, AnyActorRef>, StateValue, string, TOutput, TStateMeta>,
          TransitionError,
          ActorScope | R
        >,

      // Upstream `getTransitionData`: `transitionNode` from the root, guards with an inert scope
      getTransitionData: (
        snapshot: MachineSnapshot<TContext, EventObject, Record<string, AnyActorRef>, StateValue, string, TOutput, TStateMeta>,
        event: TEvent
      ): Effect.Effect<ReadonlyArray<TransitionDefinition<TContext, TEvent, TTransitionMeta>>, GuardError | MachineDefinitionError> =>
        Effect.flatMap(
          definitionFailure,
          () =>
            // The selected definitions are this machine's own, of its transition meta type
            StateUtils.getTransitionData(transitionDataContext(snapshot, event)) as Effect.Effect<
              ReadonlyArray<TransitionDefinition<TContext, TEvent, TTransitionMeta>>,
              GuardError
            >
        ),

      // Upstream `microstep`: `macrostep(...).microsteps`, with the actor scope of the context
      microstep: (
        snapshot: MachineSnapshot<TContext, EventObject, Record<string, AnyActorRef>, StateValue, string, TOutput, TStateMeta>,
        event: TEvent
      ): Effect.Effect<
        ReadonlyArray<MachineSnapshot<TContext, EventObject, Record<string, AnyActorRef>, StateValue, string, TOutput, TStateMeta>>,
        TransitionError,
        ActorScope | R
      > =>
        Effect.gen(function* () {
          yield* asTransitionFailure(snapshot, event)
          const actorScope = yield* AL.ActorScope
          return yield* StateUtils.macrostepMicrosteps(transitionMachine, snapshot, event, actorScope)
        }) as Effect.Effect<
          ReadonlyArray<MachineSnapshot<TContext, EventObject, Record<string, AnyActorRef>, StateValue, string, TOutput, TStateMeta>>,
          TransitionError,
          ActorScope | R
        >,

      getInitialSnapshot: (
        input: TInput
      ): Effect.Effect<
        MachineSnapshot<TContext, EventObject, Record<string, AnyActorRef>, StateValue, string, TOutput, TStateMeta>,
        InitializationError,
        ActorScope | R
      > =>
        Effect.gen(function* () {
          // An invalid machine has no initial snapshot (SD-3, amended 2026-10-08): the failure
          // carries the definition error and its upstream message, as for an `initial` key
          // that names no child below
          yield* Effect.mapError(
            definitionFailure,
            (error) => new Errors.InitializationError({ message: error.message, input, cause: error })
          )
          const actorScope = yield* AL.ActorScope
          const initEvent: EventObject = new InitEvent({ input })

          // The context factory runs as an assign on the pre-initial snapshot (upstream
          // `_getPreInitialState`): it gets the input, the actor and a spawn whose children
          // belong to the actor (D12) and join the pre-initial snapshot's children. The
          // input function of a spawn by name sees the empty context and the init event. Its
          // result merges into the empty context as an assign's partial update does
          // (upstream `resolveAssign`: `Object.assign({}, context, partialUpdate)`), so a
          // falsy result gives `{}` and an object result a shallow copy: a new plain object
          // with the result's own enumerable keys. A context that is no function and is falsy
          // (missing, `null`, `0`, `""`, `false`, `NaN`) starts as the empty context `{}`, as
          // upstream (`typeof context !== 'function' && context ? context : {}`); the type
          // allows no context only while the context type is undeclared
          // (`MachineContextConfig`).
          const preInitialContext = {}
          const spawner = createSpawner(actorScope, transitionMachine, preInitialContext, initEvent)

          // A snapshot in which only the root is active (upstream `createMachineSnapshot` with
          // `_nodes: [this.root]`), with the given context and children
          const rootOnly = (
            context: TContext,
            children: Readonly<Record<string, AnyActorRef>>
          ): MachineSnapshot<TContext, EventObject, Record<string, AnyActorRef>, StateValue, string, TOutput, TStateMeta> =>
            Snapshot.makeMachineSnapshot<TContext, StateValue, Record<string, AnyActorRef>, TOutput, TStateMeta>({
              value: {},
              context,
              status: "active",
              children: { ...children },
              historyValue: {},
              _nodes: asSnapshotNodes([root]),
              // The tags of the root, its only active node
              tags: StateUtils.getConfigurationTags([root]),
              output: Option.none<TOutput>(),
              error: Option.none(),
              // The machine object itself (XState `snapshot.machine`, SD-6)
              machine: self,
            })

          // Upstream `getInitialSnapshot` catches what the initialization throws and gives the
          // snapshot it had then, with status `error` and the thrown value as the error: the
          // machine snapshot interface stays (the value of the root's initial states,
          // `matches`), as upstream's "should retain the machine snapshot interface when
          // resolving input throws" requires.
          const failed = (
            snapshot: MachineSnapshot<TContext, EventObject, Record<string, AnyActorRef>, StateValue, string, TOutput, TStateMeta>,
            error: unknown
          ): MachineSnapshot<TContext, EventObject, Record<string, AnyActorRef>, StateValue, string, TOutput, TStateMeta> =>
            Snapshot.makeMachineSnapshot({
              ...snapshot,
              value: StateUtils.getStateValue(root, [root]),
              tags: StateUtils.getConfigurationTags([root]),
              status: "error",
              error: Option.some(error),
            })

          // The pre-initial snapshot (upstream `_getPreInitialState`): only the root is active.
          // A factory is user code: what it throws (a missing input it reads, too) or a spawn
          // by a name the machine lacks dies here. Upstream's catch then holds the snapshot
          // from before the factory: the empty context and no children.
          const preInitial = yield* Effect.gen(function* () {
            const context =
              typeof config.context === "function"
                ? (Object.assign(
                    {},
                    preInitialContext,
                    // The machine's context is a `MachineContext` once inferred
                    (config.context as ContextFactory<MachineContext, ProvidedActor, TInput, TEvent>)({
                      input,
                      spawn: spawner.spawn,
                      // The actor scope's self is the actor of this machine, which takes its events
                      self: actorScope.self as Parameters<ContextFactory<MachineContext, ProvidedActor, TInput, TEvent>>[0]["self"],
                    })
                  ) as TContext)
                : Option.getOrElse(
                    // A value given while the context type is undeclared is the inferred context
                    Option.filter(Option.fromUndefinedOr(config.context as TContext | undefined), Boolean),
                    () => ({}) as TContext
                  )
            return rootOnly(context, yield* spawner.flush)
          }).pipe(Effect.catchDefect((defect) => Effect.succeed(failed(rootOnly({} as TContext, {}), defect))))
          // A factory that failed ends the initialization: upstream returns from its catch
          if (preInitial.status === "error") {
            return preInitial
          }

          // The initial microstep, then the initial macrostep with the same internal queue
          // (upstream `initialMicrostep` and `macrostep`); every action sees the init event.
          // The actor computes the initial snapshot at creation; its action executor
          // queues the custom actions until `start`, as upstream's does.
          const initial = yield* StateUtils.initialMacrostep(transitionMachine, preInitial, initEvent as TEvent, actorScope).pipe(
            // An `initial` key that names no child fails, as upstream fails `getInitialSnapshot`
            Effect.catchTag("MachineDefinitionError", (error) =>
              Effect.fail(new Errors.InitializationError({ message: error.message, input, cause: error }))
            ),
            // A failing initial macrostep (an infinite loop past `maxIterations`) or what an
            // initial action or guard throws gives the pre-initial snapshot with status `error`,
            // as upstream does
            Effect.catchTag("TransitionError", (error) => Effect.succeed(failed(preInitial, error))),
            Effect.catchDefect((defect) => Effect.succeed(failed(preInitial, defect)))
          )

          // The engine sets the root output when the machine completes; it is typed `TOutput` here
          return initial as MachineSnapshot<TContext, EventObject, Record<string, AnyActorRef>, StateValue, string, TOutput, TStateMeta>
        }),

      // The persisted-snapshot codec (SD-7): children, tags, history ids, context refs
      getPersistedSnapshot: (
        snapshot: MachineSnapshot<TContext, EventObject, Record<string, AnyActorRef>, StateValue, string, TOutput, TStateMeta>
      ): Effect.Effect<unknown, SerializationError> => Persistence.persistMachineSnapshot(snapshot),

      // Upstream `restoreSnapshot`, with the persisted form decoded through the codec (SD-7). The
      // state value is checked before any child is created, so a failed restore creates none.
      restoreSnapshot: (
        persisted: unknown
      ): Effect.Effect<
        MachineSnapshot<TContext, EventObject, Record<string, AnyActorRef>, StateValue, string, TOutput, TStateMeta>,
        RestoreError,
        ActorScope | R
      > =>
        Effect.gen(function* () {
          // An invalid machine restores nothing (SD-3, amended 2026-10-08)
          yield* Effect.mapError(definitionFailure, (error) => new Errors.RestoreError({ message: error.message, cause: error }))
          const actorScope = yield* AL.ActorScope
          const restorable = Snapshot.isMachineSnapshot(persisted)
            ? restorableOfLive(persisted)
            : restorableOfPersisted(yield* Persistence.decodeMachineSnapshot(persisted))
          const configuration = yield* Result.match(StateUtils.configurationOfValue(transitionMachine, restorable.value), {
            onFailure: (message) => Effect.fail(new Errors.RestoreError({ message })),
            onSuccess: (stateNodes) => Effect.succeed(stateNodes),
          })
          const children = yield* restoreChildren(actorScope, transitionMachine, restorable.children)
          const historyValue = yield* reviveHistoryValue(transitionMachine, restorable.historyValue)
          return Snapshot.makeMachineSnapshot<TContext, StateValue, Record<string, AnyActorRef>, TOutput, TStateMeta>({
            value: StateUtils.getStateValue(root, configuration),
            // The context is the persisted one, of the machine's type (upstream restores it as is)
            context: Persistence.reviveContext(restorable.context, children) as TContext,
            status: restorable.status,
            children,
            historyValue,
            _nodes: asSnapshotNodes(configuration),
            tags: StateUtils.getConfigurationTags(configuration),
            output: restorable.output as Option.Option<TOutput>,
            error: restorable.error,
            // The machine object itself (XState `snapshot.machine`, SD-6)
            machine: self,
          })
        }),

      // Upstream `start`: each active child starts, in the order of `snapshot.children`
      start: (
        snapshot: MachineSnapshot<TContext, EventObject, Record<string, AnyActorRef>, StateValue, string, TOutput, TStateMeta>
      ): Effect.Effect<void, never, ActorScope> =>
        snapshot.status === "done"
          ? Effect.void
          : Effect.gen(function* () {
              const actorScope = yield* AL.ActorScope
              yield* Effect.forEach(
                Object.values(snapshot.children).filter((child) => isActorRef(child)),
                (child) =>
                  Effect.flatMap(child.getSnapshotUntyped, (childSnapshot) =>
                    childSnapshot.status === "active" ? actorScope.startChild(child) : Effect.void
                  ),
                { discard: true }
              )
            }),

      // Upstream `provide`: the same config, each record merged with the provided one over it
      provide: (newImplementations: MachineImplementations<TContext, TEvent>) => {
        const mergedImplementations: MachineImplementations<TContext, TEvent> = {
          actions: { ...implementations?.actions, ...newImplementations.actions },
          guards: { ...implementations?.guards, ...newImplementations.guards },
          actors: { ...implementations?.actors, ...newImplementations.actors },
          delays: { ...implementations?.delays, ...newImplementations.delays },
        }
        return make<TContext, TEvent, TInput, TOutput, TEmitted, R, TStateMeta, TTransitionMeta>(config, mergedImplementations)
      },

      withContext: <TNewContext>(newContext: TNewContext | ((input: TInput) => TNewContext)) =>
        make<TContext, TEvent, TInput, TOutput, TEmitted, R, TStateMeta, TTransitionMeta>(
          { ...config, context: newContext as unknown as TContext },
          implementations
        ),

      withId: <TNewId extends string>(newId: TNewId) =>
        make<TContext, TEvent, TInput, TOutput, TEmitted, R, TStateMeta, TTransitionMeta>({ ...config, id: newId }, implementations),

      // Upstream `getStateNodeById`: an id, `#` optional, then a key path below that node
      getStateNodeById: (
        id: string
      ): Effect.Effect<StateNode<TContext, TEvent, TStateMeta, TTransitionMeta>, StateNodeNotFoundError> =>
        Result.match(StateUtils.getStateNodeById(transitionMachine, id), {
          onFailure: (message) => Effect.fail(new Errors.StateNodeNotFoundError({ id, message })),
          // A node of this machine's tree, of its meta types
          onSuccess: (node) => Effect.succeed(node as StateNode<TContext, TEvent, TStateMeta, TTransitionMeta>),
        }),
    }
  )

  return machine
}

/**
 * A state machine named by upstream's type parameters, in upstream's order (upstream
 * `StateMachine<TContext, TEvent, TChildren, TActor, TAction, TGuard, TDelay, TStateValue,
 * TTag, TInput, TOutput, TEmitted, TStateMeta, TStateSchema, TTransitionMeta>`): the root
 * type `StateMachine`. It is the port's {@link StateMachine} of any id, with no Effect
 * requirement (upstream has none), whose `provide` takes the records of the declared
 * actors, actions, guards and delays, as `createMachine` gives them. So a machine fits it,
 * and a function that takes it infers the machine's context and events from it.
 *
 * @example
 * ```ts
 * const accept = <TContext extends MachineContext, TEvent extends EventObject>(
 *   machine: UpstreamStateMachine<TContext, TEvent, any, any, any, any, any, any, any, any, any, any, any, any>
 * ) => machine
 * ```
 *
 * @since 0.1.0
 * @category State Machine
 */
export type UpstreamStateMachine<
  TContext extends MachineContext,
  TEvent extends EventObject,
  TChildren extends Record<string, AnyActorRef | undefined>,
  TActor extends ProvidedActor,
  TAction extends ParameterizedObject,
  TGuard extends ParameterizedObject,
  TDelay extends string,
  TStateValue extends StateValue,
  TTag extends string,
  TInput,
  TOutput,
  TEmitted extends EventObject,
  TStateMeta,
  TStateSchema extends StateSchema,
  TTransitionMeta = TStateMeta
> = StateMachine<
  string,
  TContext,
  TEvent,
  TInput,
  TOutput,
  TEmitted,
  never,
  TStateMeta,
  TTransitionMeta,
  TStateSchema,
  CreatedMachineImplementations<TContext, TEvent, TAction, TGuard, TDelay, TActor>,
  TStateValue,
  TChildren,
  TTag
>

/**
 * The event type of a machine built by {@link createMachine}: `TEvent` itself, read through a
 * conditional type so that the call's context does not choose it (TypeScript infers no type
 * argument from the check type of a conditional type), as `NoInfer` would. Unlike
 * `NoInfer<TEvent>`, which keeps a union of object types wrapped, the result is the plain
 * union, so `Extract<EventFrom<typeof machine>, ...>` and `EventFrom<typeof machine, K>`
 * select its members (upstream's machine types carry the plain union).
 */
type CreatedMachineEvent<TEvent extends EventObject> = TEvent extends infer TMember extends EventObject ? TMember
  : never

/**
 * What `provide` takes for a machine built by {@link createMachine}: the wide
 * `MachineImplementations` while its `types` declare no actions, guards, delays or actors,
 * else the records of the declared names (`DeclaredImplementations`).
 */
type CreatedMachineImplementations<
  TContext,
  TEvent extends EventObject,
  TAction extends ParameterizedObject,
  TGuard extends ParameterizedObject,
  TDelay extends string,
  TActor extends ProvidedActor
> = [string, string, string, string] extends [TAction["type"], TGuard["type"], TDelay, TActor["src"]]
  ? MachineImplementations<TContext, TEvent>
  : DeclaredImplementations<TContext, TEvent, TAction, TGuard, TDelay, TActor>

/**
 * Creates a StateMachine from a config, as {@link make} does. The config may also hold
 * XState's `types` member (`types: {} as { context: ...; events: ... }`, see
 * `MachineTypes`), from which the machine's context, event, input, output, emitted and meta
 * types are inferred. The member carries no value at run time; `machine.config` keeps it.
 * Without declared events the event type is `AnyEventObject`, as upstream: an event with any
 * other members.
 *
 * The Effect requirement `R` is never inferred: the config holds no place for it, so it is
 * `never` unless given as a type argument. `NoInfer` keeps the call's context from choosing
 * it, so `createActor(createMachine({ ... }))` gives the same machine type as a machine built
 * first, and its actor needs only a `Scope`. The call's context never chooses the event type
 * either (see `CreatedMachineEvent`): a machine written inline where any logic is
 * expected (an invocation's `src`) keeps the event type of its own config, as a machine built
 * first does.
 * The input type is upstream's: when the config declares none, the call's context gives it,
 * so a machine written inline as an invocation's `src` (whose `AnyActorLogic` takes upstream's
 * `any` input, SD-22 amendment 2026-10-07) reads any member of its input in its context
 * factory; a machine built first takes an `unknown` input.
 *
 * The actions, guards, delays and actors `types` declares (`TAction`, `TGuard`, `TDelay`,
 * `TActor`) type the records of the implementations, here and in the machine's `provide`:
 * only those names, each action and guard with the params of its uses (so an `assign`
 * written there reads its params type), each actor with its declared logic (upstream
 * `InternalMachineImplementations`). A record the `types` member does not declare takes any
 * name. The same names, and the tags `types` declares (`TTag`), type the config itself
 * (upstream `MachineConfig<..., TActor, TAction, TGuard, TDelay, TTag>`): an action, guard,
 * delay, actor src or tag the `types` member does not declare is a type error there. The
 * machine's snapshot children are typed by the declared actors (upstream `ToChildren<TActor>`):
 * an optional reference of its logic under each declared id.
 *
 * @since 0.1.0
 * @category Constructors
 */
export const createMachine = <
  TContext extends MachineContext,
  TEvent extends EventObject = AnyEventObject,
  TInput = unknown,
  TOutput = unknown,
  TEmitted extends EventObject = EventObject,
  R = never,
  TStateMeta = unknown,
  TTransitionMeta = TStateMeta,
  TAction extends ParameterizedObject = ParameterizedObject,
  TGuard extends ParameterizedObject = ParameterizedObject,
  TDelay extends string = string,
  TActor extends ProvidedActor = ProvidedActor,
  TTag extends string = string
>(
  config: MachineConfig<
    TContext,
    TEvent,
    TInput,
    TOutput,
    TStateMeta,
    TTransitionMeta,
    NoInfer<MachineTypesNames<TAction, TGuard, TDelay, TActor, TEmitted, NoInfer<TTag>>>
  > & {
    readonly types?: MachineTypes<
      TContext,
      TEvent,
      TInput,
      TOutput,
      TEmitted,
      TStateMeta,
      TTransitionMeta,
      TAction,
      TGuard,
      TDelay,
      TActor,
      TTag
    >
  },
  implementations?: NoInfer<DeclaredImplementations<TContext, TEvent, TAction, TGuard, TDelay, TActor>>
): StateMachine<
  string,
  TContext,
  CreatedMachineEvent<TEvent>,
  TInput,
  TOutput,
  TEmitted,
  NoInfer<R>,
  TStateMeta,
  TTransitionMeta,
  StateSchema,
  CreatedMachineImplementations<TContext, TEvent, TAction, TGuard, TDelay, TActor>,
  StateValue,
  ToChildren<TActor>,
  TTag
> =>
  // The declared names only narrow the config, the records the implementations and `provide`
  // take; the machine runs any config and any record
  make<TContext, TEvent, TInput, TOutput, TEmitted, R, TStateMeta, TTransitionMeta>(
    config as MachineConfig<TContext, TEvent, TInput, TOutput, TStateMeta, TTransitionMeta>,
    implementations as MachineImplementations<TContext, TEvent> | undefined
  ) as unknown as StateMachine<
    string,
    TContext,
    CreatedMachineEvent<TEvent>,
    TInput,
    TOutput,
    TEmitted,
    NoInfer<R>,
    TStateMeta,
    TTransitionMeta,
    StateSchema,
    CreatedMachineImplementations<TContext, TEvent, TAction, TGuard, TDelay, TActor>,
    StateValue,
    ToChildren<TActor>,
    TTag
  >
