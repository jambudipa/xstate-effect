/**
 * 7GUIs Flight Booker Example
 *
 * A flight booking form with validation and booking flow.
 *
 * Demonstrates:
 * - Nested states (oneWay, roundTrip)
 * - Guards for validation
 * - Invoke for async booking
 * - Final state
 *
 * Ported from xstate/examples/7guis-flight-booker-react
 * Based on: https://eugenkiss.github.io/7guis/tasks#flight
 */
import { setup, assign, fromPromise } from "../src/index.js"

/**
 * Get today's date as YYYY-MM-DD string.
 */
const getToday = (): string => {
  const d = new Date()
  return d.toISOString().split("T")[0]!
}

/**
 * Get tomorrow's date as YYYY-MM-DD string.
 */
const getTomorrow = (): string => {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().split("T")[0]!
}

export const TODAY = getToday()
export const TOMORROW = getTomorrow()

/**
 * Flight data context.
 */
export interface FlightData {
  departDate: string
  returnDate: string
}

/**
 * Events for the flight booker.
 */
export type FlightBookerEvent =
  | { type: "BOOK_DEPART" }
  | { type: "BOOK_RETURN" }
  | { type: "CHANGE_TRIP_TYPE" }
  | { type: "CHANGE_DEPART_DATE"; value: string }
  | { type: "CHANGE_RETURN_DATE"; value: string }

/**
 * Booker actor - simulates booking process.
 */
export const bookerActor = fromPromise<void, void>(async () => {
  await new Promise((resolve) => setTimeout(resolve, 500))
})

/**
 * 7GUIs Flight Booker machine.
 *
 * A flight booking form that:
 * - Supports one-way and round-trip flights
 * - Validates dates
 * - Simulates booking process
 */
export const flightBookerMachine = setup({
  types: {
    context: {} as FlightData,
    events: {} as FlightBookerEvent,
  },
  actions: {
    setDepartDate: assign(({ event }) => ({
      departDate: (event as { type: "CHANGE_DEPART_DATE"; value: string }).value,
    })),
    setReturnDate: assign(({ event }) => ({
      returnDate: (event as { type: "CHANGE_RETURN_DATE"; value: string }).value,
    })),
  },
  actors: {
    Booker: bookerActor,
  },
  guards: {
    "isValidDepartDate?": ({ context }) => context.departDate >= TODAY,
    "isValidReturnDate?": ({ context }) =>
      context.departDate >= TODAY && context.returnDate > context.departDate,
  },
}).createMachine({
  id: "flightBookerMachine",
  initial: "scheduling",
  context: {
    departDate: TODAY,
    returnDate: TOMORROW,
  },
  states: {
    scheduling: {
      initial: "oneWay",
      on: {
        CHANGE_DEPART_DATE: {
          actions: "setDepartDate",
        },
      },
      states: {
        oneWay: {
          on: {
            CHANGE_TRIP_TYPE: "roundTrip",
            BOOK_DEPART: {
              target: "#flightBookerMachine.booking",
              guard: "isValidDepartDate?",
            },
          },
        },
        roundTrip: {
          on: {
            CHANGE_TRIP_TYPE: "oneWay",
            CHANGE_RETURN_DATE: {
              actions: "setReturnDate",
            },
            BOOK_RETURN: {
              target: "#flightBookerMachine.booking",
              guard: "isValidReturnDate?",
            },
          },
        },
      },
    },
    booking: {
      invoke: {
        src: "Booker",
        onDone: "booked",
        onError: "scheduling",
      },
    },
    booked: {
      type: "final",
    },
  },
})
