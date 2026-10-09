/**
 * Workflow Purchase Order Deadline Example
 *
 * A workflow that handles order lifecycle with a deadline for cancellation.
 *
 * Demonstrates:
 * - Root-level after/delay for deadline
 * - Sequential event-driven state transitions
 * - Named actions in implementations
 * - Deadline-based cancellation
 *
 * Ported from xstate/examples/workflow-purchase-order-deadline
 * Based on: https://github.com/serverlessworkflow/specification/blob/main/examples/README.md#purchase-order-deadline
 */
import { setup, fromPromise } from "../src/index.js"

/**
 * Events for the purchase order workflow.
 */
export type PurchaseOrderEvent =
  | { type: "OrderCreatedEvent" }
  | { type: "OrderConfirmedEvent" }
  | { type: "ShipmentSentEvent" }
  | { type: "OrderFinishedEvent" }
  | { type: "CANCEL_ORDER" }

/**
 * Cancel order actor.
 */
export const cancelOrderActor = fromPromise<void, void>(async () => {
  await new Promise((resolve) => setTimeout(resolve, 100))
  console.log("Order cancelled")
})

/**
 * Purchase order workflow machine.
 *
 * This workflow:
 * 1. Starts with order creation
 * 2. Waits for confirmation
 * 3. Waits for shipment
 * 4. Finishes order
 * 5. OR cancels if deadline is reached (requires delay support)
 */
export const purchaseOrderMachine = setup({
  types: {
    events: {} as PurchaseOrderEvent,
  },
  actors: {
    CancelOrder: cancelOrderActor,
  },
  actions: {
    logNewOrderCreated: () => {
      console.log("New order created")
    },
    logOrderConfirmed: () => {
      console.log("Order confirmed")
    },
    logOrderShipped: () => {
      console.log("Order shipped")
    },
    logOrderFinished: () => {
      console.log("Order finished")
    },
    logOrderCancelled: () => {
      console.log("Order cancelled")
    },
  },
}).createMachine({
  id: "order",
  initial: "StartNewOrder",
  // Root-level delay for deadline (requires scheduler support)
  // after: {
  //   PT30D: { target: ".CancelOrder" }
  // },
  states: {
    StartNewOrder: {
      on: {
        OrderCreatedEvent: {
          actions: "logNewOrderCreated",
          target: "WaitForOrderConfirmation",
        },
      },
    },
    WaitForOrderConfirmation: {
      on: {
        OrderConfirmedEvent: {
          actions: "logOrderConfirmed",
          target: "WaitOrderShipped",
        },
        CANCEL_ORDER: "CancelOrder",
      },
    },
    WaitOrderShipped: {
      on: {
        ShipmentSentEvent: {
          actions: "logOrderShipped",
          target: "OrderFinished",
        },
        CANCEL_ORDER: "CancelOrder",
      },
    },
    OrderFinished: {
      type: "final",
      entry: "logOrderFinished",
    },
    CancelOrder: {
      invoke: {
        src: "CancelOrder",
        onDone: "OrderCancelled",
      },
    },
    OrderCancelled: {
      type: "final",
      entry: "logOrderCancelled",
    },
  },
})
