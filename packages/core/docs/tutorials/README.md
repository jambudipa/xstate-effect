# Tutorials

Tutorials are **learning-oriented** lessons that take you through a series of steps to complete a project. They focus on learning by doing and help you get started with @jambudipa/xstate-effect.

## Prerequisites

Before starting these tutorials, you should:

- Have Node.js 18+ installed
- Have basic familiarity with TypeScript
- Understand fundamental Effect concepts (`Effect.gen`, `yield*`, `Effect.runPromise`)

## Tutorials

### Getting Started

1. [Your First State Machine](./01-first-state-machine.md)
   Build a simple toggle machine and learn the fundamentals of state machine definition.

2. [Working with Context](./02-working-with-context.md)
   Add data to your machines with typed context and the assign action.

3. [Guards and Conditional Transitions](./03-guards-and-transitions.md)
   Control state transitions based on conditions.

4. [Side Effects with Actions](./04-side-effects.md)
   Execute effects when entering states, exiting states, or during transitions.

### Intermediate

5. [Child Actors](./05-child-actors.md)
   Spawn and communicate with child actors for parallel processing.

6. [Invoking Services](./06-invoking-services.md)
   Call async operations and handle their results.

7. [Testing State Machines](./07-testing.md)
   Write deterministic tests for your machines using the testing utilities.

### Advanced

8. [Hierarchical States](./08-hierarchical-states.md)
   Organize complex behavior with nested states.

9. [Parallel States](./09-parallel-states.md)
   Model independent concurrent regions.

10. [Building a Complete Application](./10-complete-application.md)
    Put it all together to build a real-world feature.

## How to Use These Tutorials

Each tutorial builds on the previous one. Work through them in order for the best learning experience. Each tutorial includes:

- **Goal**: What you'll learn
- **Code examples**: Fully working TypeScript code
- **Exercises**: Practice what you've learned
- **What's next**: Preview of the next tutorial

Start with [Your First State Machine](./01-first-state-machine.md) to begin your journey.
