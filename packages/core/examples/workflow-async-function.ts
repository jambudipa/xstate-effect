/**
 * Workflow Async Function Invocation Example
 *
 * A workflow that invokes an async function (sending an email).
 *
 * Demonstrates:
 * - Input-based context initialization
 * - Invoke with dynamic input from context
 * - Simple async operation
 *
 * Ported from xstate/examples/workflow-async-function
 * Based on: https://github.com/serverlessworkflow/specification/tree/main/examples#async-function-invocation-example
 */
import { setup, fromPromise } from "../src/index.js"

/**
 * Input type for the async function workflow.
 */
export interface AsyncFunctionInput {
  customer: string
}

/**
 * Context type for the async function workflow.
 */
export interface AsyncFunctionContext {
  customer: string
}

/**
 * Send email actor.
 *
 * Simulates sending an email to a customer.
 */
export const sendEmailActor = fromPromise<void, { customer: string }>(async ({ input }) => {
  // Simulate email sending
  await new Promise<void>((resolve) => setTimeout(resolve, 100))
  // Email sent successfully
})

/**
 * Async function invocation workflow machine.
 *
 * This workflow:
 * 1. Receives customer email as input
 * 2. Sends an email to the customer
 * 3. Completes
 */
export const asyncFunctionMachine = setup({
  types: {
    context: {} as AsyncFunctionContext,
  },
  actors: {
    sendEmail: sendEmailActor,
  },
}).createMachine({
  id: "async-function-invocation",
  initial: "Send email",
  context: ({ input }) => ({
    customer: (input as AsyncFunctionInput)?.customer ?? "unknown@example.com",
  }),
  states: {
    "Send email": {
      invoke: {
        src: "sendEmail",
        input: ({ context }) => ({
          customer: context.customer,
        }),
        onDone: "Email sent",
      },
    },
    "Email sent": {
      type: "final",
    },
  },
})
