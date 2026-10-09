# Tutorial 7: Testing State Machines

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

Use `getNextSnapshot` to test transitions without running an actor:

```typescript
import { describe, it, expect } from "vitest"
import { setup, getNextSnapshot } from "@jambudipa/xstate-effect"

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
  it("starts in inactive state", () => {
    const initialSnapshot = toggleMachine.getInitialSnapshot()
    expect(initialSnapshot.value).toBe("inactive")
  })

  it("transitions to active on TOGGLE", async () => {
    const initialSnapshot = toggleMachine.getInitialSnapshot()
    const nextSnapshot = await getNextSnapshot(
      toggleMachine,
      initialSnapshot,
      { type: "TOGGLE" }
    )
    expect(nextSnapshot.value).toBe("active")
  })

  it("transitions back to inactive on second TOGGLE", async () => {
    let snapshot = toggleMachine.getInitialSnapshot()
    snapshot = await getNextSnapshot(toggleMachine, snapshot, { type: "TOGGLE" })
    snapshot = await getNextSnapshot(toggleMachine, snapshot, { type: "TOGGLE" })
    expect(snapshot.value).toBe("inactive")
  })
})
```

## Step 2: Testing Context Changes

```typescript
import { describe, it, expect } from "vitest"
import { setup, getNextSnapshot, assign } from "@jambudipa/xstate-effect"

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
  it("increments count", async () => {
    const initial = counterMachine.getInitialSnapshot()
    const next = await getNextSnapshot(counterMachine, initial, { type: "INCREMENT" })
    expect(next.context.count).toBe(1)
  })

  it("handles ADD event with amount", async () => {
    const initial = counterMachine.getInitialSnapshot()
    const next = await getNextSnapshot(counterMachine, initial, { type: "ADD", amount: 5 })
    expect(next.context.count).toBe(5)
  })

  it("can increment multiple times", async () => {
    let snapshot = counterMachine.getInitialSnapshot()
    for (let i = 0; i < 5; i++) {
      snapshot = await getNextSnapshot(counterMachine, snapshot, { type: "INCREMENT" })
    }
    expect(snapshot.context.count).toBe(5)
  })
})
```

## Step 3: Testing Guards

```typescript
import { describe, it, expect } from "vitest"
import { setup, getNextSnapshot, assign, guard } from "@jambudipa/xstate-effect"

const boundedCounterMachine = setup({
  types: {} as {
    context: { count: number; max: number }
    events: { type: "INCREMENT" }
  },
  guards: {
    canIncrement: guard("canIncrement", ({ context }) => context.count < context.max)
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
  it("allows increment when below max", async () => {
    const initial = boundedCounterMachine.getInitialSnapshot()
    const next = await getNextSnapshot(boundedCounterMachine, initial, { type: "INCREMENT" })
    expect(next.context.count).toBe(1)
  })

  it("blocks increment at max", async () => {
    let snapshot = boundedCounterMachine.getInitialSnapshot()

    // Increment to max
    for (let i = 0; i < 3; i++) {
      snapshot = await getNextSnapshot(boundedCounterMachine, snapshot, { type: "INCREMENT" })
    }
    expect(snapshot.context.count).toBe(3)

    // Try to increment past max
    const blocked = await getNextSnapshot(boundedCounterMachine, snapshot, { type: "INCREMENT" })
    expect(blocked.context.count).toBe(3) // Still 3, guard blocked it
  })
})
```

## Step 4: Testing with SimulatedClock

For time-dependent behavior, use `SimulatedClock`:

```typescript
import { describe, it, expect } from "vitest"
import { setup, createActor, SimulatedClock } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

const _timerMachine = setup({
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
  it("transitions to completed after delay", async () => {
    const clock = SimulatedClock.make()

    const program = Effect.gen(function* () {
      const actor = yield* createActor(timerMachine, { clock })
      yield* actor.start()
      yield* actor.send({ type: "START" })

      let snapshot = yield* actor.getSnapshot()
      expect(snapshot.value).toBe("running")

      // Advance time by 5 seconds
      yield* clock.advance(5000)

      snapshot = yield* actor.getSnapshot()
      expect(snapshot.value).toBe("completed")
    })

    await Effect.runPromise(program)
  })

  it("remains in running before delay completes", async () => {
    const clock = SimulatedClock.make()

    const program = Effect.gen(function* () {
      const actor = yield* createActor(timerMachine, { clock })
      yield* actor.start()
      yield* actor.send({ type: "START" })

      // Advance time by only 3 seconds
      yield* clock.advance(3000)

      const snapshot = yield* actor.getSnapshot()
      expect(snapshot.value).toBe("running") // Still running
    })

    await Effect.runPromise(program)
  })
})
```

## Step 5: Testing with waitFor

For async scenarios where you need to wait for a condition:

```typescript
import { describe, it, expect } from "vitest"
import { setup, createActor, waitFor, fromPromise } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

const _fetchMachine = setup({
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
          actions: assign({ data: ({ event }) => event.output })
        },
        onError: "failure"
      }
    },
    success: {},
    failure: {}
  }
})

describe("fetchMachine", () => {
  it("fetches data successfully", async () => {
    const program = Effect.gen(function* () {
      const actor = yield* createActor(fetchMachine)
      yield* actor.start()
      yield* actor.send({ type: "FETCH" })

      // Wait for success state
      const snapshot = yield* waitFor(
        actor,
        (snap) => snap.value === "success",
        { timeout: 5000 }
      )

      expect(snapshot.value).toBe("success")
      expect(snapshot.context.data).toBe("fetched data")
    })

    await Effect.runPromise(program)
  })
})
```

## Step 6: Testing Multiple Scenarios

Use table-driven tests for comprehensive coverage:

```typescript
import { describe, it, expect } from "vitest"
import { setup, getNextSnapshot, assign, guard } from "@jambudipa/xstate-effect"

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
    isValid: guard("isValid", ({ context }) =>
      context.email.includes("@") && context.password.length >= 8
    )
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
    it(name, async () => {
      let snapshot = formMachine.getInitialSnapshot()
      snapshot = await getNextSnapshot(formMachine, snapshot, { type: "SET_EMAIL", value: email })
      snapshot = await getNextSnapshot(formMachine, snapshot, { type: "SET_PASSWORD", value: password })
      snapshot = await getNextSnapshot(formMachine, snapshot, { type: "SUBMIT" })

      if (shouldSubmit) {
        expect(snapshot.value).toBe("submitted")
      } else {
        expect(snapshot.value).toBe("editing")
      }
    })
  })
})
```

## Best Practices

### 1. Test States, Not Implementation

```typescript
// Good: Test what state the machine is in
expect(snapshot.value).toBe("loading")

// Avoid: Testing internal implementation details
expect(machine._internal_queue.length).toBe(0)
```

### 2. Test Context Changes

```typescript
// Good: Verify context after events
const next = await getNextSnapshot(machine, initial, { type: "ADD_ITEM", item: "test" })
expect(next.context.items).toContain("test")
```

### 3. Test Guard Behavior

```typescript
// Test that guards block transitions
const blockedSnapshot = await getNextSnapshot(machine, atMaxSnapshot, { type: "INCREMENT" })
expect(blockedSnapshot.context.count).toBe(atMaxSnapshot.context.count)
```

### 4. Use SimulatedClock for Delays

```typescript
// Don't use real timers in tests
// Good:
yield* clock.advance(5000)

// Bad:
await new Promise(resolve => setTimeout(resolve, 5000))
```

### 5. Test Edge Cases

```typescript
describe("edge cases", () => {
  it("handles rapid events", async () => { /* ... */ })
  it("handles unknown events gracefully", async () => { /* ... */ })
  it("handles empty input", async () => { /* ... */ })
})
```

## Complete Test Suite Example

```typescript
import { describe, it, expect, beforeEach } from "vitest"
import { setup, createActor, getNextSnapshot, assign, guard, SimulatedClock } from "@jambudipa/xstate-effect"
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
    hasItems: guard("hasItems", ({ context }) => context.items.length > 0),
    hasPayment: guard("hasPayment", ({ context }) => context.paymentMethod !== null),
    canCheckout: guard("canCheckout", ({ context }) =>
      context.items.length > 0 && context.paymentMethod !== null
    )
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
    it("starts with empty cart", () => {
      const snapshot = checkoutMachine.getInitialSnapshot()
      expect(snapshot.value).toBe("cart")
      expect(snapshot.context.items).toEqual([])
      expect(snapshot.context.total).toBe(0)
    })

    it("adds items to cart", async () => {
      const initial = checkoutMachine.getInitialSnapshot()
      const next = await getNextSnapshot(checkoutMachine, initial, {
        type: "ADD_ITEM",
        item: "Widget",
        price: 10
      })
      expect(next.context.items).toContain("Widget")
      expect(next.context.total).toBe(10)
    })

    it("removes items from cart", async () => {
      let snapshot = checkoutMachine.getInitialSnapshot()
      snapshot = await getNextSnapshot(checkoutMachine, snapshot, {
        type: "ADD_ITEM",
        item: "Widget",
        price: 10
      })
      snapshot = await getNextSnapshot(checkoutMachine, snapshot, {
        type: "REMOVE_ITEM",
        item: "Widget",
        price: 10
      })
      expect(snapshot.context.items).not.toContain("Widget")
      expect(snapshot.context.total).toBe(0)
    })
  })

  describe("checkout validation", () => {
    it("blocks checkout without items", async () => {
      let snapshot = checkoutMachine.getInitialSnapshot()
      snapshot = await getNextSnapshot(checkoutMachine, snapshot, {
        type: "SET_PAYMENT",
        method: "credit"
      })
      snapshot = await getNextSnapshot(checkoutMachine, snapshot, { type: "CHECKOUT" })
      expect(snapshot.value).toBe("cart") // Blocked
    })

    it("blocks checkout without payment", async () => {
      let snapshot = checkoutMachine.getInitialSnapshot()
      snapshot = await getNextSnapshot(checkoutMachine, snapshot, {
        type: "ADD_ITEM",
        item: "Widget",
        price: 10
      })
      snapshot = await getNextSnapshot(checkoutMachine, snapshot, { type: "CHECKOUT" })
      expect(snapshot.value).toBe("cart") // Blocked
    })

    it("allows checkout with items and payment", async () => {
      let snapshot = checkoutMachine.getInitialSnapshot()
      snapshot = await getNextSnapshot(checkoutMachine, snapshot, {
        type: "ADD_ITEM",
        item: "Widget",
        price: 10
      })
      snapshot = await getNextSnapshot(checkoutMachine, snapshot, {
        type: "SET_PAYMENT",
        method: "credit"
      })
      snapshot = await getNextSnapshot(checkoutMachine, snapshot, { type: "CHECKOUT" })
      expect(snapshot.value).toBe("processing")
    })
  })

  describe("processing state", () => {
    it("completes after delay", async () => {
      const clock = SimulatedClock.make()

      const program = Effect.gen(function* () {
        const actor = yield* createActor(checkoutMachine, { clock })
        yield* actor.start()

        yield* actor.send({ type: "ADD_ITEM", item: "Widget", price: 10 })
        yield* actor.send({ type: "SET_PAYMENT", method: "credit" })
        yield* actor.send({ type: "CHECKOUT" })

        let snapshot = yield* actor.getSnapshot()
        expect(snapshot.value).toBe("processing")

        yield* clock.advance(2000)

        snapshot = yield* actor.getSnapshot()
        expect(snapshot.value).toBe("complete")
        expect(snapshot.context.items).toEqual([]) // Cart cleared
      })

      await Effect.runPromise(program)
    })
  })
})
```

## Key Takeaways

- **`getNextSnapshot`**: Pure function for testing transitions
- **`SimulatedClock`**: Deterministic time control for delays
- **`waitFor`**: Async waiting for conditions
- Test **states and context**, not internal implementation
- Use **table-driven tests** for comprehensive coverage
- Test **guard behavior** explicitly

## What's Next

In the [next tutorial](./08-hierarchical-states.md), you'll learn how to organize complex behavior with nested states.
