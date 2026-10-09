# Tutorial 4: Side Effects with Actions

State machines aren't just about managing state - they also coordinate side effects. In this tutorial, you'll learn how actions execute effects at specific points in the machine lifecycle.

## What You'll Learn

- Entry and exit actions
- Transition actions
- Built-in actions: `log`, `raise`, `sendTo`
- Creating custom Effect-based actions

## When Actions Execute

Actions can be triggered at three points:

1. **Entry actions**: Run when entering a state
2. **Exit actions**: Run when leaving a state
3. **Transition actions**: Run during a specific transition

```typescript
states: {
  loading: {
    entry: "onEnterLoading",   // Runs when entering "loading"
    exit: "onExitLoading",     // Runs when leaving "loading"
    on: {
      SUCCESS: {
        target: "success",
        actions: "onSuccess"   // Runs during this transition
      }
    }
  }
}
```

## Step 1: Entry and Exit Actions

```typescript
import { setup, createActor, action } from "@jambudipa/xstate-effect"
import { Effect, Console } from "effect"

const documentMachine = setup({
  types: {} as {
    context: { documentId: string }
    events: { type: "SAVE" } | { type: "CLOSE" }
  },
  actions: {
    logEnter: action("logEnter", ({ context }) =>
      Console.log(`Entered state with document: ${context.documentId}`)
    ),
    logExit: action("logExit", ({ context }) =>
      Console.log(`Exiting state with document: ${context.documentId}`)
    ),
    saveDocument: action("saveDocument", ({ context }) =>
      Console.log(`Saving document: ${context.documentId}`)
    )
  }
}).createMachine({
  id: "document",
  initial: "editing",
  context: { documentId: "doc-123" },
  states: {
    editing: {
      entry: "logEnter",
      exit: "logExit",
      on: {
        SAVE: { actions: "saveDocument" },
        CLOSE: { target: "closed" }
      }
    },
    closed: {
      entry: "logEnter",
      type: "final"
    }
  }
})
```

## Step 2: The action Function

The `action` function creates typed actions that return Effects:

```typescript
import { action } from "@jambudipa/xstate-effect"
import { Effect, Console } from "effect"

// Basic action with logging
const logAction = action("logAction", ({ context, event }) =>
  Console.log(`Event ${event.type} received`)
)

// Action that performs async work
const fetchData = action("fetchData", ({ context }) =>
  Effect.gen(function* () {
    yield* Console.log("Fetching data...")
    yield* Effect.sleep("1 second")
    yield* Console.log("Data fetched!")
  })
)

// Action that can fail (errors are handled by the machine)
const riskyAction = action("riskyAction", () =>
  Effect.gen(function* () {
    const random = Math.random()
    if (random < 0.5) {
      yield* Effect.fail(new Error("Random failure"))
    }
    yield* Console.log("Success!")
  })
)
```

## Step 3: Built-in Actions

### log - Simple Logging

```typescript
import { log, logDebug, logInfo, logWarning, logError } from "@jambudipa/xstate-effect"

const _machine = setup({
  types: {} as {
    context: { count: number }
    events: { type: "INCREMENT" }
  }
}).createMachine({
  id: "counter",
  initial: "active",
  context: { count: 0 },
  states: {
    active: {
      entry: log(({ context }) => `Counter started at ${context.count}`),
      on: {
        INCREMENT: {
          actions: [
            logInfo("Incrementing counter"),
            assign({ count: ({ context }) => context.count + 1 })
          ]
        }
      }
    }
  }
})
```

### raise - Send Events to Self

```typescript
import { raise } from "@jambudipa/xstate-effect"

const _machine = setup({
  types: {} as {
    context: {}
    events: { type: "START" } | { type: "STARTED" }
  }
}).createMachine({
  id: "example",
  initial: "idle",
  context: {},
  states: {
    idle: {
      on: {
        START: {
          target: "starting",
          actions: raise({ type: "STARTED" })  // Immediately raises STARTED
        }
      }
    },
    starting: {
      on: {
        STARTED: { target: "running" }
      }
    },
    running: {}
  }
})
```

### sendTo - Send Events to Other Actors

```typescript
import { sendTo, sendParent } from "@jambudipa/xstate-effect"

// Send to a specific actor by ID
sendTo("otherActorId", { type: "PING" })

// Send to parent actor
sendParent({ type: "CHILD_DONE" })

// Dynamic target and event
sendTo(
  ({ context }) => context.targetActorId,
  ({ context }) => ({ type: "UPDATE", value: context.value })
)
```

## Step 4: Multiple Actions

Execute multiple actions in sequence:

```typescript
const _machine = setup({
  types: {} as {
    context: { count: number }
    events: { type: "INCREMENT" }
  },
  actions: {
    increment: assign({ count: ({ context }) => context.count + 1 }),
    logCount: action("logCount", ({ context }) =>
      Console.log(`Count is now: ${context.count}`)
    ),
    notifyParent: sendParent({ type: "COUNT_CHANGED" })
  }
}).createMachine({
  id: "counter",
  initial: "active",
  context: { count: 0 },
  states: {
    active: {
      on: {
        INCREMENT: {
          actions: ["increment", "logCount", "notifyParent"]
        }
      }
    }
  }
})
```

Actions execute in order. The new context from `assign` is available to subsequent actions.

## Step 5: Inline vs Named Actions

**Inline actions** - defined directly in the machine:

```typescript
states: {
  active: {
    entry: action("inline", () => Console.log("Entered!")),
    on: {
      CLICK: {
        actions: assign({ clicked: true })
      }
    }
  }
}
```

**Named actions** - defined in setup, referenced by string:

```typescript
setup({
  actions: {
    onEnter: action("onEnter", () => Console.log("Entered!")),
    onClick: assign({ clicked: true })
  }
}).createMachine({
  states: {
    active: {
      entry: "onEnter",
      on: {
        CLICK: { actions: "onClick" }
      }
    }
  }
})
```

Named actions are preferred for:
- Reusability across transitions
- Easier testing
- Cleaner machine definitions

## Complete Example: Notification System

```typescript
import { setup, createActor, assign, action, raise } from "@jambudipa/xstate-effect"
import { Effect, Console } from "effect"

interface Notification {
  id: string
  message: string
  type: "info" | "warning" | "error"
}

const _notificationMachine = setup({
  types: {} as {
    context: {
      notifications: Notification[]
      lastId: number
    }
    events:
      | { type: "ADD"; message: string; notificationType: "info" | "warning" | "error" }
      | { type: "DISMISS"; id: string }
      | { type: "CLEAR_ALL" }
      | { type: "AUTO_DISMISS"; id: string }
  },
  actions: {
    addNotification: assign({
      notifications: ({ context, event }) => {
        if (event.type !== "ADD") return context.notifications
        const newNotification: Notification = {
          id: `notif-${context.lastId + 1}`,
          message: event.message,
          type: event.notificationType
        }
        return [...context.notifications, newNotification]
      },
      lastId: ({ context }) => context.lastId + 1
    }),

    dismissNotification: assign({
      notifications: ({ context, event }) => {
        if (event.type !== "DISMISS" && event.type !== "AUTO_DISMISS") {
          return context.notifications
        }
        return context.notifications.filter(n => n.id !== event.id)
      }
    }),

    clearAll: assign({
      notifications: []
    }),

    logNotification: action("logNotification", ({ event }) =>
      Effect.gen(function* () {
        if (event.type === "ADD") {
          yield* Console.log(`[${event.notificationType.toUpperCase()}] ${event.message}`)
        }
      })
    ),

    scheduleAutoDismiss: action("scheduleAutoDismiss", ({ context }) =>
      Effect.gen(function* () {
        const lastNotif = context.notifications[context.notifications.length - 1]
        if (lastNotif) {
          yield* Console.log(`Will auto-dismiss ${lastNotif.id} in 5 seconds`)
        }
      })
    )
  }
}).createMachine({
  id: "notifications",
  initial: "active",
  context: {
    notifications: [],
    lastId: 0
  },
  states: {
    active: {
      on: {
        ADD: {
          actions: ["addNotification", "logNotification", "scheduleAutoDismiss"]
        },
        DISMISS: {
          actions: "dismissNotification"
        },
        AUTO_DISMISS: {
          actions: "dismissNotification"
        },
        CLEAR_ALL: {
          actions: "clearAll"
        }
      }
    }
  }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(notificationMachine)
  yield* actor.start()

  yield* actor.send({
    type: "ADD",
    message: "Welcome to the app!",
    notificationType: "info"
  })

  yield* actor.send({
    type: "ADD",
    message: "Your session will expire soon",
    notificationType: "warning"
  })

  let snapshot = yield* actor.getSnapshot()
  console.log(`Active notifications: ${snapshot.context.notifications.length}`)

  yield* actor.send({ type: "DISMISS", id: "notif-1" })

  snapshot = yield* actor.getSnapshot()
  console.log(`After dismiss: ${snapshot.context.notifications.length}`)
})

void Effect.runPromise(program)
```

## Exercises

1. **Audit trail**: Create an action that logs all state transitions to an audit array in context.

2. **Analytics**: Add actions that track how long the machine spends in each state.

3. **Validation feedback**: Create a form machine where entry actions provide real-time validation feedback.

## Key Takeaways

- **Entry actions** run when entering a state
- **Exit actions** run when leaving a state
- **Transition actions** run during a specific transition
- The `action` function creates Effect-based actions
- Built-in actions: `log`, `raise`, `sendTo`, `sendParent`
- Multiple actions execute in sequence
- Named actions (via setup) are cleaner than inline actions

## What's Next

In the [next tutorial](./05-child-actors.md), you'll learn how to spawn and communicate with child actors for parallel processing.
