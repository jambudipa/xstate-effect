# How to Implement Retry Logic

This guide shows patterns for retrying failed operations in your state machines.

## Basic Retry with Counter

Track retry attempts in context:

```typescript
import { setup, fromPromise, assign } from "@jambudipa/xstate-effect"
import { Option } from "effect"

export const fetchWithRetry = setup({
  types: {} as {
    context: {
      data: unknown
      error: string | null
      retryCount: number
      maxRetries: number
    }
    events: { type: "FETCH" } | { type: "RETRY" }
  },
  guards: {
    canRetry: ({ context }) => context.retryCount < context.maxRetries
  },
  actors: {
    fetchData: fromPromise(async () => {
      const response = await fetch("/api/data")
      if (!response.ok) throw new Error("Request failed")
      const data: unknown = await response.json()
      return data
    })
  },
  actions: {
    incrementRetry: assign({
      retryCount: ({ context }) => context.retryCount + 1
    }),
    resetRetry: assign({ retryCount: 0 }),
    setError: assign({
      error: (_, params: { error: unknown }) =>
        params.error instanceof Error ? params.error.message : String(params.error)
    }),
    setData: assign({
      data: (_, params: { data: unknown }) => params.data
    })
  }
}).createMachine({
  id: "fetchWithRetry",
  initial: "idle",
  context: {
    data: null,
    error: null,
    retryCount: 0,
    maxRetries: 3
  },
  states: {
    idle: {
      on: { FETCH: { target: "fetching", actions: "resetRetry" } }
    },
    fetching: {
      invoke: {
        id: "fetcher",
        src: "fetchData",
        onDone: {
          target: "success",
          actions: { type: "setData", params: ({ event }) => ({ data: Option.getOrNull(event.output) }) }
        },
        onError: [
          {
            guard: "canRetry",
            target: "retrying",
            actions: [{ type: "setError", params: ({ event }) => ({ error: event.error }) }, "incrementRetry"]
          },
          {
            target: "failure",
            actions: { type: "setError", params: ({ event }) => ({ error: event.error }) }
          }
        ]
      }
    },
    retrying: {
      after: {
        1000: "fetching" // Wait 1 second before retry
      }
    },
    success: {
      on: { FETCH: { target: "fetching", actions: "resetRetry" } }
    },
    failure: {
      on: { RETRY: { target: "fetching", actions: "resetRetry" } }
    }
  }
})
```

The named actions of a `setup` see only the machine's own events, so the done and error
events of the invocation pass their data to `setData` and `setError` as params. The `output`
of a done event is an `Option`. The `FETCH` and `RETRY` transitions reset the counter: a reset
on entry to `fetching` would also run on each automatic retry, and the count would never reach
the limit.

## Exponential Backoff

Increase delay between retries. Named delays belong to `setup`, beside the guards and actors:

```typescript
import { setup, fromPromise, assign } from "@jambudipa/xstate-effect"

export const exponentialBackoffMachine = setup({
  types: {} as {
    context: {
      retryCount: number
      maxRetries: number
      baseDelay: number
    }
    events: { type: "FETCH" }
  },
  guards: {
    canRetry: ({ context }) => context.retryCount < context.maxRetries
  },
  actors: {
    fetchData: fromPromise(async () => {
      const response = await fetch("/api/data")
      if (!response.ok) throw new Error("Request failed")
      const data: unknown = await response.json()
      return data
    })
  },
  delays: {
    // The entry action of "waiting" counts the retry before the delay is computed
    RETRY_DELAY: ({ context }) =>
      context.baseDelay * Math.pow(2, context.retryCount - 1)
  }
}).createMachine({
  id: "exponentialBackoff",
  initial: "idle",
  context: {
    retryCount: 0,
    maxRetries: 5,
    baseDelay: 1000 // 1 second base
  },
  states: {
    idle: {
      on: { FETCH: "fetching" }
    },
    fetching: {
      invoke: {
        src: "fetchData",
        onDone: "success",
        onError: [
          { guard: "canRetry", target: "waiting" },
          { target: "failure" }
        ]
      }
    },
    waiting: {
      entry: assign({ retryCount: ({ context }) => context.retryCount + 1 }),
      after: {
        // Exponential delay: 1s, 2s, 4s, 8s, 16s
        RETRY_DELAY: "fetching"
      }
    },
    success: {},
    failure: {}
  }
})
```

## Retry with Effect's Built-in Retry

Use Effect's retry capabilities inside fromEffect:

```typescript
import { setup, fromEffect, assign } from "@jambudipa/xstate-effect"
import { Effect, Option, Schedule } from "effect"

const fetchWithEffectRetry = fromEffect(() =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise(() => fetch("/api/data"))
    if (!response.ok) {
      return yield* Effect.fail(new Error("Request failed"))
    }
    return yield* Effect.tryPromise((): Promise<unknown> => response.json())
  }).pipe(
    // Retry up to 3 times with exponential backoff
    Effect.retry({ schedule: Schedule.exponential("1 second"), times: 3 })
  )
)

export const machine = setup({
  types: {} as {
    context: { data: unknown }
    events: { type: "FETCH" }
  },
  actors: {
    fetch: fetchWithEffectRetry
  }
}).createMachine({
  id: "effectRetry",
  initial: "idle",
  context: { data: null },
  states: {
    idle: {
      on: { FETCH: "fetching" }
    },
    fetching: {
      invoke: {
        src: "fetch",
        onDone: {
          target: "success",
          actions: assign({ data: ({ event }) => Option.getOrNull(event.output) })
        },
        onError: "failure"
      }
    },
    success: {},
    failure: {}
  }
})
```

## Retry with Jitter

Add randomness to prevent thundering herd:

```typescript
import { setup } from "@jambudipa/xstate-effect"

export const jitterSetup = setup({
  types: {} as {
    context: { retryCount: number; baseDelay: number }
  },
  delays: {
    RETRY_DELAY: ({ context }) => {
      const baseDelay = context.baseDelay * Math.pow(2, context.retryCount)
      const jitter = Math.random() * 0.3 * baseDelay // Up to 30% jitter
      return baseDelay + jitter
    }
  }
})
```

## Manual Retry Trigger

Let users decide when to retry:

```typescript
import { setup, fromPromise, assign } from "@jambudipa/xstate-effect"

export const manualRetryMachine = setup({
  types: {} as {
    context: { error: string | null }
    events: { type: "FETCH" } | { type: "RETRY" }
  },
  actors: {
    fetchData: fromPromise(async () => {
      const response = await fetch("/api/data")
      if (!response.ok) throw new Error("Request failed")
      const data: unknown = await response.json()
      return data
    })
  }
}).createMachine({
  id: "manualRetry",
  initial: "idle",
  context: { error: null },
  states: {
    idle: {
      on: { FETCH: "fetching" }
    },
    fetching: {
      invoke: {
        src: "fetchData",
        onDone: "success",
        onError: {
          target: "failure",
          actions: assign({
            error: ({ event }) => event.error instanceof Error ? event.error.message : String(event.error)
          })
        }
      }
    },
    success: {},
    failure: {
      on: {
        RETRY: {
          target: "fetching",
          actions: assign({ error: null })
        }
      }
    }
  }
})
```

## Conditional Retry Based on Error Type

Only retry certain errors. A named guard sees only the machine's own events, so the error
event passes its error to `isRetryableError` as params:

```typescript
import { setup, fromPromise, assign, and } from "@jambudipa/xstate-effect"

const isRetryable = (error: unknown): boolean =>
  error instanceof Error &&
  // Only retry network errors, not validation errors
  (error.name === "NetworkError" ||
    error.message.includes("timeout") ||
    error.message.includes("ECONNREFUSED"))

export const conditionalRetryMachine = setup({
  types: {} as {
    context: { retryCount: number }
    events: { type: "FETCH" }
  },
  guards: {
    isRetryableError: (_, params: { error: unknown }) => isRetryable(params.error),
    canRetry: ({ context }) => context.retryCount < 3
  },
  actors: {
    fetchData: fromPromise(async () => {
      const response = await fetch("/api/data")
      if (!response.ok) throw new Error("Request failed")
      const data: unknown = await response.json()
      return data
    })
  }
}).createMachine({
  id: "conditionalRetry",
  initial: "idle",
  context: { retryCount: 0 },
  states: {
    idle: {
      on: { FETCH: "fetching" }
    },
    fetching: {
      invoke: {
        id: "fetcher",
        src: "fetchData",
        onDone: "success",
        onError: [
          {
            guard: and([
              { type: "isRetryableError", params: ({ event }) => ({ error: event.error }) },
              "canRetry"
            ]),
            target: "retrying",
            actions: assign({ retryCount: ({ context }) => context.retryCount + 1 })
          },
          { target: "failure" }
        ]
      }
    },
    retrying: {
      after: { 1000: "fetching" }
    },
    success: {},
    failure: {}
  }
})
```

## Complete Pattern: Robust Fetch with Retry

```typescript
import { setup, fromPromise, assign } from "@jambudipa/xstate-effect"
import { Option } from "effect"

class HttpError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = "HttpError"
  }
}

interface FetchContext {
  url: string
  data: unknown
  error: { message: string; code?: string } | null
  retryCount: number
  maxRetries: number
  lastAttempt: number | null
}

export const robustFetchMachine = setup({
  types: {} as {
    context: FetchContext
    events:
      | { type: "FETCH"; url: string }
      | { type: "RETRY" }
      | { type: "CANCEL" }
      | { type: "RESET" }
    input: { maxRetries?: number }
  },
  guards: {
    canRetry: ({ context }) =>
      context.retryCount < context.maxRetries,
    hasUrl: ({ event }) => event.type === "FETCH" && event.url.length > 0
  },
  actors: {
    fetchData: fromPromise(async ({ input }: { input: { url: string } }) => {
      const response = await fetch(input.url)
      if (!response.ok) {
        throw new HttpError(`HTTP_${response.status}`, `HTTP ${response.status}`)
      }
      const data: unknown = await response.json()
      return data
    })
  },
  actions: {
    setUrl: assign({
      url: ({ event }) => event.type === "FETCH" ? event.url : ""
    }),
    setData: assign({
      data: (_, params: { data: unknown }) => params.data,
      error: null
    }),
    setError: assign({
      error: (_, params: { error: unknown }) => {
        if (params.error instanceof HttpError) {
          return { message: params.error.message, code: params.error.code }
        }
        return { message: params.error instanceof Error ? params.error.message : String(params.error) }
      },
      lastAttempt: () => Date.now()
    }),
    incrementRetry: assign({
      retryCount: ({ context }) => context.retryCount + 1
    }),
    resetState: assign({
      data: null,
      error: null,
      retryCount: 0,
      lastAttempt: null
    })
  },
  delays: {
    BACKOFF: ({ context }) => {
      const base = 1000
      const delay = base * Math.pow(2, context.retryCount - 1)
      const jitter = Math.random() * 0.3 * delay
      return Math.min(delay + jitter, 30000) // Cap at 30 seconds
    }
  }
}).createMachine({
  id: "robustFetch",
  initial: "idle",
  context: ({ input }) => ({
    url: "",
    data: null,
    error: null,
    retryCount: 0,
    maxRetries: input?.maxRetries ?? 3,
    lastAttempt: null
  }),
  states: {
    idle: {
      on: {
        FETCH: {
          guard: "hasUrl",
          target: "fetching",
          actions: ["resetState", "setUrl"]
        }
      }
    },
    fetching: {
      invoke: {
        id: "fetcher",
        src: "fetchData",
        input: ({ context }) => ({ url: context.url }),
        onDone: {
          target: "success",
          actions: { type: "setData", params: ({ event }) => ({ data: Option.getOrNull(event.output) }) }
        },
        onError: [
          {
            guard: "canRetry",
            target: "retrying",
            actions: [{ type: "setError", params: ({ event }) => ({ error: event.error }) }, "incrementRetry"]
          },
          {
            target: "failure",
            actions: { type: "setError", params: ({ event }) => ({ error: event.error }) }
          }
        ]
      },
      on: {
        CANCEL: "idle"
      }
    },
    retrying: {
      after: {
        BACKOFF: "fetching"
      },
      on: {
        CANCEL: "idle"
      }
    },
    success: {
      on: {
        FETCH: {
          target: "fetching",
          actions: ["resetState", "setUrl"]
        },
        RESET: {
          target: "idle",
          actions: "resetState"
        }
      }
    },
    failure: {
      on: {
        RETRY: "fetching",
        FETCH: {
          target: "fetching",
          actions: ["resetState", "setUrl"]
        },
        RESET: {
          target: "idle",
          actions: "resetState"
        }
      }
    }
  }
})
```

## Tips

1. **Set reasonable limits** - Don't retry indefinitely
2. **Use exponential backoff** - Prevents overwhelming failing services
3. **Add jitter** - Prevents synchronized retries from multiple clients
4. **Log retry attempts** - Helpful for debugging
5. **Consider error types** - Not all errors are worth retrying
6. **Allow cancellation** - Users should be able to stop retries
