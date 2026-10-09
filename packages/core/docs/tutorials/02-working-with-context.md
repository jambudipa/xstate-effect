# Tutorial 2: Working with Context

In the previous tutorial, you built a simple toggle switch. Now you'll learn how to add data to your machines using **context** - the internal data store of a state machine.

## What You'll Learn

- How to define typed context
- How to initialize context
- How to update context with the `assign` action
- How to access context in snapshots

## The Counter Machine

We'll build a counter that can increment, decrement, and reset. The count value will be stored in context.

## Step 1: Define Context Types

First, define the shape of your context in the `types` object:

```typescript
import { setup, createActor as _createActor, assign as _assign } from "@jambudipa/xstate-effect"
import { Effect as _Effect } from "effect"

const _counterMachine = setup({
  types: {} as {
    context: { count: number }
    events:
      | { type: "INCREMENT" }
      | { type: "DECREMENT" }
      | { type: "RESET" }
  }
}).createMachine({
  id: "counter",
  initial: "active",
  context: { count: 0 },  // Initial context value
  states: {
    active: {
      on: {
        INCREMENT: { /* we'll add actions here */ },
        DECREMENT: { /* we'll add actions here */ },
        RESET: { /* we'll add actions here */ }
      }
    }
  }
})
```

The `context` type defines:
- `count: number` - the current count value

The initial context is set in `createMachine`:
- `context: { count: 0 }` - starts at zero

## Step 2: Update Context with assign

The `assign` action updates context. Import it and add actions to your transitions:

```typescript
import { setup, createActor as _createActor, assign } from "@jambudipa/xstate-effect"
import { Effect as _Effect } from "effect"

const _counterMachine = setup({
  types: {} as {
    context: { count: number }
    events:
      | { type: "INCREMENT" }
      | { type: "DECREMENT" }
      | { type: "RESET" }
  }
}).createMachine({
  id: "counter",
  initial: "active",
  context: { count: 0 },
  states: {
    active: {
      on: {
        INCREMENT: {
          actions: assign({ count: ({ context }) => context.count + 1 })
        },
        DECREMENT: {
          actions: assign({ count: ({ context }) => context.count - 1 })
        },
        RESET: {
          actions: assign({ count: 0 })
        }
      }
    }
  }
})
```

### The assign Action

`assign` can be used in two ways:

**Static assignment** - set a fixed value:
```typescript
assign({ count: 0 })
```

**Dynamic assignment** - compute the new value:
```typescript
assign({ count: ({ context }) => context.count + 1 })
```

The function receives an object with:
- `context`: The current context
- `event`: The event that triggered the transition

## Step 3: Access Event Data

Events can carry data. Let's add an `ADD` event that specifies how much to add:

```typescript
const _counterMachine = setup({
  types: {} as {
    context: { count: number }
    events:
      | { type: "INCREMENT" }
      | { type: "DECREMENT" }
      | { type: "RESET" }
      | { type: "ADD"; amount: number }
  }
}).createMachine({
  id: "counter",
  initial: "active",
  context: { count: 0 },
  states: {
    active: {
      on: {
        INCREMENT: {
          actions: assign({ count: ({ context }) => context.count + 1 })
        },
        DECREMENT: {
          actions: assign({ count: ({ context }) => context.count - 1 })
        },
        RESET: {
          actions: assign({ count: 0 })
        },
        ADD: {
          actions: assign({
            count: ({ context, event }) => context.count + event.amount
          })
        }
      }
    }
  }
})
```

Now you can send events with data:

```typescript
yield* actor.send({ type: "ADD", amount: 5 })
```

## Step 4: Multiple Context Properties

Context can have multiple properties:

```typescript
const _counterMachine = setup({
  types: {} as {
    context: {
      count: number
      min: number
      max: number
      history: number[]
    }
    events:
      | { type: "INCREMENT" }
      | { type: "DECREMENT" }
      | { type: "RESET" }
  }
}).createMachine({
  id: "counter",
  initial: "active",
  context: {
    count: 0,
    min: 0,
    max: 10,
    history: []
  },
  states: {
    active: {
      on: {
        INCREMENT: {
          actions: assign({
            count: ({ context }) => Math.min(context.count + 1, context.max),
            history: ({ context }) => [...context.history, context.count]
          })
        },
        DECREMENT: {
          actions: assign({
            count: ({ context }) => Math.max(context.count - 1, context.min),
            history: ({ context }) => [...context.history, context.count]
          })
        },
        RESET: {
          actions: assign({
            count: 0,
            history: []
          })
        }
      }
    }
  }
})
```

## Step 5: Named Actions with setup

For cleaner code, define actions in the `setup` function:

```typescript
const _counterMachine = setup({
  types: {} as {
    context: { count: number }
    events:
      | { type: "INCREMENT" }
      | { type: "DECREMENT" }
      | { type: "RESET" }
  },
  actions: {
    increment: assign({ count: ({ context }) => context.count + 1 }),
    decrement: assign({ count: ({ context }) => context.count - 1 }),
    reset: assign({ count: 0 })
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
        RESET: { actions: "reset" }
      }
    }
  }
})
```

This approach:
- Makes the machine definition cleaner
- Allows action reuse across transitions
- Keeps logic organized

## Complete Example

```typescript
import { setup, createActor, assign } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

const counterMachine = setup({
  types: {} as {
    context: { count: number }
    events:
      | { type: "INCREMENT" }
      | { type: "DECREMENT" }
      | { type: "RESET" }
      | { type: "ADD"; amount: number }
  },
  actions: {
    increment: assign({ count: ({ context }) => context.count + 1 }),
    decrement: assign({ count: ({ context }) => context.count - 1 }),
    reset: assign({ count: 0 }),
    add: assign({ count: ({ context, event }) => {
      if (event.type === "ADD") {
        return context.count + event.amount
      }
      return context.count
    }})
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
        RESET: { actions: "reset" },
        ADD: { actions: "add" }
      }
    }
  }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(counterMachine)
  yield* actor.start()

  let snapshot = yield* actor.getSnapshot()
  console.log(`Initial count: ${snapshot.context.count}`) // 0

  yield* actor.send({ type: "INCREMENT" })
  yield* actor.send({ type: "INCREMENT" })
  yield* actor.send({ type: "INCREMENT" })

  snapshot = yield* actor.getSnapshot()
  console.log(`After 3 increments: ${snapshot.context.count}`) // 3

  yield* actor.send({ type: "ADD", amount: 10 })

  snapshot = yield* actor.getSnapshot()
  console.log(`After adding 10: ${snapshot.context.count}`) // 13

  yield* actor.send({ type: "RESET" })

  snapshot = yield* actor.getSnapshot()
  console.log(`After reset: ${snapshot.context.count}`) // 0
})

void Effect.runPromise(program)
```

## Exercises

1. **Bounded counter**: Add `min` and `max` to context. Prevent the count from going below min or above max.

2. **Undo feature**: Store history in context. Add an `UNDO` event that restores the previous count.

3. **Step size**: Add a `step` property to context. Use it in increment/decrement instead of hardcoding 1.

## Key Takeaways

- **Context** stores the data associated with a machine
- **assign** is the primary way to update context
- assign can use static values or functions that receive context and event
- Events can carry additional data (payload)
- Named actions in `setup` keep machines organized

## What's Next

In the [next tutorial](./03-guards-and-transitions.md), you'll learn how to use guards to conditionally allow or prevent transitions.
