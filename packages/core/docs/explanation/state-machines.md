# What is a State Machine?

A state machine is a mathematical model of computation that describes a system as being in exactly one of a finite number of states at any given time. Understanding state machines is key to using @jambudipa/xstate-effect effectively.

## Core Concepts

### States

A **state** represents a specific condition or situation of the system. At any moment, a state machine is in exactly one state.

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│    idle     │────▶│   loading   │────▶│   success   │
└─────────────┘     └─────────────┘     └─────────────┘
```

In this example, the system can be `idle`, `loading`, or `success` - but never multiple states simultaneously.

### Events

**Events** are external inputs that can cause the system to change state. Events represent things that happen - user actions, API responses, timer expirations.

```typescript
{ type: "FETCH" }           // User requests data
{ type: "SUCCESS", data }   // API returned data
{ type: "ERROR", message }  // API failed
```

### Transitions

A **transition** is a change from one state to another, triggered by an event. Transitions are the arrows between states.

```
        FETCH              SUCCESS
idle ──────────▶ loading ──────────▶ success
                    │
                    │ ERROR
                    ▼
                 failure
```

### Context

**Context** is the extended state - data associated with the machine that isn't captured by the finite states. While states are finite (limited set of values), context can be any data.

```typescript
context: {
  user: { id: "123", name: "Alice" },  // Extended state
  retryCount: 2,
  lastError: null
}
```

## Finite vs Extended State

Understanding the difference between **finite state** and **extended state** is crucial.

**Finite state** answers: "What mode/phase is the system in?"
- idle, loading, success, failure
- playing, paused, stopped
- editing, reviewing, submitted

**Extended state (context)** answers: "What data does the system have?"
- User information
- Form field values
- Counters and metrics

```typescript
// Finite state: the mode
value: "loading"

// Extended state: the data
context: {
  url: "/api/users",
  startTime: 1699999999999,
  attempts: 1
}
```

### When to Use State vs Context

Use **finite states** when:
- The value fundamentally changes how the system behaves
- There are a limited number of possible values
- You want to prevent certain actions in certain modes

Use **context** when:
- The value is data the system operates on
- There are many possible values
- The value doesn't change fundamental behavior

```typescript
// Good: Using state for mode
states: {
  editing: { /* can type, can save */ },
  saving: { /* shows spinner, blocks input */ },
  saved: { /* shows confirmation */ }
}

// Bad: Using context for mode
context: { mode: "editing" | "saving" | "saved" }
// This loses the benefits of explicit state modeling
```

## Determinism

State machines are **deterministic** - given the same current state and event, they always produce the same next state. This makes them:

- **Predictable**: You can trace exactly how the system reached any state
- **Testable**: Same inputs always produce same outputs
- **Debuggable**: State history reveals exactly what happened

```typescript
// Always produces the same result
getNextSnapshot(machine, currentSnapshot, { type: "SUBMIT" })
```

## State Machine Variants

### Finite State Machine (FSM)

The simplest form - a fixed set of states with transitions between them.

```typescript
states: {
  green: { on: { TIMER: "yellow" } },
  yellow: { on: { TIMER: "red" } },
  red: { on: { TIMER: "green" } }
}
```

### Hierarchical State Machine (Statechart)

States can contain nested states, allowing for complex behavior organization.

```typescript
states: {
  active: {
    initial: "idle",
    states: {
      idle: { /* ... */ },
      working: { /* ... */ }
    },
    on: {
      LOGOUT: "inactive"  // Exits all nested states
    }
  },
  inactive: { /* ... */ }
}
```

### Parallel State Machine

Multiple state regions that operate independently and simultaneously.

```typescript
states: {
  player: {
    type: "parallel",
    states: {
      video: {
        initial: "paused",
        states: {
          playing: {},
          paused: {}
        }
      },
      audio: {
        initial: "unmuted",
        states: {
          muted: {},
          unmuted: {}
        }
      }
    }
  }
}
```

## The State Machine Mental Model

Think of a state machine as answering three questions:

1. **What states can the system be in?** → Define your states
2. **What events can occur?** → Define your events
3. **How do events change state?** → Define your transitions

```typescript
// 1. States the system can be in
states: {
  idle: {},
  loading: {},
  success: {},
  failure: {}
}

// 2. Events that can occur
events:
  | { type: "FETCH" }
  | { type: "SUCCESS"; data: Data }
  | { type: "ERROR"; message: string }
  | { type: "RETRY" }

// 3. How events change state
states: {
  idle: {
    on: { FETCH: "loading" }
  },
  loading: {
    on: {
      SUCCESS: "success",
      ERROR: "failure"
    }
  },
  success: {
    on: { FETCH: "loading" }
  },
  failure: {
    on: { RETRY: "loading" }
  }
}
```

## Benefits of State Machines

### 1. Explicit State

All possible states are declared upfront. No hidden states or impossible combinations.

```typescript
// Clear what states exist
states: { idle, loading, success, failure }

// vs implicit state scattered across variables
let isLoading = false
let hasError = false
let data = null
// What does isLoading=true, hasError=true mean?
```

### 2. Impossible States Are Impossible

State machines prevent invalid state combinations by design.

```typescript
// Can't be loading AND have an error simultaneously
// The machine is either in "loading" OR "failure"
```

### 3. Predictable Transitions

You know exactly what events are valid in each state.

```typescript
states: {
  loading: {
    on: {
      // Only these events do anything in loading state
      SUCCESS: "success",
      ERROR: "failure",
      CANCEL: "idle"
    }
    // RETRY event? Ignored. FETCH event? Ignored.
  }
}
```

### 4. Visual Documentation

State machines can be visualized, making the system behavior clear to everyone.

```
         FETCH
    ┌──────────────┐
    │              ▼
┌───────┐    ┌─────────┐    SUCCESS    ┌─────────┐
│ idle  │    │ loading │──────────────▶│ success │
└───────┘    └─────────┘               └─────────┘
    ▲              │
    │    ERROR     │
    │              ▼
    │        ┌─────────┐
    └────────│ failure │
      RETRY  └─────────┘
```

## Common Patterns

### Request/Response

```typescript
states: {
  idle: { on: { FETCH: "loading" } },
  loading: {
    invoke: {
      src: "fetchData",
      onDone: "success",
      onError: "failure"
    }
  },
  success: {},
  failure: { on: { RETRY: "loading" } }
}
```

### Toggle

```typescript
states: {
  inactive: { on: { TOGGLE: "active" } },
  active: { on: { TOGGLE: "inactive" } }
}
```

### Sequence

```typescript
states: {
  step1: { on: { NEXT: "step2" } },
  step2: { on: { NEXT: "step3", BACK: "step1" } },
  step3: { on: { NEXT: "complete", BACK: "step2" } },
  complete: { type: "final" }
}
```

### Guarded Transitions

```typescript
states: {
  editing: {
    on: {
      SUBMIT: [
        { guard: "isValid", target: "submitting" },
        { target: "invalid" }
      ]
    }
  }
}
```

## Summary

State machines provide a structured way to model system behavior:

- **States** define what modes the system can be in
- **Events** are inputs that trigger changes
- **Transitions** define how events change state
- **Context** holds data that doesn't define the mode
- **Determinism** ensures predictable, testable behavior

This mental model helps you think clearly about complex systems and build reliable software.

## Further Reading

- [The Actor Model](./actor-model.md) - How actors extend state machines
- [When to Use State Machines](./when-to-use.md) - Problem fit analysis
- [State Machine Theory](./theory.md) - Formal foundations
