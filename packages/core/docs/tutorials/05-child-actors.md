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
import { setup, fromPromise, assign } from "@jambudipa/xstate-effect"
import { Option } from "effect"

interface User {
  name: string
  email: string
}

// Define an actor that fetches user data
const fetchUserActor = fromPromise(async ({ input }: { input: { userId: string } }): Promise<User> => {
  const response = await fetch(`/api/users/${input.userId}`)
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`)
  }
  return response.json()
})

export const userMachine = setup({
  types: {} as {
    context: {
      userId: string
      user: User | null
      error: string | null
    }
    events: { type: "FETCH" } | { type: "RETRY" }
  },
  actors: {
    fetchUser: fetchUserActor
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
          // The output of a done event is an Option
          actions: assign({ user: ({ event }) => Option.getOrNull(event.output), error: null })
        },
        onError: {
          target: "failure",
          actions: assign({ error: ({ event }) => String(event.error) })
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
- **`onDone`**: Transition when actor completes successfully. The event's `output` is an `Option` of the actor's result: `Option.none()` when the actor gives no value
- **`onError`**: Transition when actor fails. The event's `error` is the value the actor failed with

## Step 2: Using fromEffect

For Effect-based async operations:

```typescript
import { setup, fromEffect, assign } from "@jambudipa/xstate-effect"
import { Effect, Console, Option } from "effect"

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

export const processingMachine = setup({
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
            results: ({ event }) => Option.getOrElse(event.output, () => [])
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
import { setup, fromCallback, assign } from "@jambudipa/xstate-effect"

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

export const timerMachine = setup({
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
import { setup, spawnChild, stopChild, fromPromise, assign, type DoneActorEvent } from "@jambudipa/xstate-effect"

const downloadActor = fromPromise(async ({ input }: { input: { url: string } }) => {
  // Simulate download
  await new Promise(resolve => setTimeout(resolve, 2000))
  return { url: input.url, size: Math.floor(Math.random() * 1000) }
})

export const downloadManagerMachine = setup({
  types: {} as {
    context: {
      downloads: Map<string, { url: string; status: "pending" | "complete" }>
    }
    events:
      | { type: "ADD_DOWNLOAD"; url: string; id: string }
      | { type: "CANCEL_DOWNLOAD"; id: string }
      // A spawned child sends its parent a done event when it completes
      | DoneActorEvent<{ url: string; size: number }>
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
        },
        "xstate.done.actor.*": {
          // Mark the download complete; event.actorId is the id the child was spawned with
          actions: assign({
            downloads: ({ context, event }) => {
              const newDownloads = new Map(context.downloads)
              const download = newDownloads.get(event.actorId)
              if (download) {
                newDownloads.set(event.actorId, { ...download, status: "complete" })
              }
              return newDownloads
            }
          })
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
import { setup, assign, sendParent } from "@jambudipa/xstate-effect"

export const childMachine = setup({
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

Use `sendTo` with the child's ID. The parent below invokes the `childMachine` of the previous step, and logs the progress events the child sends back:

```typescript
import { setup, assign, sendParent, sendTo } from "@jambudipa/xstate-effect"
import { Console } from "effect"

// The childMachine of the previous step
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
            sendParent(({ context }) => ({ type: "CHILD_PROGRESS", progress: context.progress }))
          ]
        }
      }
    }
  }
})

export const parentMachine = setup({
  types: {} as {
    context: {}
    events:
      | { type: "TELL_CHILD_TO_WORK" }
      | { type: "CHILD_STARTED" }
      | { type: "CHILD_PROGRESS"; progress: number }
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
        CHILD_STARTED: {
          actions: () => Console.log("Child started")
        },
        CHILD_PROGRESS: {
          actions: ({ event }) => Console.log(`Child progress: ${event.progress}%`)
        }
      }
    }
  }
})
```

## Complete Example: Task Queue

The queue spawns one `taskWorker` child for each pending task, with at most `maxConcurrent` running at once. Each worker has the id `task.<task id>`, so its done event is `xstate.done.actor.task.<task id>`, and the wildcard descriptor `xstate.done.actor.task.*` matches the done events of all workers:

```typescript
import {
  setup,
  createActor,
  fromEffect,
  assign,
  enqueueActions,
  waitFor,
  type DoneActorEvent,
  type ErrorActorEvent
} from "@jambudipa/xstate-effect"
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
      return yield* Effect.fail(new Error(`Task ${input.task.name} failed`))
    }

    yield* Console.log(`Completed task: ${input.task.name}`)
    return { taskId: input.task.id, result: "success" }
  })
)

// A worker's actor id is "task.<task id>"
const taskIdOf = (actorId: string) => actorId.slice("task.".length)

const setStatus = (tasks: Task[], taskId: string, status: Task["status"]) =>
  tasks.map(t => (t.id === taskId ? { ...t, status } : t))

const taskQueueMachine = setup({
  types: {} as {
    context: {
      tasks: Task[]
      maxConcurrent: number
      runningCount: number
    }
    events:
      | { type: "ADD_TASK"; task: Task }
      | DoneActorEvent<{ taskId: string; result: string }, `task.${string}`>
      | ErrorActorEvent<unknown, `task.${string}`>
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
    // Start pending tasks up to maxConcurrent
    startTasks: enqueueActions(({ context, enqueue }) => {
      const canStart = context.maxConcurrent - context.runningCount
      const toStart = context.tasks.filter(t => t.status === "pending").slice(0, canStart)

      for (const task of toStart) {
        enqueue.spawnChild("taskWorker", { id: `task.${task.id}`, input: { task } })
      }

      enqueue.assign({
        tasks: context.tasks.map(t => (toStart.includes(t) ? { ...t, status: "running" as const } : t)),
        runningCount: context.runningCount + toStart.length
      })
    }),
    markComplete: assign({
      tasks: ({ context, event }) =>
        event.type === "ADD_TASK" ? context.tasks : setStatus(context.tasks, taskIdOf(event.actorId), "complete"),
      runningCount: ({ context }) => context.runningCount - 1
    }),
    markFailed: assign({
      tasks: ({ context, event }) =>
        event.type === "ADD_TASK" ? context.tasks : setStatus(context.tasks, taskIdOf(event.actorId), "failed"),
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
      entry: "startTasks",
      always: {
        guard: ({ context }) => {
          const pending = context.tasks.filter(t => t.status === "pending")
          return pending.length === 0 && context.runningCount === 0
        },
        target: "idle"
      },
      on: {
        ADD_TASK: { actions: ["addTask", "startTasks"] },
        "xstate.done.actor.task.*": { actions: ["markComplete", "startTasks"] },
        "xstate.error.actor.task.*": { actions: ["markFailed", "startTasks"] }
      }
    }
  }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(taskQueueMachine)
  yield* actor.start

  for (const name of ["Resize images", "Send emails", "Build report", "Archive logs"]) {
    yield* actor.send({ type: "ADD_TASK", task: { id: name.toLowerCase().replaceAll(" ", "-"), name, status: "pending" } })
  }

  // The queue returns to idle when every task is complete or failed
  const snapshot = yield* waitFor(actor, (s) => s.matches("idle"))
  for (const task of snapshot.context.tasks) {
    console.log(`${task.name}: ${task.status}`)
  }
})

void Effect.runPromise(Effect.scoped(program))
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

In the [next tutorial](./07-testing.md), you'll learn how to write deterministic tests for your machines with the testing utilities.
