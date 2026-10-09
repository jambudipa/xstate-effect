/**
 * @since 0.1.0
 * @module assert
 *
 * XState `assertEvent` (upstream `src/assert.ts` at xstate@5.33.2).
 */
import { Effect } from "effect"
import { EventAssertionError } from "./Errors.js"
import { type EventDescriptor, type EventObject, type ExtractEvent, matchesEventDescriptor } from "./Event.js"
import { eventString } from "./internal/eventString.js"

/** The upstream message for an event that matches none of `types`. */
const expectedEventType = (event: EventObject, types: ReadonlyArray<string>): string => {
  const typesText = types.length === 1
    ? `type matching "${types[0]}"`
    : `one of types matching "${types.join("\", \"")}"`
  return `Expected event ${eventString(event)} to have ${typesText}`
}

/** True when one of `types` matches the event, which is then one of the events they match. */
const matchesOneOf = <TEvent extends EventObject, TAssertedDescriptor extends EventDescriptor<TEvent>>(
  event: TEvent,
  types: ReadonlyArray<string>
): event is ExtractEvent<TEvent, TAssertedDescriptor> =>
  types.some((descriptor) => matchesEventDescriptor(event.type, descriptor))

/**
 * Asserts that the event is of the given type, or of one of the given types: an event type, a
 * partial descriptor such as `"feedback.*"`, or `"*"`. When one of them matches the event (see
 * {@link matchesEventDescriptor}), the Effect succeeds with the same event, narrowed to the
 * events they match ({@link ExtractEvent}). Otherwise it fails with an `EventAssertionError`
 * whose message is upstream's, `Expected event <the event as JSON> to have type matching
 * "<type>"` (SD-3, amended 2026-10-08: upstream throws it at once). An action that returns
 * the Effect fails with that error, which is the actor's error (status `error`, SD-4).
 *
 * @example
 *
 * ```ts
 * import { Effect } from "effect"
 * import { assertEvent } from "@jambudipa/xstate-effect"
 *
 * type Events =
 *   | { readonly type: "greet"; readonly message: string }
 *   | { readonly type: "notify"; readonly message: string; readonly level: "info" | "error" }
 *   | { readonly type: "count"; readonly value: number }
 *
 * const messageOf = (event: Events): Effect.Effect<string, unknown> =>
 *   // the greet or the notify event, else an EventAssertionError
 *   Effect.map(assertEvent(event, ["greet", "notify"]), (greeting) => greeting.message)
 * ```
 *
 * @since 0.1.0
 * @category Assertions
 */
export const assertEvent = <TEvent extends EventObject, TAssertedDescriptor extends EventDescriptor<TEvent>>(
  event: TEvent,
  type: TAssertedDescriptor | ReadonlyArray<TAssertedDescriptor>
): Effect.Effect<ExtractEvent<TEvent, TAssertedDescriptor>, EventAssertionError> => {
  const types: ReadonlyArray<string> = typeof type === "string" ? [type] : type
  return matchesOneOf<TEvent, TAssertedDescriptor>(event, types)
    ? Effect.succeed(event)
    : Effect.fail(new EventAssertionError({ message: expectedEventType(event, types) }))
}
