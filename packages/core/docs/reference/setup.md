# setup

Creates a type-safe machine factory with shared configuration.

## Signature

```typescript
import type {
  AnyActorLogic,
  DelayConfig,
  EventObject,
  GuardImplementation,
  SetupActionImplementation,
  SetupConfig,
  SetupReturn
} from "@jambudipa/xstate-effect"

// Simplified: the full signature also takes the state meta, transition meta, input,
// emitted, children and tag types
export declare function setup<
  TContext,
  TEvent extends EventObject,
  TActors extends Record<string, AnyActorLogic>,
  TActions extends Record<string, SetupActionImplementation<TContext, TEvent>>,
  TGuards extends Record<string, GuardImplementation<TContext, TEvent>>,
  TDelays extends Record<string, DelayConfig<TContext, TEvent>>
>(
  config: SetupConfig<TContext, TEvent, TActors, TActions, TGuards, TDelays>
): SetupReturn<TContext, TEvent, TActors, TActions, TGuards, TDelays>
```

## Parameters

### config

| Property | Type | Description |
|----------|------|-------------|
| `types` | `{ context?, events?, input?, emitted?, children?, meta?, transitionMeta?, tags? }` | Type definitions for the machine (type only) |
| `actors` | `Record<string, ActorLogic>` | Named actor logic |
| `actions` | `Record<string, Action>` | Named actions |
| `guards` | `Record<string, Guard>` | Named guards |
| `delays` | `Record<string, Delay>` | Named delays |

## Types Definition

Each member of `types` is optional, and `setup` reads none of its values at run time:

```typescript
import { setup } from "@jambudipa/xstate-effect"

interface Order {
  id: string
  total: number
}

export const orderSetup = setup({
  types: {} as {
    context: { orders: Order[] }                 // Machine context type
    events: { type: "ADD"; order: Order }        // Event union type
    input: { customerId: string }                // Input for actor creation
    output: { total: number }                    // Output of each machine
    emitted: { type: "ORDER_ADDED"; id: string } // Emitted event types
    tags: "busy" | "idle"                        // Tags that `hasTag` takes
  }
})
```

`types.output` is the output type of each machine of the setup, as in XState: the machine's `output`
config must give it, and its snapshots' `output` and its done event's `output` carry it.

## Return Value

Returns a `SetupReturn` object with:

| Method | Description |
|--------|-------------|
| `createMachine(config)` | Creates a machine with the configured types |

## Usage

### Basic Setup

```typescript
import { setup, assign } from "@jambudipa/xstate-effect"

export const machine = setup({
  types: {} as {
    context: { count: number }
    events: { type: "INCREMENT" } | { type: "DECREMENT" }
  }
}).createMachine({
  id: "counter",
  initial: "active",
  context: { count: 0 },
  states: {
    active: {
      on: {
        INCREMENT: { actions: assign({ count: ({ context }) => context.count + 1 }) },
        DECREMENT: { actions: assign({ count: ({ context }) => context.count - 1 }) }
      }
    }
  }
})
```

### With Actions

A named action can be a built-in action such as `assign`, or a plain function. A plain
function may return an Effect, which the actor runs:

```typescript
import { setup, assign } from "@jambudipa/xstate-effect"
import { Console } from "effect"

export const machine = setup({
  types: {} as {
    context: { count: number }
    events: { type: "INCREMENT" }
  },
  actions: {
    increment: assign({
      count: ({ context }) => context.count + 1
    }),
    logCount: ({ context }) => Console.log(`Count: ${context.count}`)
  }
}).createMachine({
  id: "counter",
  initial: "active",
  context: { count: 0 },
  states: {
    active: {
      on: {
        INCREMENT: { actions: ["increment", "logCount"] }
      }
    }
  }
})
```

### With Guards

```typescript
import { setup, assign } from "@jambudipa/xstate-effect"

export const machine = setup({
  types: {} as {
    context: { count: number; max: number }
    events: { type: "INCREMENT" }
  },
  guards: {
    canIncrement: ({ context }) => context.count < context.max
  }
}).createMachine({
  id: "counter",
  initial: "active",
  context: { count: 0, max: 10 },
  states: {
    active: {
      on: {
        INCREMENT: {
          guard: "canIncrement",
          actions: assign({ count: ({ context }) => context.count + 1 })
        }
      }
    }
  }
})
```

### With Actors

The `output` of a done event is an `Option`, so the assigner unwraps it:

```typescript
import { setup, assign, fromPromise } from "@jambudipa/xstate-effect"
import { Option } from "effect"

export const machine = setup({
  types: {} as {
    context: { data: unknown }
    events: { type: "FETCH" }
  },
  actors: {
    fetchData: fromPromise(async ({ input }: { input: { url: string } }) => {
      const response = await fetch(input.url)
      const data: unknown = await response.json()
      return data
    })
  }
}).createMachine({
  id: "fetcher",
  initial: "idle",
  context: { data: null },
  states: {
    idle: {
      on: { FETCH: "loading" }
    },
    loading: {
      invoke: {
        src: "fetchData",
        input: { url: "/api/data" },
        onDone: {
          target: "success",
          actions: assign({ data: ({ event }) => Option.getOrNull(event.output) })
        }
      }
    },
    success: {}
  }
})
```

### With Delays

```typescript
import { setup } from "@jambudipa/xstate-effect"

export const machine = setup({
  types: {} as {
    context: { timeout: number }
    events: { type: "START" }
  },
  delays: {
    TIMEOUT: ({ context }) => context.timeout
  }
}).createMachine({
  id: "timer",
  initial: "idle",
  context: { timeout: 5000 },
  states: {
    idle: {
      on: { START: "running" }
    },
    running: {
      after: {
        TIMEOUT: "complete"
      }
    },
    complete: { type: "final" }
  }
})
```

### Complete Example

```typescript
import { setup, assign, fromPromise } from "@jambudipa/xstate-effect"
import { Console, Option } from "effect"

interface User {
  id: string
  name: string
}

export const userMachine = setup({
  types: {} as {
    context: {
      userId: string
      user: User | null
      error: string | null
    }
    events:
      | { type: "FETCH"; userId: string }
      | { type: "RETRY" }
      | { type: "RESET" }
    input: { initialUserId?: string }
  },
  actors: {
    fetchUser: fromPromise(async ({ input }: { input: { userId: string } }) => {
      const response = await fetch(`/api/users/${input.userId}`)
      if (!response.ok) throw new Error("Failed to fetch")
      const user: User = await response.json()
      return user
    })
  },
  actions: {
    setUserId: assign({
      userId: ({ event }) => event.type === "FETCH" ? event.userId : ""
    }),
    setUser: assign({
      user: (_, params: { user: User | null }) => params.user,
      error: null
    }),
    setError: assign({
      error: (_, params: { message: string }) => params.message
    }),
    reset: assign({
      user: null,
      error: null
    }),
    logFetch: ({ context }) => Console.log(`Fetching user: ${context.userId}`)
  },
  guards: {
    hasUserId: ({ context }) => context.userId.length > 0
  }
}).createMachine({
  id: "user",
  initial: "idle",
  context: ({ input }) => ({
    userId: input?.initialUserId ?? "",
    user: null,
    error: null
  }),
  states: {
    idle: {
      on: {
        FETCH: {
          target: "loading",
          actions: ["setUserId", "logFetch"]
        }
      }
    },
    loading: {
      invoke: {
        id: "fetchUser",
        src: "fetchUser",
        input: ({ context }) => ({ userId: context.userId }),
        onDone: {
          target: "success",
          actions: {
            type: "setUser",
            params: ({ event }) => ({ user: Option.getOrNull(event.output) })
          }
        },
        onError: {
          target: "failure",
          actions: {
            type: "setError",
            params: ({ event }) => ({
              message: event.error instanceof Error ? event.error.message : String(event.error)
            })
          }
        }
      }
    },
    success: {
      on: {
        FETCH: {
          target: "loading",
          actions: ["setUserId", "logFetch"]
        },
        RESET: {
          target: "idle",
          actions: "reset"
        }
      }
    },
    failure: {
      on: {
        RETRY: {
          guard: "hasUserId",
          target: "loading"
        },
        FETCH: {
          target: "loading",
          actions: ["setUserId", "logFetch"]
        }
      }
    }
  },
  output: ({ context }) => ({ user: context.user })
})
```

## Notes

- The `types` property uses the `{} as { ... }` assertion to define types without runtime values
- Named actions, guards, and actors can be referenced by string in machine config
- A named action that takes params is used as `{ type, params }`; `params` can be a function of the context and the event
- Setup enables type inference across the entire machine definition
- Every property of the setup config is optional, `types` included

## See Also

- [The `createMachine` method](../tutorials/01-first-state-machine.md#the-createmachine-method) - Tutorial 1 explains the machine config
- [Actions Reference](./actions/)
- [Guards](../tutorials/03-guards-and-transitions.md) - Tutorial 3 defines named guards in `setup`
