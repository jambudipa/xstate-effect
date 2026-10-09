/**
 * Workflow Send CloudEvent on Completion Example
 *
 * A workflow that provisions orders and outputs the results on completion.
 *
 * Demonstrates:
 * - Batch processing with array input
 * - Promise.all in actor
 * - Final state with output
 * - Input array handling
 *
 * Ported from xstate/examples/workflow-send-cloudevent
 * Based on: https://github.com/serverlessworkflow/specification/tree/main/examples#send-cloudevent-on-workflow-completion-example
 */
import { Option } from "effect"
import { setup, assign, fromPromise } from "../src/index.js"

/**
 * Order information.
 */
export interface Order {
  /** The order id; the provisioned result repeats it. */
  id: string
  /** The ordered item. */
  item: string
  /** The quantity, as text. */
  quantity: string
}

/**
 * Provisioned order result.
 */
export interface ProvisionedOrder {
  /** The id of the order this result is for. */
  id: string
  /** The provisioning outcome; the mock always gives "SUCCESS". */
  outcome: string
}

/**
 * Input type for the send cloud event workflow.
 */
export interface SendCloudEventInput {
  /** The orders to provision. Required: the context factory copies it without a check. */
  orders: Order[]
}

/**
 * Context type for the send cloud event workflow.
 */
export interface SendCloudEventContext {
  /** The orders from the input; nothing changes them. */
  orders: Order[]
  /** One result for each order, in input order; undefined until provisioning finishes. The final output repeats it. */
  provisionedOrders: ProvisionedOrder[] | undefined
}

/**
 * Provision orders function actor.
 */
export const provisionOrdersFunctionActor = fromPromise<ProvisionedOrder[], { orders: Order[] }>(
  async ({ input }) => {
    const data = await Promise.all(
      input.orders.map(async (order) => {
        await new Promise((resolve) => setTimeout(resolve, 50))
        return {
          id: order.id,
          outcome: "SUCCESS",
        }
      })
    )
    return data
  }
)

/**
 * Send cloud event workflow machine.
 *
 * This workflow:
 * 1. Receives orders as input
 * 2. Provisions all orders
 * 3. Outputs the provisioned orders (would trigger CloudEvent in real implementation)
 */
export const sendCloudEventMachine = setup({
  types: {
    context: {} as SendCloudEventContext,
  },
  actors: {
    provisionOrdersFunction: provisionOrdersFunctionActor,
  },
}).createMachine({
  id: "sendcloudeventonprovision",
  initial: "ProvisionOrdersState",
  context: ({ input }) => ({
    orders: (input as SendCloudEventInput).orders,
    provisionedOrders: undefined,
  }),
  states: {
    ProvisionOrdersState: {
      invoke: {
        src: "provisionOrdersFunction",
        input: ({ context }) => ({
          orders: context.orders,
        }),
        onDone: {
          actions: assign(({ event }) => ({
            // A done event's output is an Option (D8)
            provisionedOrders: Option.getOrUndefined(event.output),
          })),
          target: "End",
        },
      },
    },
    End: {
      type: "final",
      output: ({ context }) => ({
        provisionedOrders: context.provisionedOrders,
      }),
    },
  },
})
