/**
 * @since 0.1.0
 * @module internal/globalObject
 *
 * The lookup behind `getGlobal` of the dev entry point (upstream `getGlobal`,
 * `src/dev/index.ts` at xstate@5.33.2): the first global object candidate that exists, in
 * upstream's order `globalThis`, `self`, `window`, `global`, or upstream's warning when none
 * does. `getGlobal` reads the four candidates of the environment and hands them over, so a
 * test can reach the warning, which no runtime that the package supports can (Node 18 and
 * later always have `globalThis`). It is not an entry point export.
 */
import { Effect, Option } from "effect"

/** Upstream's warning when no global object exists (`src/dev/index.ts:35`). */
const noGlobalObject =
  "XState could not find a global object in this environment. Please let the maintainers know and raise an issue here: https://github.com/statelyai/xstate/issues"

/**
 * The first candidate that exists. With none, it logs upstream's warning (upstream
 * `console.warn`, in development builds) through the Effect logger and gives `Option.none()`.
 *
 * @since 0.1.0
 * @category Internal
 */
export const firstGlobalObject = (
  candidates: ReadonlyArray<Option.Option<typeof globalThis>>
): Effect.Effect<Option.Option<typeof globalThis>> => {
  const found = Option.firstSomeOf(candidates)
  return Option.isSome(found) ? Effect.succeed(found) : Effect.as(Effect.logWarning(noGlobalObject), found)
}
