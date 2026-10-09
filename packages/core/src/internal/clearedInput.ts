/**
 * @since 0.1.0
 * @module internal/clearedInput
 *
 * The input of a promise, observable or effect actor once it is done, errored or stopped.
 * Upstream promise and observable logic set `input` to `undefined` then
 * (`src/actors/promise.ts`, `src/actors/observable.ts` at xstate@5.33.2), and the persisted
 * form keeps the key with `undefined`. The port's effect logic follows promise logic.
 */
import { Option } from "effect"

/**
 * The `undefined` that a done, errored or stopped snapshot holds as its input (upstream
 * `input: undefined`): `None` at the boundary of a field that upstream types as
 * `TInput | undefined`.
 *
 * @since 0.1.0
 * @category Constants
 */
export const clearedInput: undefined = Option.getOrUndefined(Option.none())
