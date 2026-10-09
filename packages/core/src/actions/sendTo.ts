/**
 * @since 0.1.0
 * @module actions/sendTo
 *
 * The sendTo action sends an event to another actor.
 */
import { Effect, Option } from "effect"
import type { EventObject } from "../Event.js"
import type { ActorRef, ActorRefBase } from "../ActorRef.js"
import type { AnyEventObject } from "../internal/anyEventObject.js"
import type { Snapshot } from "../Snapshot.js"
import { ActorError } from "../Errors.js"
import { withDelay } from "../internal/actionDelay.js"
import { warnIfInCustomAction } from "../internal/customAction.js"
import { lookupDelay, resolveDelay, toDelayMillis } from "../internal/delay.js"
import type { ActionDefinition, ActionContext, ImplementationNames, MachineImplementations } from "../Types.js"
import * as Types from "../Types.js"

/**
 * The target of a send: a name, a reference, or a function of the action arguments and the
 * params of the use that gives one. A function that gives `undefined` targets the machine
 * actor itself (upstream). `TTarget` is the reference the target gives, which types the
 * event (`SendToTargetEvent`); `TSelfEvent` is every event of the machine, which the
 * function's `self` takes.
 *
 * @since 0.1.0
 * @category Actions
 */
export type SendToTarget<
  TContext,
  TEvent extends EventObject,
  TTarget extends ActorRefBase = ActorRefBase,
  TSelfEvent extends EventObject = TEvent
> =
  | string
  | TTarget
  | ((ctx: ActionContext<TContext, TEvent, TSelfEvent>, params: unknown) => TTarget | string | undefined)

/**
 * The event of a send: an event object, or a function of the action arguments and the params
 * of the use that gives one (its `self` takes `TSelfEvent`, every event of the machine).
 *
 * @since 0.1.0
 * @category Actions
 */
export type SendToEvent<
  TContext,
  TEvent extends EventObject,
  TSentEvent extends EventObject = EventObject,
  TSelfEvent extends EventObject = TEvent
> =
  | TSentEvent
  | ((ctx: ActionContext<TContext, TEvent, TSelfEvent>, params: unknown) => TSentEvent)

/**
 * The event a send takes for its target (upstream `EventFrom` of the target): a reference
 * typed by its logic (an `ActorRef`) takes its own events, as an object or from a function;
 * a name or an untyped reference (`ActorRefBase`, `AnyActorRef`) takes any event object
 * (`TSentEvent`, inferred from the argument) and also a string, which upstream's `any`
 * accepts and the run time rejects with upstream's message.
 *
 * @since 0.1.0
 * @category Actions
 */
export type SendToTargetEvent<
  TContext,
  TEvent extends EventObject,
  TTarget,
  TSentEvent extends EventObject = AnyEventObject,
  TSelfEvent extends EventObject = TEvent
> = TTarget extends ActorRef<Snapshot, infer TTargetEvent>
  ? SendToEvent<TContext, TEvent, TTargetEvent, TSelfEvent>
  : SendToEvent<TContext, TEvent, TSentEvent, TSelfEvent> | string

/**
 * Options for sendTo. `TDelay` is the delay names the delay may name (any name by default; a
 * setup's bound `sendTo` takes the setup's delays).
 *
 * @since 0.1.0
 * @category Actions
 */
export interface SendToOptions<
  TContext,
  TEvent extends EventObject,
  TDelay extends string = string,
  TSelfEvent extends EventObject = TEvent
> {
  /**
   * The delay: milliseconds, the name of a delay of the machine's `delays` implementations
   * (`setup({ delays })`, `provide({ delays })`), or a function of the action arguments and
   * the params of the use that gives milliseconds. A delay that does not resolve to a number
   * (a name that names no delay, a function that gives no number) sends the event at once,
   * as no delay does (upstream `resolveSendTo`).
   */
  readonly delay?: number | TDelay | ((ctx: ActionContext<TContext, TEvent, TSelfEvent>, params: unknown) => number)
  /** ID for the delayed event (for cancellation) */
  readonly id?: string
  /**
   * Delays that decide a delay name before the machine's own (a port extra, kept for the
   * port's earlier callers). A name they lack reads the machine's `delays`, as without the
   * option; upstream has no such option.
   */
  readonly implementations?: MachineImplementations<TContext, TEvent>
}

/**
 * The action context of a send as the `implementations` option's delays read it.
 * `TSelfEvent` is every event of the machine, so it holds `TEvent`, the events of the `on`
 * descriptor the send is written under, and a `self` that takes `TSelfEvent` takes `TEvent`
 * too; TypeScript has no lower bound to state that, so the context is cast once here.
 */
const descriptorContext = <TContext, TEvent extends EventObject, TSelfEvent extends EventObject>(
  ctx: ActionContext<TContext, TEvent, TSelfEvent>
): ActionContext<TContext, TEvent> => ctx as unknown as ActionContext<TContext, TEvent>

/**
 * The delay of a send in milliseconds (upstream `resolveSendTo`): a function's result, a
 * number as it is, a name through the machine's `delays` (`ctx.resolveDelay`, so a delay
 * function runs here, before the target function, as upstream); a name that the
 * `implementations` option holds is resolved against the option first (port extra). None
 * when it gives no number, which sends at once.
 */
const sendDelay = <TContext, TEvent extends EventObject, TSelfEvent extends EventObject>(
  delay: NonNullable<SendToOptions<TContext, TEvent, string, TSelfEvent>["delay"]>,
  ctx: ActionContext<TContext, TEvent, TSelfEvent>,
  params: unknown,
  implementations: Option.Option<MachineImplementations<TContext, TEvent>>
): Option.Option<number> => {
  if (typeof delay === "function") {
    return toDelayMillis(delay(ctx, params))
  }
  if (typeof delay === "number") {
    return Option.some(delay)
  }
  return Option.match(
    Option.filter(implementations, (option) => Option.isSome(lookupDelay(option, delay))),
    {
      onNone: () => ctx.resolveDelay(delay, params),
      onSome: (option) => resolveDelay(option, delay, descriptorContext(ctx), params),
    }
  )
}

/** The upstream message for a string event (`src/actions/send.ts:72`). */
const onlyEventObjects = (eventType: string): string =>
  `Only event objects may be used with sendTo; use sendTo({ type: "${eventType}" }) instead`

/** The upstream message for a `forwardTo` target that resolves to nothing (`src/actions/send.ts:367`). */
const forwardToUndefinedActor = "Attempted to forward event to undefined actor. This risks an infinite loop in the sender."

/**
 * Creates an action that sends an event to another actor (upstream `sendTo`).
 *
 * The engine resolves the target while the transition runs, with the snapshot of that point
 * of the action list (upstream `resolveSendTo`): a reference as it is; `#_parent` (the parent),
 * `#_internal` and the port's `#_self` (the machine actor itself), `#_<id>` (the child with
 * that id); any other name is a child id (a child spawned earlier in the same list counts),
 * then a systemId of the actor system (D7, beyond XState). A function target and an event
 * function receive the action arguments and the params of the use; a function target that
 * gives `undefined` sends to the machine actor itself. A name that resolves to nothing, and
 * a string event, set the machine's status to `error` with the upstream message.
 *
 * The event is typed by the target (`SendToTargetEvent`, upstream `EventFrom` of the
 * target): a reference typed by its logic takes its own events only; a name or an untyped
 * reference takes any event object, and a string, as upstream's `any` does.
 *
 * Without a delay the event goes out after the macrostep commits, through `system.relay`
 * (so the `@xstate.event` inspection event names the sender); an event of type
 * `xstate.error` arrives as `{ type: "xstate.error.actor.<sender id>", error: data, actorId }`.
 * With a delay the event is scheduled under the send `id`, which `cancel` takes. A delay name
 * reads the machine's `delays` (`setup({ delays })`, overridden by `provide({ delays })`); a
 * delay that does not resolve to a number sends at once.
 *
 * @example
 * ```ts
 * // Send to a child by its id, or to an actor by its systemId
 * sendTo("worker", { type: "PING" })
 *
 * // Send to an actor reference from context
 * sendTo(({ context }) => context.targetRef, { type: "PING" })
 *
 * // Dynamic event based on context
 * sendTo(
 *   ({ context }) => context.targetRef,
 *   ({ context }) => ({ type: "DATA", value: context.data })
 * )
 *
 * // With delay (number)
 * sendTo("timer", { type: "TICK" }, { delay: 1000 })
 *
 * // With a named delay of the machine's `delays`
 * sendTo("timer", { type: "TICK" }, { delay: "longDelay" })
 * ```
 *
 * @since 0.1.0
 * @category Actions
 */
export const sendTo: SendTo = (<
  TContext,
  TEvent extends EventObject,
  TSentEvent extends EventObject = EventObject,
  TNames extends ImplementationNames = ImplementationNames,
  TTarget extends ActorRefBase = ActorRefBase,
  TSelfEvent extends EventObject = TEvent
>(
  target: SendToTarget<TContext, TEvent, TTarget, TSelfEvent>,
  event: SendToTargetEvent<TContext, TEvent, TTarget, TSentEvent, TSelfEvent>,
  options?: SendToOptions<TContext, TEvent, NoInfer<TNames>["delays"], TSelfEvent>
): ActionDefinition<TContext, TEvent, void, never, TNames, TSelfEvent> => {
  warnIfInCustomAction("sendTo")
  // Each branch of the target-typed event is an event object, a function that gives one, or
  // (for a name or an untyped target) a string
  const given: SendToEvent<TContext, TEvent, EventObject, TSelfEvent> | string = event
  const definition: ActionDefinition<TContext, TEvent, void, never, TNames, TSelfEvent> = {
    type: "xstate.sendTo",
    exec: (ctx, params) =>
      Effect.gen(function* () {
        // Upstream `resolveSendTo`: the event first; a string event (the type system takes it
        // only for a name or an untyped target, as upstream's `any` does) is an error of the
        // sending actor (SD-3, SD-4)
        if (typeof given === "string") {
          return yield* Effect.die(new ActorError({ message: onlyEventObjects(given), actorId: ctx.self.id }))
        }
        const eventToSend = typeof given === "function" ? given(ctx, params) : given

        // Then the delay; a name reads the machine's `delays` now, so a delay function runs
        // before a target function, as upstream
        const delay = Option.flatMap(Option.fromNullishOr(options?.delay), (given) =>
          sendDelay(given, ctx, params, Option.fromNullishOr(options?.implementations))
        )

        // Then the target; a function that gives nothing targets the machine actor itself. The
        // engine resolves a name against the snapshot's children and the system.
        const resolvedTarget = typeof target === "function" ? target(ctx, params) : target
        return Types.ActionResult.SendEvent(resolvedTarget ?? ctx.self, eventToSend, {
          delay,
          id: Option.fromNullishOr(options?.id),
        })
      }),
  }
  // Upstream `sendTo.delay = options?.delay`, which the graph's test model reads
  return withDelay(definition, options?.delay)
}) as SendTo

/**
 * The type of {@link sendTo}. Its first signature is the one every call resolves to. The
 * second is never callable (it needs four arguments that no value has) and exists for the
 * TypeScript checker only, as the second signature of `Assign` does: a generic call nested
 * in the config of `createMachine` would otherwise be resolved before the machine has
 * inferred its event type, so an inline `sendTo` under an `on` descriptor of a typed machine
 * would read `EventObject` instead of that descriptor's events. Upstream's `sendTo` returns
 * a function, which the checker defers; the second signature gives the port's definition
 * object the same deferral.
 *
 * @since 0.1.0
 * @category Actions
 */
export interface SendTo {
  <
    TContext,
    TEvent extends EventObject,
    TSentEvent extends EventObject = EventObject,
    TNames extends ImplementationNames = ImplementationNames,
    TTarget extends ActorRefBase = ActorRefBase,
    TSelfEvent extends EventObject = TEvent
  >(
    target: SendToTarget<TContext, TEvent, TTarget, TSelfEvent>,
    event: SendToTargetEvent<TContext, TEvent, TTarget, TSentEvent, TSelfEvent>,
    options?: SendToOptions<TContext, TEvent, NoInfer<TNames>["delays"], TSelfEvent>
  ): ActionDefinition<TContext, TEvent, void, never, TNames, TSelfEvent>
  <TDeferred extends never>(
    first: TDeferred,
    second: TDeferred,
    third: TDeferred,
    fourth: TDeferred
  ): (deferred: TDeferred) => never
}

/**
 * Creates an action that sends an event to the parent actor (upstream `sendParent`, which is
 * `sendTo('#_parent', ...)`). An actor without a parent gets status `error` with
 * `Unable to send event to actor '#_parent' from machine '<id>'.`.
 *
 * @example
 * ```ts
 * sendParent({ type: "CHILD_DONE", result: 42 })
 * ```
 *
 * @since 0.1.0
 * @category Actions
 */
export const sendParent: SendParent = (<
  TContext,
  TEvent extends EventObject,
  TSentEvent extends EventObject = EventObject,
  TNames extends ImplementationNames = ImplementationNames
>(
  event: SendToEvent<TContext, TEvent, TSentEvent>,
  options?: Omit<SendToOptions<TContext, TEvent, NoInfer<TNames>["delays"]>, "id">
): ActionDefinition<TContext, TEvent, void, never, TNames> =>
  sendTo<TContext, TEvent, TSentEvent, TNames>("#_parent", event, options)) as SendParent

/**
 * The type of {@link sendParent}: its first signature is the one every call resolves to; the
 * second is never callable and gives an inline `sendParent` the checker's deferral, for the
 * reason {@link SendTo} gives.
 *
 * @since 0.1.0
 * @category Actions
 */
export interface SendParent {
  <
    TContext,
    TEvent extends EventObject,
    TSentEvent extends EventObject = EventObject,
    TNames extends ImplementationNames = ImplementationNames
  >(
    event: SendToEvent<TContext, TEvent, TSentEvent>,
    options?: Omit<SendToOptions<TContext, TEvent, NoInfer<TNames>["delays"]>, "id">
  ): ActionDefinition<TContext, TEvent, void, never, TNames>
  <TDeferred extends never>(first: TDeferred, second: TDeferred, third: TDeferred): (deferred: TDeferred) => never
}

/**
 * Creates an action that sends an event to self.
 *
 * @example
 * ```ts
 * sendSelf({ type: "RETRY" }, { delay: 1000 })
 * ```
 *
 * @since 0.1.0
 * @category Actions
 */
export const sendSelf: SendSelf = (<
  TContext,
  TEvent extends EventObject,
  TSentEvent extends EventObject = EventObject,
  TNames extends ImplementationNames = ImplementationNames
>(
  event: SendToEvent<TContext, TEvent, TSentEvent>,
  options?: SendToOptions<TContext, TEvent, NoInfer<TNames>["delays"]>
): ActionDefinition<TContext, TEvent, void, never, TNames> =>
  sendTo<TContext, TEvent, TSentEvent, TNames>("#_self", event, options)) as SendSelf

/**
 * The type of {@link sendSelf}: its first signature is the one every call resolves to; the second
 * is never callable (it takes arguments that no value has) and gives an inline call the
 * checker's deferral, for the reason `SendTo` in `sendTo.ts` gives: written inline under an
 * `on` descriptor of a typed machine, the call then reads that descriptor's events instead of
 * `EventObject`.
 *
 * @since 0.1.0
 * @category Actions
 */
export interface SendSelf {
  <
    TContext,
    TEvent extends EventObject,
    TSentEvent extends EventObject = EventObject,
    TNames extends ImplementationNames = ImplementationNames
  >(
    event: SendToEvent<TContext, TEvent, TSentEvent>,
    options?: SendToOptions<TContext, TEvent, NoInfer<TNames>["delays"]>
  ): ActionDefinition<TContext, TEvent, void, never, TNames>
  <TDeferred extends never>(first: TDeferred, second: TDeferred, third: TDeferred): (deferred: TDeferred) => never
}

/**
 * Creates an action that forwards the event being handled to the target actor (upstream
 * `forwardTo`): a `sendTo` of the current event, with the same targets and options. A target
 * that resolves to nothing (`undefined` or an empty name) would send the event back to the
 * machine itself, so it sets the machine's status to `error` with `Attempted to forward event
 * to undefined actor. This risks an infinite loop in the sender.`.
 *
 * @example
 * ```ts
 * on: { UPDATE: { actions: forwardTo("worker") } }
 * ```
 *
 * @since 0.1.0
 * @category Actions
 */
export const forwardTo: ForwardTo = (<TContext, TEvent extends EventObject>(
  target: SendToTarget<TContext, TEvent>,
  options?: SendToOptions<TContext, TEvent>
): ActionDefinition<TContext, TEvent> => {
  // Upstream builds forwardTo with sendTo, so it warns as sendTo
  warnIfInCustomAction("sendTo")
  const definition: ActionDefinition<TContext, TEvent> = {
    type: "xstate.sendTo",
    exec: (ctx, params) =>
      Effect.gen(function* () {
        const resolved = Option.filter(
          Option.fromNullishOr(typeof target === "function" ? target(ctx, params) : target),
          (found) => found !== ""
        )
        if (Option.isNone(resolved)) {
          return yield* Effect.die(new ActorError({ message: forwardToUndefinedActor, actorId: ctx.self.id }))
        }
        return yield* sendTo<TContext, TEvent, TEvent>(resolved.value, ({ event }) => event, options).exec(ctx, params)
      }),
  }
  // Upstream's forwardTo is a sendTo, whose `delay` the graph's test model reads
  return withDelay(definition, options?.delay)
}) as ForwardTo

/**
 * The type of {@link forwardTo}: its first signature is the one every call resolves to; the second
 * is never callable (it takes arguments that no value has) and gives an inline call the
 * checker's deferral, for the reason `SendTo` in `sendTo.ts` gives: written inline under an
 * `on` descriptor of a typed machine, the call then reads that descriptor's events instead of
 * `EventObject`.
 *
 * @since 0.1.0
 * @category Actions
 */
export interface ForwardTo {
  <
    TContext,
    TEvent extends EventObject
  >(
    target: SendToTarget<TContext, TEvent>,
    options?: SendToOptions<TContext, TEvent>
  ): ActionDefinition<TContext, TEvent>
  <TDeferred extends never>(first: TDeferred, second: TDeferred, third: TDeferred): (deferred: TDeferred) => never
}

// ============================================================
// UPSTREAM TYPE NAMES (EXP-1)
// ============================================================

/**
 * The action `sendTo(...)` returns (upstream `SendToAction`): an action definition of the
 * context and the event it reads, with a delay of `TDelay`.
 *
 * @since 0.1.0
 * @category Actions
 */
export type SendToAction<
  TContext,
  TExpressionEvent extends EventObject,
  _TParams,
  TEvent extends EventObject,
  TDelay extends string
> = ActionDefinition<
  TContext,
  TExpressionEvent,
  void,
  never,
  Types.MachineTypesNames<Types.ParameterizedObject, Types.ParameterizedObject, TDelay, Types.ProvidedActor, EventObject>,
  TEvent
>
