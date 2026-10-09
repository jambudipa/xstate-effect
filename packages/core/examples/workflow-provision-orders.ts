/**
 * Workflow Provision Orders Example
 *
 * A workflow that provisions orders with error handling for different exceptions.
 *
 * Demonstrates:
 * - Error handling with multiple onError targets
 * - Guards on error events
 * - Nested exception handling states
 * - onDone for compound state completion
 *
 * Ported from xstate/examples/workflow-provision-orders
 * Based on: https://github.com/serverlessworkflow/specification/tree/main/examples#provision-orders-example
 */
import { setup, fromPromise } from "../src/index.js"

/**
 * Order information.
 */
export interface Order {
  /** The order id. An empty id makes the provision step fail and leads to the missing-id handler. */
  id: string
  /** The ordered item. An empty item leads to the missing-item handler; the id is checked first. */
  item: string
  /** The quantity, as text. An empty quantity leads to the missing-quantity handler; it is checked last. */
  quantity: string
}

/**
 * Input type for the provision orders workflow.
 */
export interface ProvisionOrdersInput {
  /** The order to provision. Required: the context factory copies it without a check. */
  order: Order
}

/**
 * Context type for the provision orders workflow.
 */
export interface ProvisionOrdersContext {
  /** The order from the input; nothing changes it. */
  order: Order
}

/**
 * Provision order function actor.
 */
export const provisionOrderFunctionActor = fromPromise<{ order: Order }, { order: Order }>(
  async ({ input }) => {
    await new Promise((resolve) => setTimeout(resolve, 50))
    if (!input.order.id) {
      throw new Error("Missing order id")
    }
    if (!input.order.item) {
      throw new Error("Missing order item")
    }
    if (!input.order.quantity) {
      throw new Error("Missing order quantity")
    }
    return { order: input.order }
  }
)

/**
 * Apply order workflow actor.
 */
export const applyOrderWorkflowActor = fromPromise<void, void>(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50))
})

/**
 * Handle missing ID exception actor.
 */
export const handleMissingIdExceptionActor = fromPromise<void, void>(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50))
  console.log("Handled missing ID exception")
})

/**
 * Handle missing item exception actor.
 */
export const handleMissingItemExceptionActor = fromPromise<void, void>(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50))
  console.log("Handled missing item exception")
})

/**
 * Handle missing quantity exception actor.
 */
export const handleMissingQuantityExceptionActor = fromPromise<void, void>(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50))
  console.log("Handled missing quantity exception")
})

/**
 * Provision orders workflow machine.
 *
 * This workflow:
 * 1. Provisions an order
 * 2. On success, applies the order
 * 3. On error, routes to appropriate exception handler
 * 4. Exception handlers complete the workflow
 */
export const provisionOrdersMachine = setup({
  types: {
    context: {} as ProvisionOrdersContext,
  },
  actors: {
    provisionOrderFunction: provisionOrderFunctionActor,
    applyOrderWorkflowId: applyOrderWorkflowActor,
    handleMissingIdExceptionWorkflow: handleMissingIdExceptionActor,
    handleMissingItemExceptionWorkflow: handleMissingItemExceptionActor,
    handleMissingQuantityExceptionWorkflow: handleMissingQuantityExceptionActor,
  },
}).createMachine({
  id: "provisionorders",
  initial: "ProvisionOrder",
  context: ({ input }) => ({
    order: (input as ProvisionOrdersInput).order,
  }),
  states: {
    ProvisionOrder: {
      invoke: {
        src: "provisionOrderFunction",
        input: ({ context }) => ({
          order: context.order,
        }),
        onDone: "ApplyOrder",
        onError: [
          {
            guard: ({ event }) =>
              (event as { error: Error }).error?.message === "Missing order id",
            target: "Exception.MissingId",
          },
          {
            guard: ({ event }) =>
              (event as { error: Error }).error?.message === "Missing order item",
            target: "Exception.MissingItem",
          },
          {
            guard: ({ event }) =>
              (event as { error: Error }).error?.message === "Missing order quantity",
            target: "Exception.MissingQuantity",
          },
        ],
      },
    },
    ApplyOrder: {
      invoke: {
        src: "applyOrderWorkflowId",
        onDone: "End",
      },
    },
    End: {
      type: "final",
    },
    Exception: {
      initial: "MissingId",
      states: {
        MissingId: {
          invoke: {
            src: "handleMissingIdExceptionWorkflow",
            onDone: "End",
          },
        },
        MissingItem: {
          invoke: {
            src: "handleMissingItemExceptionWorkflow",
            onDone: "End",
          },
        },
        MissingQuantity: {
          invoke: {
            src: "handleMissingQuantityExceptionWorkflow",
            onDone: "End",
          },
        },
        End: {
          type: "final",
        },
      },
      onDone: "End",
    },
  },
})
