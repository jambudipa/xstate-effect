/**
 * MongoDB Credit Check Example
 *
 * A complex credit checking workflow with parallel bureau checks.
 *
 * Demonstrates:
 * - Parallel states for concurrent API calls
 * - Complex nested state hierarchy
 * - Multiple actors with various inputs
 * - Guards for conditional transitions
 * - Named actions with parameters
 * - onDone with guard conditions
 *
 * Ported from xstate/examples/mongodb-credit-check-api
 */
import { Option } from "effect"
import { setup, assign, fromPromise } from "../src/index.js"

/**
 * Credit profile context.
 */
export interface CreditProfile {
  SSN: string
  FirstName: string
  LastName: string
  GavUnionScore: number
  EquiGavinScore: number
  GavperianScore: number
  ErrorMessage: string
  MiddleScore: number
  InterestRateOptions: number[]
}

/**
 * User credentials for verification.
 */
export interface UserCredential {
  SSN: string
  firstName: string
  lastName: string
}

/**
 * Events for the credit check machine.
 */
export type CreditCheckEvent = {
  type: "Submit"
  SSN: string
  lastName: string
  firstName: string
}

/**
 * Mock service functions.
 */
async function checkBureauService(input: {
  ssn: string
  bureauName: string
}): Promise<number> {
  await new Promise((resolve) => setTimeout(resolve, 50))
  // Return mock credit score
  return 650 + Math.floor(Math.random() * 150)
}

async function checkReportsTable(input: {
  ssn: string
  bureauName: string
}): Promise<{ creditScore: number } | null> {
  await new Promise((resolve) => setTimeout(resolve, 30))
  // Simulate cache miss 50% of the time
  if (Math.random() > 0.5) {
    return { creditScore: 700 + Math.floor(Math.random() * 100) }
  }
  return null
}

async function verifyCredentials(
  input: UserCredential
): Promise<UserCredential> {
  await new Promise((resolve) => setTimeout(resolve, 30))
  return input
}

async function determineMiddleScore(scores: number[]): Promise<number> {
  await new Promise((resolve) => setTimeout(resolve, 20))
  const sorted = [...scores].sort((a, b) => a - b)
  return sorted[1] || sorted[0] || 0
}

async function generateInterestRate(score: number): Promise<number> {
  await new Promise((resolve) => setTimeout(resolve, 20))
  // Higher score = lower rate
  return 3.5 + (850 - score) / 100
}

/**
 * Actors for the credit check workflow.
 */
export const checkBureauActor = fromPromise<
  number,
  { ssn: string; bureauName: string }
>(async ({ input }) => checkBureauService(input))

export const checkReportsTableActor = fromPromise<
  { creditScore: number } | null,
  { ssn: string; bureauName: string }
>(async ({ input }) => checkReportsTable(input))

export const verifyCredentialsActor = fromPromise<
  UserCredential,
  UserCredential
>(async ({ input }) => verifyCredentials(input))

export const determineMiddleScoreActor = fromPromise<number, number[]>(
  async ({ input }) => determineMiddleScore(input)
)

export const generateInterestRatesActor = fromPromise<number, number>(
  async ({ input }) => generateInterestRate(input)
)

/**
 * Credit Check machine.
 *
 * A workflow that:
 * 1. Verifies user credentials
 * 2. Checks three credit bureaus in parallel
 * 3. Determines the middle score
 * 4. Generates interest rate options
 */
export const creditCheckMachine = setup({
  types: {
    context: {} as CreditProfile,
    events: {} as CreditCheckEvent,
  },
  actors: {
    checkBureau: checkBureauActor,
    checkReportsTable: checkReportsTableActor,
    verifyCredentials: verifyCredentialsActor,
    determineMiddleScore: determineMiddleScoreActor,
    generateInterestRates: generateInterestRatesActor,
  },
  actions: {
    saveReport: ({ context }, params: { bureauName: string }) => {
      console.log("Saving report to database...", params.bureauName)
    },
    emailUser: ({ context }) => {
      console.log(
        "Emailing user with interest rate options:",
        context.InterestRateOptions
      )
    },
    saveCreditProfile: ({ context }) => {
      console.log("Saving credit profile...")
    },
    emailSalesTeam: ({ context }) => {
      console.log(
        "Emailing sales team:",
        context.FirstName,
        context.LastName,
        context.MiddleScore
      )
    },
  },
  guards: {
    allSucceeded: ({ context }) =>
      context.EquiGavinScore > 0 &&
      context.GavUnionScore > 0 &&
      context.GavperianScore > 0,
    gavUnionReportFound: ({ context }) => context.GavUnionScore > 0,
    equiGavinReportFound: ({ context }) => context.EquiGavinScore > 0,
    gavperianReportFound: ({ context }) => context.GavperianScore > 0,
  },
}).createMachine({
  id: "multipleCreditCheck",
  initial: "creditCheck",
  context: {
    SSN: "",
    FirstName: "",
    LastName: "",
    GavUnionScore: 0,
    EquiGavinScore: 0,
    GavperianScore: 0,
    ErrorMessage: "",
    MiddleScore: 0,
    InterestRateOptions: [],
  },
  states: {
    creditCheck: {
      initial: "Entering Information",
      states: {
        "Entering Information": {
          on: {
            Submit: "Verifying Credentials",
          },
        },
        "Verifying Credentials": {
          invoke: {
            src: "verifyCredentials",
            input: ({ event }) => ({
              SSN: (event as CreditCheckEvent).SSN,
              firstName: (event as CreditCheckEvent).firstName,
              lastName: (event as CreditCheckEvent).lastName,
            }),
            onDone: {
              target: "CheckingCreditScores",
              // A done event's output is an Option (D8)
              actions: assign(({ event }) =>
                Option.match(event.output, {
                  onNone: () => ({}),
                  onSome: (output) => ({
                    SSN: output.SSN,
                    FirstName: output.firstName,
                    LastName: output.lastName,
                  }),
                })
              ),
            },
            onError: {
              target: "Entering Information",
              actions: assign(({ event }) => ({
                ErrorMessage:
                  "Failed to verify credentials. Details: " +
                  (event as { error: unknown }).error,
              })),
            },
          },
        },
        CheckingCreditScores: {
          type: "parallel",
          states: {
            CheckingEquiGavin: {
              initial: "CheckingForExistingReport",
              states: {
                CheckingForExistingReport: {
                  invoke: {
                    src: "checkReportsTable",
                    input: ({ context }) => ({
                      bureauName: "EquiGavin",
                      ssn: context.SSN,
                    }),
                    onDone: [
                      {
                        guard: "equiGavinReportFound",
                        target: "FetchingComplete",
                        actions: assign(({ event }) => ({
                          // A done event's output is an Option (D8)
                          EquiGavinScore: Option.match(event.output, {
                            onNone: () => 0,
                            onSome: (report) => report?.creditScore ?? 0,
                          }),
                        })),
                      },
                      { target: "FetchingReport" },
                    ],
                    onError: "FetchingFailed",
                  },
                },
                FetchingReport: {
                  invoke: {
                    src: "checkBureau",
                    input: ({ context }) => ({
                      bureauName: "EquiGavin",
                      ssn: context.SSN,
                    }),
                    onDone: {
                      target: "FetchingComplete",
                      actions: assign(({ event }) => ({
                        // A done event's output is an Option (D8)
                        EquiGavinScore: Option.getOrElse(event.output, () => 0),
                      })),
                    },
                    onError: "FetchingFailed",
                  },
                },
                FetchingComplete: {
                  type: "final",
                },
                FetchingFailed: {
                  type: "final",
                },
              },
            },
            CheckingGavUnion: {
              initial: "CheckingForExistingReport",
              states: {
                CheckingForExistingReport: {
                  invoke: {
                    src: "checkReportsTable",
                    input: ({ context }) => ({
                      bureauName: "GavUnion",
                      ssn: context.SSN,
                    }),
                    onDone: [
                      {
                        guard: "gavUnionReportFound",
                        target: "FetchingComplete",
                        actions: assign(({ event }) => ({
                          // A done event's output is an Option (D8)
                          GavUnionScore: Option.match(event.output, {
                            onNone: () => 0,
                            onSome: (report) => report?.creditScore ?? 0,
                          }),
                        })),
                      },
                      { target: "FetchingReport" },
                    ],
                    onError: "FetchingFailed",
                  },
                },
                FetchingReport: {
                  invoke: {
                    src: "checkBureau",
                    input: ({ context }) => ({
                      bureauName: "GavUnion",
                      ssn: context.SSN,
                    }),
                    onDone: {
                      target: "FetchingComplete",
                      actions: assign(({ event }) => ({
                        // A done event's output is an Option (D8)
                        GavUnionScore: Option.getOrElse(event.output, () => 0),
                      })),
                    },
                    onError: "FetchingFailed",
                  },
                },
                FetchingComplete: {
                  type: "final",
                },
                FetchingFailed: {
                  type: "final",
                },
              },
            },
            CheckingGavperian: {
              initial: "CheckingForExistingReport",
              states: {
                CheckingForExistingReport: {
                  invoke: {
                    src: "checkReportsTable",
                    input: ({ context }) => ({
                      bureauName: "Gavperian",
                      ssn: context.SSN,
                    }),
                    onDone: [
                      {
                        guard: "gavperianReportFound",
                        target: "FetchingComplete",
                        actions: assign(({ event }) => ({
                          // A done event's output is an Option (D8)
                          GavperianScore: Option.match(event.output, {
                            onNone: () => 0,
                            onSome: (report) => report?.creditScore ?? 0,
                          }),
                        })),
                      },
                      { target: "FetchingReport" },
                    ],
                    onError: "FetchingFailed",
                  },
                },
                FetchingReport: {
                  invoke: {
                    src: "checkBureau",
                    input: ({ context }) => ({
                      bureauName: "Gavperian",
                      ssn: context.SSN,
                    }),
                    onDone: {
                      target: "FetchingComplete",
                      actions: assign(({ event }) => ({
                        // A done event's output is an Option (D8)
                        GavperianScore: Option.getOrElse(event.output, () => 0),
                      })),
                    },
                    onError: "FetchingFailed",
                  },
                },
                FetchingComplete: {
                  type: "final",
                },
                FetchingFailed: {
                  type: "final",
                },
              },
            },
          },
          onDone: [
            {
              guard: "allSucceeded",
              target: "DeterminingInterestRateOptions",
            },
            {
              target: "Entering Information",
              actions: assign({
                ErrorMessage: "Failed to retrieve credit scores.",
              }),
            },
          ],
        },
        DeterminingInterestRateOptions: {
          initial: "DeterminingMiddleScore",
          states: {
            DeterminingMiddleScore: {
              invoke: {
                src: "determineMiddleScore",
                input: ({ context }) => [
                  context.EquiGavinScore,
                  context.GavUnionScore,
                  context.GavperianScore,
                ],
                onDone: {
                  target: "FetchingRates",
                  actions: [
                    assign(({ context, event }) => ({
                      // A done event's output is an Option (D8)
                      MiddleScore: Option.getOrElse(event.output, () => context.MiddleScore),
                    })),
                    "saveCreditProfile",
                  ],
                },
              },
            },
            FetchingRates: {
              invoke: {
                src: "generateInterestRates",
                input: ({ context }) => context.MiddleScore,
                onDone: {
                  target: "RatesProvided",
                  actions: assign(({ context, event }) => ({
                    // A done event's output is an Option (D8)
                    InterestRateOptions: Option.match(event.output, {
                      onNone: () => context.InterestRateOptions,
                      onSome: (rate) => [rate],
                    }),
                  })),
                },
              },
            },
            RatesProvided: {
              type: "final",
              entry: ["emailUser", "emailSalesTeam"],
            },
          },
        },
      },
    },
  },
})
