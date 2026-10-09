# assign

Updates the machine's context with new values.

## Signature

```typescript
function assign<TContext, TEvent>(
  assignment: Assigner<TContext, TEvent> | PropertyAssigner<TContext, TEvent>
): ActionDefinition<TContext, TEvent>
```

## Parameters

### assignment

Either an object with property assignments or a function returning the new context.

**Property Assigner** (recommended):
```typescript
assign({
  property1: value | ((args) => value),
  property2: value | ((args) => value)
})
```

**Function Assigner**:
```typescript
assign((args) => newContext)
```

### Assignment Function Arguments

| Property | Type | Description |
|----------|------|-------------|
| `context` | `TContext` | Current context |
| `event` | `TEvent` | Event that triggered the action |
| `self` | `ActorRef` | Reference to the current actor |
| `system` | `ActorSystem` | The actor system |

## Usage

### Static Values

```typescript
assign({ count: 0 })
assign({ name: "default", active: false })
```

### Dynamic Values from Context

```typescript
assign({
  count: ({ context }) => context.count + 1
})

assign({
  total: ({ context }) => context.items.reduce((sum, item) => sum + item.price, 0)
})
```

### Values from Event

```typescript
assign({
  name: ({ event }) => event.type === "SET_NAME" ? event.name : ""
})

assign({
  items: ({ context, event }) => {
    if (event.type === "ADD_ITEM") {
      return [...context.items, event.item]
    }
    return context.items
  }
})
```

### Multiple Properties

```typescript
assign({
  count: ({ context }) => context.count + 1,
  lastUpdated: () => Date.now(),
  history: ({ context }) => [...context.history, context.count]
})
```

### Full Context Replacement

```typescript
assign(({ context, event }) => {
  if (event.type === "RESET") {
    return { count: 0, name: "", items: [] }
  }
  return context
})
```

## Examples

### Counter

```typescript
const counterMachine = setup({
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
const formMachine = setup({
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
}).createMachine({ /* ... */ })
```

### Immutable Updates

```typescript
// Adding to array
assign({
  items: ({ context, event }) => [...context.items, event.item]
})

// Removing from array
assign({
  items: ({ context, event }) =>
    context.items.filter(item => item.id !== event.itemId)
})

// Updating array item
assign({
  items: ({ context, event }) =>
    context.items.map(item =>
      item.id === event.itemId ? { ...item, ...event.updates } : item
    )
})

// Updating nested object
assign({
  user: ({ context, event }) => ({
    ...context.user,
    profile: {
      ...context.user?.profile,
      name: event.name
    }
  })
})
```

## Notes

- `assign` always returns a new context object (immutable update)
- Property assigners are evaluated in order
- Later assignments can access results of earlier assignments in the same `assign` call
- Always handle the possibility that the event type doesn't match when using event data
- Use TypeScript's type narrowing for type-safe event access

## Common Patterns

### Type-Safe Event Access

```typescript
assign({
  value: ({ event }) => {
    // Type narrowing
    if (event.type === "SET_VALUE") {
      return event.value
    }
    return undefined
  }
})

// Or with a type guard
assign({
  value: ({ event }) =>
    event.type === "SET_VALUE" ? event.value : undefined
})
```

### Conditional Assignment

```typescript
assign({
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
```

## See Also

- [Actions Overview](./index.md)
- [How to Update Context](../how-to/update-context.md)
