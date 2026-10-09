/**
 * Workflow Event-Based Transitions Example
 *
 * A workflow that demonstrates event-based transitions with timeout fallback.
 *
 * Demonstrates:
 * - Event-based branching
 * - After/delay transitions (timeout)
 * - Multiple event handlers on same state
 *
 * Ported from xstate/examples/workflow-event-based
 * Based on: https://github.com/serverlessworkflow/specification/tree/main/examples#Event-Based-Transitions-Example
 */
import { setup, fromPromise } from "../src/index.js"

/**
 * Events for the event-based workflow.
 */
export type EventBasedEvent =
  | { type: "visaApprovedEvent" }
  | { type: "visaRejectedEvent" }

/**
 * Handle approved visa actor.
 */
export const handleApprovedVisaActor = fromPromise<void, void>(async () => {
  await new Promise((resolve) => setTimeout(resolve, 100))
})

/**
 * Handle rejected visa actor.
 */
export const handleRejectedVisaActor = fromPromise<void, void>(async () => {
  await new Promise((resolve) => setTimeout(resolve, 100))
})

/**
 * Handle no visa decision actor.
 */
export const handleNoVisaDecisionActor = fromPromise<void, void>(async () => {
  await new Promise((resolve) => setTimeout(resolve, 100))
})

/**
 * Event-based workflow machine.
 *
 * This workflow:
 * 1. Waits for a visa decision event
 * 2. Routes to appropriate handler based on event type
 * 3. If no event received within timeout, handles as no decision
 */
export const eventBasedMachine = setup({
  types: {
    events: {} as EventBasedEvent,
  },
  actors: {
    handleApprovedVisaWorkflowID: handleApprovedVisaActor,
    handleRejectedVisaWorkflowID: handleRejectedVisaActor,
    handleNoVisaDecisionWorkflowId: handleNoVisaDecisionActor,
  },
}).createMachine({
  id: "eventbasedswitchstate",
  initial: "CheckVisaStatus",
  states: {
    CheckVisaStatus: {
      on: {
        visaApprovedEvent: "HandleApprovedVisa",
        visaRejectedEvent: "HandleRejectedVisa",
      },
      // Note: after/delays require scheduler support
      // after: {
      //   visaDecisionTimeout: "HandleNoVisaDecision"
      // }
    },
    HandleApprovedVisa: {
      invoke: {
        src: "handleApprovedVisaWorkflowID",
        onDone: "End",
      },
    },
    HandleRejectedVisa: {
      invoke: {
        src: "handleRejectedVisaWorkflowID",
        onDone: "End",
      },
    },
    HandleNoVisaDecision: {
      invoke: {
        src: "handleNoVisaDecisionWorkflowId",
        onDone: "End",
      },
    },
    End: {
      type: "final",
    },
  },
})
