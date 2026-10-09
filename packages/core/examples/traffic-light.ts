/**
 * Traffic Light Example
 *
 * A simple traffic light state machine that cycles through colors.
 *
 * Demonstrates:
 * - Simple state transitions
 * - Context with cycle counter
 * - Assign action on transition
 *
 * Ported from xstate/examples/express-workflow
 */
import { createMachine, assign } from "../src/index.js"

/**
 * Context for the traffic light.
 */
export interface TrafficLightContext {
  /** The completed green, yellow, red cycles: the TIMER from red to green adds 1. */
  cycles: number
}

/**
 * Events for the traffic light.
 */
export type TrafficLightEvent = { type: "TIMER" }

/**
 * Traffic Light machine.
 *
 * A simple traffic light that:
 * - Cycles through green -> yellow -> red
 * - Counts completed cycles
 */
export const trafficLightMachine = createMachine({
  types: {} as { context: TrafficLightContext; events: TrafficLightEvent },
  id: "trafficLight",
  initial: "green",
  context: {
    cycles: 0,
  },
  states: {
    green: {
      on: {
        TIMER: "yellow",
      },
    },
    yellow: {
      on: {
        TIMER: "red",
      },
    },
    red: {
      on: {
        TIMER: {
          target: "green",
          actions: assign(({ context }) => ({
            cycles: context.cycles + 1,
          })),
        },
      },
    },
  },
})
