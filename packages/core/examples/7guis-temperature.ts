/**
 * 7GUIs Temperature Converter Example
 *
 * A bidirectional temperature converter between Celsius and Fahrenheit.
 *
 * Demonstrates:
 * - Multiple event types updating different context fields
 * - Computed values in assign
 * - Stateless machine (no explicit states)
 *
 * Ported from xstate/examples/7guis-temperature-react
 * Based on: https://eugenkiss.github.io/7guis/tasks#temp
 */
import { createMachine, assign } from "../src/index.js"

/**
 * Context type for the temperature converter.
 */
export interface TemperatureContext {
  tempC?: number | string
  tempF?: number | string
}

/**
 * Events for the temperature converter.
 */
export type TemperatureEvent =
  | { type: "CELSIUS"; value: string }
  | { type: "FAHRENHEIT"; value: string }

/**
 * 7GUIs Temperature Converter machine.
 *
 * Converts between Celsius and Fahrenheit bidirectionally.
 * When one field changes, the other is automatically computed.
 */
export const temperatureMachine = createMachine({
  types: {} as { context: TemperatureContext; events: TemperatureEvent },
  id: "temperature",
  context: { tempC: undefined, tempF: undefined },
  on: {
    CELSIUS: {
      actions: assign(({ event }) => ({
        tempC: event.value,
        tempF: event.value.length ? +event.value * (9 / 5) + 32 : "",
      })),
    },
    FAHRENHEIT: {
      actions: assign(({ event }) => ({
        tempC: event.value.length ? (+event.value - 32) * (5 / 9) : "",
        tempF: event.value,
      })),
    },
  },
})
