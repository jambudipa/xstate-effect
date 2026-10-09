# Tutorial 5: Child Actors

State machines can spawn **child actors** to handle concurrent tasks, delegating work and receiving results. This tutorial teaches you the actor model within @jambudipa/xstate-effect.

## What You'll Learn

- How to define actor types with `fromPromise`, `fromEffect`, and `fromCallback`
- How to invoke actors from states
- How to spawn actors dynamically
- How to communicate between parent and child actors

## The Actor Model

In the actor model:
- **Actors** are independent units that process messages
- **Parent actors** can spawn **child actors**
- Actors communicate by sending events
- Each actor manages its own state

## Step 1: Invoking Services with fromPromise

The simplest actor wraps a Promise-returning function:

```typescript
import { setup, createActor, fromPromise, assign } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

// Define an actor that fetches user data
const fetchUserActor = fromPromise(async ({ input }: { input: { userId: string } }) => {
  const response = await fetch(`/api/users/${input.userId}`)
  return response.json()
})

const userMachine = setup({
  types: {} as {
    context: {
      userId: string
      user: { name: string; email: string } | null
      error: string | null
    }
    events: { type: "FETCH" } | { type: "RETRY" }
  },
  actors: {
    fetchUser: fetchUserActor
  },
  actions: {
    setUser: assign({
      user: ({ event }) => {
        if (event.type === "xstate.done.actor.fetchUser") {
          return event.output
        }
        return null
      }
    }),
    setError: assign({
      error: ({ event }) => {
        if (event.type === "xstate.error.actor.fetchUser") {
          return event.error.message
        }
        return null
      }
    })
  }
}).createMachine({
  id: "user",
  initial: "idle",
  context: {
    userId: "user-123",
    user: null,
    error: null
  },
  states: {
    idle: {
      on: { FETCH: "loading" }
    },
    loading: {
      invoke: {
        id: "fetchUser",
        src: "fetchUser",
        input: ({ context }) => ({ userId: context.userId }),
        onDone: {
          target: "success",
          actions: "setUser"
        },
        onError: {
          target: "failure",
          actions: "setError"
        }
      }
    },
    success: {
      on: { FETCH: "loading" }
    },
    failure: {
      on: { RETRY: "loading" }
    }
  }
})
```

### Key Concepts

- **`invoke`**: Starts an actor when entering the state
- **`src`**: References the actor defined in setup
- **`input`**: Data passed to the actor
- **`onDone`**: Transition when actor completes successfully
- **`onError`**: Transition when actor fails

## Step 2: Using fromEffect

For Effect-based async operations:

```typescript
import { fromEffect } from "@jambudipa/xstate-effect"
import { Effect, Console } from "effect"

const processDataActor = fromEffect(({ input }: { input: { data: string[] } }) =>
  Effect.gen(function* () {
    yield* Console.log(`Processing ${input.data.length} items...`)

    // Simulate processing
    yield* Effect.sleep("2 seconds")

    const results = input.data.map(item => item.toUpperCase())

    yield* Console.log("Processing complete!")
    return results
  })
)

const processingMachine = setup({
  types: {} as {
    context: {
      data: string[]
      results: string[]
    }
    events: { type: "START" }
  },
  actors: {
    processData: processDataActor
  }
}).createMachine({
  id: "processor",
  initial: "idle",
  context: { data: ["a", "b", "c"], results: [] },
  states: {
    idle: {
      on: { START: "processing" }
    },
    processing: {
      invoke: {
        src: "processData",
        input: ({ context }) => ({ data: context.data }),
        onDone: {
          target: "done",
          actions: assign({
            results: ({ event }) => event.output
          })
        }
      }
    },
    done: { type: "final" }
  }
})
```

## Step 3: Callback Actors

For long-running processes that emit multiple events:

```typescript
import { fromCallback } from "@jambudipa/xstate-effect"

const timerActor = fromCallback(({ sendBack, input }: {
  sendBack: (event: { type: "TICK"; elapsed: number }) => void
  input: { interval: number }
}) => {
  let elapsed = 0

  const intervalId = setInterval(() => {
    elapsed += input.interval
    sendBack({ type: "TICK", elapsed })
  }, input.interval)

  // Return cleanup function
  return () => clearInterval(intervalId)
})

const _timerMachine = setup({
  types: {} as {
    context: { elapsed: number }
    events: { type: "START" } | { type: "STOP" } | { type: "TICK"; elapsed: number }
  },
  actors: {
    timer: timerActor
  }
}).createMachine({
  id: "timer",
  initial: "stopped",
  context: { elapsed: 0 },
  states: {
    stopped: {
      on: { START: "running" }
    },
    running: {
      invoke: {
        src: "timer",
        input: { interval: 1000 }
      },
      on: {
        TICK: {
          actions: assign({
            elapsed: ({ event }) => event.elapsed
          })
        },
        STOP: "stopped"
      }
    }
  }
})
```

## Step 4: Spawning Dynamic Actors

Use `spawnChild` to create actors on-demand:

```typescript
import { setup, createActor, spawnChild, stopChild, fromPromise, assign } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

const downloadActor = fromPromise(async ({ input }: { input: { url: string } }) => {
  // Simulate download
  await new Promise(resolve => setTimeout(resolve, 2000))
  return { url: input.url, size: Math.floor(Math.random() * 1000) }
})

const downloadManagerMachine = setup({
  types: {} as {
    context: {
      downloads: Map<string, { url: string; status: "pending" | "complete" }>
    }
    events:
      | { type: "ADD_DOWNLOAD"; url: string; id: string }
      | { type: "CANCEL_DOWNLOAD"; id: string }
      | { type: "xstate.done.actor.*"; output: { url: string; size: number } }
  },
  actors: {
    download: downloadActor
  }
}).createMachine({
  id: "downloadManager",
  initial: "active",
  context: { downloads: new Map() },
  states: {
    active: {
      on: {
        ADD_DOWNLOAD: {
          actions: [
            // Add to tracking
            assign({
              downloads: ({ context, event }) => {
                const newDownloads = new Map(context.downloads)
                newDownloads.set(event.id, { url: event.url, status: "pending" })
                return newDownloads
              }
            }),
            // Spawn the download actor
            spawnChild("download", {
              id: ({ event }) => event.id,
              input: ({ event }) => ({ url: event.url })
            })
          ]
        },
        CANCEL_DOWNLOAD: {
          actions: [
            stopChild(({ event }) => event.id),
            assign({
              downloads: ({ context, event }) => {
                const newDownloads = new Map(context.downloads)
                newDownloads.delete(event.id)
                return newDownloads
              }
            })
          ]
        }
      }
    }
  }
})
```

## Step 5: Parent-Child Communication

### Child to Parent

Children automatically send done/error events. For custom events, use `sendParent`:

```typescript
const childMachine = setup({
  types: {} as {
    context: { progress: number }
    events: { type: "WORK" }
  }
}).createMachine({
  id: "child",
  initial: "working",
  context: { progress: 0 },
  states: {
    working: {
      entry: sendParent({ type: "CHILD_STARTED" }),
      on: {
        WORK: {
          actions: [
            assign({ progress: ({ context }) => context.progress + 10 }),
            sendParent(({ context }) => ({
              type: "CHILD_PROGRESS",
              progress: context.progress
            }))
          ]
        }
      }
    }
  }
})
```

### Parent to Child

Use `sendTo` with the child's ID:

```typescript
const _parentMachine = setup({
  types: {} as {
    context: {}
    events: { type: "TELL_CHILD_TO_WORK" }
  },
  actors: {
    child: childMachine
  }
}).createMachine({
  id: "parent",
  initial: "active",
  context: {},
  states: {
    active: {
      invoke: {
        id: "myChild",
        src: "child"
      },
      on: {
        TELL_CHILD_TO_WORK: {
          actions: sendTo("myChild", { type: "WORK" })
        },
        CHILD_PROGRESS: {
          actions: action("logProgress", ({ event }) =>
            Console.log(`Child progress: ${event.progress}%`)
          )
        }
      }
    }
  }
})
```

## Complete Example: Task Queue

```typescript
import { setup, createActor, fromEffect, spawnChild, assign, action } from "@jambudipa/xstate-effect"
import { Effect, Console } from "effect"

interface Task {
  id: string
  name: string
  status: "pending" | "running" | "complete" | "failed"
}

const taskWorker = fromEffect(({ input }: { input: { task: Task } }) =>
  Effect.gen(function* () {
    yield* Console.log(`Starting task: ${input.task.name}`)
    yield* Effect.sleep("1 second")

    // Simulate occasional failure
    if (Math.random() < 0.2) {
      yield* Effect.fail(new Error(`Task ${input.task.name} failed`))
    }

    yield* Console.log(`Completed task: ${input.task.name}`)
    return { taskId: input.task.id, result: "success" }
  })
)

const taskQueueMachine = setup({
  types: {} as {
    context: {
      tasks: Task[]
      maxConcurrent: number
      runningCount: number
    }
    events:
      | { type: "ADD_TASK"; task: Task }
      | { type: "PROCESS_NEXT" }
      | { type: `xstate.done.actor.task-${string}`; output: { taskId: string } }
      | { type: `xstate.error.actor.task-${string}`; error: Error }
  },
  actors: {
    taskWorker
  },
  actions: {
    addTask: assign({
      tasks: ({ context, event }) => {
        if (event.type !== "ADD_TASK") return context.tasks
        return [...context.tasks, event.task]
      }
    }),
    markComplete: assign({
      tasks: ({ context, event }) => {
        // Extract task ID from event
        const match = event.type.match(/xstate\.done\.actor\.task-(.+)/)
        if (!match) return context.tasks
        const taskId = match[1]
        return context.tasks.map(t =>
          t.id === taskId ? { ...t, status: "complete" as const } : t
        )
      },
      runningCount: ({ context }) => context.runningCount - 1
    }),
    markFailed: assign({
      tasks: ({ context, event }) => {
        const match = event.type.match(/xstate\.error\.actor\.task-(.+)/)
        if (!match) return context.tasks
        const taskId = match[1]
        return context.tasks.map(t =>
          t.id === taskId ? { ...t, status: "failed" as const } : t
        )
      },
      runningCount: ({ context }) => context.runningCount - 1
    })
  }
}).createMachine({
  id: "taskQueue",
  initial: "idle",
  context: {
    tasks: [],
    maxConcurrent: 3,
    runningCount: 0
  },
  states: {
    idle: {
      on: {
        ADD_TASK: {
          actions: "addTask",
          target: "processing"
        }
      }
    },
    processing: {
      always: {
        guard: ({ context }) => {
          const pending = context.tasks.filter(t => t.status === "pending")
          return pending.length === 0 && context.runningCount === 0
        },
        target: "idle"
      },
      entry: ({ context, self }) => {
        // Start tasks up to maxConcurrent
        const pending = context.tasks.filter(t => t.status === "pending")
        const canStart = context.maxConcurrent - context.runningCount

        pending.slice(0, canStart).forEach(task => {
          // This would spawn the task worker
          // spawnChild("taskWorker", { id: `task-${task.id}`, input: { task } })
        })
      },
      on: {
        ADD_TASK: { actions: "addTask" },
        "xstate.done.actor.task-*": { actions: "markComplete" },
        "xstate.error.actor.task-*": { actions: "markFailed" }
      }
    }
  }
})
```

## Exercises

1. **Retry logic**: Modify the fetch example to automatically retry failed requests up to 3 times.

2. **Actor pool**: Create a machine that maintains a pool of worker actors, distributing tasks among them.

3. **Hierarchical actors**: Create a supervisor actor that spawns multiple child machines, each with their own state.

## Key Takeaways

- **`fromPromise`**: Wraps async functions returning Promises
- **`fromEffect`**: Wraps Effect-based async operations
- **`fromCallback`**: For long-running processes that emit multiple events
- **`invoke`**: Starts an actor when entering a state
- **`spawnChild`**: Dynamically creates child actors
- **`sendTo` / `sendParent`**: Communication between actors
- **`onDone` / `onError`**: Handle actor completion

## What's Next

In the [next tutorial](./06-invoking-services.md), you'll dive deeper into invoking external services and handling their lifecycles.
