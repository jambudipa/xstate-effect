/**
 * @since 0.1.0
 * @module @jambudipa/xstate-effect
 *
 * XState rewritten using Effect-TS.
 *
 * This is a ground-up implementation of XState's core concepts using Effect,
 * providing type-safe, composable, and concurrent state management.
 */
import * as ActorModule from "./Actor.js"
import type * as ActorLogicModule from "./ActorLogic.js"
import type * as ActorRefModule from "./ActorRef.js"
import type { EventObject as EventObjectType } from "./Event.js"
import type * as SnapshotModule from "./Snapshot.js"
import * as StateMachineModule from "./StateMachine.js"
import type * as TypesModule from "./Types.js"
import * as StateValueModule from "./StateValue.js"

// ============================================================
// RE-EXPORTS
// ============================================================

/**
 * Error types.
 *
 * @since 0.1.0
 */
export * as Errors from "./Errors.js"
export type {
  TransitionError,
  InitializationError,
  ActorError,
  GuardError,
  ActionError,
  StateNodeNotFoundError,
  SerializationError,
  RestoreError,
  InvalidPersistedSnapshotError,
  StartError,
  InvokeError,
  DelayError,
  XStateError,
} from "./Errors.js"

/**
 * Event types.
 *
 * @since 0.1.0
 */
export * as Event from "./Event.js"
export type {
  EventObject,
  WildcardEvent,
  EventlessEvent,
  EventType,
  EventByType,
  EventDescriptor,
  ExtractEvent,
} from "./Event.js"
export type { AnyEventObject } from "./internal/anyEventObject.js"
export {
  InitEvent,
  StopEvent,
  DoneActorEvent,
  ErrorActorEvent,
  DoneStateEvent,
  AfterEvent,
  SnapshotEvent,
  NULL_EVENT,
  isEventObject,
  isNullEvent,
  isWildcardType,
  isDoneActorEvent,
  isErrorActorEvent,
  isDoneStateEvent,
  isAfterEvent,
  matchesEventDescriptor,
} from "./Event.js"
/**
 * XState `assertEvent`: an Effect that succeeds with the event, narrowed, when it matches one
 * of the given types, and fails with an `EventAssertionError` of the upstream message
 * otherwise (SD-3, amended 2026-10-08).
 *
 * @since 0.1.0
 */
export { assertEvent } from "./assert.js"

/**
 * The `StateValue` module: the state-value utilities (`StateValue.matches`,
 * `StateValue.fromPath`, ...). The same root name is also the XState `StateValue` type,
 * below.
 *
 * @since 0.1.0
 */
export const StateValue = StateValueModule
/**
 * The XState state value (upstream `StateValue`, a root type there): a state key, or a map
 * from each active child key to its own state value.
 *
 * @since 0.1.0
 */
export type StateValue = StateValueModule.StateValue
/**
 * The types of the `StateValue` module, read as `StateValue.StateValue` and
 * `StateValue.StateValueMap`.
 *
 * @since 0.1.0
 */
export declare namespace StateValue {
  /**
   * A state key, or a map from each active child key to its own state value.
   *
   * @since 0.1.0
   */
  export type StateValue = StateValueModule.StateValue
  /**
   * A map from each active child key to its own state value.
   *
   * @since 0.1.0
   */
  export type StateValueMap = StateValueModule.StateValueMap
}
export type {
  StateValue as StateValueType,
  StateValueMap,
} from "./StateValue.js"
/**
 * XState `matchesState` (pattern first, dotted paths) and `pathToStateValue` (the empty path
 * is `{}`), from the root as upstream `src/utils.ts` exports them.
 *
 * @since 0.1.0
 */
export { matchesState, pathToStateValue } from "./StateValue.js"
/**
 * XState `__unsafe_getAllOwnEventDescriptors(snapshot)`, from the root as upstream
 * `src/utils.ts` exports it: the event descriptors the active state nodes of a machine
 * snapshot take, each once. It is the function the graph entry point uses.
 *
 * @since 0.1.0
 */
export { getAllOwnEventDescriptors as __unsafe_getAllOwnEventDescriptors } from "./graph/utils.js"
/**
 * XState `getStateNodes(stateNode, stateValue)` from `src/stateUtils.ts` (SD-11: the graph
 * function of that name stays in `./graph`). It returns an Effect that fails with
 * `MachineDefinitionError` for a value that names no state (SD-3).
 *
 * @since 0.1.0
 */
export { getStateNodes } from "./stateUtils.js"
/**
 * XState `mapState`: one result for each active state node whose mapper has a `map`, leaf
 * to root.
 *
 * @since 0.1.0
 */
export { mapState } from "./mapState.js"

/**
 * Snapshot types.
 *
 * @since 0.1.0
 */
export * as Snapshot from "./Snapshot.js"
/**
 * The snapshot of any actor (upstream `Snapshot`, a root type there): its status, output and
 * error. The same root name is also the `Snapshot` module above, so `Snapshot<TOutput>` is
 * this type and `Snapshot.isSnapshot` a member of the module.
 *
 * @since 0.1.0
 */
export type Snapshot<TOutput = unknown> = SnapshotModule.Snapshot<TOutput>
export type {
  AnyHistoryValue,
  AnyMachineSnapshot,
  AnyStateConfig,
  SnapshotStatus,
  Snapshot as SnapshotType,
  MachineSnapshot,
  HistoryValue,
  StateConfig,
} from "./Snapshot.js"
export {
  SnapshotTypeId,
  MachineSnapshotTypeId,
  SnapshotStatusSchema,
  isSnapshot,
  isMachineSnapshot,
  active,
  done,
  error,
  stopped,
  isActive,
  isDone,
  isError,
  isStopped,
  makeMachineSnapshot,
  initialMachineSnapshot,
  matches,
  hasTag,
  getTags,
  updateContext,
  updateValue,
  updateStatus,
  complete,
  fail,
} from "./Snapshot.js"

/**
 * ActorLogic interface.
 *
 * @since 0.1.0
 */
export * as ActorLogic from "./ActorLogic.js"
/**
 * The logic of an actor (upstream `ActorLogic`, a root type there): how it computes its
 * initial snapshot and the next one for each event. The same root name is also the
 * `ActorLogic` module above, so `ActorLogic<TSnapshot, TEvent>` is this type and
 * `ActorLogic.isActorLogic` a member of the module. The parameters after the event follow
 * the port's interface: input, emitted events, then the Effect requirements.
 *
 * @since 0.1.0
 */
export type ActorLogic<
  TSnapshot extends SnapshotModule.Snapshot,
  TEvent extends EventObjectType,
  TInput = unknown,
  TEmitted extends EventObjectType = EventObjectType,
  R = never
> = ActorLogicModule.ActorLogic<TSnapshot, TEvent, TInput, TEmitted, R>
export type {
  ActorLogic as ActorLogicType,
  ActorScopeService,
  AnyActorLogic,
  CustomActionExecution,
} from "./ActorLogic.js"
export {
  ActorLogicTypeId,
  ActorScope,
  isActorLogic,
  make as makeActorLogic,
} from "./ActorLogic.js"

/**
 * ActorRef type.
 *
 * @since 0.1.0
 */
export * as ActorRef from "./ActorRef.js"
/**
 * A reference to an actor (upstream `ActorRef`, a root type there). The same root name is
 * also the `ActorRef` module above, so `ActorRef<TSnapshot, TEvent, TEmitted>` is this type
 * and `ActorRef.isActorRef` a member of the module.
 *
 * @since 0.1.0
 */
export type ActorRef<
  TSnapshot extends SnapshotModule.Snapshot,
  TEvent extends EventObjectType,
  TEmitted extends EventObjectType = EventObjectType
> = ActorRefModule.ActorRef<TSnapshot, TEvent, TEmitted>
export type {
  ActorRef as ActorRefType,
  AnyActorRef,
  SnapshotStream,
  UnknownActorRef,
} from "./ActorRef.js"
export {
  ActorRefTypeId,
  isActorRef,
  getId,
  equals,
  isChildOf,
  send,
  toSnapshotStream,
} from "./ActorRef.js"

/**
 * StateNode: the state node class (XState `StateNode`). Its static members are the
 * functions of the StateNode module, as the former `StateNode` namespace exposed them.
 *
 * @since 0.1.0
 */
export { StateNode } from "./StateNode.js"
export type {
  AnyStateNode,
  AnyStateNodeDefinition,
  HistoryStateNode,
  StateNode as StateNodeInterface,
} from "./StateNode.js"
export {
  StateNodeTypeId,
  isStateNode,
  make as makeStateNode,
  atomic,
  compound,
  parallel,
  final,
  historyState,
  getChild,
  getChildren,
  getTransitions,
  getInitialTarget,
  getLeafStates,
  isAtomic,
  isCompound,
  isParallel,
  isFinal,
  isHistory,
  isLeaf,
  isAncestor,
  isDescendant,
  withTransitions,
  withEntry,
  withExit,
  withInvoke,
  withTags,
  withParent,
} from "./StateNode.js"

/**
 * XState `StateMachine`, the class of every machine (`machine instanceof StateMachine`;
 * `new StateMachine(config, implementations)` builds one as `createMachine` does). Its
 * static members are the functions of the StateMachine module (`StateMachine.make`,
 * `StateMachine.isStateMachine`, ...), and the namespace below holds the module's types.
 *
 * @since 0.1.0
 */
export const StateMachine = StateMachineModule.StateMachineClass
/**
 * The types of the StateMachine module, read as `StateMachine.StateMachine`,
 * `StateMachine.StateMachine.ContextOf`, `StateMachine.AnyStateMachine`, ...
 *
 * @since 0.1.0
 */
export declare namespace StateMachine {
  /**
   * The port's own machine type, the id first (`StateMachine.StateMachine` of the module).
   *
   * @since 0.1.0
   */
  export type StateMachine<
    Id extends string,
    TContext,
    TEvent extends EventObjectType,
    TInput,
    TOutput,
    TEmitted extends EventObjectType = EventObjectType,
    R = never,
    TStateMeta = unknown,
    TTransitionMeta = TStateMeta,
    TStateSchema extends TypesModule.StateSchema = TypesModule.StateSchema,
    TProvided = TypesModule.MachineImplementations<TContext, TEvent>,
    TStateValue extends StateValueModule.StateValue = StateValueModule.StateValue,
    TChildren extends Record<string, unknown> = Record<string, ActorRefModule.AnyActorRef>,
    TTag extends string = string
  > = StateMachineModule.StateMachine<
    Id,
    TContext,
    TEvent,
    TInput,
    TOutput,
    TEmitted,
    R,
    TStateMeta,
    TTransitionMeta,
    TStateSchema,
    TProvided,
    TStateValue,
    TChildren,
    TTag
  >
  /**
   * The extractors of the port's machine type (`StateMachine.StateMachine.ContextOf<T>`, ...).
   *
   * @since 0.1.0
   */
  export namespace StateMachine {
    /**
     * The id of a machine.
     *
     * @since 0.1.0
     */
    export type IdOf<T> = StateMachineModule.StateMachine.IdOf<T>
    /**
     * The context of a machine.
     *
     * @since 0.1.0
     */
    export type ContextOf<T> = StateMachineModule.StateMachine.ContextOf<T>
    /**
     * The events of a machine.
     *
     * @since 0.1.0
     */
    export type EventOf<T> = StateMachineModule.StateMachine.EventOf<T>
    /**
     * The input of a machine.
     *
     * @since 0.1.0
     */
    export type InputOf<T> = StateMachineModule.StateMachine.InputOf<T>
    /**
     * The output of a machine.
     *
     * @since 0.1.0
     */
    export type OutputOf<T> = StateMachineModule.StateMachine.OutputOf<T>
    /**
     * The events a machine emits.
     *
     * @since 0.1.0
     */
    export type EmittedOf<T> = StateMachineModule.StateMachine.EmittedOf<T>
    /**
     * The Effect requirements of a machine.
     *
     * @since 0.1.0
     */
    export type RequirementsOf<T> = StateMachineModule.StateMachine.RequirementsOf<T>
    /**
     * Any machine of the port's type.
     *
     * @since 0.1.0
     */
    export type Any = StateMachineModule.StateMachine.Any
    /**
     * What `resolveState` takes.
     *
     * @since 0.1.0
     */
    export type ResolveStateConfig<TContext, TOutput> = StateMachineModule.StateMachine.ResolveStateConfig<TContext, TOutput>
  }
  /**
   * A machine whose types are not known.
   *
   * @since 0.1.0
   */
  export type AnyStateMachine = StateMachineModule.AnyStateMachine
  /**
   * A machine named by upstream's type parameters, the context first (the root
   * `StateMachine` type).
   *
   * @since 0.1.0
   */
  export type UpstreamStateMachine<
    TContext extends TypesModule.MachineContext,
    TEvent extends EventObjectType,
    TChildren extends Record<string, ActorRefModule.AnyActorRef | undefined>,
    TActor extends TypesModule.ProvidedActor,
    TAction extends TypesModule.ParameterizedObject,
    TGuard extends TypesModule.ParameterizedObject,
    TDelay extends string,
    TStateValue extends StateValueModule.StateValue,
    TTag extends string,
    TInput,
    TOutput,
    TEmitted extends EventObjectType,
    TStateMeta,
    TStateSchema extends TypesModule.StateSchema,
    TTransitionMeta = TStateMeta
  > = StateMachineModule.UpstreamStateMachine<
    TContext,
    TEvent,
    TChildren,
    TActor,
    TAction,
    TGuard,
    TDelay,
    TStateValue,
    TTag,
    TInput,
    TOutput,
    TEmitted,
    TStateMeta,
    TStateSchema,
    TTransitionMeta
  >
  /**
   * The type of the `StateMachine` class.
   *
   * @since 0.1.0
   */
  export type StateMachineConstructor = StateMachineModule.StateMachineConstructor
  /**
   * The type id of a machine.
   *
   * @since 0.1.0
   */
  export type StateMachineTypeId = StateMachineModule.StateMachineTypeId
}
/**
 * A state machine named by upstream's type parameters, the context first (upstream
 * `StateMachine`, a root class there; `StateMachine.UpstreamStateMachine`). The same root
 * name is also the `StateMachine` class above, so `StateMachine<TContext, TEvent, ...>` is
 * this type and `StateMachine.createMachine` a static member of the class; the port's own
 * machine type, the id first, is `StateMachine.StateMachine` (`StateMachineType`).
 *
 * @since 0.1.0
 */
export type StateMachine<
  TContext extends TypesModule.MachineContext,
  TEvent extends EventObjectType,
  TChildren extends Record<string, ActorRefModule.AnyActorRef | undefined>,
  TActor extends TypesModule.ProvidedActor,
  TAction extends TypesModule.ParameterizedObject,
  TGuard extends TypesModule.ParameterizedObject,
  TDelay extends string,
  TStateValue extends StateValueModule.StateValue,
  TTag extends string,
  TInput,
  TOutput,
  TEmitted extends EventObjectType,
  TStateMeta,
  TStateSchema extends TypesModule.StateSchema,
  TTransitionMeta = TStateMeta
> = StateMachineModule.UpstreamStateMachine<
  TContext,
  TEvent,
  TChildren,
  TActor,
  TAction,
  TGuard,
  TDelay,
  TStateValue,
  TTag,
  TInput,
  TOutput,
  TEmitted,
  TStateMeta,
  TStateSchema,
  TTransitionMeta
>
export type {
  AnyStateMachine,
  StateMachine as StateMachineType,
} from "./StateMachine.js"
export {
  StateMachineTypeId,
  isStateMachine,
  make as makeStateMachine,
  createMachine,
} from "./StateMachine.js"

/**
 * XState `Actor`, the class of every actor (`actor instanceof Actor`); `createActor` builds
 * actors (D6, SD-8). Its static members are the functions of the Actor module
 * (`Actor.make`, `Actor.isActor`, ...), and the namespace below holds the module's types.
 *
 * @since 0.1.0
 */
export const Actor = ActorModule.ActorClass
/**
 * The types of the Actor module, read as `Actor.Actor`, `Actor.Actor.Any`,
 * `Actor.AnyActor`, ...
 *
 * @since 0.1.0
 */
export declare namespace Actor {
  /**
   * An actor of known snapshot, event and emitted types (`Actor.Actor` of the module).
   *
   * @since 0.1.0
   */
  export type Actor<
    TSnapshot extends SnapshotModule.Snapshot,
    TEvent extends EventObjectType,
    TEmitted extends EventObjectType = EventObjectType
  > = ActorModule.Actor<TSnapshot, TEvent, TEmitted>
  /**
   * The extractors of an actor type (`Actor.Actor.SnapshotOf<T>`, ...).
   *
   * @since 0.1.0
   */
  export namespace Actor {
    /**
     * The snapshot of an actor.
     *
     * @since 0.1.0
     */
    export type SnapshotOf<T> = ActorModule.Actor.SnapshotOf<T>
    /**
     * The events an actor takes.
     *
     * @since 0.1.0
     */
    export type EventOf<T> = ActorModule.Actor.EventOf<T>
    /**
     * The events an actor emits.
     *
     * @since 0.1.0
     */
    export type EmittedOf<T> = ActorModule.Actor.EmittedOf<T>
    /**
     * Any actor of the port's actor type.
     *
     * @since 0.1.0
     */
    export type Any = ActorModule.Actor.Any
  }
  /**
   * Any actor (the root `AnyActor`).
   *
   * @since 0.1.0
   */
  export type AnyActor = ActorModule.AnyActor
  /**
   * The signatures of `make` and `createActor`.
   *
   * @since 0.1.0
   */
  export type MakeActor = ActorModule.MakeActor
  /**
   * A selected value of an actor's snapshot.
   *
   * @since 0.1.0
   */
  export type Readable<T> = ActorModule.Readable<T>
  /**
   * The type of the `Actor` class.
   *
   * @since 0.1.0
   */
  export type ActorConstructor = ActorModule.ActorConstructor
  /**
   * The type id of an actor.
   *
   * @since 0.1.0
   */
  export type ActorTypeId = ActorModule.ActorTypeId
}
export type {
  Actor as ActorType,
  AnyActor,
  Readable,
} from "./Actor.js"
export type {
  ActorSystemService,
  SchedulerService,
} from "./ActorLogic.js"
export {
  ActorTypeId,
  isActor,
  make as makeActor,
  createActor,
} from "./Actor.js"

/**
 * ActorSystem service.
 *
 * @since 0.1.0
 */
export * as ActorSystem from "./ActorSystem.js"
/**
 * An actor system typed by the actors it declares (upstream `ActorSystem<T>`, a root type
 * there). The same root name is also the `ActorSystem` module above, so `ActorSystem<T>` is
 * this type and `ActorSystem.makeActorSystem` a member of the module.
 *
 * @since 0.1.0
 */
export type ActorSystem<T extends ActorLogicModule.ActorSystemInfo> = ActorLogicModule.TypedActorSystem<T>
export type { ActorSystemInfo } from "./ActorLogic.js"
export {
  ActorSystem as ActorSystemTag,
  Scheduler as SchedulerTag,
  SchedulerLive,
  ActorSystemLive,
  Live as ActorSystemLiveFull,
  makeActorSystem,
} from "./ActorSystem.js"

/**
 * Type definitions.
 *
 * @since 0.1.0
 */
export * as Types from "./Types.js"
/**
 * XState `SpecialTargets`: the send target names of the parent (`#_parent`) and of the actor
 * itself (`#_internal`).
 *
 * @since 0.1.0
 */
export { SpecialTargets } from "./Types.js"
export type {
  ProcessingStatus,
  StateNodeType,
  HistoryType,
  TransitionTarget,
  TransitionConfig,
  TransitionsConfig,
  RouteTransitionConfig,
  TransitionDefinition,
  Transitions,
  DelayedTransitionDefinition,
  InitialTransition,
  InitialTransitionConfig,
  TypedActorContext,
  ActionContext,
  ActionDefinition,
  Action,
  ActionArgs,
  ActionFunction,
  ActionImplementation,
  ActionParams,
  DynamicParams,
  ParameterizedAction,
  ActionResult,
  GuardContext,
  GuardDefinition,
  BuiltInGuardDefinition,
  Guard,
  GuardArgs,
  GuardImplementation,
  GuardPredicate,
  GuardScope,
  ParameterizedGuard,
  UnknownGuard,
  SpawnOptions,
  ActorRefFrom,
  ActorRefFromLogic,
  SnapshotFrom,
  InputFrom,
  OutputFrom,
  EmittedFrom,
  MachineImplementationsFrom,
  StateValueFrom,
  TagsFrom,
  InvokeConfig,
  InvokeConfigMembers,
  InvokeInput,
  InvokeTransitionsConfig,
  InvokeDefinition,
  OutputDefinition,
  MachineImplementations,
  StateNodeConfig,
  MachineConfig,
  MachineContext,
  ContextFactory,
  MachineOptions,
  MachineTypes,
  StateSchema,
  RoutableStateId,
  ProvidedActor,
  ParameterizedObject,
  ImplementationNames,
  ActionReference,
  GuardReference,
  DelayedTransitionsConfig,
  ActorOptions,
  ActorOptionsArgs,
  RequiredActorOptionsKeys,
  DevToolsAdapter,
} from "./Types.js"

/**
 * The type of the synchronous `spawn` that assigners and the context factory receive
 * (upstream `src/spawn.ts`).
 *
 * @since 0.1.0
 */
export type { Spawner } from "./spawn.js"

/**
 * Inspection events (upstream `src/inspection.ts`).
 *
 * @since 0.1.0
 */
export type {
  InspectedActionEvent,
  InspectedActorEvent,
  InspectedEventEvent,
  InspectedMicrostepEvent,
  InspectedSnapshotEvent,
  InspectedTransitionEvent,
  InspectionEvent,
} from "./inspection.js"

/**
 * Setup API for creating type-safe machines.
 *
 * @since 0.1.0
 */
export * from "./setup.js"

/**
 * Built-in actions.
 *
 * @since 0.1.0
 */
export * as actions from "./actions/index.js"
export { assign, assignProperty } from "./actions/assign.js"
export { sendTo, sendParent, sendSelf, forwardTo } from "./actions/sendTo.js"
export { raise } from "./actions/raise.js"
export { spawnChild } from "./actions/spawnChild.js"
export { stopChild, stopAllChildren } from "./actions/stopChild.js"
/**
 * XState `stop`, the deprecated alias of `stopChild` (SD-11), with the rest of the
 * `stopChild` module. A star export: a named re-export of the deprecated `stop` fails the
 * gate's `no-deprecated` rule. The port's former root `stop` (a snapshot function) stays
 * reachable as `Snapshot.stop`.
 *
 * @since 0.1.0
 */
export * from "./actions/stopChild.js"
export { emit } from "./actions/emit.js"
export { cancel } from "./actions/cancel.js"
export { log, logDebug, logInfo, logWarning, logError } from "./actions/log.js"
export { enqueueActions } from "./actions/enqueueActions.js"

/**
 * Built-in guards.
 *
 * @since 0.1.0
 */
export * as guards from "./guards/index.js"
export { stateIn, stateNotIn } from "./guards/stateIn.js"
export { and } from "./guards/and.js"
export { or } from "./guards/or.js"
export { not } from "./guards/not.js"

/**
 * Pre-built actor logic.
 *
 * @since 0.1.0
 */
export * as actors from "./actors/index.js"
/**
 * XState `createEmptyActor`: a new, unstarted root actor whose snapshot has an `undefined`
 * context and which accepts any event (D6: an Effect in the caller's scope).
 *
 * @since 0.1.0
 */
export { createEmptyActor } from "./actors/index.js"
export {
  fromPromise,
  type PromiseActorLogic,
  type PromiseActorRef,
  type PromiseSnapshot,
} from "./actors/fromPromise.js"
export {
  type CallbackActorLogic,
  type CallbackActorRef,
  type CallbackLogicFunction,
  type CallbackSnapshot,
  fromCallback,
} from "./actors/fromCallback.js"
export {
  fromTransition,
  fromTransitionWithInput,
  type TransitionActorLogic,
  type TransitionActorRef,
  type TransitionActorScope,
  type TransitionSnapshot,
} from "./actors/fromTransition.js"
export {
  fromEventObservable,
  fromObservable,
  fromStream,
  type ObservableActorLogic,
  type ObservableActorRef,
  type ObservableSnapshot,
  type Observer,
  type Subscribable,
} from "./actors/fromObservable.js"
export {
  type EffectActorLogic,
  type EffectActorRef,
  type EffectSnapshot,
  fromEffect,
  fromEffectBackground,
} from "./actors/fromEffect.js"

/**
 * Testing utilities.
 *
 * @since 0.1.0
 */
export * as testing from "./testing/index.js"
export {
  SimulatedClock,
  type SyncSimulatedClock,
  makeSimulatedClock,
  type SimulatedClockEffect,
  makeSimulatedClockEffect,
  TimeTravelError,
} from "./testing/SimulatedClock.js"
export {
  WaitForTimeoutError,
  WaitForTerminatedError,
  type WaitForOptions,
  waitFor,
  waitForPromise,
} from "./testing/waitFor.js"
export {
  ActorOutputError,
  toEffect,
  toPromise,
} from "./testing/toPromise.js"
export {
  type ExecutableActionObject,
  type ExecutableActionsFrom,
  type ExecutableSpawnAction,
  getInitialMicrosteps,
  getInitialSnapshot,
  getMicrosteps,
  getNextSnapshot,
  getNextTransitions,
  initialTransition,
  type SpecialExecutableAction,
  transition,
} from "./testing/getNextSnapshot.js"

// ============================================================
// UPSTREAM TYPE NAMES (EXP-1)
// ============================================================

/**
 * XState's general type utilities (upstream `src/types.ts`), from the root as upstream
 * exports them.
 *
 * @since 0.1.0
 */
export type {
  AnyFunction,
  Cast,
  Compute,
  ConditionalRequired,
  DoNotInfer,
  Elements,
  Equals,
  GetConcreteByKey,
  HomomorphicOmit,
  HomomorphicPick,
  Identity,
  IndexByProp,
  IndexByType,
  InferEvent,
  Invert,
  IsAny,
  IsLiteralString,
  IsNever,
  IsNotNever,
  Lazy,
  LowInfer,
  MaybeLazy,
  Merge,
  MetaObject,
  NoInfer,
  NonReducibleUnknown,
  Prop,
  SingleOrArray,
  TODO,
  Values,
} from "./typeUtils.js"

/**
 * XState's config, definition, implementation and actor types (upstream `src/types.ts`) on
 * the port's own types, from the root as upstream exports them.
 *
 * @since 0.1.0
 */
export type {
  ActionExecutor,
  ActionFunctionMap,
  Actions,
  ActorLike,
  ActorLogicFrom,
  ActorRefLike,
  AnyActorScope,
  AnyInvokeConfig,
  AnyState,
  AnyStateNodeConfig,
  AnyTransitionConfig,
  AnyTransitionDefinition,
  AtomicStateNodeConfig,
  BaseActorRef,
  BuiltinActionResolution,
  DelayConfig,
  DelayExpr,
  DelayFunctionMap,
  DelayedTransitions,
  EventFromLogic,
  GetParameterizedParams,
  HistoryStateNodeConfig,
  InternalMachineImplementations,
  InteropSubscribable,
  LogExpr,
  MachineImplementationsSimplified,
  Mapper,
  NoRequiredParams,
  RaiseActionOptions,
  RaiseActionParams,
  RequiredActorOptions,
  RequiredLogicInput,
  ResolvedStateMachineTypes,
  SendExpr,
  SendToActionOptions,
  SendToActionParams,
  SimpleOrStateNodeConfig,
  StateFrom,
  StateId,
  StateKey,
  StateLike,
  StateMachineDefinition,
  StateMachineTypes,
  StateNodeDefinition,
  StateNodesConfig,
  StateSchemaFrom,
  StatesConfig,
  StatesDefinition,
  StateTypes,
  ToChildren,
  ToStateValue,
  TransitionConfigOrTarget,
  TransitionConfigTarget,
  TransitionDefinitionMap,
  UnifiedArg,
  UnknownAction,
  UnknownActorLogic,
  UnknownMachineConfig,
  WithDynamicParams,
} from "./Types.js"

/**
 * Upstream's deprecated names of the actor types (`Interpreter`, `AnyInterpreter`,
 * `InterpreterFrom`). A star export: a named re-export of a deprecated name fails the gate's
 * `no-deprecated` rule.
 *
 * @since 0.1.0
 */
export type * from "./interpreter.js"

/**
 * The initial transition of a state node (upstream `InitialTransitionDefinition`).
 *
 * @since 0.1.0
 */
export type { InitialTransitionDefinition } from "./StateNode.js"

/**
 * A persisted history value (upstream `PersistedHistoryValue`).
 *
 * @since 0.1.0
 */
export type { PersistedHistoryValue } from "./persistence.js"

/**
 * The executable form of a named action (upstream `ToExecutableAction`).
 *
 * @since 0.1.0
 */
export type { ToExecutableAction } from "./testing/getNextSnapshot.js"

/**
 * The types of the built-in actions (upstream `src/actions/*.ts`), from the root as
 * upstream exports them; `./actions` exports them too (`StopAction` comes with the
 * `stopChild` module above).
 *
 * @since 0.1.0
 */
export type { AssignAction, AssignArgs, Assigner, PartialAssigner, PropertyAssigner } from "./actions/assign.js"
export type { CancelAction } from "./actions/cancel.js"
export type { EmitAction } from "./actions/emit.js"
export type { EnqueueActionsAction } from "./actions/enqueueActions.js"
export type { LogAction } from "./actions/log.js"
export type { RaiseAction } from "./actions/raise.js"
export type { SendToAction } from "./actions/sendTo.js"
export type { SpawnAction, SpawnActionOptions } from "./actions/spawnChild.js"
