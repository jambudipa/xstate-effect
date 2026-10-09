/**
 * @since 0.1.0
 * @module guards/and
 *
 * The and guard combines multiple guards with AND logic.
 */
import { Effect, Option } from "effect"
import type { EventObject } from "../Event.js"
import type { BuiltInGuardDefinition, Guard, GuardArg, MachineImplementations, ReferencedGuards } from "../Types.js"
import { evaluateGuard, guardScopeOf } from "./evaluateGuard.js"

/**
 * The params an `and` guard shows: its guards and its optional implementations (port extra).
 * The guard reads both from its closure, so it decides the same way when it is used by name
 * with other params (upstream ignores the params of that use).
 */
type AndGuardParams<TContext, TEvent extends EventObject> = {
  readonly guards: ReadonlyArray<Guard<TContext, TEvent>>
  readonly implementations?: MachineImplementations<TContext, TEvent>
}

/**
 * Creates a guard that passes only if ALL provided guards pass (upstream `and`).
 *
 * Each guard is evaluated in order by the shared `evaluateGuard`, which stops at the first
 * one that fails: a name or `{ type, params }` resolves against the machine's
 * implementations (or the `implementations` argument, a port extra), at any depth. An
 * unknown name fails the guard with `GuardError`.
 *
 * @example
 * ```ts
 * and([
 *   ({ context }) => context.count > 0,
 *   not("isDisabled"),
 *   "canProceed" // named guard from implementations
 * ])
 * ```
 *
 * @since 0.1.0
 * @category Guards
 */
export const and: And = (<TContext, TEvent extends EventObject>(
  guards: ReadonlyArray<Guard<TContext, TEvent>>,
  implementations?: MachineImplementations<TContext, TEvent>
): BuiltInGuardDefinition<TContext, TEvent, AndGuardParams<TContext, TEvent>> => ({
  type: "xstate.and",
  params: { guards, implementations },
  predicate: (ctx) =>
    Effect.gen(function* () {
      const scope = guardScopeOf(ctx, Option.fromNullishOr(implementations))
      for (const guard of guards) {
        if (!(yield* evaluateGuard(guard, ctx.context, ctx.event, scope))) {
          return false
        }
      }
      return true
    }),
})) as unknown as And

/**
 * The type of {@link and}: its first signature is the one every call resolves to. Each guard is
 * inferred as written (`TArgs`, XState `SingleGuardArg` for each), so the result carries the
 * guards they name (`ReferencedGuards`), which a setup checks against its own. The second is
 * never callable and gives an inline call the checker's deferral, as {@link Not} explains.
 *
 * @since 0.1.0
 * @category Guards
 */
export interface And {
  <TContext, TEvent extends EventObject, const TArgs extends Array<unknown> = Array<Guard<TContext, TEvent>>>(
    guards: readonly [...{ [K in keyof TArgs]: GuardArg<TContext, TEvent, TArgs[K]> }],
    implementations?: MachineImplementations<TContext, TEvent>
  ): BuiltInGuardDefinition<TContext, TEvent, AndGuardParams<TContext, TEvent>, ReferencedGuards<NoInfer<TArgs>[number]>>
  <TDeferred extends never>(first: TDeferred, second: TDeferred, third: TDeferred): (deferred: TDeferred) => never
}
