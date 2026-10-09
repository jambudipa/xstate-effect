/**
 * @since 0.1.0
 * @module spawn
 *
 * Spawning per parent (D12): the synchronous `spawn` that assigners, port action definitions
 * and the context factory receive (upstream `createSpawner` in `src/spawn.ts`), its type
 * `Spawner` (upstream `Spawner`, a root type export), and the spawn a `spawnChild` action asks
 * for (upstream `resolveSpawn` in `src/actions/spawnChild.ts`).
 *
 * A child is created through the parent's actor scope (`ActorScopeService.allocateChild` and
 * `spawnChild`), so it joins the parent's system, lives in the parent's scope and starts after
 * the macrostep that spawned it. Upstream `createActor` builds the child at once; here the
 * child is an Effect to build, so `spawn` hands out the object the child is built into, and
 * the engine builds every child an action spawned as soon as the action returns, before the
 * next action runs.
 */
import { Chunk, Effect, HashMap, Option, Result } from "effect"
import type { ActorLogic, ActorScopeService, AnyActorLogic, SpawnRequest } from "./ActorLogic.js"
import type { ActorRefBase, AnyActorRef } from "./ActorRef.js"
import { ActorError } from "./Errors.js"
import type { EventObject } from "./Event.js"
import type {
  ActorRefFromLogic,
  NamedSpawnOptions,
  ProvidedActor,
  RequiredActorOptionsKeys,
  SpawnChild,
} from "./Types.js"

// ============================================================
// THE SPAWNER TYPE
// ============================================================

/**
 * The options of one spawn: the child's id, its system id, its input and `syncSnapshot`. A type
 * literal, as upstream writes them, so that a declaration emit can expand it in the type of an
 * exported machine (an interface that the module does not export cannot be named there).
 */
type SpawnerOptions<TInput, TId> = {
  readonly id?: TId
  readonly systemId?: string
  readonly input?: TInput
  readonly syncSnapshot?: boolean
}

/**
 * The options argument of a spawn, as a rest tuple (upstream `ConditionalRequired`):
 * optional while `TRequired` names no key, required with each key of `TRequired` otherwise.
 */
type SpawnArgs<TOptions, TRequired extends string> = [TRequired] extends [never] ? [options?: TOptions]
  : [options: TOptions & { readonly [K in TRequired]: unknown }]

/**
 * The input a spawn of `TLogic` takes (upstream `InputFrom`): the logic's input type, or any
 * input for a logic that declares none (`never`, which a logic written inline in
 * `setup({ actors })` or in the call infers; upstream's inline logic takes any input there).
 * `spawnChild` reads it too.
 *
 * @since 0.1.0
 * @category Spawning
 */
export type SpawnInput<TLogic extends AnyActorLogic> = [ActorLogic.InputOf<TLogic>] extends [never] ? unknown
  : ActorLogic.InputOf<TLogic>

/**
 * The option keys a spawn of `TLogic` requires (upstream `RequiredLogicInput`): `"input"` when
 * the logic's input type does not take `undefined`, none for a logic that declares no input.
 */
type RequiredSpawnInput<TLogic extends AnyActorLogic> = [ActorLogic.InputOf<TLogic>] extends [never] ? never
  : RequiredActorOptionsKeys<TLogic>

/**
 * The child id a declared actor takes (upstream `TActor['id']`): the declared ids, or any id
 * when the actor declares none. `spawnChild` reads it too.
 *
 * @since 0.1.0
 * @category Spawning
 */
export type DeclaredActorId<TActor extends ProvidedActor> = TActor extends { readonly id?: infer TId }
  ? unknown extends TId ? string | undefined : TId
  : string | undefined

/**
 * The option keys a spawn of a declared actor requires (upstream `RequiredActorOptions`):
 * `"id"` when the actor declares its ids, `"input"` when its logic's input type does not take
 * `undefined`. `spawnChild` reads it too.
 *
 * @since 0.1.0
 * @category Spawning
 */
export type RequiredSpawnKeys<TActor extends ProvidedActor> =
  | (undefined extends DeclaredActorId<TActor> ? never : "id")
  | RequiredSpawnInput<TActor["logic"]>

/** The options argument of a spawn of the declared actor named `TSrc` (upstream `SpawnOptions`). */
type DeclaredSpawnArgs<TActor extends ProvidedActor, TSrc extends string> = TActor extends { readonly src: TSrc }
  ? SpawnArgs<SpawnerOptions<SpawnInput<TActor["logic"]>, DeclaredActorId<TActor>>, RequiredSpawnKeys<TActor>>
  : never

/** The logic of the declared actor named `TSrc` (upstream `GetConcreteByKey<TActor, 'src', TSrc>['logic']`). */
type DeclaredLogic<TActor extends ProvidedActor, TSrc extends string> = TActor extends {
  readonly src: TSrc
  readonly logic: infer TLogic extends AnyActorLogic
}
  ? TLogic
  : never

/**
 * The spawn of a machine whose actor names are not literal (upstream `Spawner` when `src` is
 * not a literal string): any logic, whose input it requires when the logic's input type does
 * not take `undefined`, or any string src with any options.
 */
interface AnySpawner {
  <TLogic extends AnyActorLogic>(
    logic: TLogic,
    ...[options]: SpawnArgs<SpawnerOptions<SpawnInput<TLogic>, string>, RequiredSpawnInput<TLogic>>
  ): ActorRefFromLogic<TLogic>
  (src: string, options?: NamedSpawnOptions): AnyActorRef
}

/**
 * The synchronous spawn that assigners, port action definitions and the context factory
 * receive (upstream `Spawner`): it gives the child's reference at once, adds the child to
 * the machine snapshot's `children` with the action's result, and starts it after the
 * macrostep (D12). A logic whose input type does not take `undefined` needs its `input`.
 *
 * `TActor` is the actors the machine declares (upstream `ProvidedActor`); it has no default, as
 * upstream's has none. With `ProvidedActor`, `spawn` takes any logic, typed by it, or any
 * string src, which names one of the machine's actor implementations: an unknown one fails
 * the action with `Actor logic '<src>' not implemented in machine '<id>'`, and its `input` may
 * be a function of `{ context, event, self }`. With literal source names (a setup's actors),
 * `spawn` takes only those names, with each actor's ids and static input of its logic (the id
 * required when the actor declares ids), or an inline logic with no id; the reference of a
 * name is typed by its logic. The context factory and the assigners of `createMachine`
 * receive `Spawner<ProvidedActor>`; those of a setup machine receive the `Spawner` of the
 * setup's actors.
 *
 * @example
 * ```ts
 * import { assign, createMachine, fromPromise, type ActorRefFrom, type ProvidedActor, type Spawner } from "@jambudipa/xstate-effect"
 *
 * const child = fromPromise(({ input }: { input: number }) => Promise.resolve(input))
 * const spawnChild = (spawn: Spawner<ProvidedActor>) => spawn(child, { input: 42 })
 * createMachine({
 *   types: {} as { context: { ref?: ActorRefFrom<typeof child> } },
 *   context: {},
 *   entry: assign(({ spawn }) => ({ ref: spawnChild(spawn) }))
 * })
 * ```
 *
 * @since 0.1.0
 * @category Spawning
 */
export type Spawner<TActor extends ProvidedActor> = string extends TActor["src"] ? AnySpawner
  // The spawn of a machine that declares its actors (upstream's literal-string branch): a
  // declared src name with that actor's ids, static input and required options, or an inline
  // logic with no id. A type literal, as upstream's, so that the type of an exported setup
  // machine whose context factory or assigner receives `spawn` can be emitted (TS4023 names an
  // interface that the module does not export).
  : {
    <TSrc extends TActor["src"]>(
      src: TSrc,
      ...[options]: DeclaredSpawnArgs<TActor, TSrc>
    ): ActorRefFromLogic<DeclaredLogic<TActor, TSrc>>
    <TLogic extends AnyActorLogic>(
      logic: TLogic,
      ...[options]: SpawnArgs<SpawnerOptions<SpawnInput<TLogic>, never>, RequiredSpawnInput<TLogic>>
    ): ActorRefFromLogic<TLogic>
  }

/**
 * What spawning reads of the machine: its id, for the error text, the actor logic its
 * implementations name (`setup({ actors })`, `createMachine(config, { actors })`, `provide`),
 * and its state nodes by id, whose invocations a source name `xstate.invoke.<index>.<node id>`
 * names.
 *
 * @since 0.1.0
 * @category Models
 */
export interface SpawningMachine {
  /** The machine's id, which the error for an unknown src names. */
  readonly id: string
  /** The machine's implementations; only `actors` is read, and only its own properties. */
  readonly implementations: { readonly actors?: Readonly<Record<string, AnyActorLogic>> }
  /** The state nodes by node id, with their invoke definitions in config order. */
  readonly idMap: HashMap.HashMap<string, { readonly invoke: ReadonlyArray<{ readonly src: string | AnyActorLogic }> }>
}

/** The source name of an invocation's inline logic (upstream `xstate.invoke.<index>.<node id>`). */
const invokeSourceNamePattern = /^xstate\.invoke\.(\d+)\.(.*)/

/**
 * The inline logic of the invocation a source name `xstate.invoke.<index>.<node id>` names
 * (upstream reads `node.config.invoke`; the node's invoke definitions hold the same `src`);
 * none when the node or the invocation does not exist, or its src is a name.
 */
const invokedLogic = (
  machine: SpawningMachine,
  index: string,
  stateNodeId: string
): Option.Option<AnyActorLogic> =>
  Option.flatMap(HashMap.get(machine.idMap, stateNodeId), (stateNode) =>
    Option.flatMap(Option.fromNullishOr(stateNode.invoke[Number(index)]), (invokeDef) =>
      typeof invokeDef.src === "string" ? Option.none() : Option.some(invokeDef.src)
    )
  )

/**
 * The actor logic a string src names (upstream `resolveReferencedActor`): for a source name
 * `xstate.invoke.<index>.<node id>`, the inline logic of that invocation of that node, which
 * is how an invoked child's src and a persisted child name inline logic; for any other name,
 * an own property of the machine's actor implementations; none when the name names nothing.
 *
 * @since 0.1.0
 * @category Spawning
 */
export const resolveReferencedActor = (machine: SpawningMachine, src: string): Option.Option<AnyActorLogic> =>
  Option.match(Option.fromNullishOr(invokeSourceNamePattern.exec(src)), {
    onNone: () =>
      Option.flatMap(Option.fromNullishOr(machine.implementations.actors), (actors) =>
        Object.hasOwn(actors, src) ? Option.fromNullishOr(actors[src]) : Option.none()
      ),
    // The pattern's two groups always take part in a match
    onSome: ([, index = "", stateNodeId = ""]) => invokedLogic(machine, index, stateNodeId),
  })

/** One call of a spawn function: the object it handed out, and the child to build into it or why not. */
interface PendingSpawn {
  /** The unbuilt object `spawn` returned to the user function; `flush` builds the child into it. */
  readonly child: AnyActorRef
  /** The child to build, or the unknown-src error that `flush` turns into a defect. */
  readonly request: Result.Result<SpawnRequest, ActorError>
}

/** The spawn request for `logic`, named `src`, with the options of the call and the input as resolved. */
const requestOf = (
  logic: AnyActorLogic,
  src: string | AnyActorLogic,
  options: NamedSpawnOptions | undefined,
  input: unknown
): SpawnRequest => ({
  logic,
  src,
  id: Option.fromUndefinedOr(options?.id),
  systemId: Option.fromUndefinedOr(options?.systemId),
  input,
  syncSnapshot: options?.syncSnapshot ?? false,
})

/**
 * A spawn function and the step that builds what it spawned.
 *
 * @since 0.1.0
 * @category Models
 */
export interface SpawnSession {
  /** The synchronous spawn the user function receives. */
  readonly spawn: Spawner<ProvidedActor>
  /**
   * Builds the children `spawn` handed out since the last flush, in call order, and gives them
   * by id (upstream `spawnedChildren`). A string src that named no implementation is a defect
   * with the upstream message, at the point of that call, which sets the actor's status to
   * `error` (SD-4); the children built before it stop with the actor's scope (SD-27).
   */
  readonly flush: Effect.Effect<Readonly<Record<string, AnyActorRef>>>
}

/**
 * Creates the spawn function of one action (upstream `createSpawner`), for the actor of
 * `actorScope`, the machine's implementations, and the context and event the action sees.
 * A string src resolves against the implementations, and a function input is called with
 * `{ context, event, self }`; a logic src takes its input as given (upstream). An unknown
 * string src makes the action fail with `Actor logic '<src>' not implemented in machine
 * '<id>'` once it returns: upstream throws inside the user function, which the port never
 * does (SD-3, amended 2026-10-08: no package site throws), so the user function goes on with
 * an object that is never built and the failed macrostep never commits it.
 *
 * @since 0.1.0
 * @category Spawning
 */
export const createSpawner = (
  actorScope: ActorScopeService,
  machine: SpawningMachine,
  context: unknown,
  event: EventObject
): SpawnSession => {
  let pending = Chunk.empty<PendingSpawn>()

  const spawnOne = (src: string | AnyActorLogic, options?: NamedSpawnOptions): AnyActorRef => {
    const child = actorScope.allocateChild()
    const request: Result.Result<SpawnRequest, ActorError> =
      typeof src === "string"
        ? Option.match(resolveReferencedActor(machine, src), {
            onNone: () =>
              Result.fail(
                new ActorError({
                  message: `Actor logic '${src}' not implemented in machine '${machine.id}'`,
                  actorId: actorScope.id,
                })
              ),
            onSome: (logic) =>
              Result.succeed(
                requestOf(
                  logic,
                  src,
                  options,
                  typeof options?.input === "function"
                    ? (options.input as (args: { context: unknown; event: EventObject; self: ActorRefBase }) => unknown)({
                        context,
                        event,
                        self: actorScope.self,
                      })
                    : options?.input
                )
              ),
          })
        : Result.succeed(requestOf(src, src, options, options?.input))
    pending = Chunk.append(pending, { child, request })
    return child
  }

  const flush: Effect.Effect<Readonly<Record<string, AnyActorRef>>> = Effect.gen(function* () {
    const spawns = pending
    pending = Chunk.empty()
    let children: Readonly<Record<string, AnyActorRef>> = {}
    for (const { child, request } of spawns) {
      if (Result.isFailure(request)) {
        return yield* Effect.die(request.failure)
      }
      yield* actorScope.spawnChild(child, request.success)
      // The id is the child's own once it is built: the given one or its session id
      children = { ...children, [child.id]: child }
    }
    return children
  })

  // One function serves both overloads of `Spawner`: a logic gives its typed reference
  return { spawn: spawnOne as Spawner<ProvidedActor>, flush }
}

/**
 * Carries out the spawn a `spawnChild` action asked for (upstream `resolveSpawn` and
 * `executeSpawn`): a string src resolves against the machine's implementations; an unknown
 * one warns `Actor type '<src>' not found in machine '<actor id>'.` and spawns nothing, and
 * its input function never runs. Otherwise the input resolves (a throw of the input
 * function is a defect, the actor's error), and the child is built in the actor's scope and
 * given back with that input, to join `snapshot.children` under the id option (the key
 * "undefined" without one, as upstream); it starts after the macrostep.
 *
 * @since 0.1.0
 * @category Spawning
 */
export const spawnRequested = (
  actorScope: ActorScopeService,
  machine: SpawningMachine,
  request: SpawnChild
): Effect.Effect<Option.Option<{ readonly child: AnyActorRef; readonly input: unknown }>> =>
  Option.match(typeof request.src === "string" ? resolveReferencedActor(machine, request.src) : Option.some(request.src), {
    onNone: () =>
      Effect.as(
        Effect.logWarning(`Actor type '${String(request.src)}' not found in machine '${actorScope.id}'.`),
        Option.none()
      ),
    onSome: (logic) =>
      Effect.suspend(() => {
        const input = request.resolveInput === undefined ? request.input : request.resolveInput()
        const child = actorScope.allocateChild()
        return Effect.as(
          actorScope.spawnChild(child, {
            logic,
            src: request.src,
            id: request.id,
            systemId: request.systemId,
            input,
            syncSnapshot: request.syncSnapshot,
          }),
          Option.some({ child, input })
        )
      }),
  })
