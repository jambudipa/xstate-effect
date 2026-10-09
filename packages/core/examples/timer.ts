/**
 * Timer Example
 *
 * A countdown timer state machine.
 *
 * Demonstrates:
 * - Callback actor for ticks
 * - Guards on transitions
 * - Always transitions for auto-stop
 * - Root-level event handlers
 *
 * Ported from xstate/examples/timer
 */
import { setup, assign, fromCallback } from "../src/index.js"
import type { EventObject } from "../src/index.js"

/**
 * Context type for the timer.
 */
export interface TimerContext {
  /**
   * The seconds left. "minute" and "second" add 60 and 1 while stopped; each TICK while running
   * takes 1 away, and the machine stops at 0. start needs it above 0.
   */
  seconds: number
}

/**
 * Events for the timer.
 */
export type TimerEvent =
  | { type: "start" }
  | { type: "stop" }
  | { type: "reset" }
  | { type: "minute" }
  | { type: "second" }
  | { type: "TICK" }

/**
 * Ticks actor - emits TICK events every second.
 */
export const ticksActor = fromCallback<EventObject, void, EventObject>(({ sendBack }) => {
  const interval = setInterval(() => {
    sendBack({ type: "TICK" })
  }, 1000)
  return () => clearInterval(interval)
})

/**
 * Timer machine.
 *
 * A countdown timer that:
 * - Can add minutes or seconds
 * - Starts counting down when started
 * - Stops when reaching 0 or manually stopped
 * - Can be reset
 */
export const timerMachine = setup({
  types: {
    context: {} as TimerContext,
    events: {} as TimerEvent,
  },
  actors: {
    ticks: ticksActor,
  },
}).createMachine({
  id: "timer",
  initial: "stopped",
  context: {
    seconds: 0,
  },
  states: {
    stopped: {
      on: {
        start: {
          guard: ({ context }) => context.seconds > 0,
          target: "running",
        },
        minute: {
          actions: assign(({ context }) => ({
            seconds: context.seconds + 60,
          })),
        },
        second: {
          actions: assign(({ context }) => ({
            seconds: context.seconds + 1,
          })),
        },
      },
    },
    running: {
      invoke: {
        src: "ticks",
      },
      on: {
        stop: "stopped",
        TICK: {
          actions: assign(({ context }) => ({
            seconds: context.seconds - 1,
          })),
        },
      },
      always: {
        guard: ({ context }) => context.seconds === 0,
        target: "stopped",
      },
    },
  },
  on: {
    reset: {
      guard: ({ context }) => context.seconds > 0,
      actions: assign({ seconds: 0 }),
    },
  },
})
