/**
 * Workflow Book Lending Example
 *
 * A comprehensive book lending workflow with multiple decision points.
 *
 * Demonstrates:
 * - Complex state machine with nested states
 * - Multiple actors for different operations
 * - Always transitions for decision logic
 * - Event-based waiting states
 * - Context mutations throughout workflow
 *
 * Ported from xstate/examples/workflow-book-lending
 * Based on: https://github.com/serverlessworkflow/specification/blob/main/examples/README.md#book-lending
 */
import { Option } from "effect"
import { setup, assign, fromPromise } from "../src/index.js"

/**
 * Lender information.
 */
export interface Lender {
  name: string
  address: string
  phone: string
}

/**
 * Book information.
 */
export interface Book {
  title: string
  id: string
  status: "onloan" | "available" | "unknown"
}

/**
 * Context type for the book lending workflow.
 */
export interface BookLendingContext {
  book: Book | null
  lender: Lender | null
}

/**
 * Events for the book lending workflow.
 */
export type BookLendingEvent =
  | { type: "bookLendingRequest"; book: { title: string; id: string }; lender: Lender }
  | { type: "holdBook" }
  | { type: "declineBookhold" }

/**
 * Get book status actor.
 */
export const getBookStatusActor = fromPromise<{ status: "onloan" | "available" }, { bookid: string }>(
  async ({ input }) => {
    await new Promise((resolve) => setTimeout(resolve, 50))
    return { status: "available" as const }
  }
)

/**
 * Send status to lender actor.
 */
export const sendStatusToLenderActor = fromPromise<void, { bookid: string; message: string }>(
  async ({ input }) => {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
)

/**
 * Request hold for lender actor.
 */
export const requestHoldActor = fromPromise<void, { bookid: string; lender: Lender | null }>(
  async ({ input }) => {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
)

/**
 * Cancel hold request actor.
 */
export const cancelHoldActor = fromPromise<void, { bookid: string; lender: Lender | null }>(
  async ({ input }) => {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
)

/**
 * Check out book actor.
 */
export const checkOutBookActor = fromPromise<void, { bookid: string }>(
  async ({ input }) => {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
)

/**
 * Notify lender for checkout actor.
 */
export const notifyLenderActor = fromPromise<void, { bookid: string; lender: Lender | null }>(
  async ({ input }) => {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
)

/**
 * Book lending workflow machine.
 *
 * This workflow handles the complete book lending process:
 * 1. Receive lending request
 * 2. Check book status
 * 3. If available, check out and notify
 * 4. If on loan, notify lender and wait for hold decision
 * 5. Handle hold or cancellation
 */
export const bookLendingMachine = setup({
  types: {
    context: {} as BookLendingContext,
    events: {} as BookLendingEvent,
  },
  actors: {
    "Get status for book": getBookStatusActor,
    "Send status to lender": sendStatusToLenderActor,
    "Request hold for lender": requestHoldActor,
    "Cancel hold request for lender": cancelHoldActor,
    "Check out book with id": checkOutBookActor,
    "Notify Lender for checkout": notifyLenderActor,
  },
}).createMachine({
  id: "bookLending",
  initial: "Book Lending Request",
  context: {
    book: null,
    lender: null,
  },
  states: {
    "Book Lending Request": {
      on: {
        bookLendingRequest: {
          target: "Get Book Status",
          actions: assign(({ event }) => ({
            book: {
              ...event.book,
              status: "unknown" as const,
            },
            lender: event.lender,
          })),
        },
      },
    },
    "Get Book Status": {
      invoke: {
        src: "Get status for book",
        input: ({ context }) => ({
          bookid: context.book!.id,
        }),
        onDone: {
          target: "Book Status Decision",
          actions: assign(({ context, event }) => ({
            book: {
              ...context.book!,
              status: Option.match(event.output, { onNone: () => context.book!.status, onSome: (output) => output.status }),
            },
          })),
        },
      },
    },
    "Book Status Decision": {
      always: [
        {
          guard: ({ context }) => context.book!.status === "onloan",
          target: "Report Status To Lender",
        },
        {
          guard: ({ context }) => context.book!.status === "available",
          target: "Check Out Book",
        },
        {
          target: "End",
        },
      ],
    },
    "Report Status To Lender": {
      invoke: {
        src: "Send status to lender",
        input: ({ context }) => ({
          bookid: context.book!.id,
          message: `Book ${context.book!.title} is already on loan`,
        }),
        onDone: "Wait for Lender response",
      },
    },
    "Wait for Lender response": {
      on: {
        holdBook: "Request Hold",
        declineBookhold: "Cancel Request",
      },
    },
    "Request Hold": {
      invoke: {
        src: "Request hold for lender",
        input: ({ context }) => ({
          bookid: context.book!.id,
          lender: context.lender,
        }),
        onDone: "Sleep two weeks",
      },
    },
    "Cancel Request": {
      invoke: {
        src: "Cancel hold request for lender",
        input: ({ context }) => ({
          bookid: context.book!.id,
          lender: context.lender,
        }),
        onDone: "End",
      },
    },
    "Sleep two weeks": {
      // In full implementation: after: { PT2W: "Get Book Status" }
      // For testing, we just stay here until manually transitioned
      always: "Get Book Status",
    },
    "Check Out Book": {
      initial: "Checking out book",
      states: {
        "Checking out book": {
          invoke: {
            src: "Check out book with id",
            input: ({ context }) => ({
              bookid: context.book!.id,
            }),
            onDone: "Notifying Lender",
          },
        },
        "Notifying Lender": {
          invoke: {
            src: "Notify Lender for checkout",
            input: ({ context }) => ({
              bookid: context.book!.id,
              lender: context.lender,
            }),
            onDone: "Done",
          },
        },
        Done: {
          type: "final",
        },
      },
      onDone: "End",
    },
    End: {
      type: "final",
    },
  },
})
