/**
 * @since 0.1.0
 * @module actions/assign
 *
 * The assign action updates the machine context.
 */
import { Effect, Predicate } from "effect"
import { ActorError } from "../Errors.js"
import type { EventObject } from "../Event.js"
import { warnIfInCustomAction } from "../internal/customAction.js"
import type { ActionDefinition, ActionContext, AssignDefinitionParams, ImplementationNames, ImplementsParams } from "../Types.js"
import * as Types from "../Types.js"

/**
 * The function form of an assignment (upstream `Assigner`): it receives the action context
 * and the params of the use, and returns the keys to change. It may return an Effect of them
 * (port extension); what that Effect fails with becomes the actor's error.
 *
 * @since 0.1.0
 * @category Actions
 */
export type Assigner<
  TContext,
  TEvent extends EventObject,
  TParams = void,
  TSelfEvent extends EventObject = TEvent,
  TNames extends ImplementationNames = ImplementationNames
> = (
  ctx: ActionContext<TContext, TEvent, TSelfEvent, TNames>,
  params: TParams
) => Partial<TContext> | Effect.Effect<Partial<TContext>, unknown>

/**
 * The object form of an assignment (upstream `PropertyAssigner`): each key holds its new
 * value, or a function of the action context and the params of the use that computes it.
 *
 * @since 0.1.0
 * @category Actions
 */
export type PropertyAssigner<
  TContext,
  TEvent extends EventObject,
  TParams = void,
  TSelfEvent extends EventObject = TEvent,
  TNames extends ImplementationNames = ImplementationNames
> = {
  readonly [K in keyof TContext]?:
    | TContext[K]
    | ((ctx: ActionContext<TContext, TEvent, TSelfEvent, TNames>, params: TParams) => TContext[K])
}

/**
 * Assignment can be an object of new values and property assigners, or a function that
 * returns a partial context. `TParams` types the params of the use that each function
 * receives: `void` (none) for an inline assign; the params type of the action for an assign
 * that implements a `{ type, params }` action.
 *
 * @since 0.1.0
 * @category Actions
 */
export type Assignment<
  TContext,
  TEvent extends EventObject,
  TParams = void,
  TSelfEvent extends EventObject = TEvent,
  TNames extends ImplementationNames = ImplementationNames
> =
  | Partial<TContext>
  | PropertyAssigner<TContext, TEvent, TParams, TSelfEvent, TNames>
  | Assigner<TContext, TEvent, TParams, TSelfEvent, TNames>

/**
 * The values of an object assignment (upstream `resolveAssign`): a function value is a
 * property assigner, called with the action context (its `spawn` included) and the params;
 * any other value is copied. Every property assigner reads the same context: the one from
 * before the action.
 */
const resolveProperties = <TContext, TEvent extends EventObject, TParams, TSelfEvent extends EventObject>(
  assignment: PropertyAssigner<TContext, TEvent, TParams, TSelfEvent>,
  ctx: ActionContext<TContext, TEvent, TSelfEvent>,
  params: TParams
): Partial<TContext> =>
  Object.fromEntries(
    Object.entries(assignment).map(([key, value]) => [
      key,
      typeof value === "function"
        ? (value as (ctx: ActionContext<TContext, TEvent, TSelfEvent>, params: TParams) => unknown)(ctx, params)
        : value,
    ])
  ) as Partial<TContext>

/** The upstream error for an assign on a snapshot without context (`src/actions/assign.ts:45`). */
const undefinedContextMessage =
  "Cannot assign to undefined `context`. Ensure that `context` is defined in the machine config."

/**
 * Runs one assignment against the action context (upstream `resolveAssign`): a snapshot
 * whose context is falsy fails with the upstream error before any assigner runs (an `Error`
 * named `Error`, as upstream throws it); otherwise the partial context is merged into a copy
 * of the context (`Object.assign({}, context, partial)`). What an assigner throws, and what
 * its Effect fails with, is a defect that carries the value: the actor's error (SD-4).
 */
const resolveAssign = <TContext, TEvent extends EventObject, TParams, TSelfEvent extends EventObject>(
  assignment: Assignment<TContext, TEvent, TParams, TSelfEvent>,
  ctx: ActionContext<TContext, TEvent, TSelfEvent>,
  params: TParams
): Effect.Effect<Types.ActionResult> =>
  Predicate.isTruthy(ctx.context)
    ? Effect.gen(function* () {
        const result =
          typeof assignment === "function" ? assignment(ctx, params) : resolveProperties(assignment, ctx, params)

        // Handle Effect-returning assignment functions (port extension)
        const partialContext: Partial<TContext> = Effect.isEffect(result)
          ? yield* Effect.orDie(result)
          : result

        return Types.ActionResult.ContextUpdate({
          ...ctx.context,
          ...partialContext,
        })
      })
    : Effect.die(new ActorError({ message: undefinedContextMessage, actorId: ctx.self.id }))

/**
 * Creates an assign action that updates the machine context.
 *
 * The assign action receives a fully-typed ActionContext with:
 * - `ctx.context` - Your exact context type
 * - `ctx.event` - Your exact event union type
 * - `ctx.self` - Typed reference to the current actor
 * - `ctx.system` - Typed actor system access
 * - `ctx.spawn` - The synchronous spawn: the child joins `snapshot.children` with the update
 *
 * and, as its second argument, the params of the use (upstream): an assign that implements
 * a `{ type, params }` action receives that use's params; an inline assign and a string
 * reference receive `undefined`. Give their type as an annotation of the params argument,
 * or as the `TParams` type argument.
 *
 * In the object form, a function value is a property assigner (upstream): it receives the
 * same context and params and computes that key's value; any other value is copied. Every
 * assigner reads the context from before the action.
 *
 * The context and event types come from where the action is used (the machine's types, as
 * upstream `LowInfer`), never from the assignment: an object whose values are property
 * assigners is not a partial context. That holds inline in a `createMachine` or `setup`
 * call that infers those types from the same config (its `types` member, its `context`):
 * see {@link Assign} for how. The params type comes from an annotated params argument
 * (`(ctx, params: number) => ...`, upstream infers it the same way), the type argument, or
 * an implementation slot that knows the params of its action's uses (`types.actions` in
 * `createMachine`, a setup machine's `provide`; see `ImplementsParams`); it is `undefined`
 * otherwise, inline too (upstream: an inline built-in action's params are `undefined`). A
 * setup reads it to check the params of each `{ type, params }` use.
 *
 * A snapshot without context (a restored snapshot that has none) fails the action with the
 * upstream error `Cannot assign to undefined \`context\`. ...`, which the actor takes as
 * its error, as it takes whatever an assigner throws.
 *
 * @example
 * ```ts
 * // Object assignment
 * assign({ count: 0 })
 *
 * // Property assigners, spawn included
 * assign({
 *   count: ({ context }) => context.count + 1,
 *   child: ({ spawn }) => spawn(childLogic, { id: "child" })
 * })
 *
 * // Function assignment with full type inference
 * assign((ctx) => ({
 *   count: ctx.context.count + 1,
 *   lastEvent: ctx.event.type
 * }))
 *
 * // Narrow event type with type guard
 * assign((ctx) => {
 *   if (ctx.event.type === "INCREMENT") {
 *     return { count: ctx.context.count + ctx.event.amount }
 *   }
 *   return {}
 * })
 *
 * // An implementation of `{ type: "add", params: { by: 5 } }`
 * createMachine(config, {
 *   actions: {
 *     add: assign<Context, Event, { by: number }>({
 *       count: ({ context }, params) => context.count + params.by
 *     })
 *   }
 * })
 * ```
 *
 * @since 0.1.0
 * @category Actions
 */
export const assign: Assign = (<TContext, TEvent extends EventObject, TParams, TSelfEvent extends EventObject>(
  assignment: Assignment<TContext, TEvent, TParams, TSelfEvent>
): ActionDefinition<TContext, TEvent, TParams, never, ImplementationNames, TSelfEvent> => {
  warnIfInCustomAction("assign")
  return {
    type: "xstate.assign",
    exec: (ctx, params) => resolveAssign(assignment, ctx, params),
  }
}) as Assign

/**
 * The type of {@link assign}. Its first signature is the one every call resolves to. The
 * second is never callable (it needs three arguments that no value has) and exists for the
 * TypeScript checker only: a generic call nested in the arguments of another generic call
 * is resolved before that call has inferred anything, unless the callee has a generic
 * signature that returns a function, which the checker defers to its second pass. Upstream's
 * `assign` returns a function, so `createMachine({ types, context, ... })` and
 * `setup({ types, actions })` type an inline assigner with their own context and event types.
 * The port's `assign` returns a definition object (D15); the second signature gives it the
 * same deferral, so the first signature then reads those types from where the action is
 * used.
 *
 * The result also carries the type-only {@link ImplementsParams} member, so a slot that
 * knows the params of its action's uses gives them to `TParams`; `NoInfer` keeps an inline
 * use (whose `Action` type names no params) from inferring them. `TSelfEvent` is every event
 * of the machine, which the assigners' `self` takes; the slot gives it, as it gives `TEvent`
 * the events of the `on` descriptor the assign is written under. `TNames` is the names of the
 * place the assign is written in (a setup's `actions` record gives the setup's), so the
 * assigners' `spawn` takes only those actors, each with the input of its logic (XState
 * `Spawner<TActor>`).
 *
 * @since 0.1.0
 * @category Actions
 */
export interface Assign {
  <
    TContext,
    TEvent extends EventObject,
    TParams = undefined,
    TSelfEvent extends EventObject = TEvent,
    TNames extends ImplementationNames = ImplementationNames
  >(
    assignment: Assignment<NoInfer<TContext>, NoInfer<TEvent>, TParams, NoInfer<TSelfEvent>, NoInfer<TNames>>
  ): ActionDefinition<TContext, TEvent, AssignDefinitionParams<NoInfer<TParams>>, never, TNames, TSelfEvent> & ImplementsParams<TParams>
  <TDeferred extends never>(first: TDeferred, second: TDeferred, third: TDeferred): (deferred: TDeferred) => never
}

/**
 * Type-safe assign for a single property: `assign({ [key]: value })`, so a function value
 * receives the action context and the params of the use (typed by `TParams`), and a
 * snapshot without context fails as for `assign`.
 *
 * @example
 * ```ts
 * assignProperty("count", (ctx) => ctx.context.count + 1)
 * ```
 *
 * @since 0.1.0
 * @category Actions
 */
export const assignProperty = <
  TContext,
  TEvent extends EventObject,
  K extends keyof TContext,
  TParams = void
>(
  key: K,
  value: TContext[K] | ((ctx: ActionContext<TContext, TEvent>, params: TParams) => TContext[K])
): ActionDefinition<TContext, TEvent, TParams> => {
  // One key of the object form; the mapped type does not see a computed key as one of its own
  const assignment = { [key]: value } as PropertyAssigner<TContext, TEvent, TParams>
  return {
    type: "xstate.assign",
    exec: (ctx, params) => resolveAssign(assignment, ctx, params),
  }
}

// ============================================================
// UPSTREAM TYPE NAMES (EXP-1)
// ============================================================

/**
 * The argument an assigner receives (upstream `AssignArgs`): the action context, whose
 * `spawn` takes the provided actors `TActor`.
 *
 * @since 0.1.0
 * @category Actions
 */
export type AssignArgs<
  TContext,
  TExpressionEvent extends EventObject,
  TEvent extends EventObject,
  TActor extends Types.ProvidedActor
> = ActionContext<
  TContext,
  TExpressionEvent,
  TEvent,
  Types.MachineTypesNames<Types.ParameterizedObject, Types.ParameterizedObject, string, TActor, EventObject>
>

/**
 * A function that gives one context property from the assigner's argument and the params
 * (upstream `PartialAssigner`).
 *
 * @since 0.1.0
 * @category Actions
 */
export type PartialAssigner<
  TContext,
  TExpressionEvent extends EventObject,
  TParams,
  TEvent extends EventObject,
  TActor extends Types.ProvidedActor,
  TKey extends keyof TContext
> = (args: AssignArgs<TContext, TExpressionEvent, TEvent, TActor>, params: TParams) => TContext[TKey]

/**
 * The action `assign(...)` returns (upstream `AssignAction`): an action definition of the
 * context and the event it reads, which takes every event of the machine (`TEvent`).
 *
 * @since 0.1.0
 * @category Actions
 */
export type AssignAction<
  TContext,
  TExpressionEvent extends EventObject,
  TParams,
  TEvent extends EventObject,
  _TActor extends Types.ProvidedActor
> =
  & ActionDefinition<TContext, TExpressionEvent, AssignDefinitionParams<TParams>, never, ImplementationNames, TEvent>
  & ImplementsParams<TParams>
