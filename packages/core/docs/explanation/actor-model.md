# The Actor Model

The actor model is a mathematical model of concurrent computation that treats "actors" as the fundamental unit of computation. @jambudipa/xstate-effect implements an actor system on top of its state machine foundation.

## What is an Actor?

An **actor** is an independent entity that:

1. Has its own private state (snapshot)
2. Receives messages (events)
3. Processes messages one at a time
4. Can send messages to other actors
5. Can create new actors

```
┌─────────────────────────────────────────┐
│                  Actor                   │
│  ┌─────────┐   ┌─────────────────────┐  │
│  │ Mailbox │──▶│     Behavior        │  │
│  │ (Queue) │   │  - Process event    │  │
│  └─────────┘   │  - Update state     │  │
│                │  - Send messages    │  │
│       ▲        │  - Spawn children   │  │
│       │        └─────────────────────┘  │
│    Events                               │
│    from                    Snapshot     │
│    other                   (State)      │
│    actors                               │
└─────────────────────────────────────────┘
```

## Key Properties

### Encapsulation

Each actor encapsulates its own state. Other actors cannot directly read or modify it - they can only send messages.

```typescript
import { Effect } from "effect"
import { assign, createActor, send, setup } from "@jambudipa/xstate-effect"

const counterMachine = setup({
  types: {} as {
    context: { count: number }
    events: { type: "SET_COUNT"; value: number }
  }
}).createMachine({
  context: { count: 0 },
  on: {
    SET_COUNT: { actions: assign({ count: ({ event }) => event.value }) }
  }
})

export const actorA = Effect.gen(function* () {
  const actorB = yield* createActor(counterMachine)
  yield* actorB.start

  // Actor A cannot do this:
  // actorB.snapshot.context.count = 5  // ❌ No direct access

  // Actor A must send a message:
  yield* send(actorB, { type: "SET_COUNT", value: 5 })  // ✓
})
```

### Sequential Processing

An actor processes one message at a time. This eliminates race conditions within a single actor.

```typescript
import { Effect } from "effect"
import { assign, createActor, setup } from "@jambudipa/xstate-effect"

const counterMachine = setup({
  types: {} as { context: { count: number }; events: { type: "INCREMENT" } }
}).createMachine({
  context: { count: 0 },
  on: {
    INCREMENT: { actions: assign({ count: ({ context }) => context.count + 1 }) }
  }
})

export const program = Effect.gen(function* () {
  const actor = yield* createActor(counterMachine)
  yield* actor.start

  // These events are processed one at a time
  yield* actor.send({ type: "INCREMENT" })
  yield* actor.send({ type: "INCREMENT" })
  yield* actor.send({ type: "INCREMENT" })

  const snapshot = yield* actor.getSnapshot
  console.log(snapshot.context.count) // count is guaranteed to be 3
})
```

### Location Transparency

Actors communicate via references (ActorRef). The sender doesn't need to know where the actor lives.

```typescript
import { send, type ActorRef, type Snapshot } from "@jambudipa/xstate-effect"

// Send to any actor reference
export const ping = (someActorRef: ActorRef<Snapshot, { type: "PING" }>) =>
  send(someActorRef, { type: "PING" })
// Works for any actor that takes PING, whatever logic runs it
```

## Actors in @jambudipa/xstate-effect

### Actor Creation

```typescript
import { createActor, setup } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

const myMachine = setup({
  types: {} as { context: { value: number }; input: { initialValue: number } }
}).createMachine({
  context: ({ input }) => ({ value: input.initialValue })
})

export const program = Effect.gen(function* () {
  // Create an actor from a machine
  const actor = yield* createActor(myMachine, {
    id: "my-actor",  // Optional ID
    input: { initialValue: 10 }  // Input, required because the machine declares one
  })

  // Start the actor
  yield* actor.start

  // Actor is now running
})
```

### ActorRef

An `ActorRef` is a reference to an actor. It provides Effects to interact with the actor. This
is a simplified view of its main members:

```typescript
import type { Effect } from "effect"
import type { EventObject, Snapshot } from "@jambudipa/xstate-effect"

export interface ActorRefSketch<TSnapshot extends Snapshot, TEvent extends EventObject> {
  // Unique identifier
  readonly id: string

  // Get current snapshot
  readonly getSnapshot: Effect.Effect<TSnapshot>

  // Send an event
  readonly send: (event: TEvent) => Effect.Effect<void>
}
```

### The Actor System

All actors exist within an `ActorSystem` that provides:

- Actor registration and lookup
- Event relay between actors
- Inspection and debugging
- Scheduling services

```typescript
import { Effect } from "effect"
import { createActor, createMachine } from "@jambudipa/xstate-effect"

const machine = createMachine({
  initial: "idle",
  states: { idle: {} }
})

// The system is provided automatically
export const program = Effect.gen(function* () {
  const actor = yield* createActor(machine)
  // Actor is registered with the system
  yield* actor.start
})
```

## Parent-Child Relationships

Actors form hierarchies. A parent actor can spawn children, and children can send events to their parent.

```
          ┌─────────────────┐
          │   Root Actor    │
          │   (Machine)     │
          └────────┬────────┘
                   │ spawns
         ┌─────────┴─────────┐
         │                   │
    ┌────┴────┐        ┌────┴────┐
    │ Child A │        │ Child B │
    │ (fetch) │        │ (timer) │
    └─────────┘        └─────────┘
```

### Spawning Children

```typescript
import { fromPromise, setup, spawnChild } from "@jambudipa/xstate-effect"

export const parentMachine = setup({
  actors: {
    fetchData: fromPromise(async ({ input }: { input: { url: string } }): Promise<unknown> => {
      const response = await fetch(input.url)
      return response.json()
    })
  }
}).createMachine({
  id: "parent",
  initial: "idle",
  context: {},
  states: {
    idle: {
      on: {
        FETCH: {
          actions: spawnChild("fetchData", {
            id: "fetcher",
            input: { url: "/api/data" }
          })
        }
      }
    }
  }
})
```

### Communication

**Parent to Child** - Use `sendTo` with the child's ID:

```typescript
import { sendTo } from "@jambudipa/xstate-effect"

// An action that sends PING to the child with the ID "childActorId"
export const pingChild = sendTo("childActorId", { type: "PING" })
```

**Child to Parent** - Use `sendParent`:

```typescript
import { sendParent, setup } from "@jambudipa/xstate-effect"

export const childMachine = setup({
  types: {} as { context: { data: string } }
}).createMachine({
  context: { data: "report.pdf" },
  entry: sendParent(({ context }) => ({ type: "CHILD_DONE", result: context.data }))
})
```

**Between Siblings** - Route through the parent, or look the sibling up by the `systemId` it was
created with:

```typescript
import { Effect, Option } from "effect"
import { sendTo } from "@jambudipa/xstate-effect"

// An action that sends DATA to the actor registered as "sibling-actor-id".
// `system.get` is an Effect that never waits, so the target function runs it at once.
export const sendToSibling = sendTo(
  ({ system }) => Option.getOrUndefined(Effect.runSync(system.get("sibling-actor-id"))),
  { type: "DATA", payload: [1, 2, 3] }
)
```

## Types of Actors

### State Machine Actors

The primary actor type - a full state machine:

```typescript
import { Effect } from "effect"
import { createActor, setup } from "@jambudipa/xstate-effect"

const machine = setup({
  types: {} as { events: { type: "NEXT" } }
}).createMachine({
  initial: "first",
  states: {
    first: { on: { NEXT: "second" } },
    second: {}
  }
})

export const program = Effect.gen(function* () {
  const actor = yield* createActor(machine)
  yield* actor.start
})
```

### Promise Actors

Wrap a Promise-returning function:

```typescript
import { fromPromise } from "@jambudipa/xstate-effect"

export const fetchActor = fromPromise(async ({ input }: { input: { url: string } }): Promise<unknown> => {
  const response = await fetch(input.url)
  return response.json()
})
```

### Effect Actors

Wrap an Effect:

```typescript
import { Console, Effect } from "effect"
import { fromEffect } from "@jambudipa/xstate-effect"

export const effectActor = fromEffect(() =>
  Effect.gen(function* () {
    yield* Console.log("Processing...")
    yield* Effect.sleep("1 second")
    return { result: "done" }
  })
)
```

### Callback Actors

Long-running processes that emit events:

```typescript
import { fromCallback } from "@jambudipa/xstate-effect"

export const callbackActor = fromCallback(({ sendBack, receive }) => {
  const interval = setInterval(() => {
    sendBack({ type: "TICK" })
  }, 1000)

  receive((event) => {
    if (event.type === "STOP") {
      clearInterval(interval)
    }
  })

  return () => clearInterval(interval)
})
```

### Transition Actors

Minimal actors with a transition function:

```typescript
import { fromTransition } from "@jambudipa/xstate-effect"

export const transitionActor = fromTransition(
  (state, event) => {
    switch (event.type) {
      case "INCREMENT":
        return { count: state.count + 1 }
      default:
        return state
    }
  },
  { count: 0 }  // Initial state
)
```

## Actor Lifecycle

```
Created ──▶ Started ──▶ Active ──▶ Stopped
              │            │
              │            ▼
              │         Error
              │            │
              └────────────┘
                   │
                   ▼
                 Done
```

### Lifecycle Stages

1. **Created**: Actor exists but hasn't started
2. **Started**: Actor is initialized and processing events
3. **Active**: Normal operation
4. **Done**: Actor reached a final state
5. **Error**: Actor encountered an error
6. **Stopped**: Actor was explicitly stopped

### Lifecycle in Code

```typescript
import { Effect } from "effect"
import { createActor, createMachine } from "@jambudipa/xstate-effect"

const machine = createMachine({
  initial: "working",
  states: {
    working: { on: { COMPLETE: "finished" } },
    finished: { type: "final" }
  }
})

export const program = Effect.gen(function* () {
  // Created
  const actor = yield* createActor(machine)

  // Started
  yield* actor.start

  let snapshot = yield* actor.getSnapshot
  console.log(snapshot.status) // "active"

  // Send events while active
  yield* actor.send({ type: "COMPLETE" })

  snapshot = yield* actor.getSnapshot
  console.log(snapshot.status) // "done": the machine reached its final state

  // Stop explicitly: a second actor, stopped before it is done
  const other = yield* createActor(machine)
  yield* other.start
  yield* other.stop

  snapshot = yield* other.getSnapshot
  console.log(snapshot.status) // "stopped"
})
```

## Supervision

Parents can supervise children and respond to their lifecycle events:

```typescript
import { Option } from "effect"
import { createMachine, setup } from "@jambudipa/xstate-effect"

const childMachine = createMachine({
  initial: "working",
  states: {
    working: { on: { FINISH: "finished" } },
    finished: { type: "final" }
  },
  output: { result: 42 }
})

export const parentMachine = setup({
  actors: { childMachine }
}).createMachine({
  initial: "running",
  states: {
    running: {
      invoke: {
        src: "childMachine",
        onDone: {
          // Child reached final state; its output arrives as an Option
          target: "childComplete",
          actions: ({ event }) => console.log("Child output:", Option.getOrUndefined(event.output))
        },
        onError: {
          // Child had an error
          target: "childFailed",
          actions: ({ event }) => console.log("Child error:", event.error)
        }
      }
    },
    childComplete: {},
    childFailed: {}
  }
})
```

## Benefits of the Actor Model

### 1. Isolation

Each actor's state is isolated. Bugs in one actor don't corrupt another's state.

### 2. Concurrency

Actors naturally model concurrent systems. Each actor processes independently.

### 3. Scalability

The message-passing model scales well - actors can be distributed across processes or machines.

### 4. Fault Tolerance

Actor hierarchies enable supervision strategies - parents can restart failed children.

### 5. Testability

Actors can be tested in isolation by sending events and checking responses.

## Common Patterns

### Coordinator Pattern

One actor coordinates multiple workers:

```typescript
import { assign, sendParent, setup, spawnChild } from "@jambudipa/xstate-effect"

interface Task { id: string; text: string }
interface TaskResult { taskId: string; text: string }

const workerMachine = setup({
  types: {} as { context: { task: Task }; input: { task: Task } }
}).createMachine({
  context: ({ input }) => ({ task: input.task }),
  entry: sendParent(({ context }) => ({
    type: "WORKER_DONE",
    result: { taskId: context.task.id, text: context.task.text.toUpperCase() }
  }))
})

export const coordinatorMachine = setup({
  types: {} as {
    context: { tasks: Task[]; results: TaskResult[] }
    events: { type: "ADD_TASK"; task: Task } | { type: "WORKER_DONE"; result: TaskResult }
  },
  actors: {
    worker: workerMachine
  }
}).createMachine({
  id: "coordinator",
  initial: "running",
  context: { tasks: [], results: [] },
  states: {
    running: {
      on: {
        ADD_TASK: {
          actions: [
            // Add to queue
            assign({ tasks: ({ context, event }) => [...context.tasks, event.task] }),
            // Spawn worker
            spawnChild("worker", {
              id: ({ event }) => `worker-${event.task.id}`,
              input: ({ event }) => ({ task: event.task })
            })
          ]
        },
        WORKER_DONE: {
          actions: assign({
            results: ({ context, event }) => [...context.results, event.result]
          })
        }
      }
    }
  }
})
```

### Saga Pattern

Coordinate a multi-step process with compensation:

```typescript
import { fromPromise, setup } from "@jambudipa/xstate-effect"

// Your own order service client
declare const orderApi: {
  reserveInventory: () => Promise<void>
  chargePayment: () => Promise<void>
  sendConfirmation: () => Promise<void>
  releaseInventory: () => Promise<void>
}

export const sagaMachine = setup({
  actors: {
    reserveInventory: fromPromise(() => orderApi.reserveInventory()),
    chargePayment: fromPromise(() => orderApi.chargePayment()),
    sendConfirmation: fromPromise(() => orderApi.sendConfirmation()),
    releaseInventory: fromPromise(() => orderApi.releaseInventory())
  }
}).createMachine({
  id: "orderSaga",
  initial: "reservingInventory",
  states: {
    reservingInventory: {
      invoke: {
        src: "reserveInventory",
        onDone: "chargingPayment",
        onError: "failed"
      }
    },
    chargingPayment: {
      invoke: {
        src: "chargePayment",
        onDone: "sendingConfirmation",
        onError: "compensatingInventory"  // Rollback
      }
    },
    sendingConfirmation: {
      invoke: {
        src: "sendConfirmation",
        onDone: "completed",
        onError: "completed"  // Best effort
      }
    },
    compensatingInventory: {
      // Rollback reservation
      invoke: {
        src: "releaseInventory",
        onDone: "failed"
      }
    },
    completed: { type: "final" },
    failed: { type: "final" }
  }
})
```

## Summary

The actor model in @jambudipa/xstate-effect provides:

- **Encapsulated state** - Each actor owns its data
- **Message passing** - Communication via events
- **Hierarchy** - Parent-child relationships
- **Lifecycle management** - Birth to death handling
- **Multiple actor types** - Machines, promises, effects, callbacks
- **Type safety** - Full TypeScript support

Combined with state machines, actors enable modeling complex, concurrent systems in a structured, maintainable way.

## Further Reading

- [What is a State Machine?](./state-machines.md)
- [Spawning Dynamic Actors](../tutorials/05-child-actors.md#step-4-spawning-dynamic-actors) - Step 4 of the child actors tutorial
