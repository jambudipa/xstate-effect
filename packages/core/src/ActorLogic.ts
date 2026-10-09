/**
 * @since 0.1.0
 * @module ActorLogic
 *
 * ActorLogic defines the behavior of an actor.
 */
import { Effect, Predicate, Context, Option } from "effect"
import type { Scope } from "effect"
import type { Snapshot } from "./Snapshot.js"
import type { EventObject } from "./Event.js"
import type { ActorError, TransitionError, InitializationError, SerializationError, RestoreError, StartError } from "./Errors.js"
import type { ActorRefBase, AnyActorRef } from "./ActorRef.js"
import type { UpstreamAny } from "./internal/anyEventObject.js"
import type {
  Action,
  ActionArgs,
  ActionContext,
  ActionDefinition,
  ActionFunction,
  ActionImplementation,
  MachineImplementations,
  ParameterizedAction,
  Spawner,
  Variance,
} from "./Types.js"
import { ActionResult } from "./Types.js"
import { evaluateGuard } from "./guards/evaluateGuard.js"
import { runCustomAction } from "./internal/customAction.js"
import { resolveDelay } from "./internal/delay.js"

// ============================================================
// ACTOR LOGIC TYPE ID
// ============================================================

/**
 * Type ID for ActorLogic.
 *
 * @since 0.1.0
 * @category Type ID
 */
export const ActorLogicTypeId: unique symbol = Symbol.for("@xstate-effect/ActorLogic")

/**
 * Type ID type for ActorLogic.
 *
 * @since 0.1.0
 * @category Type ID
 */
export type ActorLogicTypeId = typeof ActorLogicTypeId

// ============================================================
// ACTOR SCOPE TAG
// ============================================================

/**
 * ActorScope service provides access to actor context during transitions.
 *
 * @since 0.1.0
 * @category Services
 */
export interface ActorScopeService {
  /** Reference to the current actor */
  readonly self: ActorRefBase

  /** Actor ID */
  readonly id: string

  /** Session ID */
  readonly sessionId: string

  /** Actor system */
  readonly system: ActorSystemService

  /**
   * The function the actor's `log` actions call (upstream `actorScope.logger`): the actor's
   * `logger` option, else its system's (the root actor's `logger` option). `None` logs
   * through Effect logging at the action's level, with the actor's annotations (C12).
   */
  readonly logger: Option.Option<(...args: ReadonlyArray<unknown>) => void>

  /** Defers an effect to be executed after the current transition */
  readonly defer: (effect: Effect.Effect<void>) => Effect.Effect<void>

  /**
   * Delivers an event to the actor's listeners at once (upstream `actorScope.emit`). The
   * engine defers each emit of a macrostep with `defer`, so listeners run after the commit.
   */
  readonly emit: (event: EventObject) => Effect.Effect<void>

  /**
   * Stops a child of this actor (upstream `executeStop` and `actorScope.stopChild`): the
   * child and its descendants give up their systemIds at once; a child that has not started
   * stops at once and never starts; a running child stops after the events already sent to
   * it, before the next deferred effect of the macrostep. An actor that is not a child is a
   * defect with the upstream message, which the macrostep turns into status `error` (SD-4).
   */
  readonly stopChild: (child: ActorRefBase) => Effect.Effect<void>

  /**
   * Runs an action's execution (upstream `actionExecutor`): a custom action, or the execution
   * of a built-in action that has one (raise, sendTo, emit, log, cancel, spawnChild,
   * stopChild). It sends the `@xstate.action` inspection event, then runs the execution. An
   * actor that is not running yet queues both until `start`, so the initial actions computed
   * at creation run at `start`. The pure helpers' inert scope runs none (P7).
   */
  readonly actionExecutor: (action: CustomActionExecution) => Effect.Effect<void>

  /**
   * The object a child of this actor is built into (D12). XState's `spawn` returns the
   * child at once; the port creates the child with an Effect, so `spawn` returns this object
   * and `spawnChild` builds the child into it once the user function has returned.
   */
  readonly allocateChild: () => AnyActorRef

  /**
   * Builds a child of this actor into `child`, an object `allocateChild` gave (upstream
   * `createActor(logic, { parent: self, ... })` in `spawn` and `spawnChild`): the child joins
   * this actor's system, lives in this actor's scope (D12) and registers its systemId. It is
   * not started: it starts after the current macrostep, or at `start` for a spawn in the
   * initial snapshot (upstream `actorScope.defer`), unless it is stopped before. A systemId in
   * use is a defect, which the macrostep turns into status `error` (SD-4).
   */
  readonly spawnChild: (child: ActorRefBase, request: SpawnRequest) => Effect.Effect<void>

  /**
   * Creates a child of this actor from its entry in a persisted snapshot (upstream
   * `createActor(logic, { id, parent: self, syncSnapshot, snapshot, src, systemId })` in
   * `StateMachine.restoreSnapshot`): the child joins this actor's system, lives in this
   * actor's scope (D12), registers its systemId while its snapshot is active, and computes its
   * snapshot through its logic's `restoreSnapshot`. It is not started: the machine's `start`
   * starts each active child. A systemId in use is a defect, which gives this actor status
   * `error` (SD-4, SD-8).
   */
  readonly restoreChild: (request: RestoreChildRequest) => Effect.Effect<AnyActorRef>

  /**
   * Starts a child of this actor that has not started (upstream `child.start()` in
   * `StateMachine.start`); a child that has started, stopped or ended does not change.
   */
  readonly startChild: (child: ActorRefBase) => Effect.Effect<void>
}

/**
 * What the restore of one child asks for (upstream `createActor` options in
 * `StateMachine.restoreSnapshot`): the logic its src names, that src, its id, its systemId,
 * whether it syncs its snapshot to its parent, and its persisted snapshot (none gives the
 * logic's initial snapshot, as upstream when the entry has none).
 *
 * @since 0.1.0
 * @category Services
 */
export interface RestoreChildRequest {
  /** The logic the persisted `src` resolves to; it restores the child's snapshot. */
  readonly logic: AnyActorLogic
  /** The src as persisted: an implementation name, or the logic itself. The child keeps it. */
  readonly src: string | AnyActorLogic
  /** The child's id as persisted: the key it has in its parent's `children`. */
  readonly id: string
  /** The systemId to register while the child's snapshot is active; `None` registers none. */
  readonly systemId: Option.Option<string>
  /** Whether the child relays its snapshots to its parent as `xstate.snapshot.<id>` events. */
  readonly syncSnapshot: boolean
  /** The persisted snapshot as stored, before `restoreSnapshot` decodes it. */
  readonly snapshot: Option.Option<unknown>
}

/**
 * What one spawn asks for (upstream `createActor` options in `spawn` and `spawnChild`): the
 * logic, the src it was named by, the id (the session id when none), the systemId, the input
 * as resolved, and whether the child syncs its snapshot to its parent.
 *
 * @since 0.1.0
 * @category Services
 */
export interface SpawnRequest {
  /** The logic to run, already resolved from `src`. */
  readonly logic: AnyActorLogic
  /** The src as the spawn named it: an implementation name, or the logic itself. The child keeps it. */
  readonly src: string | AnyActorLogic
  /** The child's id; `None` gives the session id the system books for it. */
  readonly id: Option.Option<string>
  /** The systemId to register; one already in use is a defect that errors the parent (SD-4). */
  readonly systemId: Option.Option<string>
  /** The input the child's logic gets, as the spawn resolved it; it is not resolved again. */
  readonly input: unknown
  /** Whether the child relays its snapshots to its parent as `xstate.snapshot.<id>` events. */
  readonly syncSnapshot: boolean
}

/**
 * The arguments an executable action runs with (upstream `ExecutableActionObject.info`,
 * `ActionArgs<MachineContext, EventObject, EventObject>`): the context at the action's point of
 * its list, the event, the actor (`self`) and its system. The context is `unknown`, as the port
 * types any context, not only objects.
 *
 * @since 0.1.0
 * @category Services
 */
export interface ExecutableActionInfo {
  /** The context the earlier actions of the same list left, not the one before the list. */
  readonly context: unknown
  /** The event the macrostep is processing. */
  readonly event: EventObject
  /** The actor that runs the action. */
  readonly self: AnyActorRef
  /** The actor's system. */
  readonly system: ActorSystemService
}

/**
 * One action execution as the engine hands it to the actor's action executor (upstream
 * `ExecutableActionObject`): a custom action, or a built-in action's execution; its type, its
 * arguments (`info`), the params of this use, and what runs it. For a built-in action the params are the resolved
 * ones (upstream's `resolve` result).
 *
 * @since 0.1.0
 * @category Services
 */
export interface CustomActionExecution {
  /** The action's type, as the `@xstate.action` inspection event reports it. */
  readonly type: string
  /**
   * The arguments of this use (upstream `info`, the `ActionArgs` of the action's point of the
   * list): the context the earlier actions left, the event, the actor and its system.
   */
  readonly info: ExecutableActionInfo
  /** The params of this use; `undefined` when it has none. */
  readonly params: unknown
  /**
   * Runs the action with the arguments resolved for it; `Effect.void` without an
   * implementation, or for a built-in action whose work the engine did already.
   */
  readonly exec: Effect.Effect<void>
}

// ============================================================
// ACTOR SYSTEM SERVICE (forward declaration)
// ============================================================

/**
 * ActorSystemService provides actor registration and communication (upstream
 * `ActorSystem`). The system keeps every started actor by session id and, apart from that,
 * the actors that have a `systemId`; `get` and `getAll` read only the systemId registry (D7).
 * This is a forward declaration to avoid circular imports.
 *
 * @since 0.1.0
 * @category Services
 */
export interface ActorSystemService {
  /** Books the next session id of this system: `x:0`, `x:1`, … (upstream `_bookId`, SD-9) */
  readonly generateId: Effect.Effect<string>

  /** Registers an actor under its session id (upstream `_register`); gives the session id back */
  readonly register: (sessionId: string, actor: ActorRefBase) => Effect.Effect<string>

  /**
   * Unregisters an actor (upstream `_unregister`): drops its session id and, when it has
   * one, its systemId, which is then free for another actor.
   */
  readonly unregister: (actor: ActorRefBase) => Effect.Effect<void>

  /**
   * Registers `actor` under `systemId` (upstream `_set`). Registering the same actor again
   * changes nothing; another actor under a systemId in use fails with the upstream message
   * `Actor with system ID '<systemId>' already exists.`.
   */
  readonly _set: (systemId: string, actor: ActorRefBase) => Effect.Effect<void, ActorError>

  /**
   * The actor registered under `systemId`, or `None` (upstream `get`, D7). Without a type
   * argument it is an {@link AnyActorRef}, which takes any event, as upstream's `any` does.
   */
  readonly get: <T extends ActorRefBase = AnyActorRef>(systemId: string) => Effect.Effect<Option.Option<T>>

  /**
   * The synchronous form of `get`, for engine code that resolves an actor inside a
   * transition (D7). Internal: user code reads the system through `get`.
   */
  readonly _lookup: (systemId: string) => Option.Option<ActorRefBase>

  /**
   * The actors registered under a systemId, as a new record keyed by systemId in
   * registration order (upstream `getAll`). Actors without a systemId are not in it.
   */
  readonly getAll: Effect.Effect<Readonly<Record<string, ActorRefBase>>>

  /** Relays an event from one actor to another */
  readonly relay: (source: ActorRefBase, target: ActorRefBase, event: EventObject) => Effect.Effect<void>

  /** Scheduler service */
  readonly scheduler: SchedulerService

  /**
   * The system snapshot (upstream `getSnapshot`): a new record of the pending delayed events,
   * keyed `<sessionId>.<id>` of the actor that scheduled each one (upstream
   * `_scheduledEvents`). An event leaves it when it fires or is cancelled.
   */
  readonly getSnapshot: Effect.Effect<SystemSnapshot>

  /**
   * The system's clock (upstream `_clock`): the root actor's `clock` option, else a clock on
   * the Effect clock. An actor's `clock` defaults to it.
   */
  readonly _clock: import("./ActorSystem.js").Clock

  /**
   * The system's logger (upstream `_logger`): the root actor's `logger` option, or `None`
   * for Effect logging. An actor's logger defaults to it, so every child of the root logs
   * through it unless it was created with a logger of its own.
   */
  readonly _logger: Option.Option<(...args: ReadonlyArray<unknown>) => void>

  /**
   * Registers an inspection function (upstream `inspect`, function form only, SD-18) until the
   * scope it runs in closes. Each call is its own registration, also for a function that is
   * registered already. The functions run for each inspection event one after another, in
   * registration order; one that throws, fails or dies is reported through the logger and
   * changes no actor (SD-21).
   */
  readonly inspect: (observer: (event: import("./Types.js").InspectionEvent) => Effect.Effect<void>) => Effect.Effect<void, never, import("effect").Scope.Scope>

  /**
   * Internal (upstream `_sendInspectionEvent`): hands an inspection event to every inspection
   * function of the system, with `rootId`, the session id of the system's root actor.
   */
  readonly _sendInspectionEvent: (event: import("./inspection.js").InspectionEventInput) => Effect.Effect<void>
}

/**
 * The actors a system declares, by systemId (upstream `ActorSystemInfo`).
 *
 * @example
 * ```ts
 * type Info = { actors: { receiver: ActorRef<Snapshot<unknown>, { type: "HELLO" }> } }
 * ```
 *
 * @since 0.1.0
 * @category Services
 */
export interface ActorSystemInfo {
  /** The reference type of each declared actor, by its systemId. */
  readonly actors: Readonly<Record<string, ActorRefBase>>
}

/**
 * An actor system whose `get` and `getAll` are typed by the actors it declares (upstream
 * `ActorSystem<T>`, a root type there): `get` gives the declared reference of a systemId,
 * `getAll` a record of the declared references. A cast of an action's `system` to it types
 * what the action reads (upstream system.test).
 *
 * @example
 * ```ts
 * type MySystem = TypedActorSystem<{ actors: { receiver: ActorRef<Snapshot<unknown>, { type: "HELLO" }> } }>
 * const receiver = yield* (system as MySystem).get("receiver") // Option of that reference
 * ```
 *
 * @since 0.1.0
 * @category Services
 */
export interface TypedActorSystem<T extends ActorSystemInfo> extends Omit<ActorSystemService, "get" | "getAll"> {
  /** The actor registered under `systemId`, or `None` (as {@link ActorSystemService}'s `get`) */
  readonly get: <K extends keyof T["actors"] & string>(systemId: K) => Effect.Effect<Option.Option<T["actors"][K]>>
  /** The actors registered under a systemId, by systemId (as {@link ActorSystemService}'s `getAll`) */
  readonly getAll: Effect.Effect<Partial<T["actors"]>>
}

/**
 * A pending delayed event (upstream `ScheduledEvent` in `system.ts`): the actor that
 * scheduled it, the actor it goes to, the event, its delay in milliseconds, its id, and the
 * time it was scheduled at on the system's clock (`startedAt`). It fires at
 * `startedAt + delay`.
 *
 * @since 0.1.0
 * @category Models
 */
export interface ScheduledEvent {
  /** The actor that scheduled the event: its session id is part of the event's key. */
  readonly source: ActorRefBase
  /** The actor the event goes to: the source itself for a delayed `raise`. */
  readonly target: ActorRefBase
  /** The event to deliver. */
  readonly event: EventObject
  /** The delay in milliseconds as scheduled; a restored event keeps it (P4). */
  readonly delay: number
  /**
   * The action's `id`, or a generated `xstate.scheduled.<n>` for one without: the id that
   * `cancel` takes.
   */
  readonly id: string
  /** The clock's time in milliseconds when the event was scheduled. */
  readonly startedAt: number
}

/**
 * The snapshot of an actor system (upstream `ActorSystem.getSnapshot`): its pending delayed
 * events, keyed `<sessionId>.<id>`.
 *
 * @since 0.1.0
 * @category Models
 */
export interface SystemSnapshot {
  /** The pending delayed events, keyed `<sessionId>.<id>`; a copy taken at the read. */
  readonly _scheduledEvents: Readonly<Record<string, ScheduledEvent>>
}

/**
 * SchedulerService for delayed events.
 *
 * @since 0.1.0
 * @category Services
 */
export interface SchedulerService {
  /**
   * Schedules `event` from `source` to `target` after `delayMs` milliseconds, under `id` or a
   * fresh id; the record's `startedAt` is the clock's time now.
   */
  readonly schedule: (
    source: ActorRefBase,
    target: ActorRefBase,
    event: EventObject,
    delayMs: number,
    id: import("effect").Option.Option<string>
  ) => Effect.Effect<void>

  /**
   * Cancels the pending event `id` of `source` (upstream `cancel`): its timer is cleared and it
   * never fires. An id that is not pending, because it fired or never existed, changes nothing.
   */
  readonly cancel: (source: ActorRefBase, id: string) => Effect.Effect<void>

  /**
   * Cancels every pending event that `actor` scheduled; the actor's end runs it. Events that
   * other actors scheduled for `actor` are not cancelled.
   */
  readonly cancelAll: (actor: ActorRefBase) => Effect.Effect<void>

  /**
   * Schedules a restored event again (P4): it keeps its id, `delay` and `startedAt`, and
   * fires after the time left, `startedAt + delay` minus the clock's time now. An event whose
   * time has passed is delivered at once, so it fires once.
   */
  readonly resume: (scheduled: ScheduledEvent) => Effect.Effect<void>

  /** The pending delayed events, keyed `<sessionId>.<id>` (a new record per read). */
  readonly scheduledEvents: Effect.Effect<Readonly<Record<string, ScheduledEvent>>>
}

/**
 * ActorScope context tag.
 *
 * @since 0.1.0
 * @category Services
 */
export class ActorScope extends Context.Service<
  ActorScope,
  ActorScopeService
>()("@xstate-effect/ActorScope") {}

// ============================================================
// ACTOR LOGIC INTERFACE
// ============================================================

/**
 * ActorLogic defines the behavior of an actor.
 *
 * This is the core interface that all actor types implement.
 * It defines how an actor:
 * - Transitions between states in response to events
 * - Creates its initial snapshot
 * - Persists and restores its state
 * - Starts up
 *
 * @since 0.1.0
 * @category Actor Logic
 */
export interface ActorLogic<
  in out TSnapshot extends Snapshot,
  in out TEvent extends EventObject,
  in TInput,
  out TEmitted extends EventObject = EventObject,
  out R = never
> {
  /** The type-level variance markers; at run time only its presence marks the object as logic. */
  readonly [ActorLogicTypeId]: Variance.ActorLogic<TSnapshot, TEvent, TInput, TEmitted, R>

  /**
   * Optional configuration object for the actor logic.
   */
  readonly config?: unknown

  /**
   * Computes the next snapshot given the current snapshot and an event.
   *
   * This is the core transition function that defines how the actor
   * responds to events.
   */
  readonly transition: (
    snapshot: TSnapshot,
    event: TEvent
  ) => Effect.Effect<TSnapshot, TransitionError, ActorScope | R>

  /**
   * Creates the initial snapshot for this actor.
   *
   * Called when the actor is first created with its input.
   */
  readonly getInitialSnapshot: (
    input: TInput
  ) => Effect.Effect<TSnapshot, InitializationError, ActorScope | R>

  /**
   * Restores a snapshot from persisted state.
   *
   * Optional - if not provided, actors cannot be restored from persistence.
   */
  readonly restoreSnapshot?: (
    persisted: unknown
  ) => Effect.Effect<TSnapshot, RestoreError, ActorScope | R>

  /**
   * Called when the actor starts.
   *
   * Optional - used for actors that need to perform setup actions. It runs in the actor's
   * own scope (D12): a fiber it forks with `Effect.forkScoped`, or a finalizer it adds, lives
   * until the actor stops, is done or errors.
   */
  readonly start?: (
    snapshot: TSnapshot
  ) => Effect.Effect<void, StartError, ActorScope | Scope.Scope | R>

  /**
   * Serializes a snapshot for persistence.
   *
   * The returned value should be JSON-serializable.
   */
  readonly getPersistedSnapshot: (
    snapshot: TSnapshot
  ) => Effect.Effect<unknown, SerializationError>
}

/**
 * Type guard for ActorLogic.
 *
 * @since 0.1.0
 * @category Guards
 */
export const isActorLogic = (u: unknown): u is ActorLogic.Any =>
  Predicate.hasProperty(u, ActorLogicTypeId)

// ============================================================
// ACTOR LOGIC NAMESPACE
// ============================================================

/**
 * @since 0.1.0
 * @category Actor Logic
 */
export declare namespace ActorLogic {
  /**
   * Extract the Snapshot type from an ActorLogic. Every parameter is inferred: the snapshot
   * and event parameters are invariant, so a fixed bound would reject a concrete logic.
   *
   * @since 0.1.0
   */
  export type SnapshotOf<T> = T extends ActorLogic<infer S, infer _E, infer _I, infer _Em, infer _R> ? S : never

  /**
   * Extract the Event type from an ActorLogic.
   *
   * @since 0.1.0
   */
  export type EventOf<T> = T extends ActorLogic<infer _S, infer E, infer _I, infer _Em, infer _R> ? E : never

  /**
   * Extract the Input type from an ActorLogic.
   *
   * @since 0.1.0
   */
  export type InputOf<T> = T extends ActorLogic<infer _S, infer _E, infer I, infer _Em, infer _R> ? I : never

  /**
   * Extract the Emitted type from an ActorLogic.
   *
   * @since 0.1.0
   */
  export type EmittedOf<T> = T extends ActorLogic<infer _S, infer _E, infer _I, infer Em, infer _R> ? Em : never

  /**
   * Extract the Requirements type from an ActorLogic.
   *
   * @since 0.1.0
   */
  export type RequirementsOf<T> = T extends ActorLogic<infer _S, infer _E, infer _I, infer _Em, infer R> ? R : never

  /**
   * Any ActorLogic type.
   *
   * @since 0.1.0
   */
  export type Any = ActorLogic<Snapshot, EventObject, unknown>
}

/**
 * Any actor logic, whatever its snapshot, event, input, emitted and requirement types
 * (upstream `AnyActorLogic`). `ActorLogic.Any` fixes those types, and the snapshot and event
 * parameters are invariant, so a concrete logic is not an `ActorLogic.Any`; every
 * `ActorLogic<S, E, I, Em, R>`, a state machine included, is an `AnyActorLogic`. Its input
 * and event are upstream's `any` (SD-22 amendment 2026-10-07), so an inline logic written as
 * an invocation's `src` reads any member of its input and of the events it receives.
 *
 * Its `transition` is a method, whose snapshot parameter TypeScript compares both ways (as
 * `AnyActorRef`'s `send`, SD-22): it takes any snapshot, as upstream's `any` does, and every
 * logic still fits. It gives a snapshot with the `value` and `context` of a machine's as
 * optional `unknown` (`AnyActorRef`'s snapshot), so a logic that wraps any logic passes the
 * snapshot it receives to the wrapped `transition` and reads what it gives (upstream
 * `actorLogic.test.ts`, "composable actor logic").
 *
 * @since 0.1.0
 * @category Actor Logic
 */
export interface AnyActorLogic {
  /** The marker every logic carries; its variance is not checked here. */
  readonly [ActorLogicTypeId]: unknown
  /** {@link ActorLogic}'s `transition`, with any snapshot and any event. */
  transition(
    snapshot: Snapshot,
    event: UpstreamAny
  ): Effect.Effect<Snapshot & { readonly value?: unknown; readonly context?: unknown }, unknown, unknown>
  /** {@link ActorLogic}'s `getInitialSnapshot`, with any input. */
  readonly getInitialSnapshot: (input: UpstreamAny) => Effect.Effect<Snapshot, unknown, unknown>
  /** {@link ActorLogic}'s `getPersistedSnapshot`; `never` admits every logic's snapshot type. */
  readonly getPersistedSnapshot: (snapshot: never) => Effect.Effect<unknown, unknown>
  /** {@link ActorLogic}'s optional `restoreSnapshot`; absent when the logic cannot restore. */
  readonly restoreSnapshot?: (persisted: never) => Effect.Effect<Snapshot, unknown, unknown>
  /** {@link ActorLogic}'s optional `start`; absent when the logic needs no start step. */
  readonly start?: (snapshot: never) => Effect.Effect<void, unknown, unknown>
}

// ============================================================
// ACTOR LOGIC CONSTRUCTORS
// ============================================================

// ============================================================
// CONTEXT CONSTRUCTION HELPERS
// ============================================================

/**
 * The Effect form of a spawn function for the children of one parent (`createSpawnFunction`
 * in the Actor module): it creates and starts a child. Actions and assigners get the
 * synchronous `Spawner` instead.
 *
 * @deprecated The public type of a spawn is `Spawner` (a root type export, as upstream), the
 * `spawn` that assigners and the context factory receive. This port extra stays for existing
 * users (ledger DEV-43); `ReturnType<typeof Actor.createSpawnFunction>` names the same type.
 *
 * @since 0.1.0
 * @category Context Construction
 */
export type SpawnFunction = <TLogic extends AnyActorLogic>(
  logic: TLogic,
  options?: import("./Types.js").SpawnOptions<TLogic>
) => Effect.Effect<
  import("./ActorRef.js").ActorRef<
    ActorLogic.SnapshotOf<TLogic>,
    ActorLogic.EventOf<TLogic>,
    ActorLogic.EmittedOf<TLogic>
  >,
  never,
  import("effect").Scope.Scope
>

/**
 * Creates the argument object of the XState action forms (upstream `actionArgs` in
 * `resolveAndExecuteActionsWithContext`): exactly `{ context, event, self, system }`, with
 * the context of `snapshot`.
 *
 * @since 0.1.0
 * @category Context Construction
 */
export const createActionArgs = <TContext, TEvent extends EventObject>(
  scope: ActorScopeService,
  snapshot: import("./Snapshot.js").MachineSnapshot<TContext, EventObject, Record<string, import("./ActorRef.js").ActorRefBase>, import("./StateValue.js").StateValue, string, unknown>,
  event: TEvent
): ActionArgs<TContext, TEvent> => ({
  // Type information comes from the parameters
  context: snapshot.context,
  event: event,

  // The self reference is the machine actor: its snapshot is the machine snapshot of this
  // context (upstream `ActionArgs`); a safe cast, as the types come from the machine definition
  self: scope.self as import("./ActorRef.js").ActorRef<
    import("./Snapshot.js").MachineSnapshot<TContext>,
    TEvent,
    EventObject
  >,

  // System is fully typed
  system: scope.system,
})

/**
 * Creates the `info` of an executable action (upstream `actionArgs`, which
 * `resolveAndExecuteActionsWithContext` gives each `actionExecutor` call): the context at the
 * action's point of the list, the event, the actor and its system.
 *
 * @since 0.1.0
 * @category Context Construction
 */
export const createActionInfo = (scope: ActorScopeService, context: unknown, event: EventObject): ExecutableActionInfo => ({
  context,
  event,
  // The actor scope's self is the actor that runs the list, a reference of any actor
  self: scope.self as AnyActorRef,
  system: scope.system,
})

/**
 * Creates a typed ActionContext from untyped ActorScopeService: the XState argument object
 * (`createActionArgs`) plus the port's `defer`, `emit`, `spawn`, `stopChild` and `children`,
 * which port `ActionDefinition`s and assigners receive. `spawn` is the synchronous spawn
 * function the engine made for this action (upstream `createSpawner`): the children it returns
 * belong to this actor (D12). `children` are the snapshot's. `implementations` are the machine's (upstream `snapshot.machine`): the
 * context's `evaluateGuard` and `resolveDelay` resolve guard and delay names against them
 * (none by default).
 *
 * This is the key bridge between Layer 1 (runtime communication)
 * and Layer 2 (generic logic). Called internally when executing actions.
 *
 * Type information comes from the PARAMETERS (snapshot, event),
 * not from the ActorScopeService which remains untyped.
 *
 * @since 0.1.0
 * @category Context Construction
 */
export const createActionContext = <TContext, TEvent extends EventObject>(
  scope: ActorScopeService,
  snapshot: import("./Snapshot.js").MachineSnapshot<TContext, EventObject, Record<string, import("./ActorRef.js").ActorRefBase>, import("./StateValue.js").StateValue, string, unknown>,
  event: TEvent,
  spawn: Spawner,
  implementations: MachineImplementations<TContext, TEvent> = {}
): import("./Types.js").ActionContext<TContext, TEvent> => ({
  ...createActionArgs(scope, snapshot, event),

  // Delegate to scope methods. An emit reaches the listeners after the macrostep commits,
  // as the `emit` action's does (upstream `executeEmit`)
  defer: scope.defer,
  emit: (event) => scope.defer(scope.emit(event)),
  stopChild: scope.stopChild,
  spawn,
  children: snapshot.children,

  // The machine's guards and delays, with the context and the event of this action; a guard
  // reads the snapshot of this point of the action list (upstream `check`)
  evaluateGuard: (guard) =>
    evaluateGuard(guard, snapshot.context, event, { self: scope.self, system: scope.system, implementations, snapshot }),
  resolveDelay: (name, params) => resolveDelay(implementations, name, createActionArgs(scope, snapshot, event), params),
})

/**
 * Creates a typed GuardContext from untyped ActorScopeService.
 *
 * @since 0.1.0
 * @category Context Construction
 */
export const createGuardContext = <TContext, TEvent extends EventObject>(
  scope: ActorScopeService,
  snapshot: import("./Snapshot.js").MachineSnapshot<TContext, EventObject, Record<string, import("./ActorRef.js").ActorRefBase>, import("./StateValue.js").StateValue, string, unknown>,
  event: TEvent
): import("./Types.js").GuardContext<TContext, TEvent> => ({
  context: snapshot.context,
  event: event,
  self: scope.self,
  system: scope.system,
  snapshot,
})

// ============================================================
// ACTION RESOLUTION
// ============================================================

/**
 * One action resolved for one use (upstream `ExecutableActionObject`): its type, the params
 * of this use, whether the actor's action executor runs it, and what runs it.
 *
 * @since 0.1.0
 * @category Actions
 */
export interface ExecutableAction<TContext, TEvent extends EventObject> {
  /** The name, the definition's `type`, or an inline function's name (`'(anonymous)'` without one). */
  readonly type: string
  /**
   * The params of this use: none for an inline function, a string reference and an
   * `undefined` value. The action receives none as `undefined`, as upstream.
   */
  readonly params: Option.Option<unknown>
  /**
   * Whether it is a custom action (an inline function, a named implementation that is a
   * function, or a name without implementation): the action executor sends an
   * `@xstate.action` inspection event for it before it runs it. A port `ActionDefinition`
   * resolves like an upstream built-in action instead.
   */
  readonly custom: boolean
  /** Runs it with the port action context; none for a name without implementation. */
  readonly exec: Option.Option<(ctx: ActionContext<TContext, TEvent>) => Effect.Effect<ActionResult>>
}

/** Whether an action is a port `ActionDefinition`: an object with an `exec` function (D15). */
const isActionDefinition = <TContext, TEvent extends EventObject>(
  action: Exclude<Action<TContext, TEvent>, string>
): action is ActionDefinition<TContext, TEvent> => Predicate.hasProperty(action, "exec") && Predicate.isFunction(action.exec)

/**
 * The params of one `{ type, params }` use (upstream): the static value as written, or the
 * params function's result for the context and the event; none for `undefined`.
 */
const resolveParams = <TContext, TEvent extends EventObject>(
  action: ParameterizedAction<TContext, TEvent>,
  context: TContext,
  event: TEvent
): Option.Option<unknown> =>
  Option.fromUndefinedOr<unknown>(typeof action.params === "function" ? action.params({ context, event }) : action.params)

/** An action name's implementation, looked up as an own property of the implementations. */
const lookupImplementation = <TContext, TEvent extends EventObject>(
  implementations: MachineImplementations<TContext, TEvent>,
  type: string
): Option.Option<ActionImplementation<TContext, TEvent>> =>
  Option.flatMap(Option.fromNullishOr(implementations.actions), (actions) =>
    Object.hasOwn(actions, type) ? Option.fromNullishOr(actions[type]) : Option.none()
  )

/**
 * Runs a custom action function: calls it with the XState argument object and the params,
 * then runs the Effect it returns (port extension); any other return value is ignored. What
 * the function throws, and what its Effect fails or dies with, is a defect that carries the
 * original value: the macrostep stops there and the actor's error is that value (SD-4). The
 * engine never catches it; only the actor does. A built-in action creator that the
 * function calls logs upstream's custom-action warning (`runCustomAction`).
 */
const runActionFunction =
  <TContext, TEvent extends EventObject>(fn: ActionFunction<TContext, TEvent, never>, params: Option.Option<unknown>) =>
  (ctx: ActionContext<TContext, TEvent>): Effect.Effect<ActionResult> =>
    runCustomAction((): unknown =>
      fn(
        { context: ctx.context, event: ctx.event, self: ctx.self, system: ctx.system },
        // An implementation declares its own params type; the engine passes the params of the use
        Option.getOrUndefined(params) as never
      )
    ).pipe(
      // The function's type does not say what an Effect it returns needs or fails with
      Effect.flatMap((returned) => (Effect.isEffect(returned) ? (returned as Effect.Effect<unknown, unknown>) : Effect.void)),
      Effect.orDie,
      Effect.as(ActionResult.NoOp())
    )

/**
 * Runs a port definition with the given params. Its type admits no failure; a failure it has
 * at run time all the same (an assigner's Effect, a cast) is a defect that carries the
 * original value, as for an action function (SD-4).
 */
const runActionDefinition =
  <TContext, TEvent extends EventObject>(
    definition: Pick<ActionDefinition<TContext, TEvent, never>, "exec">,
    params: Option.Option<unknown>
  ) =>
  (ctx: ActionContext<TContext, TEvent>): Effect.Effect<ActionResult> =>
    // An implementation declares its own params type; the engine passes the params of the use
    Effect.suspend(() => definition.exec(ctx, Option.getOrUndefined(params) as never)).pipe(Effect.orDie)

/**
 * Resolves one action for one use (upstream `resolveAndExecuteActionsWithContext`, per
 * action), with the context the earlier actions of the list left:
 *
 * - an inline function is a custom action with `undefined` params;
 * - a port `ActionDefinition` runs with its own `params` (D15);
 * - a string names an implementation, called with `undefined` params;
 * - `{ type, params }` names an implementation, called with the params of this use: the
 *   static value, or `params({ context, event })`.
 *
 * A named implementation is a plain function (a custom action) or a port definition; params
 * stored on the definition play no part. A name without implementation is a custom action
 * with nothing to run: not an error, as upstream.
 *
 * @since 0.1.0
 * @category Actions
 */
export const resolveAction = <TContext, TEvent extends EventObject>(
  implementations: MachineImplementations<TContext, TEvent>,
  action: Action<TContext, TEvent>,
  context: TContext,
  event: TEvent
): ExecutableAction<TContext, TEvent> => {
  if (typeof action === "function") {
    const params = Option.none()
    return {
      type: action.name === "" ? "(anonymous)" : action.name,
      params,
      custom: true,
      exec: Option.some(runActionFunction<TContext, TEvent>(action, params)),
    }
  }
  if (typeof action !== "string" && isActionDefinition(action)) {
    const params = Option.fromUndefinedOr<unknown>(action.params)
    return { type: action.type, params, custom: false, exec: Option.some(runActionDefinition(action, params)) }
  }
  const type = typeof action === "string" ? action : action.type
  const params = typeof action === "string" ? Option.none() : resolveParams(action, context, event)
  return Option.match(lookupImplementation(implementations, type), {
    onNone: (): ExecutableAction<TContext, TEvent> => ({ type, params, custom: true, exec: Option.none() }),
    onSome: (implementation): ExecutableAction<TContext, TEvent> =>
      typeof implementation === "function"
        ? { type, params, custom: true, exec: Option.some(runActionFunction<TContext, TEvent>(implementation, params)) }
        : { type, params, custom: false, exec: Option.some(runActionDefinition(implementation, params)) },
  })
}

// ============================================================
// ACTOR LOGIC CONSTRUCTORS
// ============================================================

/**
 * Creates variance markers for ActorLogic TypeId.
 *
 * This helper creates the variance object without using `{} as` casts.
 * The variance markers are purely type-level - they have no runtime behavior.
 *
 * @internal
 */
const makeActorLogicVariance = <
  TSnapshot extends Snapshot,
  TEvent extends EventObject,
  TInput,
  TEmitted extends EventObject,
  R
>(): Variance.ActorLogic<TSnapshot, TEvent, TInput, TEmitted, R> => ({
  _Snapshot: (_: TSnapshot): TSnapshot => _,
  _Event: (_: TEvent): TEvent => _,
  _Input: (_: TInput) => _,
  _Emitted: (_: never): TEmitted => _,
  _R: (_: never): R => _,
})

/**
 * Creates an ActorLogic from a config object (exported as `makeActorLogic`): the functions
 * as given, with the type ID added. An absent optional member (`restoreSnapshot`, `start`,
 * `config`) stays absent on the result, so an actor treats the logic as one without it.
 *
 * @since 0.1.0
 * @category Constructors
 */
export const make = <
  TSnapshot extends Snapshot,
  TEvent extends EventObject,
  TInput,
  TEmitted extends EventObject = EventObject,
  R = never
>(config: {
  readonly transition: (
    snapshot: TSnapshot,
    event: TEvent
  ) => Effect.Effect<TSnapshot, TransitionError, ActorScope | R>

  readonly getInitialSnapshot: (
    input: TInput
  ) => Effect.Effect<TSnapshot, InitializationError, ActorScope | R>

  readonly getPersistedSnapshot: (
    snapshot: TSnapshot
  ) => Effect.Effect<unknown, SerializationError>

  readonly restoreSnapshot?: (
    persisted: unknown
  ) => Effect.Effect<TSnapshot, RestoreError, ActorScope | R>

  readonly start?: (
    snapshot: TSnapshot
  ) => Effect.Effect<void, StartError, ActorScope | R>

  readonly config?: unknown
}): ActorLogic<TSnapshot, TEvent, TInput, TEmitted, R> => {
  const result: ActorLogic<TSnapshot, TEvent, TInput, TEmitted, R> = {
    [ActorLogicTypeId]: makeActorLogicVariance<TSnapshot, TEvent, TInput, TEmitted, R>(),
    transition: config.transition,
    getInitialSnapshot: config.getInitialSnapshot,
    getPersistedSnapshot: config.getPersistedSnapshot,
  }
  const restoreSnapshotOption = Option.fromNullishOr(config.restoreSnapshot)
  if (Option.isSome(restoreSnapshotOption)) {
    (result as { restoreSnapshot?: typeof config.restoreSnapshot }).restoreSnapshot = restoreSnapshotOption.value
  }
  const startOption = Option.fromNullishOr(config.start)
  if (Option.isSome(startOption)) {
    (result as { start?: typeof config.start }).start = startOption.value
  }
  const configOption = Option.fromNullishOr(config.config)
  if (Option.isSome(configOption)) {
    (result as { config?: unknown }).config = configOption.value
  }
  return result
}
