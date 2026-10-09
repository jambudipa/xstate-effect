/**
 * @since 0.1.0
 * @module actions/enqueueActions
 *
 * Provides an imperative way to queue actions based on conditions.
 */
import { Effect, Chunk } from "effect"
import type { EventObject } from "../Event.js"
import type { Action, ActionContext, ActionDefinition, Guard, ImplementationNames } from "../Types.js"
import * as Types from "../Types.js"
import type { AnyActorLogic } from "../ActorLogic.js"
import type { ActorRefBase } from "../ActorRef.js"
import { assign, type Assignment } from "./assign.js"
import { raise, type RaiseEvent, type RaiseOptions } from "./raise.js"
import {
  sendTo,
  sendParent,
  sendSelf,
  type SendToEvent,
  type SendToOptions,
  type SendToTarget,
  type SendToTargetEvent
} from "./sendTo.js"
import { spawnChild, type SpawnChildArguments, type UntypedSpawnChildOptions } from "./spawnChild.js"
import { stopChild, type StopChildTarget } from "./stopChild.js"
import { emit, type EmitEvent } from "./emit.js"
import { cancel, type CancelId } from "./cancel.js"

/**
 * The `enqueue` function of an `enqueueActions` (upstream `ActionEnqueuer`): it enqueues any
 * action form, and its helpers enqueue the built-in actions with the arguments those take.
 * There is no `enqueue.log` (as upstream, SD-16): enqueue `log(...)` itself. `TNames` holds
 * the actions, delays and actors a name may name (any name by default; a setup's bound
 * `enqueueActions` takes the setup's).
 *
 * @since 0.1.0
 * @category Actions
 */
export interface ActionEnqueuer<
  TContext,
  TEvent extends EventObject,
  TNames extends ImplementationNames = ImplementationNames,
  TSelfEvent extends EventObject = TEvent
> {
  /**
   * Enqueues an action in any form a machine config takes: the name of an implementation,
   * `{ type, params }`, an inline function, a built-in action such as `raise(...)` or
   * `log(...)`, a nested `enqueueActions`, or a port definition.
   */
  (action: Action<TContext, TEvent, TNames, TSelfEvent>): void

  /** Enqueues `assign(assignment)`; its assigners receive `undefined` params, as upstream. */
  readonly assign: (assignment: Assignment<TContext, TEvent, undefined, TSelfEvent>) => void

  /** Enqueues `raise(event, options)`: `{ id, delay }`, the delay a number, a name or a function. */
  readonly raise: (
    event: RaiseEvent<TContext, TEvent, TSelfEvent>,
    options?: RaiseOptions<TContext, TEvent, TNames["delays"]>
  ) => void

  /**
   * Enqueues `sendTo(target, event, options)`: `{ id, delay }`, the delay a number, a name or a
   * function. The event is typed by the target, as `sendTo`'s is (`SendToTargetEvent`,
   * upstream `EventFrom` of the target): a reference typed by its logic takes its own events.
   */
  readonly sendTo: <TTarget extends ActorRefBase = ActorRefBase, TSentEvent extends EventObject = EventObject>(
    target: SendToTarget<TContext, TEvent, TTarget, TSelfEvent>,
    event: SendToTargetEvent<TContext, TEvent, TTarget, TSentEvent, TSelfEvent>,
    options?: SendToOptions<TContext, TEvent, TNames["delays"], TSelfEvent>
  ) => void

  /** Enqueues `sendParent(event, options)`. */
  readonly sendParent: <TSentEvent extends EventObject = EventObject>(
    event: SendToEvent<TContext, TEvent, TSentEvent>,
    options?: Omit<SendToOptions<TContext, TEvent, TNames["delays"]>, "id">
  ) => void

  /** Enqueues `sendSelf(event, options)` (port extra). */
  readonly sendSelf: <TSentEvent extends EventObject = EventObject>(
    event: SendToEvent<TContext, TEvent, TSentEvent>,
    options?: SendToOptions<TContext, TEvent, TNames["delays"]>
  ) => void

  /**
   * Enqueues `spawnChild(src, options)`: `{ id, systemId, input, syncSnapshot }`, with the
   * arguments `spawnChild` takes (upstream `Parameters<typeof spawnChild>`): a declared
   * actor's ids and input where the machine declares its actors, any input for a logic given
   * inline.
   */
  readonly spawnChild: <TLogic extends AnyActorLogic>(...args: SpawnChildArguments<TContext, TEvent, TLogic, TNames>) => void

  /** Enqueues `stopChild(child)`: a reference, an id, or a function giving one. */
  readonly stopChild: (child: StopChildTarget<TContext, TEvent>) => void

  /**
   * Enqueues `emit(event)`. In a setup machine that declares `types.emitted`, the event is
   * one of those events (XState); elsewhere any event object.
   */
  readonly emit: (event: EmitEvent<TContext, TEvent, TNames["emitted"]>) => void

  /** Enqueues `cancel(sendId)`. */
  readonly cancel: (sendId: CancelId<TContext, TEvent>) => void
}

/**
 * Arguments provided to the collect function (upstream `CollectActionsArg`): the context and
 * the event of the action, `self` and `system`, the enqueuer and `check`. `TNames` holds the
 * implementations `enqueue` and `check` may name (any name by default).
 *
 * @since 0.1.0
 * @category Actions
 */
export interface EnqueueActionsArg<
  TContext,
  TEvent extends EventObject,
  TNames extends ImplementationNames = ImplementationNames,
  TSelfEvent extends EventObject = TEvent
> {
  /** Current context */
  readonly context: TContext
  /** Current event */
  readonly event: TEvent
  /** Action enqueuer */
  readonly enqueue: ActionEnqueuer<TContext, TEvent, TNames, TSelfEvent>
  /**
   * Evaluates a guard now (upstream `evaluateGuard`), in any form a transition takes: a name
   * or `{ type, params }` of the machine's guards, an inline function of `{ context, event }`,
   * or a built-in guard (`and`, `or`, `not`, `stateIn`). It reads the context from before
   * any action this `enqueueActions` enqueues. A name without implementation throws
   * `Guard '<name>' is not implemented.'.`, which ends `collect` and becomes the actor's
   * error, as upstream.
   */
  readonly check: (guard: Guard<TContext, TEvent, TNames>) => boolean
  /** Reference to the machine actor itself */
  readonly self: ActionContext<TContext, TEvent, TSelfEvent>["self"]
  /** The actor system */
  readonly system: ActionContext<TContext, TEvent>["system"]
}

/**
 * Collect function type.
 *
 * @since 0.1.0
 * @category Actions
 */
export type CollectActions<
  TContext,
  TEvent extends EventObject,
  TParams = void,
  TNames extends ImplementationNames = ImplementationNames,
  TSelfEvent extends EventObject = TEvent
> = (
  args: EnqueueActionsArg<TContext, TEvent, TNames, TSelfEvent>,
  params: TParams
) => void

/**
 * EnqueueActionsDefinition extends ActionDefinition to include the collect function.
 *
 * This allows access to the collect function for potential resolution or inspection,
 * without requiring type assertions.
 *
 * @since 0.1.0
 * @category Actions
 */
export interface EnqueueActionsDefinition<
  TContext,
  TEvent extends EventObject,
  TParams = void,
  R = never,
  TNames extends ImplementationNames = ImplementationNames,
  TSelfEvent extends EventObject = TEvent
> extends ActionDefinition<TContext, TEvent, TParams, R, TNames, TSelfEvent> {
  /**
   * The collect function that queues actions imperatively.
   */
  readonly collect: CollectActions<TContext, TEvent, TParams, TNames, TSelfEvent>
}

/**
 * Creates an action that enqueues other actions imperatively (upstream `enqueueActions`).
 *
 * The engine calls `collect` once, when it reaches the action, with the context and the
 * event, `self` and `system`, the enqueuer and `check`, and the params of the use (an
 * `enqueueActions` used as a named action receives the params of `{ type, params }`). The
 * actions it enqueued then run in its place, in order, as if they stood in the action list
 * themselves: each one sees the context the ones before it assigned, a raise joins the
 * internal queue, sends, emits, spawns, stops, cancels and logs go through the engine, and a
 * nested `enqueueActions` resolves in place too. `check` evaluates a guard against the
 * context from before those actions run. What `collect` throws, a name without
 * implementation in `check` included, becomes the actor's error.
 *
 * @example
 * ```ts
 * const machine = setup({
 *   // ...
 * }).createMachine({
 *   entry: enqueueActions(({ enqueue, check, context }) => {
 *     // Always assign initial count
 *     enqueue.assign({ count: 0 })
 *
 *     // Conditionally raise an event
 *     if (context.shouldNotify) {
 *       enqueue.raise({ type: "NOTIFY" })
 *     }
 *
 *     // Check a guard
 *     if (check("isAdmin")) {
 *       enqueue.assign({ isAdmin: true })
 *     }
 *
 *     // A named action, and a built-in action such as log
 *     enqueue("track")
 *     enqueue(log("entered"))
 *   })
 * })
 * ```
 *
 * @since 0.1.0
 * @category Actions
 */
export const enqueueActions: EnqueueActions = (<
  TContext,
  TEvent extends EventObject,
  TParams = void,
  TNames extends ImplementationNames = ImplementationNames,
  TSelfEvent extends EventObject = TEvent
>(
  collect: CollectActions<TContext, TEvent, TParams, TNames, TSelfEvent>
): EnqueueActionsDefinition<TContext, TEvent, TParams, never, TNames, TSelfEvent> => {
  // Upstream `resolveEnqueueActions`: collect once, then hand the collected actions to the
  // engine, which resolves them in place. What collect throws is a defect that carries the
  // thrown value, so it becomes the actor's error (SD-4)
  const exec = (ctx: ActionContext<TContext, TEvent, TSelfEvent>, params: TParams) =>
    Effect.flatMap(Effect.context(), (services) =>
      Effect.sync(() => {
        // Any action form: the engine resolves each one as the machine's own action
        let actions: Chunk.Chunk<unknown> = Chunk.empty()
        const push = (action: unknown): void => {
          actions = Chunk.append(actions, action)
        }

        const enqueue: ActionEnqueuer<TContext, TEvent, ImplementationNames, TSelfEvent> = Object.assign(
          (action: Action<TContext, TEvent, ImplementationNames, TSelfEvent>) => push(action),
          {
            assign: (assignment: Assignment<TContext, TEvent, undefined, TSelfEvent>) =>
              push(assign<TContext, TEvent, undefined, TSelfEvent>(assignment)),
            raise: (event: RaiseEvent<TContext, TEvent, TSelfEvent>, options?: RaiseOptions<TContext, TEvent>) =>
              push(raise<TContext, TEvent, TSelfEvent, ImplementationNames, TSelfEvent, TSelfEvent>(event, options)),
            sendTo: <TTarget extends ActorRefBase, TSentEvent extends EventObject>(
              target: SendToTarget<TContext, TEvent, TTarget, TSelfEvent>,
              event: SendToTargetEvent<TContext, TEvent, TTarget, TSentEvent, TSelfEvent>,
              options?: SendToOptions<TContext, TEvent, string, TSelfEvent>
            ) => push(sendTo<TContext, TEvent, TSentEvent, ImplementationNames, TTarget, TSelfEvent>(target, event, options)),
            sendParent: <TSentEvent extends EventObject>(
              event: SendToEvent<TContext, TEvent, TSentEvent>,
              options?: Omit<SendToOptions<TContext, TEvent>, "id">
            ) => push(sendParent<TContext, TEvent, TSentEvent>(event, options)),
            sendSelf: <TSentEvent extends EventObject>(
              event: SendToEvent<TContext, TEvent, TSentEvent>,
              options?: SendToOptions<TContext, TEvent>
            ) => push(sendSelf<TContext, TEvent, TSentEvent>(event, options)),
            spawnChild: <TLogic extends AnyActorLogic>(src: string | TLogic, options?: UntypedSpawnChildOptions<TContext, TEvent>) =>
              push(spawnChild<TContext, TEvent, TLogic>(src, options)),
            stopChild: (child: StopChildTarget<TContext, TEvent>) => push(stopChild<TContext, TEvent>(child)),
            emit: (event: EmitEvent<TContext, TEvent, TNames["emitted"]>) =>
              push(emit<TContext, TEvent, TNames>(event)),
            cancel: (sendId: CancelId<TContext, TEvent>) => push(cancel<TContext, TEvent>(sendId)),
          }
        )

        // Upstream `check`: `evaluateGuard(guard, snapshot.context, event, snapshot)`, with the
        // machine's guards (the context's evaluator). `collect` is a synchronous user function
        // that wants a boolean, so the evaluation runs to its end here, with the actor's
        // services; what it fails or dies with (a name without implementation, a throwing
        // guard, a guard Effect that does not complete synchronously) is thrown, as upstream's
        // evaluator throws, and so ends `collect`
        const evaluate = Effect.runSyncWith(services)
        const check = (guard: Guard<TContext, TEvent>): boolean => evaluate(ctx.evaluateGuard(guard))

        collect({ context: ctx.context, event: ctx.event, enqueue, check, self: ctx.self, system: ctx.system }, params)

        // The engine runs them in this action's place (upstream `[snapshot, undefined, actions]`)
        return Types.ActionResult.Enqueued(Chunk.toReadonlyArray(actions))
      })
    )

  // Return the EnqueueActionsDefinition with collect property included
  return {
    type: "xstate.enqueueActions",
    exec,
    collect,
  }
}) as EnqueueActions

/**
 * The type of {@link enqueueActions}: its first signature is the one every call resolves to; the second
 * is never callable (it takes arguments that no value has) and gives an inline call the
 * checker's deferral, for the reason `SendTo` in `sendTo.ts` gives: written inline under an
 * `on` descriptor of a typed machine, the call then reads that descriptor's events instead of
 * `EventObject`.
 *
 * @since 0.1.0
 * @category Actions
 */
export interface EnqueueActions {
  <
    TContext,
    TEvent extends EventObject,
    TParams = void,
    TNames extends ImplementationNames = ImplementationNames,
    TSelfEvent extends EventObject = TEvent
  >(
    collect: CollectActions<TContext, TEvent, TParams, TNames, TSelfEvent>
  ): EnqueueActionsDefinition<TContext, TEvent, TParams, never, TNames, TSelfEvent>
  <TDeferred extends never>(first: TDeferred, second: TDeferred, third: TDeferred): (deferred: TDeferred) => never
}

// ============================================================
// UPSTREAM TYPE NAMES (EXP-1)
// ============================================================

/**
 * The action `enqueueActions(...)` returns (upstream `EnqueueActionsAction`): an action
 * definition of the context and the event it reads, which enqueues the machine's actions,
 * guards, delays and actors.
 *
 * @since 0.1.0
 * @category Actions
 */
export type EnqueueActionsAction<
  TContext,
  TExpressionEvent extends EventObject,
  TParams,
  TEvent extends EventObject,
  TActor extends Types.ProvidedActor,
  TAction extends Types.ParameterizedObject,
  TGuard extends Types.ParameterizedObject,
  TDelay extends string
> = EnqueueActionsDefinition<
  TContext,
  TExpressionEvent,
  TParams,
  never,
  Types.MachineTypesNames<TAction, TGuard, TDelay, TActor, EventObject>,
  TEvent
>
