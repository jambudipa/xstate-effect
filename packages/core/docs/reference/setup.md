# setup

Creates a type-safe machine factory with shared configuration.

## Signature

```typescript
function setup<
  TContext,
  TEvent extends EventObject,
  TInput,
  TOutput,
  TEmitted extends EventObject,
  TActors extends Record<string, AnyActorLogic>,
  TActions extends Record<string, AnyAction>,
  TGuards extends Record<string, AnyGuard>,
  TDelays extends Record<string, AnyDelay>
>(config: SetupConfig<...>): SetupReturn<...>
```

## Parameters

### config

| Property | Type | Description |
|----------|------|-------------|
| `types` | `SetupTypes` | Type definitions for the machine |
| `actors` | `Record<string, ActorLogic>` | Named actor creators |
| `actions` | `Record<string, Action>` | Named actions |
| `guards` | `Record<string, Guard>` | Named guard functions |
| `delays` | `Record<string, Delay>` | Named delay functions |

## Types Definition

```typescript
interface SetupTypes {
  context: TContext        // Machine context type
  events: TEvent           // Event union type
  input?: TInput           // Input for actor creation
  output?: TOutput         // Output for final states
  emitted?: TEmitted       // Emitted event types
}
```

## Return Value

Returns a `SetupReturn` object with:

| Method | Description |
|--------|-------------|
| `createMachine(config)` | Creates a machine with the configured types |

## Usage

### Basic Setup

```typescript
import { setup } from "@jambudipa/xstate-effect"

const machine = setup({
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
        INCREMENT: { /* ... */ },
        DECREMENT: { /* ... */ }
      }
    }
  }
})
```

### With Actions

```typescript
import { setup, assign } from "@jambudipa/xstate-effect"

const machine = setup({
  types: {} as {
    context: { count: number }
    events: { type: "INCREMENT" }
  },
  actions: {
    increment: assign({
      count: ({ context }) => context.count + 1
    }),
    logCount: action("logCount", ({ context }) =>
      Console.log(`Count: ${context.count}`)
    )
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
import { setup, guard } from "@jambudipa/xstate-effect"

const machine = setup({
  types: {} as {
    context: { count: number; max: number }
    events: { type: "INCREMENT" }
  },
  guards: {
    canIncrement: guard("canIncrement", ({ context }) =>
      context.count < context.max
    )
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

```typescript
import { setup, fromPromise } from "@jambudipa/xstate-effect"

const machine = setup({
  types: {} as {
    context: { data: any }
    events: { type: "FETCH" }
  },
  actors: {
    fetchData: fromPromise(async ({ input }: { input: { url: string } }) => {
      const response = await fetch(input.url)
      return response.json()
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
          actions: assign({ data: ({ event }) => event.output })
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

const machine = setup({
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
import { setup, assign, guard, action, fromPromise } from "@jambudipa/xstate-effect"
import { Effect, Console } from "effect"

interface User {
  id: string
  name: string
}

const userMachine = setup({
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
    output: { user: User | null }
  },
  actors: {
    fetchUser: fromPromise(async ({ input }: { input: { userId: string } }) => {
      const response = await fetch(`/api/users/${input.userId}`)
      if (!response.ok) throw new Error("Failed to fetch")
      return response.json() as Promise<User>
    })
  },
  actions: {
    setUserId: assign({
      userId: ({ event }) => event.type === "FETCH" ? event.userId : ""
    }),
    setUser: assign({
      user: ({ event }) =>
        event.type === "xstate.done.actor.fetchUser" ? event.output : null,
      error: null
    }),
    setError: assign({
      error: ({ event }) =>
        event.type === "xstate.error.actor.fetchUser" ? event.error.message : null
    }),
    reset: assign({
      user: null,
      error: null
    }),
    logFetch: action("logFetch", ({ context }) =>
      Console.log(`Fetching user: ${context.userId}`)
    )
  },
  guards: {
    hasUserId: guard("hasUserId", ({ context }) => context.userId.length > 0)
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
          actions: "setUser"
        },
        onError: {
          target: "failure",
          actions: "setError"
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

- The `types` property uses `as` assertion to define types without runtime values
- Named actions, guards, and actors can be referenced by string in machine config
- Setup enables type inference across the entire machine definition
- All properties in setup are optional except `types`

## See Also

- [createMachine](./create-machine.md)
- [Actions Reference](./actions/)
- [Guards Reference](./guards/)
