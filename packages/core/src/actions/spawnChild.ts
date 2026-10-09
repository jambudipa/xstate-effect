/**
 * @since 0.1.0
 * @module actions/spawnChild
 *
 * The spawnChild action spawns a child actor.
 */
import { Effect, Option } from "effect"
import type { EventObject } from "../Event.js"
import type { ActorLogic, AnyActorLogic } from "../ActorLogic.js"
import type { DeclaredActorId, RequiredSpawnKeys, SpawnInput } from "../spawn.js"
import type {
  ActionDefinition,
  ActionContext,
  ImplementationNames,
  ProvidedActor,
  SpawnOptions,
  MachineImplementations,
} from "../Types.js"
import * as Types from "../Types.js"

/**
 * Options for spawnChild.
 *
 * @since 0.1.0
 * @category Actions
 */
export interface SpawnChildOptions<
  TContext,
  TEvent extends EventObject,
  TLogic extends AnyActorLogic
> {
  /** ID for the spawned actor, or a function of the action arguments; defaults to its session id */
  readonly id?: string | ((ctx: ActionContext<TContext, TEvent>) => string)
  /**
   * Input for the spawned actor, or a function of `{ context, event, self }`: the input type
   * of `TLogic`, which is any value for a logic given inline beside declared actors (upstream
   * `SpawnArguments`), and a declared actor's input for a name a setup declares
   */
  readonly input?: SpawnedInputOf<TLogic> | ((ctx: ActionContext<TContext, TEvent>) => SpawnedInputOf<TLogic>)
  /** System ID for registry */
  readonly systemId?: string
  /** Whether the child sends each active snapshot to its parent as `xstate.snapshot.<id>` */
  readonly syncSnapshot?: boolean
}

/**
 * Options for spawnChild where the machine declares no actors (upstream `SpawnArguments`
 * where the actor names are not literal strings, and `DistributeActors` of no actor): any id,
 * static or a function of the action context, and any input. As upstream's `input?: unknown`,
 * an input function there gets no contextual type, so its parameter needs an annotation.
 *
 * @since 0.1.0
 * @category Actions
 */
export interface UntypedSpawnChildOptions<TContext, TEvent extends EventObject> {
  /** ID for the spawned actor, or a function of the action arguments; defaults to its session id */
  readonly id?: string | ((ctx: ActionContext<TContext, TEvent>) => string)
  /** Input for the spawned actor: any value, or a function that the engine calls with `{ context, event, self }` */
  readonly input?: unknown
  /** System ID for registry */
  readonly systemId?: string
  /** Whether the child sends each active snapshot to its parent as `xstate.snapshot.<id>` */
  readonly syncSnapshot?: boolean
}

/**
 * The input of a spawnChild's options for `TLogic`: that logic's input type, or any value for
 * `AnyActorLogic`, which matches no `ActorLogic<...>`. `spawnChild` and `enqueue.spawnChild`
 * pass `AnyActorLogic` for a logic given inline beside declared actors: upstream
 * `SpawnArguments` gives that logic `InputFrom<ProvidedActor["logic"]>`, which is `any`, and
 * its input function the action context of the declared actors' options. Any value is written
 * `NonNullable<unknown> | null | undefined`, not `unknown`, so that the input function beside
 * it in a union keeps its action context type (`unknown` would absorb the union).
 */
type SpawnedInputOf<TLogic> =
  TLogic extends ActorLogic<infer _S, infer _E, infer I, infer _Em, infer _R> ? I : NonNullable<unknown> | null | undefined

/**
 * The options of a spawnChild of the declared actor `TActor` (upstream `SpawnActionOptions`):
 * one of the ids the actor declares (any id when it declares none) and the input of its logic,
 * each static or a function of the action context. Any input is written as in
 * {@link SpawnedInputOf}, so that an input function keeps its action context type.
 */
interface DeclaredSpawnChildOptions<TContext, TEvent extends EventObject, TActor extends ProvidedActor> {
  readonly id?:
    | Exclude<DeclaredActorId<TActor>, undefined>
    | ((ctx: ActionContext<TContext, TEvent>) => Exclude<DeclaredActorId<TActor>, undefined>)
  readonly input?:
    | DeclaredSpawnInput<TActor["logic"]>
    | ((ctx: ActionContext<TContext, TEvent>) => DeclaredSpawnInput<TActor["logic"]>)
  readonly systemId?: string
  readonly syncSnapshot?: boolean
}

/** The input of a declared actor's logic (upstream `InputFrom`); any value when it declares none. */
type DeclaredSpawnInput<TLogic extends AnyActorLogic> = unknown extends SpawnInput<TLogic> ? NonNullable<unknown> | null | undefined
  : SpawnInput<TLogic>

/**
 * The arguments of a spawnChild of one declared actor (upstream `DistributeActors` of
 * `SpawnArguments`): its src, then its options, required with each key of
 * `RequiredSpawnKeys` (its declared id, the input its logic requires).
 */
type DeclaredSpawnChildArguments<TContext, TEvent extends EventObject, TActor extends ProvidedActor> =
  TActor extends ProvidedActor ? [RequiredSpawnKeys<TActor>] extends [never]
      ? [src: TActor["src"], options?: DeclaredSpawnChildOptions<TContext, TEvent, TActor>]
    : [
      src: TActor["src"],
      options: DeclaredSpawnChildOptions<TContext, TEvent, TActor> & { readonly [K in RequiredSpawnKeys<TActor>]: unknown }
    ]
    : never

/**
 * The arguments of `spawnChild` and `enqueue.spawnChild` (upstream `SpawnArguments`). Where
 * any actor name is taken: a name or a logic, with any input and an input function of no
 * contextual type (upstream `input?: unknown`). Where the machine declares its actors
 * (`TNames["providedActor"]`: a plain `createMachine`'s `types.actors`, a setup's actors): a
 * declared src with that actor's ids and input, or an inline logic with no id and any input,
 * whose input function reads the action context. Where it declares none (a setup without
 * actors): an inline logic with no id and any input, whose input function has no contextual
 * type (upstream `DistributeActors` of no actor leaves it an `any` input). As upstream, the
 * input of a logic given inline is not checked against that logic's input.
 *
 * @since 0.1.0
 * @category Actions
 */
export type SpawnChildArguments<TContext, TEvent extends EventObject, TLogic extends AnyActorLogic, TNames extends ImplementationNames> =
  string extends TNames["actors"] ? [src: TNames["actors"] | TLogic, options?: UntypedSpawnChildOptions<TContext, TEvent>]
    : [TNames["providedActor"]] extends [never] ? [src: TLogic, options?: UntypedSpawnChildOptions<TContext, TEvent> & { readonly id?: never }]
    :
      | DeclaredSpawnChildArguments<TContext, TEvent, TNames["providedActor"]>
      | [src: TLogic, options?: SpawnChildOptions<TContext, TEvent, AnyActorLogic> & { readonly id?: never }]

/** The value of an option that may be a function of the action context. */
const resolveOption = <TContext, TEvent extends EventObject, A>(
  option: A | ((ctx: ActionContext<TContext, TEvent>) => A) | undefined,
  ctx: ActionContext<TContext, TEvent>
): Option.Option<A> =>
  Option.map(Option.fromUndefinedOr(option), (value) =>
    typeof value === "function" ? (value as (ctx: ActionContext<TContext, TEvent>) => A)(ctx) : value
  )

/**
 * Creates an action that spawns a child actor (upstream `spawnChild`): the engine resolves a
 * string src against the machine's actor implementations (`setup({ actors })`, `provide`),
 * creates the child with the actor as its parent in the actor's scope (D12), adds it to
 * `snapshot.children` under its id, and starts it after the macrostep. An unknown src warns
 * `Actor type '<src>' not found in machine '<actor id>'.` and spawns nothing. The id and the
 * input may be functions of the action context; the id defaults to the child's session id.
 * Without an id option the child joins `snapshot.children` under the key `"undefined"`, as
 * upstream's, so a second spawn without an id replaces that entry.
 * Where the machine declares its actors (`types.actors`, a setup's actors), a src is one of
 * their names, with one of the ids that actor declares (required then) and the input of its
 * logic (required when the input type does not take `undefined`); an inline logic takes no id
 * there (upstream `SpawnArguments`).
 *
 * @example
 * ```ts
 * // Spawn with default ID
 * spawnChild(fetchLogic)
 *
 * // Spawn with specific ID and input. Where the machine declares no actors, an input
 * // function has no contextual type (upstream `input?: unknown`), so annotate it
 * spawnChild(workerLogic, {
 *   id: (ctx) => `worker-${ctx.context.workerId}`,
 *   input: (ctx: { readonly context: { readonly currentTask: string } }) => ({ taskId: ctx.context.currentTask })
 * })
 * ```
 *
 * @since 0.1.0
 * @category Actions
 */
export const spawnChild: SpawnChild = (<
  TContext,
  TEvent extends EventObject,
  TLogic extends AnyActorLogic,
  TNames extends ImplementationNames = ImplementationNames
>(
  src: NoInfer<TNames>["actors"] | TLogic,
  options?: SpawnChildOptions<TContext, TEvent, TLogic>
): ActionDefinition<TContext, TEvent, void, never, TNames> => ({
  type: "xstate.spawnChild",
  exec: (ctx, _params) =>
    Effect.sync(() =>
      Types.ActionResult.SpawnChild({
        src,
        id: resolveOption(options?.id, ctx),
        // The option as written, for the executable action's params (upstream `resolveSpawn`)
        givenId: options?.id,
        systemId: Option.fromUndefinedOr(options?.systemId),
        // Upstream `resolveSpawn` calls an input function only for a src that resolves to a
        // logic: the engine calls this once it has found one
        resolveInput: () => Option.getOrUndefined(resolveOption(options?.input, ctx)),
        syncSnapshot: options?.syncSnapshot ?? false,
      })
    ),
})) as SpawnChild

/**
 * The type of {@link spawnChild}: its first signature is the one every call resolves to; the second
 * is never callable (it takes arguments that no value has) and gives an inline call the
 * checker's deferral, for the reason `SendTo` in `sendTo.ts` gives: written inline under an
 * `on` descriptor of a typed machine, the call then reads that descriptor's events instead of
 * `EventObject`.
 *
 * @since 0.1.0
 * @category Actions
 */
export interface SpawnChild {
  <
    TContext,
    TEvent extends EventObject,
    TLogic extends AnyActorLogic,
    TNames extends ImplementationNames = ImplementationNames
  >(
    ...args: SpawnChildArguments<TContext, TEvent, TLogic, NoInfer<TNames>>
  ): ActionDefinition<TContext, TEvent, void, never, TNames>
  <TDeferred extends never>(first: TDeferred, second: TDeferred, third: TDeferred): (deferred: TDeferred) => never
}

/**
 * Creates a spawnChild action that resolves actor logic from the given implementations (a
 * port extra; `spawnChild` with a string src reads the machine's own implementations). A
 * name the implementations lack warns and spawns nothing.
 *
 * @since 0.1.0
 * @category Actions
 */
export const spawnChildFromRegistry = <
  TContext,
  TEvent extends EventObject
>(
  srcName: string,
  implementations: MachineImplementations<TContext, TEvent>,
  options?: Omit<SpawnChildOptions<TContext, TEvent, AnyActorLogic>, "input"> & {
    readonly input?: unknown | ((ctx: ActionContext<TContext, TEvent>) => unknown)
  }
): ActionDefinition<TContext, TEvent> => ({
  type: "xstate.spawnChild",
  exec: (ctx, _params) =>
    Effect.gen(function* () {
      // Look up actor logic from implementations
      const logicOption = Option.fromNullishOr(implementations.actors?.[srcName])
      if (Option.isNone(logicOption)) {
        yield* Effect.logWarning(`Actor "${srcName}" not found in implementations`)
        return Types.ActionResult.NoOp()
      }

      return Types.ActionResult.SpawnChild({
        src: logicOption.value,
        id: resolveOption(options?.id, ctx),
        systemId: Option.fromUndefinedOr(options?.systemId),
        input: Option.getOrUndefined(resolveOption<TContext, TEvent, unknown>(options?.input, ctx)),
        syncSnapshot: options?.syncSnapshot ?? false,
      })
    }),
})

// Re-export SpawnOptions from Types for convenience
export type { SpawnOptions }

// ============================================================
// UPSTREAM TYPE NAMES (EXP-1)
// ============================================================

/**
 * The action `spawnChild(...)` returns (upstream `SpawnAction`): an action definition of
 * the context and the event it reads, which spawns one of the provided actors `TActor`.
 *
 * @since 0.1.0
 * @category Actions
 */
export type SpawnAction<
  TContext,
  TExpressionEvent extends EventObject,
  _TParams,
  _TEvent extends EventObject,
  TActor extends Types.ProvidedActor
> = ActionDefinition<
  TContext,
  TExpressionEvent,
  void,
  never,
  Types.MachineTypesNames<Types.ParameterizedObject, Types.ParameterizedObject, string, TActor, EventObject>
>

/**
 * The options of `spawnChild` for a provided actor (upstream `SpawnActionOptions`): the
 * port's {@link SpawnChildOptions} of its logic.
 *
 * @since 0.1.0
 * @category Actions
 */
export type SpawnActionOptions<
  TContext,
  TExpressionEvent extends EventObject,
  _TEvent extends EventObject,
  TActor extends Types.ProvidedActor
> = SpawnChildOptions<TContext, TExpressionEvent, TActor["logic"]>
