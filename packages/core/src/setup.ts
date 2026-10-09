/**
 * @since 0.1.0
 * @module setup
 *
 * The setup API for creating type-safe state machines.
 */
import { Effect, Option, Schema } from "effect"
import type { EventObject, ExtractEvent } from "./Event.js"
import type { AnyEventObject } from "./internal/anyEventObject.js"
import type { StateMachine } from "./StateMachine.js"
import * as SM from "./StateMachine.js"
import type { ActorLogic, AnyActorLogic } from "./ActorLogic.js"
import type { ActorRef, ActorRefBase, AnyActorRef } from "./ActorRef.js"
import type { StateValue } from "./StateValue.js"
import type { Cast, NonReducibleUnknown } from "./typeUtils.js"
import { assign, type Assignment } from "./actions/assign.js"
import { cancel, type CancelId } from "./actions/cancel.js"
import { emit, type EmitEvent } from "./actions/emit.js"
import { enqueueActions, type CollectActions, type EnqueueActionsDefinition } from "./actions/enqueueActions.js"
import { log, type LogMessage, type LogOptions } from "./actions/log.js"
import { raise, type RaiseEvent, type RaiseOptions } from "./actions/raise.js"
import { sendTo, type SendToOptions, type SendToTarget, type SendToTargetEvent } from "./actions/sendTo.js"
import { spawnChild, type SpawnChildArguments, type UntypedSpawnChildOptions } from "./actions/spawnChild.js"
import { stopChild, type StopChildTarget } from "./actions/stopChild.js"
import type {
  MachineConfig,
  MachineConfigMembers,
  MachineImplementations,
  RouteEventOf,
  StateKeysConfig,
  StateNodeConfig,
  StateSchema,
  StateSchemaOfKeys,
  ToChildren,
  ToStateSchema,
  ToStateValue,
  ActionDefinition,
  AssignDefinitionParams,
  ActionFunction,
  ActionContext,
  ActionResult,
  DelayConfig,
  GuardDefinition,
  GuardContext,
  GuardImplementation,
  ImplementationNames,
  NamedActionImplementation,
  NamedGuardImplementation,
  ParameterizedObject,
  SnapshotFrom,
} from "./Types.js"

// ============================================================
// SETUP TYPES
// ============================================================

/**
 * Type constraints for setup.
 *
 * @since 0.1.0
 * @category Setup
 */
export interface SetupTypes<
  TContext,
  TEvent extends EventObject,
  TActors extends Record<string, AnyActorLogic> = Record<string, AnyActorLogic>,
  TActions extends Record<string, SetupActionImplementation<TContext, TEvent>> = Record<string, SetupActionImplementation<TContext, TEvent>>,
  TGuards extends Record<string, GuardImplementation<TContext, TEvent>> = Record<string, GuardImplementation<TContext, TEvent>>,
  TDelays extends Record<string, DelayConfig<TContext, TEvent>> = Record<string, DelayConfig<TContext, TEvent>>
> {
  readonly context: TContext
  readonly events: TEvent
  readonly actors: TActors
  readonly actions: TActions
  readonly guards: TGuards
  readonly delays: TDelays
}

/**
 * Configuration for setup. `types` declares the types only (its values are not read):
 * `context`, `events`, the machine `input`, the `emitted` events, the `children` ids of the
 * setup's actors, the state meta type `meta` and the transition meta type `transitionMeta`
 * (XState 5.33), which defaults to `meta`, and the `tags` its snapshots' `hasTag` takes.
 *
 * @since 0.1.0
 * @category Setup
 */
export interface SetupConfig<
  TContext,
  TEvent extends EventObject,
  TActors extends Record<string, AnyActorLogic>,
  TActions extends Record<string, SetupActionImplementation<TContext, TEvent>>,
  TGuards extends Record<string, GuardImplementation<TContext, TEvent>>,
  TDelays extends Record<string, DelayConfig<TContext, TEvent>>,
  TStateMeta = unknown,
  TTransitionMeta = TStateMeta,
  TInput = NonReducibleUnknown,
  TEmitted extends EventObject = EventObject,
  TChildrenMap extends Record<string, string> = Record<never, never>,
  TTag extends string = string
> {
  readonly types?: {
    readonly context?: TContext
    readonly events?: TEvent
    /**
     * The input each machine of this setup takes (XState `types.input`): what its context
     * factory gets. Without it, the input type is upstream's default, `NonReducibleUnknown`.
     */
    readonly input?: TInput
    /**
     * The events each machine of this setup emits (XState `types.emitted`): `emit` and
     * `enqueue.emit` in its config take only these, and its actors' `on` listeners get them.
     */
    readonly emitted?: TEmitted
    /**
     * The child ids of the setup's actors (XState `types.children`): each child id with the
     * name of the actor it runs. The snapshots of the setup's machines type the child under
     * that id by the actor's logic, and `actors` must give every named actor.
     */
    readonly children?: TChildrenMap
    /** The type of each state node's `meta`; also the transition meta type when `transitionMeta` is absent. */
    readonly meta?: TStateMeta
    /** The type of each transition's `meta`. */
    readonly transitionMeta?: TTransitionMeta
    /** The tags of each machine of this setup (XState `types.tags`): what its snapshots' `hasTag` takes. */
    readonly tags?: TTag
  }
  readonly actors?: TActors
  readonly actions?: TActions
  /**
   * The setup's guards by name. A built-in guard here (`not`, `and`, `or`) names only guards
   * of this record, with their params (see {@link SetupGuardChecks}).
   */
  readonly guards?: TGuards & SetupGuardChecks<TGuards>
  /**
   * The delays a name resolves to in `raise`, `sendTo` and an `after` key (XState
   * `DelayConfig`): milliseconds, a `Duration`, or a function of the action arguments and the
   * params of the use that gives either.
   */
  readonly delays?: TDelays
  /** Schemas each machine of this setup carries as given (XState `setup({ schemas })`, `machine.schemas`). */
  readonly schemas?: unknown
}

/**
 * The config `setup(...).createMachine` checks a machine config against: the setup's machine
 * config, with the names of the setup's implementations (`TNames`), and the state keys it
 * infers the state schema from (`StateKeysConfig`).
 *
 * @since 0.1.0
 * @category Setup
 */
export type SetupMachineConfig<
  TContext,
  TEvent extends EventObject,
  TInput,
  TOutput,
  TStateMeta,
  TTransitionMeta,
  TStateKeys,
  TNames extends ImplementationNames = ImplementationNames
> =
  & MachineConfig<TContext, TEvent, TInput, TOutput, TStateMeta, TTransitionMeta, TNames>
  & StateKeysConfig<TStateKeys, StateNodeConfig<TContext, TEvent, NoInfer<TStateMeta>, NoInfer<TTransitionMeta>, TNames>>

/**
 * The members of a machine config other than `context` (`MachineConfigMembers`), with the
 * setup's types: what `setup(...).createMachine` checks the config as written against before
 * it reads the routable states from it. `context` stays out, so the context factory keeps
 * one contextual signature.
 *
 * @since 0.1.0
 * @category Setup
 */
export type SetupConfigMembers<
  TContext,
  TEvent extends EventObject,
  TStateMeta,
  TTransitionMeta,
  TNames extends ImplementationNames = ImplementationNames
> = MachineConfigMembers<
  TContext,
  TEvent,
  NoInfer<TStateMeta>,
  NoInfer<TTransitionMeta>,
  TNames
>

/**
 * The machine `setup(...).createMachine` returns: the setup's types, the route event of the
 * config's routable states (`RouteEventOf<TConfig>`, XState) beside the setup's events, the
 * state schema of the config as written (its state keys and ids, XState `ToStateSchema`), the
 * state value of the config (XState `ToStateValue`), the children its snapshots hold
 * (`TChildren`, see {@link SetupChildren}), and what its `provide` takes (`TProvided`, see
 * {@link SetupProvideImplementations}). A config typed as a whole (explicit type arguments)
 * gives the schema of its state keys and the wide `StateValue`.
 *
 * @since 0.1.0
 * @category Setup
 */
export type SetupMachine<
  TContext,
  TEvent extends EventObject,
  TInput,
  TOutput,
  TEmitted extends EventObject,
  TStateMeta,
  TTransitionMeta,
  TStateKeys,
  TConfig,
  TProvided = MachineImplementations<TContext, TEvent>,
  TChildren extends Record<string, unknown> = Record<string, AnyActorRef>,
  TTag extends string = string
> = StateMachine<
  string,
  TContext,
  TEvent | RouteEventOf<TConfig>,
  TInput,
  TOutput,
  TEmitted,
  never,
  TStateMeta,
  TTransitionMeta,
  SetupStateSchema<TConfig, TStateKeys>,
  TProvided,
  Cast<ToStateValue<TConfig>, StateValue>,
  TChildren,
  TTag
>

/**
 * The state schema of a setup machine: the schema of the config as written (with the node
 * ids, XState `ToStateSchema<TConfig>`), or of the inferred state keys when the config is
 * typed as a whole.
 */
type SetupStateSchema<TConfig, TStateKeys> = TConfig extends { readonly states?: infer TStates }
  ? string extends keyof NonNullable<TStates> ? StateSchemaOfKeys<TStateKeys> : Cast<ToStateSchema<TConfig>, StateSchema>
  : Cast<ToStateSchema<TConfig>, StateSchema>

/**
 * The `createMachine` of a setup: it takes the machine config as written (`TConfig`) and
 * gives a {@link SetupMachine} whose `provide` takes `TProvided`. The machine's input type is
 * the setup's `types.input` (`TSetupInput`), as upstream fixes it: the context factory gets
 * that input, and an annotated factory does not change it. Its emitted events are the setup's
 * `types.emitted` (`TSetupEmitted`).
 * See `SetupReturn.createMachine`.
 *
 * @since 0.1.0
 * @category Setup
 */
export type SetupCreateMachine<
  TContext,
  TEvent extends EventObject,
  TStateMeta,
  TTransitionMeta,
  TNames extends ImplementationNames = ImplementationNames,
  TProvided = MachineImplementations<TContext, TEvent>,
  TSetupInput = NonReducibleUnknown,
  TSetupEmitted extends EventObject = EventObject,
  TChildrenMap extends Record<string, string> = Record<never, never>,
  TTag extends string = string
> = <
  TOutput = unknown,
  TEmitted extends EventObject = TSetupEmitted,
  TStateKeys = Readonly<Record<string, unknown>>,
  const TConfig extends SetupConfigMembers<TContext, TEvent, TStateMeta, TTransitionMeta, TNames> =
    SetupConfigMembers<TContext, TEvent, TStateMeta, TTransitionMeta, TNames>
>(
  config: SetupMachineConfig<TContext, TEvent, TSetupInput, TOutput, TStateMeta, TTransitionMeta, TStateKeys, TNames> & TConfig
) => SetupMachine<
  TContext,
  TEvent,
  TSetupInput,
  TOutput,
  TEmitted,
  TStateMeta,
  TTransitionMeta,
  TStateKeys,
  TConfig,
  TProvided,
  SetupChildren<TChildrenMap, TNames["actorLogic"], TConfig>,
  TTag
>

/**
 * The `children` of a setup machine's snapshots (XState `ToChildren` of the setup's actors):
 * the actors with the child ids of `types.children`, or, without it, of the ids the config's
 * root `invoke` gives its named actors; any other id is a reference of an actor without a
 * literal id, or `undefined`. A setup without actors gives the wide `Record<string, AnyActorRef>`.
 *
 * @since 0.1.0
 * @category Setup
 */
export type SetupChildren<TChildrenMap, TActors, TConfig> = Cast<
  ToChildren<ToProvidedActor<MergeChildrenMap<TChildrenMap, ConfigChildren<TConfig>>, TActors>>,
  Record<string, unknown>
>

/**
 * The actors a setup provides (XState `ToProvidedActor`): each actor name with its logic and
 * the child id the children map gives it (any id when the map names none for it).
 *
 * @since 0.1.0
 * @category Setup
 */
export type ToProvidedActor<TChildrenMap, TActors> = {
  readonly [K in keyof TActors & string]: {
    readonly src: K
    readonly logic: Cast<TActors[K], AnyActorLogic>
    readonly id: [keyof TChildrenMap] extends [never] ? string | undefined
      : K extends TChildrenMap[keyof TChildrenMap] ? ChildIdOf<TChildrenMap, K>
      : string | undefined
  }
}[keyof TActors & string]

/** The child ids a children map gives the actor `TSrc` (XState `Invert`). */
type ChildIdOf<TChildrenMap, TSrc> = { readonly [K in keyof TChildrenMap]: TChildrenMap[K] extends TSrc ? K : never }[keyof TChildrenMap] & string

/** The declared children map, or the inferred one when none is declared (XState `MergeChildrenMap`). */
type MergeChildrenMap<TExplicit, TInferred> = [keyof TExplicit] extends [never] ? TInferred : TExplicit

/** The `{ [id]: src }` of the root `invoke` entries of a config with a literal id and src (XState `ExtractConfigChildren`). */
type ConfigChildren<TConfig> = TConfig extends { readonly invoke: infer TInvoke }
  ? TInvoke extends ReadonlyArray<infer TEntry> ? UnionToIntersection<InvokeChild<TEntry>> : InvokeChild<TInvoke>
  : Record<never, never>

/** The `{ [id]: src }` of one invoke entry with a literal id and src. */
type InvokeChild<TEntry> = TEntry extends { readonly id: infer TId extends string; readonly src: infer TSrc extends string }
  ? { readonly [K in TId]: TSrc }
  : Record<never, never>

/** The intersection of the members of a union. */
type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void ? I : never

/**
 * The `actors` a setup with `types.children` must give (XState `RequiredSetupKeys`): every
 * actor the children map names; nothing without a children map.
 *
 * @since 0.1.0
 * @category Setup
 */
export type SetupChildrenActors<TChildrenMap> = [keyof TChildrenMap] extends [never] ? unknown
  : { readonly actors: { readonly [K in TChildrenMap[keyof TChildrenMap] & string]: AnyActorLogic } }

/**
 * The `createMachine` of a setup, from the function that builds a machine of the setup's
 * types. Only the type adds the rest (the config as written, the state schema of its keys,
 * the route event of its routable states and the names its `provide` takes): the machine
 * takes any event at run time, the root's `xstate.route` transitions take the route event,
 * and `provide` merges any record (XState casts the same way).
 */
const setupCreateMachine = <
  TContext,
  TEvent extends EventObject,
  TStateMeta,
  TTransitionMeta,
  TNames extends ImplementationNames,
  TProvided,
  TSetupInput,
  TSetupEmitted extends EventObject,
  TChildrenMap extends Record<string, string>,
  TTag extends string
>(
  create: <TInput, TOutput, TEmitted extends EventObject>(
    config: MachineConfig<TContext, TEvent, TInput, TOutput, TStateMeta, TTransitionMeta>
  ) => StateMachine<string, TContext, TEvent, TInput, TOutput, TEmitted, never, TStateMeta, TTransitionMeta>
): SetupCreateMachine<TContext, TEvent, TStateMeta, TTransitionMeta, TNames, TProvided, TSetupInput, TSetupEmitted, TChildrenMap, TTag> =>
  create as unknown as SetupCreateMachine<TContext, TEvent, TStateMeta, TTransitionMeta, TNames, TProvided, TSetupInput, TSetupEmitted, TChildrenMap, TTag>

/**
 * Return type of setup.
 *
 * Provides:
 * - `createMachine` to create state machines with the configured types
 * - Type-safe accessors for `actors`, `actions`, `guards`, `delays`
 *
 * @since 0.1.0
 * @category Setup
 */
export interface SetupReturn<
  TContext,
  TEvent extends EventObject,
  TActors extends Record<string, AnyActorLogic>,
  TActions extends Record<string, SetupActionImplementation<TContext, TEvent>>,
  TGuards extends Record<string, GuardImplementation<TContext, TEvent>>,
  TDelays extends Record<string, DelayConfig<TContext, TEvent>>,
  TStateMeta = unknown,
  TTransitionMeta = TStateMeta,
  TInput = NonReducibleUnknown,
  TEmitted extends EventObject = EventObject,
  TChildrenMap extends Record<string, string> = Record<never, never>,
  TTag extends string = string
> extends SetupHelpers<TContext, TEvent, SetupNames<TActions, TGuards, TDelays, TActors, TEmitted, TTag, TChildrenMap>> {
  /**
   * Creates a state machine with the configured types and implementations.
   * Type parameters flow from setup to the created machine, the meta types included.
   *
   * The machine also carries the state keys and ids of the config as its state schema (XState
   * `ToStateSchema<TConfig>`), so `mapState` checks a mapper's keys against them and a
   * snapshot's `getMeta()` is keyed by the state ids (XState `StateId`). `TStateKeys` is
   * inferred from the config's `states`, as deep as they go; given explicit type arguments,
   * it stays the wide default and the machine takes any key.
   *
   * When the config has routable states (a `route` and an `id`, the root included), the
   * machine's event type also holds the route event (XState): `{ type: "xstate.route", to }`
   * with `to` one of their `#<id>`s (`RoutableStateId`). So a machine whose declared events
   * are `never` still takes route events, and a `to` that names no routable state is a type
   * error. `TConfig` is the config as written (XState `const TConfig extends MachineConfig`).
   * A config whose members other than `context` are not valid as written, or explicit type
   * arguments, give the plain members, which add no route event, and the config is checked as
   * before. As in XState, a valid config is not checked for extra keys.
   *
   * The config names only this setup's implementations (XState): an action or guard name is
   * one of the setup's, used alone only when its params may be `undefined` and else as
   * `{ type, params }` with params of its type; an `after` key is a setup delay or a number;
   * an `invoke` src is a setup actor or actor logic. A setup without actions takes no action
   * name, and so on for the others. The machine's `provide` takes the same names (see
   * {@link SetupProvideImplementations}). With `types.emitted`, an `emit` or `enqueue.emit`
   * in the config takes only those events, and the machine's actors emit them.
   *
   * The machine's snapshots type `value` by the config's states (XState `ToStateValue`),
   * `matches` and the keys of `getMeta` by its state keys and ids, and `children` by the
   * setup's actors with the ids of `types.children` (see {@link SetupChildren}).
   */
  readonly createMachine: SetupCreateMachine<
    TContext,
    TEvent,
    TStateMeta,
    TTransitionMeta,
    SetupNames<TActions, TGuards, TDelays, TActors, TEmitted, TTag, TChildrenMap>,
    SetupProvideImplementations<TContext, TEvent, TActors, TActions, TGuards, TDelays>,
    TInput,
    TEmitted,
    TChildrenMap,
    TTag
  >

  /**
   * The configured actors (for reference and composition).
   * Keys are inferred as literal types when using `const` modifier.
   */
  readonly actors: TActors

  /**
   * The configured actions (for reference and composition).
   * Keys are inferred as literal types when using `const` modifier.
   */
  readonly actions: TActions

  /**
   * The configured guards (for reference and composition).
   * Keys are inferred as literal types when using `const` modifier.
   */
  readonly guards: TGuards

  /**
   * The configured delays (for reference and composition).
   * Keys are inferred as literal types when using `const` modifier.
   */
  readonly delays: TDelays

  /**
   * A new setup with the same types, schemas and actors, whose actions, guards and delays
   * are this setup's with the extension's added (XState `extend`): `{ ...base, ...extended }`,
   * so an extension wins over a base implementation of the same name. This setup is
   * unchanged, and a further `extend` builds on the result.
   *
   * @example
   * ```ts
   * const base = setup({ actions: { track: () => {} } })
   * const extended = base.extend({ guards: { isReady: () => true }, delays: { soon: 100 } })
   * extended.createMachine({ entry: "track", on: { GO: { guard: "isReady" } } })
   * ```
   */
  readonly extend: <
    // Each defaults to its constraint, as setup's own records do (TExtendActions to its
    // constraint with any name): a plain-function action, guard or delay reads its argument
    // types from it. A built-in action written in the record reads the base's actions and
    // the record's own action names, the guards and delays of both, the actors and the
    // emitted events from the constraint of TExtendActions (`ExtensionNames`)
    const TExtendActions extends Record<
      string,
      SetupActionImplementation<TContext, TEvent, ExtensionNames<TActions, TGuards, TDelays, TActors, TEmitted, TExtendGuards, TExtendDelays, TExtendActionNames>>
    > = Record<string, SetupActionImplementation<TContext, TEvent>>,
    const TExtendGuards extends Record<string, GuardImplementation<TContext, TEvent>> = Record<string, GuardImplementation<TContext, TEvent>>,
    const TExtendDelays extends Record<string, DelayConfig<TContext, TEvent>> = Record<string, DelayConfig<TContext, TEvent>>,
    // The names of the extension's actions, from the keys of its `actions` record: a built-in
    // action of the record may name a sibling (upstream `TActions & TExtendActions`)
    TExtendActionNames extends string = never
  >(
    extension: SetupExtension<TExtendActions, TExtendGuards, TExtendDelays, MergedImplementations<TGuards, TExtendGuards>> &
      { readonly actions?: Readonly<Record<TExtendActionNames, unknown>> }
  ) => SetupReturn<
    TContext,
    TEvent,
    TActors,
    MergedImplementations<TActions, TExtendActions>,
    MergedImplementations<TGuards, TExtendGuards>,
    MergedImplementations<TDelays, TExtendDelays>,
    TStateMeta,
    TTransitionMeta,
    TInput,
    TEmitted,
    TChildrenMap,
    TTag
  >

  /**
   * Gives the state config back, typed by this setup (XState `createStateConfig`), so a
   * state can be written apart from the machine that uses it.
   *
   * @example
   * ```ts
   * const lights = setup({ actions: { note: () => {} } })
   * const green = lights.createStateConfig({ on: { TIMER: { target: "yellow", actions: "note" } } })
   * lights.createMachine({ initial: "green", states: { green, yellow: {} } })
   * ```
   */
  readonly createStateConfig: <
    const TStateConfig extends StateNodeConfig<TContext, TEvent, TStateMeta, TTransitionMeta, SetupNames<TActions, TGuards, TDelays, TActors, TEmitted, TTag, TChildrenMap>>
  >(
    config: TStateConfig
  ) => TStateConfig

  /**
   * Gives the action back, typed by this setup (XState `createAction`): an inline function
   * of `({ context, event, self, system }, params)` or a built-in action.
   *
   * @example
   * ```ts
   * const counter = setup({ types: { context: {} as { count: number } } })
   * const report = counter.createAction(({ context }) => console.log(context.count))
   * counter.createMachine({ context: { count: 0 }, entry: report })
   * ```
   */
  readonly createAction: <const TAction extends SetupAction<TContext, TEvent>>(action: TAction) => TAction
}

/**
 * The built-in actions bound to a setup (XState `setup(...).assign` and the others): each is
 * the module function with the setup's context and events, so its callbacks need no type
 * annotations and its arguments are checked against the setup's types; a delay name, and a
 * name `enqueueActions` enqueues or checks, is one of the setup's (`TNames`).
 *
 * @example
 * ```ts
 * const counter = setup({ types: { context: {} as { count: number }, events: {} as { type: "INC" } } })
 * counter.createMachine({
 *   context: { count: 0 },
 *   on: { INC: { actions: counter.assign({ count: ({ context }) => context.count + 1 }) } }
 * })
 * ```
 *
 * @since 0.1.0
 * @category Setup
 */
export interface SetupHelpers<TContext, TEvent extends EventObject, TNames extends ImplementationNames = ImplementationNames> {
  /** `assign` with this setup's context and events (XState). */
  readonly assign: <TParams = undefined>(
    assignment: Assignment<TContext, TEvent, TParams>
  ) => ActionDefinition<TContext, TEvent, AssignDefinitionParams<NoInfer<TParams>>>

  /** `raise` with this setup's context and events; the raised event is one of the events (XState). */
  readonly raise: (
    event: RaiseEvent<TContext, TEvent, TEvent>,
    options?: RaiseOptions<TContext, TEvent, TNames["delays"]>
  ) => ActionDefinition<TContext, TEvent>

  /** `sendTo` with this setup's context and events (XState). */
  readonly sendTo: <TTarget extends ActorRefBase = ActorRefBase, TSentEvent extends EventObject = EventObject>(
    target: SendToTarget<TContext, TEvent, TTarget>,
    event: SendToTargetEvent<TContext, TEvent, TTarget, TSentEvent>,
    options?: SendToOptions<TContext, TEvent, TNames["delays"]>
  ) => ActionDefinition<TContext, TEvent>

  /** `log` with this setup's context and events (XState). */
  readonly log: (value?: LogMessage<TContext, TEvent>, labelOrOptions?: string | LogOptions) => ActionDefinition<TContext, TEvent>

  /** `cancel` with this setup's context and events (XState). */
  readonly cancel: (id: CancelId<TContext, TEvent>) => ActionDefinition<TContext, TEvent>

  /** `stopChild` with this setup's context and events (XState). */
  readonly stopChild: (child: StopChildTarget<TContext, TEvent>) => ActionDefinition<TContext, TEvent>

  /** `enqueueActions` with this setup's context and events (XState). */
  readonly enqueueActions: <TParams = void>(
    collect: CollectActions<TContext, TEvent, TParams, TNames>
  ) => EnqueueActionsDefinition<TContext, TEvent, TParams, never, TNames>

  /**
   * `emit` with this setup's context and events (XState): the event is one of the setup's
   * `types.emitted`, or any event object when it declares none.
   */
  readonly emit: (event: EmitEvent<TContext, TEvent, TNames["emitted"]>) => ActionDefinition<TContext, TEvent>

  /**
   * `spawnChild` with this setup's context and events (XState): the arguments of the module
   * `spawnChild` with this setup's names (upstream `typeof spawnChild<..., ToProvidedActor>`,
   * see {@link SpawnChildArguments}): the name of one of this setup's actors, with an id that
   * `types.children` gives it and its logic's input, or actor logic, with no id and any input.
   * The action carries the setup's names, so a machine of another setup without that actor
   * rejects it.
   */
  readonly spawnChild: <TLogic extends AnyActorLogic>(
    ...args: SpawnChildArguments<TContext, TEvent, TLogic, TNames>
  ) => ActionDefinition<TContext, TEvent, void, never, TNames>
}

/**
 * The actions, guards and delays `setup(...).extend` adds (XState): each in the form `setup`
 * takes them.
 *
 * @since 0.1.0
 * @category Setup
 */
export interface SetupExtension<TActions, TGuards, TDelays, TAllGuards = TGuards> {
  readonly actions?: TActions
  /**
   * The guards added. A built-in guard here (`not`, `and`, `or`) names only guards of
   * `TAllGuards`, the base's with these (see {@link SetupGuardChecks}).
   */
  readonly guards?: TGuards & SetupGuardChecks<TGuards, TAllGuards>
  readonly delays?: TDelays
}

/**
 * The check a guard of a setup's `guards` record (and of an `extend`'s) passes besides its own
 * form: a built-in guard (`not`, `and`, `or`) names only guards of `TAllGuards` (the record
 * itself, with the base's for an `extend`), each with params of its type (XState
 * `ToParameterizedObject<TGuards>`, which upstream checks through `_out_TGuard`). Any other
 * form passes as it is.
 *
 * @since 0.1.0
 * @category Setup
 */
export type SetupGuardChecks<TGuards, TAllGuards = TGuards> = {
  readonly [K in keyof TGuards]: TGuards[K] extends { readonly predicate: unknown }
    ? { readonly "~guards"?: ParameterizedObjectsOf<TAllGuards> }
    : unknown
}

/**
 * The implementations of a setup after `extend` (XState `TActions & TExtendActions`): the
 * base's, with the extension's in place of a base implementation of the same name. A side
 * that names none (its wide default) adds nothing.
 *
 * @since 0.1.0
 * @category Setup
 */
export type MergedImplementations<TBase, TExtension> = string extends keyof TExtension ? TBase
  : string extends keyof TBase ? TExtension
  : Omit<TBase, keyof TExtension> & TExtension

/**
 * An action `createAction` takes (XState `ActionFunction`): an inline function of
 * `({ context, event, self, system }, params)`, or a built-in action or port definition.
 *
 * @since 0.1.0
 * @category Setup
 */
export type SetupAction<TContext, TEvent extends EventObject> = ActionFunction<TContext, TEvent> | ActionDefinition<TContext, TEvent>

/**
 * The names of a setup's actors (XState `TActor['src']`): `never` when the setup has none.
 *
 * @since 0.1.0
 * @category Setup
 */
export type ActorNamesOf<TActors> = NamesOf<TActors>

/**
 * An action implementation in `setup({ actions })` and `extend({ actions })`: a plain
 * function of the setup's types, or a port definition of them whose names are `TNames` (any
 * name by default). A built-in action written in the same call, such as `raise(...)` or
 * `enqueueActions(...)`, reads the setup's context, events and names from this type: the
 * checker infers it in its second pass (the built-ins' deferral signature, see `Raise`),
 * after it has inferred the setup's `types` and the other records, as upstream's built-ins
 * get theirs. So its raised event, delay, actor, guard and action names and emitted events
 * are checked where it is written (XState).
 *
 * @since 0.1.0
 * @category Setup
 */
export type SetupActionImplementation<
  TContext,
  TEvent extends EventObject,
  TNames extends ImplementationNames = ImplementationNames
> =
  | ActionFunction<TContext, TEvent, never>
  | (Pick<ActionDefinition<TContext, TEvent, never>, "type" | "exec"> & ImplementsNames<TNames>)

/** The names a definition may use, as `ActionDefinition` carries them (type only; never set). */
interface ImplementsNames<TNames> {
  "~names"?(names: TNames): void
}

/**
 * The names a built-in action written in `setup({ actions })` may use (the constraint of
 * that record): the names of the record's own actions (upstream
 * `ToParameterizedObject<TActions>`; their params are not checked, ledger row DEV-63), and
 * the guards, delays, actors and emitted events of the same setup. A record the setup call
 * leaves out names none, as in {@link SetupNames}. `TActionNames` comes from the record's
 * keys (a type parameter of `setup` of its own, as `TActions` cannot name itself in its
 * constraint).
 *
 * @since 0.1.0
 * @category Setup
 */
export interface SetupRecordNames<
  TGuards extends ParameterizedObject,
  TDelays extends string,
  TActorLogic extends Readonly<Record<string, AnyActorLogic>>,
  TEmitted extends AnyEventObject,
  TActionNames extends string = never
> extends ImplementationNames {
  readonly actions: ParameterizedObjectsOf<Record<TActionNames, unknown>>
  readonly guards: TGuards
  readonly delays: TDelays
  readonly actors: NamesOf<TActorLogic>
  readonly actorLogic: TActorLogic
  readonly emitted: TEmitted
  readonly providedActor: SetupProvidedActor<TActorLogic>
}

/**
 * A record of the setup call not inferred yet (`never` while the checker infers the call),
 * as the wide record that names none. The names a nested built-in reads are passed through
 * it (and {@link Known}): a type the call has not inferred would keep the checker from
 * inferring the names from them at all.
 */
type OrNone<TRecord> = [TRecord] extends [never] ? Record<string, never> : TRecord

/**
 * A type of the setup call not inferred yet (`never` while the checker infers the call), as
 * its default: a built-in action written in the record then reads the types the call has
 * inferred so far, and the defaults for the others.
 */
type Known<T, TDefault> = [T] extends [never] ? TDefault : T

/**
 * The names a built-in action written in `extend({ actions })` may use (the constraint of
 * that record): the base setup's actions and the names of the record's own actions (upstream
 * `TActions & TExtendActions`; a sibling's params are not checked, as the record is still
 * being inferred: ledger row DEV-63), its guards and delays with the extension's, its actors and its emitted
 * events. `TExtendActionNames` comes from the record's keys (a type parameter of `extend` of
 * its own, as `TExtendActions` cannot name itself in its constraint).
 *
 * @since 0.1.0
 * @category Setup
 */
export type ExtensionNames<
  TActions,
  TGuards,
  TDelays,
  TActors extends Readonly<Record<string, AnyActorLogic>>,
  TEmitted extends EventObject,
  TExtendGuards,
  TExtendDelays,
  TExtendActionNames extends string = never
> =
  SetupNames<
    MergedImplementations<TActions, Record<TExtendActionNames, unknown>>,
    MergedImplementations<TGuards, OrNone<TExtendGuards>>,
    MergedImplementations<TDelays, OrNone<TExtendDelays>>,
    TActors,
    TEmitted
  >

/**
 * The keys of an implementation record: `never` for a record that names none (the wide
 * default of a setup without that record).
 *
 * @since 0.1.0
 * @category Setup
 */
export type NamesOf<TRecord> = string extends keyof TRecord ? never : keyof TRecord & string

/**
 * The params type of an action or guard implementation: what the params argument of its
 * function, or of a port definition's `exec` or `predicate`, takes. It is `unknown` (any
 * params) for one that declares none: no params argument, an unannotated one (`never`, from
 * the setup's records), a `void` one (a built-in action such as `raise`, which reads the
 * params of the use only through its callbacks), and a guard that names another guard.
 *
 * @since 0.1.0
 * @category Setup
 */
export type ImplementationParams<TImplementation> = DeclaredParams<
  TImplementation extends { readonly exec: (ctx: never, params: infer TParams) => unknown } ? TParams
  : TImplementation extends { readonly predicate: (ctx: never, params: infer TParams) => unknown } ? TParams
  : TImplementation extends (args: never, params: infer TParams) => unknown ? TParams
  : unknown
>

/** A params type as declared: `unknown` for `never` and `void`, which declare none. */
type DeclaredParams<TParams> = [TParams] extends [never] ? unknown
  : [TParams] extends [void] ? ([void] extends [TParams] ? unknown : TParams)
  : TParams

/**
 * Each implementation of a record with the type of its params (XState
 * `ToParameterizedObject`): `{ type, params }` for each key, `never` for a record that names
 * none.
 *
 * @since 0.1.0
 * @category Setup
 */
export type ParameterizedObjectsOf<TRecord> = string extends keyof TRecord ? never
  : { readonly [K in keyof TRecord & string]: { readonly type: K; readonly params: ImplementationParams<TRecord[K]> } }[keyof TRecord & string]

/**
 * The names a setup's machine configs may use (see `ImplementationNames`): the setup's
 * actions and guards with their params, the names of its delays and actors, the events
 * it declares in `types.emitted`, the tags of its `types.tags` (XState `TTag`; any tag when
 * it declares none), and its actors with the child ids its `types.children` gives them. A record the setup does not have names nothing, so any name
 * there is a type error (XState); a setup that declares no emitted events takes any event
 * object in `emit`.
 *
 * @since 0.1.0
 * @category Setup
 */
export interface SetupNames<
  TActions,
  TGuards,
  TDelays,
  TActors extends Readonly<Record<string, AnyActorLogic>>,
  TEmitted extends EventObject = EventObject,
  TTag extends string = string,
  TChildrenMap extends Record<string, string> = Record<never, never>
> extends ImplementationNames {
  readonly actions: ParameterizedObjectsOf<TActions>
  readonly guards: ParameterizedObjectsOf<TGuards>
  readonly delays: NamesOf<TDelays>
  readonly actors: NamesOf<TActors>
  readonly actorLogic: TActors
  readonly emitted: DeclaredEmitted<TEmitted>
  readonly tags: TTag
  readonly providedActor: SetupProvidedActor<TActors, TChildrenMap>
}

/**
 * A setup's actors as XState's `ProvidedActor` union (`ToProvidedActor<TChildrenMap,
 * TActors>`): each actor name with its logic, and, for an actor that `types.children` names,
 * the ids the map gives it, so a spawn or an invocation of it requires one; an actor the map
 * does not name has no `id` member and takes any id. `never` for a setup without actors.
 */
type SetupProvidedActor<
  TActors extends Readonly<Record<string, AnyActorLogic>>,
  TChildrenMap = Record<never, never>
> = {
  readonly [K in NamesOf<TActors>]: { readonly src: K; readonly logic: TActors[K] } & DeclaredChildIds<TChildrenMap, K>
}[NamesOf<TActors>]

/**
 * The `id` member of the setup actor `TSrc`: the ids `types.children` gives it, or nothing when
 * the map gives it none (an optional `id` would read as a declared id of type `string`).
 */
type DeclaredChildIds<TChildrenMap, TSrc> = TSrc extends TChildrenMap[keyof TChildrenMap]
  ? { readonly id: ChildIdOf<TChildrenMap, TSrc> }
  : unknown

/**
 * The events an `emit` of a setup machine takes: the setup's `types.emitted`, or any event
 * object when it declares none (its default, `EventObject`).
 *
 * @since 0.1.0
 * @category Setup
 */
export type DeclaredEmitted<TEmitted extends EventObject> = EventObject extends TEmitted ? AnyEventObject : TEmitted

/**
 * What a setup machine's `provide` takes (XState `InternalMachineImplementations` of the
 * machine's types): in each record, only the setup's names. An action or a guard is a plain
 * function whose params are those of the setup's implementation of that name (any params
 * when that one declares none), or a port definition; a guard may also name another guard of
 * the setup, with that guard's params. A delay is a `DelayConfig`; an actor is a logic of the
 * setup's type for that src. A record the setup does not have takes no name.
 *
 * @example
 * ```ts
 * const machine = setup({
 *   actors: { load: fromPromise(async () => "data") },
 *   guards: { atLeast: ({ context }, params: { min: number }) => true }
 * }).createMachine({})
 * machine.provide({
 *   actors: { load: fromPromise(async () => "test data") },
 *   guards: { atLeast: (_, params) => params.min > 0 }
 * })
 * ```
 *
 * @since 0.1.0
 * @category Setup
 */
export interface SetupProvideImplementations<TContext, TEvent extends EventObject, TActors, TActions, TGuards, TDelays> {
  readonly actions?: {
    readonly [K in NamesOf<TActions>]?: NamedActionImplementation<TContext, TEvent, ImplementationParams<TActions[K & keyof TActions]>>
  }
  readonly guards?: {
    readonly [K in NamesOf<TGuards>]?: NamedGuardImplementation<
      TContext,
      TEvent,
      ImplementationParams<TGuards[K & keyof TGuards]>,
      ParameterizedObjectsOf<TGuards>
    >
  }
  readonly delays?: { readonly [K in NamesOf<TDelays>]?: DelayConfig<TContext, TEvent> }
  readonly actors?: { readonly [K in NamesOf<TActors>]?: TActors[K & keyof TActors] }
}

/**
 * The logic a `spawnChild` src stands for: the setup actor a name names, or the logic given.
 *
 * @since 0.1.0
 * @category Setup
 */
export type SpawnedLogicOf<TActors, TSrc> = TSrc extends keyof TActors
  ? TActors[TSrc] extends AnyActorLogic ? TActors[TSrc] : AnyActorLogic
  : TSrc extends AnyActorLogic ? TSrc
  : AnyActorLogic

/**
 * The bound helpers of a setup (XState): each calls the module function with the setup's
 * context and event types.
 */
const bindHelpers = <TContext, TEvent extends EventObject, TNames extends ImplementationNames>(): SetupHelpers<
  TContext,
  TEvent,
  TNames
> => ({
  assign: <TParams = undefined>(assignment: Assignment<TContext, TEvent, TParams>) => assign<TContext, TEvent, TParams>(assignment),
  raise: (event, options) => raise<TContext, TEvent, TEvent>(event, options),
  sendTo: <TTarget extends ActorRefBase, TSentEvent extends EventObject>(
    target: SendToTarget<TContext, TEvent, TTarget>,
    event: SendToTargetEvent<TContext, TEvent, TTarget, TSentEvent>,
    options?: SendToOptions<TContext, TEvent, TNames["delays"]>
  ) => sendTo<TContext, TEvent, TSentEvent, ImplementationNames, TTarget>(target, event, options),
  log: (value, labelOrOptions) => log<TContext, TEvent>(value, labelOrOptions),
  cancel: (id) => cancel<TContext, TEvent>(id),
  stopChild: (child) => stopChild<TContext, TEvent>(child),
  enqueueActions: <TParams>(collect: CollectActions<TContext, TEvent, TParams, TNames>) =>
    enqueueActions<TContext, TEvent, TParams, TNames>(collect),
  emit: (event: EmitEvent<TContext, TEvent, TNames["emitted"]>) => emit<TContext, TEvent, TNames>(event),
  spawnChild: <TLogic extends AnyActorLogic>(src: string | TLogic, options?: UntypedSpawnChildOptions<TContext, TEvent>) =>
    // The bound helper's own signature checks the src and the options against the setup's
    // actors, so the call takes any name; its result type carries the setup's names
    spawnChild<TContext, TEvent, TLogic>(src, options),
})

/** The implementation records of a setup. */
interface SetupImplementations<TActors, TActions, TGuards, TDelays> {
  readonly actors: TActors
  readonly actions: TActions
  readonly guards: TGuards
  readonly delays: TDelays
}

/**
 * The records of a setup after `extend` (upstream `{ ...actions, ...extended.actions }` for
 * each): the actors stay, the extension's actions, guards and delays win on a clash.
 */
const mergeImplementations = <TContext, TEvent extends EventObject, TActors>(
  base: SetupImplementations<
    TActors,
    Record<string, SetupActionImplementation<TContext, TEvent>>,
    Record<string, GuardImplementation<TContext, TEvent>>,
    Record<string, DelayConfig<TContext, TEvent>>
  >,
  extension: SetupExtension<
    Record<string, SetupActionImplementation<TContext, TEvent>>,
    Record<string, GuardImplementation<TContext, TEvent>>,
    Record<string, DelayConfig<TContext, TEvent>>
  >
) => ({
  actors: base.actors,
  actions: { ...base.actions, ...extension.actions },
  guards: { ...base.guards, ...extension.guards },
  delays: { ...base.delays, ...extension.delays },
})

/**
 * A setup from its implementation records and schemas: the records, `createMachine`
 * (upstream `createMachine({ ...config, schemas }, implementations)`), `extend` (a new setup
 * of the merged records), `createStateConfig`, `createAction` and the bound helpers. `setup`
 * gives its `schemas` (which replace a machine config's own, as upstream); a schema-based
 * setup gives none and leaves the machine config as written.
 */
const buildSetup = <
  TContext,
  TEvent extends EventObject,
  TActors extends Record<string, AnyActorLogic>,
  TActions extends Record<string, SetupActionImplementation<TContext, TEvent>>,
  TGuards extends Record<string, GuardImplementation<TContext, TEvent>>,
  TDelays extends Record<string, DelayConfig<TContext, TEvent>>,
  TStateMeta,
  TTransitionMeta,
  TInput,
  TEmitted extends EventObject,
  TChildrenMap extends Record<string, string>,
  TTag extends string
>(
  implementations: SetupImplementations<TActors, TActions, TGuards, TDelays>,
  schemas: Option.Option<unknown>
): SetupReturn<TContext, TEvent, TActors, TActions, TGuards, TDelays, TStateMeta, TTransitionMeta, TInput, TEmitted, TChildrenMap, TTag> => {
  // The records are the machine's implementations; only their types are the setup's
  const machineImplementations = implementations as MachineImplementations<TContext, TEvent>
  return {
    ...implementations,
    ...bindHelpers<TContext, TEvent, SetupNames<TActions, TGuards, TDelays, TActors, TEmitted, TTag, TChildrenMap>>(),
    createMachine: setupCreateMachine<
      TContext,
      TEvent,
      TStateMeta,
      TTransitionMeta,
      SetupNames<TActions, TGuards, TDelays, TActors, TEmitted, TTag, TChildrenMap>,
      SetupProvideImplementations<TContext, TEvent, TActors, TActions, TGuards, TDelays>,
      TInput,
      TEmitted,
      TChildrenMap,
      TTag
    >(
      <TMachineInput, TOutput, TEmitted extends EventObject>(
        machineConfig: MachineConfig<TContext, TEvent, TMachineInput, TOutput, TStateMeta, TTransitionMeta>
      ) =>
        SM.make<TContext, TEvent, TMachineInput, TOutput, TEmitted, never, TStateMeta, TTransitionMeta>(
          Option.match(schemas, { onNone: () => machineConfig, onSome: (given) => ({ ...machineConfig, schemas: given }) }),
          machineImplementations
        )
    ),
    // Only the type of `extend` knows the merged records (upstream casts the same way)
    extend: (extension) =>
      buildSetup<
        TContext,
        TEvent,
        TActors,
        Record<string, SetupActionImplementation<TContext, TEvent>>,
        Record<string, GuardImplementation<TContext, TEvent>>,
        Record<string, DelayConfig<TContext, TEvent>>,
        TStateMeta,
        TTransitionMeta,
        TInput,
        TEmitted,
        TChildrenMap,
        TTag
      >(mergeImplementations<TContext, TEvent, TActors>(implementations, extension), schemas) as never,
    createStateConfig: (config) => config,
    createAction: (action) => action,
  }
}

// ============================================================
// SETUP FUNCTION
// ============================================================

/**
 * Creates a type-safe machine factory.
 *
 * The setup function allows you to define types and implementations
 * that will be shared across all machines created with it. Without declared events
 * (`types.events`) the event type is `AnyEventObject`, as upstream.
 *
 * @example
 * ```ts
 * interface Context {
 *   count: number
 *   user: Option.Option<User>
 * }
 *
 * type Event =
 *   | { type: "INCREMENT" }
 *   | { type: "DECREMENT" }
 *   | { type: "FETCH_USER"; userId: string }
 *
 * const machine = setup({
 *   types: {} as {
 *     context: Context
 *     events: Event
 *   },
 *   actors: {
 *     fetchUser: fromPromise(async ({ input }) => {
 *       const response = await fetch(`/api/users/${input.userId}`)
 *       return response.json()
 *     })
 *   },
 *   actions: {
 *     logCount: log(({ context }) => `Count: ${context.count}`)
 *   },
 *   guards: {
 *     isPositive: ({ context }) => context.count > 0
 *   }
 * }).createMachine({
 *   id: "counter",
 *   context: { count: 0, user: Option.none() },
 *   initial: "idle",
 *   states: {
 *     idle: {
 *       on: {
 *         INCREMENT: {
 *           actions: ["logCount"]
 *         }
 *       }
 *     }
 *   }
 * })
 * ```
 *
 * @since 0.1.0
 * @category Setup
 */
export const setup = <
  TContext,
  TEvent extends EventObject = AnyEventObject,
  const TActors extends Record<string, AnyActorLogic> = Record<string, never>,
  // TActions, TGuards and TDelays default to their constraints (TActions to its constraint
  // with any name, as a default names only earlier type parameters): inference reads it for
  // the contextual type of a plain-function action, guard or delay, so
  // `({ context }, params) => ...` gets typed arguments. A built-in action written in the
  // record reads the record's own action names, and the setup's guards, delays, actors and
  // emitted events, from the constraint of TActions (`SetupRecordNames`)
  const TActions extends Record<
    string,
    SetupActionImplementation<
      TContext,
      TEvent,
      SetupRecordNames<
        ParameterizedObjectsOf<OrNone<TGuards>>,
        NamesOf<OrNone<TDelays>>,
        OrNone<TActors>,
        DeclaredEmitted<Known<TEmitted, EventObject>>,
        TActionNames
      >
    >
  > = Record<string, SetupActionImplementation<TContext, TEvent>>,
  const TGuards extends Record<string, GuardImplementation<TContext, TEvent>> = Record<string, GuardImplementation<TContext, TEvent>>,
  const TDelays extends Record<string, DelayConfig<TContext, TEvent>> = Record<string, DelayConfig<TContext, TEvent>>,
  TStateMeta = unknown,
  TTransitionMeta = TStateMeta,
  TInput = NonReducibleUnknown,
  TEmitted extends EventObject = EventObject,
  TChildrenMap extends Record<string, string> = Record<never, never>,
  TTag extends string = string,
  // The names of the record's actions, from the keys of its `actions` record: a built-in
  // action of the record may name a sibling, and no other action (upstream
  // `ToParameterizedObject<TActions>`)
  TActionNames extends string = never
>(
  config:
    & SetupConfig<TContext, TEvent, TActors, TActions, TGuards, TDelays, TStateMeta, TTransitionMeta, TInput, TEmitted, TChildrenMap, TTag>
    & SetupChildrenActors<NoInfer<TChildrenMap>>
    & { readonly actions?: Readonly<Record<TActionNames, unknown>> }
): SetupReturn<TContext, TEvent, TActors, TActions, TGuards, TDelays, TStateMeta, TTransitionMeta, TInput, TEmitted, TChildrenMap, TTag> =>
  buildSetup<TContext, TEvent, TActors, TActions, TGuards, TDelays, TStateMeta, TTransitionMeta, TInput, TEmitted, TChildrenMap, TTag>(
    {
      // An absent record is empty: the type of its default (no names) says the same
      actors: config.actors ?? ({} as TActors),
      actions: config.actions ?? ({} as TActions),
      guards: config.guards ?? ({} as TGuards),
      delays: config.delays ?? ({} as TDelays),
    },
    Option.some(config.schemas)
  )

// ============================================================
// FACTORY FUNCTIONS
// ============================================================

/**
 * Creates a type-safe action definition.
 *
 * This is the primary factory for creating custom actions with full
 * type inference for context and event.
 *
 * @example
 * ```ts
 * const myAction = action<MyContext, MyEvent>("myAction", (ctx) => {
 *   // ctx.context is MyContext
 *   // ctx.event is MyEvent
 *   return Effect.succeed(ActionResult.NoOp())
 * })
 * ```
 *
 * @since 0.1.0
 * @category Actions
 */
export const action = <
  TContext,
  TEvent extends EventObject,
  TParams = void,
  R = never
>(
  type: string,
  exec: (
    ctx: ActionContext<TContext, TEvent>,
    params: TParams
  ) => Effect.Effect<ActionResult, never, R>
): ActionDefinition<TContext, TEvent, TParams, R> => ({
  type,
  exec,
})

/**
 * Creates a type-safe guard definition.
 *
 * This is the primary factory for creating custom guards with full
 * type inference for context and event.
 *
 * @example
 * ```ts
 * const isValid = guard<MyContext, MyEvent>("isValid", (ctx) =>
 *   Effect.succeed(ctx.context.isValid && ctx.event.type === "SUBMIT")
 * )
 * ```
 *
 * @since 0.1.0
 * @category Guards
 */
export const guard = <
  TContext,
  TEvent extends EventObject,
  TParams = void
>(
  type: string,
  predicate: (
    ctx: GuardContext<TContext, TEvent>,
    params: TParams
  ) => Effect.Effect<boolean>
): GuardDefinition<TContext, TEvent, TParams> => ({
  type,
  predicate,
})

/**
 * Creates a guard from a synchronous predicate function.
 *
 * This is a convenience wrapper for creating simple boolean guards
 * without needing to wrap the return value in Effect.
 *
 * @example
 * ```ts
 * const hasTodos = when<TodoContext, TodoEvent>((ctx) =>
 *   ctx.context.todos.length > 0
 * )
 *
 * const isAddEvent = when<TodoContext, TodoEvent>((ctx) =>
 *   ctx.event.type === "ADD_TODO"
 * )
 * ```
 *
 * @since 0.1.0
 * @category Guards
 */
export const when = <TContext, TEvent extends EventObject>(
  predicate: (ctx: GuardContext<TContext, TEvent>) => boolean
): GuardDefinition<TContext, TEvent> => ({
  type: "xstate.when",
  predicate: (ctx, _params) => Effect.sync(() => predicate(ctx)),
})

// ============================================================
// HELPER TYPES
// ============================================================

/**
 * The context type of a setup return, a machine, an actor or an actor reference of machine
 * logic, or a machine snapshot (XState `ContextFrom`, DEV-14): a function gives the context of
 * what it returns, and a logic or snapshot without a context gives `never`.
 *
 * @example
 * ```ts
 * import { setup, type ContextFrom } from "@xstate-effect/core"
 *
 * const machine = setup({ types: {} as { context: { count: number } } }).createMachine({ context: { count: 0 } })
 * type Context = ContextFrom<typeof machine> // { count: number }
 * ```
 *
 * @since 0.1.0
 * @category Setup
 */
export type ContextFrom<T> = T extends SetupReturn<infer C, infer _E, infer _A, infer _Act, infer _G, infer _D, infer _SM, infer _TM, infer _I, infer _Em, infer _Ch, infer _Tg> ? C
  : ContextOfSnapshot<T extends { readonly context: unknown; readonly value: unknown } ? T : SnapshotFrom<T>>

/** The context of a snapshot that has one; `never` for any other. */
type ContextOfSnapshot<TSnapshot> = TSnapshot extends { readonly context: infer C } ? C : never

/**
 * The event type of a setup return, a machine or any actor logic, or an actor or an actor
 * reference (XState `EventFrom`, DEV-14): the events it takes. A function gives the events of
 * what it returns, and any other type `never`. The second parameter keeps the events of the
 * given types only (upstream `EventFrom<T, K>`).
 *
 * @example
 * ```ts
 * import { setup, type EventFrom } from "@xstate-effect/core"
 *
 * const machine = setup({ types: {} as { events: { type: "GO" } | { type: "STOP" } } }).createMachine({})
 * const typeOf = (event: EventFrom<typeof machine>) => event.type // "GO" | "STOP"
 * type Go = EventFrom<typeof machine, "GO"> // { type: "GO" }
 * ```
 *
 * @since 0.1.0
 * @category Setup
 */
export type EventFrom<
  T,
  K extends TEvent["type"] = never,
  TEvent extends EventObject = EventOf<T>
> = [K] extends [never] ? TEvent : ExtractEvent<TEvent, K>

/** The events of a setup return, a machine, an actor logic, an actor or a function that returns one. */
type EventOf<T> = T extends SetupReturn<infer _C, infer E, infer _A, infer _Act, infer _G, infer _D, infer _SM, infer _TM, infer _I, infer _Em, infer _Ch, infer _Tg> ? E
  : (T extends (...args: never) => infer TReturn ? TReturn : T) extends infer TValue
    ? TValue extends ActorRef<infer _S, infer E, infer _Em> ? E
    : TValue extends ActorLogic<infer _S, infer E, infer _I, infer _Em, infer _R> ? E
    : never
  : never

/**
 * Extracts the actors from a setup return.
 *
 * @since 0.1.0
 * @category Setup
 */
export type ActorsFrom<T> = T extends SetupReturn<infer _C, infer _E, infer A, infer _Act, infer _G, infer _D, infer _SM, infer _TM, infer _I, infer _Em, infer _Ch, infer _Tg> ? A : never

/**
 * Extracts the actions from a setup return.
 *
 * @since 0.1.0
 * @category Setup
 */
export type ActionsFrom<T> = T extends SetupReturn<infer _C, infer _E, infer _Actors, infer A, infer _G, infer _D, infer _SM, infer _TM, infer _I, infer _Em, infer _Ch, infer _Tg> ? A : never

/**
 * Extracts the guards from a setup return.
 *
 * @since 0.1.0
 * @category Setup
 */
export type GuardsFrom<T> = T extends SetupReturn<infer _C, infer _E, infer _A, infer _Act, infer G, infer _D, infer _SM, infer _TM, infer _I, infer _Em, infer _Ch, infer _Tg> ? G : never

/**
 * Extracts the delays from a setup return.
 *
 * @since 0.1.0
 * @category Setup
 */
export type DelaysFrom<T> = T extends SetupReturn<infer _C, infer _E, infer _A, infer _Act, infer _G, infer D, infer _SM, infer _TM, infer _I, infer _Em, infer _Ch, infer _Tg> ? D : never

// ============================================================
// SCHEMA-BASED SETUP
// ============================================================

/**
 * Configuration for schema-based setup.
 *
 * Uses Effect Schema for context and events, providing:
 * - Runtime validation
 * - Self-documenting types
 * - Automatic serialization/deserialization
 *
 * @since 0.1.0
 * @category Setup
 */
export interface SetupSchemaConfig<
  TContextSchema extends Schema.Decoder<unknown>,
  TEventSchema extends Schema.Decoder<unknown>,
  TActors extends Record<string, AnyActorLogic>,
  TActions extends Record<string, SetupActionImplementation<Schema.Schema.Type<TContextSchema>, Schema.Schema.Type<TEventSchema> & EventObject>>,
  TGuards extends Record<string, GuardImplementation<Schema.Schema.Type<TContextSchema>, Schema.Schema.Type<TEventSchema> & EventObject>>,
  TDelays extends Record<string, DelayConfig<Schema.Schema.Type<TContextSchema>, Schema.Schema.Type<TEventSchema> & EventObject>>
> {
  /**
   * Schema for the context type.
   * Provides runtime validation and type inference.
   */
  readonly context: TContextSchema
  /**
   * Schema for the event types.
   * Use Schema.Union for multiple event types.
   */
  readonly events: TEventSchema
  readonly actors?: TActors
  readonly actions?: TActions
  readonly guards?: TGuards
  readonly delays?: TDelays
}

/**
 * Return type of setupWithSchema.
 *
 * @since 0.1.0
 * @category Setup
 */
export interface SetupSchemaReturn<
  TContext,
  TEvent extends EventObject,
  TContextSchema extends Schema.Decoder<unknown>,
  TEventSchema extends Schema.Decoder<unknown>,
  TActors extends Record<string, AnyActorLogic>,
  TActions extends Record<string, SetupActionImplementation<TContext, TEvent>>,
  TGuards extends Record<string, GuardImplementation<TContext, TEvent>>,
  TDelays extends Record<string, DelayConfig<TContext, TEvent>>
> extends Omit<SetupReturn<TContext, TEvent, TActors, TActions, TGuards, TDelays>, "extend"> {
  // `extend` is its own below: it gives a schema-based setup back (the two generic signatures
  // of `extend` are not comparable once the names of the extension's actions are inferred)
  /**
   * The context schema for runtime validation.
   */
  readonly contextSchema: TContextSchema
  /**
   * The event schema for runtime validation.
   */
  readonly eventSchema: TEventSchema
  /**
   * Validates a context value against the schema.
   */
  readonly validateContext: (value: unknown) => Effect.Effect<TContext, Schema.SchemaError>
  /**
   * Validates an event value against the schema.
   */
  readonly validateEvent: (value: unknown) => Effect.Effect<TEvent, Schema.SchemaError>

  /**
   * `extend` (see `SetupReturn.extend`) for a schema-based setup: the new setup keeps the
   * schemas and the validators.
   */
  readonly extend: <
    const TExtendActions extends Record<
      string,
      SetupActionImplementation<TContext, TEvent, ExtensionNames<TActions, TGuards, TDelays, TActors, EventObject, TExtendGuards, TExtendDelays, TExtendActionNames>>
    > = Record<string, SetupActionImplementation<TContext, TEvent>>,
    const TExtendGuards extends Record<string, GuardImplementation<TContext, TEvent>> = Record<string, GuardImplementation<TContext, TEvent>>,
    const TExtendDelays extends Record<string, DelayConfig<TContext, TEvent>> = Record<string, DelayConfig<TContext, TEvent>>,
    TExtendActionNames extends string = never
  >(
    extension: SetupExtension<TExtendActions, TExtendGuards, TExtendDelays, MergedImplementations<TGuards, TExtendGuards>> &
      { readonly actions?: Readonly<Record<TExtendActionNames, unknown>> }
  ) => SetupSchemaReturn<
    TContext,
    TEvent,
    TContextSchema,
    TEventSchema,
    TActors,
    MergedImplementations<TActions, TExtendActions>,
    MergedImplementations<TGuards, TExtendGuards>,
    MergedImplementations<TDelays, TExtendDelays>
  >
}

/**
 * A schema-based setup from its implementation records and schemas: the setup members, the
 * schemas and the validators, and an `extend` that keeps them.
 */
const buildSchemaSetup = <
  TContextSchema extends Schema.Decoder<unknown>,
  TEventSchema extends Schema.Decoder<unknown>,
  TActors extends Record<string, AnyActorLogic>,
  TActions extends Record<string, SetupActionImplementation<Schema.Schema.Type<TContextSchema>, Schema.Schema.Type<TEventSchema> & EventObject>>,
  TGuards extends Record<string, GuardImplementation<Schema.Schema.Type<TContextSchema>, Schema.Schema.Type<TEventSchema> & EventObject>>,
  TDelays extends Record<string, DelayConfig<Schema.Schema.Type<TContextSchema>, Schema.Schema.Type<TEventSchema> & EventObject>>
>(
  implementations: SetupImplementations<TActors, TActions, TGuards, TDelays>,
  contextSchema: TContextSchema,
  eventSchema: TEventSchema
): SetupSchemaReturn<
  Schema.Schema.Type<TContextSchema>,
  Schema.Schema.Type<TEventSchema> & EventObject,
  TContextSchema,
  TEventSchema,
  TActors,
  TActions,
  TGuards,
  TDelays
> => {
  type TContext = Schema.Schema.Type<TContextSchema>
  type TEvent = Schema.Schema.Type<TEventSchema> & EventObject
  return {
    ...buildSetup<TContext, TEvent, TActors, TActions, TGuards, TDelays, unknown, unknown, NonReducibleUnknown, EventObject, Record<never, never>, string>(
      implementations,
      Option.none()
    ),
    contextSchema,
    eventSchema,
    validateContext: Schema.decodeUnknownEffect(contextSchema) as (value: unknown) => Effect.Effect<TContext, Schema.SchemaError>,
    validateEvent: Schema.decodeUnknownEffect(eventSchema) as (value: unknown) => Effect.Effect<TEvent, Schema.SchemaError>,
    // Only the type of `extend` knows the merged records (as for `setup`)
    extend: (extension) =>
      buildSchemaSetup<
        TContextSchema,
        TEventSchema,
        TActors,
        Record<string, SetupActionImplementation<TContext, TEvent>>,
        Record<string, GuardImplementation<TContext, TEvent>>,
        Record<string, DelayConfig<TContext, TEvent>>
      >(mergeImplementations<TContext, TEvent, TActors>(implementations, extension), contextSchema, eventSchema) as never,
  }
}

/**
 * Creates a type-safe machine factory using Effect Schema.
 *
 * This is the Effect-idiomatic alternative to the phantom type approach.
 * It provides:
 * - Runtime validation of context and events
 * - Self-documenting schemas
 * - Automatic serialization/deserialization support
 * - Full type inference
 *
 * @example
 * ```ts
 * const Context = Schema.Struct({
 *   count: Schema.Number,
 *   name: Schema.String,
 * })
 *
 * const IncrementEvent = Schema.Struct({
 *   type: Schema.Literal("INCREMENT"),
 *   value: Schema.Number,
 * })
 *
 * const ResetEvent = Schema.Struct({
 *   type: Schema.Literal("RESET"),
 * })
 *
 * const Events = Schema.Union([IncrementEvent, ResetEvent])
 *
 * const machineSetup = setupWithSchema({
 *   context: Context,
 *   events: Events,
 *   actions: {
 *     logCount: log(({ context }) => `Count: ${context.count}`)
 *   },
 *   guards: {
 *     isPositive: ({ context }) => context.count > 0
 *   }
 * })
 *
 * // Type inference works:
 * // context is { count: number; name: string }
 * // events is { type: "INCREMENT"; value: number } | { type: "RESET" }
 * ```
 *
 * @since 0.1.0
 * @category Setup
 */
export const setupWithSchema = <
  TContextSchema extends Schema.Decoder<unknown>,
  TEventSchema extends Schema.Decoder<unknown>,
  const TActors extends Record<string, AnyActorLogic> = Record<string, never>,
  const TActions extends Record<string, SetupActionImplementation<Schema.Schema.Type<TContextSchema>, Schema.Schema.Type<TEventSchema> & EventObject>> = Record<string, SetupActionImplementation<Schema.Schema.Type<TContextSchema>, Schema.Schema.Type<TEventSchema> & EventObject>>,
  const TGuards extends Record<string, GuardImplementation<Schema.Schema.Type<TContextSchema>, Schema.Schema.Type<TEventSchema> & EventObject>> = Record<string, GuardImplementation<Schema.Schema.Type<TContextSchema>, Schema.Schema.Type<TEventSchema> & EventObject>>,
  const TDelays extends Record<string, DelayConfig<Schema.Schema.Type<TContextSchema>, Schema.Schema.Type<TEventSchema> & EventObject>> = Record<string, DelayConfig<Schema.Schema.Type<TContextSchema>, Schema.Schema.Type<TEventSchema> & EventObject>>
>(
  config: SetupSchemaConfig<TContextSchema, TEventSchema, TActors, TActions, TGuards, TDelays>
): SetupSchemaReturn<
  Schema.Schema.Type<TContextSchema>,
  Schema.Schema.Type<TEventSchema> & EventObject,
  TContextSchema,
  TEventSchema,
  TActors,
  TActions,
  TGuards,
  TDelays
> =>
  buildSchemaSetup<TContextSchema, TEventSchema, TActors, TActions, TGuards, TDelays>(
    {
      // An absent record is empty: the type of its default (no names) says the same
      actors: config.actors ?? ({} as TActors),
      actions: config.actions ?? ({} as TActions),
      guards: config.guards ?? ({} as TGuards),
      delays: config.delays ?? ({} as TDelays),
    },
    config.context,
    config.events
  )
