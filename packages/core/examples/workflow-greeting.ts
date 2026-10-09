/**
 * Workflow Greeting Example
 *
 * A workflow that invokes an async greeting function and outputs the result.
 *
 * Demonstrates:
 * - Setup API with typed context and input
 * - Invoke with fromPromise actor
 * - onDone transitions
 * - Context assignment from invoke output
 * - Final state with dynamic output
 *
 * Ported from xstate/examples/workflow-greeting
 * Based on: https://github.com/serverlessworkflow/specification/tree/main/examples#greeting-example
 */
import { Option } from "effect"
import { setup, assign, fromPromise } from "../src/index.js"

/**
 * Input type for the greeting workflow.
 */
export interface GreetingInput {
  /** The person to greet. Without an input the machine greets "World". */
  person: {
    name: string
  }
}

/**
 * Context type for the greeting workflow.
 */
export interface GreetingContext {
  /** The greeting from the greeting function; undefined until it finishes. The final output repeats it. */
  greeting: string | undefined
}

/**
 * Events for the greeting workflow.
 */
export type GreetingEvent =
  | { type: "xstate.init"; input: GreetingInput }
  | { type: "xstate.done.actor.greetingFunction"; output: { greeting: string } }

/**
 * Greeting function actor.
 *
 * Simulates an async greeting service.
 */
export const greetingFunctionActor = fromPromise<{ greeting: string }, { name: string }>(
  async ({ input }) => {
    // Simulate async operation
    await new Promise((resolve) => setTimeout(resolve, 100))
    return {
      greeting: `Hello, ${input.name}!`,
    }
  }
)

/**
 * Greeting workflow machine.
 *
 * This workflow:
 * 1. Receives a person's name as input
 * 2. Invokes an async greeting function
 * 3. Stores the greeting in context
 * 4. Outputs the greeting
 */
export const greetingMachine = setup({
  types: {
    context: {} as GreetingContext,
    events: {} as GreetingEvent,
  },
  actors: {
    greetingFunction: greetingFunctionActor,
  },
}).createMachine({
  id: "greeting",
  context: {
    greeting: undefined,
  },
  initial: "Greet",
  states: {
    Greet: {
      invoke: {
        src: "greetingFunction",
        input: ({ event }) => ({
          name: (event as { type: "xstate.init"; input: GreetingInput }).input?.person?.name ?? "World",
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
