/**
 * @since 0.1.0
 * @module testing/getNextSnapshot
 *
 * Pure functional utilities to compute state transitions without side effects (upstream
 * `getNextSnapshot.ts` and `transition.ts`).
 */
import { Chunk, Effect, Function, Option, Ref, Scope, Layer } from "effect"
import type { Snapshot } from "../Snapshot.js"
import * as Snap from "../Snapshot.js"
import type { EventObject } from "../Event.js"
import type {
  ActorLogic,
  ActorScopeService,
  ActorSystemService,
  AnyActorLogic,
  CustomActionExecution,
} from "../ActorLogic.js"
import { ActorScope } from "../ActorLogic.js"
import type { AnyActorRef } from "../ActorRef.js"
import { allocateChild, buildChild, restoreChild } from "../Actor.js"
import { GuardError, TransitionError } from "../Errors.js"
import type { InitializationError } from "../Errors.js"
import { ACTOR_REF_TYPE, type PersistedActorRef } from "../persistence.js"
import type { AnyStateMachine, StateMachineTypeId } from "../StateMachine.js"
import { getProperAncestors, isAtomicStateNode, MicrostepRecorder, type MicrostepRecording } from "../stateUtils.js"
import type { ParameterizedObject, SnapshotFrom, TransitionDefinition } from "../Types.js"

/**
 * Creates an inert (no-op) actor scope for pure computations (upstream
 * `createInertActorScope`).
 *
 * This scope can be used to compute transitions without side effects: its action executor
 * runs no action (upstream `actionExecutor: () => {}`), and every method that would cause a
 * side effect is a no-op.
 *
 * @since 0.1.0
 * @category Testing
 * @internal
 */
export const createInertActorScope = <TSnapshot extends Snapshot>(
  snapshot: TSnapshot
): ActorScopeService => {
  // Each inert scope is a fresh system (upstream: `createSystem` per call), which numbers the
  // session ids of the children it creates from `x:0` (SD-9). Upstream books them from one
  // global counter, so a child never takes the id of a child the snapshot already holds; here
  // such an id is skipped
  const idCounter = Ref.makeUnsafe(0)
  const heldIds = Snap.isMachineSnapshot(snapshot) ? Object.keys(snapshot.children) : []
  const generateId: Effect.Effect<string> = Effect.gen(function* () {
    while (true) {
      const id = `x:${yield* Ref.getAndUpdate(idCounter, (n) => n + 1)}`
      if (!heldIds.includes(id)) {
        return id
      }
    }
  })

  const inertSystem: ActorSystemService = {
    generateId,
    register: () => Effect.succeed("inert-session"),
    unregister: () => Effect.void,
    _set: () => Effect.void,
    get: () => Effect.succeed(Option.none()),
    _lookup: () => Option.none(),
    getAll: Effect.succeed({}),
    relay: () => Effect.void,
    scheduler: {
      schedule: () => Effect.void,
      cancel: () => Effect.void,
      cancelAll: () => Effect.void,
      resume: () => Effect.void,
      scheduledEvents: Effect.succeed({}),
    },
    getSnapshot: Effect.succeed({ _scheduledEvents: {} }),
    // A clock that never fires: nothing pure starts a timer
    _clock: { setTimeout: () => 0, clearTimeout: Function.constVoid },
    // Effect logging, as before the logger option (upstream: the system's logger)
    _logger: Option.none(),
    inspect: () => Effect.void,
    _sendInspectionEvent: () => Effect.void,
  }

  const inertActorRef: AnyActorRef = {
    id: "inert",
    sessionId: "inert-session",
    src: "inert",
    sendUntyped: () => Effect.void,
    getSnapshotUntyped: Effect.succeed(snapshot),
    getPersistedSnapshot: Effect.succeed(snapshot),
    _parent: Option.none(),
    _system: inertSystem,
    pipe: function() { return this },
    // The JSON form of every actor (upstream's inert `self` is a real actor)
    toJSON: (): PersistedActorRef => ({ xstate$$type: ACTOR_REF_TYPE, id: "inert" }),
  } as unknown as AnyActorRef

  return {
    self: inertActorRef,
    id: "inert",
    sessionId: "inert-session",
    system: inertSystem,
    // Upstream's inert scope logs nothing (`logger: () => {}`): a transition reducer's
    // `logger` gives no log here; the action executor runs no `log` action anyway (P7)
    logger: Option.some(Function.constVoid),
    defer: () => Effect.void,
    emit: () => Effect.void,
    stopChild: () => Effect.void,
    // Upstream `actionExecutor: () => {}`: no custom action, log or other action runs (P7)
    actionExecutor: () => Effect.void,
    // A spawn creates the child as upstream's inert scope does, and never starts it: it
    // lives in a scope that closes at once, so it holds no fiber and no timer
    allocateChild,
    spawnChild: (child, request) => Effect.scoped(Effect.asVoid(buildChild(child, request, inertActorRef))),
    // A restored child is created the same way, and nothing starts it
    restoreChild: (request) => Effect.scoped(restoreChild(request, inertActorRef)),
    startChild: () => Effect.void,
  }
}

/**
 * The inert actor scope with an action executor that keeps each action it receives in
 * `actions` and runs none (upstream `transition` and `initialTransition`, which replace the
 * inert scope's `actionExecutor` with one that pushes the action).
 */
const collectingActorScope = <TSnapshot extends Snapshot>(
  snapshot: TSnapshot,
  actions: Ref.Ref<Chunk.Chunk<CustomActionExecution>>
): ActorScopeService => ({
  ...createInertActorScope(snapshot),
  actionExecutor: (action) => Ref.update(actions, Chunk.append(action)),
})

/**
 * Turns the guard-evaluation error the engine dies with into a failure (upstream throws it
 * from the pure helpers; the port fails the Effect, SD-3, as `getTransitionData` does). Any
 * other defect stays a defect.
 */
const failOnGuardError = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E | GuardError, R> =>
  Effect.catchDefect(effect, (defect) => (defect instanceof GuardError ? Effect.fail(defect) : Effect.die(defect)))

/**
 * Computes the initial snapshot for actor logic without creating an actor.
 *
 * The input is optional when the logic's input type admits `undefined`, so a machine that
 * declares no input type takes none (XState `getInitialSnapshot(logic, ...[input])`); a
 * logic that declares its input type requires it. No action runs; `assign` and the context
 * factory still give the context (upstream: the inert scope's action executor runs nothing).
 * It fails as the logic's `getInitialSnapshot` fails: for a machine, with the
 * `InitializationError` of a definition error (SD-3, amended 2026-10-08) or of an `initial`
 * key that names no child.
 *
 * @example
 * ```ts
 * const initialSnapshot = yield* getInitialSnapshot(
 *   myMachine,
 *   { userId: "123" } // input
 * )
 * ```
 *
 * @since 0.1.0
 * @category Testing
 */
export const getInitialSnapshot = <
  TSnapshot extends Snapshot,
  TEvent extends EventObject,
  TInput,
  TEmitted extends EventObject,
  R
>(
  logic: ActorLogic<TSnapshot, TEvent, TInput, TEmitted, R>,
  ...[input]: undefined extends TInput ? [input?: TInput] : [input: TInput]
): Effect.Effect<TSnapshot, InitializationError, Exclude<R, Scope.Scope>> =>
  Effect.gen(function* () {
    // Create a placeholder snapshot for the inert scope
    const placeholderSnapshot: Snapshot = Snap.active()

    const inertScope = createInertActorScope(placeholderSnapshot)
    const inertScopeLayer = Layer.succeed(ActorScope, inertScope)

    const snapshot = yield* logic
      // An omitted input is `undefined`, which the optional form admits only when the input
      // type does
      .getInitialSnapshot(input as TInput)
      .pipe(
        Effect.provide(inertScopeLayer),
        // Provide a scope for actors that use addFinalizer (like fromPromise)
        Effect.scoped
      )

    return snapshot
  })

/**
 * The types the logic's own `transition` takes and gives (XState `SnapshotFrom` and
 * `EventFromLogic` for the pure helpers): its snapshot, its event, the Effect services it
 * needs and the error it fails with. A concrete logic gives its own types, an
 * `AnyStateMachine` gives `AnyMachineSnapshot`, `EventObject` and the actor scope only.
 */
type TransitionTypes<TLogic> = TLogic extends {
  readonly transition: (
    snapshot: infer TSnapshot extends Snapshot,
    event: infer TEvent extends EventObject
  ) => Effect.Effect<unknown, infer E, infer R>
}
  ? readonly [snapshot: TSnapshot, event: TEvent, requirements: R, error: E]
  : never

/** A logic's own `transition`, with the types {@link TransitionTypes} reads from it. */
interface OwnTransition<TLogic> {
  /**
   * The logic's `transition`, typed with the snapshot, event, error and requirements the logic
   * declares; `runTransition` casts the logic to this view to call it.
   */
  readonly transition: (
    snapshot: TransitionTypes<TLogic>[0],
    event: TransitionTypes<TLogic>[1]
  ) => Effect.Effect<TransitionTypes<TLogic>[0], TransitionTypes<TLogic>[3], TransitionTypes<TLogic>[2]>
}

/**
 * Runs the logic's own `transition` for `snapshot` and `event` with `actorScope`; a throwing
 * guard fails it with the guard-evaluation error.
 */
const runTransition = <TLogic extends AnyActorLogic>(
  logic: TLogic,
  snapshot: TransitionTypes<TLogic>[0],
  event: TransitionTypes<TLogic>[1],
  actorScope: ActorScopeService
): Effect.Effect<
  TransitionTypes<TLogic>[0],
  TransitionTypes<TLogic>[3] | GuardError,
  Exclude<TransitionTypes<TLogic>[2], ActorScope>
> =>
  // `AnyActorLogic` types `transition` with `never` arguments; the logic's own `transition`
  // has the types `TransitionTypes` reads from it
  (logic as unknown as OwnTransition<TLogic>)
    .transition(snapshot, event)
    .pipe(Effect.provide(Layer.succeed(ActorScope, actorScope)), failOnGuardError)

/**
 * Computes the next snapshot for actor logic without side effects (upstream
 * `getNextSnapshot`, deprecated there in favour of {@link transition}).
 *
 * This is useful for testing state transitions in isolation without
 * creating a full actor. No action runs; `assign` still gives the context.
 *
 * Like XState's `getNextSnapshot(actorLogic, snapshot, event)`, it takes any actor logic, an
 * `AnyStateMachine` included, and checks the snapshot and the event against the types of
 * that logic's `transition`. What upstream throws fails the Effect: the logic's transition
 * error (a macrostep past `maxIterations`), and the guard-evaluation `GuardError` of a guard
 * that throws.
 *
 * @example
 * ```ts
 * const nextSnapshot = yield* getNextSnapshot(
 *   myMachine,
 *   currentSnapshot,
 *   { type: "TOGGLE" }
 * )
 *
 * expect(nextSnapshot.value).toEqual("on")
 * ```
 *
 * @since 0.1.0
 * @category Testing
 */
export const getNextSnapshot = <TLogic extends AnyActorLogic>(
  logic: TLogic,
  snapshot: TransitionTypes<TLogic>[0],
  event: TransitionTypes<TLogic>[1]
): Effect.Effect<
  TransitionTypes<TLogic>[0],
  TransitionTypes<TLogic>[3] | GuardError,
  Exclude<TransitionTypes<TLogic>[2], ActorScope>
> => runTransition(logic, snapshot, event, createInertActorScope(snapshot))

// ============================================================
// EXECUTABLE ACTIONS
// ============================================================

/**
 * One action a transition hands to the actor's action executor (upstream
 * `ExecutableActionObject`): its type, its resolved params, and what runs it. A custom
 * action's `exec` runs the action; a built-in action's `exec` does its work (the send, the
 * schedule, the emit) through the actor scope that resolved it.
 *
 * @since 0.1.0
 * @category Testing
 */
export type ExecutableActionObject = CustomActionExecution

/**
 * A raise as a transition returns it (upstream `ExecutableRaiseAction`): the event, the id,
 * and the delay in milliseconds (`undefined` for none, which the transition put on its
 * internal queue).
 *
 * @since 0.1.0
 * @category Testing
 */
export interface ExecutableRaiseAction extends CustomActionExecution {
  /** The built-in type that tells a raise apart from the other executable actions. */
  readonly type: "xstate.raise"
  /**
   * The raise as resolved: `id` is the action's `id` option (what `cancel` takes), `undefined`
   * without one; `delay` is the resolved milliseconds, `undefined` when the delay gave none.
   */
  readonly params: {
    readonly event: EventObject
    readonly id: string | undefined
    readonly delay: number | undefined
  }
}

/**
 * A send as a transition returns it (upstream `ExecutableSendToAction`): the event, the id,
 * the delay in milliseconds, the target actor (`to`; for a name that resolves after its action
 * list, the actor it resolved to once the list has run, as upstream's `retryResolveSendTo`
 * puts it there) and the target's name (`targetId`, `undefined` for a reference).
 *
 * @since 0.1.0
 * @category Testing
 */
export interface ExecutableSendToAction extends CustomActionExecution {
  /** The built-in type that tells a send apart from the other executable actions. */
  readonly type: "xstate.sendTo"
  /**
   * The send as resolved: `id` is the action's `id` option (what `cancel` takes); a `delay` in
   * milliseconds goes to the scheduler, `undefined` sends at once through the system.
   */
  readonly params: {
    readonly event: EventObject
    readonly id: string | undefined
    readonly delay: number | undefined
    readonly to: AnyActorRef
    readonly targetId: string | undefined
  }
}

/**
 * A spawn as a transition returns it (upstream `ExecutableSpawnAction`): the `id` option as the
 * action was written (typed `string`, as upstream types it; an id function stays the
 * function), the actor (created, never started; `undefined` for a src that names no logic),
 * the src, the systemId, and the input resolved for the logic (`undefined` without one), as
 * upstream's params hold them at run time.
 *
 * @since 0.1.0
 * @category Testing
 */
export interface ExecutableSpawnAction extends CustomActionExecution {
  /** The built-in type that tells a spawn apart from the other executable actions. */
  readonly type: "xstate.spawnChild"
  /**
   * The spawn as resolved. The `exec` of a spawn is `Effect.void`: the actor scope queues the
   * child's start itself, and in the pure helpers nothing starts `actorRef`.
   */
  readonly params: {
    readonly id: string
    readonly actorRef: AnyActorRef | undefined
    readonly src: string | AnyActorLogic
    readonly systemId: string | undefined
    readonly input: unknown
  }
}

/**
 * The built-in actions upstream types for a transition's actions (`SpecialExecutableAction`).
 *
 * @since 0.1.0
 * @category Testing
 */
export type SpecialExecutableAction = ExecutableSpawnAction | ExecutableRaiseAction | ExecutableSendToAction

/** The executable actions of a logic with this snapshot type: a machine's, none for any other logic. */
type ExecutableActionsOf<TSnapshot> = TSnapshot extends Snap.MachineSnapshot ? SpecialExecutableAction : never

/**
 * The actions the transitions of a logic return (upstream `ExecutableActionsFrom`): the
 * special built-in actions for a machine, none for any other logic. The port's machine type
 * does not carry the names of its actions, so upstream's `ToExecutableAction` of each named
 * action is not part of it.
 *
 * @since 0.1.0
 * @category Testing
 */
export type ExecutableActionsFrom<TLogic> = ExecutableActionsOf<SnapshotFrom<TLogic>>

/**
 * The executable form of a named action (upstream `ToExecutableAction`): its type and
 * params; its `exec` stays the Effect of every executable action of the port.
 *
 * @since 0.1.0
 * @category Testing
 */
export interface ToExecutableAction<T extends ParameterizedObject> extends Omit<CustomActionExecution, "type" | "params"> {
  /** The named action's type, narrowed from `string` to the literal of `T`. */
  readonly type: T["type"]
  /** The params of this use, typed as `T` declares them. */
  readonly params: T["params"]
}

// ============================================================
// PURE TRANSITIONS
// ============================================================

/**
 * Given actor `logic`, a `snapshot` and an `event`, gives the next snapshot and the actions
 * to execute (upstream `transition`). Pure: no action runs, and the actions come back in the
 * order the transition handed them to the action executor (custom actions, and the built-in
 * actions that do work: raise, sendTo, cancel, emit, log, spawnChild, stopChild). `assign`
 * still gives the context. Fails as {@link getNextSnapshot} fails.
 *
 * @example
 * ```ts
 * const [initial] = yield* initialTransition(toggleMachine)
 * expect(initial.value).toEqual("off")
 *
 * const [toggled, actions] = yield* transition(toggleMachine, initial, { type: "TOGGLE" })
 * expect(toggled.value).toEqual("on")
 * ```
 *
 * @since 0.1.0
 * @category Testing
 */
export const transition = <TLogic extends AnyActorLogic>(
  logic: TLogic,
  snapshot: TransitionTypes<TLogic>[0],
  event: TransitionTypes<TLogic>[1]
): Effect.Effect<
  readonly [nextSnapshot: TransitionTypes<TLogic>[0], actions: Array<ExecutableActionsOf<TransitionTypes<TLogic>[0]>>],
  TransitionTypes<TLogic>[3] | GuardError,
  Exclude<TransitionTypes<TLogic>[2], ActorScope>
> =>
  Effect.gen(function* () {
    const actions = yield* Ref.make(Chunk.empty<CustomActionExecution>())
    const nextSnapshot = yield* runTransition(logic, snapshot, event, collectingActorScope(snapshot, actions))
    // The actions as upstream types them for this logic
    const executable = Chunk.toArray(yield* Ref.get(actions)) as Array<ExecutableActionsOf<TransitionTypes<TLogic>[0]>>
    return [nextSnapshot, executable] as const
  })

/**
 * Given actor `logic` and its input (optional when the input type admits `undefined`), gives
 * the initial snapshot and the actions to execute from the initial transition (upstream
 * `initialTransition`). Pure: no action runs, the entry actions included; `assign` and the
 * context factory still give the context. Typed as {@link getInitialSnapshot} is: a machine
 * gives an error snapshot for what its initialization throws, as upstream, and fails with the
 * `InitializationError` of a definition error (SD-3, amended 2026-10-08).
 *
 * @since 0.1.0
 * @category Testing
 */
export const initialTransition = <
  TSnapshot extends Snapshot,
  TEvent extends EventObject,
  TInput,
  TEmitted extends EventObject,
  R
>(
  logic: ActorLogic<TSnapshot, TEvent, TInput, TEmitted, R>,
  ...[input]: undefined extends TInput ? [input?: TInput] : [input: TInput]
): Effect.Effect<
  readonly [nextSnapshot: TSnapshot, actions: Array<ExecutableActionsOf<TSnapshot>>],
  InitializationError,
  Exclude<R, Scope.Scope>
> =>
  Effect.gen(function* () {
    const actions = yield* Ref.make(Chunk.empty<CustomActionExecution>())
    const snapshot = yield* logic
      // An omitted input is `undefined`, which the optional form admits only when the input
      // type does
      .getInitialSnapshot(input as TInput)
      .pipe(
        Effect.provide(Layer.succeed(ActorScope, collectingActorScope(Snap.active(), actions))),
        // Provide a scope for actors that use addFinalizer (like fromPromise)
        Effect.scoped
      )
    // The actions as upstream types them for this logic
    const executable = Chunk.toArray(yield* Ref.get(actions)) as Array<ExecutableActionsOf<TSnapshot>>
    return [snapshot, executable] as const
  })

// ============================================================
// MICROSTEPS
// ============================================================

/**
 * Runs `effect` with a recording of the microsteps of the macrosteps that use `actorScope`,
 * and gives the recorded microsteps with what the effect gave.
 */
const recordingMicrosteps = <A, E, R>(
  actorScope: ActorScopeService,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<readonly [A, MicrostepRecording["steps"]], E, R> =>
  Effect.suspend(() => {
    const recording: MicrostepRecording = { actorScope, steps: [] }
    return effect.pipe(
      Effect.provideService(MicrostepRecorder, Option.some(recording)),
      Effect.map((result) => [result, recording.steps] as const)
    )
  })

/**
 * Given a state `machine`, a `snapshot` and an `event`, gives each microstep of the
 * macrostep that processes the event, as `[snapshot, actions]` (upstream `getMicrosteps`):
 * the first microstep for the event, then each eventless and raised-event microstep, with the
 * actions each one handed to the action executor. Pure: no action runs. A snapshot that is not
 * active (`done`, `error`, `stopped`) takes the first microstep only, as upstream; a `done`
 * one stays `done` and adds the exit actions of every active node. Fails as
 * {@link getNextSnapshot} fails: past `maxIterations`
 * with the `TransitionError`, for a throwing guard with the guard-evaluation `GuardError`.
 *
 * @since 0.1.0
 * @category Testing
 */
export const getMicrosteps = <TMachine extends AnyStateMachine>(
  machine: TMachine,
  snapshot: TransitionTypes<TMachine>[0],
  event: TransitionTypes<TMachine>[1]
): Effect.Effect<
  Array<readonly [snapshot: TransitionTypes<TMachine>[0], actions: Array<ExecutableActionsOf<TransitionTypes<TMachine>[0]>>]>,
  TransitionTypes<TMachine>[3] | GuardError,
  Exclude<TransitionTypes<TMachine>[2], ActorScope>
> =>
  Effect.suspend(() => {
    const actorScope = createInertActorScope(snapshot)
    return Effect.map(
      recordingMicrosteps(actorScope, runTransition(machine, snapshot, event, actorScope)),
      // The snapshots of this machine's microsteps, and their actions as upstream types them
      ([, steps]) =>
        steps as unknown as Array<
          readonly [TransitionTypes<TMachine>[0], Array<ExecutableActionsOf<TransitionTypes<TMachine>[0]>>]
        >
    )
  })

/**
 * Given a state `machine` and its input (optional when the input type admits `undefined`),
 * gives each microstep of the initial transition, as `[snapshot, actions]` (upstream
 * `getInitialMicrosteps`): the initial microstep, which enters the initial states with their
 * entry actions, then each eventless and raised-event microstep. Pure: no action runs; the
 * context factory still gives the context. What upstream throws fails the Effect: the
 * `InitializationError` of an `initial` key that names no child, the `TransitionError` past
 * `maxIterations` and the guard-evaluation `GuardError`; any other thrown value is a defect.
 *
 * @since 0.1.0
 * @category Testing
 */
export const getInitialMicrosteps = <
  TSnapshot extends Snapshot,
  TEvent extends EventObject,
  TInput,
  TEmitted extends EventObject,
  R
>(
  // A state machine, as upstream's `T extends AnyStateMachine`; its logic types give the input
  machine: ActorLogic<TSnapshot, TEvent, TInput, TEmitted, R> & Pick<AnyStateMachine, StateMachineTypeId>,
  ...[input]: undefined extends TInput ? [input?: TInput] : [input: TInput]
): Effect.Effect<
  Array<readonly [snapshot: TSnapshot, actions: Array<ExecutableActionsOf<TSnapshot>>]>,
  InitializationError | TransitionError | GuardError,
  Exclude<Exclude<R, ActorScope>, Scope.Scope>
> =>
  Effect.suspend(() => {
    const actorScope = createInertActorScope(Snap.active())
    return recordingMicrosteps(
      actorScope,
      machine
        // An omitted input is `undefined`, which the optional form admits only when the input
        // type does
        .getInitialSnapshot(input as TInput)
        .pipe(Effect.provide(Layer.succeed(ActorScope, actorScope)), Effect.scoped)
    ).pipe(
      Effect.flatMap(([snapshot, steps]) =>
        // A machine gives an error snapshot for what its initialization throws; upstream's
        // `getInitialMicrosteps` throws it
        Option.match(Option.filter(snapshot.error, () => snapshot.status === "error"), {
          onNone: () =>
            Effect.succeed(steps as unknown as Array<readonly [TSnapshot, Array<ExecutableActionsOf<TSnapshot>>]>),
          onSome: (error) =>
            error instanceof TransitionError || error instanceof GuardError ? Effect.fail(error) : Effect.die(error),
        })
      )
    )
  })

/**
 * Gets every potential next transition from the current snapshot (upstream
 * `getNextTransitions`): for each active atomic node in the snapshot's node order, the
 * transitions of the node and then of each of its ancestors that no earlier atomic node
 * visited, each node's event transitions in declaration order (delayed transitions on their
 * `xstate.after.*` events among them) and then its `always` transitions. Guarded transitions
 * count whatever their guard gives; no guard runs. An Effect (SD-13).
 *
 * @since 0.1.0
 * @category Testing
 */
export const getNextTransitions = (
  snapshot: Snap.AnyMachineSnapshot
): Effect.Effect<ReadonlyArray<TransitionDefinition<unknown, EventObject>>> =>
  Effect.sync(() => {
    // Each atomic node, then its ancestors, in that order, each node once
    const nodes = snapshot._nodes
      .filter(isAtomicStateNode)
      .flatMap((atomic) => [atomic, ...getProperAncestors(atomic, Option.none())])
    const visited = nodes.filter((node, index) => nodes.findIndex((other) => other.id === node.id) === index)
    return visited.flatMap((node) => [...node.transitions.flatMap(([, transitions]) => transitions), ...node.always])
  })
