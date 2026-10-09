# getNextSnapshot

Computes the next snapshot after processing an event, without running an actor. Used for pure, deterministic testing.

## Signature

```typescript
function getNextSnapshot<TLogic extends AnyStateMachine>(
  machine: TLogic,
  snapshot: SnapshotFrom<TLogic>,
  event: EventFrom<TLogic>
): Promise<SnapshotFrom<TLogic>>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `machine` | `StateMachine` | The machine definition |
| `snapshot` | `Snapshot` | The current snapshot |
| `event` | `Event` | The event to process |

## Return Value

Returns a `Promise<Snapshot>` representing the state after processing the event.

## Usage

### Basic Usage

```typescript
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

// Get initial snapshot
const initial = toggleMachine.getInitialSnapshot()

// Compute next state
const next = await getNextSnapshot(toggleMachine, initial, { type: "TOGGLE" })
console.log(next.value) // "active"
```

### Testing Transitions

```typescript
import { describe, it, expect } from "vitest"

describe("toggleMachine", () => {
  it("transitions from inactive to active", async () => {
    const initial = toggleMachine.getInitialSnapshot()
    const next = await getNextSnapshot(toggleMachine, initial, { type: "TOGGLE" })

    expect(next.value).toBe("active")
  })

  it("transitions back to inactive", async () => {
    let snapshot = toggleMachine.getInitialSnapshot()
    snapshot = await getNextSnapshot(toggleMachine, snapshot, { type: "TOGGLE" })
    snapshot = await getNextSnapshot(toggleMachine, snapshot, { type: "TOGGLE" })

    expect(snapshot.value).toBe("inactive")
  })
})
```

### Testing Context Changes

```typescript
import { describe, it, expect } from "vitest"
import { setup, getNextSnapshot, assign } from "@jambudipa/xstate-effect"

const counterMachine = setup({
  types: {} as {
    context: { count: number }
    events: { type: "INCREMENT" } | { type: "ADD"; amount: number }
  },
  actions: {
    increment: assign({ count: ({ context }) => context.count + 1 }),
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

  it("adds specified amount", async () => {
    const initial = counterMachine.getInitialSnapshot()
    const next = await getNextSnapshot(counterMachine, initial, { type: "ADD", amount: 5 })

    expect(next.context.count).toBe(5)
  })

  it("processes multiple events", async () => {
    let snapshot = counterMachine.getInitialSnapshot()

    snapshot = await getNextSnapshot(counterMachine, snapshot, { type: "INCREMENT" })
    snapshot = await getNextSnapshot(counterMachine, snapshot, { type: "INCREMENT" })
    snapshot = await getNextSnapshot(counterMachine, snapshot, { type: "ADD", amount: 10 })

    expect(snapshot.context.count).toBe(12)
  })
})
```

### Testing Guards

```typescript
import { describe, it, expect } from "vitest"
import { setup, getNextSnapshot, assign, guard } from "@jambudipa/xstate-effect"

const boundedMachine = setup({
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
  id: "bounded",
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

describe("boundedMachine guards", () => {
  it("allows increment below max", async () => {
    const initial = boundedMachine.getInitialSnapshot()
    const next = await getNextSnapshot(boundedMachine, initial, { type: "INCREMENT" })

    expect(next.context.count).toBe(1)
  })

  it("blocks increment at max", async () => {
    let snapshot = boundedMachine.getInitialSnapshot()

    // Increment to max
    for (let i = 0; i < 3; i++) {
      snapshot = await getNextSnapshot(boundedMachine, snapshot, { type: "INCREMENT" })
    }
    expect(snapshot.context.count).toBe(3)

    // Try to exceed max
    const blocked = await getNextSnapshot(boundedMachine, snapshot, { type: "INCREMENT" })
    expect(blocked.context.count).toBe(3) // Unchanged
  })
})
```

### Testing with Custom Initial State

```typescript
it("can start from custom state", async () => {
  // Create a snapshot at a specific state
  const customSnapshot = {
    ...toggleMachine.getInitialSnapshot(),
    value: "active"
  }

  const next = await getNextSnapshot(toggleMachine, customSnapshot, { type: "TOGGLE" })
  expect(next.value).toBe("inactive")
})
```

### Table-Driven Tests

```typescript
describe("formMachine validation", () => {
  const testCases = [
    { email: "", password: "", shouldSubmit: false, description: "empty form" },
    { email: "invalid", password: "12345678", shouldSubmit: false, description: "invalid email" },
    { email: "test@test.com", password: "short", shouldSubmit: false, description: "short password" },
    { email: "test@test.com", password: "12345678", shouldSubmit: true, description: "valid form" }
  ]

  testCases.forEach(({ email, password, shouldSubmit, description }) => {
    it(`handles ${description}`, async () => {
      let snapshot = formMachine.getInitialSnapshot()
      snapshot = await getNextSnapshot(snapshot, { type: "SET_EMAIL", value: email })
      snapshot = await getNextSnapshot(snapshot, { type: "SET_PASSWORD", value: password })
      snapshot = await getNextSnapshot(snapshot, { type: "SUBMIT" })

      expect(snapshot.value).toBe(shouldSubmit ? "submitted" : "editing")
    })
  })
})
```

## Notes

- `getNextSnapshot` is pure - it doesn't create or run an actor
- No action runs during computation; `assign` still updates the context (use `transition` to get the actions as data)
- Guards are evaluated during computation
- Invoked actors and delayed transitions are NOT processed (use `createActor` for those)
- Returns a Promise because actions may be async Effects

## When to Use

Use `getNextSnapshot` when:
- Testing pure state transitions
- Testing context updates
- Testing guard conditions
- You don't need async actors or timers

Use `createActor` instead when:
- Testing invoked services
- Testing delayed transitions
- Testing actor communication
- Testing real-time behavior

## See Also

- [SimulatedClock](./simulated-clock.md)
- [waitFor](./wait-for.md)
- [Testing Tutorial](../../tutorials/07-testing.md)
