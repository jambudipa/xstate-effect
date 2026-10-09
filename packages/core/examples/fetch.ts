/**
 * Fetch Example
 *
 * A data fetching state machine that demonstrates:
 * - Multiple states (idle, loading, success, failure)
 * - Context mutations with assign action
 * - Async actor with fromPromise
 * - Retry logic
 *
 * Ported from xstate/examples/fetch
 */
import { createMachine, setup, assign, fromPromise } from "../src/index.js"

/**
 * Data returned by the fetch operation.
 */
export interface FetchResult<T> {
  data: T
}

/**
 * Context type for the fetch machine.
 */
export interface FetchContext<T> {
  name: string
  data: T | null
  error: unknown | null
  retryCount: number
}

/**
 * Events that the fetch machine can receive.
 */
export type FetchEvent<T> =
  | { type: "FETCH" }
  | { type: "RETRY" }
  | { type: "RESET" }
  | { type: "SET_NAME"; name: string }
  | { type: "SUCCESS"; data: T }
  | { type: "ERROR"; error: unknown }

/**
 * Greeting result type.
 */
export interface Greeting {
  greeting: string
}

/**
 * Mock function to simulate fetching a greeting.
 */
export const getGreeting = async (name: string): Promise<Greeting> => {
  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 100))

  // Simulate occasional failures for testing retry logic
  if (Math.random() < 0.1) {
    throw new Error("Network error")
  }

  return { greeting: `Hello, ${name}!` }
}

/**
 * Creates a fetch actor for a specific API call.
 */
export const createFetchActor = <TInput, TOutput>(
  fetcher: (input: TInput) => Promise<TOutput>
) =>
  fromPromise<TOutput, TInput>(({ input }) => fetcher(input))

/**
 * Fetch user actor.
 */
export const fetchUserActor = createFetchActor<{ name: string }, Greeting>(
  ({ name }) => getGreeting(name)
)

/**
 * Fetch machine using setup API.
 *
 * This machine manages a fetch operation with the following states:
 * - idle: Waiting for FETCH event
 * - loading: Fetch is in progress
 * - success: Fetch completed successfully
 * - failure: Fetch failed, can retry
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { getInitialSnapshot, getNextSnapshot } from "@jambudipa/xstate-effect"
 * import { fetchMachine } from "./fetch.js"
 *
 * const program = Effect.gen(function* () {
 *   // Get initial snapshot
 *   const initial = yield* getInitialSnapshot(fetchMachine, undefined)
 *   console.log(initial.value) // "idle"
 *   console.log(initial.context.name) // "World"
 *
 *   // Start fetch
 *   const loading = yield* getNextSnapshot(fetchMachine, initial, { type: "FETCH" })
 *   console.log(loading.value) // "loading"
 *
 *   // Simulate successful fetch
 *   const success = yield* getNextSnapshot(fetchMachine, loading, {
 *     type: "SUCCESS",
 *     data: { greeting: "Hello, World!" }
 *   })
 *   console.log(success.value) // "success"
 *   console.log(success.context.data) // { greeting: "Hello, World!" }
 * })
 * ```
 */
export const fetchMachine = setup({
  types: {
    context: {} as FetchContext<Greeting>,
    events: {} as FetchEvent<Greeting>,
  },
  actors: {
    fetchUser: fetchUserActor,
  },
}).createMachine({
  id: "fetch",
  initial: "idle",
  context: {
    name: "World",
    data: null,
    error: null,
    retryCount: 0,
  },
  states: {
    idle: {
      on: {
        FETCH: "loading",
        SET_NAME: {
          actions: assign<FetchContext<Greeting>, { type: "SET_NAME"; name: string }>(
            ({ event }) => ({ name: event.name })
          ),
        },
      },
    },
    loading: {
      on: {
        SUCCESS: {
          target: "success",
          actions: assign<FetchContext<Greeting>, { type: "SUCCESS"; data: Greeting }>(
            ({ event }) => ({ data: event.data, error: null })
          ),
        },
        ERROR: {
          target: "failure",
          actions: assign<FetchContext<Greeting>, { type: "ERROR"; error: unknown }>(
            ({ event }) => ({ error: event.error, retryCount: 0 })
          ),
        },
      },
    },
    success: {
      on: {
        RESET: {
          target: "idle",
          actions: assign({ data: null, error: null }),
        },
        FETCH: "loading",
      },
    },
    failure: {
      on: {
        RETRY: {
          target: "loading",
          actions: assign<FetchContext<Greeting>, FetchEvent<Greeting>>(({ context }) => ({
            retryCount: context.retryCount + 1,
          })),
        },
        RESET: {
          target: "idle",
          actions: assign({ data: null, error: null, retryCount: 0 }),
        },
      },
    },
  },
})

/**
 * Simple fetch machine without setup API.
 *
 * A more basic version demonstrating the core fetch pattern.
 */
export const simpleFetchMachine = createMachine({
  types: {} as { context: FetchContext<Greeting>; events: FetchEvent<Greeting> },
  id: "simpleFetch",
  initial: "idle",
  context: {
    name: "World",
    data: null,
    error: null,
    retryCount: 0,
  },
  states: {
    idle: {
      on: {
        FETCH: "loading",
      },
    },
    loading: {
      on: {
        SUCCESS: {
          target: "success",
          actions: assign<FetchContext<Greeting>, { type: "SUCCESS"; data: Greeting }>(
            ({ event }) => ({ data: event.data, error: null })
          ),
        },
        ERROR: {
          target: "failure",
          actions: assign<FetchContext<Greeting>, { type: "ERROR"; error: unknown }>(
            ({ event }) => ({ error: event.error })
          ),
        },
      },
    },
    success: {
      on: {
        FETCH: "loading",
      },
    },
    failure: {
      on: {
        RETRY: "loading",
      },
    },
  },
})

/**
 * Generic fetch machine factory.
 *
 * Creates a fetch machine for any data type.
 */
export const createFetchMachine = <T>() =>
  createMachine({
    types: {} as { context: FetchContext<T>; events: FetchEvent<T> },
    id: "genericFetch",
    initial: "idle",
    context: {
      name: "",
      data: null,
      error: null,
      retryCount: 0,
    },
    states: {
      idle: {
        on: {
          FETCH: "loading",
        },
      },
      loading: {
        on: {
          SUCCESS: {
            target: "success",
          },
          ERROR: {
            target: "failure",
          },
        },
      },
      success: {
        type: "final",
      },
      failure: {
        on: {
          RETRY: "loading",
        },
      },
    },
  })
