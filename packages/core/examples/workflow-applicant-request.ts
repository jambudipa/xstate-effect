/**
 * Workflow Applicant Request Decision Example
 *
 * A workflow that handles application requests with age-based decisions.
 *
 * Demonstrates:
 * - Guards for conditional transitions
 * - Multiple transition targets from same event
 * - Input-based context initialization
 * - Actor invocation with error handling
 *
 * Ported from xstate/examples/workflow-applicant-request
 * Based on: https://github.com/serverlessworkflow/specification/tree/main/examples#applicant-request-decision-example
 */
import { setup, fromPromise } from "../src/index.js"

/**
 * Applicant information.
 */
export interface Applicant {
  fname: string
  lname: string
  age: number
  email: string
}

/**
 * Input type for the applicant request workflow.
 */
export interface ApplicantRequestInput {
  applicant: Applicant
}

/**
 * Context type for the applicant request workflow.
 */
export interface ApplicantRequestContext {
  applicant: Applicant
}

/**
 * Events for the applicant request workflow.
 */
export type ApplicantRequestEvent =
  | { type: "Submit" }

/**
 * Start application workflow actor.
 */
export const startApplicationActor = fromPromise<void, void>(async () => {
  await new Promise((resolve) => setTimeout(resolve, 100))
})

/**
 * Send rejection email actor.
 */
export const sendRejectionEmailActor = fromPromise<void, { applicant: Applicant }>(
  async ({ input }) => {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
)

/**
 * Applicant request workflow machine.
 *
 * This workflow:
 * 1. Receives an applicant as input
 * 2. Waits for Submit event
 * 3. If applicant is 18+, starts application
 * 4. If under 18, sends rejection email
 */
export const applicantRequestMachine = setup({
  types: {
    context: {} as ApplicantRequestContext,
    events: {} as ApplicantRequestEvent,
  },
  actors: {
    startApplicationWorkflowId: startApplicationActor,
    sendRejectionEmailFunction: sendRejectionEmailActor,
  },
  guards: {
    isOver18: ({ context }) => context.applicant.age >= 18,
  },
}).createMachine({
  id: "applicantrequest",
  initial: "CheckApplication",
  context: ({ input }) => ({
    applicant: (input as ApplicantRequestInput).applicant,
  }),
  states: {
    CheckApplication: {
      on: {
        Submit: [
          {
            target: "StartApplication",
            guard: "isOver18",
            reenter: false,
          },
          {
            target: "RejectApplication",
            reenter: false,
          },
        ],
      },
    },
    StartApplication: {
      invoke: {
        src: "startApplicationWorkflowId",
        onDone: "End",
        onError: "RejectApplication",
      },
    },
    RejectApplication: {
      invoke: {
        src: "sendRejectionEmailFunction",
        input: ({ context }) => ({
          applicant: context.applicant,
        }),
        onDone: "End",
      },
    },
    End: {
      type: "final",
    },
  },
})
