# How to Define Custom Types

This guide shows how to set up type-safe context, events, input, and output types for your machines.

## Basic Type Setup

Use the `types` property in `setup` to define your machine's type schema:

```typescript
import { setup } from "@jambudipa/xstate-effect"

const _machine = setup({
  types: {} as {
    context: { /* your context type */ }
    events: { /* your event union */ }
    input: { /* input for initialization */ }
    output: { /* output when machine completes */ }
  }
}).createMachine({ /* ... */ })
```

## Context Types

Context holds the data for your machine:

```typescript
interface UserContext {
  user: {
    id: string
    name: string
    email: string
  } | null
  isLoading: boolean
  error: string | null
}

const _userMachine = setup({
  types: {} as {
    context: UserContext
    events: { type: "FETCH" }
  }
}).createMachine({
  id: "user",
  initial: "idle",
  context: {
    user: null,
    isLoading: false,
    error: null
  },
  states: { /* ... */ }
})
```

## Event Types

Define events as a discriminated union:

```typescript
type UserEvent =
  | { type: "FETCH"; userId: string }
  | { type: "UPDATE"; name: string; email: string }
  | { type: "DELETE" }
  | { type: "RESET" }

const _machine = setup({
  types: {} as {
    context: UserContext
    events: UserEvent
  }
}).createMachine({ /* ... */ })
```

### Events with Payloads

```typescript
type _FormEvent =
  | { type: "SET_FIELD"; field: string; value: string }
  | { type: "SET_FIELDS"; fields: Record<string, string> }
  | { type: "VALIDATE" }
  | { type: "SUBMIT" }
  | { type: "RESET" }
```

### Generic Event Patterns

```typescript
// CRUD operations
type _CrudEvent<T> =
  | { type: "CREATE"; data: Omit<T, "id"> }
  | { type: "READ"; id: string }
  | { type: "UPDATE"; id: string; data: Partial<T> }
  | { type: "DELETE"; id: string }
```

## Input Types

Input is data passed when creating an actor:

```typescript
interface MachineInput {
  initialCount: number
  maxCount: number
}

const counterMachine = setup({
  types: {} as {
    context: { count: number; max: number }
    events: { type: "INCREMENT" }
    input: MachineInput
  }
}).createMachine({
  id: "counter",
  initial: "active",
  context: ({ input }) => ({
    count: input.initialCount,
    max: input.maxCount
  }),
  states: { /* ... */ }
})

// Usage
const _actor = yield* createActor(counterMachine, {
  input: { initialCount: 0, maxCount: 10 }
})
```

## Output Types

Output is the value returned when the machine reaches a final state:

```typescript
interface MachineOutput {
  result: "success" | "cancelled"
  data?: string
}

const _wizardMachine = setup({
  types: {} as {
    context: { step: number; data: string }
    events: { type: "NEXT" } | { type: "CANCEL" }
    output: MachineOutput
  }
}).createMachine({
  id: "wizard",
  initial: "step1",
  context: { step: 1, data: "" },
  states: {
    step1: { /* ... */ },
    step2: { /* ... */ },
    complete: {
      type: "final",
      output: ({ context }) => ({
        result: "success" as const,
        data: context.data
      })
    },
    cancelled: {
      type: "final",
      output: { result: "cancelled" as const }
    }
  }
})
```

## Actor Types

Define types for child actors:

```typescript
import { fromPromise, ActorRefFrom } from "@jambudipa/xstate-effect"

const fetchUser = fromPromise(async ({ input }: { input: { id: string } }) => {
  const response = await fetch(`/api/users/${input.id}`)
  return response.json() as Promise<{ name: string; email: string }>
})

const _machine = setup({
  types: {} as {
    context: {
      userRef: ActorRefFrom<typeof fetchUser> | null
    }
    events: { type: "FETCH"; userId: string }
  },
  actors: {
    fetchUser
  }
}).createMachine({ /* ... */ })
```

## Complete Example

```typescript
import { setup, createActor, assign, fromPromise } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

// Define all types
interface User {
  id: string
  name: string
  email: string
}

interface AuthContext {
  user: User | null
  token: string | null
  error: string | null
}

type AuthEvent =
  | { type: "LOGIN"; email: string; password: string }
  | { type: "LOGOUT" }
  | { type: "REFRESH_TOKEN" }

interface AuthInput {
  persistedToken?: string
}

interface AuthOutput {
  wasLoggedIn: boolean
}

// Define the machine
const authMachine = setup({
  types: {} as {
    context: AuthContext
    events: AuthEvent
    input: AuthInput
    output: AuthOutput
  },
  actors: {
    authenticate: fromPromise(async ({ input }: { input: { email: string; password: string } }) => {
      // Simulated auth
      return { user: { id: "1", name: "User", email: input.email }, token: "abc123" }
    })
  }
}).createMachine({
  id: "auth",
  initial: "idle",
  context: ({ input }) => ({
    user: null,
    token: input.persistedToken ?? null,
    error: null
  }),
  states: {
    idle: {
      always: {
        guard: ({ context }) => context.token !== null,
        target: "authenticated"
      },
      on: {
        LOGIN: "authenticating"
      }
    },
    authenticating: {
      invoke: {
        src: "authenticate",
        input: ({ event }) => ({
          email: event.type === "LOGIN" ? event.email : "",
          password: event.type === "LOGIN" ? event.password : ""
        }),
        onDone: {
          target: "authenticated",
          actions: assign({
            user: ({ event }) => event.output.user,
            token: ({ event }) => event.output.token
          })
        },
        onError: {
          target: "idle",
          actions: assign({ error: "Authentication failed" })
        }
      }
    },
    authenticated: {
      on: {
        LOGOUT: {
          target: "loggedOut",
          actions: assign({ user: null, token: null })
        }
      }
    },
    loggedOut: {
      type: "final",
      output: { wasLoggedIn: true }
    }
  }
})

// Usage with full type safety
const _program = Effect.gen(function* () {
  const actor = yield* createActor(authMachine, {
    input: { persistedToken: undefined }
  })
  yield* actor.start()

  // TypeScript knows the event shape
  yield* actor.send({ type: "LOGIN", email: "user@example.com", password: "secret" })

  const snapshot = yield* actor.getSnapshot()
  // TypeScript knows context.user is User | null
  if (snapshot.context.user) {
    console.log(snapshot.context.user.name)
  }
})
```

## Tips

1. **Use interfaces for complex types** - Makes them reusable and easier to extend
2. **Keep events as discriminated unions** - Enables exhaustive type checking
3. **Use `as const` for literal types** - Ensures string literals are preserved
4. **Extract shared types** - Create type files for shared context/event types
