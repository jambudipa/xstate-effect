---
title: Keep data in context
doc-type: tutorial
sources: [packages/core/src/actions/assign.ts, packages/core/src/setup.ts]
---

# Keep data in context

> **TL;DR:** You give the turnstile from the first tutorial data of its own: the credit paid so far
> and the number of people who have passed. You declare the shape of that data, its **context**,
> give the `COIN` event a payload, and update the context with `assign` — first on the transitions,
> then as named actions in `setup`.

## What you will build

The turnstile now records money and passes. A `COIN` event carries the coin's value in pence, in
`amount`, and the turnstile adds it to `credit` as it unlocks. A `PUSH` adds one to `passes` and
clears the credit. At the end of this tutorial the program prints:

```text
start: locked { credit: 0, passes: 0 }
after COIN: unlocked { credit: 50, passes: 0 }
after PUSH: locked { credit: 0, passes: 1 }
after COIN: unlocked { credit: 20, passes: 1 }
after PUSH: locked { credit: 0, passes: 2 }
```

## Before you start

Complete [Build your first state machine](./01-first-state-machine.md). This tutorial continues
in its `turnstile` project and changes its `turnstile.ts` file.

## Step 1: Declare the context and the event data

Replace the content of `turnstile.ts` with this program:

```ts
import { createActor, setup } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

const turnstileMachine = setup({
  types: {} as {
    context: { credit: number; passes: number }
    events: { type: "COIN"; amount: number } | { type: "PUSH" }
  }
}).createMachine({
  id: "turnstile",
  initial: "locked",
  context: { credit: 0, passes: 0 },
  states: {
    locked: {
      on: {
        COIN: { target: "unlocked" }
      }
    },
    unlocked: {
      on: {
        PUSH: { target: "locked" }
      }
    }
  }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(turnstileMachine)
  yield* actor.start

  const report = (label: string) =>
    Effect.gen(function* () {
      const snapshot = yield* actor.getSnapshot
      console.log(`${label}: ${snapshot.value}`, snapshot.context)
    })

  yield* report("start")
  yield* actor.send({ type: "COIN", amount: 50 })
  yield* report("after COIN")
  yield* actor.send({ type: "PUSH" })
  yield* report("after PUSH")
})

void Effect.runPromise(Effect.scoped(program))
```

Three things changed:

- `context: { credit: number; passes: number }` in `types` declares the shape of the machine's
  data, and `context: { credit: 0, passes: 0 }` in `createMachine` gives its starting value.
- The `COIN` event now has an `amount` field, so every `COIN` you send must carry one:
  `{ type: "COIN", amount: 50 }` is a 50p coin.
- `report` prints `snapshot.context`, the machine's data, beside the state.

Run the program:

```bash
npx tsx turnstile.ts
```

**What you should see:**

```text
start: locked { credit: 0, passes: 0 }
after COIN: unlocked { credit: 0, passes: 0 }
after PUSH: locked { credit: 0, passes: 0 }
```

The context is there, but nothing changes it yet: the 50p coin unlocks the turnstile and is not
counted. `npx tsc` still prints nothing.

## Step 2: Update the context with `assign`

Replace the content of `turnstile.ts` with this program:

```ts
import { assign, createActor, setup } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

const turnstileMachine = setup({
  types: {} as {
    context: { credit: number; passes: number }
    events: { type: "COIN"; amount: number } | { type: "PUSH" }
  }
}).createMachine({
  id: "turnstile",
  initial: "locked",
  context: { credit: 0, passes: 0 },
  states: {
    locked: {
      on: {
        COIN: {
          target: "unlocked",
          actions: assign({
            credit: ({ context, event }) => context.credit + event.amount
          })
        }
      }
    },
    unlocked: {
      on: {
        PUSH: {
          target: "locked",
          actions: assign({
            credit: 0,
            passes: ({ context }) => context.passes + 1
          })
        }
      }
    }
  }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(turnstileMachine)
  yield* actor.start

  const report = (label: string) =>
    Effect.gen(function* () {
      const snapshot = yield* actor.getSnapshot
      console.log(`${label}: ${snapshot.value}`, snapshot.context)
    })

  yield* report("start")
  yield* actor.send({ type: "COIN", amount: 50 })
  yield* report("after COIN")
  yield* actor.send({ type: "PUSH" })
  yield* report("after PUSH")
  yield* actor.send({ type: "COIN", amount: 20 })
  yield* report("after COIN")
  yield* actor.send({ type: "PUSH" })
  yield* report("after PUSH")
})

void Effect.runPromise(Effect.scoped(program))
```

Each transition now has `actions`: the things the machine does when it takes the transition.
`assign` is the action that updates the context:

- Each key of the object you pass to `assign` is a context property to change.
- A function value computes the new value. It receives `context`, the data before the action, and
  `event`, the event being processed. Under `on: { COIN: … }`, `event` is the `COIN` event, so
  `event.amount` is a number.
- A plain value, such as `credit: 0`, replaces the old value as it is.
- A property you leave out keeps its value.

Run the program again with `npx tsx turnstile.ts`.

**What you should see:**

```text
start: locked { credit: 0, passes: 0 }
after COIN: unlocked { credit: 50, passes: 0 }
after PUSH: locked { credit: 0, passes: 1 }
after COIN: unlocked { credit: 20, passes: 1 }
after PUSH: locked { credit: 0, passes: 2 }
```

Each coin adds its value to `credit`, and each push counts a pass and clears the credit.

## Step 3: Name the actions in `setup`

The actions work, but they sit inside the states. Move them into `setup`, where they get names.
Replace the content of `turnstile.ts` with this program:

```ts
import { assign, createActor, setup } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

const turnstileMachine = setup({
  types: {} as {
    context: { credit: number; passes: number }
    events: { type: "COIN"; amount: number } | { type: "PUSH" }
  },
  actions: {
    addCredit: assign({
      credit: ({ context, event }) =>
        event.type === "COIN" ? context.credit + event.amount : context.credit
    }),
    recordPass: assign({
      credit: 0,
      passes: ({ context }) => context.passes + 1
    })
  }
}).createMachine({
  id: "turnstile",
  initial: "locked",
  context: { credit: 0, passes: 0 },
  states: {
    locked: {
      on: {
        COIN: { target: "unlocked", actions: "addCredit" }
      }
    },
    unlocked: {
      on: {
        PUSH: { target: "locked", actions: "recordPass" }
      }
    }
  }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(turnstileMachine)
  yield* actor.start

  const report = (label: string) =>
    Effect.gen(function* () {
      const snapshot = yield* actor.getSnapshot
      console.log(`${label}: ${snapshot.value}`, snapshot.context)
    })

  yield* report("start")
  yield* actor.send({ type: "COIN", amount: 50 })
  yield* report("after COIN")
  yield* actor.send({ type: "PUSH" })
  yield* report("after PUSH")
  yield* actor.send({ type: "COIN", amount: 20 })
  yield* report("after COIN")
  yield* actor.send({ type: "PUSH" })
  yield* report("after PUSH")
})

void Effect.runPromise(Effect.scoped(program))
```

What changed:

- `setup` now takes an `actions` record. Each key names an action, and each transition refers to
  its action by that name: `actions: "addCredit"`.
- An action in the record can be used for any event, so its `event` is any event of the machine.
  `addCredit` checks `event.type === "COIN"` before it reads `event.amount`, and keeps the credit
  for any other event.
- TypeScript checks the names. A transition that names an action the record does not hold, such
  as `"addCredits"`, fails `npx tsc`.

Run the program again with `npx tsx turnstile.ts`.

**What you should see:** the same output as in step 2.

```text
start: locked { credit: 0, passes: 0 }
after COIN: unlocked { credit: 50, passes: 0 }
after PUSH: locked { credit: 0, passes: 1 }
after COIN: unlocked { credit: 20, passes: 1 }
after PUSH: locked { credit: 0, passes: 2 }
```

The machine behaves as before; only the place of its actions changed.

## What you learned

- The context is the machine's own data. You declare its type in `types.context` and its starting
  value in the `context` of `createMachine`, and `snapshot.context` shows it.
- An event can carry data beside its `type`, and TypeScript makes every send include it.
- `assign` updates the context. A function value computes a property from `context` and `event`;
  a plain value replaces it; a property you leave out keeps its value.
- Actions named in the `actions` record of `setup` can be used by name in any transition.

## Next steps

- [Guard your transitions](./03-guards-and-transitions.md): make the turnstile ask for a fare
  before it unlocks, in the same project.
- [assign and assignProperty](../reference/actions/assign.md) describes the forms `assign` takes.
- [How to type a machine's context, events, input and output](../how-to/define-custom-types.md)
  also covers the types of a machine's input and output.
- [setup and setupWithSchema](../reference/setup.md) describes everything `setup` takes.
