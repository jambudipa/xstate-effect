/**
 * @since 0.1.0
 * @module Types
 *
 * Common type definitions and utilities for xstate-effect.
 */
import { Effect, Option, Chunk, Duration, Data, Types as EffectTypes } from "effect"
import type { DoneActorEvent, DoneStateEvent, ErrorActorEvent, EventDescriptor, EventObject, ExtractEvent, SnapshotEvent } from "./Event.js"
import type { AnyEventObject, UpstreamAny } from "./internal/anyEventObject.js"
import type { GuardError } from "./Errors.js"
import type { ActorRef, ActorRefBase, AnyActorRef } from "./ActorRef.js"
import type { AnyActor } from "./Actor.js"
import type { ActorLogic, AnyActorLogic } from "./ActorLogic.js"
import type { PromiseActorLogic } from "./actors/fromPromise.js"
import type { MachineSnapshot, Snapshot } from "./Snapshot.js"
import type { AnyStateMachine, StateMachine } from "./StateMachine.js"
import type { StateNode } from "./StateNode.js"
import type { StateValue, StateValueMap } from "./StateValue.js"
import type * as Inspection from "./inspection.js"
import type * as Spawn from "./spawn.js"
import type { Scope } from "effect"
import type { RaiseOptions } from "./actions/raise.js"
import type { SendToOptions } from "./actions/sendTo.js"
import type { Subscribable } from "./actors/fromObservable.js"
import type { ActorScopeService, CustomActionExecution } from "./ActorLogic.js"
import type { AnyMachineSnapshot } from "./Snapshot.js"
import type { ConditionalRequired, LowInfer, MetaObject, NonReducibleUnknown, SingleOrArray } from "./typeUtils.js"

// ============================================================
// VARIANCE NAMESPACE - Effect-idiomatic variance encoding
// ============================================================

/**
 * Pre-defined variance interfaces for xstate-effect types.
 *
 * These eliminate the `{} as Types.Invariant<T>` pattern throughout the codebase
 * by providing strongly-typed interfaces that can be used directly in TypeId objects.
 *
 * @since 0.1.0
 * @category Variance
 */
export namespace Variance {
  /**
   * Variance interface for ActorLogic types.
   *
   * - Snapshot: Invariant (both produced and consumed)
   * - Event: Invariant (both sent and received)
   * - Input: Contravariant (only consumed)
   * - Emitted: Covariant (only produced)
   * - R: Covariant (requirements, only demanded)
   */
  export interface ActorLogic<
    in out TSnapshot extends Snapshot,
    in out TEvent extends EventObject,
    in TInput,
    out TEmitted extends EventObject,
    out R
  > {
    readonly _Snapshot: EffectTypes.Invariant<TSnapshot>
    readonly _Event: EffectTypes.Invariant<TEvent>
    readonly _Input: EffectTypes.Contravariant<TInput>
    readonly _Emitted: EffectTypes.Covariant<TEmitted>
    readonly _R: EffectTypes.Covariant<R>
  }

  /**
   * Variance interface for ActorRef types.
   *
   * - Snapshot: Covariant (only read/observed)
   * - Event: Contravariant (only sent to)
   * - Emitted: Covariant (only observed)
   */
  export interface ActorRef<
    out TSnapshot extends Snapshot,
    in TEvent extends EventObject,
    out TEmitted extends EventObject
  > {
    readonly _Snapshot: EffectTypes.Covariant<TSnapshot>
    readonly _Event: EffectTypes.Contravariant<TEvent>
    readonly _Emitted: EffectTypes.Covariant<TEmitted>
  }

  /**
   * Variance interface for Actor types (running actor instance).
   *
   * - Snapshot: Covariant (only read)
   * - Event: Invariant (both sent and triggers transitions)
   * - Emitted: Covariant (only observed)
   */
  export interface Actor<
    out TSnapshot extends Snapshot,
    in out TEvent extends EventObject,
    out TEmitted extends EventObject
  > {
    readonly _Snapshot: EffectTypes.Covariant<TSnapshot>
    readonly _Event: EffectTypes.Invariant<TEvent>
    readonly _Emitted: EffectTypes.Covariant<TEmitted>
  }

  /**
   * Variance interface for StateNode types.
   *
   * - Context: Invariant (both read and written)
   * - Event: Invariant (both triggers and actions use it)
   */
  export interface StateNode<
    in out TContext,
    in out TEvent extends EventObject
  > {
    readonly _Context: EffectTypes.Invariant<TContext>
    readonly _Event: EffectTypes.Invariant<TEvent>
  }

  /**
   * Variance interface for StateMachine types.
   *
   * - Id: Covariant (identifier, only observed)
   * - Context: Invariant (both read and written)
   * - Event: Invariant (both sent and handled)
   * - Input: Contravariant (only consumed at initialization)
   * - Output: Invariant (produced by final states, may be transformed)
   * - Emitted: Covariant (only produced)
   * - R: Covariant (requirements)
   * - StateMeta: Invariant (typed in the config, read back through the snapshots)
   * - TransitionMeta: Invariant (typed in the config, read back on the transitions)
   */
  export interface StateMachine<
    out Id extends string,
    in out TContext,
    in out TEvent extends EventObject,
    in TInput,
    in out TOutput,
    out TEmitted extends EventObject,
    out R,
    in out TStateMeta = unknown,
    in out TTransitionMeta = TStateMeta
  > {
    readonly _Id: EffectTypes.Covariant<Id>
    readonly _Context: EffectTypes.Invariant<TContext>
    readonly _Event: EffectTypes.Invariant<TEvent>
    readonly _Input: EffectTypes.Contravariant<TInput>
    readonly _Output: EffectTypes.Invariant<TOutput>
    readonly _Emitted: EffectTypes.Covariant<TEmitted>
    readonly _R: EffectTypes.Covariant<R>
    readonly _StateMeta: EffectTypes.Invariant<TStateMeta>
    readonly _TransitionMeta: EffectTypes.Invariant<TTransitionMeta>
  }
}

// ============================================================
// PROCESSING STATUS
// ============================================================

/**
 * Processing status of an actor.
 *
 * @since 0.1.0
 * @category Types
 */
export type ProcessingStatus = "not-started" | "running" | "stopped"

/**
 * Processing status constants.
 *
 * @since 0.1.0
 * @category Types
 */
export const ProcessingStatus = {
  NotStarted: "not-started" as const,
  Running: "running" as const,
  Stopped: "stopped" as const,
}

/**
 * A special send target name (XState's `SpecialTargets` enum type): one of the values of
 * {@link SpecialTargets}.
 *
 * @since 0.1.0
 * @category Types
 */
export type SpecialTargets = (typeof SpecialTargets)[keyof typeof SpecialTargets]

/**
 * The special send targets (XState `SpecialTargets`): `Parent` names the actor's parent
 * (`#_parent`) and `Internal` the actor itself (`#_internal`). `sendTo` and `forwardTo` take
 * them as target names.
 *
 * @since 0.1.0
 * @category Types
 */
export const SpecialTargets = {
  Parent: "#_parent",
  Internal: "#_internal",
} as const

// ============================================================
// STATE NODE TYPES
// ============================================================

/**
 * Type of state node.
 *
 * @since 0.1.0
 * @category Types
 */
export type StateNodeType = "atomic" | "compound" | "parallel" | "final" | "history"

/**
 * History type for history states.
 *
 * @since 0.1.0
 * @category Types
 */
export type HistoryType = "shallow" | "deep"

// ============================================================
// TRANSITION TYPES
// ============================================================

/**
 * Transition target definition: one target or a list of targets (XState
 * `SingleOrArray<string>`). An empty string or `undefined` gives a targetless transition.
 *
 * @since 0.1.0
 * @category Types
 */
export type TransitionTarget =
  | string
  | ReadonlyArray<string>
  | undefined

/**
 * Transition configuration in machine config. `TEvent` is the event the transition is taken
 * on, which its guard and actions read; `TSelfEvent` is every event of the machine, which
 * the actions' `self` takes (upstream `TExpressionEvent` and `TEvent`; the same type by
 * default). `TNames` holds the implementations its guard and actions may name (see
 * {@link ImplementationNames}; any name by default).
 *
 * @since 0.1.0
 * @category Types
 */
export interface TransitionConfig<
  TContext,
  TEvent extends EventObject,
  TMeta = unknown,
  TNames extends ImplementationNames = ImplementationNames,
  TSelfEvent extends EventObject = TEvent
> {
  readonly target?: TransitionTarget
  /** Any XState guard form, or a port `GuardDefinition` (D15). */
  readonly guard?: Guard<TContext, TEvent, TNames>
  readonly actions?:
    | Action<TContext, TEvent, TNames, TSelfEvent>
    | ReadonlyArray<Action<TContext, TEvent, TNames, TSelfEvent>>
  readonly description?: string
  readonly reenter?: boolean
  /**
   * Transition metadata, kept on the resolved transition (XState), of the transition meta
   * type (`types.transitionMeta`, else `types.meta`).
   */
  readonly meta?: TMeta
}

/**
 * The `route` config of a state node (XState `RouteTransitionConfig`): the guard, actions,
 * meta and description of the transition that an `xstate.route` event to the node takes.
 * The target is always the node itself.
 *
 * @example
 * ```ts
 * states: { review: { id: "review", route: { guard: "isReady" } } }
 * // then: actor.send({ type: "xstate.route", to: "#review" })
 * ```
 *
 * @since 0.1.0
 * @category Types
 */
export interface RouteTransitionConfig<
  TContext,
  TEvent extends EventObject,
  TMeta = unknown,
  TNames extends ImplementationNames = ImplementationNames
> {
  /** Any XState guard form; the route is taken only when it passes. */
  readonly guard?: Guard<TContext, TEvent, TNames>
  readonly actions?: Action<TContext, TEvent, TNames> | ReadonlyArray<Action<TContext, TEvent, TNames>>
  /** Transition metadata, kept on the resolved route transition (XState). */
  readonly meta?: TMeta
  readonly description?: string
}

/**
 * The transitions of a state node as a list (upstream `Transitions<TContext, TEvent>`,
 * `Array<TransitionDefinition<TContext, TEvent, any>>`): their meta is upstream's `any` (SD-22
 * amendment, goal journal `2026-10-07-13-node-containers-any.md`).
 *
 * @since 0.1.0
 * @category Types
 */
export type Transitions<TContext extends MachineContext, TEvent extends EventObject> = Array<
  TransitionDefinition<TContext, TEvent, UpstreamAny>
>

/**
 * Transition definition (resolved).
 *
 * @since 0.1.0
 * @category Types
 */
export interface TransitionDefinition<TContext, TEvent extends EventObject, TMeta = unknown> {
  /**
   * The target state nodes, resolved once the machine's node tree exists (XState
   * `TransitionDefinition.target`): the array of nodes, or `undefined` for a targetless (or
   * forbidden) transition.
   */
  readonly target: ReadonlyArray<StateNode<TContext, TEvent>> | undefined
  readonly guard: Option.Option<Guard<TContext, TEvent>>
  readonly actions: Chunk.Chunk<Action<TContext, TEvent>>
  /**
   * The transition's description, as written (XState: upstream spreads the config into the
   * definition, so the key is there exactly when the config has it).
   */
  readonly description?: string
  readonly reenter: boolean
  readonly eventType: string
  readonly source: string // State node ID
  /**
   * Transition metadata, as written (XState `meta`: upstream spreads the config into the
   * definition, so the key is there exactly when the config has it).
   */
  readonly meta?: TMeta
  /**
   * The JSON form (XState `formatTransition`'s `toJSON`): the config and the definition
   * spread, with the source as `#<id>`, the targets as `#<id>` (`undefined` for a targetless
   * transition), the actions as written and the guard as written (`undefined` for none); it
   * keeps the `toJSON` key, as upstream's spread does.
   */
  readonly toJSON: () => unknown
}

// ============================================================
// INITIAL TRANSITION
// ============================================================

/**
 * Initial transition for compound states.
 *
 * @since 0.1.0
 * @category Types
 */
export interface InitialTransition<TContext, TEvent extends EventObject, TMeta = unknown> {
  readonly target: ReadonlyArray<string>
  readonly actions: Chunk.Chunk<Action<TContext, TEvent>>
  /** The transition metadata of the object form of `initial` (XState `meta`). */
  readonly meta?: TMeta
  /** The description of the object form of `initial` (XState `description`). */
  readonly description?: string
}

/**
 * The object form of a node's `initial` (upstream `InitialTransitionConfig`): the key of the
 * initial child, the actions of the initial transition, and its meta and description. The
 * actions run when the node is entered by default, after its entry actions and before the
 * initial child's.
 *
 * @example
 * ```ts
 * initial: { target: "idle", actions: () => console.log("starting"), meta: { reason: "boot" } }
 * ```
 *
 * @since 0.1.0
 * @category Types
 */
export interface InitialTransitionConfig<
  TContext,
  TEvent extends EventObject,
  TMeta = unknown,
  TNames extends ImplementationNames = ImplementationNames
> {
  readonly target: string
  readonly actions?: Action<TContext, TEvent, TNames> | ReadonlyArray<Action<TContext, TEvent, TNames>>
  /** Transition metadata, kept on the node's initial transition (XState). */
  readonly meta?: TMeta
  readonly description?: string
}

/**
 * A delayed transition of a state node (upstream `DelayedTransitionDefinition`, an entry of
 * `stateNode.after`): the transition definition of one `after` entry, with its delay.
 *
 * @since 0.1.0
 * @category Types
 */
export interface DelayedTransitionDefinition<TContext, TEvent extends EventObject, TMeta = unknown>
  extends TransitionDefinition<TContext, TEvent, TMeta>
{
  /** The delay: milliseconds for a key that reads as a number, else the delay's name. */
  readonly delay: number | string
}

// ============================================================
// TYPED ACTOR CONTEXT - Layer 2 of type inference architecture
// ============================================================

/**
 * TypedActorContext provides fully-typed access to actor internals.
 *
 * This is the base interface for typed contexts. It is constructed at
 * execution time (not stored in Effect context), bridging the untyped
 * ActorScopeService to typed action/guard implementations.
 *
 * `TEvent` is the event being handled; `TSelfEvent` is every event the actor takes, which
 * `self` accepts (upstream `ActionArgs` reads `TExpressionEvent` and `TEvent` the same way;
 * the same type by default). The split lets an action under one `on` descriptor read that
 * descriptor's events while it still sends any event of the machine to itself.
 *
 * @since 0.1.0
 * @category Typed Context
 */
export interface TypedActorContext<
  TContext,
  TEvent extends EventObject,
  out TSnapshot extends import("./Snapshot.js").Snapshot<unknown> = import("./Snapshot.js").Snapshot<unknown>,
  TSelfEvent extends EventObject = TEvent
> {
  /** Current context - YOUR EXACT TYPE */
  readonly context: TContext

  /** The triggering event - YOUR EXACT UNION */
  readonly event: TEvent

  /** Typed reference to self: it takes every event of the actor (`TSelfEvent`) */
  readonly self: ActorRef<TSnapshot, TSelfEvent>

  /** Actor system with typed operations */
  readonly system: import("./ActorLogic.js").ActorSystemService
}

// ============================================================
// ACTION CONTEXT - Extended for action execution
// ============================================================

/**
 * SpawnOptions for spawning child actors.
 *
 * @since 0.1.0
 * @category Typed Context
 */
export interface SpawnOptions<TLogic extends AnyActorLogic> {
  /** The child's id; defaults to its session id. */
  readonly id?: string
  readonly input?: ActorLogic.InputOf<TLogic>
  /** The id under which the system registers the child (D7). */
  readonly systemId?: string
  /** Whether the child sends each active snapshot to its parent as `xstate.snapshot.<id>`. */
  readonly syncSnapshot?: boolean
}

/**
 * The options of a spawn by a string src (upstream): the input may also be a function of
 * `{ context, event, self }`, which the spawn calls.
 *
 * @since 0.1.0
 * @category Typed Context
 */
export interface NamedSpawnOptions {
  readonly id?: string
  readonly input?: unknown
  readonly systemId?: string
  readonly syncSnapshot?: boolean
}

/**
 * The synchronous spawn that assigners, port action definitions and the context factory
 * receive (upstream `Spawner`, a root type export): the `Spawner` of the `spawn` module, for
 * the actors `TActor` a machine declares (any logic or name by default). An unknown name, or
 * any name in a setup without actors, is a type error where the setup's actors reach the
 * action; a logic whose input type does not take `undefined` needs its `input`.
 *
 * @since 0.1.0
 * @category Typed Context
 */
export type Spawner<TActor extends ProvidedActor = ProvidedActor> = Spawn.Spawner<TActor>

/**
 * The actors an implementation-names record names, as {@link Spawner} takes them (XState
 * `ProvidedActor`): its `providedActor` union (each name with its logic and declared ids; a
 * setup's actors with any child id, XState `ToProvidedActor`), or the wide `ProvidedActor`
 * while any name is taken. A setup without actors names none (`never`).
 */
type NamedActors<TNames extends ImplementationNames> = string extends TNames["actors"] ? ProvidedActor
  : TNames["providedActor"]

/**
 * The reference of an actor logic (upstream `ActorRefFrom`): the `ActorRef` of the logic's
 * snapshot, events and emitted events, which a `Spawner` returns for that logic. A function
 * gives the reference of what it returns, a `Promise<T>` the reference of a
 * `PromiseActorLogic<T>`, and any other type `never`. A state machine is the actor logic of
 * its `MachineSnapshot`, so the logic case also gives upstream's state machine case. The
 * supertypes `AnyActorLogic` and `AnyStateMachine` (whose types are unknown) give
 * {@link AnyActorRef}, which every reference fits (upstream: a reference of `any` types).
 *
 * @example
 * ```ts
 * type Context = { readonly machineRef?: ActorRefFrom<AnyStateMachine> } // any machine's reference
 * ```
 *
 * @since 0.1.0
 * @category Typed Context
 */
export type ActorRefFrom<T> =
  (T extends (...args: never) => infer TReturn ? TReturn : T) extends infer TLogic
    ? TLogic extends Promise<infer TOutput>
      ? ActorRefFrom<PromiseActorLogic<TOutput>>
      : TLogic extends ActorLogic<infer TSnapshot, infer TEvent, infer _TInput, infer TEmitted, infer _R>
        ? ActorRef<TSnapshot, TEvent, TEmitted>
        : TLogic extends AnyActorLogic
          ? AnyActorRef
          : never
    : never

/**
 * The reference of an actor logic (upstream `ActorRefFromLogic`): the `ActorRef` of the
 * logic's snapshot, events and emitted events, as `ActorRefFrom` gives it for a logic.
 *
 * @example
 * ```ts
 * import { createMachine, type ActorRefFromLogic } from "@xstate-effect/core"
 *
 * const child = createMachine({ types: {} as { events: { type: "PING" } } })
 * type ChildRef = ActorRefFromLogic<typeof child>
 * ```
 *
 * @since 0.1.0
 * @category Typed Context
 */
export type ActorRefFromLogic<T extends AnyActorLogic> = ActorRef<
  ActorLogic.SnapshotOf<T>,
  ActorLogic.EventOf<T>,
  ActorLogic.EmittedOf<T>
>

/**
 * The snapshot type of an actor, an actor reference or an actor logic (upstream
 * `SnapshotFrom`). A function gives the snapshot type of what it returns, and any other type
 * gives `never`. A state machine is the actor logic of its `MachineSnapshot`, so the logic case
 * also gives upstream's state machine case.
 *
 * @example
 * ```ts
 * import { createMachine, type SnapshotFrom } from "@xstate-effect/core"
 *
 * const machine = createMachine({ context: { count: 0 } })
 * const countOf = (snapshot: SnapshotFrom<typeof machine>) => snapshot.context.count
 * ```
 *
 * @since 0.1.0
 * @category Typed Context
 */
export type SnapshotFrom<T> =
  (T extends (...args: never) => infer TReturn ? TReturn : T) extends infer TValue
    ? TValue extends ActorRef<infer TSnapshot, infer _TEvent, infer _TEmitted>
      ? TSnapshot
      : TValue extends ActorLogic<infer TSnapshot, infer _TEvent, infer _TInput, infer _TEmitted, infer _R>
        ? TSnapshot
        : never
    : never

/**
 * The input type of an actor logic or a state machine (upstream `InputFrom`): what
 * `createActor`'s `input` option takes for it. Any other type gives `never`.
 *
 * @example
 * ```ts
 * import { fromPromise, type InputFrom } from "@xstate-effect/core"
 *
 * const fetchUser = fromPromise(({ input }: { input: { id: string } }) => Promise.resolve(input.id))
 * type Input = InputFrom<typeof fetchUser> // { id: string }
 * ```
 *
 * @since 0.1.0
 * @category Typed Context
 */
export type InputFrom<T> = T extends ActorLogic<infer _TSnapshot, infer _TEvent, infer TInput, infer _TEmitted, infer _R>
  ? TInput
  : never

/**
 * The output type of an actor logic, a state machine or an actor reference (upstream
 * `OutputFrom`): the output of its done snapshot. The snapshot stores it as an `Option` of
 * this type (D8), so `toEffect` succeeds with `Option<OutputFrom<T>>`. Any other type gives
 * `never`.
 *
 * @example
 * ```ts
 * import { createMachine, type OutputFrom } from "@xstate-effect/core"
 *
 * const machine = createMachine({ types: {} as { output: number }, output: 42 })
 * type Output = OutputFrom<typeof machine> // number
 * ```
 *
 * @since 0.1.0
 * @category Typed Context
 */
export type OutputFrom<T> = T extends ActorLogic<infer TSnapshot, infer _TEvent, infer _TInput, infer _TEmitted, infer _R>
  ? Snapshot.Output<TSnapshot>
  : T extends ActorRef<infer TSnapshot, infer _TEvent, infer _TEmitted> ? Snapshot.Output<TSnapshot>
  : never

/**
 * The events an actor logic emits (upstream `EmittedFrom`): what `actor.on` hands to its
 * listeners.
 *
 * @example
 * ```ts
 * import { createMachine, type EmittedFrom } from "@xstate-effect/core"
 *
 * const machine = createMachine({ types: {} as { emitted: { type: "saved" } } })
 * type Emitted = EmittedFrom<typeof machine> // { type: "saved" }
 * ```
 *
 * @since 0.1.0
 * @category Typed Context
 */
export type EmittedFrom<TLogic extends AnyActorLogic> = TLogic extends
  ActorLogic<infer _TSnapshot, infer _TEvent, infer _TInput, infer TEmitted, infer _R> ? TEmitted
  : never

/**
 * The implementations a state machine takes in `provide` (upstream
 * `MachineImplementationsFrom`): the machine's actions, guards, actors and delays, each
 * action and guard typed by the machine's context and events. A `setup(...).createMachine`
 * machine takes the setup's names, a `createMachine` machine the names its `types` declare,
 * or any name where it declares none. A function gives the implementations of the machine
 * it returns.
 *
 * @example
 * ```ts
 * import { assign, createMachine, type MachineImplementationsFrom } from "@xstate-effect/core"
 *
 * const machine = createMachine({ context: { count: 0 } })
 * const implementations: MachineImplementationsFrom<typeof machine> = {
 *   actions: { reset: assign(() => ({ count: 0 })) }
 * }
 * ```
 *
 * @since 0.1.0
 * @category Typed Context
 */
export type MachineImplementationsFrom<T extends AnyStateMachine | ((...args: never) => AnyStateMachine)> =
  (T extends (...args: never) => infer TReturn ? TReturn : T) extends StateMachine<
    infer _Id,
    infer _TContext,
    infer _TEvent,
    infer _TInput,
    infer _TOutput,
    infer _TEmitted,
    infer _R,
    infer _TStateMeta,
    infer _TTransitionMeta,
    infer _TStateSchema,
    infer TProvided,
    infer _TStateValue,
    infer _TChildren,
    infer _TTag
  > ? TProvided
  : never

/**
 * The state values a state machine's snapshots match (upstream `StateValueFrom`): what
 * `snapshot.matches` takes. A `setup(...).createMachine` machine gives the values of its
 * config, any other machine any state value.
 *
 * @example
 * ```ts
 * import { createMachine, type StateValueFrom } from "@xstate-effect/core"
 *
 * const machine = createMachine({ initial: "idle", states: { idle: {} } })
 * const value: StateValueFrom<typeof machine> = "idle"
 * ```
 *
 * @since 0.1.0
 * @category Typed Context
 */
export type StateValueFrom<TMachine extends AnyStateMachine> = SnapshotFrom<TMachine> extends
  { matches(partialStateValue: infer TStateValue): boolean } ? TStateValue
  : never

/**
 * The tags of a state machine's snapshots (upstream `TagsFrom`): what `snapshot.hasTag`
 * takes. A machine whose `types` (or setup `types`) declare its `tags` gives those tags, any
 * other machine any string.
 *
 * @example
 * ```ts
 * import { createMachine, type TagsFrom } from "@xstate-effect/core"
 *
 * const machine = createMachine({
 *   types: {} as { tags: "loading" },
 *   initial: "busy",
 *   states: { busy: { tags: ["loading"] } }
 * })
 * const tag: TagsFrom<typeof machine> = "loading"
 * ```
 *
 * @since 0.1.0
 * @category Typed Context
 */
export type TagsFrom<TMachine extends AnyStateMachine> = SnapshotFrom<TMachine> extends
  { hasTag(tag: infer TTag): boolean } ? TTag
  : never

/**
 * ActionContext - What actions receive.
 *
 * Extends TypedActorContext with mutation capabilities for:
 * - Deferring effects to run after the current transition
 * - Emitting events to external subscribers
 * - Spawning child actors with full type inference
 * - Stopping child actors
 *
 * This is constructed at execution time from the untyped ActorScopeService,
 * providing full type safety without requiring generic Context.Tags.
 *
 * @since 0.1.0
 * @category Typed Context
 */
export interface ActionContext<
  TContext,
  TEvent extends EventObject,
  TSelfEvent extends EventObject = TEvent,
  TNames extends ImplementationNames = ImplementationNames
> extends TypedActorContext<TContext, TEvent, MachineSnapshot<TContext>, TSelfEvent> {
  /** Defer an effect to run after the current transition */
  readonly defer: (effect: Effect.Effect<void>) => Effect.Effect<void>

  /** Emit an event to the actor's listeners once the current macrostep commits (A6) */
  readonly emit: (event: EventObject) => Effect.Effect<void>

  /**
   * Spawns a child of this actor and gives its reference at once (upstream `spawn`): the
   * {@link Spawner} of the actors `TNames` names (any logic or name by default; a setup's
   * actors, each typed by its logic, where the setup's names reach the action)
   */
  readonly spawn: Spawner<NamedActors<TNames>>

  /** Stops a child of this actor, as `stopChild` does (the actor scope's `stopChild`) */
  readonly stopChild: (child: ActorRefBase) => Effect.Effect<void>

  /**
   * The children of the snapshot at this point of the action list (upstream
   * `snapshot.children`, which upstream's built-in actions read), by id: a child spawned
   * earlier in the same list is there, one stopped earlier is not. `stopAllChildren` reads it.
   */
  readonly children: Readonly<Record<string, ActorRefBase>>

  // The members below read the machine's implementations, which upstream's built-in actions
  // read from `snapshot.machine`. They are methods on purpose: a method's parameters are
  // checked bivariantly, so they leave the context covariant in `TContext`, as a field
  // holding the implementations would not.

  /**
   * Evaluates a guard as a transition does (the shared evaluator; upstream
   * `evaluateGuard(guard, snapshot.context, event, snapshot)`), with the context and the event
   * of this action: a name or `{ type, params }` reads the machine's guards, an inline function
   * or a built-in guard runs as it is. Fails with `GuardError` for a name without
   * implementation. An `enqueueActions` `check` runs it.
   */
  evaluateGuard(guard: Guard<TContext, TEvent>): Effect.Effect<boolean, GuardError>

  /**
   * The milliseconds a delay name stands for in the machine's `delays` (upstream
   * `resolveRaise` and `resolveSendTo`): a number, a `Duration`, or a function called with the
   * action arguments of this action and `params`; none for a name the machine lacks or a value
   * that is no number. `raise` and `sendTo` resolve a delay name with it, where upstream does.
   */
  resolveDelay(name: string, params: unknown): Option.Option<number>
}

// ============================================================
// GUARD CONTEXT - Read-only for guard evaluation
// ============================================================

/**
 * GuardContext - What guards receive.
 *
 * Read-only subset of TypedActorContext for guard evaluation.
 * Guards should not have side effects, so no mutation methods.
 *
 * @since 0.1.0
 * @category Typed Context
 */
export interface GuardContext<
  TContext,
  TEvent extends EventObject
> {
  /** Current context - YOUR EXACT TYPE */
  readonly context: TContext

  /** The triggering event - YOUR EXACT UNION */
  readonly event: TEvent

  /** Reference to self (untyped for guards) */
  readonly self: ActorRefBase

  /** Actor system with typed operations */
  readonly system: import("./ActorLogic.js").ActorSystemService

  /**
   * Machine implementations for resolving named guards. The engine always passes the
   * machine's implementations, so the guards inside `and`, `or` and `not` resolve names.
   */
  readonly implementations?: MachineImplementations<TContext, TEvent>

  /**
   * The snapshot the guard is evaluated with (upstream's fourth `evaluateGuard` argument):
   * `stateIn` checks its active configuration. The engine always passes it: the snapshot of
   * the current step for a transition, the snapshot `can` is called on, and the snapshot of
   * that point of the action list for an `enqueueActions` `check`.
   */
  readonly snapshot?: MachineSnapshot<TContext>
}

// ============================================================
// ACTION TYPES
// ============================================================

/**
 * Action definition with full type information.
 *
 * Actions receive ActionContext<TContext, TEvent, TSelfEvent> which provides:
 * - Fully typed `context` and `event`
 * - Typed `self` reference, which takes every event of the machine (`TSelfEvent`, by
 *   default `TEvent`)
 * - Methods for `defer`, `emit`, `spawn`, `stopChild`
 *
 * @since 0.1.0
 * @category Types
 */
export interface ActionDefinition<
  TContext,
  TEvent extends EventObject,
  TParams = void,
  R = never,
  TNames extends ImplementationNames = ImplementationNames,
  TSelfEvent extends EventObject = TEvent
> {
  readonly type: string
  readonly params?: TParams
  readonly exec: (
    ctx: ActionContext<TContext, TEvent, TSelfEvent>,
    params: TParams
  ) => Effect.Effect<ActionResult, never, R>
  /**
   * The implementations the definition may name (type only; never set). A built-in action
   * written inline in a setup machine config (`raise`, `sendTo`, `enqueueActions`,
   * `spawnChild`) reads the setup's names from the config's type through it, so its delay,
   * `enqueue`, `check` and src names are checked (XState `_out_TAction` and the others). It
   * is a method, so its parameter is compared both ways: a definition made for any name, or
   * for fewer names (a base setup's, in an extended one), is still accepted.
   */
  "~names"?(names: TNames): void
}

// ============================================================
// XSTATE ACTION FORMS
// ============================================================

/**
 * The argument object every XState-form action receives (upstream `ActionArgs`): the
 * context the earlier actions of the same list left, the event, `self` and `system`.
 *
 * @since 0.1.0
 * @category Types
 */
export type ActionArgs<TContext, TEvent extends EventObject, TSelfEvent extends EventObject = TEvent> = TypedActorContext<
  TContext,
  TEvent,
  MachineSnapshot<TContext>,
  TSelfEvent
>

/**
 * Any value a params slot can hold (upstream `NonReducibleUnknown`). Unlike `unknown`, it
 * does not absorb a params function in a union, so that function stays contextually typed.
 *
 * @since 0.1.0
 * @category Types
 */
export type ActionParams = object | string | number | bigint | boolean | symbol | null | undefined

/**
 * The params of one use of a parameterized action (upstream `DynamicParam`): a static
 * value, or a function that computes them from the context and the event.
 *
 * @since 0.1.0
 * @category Types
 */
export type DynamicParams<TContext, TEvent extends EventObject, TParams = ActionParams> =
  | TParams
  | ((args: { readonly context: TContext; readonly event: TEvent }) => TParams)

/**
 * A use of a named action with the params of that use (upstream `ParameterizedObject` with
 * a `DynamicParam`). The engine calls the implementation named `type` with these params.
 *
 * @example
 * ```ts
 * entry: [{ type: "track", params: { id: 1 } }, { type: "track", params: ({ context }) => ({ id: context.id }) }]
 * ```
 *
 * @since 0.1.0
 * @category Types
 */
export interface ParameterizedAction<TContext, TEvent extends EventObject> {
  readonly type: string
  readonly params?: DynamicParams<TContext, TEvent>
}

/**
 * A custom action written as a function (upstream `ActionFunction`), called as
 * `fn({ context, event, self, system }, params)`. Inline in a config it receives `undefined`
 * params; as an implementation it receives the params of each use. Its return value is
 * ignored, except that a returned Effect runs (port extension). `args.self` takes every
 * event of the machine (`TSelfEvent`, by default the event the action reads).
 *
 * @since 0.1.0
 * @category Types
 */
export type ActionFunction<TContext, TEvent extends EventObject, TParams = undefined, TSelfEvent extends EventObject = TEvent> = (
  args: ActionArgs<TContext, TEvent, TSelfEvent>,
  params: TParams
) => unknown

/**
 * An action as a machine config writes it (upstream `Action`): the name of an
 * implementation, a `{ type, params }` use of one, an inline function, or a port
 * `ActionDefinition` (D15). `TNames` holds the actions a name may name, with their params
 * (see {@link ImplementationNames}; any name and any params by default). `TEvent` is the
 * event the action reads and `TSelfEvent` every event of the machine, which its `self`
 * takes (by default the same type). An action made for a wider event, such as the whole
 * event union of the machine, fits where a narrower event is read.
 *
 * @since 0.1.0
 * @category Types
 */
export type Action<
  TContext,
  TEvent extends EventObject,
  TNames extends ImplementationNames = ImplementationNames,
  TSelfEvent extends EventObject = TEvent
> =
  | ActionReference<TContext, TEvent, TNames["actions"]>
  | ActionFunction<TContext, TEvent, undefined, TSelfEvent>
  | ActionDefinition<TContext, TEvent, void, never, TNames, TSelfEvent>

/**
 * A use of a named action as a config writes it (upstream `NoRequiredParams` and
 * `ConditionalRequired`): with the wide default, any name or `{ type, params }`; with named
 * actions, the name alone for an action whose params may be `undefined`, else `{ type,
 * params }` with params of that action's type, given as a value or a function of the
 * context and the event.
 *
 * @example
 * ```ts
 * // actions: { reset: () => {}, resetTo: (_, params: number) => {} }
 * entry: ["reset", { type: "resetTo", params: 0 }] // "resetTo" alone is a type error
 * ```
 *
 * @since 0.1.0
 * @category Types
 */
export type ActionReference<TContext, TEvent extends EventObject, TActions extends ParameterizedObject> =
  string extends TActions["type"] ? string | ParameterizedAction<TContext, TEvent>
  : NamedReference<TContext, TEvent, TActions>

/**
 * The references to one named action or guard of a union (distributive): its name when its
 * params may be `undefined`, and `{ type, params }`, whose params are optional then and
 * required otherwise.
 */
type NamedReference<TContext, TEvent extends EventObject, TObject extends ParameterizedObject> = TObject extends ParameterizedObject
  ? undefined extends TObject["params"]
    ? TObject["type"] | { readonly type: TObject["type"]; readonly params?: DynamicParams<TContext, TEvent, ParamsValue<TObject["params"]>> }
    : { readonly type: TObject["type"]; readonly params: DynamicParams<TContext, TEvent, TObject["params"]> }
  : never

/**
 * The params a reference may give for a params type: any value for `unknown` (an
 * implementation that declares none), else that type.
 */
type ParamsValue<TParams> = unknown extends TParams ? ActionParams : TParams

/**
 * An action implementation in `setup({ actions })`, `createMachine(config, { actions })` and
 * `machine.provide({ actions })`: a plain function or a port `ActionDefinition`, called with
 * the params of each use. A definition's own `params` field plays no part, and either form
 * may declare any params type.
 *
 * @since 0.1.0
 * @category Types
 */
export type ActionImplementation<TContext, TEvent extends EventObject> =
  | ActionFunction<TContext, TEvent, never>
  | Pick<ActionDefinition<TContext, TEvent, never>, "type" | "exec">

/**
 * The params of the uses an action implementation serves, as a type-only member (never
 * set). A slot that knows the params of its action's uses asks for it
 * ({@link NamedActionImplementation}), and `assign` carries it, so an `assign` written in
 * that slot reads its params type from there (upstream infers them from the `ActionFunction`
 * type the slot expects). It is a method, so its parameter is compared both ways: an
 * implementation that declares other params is still accepted, as a port definition is.
 *
 * @since 0.1.0
 * @category Types
 */
export interface ImplementsParams<TParams> {
  "~params"?(params: TParams): void
}

/**
 * The params type of the definition an `assign` gives: its params type, or `void` for an
 * assign that takes `undefined` params (one written inline, upstream's params of an inline
 * built-in action), which a config's {@link Action} slot holds as a definition of no params.
 *
 * @since 0.1.0
 * @category Types
 */
export type AssignDefinitionParams<TParams> = [TParams] extends [undefined] ? void : TParams

/**
 * The implementation of an action whose uses carry params of type `TParams` (upstream
 * `ActionFunction` with the params of that action's name): a plain function that takes
 * those params, or a port definition of any params. An `assign` written here reads `TParams`
 * as its params type (see {@link ImplementsParams}).
 *
 * @example
 * ```ts
 * // types: {} as { actions: { type: "inc"; params: { by: number } } }
 * const inc: NamedActionImplementation<{ count: number }, EventObject, { by: number }> =
 *   assign(({ context }, params) => ({ count: context.count + params.by }))
 * ```
 *
 * @since 0.1.0
 * @category Types
 */
export type NamedActionImplementation<TContext, TEvent extends EventObject, TParams> =
  | ActionFunction<TContext, TEvent, TParams>
  | (Pick<ActionDefinition<TContext, TEvent, never>, "type" | "exec"> & ImplementsParams<TParams>)

/**
 * The `actions` record of a machine's implementations (upstream
 * `MachineImplementationsActions`): any name, each a plain function or a port definition of
 * any params, while the machine declares no actions (the wide `ParameterizedObject`); once
 * `types.actions` declares them, only those names, each with the params of its uses.
 *
 * @since 0.1.0
 * @category Types
 */
export type ActionImplementations<
  TContext,
  TEvent extends EventObject,
  TAction extends ParameterizedObject,
  TNames extends ImplementationNames = ImplementationNames
> = {
  readonly [K in TAction["type"]]?:
    & (string extends TAction["type"] ? ActionImplementation<TContext, TEvent>
      : NamedActionImplementation<TContext, TEvent, ParamsOf<TAction, K>>)
    & ImplementsNames<TNames>
}

/**
 * The names of the machine an implementation slot belongs to, as a type-only member (never
 * set), as {@link ImplementsParams} gives the params: a built-in action written in the slot
 * (`enqueueActions`, whose `check` then takes only the machine's guards) reads them from
 * there (upstream `MachineImplementations` of the machine's types). It is a method, so a
 * definition made for other names is still accepted.
 */
interface ImplementsNames<TNames extends ImplementationNames> {
  "~names"?(names: TNames): void
}

/**
 * The params of the declared action or guard named `K` (upstream `GetConcreteByKey<...,
 * "type", K>["params"]`): its `params` member, `undefined` when it declares none.
 */
type ParamsOf<TObject extends ParameterizedObject, K extends string> = TObject extends { readonly type: K }
  ? "params" extends keyof TObject ? TObject["params"] : undefined
  : never

/**
 * Result of executing an action - NoOp variant.
 *
 * @since 0.1.0
 * @category Types
 */
export class NoOp extends Data.TaggedClass("NoOp")<{}> {}

/**
 * Result of executing an action - ContextUpdate variant.
 *
 * @since 0.1.0
 * @category Types
 */
export class ContextUpdate extends Data.TaggedClass("ContextUpdate")<{
  readonly context: unknown
}> {}

/**
 * Result of executing an action - SpawnChild variant: the spawn a `spawnChild` action asks
 * for (upstream `resolveSpawn`). The engine resolves a string src against the machine's
 * actor implementations, warns for an unknown one, and otherwise creates the child and adds
 * it to `snapshot.children`; the child starts after the macrostep. `id` is the resolved id;
 * `givenId`, which the built-in `spawnChild` sets, is the `id` option as written (a function
 * stays a function), which the executable action's params hold, as upstream's do; a result
 * without it gives the resolved id there. `input` is the child's input (none when absent).
 * `resolveInput`, which the built-in `spawnChild` sets in place of `input`, gives the input:
 * the engine calls it only once the src resolves to a logic (upstream `resolveSpawn` calls an
 * input function only then).
 *
 * @since 0.1.0
 * @category Types
 */
export class SpawnChild extends Data.TaggedClass("SpawnChild")<{
  readonly src: string | AnyActorLogic
  readonly id: Option.Option<string>
  readonly givenId?: unknown
  readonly systemId: Option.Option<string>
  readonly input?: unknown
  readonly resolveInput?: () => unknown
  readonly syncSnapshot: boolean
}> {}

/**
 * Result of executing an action - StopChild variant: the child a `stopChild` action names
 * (upstream `resolveStop`), a reference or a string. The engine resolves a string against
 * `snapshot.children` by id, then by systemId (D7), removes the child from
 * `snapshot.children` and stops it; a name it cannot resolve changes nothing.
 *
 * @since 0.1.0
 * @category Types
 */
export class StopChild extends Data.TaggedClass("StopChild")<{
  readonly target: string | ActorRefBase
}> {}

/**
 * Result of executing an action - SendEvent variant: the send a `sendTo` action asks for
 * (upstream `resolveSendTo`). The target is a reference or a name; the engine resolves a name
 * with the snapshot of that point of the action list: `#_parent`, `#_internal` and `#_self`
 * (the machine actor itself), `#_<id>` (a child by id), else a child by id and then an actor
 * by systemId (D7). A name it cannot resolve sets status `error` with `Unable to send event
 * to actor '<target>' from machine '<id>'.`. `sendTo` gives the delay in milliseconds (it
 * resolves a name itself, before the target, as upstream); the engine resolves a delay name
 * that a definition put here against the machine's `delays` implementations, as for
 * `RaiseEvent`. With a delay in milliseconds the
 * engine schedules the event under the send `id`; without one, or with one that does not
 * resolve to a number, it sends the event through `system.relay` after the macrostep.
 *
 * @since 0.1.0
 * @category Types
 */
export class SendEvent extends Data.TaggedClass("SendEvent")<{
  readonly target: string | ActorRefBase
  readonly event: EventObject
  /** The delay in milliseconds, or the name of a delay of the machine's implementations */
  readonly delay: Option.Option<number | string>
  /** The id of a delayed send, for `cancel` */
  readonly id: Option.Option<string>
}> {}

/**
 * Result of executing an action - RaiseEvent variant: the raise a `raise` action asks for
 * (upstream `resolveRaise`). `raise` gives the delay in milliseconds (it resolves a name
 * itself); the engine resolves a delay name that a definition put here against the machine's
 * `delays` implementations (a number, a `Duration`, or a function of the action arguments
 * and the params of the use). A delay in milliseconds, zero included, schedules the event to the
 * actor itself once the macrostep commits (upstream `executeRaise`); no delay, or one that
 * does not resolve to a number, puts it on the internal queue, so the same macrostep takes it.
 *
 * @since 0.1.0
 * @category Types
 */
export class RaiseEvent extends Data.TaggedClass("RaiseEvent")<{
  readonly event: EventObject
  /** The delay in milliseconds, or the name of a delay of the machine's implementations */
  readonly delay: Option.Option<number | string>
  /** The id of a delayed raise, for `cancel` */
  readonly id: Option.Option<string>
}> {}

/**
 * Result of executing an action - Cancel variant: the cancel a `cancel` action made (upstream
 * `resolveCancel`'s params `{ sendId }`). The action defers the scheduler's cancel itself
 * (upstream `executeCancel`); the engine hands the resolved id to the actor's action executor,
 * so the `@xstate.action` inspection event carries upstream's params.
 *
 * @since 0.1.0
 * @category Types
 */
export class Cancel extends Data.TaggedClass("Cancel")<{
  /** The id of the delayed event the action cancels */
  readonly sendId: string
}> {}

/**
 * Result of executing an action - EmitEvent variant.
 *
 * @since 0.1.0
 * @category Types
 */
export class EmitEvent extends Data.TaggedClass("EmitEvent")<{
  readonly event: EventObject
}> {}

/**
 * The level of a log entry (port): `log`'s `{ level }` option and the helpers `logDebug`,
 * `logInfo`, `logWarning`, `logError` give it; the engine logs at the Effect level of the
 * same name (`warning` is Effect's `Warn`).
 *
 * @since 0.1.0
 * @category Types
 */
export type LogLevel = "debug" | "info" | "warning" | "error"

/**
 * Result of executing an action - Log variant: the log a `log` action asks for (upstream
 * `resolveLog`), with its value already computed. The engine logs it once (upstream
 * `executeLog`) through the actor's action executor, so before `start` it waits for
 * `start`: `(label, value)` with a label that is not empty, `(value)` without one.
 *
 * @since 0.1.0
 * @category Types
 */
export class Log extends Data.TaggedClass("Log")<{
  /** The value to log, as the action gave it or as its function returned it */
  readonly value: unknown
  /** The label (upstream `log(value, label)`) */
  readonly label: Option.Option<string>
  /** The level of the entry */
  readonly level: LogLevel
}> {}

/**
 * Result of executing an action - Enqueued variant: the actions an `enqueueActions` action
 * collected (upstream `resolveEnqueueActions`, which returns them with the snapshot as
 * `[snapshot, undefined, actions]`). The engine resolves them in place, in order, with the
 * snapshot of that point of the action list, as if they stood in the list themselves (upstream
 * `resolveAndExecuteActionsWithContext`): each one is any action form a machine config takes
 * (a name, `{ type, params }`, an inline function, a built-in action, a port definition), so a
 * nested `enqueueActions` resolves in place too.
 *
 * @since 0.1.0
 * @category Types
 */
export class Enqueued extends Data.TaggedClass("Enqueued")<{
  /** The actions in the order they were enqueued, of the machine that runs the action */
  readonly actions: ReadonlyArray<unknown>
}> {}

/**
 * Result of executing an action.
 *
 * @since 0.1.0
 * @category Types
 */
export type ActionResult =
  | NoOp
  | ContextUpdate
  | SpawnChild
  | StopChild
  | SendEvent
  | RaiseEvent
  | EmitEvent
  | Cancel
  | Log
  | Enqueued

/**
 * Action result constructors.
 *
 * @since 0.1.0
 * @category Types
 */
export const ActionResult = {
  NoOp: (): ActionResult => new NoOp(),
  ContextUpdate: (context: unknown): ActionResult => new ContextUpdate({ context }),
  SpawnChild: (request: {
    readonly src: string | AnyActorLogic
    readonly id: Option.Option<string>
    readonly givenId?: unknown
    readonly systemId: Option.Option<string>
    readonly input?: unknown
    readonly resolveInput?: () => unknown
    readonly syncSnapshot: boolean
  }): ActionResult => new SpawnChild(request),
  StopChild: (target: string | ActorRefBase): ActionResult => new StopChild({ target }),
  SendEvent: (
    target: string | ActorRefBase,
    event: EventObject,
    options?: { readonly delay?: Option.Option<number | string>; readonly id?: Option.Option<string> }
  ): ActionResult =>
    new SendEvent({ target, event, delay: options?.delay ?? Option.none(), id: options?.id ?? Option.none() }),
  RaiseEvent: (
    event: EventObject,
    options?: { readonly delay?: Option.Option<number | string>; readonly id?: Option.Option<string> }
  ): ActionResult =>
    new RaiseEvent({ event, delay: options?.delay ?? Option.none(), id: options?.id ?? Option.none() }),
  EmitEvent: (event: EventObject): ActionResult => new EmitEvent({ event }),
  Cancel: (sendId: string): ActionResult => new Cancel({ sendId }),
  Log: (
    value: unknown,
    options?: { readonly label?: Option.Option<string>; readonly level?: LogLevel }
  ): ActionResult => new Log({ value, label: options?.label ?? Option.none(), level: options?.level ?? "info" }),
  Enqueued: (actions: ReadonlyArray<unknown>): ActionResult => new Enqueued({ actions }),
}

// ============================================================
// GUARD TYPES
// ============================================================

/**
 * Guard definition with full type information.
 *
 * Guards receive GuardContext<TContext, TEvent> which provides:
 * - Fully typed `context` and `event`
 * - Reference to `self` and `system`
 *
 * Guards are read-only and should not have side effects.
 *
 * @since 0.1.0
 * @category Types
 */
export interface GuardDefinition<
  TContext,
  TEvent extends EventObject,
  TParams = void
> {
  readonly type: string
  readonly params?: TParams
  /**
   * Decides the guard. It fails with `GuardError` when a guard it evaluates in turn names no
   * implementation (the built-in `and`, `or` and `not`).
   */
  readonly predicate: (
    ctx: GuardContext<TContext, TEvent>,
    params: TParams
  ) => Effect.Effect<boolean, GuardError>
}

/**
 * A built-in guard (`and`, `or`, `not`, `stateIn`, `stateNotIn`): it shows its arguments as
 * `params` and decides from its closure, so its predicate takes the params of any use, as
 * upstream's built-in guards take `unknown` params. Used by name in a setup machine, it needs
 * no params. `TGuards` is the guards it names, each with the params of that use (see
 * {@link ReferencedGuards}): a setup checks them against its own guards.
 *
 * @since 0.1.0
 * @category Types
 */
export interface BuiltInGuardDefinition<TContext, TEvent extends EventObject, TShown, TGuards = never>
  extends GuardDefinition<TContext, TEvent, unknown>
{
  readonly params: TShown
  /**
   * The guards this guard names (type only; never set, XState `_out_TGuard`): `{ type, params
   * }` for each name and each use, with the guards a nested `and`, `or` or `not` names.
   */
  readonly "~guards"?: TGuards
}

/**
 * One guard a built-in guard takes (XState `SingleGuardArg`): a guard name, a `{ type, params
 * }` use or a guard definition as written (so `and`, `or` and `not` know the names), or an
 * inline function of the machine's context and events, whose params are `unknown` (upstream
 * `SingleGuardArg<..., unknown, ...>`); a definition's `predicate` reads them too. A guard typed as any guard (explicit type arguments, a variable of type `Guard`) is
 * taken as it is and names any guard.
 *
 * @since 0.1.0
 * @category Types
 */
export type GuardArg<TContext, TEvent extends EventObject, TArg> = Guard<TContext, TEvent> extends TArg ? AnyGuardArg<TContext, TEvent>
  : [TArg] extends [{ readonly predicate: unknown }] ? Pick<GuardDefinition<TContext, TEvent, never>, "type" | "predicate">
  : [TArg] extends [{ readonly type: string }] ? AsWritten<TArg>
  : [TArg] extends [string] ? TArg
  : GuardPredicate<TContext, TEvent, unknown>

/**
 * A guard argument typed as any guard (explicit type arguments, a value of type `Guard`, and
 * the first pass of the checker over an inline function): any {@link Guard}, with the
 * function form of {@link CompositeGuardPredicate}.
 */
type AnyGuardArg<TContext, TEvent extends EventObject> =
  | GuardReference<TContext, TEvent, ParameterizedObject>
  | CompositeGuardPredicate<TContext, TEvent>
  | Pick<GuardDefinition<TContext, TEvent, never>, "type" | "predicate">

/**
 * The function form of a guard argument typed as any guard: an inline function reads its
 * params as `unknown` (upstream `SingleGuardArg<..., unknown, ...>`), as the last branch of
 * {@link GuardArg} gives it. It is a method's signature, whose parameters TypeScript compares
 * both ways, so a `Guard` value given with explicit type arguments (its function form takes
 * `undefined` params) still fits; an inline function the checker infers is checked strictly,
 * so one that annotates narrower params is a type error, as upstream.
 */
type CompositeGuardPredicate<TContext, TEvent extends EventObject> = {
  check(args: GuardArgs<TContext, TEvent>, params: unknown): boolean | Effect.Effect<boolean>
}["check"]

/**
 * The object type as written (XState `Identity`): a mapped copy, through which the checker
 * keeps a reference's literal `type` while it infers the argument.
 */
type AsWritten<T> = { [K in keyof T]: T[K] }

/**
 * The guards a guard argument names (XState `NormalizeGuardArg`): a name gives `{ type, params:
 * undefined }`; a `{ type, params }` use gives its type and params (the result of a params
 * function, `unknown` when it gives none); a built-in guard gives the guards it names; an
 * inline function names none.
 *
 * @since 0.1.0
 * @category Types
 */
export type ReferencedGuards<TArg> = TArg extends { readonly predicate: unknown }
  ? "~guards" extends keyof TArg ? Exclude<TArg["~guards"], undefined> : never
  : TArg extends string ? { readonly type: TArg; readonly params: undefined }
  : TArg extends { readonly type: infer TType extends string }
    ? { readonly type: TType; readonly params: TArg extends { readonly params: infer TParams } ? ParamsOfUse<TParams> : unknown }
  : never

/** The params of a use: the value, or what a params function gives. */
type ParamsOfUse<TParams> = TParams extends (...args: never) => infer TResult ? TResult : TParams

// ============================================================
// XSTATE GUARD FORMS
// ============================================================

/**
 * The argument object every XState-form guard receives (upstream `GuardArgs`): exactly the
 * context and the event.
 *
 * @since 0.1.0
 * @category Types
 */
export interface GuardArgs<TContext, TEvent extends EventObject> {
  readonly context: TContext
  readonly event: TEvent
}

/**
 * A guard written as a function (upstream `GuardPredicate`), called as
 * `fn({ context, event }, params)`. Inline in a config it receives `undefined` params; as an
 * implementation it receives the params of each use. It returns a boolean, or an
 * `Effect<boolean>` that the evaluator runs (port extension).
 *
 * @example
 * ```ts
 * guard: ({ context, event }) => context.count + event.amount > 10
 * ```
 *
 * @since 0.1.0
 * @category Types
 */
export type GuardPredicate<TContext, TEvent extends EventObject, TParams = undefined> = (
  args: GuardArgs<TContext, TEvent>,
  params: TParams
) => boolean | Effect.Effect<boolean>

/**
 * A use of a named guard with the params of that use (upstream `ParameterizedObject` with a
 * `DynamicParam`): a static value, or a function of the context and the event.
 *
 * @example
 * ```ts
 * guard: { type: "atLeast", params: ({ context }) => ({ min: context.limit }) }
 * ```
 *
 * @since 0.1.0
 * @category Types
 */
export interface ParameterizedGuard<TContext, TEvent extends EventObject> {
  readonly type: string
  readonly params?: DynamicParams<TContext, TEvent>
}

/**
 * A guard as a machine config writes it (upstream `Guard`): the name of an implementation,
 * a `{ type, params }` use of one, an inline function, or a port `GuardDefinition` of any
 * params type (D15), which the built-in `and`, `or`, `not`, `stateIn` and `when` return.
 * `TNames` holds the guards a name may name, with their params (see
 * {@link ImplementationNames}; any name and any params by default).
 *
 * @since 0.1.0
 * @category Types
 */
export type Guard<TContext, TEvent extends EventObject, TNames extends ImplementationNames = ImplementationNames> =
  | GuardReference<TContext, TEvent, TNames["guards"]>
  | GuardPredicate<TContext, TEvent>
  | Pick<GuardDefinition<TContext, TEvent, never>, "type" | "predicate">

/**
 * A use of a named guard as a config writes it (as {@link ActionReference} for actions):
 * with the wide default, any name or `{ type, params }`; with named guards, the name alone
 * for a guard whose params may be `undefined`, else `{ type, params }` with params of that
 * guard's type.
 *
 * @since 0.1.0
 * @category Types
 */
export type GuardReference<TContext, TEvent extends EventObject, TGuards extends ParameterizedObject> =
  string extends TGuards["type"] ? string | ParameterizedGuard<TContext, TEvent>
  : NamedReference<TContext, TEvent, TGuards>

/**
 * A guard of any machine (upstream `UnknownGuard`).
 *
 * @since 0.1.0
 * @category Types
 */
export type UnknownGuard = Guard<unknown, EventObject>

/**
 * A guard implementation in `setup({ guards })`, `createMachine(config, { guards })` and
 * `machine.provide({ guards })` (upstream): a plain function or a port `GuardDefinition`,
 * called with the params of each use, or another guard (a name or a `{ type, params }`
 * use) that the evaluator resolves in turn. A definition's own `params` field plays no part.
 *
 * @since 0.1.0
 * @category Types
 */
export type GuardImplementation<TContext, TEvent extends EventObject> =
  | GuardPredicate<TContext, TEvent, never>
  | Pick<GuardDefinition<TContext, TEvent, never>, "type" | "predicate">
  | string
  | ParameterizedGuard<TContext, TEvent>

/**
 * What the guard evaluator needs besides the context and the event: the implementations
 * that resolve guard names (upstream reads them from `snapshot.machine`), the actor a port
 * `GuardDefinition` receives as `self` and `system`, and the snapshot `stateIn` checks
 * (upstream's fourth argument). Without a snapshot no state is active, so `stateIn` is
 * false. A `GuardContext` is one.
 *
 * @since 0.1.0
 * @category Types
 */
export interface GuardScope<TContext, TEvent extends EventObject> {
  readonly self: ActorRefBase
  readonly system: import("./ActorLogic.js").ActorSystemService
  readonly implementations?: MachineImplementations<TContext, TEvent>
  readonly snapshot?: MachineSnapshot<TContext>
}

// ============================================================
// INVOKE TYPES
// ============================================================

/**
 * Invoke configuration in state config. A string `src` names one of the actors `TNames`
 * holds (see {@link ImplementationNames}; any name by default); otherwise `src` is any
 * actor logic, whatever its types, a state machine included (upstream `AnyActorLogic`).
 * The `id` is the invoked actor's id, `<index>.<node id>` when none is given (XState: a
 * string); its done, error and snapshot events are `xstate.done.actor.<id>`,
 * `xstate.error.actor.<id>` and `xstate.snapshot.<id>`. Where the actors are declared (a
 * setup machine, or a plain `createMachine` with `types.actors`), inline logic takes no `id`
 * (upstream `DistributeActors`: `id?: never`), so only a declared actor's invocation is named,
 * with one of the ids the actor declares (required then), and the events its results take
 * are typed:
 * `onDone`'s `event.output` from the named actor's logic (an Option, D8), `onError`'s
 * `event.error` as unknown, `onSnapshot`'s `event.snapshot` from that logic's snapshot.
 * Where any name is taken (a plain `createMachine`), they are upstream's untyped events:
 * `onDone`'s `event.output` is an Option of any value (`DoneActorEvent<any>`), `onError`'s
 * `event.error` unknown, `onSnapshot`'s `event.snapshot` any snapshot (`SnapshotEvent<any>`;
 * SD-22 amendment 2026-10-07). A declared actor's `input` is of that logic's input type
 * (XState `InputFrom`), given as a value or as a function of `{ context, event, self }`, and
 * it is required when that type does not take `undefined` (XState `RequiredActorOptions`); a
 * logic that declares no input (`unknown`, or `never` for one written inline in
 * `setup({ actors })`) takes any input.
 *
 * @since 0.1.0
 * @category Types
 */
export type InvokeConfig<
  TContext,
  TEvent extends EventObject,
  TMeta = unknown,
  TNames extends ImplementationNames = ImplementationNames
> = string extends TNames["actors"]
  ? InvokeConfigMembers<
    TContext,
    TEvent,
    TMeta,
    TNames,
    DoneActorEvent<UpstreamAny>,
    ErrorActorEvent,
    SnapshotEvent<UpstreamAny>
  > & {
    readonly src: TNames["actors"] | AnyActorLogic
    readonly id?: string
  }
  :
    | DeclaredInvokeConfig<TContext, TEvent, TMeta, TNames, TNames["providedActor"]>
    | InlineInvokeConfig<TContext, TEvent, TMeta, TNames>

/**
 * The invocation of one declared actor (upstream `DistributeActors`, distributed over
 * `TNames["providedActor"]`): its `src`, the result events and `input` of its logic, and its
 * `id` (see {@link InvokedIdConfig}).
 */
type DeclaredInvokeConfig<
  TContext,
  TEvent extends EventObject,
  TMeta,
  TNames extends ImplementationNames,
  TActor extends ProvidedActor
> = TActor extends ProvidedActor ?
    & Omit<
      InvokeConfigMembers<
        TContext,
        TEvent,
        TMeta,
        TNames,
        DoneActorEvent<InvokedOutput<TActor["logic"]>>,
        ErrorActorEvent,
        SnapshotEvent<InvokedSnapshot<TActor["logic"]>>
      >,
      "input"
    >
    & InvokedInputConfig<TContext, TEvent, InvokedInput<TActor["logic"]>>
    & InvokedIdConfig<TActor>
    & { readonly src: TActor["src"] }
  : never

/**
 * The `id` of an invocation of a declared actor (upstream `id?: TSpecificActor['id']` with
 * `RequiredActorOptions`): one of the ids the actor declares, required then; any id when it
 * declares none.
 */
type InvokedIdConfig<TActor> = TActor extends { readonly id?: infer TId }
  ? unknown extends TId ? { readonly id?: string }
  : undefined extends TId ? { readonly id?: TId }
  : { readonly id: TId }
  : { readonly id?: string }

/**
 * The inline-logic member of a setup machine's {@link InvokeConfig}: any actor logic as
 * `src`, no `id`. A setup that declares no actors gets none (upstream `DistributeActors`
 * over no actors is `never`), so its machine takes no invocation at all and TypeScript
 * reports an invoke object's `src` as an excess property, as upstream.
 */
type InlineInvokeConfig<
  TContext,
  TEvent extends EventObject,
  TMeta,
  TNames extends ImplementationNames
> = [TNames["actors"]] extends [never] ? never
  : InvokeConfigMembers<TContext, TEvent, TMeta, TNames, DoneActorEvent, ErrorActorEvent, SnapshotEvent<Snapshot>> & {
    readonly src: AnyActorLogic
    readonly id?: never
  }

/** The output type of an invoked logic (XState `OutputFrom`); unknown for any other logic. */
type InvokedOutput<TLogic> = TLogic extends ActorLogic<infer S, infer _E, infer _I, infer _Em, infer _R>
  ? S extends Snapshot<infer O> ? O : unknown
  : unknown

/** The input type of an invoked logic (XState `InputFrom`); unknown for any other logic. */
type InvokedInput<TLogic> = TLogic extends ActorLogic<infer _S, infer _E, infer I, infer _Em, infer _R> ? I : unknown

/**
 * The `input` of an invocation of a declared actor whose input type is `TInput`: any input
 * (see {@link InvokeInput}) when the logic declares none (`unknown`, or `never` for one
 * written inline in `setup({ actors })`), else a value or a function of `{ context, event,
 * self }` of that type, required unless the type takes `undefined`.
 */
type InvokedInputConfig<TContext, TEvent extends EventObject, TInput> = [TInput] extends [never]
  ? { readonly input?: InvokeInput<TContext, TEvent> }
  : unknown extends TInput ? { readonly input?: InvokeInput<TContext, TEvent> }
  : undefined extends TInput ? { readonly input?: TypedInvokeInput<TContext, TEvent, TInput> }
  : { readonly input: TypedInvokeInput<TContext, TEvent, TInput> }

/**
 * An input of type `TInput`, as a value or as a function of `{ context, event, self }` (XState
 * `Mapper | InputFrom`); `self` is the invoking machine's reference, which takes its events.
 */
type TypedInvokeInput<TContext, TEvent extends EventObject, TInput> =
  | TInput
  | ((args: {
    readonly context: TContext
    readonly event: TEvent
    readonly self: ActorRef<MachineSnapshot<TContext>, TEvent>
  }) => TInput)

/** The snapshot type of an invoked logic (XState `SnapshotFrom`); any snapshot for any other logic. */
type InvokedSnapshot<TLogic> = TLogic extends ActorLogic<infer S, infer _E, infer _I, infer _Em, infer _R> ? S : Snapshot

/**
 * The members of an {@link InvokeConfig} besides `src` and `id`. `TDoneEvent`,
 * `TErrorEvent` and `TSnapshotEvent` are the events the `onDone`, `onError` and `onSnapshot`
 * transitions take (the machine's events by default); their actions may still raise and
 * send the machine's events, and `self` takes them. The machine's event type is never
 * inferred from these transitions (`NoInfer`), so an inline machine keeps the events of its
 * own `on` keys.
 *
 * @since 0.1.0
 * @category Types
 */
export interface InvokeConfigMembers<
  TContext,
  TEvent extends EventObject,
  TMeta = unknown,
  TNames extends ImplementationNames = ImplementationNames,
  TDoneEvent extends EventObject = TEvent,
  TErrorEvent extends EventObject = TEvent,
  TSnapshotEvent extends EventObject = TEvent
> {
  /**
   * The key the invoked actor registers under in the system while the state is active
   * (XState `systemId`): `system.get(systemId)` finds it from the entry on, and no more once
   * the state exits.
   */
  readonly systemId?: string
  /**
   * The invoked actor's input: a value, or a function of the context, the event that enters
   * the state and the invoking actor, called on entry (XState `Mapper`).
   */
  readonly input?: InvokeInput<TContext, TEvent>
  /**
   * The transition the invoked actor's done event takes: a transition config or a target
   * string, or a list of them, tried in order (XState `SingleOrArray`).
   */
  readonly onDone?: InvokeTransitionsConfig<TContext, TDoneEvent, TMeta, TNames, NoInfer<TEvent>>
  /** The transitions the invoked actor's error event takes, as `onDone`. */
  readonly onError?: InvokeTransitionsConfig<TContext, TErrorEvent, TMeta, TNames, NoInfer<TEvent>>
  /** The transitions each `xstate.snapshot.<id>` event of the invoked actor takes (XState). */
  readonly onSnapshot?: InvokeTransitionsConfig<TContext, TSnapshotEvent, TMeta, TNames, NoInfer<TEvent>>
}

/**
 * The input of an invocation (XState `Mapper<TContext, TEvent, unknown, TEvent> |
 * NonReducibleUnknown`): any value, or a function of `{ context, event, self }` that gives it
 * on entry. Any value is written `NonNullable<unknown> | null | undefined`, not `unknown`, so
 * that the function beside it in the union keeps its argument type (`unknown` would absorb
 * the union).
 *
 * @since 0.1.0
 * @category Types
 */
export type InvokeInput<TContext, TEvent extends EventObject> =
  | ((args: { readonly context: TContext; readonly event: TEvent; readonly self: ActorRefBase }) => unknown)
  | NonNullable<unknown>
  | null
  | undefined

/**
 * The transitions of an invocation's `onDone`, `onError` or `onSnapshot`: a transition config
 * or a target string, or a list of them, tried in order (XState `string |
 * SingleOrArray<TransitionConfigOrTarget>`). `TEvent` is the event they take and
 * `TSelfEvent` the machine's events, which their actions may raise and send.
 *
 * @since 0.1.0
 * @category Types
 */
export type InvokeTransitionsConfig<
  TContext,
  TEvent extends EventObject,
  TMeta = unknown,
  TNames extends ImplementationNames = ImplementationNames,
  TSelfEvent extends EventObject = TEvent
> =
  | TransitionConfig<TContext, TEvent, TMeta, TNames, TSelfEvent>
  | string
  | ReadonlyArray<TransitionConfig<TContext, TEvent, TMeta, TNames, TSelfEvent> | string>

/**
 * Resolved invoke definition. Its `onDone`, `onError` and `onSnapshot` are the config's, as
 * written, each there exactly when the config has it (upstream spreads the invoke config);
 * the node's transitions on `xstate.done.actor.<id>`, `xstate.error.actor.<id>` and
 * `xstate.snapshot.<id>` are their definitions.
 *
 * @since 0.1.0
 * @category Types
 */
export interface InvokeDefinition<TContext, TEvent extends EventObject, TMeta = unknown> {
  readonly src: string | AnyActorLogic
  readonly id: string
  /** The invocation's `systemId`, none when the config gives none. */
  readonly systemId: Option.Option<string>
  readonly input: Option.Option<InvokeInput<TContext, TEvent>>
  /** The transitions the invoked actor's done event takes, as the config writes them. */
  readonly onDone?: InvokeTransitionsConfig<TContext, TEvent, TMeta>
  /** The transitions the invoked actor's error event takes, as the config writes them. */
  readonly onError?: InvokeTransitionsConfig<TContext, TEvent, TMeta>
  /** The transitions each snapshot event of the invoked actor takes, as the config writes them. */
  readonly onSnapshot?: InvokeTransitionsConfig<TContext, TEvent, TMeta>
}

// ============================================================
// OUTPUT TYPES
// ============================================================

/**
 * Output definition for final states and the machine root (upstream `Mapper |
 * NonReducibleUnknown`): a mapper of the context, the event and `self`, or the output value.
 * The value side is {@link ActionParams}, not `unknown`, so it does not absorb the mapper and
 * a mapper written inline stays contextually typed. `TEvent` is the event the mapper reads (a
 * final state's: the machine's events; the root's: its `xstate.done.state.*` event) and
 * `TSelfEvent` every event the machine takes, which `self` accepts. `TOutput` is the output
 * type the machine declares (XState `TOutput`): the value and the mapper's result must be of
 * that type; while it is `unknown` (nothing declared) any value is taken.
 *
 * @example
 * ```ts
 * states: { done: { type: "final", output: ({ context }) => context.count } }
 * ```
 *
 * @since 0.1.0
 * @category Types
 */
export type OutputDefinition<
  TContext,
  TEvent extends EventObject,
  TSelfEvent extends EventObject = TEvent,
  TOutput = unknown
> =
  | ((args: {
      readonly context: TContext
      readonly event: TEvent
      readonly self: ActorRef<MachineSnapshot<TContext>, TSelfEvent>
    }) => TOutput)
  | (unknown extends TOutput ? ActionParams : TOutput & ActionParams)

// ============================================================
// MACHINE IMPLEMENTATIONS
// ============================================================

/**
 * A delay function (upstream `DelayExpr`): called with the action arguments and the params of
 * the use of the action whose delay it is (`undefined` for an inline use and an `after` key),
 * it gives the delay in milliseconds, or a `Duration` (port). A result that is neither means
 * no delay.
 *
 * @since 0.1.0
 * @category Types
 */
export type DelayFunction<TContext, TEvent extends EventObject, TParams = undefined> = (
  args: ActionArgs<TContext, TEvent>,
  params: TParams
) => number | Duration.Duration

/**
 * A delay of the machine's `delays` implementations (upstream `DelayConfig`): milliseconds, a
 * `Duration` (port), or a {@link DelayFunction}. A delay function declares its own params
 * type, as an action implementation does.
 *
 * @since 0.1.0
 * @category Types
 */
export type DelayConfig<TContext, TEvent extends EventObject> =
  | number
  | Duration.Duration
  | DelayFunction<TContext, TEvent, never>

/**
 * Machine implementations for actions, guards, actors, and delays: any name in each record.
 * A machine whose `types` declare names takes {@link DeclaredImplementations} instead.
 *
 * @since 0.1.0
 * @category Types
 */
export interface MachineImplementations<TContext, TEvent extends EventObject> {
  readonly actions?: Record<string, ActionImplementation<TContext, TEvent>>
  readonly guards?: Record<string, GuardImplementation<TContext, TEvent>>
  /** The actor logic a string src names in `spawn`, `spawnChild` and `invoke`. */
  readonly actors?: Record<string, AnyActorLogic>
  /** The delays a name resolves to in `raise`, `sendTo` and an `after` key. */
  readonly delays?: Record<string, DelayConfig<TContext, TEvent>>
}

/**
 * The implementations of a machine built by `createMachine` (its second argument and
 * `provide`), typed by what its `types` member declares (upstream
 * `InternalMachineImplementations`): `TAction` and `TGuard` with their params, `TDelay`, and
 * `TActor` with its logic. Each record takes only the declared names; a record whose names
 * the machine does not declare (the defaults) takes any name, as {@link MachineImplementations}.
 *
 * Each record is one mapped type over the declared names, so the slot of a name is known
 * while the call is still inferring its types, and a nested `assign` or `fromPromise` reads
 * that slot's params, input and output.
 *
 * @example
 * ```ts
 * createMachine(
 *   { types: {} as { actions: { type: "inc"; params: { by: number } } }, context: { count: 0 } },
 *   { actions: { inc: assign(({ context }, params) => ({ count: context.count + params.by })) } }
 * )
 * ```
 *
 * @since 0.1.0
 * @category Types
 */
export interface DeclaredImplementations<
  TContext,
  TEvent extends EventObject,
  TAction extends ParameterizedObject = ParameterizedObject,
  TGuard extends ParameterizedObject = ParameterizedObject,
  TDelay extends string = string,
  TActor extends ProvidedActor = ProvidedActor
> {
  /**
   * The action implementations by declared name; a built-in action written here reads the
   * declared names (its `check` takes the declared guards).
   */
  readonly actions?: ActionImplementations<TContext, TEvent, TAction, DeclaredImplementationNames<TAction, TGuard, TDelay, TActor>>
  readonly guards?: GuardImplementations<TContext, TEvent, TGuard>
  /** The actor logic a string src names in `spawn`, `spawnChild` and `invoke`. */
  readonly actors?: ActorImplementations<TActor>
  /** The delays a name resolves to in `raise`, `sendTo` and an `after` key. */
  readonly delays?: DelayImplementations<TContext, TEvent, TDelay>
}

/**
 * The names a built-in action written in the implementations of `createMachine` reads (see
 * {@link ImplementsNames}): the actions, guards, delays and actors `types` declares, any name
 * of a kind it does not declare. Each kind is a part of its own: while the checker infers the
 * call, a kind with nothing to infer from is a placeholder that would hide the whole names
 * type from the built-in action's inference, so that kind's part is left out then.
 */
type DeclaredImplementationNames<TAction, TGuard, TDelay, TActor extends ProvidedActor> =
  & ImplementationNames
  & DeclaredNamesPart<TAction, { readonly actions: TAction }>
  & DeclaredNamesPart<TGuard, { readonly guards: TGuard }>
  & DeclaredNamesPart<TDelay, { readonly delays: TDelay }>
  & DeclaredNamesPart<TActor, {
    readonly actors: TActor["src"]
    readonly actorLogic: { readonly [K in TActor["src"]]: Extract<TActor, { readonly src: K }>["logic"] }
    readonly providedActor: TActor
  }>

/** `TPart`, or nothing while `T` is still the checker's placeholder (`never`). */
type DeclaredNamesPart<T, TPart> = [T] extends [never] ? unknown : TPart

/**
 * The `guards` record of a machine's implementations (upstream
 * `MachineImplementationsGuards`): any name while the machine declares no guards; once
 * `types.guards` declares them, only those names, each a plain predicate that takes the
 * params of its uses, a port definition, or a use of another declared guard.
 *
 * @since 0.1.0
 * @category Types
 */
export type GuardImplementations<TContext, TEvent extends EventObject, TGuard extends ParameterizedObject> = {
  readonly [K in TGuard["type"]]?: string extends TGuard["type"] ? GuardImplementation<TContext, TEvent>
    : NamedGuardImplementation<TContext, TEvent, ParamsOf<TGuard, K>, TGuard>
}

/**
 * The implementation of a guard whose uses carry params of type `TParams` (upstream `Guard`
 * with the params of that guard's name): a plain predicate that takes those params, a port
 * definition, or a use of another guard of `TGuards`.
 *
 * @since 0.1.0
 * @category Types
 */
export type NamedGuardImplementation<
  TContext,
  TEvent extends EventObject,
  TParams,
  TGuards extends ParameterizedObject
> =
  | GuardPredicate<TContext, TEvent, TParams>
  | Pick<GuardDefinition<TContext, TEvent, never>, "type" | "predicate">
  | GuardReference<TContext, TEvent, TGuards>

/**
 * The `delays` record of a machine's implementations (upstream
 * `MachineImplementationsDelays`): any name while the machine declares no delays, else only
 * the names `types.delays` declares.
 *
 * @since 0.1.0
 * @category Types
 */
export type DelayImplementations<TContext, TEvent extends EventObject, TDelay extends string> = {
  readonly [K in TDelay]?: DelayConfig<TContext, TEvent>
}

/**
 * The `actors` record of a machine's implementations (upstream
 * `MachineImplementationsActors`): any name and any logic while the machine declares no
 * actors; once `types.actors` declares them, only their src names, each with the logic type
 * declared for it.
 *
 * @since 0.1.0
 * @category Types
 */
export type ActorImplementations<TActor extends ProvidedActor> = {
  readonly [K in TActor["src"]]?: Extract<TActor, { readonly src: K }>["logic"]
}

// ============================================================
// STATE CONFIG
// ============================================================

/**
 * The `on` member of a state node config (upstream `TransitionsConfig`): for each event
 * descriptor of the machine's events (an event type, a partial descriptor such as `mouse.*`,
 * or `*`), a transition config or a target string, or a list of them tried in order. The
 * guard, the actions and the params functions of a descriptor's transitions read the events
 * that descriptor matches (`ExtractEvent`), while an action's `self` takes every event of the
 * machine. A key that is no descriptor of the machine's events is a type error; a machine
 * whose event type is `EventObject` takes any key. An `undefined` value is a forbidden
 * transition: it takes the event and does nothing.
 *
 * @example
 * ```ts
 * type Event = { type: "EMERGENCY"; isEmergency: boolean } | { type: "mouse.click"; x: number }
 * // on: {
 * //   EMERGENCY: { target: "red", guard: ({ event }) => event.isEmergency },
 * //   "mouse.*": { actions: ({ event }) => console.log(event.x) }
 * // }
 * ```
 *
 * @since 0.1.0
 * @category Types
 */
export type TransitionsConfig<
  TContext,
  TEvent extends EventObject,
  TMeta = unknown,
  TNames extends ImplementationNames = ImplementationNames
> = {
  readonly [K in EventDescriptor<TEvent>]?:
    | TransitionConfig<TContext, ExtractEvent<TEvent, K>, TMeta, TNames, TEvent>
    | string
    | ReadonlyArray<TransitionConfig<TContext, ExtractEvent<TEvent, K>, TMeta, TNames, TEvent> | string>
    | undefined
}

/**
 * State configuration in machine config. `TStateMeta` types the node's `meta` and
 * `TTransitionMeta` the `meta` of each of its transitions (XState 5.33 `types.meta` and
 * `types.transitionMeta`); the transition meta type defaults to the state meta type.
 * `TNames` holds the actions, guards, delays and actors the node may name (see
 * {@link ImplementationNames}; any name by default).
 *
 * @since 0.1.0
 * @category Types
 */
export interface StateNodeConfig<
  TContext,
  TEvent extends EventObject,
  TStateMeta = unknown,
  TTransitionMeta = TStateMeta,
  TNames extends ImplementationNames = ImplementationNames
> {
  /**
   * A custom id for the state node (XState). The node is reachable by this id, while its
   * children keep `<machineId>.<path>` ids.
   */
  readonly id?: string
  readonly type?: StateNodeType
  /** The initial child's key, or the initial transition with its actions. */
  readonly initial?: string | InitialTransitionConfig<TContext, TEvent, TTransitionMeta, TNames>
  readonly states?: Record<string, StateNodeConfig<TContext, TEvent, TStateMeta, TTransitionMeta, TNames>>
  /**
   * The transitions for each event descriptor (XState `TransitionsConfig`): a transition
   * config or a target string, or a list of them tried in order, each reading the events its
   * descriptor matches. An `undefined` value is a forbidden transition: it takes the event
   * and does nothing.
   */
  readonly on?: TransitionsConfig<TContext, TEvent, TTransitionMeta, TNames>
  /**
   * Eventless transitions (XState `TransitionConfigOrTarget`): a transition config or a
   * target string, or a list of them, tried in order.
   */
  readonly always?:
    | TransitionConfig<TContext, TEvent, TTransitionMeta, TNames>
    | string
    | ReadonlyArray<TransitionConfig<TContext, TEvent, TTransitionMeta, TNames> | string>
  /**
   * The transition the node takes when it completes (XState `onDone`): a compound node when
   * a final child is entered, a parallel node when every region is complete. It is the
   * node's transition on `xstate.done.state.<node id>`, whose `output` is an `Option`: the
   * final child's output for a compound node, `Option.none()` for a parallel node. Its guard
   * and actions read that event (upstream `DoneStateEvent`); `self` takes the machine's events.
   */
  readonly onDone?:
    | TransitionConfig<TContext, DoneStateEvent, TTransitionMeta, TNames, NoInfer<TEvent>>
    | string
    | ReadonlyArray<TransitionConfig<TContext, DoneStateEvent, TTransitionMeta, TNames, NoInfer<TEvent>> | string>
  /**
   * Delayed transitions (XState `after`): for each delay, the transitions the state takes
   * that long after it is entered, unless it is exited first. A key that reads as a number
   * is milliseconds (`1000`, `'1000'`); any other key names a delay of the machine's `delays`
   * implementations, a number or a function of the context and the event. The transitions
   * of a key wait for the event `xstate.after.<delay>.<state node id>`. With named delays
   * (`TNames`), a key is one of those names or a number.
   */
  readonly after?: DelayedTransitionsConfig<TContext, TEvent, TTransitionMeta, TNames>
  /**
   * The state's entry actions. The machine's events are no inference site here (upstream
   * `NoInfer`): an action typed with other events does not change the machine's event type.
   */
  readonly entry?: Action<TContext, NoInfer<TEvent>, TNames> | ReadonlyArray<Action<TContext, NoInfer<TEvent>, TNames>>
  /** The state's exit actions; no inference site of the machine's events either. */
  readonly exit?: Action<TContext, NoInfer<TEvent>, TNames> | ReadonlyArray<Action<TContext, NoInfer<TEvent>, TNames>>
  readonly invoke?:
    | InvokeConfig<TContext, TEvent, TTransitionMeta, TNames>
    | ReadonlyArray<InvokeConfig<TContext, TEvent, TTransitionMeta, TNames>>
  /**
   * The state's tags (XState `SingleOrArray<TTag>`): one tag or a list of them, each one of
   * `TNames["tags"]` (any string by default).
   */
  readonly tags?: TNames["tags"] | ReadonlyArray<TNames["tags"]>
  /**
   * The node's metadata (XState `meta`), of the state meta type; `snapshot.getMeta()` reads it.
   * Writable, as upstream: a node's `config` is this object, and a write to its `meta` shows in
   * the machine config.
   */
  meta?: TStateMeta
  readonly description?: string
  readonly output?: OutputDefinition<TContext, TEvent>
  /**
   * The kind of history a history state keeps (XState): `true` means `'shallow'`, and
   * `false` means none. A truthy value without a `type` makes the node a history state.
   */
  readonly history?: HistoryType | boolean
  /** The default target of a history state: a path below its parent, or a `#id`. */
  readonly target?: string
  /**
   * Makes the node routable (XState `route`): when the node has an explicit `id`, the
   * machine takes the event `{ type: "xstate.route", to: "#<id>" }` to this node from any
   * state, if the route's guard passes. The route transition belongs to the machine root,
   * so a route to the current state exits and re-enters it. A node without an explicit
   * `id`, and the root, are not routable.
   */
  readonly route?: RouteTransitionConfig<TContext, TEvent, TTransitionMeta, TNames>
}

/**
 * The `after` member of a state node config (XState `DelayedTransitions`): for each delay,
 * a transition config or a target, or a list of them. With the wide default any key is
 * taken; with named delays (`TNames`), a key is one of those names or a number of
 * milliseconds (XState `Delay<TDelay>`).
 *
 * @since 0.1.0
 * @category Types
 */
export type DelayedTransitionsConfig<
  TContext,
  TEvent extends EventObject,
  TMeta = unknown,
  TNames extends ImplementationNames = ImplementationNames
> = string extends TNames["delays"] ? Record<
    string | number,
    | TransitionConfig<TContext, TEvent, TMeta, TNames>
    | string
    | ReadonlyArray<TransitionConfig<TContext, TEvent, TMeta, TNames> | string>
  >
  : {
    readonly [K in TNames["delays"] | number]?:
      | TransitionConfig<TContext, TEvent, TMeta, TNames>
      | string
      | ReadonlyArray<TransitionConfig<TContext, TEvent, TMeta, TNames> | string>
  }

// ============================================================
// MACHINE CONFIG
// ============================================================

/**
 * Run-time options of a machine (XState `MachineOptions`).
 *
 * @example
 * ```ts
 * createMachine({ id: "m", initial: "a", context: {}, options: { maxIterations: 5000 }, states: { a: {} } })
 * ```
 *
 * @since 0.1.0
 * @category Types
 */
export interface MachineOptions {
  /**
   * The most loop iterations one macrostep may run before it fails with the infinite-loop
   * error. The iteration that finds the macrostep stable counts too, so a macrostep with
   * k eventless or raised microsteps needs k + 1. Defaults to `Infinity` (no limit).
   */
  readonly maxIterations?: number
}

/**
 * The members of a machine configuration other than `context`. `TNames` holds the
 * implementations the config may name (see {@link ImplementationNames}; any name by default).
 *
 * @since 0.1.0
 * @category Types
 */
export interface MachineConfigMembers<
  TContext,
  TEvent extends EventObject,
  TStateMeta = unknown,
  TTransitionMeta = TStateMeta,
  TNames extends ImplementationNames = ImplementationNames,
  TOutput = unknown
> extends StateNodeConfig<TContext, TEvent, TStateMeta, TTransitionMeta, TNames> {
  /**
   * The machine id (XState, SD-10). A machine with no id, or with the empty id, has the id
   * `(machine)`, and its state ids start with it (`(machine).a`).
   */
  readonly id?: string
  /**
   * The machine output (upstream `Mapper<TContext, DoneStateEvent, TOutput, TEvent> |
   * TOutput`): a mapper of the `xstate.done.state.*` event that completes the machine, or the
   * value itself, of the declared output type (any value while none is declared).
   */
  readonly output?: OutputDefinition<TContext, DoneStateEvent, NoInfer<TEvent>, TOutput>
  /** Run-time options of the machine (XState `options`). */
  readonly options?: MachineOptions
  /** The machine's own version (XState `version`), read back as `machine.version`. */
  readonly version?: string
  /** Schemas the machine carries as given (XState `schemas`, set by `setup({ schemas })`). */
  readonly schemas?: unknown
}

/**
 * The function form of a machine's `context` (XState `ContextFactory`, with upstream's type
 * parameters in upstream's order). The machine calls it once for each actor, when the actor
 * is created, with the actor's `input`, the synchronous `spawn` an assigner gets (its
 * children join the initial snapshot and start with the actor; typed by the machine's
 * declared actors `TActor`, upstream `Spawner<TActor>`) and the actor itself as `self`: the
 * machine actor, whose snapshot is the machine snapshot of `TContext` and `TEvent`, which
 * takes `TEvent` and emits any event. What it throws gives the initial snapshot status
 * `error`.
 *
 * @example
 * ```ts
 * const factory: ContextFactory<{ count: number }, ProvidedActor, { start: number }> = ({ input }) => ({
 *   count: input.start
 * })
 * ```
 *
 * @since 0.1.0
 * @category Types
 */
export type ContextFactory<
  TContext extends MachineContext,
  TActor extends ProvidedActor,
  TInput,
  TEvent extends EventObject = EventObject
> = MachineContextFactory<TContext, TActor, TInput, TEvent>

/**
 * {@link ContextFactory} for a context type that may still be `unknown`: `MachineContextConfig`
 * gives it the context type while `createMachine` infers it, so the type the factory returns
 * is the inferred context.
 */
type MachineContextFactory<TContext, TActor extends ProvidedActor, TInput, TEvent extends EventObject> = (args: {
  spawn: Spawner<TActor>
  input: TInput
  // Upstream's `MachineSnapshot<TContext, TEvent, Record<string, AnyActorRef | undefined>,
  // StateValue, string, unknown, TODO, TODO>`: the state value, tags and output are the
  // defaults, and upstream leaves the meta and the state schema as `TODO` (`any`), which are
  // the port's widest types, the defaults too (ledger DEV-66)
  self: ActorRef<
    MachineSnapshot<TContext, TEvent, Record<string, AnyActorRef | undefined>>,
    TEvent,
    AnyEventObject
  >
}) => TContext

/**
 * The `context` member of a machine configuration, as XState types it: optional while the
 * context type is not declared (`unknown`), required once it is. A machine with no
 * context starts with the empty context `{}`. The function form is a {@link ContextFactory}.
 * Its value is a lower-priority inference site (XState `LowInfer`): a context type that
 * `types.context` declares is not widened by the value, which is checked against it.
 *
 * @example
 * ```ts
 * createMachine({ id: "m", initial: "a", states: { a: {} } }) // context {}
 * createMachine({ id: "m", initial: "a", context: { count: 0 }, states: { a: {} } })
 * createMachine({
 *   types: {} as { input: { start: number }; context: { count: number } },
 *   context: ({ input }) => ({ count: input.start })
 * })
 * ```
 *
 * @since 0.1.0
 * @category Types
 */
export type MachineContextConfig<
  TContext,
  TInput,
  TEvent extends EventObject = EventObject,
  TNames extends ImplementationNames = ImplementationNames
> = unknown extends TContext
  ? { readonly context?: UndeclaredContext<TContext> | MachineContextFactory<TContext, NamedActors<TNames>, TInput, TEvent> }
  : MachineContext extends TContext
    ? { readonly context?: LowInfer<TContext> | MachineContextFactory<LowInfer<TContext>, NamedActors<TNames>, TInput, TEvent> }
  : { readonly context: LowInfer<TContext> | MachineContextFactory<LowInfer<TContext>, NamedActors<TNames>, TInput, TEvent> }

/**
 * The context of a state machine (upstream `MachineContext`, `Record<string, any>`): an
 * object with any members, upstream's `any` (SD-22 amendment 2026-10-07, goal journal
 * `2026-10-07-11-machinecontext-any.md`). The context type `createMachine` infers is one, so
 * a context that is no object is a type error, and a machine whose `types` and config
 * declare none has this context.
 *
 * @since 0.1.0
 * @category Types
 */
export type MachineContext = Record<string, UpstreamAny>

/**
 * The value form of `context` while the context type is not known yet: the context type
 * itself, and any value while it is `unknown`, spelt as the union `{} | null | undefined`. A
 * union with `unknown` itself would be `unknown`, so a context factory written before the
 * context type is inferred (`context: ({ spawn }) => ...` without `types`) would get no
 * parameter type.
 */
type UndeclaredContext<TContext> = unknown extends TContext ? NonNullable<unknown> | null | undefined : TContext

/**
 * Machine configuration. `TStateMeta` and `TTransitionMeta` are the meta types that
 * `setup({ types: { meta, transitionMeta } })` declares. A `meta` in the config is checked
 * against them and infers nothing (XState `DoNotInfer`), so a machine with no meta types
 * takes any meta. `TNames` holds the implementations the config may name (see
 * {@link ImplementationNames}; any name by default, as `createMachine` takes).
 *
 * @since 0.1.0
 * @category Types
 */
export type MachineConfig<
  TContext,
  TEvent extends EventObject,
  TInput = unknown,
  TOutput = unknown,
  TStateMeta = unknown,
  TTransitionMeta = TStateMeta,
  TNames extends ImplementationNames = ImplementationNames
> =
  & MachineConfigMembers<TContext, TEvent, NoInfer<TStateMeta>, NoInfer<TTransitionMeta>, TNames, NoInfer<TOutput>>
  & MachineContextConfig<TContext, TInput, TEvent, TNames>

/**
 * The state structure of a machine at the type level (XState `StateSchema`): each node's
 * child states by key under `states`, as deep as the machine's states. The other members
 * keep the shape of a state node config. A machine built with `setup(...).createMachine`
 * carries the schema of its config's state keys, and so do its snapshots, so `mapState` can
 * check a mapper's keys; a machine from `createMachine` without `setup` has this wide schema,
 * whose `states` take any key (XState gives it an `any` schema).
 *
 * @example
 * ```ts
 * // the schema of { initial: "a", states: { a: { initial: "one", states: { one: {} } }, b: {} } }
 * type Schema = { readonly states: { readonly a: { readonly states: { readonly one: {} } }; readonly b: {} } }
 * ```
 *
 * @since 0.1.0
 * @category Types
 */
export interface StateSchema {
  readonly id?: string
  readonly route?: unknown
  readonly states?: Readonly<Record<string, StateSchema>>
  readonly type?: unknown
  readonly invoke?: unknown
  readonly on?: unknown
  readonly entry?: unknown
  readonly exit?: unknown
  readonly onDone?: unknown
  readonly after?: unknown
  readonly always?: unknown
  readonly meta?: unknown
  readonly output?: unknown
  readonly tags?: unknown
  readonly description?: unknown
}

/**
 * The part of a machine config that `setup(...).createMachine` infers the state keys from:
 * `TStateKeys` holds each state's key and, under it, the keys of its child states. Every
 * child config stays a `TStateNodeConfig`, so the callbacks inside keep their types.
 *
 * @since 0.1.0
 * @category Types
 */
export interface StateKeysConfig<TStateKeys, TStateNodeConfig> {
  readonly states?: {
    readonly [K in keyof TStateKeys]: TStateNodeConfig & StateKeysConfig<TStateKeys[K], TStateNodeConfig>
  }
}

/**
 * The {@link StateSchema} of the state keys {@link StateKeysConfig} infers (XState
 * `ToStateSchema`): a node with child states has them under `states`, a node with none has no
 * `states`, and keys that are not known literals (a config typed as a whole
 * `MachineConfig`) give the wide `StateSchema`.
 *
 * @since 0.1.0
 * @category Types
 */
export type StateSchemaOfKeys<TStateKeys> = string extends keyof TStateKeys ? StateSchema
  : [keyof TStateKeys] extends [never] ? Record<never, never>
  : { readonly states: { readonly [K in keyof TStateKeys]: StateSchemaOfKeys<TStateKeys[K]> } }

/**
 * The route targets of a state schema or config (XState `RoutableStateId`): `#<id>` for each
 * node with both a `route` and an `id`, the given node included, as deep as its `states` go.
 * A node with a `route` and no `id` is not routable, and neither is an `id` without a
 * `route`. A config typed as a whole `StateNodeConfig` (no literal members) gives `never`.
 *
 * @example
 * ```ts
 * type Ids = RoutableStateId<{ states: { a: { id: "a"; route: {} }; b: { route: {} } } }> // "#a"
 * ```
 *
 * @since 0.1.0
 * @category Types
 */
export type RoutableStateId<TSchema> =
  | (TSchema extends { readonly route: unknown; readonly id: infer TId extends string } ? `#${TId}` : never)
  | (TSchema extends { readonly states: infer TStates }
    ? { readonly [K in keyof TStates & string]: RoutableStateId<TStates[K]> }[keyof TStates & string]
    : never)

/**
 * The route event of a machine whose config has routable states (XState
 * `setup().createMachine`): `{ type: "xstate.route", to }` with `to` one of the
 * {@link RoutableStateId}s of the config, or `never` when it has none.
 *
 * @since 0.1.0
 * @category Types
 */
export type RouteEventOf<TConfig> = [RoutableStateId<TConfig>] extends [never] ? never
  : { readonly type: "xstate.route"; readonly to: RoutableStateId<TConfig> }

/**
 * The state schema of a machine config as written (XState `ToStateSchema`): each node's `id`
 * and its child states under `states`, as deep as the config goes. The other members of the
 * config play no part. `setup(...).createMachine` gives its machine this schema, so the
 * snapshot types read the state keys and ids from it.
 *
 * @example
 * ```ts
 * type Schema = ToStateSchema<{ id: "m"; states: { a: { id: "first" }; b: {} } }>
 * // { readonly id: "m"; readonly states: { readonly a: { readonly id: "first" }; readonly b: {} } }
 * ```
 *
 * @since 0.1.0
 * @category Types
 */
export type ToStateSchema<TConfig> = {
  readonly [K in keyof TConfig as K & ("id" | "states")]: K extends "states"
    ? { readonly [SK in keyof TConfig[K]]: ToStateSchema<NonNullable<TConfig[K][SK]>> }
    : TConfig[K]
}

/**
 * The ids of the state nodes of a state schema (XState `StateId`): a node's own `id` when it
 * has one, else its key path below the root, joined with `.` after the root's id; the root's
 * default id is `(machine)`. The wide {@link StateSchema} (a machine built without `setup`)
 * gives any string.
 *
 * @example
 * ```ts
 * type Ids = StateId<{ id: "root"; states: { a: {}; b: { id: "bee" } } }> // "root" | "root.a" | "bee"
 * ```
 *
 * @since 0.1.0
 * @category Types
 */
export type StateId<TSchema, TKey extends string = "(machine)", TParentKey extends string | null = null> =
  IsWideStateSchema<TSchema> extends true ? string
    :
      | (TSchema extends { readonly id: infer TId extends string } ? TId
        : TParentKey extends null ? TKey
        : `${TParentKey}.${TKey}`)
      | (TSchema extends { readonly states: infer TStates } ? {
          readonly [K in keyof TStates & string]: StateId<
            TStates[K],
            K,
            TParentKey extends string ? `${TParentKey}.${TKey}`
              : TSchema extends { readonly id: infer TId extends string } ? TId
              : TKey
          >
        }[keyof TStates & string]
        : never)

/** Whether a schema is the wide `StateSchema` (child states under any key) rather than one written out. */
type IsWideStateSchema<TSchema> = TSchema extends { readonly states?: infer TStates }
  ? string extends keyof NonNullable<TStates> ? true : false
  : false

/** The keys of the child states of a schema that are not history states, split into non-leaf and leaf (XState `GroupStateKeys`). */
type GroupStateKeys<TSchema, S extends PropertyKey> = S extends unknown
  ? TSchema extends { readonly states: infer TStates }
    ? S extends keyof TStates
      ? TStates[S] extends { readonly type: "history" } ? [never, never]
      : TSchema extends { readonly type: "parallel" } ? [S, never]
      : "states" extends keyof TStates[S] ? [S, never]
      : [never, S]
    : [never, never]
    : [never, never]
  : never

/**
 * The state value of a machine config as written (XState `ToStateValue`): for a compound node,
 * the key of each atomic child, or `{ key: <child value> }` for each child with children of
 * its own; for a parallel node, one object with the value of every region; `{}` for a node
 * without child states. History states are left out. A config typed as a whole (no literal
 * state keys) gives the wide `StateValue`.
 *
 * @example
 * ```ts
 * type Value = ToStateValue<{ initial: "a"; states: { a: {}; b: { initial: "b1"; states: { b1: {} } } } }>
 * // "a" | { b: "b1" }
 * ```
 *
 * @since 0.1.0
 * @category Types
 */
export type ToStateValue<TConfig> = IsWideStateSchema<TConfig> extends true ? StateValue
  : TConfig extends { readonly states: infer TStates }
    ? [keyof TStates] extends [never] ? {}
    :
      | GroupStateKeys<TConfig, keyof TStates>[1]
      | ([GroupStateKeys<TConfig, keyof TStates>[0]] extends [never] ? never
        : TConfig extends { readonly type: "parallel" }
          ? { readonly [K in GroupStateKeys<TConfig, keyof TStates>[0] & keyof TStates]: ToStateValue<TStates[K]> }
        : {
          readonly [K in GroupStateKeys<TConfig, keyof TStates>[0] & keyof TStates]: {
            readonly [StateKey in K]: ToStateValue<TStates[K]>
          }
        }[GroupStateKeys<TConfig, keyof TStates>[0] & keyof TStates])
    : {}

/**
 * The values `snapshot.matches` takes for a state value type (XState `ToTestStateValue`): a
 * state key, or an object of keys to such values, each key optional, as deep as the value
 * goes; nothing for `{}` (a machine without states). The wide `StateValue` takes any value.
 *
 * @example
 * ```ts
 * type Test = ToTestStateValue<"a" | { b: "b1" }>
 * // "a" | "b" | { readonly b?: "b1" }
 * ```
 *
 * @since 0.1.0
 * @category Types
 */
export type ToTestStateValue<TStateValue> = [TStateValue] extends [string] ? TStateValue
  : [StateValueMap] extends [TStateValue] ? [keyof TStateValue] extends [never] ? never : StateValue
  : TStateValue extends string ? TStateValue
  : [keyof TStateValue] extends [never] ? never
  :
    | (keyof TStateValue & string)
    | { readonly [K in keyof TStateValue]?: ToTestStateValue<NonNullable<TStateValue[K]>> }

/**
 * An actor a machine declares in its `types` (XState `ProvidedActor`): the source name, the
 * actor logic and, optionally, the child id.
 *
 * @since 0.1.0
 * @category Types
 */
export interface ProvidedActor {
  readonly src: string
  readonly logic: AnyActorLogic
  readonly id?: string | undefined
}

/** A literal string, `never` for `string` itself and for `undefined`. */
type LiteralString<T> = T extends string ? string extends T ? never : T : never

/** The actors of a union that have no literal id (XState `NonConcreteActors`). */
type NonConcreteActors<TActor extends ProvidedActor> = TActor extends unknown
  ? [LiteralString<TActor["id"]>] extends [never] ? TActor : never
  : never

/**
 * The `children` of a machine snapshot for the actors a machine declares (XState
 * `ToChildren`): each actor with a literal child id under that id, as an optional reference of
 * its logic; when some actor has no literal id, any other key is a reference of one of those
 * actors' logics or `undefined`. Actors whose src is no literal name give the wide
 * `Record<string, AnyActorRef>`.
 *
 * @example
 * ```ts
 * type Children = ToChildren<{ src: "child"; logic: typeof child; id: "first" }>
 * // { readonly first?: ActorRefFromLogic<typeof child> }
 * ```
 *
 * @since 0.1.0
 * @category Types
 */
export type ToChildren<TActor extends ProvidedActor> = string extends TActor["src"] ? Record<string, AnyActorRef>
  : [NonConcreteActors<TActor>] extends [never]
    ? { readonly [A in TActor as LiteralString<A["id"]>]?: ActorRefFromLogic<A["logic"]> }
  :
    & { readonly [A in TActor as LiteralString<A["id"]>]?: ActorRefFromLogic<A["logic"]> }
    & {
      readonly [id: string]:
        | (NonConcreteActors<TActor> extends infer TFree extends ProvidedActor
          ? TFree extends unknown ? ActorRefFromLogic<TFree["logic"]> : never
          : never)
        | undefined
    }

/**
 * A named action, guard or delay a machine declares in its `types` (XState
 * `ParameterizedObject`): the name and, optionally, the type of its params.
 *
 * @since 0.1.0
 * @category Types
 */
export interface ParameterizedObject {
  readonly type: string
  readonly params?: unknown
}

/**
 * The implementations a machine config may name (XState's `TAction`, `TGuard`, `TDelay` and
 * the `src` of `TActor`): each action and each guard with the type of its params, the delay
 * names and the actor names, and the events its `emit` actions may emit (XState `TEmitted`).
 * The interface itself is the wide default: any name with any params and any event object,
 * as a machine from `createMachine` takes. `setup(...).createMachine` and
 * `createStateConfig` take the names of the setup's implementations only, so a config that
 * names an unknown action, guard, delay or actor, or gives wrong params, is a type error; a
 * setup that declares `types.emitted` takes only those events in `emit` and `enqueue.emit`.
 *
 * @example
 * ```ts
 * // the names of setup({ actions: { track: (_, params: { id: number }) => {} }, delays: { soon: 100 } })
 * type Names = {
 *   actions: { type: "track"; params: { id: number } }
 *   guards: never
 *   delays: "soon"
 *   actors: never
 * }
 * ```
 *
 * @since 0.1.0
 * @category Types
 */
export interface ImplementationNames {
  readonly actions: ParameterizedObject
  readonly guards: ParameterizedObject
  readonly delays: string
  readonly actors: string
  /**
   * The logic of each actor name (XState `ProvidedActor['logic']`), which types the events an
   * invocation of that name takes: any logic by default.
   */
  readonly actorLogic: Readonly<Record<string, AnyActorLogic>>
  /**
   * The events an `emit` or `enqueue.emit` written in the config may emit (XState
   * `TEmitted`): any event object by default.
   */
  readonly emitted: AnyEventObject
  /** The tags a state config may set (XState `TTag`): any string by default. */
  readonly tags: string
  /**
   * The actors as XState's `ProvidedActor` union: each src with its logic and the child ids it
   * declares, which the `spawn` of an assigner reads (its ids and input). Any actor by
   * default; the union of the declared actors where `actors` names them.
   */
  readonly providedActor: ProvidedActor
}

/**
 * The names a config of `createMachine` may use (see {@link ImplementationNames}), from what
 * its `types` member declares (XState `MachineConfig<..., TActor, TAction, TGuard, TDelay,
 * TTag, ..., TEmitted>`): the declared actions and guards with their params, the declared
 * delay names, the src of each declared actor with its logic, and the declared emitted
 * events. A kind the `types` member does not declare takes any name, as before.
 *
 * @since 0.1.0
 * @category Types
 */
export interface MachineTypesNames<
  TAction extends ParameterizedObject,
  TGuard extends ParameterizedObject,
  TDelay extends string,
  TActor extends ProvidedActor,
  TEmitted extends EventObject,
  TTag extends string = string
> extends ImplementationNames {
  readonly actions: KnownOr<TAction, ParameterizedObject>
  readonly guards: KnownOr<TGuard, ParameterizedObject>
  readonly delays: KnownOr<TDelay, string>
  readonly actors: KnownOr<TActor, ProvidedActor>["src"]
  readonly actorLogic: {
    readonly [K in KnownOr<TActor, ProvidedActor>["src"]]: Extract<KnownOr<TActor, ProvidedActor>, { readonly src: K }>["logic"]
  }
  readonly emitted: EventObject extends KnownOr<TEmitted, EventObject> ? AnyEventObject : TEmitted
  readonly tags: KnownOr<TTag, string>
  readonly providedActor: KnownOr<TActor, ProvidedActor>
}

/**
 * `T`, or `TDefault` while `T` is `never`: a built-in action written in the config infers its
 * names while `createMachine` still infers the declared ones, which are `never` then, so it
 * takes any name (the declared names check the config once they are inferred).
 */
type KnownOr<T, TDefault> = [T] extends [never] ? TDefault : T

/**
 * The `types` member of a machine configuration given to `createMachine` without `setup`
 * (XState `MachineTypes`). It carries no value: `types: {} as { context: ...; events: ... }`
 * declares the types `createMachine` infers the machine's type parameters from (context,
 * events, input, output, emitted events, state meta and transition meta). The declared
 * actions, guards, delays and actors type the records of the machine's implementations (the
 * second `createMachine` argument and `provide`): their names, the params of each action and
 * guard, the logic of each actor (see {@link DeclaredImplementations}), and the machine config
 * itself (see {@link MachineTypesNames}): its action, guard, delay, actor and tag names.
 * Machine types declare no `children` (XState gives the key the type `never`).
 *
 * @example
 * ```ts
 * createMachine({
 *   types: {} as { context: { readonly count: number }; events: { readonly type: "INC" } },
 *   context: { count: 0 },
 *   initial: "a",
 *   states: { a: { on: { INC: "a" } } }
 * })
 * ```
 *
 * @since 0.1.0
 * @category Types
 */
export interface MachineTypes<
  TContext,
  TEvent extends EventObject,
  TInput,
  TOutput,
  TEmitted extends EventObject,
  TStateMeta,
  TTransitionMeta = TStateMeta,
  TAction extends ParameterizedObject = ParameterizedObject,
  TGuard extends ParameterizedObject = ParameterizedObject,
  TDelay extends string = string,
  TActor extends ProvidedActor = ProvidedActor,
  TTag extends string = string
> {
  readonly context?: TContext
  readonly events?: TEvent
  readonly children?: never
  /** The actors the machine's implementations name: each src with the type of its logic. */
  readonly actors?: TActor
  /** The actions the machine's implementations name, each with the type of its params. */
  readonly actions?: TAction
  /** The guards the machine's implementations name, each with the type of its params. */
  readonly guards?: TGuard
  /** The delays the machine's implementations name. */
  readonly delays?: TDelay
  /** The tags the machine's state configs may set. */
  readonly tags?: TTag
  readonly input?: TInput
  readonly output?: TOutput
  readonly emitted?: TEmitted
  /** The type of each state node's `meta`; also the transition meta type when `transitionMeta` is absent. */
  readonly meta?: TStateMeta
  /** The type of each transition's `meta`. */
  readonly transitionMeta?: TTransitionMeta
}

// ============================================================
// ACTOR OPTIONS
// ============================================================

/**
 * Options for creating an actor (upstream `ActorOptions`, the members the port supports so
 * far).
 *
 * @since 0.1.0
 * @category Types
 */
export interface ActorOptions<TLogic extends AnyActorLogic> {
  /** The actor's id; defaults to its session id. */
  readonly id?: string
  /**
   * The parent actor: the new actor joins the parent's system instead of creating one, and
   * lives in the parent's scope, so the parent's stop, done or error stops it (D12).
   */
  readonly parent?: AnyActorRef
  /**
   * Whether the actor sends each active snapshot it publishes to its parent as
   * `{ type: 'xstate.snapshot.<id>', snapshot }`, from the snapshot it starts with (upstream).
   */
  readonly syncSnapshot?: boolean
  /** The src the actor reports as `actor.src`: the name its parent spawned it by; defaults to the logic. */
  readonly src?: string | AnyActorLogic
  /** The input that the logic's initial snapshot receives. */
  readonly input?: ActorLogic.InputOf<TLogic>
  /** The id under which the system registers the actor. */
  readonly systemId?: string
  /**
   * The clock that sets and clears the timers of delayed events (upstream `clock`): an object
   * with `setTimeout` and `clearTimeout`, or a `SimulatedClock` for tests. A root actor's
   * system starts every delayed event of the system on it; without one they run on the
   * Effect clock. A child joins its parent's system, so its own clock option only sets its
   * `clock` member, as upstream.
   */
  readonly clock?: import("./ActorSystem.js").Clock
  /**
   * An inspection function for the actor's system (upstream `inspect`; a function only,
   * SD-18): an actor without a parent registers it with the system it creates, before it
   * books its session id, so it runs first for every inspection event of that system while
   * the actor's scope is open. An actor with a parent ignores it, as upstream.
   */
  readonly inspect?: (event: InspectionEvent) => Effect.Effect<void>
  /**
   * The function that `log` actions call (upstream `logger`): `(label, value)` for a log with
   * a label, `(value)` without one; the port's log level does not reach it. Any function,
   * whatever arguments it declares (upstream `(...args: any[]) => void`; the method form keeps
   * that without `any`). A root actor's system keeps it, so every child that the root invokes
   * or spawns, at any depth, logs through it unless the child was created with its own
   * (upstream `options?.logger ?? system._logger`). Without one, `log` actions go to Effect
   * logging at their level, with the actor's annotations (C12), where upstream's default is
   * `console.log` (SD-21). A logger that throws gives the actor status `error` (SD-4).
   */
  logger?(...args: ReadonlyArray<unknown>): void
  /**
   * A snapshot to start from instead of the initial snapshot: the logic's
   * `restoreSnapshot` reads it, or it is used as is when the logic has none (upstream
   * `_initState`). No initial action runs for it. A persisted snapshot that holds pending
   * delayed events (`scheduledEvents`) resumes them at `start` (P4).
   */
  readonly snapshot?: unknown
  /**
   * Whether a persisted machine snapshot given as `snapshot` is checked when it is restored
   * (D11, a port option; off by default, as XState checks nothing): status `done` on a state
   * that does not complete the machine gives the actor status `error` with an
   * `InvalidPersistedSnapshotError`. The children that the restore rehydrates are checked
   * too. A live snapshot (from `getSnapshot` or `resolveState`) is never checked.
   */
  readonly validateSnapshot?: boolean
  /**
   * Registers the actor with dev tools when it starts (upstream `devTools`, which upstream
   * types `never` and deprecates in favour of `inspect`; the port types the values its
   * runtime takes, D6): `true` calls `devToolsAdapter` of the dev entry point
   * (`src/dev/index.ts`), a function is called instead of it, and `false` or no option
   * registers nothing. The adapter runs once, in `start`, after the actor publishes the
   * snapshot it starts from and before it processes the events sent before `start`
   * (upstream `attachDevTools` after `update`, before `mailbox.start`). It also runs for an
   * actor that an initial action errors, after the actor ends; it never runs for an actor
   * that is done or errored before `start`, or whose logic's `start` fails (upstream returns
   * first). What it fails or dies with leaves `start` as a defect, as upstream's throw leaves
   * `start`, and the actor then processes no event. A child that the actor invokes or spawns
   * does not inherit it, as upstream.
   */
  readonly devTools?: boolean | DevToolsAdapter
}

/**
 * A dev tools adapter (upstream `DevToolsAdapter`): the function that the `devTools` actor
 * option calls with each actor that starts. It returns an Effect, as the `inspect` option's
 * function does (D6, SD-18); what it fails or dies with makes the actor's `start` die.
 *
 * @example
 * ```ts
 * const adapter: DevToolsAdapter = (service) => Effect.log(`started ${service.id}`)
 * ```
 *
 * @since 0.1.0
 * @category Types
 */
export type DevToolsAdapter = (service: AnyActor) => Effect.Effect<void, unknown>

/**
 * The option keys `createActor` requires for a logic (XState `RequiredActorOptionsKeys`):
 * `"input"` when the logic's input type does not take `undefined`, none otherwise.
 *
 * @example
 * ```ts
 * type Required = RequiredActorOptionsKeys<PromiseActorLogic<number, { id: string }>> // "input"
 * type None = RequiredActorOptionsKeys<PromiseActorLogic<number, { id: string } | undefined>> // never
 * ```
 *
 * @since 0.1.0
 * @category Types
 */
export type RequiredActorOptionsKeys<TLogic extends AnyActorLogic> = undefined extends ActorLogic.InputOf<TLogic>
  ? never
  : "input"

/**
 * The options argument of `createActor`, as a rest tuple (XState `ConditionalRequired`):
 * optional while the logic requires no option key, required with each key of
 * {@link RequiredActorOptionsKeys} otherwise, so a logic that declares an input takes no
 * actor without it.
 *
 * @since 0.1.0
 * @category Types
 */
export type ActorOptionsArgs<TLogic extends AnyActorLogic> = [RequiredActorOptionsKeys<TLogic>] extends [never]
  ? [options?: ActorOptions<TLogic>]
  : [options: ActorOptions<TLogic> & { readonly [K in RequiredActorOptionsKeys<TLogic>]: unknown }]

// ============================================================
// INSPECTION TYPES
// ============================================================

/**
 * Every inspection event (upstream `InspectionEvent`); the members are in the `inspection`
 * module.
 *
 * @since 0.1.0
 * @category Types
 */
export type InspectionEvent = Inspection.InspectionEvent

// ============================================================
// UPSTREAM TYPE NAMES (EXP-1)
// ============================================================

// The type names `src/types.ts` of xstate@5.33.2 exports from the root that had no port
// counterpart: each is upstream's type on the port's own types. Where upstream lists the
// actor, action, guard, delay and emitted types one by one, the port's types read them as
// one `MachineTypesNames`; a parameter the port's type does not carry (an action's params,
// most often) stays in the list, so a type written with upstream's arguments compiles.

/**
 * The params of a parameterized object, `undefined` where it has none (upstream
 * `GetParameterizedParams`).
 *
 * @since 0.1.0
 * @category Types
 */
export type GetParameterizedParams<T extends ParameterizedObject | undefined> = T extends unknown
  ? ("params" extends keyof T ? T["params"] : undefined)
  : never

/**
 * The names of the parameterized objects of a union whose params may be `undefined`
 * (upstream `NoRequiredParams`): the ones a config may name alone.
 *
 * @since 0.1.0
 * @category Types
 */
export type NoRequiredParams<T extends ParameterizedObject> = T extends unknown
  ? undefined extends T["params"] ? T["type"]
  : never
  : never

/**
 * A use of a parameterized object whose params are given as a value or as a function of
 * the context and the event (upstream `WithDynamicParams`); required where its params may
 * not be `undefined`.
 *
 * @since 0.1.0
 * @category Types
 */
export type WithDynamicParams<TContext, TExpressionEvent extends EventObject, T extends ParameterizedObject> = T extends
  unknown ? ConditionalRequired<
    {
      type: T["type"]
      params?: T["params"] | ((args: { context: TContext; event: TExpressionEvent }) => T["params"])
    },
    undefined extends T["params"] ? false : true
  >
  : never

/**
 * Any action of any machine (upstream `UnknownAction`).
 *
 * @since 0.1.0
 * @category Types
 */
export type UnknownAction = Action<MachineContext, EventObject>

/**
 * One action or a list of them, as a config writes them (upstream `Actions`).
 *
 * @since 0.1.0
 * @category Types
 */
export type Actions<
  TContext,
  TExpressionEvent extends EventObject,
  TEvent extends EventObject,
  _TParams,
  TActor extends ProvidedActor,
  TAction extends ParameterizedObject,
  TGuard extends ParameterizedObject,
  TDelay extends string,
  TEmitted extends EventObject
> = SingleOrArray<Action<TContext, TExpressionEvent, MachineTypesNames<TAction, TGuard, TDelay, TActor, TEmitted>, TEvent>>

/**
 * The action implementations by action name, each a function of the params of its
 * declared action (upstream `ActionFunctionMap`).
 *
 * @since 0.1.0
 * @category Types
 */
export type ActionFunctionMap<
  TContext,
  TEvent extends EventObject,
  _TActor extends ProvidedActor,
  TAction extends ParameterizedObject = ParameterizedObject,
  _TGuard extends ParameterizedObject = ParameterizedObject,
  _TDelay extends string = string,
  _TEmitted extends EventObject = EventObject
> = {
  [K in TAction["type"]]?: ActionFunction<TContext, TEvent, GetParameterizedParams<TAction extends { type: K } ? TAction : never>>
}

/**
 * The transition config of any machine (upstream `AnyTransitionConfig`).
 *
 * @since 0.1.0
 * @category Types
 */
export type AnyTransitionConfig = TransitionConfig<UpstreamAny, UpstreamAny, UpstreamAny>

/**
 * The transition definition of any machine (upstream `AnyTransitionDefinition`).
 *
 * @since 0.1.0
 * @category Types
 */
export type AnyTransitionDefinition = TransitionDefinition<UpstreamAny, UpstreamAny, UpstreamAny>

/**
 * The invoke config of any machine (upstream `AnyInvokeConfig`).
 *
 * @since 0.1.0
 * @category Types
 */
export type AnyInvokeConfig = InvokeConfig<UpstreamAny, UpstreamAny, UpstreamAny>

/**
 * The state node config of any machine (upstream `AnyStateNodeConfig`).
 *
 * @since 0.1.0
 * @category Types
 */
export type AnyStateNodeConfig = StateNodeConfig<UpstreamAny, UpstreamAny, UpstreamAny, UpstreamAny>

/**
 * The config of an atomic state node: no initial state, no child states, no done
 * transition (upstream `AtomicStateNodeConfig`).
 *
 * @since 0.1.0
 * @category Types
 */
export interface AtomicStateNodeConfig<TContext, TEvent extends EventObject>
  extends StateNodeConfig<TContext, TEvent, UpstreamAny, UpstreamAny>
{
  readonly initial?: undefined
  readonly parallel?: false | undefined
  readonly states?: undefined
  readonly onDone?: undefined
}

/**
 * The config of a history state node (upstream `HistoryStateNodeConfig`).
 *
 * @since 0.1.0
 * @category Types
 */
export interface HistoryStateNodeConfig<TContext, TEvent extends EventObject>
  extends AtomicStateNodeConfig<TContext, TEvent>
{
  readonly history: "shallow" | "deep" | true
  readonly target: string | undefined
}

/**
 * The config of an atomic state node or of any state node (upstream
 * `SimpleOrStateNodeConfig`).
 *
 * @since 0.1.0
 * @category Types
 */
export type SimpleOrStateNodeConfig<TContext, TEvent extends EventObject> =
  | AtomicStateNodeConfig<TContext, TEvent>
  | StateNodeConfig<TContext, TEvent, UpstreamAny, UpstreamAny>

/**
 * The child state configs by key (upstream `StatesConfig`).
 *
 * @since 0.1.0
 * @category Types
 */
export type StatesConfig<
  TContext,
  TEvent extends EventObject,
  TActor extends ProvidedActor,
  TAction extends ParameterizedObject,
  TGuard extends ParameterizedObject,
  TDelay extends string,
  TTag extends string,
  _TOutput,
  TEmitted extends EventObject,
  TStateMeta extends MetaObject,
  TTransitionMeta extends MetaObject = TStateMeta
> = {
  [K in string]: StateNodeConfig<
    TContext,
    TEvent,
    TStateMeta,
    TTransitionMeta,
    MachineTypesNames<TAction, TGuard, TDelay, TActor, TEmitted, TTag>
  >
}

/**
 * The state nodes by key (upstream `StateNodesConfig`).
 *
 * @since 0.1.0
 * @category Types
 */
export type StateNodesConfig<
  TContext,
  TEvent extends EventObject,
  TStateMeta extends MetaObject = MetaObject,
  TTransitionMeta extends MetaObject = TStateMeta
> = {
  [K in string]: StateNode<TContext, TEvent, TStateMeta, TTransitionMeta>
}

/**
 * The kinds of state node, and any other string (upstream `StateTypes`).
 *
 * @since 0.1.0
 * @category Types
 */
export type StateTypes = StateNodeType | (string & NonNullable<unknown>)

/**
 * A transition target as a config writes it (upstream `TransitionConfigTarget`).
 *
 * @since 0.1.0
 * @category Types
 */
export type TransitionConfigTarget = string | undefined

/**
 * A transition as a config writes it: a target, a transition config, or a list of them
 * (upstream `TransitionConfigOrTarget`).
 *
 * @since 0.1.0
 * @category Types
 */
export type TransitionConfigOrTarget<
  TContext,
  TExpressionEvent extends EventObject,
  TEvent extends EventObject,
  TActor extends ProvidedActor,
  TAction extends ParameterizedObject,
  TGuard extends ParameterizedObject,
  TDelay extends string,
  TEmitted extends EventObject,
  TTransitionMeta extends MetaObject
> = SingleOrArray<
  | TransitionConfigTarget
  | TransitionConfig<
    TContext,
    TExpressionEvent,
    TTransitionMeta,
    MachineTypesNames<TAction, TGuard, TDelay, TActor, TEmitted>,
    TEvent
  >
>

/**
 * The delayed transitions of a state node config, its `after` (upstream
 * `DelayedTransitions`).
 *
 * @since 0.1.0
 * @category Types
 */
export type DelayedTransitions<
  TContext,
  TEvent extends EventObject,
  TActor extends ProvidedActor,
  TAction extends ParameterizedObject,
  TGuard extends ParameterizedObject,
  TDelay extends string,
  TEmitted extends EventObject = EventObject,
  TTransitionMeta extends MetaObject = MetaObject
> = DelayedTransitionsConfig<TContext, TEvent, TTransitionMeta, MachineTypesNames<TAction, TGuard, TDelay, TActor, TEmitted>>

/**
 * The transition definitions by event descriptor (upstream `TransitionDefinitionMap`); the
 * port's lists are readonly.
 *
 * @since 0.1.0
 * @category Types
 */
export type TransitionDefinitionMap<TContext, TEvent extends EventObject, TTransitionMeta extends MetaObject = MetaObject> = {
  [K in EventDescriptor<TEvent>]: ReadonlyArray<TransitionDefinition<TContext, ExtractEvent<TEvent, K>, TTransitionMeta>>
}

/**
 * The definition of a state node, `node.definition` (upstream `StateNodeDefinition`).
 *
 * @since 0.1.0
 * @category Types
 */
export type StateNodeDefinition<TContext, TEvent extends EventObject, TStateMeta = MetaObject, TTransitionMeta = TStateMeta> =
  StateNode.Definition<TContext, TEvent, TStateMeta, TTransitionMeta>

/**
 * The definition of a machine, its root's: `machine.definition` (upstream
 * `StateMachineDefinition`).
 *
 * @since 0.1.0
 * @category Types
 */
export type StateMachineDefinition<TContext, TEvent extends EventObject, TStateMeta = MetaObject, TTransitionMeta = TStateMeta> =
  StateNodeDefinition<TContext, TEvent, TStateMeta, TTransitionMeta>

/**
 * The child state definitions by key (upstream `StatesDefinition`).
 *
 * @since 0.1.0
 * @category Types
 */
export type StatesDefinition<TContext, TEvent extends EventObject, TStateMeta = MetaObject, TTransitionMeta = TStateMeta> = {
  [K in string]: StateNodeDefinition<TContext, TEvent, TStateMeta, TTransitionMeta>
}

/**
 * The machine config of any machine (upstream `UnknownMachineConfig`).
 *
 * @since 0.1.0
 * @category Types
 */
export type UnknownMachineConfig = MachineConfig<MachineContext, EventObject>

/**
 * A delay given as a function of the action arguments and the params (upstream
 * `DelayExpr`).
 *
 * @since 0.1.0
 * @category Types
 */
export type DelayExpr<TContext, TExpressionEvent extends EventObject, TParams, TEvent extends EventObject> = (
  args: ActionArgs<TContext, TExpressionEvent, TEvent>,
  params: TParams
) => number

/**
 * The delays of a machine's implementations by name (upstream `DelayFunctionMap`).
 *
 * @since 0.1.0
 * @category Types
 */
export type DelayFunctionMap<TContext, TEvent extends EventObject, _TAction extends ParameterizedObject> = Record<
  string,
  DelayConfig<TContext, TEvent>
>

/**
 * A log value given as a function of the action arguments and the params (upstream
 * `LogExpr`).
 *
 * @since 0.1.0
 * @category Types
 */
export type LogExpr<TContext, TExpressionEvent extends EventObject, TParams, TEvent extends EventObject> = (
  args: ActionArgs<TContext, TExpressionEvent, TEvent>,
  params: TParams
) => unknown

/**
 * An event given as a function of the action arguments and the params (upstream
 * `SendExpr`).
 *
 * @since 0.1.0
 * @category Types
 */
export type SendExpr<
  TContext,
  TExpressionEvent extends EventObject,
  TParams,
  TSentEvent extends EventObject,
  TEvent extends EventObject
> = (args: ActionArgs<TContext, TExpressionEvent, TEvent>, params: TParams) => TSentEvent

/**
 * A function of the context, the event and `self` (upstream `Mapper`), as an invocation's
 * or a spawn's `input` takes.
 *
 * @since 0.1.0
 * @category Types
 */
export type Mapper<TContext, TExpressionEvent extends EventObject, TResult, TEvent extends EventObject> = (
  args: Pick<ActionArgs<TContext, TExpressionEvent, TEvent>, "context" | "event" | "self">
) => TResult

/**
 * The options of `raise` (upstream `RaiseActionOptions`): the port's `RaiseOptions`.
 *
 * @since 0.1.0
 * @category Types
 */
export type RaiseActionOptions<
  TContext,
  TExpressionEvent extends EventObject,
  _TParams,
  _TEvent extends EventObject,
  TDelay extends string
> = RaiseOptions<TContext, TExpressionEvent, TDelay>

/**
 * The options of `raise` with the event to raise (upstream `RaiseActionParams`).
 *
 * @since 0.1.0
 * @category Types
 */
export interface RaiseActionParams<
  TContext,
  TExpressionEvent extends EventObject,
  TParams,
  TEvent extends EventObject,
  TDelay extends string
> extends RaiseOptions<TContext, TExpressionEvent, TDelay> {
  readonly event: TEvent | SendExpr<TContext, TExpressionEvent, TParams, TEvent, TEvent>
}

/**
 * The options of `sendTo` (upstream `SendToActionOptions`): the port's `SendToOptions`.
 *
 * @since 0.1.0
 * @category Types
 */
export type SendToActionOptions<
  TContext,
  TExpressionEvent extends EventObject,
  _TParams,
  TEvent extends EventObject,
  TDelay extends string
> = SendToOptions<TContext, TExpressionEvent, TDelay, TEvent>

/**
 * The options of `sendTo` with the event to send (upstream `SendToActionParams`).
 *
 * @since 0.1.0
 * @category Types
 */
export interface SendToActionParams<
  TContext,
  TExpressionEvent extends EventObject,
  TParams,
  TSentEvent extends EventObject,
  TEvent extends EventObject,
  TDelay extends string
> extends SendToOptions<TContext, TExpressionEvent, TDelay, TEvent> {
  readonly event: TSentEvent | SendExpr<TContext, TExpressionEvent, TParams, TSentEvent, TEvent>
}

/**
 * The types a machine declares, as one record (upstream `StateMachineTypes`).
 *
 * @since 0.1.0
 * @category Types
 */
export interface StateMachineTypes {
  readonly context: MachineContext
  readonly events: EventObject
  readonly actors: ProvidedActor
  readonly actions: ParameterizedObject
  readonly guards: ParameterizedObject
  readonly delays: string
  readonly tags: string
  readonly emitted: EventObject
}

/**
 * The types a machine declares, from its type parameters (upstream
 * `ResolvedStateMachineTypes`).
 *
 * @since 0.1.0
 * @category Types
 */
export interface ResolvedStateMachineTypes<
  TContext extends MachineContext,
  TEvent extends EventObject,
  TActor extends ProvidedActor,
  TAction extends ParameterizedObject,
  TGuard extends ParameterizedObject,
  TDelay extends string,
  TTag extends string,
  TEmitted extends EventObject = EventObject
> extends StateMachineTypes {
  readonly context: TContext
  readonly events: TEvent
  readonly actors: TActor
  readonly actions: TAction
  readonly guards: TGuard
  readonly delays: TDelay
  readonly tags: TTag
  readonly emitted: TEmitted
}

/**
 * The implementations a machine of these types takes (upstream
 * `InternalMachineImplementations`): the {@link DeclaredImplementations} of the record's
 * types.
 *
 * @since 0.1.0
 * @category Types
 */
export type InternalMachineImplementations<TTypes extends StateMachineTypes> = DeclaredImplementations<
  TTypes["context"],
  TTypes["events"],
  TTypes["actions"],
  TTypes["guards"],
  TTypes["delays"],
  TTypes["actors"]
>

/**
 * The implementations of a machine, each record of any name (upstream
 * `MachineImplementationsSimplified`).
 *
 * @since 0.1.0
 * @category Types
 */
export type MachineImplementationsSimplified<
  TContext,
  TEvent extends EventObject,
  _TActor extends ProvidedActor = ProvidedActor,
  _TAction extends ParameterizedObject = ParameterizedObject,
  _TGuard extends ParameterizedObject = ParameterizedObject
> = Required<MachineImplementations<TContext, TEvent>>

/**
 * A snapshot of any machine (upstream `AnyState`, its alias of `AnyMachineSnapshot`).
 *
 * @since 0.1.0
 * @category Types
 */
export type AnyState = AnyMachineSnapshot

/**
 * A state key, or a machine snapshot (upstream `StateKey`).
 *
 * @since 0.1.0
 * @category Types
 */
export type StateKey = string | AnyMachineSnapshot

/**
 * What a state holds: its value, context and event (upstream `StateLike`).
 *
 * @since 0.1.0
 * @category Types
 */
export interface StateLike<TContext extends MachineContext> {
  readonly value: StateValue
  readonly context: TContext
  readonly event: EventObject
}

/**
 * The snapshot type of a machine, or of the machine a function returns (upstream
 * `StateFrom`).
 *
 * @since 0.1.0
 * @category Typed Context
 */
export type StateFrom<T extends AnyStateMachine | ((...args: never) => AnyStateMachine)> = T extends AnyStateMachine
  ? SnapshotFrom<T>
  : T extends (...args: never) => infer TMachine ? SnapshotFrom<TMachine>
  : never

/**
 * The state schema of a machine (upstream `StateSchemaFrom`).
 *
 * @since 0.1.0
 * @category Typed Context
 */
export type StateSchemaFrom<T extends AnyStateMachine> = T extends StateMachine<
  infer _Id,
  infer _TContext,
  infer _TEvent,
  infer _TInput,
  infer _TOutput,
  infer _TEmitted,
  infer _R,
  infer _TStateMeta,
  infer _TTransitionMeta,
  infer TStateSchema,
  infer _TProvided,
  infer _TStateValue,
  infer _TChildren,
  infer _TTag
> ? TStateSchema
  : never

/**
 * The actor logic of a machine or a promise, or of what a function returns (upstream
 * `ActorLogicFrom`).
 *
 * @since 0.1.0
 * @category Typed Context
 */
export type ActorLogicFrom<T> = (T extends (...args: never) => infer TReturn ? TReturn : T) extends infer TValue
  ? TValue extends AnyStateMachine ? TValue
  : TValue extends Promise<infer U> ? PromiseActorLogic<U>
  : never
  : never

/**
 * The events an actor logic takes (upstream `EventFromLogic`).
 *
 * @since 0.1.0
 * @category Typed Context
 */
export type EventFromLogic<TLogic extends AnyActorLogic> = ActorLogic.EventOf<TLogic>

/**
 * The `createActor` option a logic requires: `"input"` when its input may not be
 * `undefined` (upstream `RequiredLogicInput`), as {@link RequiredActorOptionsKeys}.
 *
 * @since 0.1.0
 * @category Types
 */
export type RequiredLogicInput<TLogic extends AnyActorLogic> = RequiredActorOptionsKeys<TLogic>

/**
 * The spawn options a provided actor requires: `"id"` when it declares one, `"input"` when
 * its logic's input may not be `undefined` (upstream `RequiredActorOptions`).
 *
 * @since 0.1.0
 * @category Types
 */
export type RequiredActorOptions<TActor extends ProvidedActor> =
  | (undefined extends TActor["id"] ? never : "id")
  | RequiredActorOptionsKeys<TActor["logic"]>

/**
 * Any actor logic (upstream `UnknownActorLogic`).
 *
 * @since 0.1.0
 * @category Types
 */
export type UnknownActorLogic = ActorLogic<UpstreamAny, UpstreamAny, UpstreamAny, UpstreamAny>

/**
 * The scope any actor logic runs in (upstream `AnyActorScope`): the port's
 * `ActorScopeService`.
 *
 * @since 0.1.0
 * @category Types
 */
export type AnyActorScope = ActorScopeService

/**
 * What an action, a guard or a mapper receives: the context, the event, `self` and the
 * system (upstream `UnifiedArg`), as the port's {@link ActionArgs}.
 *
 * @since 0.1.0
 * @category Types
 */
export type UnifiedArg<TContext, TExpressionEvent extends EventObject, TEvent extends EventObject> = ActionArgs<
  TContext,
  TExpressionEvent,
  TEvent
>

/**
 * Something events can be sent to (upstream `BaseActorRef`); the port's `send` returns an
 * Effect (D6).
 *
 * @since 0.1.0
 * @category Types
 */
export interface BaseActorRef<TEvent extends EventObject> {
  readonly send: (event: TEvent) => Effect.Effect<void>
}

/**
 * Something events can be sent to and whose values can be observed (upstream
 * `ActorLike`); the port's `send` and `subscribe` return Effects, and a subscription ends
 * with its `Scope` (D6).
 *
 * @since 0.1.0
 * @category Types
 */
export interface ActorLike<TCurrent, TEvent extends EventObject> extends BaseActorRef<TEvent> {
  readonly subscribe: (observer: (value: TCurrent) => Effect.Effect<void>) => Effect.Effect<void, never, Scope.Scope>
}

/**
 * The members of an actor reference that a reference from a persisted or inspected actor
 * holds: its session id, `send` and `getSnapshot` (upstream `ActorRefLike`).
 *
 * @since 0.1.0
 * @category Types
 */
export type ActorRefLike = Pick<AnyActorRef, "sessionId" | "send" | "getSnapshot">

/**
 * A source of values with an observer-object `subscribe` (upstream
 * `InteropSubscribable`): the port's `Subscribable`, which `fromObservable` takes.
 *
 * @since 0.1.0
 * @category Types
 */
export type InteropSubscribable<T> = Subscribable<T>

/**
 * The function that runs an action's execution (upstream `ActionExecutor`); the port's
 * returns an Effect (D6).
 *
 * @since 0.1.0
 * @category Types
 */
export type ActionExecutor = (actionToExecute: CustomActionExecution) => Effect.Effect<void>

/**
 * What a built-in action resolves to: the snapshot, the params and the actions it adds
 * (upstream `BuiltinActionResolution`).
 *
 * @since 0.1.0
 * @category Types
 */
export type BuiltinActionResolution = readonly [
  AnyMachineSnapshot,
  NonReducibleUnknown,
  ReadonlyArray<UnknownAction> | undefined
]
