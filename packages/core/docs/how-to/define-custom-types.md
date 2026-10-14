# How to Define Custom Types

This guide shows how to set up type-safe context, events, input, and output types for your machines.

## Basic Type Setup

Use the `types` property in `setup` to define your machine's context, events and input. The
`types` of `setup` has no `output` member: to type the output, see [Output Types](#output-types).

```typescript
import { setup, assign } from "@jambudipa/xstate-effect"

export const machine = setup({
  types: {} as {
    context: { count: number }                        // your context type
    events: { type: "INCREMENT" } | { type: "FINISH" } // your event union
    input: { start: number }                          // input for initialization
  }
}).createMachine({
  id: "counter",
  initial: "active",
  context: ({ input }) => ({ count: input.start }),
  states: {
    active: {
      on: {
        INCREMENT: { actions: assign({ count: ({ context }) => context.count + 1 }) },
        FINISH: "done"
      }
    },
    done: { type: "final" }
  }
})
```

## Context Types

Context holds the data for your machine:

```typescript
import { setup } from "@jambudipa/xstate-effect"

interface UserContext {
  user: {
    id: string
    name: string
    email: string
  } | null
  isLoading: boolean
  error: string | null
}

export const userMachine = setup({
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
  states: {
    idle: {
      on: { FETCH: "loading" }
    },
    loading: {}
  }
})
```

## Event Types

Define events as a discriminated union. A transition under an event type reads that event, so
its actions see the event's own fields:

```typescript
import { setup, assign } from "@jambudipa/xstate-effect"

interface UserContext {
  userId: string
  name: string
  email: string
}

type UserEvent =
  | { type: "FETCH"; userId: string }
  | { type: "UPDATE"; name: string; email: string }
  | { type: "DELETE" }
  | { type: "RESET" }

export const machine = setup({
  types: {} as {
    context: UserContext
    events: UserEvent
  }
}).createMachine({
  id: "user",
  initial: "active",
  context: { userId: "", name: "", email: "" },
  states: {
    active: {
      on: {
        FETCH: { actions: assign({ userId: ({ event }) => event.userId }) },
        UPDATE: { actions: assign({ name: ({ event }) => event.name, email: ({ event }) => event.email }) },
        RESET: { actions: assign({ userId: "", name: "", email: "" }) },
        DELETE: "deleted"
      }
    },
    deleted: { type: "final" }
  }
})
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
import { setup, assign, createActor } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

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
  states: {
    active: {
      on: {
        INCREMENT: {
          guard: ({ context }) => context.count < context.max,
          actions: assign({ count: ({ context }) => context.count + 1 })
        }
      }
    }
  }
})

// Usage
export const program = Effect.gen(function* () {
  const actor = yield* createActor(counterMachine, {
    input: { initialCount: 0, maxCount: 10 }
  })
  yield* actor.start
  const snapshot = yield* actor.getSnapshot
  console.log(snapshot.context.max) // 10
})
```

## Output Types

Output is the value the machine's `output` gives when the machine reaches a top-level final
state. The `types` of `setup` has no `output` member, so declare the output type in the `types`
of `createMachine`. The machine's `output` must then give that type, and the actor's
`snapshot.output` is an `Option` of it:

```typescript
import { createMachine, assign, type OutputFrom } from "@jambudipa/xstate-effect"

interface MachineOutput {
  result: "success" | "cancelled"
  data?: string
}

export const wizardMachine = createMachine({
  types: {} as {
    context: { step: number; data: string; cancelled: boolean }
    events: { type: "NEXT"; data: string } | { type: "CANCEL" }
    output: MachineOutput
  },
  id: "wizard",
  initial: "step1",
  context: { step: 1, data: "", cancelled: false },
  states: {
    step1: {
      on: {
        NEXT: { target: "step2", actions: assign({ step: 2, data: ({ event }) => event.data }) },
        CANCEL: "cancelled"
      }
    },
    step2: {
      on: {
        NEXT: "complete",
        CANCEL: "cancelled"
      }
    },
    complete: { type: "final" },
    cancelled: {
      type: "final",
      entry: assign({ cancelled: true })
    }
  },
  output: ({ context }): MachineOutput =>
    context.cancelled ? { result: "cancelled" } : { result: "success", data: context.data }
})

export type WizardOutput = OutputFrom<typeof wizardMachine> // MachineOutput
```

## Actor Types

Define types for child actors:

```typescript
import { setup, assign, fromPromise, type ActorRefFrom } from "@jambudipa/xstate-effect"

const fetchUser = fromPromise(async ({ input }: { input: { id: string } }) => {
  const response = await fetch(`/api/users/${input.id}`)
  const user: { name: string; email: string } = await response.json()
  return user
})

export const machine = setup({
  types: {} as {
    context: {
      userRef: ActorRefFrom<typeof fetchUser> | null
    }
    events: { type: "FETCH"; userId: string }
  },
  actors: {
    fetchUser
  }
}).createMachine({
  id: "users",
  context: { userRef: null },
  on: {
    FETCH: {
      actions: assign({
        userRef: ({ event, spawn }) => spawn("fetchUser", { input: { id: event.userId } })
      })
    }
  }
})
```

## Complete Example

The machine declares its output type, so it uses the `types` of `createMachine` and gives the
actor logic to `invoke` directly:

```typescript
import { createMachine, createActor, assign, fromPromise } from "@jambudipa/xstate-effect"
import { Effect, Option } from "effect"

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

// Define the actor logic
const authenticate = fromPromise(async ({ input }: { input: { email: string; password: string } }) => {
  // Simulated auth
  return { user: { id: "1", name: "User", email: input.email }, token: "abc123" }
})

// Define the machine
const authMachine = createMachine({
  types: {} as {
    context: AuthContext
    events: AuthEvent
    input: AuthInput
    output: AuthOutput
  },
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
        src: authenticate,
        input: ({ event }) => ({
          email: event.type === "LOGIN" ? event.email : "",
          password: event.type === "LOGIN" ? event.password : ""
        }),
        onDone: {
          target: "authenticated",
          // The output of a done event is an Option
          actions: assign(({ event }) =>
            Option.match(event.output, {
              onNone: () => ({}),
              onSome: ({ user, token }) => ({ user, token, error: null })
            })
          )
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
      type: "final"
    }
  },
  // The machine reaches its final state only by a logout
  output: { wasLoggedIn: true }
})

// Usage with full type safety
const _program = Effect.gen(function* () {
  const actor = yield* createActor(authMachine, {
    input: { persistedToken: undefined }
  })
  yield* actor.start

  // TypeScript knows the event shape
  yield* actor.send({ type: "LOGIN", email: "user@example.com", password: "secret" })

  const snapshot = yield* actor.getSnapshot
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
