/**
 * @since 0.1.0
 * @module actors/fromTransition
 *
 * Creates actor logic from a reducer-like transition function (upstream `fromTransition`).
 *
 * The reducer stays a plain function: it receives the state, the event and the actor scope
 * argument (upstream's `self`, `id`, `sessionId`, `logger`, `defer`, `system`, `stopChild`,
 * `emit` and `actionExecutor`), and returns the next state.
 */
import { Effect, Exit, Fiber, Function, MutableRef, Option } from "effect"
import type { Scope } from "effect"
import type { Snapshot } from "../Snapshot.js"
import * as Snap from "../Snapshot.js"
import type { EventObject } from "../Event.js"
import type { ActorLogic, ActorScopeService, ActorSystemService, CustomActionExecution } from "../ActorLogic.js"
import { ActorLogicTypeId, ActorScope } from "../ActorLogic.js"
import type { ActorRef, ActorRefBase, AnyActorRef } from "../ActorRef.js"
import { ActorError } from "../Errors.js"
import * as Outbox from "../internal/outbox.js"
import * as Persistence from "../persistence.js"
import type { Variance } from "../Types.js"

/**
 * Creates variance markers for ActorLogic TypeId.
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
 * Snapshot for a transition actor (upstream `TransitionSnapshot`): the reducer's state is the
 * snapshot's `context`.
 *
 * @since 0.1.0
 * @category Actors
 */
export interface TransitionSnapshot<TContext> extends Snapshot<undefined> {
  /**
   * The reducer's current state: the initial state, then what the reducer returned for the last
   * event. A reducer that throws leaves it as it was before that event.
   */
  readonly context: TContext
}

/**
 * Actor logic created by `fromTransition` (upstream `TransitionActorLogic`).
 *
 * @since 0.1.0
 * @category Actors
 */
export type TransitionActorLogic<
  TContext,
  TEvent extends EventObject,
  TInput = unknown,
  TEmitted extends EventObject = EventObject
> = ActorLogic<TransitionSnapshot<TContext>, TEvent, TInput, TEmitted>

/**
 * A reference to a transition actor, the type of `self` in the reducer and the factory
 * (upstream `TransitionActorRef`).
 *
 * @since 0.1.0
 * @category Actors
 */
export type TransitionActorRef<TContext, TEvent extends EventObject> = ActorRef<TransitionSnapshot<TContext>, TEvent>

/**
 * The actor scope argument of the reducer (upstream `ActorScope`, the third argument of the
 * transition function). The port's actor scope is a service whose members return Effects; the
 * reducer is a plain function, so it receives these plain members, upstream's own.
 *
 * `logger`, `defer`, `stopChild` and `actionExecutor` called while the reducer runs start
 * their work at once, inside the call, with the actor's services; a work that fails or dies
 * gives the actor status `error` when the reducer returns, with the snapshot from before the
 * event (SD-4), as upstream's throw. Called later, from code the reducer left behind (a
 * timer), they run their work through the actor while it runs, as `emit` does. In the pure
 * helpers (no running actor) they do what upstream's inert scope does: nothing, apart from
 * `actionExecutor`, whose action the `transition` helper returns in its list.
 *
 * @since 0.1.0
 * @category Actors
 */
export interface TransitionActorScope<
  TContext,
  TEvent extends EventObject,
  TSystem extends ActorSystemService = ActorSystemService,
  TEmitted extends EventObject = EventObject
> {
  /** The transition actor itself */
  readonly self: TransitionActorRef<TContext, TEvent>
  /** The actor's id */
  readonly id: string
  /** The actor's session id */
  readonly sessionId: string
  /**
   * The actor's logger (upstream `actorScope.logger`): the actor's `logger` option, else its
   * system's. Without one, an Effect log at level Info with the actor's annotations (C12).
   */
  readonly logger: (...args: ReadonlyArray<unknown>) => void
  /**
   * Runs `fn` after the next state commits, before the observers see it (upstream
   * `actorScope.defer`, which `update` runs); from code the reducer left behind, after the
   * commit of the actor's next event, as upstream.
   */
  readonly defer: (fn: () => void) => void
  /** The actor system the transition actor belongs to */
  readonly system: TSystem
  /**
   * Stops a child of the actor (upstream `actorScope.stopChild`). A transition actor spawns
   * no child, so for an actor that is not its child it is upstream's error: the actor gets
   * status `error` with `Cannot stop child actor <child id> of <id> because it is not a
   * child`. A child given by the `parent` option stops as a machine's `stopChild` stops it.
   */
  readonly stopChild: (child: AnyActorRef) => void
  /**
   * Delivers an event to the actor's listeners at once, inside the call (upstream
   * `actorScope.emit`): from the reducer, before the next state commits, or from code the
   * reducer left behind (a timer), while the actor runs. Without a running actor (the pure
   * helpers) it delivers nothing.
   */
  readonly emit: (emitted: TEmitted) => void
  /**
   * Runs an action's execution (upstream `actorScope.actionExecutor`): the `@xstate.action`
   * inspection event, then its `exec`, at once. The pure `transition` helper keeps the action
   * in the list it returns and runs nothing.
   */
  readonly actionExecutor: (action: CustomActionExecution) => void
}

/** The reducer `fromTransition` takes. */
type Reducer<TContext, TEvent extends EventObject, TSystem extends ActorSystemService, TEmitted extends EventObject> = (
  state: TContext,
  event: TEvent,
  actorScope: TransitionActorScope<TContext, TEvent, TSystem, TEmitted>
) => TContext

/** The factory form of the initial state (upstream `({ input, self }) => context`). */
type InitialContextFactory<TContext, TEvent extends EventObject, TInput> = (args: {
  readonly input: TInput
  readonly self: TransitionActorRef<TContext, TEvent>
}) => TContext

/** The outbox of each running transition actor of one logic, keyed by the actor itself. */
type Outboxes = WeakMap<ActorRefBase, Outbox.Outbox>

/**
 * Gives the running actor its outbox, in the actor's scope, for as long as it runs (upstream:
 * the reducer's `actorScope` is the actor's own, so its `emit` works after the call too).
 */
const openOutbox = (outboxes: Outboxes): Effect.Effect<void, never, ActorScope | Scope.Scope> =>
  Effect.gen(function* () {
    const self = (yield* ActorScope).self
    const outbox = yield* Outbox.make
    yield* Effect.sync(() => outboxes.set(self, outbox))
    yield* Effect.addFinalizer(() => Effect.sync(() => outboxes.delete(self)))
  })

/**
 * The work of the reducer scope's `stopChild` (upstream `actorScope.stopChild`): in a running
 * actor (it has an outbox), an actor that is not its child is upstream's error, at once, so the
 * actor errors with the snapshot from before the event; a child stops through the actor
 * scope. In the pure helpers the inert scope's `stopChild` does nothing, as upstream's.
 */
const stopChildWork = (
  actorScope: ActorScopeService,
  outbox: Option.Option<Outbox.Outbox>,
  child: AnyActorRef
): Effect.Effect<void> =>
  Option.isSome(outbox) && !Option.exists(child._parent, (parent) => parent === actorScope.self)
    ? Effect.die(
        new ActorError({
          message: `Cannot stop child actor ${child.id} of ${actorScope.id} because it is not a child`,
          actorId: actorScope.id,
        })
      )
    : actorScope.stopChild(child)

/**
 * Calls the reducer with the actor scope argument (upstream
 * `transition(snapshot.context, event, actorScope)`). Its `emit` delivers each event at once
 * through the actor's outbox, inside the call, so a listener reads the snapshot from before the
 * event; an actor that is not running (the pure helpers' inert scope) has no outbox, and its
 * emits go nowhere. Its `logger` (without a logger of the actor's), `defer`, `stopChild` and
 * `actionExecutor` start their work at once, each in a fiber with the services of this call,
 * which the call joins in order when the reducer returns, so a work that fails or dies is the
 * transition's defect; once the reducer has returned they go through the outbox as `emit`. A
 * throw is a defect that carries the thrown value, so the actor errors with it (SD-4), and the
 * work that still runs is interrupted.
 */
const reduce = <TContext, TEvent extends EventObject, TSystem extends ActorSystemService, TEmitted extends EventObject>(
  reducer: Reducer<TContext, TEvent, TSystem, TEmitted>,
  outboxes: Outboxes,
  state: TContext,
  event: TEvent
): Effect.Effect<TContext, never, ActorScope> =>
  Effect.gen(function* () {
    const actorScope = yield* ActorScope
    const outbox = yield* Effect.sync(() => Option.fromUndefinedOr(outboxes.get(actorScope.self)))
    const runFork = Effect.runForkWith(yield* Effect.context<ActorScope>())
    // The fibers of the work started while the reducer runs; none once it has returned
    const started = MutableRef.make<Option.Option<ReadonlyArray<Fiber.Fiber<void>>>>(Option.some([]))
    /** Starts a member's work: at once inside the call, later through the outbox. */
    const run = (work: Effect.Effect<void>): void =>
      Option.match(MutableRef.get(started), {
        onSome: (fibers) => {
          MutableRef.set(started, Option.some([...fibers, runFork(work)]))
        },
        onNone: () => Option.match(outbox, { onNone: Function.constVoid, onSome: (running) => running.post(work) }),
      })
    const scopeArgument: TransitionActorScope<TContext, TEvent, TSystem, TEmitted> = {
      // The actor scope's `self` is this transition actor, and its system is the actor's system
      self: actorScope.self as TransitionActorRef<TContext, TEvent>,
      id: actorScope.id,
      sessionId: actorScope.sessionId,
      // Upstream `actorScope.logger` is the actor's logger itself
      logger: Option.getOrElse(
        actorScope.logger,
        () =>
          (...args: ReadonlyArray<unknown>) =>
            run(
              Effect.logInfo(...args).pipe(
                Effect.annotateLogs({ actorId: actorScope.self.id, sessionId: actorScope.self.sessionId })
              )
            )
      ),
      defer: (fn) => run(actorScope.defer(Effect.sync(fn))),
      system: actorScope.system as TSystem,
      stopChild: (child) => run(stopChildWork(actorScope, outbox, child)),
      emit: (emitted) =>
        Option.match(outbox, {
          onNone: Function.constVoid,
          onSome: (running) => running.post(actorScope.emit(emitted)),
        }),
      actionExecutor: (action) => run(actorScope.actionExecutor(action)),
    }
    const reduced = yield* Effect.exit(Effect.sync(() => reducer(state, event, scopeArgument)))
    const fibers = Option.getOrElse(MutableRef.getAndSet(started, Option.none()), (): ReadonlyArray<Fiber.Fiber<void>> => [])
    return yield* Exit.match(reduced, {
      onFailure: (cause) => Effect.andThen(Fiber.interruptAll(fibers), Effect.failCause(cause)),
      onSuccess: (next) => Effect.as(Effect.forEach(fibers, Fiber.join, { discard: true }), next),
    }).pipe(Effect.onInterrupt(() => Fiber.interruptAll(fibers)))
  })

/**
 * Creates actor logic from a reducer-like transition function (upstream `fromTransition`).
 *
 * - `transition(state, event, actorScope)` returns the next state; the state is the snapshot's
 *   `context`. `actorScope` carries the actor's `self`, `id`, `sessionId`, `logger`, `defer`,
 *   `system`, `stopChild`, `emit` and `actionExecutor` ({@link TransitionActorScope}).
 * - `emit(event)` delivers the event to the actor's `on` listeners and `emissions` inside the
 *   call, from the reducer or from code it leaves behind (a timer), while the actor runs.
 * - `initialContext` is the initial state, or a factory `({ input, self }) => state` that builds
 *   it from the actor's input (a state that is itself a function needs the factory form).
 * - A throw in the reducer or the factory gives the actor status `error` with the thrown value,
 *   and its parent `xstate.error.actor.<id>` (SD-4).
 * - Generic order follows upstream: `fromTransition<TContext, TEvent, TSystem, TInput, TEmitted>`
 *   (SD-12); `TSystem`, `TInput` and `TEmitted` have defaults.
 *
 * @example
 * ```ts
 * const counterLogic = fromTransition(
 *   (state, event: { type: "increment" }, { emit }) => {
 *     emit({ type: "counted" })
 *     return { ...state, count: state.count + state.step }
 *   },
 *   ({ input }: { input: { step: number } }) => ({ count: 0, step: input.step })
 * )
 * ```
 *
 * @since 0.1.0
 * @category Actors
 */
export const fromTransition = <
  TContext,
  TEvent extends EventObject,
  TSystem extends ActorSystemService = ActorSystemService,
  TInput = unknown,
  TEmitted extends EventObject = EventObject
>(
  transition: Reducer<TContext, TEvent, TSystem, TEmitted>,
  initialContext: TContext | InitialContextFactory<TContext, TEvent, TInput>
): TransitionActorLogic<TContext, TEvent, TInput, TEmitted> => {
  // Keyed by the actor itself, so two actors whose session ids are equal (one per system) never
  // share an outbox
  const outboxes: Outboxes = new WeakMap()

  return {
    [ActorLogicTypeId]: makeActorLogicVariance<TransitionSnapshot<TContext>, TEvent, TInput, TEmitted, never>(),

    config: transition,

    transition: (snapshot, event) =>
      Effect.map(reduce(transition, outboxes, snapshot.context, event), (context) => ({ ...snapshot, context })),

    // The outbox the reducer's `emit` delivers through while the actor runs
    start: () => openOutbox(outboxes),

    getInitialSnapshot: (input) =>
      Effect.gen(function* () {
        const actorScope = yield* ActorScope
        const context =
          typeof initialContext === "function"
            ? // Upstream's check: a state that is itself a function is called as the factory
              yield* Effect.sync(() =>
                (initialContext as InitialContextFactory<TContext, TEvent, TInput>)({
                  input,
                  self: actorScope.self as TransitionActorRef<TContext, TEvent>,
                })
              )
            : initialContext

        return {
          [Snap.SnapshotTypeId]: Snap.SnapshotTypeId,
          status: "active" as const,
          output: Option.none(),
          error: Option.none(),
          context,
        }
      }),

    // The persisted-snapshot codec (SD-7): `{ status, output, error, context }`, no Option
    // objects; the context goes through the same context codec as a machine's
    getPersistedSnapshot: Persistence.persistTransitionSnapshot,

    restoreSnapshot: (persisted) => Persistence.restoreTransitionSnapshot<TContext>(persisted),
  }
}

/**
 * Creates actor logic from a reducer whose factory takes the raw input (port extra; the
 * upstream form is `fromTransition` with `({ input }) => state`). The reducer receives the actor
 * scope argument as in `fromTransition`.
 *
 * @example
 * ```ts
 * const counterActor = fromTransitionWithInput<{ initial: number }>()(
 *   (context, event) => {
 *     switch (event.type) {
 *       case "INCREMENT":
 *         return { count: context.count + 1 }
 *       default:
 *         return context
 *     }
 *   },
 *   ({ initial }) => ({ count: initial })
 * )
 * ```
 *
 * @since 0.1.0
 * @category Actors
 */
export const fromTransitionWithInput =
  <TInput>() =>
  <TContext, TEvent extends EventObject, TEmitted extends EventObject = EventObject>(
    transition: Reducer<TContext, TEvent, ActorSystemService, TEmitted>,
    initialContext: (input: TInput) => TContext
  ): TransitionActorLogic<TContext, TEvent, TInput, TEmitted> =>
    fromTransition<TContext, TEvent, ActorSystemService, TInput, TEmitted>(transition, ({ input }) => initialContext(input))
