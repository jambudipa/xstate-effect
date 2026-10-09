# How to Implement Retry Logic

This guide shows patterns for retrying failed operations in your state machines.

## Basic Retry with Counter

Track retry attempts in context:

```typescript
import { setup, createActor, fromPromise, assign, guard } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

const fetchWithRetry = setup({
  types: {} as {
    context: {
      data: any
      error: string | null
      retryCount: number
      maxRetries: number
    }
    events: { type: "FETCH" } | { type: "RETRY" }
  },
  guards: {
    canRetry: guard("canRetry", ({ context }) => context.retryCount < context.maxRetries)
  },
  actors: {
    fetchData: fromPromise(async () => {
      const response = await fetch("/api/data")
      if (!response.ok) throw new Error("Request failed")
      return response.json()
    })
  },
  actions: {
    incrementRetry: assign({
      retryCount: ({ context }) => context.retryCount + 1
    }),
    resetRetry: assign({ retryCount: 0 }),
    setError: assign({
      error: ({ event }) =>
        event.type === "xstate.error.actor.fetcher" ? event.error.message : null
    }),
    setData: assign({
      data: ({ event }) =>
        event.type === "xstate.done.actor.fetcher" ? event.output : null
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
      on: { FETCH: "fetching" }
    },
    fetching: {
      entry: "resetRetry",
      invoke: {
        id: "fetcher",
        src: "fetchData",
        onDone: {
          target: "success",
          actions: "setData"
        },
        onError: [
          {
            guard: "canRetry",
            target: "retrying",
            actions: ["setError", "incrementRetry"]
          },
          {
            target: "failure",
            actions: "setError"
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
      on: { FETCH: "fetching" }
    },
    failure: {
      on: { RETRY: "fetching" }
    }
  }
})
```

## Exponential Backoff

Increase delay between retries:

```typescript
const exponentialBackoffMachine = setup({
  types: {} as {
    context: {
      retryCount: number
      maxRetries: number
      baseDelay: number
    }
    events: { type: "FETCH" }
  },
  guards: {
    canRetry: guard("canRetry", ({ context }) => context.retryCount < context.maxRetries)
  },
  actors: {
    fetchData: fromPromise(async () => { /* ... */ })
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
}, {
  delays: {
    RETRY_DELAY: ({ context }) =>
      context.baseDelay * Math.pow(2, context.retryCount)
  }
})
```

## Retry with Effect's Built-in Retry

Use Effect's retry capabilities inside fromEffect:

```typescript
import { setup, fromEffect, assign } from "@jambudipa/xstate-effect"
import { Effect, Schedule } from "effect"

const fetchWithEffectRetry = fromEffect(() =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise(() => fetch("/api/data"))
    if (!response.ok) {
      yield* Effect.fail(new Error("Request failed"))
    }
    return yield* Effect.tryPromise(() => response.json())
  }).pipe(
    // Retry up to 3 times with exponential backoff
    Effect.retry(
      Schedule.exponential("1 second").pipe(
        Schedule.compose(Schedule.recurs(3))
      )
    )
  )
)

const machine = setup({
  types: {} as {
    context: { data: any }
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
          actions: assign({ data: ({ event }) => event.output })
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
delays: {
  RETRY_DELAY: ({ context }) => {
    const baseDelay = context.baseDelay * Math.pow(2, context.retryCount)
    const jitter = Math.random() * 0.3 * baseDelay // Up to 30% jitter
    return baseDelay + jitter
  }
}
```

## Manual Retry Trigger

Let users decide when to retry:

```typescript
const manualRetryMachine = setup({
  types: {} as {
    context: { error: string | null }
    events: { type: "FETCH" } | { type: "RETRY" }
  },
  actors: {
    fetchData: fromPromise(async () => { /* ... */ })
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
          actions: assign({ error: ({ event }) => event.error.message })
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

Only retry certain errors:

```typescript
const conditionalRetryMachine = setup({
  types: {} as {
    context: { retryCount: number }
    events: { type: "FETCH" }
  },
  guards: {
    isRetryableError: guard("isRetryableError", ({ event }) => {
      if (event.type !== "xstate.error.actor.fetcher") return false
      const error = event.error

      // Only retry network errors, not validation errors
      return error.name === "NetworkError" ||
             error.message.includes("timeout") ||
             error.message.includes("ECONNREFUSED")
    }),
    canRetry: guard("canRetry", ({ context }) => context.retryCount < 3)
  },
  actors: {
    fetchData: fromPromise(async () => { /* ... */ })
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
            guard: and(["isRetryableError", "canRetry"]),
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
import { setup, createActor, fromPromise, assign, guard, and } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

interface FetchContext {
  url: string
  data: any
  error: { message: string; code?: string } | null
  retryCount: number
  maxRetries: number
  lastAttempt: number | null
}

const robustFetchMachine = setup({
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
    canRetry: guard("canRetry", ({ context }) =>
      context.retryCount < context.maxRetries
    ),
    hasUrl: guard("hasUrl", ({ context }) => context.url.length > 0)
  },
  actors: {
    fetchData: fromPromise(async ({ input }: { input: { url: string } }) => {
      const response = await fetch(input.url)
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`)
        ;(error as any).code = `HTTP_${response.status}`
        throw error
      }
      return response.json()
    })
  },
  actions: {
    setUrl: assign({
      url: ({ event }) => event.type === "FETCH" ? event.url : ""
    }),
    setData: assign({
      data: ({ event }) =>
        event.type === "xstate.done.actor.fetcher" ? event.output : null,
      error: null
    }),
    setError: assign({
      error: ({ event }) => {
        if (event.type === "xstate.error.actor.fetcher") {
          return {
            message: event.error.message,
            code: (event.error as any).code
          }
        }
        return null
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
          actions: "setData"
        },
        onError: [
          {
            guard: "canRetry",
            target: "retrying",
            actions: ["setError", "incrementRetry"]
          },
          {
            target: "failure",
            actions: "setError"
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
}, {
  delays: {
    BACKOFF: ({ context }) => {
      const base = 1000
      const delay = base * Math.pow(2, context.retryCount - 1)
      const jitter = Math.random() * 0.3 * delay
      return Math.min(delay + jitter, 30000) // Cap at 30 seconds
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
