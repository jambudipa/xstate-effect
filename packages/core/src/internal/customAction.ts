/**
 * @since 0.1.0
 * @module internal/customAction
 *
 * The warning for a built-in action creator called while a custom action runs (upstream
 * `executingCustomAction`, `src/createActor.ts` at xstate@5.33.2). `assign`, `raise`,
 * `sendTo` and `emit` only build an action, so calling one inside a custom action does
 * nothing; upstream warns `Custom actions should not call \`<name>()\` directly, ...` at the
 * call (`sendParent` and `forwardTo` warn as `sendTo`, which upstream builds them with).
 *
 * A custom action is an inline function action or a named implementation that is a function
 * (`custom` in `ActorLogic.ts`). The engine calls it through {@link runCustomAction}, which
 * gives the fiber a list of warnings for the length of the call; a creator called in that
 * call adds its warning to the list ({@link warnIfInCustomAction}), and the list is logged
 * through the Effect logger (SD-21) once the call has returned or thrown. The list belongs to
 * the fiber, so the actions of other actors never see it. The Effect a custom action returns
 * (port extension) runs after the call, outside the list, as upstream has no such Effect.
 */
import { Context, Effect, Fiber, MutableRef, Option } from "effect"

/**
 * The name a built-in action creator warns with: upstream's `assign`, `raise`, `sendTo` and
 * `emit` (`sendParent` and `forwardTo` warn as `sendTo`).
 *
 * @since 0.1.0
 * @category Internal
 */
export type BuiltInCreator = "assign" | "emit" | "raise" | "sendTo"

/**
 * The warnings of the custom action that runs in the current fiber; none outside one.
 */
const CustomActionWarnings = Context.Reference<Option.Option<MutableRef.MutableRef<ReadonlyArray<string>>>>(
  "@xstate-effect/internal/customAction/CustomActionWarnings",
  { defaultValue: () => Option.none() }
)

/**
 * Upstream's warning for a built-in action creator called inside a custom action.
 *
 * @since 0.1.0
 * @category Internal
 */
export const customActionWarning = (creator: BuiltInCreator): string =>
  `Custom actions should not call \`${creator}()\` directly, as it is not imperative. See https://stately.ai/docs/actions#built-in-actions for more details.`

/**
 * Adds the warning of `creator` to the warnings of the custom action that runs in the
 * current fiber; does nothing outside a custom action. A built-in action creator calls it
 * first, as upstream's creators check `executingCustomAction` first.
 *
 * @since 0.1.0
 * @category Internal
 */
export const warnIfInCustomAction = (creator: BuiltInCreator): void => {
  const warnings = Option.flatMap(Option.fromUndefinedOr(Fiber.getCurrent()), (fiber) =>
    fiber.getRef(CustomActionWarnings)
  )
  if (Option.isSome(warnings)) {
    MutableRef.update(warnings.value, (list) => [...list, customActionWarning(creator)])
  }
}

/**
 * Calls a custom action's function with a fresh list of warnings in the fiber, then logs each
 * warning the call added, in call order, at the warning level, also when the call throws
 * (upstream warns at the call, before the throw). A throw is a defect that carries the
 * thrown value (SD-4).
 *
 * @since 0.1.0
 * @category Internal
 */
export const runCustomAction = <A>(call: () => A): Effect.Effect<A> =>
  Effect.suspend(() => {
    const warnings = MutableRef.make<ReadonlyArray<string>>([])
    return Effect.sync(call).pipe(
      Effect.provideService(CustomActionWarnings, Option.some(warnings)),
      Effect.ensuring(
        Effect.suspend(() =>
          Effect.forEach(MutableRef.get(warnings), (warning) => Effect.logWarning(warning), { discard: true })
        )
      )
    )
  })
