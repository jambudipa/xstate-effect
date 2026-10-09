/**
 * @since 0.1.0
 * @module graph/utils
 *
 * Helpers of the graph entry point (upstream `src/graph/utils.ts` at xstate@5.33.2): the JSON
 * text of a value, the event descriptors of a machine snapshot, the path trace of a failed
 * path test, and the description of a machine snapshot.
 */
import { Array as Arr, Option, Predicate, Schema } from "effect"
import type { EventObject } from "../Event.js"
import type { AnyMachineSnapshot, Snapshot } from "../Snapshot.js"
import type { SerializationConfig, StatePath, TestPathResult } from "./types.js"

/**
 * The JSON text of a value through the Schema JSON codec: none for a value that JSON cannot
 * encode (`undefined`, a function, a `bigint`, a cyclic object), where upstream's
 * `JSON.stringify` returns `undefined` or throws.
 */
const encodeJson = Schema.encodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

/**
 * The JSON text of a value (upstream `JSON.stringify(value)`); `String(value)` for a value
 * that has no JSON text.
 *
 * @since 0.1.0
 * @category Formatting
 */
export const simpleStringify = (value: unknown): string => Option.getOrElse(encodeJson(value), () => String(value))

/**
 * The event descriptors the active state nodes of a snapshot take, each once, in the order of
 * their first occurrence (upstream `getAllOwnEventDescriptors` of `src/utils.ts`, a native
 * `Set` in insertion order; the root entry point exports this function as
 * `__unsafe_getAllOwnEventDescriptors`, as upstream's root does).
 *
 * @since 0.1.0
 * @category Internal
 */
export const getAllOwnEventDescriptors = (snapshot: AnyMachineSnapshot): Array<string> =>
  Arr.dedupe(snapshot._nodes.flatMap((node) => node.ownEvents))

/** How a path trace writes its states, its events and their pass or fail marks. */
interface TestResultStringOptions<TSnapshot extends Snapshot, TEvent extends EventObject>
  extends SerializationConfig<TSnapshot, TEvent>
{
  /**
   * Marks a text with a color name (`green`, `greenBright`, `red`, `redBright` or `gray`).
   * The default returns the text unchanged, and a test model never gives another, so its
   * traces carry no color.
   */
  formatColor: (color: string, string: string) => string
}

/**
 * The trace of a path test (upstream `formatPathTestResult`): each step's state and event,
 * then the target state; the step that failed is marked through `formatColor`.
 *
 * @since 0.1.0
 * @category Formatting
 */
export const formatPathTestResult = <TSnapshot extends Snapshot, TEvent extends EventObject>(
  path: StatePath<TSnapshot, TEvent>,
  testPathResult: TestPathResult<TSnapshot, TEvent>,
  options?: Partial<TestResultStringOptions<TSnapshot, TEvent>>
): string => {
  const resolvedOptions: TestResultStringOptions<TSnapshot, TEvent> = {
    formatColor: (_color, string) => string,
    serializeState: simpleStringify,
    serializeEvent: simpleStringify,
    ...options,
  }

  const { formatColor, serializeState, serializeEvent } = resolvedOptions

  const { state } = path

  const targetStateString = serializeState(state, path.steps.at(-1)?.event)

  let hasFailed = false
  const stepLines = testPathResult.steps.map((s, i, steps) => {
    // The event of the previous step; none for the first step (`steps[-1]` is no step)
    const stateString = serializeState(s.step.state, steps[i - 1]?.step.event)
    const eventString = serializeEvent(s.step.event)

    let stateColor: string
    if (hasFailed) {
      stateColor = formatColor("gray", stateString)
    } else if (Option.isSome(s.state.error)) {
      hasFailed = true
      stateColor = formatColor("redBright", stateString)
    } else {
      stateColor = formatColor("greenBright", stateString)
    }
    const stateResult = `\tState: ${stateColor}`

    let eventColor: string
    if (hasFailed) {
      eventColor = formatColor("gray", eventString)
    } else if (Option.isSome(s.event.error)) {
      hasFailed = true
      eventColor = formatColor("red", eventString)
    } else {
      eventColor = formatColor("green", eventString)
    }
    const eventResult = `\tEvent: ${eventColor}`

    return [stateResult, eventResult].join("\n")
  })

  const targetColor = hasFailed
    ? formatColor("gray", targetStateString)
    : Option.isSome(testPathResult.state.error)
      ? formatColor("red", targetStateString)
      : formatColor("green", targetStateString)

  return "\nPath:\n" + [...stepLines, `\tState: ${targetColor}`].join("\n\n")
}

/** Whether a test meta `description` is the function form. */
const isDescriber = (value: unknown): value is (snapshot: AnyMachineSnapshot) => string => typeof value === "function"

/**
 * The description of a machine snapshot (upstream `getDescription`): each active atomic or
 * final state node by the `description` of its test meta, else by its path, then the context
 * as JSON when it has keys.
 *
 * @example
 * ```ts
 * getDescription(snapshot) // state "done"({"allowed":true})
 * ```
 *
 * @since 0.1.0
 * @category Formatting
 */
export const getDescription = (snapshot: AnyMachineSnapshot): string => {
  const context: unknown = snapshot.context
  const contextString =
    Predicate.isObject(context) && Object.keys(context).length > 0 ? `(${simpleStringify(context)})` : ""

  const metas = snapshot.getMeta()
  const stateStrings = snapshot._nodes
    .filter((node) => node.type === "atomic" || node.type === "final")
    .map(({ id, path }) => {
      const meta: unknown = metas[id]
      if (!meta) {
        return `"${path.join(".")}"`
      }

      const description: unknown = Predicate.hasProperty(meta, "description") ? meta.description : ""

      if (isDescriber(description)) {
        return description(snapshot)
      }

      return description ? `"${String(description)}"` : simpleStringify(snapshot.value)
    })

  return `state${stateStrings.length === 1 ? "" : "s"} ` + stateStrings.join(", ") + ` ${contextString}`.trim()
}
