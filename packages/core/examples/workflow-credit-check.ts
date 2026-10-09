/**
 * Workflow Customer Credit Check Example
 *
 * A workflow that performs credit checks and routes based on decision.
 *
 * Demonstrates:
 * - Complex workflow with multiple decision points
 * - Always transitions for routing
 * - Context updates from invoke output
 * - Timeout handling (conceptual - requires delay support)
 *
 * Ported from xstate/examples/workflow-credit-check
 * Based on: https://github.com/serverlessworkflow/specification/tree/main/examples#perform-customer-credit-check-example
 */
import { Option } from "effect"
import { setup, assign, fromPromise } from "../src/index.js"

/**
 * Customer information.
 */
export interface Customer {
  /** The customer id; the credit check result repeats it. */
  id: string
  /** The full name. */
  name: string
  /** The social security number, as a number. */
  SSN: number
  /** The yearly income; the mock service does not read it. */
  yearlyIncome: number
  /** The postal address. */
  address: string
  /** The employer name. */
  employer: string
}

/**
 * Credit check result.
 */
export interface CreditCheckResult {
  /** The id of the customer that was checked. */
  id: string
  /** The credit score; the mock always gives 700. */
  score: number
  /** The decision that routes the workflow: "Approved" starts the application, "Denied" sends the rejection email. */
  decision: "Approved" | "Denied"
  /** The reason for the decision, as text. */
  reason: string
}

/**
 * Input type for the credit check workflow.
 */
export interface CreditCheckInput {
  /** The customer to check. Required: the context factory copies it without a check. */
  customer: Customer
}

/**
 * Context type for the credit check workflow.
 */
export interface CreditCheckContext {
  /** The customer from the input; nothing changes it. */
  customer: Customer
  /** The result of the credit check; null until it finishes. Anything but "Approved", null included, leads to rejection. */
  creditCheck: CreditCheckResult | null
}

/**
 * Credit check microservice actor.
 */
export const callCreditCheckMicroserviceActor = fromPromise<CreditCheckResult, { customer: Customer }>(
  async ({ input }) => {
    await new Promise((resolve) => setTimeout(resolve, 100))
    return {
      id: input.customer.id,
      score: 700,
      decision: "Approved" as const,
      reason: "Good credit score",
    }
  }
)

/**
 * Start application workflow actor.
 */
export const startApplicationWorkflowActor = fromPromise<{ application: { id: string; status: string } }, { customer: Customer }>(
  async ({ input }) => {
    await new Promise((resolve) => setTimeout(resolve, 100))
    return {
      application: {
        id: "application123",
        status: "Approved",
      },
    }
  }
)

/**
 * Send rejection email actor.
 */
export const sendRejectionEmailActor = fromPromise<{ email: { id: string; status: string } }, { applicant: Customer }>(
  async ({ input }) => {
    await new Promise((resolve) => setTimeout(resolve, 100))
    return {
      email: {
        id: "email123",
        status: "Sent",
      },
    }
  }
)

/**
 * Customer credit check workflow machine.
 *
 * This workflow:
 * 1. Calls credit check microservice
 * 2. Evaluates the decision (Approved/Denied)
 * 3. Routes to appropriate next step
 * 4. Handles timeout scenario
 */
export const creditCheckMachine = setup({
  types: {
    context: {} as CreditCheckContext,
  },
  actors: {
    callCreditCheckMicroservice: callCreditCheckMicroserviceActor,
    startApplicationWorkflowId: startApplicationWorkflowActor,
    sendRejectionEmailFunction: sendRejectionEmailActor,
  },
}).createMachine({
  id: "customercreditcheck",
  initial: "CheckCredit",
  context: ({ input }) => ({
    customer: (input as CreditCheckInput).customer,
    creditCheck: null,
  }),
  states: {
    CheckCredit: {
      invoke: {
        src: "callCreditCheckMicroservice",
        input: ({ context }) => ({
          customer: context.customer,
        }),
        onDone: {
          target: "EvaluateDecision",
          actions: assign(({ event }) => ({
            creditCheck: Option.getOrNull(event.output),
          })),
        },
      },
      // Note: after/delays require scheduler support
      // after: {
      //   PT15M: "Timeout"
      // }
    },
    EvaluateDecision: {
      always: [
        {
          guard: ({ context }) => context.creditCheck?.decision === "Approved",
          target: "StartApplication",
        },
        {
          guard: ({ context }) => context.creditCheck?.decision === "Denied",
          target: "RejectApplication",
        },
        {
          target: "RejectApplication",
        },
      ],
    },
    StartApplication: {
      invoke: {
        src: "startApplicationWorkflowId",
        input: ({ context }) => ({
          customer: context.customer,
        }),
        onDone: "End",
      },
    },
    RejectApplication: {
      invoke: {
        src: "sendRejectionEmailFunction",
        input: ({ context }) => ({
          applicant: context.customer,
        }),
        onDone: "End",
      },
    },
    End: {
      type: "final",
    },
    Timeout: {
      // Timeout state - workflow ends here if credit check times out
    },
  },
})
