/**
 * Workflow Finalize College Application Example
 *
 * A workflow that waits for all required documents before finalizing an application.
 *
 * Demonstrates:
 * - Multiple event accumulation pattern
 * - Always transition with compound guard
 * - Boolean flags in context
 * - Input-based context initialization
 *
 * Ported from xstate/examples/workflow-finalize-college-app
 * Based on: https://github.com/serverlessworkflow/specification/tree/main/examples#finalize-college-application-example
 */
import { setup, assign, fromPromise } from "../src/index.js"

/**
 * Input type for the college application workflow.
 */
export interface CollegeAppInput {
  /** The applicant whose application to finalize. Required: the context factory reads it without a check. */
  applicantId: string
}

/**
 * Context type for the college application workflow.
 */
export interface CollegeAppContext {
  /** The applicant from the input; the finalize actor receives it. */
  applicantId: string
  /** Set by ApplicationSubmitted. The application is finalized when all three flags are true, in any order. */
  applicationSubmitted: boolean
  /** Set by SATScoresReceived; one of the three flags that finalization needs. */
  satScoresReceived: boolean
  /** Set by RecommendationLetterReceived; one of the three flags that finalization needs. */
  recommendationLetterReceived: boolean
}

/**
 * Events for the college application workflow.
 */
export type CollegeAppEvent =
  | { type: "ApplicationSubmitted" }
  | { type: "SATScoresReceived" }
  | { type: "RecommendationLetterReceived" }

/**
 * Finalize application actor.
 */
export const finalizeApplicationFunctionActor = fromPromise<{ applicantId: string }, { applicantId: string }>(
  async ({ input }) => {
    await new Promise((resolve) => setTimeout(resolve, 100))
    console.log("Finalized application for:", input.applicantId)
    return { applicantId: input.applicantId }
  }
)

/**
 * College application workflow machine.
 *
 * This workflow:
 * 1. Waits for all three required events
 * 2. When all received, finalizes the application
 * 3. Completes
 */
export const collegeAppMachine = setup({
  types: {
    context: {} as CollegeAppContext,
    events: {} as CollegeAppEvent,
  },
  actors: {
    finalizeApplicationFunction: finalizeApplicationFunctionActor,
  },
}).createMachine({
  id: "finalizeCollegeApplication",
  initial: "FinalizeApplication",
  context: ({ input }) => ({
    applicantId: (input as CollegeAppInput).applicantId,
    applicationSubmitted: false,
    satScoresReceived: false,
    recommendationLetterReceived: false,
  }),
  states: {
    FinalizeApplication: {
      on: {
        ApplicationSubmitted: {
          actions: assign({ applicationSubmitted: true }),
        },
        SATScoresReceived: {
          actions: assign({ satScoresReceived: true }),
        },
        RecommendationLetterReceived: {
          actions: assign({ recommendationLetterReceived: true }),
        },
      },
      always: {
        guard: ({ context }) =>
          context.applicationSubmitted &&
          context.satScoresReceived &&
          context.recommendationLetterReceived,
        target: "FinalizingApplication",
      },
    },
    FinalizingApplication: {
      invoke: {
        src: "finalizeApplicationFunction",
        input: ({ context }) => ({
          applicantId: context.applicantId,
        }),
        onDone: "Finalized",
      },
    },
    Finalized: {
      type: "final",
    },
  },
})
