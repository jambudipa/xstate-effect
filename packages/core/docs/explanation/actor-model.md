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
// Actor A cannot do this:
actorB.snapshot.context.count = 5  // ❌ No direct access

// Actor A must send a message:
yield* send(actorBRef, { type: "SET_COUNT", value: 5 })  // ✓
```

### Sequential Processing

An actor processes one message at a time. This eliminates race conditions within a single actor.

```typescript
// These events are processed one at a time
yield* actor.send({ type: "INCREMENT" })
yield* actor.send({ type: "INCREMENT" })
yield* actor.send({ type: "INCREMENT" })
// count is guaranteed to be 3
```

### Location Transparency

Actors communicate via references (ActorRef). The sender doesn't need to know where the actor lives.

```typescript
// Send to any actor reference
yield* send(someActorRef, { type: "PING" })
// Works whether the actor is local or remote
```

## Actors in @jambudipa/xstate-effect

### Actor Creation

```typescript
import { createActor } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

const _program = Effect.gen(function* () {
  // Create an actor from a machine
  const _actor = yield* createActor(myMachine, {
    id: "my-actor",  // Optional ID
    input: { initialValue: 10 }  // Optional input
  })

  // Start the actor
  yield* actor.start()

  // Actor is now running
})
```

### ActorRef

An `ActorRef` is a reference to an actor. It provides methods to interact with the actor:

```typescript
interface _ActorRef<TSnapshot, TEvent> {
  // Unique identifier
  id: string

  // Get current snapshot
  getSnapshot(): Effect<TSnapshot>

  // Send an event
  send(event: TEvent): Effect<void>
}
```

### The Actor System

All actors exist within an `ActorSystem` that provides:

- Actor registration and lookup
- Event relay between actors
- Inspection and debugging
- Scheduling services

```typescript
// The system is provided automatically
const _program = Effect.gen(function* () {
  const actor = yield* createActor(machine)
  // Actor is registered with the system
  yield* actor.start()
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
import { spawnChild, fromPromise } from "@jambudipa/xstate-effect"

const _parentMachine = setup({
  actors: {
    fetchData: fromPromise(async ({ input }) => {
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

**Parent to Child** - Use `sendTo`:

```typescript
sendTo("childActorId", { type: "PING" })
```

**Child to Parent** - Use `sendParent`:

```typescript
sendParent({ type: "CHILD_DONE", result: data })
```

**Between Siblings** - Route through parent or use actor IDs:

```typescript
sendTo("sibling-actor-id", { type: "DATA", payload })
```

## Types of Actors

### State Machine Actors

The primary actor type - a full state machine:

```typescript
const machine = setup({ /* ... */ }).createMachine({ /* ... */ })
const _actor = yield* createActor(machine)
```

### Promise Actors

Wrap a Promise-returning function:

```typescript
const _fetchActor = fromPromise(async ({ input }) => {
  const response = await fetch(input.url)
  return response.json()
})
```

### Effect Actors

Wrap an Effect:

```typescript
const _effectActor = fromEffect(({ _input }) =>
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
const _callbackActor = fromCallback(({ sendBack, receive }) => {
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
const _transitionActor = fromTransition(
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
const _program = Effect.gen(function* () {
  // Created
  const actor = yield* createActor(machine)

  // Started
  yield* actor.start()

  let _snapshot = yield* actor.getSnapshot()
  // _snapshot.status === "active"

  // Send events while active
  yield* actor.send({ type: "COMPLETE" })

  _snapshot = yield* actor.getSnapshot()
  // _snapshot.status === "done" (if reached final state)

  // Stop explicitly
  yield* actor.stop()
  // _snapshot.status === "stopped"
})
```

## Supervision

Parents can supervise children and respond to their lifecycle events:

```typescript
states: {
  running: {
    invoke: {
      src: "childMachine",
      onDone: {
        // Child reached final state
        target: "childComplete",
        actions: ({ event }) => console.log("Child output:", event.output)
      },
      onError: {
        // Child had an error
        target: "childFailed",
        actions: ({ event }) => console.log("Child error:", event.error)
      }
    }
  }
}
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
const _coordinatorMachine = setup({
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
const _sagaMachine = setup({
  actors: {
    reserveInventory: fromPromise(/* ... */),
    chargePayment: fromPromise(/* ... */),
    sendConfirmation: fromPromise(/* ... */)
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
- [Actor Lifecycle](./actor-lifecycle.md)
- [Spawning Actors How-to](../how-to/spawn-actors.md)
