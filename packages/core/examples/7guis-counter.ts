/**
 * 7GUIs Counter Example
 *
 * The simplest 7GUIs example - a counter with an increment button.
 *
 * Demonstrates:
 * - Single state with context
 * - Root-level event handler
 * - Context mutation with assign
 *
 * Ported from xstate/examples/7guis-counter-react
 * Based on: https://eugenkiss.github.io/7guis/tasks#counter
 */
import { createMachine, assign } from "../src/index.js"

/**
 * Context type for the counter.
 */
export interface CounterContext {
  /** The number of INCREMENT events so far; starts at 0 and never goes down. */
  count: number
}

/**
 * Events for the counter.
 */
export type CounterEvent = { type: "INCREMENT" }

/**
 * 7GUIs Counter machine.
 *
 * A simple counter that increments on button click.
 */
export const counterMachine = createMachine({
  types: {} as { context: CounterContext; events: CounterEvent },
  id: "counter",
  context: { count: 0 },
  on: {
    INCREMENT: {
      actions: assign(({ context }) => ({ count: context.count + 1 })),
    },
  },
})
