# How to Invoke Async Operations

This guide shows how to call APIs, perform async work, and handle results in your state machines.

## Using fromPromise

The simplest way to invoke async operations:

```typescript
import { setup, fromPromise, assign } from "@jambudipa/xstate-effect"
import { Option } from "effect"

const fetchUserActor = fromPromise(async ({ input }: { input: { userId: string } }) => {
  const response = await fetch(`/api/users/${input.userId}`)
  if (!response.ok) throw new Error("Failed to fetch user")
  const user: unknown = await response.json()
  return user
})

const _userMachine = setup({
  types: {} as {
    context: { userId: string; user: unknown; error: string | null }
    events: { type: "FETCH" }
  },
  actors: {
    fetchUser: fetchUserActor
  }
}).createMachine({
  id: "user",
  initial: "idle",
  context: { userId: "123", user: null, error: null },
  states: {
    idle: {
      on: { FETCH: "loading" }
    },
    loading: {
      invoke: {
        src: "fetchUser",
        input: ({ context }) => ({ userId: context.userId }),
        onDone: {
          target: "success",
          actions: assign({ user: ({ event }) => Option.getOrNull(event.output) })
        },
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
      on: { FETCH: "loading" }
    }
  }
})
```

The `output` of a done event is an `Option` (`Option.none()` where XState gives `undefined`),
so the assigner unwraps it. The `error` of an error event is the raw value the actor failed
with, so the assigner checks its type before it reads a message.

## Using fromEffect

For Effect-based async operations:

```typescript
import { setup, fromEffect, assign } from "@jambudipa/xstate-effect"
import { Effect, Console, Option } from "effect"

const processDataActor = fromEffect(({ input }: { input: { items: string[] } }) =>
  Effect.gen(function* () {
    yield* Console.log(`Processing ${input.items.length} items`)

    // Simulate async work
    yield* Effect.sleep("1 second")

    // Return processed result
    return input.items.map(item => item.toUpperCase())
  })
)

const _processorMachine = setup({
  types: {} as {
    context: { items: string[]; results: string[] }
    events: { type: "PROCESS" }
  },
  actors: {
    processData: processDataActor
  }
}).createMachine({
  id: "processor",
  initial: "idle",
  context: { items: ["a", "b", "c"], results: [] },
  states: {
    idle: {
      on: { PROCESS: "processing" }
    },
    processing: {
      invoke: {
        src: "processData",
        input: ({ context }) => ({ items: context.items }),
        onDone: {
          target: "done",
          actions: assign({ results: ({ event }) => Option.getOrElse(event.output, () => []) })
        },
        onError: "error"
      }
    },
    done: { type: "final" },
    error: {}
  }
})
```

## Multiple Concurrent Invocations

Invoke multiple services in parallel:

```typescript
import { setup, fromPromise, assign } from "@jambudipa/xstate-effect"
import { Option } from "effect"

const fetchOne = async (url: string): Promise<unknown> => {
  const response = await fetch(url)
  const body: unknown = await response.json()
  return body
}

const fetchMany = async (url: string): Promise<unknown[]> => {
  const response = await fetch(url)
  const body: unknown[] = await response.json()
  return body
}

const _dashboardMachine = setup({
  types: {} as {
    context: {
      user: unknown
      posts: unknown[]
      notifications: unknown[]
    }
    events: { type: "LOAD" }
  },
  actors: {
    fetchUser: fromPromise(() => fetchOne("/api/user")),
    fetchPosts: fromPromise(() => fetchMany("/api/posts")),
    fetchNotifications: fromPromise(() => fetchMany("/api/notifications"))
  }
}).createMachine({
  id: "dashboard",
  initial: "idle",
  context: { user: null, posts: [], notifications: [] },
  states: {
    idle: {
      on: { LOAD: "loading" }
    },
    loading: {
      type: "parallel",
      states: {
        user: {
          initial: "fetching",
          states: {
            fetching: {
              invoke: {
                src: "fetchUser",
                onDone: {
                  target: "done",
                  actions: assign({ user: ({ event }) => Option.getOrNull(event.output) })
                },
                onError: "error"
              }
            },
            done: { type: "final" },
            error: { type: "final" }
          }
        },
        posts: {
          initial: "fetching",
          states: {
            fetching: {
              invoke: {
                src: "fetchPosts",
                onDone: {
                  target: "done",
                  actions: assign({ posts: ({ event }) => Option.getOrElse(event.output, () => []) })
                },
                onError: "error"
              }
            },
            done: { type: "final" },
            error: { type: "final" }
          }
        },
        notifications: {
          initial: "fetching",
          states: {
            fetching: {
              invoke: {
                src: "fetchNotifications",
                onDone: {
                  target: "done",
                  actions: assign({ notifications: ({ event }) => Option.getOrElse(event.output, () => []) })
                },
                onError: "error"
              }
            },
            done: { type: "final" },
            error: { type: "final" }
          }
        }
      },
      onDone: "ready"
    },
    ready: {}
  }
})
```

## Passing Dynamic Input

```typescript
import { setup, fromPromise } from "@jambudipa/xstate-effect"

export const searchMachine = setup({
  types: {} as {
    context: { userId: string }
    events: { type: "SEARCH"; query: string }
  },
  actors: {
    fetchData: fromPromise(async ({ input }: { input: { userId: string; query: string; timestamp: number } }) => {
      const response = await fetch(`/api/users/${input.userId}/search?q=${input.query}&t=${input.timestamp}`)
      const results: unknown = await response.json()
      return results
    })
  }
}).createMachine({
  id: "search",
  initial: "idle",
  context: { userId: "123" },
  states: {
    idle: {
      on: { SEARCH: "searching" }
    },
    searching: {
      invoke: {
        src: "fetchData",
        input: ({ context, event }) => ({
          // From context
          userId: context.userId,
          // From event (if available)
          query: event.type === "SEARCH" ? event.query : "",
          // Computed values
          timestamp: Date.now()
        }),
        onDone: "idle"
      }
    }
  }
})
```

## Handling Different Error Types

```typescript
import { setup, fromEffect, assign } from "@jambudipa/xstate-effect"
import { Effect, Schema } from "effect"

class NetworkError extends Schema.TaggedError<NetworkError>()("NetworkError", {
  message: Schema.String
}) {}
class ValidationError extends Schema.TaggedError<ValidationError>()("ValidationError", {
  field: Schema.String
}) {}

const submitActor = fromEffect(({ input }: { input: { data: Record<string, unknown> } }) =>
  Effect.gen(function* () {
    // Validate
    if (!input.data.email) {
      return yield* new ValidationError({ field: "email" })
    }

    // Submit
    const response = yield* Effect.tryPromise({
      try: () => fetch("/api/submit", { method: "POST", body: JSON.stringify(input.data) }),
      catch: () => new NetworkError({ message: "Network request failed" })
    })

    return yield* Effect.tryPromise({
      try: (): Promise<unknown> => response.json(),
      catch: () => new NetworkError({ message: "The response was not JSON" })
    })
  })
)

const _formMachine = setup({
  types: {} as {
    context: { data: Record<string, unknown>; error: { type: string; message: string } | null }
    events: { type: "SUBMIT" }
  },
  actors: { submit: submitActor }
}).createMachine({
  id: "form",
  initial: "editing",
  context: { data: {}, error: null },
  states: {
    editing: {
      on: { SUBMIT: "submitting" }
    },
    submitting: {
      invoke: {
        src: "submit",
        input: ({ context }) => ({ data: context.data }),
        onDone: "success",
        onError: {
          target: "editing",
          actions: assign({
            error: ({ event }) => {
              const err = event.error
              if (err instanceof NetworkError) {
                return { type: "network", message: err.message }
              }
              if (err instanceof ValidationError) {
                return { type: "validation", message: `Invalid ${err.field}` }
              }
              return { type: "unknown", message: "An error occurred" }
            }
          })
        }
      }
    },
    success: { type: "final" }
  }
})
```

## Cancellation

Invoked actors are automatically cancelled when leaving the state:

```typescript
import { setup, fromEffect } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

export const cancellableMachine = setup({
  types: {} as {
    events: { type: "START" } | { type: "CANCEL" }
  },
  actors: {
    slowOperation: fromEffect(() => Effect.sleep("10 seconds"))
  }
}).createMachine({
  id: "cancellable",
  initial: "idle",
  states: {
    idle: {
      on: { START: "loading" }
    },
    loading: {
      invoke: {
        src: "slowOperation", // Cancelled if we leave "loading"
        onDone: "success"
      },
      on: {
        CANCEL: "idle" // Leaving triggers cancellation
      }
    },
    success: {}
  }
})
```

## Invoke with ID

Give your invocation an ID to reference it:

```typescript
import { setup, fromPromise } from "@jambudipa/xstate-effect"
import { Console } from "effect"

export const fetcherMachine = setup({
  types: {} as {
    events: { type: "FETCH" }
  },
  actors: {
    fetchData: fromPromise(async () => {
      const response = await fetch("/api/data")
      const data: unknown = await response.json()
      return data
    })
  }
}).createMachine({
  id: "fetcher",
  initial: "idle",
  states: {
    idle: {
      on: { FETCH: "loading" }
    },
    loading: {
      invoke: {
        id: "myFetcher",
        src: "fetchData",
        onDone: {
          target: "idle",
          // event.type is "xstate.done.actor.myFetcher"
          actions: ({ event }) => Console.log(event.type)
        }
      }
    }
  }
})
```

## Tips

1. **Keep actors stateless** - Don't rely on external mutable state
2. **Handle both success and error** - Always define `onDone` and `onError`
3. **Use typed input** - Define input types for type safety
4. **Cancel long operations** - Consider adding cancel transitions
5. **Log for debugging** - Use Effect's Console in fromEffect actors
