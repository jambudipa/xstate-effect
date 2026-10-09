# @jambudipa/xstate-effect Documentation

XState reimagined with Effect-TS: Type-safe, composable state machines with first-class support for effects, concurrency, and the Effect ecosystem.

## Documentation Structure

This documentation follows the [Diataxis](https://diataxis.fr/) framework, organizing content into four distinct categories based on user needs:

| Section | Purpose | Start here if you want to... |
|---------|---------|------------------------------|
| [Tutorials](./tutorials/) | Learning-oriented | Learn the basics through hands-on examples |
| [How-to Guides](./how-to/) | Task-oriented | Accomplish a specific goal |
| [Reference](./reference/) | Information-oriented | Look up technical details |
| [Explanation](./explanation/) | Understanding-oriented | Understand concepts and architecture |

## Quick Start

```typescript
import { setup, createActor, assign } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

// Define a simple counter machine
const counterMachine = setup({
  types: {} as {
    context: { count: number }
    events: { type: "INCREMENT" } | { type: "DECREMENT" }
  },
  actions: {
    increment: assign({ count: ({ context }) => context.count + 1 }),
    decrement: assign({ count: ({ context }) => context.count - 1 })
  }
}).createMachine({
  id: "counter",
  initial: "active",
  context: { count: 0 },
  states: {
    active: {
      on: {
        INCREMENT: { actions: "increment" },
        DECREMENT: { actions: "decrement" }
      }
    }
  }
})

// Run the machine
const program = Effect.gen(function* () {
  const actor = yield* createActor(counterMachine)
  yield* actor.start()
  yield* actor.send({ type: "INCREMENT" })
  yield* actor.send({ type: "INCREMENT" })
  const snapshot = yield* actor.getSnapshot()
  console.log(snapshot.context.count) // 2
})

void Effect.runPromise(program)
```

## What is @jambudipa/xstate-effect?

This package is a ground-up implementation of XState's state machine concepts using Effect-TS. It provides:

- **Type-safe state machines** - Full TypeScript inference for context, events, and actions
- **Effect integration** - Actions, guards, and actors are Effect-native
- **Actor model** - First-class support for spawning and communicating with child actors
- **Composable** - Build complex systems from simple, reusable pieces
- **Testable** - Deterministic testing with simulated clocks and snapshot assertions

## Installation

```bash
npm install @jambudipa/xstate-effect effect
```

## Next Steps

- **New to state machines?** Start with the [First State Machine Tutorial](./tutorials/01-first-state-machine.md)
- **Know XState?** Read [XState to Effect Migration](./explanation/xstate-migration.md)
- **Building something specific?** Browse the [How-to Guides](./how-to/)
- **Need API details?** Check the [Reference](./reference/)
