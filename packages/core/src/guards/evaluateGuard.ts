/**
 * @since 0.1.0
 * @module guards/evaluateGuard
 *
 * The one guard evaluator (upstream `evaluateGuard` in `src/guards.ts`), shared by the
 * engine's transition selection and the built-in guards `and`, `or`, `not` and `stateNotIn`.
 */
import { Context, Effect, Option, Predicate, Result } from "effect"
import { GuardError } from "../Errors.js"
import type { EventObject } from "../Event.js"
import type {
  Guard,
  GuardArgs,
  GuardContext,
  GuardDefinition,
  GuardImplementation,
  GuardPredicate,
  GuardScope,
  MachineImplementations,
  ParameterizedGuard,
} from "../Types.js"

/** A port guard definition of any params type, as configs and implementations hold it. */
type AnyGuardDefinition<TContext, TEvent extends EventObject> = Pick<GuardDefinition<TContext, TEvent, never>, "type" | "predicate">

/** What a name resolves to: something that decides, and the params of the use that named it. */
interface ResolvedGuard<TContext, TEvent extends EventObject> {
  /** The function or definition at the end of the chain of names and `{ type, params }` uses. */
  readonly decider: GuardPredicate<TContext, TEvent, never> | AnyGuardDefinition<TContext, TEvent>
  /**
   * The params of the use that names `decider` directly, already resolved for the context and
   * the event; none for a bare name or `undefined` params. The params of earlier hops in the
   * chain are dropped, as upstream.
   */
  readonly params: Option.Option<unknown>
}

/** `src/guards.ts:356` at xstate@5.33.2 (the stray `'.` is upstream's). */
const notImplementedMessage = (guardType: string): string => `Guard '${guardType}' is not implemented.'.`

/**
 * How many guard evaluations the current one runs inside: a built-in guard (`and`, `or`,
 * `not`, `stateNotIn`) evaluates its own guards inside its evaluation, in the same fiber.
 */
const GuardDepth = Context.Reference<number>("@xstate-effect/guards/GuardDepth", { defaultValue: () => 0 })

/**
 * The deepest nesting of guard evaluations. Only a guard that refers back to itself through
 * a built-in guard (`a: not('a')`) gets there. Upstream evaluates guards on the call stack,
 * which overflows for such a cycle (its `evaluateGuard` notes "throw on cycles (depth check
 * should be enough)"); the Effect runtime does not grow the call stack, so the cycle would
 * run forever. A guard that only refers to other names (`a: 'b', b: 'a'`) resolves on the
 * call stack here too and overflows as upstream.
 */
const maxGuardDepth = 10_000

/** The message of the `RangeError` a JavaScript call stack overflow throws (V8), upstream's for a guard cycle. */
const stackOverflowMessage = "Maximum call stack size exceeded"

/** The type a guard names, for its error: a name, the `type` of an object; empty for a function. */
const guardTypeOf = <TContext, TEvent extends EventObject>(guard: Guard<TContext, TEvent>): string =>
  typeof guard === "string" ? guard : typeof guard === "function" ? "" : guard.type

/** Whether a guard object is a port `GuardDefinition`: an object with a `predicate` function (D15). */
const isGuardDefinition = <TContext, TEvent extends EventObject>(
  guard: AnyGuardDefinition<TContext, TEvent> | ParameterizedGuard<TContext, TEvent>
): guard is AnyGuardDefinition<TContext, TEvent> => Predicate.hasProperty(guard, "predicate") && Predicate.isFunction(guard.predicate)

/** A guard name's implementation, looked up as an own property of the implementations. */
const lookupGuard = <TContext, TEvent extends EventObject>(
  implementations: Option.Option<MachineImplementations<TContext, TEvent>>,
  guardType: string
): Option.Option<GuardImplementation<TContext, TEvent>> =>
  Option.flatMap(
    Option.flatMap(implementations, (all) => Option.fromNullishOr(all.guards)),
    (guards) => (Object.hasOwn(guards, guardType) ? Option.fromNullishOr(guards[guardType]) : Option.none())
  )

/**
 * The params of one `{ type, params }` use (upstream): the static value as written, or the
 * params function's result for the context and the event; none for `undefined`.
 */
const resolveParams = <TContext, TEvent extends EventObject>(
  guard: ParameterizedGuard<TContext, TEvent>,
  context: TContext,
  event: TEvent
): Option.Option<unknown> =>
  Option.fromUndefinedOr<unknown>(typeof guard.params === "function" ? guard.params({ context, event }) : guard.params)

/**
 * Resolves a name or a `{ type, params }` use to the function or definition that decides it
 * (upstream): a function or definition implementation takes the params of this use; a name
 * or `{ type, params }` implementation resolves in turn with its own params. The recursion
 * is synchronous, so a reference cycle overflows the stack, as upstream.
 */
const resolveGuard = <TContext, TEvent extends EventObject>(
  guard: string | ParameterizedGuard<TContext, TEvent>,
  args: GuardArgs<TContext, TEvent>,
  implementations: Option.Option<MachineImplementations<TContext, TEvent>>
): Result.Result<ResolvedGuard<TContext, TEvent>, GuardError> => {
  const guardType = typeof guard === "string" ? guard : guard.type
  return Option.match(lookupGuard(implementations, guardType), {
    onNone: () => Result.fail(new GuardError({ message: notImplementedMessage(guardType), guard: guardType })),
    onSome: (implementation) =>
      typeof implementation === "function" || (typeof implementation !== "string" && isGuardDefinition(implementation))
        ? Result.succeed({
            decider: implementation,
            params: typeof guard === "string" ? Option.none() : resolveParams(guard, args.context, args.event),
          })
        : resolveGuard(implementation, args, implementations),
  })
}

/**
 * Calls a guard function with the XState argument object and the params (`undefined` when
 * none), and runs the Effect it returns (port extension). A throw, and a failure or a defect
 * of that Effect (its type admits no failure, but a cast can give one), is a defect that
 * carries the original value (SD-4).
 */
const runPredicate = <TContext, TEvent extends EventObject>(
  predicate: GuardPredicate<TContext, TEvent, never>,
  args: GuardArgs<TContext, TEvent>,
  params: Option.Option<unknown>
): Effect.Effect<boolean> =>
  Effect.suspend(() => {
    // An implementation declares its own params type; the evaluator passes the params of the use
    const result = predicate({ context: args.context, event: args.event }, Option.getOrUndefined(params) as never)
    return Effect.isEffect(result) ? Effect.orDie(result) : Effect.succeed(result)
  })

/** Runs what decides a guard: a function with the XState arguments, a definition with the port context. */
const decide = <TContext, TEvent extends EventObject>(
  decider: GuardPredicate<TContext, TEvent, never> | AnyGuardDefinition<TContext, TEvent>,
  params: Option.Option<unknown>,
  args: GuardArgs<TContext, TEvent>,
  scope: GuardScope<TContext, TEvent>
): Effect.Effect<boolean, GuardError> =>
  typeof decider === "function"
    ? runPredicate(decider, args, params)
    : Effect.suspend(() =>
        // A definition declares its own params type; the evaluator passes the params of the use
        decider.predicate(guardContextOf(args, scope), Option.getOrUndefined(params) as never)
      )

/**
 * The context a port `GuardDefinition` receives: the arguments, the actor, the
 * implementations and the snapshot.
 */
const guardContextOf = <TContext, TEvent extends EventObject>(
  args: GuardArgs<TContext, TEvent>,
  scope: GuardScope<TContext, TEvent>
): GuardContext<TContext, TEvent> => ({
  context: args.context,
  event: args.event,
  self: scope.self,
  system: scope.system,
  implementations: scope.implementations,
  snapshot: scope.snapshot,
})

/**
 * The scope a built-in guard evaluates its own guards in: the actor and the snapshot of its
 * context, and its own `implementations` argument when it has one (port extra), else the
 * context's.
 *
 * @since 0.1.0
 * @category Guards
 */
export const guardScopeOf = <TContext, TEvent extends EventObject>(
  ctx: GuardContext<TContext, TEvent>,
  implementations: Option.Option<MachineImplementations<TContext, TEvent>> = Option.none()
): GuardScope<TContext, TEvent> => ({
  self: ctx.self,
  system: ctx.system,
  implementations: Option.getOrUndefined(Option.orElse(implementations, () => Option.fromNullishOr(ctx.implementations))),
  snapshot: ctx.snapshot,
})

/**
 * Evaluates a guard (upstream `evaluateGuard`), in any form a machine config, an
 * implementation or a built-in guard holds:
 *
 * - an inline function is called as `fn({ context, event }, undefined)`;
 * - a port `GuardDefinition` runs its `predicate` with the guard context and its own `params`
 *   (D15);
 * - a name calls the implementation it names with `undefined` params;
 * - `{ type, params }` calls the implementation named `type` with the params of this use:
 *   the static value, or `params({ context, event })`.
 *
 * An implementation is a function or a definition, called with the params of the use, or
 * another name or `{ type, params }`, which resolves in turn with its own params (so a
 * built-in guard used by name ignores the params of that use). The built-ins carry their
 * own guards. A function may return an `Effect<boolean>` (port extension).
 *
 * The fourth argument is a `GuardScope` (the implementations, the actor and the snapshot),
 * where upstream takes the snapshot and reads `snapshot.machine.implementations`: a port
 * definition receives `self` and `system`, and the scope's `snapshot` is what `stateIn`
 * checks (without one, `stateIn` is false).
 *
 * Fails with `GuardError` and the upstream message `Guard '<type>' is not implemented.'.`
 * when a name has no implementation. A running actor then gets status `error` (S16): with
 * the upstream guard-evaluation wrapper around that message when it selects a transition for
 * an event, with the message itself for an eventless transition.
 *
 * Fails with `GuardError` and the message `Maximum call stack size exceeded` when guards
 * nest deeper than 10,000 evaluations, which only a guard that refers back to itself through
 * a built-in guard does (`a: not('a')`): upstream's evaluation overflows the call stack there,
 * and the transition wraps that `RangeError` the same way. A guard that names itself through
 * other names only (`a: 'b', b: 'a'`) overflows the call stack as upstream.
 *
 * @example
 * ```ts
 * const passes = yield* evaluateGuard(and(["isAdmin", not("isLocked")]), context, event, {
 *   self,
 *   system,
 *   implementations: { guards: { isAdmin: ({ context }) => context.admin, isLocked: () => false } },
 * })
 * ```
 *
 * @since 0.1.0
 * @category Guards
 */
export const evaluateGuard = <TContext, TEvent extends EventObject>(
  guard: Guard<TContext, TEvent>,
  context: TContext,
  event: TEvent,
  scope: GuardScope<TContext, TEvent>
): Effect.Effect<boolean, GuardError> =>
  Effect.gen(function* () {
    const depth = yield* GuardDepth
    if (depth >= maxGuardDepth) {
      return yield* Effect.fail(new GuardError({ message: stackOverflowMessage, guard: guardTypeOf(guard) }))
    }
    return yield* Effect.provideService(evaluateNested(guard, context, event, scope), GuardDepth, depth + 1)
  })

/** One guard evaluation, inside which a built-in guard evaluates its own guards one level deeper. */
const evaluateNested = <TContext, TEvent extends EventObject>(
  guard: Guard<TContext, TEvent>,
  context: TContext,
  event: TEvent,
  scope: GuardScope<TContext, TEvent>
): Effect.Effect<boolean, GuardError> =>
  Effect.suspend(() => {
    const args: GuardArgs<TContext, TEvent> = { context, event }
    if (typeof guard === "function") {
      return runPredicate(guard, args, Option.none())
    }
    if (typeof guard !== "string" && isGuardDefinition(guard)) {
      const params = Predicate.hasProperty(guard, "params") ? Option.fromUndefinedOr<unknown>(guard.params) : Option.none()
      return decide(guard, params, args, scope)
    }
    return Result.match(resolveGuard(guard, args, Option.fromNullishOr(scope.implementations)), {
      onFailure: (error) => Effect.fail(error),
      onSuccess: ({ decider, params }) => decide(decider, params, args, scope),
    })
  })
