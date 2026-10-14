---
title: How to test a machine without running an actor
doc-type: how-to
sources: [packages/core/src/testing/getNextSnapshot.ts]
---

# How to test a machine without running an actor

> **TL;DR:** Compute snapshots with the pure transition functions. `initialTransition(machine,
> input)` gives the first snapshot and its actions; `transition(machine, snapshot, event)` gives
> the next snapshot and the actions of that step. Both are Effects that need no scope, run no
> action and start no timer or child; `assign` still updates the context. Check the snapshot's
> `value`, `context` and `status`, and the `type` and `params` of each action.

## When you need this

You want to check the logic of a machine — which state an event leads to, how the context
changes, which actions a step asks for — without the side effects of a running actor. The pure
functions need no actor, no `Scope` and no clock, so each check is a short, fast unit test.

To check behaviour that needs a running actor (child actors that do work, delays that pass,
snapshots over time), use an actor instead: see
[How to test delayed transitions](test-delayed-transitions.md).

## Before you start

- Import the functions from `@jambudipa/xstate-effect`: `initialTransition`, `transition`,
  `getInitialSnapshot`, `getNextSnapshot`, `getMicrosteps`, `getInitialMicrosteps` and
  `getNextTransitions`. There is no separate testing entry point.
- The functions return Effects with no `Scope` requirement. Run a test with
  `Effect.runPromise(test)`, or pass it to `it.effect` of `@effect/vitest`.

## Steps

1. Get the initial snapshot with `initialTransition(machine, input)`. Leave out the input when
   the machine declares no input type.
2. Give the snapshot and an event to `transition(machine, snapshot, event)`. It returns a
   tuple: the next snapshot and the actions of the step.
3. Check the snapshot: `value`, `context`, `status`, or `matches(...)`.
4. Check the actions: each one has a `type` and resolved `params`. The actions did not run;
   they only tell you what an actor would do.
5. Repeat step 2 from the snapshot you got, for the next event.

This test checks a cart. Each `console.log` marks a check: replace it with your test runner's
assertion.

```ts
import { Effect } from "effect"
import { assign, initialTransition, setup, transition } from "@jambudipa/xstate-effect"

const cartMachine = setup({
  types: {} as {
    context: { items: ReadonlyArray<string> }
    events: { type: "ADD"; item: string } | { type: "CHECKOUT" } | { type: "PAID" }
    input: { items: ReadonlyArray<string> }
  },
  actions: {
    track: (_, params: { name: string }) => {
      console.log("track", params.name)
    }
  },
  guards: {
    hasItems: ({ context }) => context.items.length > 0
  }
}).createMachine({
  id: "cart",
  context: ({ input }) => ({ items: input.items }),
  initial: "shopping",
  states: {
    shopping: {
      on: {
        ADD: { actions: assign({ items: ({ context, event }) => [...context.items, event.item] }) },
        CHECKOUT: { guard: "hasItems", target: "paying", actions: { type: "track", params: { name: "checkout" } } }
      }
    },
    paying: {
      after: { 900_000: "shopping" },
      on: { PAID: "done" }
    },
    done: { type: "final" }
  }
})

export const cartTest = Effect.gen(function* () {
  const [initial] = yield* initialTransition(cartMachine, { items: [] })
  console.log(initial.value, initial.context) // shopping { items: [] }

  // The guard keeps an empty cart in "shopping"
  const [blocked, noActions] = yield* transition(cartMachine, initial, { type: "CHECKOUT" })
  console.log(blocked.value, noActions.length) // shopping 0

  // assign updates the context
  const [withBook] = yield* transition(cartMachine, initial, { type: "ADD", item: "book" })
  console.log(withBook.context.items) // ["book"]

  // The actions come back in order, and none of them ran: "track" was not logged
  const [paying, actions] = yield* transition(cartMachine, withBook, { type: "CHECKOUT" })
  console.log(paying.value) // paying
  console.log(actions.map((action) => action.type)) // ["track", "xstate.raise"]
  console.log(actions[0]?.params) // { name: "checkout" }

  const [done] = yield* transition(cartMachine, paying, { type: "PAID" })
  console.log(done.value, done.status) // done done
})
```

The second action of the `CHECKOUT` step is the delayed transition of `paying`: the machine
schedules it as an `xstate.raise` action. Its `params` hold the event
(`xstate.after.900000.cart.paying`), the `id` and the `delay` in milliseconds (`900000`), so
you can check that the step schedules the timer without running any time.

## Variations

### Get only the snapshot

`getInitialSnapshot(machine, input)` and `getNextSnapshot(machine, snapshot, event)` give the
snapshot without the actions. To apply several events in a row, fold them with `Effect.reduce`.

```ts
import { Effect } from "effect"
import { assign, createMachine, getInitialSnapshot, getNextSnapshot } from "@jambudipa/xstate-effect"

const doorMachine = createMachine({
  types: {} as {
    context: { locked: boolean }
    events: { type: "OPEN" } | { type: "CLOSE" } | { type: "LOCK" }
  },
  context: { locked: false },
  initial: "closed",
  states: {
    closed: {
      on: {
        OPEN: { guard: ({ context }) => !context.locked, target: "open" },
        LOCK: { actions: assign({ locked: true }) }
      }
    },
    open: { on: { CLOSE: "closed" } }
  }
})

export const sequenceTest = Effect.gen(function* () {
  const initial = yield* getInitialSnapshot(doorMachine)
  const events = [{ type: "OPEN" }, { type: "CLOSE" }, { type: "LOCK" }, { type: "OPEN" }] as const

  const last = yield* Effect.reduce(events, () => initial, (snapshot, event) =>
    getNextSnapshot(doorMachine, snapshot, event)
  )
  console.log(last.value, last.context) // closed { locked: true }
})
```

### Start from a chosen state

`machine.resolveState({ value, context })` builds a snapshot for any state, so a test does not
have to replay the events that lead there. It is an Effect: a value that names no state fails
it with `MachineDefinitionError`.

You can also ask a snapshot whether it would take an event. `snapshot.can(event)` runs the
guards and gives a boolean. `getNextTransitions(snapshot)` lists the transitions the active
states define, guarded ones included, without running any guard.

```ts
import { Effect } from "effect"
import { assign, createMachine, getNextTransitions, transition } from "@jambudipa/xstate-effect"

const doorMachine = createMachine({
  types: {} as {
    context: { locked: boolean }
    events: { type: "OPEN" } | { type: "CLOSE" } | { type: "LOCK" }
  },
  context: { locked: false },
  initial: "closed",
  states: {
    closed: {
      on: {
        OPEN: { guard: ({ context }) => !context.locked, target: "open" },
        LOCK: { actions: assign({ locked: true }) }
      }
    },
    open: { on: { CLOSE: "closed" } }
  }
})

export const lockedDoorTest = Effect.gen(function* () {
  const locked = yield* doorMachine.resolveState({ value: "closed", context: { locked: true } })

  const [next] = yield* transition(doorMachine, locked, { type: "OPEN" })
  console.log(next.value) // closed

  console.log(yield* locked.can({ type: "OPEN" })) // false
  const candidates = yield* getNextTransitions(locked)
  console.log(candidates.map((candidate) => candidate.eventType)) // ["OPEN", "LOCK"]
})
```

### Check each microstep

One event can pass through several states: eventless (`always`) transitions and raised events
run in the same step. `getMicrosteps(machine, snapshot, event)` gives each microstep as a
`[snapshot, actions]` tuple, in order. `getInitialMicrosteps(machine, input)` does the same for
the initial transition.

```ts
import { Effect } from "effect"
import { assign, createMachine, getInitialSnapshot, getMicrosteps } from "@jambudipa/xstate-effect"

const formMachine = createMachine({
  types: {} as {
    context: { valid: boolean }
    events: { type: "SUBMIT"; valid: boolean }
  },
  context: { valid: false },
  initial: "editing",
  states: {
    editing: {
      on: { SUBMIT: { target: "checking", actions: assign({ valid: ({ event }) => event.valid }) } }
    },
    checking: {
      always: [{ guard: ({ context }) => context.valid, target: "sent" }, { target: "editing" }]
    },
    sent: {}
  }
})

export const microstepTest = Effect.gen(function* () {
  const initial = yield* getInitialSnapshot(formMachine)
  const steps = yield* getMicrosteps(formMachine, initial, { type: "SUBMIT", valid: true })
  console.log(steps.map(([snapshot]) => snapshot.value)) // ["checking", "sent"]
})
```

### Check a guard that throws

The pure functions do not throw. A guard that throws fails the Effect with `GuardError`; a step
that loops past the machine's iteration limit fails with `TransitionError`. Turn the failure
into a value with `Effect.flip` to check it.

```ts
import { Effect } from "effect"
import { createMachine, initialTransition, transition } from "@jambudipa/xstate-effect"

const strictMachine = createMachine({
  types: {} as { events: { type: "GO" } },
  initial: "idle",
  states: {
    idle: {
      on: {
        GO: {
          guard: () => {
            throw new Error("not ready")
          },
          target: "running"
        }
      }
    },
    running: {}
  }
})

export const guardFailureTest = Effect.gen(function* () {
  const [initial] = yield* initialTransition(strictMachine)
  const error = yield* Effect.flip(transition(strictMachine, initial, { type: "GO" }))
  console.log(error._tag) // GuardError
})
```

### Machines that invoke or spawn actors

An `invoke` or a `spawnChild` shows up as an `xstate.spawnChild` action. The pure functions
create the child, so it appears in `snapshot.children`, but they never start it: a promise
does not run and a child's timers do not start. To test what the child does, run the machine
in an actor.

### Generate the events instead of writing them

To check every reachable state without listing the events yourself, generate the paths from
the machine: see [How to generate tests from a machine](generate-tests-from-a-machine.md).

## Related

- [Pure transition functions](../reference/testing/get-next-snapshot.md): the signatures of
  these functions and the shapes of the actions they return.
- [Snapshots](../reference/snapshots.md): `value`, `context`, `status`, `matches` and `can`.
- [Errors](../reference/errors.md): `GuardError`, `TransitionError` and `InitializationError`.
- [Test your machine](../tutorials/07-testing.md): a guided first test.
