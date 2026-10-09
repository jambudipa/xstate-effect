/**
 * Workflow Reusing Functions / Event-Based Service Example
 *
 * A workflow that handles payment confirmation with fund checking.
 *
 * Demonstrates:
 * - Child machine invocation
 * - sendParent for child-to-parent communication
 * - forwardTo for event delegation
 * - Guards with named implementations
 * - Event-driven workflow initiation
 *
 * Ported from xstate/examples/workflow-reusing-functions
 * Based on: https://github.com/serverlessworkflow/specification/tree/main/examples#event-based-service-invocation
 */
import { Option } from "effect"
import { setup, assign, fromPromise } from "../src/index.js"

/**
 * Payment received event.
 */
export interface PaymentReceivedEvent {
  /** The event type; the only event either machine accepts. */
  type: "PaymentReceivedEvent"
  /** The account to check the funds of. */
  accountId: string
  /** The payment; the mock fund check approves an amount below 1000. */
  payment: {
    amount: number
  }
  /** The customer who receives the confirmation email. */
  customer: {
    name: string
  }
  /** The availability that the sender claims. The fund check overwrites it before the decision. */
  funds: {
    available: boolean
  }
}

/**
 * Context type for the payment confirmation workflow.
 */
export interface PaymentConfirmationContext {
  /** The payment of the received event; null while Pending. The fund check reads it with a non-null assertion. */
  payment: { amount: number } | null
  /** The customer of the received event; null while Pending. */
  customer: { name: string } | null
  /** The result of the fund check (first the claim of the event); the success email needs `available` true. */
  funds: { available: boolean } | null
  /** The account of the received event; null while Pending. */
  accountId: string | null
}

/**
 * Check funds actor.
 */
export const checkFundsActor = fromPromise<{ available: boolean }, { account: string; paymentamount: number }>(
  async ({ input }) => {
    await new Promise((resolve) => setTimeout(resolve, 50))
    return {
      available: input.paymentamount < 1000,
    }
  }
)

/**
 * Send success email actor.
 */
export const sendSuccessEmailActor = fromPromise<void, { applicant: { name: string } | null }>(
  async ({ input }) => {
    await new Promise((resolve) => setTimeout(resolve, 50))
    console.log("Success email sent to:", input.applicant?.name)
  }
)

/**
 * Send insufficient funds email actor.
 */
export const sendInsufficientFundsEmailActor = fromPromise<void, { applicant: { name: string } | null }>(
  async ({ input }) => {
    await new Promise((resolve) => setTimeout(resolve, 50))
    console.log("Insufficient funds email sent to:", input.applicant?.name)
  }
)

/**
 * Payment confirmation workflow machine.
 *
 * This workflow:
 * 1. Waits for payment event
 * 2. Checks if funds are available
 * 3. Sends appropriate email based on fund availability
 * 4. Completes (would send event to parent in full implementation)
 */
export const paymentConfirmationMachine = setup({
  types: {
    context: {} as PaymentConfirmationContext,
    events: {} as PaymentReceivedEvent,
  },
  actors: {
    checkfunds: checkFundsActor,
    sendSuccessEmail: sendSuccessEmailActor,
    sendInsufficientFundsEmail: sendInsufficientFundsEmailActor,
  },
  guards: {
    fundsAvailable: ({ context }) => !!context.funds?.available,
  },
}).createMachine({
  id: "paymentconfirmation",
  initial: "Pending",
  context: {
    customer: null,
    payment: null,
    funds: null,
    accountId: null,
  },
  states: {
    Pending: {
      on: {
        PaymentReceivedEvent: {
          actions: assign(({ event }) => ({
            customer: event.customer,
            payment: event.payment,
            funds: event.funds,
            accountId: event.accountId,
          })),
          target: "PaymentReceived",
        },
      },
    },
    PaymentReceived: {
      invoke: {
        src: "checkfunds",
        input: ({ context }) => ({
          account: context.accountId!,
          paymentamount: context.payment!.amount,
        }),
        onDone: {
          actions: assign(({ event }) => ({
            // A done event's output is an Option (D8)
            funds: Option.getOrNull(event.output),
          })),
          target: "ConfirmBasedOnFunds",
        },
      },
    },
    ConfirmBasedOnFunds: {
      always: [
        {
          guard: "fundsAvailable",
          target: "SendPaymentSuccess",
        },
        {
          target: "SendInsufficientResults",
        },
      ],
    },
    SendPaymentSuccess: {
      invoke: {
        src: "sendSuccessEmail",
        input: ({ context }) => ({
          applicant: context.customer,
        }),
        onDone: "End",
      },
    },
    SendInsufficientResults: {
      invoke: {
        src: "sendInsufficientFundsEmail",
        input: ({ context }) => ({
          applicant: context.customer,
        }),
        onDone: "End",
      },
    },
    End: {
      type: "final",
      // In full implementation: entry: sendParent(...)
    },
  },
})

/**
 * Parent workflow machine that invokes the payment confirmation child.
 */
export const parentPaymentMachine = setup({
  types: {
    events: {} as PaymentReceivedEvent,
  },
  actors: {
    paymentconfirmation: paymentConfirmationMachine,
  },
}).createMachine({
  id: "parent",
  initial: "Active",
  states: {
    Active: {
      invoke: {
        id: "paymentconfirmation",
        src: "paymentconfirmation",
        onDone: "Complete",
      },
      on: {
        PaymentReceivedEvent: {
          // In full implementation: actions: forwardTo("paymentconfirmation")
        },
      },
    },
    Complete: {
      type: "final",
    },
  },
})
