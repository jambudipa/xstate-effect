/**
 * @since 0.1.0
 * @module guards/not
 *
 * The not guard negates another guard.
 */
import { Effect, Option } from "effect"
import type { EventObject } from "../Event.js"
import type { BuiltInGuardDefinition, Guard, GuardArg, MachineImplementations, ReferencedGuards } from "../Types.js"
import { evaluateGuard, guardScopeOf } from "./evaluateGuard.js"

/**
 * The params a `not` guard shows: its guard and its optional implementations (port extra).
 * The guard reads both from its closure, so it decides the same way when it is used by name
 * with other params (upstream ignores the params of that use).
 */
type NotGuardParams<TContext, TEvent extends EventObject> = {
  readonly guard: Guard<TContext, TEvent>
  readonly implementations?: MachineImplementations<TContext, TEvent>
}

/**
 * Creates a guard that passes only if the provided guard fails (upstream `not`).
 *
 * The guard is evaluated by the shared `evaluateGuard`: a name or `{ type, params }`
 * resolves against the machine's implementations (or the `implementations` argument, a
 * port extra). An unknown name fails the guard with `GuardError`.
 *
 * @example
 * ```ts
 * not(({ context }) => context.isDisabled)
 * not("isLoading") // negate named guard
 * not(stateIn("error")) // negate stateIn guard
 * ```
 *
 * @since 0.1.0
 * @category Guards
 */
export const not: Not = (<TContext, TEvent extends EventObject>(
  guard: Guard<TContext, TEvent>,
  implementations?: MachineImplementations<TContext, TEvent>
): BuiltInGuardDefinition<TContext, TEvent, NotGuardParams<TContext, TEvent>> => ({
  type: "xstate.not",
  params: { guard, implementations },
  predicate: (ctx) =>
    evaluateGuard(guard, ctx.context, ctx.event, guardScopeOf(ctx, Option.fromNullishOr(implementations))).pipe(
      Effect.map((passes) => !passes)
    ),
})) as unknown as Not

/**
 * The type of {@link not}: its first signature is the one every call resolves to. The guard
 * is inferred as written (`TArg`, XState `SingleGuardArg`), so the result carries the guards it
 * names (`ReferencedGuards`), which a setup checks against its own. The second is never
 * callable (it takes arguments that no value has) and gives an inline call the checker's
 * deferral, as `Raise` does: written in a setup's `guards` record, an inline function guard
 * then reads the setup's context and events.
 *
 * @since 0.1.0
 * @category Guards
 */
export interface Not {
  <TContext, TEvent extends EventObject, TArg = Guard<TContext, TEvent>>(
    guard: GuardArg<TContext, TEvent, TArg>,
    implementations?: MachineImplementations<TContext, TEvent>
  ): BuiltInGuardDefinition<TContext, TEvent, NotGuardParams<TContext, TEvent>, ReferencedGuards<NoInfer<TArg>>>
  <TDeferred extends never>(first: TDeferred, second: TDeferred, third: TDeferred): (deferred: TDeferred) => never
}
