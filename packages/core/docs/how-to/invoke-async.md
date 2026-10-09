# How to Invoke Async Operations

This guide shows how to call APIs, perform async work, and handle results in your state machines.

## Using fromPromise

The simplest way to invoke async operations:

```typescript
import { setup, fromPromise, assign } from "@jambudipa/xstate-effect"

const fetchUserActor = fromPromise(async ({ input }: { input: { userId: string } }) => {
  const response = await fetch(`/api/users/${input.userId}`)
  if (!response.ok) throw new Error("Failed to fetch user")
  return response.json()
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
          actions: assign({ user: ({ event }) => event.output })
        },
        onError: {
          target: "failure",
          actions: assign({ error: ({ event }) => event.error.message })
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

## Using fromEffect

For Effect-based async operations:

```typescript
import { setup, fromEffect, assign } from "@jambudipa/xstate-effect"
import { Effect, Console } from "effect"

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
          actions: assign({ results: ({ event }) => event.output })
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
    fetchUser: fromPromise(async () => { /* ... */ }),
    fetchPosts: fromPromise(async () => { /* ... */ }),
    fetchNotifications: fromPromise(async () => { /* ... */ })
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
                  actions: assign({ user: ({ event }) => event.output })
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
                  actions: assign({ posts: ({ event }) => event.output })
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
                  actions: assign({ notifications: ({ event }) => event.output })
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
  onDone: { /* ... */ }
}
```

## Handling Different Error Types

```typescript
import { setup, fromEffect, assign } from "@jambudipa/xstate-effect"
import { Effect, Data } from "effect"

class NetworkError extends Data.TaggedError("NetworkError")<{ message: string }> {}
class ValidationError extends Data.TaggedError("ValidationError")<{ field: string }> {}

const submitActor = fromEffect(({ input }: { input: { data: Record<string, unknown> } }) =>
  Effect.gen(function* () {
    // Validate
    if (!input.data.email) {
      yield* Effect.fail(new ValidationError({ field: "email" }))
    }

    // Submit
    const response = yield* Effect.tryPromise({
      try: () => fetch("/api/submit", { method: "POST", body: JSON.stringify(input.data) }),
      catch: () => new NetworkError({ message: "Network request failed" })
    })

    return yield* Effect.tryPromise(() => response.json())
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
states: {
  loading: {
    invoke: {
      src: "slowOperation", // Cancelled if we leave "loading"
      onDone: "success"
    },
    on: {
      CANCEL: "idle" // Leaving triggers cancellation
    }
  }
}
```

## Invoke with ID

Give your invocation an ID to reference it:

```typescript
invoke: {
  id: "myFetcher",
  src: "fetchData",
  onDone: {
    actions: ({ event }) => {
      // event.type will be "xstate.done.actor.myFetcher"
    }
  }
}
```

## Tips

1. **Keep actors stateless** - Don't rely on external mutable state
2. **Handle both success and error** - Always define `onDone` and `onError`
3. **Use typed input** - Define input types for type safety
4. **Cancel long operations** - Consider adding cancel transitions
5. **Log for debugging** - Use Effect's Console in fromEffect actors
