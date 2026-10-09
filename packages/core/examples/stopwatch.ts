/**
 * Stopwatch Example
 *
 * A stopwatch state machine that demonstrates:
 * - Multiple states (stopped, running, paused)
 * - Context mutations with assign action
 * - State transitions based on events
 * - Tick actor using fromCallback (for use with invoke)
 *
 * Ported from xstate/examples/stopwatch
 */
import { createMachine, setup, assign, fromCallback } from "../src/index.js"
import type { EventObject } from "../src/index.js"

/**
 * Context type for the stopwatch machine.
 */
export interface StopwatchContext {
  /**
   * The number of TICK events while running, not a time. The ticks actor sends one TICK every
   * `intervalMs` (10 ms by default), but no machine here invokes it: the caller sends TICK.
   * Stop and pause keep the value; only reset sets it back to 0.
   */
  elapsed: number
}

/**
 * Events that the stopwatch machine can receive.
 */
export type StopwatchEvent =
  | { type: "start" }
  | { type: "stop" }
  | { type: "reset" }
  | { type: "TICK" }
  | { type: "pause" }
  | { type: "resume" }

/**
 * Tick actor logic that emits TICK events at regular intervals.
 *
 * This is a callback actor that starts an interval and sends TICK
 * events back to its parent. It cleans up the interval when stopped.
 *
 * @param intervalMs - The interval between ticks in milliseconds
 */
export const createTicksActor = (intervalMs: number = 10) =>
  fromCallback<EventObject, void, EventObject>(({ sendBack }) => {
    const interval = setInterval(() => {
      sendBack({ type: "TICK" })
    }, intervalMs)

    return () => clearInterval(interval)
  })

/**
 * Ticks actor with default 10ms interval.
 */
export const ticksActor = createTicksActor(10)

/**
 * Stopwatch state machine using setup API.
 *
 * This machine manages a stopwatch with the following states:
 * - stopped: Initial state, elapsed time is 0 or preserved from pause
 * - running: Timer is active, elapsed time increments on each TICK
 * - paused: Timer is paused, elapsed time is preserved
 *
 * Note: The invoke functionality would automatically start/stop the ticks actor.
 * For testing without invoke, you can send TICK events manually.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { getInitialSnapshot, getNextSnapshot } from "@jambudipa/xstate-effect"
 * import { stopwatchMachine } from "./stopwatch.js"
 *
 * const program = Effect.gen(function* () {
 *   // Get initial snapshot
 *   const initial = yield* getInitialSnapshot(stopwatchMachine, undefined)
 *   console.log(initial.value) // "stopped"
 *   console.log(initial.context.elapsed) // 0
 *
 *   // Start the stopwatch
 *   const running = yield* getNextSnapshot(stopwatchMachine, initial, { type: "start" })
 *   console.log(running.value) // "running"
 *
 *   // Simulate tick
 *   const afterTick = yield* getNextSnapshot(stopwatchMachine, running, { type: "TICK" })
 *   console.log(afterTick.context.elapsed) // 1
 *
 *   // Stop
 *   const stopped = yield* getNextSnapshot(stopwatchMachine, afterTick, { type: "stop" })
 *   console.log(stopped.value) // "stopped"
 * })
 * ```
 */
export const stopwatchMachine = setup({
  types: {
    context: {} as StopwatchContext,
    events: {} as StopwatchEvent,
  },
  actors: {
    ticks: ticksActor,
  },
}).createMachine({
  id: "stopwatch",
  initial: "stopped",
  context: {
    elapsed: 0,
  },
  states: {
    stopped: {
      on: {
        start: "running",
      },
    },
    running: {
      // Note: invoke is defined but may not be fully functional yet
      // invoke: {
      //   src: "ticks",
      // },
      on: {
        TICK: {
          actions: assign(({ context }) => ({
            elapsed: context.elapsed + 1,
          })),
        },
        stop: "stopped",
        pause: "paused",
      },
    },
    paused: {
      on: {
        resume: "running",
        stop: "stopped",
        reset: {
          target: "stopped",
          actions: assign({ elapsed: 0 }),
        },
      },
    },
  },
  on: {
    // A root transition targets a child with a leading dot (XState resolveTarget)
    reset: {
      target: ".stopped",
      actions: assign({ elapsed: 0 }),
    },
  },
})

/**
 * Simple stopwatch without setup API.
 *
 * This is a simpler version using createMachine directly.
 */
export const simpleStopwatchMachine = createMachine({
  types: {} as { context: StopwatchContext; events: StopwatchEvent },
  id: "simpleStopwatch",
  initial: "stopped",
  context: {
    elapsed: 0,
  },
  states: {
    stopped: {
      on: {
        start: "running",
        reset: {
          actions: assign({ elapsed: 0 }),
        },
      },
    },
    running: {
      on: {
        TICK: {
          actions: assign(({ context }) => ({
            elapsed: context.elapsed + 1,
          })),
        },
        stop: "stopped",
        pause: "paused",
        reset: {
          target: "stopped",
          actions: assign({ elapsed: 0 }),
        },
      },
    },
    paused: {
      on: {
        resume: "running",
        stop: "stopped",
        reset: {
          target: "stopped",
          actions: assign({ elapsed: 0 }),
        },
      },
    },
  },
})
