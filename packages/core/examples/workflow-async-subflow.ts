/**
 * Workflow Async Subflow Invocation Example
 *
 * A workflow that invokes another machine as a subflow.
 *
 * Demonstrates:
 * - Machine as actor (subflow)
 * - Nested machine invocation
 * - Multi-step subflow with context
 *
 * Ported from xstate/examples/workflow-async-subflow
 * Based on: https://github.com/serverlessworkflow/specification/tree/main/examples#async-subflow-invocation-example
 */
import { Option } from "effect"
import { setup, assign, fromPromise, createMachine } from "../src/index.js"

/**
 * Context type for the onboarding subflow.
 */
export interface OnboardingContext {
  name: string | undefined
}

/**
 * Events for the onboarding subflow.
 */
export type OnboardingEvent =
  | { type: "xstate.done.actor.prompt"; output: { response: string } }

/**
 * Prompt actor - simulates user prompt.
 */
export const promptActor = fromPromise<{ response: string }, { question: string }>(
  async ({ input }) => {
    // In a real implementation, this would prompt the user
    // For the example, we simulate a response
    await new Promise((resolve) => setTimeout(resolve, 50))
    return {
      response: input.question.includes("name") ? "Alice" : "OK",
    }
  }
)

/**
 * Onboarding subflow machine.
 *
 * A multi-step onboarding process.
 */
export const onboardingMachine = setup({
  types: {
    context: {} as OnboardingContext,
    events: {} as OnboardingEvent,
  },
  actors: {
    prompt: promptActor,
  },
}).createMachine({
  id: "onboarding",
  initial: "Welcome",
  context: {
    name: undefined,
  },
  states: {
    Welcome: {
      invoke: {
        src: "prompt",
        input: {
          question: "What is your name?",
        },
        onDone: {
          target: "Personalize",
          actions: assign(({ event }) => ({
            name: Option.getOrUndefined(event.output)?.response,
          })),
        },
      },
    },
    Personalize: {
      invoke: {
        src: "prompt",
        input: ({ context }) => ({
          question: `Welcome ${context.name}, press enter to finish the onboarding process`,
        }),
        onDone: "Completed",
      },
    },
    Completed: {
      type: "final",
    },
  },
})

/**
 * Main workflow machine that invokes the onboarding subflow.
 */
export const asyncSubflowMachine = setup({
  actors: {
    onboarding: onboardingMachine,
  },
}).createMachine({
  id: "async-subflow-invocation",
  initial: "Onboard",
  states: {
    Onboard: {
      invoke: {
        src: "onboarding",
        onDone: "Onboarded",
      },
    },
    Onboarded: {
      type: "final",
    },
  },
})
