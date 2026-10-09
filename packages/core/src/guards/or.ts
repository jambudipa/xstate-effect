/**
 * @since 0.1.0
 * @module guards/or
 *
 * The or guard combines multiple guards with OR logic.
 */
import { Effect, Option } from "effect"
import type { EventObject } from "../Event.js"
import type { BuiltInGuardDefinition, Guard, GuardArg, MachineImplementations, ReferencedGuards } from "../Types.js"
import { evaluateGuard, guardScopeOf } from "./evaluateGuard.js"

/**
 * The params an `or` guard shows: its guards and its optional implementations (port extra).
 * The guard reads both from its closure, so it decides the same way when it is used by name
 * with other params (upstream ignores the params of that use).
 */
type OrGuardParams<TContext, TEvent extends EventObject> = {
  readonly guards: ReadonlyArray<Guard<TContext, TEvent>>
  readonly implementations?: MachineImplementations<TContext, TEvent>
}

/**
 * Creates a guard that passes if ANY of the provided guards pass (upstream `or`).
 *
 * Each guard is evaluated in order by the shared `evaluateGuard`, which stops at the first
 * one that passes: a name or `{ type, params }` resolves against the machine's
 * implementations (or the `implementations` argument, a port extra), at any depth. An
 * unknown name that is evaluated fails the guard with `GuardError`.
 *
 * @example
 * ```ts
 * or([
 *   ({ context }) => context.isAdmin,
 *   { type: "hasRole", params: { role: "editor" } },
 *   "isSuperUser" // named guard from implementations
 * ])
 * ```
 *
 * @since 0.1.0
 * @category Guards
 */
export const or: Or = (<TContext, TEvent extends EventObject>(
  guards: ReadonlyArray<Guard<TContext, TEvent>>,
  implementations?: MachineImplementations<TContext, TEvent>
): BuiltInGuardDefinition<TContext, TEvent, OrGuardParams<TContext, TEvent>> => ({
  type: "xstate.or",
  params: { guards, implementations },
  predicate: (ctx) =>
    Effect.gen(function* () {
      const scope = guardScopeOf(ctx, Option.fromNullishOr(implementations))
      for (const guard of guards) {
        if (yield* evaluateGuard(guard, ctx.context, ctx.event, scope)) {
          return true
        }
      }
      return false
    }),
})) as unknown as Or

/**
 * The type of {@link or}: its first signature is the one every call resolves to. Each guard is
 * inferred as written (`TArgs`, XState `SingleGuardArg` for each), so the result carries the
 * guards they name (`ReferencedGuards`), which a setup checks against its own. The second is
 * never callable and gives an inline call the checker's deferral, as {@link Not} explains.
 *
 * @since 0.1.0
 * @category Guards
 */
export interface Or {
  <TContext, TEvent extends EventObject, const TArgs extends Array<unknown> = Array<Guard<TContext, TEvent>>>(
    guards: readonly [...{ [K in keyof TArgs]: GuardArg<TContext, TEvent, TArgs[K]> }],
    implementations?: MachineImplementations<TContext, TEvent>
  ): BuiltInGuardDefinition<TContext, TEvent, OrGuardParams<TContext, TEvent>, ReferencedGuards<NoInfer<TArgs>[number]>>
  <TDeferred extends never>(first: TDeferred, second: TDeferred, third: TDeferred): (deferred: TDeferred) => never
}
