# Tutorial 1: Your First State Machine

In this tutorial, you'll build a simple toggle switch - a light that can be turned on and off. This will teach you the fundamental concepts of state machines in @jambudipa/xstate-effect.

## What You'll Learn

- How to define a state machine with `setup` and `createMachine`
- How to create and run an actor
- How to send events to trigger transitions
- How to read the current state

## Prerequisites

Create a new project and install the dependencies:

```bash
mkdir my-state-machine
cd my-state-machine
npm init -y
npm install @jambudipa/xstate-effect effect typescript
```

## Step 1: Define the Machine

A state machine describes all possible states and the events that cause transitions between them. Let's define a toggle switch:

```typescript
// toggle.ts
import { setup } from "@jambudipa/xstate-effect"

const _toggleMachine = setup({
  types: {} as {
    context: {}
    events: { type: "TOGGLE" }
  }
}).createMachine({
  id: "toggle",
  initial: "inactive",
  context: {},
  states: {
    inactive: {
      on: {
        TOGGLE: { target: "active" }
      }
    },
    active: {
      on: {
        TOGGLE: { target: "inactive" }
      }
    }
  }
})
```

Let's break this down:

### The `setup` Function

```typescript
import { setup } from "@jambudipa/xstate-effect"

export const toggleSetup = setup({
  types: {} as {
    context: {}
    events: { type: "TOGGLE" }
  }
})
```

The `setup` function creates a type-safe factory for your machine. The `types` object defines:
- `context`: The data the machine holds (empty for now)
- `events`: The events the machine can receive (just `TOGGLE`)

### The `createMachine` Method

```typescript
import { setup } from "@jambudipa/xstate-effect"

export const toggleMachine = setup({
  types: {} as {
    context: {}
    events: { type: "TOGGLE" }
  }
}).createMachine({
  id: "toggle",
  initial: "inactive",
  context: {},
  states: {
    // The next section adds the transitions
    inactive: {},
    active: {}
  }
})
```

Call `createMachine` on the result of `setup`. This creates the actual machine definition:
- `id`: A unique identifier for the machine
- `initial`: The starting state
- `context`: The initial data
- `states`: The possible states and their transitions

### State Definitions

```typescript
import { setup } from "@jambudipa/xstate-effect"

export const toggleMachine = setup({
  types: {} as {
    context: {}
    events: { type: "TOGGLE" }
  }
}).createMachine({
  id: "toggle",
  initial: "inactive",
  context: {},
  states: {
    inactive: {
      on: {
        TOGGLE: { target: "active" }
      }
    },
    active: {
      on: {
        TOGGLE: { target: "inactive" }
      }
    }
  }
})
```

Each state defines which events it responds to in the `on` property. When a `TOGGLE` event is received:
- In `inactive` state → transition to `active`
- In `active` state → transition to `inactive`

## Step 2: Create and Run an Actor

A machine is just a definition - like a blueprint. To actually run it, we need to create an **actor**:

```typescript
import { setup, createActor } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

const toggleMachine = setup({
  types: {} as {
    context: {}
    events: { type: "TOGGLE" }
  }
}).createMachine({
  id: "toggle",
  initial: "inactive",
  context: {},
  states: {
    inactive: {
      on: {
        TOGGLE: { target: "active" }
      }
    },
    active: {
      on: {
        TOGGLE: { target: "inactive" }
      }
    }
  }
})

const program = Effect.gen(function* () {
  // Create an actor from the machine
  const actor = yield* createActor(toggleMachine)

  // Start the actor
  yield* actor.start

  // Get the initial state
  const initialSnapshot = yield* actor.getSnapshot
  console.log("Initial state:", initialSnapshot.value)
  // Output: Initial state: inactive

  // Send a TOGGLE event
  yield* actor.send({ type: "TOGGLE" })

  // Check the new state
  const afterToggle = yield* actor.getSnapshot
  console.log("After toggle:", afterToggle.value)
  // Output: After toggle: active

  // Toggle again
  yield* actor.send({ type: "TOGGLE" })

  const final = yield* actor.getSnapshot
  console.log("Final state:", final.value)
  // Output: Final state: inactive
})

// Run the program. Effect.scoped gives the actor a scope: when the program ends, the scope
// closes and the actor stops.
void Effect.runPromise(Effect.scoped(program))
```

### Key Concepts

1. **`createActor(machine)`**: An Effect that creates a new actor from a machine definition. The actor lives in the caller's `Scope`, so wrap the program in `Effect.scoped`
2. **`actor.start`**: An Effect that starts the actor and enters the initial state
3. **`actor.send(event)`**: Returns an Effect that sends an event to the actor. The Effect completes when the actor has processed the event
4. **`actor.getSnapshot`**: An Effect that gives the current state of the actor

`start`, `getSnapshot` and the result of `send` are Effects, not functions that return Promises: run each one with `yield*` inside `Effect.gen`.

## Step 3: Understanding Snapshots

The snapshot contains all information about the actor's current state:

```typescript
import { setup, createActor } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

const toggleMachine = setup({
  types: {} as {
    context: {}
    events: { type: "TOGGLE" }
  }
}).createMachine({
  id: "toggle",
  initial: "inactive",
  context: {},
  states: {
    inactive: { on: { TOGGLE: { target: "active" } } },
    active: { on: { TOGGLE: { target: "inactive" } } }
  }
})

export const inspectSnapshot = Effect.gen(function* () {
  const actor = yield* createActor(toggleMachine)
  yield* actor.start

  const snapshot = yield* actor.getSnapshot

  // The current state value
  console.log(snapshot.value) // "inactive" | "active"

  // The context (data)
  console.log(snapshot.context) // {}

  // The status of the actor
  console.log(snapshot.status) // "active" | "done" | "error" | "stopped"
})
```

## Complete Example

Here's the complete working code:

```typescript
// toggle.ts
import { setup, createActor } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

// 1. Define the machine
const toggleMachine = setup({
  types: {} as {
    context: {}
    events: { type: "TOGGLE" }
  }
}).createMachine({
  id: "toggle",
  initial: "inactive",
  context: {},
  states: {
    inactive: {
      on: {
        TOGGLE: { target: "active" }
      }
    },
    active: {
      on: {
        TOGGLE: { target: "inactive" }
      }
    }
  }
})

// 2. Create and run an actor
const program = Effect.gen(function* () {
  const actor = yield* createActor(toggleMachine)
  yield* actor.start

  console.log("Toggle machine started!")

  // Get initial state
  let snapshot = yield* actor.getSnapshot
  console.log(`State: ${snapshot.value}`) // inactive

  // Toggle on
  yield* actor.send({ type: "TOGGLE" })
  snapshot = yield* actor.getSnapshot
  console.log(`State: ${snapshot.value}`) // active

  // Toggle off
  yield* actor.send({ type: "TOGGLE" })
  snapshot = yield* actor.getSnapshot
  console.log(`State: ${snapshot.value}`) // inactive
})

// 3. Run the program in a scope; the actor stops when the scope closes
void Effect.runPromise(Effect.scoped(program)).then(() => {
  console.log("Done!")
})
```

Run it:

```bash
npx tsx toggle.ts
```

## Exercises

1. **Add a third state**: Modify the machine to have three states: `off`, `dim`, and `bright`. The `TOGGLE` event should cycle through them.

2. **Add multiple events**: Add `TURN_ON` and `TURN_OFF` events that go directly to specific states regardless of the current state.

3. **Explore the snapshot**: Log the entire snapshot object and explore its properties.

## Key Takeaways

- A **machine** is a definition (blueprint) of states and transitions
- An **actor** is a running instance of a machine
- **Events** trigger transitions between states
- **Snapshots** represent the current state of an actor
- Everything runs inside `Effect.gen` for type-safe, composable code

## What's Next

In the [next tutorial](./02-working-with-context.md), you'll learn how to add data to your machines with context and the `assign` action.
