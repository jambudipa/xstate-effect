/**
 * Workflow Car Auction Bids Example
 *
 * A workflow that collects car auction bids and determines the winner.
 *
 * Demonstrates:
 * - Array accumulation in context
 * - After/delay for auction timeout
 * - Final state with computed output
 * - Event payload handling
 *
 * Ported from xstate/examples/workflow-car-auction-bids
 * Based on: https://github.com/serverlessworkflow/specification/tree/main/examples#handle-car-auction-bids-example
 */
import { createMachine, assign } from "../src/index.js"

/**
 * Bid information.
 */
export interface Bid {
  /** The car the bid is for. The machine does not check it: all bids compete as one auction. */
  carid: string
  /** The bid amount. The highest amount wins; on a tie the later bid wins. */
  amount: number
  /** The person who placed the bid. */
  bidder: {
    id: string
    firstName: string
    lastName: string
  }
}

/**
 * Context type for the car auction workflow.
 */
export interface CarAuctionContext {
  /** Every bid in the order of arrival. The final output picks the winner from it, or null when it is empty. */
  bids: Bid[]
}

/**
 * Events for the car auction workflow.
 */
export type CarAuctionEvent =
  | { type: "CarBidEvent"; bid: Bid }
  | { type: "END_BIDDING" }

/**
 * Car auction workflow machine.
 *
 * This workflow:
 * 1. Collects bids until timeout
 * 2. Determines the winning bid
 * 3. Outputs the winner
 */
export const carAuctionMachine = createMachine({
  types: {} as { context: CarAuctionContext; events: CarAuctionEvent },
  id: "handleCarAuctionBid",
  description: "Store bids while the car auction is active",
  initial: "StoreCarAuctionBid",
  context: {
    bids: [],
  },
  states: {
    StoreCarAuctionBid: {
      on: {
        CarBidEvent: {
          actions: assign(({ context, event }) => ({
            bids: [...context.bids, (event as { type: "CarBidEvent"; bid: Bid }).bid],
          })),
        },
        // Manual trigger for testing (since after/delays need scheduler support)
        END_BIDDING: "BiddingEnded",
      },
      // In full implementation:
      // after: {
      //   BiddingDelay: "BiddingEnded"
      // }
    },
    BiddingEnded: {
      type: "final",
      output: ({ context }) => ({
        winningBid: context.bids.length > 0
          ? context.bids.reduce((prev, current) =>
              prev.amount > current.amount ? prev : current
            )
          : null,
      }),
    },
  },
})
