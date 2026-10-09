# Tutorial 3: Guards and Conditional Transitions

In previous tutorials, transitions always happened when an event was received. Now you'll learn to use **guards** to conditionally allow or prevent transitions based on context or event data.

## What You'll Learn

- How to define guard functions
- How to use guards in transitions
- How to combine guards with `and`, `or`, and `not`
- How to use `stateIn` guards

## Why Guards?

Consider a counter with a maximum value. Without guards, you'd need separate states for "at maximum" and "not at maximum". With guards, you can conditionally prevent the INCREMENT event:

```typescript
// Without guards: complex state structure
states: {
  belowMax: { on: { INCREMENT: "checkMax" } },
  atMax: { on: { DECREMENT: "belowMax" } },
  checkMax: { always: [ /* conditional transitions */ ] }
}

// With guards: simple and clear
states: {
  active: {
    on: {
      INCREMENT: { guard: "canIncrement", actions: "increment" }
    }
  }
}
```

## Step 1: Define a Guard

Guards are functions that return `true` (allow) or `false` (prevent):

```typescript
import { setup, createActor as _createActor, assign, guard } from "@jambudipa/xstate-effect"
import { Effect as _Effect } from "effect"

const _counterMachine = setup({
  types: {} as {
    context: { count: number; max: number }
    events: { type: "INCREMENT" } | { type: "DECREMENT" }
  },
  guards: {
    canIncrement: guard("canIncrement", ({ context }) =>
      context.count < context.max
    ),
    canDecrement: guard("canDecrement", ({ context }) =>
      context.count > 0
    )
  },
  actions: {
    increment: assign({ count: ({ context }) => context.count + 1 }),
    decrement: assign({ count: ({ context }) => context.count - 1 })
  }
}).createMachine({
  id: "boundedCounter",
  initial: "active",
  context: { count: 0, max: 5 },
  states: {
    active: {
      on: {
        INCREMENT: {
          guard: "canIncrement",
          actions: "increment"
        },
        DECREMENT: {
          guard: "canDecrement",
          actions: "decrement"
        }
      }
    }
  }
})
```

### Guard Function Signature

```typescript
guard("name", ({ context, event }) => boolean)
```

The guard receives:
- `context`: Current machine context
- `event`: The event that triggered the transition

## Step 2: Guards with Event Data

Guards can inspect event payloads:

```typescript
const _machine = setup({
  types: {} as {
    context: { balance: number }
    events: { type: "WITHDRAW"; amount: number }
  },
  guards: {
    hasSufficientFunds: guard("hasSufficientFunds", ({ context, event }) =>
      event.type === "WITHDRAW" && context.balance >= event.amount
    )
  },
  actions: {
    withdraw: assign({
      balance: ({ context, event }) =>
        event.type === "WITHDRAW" ? context.balance - event.amount : context.balance
    })
  }
}).createMachine({
  id: "account",
  initial: "active",
  context: { balance: 100 },
  states: {
    active: {
      on: {
        WITHDRAW: {
          guard: "hasSufficientFunds",
          actions: "withdraw"
        }
      }
    }
  }
})
```

## Step 3: Multiple Transitions with Guards

Define multiple transitions for the same event. The first matching guard wins:

```typescript
const _trafficLight = setup({
  types: {} as {
    context: { emergencyMode: boolean }
    events: { type: "NEXT" }
  },
  guards: {
    isEmergency: guard("isEmergency", ({ context }) => context.emergencyMode)
  }
}).createMachine({
  id: "trafficLight",
  initial: "green",
  context: { emergencyMode: false },
  states: {
    green: {
      on: {
        NEXT: [
          // First check for emergency
          { guard: "isEmergency", target: "flashingRed" },
          // Default transition
          { target: "yellow" }
        ]
      }
    },
    yellow: {
      on: {
        NEXT: [
          { guard: "isEmergency", target: "flashingRed" },
          { target: "red" }
        ]
      }
    },
    red: {
      on: {
        NEXT: [
          { guard: "isEmergency", target: "flashingRed" },
          { target: "green" }
        ]
      }
    },
    flashingRed: {
      on: {
        NEXT: { target: "red" }
      }
    }
  }
})
```

## Step 4: Combining Guards

Use `and`, `or`, and `not` to compose guards:

```typescript
import { setup, guard, and, or, not } from "@jambudipa/xstate-effect"

const _machine = setup({
  types: {} as {
    context: {
      isAdmin: boolean
      isVerified: boolean
      isBanned: boolean
    }
    events: { type: "ACCESS_ADMIN" }
  },
  guards: {
    isAdmin: guard("isAdmin", ({ context }) => context.isAdmin),
    isVerified: guard("isVerified", ({ context }) => context.isVerified),
    isBanned: guard("isBanned", ({ context }) => context.isBanned),

    // Combine guards
    canAccessAdmin: and(["isAdmin", "isVerified", not("isBanned")])
  }
}).createMachine({
  id: "access",
  initial: "home",
  context: { isAdmin: true, isVerified: true, isBanned: false },
  states: {
    home: {
      on: {
        ACCESS_ADMIN: {
          guard: "canAccessAdmin",
          target: "admin"
        }
      }
    },
    admin: {}
  }
})
```

### Guard Combinators

```typescript
// All guards must pass
and(["guard1", "guard2", "guard3"])

// At least one guard must pass
or(["guard1", "guard2"])

// Inverts the guard result
not("guardName")

// Nested combinations
and(["guard1", or(["guard2", "guard3"])])
```

## Step 5: The stateIn Guard

Check if the machine is in a specific state:

```typescript
import { setup, stateIn, stateNotIn } from "@jambudipa/xstate-effect"

const _machine = setup({
  types: {} as {
    context: {}
    events: { type: "SUBMIT" }
  },
  guards: {
    isReady: stateIn("ready"),
    isNotLoading: stateNotIn("loading")
  }
}).createMachine({
  id: "form",
  initial: "idle",
  context: {},
  states: {
    idle: {
      on: { SUBMIT: "loading" }
    },
    loading: {},
    ready: {
      on: {
        SUBMIT: {
          guard: "isReady",  // Only submits from ready state
          target: "loading"
        }
      }
    }
  }
})
```

## Complete Example: Password Validator

```typescript
import { setup, createActor, assign, guard, and } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

const passwordMachine = setup({
  types: {} as {
    context: {
      password: string
      minLength: number
    }
    events:
      | { type: "SET_PASSWORD"; value: string }
      | { type: "SUBMIT" }
  },
  guards: {
    hasMinLength: guard("hasMinLength", ({ context }) =>
      context.password.length >= context.minLength
    ),
    hasNumber: guard("hasNumber", ({ context }) =>
      /\d/.test(context.password)
    ),
    hasUppercase: guard("hasUppercase", ({ context }) =>
      /[A-Z]/.test(context.password)
    ),
    isValidPassword: and(["hasMinLength", "hasNumber", "hasUppercase"])
  },
  actions: {
    setPassword: assign({
      password: ({ event }) =>
        event.type === "SET_PASSWORD" ? event.value : ""
    })
  }
}).createMachine({
  id: "passwordValidator",
  initial: "editing",
  context: { password: "", minLength: 8 },
  states: {
    editing: {
      on: {
        SET_PASSWORD: { actions: "setPassword" },
        SUBMIT: {
          guard: "isValidPassword",
          target: "submitted"
        }
      }
    },
    submitted: {
      type: "final"
    }
  }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(passwordMachine)
  yield* actor.start()

  // Try weak password
  yield* actor.send({ type: "SET_PASSWORD", value: "weak" })
  yield* actor.send({ type: "SUBMIT" }) // Blocked by guard

  let snapshot = yield* actor.getSnapshot()
  console.log(`State after weak password: ${snapshot.value}`) // editing

  // Try strong password
  yield* actor.send({ type: "SET_PASSWORD", value: "Strong1Password" })
  yield* actor.send({ type: "SUBMIT" }) // Allowed

  snapshot = yield* actor.getSnapshot()
  console.log(`State after strong password: ${snapshot.value}`) // submitted
})

void Effect.runPromise(program)
```

## Exercises

1. **Age verification**: Create a machine that only allows access if the user's age in context is 18 or above.

2. **Rate limiter**: Add a guard that prevents more than 5 events within a time window. Store the event timestamps in context.

3. **Form validation**: Create a form machine with multiple fields. Only allow submission when all fields are valid.

## Key Takeaways

- **Guards** conditionally allow or prevent transitions
- Guards receive `context` and `event` and return a boolean
- Use `and`, `or`, `not` to compose complex conditions
- Multiple transitions can be defined for the same event - first matching guard wins
- `stateIn` and `stateNotIn` check the current state

## What's Next

In the [next tutorial](./04-side-effects.md), you'll learn how to execute side effects with actions that run when entering states, exiting states, or during transitions.
