/**
 * Workflow Filling Water Example
 *
 * A workflow that simulates filling a glass with water.
 *
 * Demonstrates:
 * - Always transitions with guards
 * - Loop-back transitions
 * - Counter pattern with after/delay
 * - Input-based context initialization
 *
 * Ported from xstate/examples/workflow-filling-water
 * Based on: https://github.com/serverlessworkflow/specification/blob/main/examples/README.md#filling-a-glass-of-water
 */
import { createMachine, assign } from "../src/index.js"

/**
 * Input type for the filling water workflow.
 */
export interface FillingWaterInput {
  current: number
  max: number
}

/**
 * Context type for the filling water workflow.
 */
export interface FillingWaterContext {
  counts: {
    current: number
    max: number
  }
}

/**
 * Events for the filling water workflow.
 */
export type FillingWaterEvent =
  | { type: "WaterAddedEvent" }
  | { type: "ADD_WATER" }

/**
 * Filling water workflow machine.
 *
 * This workflow:
 * 1. Checks if glass is full
 * 2. If not full, adds water (after delay)
 * 3. Loops back to check
 * 4. When full, completes
 */
export const fillingWaterMachine = createMachine({
  types: {} as { context: FillingWaterContext; events: FillingWaterEvent },
  id: "fillglassofwater",
  initial: "CheckIfFull",
  context: ({ input }) => ({
    counts: (input as FillingWaterInput) ?? { current: 0, max: 10 },
  }),
  states: {
    CheckIfFull: {
      always: [
        {
          target: "AddWater",
          guard: ({ context }) => context.counts.current < context.counts.max,
        },
        {
          target: "GlassFull",
        },
      ],
    },
    AddWater: {
      // In full implementation: after: { 500: { actions: ..., target: "CheckIfFull" } }
      // For testing, we use event-driven approach
      on: {
        ADD_WATER: {
          target: "CheckIfFull",
          actions: assign(({ context }) => ({
            counts: {
              ...context.counts,
              current: context.counts.current + 1,
            },
          })),
        },
      },
    },
    GlassFull: {
      type: "final",
    },
  },
})

/**
 * Filling water machine with auto-fill (for testing).
 *
 * Uses always transitions to automatically fill without events.
 */
export const autoFillingWaterMachine = createMachine({
  types: {} as { context: FillingWaterContext; events: FillingWaterEvent },
  id: "autoFillGlassOfWater",
  initial: "Filling",
  context: {
    counts: { current: 0, max: 5 },
  },
  states: {
    Filling: {
      always: [
        {
          guard: ({ context }) => context.counts.current >= context.counts.max,
          target: "GlassFull",
        },
        {
          // This would cause infinite loop without delay in real XState
          // Here we show the pattern
          actions: assign(({ context }) => ({
            counts: {
              ...context.counts,
              current: context.counts.current + 1,
            },
          })),
        },
      ],
    },
    GlassFull: {
      type: "final",
    },
  },
})
