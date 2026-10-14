# getNextSnapshot

Computes the next snapshot after processing an event, without running an actor. Used for pure, deterministic testing.

## Signature

```typescript
import type { AnyActorLogic, EventFromLogic, GuardError, SnapshotFrom } from "@jambudipa/xstate-effect"
import type { Effect } from "effect"

// Simplified: the Effect can also fail with the logic's own transition error, and it needs
// the services that the logic's transition needs
export declare function getNextSnapshot<TLogic extends AnyActorLogic>(
  logic: TLogic,
  snapshot: SnapshotFrom<TLogic>,
  event: EventFromLogic<TLogic>
): Effect.Effect<SnapshotFrom<TLogic>, GuardError>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `logic` | `ActorLogic` | The machine definition, or any other actor logic |
| `snapshot` | `Snapshot` | The current snapshot |
| `event` | `Event` | The event to process |

## Return Value

Returns an `Effect` that succeeds with the snapshot after processing the event. Run it with
`yield*` inside `Effect.gen`, or with `Effect.runPromise` at the edge of the program. It fails
with a `GuardError` when a guard throws.

## Usage

### Basic Usage

```typescript
import { setup, getInitialSnapshot, getNextSnapshot } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

const toggleMachine = setup({
  types: {} as {
    events: { type: "TOGGLE" }
  }
}).createMachine({
  id: "toggle",
  initial: "inactive",
  states: {
    inactive: { on: { TOGGLE: "active" } },
    active: { on: { TOGGLE: "inactive" } }
  }
})

const program = Effect.gen(function* () {
  // Get initial snapshot
  const initial = yield* getInitialSnapshot(toggleMachine)

  // Compute next state
  const next = yield* getNextSnapshot(toggleMachine, initial, { type: "TOGGLE" })
  console.log(next.value) // "active"
})

void Effect.runPromise(program)
```

### Testing Transitions

`it.effect` of `@effect/vitest` runs the Effect that a test returns:

```typescript
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { setup, getInitialSnapshot, getNextSnapshot } from "@jambudipa/xstate-effect"

const toggleMachine = setup({
  types: {} as {
    events: { type: "TOGGLE" }
  }
}).createMachine({
  id: "toggle",
  initial: "inactive",
  states: {
    inactive: { on: { TOGGLE: "active" } },
    active: { on: { TOGGLE: "inactive" } }
  }
})

describe("toggleMachine", () => {
  it.effect("transitions from inactive to active", () =>
    Effect.gen(function* () {
      const initial = yield* getInitialSnapshot(toggleMachine)
      const next = yield* getNextSnapshot(toggleMachine, initial, { type: "TOGGLE" })

      expect(next.value).toBe("active")
    })
  )

  it.effect("transitions back to inactive", () =>
    Effect.gen(function* () {
      let snapshot = yield* getInitialSnapshot(toggleMachine)
      snapshot = yield* getNextSnapshot(toggleMachine, snapshot, { type: "TOGGLE" })
      snapshot = yield* getNextSnapshot(toggleMachine, snapshot, { type: "TOGGLE" })

      expect(snapshot.value).toBe("inactive")
    })
  )
})
```

### Testing Context Changes

```typescript
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { setup, getInitialSnapshot, getNextSnapshot, assign } from "@jambudipa/xstate-effect"

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
  it.effect("increments count", () =>
    Effect.gen(function* () {
      const initial = yield* getInitialSnapshot(counterMachine)
      const next = yield* getNextSnapshot(counterMachine, initial, { type: "INCREMENT" })

      expect(next.context.count).toBe(1)
    })
  )

  it.effect("adds specified amount", () =>
    Effect.gen(function* () {
      const initial = yield* getInitialSnapshot(counterMachine)
      const next = yield* getNextSnapshot(counterMachine, initial, { type: "ADD", amount: 5 })

      expect(next.context.count).toBe(5)
    })
  )

  it.effect("processes multiple events", () =>
    Effect.gen(function* () {
      let snapshot = yield* getInitialSnapshot(counterMachine)

      snapshot = yield* getNextSnapshot(counterMachine, snapshot, { type: "INCREMENT" })
      snapshot = yield* getNextSnapshot(counterMachine, snapshot, { type: "INCREMENT" })
      snapshot = yield* getNextSnapshot(counterMachine, snapshot, { type: "ADD", amount: 10 })

      expect(snapshot.context.count).toBe(12)
    })
  )
})
```

### Testing Guards

```typescript
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { setup, getInitialSnapshot, getNextSnapshot, assign } from "@jambudipa/xstate-effect"

const boundedMachine = setup({
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
  it.effect("allows increment below max", () =>
    Effect.gen(function* () {
      const initial = yield* getInitialSnapshot(boundedMachine)
      const next = yield* getNextSnapshot(boundedMachine, initial, { type: "INCREMENT" })

      expect(next.context.count).toBe(1)
    })
  )

  it.effect("blocks increment at max", () =>
    Effect.gen(function* () {
      let snapshot = yield* getInitialSnapshot(boundedMachine)

      // Increment to max
      for (let i = 0; i < 3; i++) {
        snapshot = yield* getNextSnapshot(boundedMachine, snapshot, { type: "INCREMENT" })
      }
      expect(snapshot.context.count).toBe(3)

      // Try to exceed max
      const blocked = yield* getNextSnapshot(boundedMachine, snapshot, { type: "INCREMENT" })
      expect(blocked.context.count).toBe(3) // Unchanged
    })
  )
})
```

### Testing with Custom Initial State

`machine.resolveState` gives the snapshot of a state value, so a test can start from any state:

```typescript
import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { setup, getNextSnapshot } from "@jambudipa/xstate-effect"

const toggleMachine = setup({
  types: {} as {
    events: { type: "TOGGLE" }
  }
}).createMachine({
  id: "toggle",
  initial: "inactive",
  states: {
    inactive: { on: { TOGGLE: "active" } },
    active: { on: { TOGGLE: "inactive" } }
  }
})

it.effect("can start from custom state", () =>
  Effect.gen(function* () {
    // Create a snapshot at a specific state
    const customSnapshot = yield* toggleMachine.resolveState({ value: "active" })

    const next = yield* getNextSnapshot(toggleMachine, customSnapshot, { type: "TOGGLE" })
    expect(next.value).toBe("inactive")
  })
)
```

### Table-Driven Tests

```typescript
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { setup, getInitialSnapshot, getNextSnapshot, assign } from "@jambudipa/xstate-effect"

const formMachine = setup({
  types: {} as {
    context: { email: string; password: string }
    events:
      | { type: "SET_EMAIL"; value: string }
      | { type: "SET_PASSWORD"; value: string }
      | { type: "SUBMIT" }
  },
  guards: {
    isValid: ({ context }) => context.email.includes("@") && context.password.length >= 8
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
    submitted: {}
  }
})

describe("formMachine validation", () => {
  const testCases = [
    { email: "", password: "", shouldSubmit: false, description: "empty form" },
    { email: "invalid", password: "12345678", shouldSubmit: false, description: "invalid email" },
    { email: "test@test.com", password: "short", shouldSubmit: false, description: "short password" },
    { email: "test@test.com", password: "12345678", shouldSubmit: true, description: "valid form" }
  ]

  testCases.forEach(({ email, password, shouldSubmit, description }) => {
    it.effect(`handles ${description}`, () =>
      Effect.gen(function* () {
        let snapshot = yield* getInitialSnapshot(formMachine)
        snapshot = yield* getNextSnapshot(formMachine, snapshot, { type: "SET_EMAIL", value: email })
        snapshot = yield* getNextSnapshot(formMachine, snapshot, { type: "SET_PASSWORD", value: password })
        snapshot = yield* getNextSnapshot(formMachine, snapshot, { type: "SUBMIT" })

        expect(snapshot.value).toBe(shouldSubmit ? "submitted" : "editing")
      })
    )
  })
})
```

## Notes

- `getNextSnapshot` is pure - it doesn't create or run an actor
- No action runs during computation; `assign` still updates the context (use `transition` to get the actions as data)
- Guards are evaluated during computation
- Invoked actors and delayed transitions are NOT processed (use `createActor` for those)
- Returns an Effect, as `getInitialSnapshot` does: a guard or an assigner can be an Effect, and a guard that throws fails it

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

- [Testing with SimulatedClock](../../tutorials/07-testing.md#step-4-testing-with-simulatedclock) - Step 4 of the testing tutorial
- [Testing with waitFor](../../tutorials/07-testing.md#step-5-testing-with-waitfor) - Step 5 of the testing tutorial
- [Testing Tutorial](../../tutorials/07-testing.md)
