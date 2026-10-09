/**
 * @since 0.1.0
 * @module internal/eventString
 *
 * The text of an event in an upstream message (`JSON.stringify(event)` upstream).
 */
import { Option, Schema } from "effect"
import type { EventObject } from "../Event.js"

/**
 * The JSON encoder, built once; the Effect lint rules replace `JSON.stringify` with Schema. It
 * gives `None` where `JSON.stringify` throws, for example on a cycle or a `bigint`.
 */
const encodeJsonString = Schema.encodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

/**
 * The event as upstream prints it in a message or warning: its JSON text, or `String(event)`
 * when it has none (where upstream's `JSON.stringify` would throw).
 *
 * @since 0.1.0
 * @category Formatting
 */
export const eventString = (event: EventObject): string =>
  Option.getOrElse(encodeJsonString(event), () => String(event))
