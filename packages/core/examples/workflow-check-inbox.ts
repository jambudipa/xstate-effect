/**
 * Workflow Check Inbox Example
 *
 * A workflow that periodically checks an inbox and sends texts for high priority messages.
 *
 * Demonstrates:
 * - Callback actor for scheduling/intervals
 * - Root-level invoke for background process
 * - Array handling in context
 * - Chained async operations
 *
 * Ported from xstate/examples/workflow-check-inbox
 * Based on: https://github.com/serverlessworkflow/specification/tree/main/examples#check-inbox-periodically
 */
import { Option } from "effect"
import { setup, assign, fromPromise, fromCallback } from "../src/index.js"
import type { EventObject } from "../src/index.js"

/**
 * Message in the inbox.
 */
export interface Message {
  /** The message subject. */
  subject: string
  /** The priority. The workflow texts the high-priority messages; the mock text actor only waits, 10 ms for "high" and 50 ms for "low". */
  priority: "high" | "low"
}

/**
 * Context type for the check inbox workflow.
 */
export interface CheckInboxContext {
  /** The messages of the last inbox check; each check replaces the list, and the text actor receives it. */
  messages: Message[]
}

/**
 * Events for the check inbox workflow.
 */
export type CheckInboxEvent =
  | { type: "reminder" }
  | { type: "xstate.done.actor.checkInboxFunction"; output: Message[] }
  | { type: "xstate.done.actor.sendTextsFunction"; output: { status: string } }

/**
 * Schedule actor - emits reminder events at interval.
 */
export const scheduleActor = fromCallback<EventObject, { interval: number }, EventObject>(
  ({ input, sendBack }) => {
    const i = setInterval(() => {
      sendBack({ type: "reminder" })
    }, input.interval)

    return () => {
      clearInterval(i)
    }
  }
)

/**
 * Check inbox function actor.
 */
export const checkInboxFunctionActor = fromPromise<Message[], void>(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50))
  return [
    { subject: "Hello", priority: "high" as const },
    { subject: "Hi", priority: "low" as const },
  ]
})

/**
 * Send texts function actor.
 */
export const sendTextsFunctionActor = fromPromise<{ status: string }, { messages: Message[] }>(
  async ({ input }) => {
    await Promise.all(
      input.messages.map(async (message) => {
        if (message.priority === "high") {
          await new Promise((resolve) => setTimeout(resolve, 10))
        } else {
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
      })
    )
    return { status: "success" }
  }
)

/**
 * Check inbox workflow machine.
 *
 * This workflow:
 * 1. Runs a scheduler in the background
 * 2. On reminder, checks the inbox
 * 3. Sends texts for messages
 * 4. Returns to idle to wait for next reminder
 */
export const checkInboxMachine = setup({
  types: {
    context: {} as CheckInboxContext,
    events: {} as CheckInboxEvent,
  },
  actors: {
    schedule: scheduleActor,
    checkInboxFunction: checkInboxFunctionActor,
    sendTextsFunction: sendTextsFunctionActor,
  },
}).createMachine({
  id: "checkInbox",
  initial: "Idle",
  context: {
    messages: [],
  },
  // Root-level invoke for background scheduling
  // Note: This requires full invoke support
  // invoke: {
  //   src: "schedule",
  //   input: { interval: 2000 }
  // },
  states: {
    Idle: {
      on: {
        reminder: "CheckInbox",
      },
    },
    CheckInbox: {
      invoke: {
        src: "checkInboxFunction",
        onDone: {
          target: "SendTextForHighPriority",
          actions: assign(({ event }) => ({
            messages: Option.getOrElse(event.output, (): Message[] => []),
          })),
        },
      },
    },
    SendTextForHighPriority: {
      invoke: {
        src: "sendTextsFunction",
        input: ({ context }) => ({
          messages: context.messages,
        }),
        onDone: "Idle",
      },
    },
  },
})
