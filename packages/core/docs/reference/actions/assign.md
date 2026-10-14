# assign

Updates the machine's context with new values.

## Signature

```typescript
import type { ActionDefinition, Assigner, EventObject, PropertyAssigner } from "@jambudipa/xstate-effect"

// Simplified: the full type also carries the params type of the action's uses, every event
// of the machine and the names of the machine's implementations
export declare function assign<TContext, TEvent extends EventObject>(
  assignment: Partial<TContext> | PropertyAssigner<TContext, TEvent> | Assigner<TContext, TEvent>
): ActionDefinition<TContext, TEvent>
```

The context and event types come from where the action is used: the `types` of the machine
or of its `setup`, and the event of the transition that runs the action.

## Parameters

### assignment

Either an object with property assignments or a function returning the context properties to change.

**Property Assigner** (recommended): each key holds a value, or a function that computes it:
```typescript
import { setup, assign } from "@jambudipa/xstate-effect"

export const counter = setup({
  types: {} as {
    context: { count: number; label: string }
  },
  actions: {
    update: assign({
      count: 1,                                          // a value
      label: ({ context }) => `Count: ${context.count}` // or a function of the arguments
    })
  }
})
```

**Function Assigner**: the function returns the properties to change, and `assign` merges them into the context:
```typescript
import { setup, assign } from "@jambudipa/xstate-effect"

export const counter = setup({
  types: {} as {
    context: { count: number; label: string }
  },
  actions: {
    increment: assign(({ context }) => ({ count: context.count + 1 }))
  }
})
```

### Assignment Function Arguments

| Property | Type | Description |
|----------|------|-------------|
| `context` | `TContext` | Current context |
| `event` | `TEvent` | Event that triggered the action |
| `self` | `ActorRef` | Reference to the current actor |
| `system` | `ActorSystem` | The actor system |
| `spawn` | `Spawner` | Spawns a child actor and gives its reference at once |

The params of the action's use are the second argument of each function.

## Usage

### Static Values

```typescript
import { setup, assign } from "@jambudipa/xstate-effect"

export const profile = setup({
  types: {} as {
    context: { count: number; name: string; active: boolean }
  },
  actions: {
    resetCount: assign({ count: 0 }),
    resetProfile: assign({ name: "default", active: false })
  }
})
```

### Dynamic Values from Context

```typescript
import { setup, assign } from "@jambudipa/xstate-effect"

export const cart = setup({
  types: {} as {
    context: { count: number; total: number; items: Array<{ price: number }> }
  },
  actions: {
    increment: assign({
      count: ({ context }) => context.count + 1
    }),
    computeTotal: assign({
      total: ({ context }) => context.items.reduce((sum, item) => sum + item.price, 0)
    })
  }
})
```

### Values from Event

```typescript
import { setup, assign } from "@jambudipa/xstate-effect"

export const list = setup({
  types: {} as {
    context: { name: string; items: string[] }
    events: { type: "SET_NAME"; name: string } | { type: "ADD_ITEM"; item: string }
  },
  actions: {
    setName: assign({
      name: ({ event }) => event.type === "SET_NAME" ? event.name : ""
    }),
    addItem: assign({
      items: ({ context, event }) => {
        if (event.type === "ADD_ITEM") {
          return [...context.items, event.item]
        }
        return context.items
      }
    })
  }
})
```

### Multiple Properties

```typescript
import { setup, assign } from "@jambudipa/xstate-effect"

export const tracker = setup({
  types: {} as {
    context: { count: number; lastUpdated: number; history: number[] }
  },
  actions: {
    record: assign({
      count: ({ context }) => context.count + 1,
      lastUpdated: () => Date.now(),
      history: ({ context }) => [...context.history, context.count]
    })
  }
})
```

### Full Context Replacement

```typescript
import { setup, assign } from "@jambudipa/xstate-effect"

export const form = setup({
  types: {} as {
    context: { count: number; name: string; items: string[] }
    events: { type: "RESET" } | { type: "SUBMIT" }
  },
  actions: {
    reset: assign(({ context, event }) => {
      if (event.type === "RESET") {
        return { count: 0, name: "", items: [] }
      }
      return context
    })
  }
})
```

## Examples

### Counter

```typescript
import { setup, assign } from "@jambudipa/xstate-effect"

export const counterMachine = setup({
  types: {} as {
    context: { count: number }
    events:
      | { type: "INCREMENT" }
      | { type: "DECREMENT" }
      | { type: "SET"; value: number }
  },
  actions: {
    increment: assign({ count: ({ context }) => context.count + 1 }),
    decrement: assign({ count: ({ context }) => context.count - 1 }),
    set: assign({ count: ({ event }) => event.type === "SET" ? event.value : 0 })
  }
}).createMachine({
  id: "counter",
  initial: "active",
  context: { count: 0 },
  states: {
    active: {
      on: {
        INCREMENT: { actions: "increment" },
        DECREMENT: { actions: "decrement" },
        SET: { actions: "set" }
      }
    }
  }
})
```

### Form Fields

```typescript
import { setup, assign } from "@jambudipa/xstate-effect"

export const formMachine = setup({
  types: {} as {
    context: {
      fields: Record<string, string>
      errors: Record<string, string>
      touched: Record<string, boolean>
    }
    events:
      | { type: "SET_FIELD"; field: string; value: string }
      | { type: "BLUR_FIELD"; field: string }
      | { type: "SET_ERROR"; field: string; error: string }
      | { type: "CLEAR_ERRORS" }
  },
  actions: {
    setField: assign({
      fields: ({ context, event }) => {
        if (event.type !== "SET_FIELD") return context.fields
        return { ...context.fields, [event.field]: event.value }
      }
    }),
    touchField: assign({
      touched: ({ context, event }) => {
        if (event.type !== "BLUR_FIELD") return context.touched
        return { ...context.touched, [event.field]: true }
      }
    }),
    setError: assign({
      errors: ({ context, event }) => {
        if (event.type !== "SET_ERROR") return context.errors
        return { ...context.errors, [event.field]: event.error }
      }
    }),
    clearErrors: assign({ errors: {} })
  }
}).createMachine({
  id: "form",
  initial: "editing",
  context: { fields: {}, errors: {}, touched: {} },
  states: {
    editing: {
      on: {
        SET_FIELD: { actions: "setField" },
        BLUR_FIELD: { actions: "touchField" },
        SET_ERROR: { actions: "setError" },
        CLEAR_ERRORS: { actions: "clearErrors" }
      }
    }
  }
})
```

### Immutable Updates

An `assign` written under an event in `on` reads that event's type, so it needs no check of `event.type`:

```typescript
import { createMachine, assign } from "@jambudipa/xstate-effect"

interface Item {
  id: string
  name: string
  done: boolean
}

export const listMachine = createMachine({
  types: {} as {
    context: { items: Item[]; user: { profile: { name: string; bio: string } } }
    events:
      | { type: "ADD_ITEM"; item: Item }
      | { type: "REMOVE_ITEM"; itemId: string }
      | { type: "UPDATE_ITEM"; itemId: string; updates: Partial<Item> }
      | { type: "SET_NAME"; name: string }
  },
  context: { items: [], user: { profile: { name: "", bio: "" } } },
  on: {
    // Adding to array
    ADD_ITEM: {
      actions: assign({
        items: ({ context, event }) => [...context.items, event.item]
      })
    },
    // Removing from array
    REMOVE_ITEM: {
      actions: assign({
        items: ({ context, event }) =>
          context.items.filter(item => item.id !== event.itemId)
      })
    },
    // Updating array item
    UPDATE_ITEM: {
      actions: assign({
        items: ({ context, event }) =>
          context.items.map(item =>
            item.id === event.itemId ? { ...item, ...event.updates } : item
          )
      })
    },
    // Updating nested object
    SET_NAME: {
      actions: assign({
        user: ({ context, event }) => ({
          ...context.user,
          profile: {
            ...context.user.profile,
            name: event.name
          }
        })
      })
    }
  }
})
```

## Notes

- `assign` always returns a new context object (immutable update)
- Property assigners are evaluated in order
- Every property assigner of one `assign` call reads the context from before the action, not the results of the other assigners
- An assigner function may return an Effect of the properties to change; a failure of that Effect becomes the actor's error
- Always handle the possibility that the event type doesn't match when using event data
- Use TypeScript's type narrowing for type-safe event access

## Common Patterns

### Type-Safe Event Access

```typescript
import { setup, assign } from "@jambudipa/xstate-effect"

export const valueSetup = setup({
  types: {} as {
    context: { value: number | undefined }
    events: { type: "SET_VALUE"; value: number } | { type: "CLEAR" }
  },
  actions: {
    setValue: assign({
      value: ({ event }) => {
        // Type narrowing
        if (event.type === "SET_VALUE") {
          return event.value
        }
        return undefined
      }
    }),
    // Or with a conditional expression
    setValueInline: assign({
      value: ({ event }) =>
        event.type === "SET_VALUE" ? event.value : undefined
    })
  }
})
```

### Conditional Assignment

```typescript
import { setup, assign } from "@jambudipa/xstate-effect"

export const bounded = setup({
  types: {} as {
    context: { count: number; min: number; max: number }
    events: { type: "INCREMENT" } | { type: "DECREMENT" }
  },
  actions: {
    step: assign({
      count: ({ context, event }) => {
        if (event.type === "INCREMENT" && context.count < context.max) {
          return context.count + 1
        }
        if (event.type === "DECREMENT" && context.count > context.min) {
          return context.count - 1
        }
        return context.count
      }
    })
  }
})
```

## See Also

- [Actions in the package entry points](../../../README.md#entry-points) - Every action that `@jambudipa/xstate-effect/actions` exports
- [Working with Context](../../tutorials/02-working-with-context.md) - Tutorial 2 updates context with `assign`
