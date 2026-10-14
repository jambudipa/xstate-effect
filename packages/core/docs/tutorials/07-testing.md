# Tutorial 6: Testing State Machines

State machines are inherently testable - they have defined states, transitions, and behaviors. This tutorial teaches you to write deterministic, reliable tests for your machines.

## What You'll Learn

- Testing with `getNextSnapshot` for pure assertions
- Using `SimulatedClock` for time-dependent tests
- Testing with `waitFor` for async scenarios
- Best practices for machine testing

## Why State Machines Are Testable

State machines provide:
- **Deterministic behavior**: Same input → same output
- **Explicit states**: Easy to verify current state
- **Defined transitions**: Test that events cause expected changes
- **Isolated logic**: Business rules separate from UI

## Step 1: Basic Snapshot Testing

Use `getInitialSnapshot` and `getNextSnapshot` to test transitions without running an actor. Both return Effects: run them with `yield*` inside `Effect.gen`, and return the Promise of `Effect.runPromise` from the test so that Vitest waits for it:

```typescript
import { describe, it, expect } from "vitest"
import { setup, getInitialSnapshot, getNextSnapshot } from "@jambudipa/xstate-effect"
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
    inactive: { on: { TOGGLE: "active" } },
    active: { on: { TOGGLE: "inactive" } }
  }
})

describe("toggleMachine", () => {
  it("starts in inactive state", () =>
    Effect.gen(function* () {
      const initialSnapshot = yield* getInitialSnapshot(toggleMachine)
      expect(initialSnapshot.value).toBe("inactive")
    }).pipe(Effect.runPromise))

  it("transitions to active on TOGGLE", () =>
    Effect.gen(function* () {
      const initialSnapshot = yield* getInitialSnapshot(toggleMachine)
      const nextSnapshot = yield* getNextSnapshot(
        toggleMachine,
        initialSnapshot,
        { type: "TOGGLE" }
      )
      expect(nextSnapshot.value).toBe("active")
    }).pipe(Effect.runPromise))

  it("transitions back to inactive on second TOGGLE", () =>
    Effect.gen(function* () {
      let snapshot = yield* getInitialSnapshot(toggleMachine)
      snapshot = yield* getNextSnapshot(toggleMachine, snapshot, { type: "TOGGLE" })
      snapshot = yield* getNextSnapshot(toggleMachine, snapshot, { type: "TOGGLE" })
      expect(snapshot.value).toBe("inactive")
    }).pipe(Effect.runPromise))
})
```

## Step 2: Testing Context Changes

```typescript
import { describe, it, expect } from "vitest"
import { setup, getInitialSnapshot, getNextSnapshot, assign } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

const counterMachine = setup({
  types: {} as {
    context: { count: number }
    events:
      | { type: "INCREMENT" }
      | { type: "DECREMENT" }
      | { type: "ADD"; amount: number }
  },
  actions: {
    increment: assign({ count: ({ context }) => context.count + 1 }),
    decrement: assign({ count: ({ context }) => context.count - 1 }),
    add: assign({
      count: ({ context, event }) =>
        event.type === "ADD" ? context.count + event.amount : context.count
    })
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
        ADD: { actions: "add" }
      }
    }
  }
})

describe("counterMachine", () => {
  it("increments count", () =>
    Effect.gen(function* () {
      const initial = yield* getInitialSnapshot(counterMachine)
      const next = yield* getNextSnapshot(counterMachine, initial, { type: "INCREMENT" })
      expect(next.context.count).toBe(1)
    }).pipe(Effect.runPromise))

  it("handles ADD event with amount", () =>
    Effect.gen(function* () {
      const initial = yield* getInitialSnapshot(counterMachine)
      const next = yield* getNextSnapshot(counterMachine, initial, { type: "ADD", amount: 5 })
      expect(next.context.count).toBe(5)
    }).pipe(Effect.runPromise))

  it("can increment multiple times", () =>
    Effect.gen(function* () {
      let snapshot = yield* getInitialSnapshot(counterMachine)
      for (let i = 0; i < 5; i++) {
        snapshot = yield* getNextSnapshot(counterMachine, snapshot, { type: "INCREMENT" })
      }
      expect(snapshot.context.count).toBe(5)
    }).pipe(Effect.runPromise))
})
```

## Step 3: Testing Guards

```typescript
import { describe, it, expect } from "vitest"
import { setup, getInitialSnapshot, getNextSnapshot, assign } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

const boundedCounterMachine = setup({
  types: {} as {
    context: { count: number; max: number }
    events: { type: "INCREMENT" }
  },
  guards: {
    canIncrement: ({ context }) => context.count < context.max
  },
  actions: {
    increment: assign({ count: ({ context }) => context.count + 1 })
  }
}).createMachine({
  id: "boundedCounter",
  initial: "active",
  context: { count: 0, max: 3 },
  states: {
    active: {
      on: {
        INCREMENT: {
          guard: "canIncrement",
          actions: "increment"
        }
      }
    }
  }
})

describe("boundedCounterMachine", () => {
  it("allows increment when below max", () =>
    Effect.gen(function* () {
      const initial = yield* getInitialSnapshot(boundedCounterMachine)
      const next = yield* getNextSnapshot(boundedCounterMachine, initial, { type: "INCREMENT" })
      expect(next.context.count).toBe(1)
    }).pipe(Effect.runPromise))

  it("blocks increment at max", () =>
    Effect.gen(function* () {
      let snapshot = yield* getInitialSnapshot(boundedCounterMachine)

      // Increment to max
      for (let i = 0; i < 3; i++) {
        snapshot = yield* getNextSnapshot(boundedCounterMachine, snapshot, { type: "INCREMENT" })
      }
      expect(snapshot.context.count).toBe(3)

      // Try to increment past max
      const blocked = yield* getNextSnapshot(boundedCounterMachine, snapshot, { type: "INCREMENT" })
      expect(blocked.context.count).toBe(3) // Still 3, guard blocked it
    }).pipe(Effect.runPromise))
})
```

## Step 4: Testing with SimulatedClock

For time-dependent behavior, use `SimulatedClock`. Create one with `new SimulatedClock()` and give it to the actor with the `clock` option. Time then moves only when you call `clock.increment(ms)`, an Effect that fires the delayed events that are due:

```typescript
import { describe, it, expect } from "vitest"
import { setup, createActor, SimulatedClock } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

const timerMachine = setup({
  types: {} as {
    context: {}
    events: { type: "START" }
  }
}).createMachine({
  id: "timer",
  initial: "idle",
  context: {},
  states: {
    idle: {
      on: { START: "running" }
    },
    running: {
      after: {
        5000: "completed"  // Transition after 5 seconds
      }
    },
    completed: { type: "final" }
  }
})

describe("timerMachine with SimulatedClock", () => {
  it("transitions to completed after delay", () =>
    Effect.gen(function* () {
      const clock = new SimulatedClock()
      const actor = yield* createActor(timerMachine, { clock })
      yield* actor.start
      yield* actor.send({ type: "START" })

      let snapshot = yield* actor.getSnapshot
      expect(snapshot.value).toBe("running")

      // Advance time by 5 seconds
      yield* clock.increment(5000)

      snapshot = yield* actor.getSnapshot
      expect(snapshot.value).toBe("completed")
    }).pipe(Effect.scoped, Effect.runPromise))

  it("remains in running before delay completes", () =>
    Effect.gen(function* () {
      const clock = new SimulatedClock()
      const actor = yield* createActor(timerMachine, { clock })
      yield* actor.start
      yield* actor.send({ type: "START" })

      // Advance time by only 3 seconds
      yield* clock.increment(3000)

      const snapshot = yield* actor.getSnapshot
      expect(snapshot.value).toBe("running") // Still running
    }).pipe(Effect.scoped, Effect.runPromise))
})
```

`createActor` needs a `Scope`, so these tests run the Effect with `Effect.scoped`: the actor stops when the test's Effect ends.

## Step 5: Testing with waitFor

For async scenarios where you need to wait for a condition, `waitFor` gives an Effect that succeeds with the first snapshot that satisfies the predicate:

```typescript
import { describe, it, expect } from "vitest"
import { setup, createActor, waitFor, fromPromise, assign } from "@jambudipa/xstate-effect"
import { Effect, Option } from "effect"

const fetchMachine = setup({
  types: {} as {
    context: { data: string | null }
    events: { type: "FETCH" }
  },
  actors: {
    fetchData: fromPromise(async () => {
      await new Promise(resolve => setTimeout(resolve, 100))
      return "fetched data"
    })
  }
}).createMachine({
  id: "fetch",
  initial: "idle",
  context: { data: null },
  states: {
    idle: {
      on: { FETCH: "loading" }
    },
    loading: {
      invoke: {
        src: "fetchData",
        onDone: {
          target: "success",
          // The output of a done event is an Option
          actions: assign({ data: ({ event }) => Option.getOrNull(event.output) })
        },
        onError: "failure"
      }
    },
    success: {},
    failure: {}
  }
})

describe("fetchMachine", () => {
  it("fetches data successfully", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(fetchMachine)
      yield* actor.start
      yield* actor.send({ type: "FETCH" })

      // Wait for success state
      const snapshot = yield* waitFor(
        actor,
        (snap) => snap.value === "success",
        { timeout: 5000 }
      )

      expect(snapshot.value).toBe("success")
      expect(snapshot.context.data).toBe("fetched data")
    }).pipe(Effect.scoped, Effect.runPromise))
})
```

## Step 6: Testing Multiple Scenarios

Use table-driven tests for comprehensive coverage:

```typescript
import { describe, it, expect } from "vitest"
import { setup, getInitialSnapshot, getNextSnapshot, assign } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

const formMachine = setup({
  types: {} as {
    context: {
      email: string
      password: string
    }
    events:
      | { type: "SET_EMAIL"; value: string }
      | { type: "SET_PASSWORD"; value: string }
      | { type: "SUBMIT" }
  },
  guards: {
    isValid: ({ context }) =>
      context.email.includes("@") && context.password.length >= 8
  }
}).createMachine({
  id: "form",
  initial: "editing",
  context: { email: "", password: "" },
  states: {
    editing: {
      on: {
        SET_EMAIL: { actions: assign({ email: ({ event }) => event.value }) },
        SET_PASSWORD: { actions: assign({ password: ({ event }) => event.value }) },
        SUBMIT: { guard: "isValid", target: "submitted" }
      }
    },
    submitted: { type: "final" }
  }
})

describe("formMachine validation", () => {
  const testCases = [
    {
      name: "rejects empty form",
      email: "",
      password: "",
      shouldSubmit: false
    },
    {
      name: "rejects invalid email",
      email: "notanemail",
      password: "password123",
      shouldSubmit: false
    },
    {
      name: "rejects short password",
      email: "test@example.com",
      password: "short",
      shouldSubmit: false
    },
    {
      name: "accepts valid form",
      email: "test@example.com",
      password: "password123",
      shouldSubmit: true
    }
  ]

  testCases.forEach(({ name, email, password, shouldSubmit }) => {
    it(name, () =>
      Effect.gen(function* () {
        let snapshot = yield* getInitialSnapshot(formMachine)
        snapshot = yield* getNextSnapshot(formMachine, snapshot, { type: "SET_EMAIL", value: email })
        snapshot = yield* getNextSnapshot(formMachine, snapshot, { type: "SET_PASSWORD", value: password })
        snapshot = yield* getNextSnapshot(formMachine, snapshot, { type: "SUBMIT" })

        if (shouldSubmit) {
          expect(snapshot.value).toBe("submitted")
        } else {
          expect(snapshot.value).toBe("editing")
        }
      }).pipe(Effect.runPromise))
  })
})
```

## Best Practices

### 1. Test States, Not Implementation

```typescript
import { it, expect } from "vitest"
import { setup, getInitialSnapshot, getNextSnapshot } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

const loaderMachine = setup({
  types: {} as {
    context: {}
    events: { type: "LOAD" }
  }
}).createMachine({
  id: "loader",
  initial: "idle",
  context: {},
  states: {
    idle: { on: { LOAD: "loading" } },
    loading: {}
  }
})

it("enters loading on LOAD", () =>
  Effect.gen(function* () {
    const initial = yield* getInitialSnapshot(loaderMachine)
    const snapshot = yield* getNextSnapshot(loaderMachine, initial, { type: "LOAD" })

    // Good: Test what state the machine is in
    expect(snapshot.value).toBe("loading")

    // Avoid: Testing internal implementation details
    expect(snapshot._nodes.length).toBe(2)
  }).pipe(Effect.runPromise))
```

### 2. Test Context Changes

```typescript
import { it, expect } from "vitest"
import { setup, getInitialSnapshot, getNextSnapshot, assign } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

const listMachine = setup({
  types: {} as {
    context: { items: string[] }
    events: { type: "ADD_ITEM"; item: string }
  }
}).createMachine({
  id: "list",
  context: { items: [] },
  on: {
    ADD_ITEM: { actions: assign({ items: ({ context, event }) => [...context.items, event.item] }) }
  }
})

it("adds the item", () =>
  Effect.gen(function* () {
    const initial = yield* getInitialSnapshot(listMachine)

    // Good: Verify context after events
    const next = yield* getNextSnapshot(listMachine, initial, { type: "ADD_ITEM", item: "test" })
    expect(next.context.items).toContain("test")
  }).pipe(Effect.runPromise))
```

### 3. Test Guard Behavior

```typescript
import { it, expect } from "vitest"
import { setup, getInitialSnapshot, getNextSnapshot, assign } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

const machine = setup({
  types: {} as {
    context: { count: number }
    events: { type: "INCREMENT" }
  },
  guards: {
    belowMax: ({ context }) => context.count < 3
  }
}).createMachine({
  id: "counter",
  context: { count: 3 },
  on: {
    INCREMENT: { guard: "belowMax", actions: assign({ count: ({ context }) => context.count + 1 }) }
  }
})

it("blocks INCREMENT at the maximum", () =>
  Effect.gen(function* () {
    const atMaxSnapshot = yield* getInitialSnapshot(machine)

    // Test that guards block transitions
    const blockedSnapshot = yield* getNextSnapshot(machine, atMaxSnapshot, { type: "INCREMENT" })
    expect(blockedSnapshot.context.count).toBe(atMaxSnapshot.context.count)
  }).pipe(Effect.runPromise))
```

### 4. Use SimulatedClock for Delays

```typescript
import { SimulatedClock } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

// Don't use real timers in tests
export const advanceTime = Effect.gen(function* () {
  const clock = new SimulatedClock()

  // Good: the simulated clock fires the due delayed events at once
  yield* clock.increment(5000)

  // Bad: the test waits five real seconds
  yield* Effect.sleep("5 seconds")
})
```

### 5. Test Edge Cases

Write each edge case as a test that runs. A placeholder such as `it.todo` passes without
checking anything, and this package's own suite fails on it:

```typescript
import { describe, it, expect } from "vitest"
import { setup, getInitialSnapshot, getNextSnapshot } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

const toggleMachine = setup({
  types: {} as {
    context: {}
    events: { type: "TOGGLE" } | { type: "UNKNOWN" }
  }
}).createMachine({
  id: "toggle",
  initial: "inactive",
  context: {},
  states: {
    inactive: { on: { TOGGLE: "active" } },
    active: { on: { TOGGLE: "inactive" } }
  }
})

describe("edge cases", () => {
  it("handles rapid events: 101 toggles end in active", () =>
    Effect.gen(function* () {
      let snapshot = yield* getInitialSnapshot(toggleMachine)
      for (let toggle = 0; toggle < 101; toggle++) {
        snapshot = yield* getNextSnapshot(toggleMachine, snapshot, { type: "TOGGLE" })
      }
      expect(snapshot.value).toBe("active")
    }).pipe(Effect.runPromise))

  it("ignores an event that no state handles", () =>
    Effect.gen(function* () {
      const initialSnapshot = yield* getInitialSnapshot(toggleMachine)
      const nextSnapshot = yield* getNextSnapshot(toggleMachine, initialSnapshot, { type: "UNKNOWN" })
      expect(nextSnapshot.value).toBe("inactive")
    }).pipe(Effect.runPromise))
})
```

## Complete Test Suite Example

```typescript
import { describe, it, expect } from "vitest"
import { setup, createActor, getInitialSnapshot, getNextSnapshot, assign, SimulatedClock } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

const checkoutMachine = setup({
  types: {} as {
    context: {
      items: string[]
      total: number
      paymentMethod: string | null
    }
    events:
      | { type: "ADD_ITEM"; item: string; price: number }
      | { type: "REMOVE_ITEM"; item: string; price: number }
      | { type: "SET_PAYMENT"; method: string }
      | { type: "CHECKOUT" }
      | { type: "CANCEL" }
  },
  guards: {
    hasItems: ({ context }) => context.items.length > 0,
    hasPayment: ({ context }) => context.paymentMethod !== null,
    canCheckout: ({ context }) =>
      context.items.length > 0 && context.paymentMethod !== null
  },
  actions: {
    addItem: assign({
      items: ({ context, event }) =>
        event.type === "ADD_ITEM" ? [...context.items, event.item] : context.items,
      total: ({ context, event }) =>
        event.type === "ADD_ITEM" ? context.total + event.price : context.total
    }),
    removeItem: assign({
      items: ({ context, event }) =>
        event.type === "REMOVE_ITEM"
          ? context.items.filter(i => i !== event.item)
          : context.items,
      total: ({ context, event }) =>
        event.type === "REMOVE_ITEM" ? context.total - event.price : context.total
    }),
    setPayment: assign({
      paymentMethod: ({ event }) =>
        event.type === "SET_PAYMENT" ? event.method : null
    }),
    clearCart: assign({
      items: [],
      total: 0,
      paymentMethod: null
    })
  }
}).createMachine({
  id: "checkout",
  initial: "cart",
  context: { items: [], total: 0, paymentMethod: null },
  states: {
    cart: {
      on: {
        ADD_ITEM: { actions: "addItem" },
        REMOVE_ITEM: { actions: "removeItem" },
        SET_PAYMENT: { actions: "setPayment" },
        CHECKOUT: { guard: "canCheckout", target: "processing" }
      }
    },
    processing: {
      after: {
        2000: "complete"
      },
      on: {
        CANCEL: { target: "cart" }
      }
    },
    complete: {
      entry: "clearCart",
      type: "final"
    }
  }
})

describe("checkoutMachine", () => {
  describe("cart state", () => {
    it("starts with empty cart", () =>
      Effect.gen(function* () {
        const snapshot = yield* getInitialSnapshot(checkoutMachine)
        expect(snapshot.value).toBe("cart")
        expect(snapshot.context.items).toEqual([])
        expect(snapshot.context.total).toBe(0)
      }).pipe(Effect.runPromise))

    it("adds items to cart", () =>
      Effect.gen(function* () {
        const initial = yield* getInitialSnapshot(checkoutMachine)
        const next = yield* getNextSnapshot(checkoutMachine, initial, {
          type: "ADD_ITEM",
          item: "Widget",
          price: 10
        })
        expect(next.context.items).toContain("Widget")
        expect(next.context.total).toBe(10)
      }).pipe(Effect.runPromise))

    it("removes items from cart", () =>
      Effect.gen(function* () {
        let snapshot = yield* getInitialSnapshot(checkoutMachine)
        snapshot = yield* getNextSnapshot(checkoutMachine, snapshot, {
          type: "ADD_ITEM",
          item: "Widget",
          price: 10
        })
        snapshot = yield* getNextSnapshot(checkoutMachine, snapshot, {
          type: "REMOVE_ITEM",
          item: "Widget",
          price: 10
        })
        expect(snapshot.context.items).not.toContain("Widget")
        expect(snapshot.context.total).toBe(0)
      }).pipe(Effect.runPromise))
  })

  describe("checkout validation", () => {
    it("blocks checkout without items", () =>
      Effect.gen(function* () {
        let snapshot = yield* getInitialSnapshot(checkoutMachine)
        snapshot = yield* getNextSnapshot(checkoutMachine, snapshot, {
          type: "SET_PAYMENT",
          method: "credit"
        })
        snapshot = yield* getNextSnapshot(checkoutMachine, snapshot, { type: "CHECKOUT" })
        expect(snapshot.value).toBe("cart") // Blocked
      }).pipe(Effect.runPromise))

    it("blocks checkout without payment", () =>
      Effect.gen(function* () {
        let snapshot = yield* getInitialSnapshot(checkoutMachine)
        snapshot = yield* getNextSnapshot(checkoutMachine, snapshot, {
          type: "ADD_ITEM",
          item: "Widget",
          price: 10
        })
        snapshot = yield* getNextSnapshot(checkoutMachine, snapshot, { type: "CHECKOUT" })
        expect(snapshot.value).toBe("cart") // Blocked
      }).pipe(Effect.runPromise))

    it("allows checkout with items and payment", () =>
      Effect.gen(function* () {
        let snapshot = yield* getInitialSnapshot(checkoutMachine)
        snapshot = yield* getNextSnapshot(checkoutMachine, snapshot, {
          type: "ADD_ITEM",
          item: "Widget",
          price: 10
        })
        snapshot = yield* getNextSnapshot(checkoutMachine, snapshot, {
          type: "SET_PAYMENT",
          method: "credit"
        })
        snapshot = yield* getNextSnapshot(checkoutMachine, snapshot, { type: "CHECKOUT" })
        expect(snapshot.value).toBe("processing")
      }).pipe(Effect.runPromise))
  })

  describe("processing state", () => {
    it("completes after delay", () =>
      Effect.gen(function* () {
        const clock = new SimulatedClock()
        const actor = yield* createActor(checkoutMachine, { clock })
        yield* actor.start

        yield* actor.send({ type: "ADD_ITEM", item: "Widget", price: 10 })
        yield* actor.send({ type: "SET_PAYMENT", method: "credit" })
        yield* actor.send({ type: "CHECKOUT" })

        let snapshot = yield* actor.getSnapshot
        expect(snapshot.value).toBe("processing")

        yield* clock.increment(2000)

        snapshot = yield* actor.getSnapshot
        expect(snapshot.value).toBe("complete")
        expect(snapshot.context.items).toEqual([]) // Cart cleared
      }).pipe(Effect.scoped, Effect.runPromise))
  })
})
```

## Key Takeaways

- **`getInitialSnapshot`** and **`getNextSnapshot`**: Effects that compute snapshots without an actor, for testing transitions
- **`SimulatedClock`**: Deterministic time control for delays, moved with `clock.increment(ms)`
- **`waitFor`**: An Effect that waits for a snapshot that satisfies a condition
- Run each test's Effect with `Effect.runPromise` (and `Effect.scoped` when it creates an actor), and return the Promise to Vitest
- Test **states and context**, not internal implementation
- Use **table-driven tests** for comprehensive coverage
- Test **guard behavior** explicitly

## What's Next

This is the last tutorial. To carry out a specific task, such as invoking an async operation or retrying one that fails, read the [how-to guides](../how-to/README.md). To understand why the library works as it does, read the [explanation pages](../explanation/README.md).
