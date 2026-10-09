/**
 * Workflow Event-Based Greeting Example
 *
 * A workflow that waits for an event before processing.
 *
 * Demonstrates:
 * - Event-driven state transitions
 * - Waiting for external events
 * - Event payload access in invoke input
 *
 * Ported from xstate/examples/workflow-event-greeting
 * Based on: https://github.com/serverlessworkflow/specification/tree/main/examples#event-based-greeting-example
 */
import { Option } from "effect"
import { setup, assign, fromPromise } from "../src/index.js"

/**
 * Context type for the event greeting workflow.
 */
export interface EventGreetingContext {
  /** The greeting from the greeting function; undefined until it finishes. The final output repeats it. */
  greeting: string | undefined
}

/**
 * Events for the event greeting workflow.
 */
export type EventGreetingEvent =
  | { type: "greet"; greet: { name: string } }
  | { type: "xstate.done.actor.greetingFunction"; output: { greeting: string } }

/**
 * Greeting function actor.
 */
export const greetingFunctionActor = fromPromise<{ greeting: string }, { name: string }>(
  async ({ input }) => {
    await new Promise((resolve) => setTimeout(resolve, 100))
    return {
      greeting: `Hello, ${input.name}!`,
    }
  }
)

/**
 * Event-based greeting workflow machine.
 *
 * This workflow:
 * 1. Waits for a "greet" event
 * 2. Invokes the greeting function with the name from the event
 * 3. Outputs the greeting
 */
export const eventGreetingMachine = setup({
  types: {
    context: {} as EventGreetingContext,
    events: {} as EventGreetingEvent,
  },
  actors: {
    greetingFunction: greetingFunctionActor,
  },
}).createMachine({
  id: "event-greeting",
  initial: "Waiting",
  context: {
    greeting: undefined,
  },
  states: {
    Waiting: {
      on: {
        greet: "Greet",
      },
    },
    Greet: {
      invoke: {
        src: "greetingFunction",
        input: ({ event }) => ({
          name: (event as { type: "greet"; greet: { name: string } }).greet?.name ?? "World",
        }),
        onDone: {
          target: "Greeted",
          actions: assign(({ event }) => ({
            greeting: Option.getOrUndefined(event.output)?.greeting,
          })),
        },
      },
    },
    Greeted: {
      type: "final",
      output: ({ context }) => ({
        greeting: context.greeting,
      }),
    },
  },
})
