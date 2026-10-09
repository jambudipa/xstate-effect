/**
 * Workflow Accumulate Room Readings Example
 *
 * A workflow that accumulates temperature and humidity readings, then generates reports.
 *
 * Demonstrates:
 * - Event accumulation in context
 * - Entry actions for state reset
 * - Guarded after/delay transitions
 * - Cyclic workflow pattern
 *
 * Ported from xstate/examples/workflow-accumulate-room-readings
 * Based on: https://github.com/serverlessworkflow/specification/blob/main/examples/README.md#accumulate-room-readings
 */
import { setup, assign, fromPromise } from "../src/index.js"

/**
 * Context type for the room readings workflow.
 */
export interface RoomReadingsContext {
  /**
   * The last temperature reading of this cycle, or null before one arrives. Entering
   * ConsumeReading clears it; GENERATE_REPORT needs it and `humidity` both set.
   */
  temperature: number | null
  /** The last humidity reading of this cycle, or null before one arrives; cleared like `temperature`. */
  humidity: number | null
}

/**
 * Events for the room readings workflow.
 */
export type RoomReadingsEvent =
  | { type: "TemperatureEvent"; roomId: string; temperature: number }
  | { type: "HumidityEvent"; roomId: string; humidity: number }
  | { type: "GENERATE_REPORT" }

/**
 * Produce report actor.
 */
export const produceReportActor = fromPromise<void, { temperature: number | null; humidity: number | null }>(
  async ({ input }) => {
    await new Promise((resolve) => setTimeout(resolve, 100))
    console.log("Report generated:", input)
  }
)

/**
 * Room readings workflow machine.
 *
 * This workflow:
 * 1. Resets readings on entering consume state
 * 2. Accumulates temperature and humidity events
 * 3. After delay (if both readings present), generates report
 * 4. Loops back to consume more readings
 */
export const roomReadingsMachine = setup({
  types: {
    context: {} as RoomReadingsContext,
    events: {} as RoomReadingsEvent,
  },
  actors: {
    produceReport: produceReportActor,
  },
}).createMachine({
  id: "roomreadings",
  initial: "ConsumeReading",
  context: {
    temperature: null,
    humidity: null,
  },
  states: {
    ConsumeReading: {
      entry: assign({
        temperature: null,
        humidity: null,
      }),
      on: {
        TemperatureEvent: {
          actions: assign(({ event }) => ({
            temperature: (event as { type: "TemperatureEvent"; temperature: number }).temperature,
          })),
        },
        HumidityEvent: {
          actions: assign(({ event }) => ({
            humidity: (event as { type: "HumidityEvent"; humidity: number }).humidity,
          })),
        },
        // Manual trigger for testing (since after/delays need scheduler support)
        GENERATE_REPORT: {
          guard: ({ context }) => context.temperature !== null && context.humidity !== null,
          target: "GenerateReport",
        },
      },
      // In full implementation:
      // after: {
      //   PT1H: {
      //     guard: ({ context }) => context.temperature !== null && context.humidity !== null,
      //     target: "GenerateReport"
      //   }
      // }
    },
    GenerateReport: {
      invoke: {
        src: "produceReport",
        input: ({ context }) => ({
          temperature: context.temperature,
          humidity: context.humidity,
        }),
        onDone: "ConsumeReading",
      },
    },
  },
})
