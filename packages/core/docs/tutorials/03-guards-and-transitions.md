---
title: Guard your transitions
doc-type: tutorial
sources: [packages/core/src/guards/, packages/core/src/setup.ts]
---

# Guard your transitions

> **TL;DR:** You give the turnstile a fare of 100p and make it unlock only when the credit reaches
> the fare. You write **guards** in `setup`, give one event several transitions so that the first
> one whose guard passes is taken, combine two guards with `and`, and ask a snapshot with `can`
> whether it would accept an event.

## What you will build

The turnstile from [Keep data in context](./02-working-with-context.md) unlocks for any coin. Now
it asks for a fare. Coins below the fare add up until the credit reaches it, and a coin the
turnstile does not accept, such as a 5p coin, is ignored. At the end of this tutorial the program
asks the turnstile which events it would accept, and prints:

```text
5p accepted: false
50p accepted: true
PUSH accepted: false
```

## Before you start

Complete [Keep data in context](./02-working-with-context.md). This tutorial continues in its
`turnstile` project and changes its `turnstile.ts` file.

## Step 1: Guard the `COIN` transition

Replace the content of `turnstile.ts` with this program:

```ts
import { assign, createActor, setup } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

const turnstileMachine = setup({
  types: {} as {
    context: { fare: number; credit: number; passes: number }
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
  },
  guards: {
    paysTheFare: ({ context, event }) =>
      event.type === "COIN" && context.credit + event.amount >= context.fare
  }
}).createMachine({
  id: "turnstile",
  initial: "locked",
  context: { fare: 100, credit: 0, passes: 0 },
  states: {
    locked: {
      on: {
        COIN: { guard: "paysTheFare", target: "unlocked", actions: "addCredit" }
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
  yield* report("after 50p")
  yield* actor.send({ type: "COIN", amount: 100 })
  yield* report("after 100p")
  yield* actor.send({ type: "PUSH" })
  yield* report("after PUSH")
})

void Effect.runPromise(Effect.scoped(program))
```

What changed:

- The context has a `fare` of 100p.
- `setup` takes a `guards` record. A guard is a function that receives `context` and `event` and
  returns `true` or `false`. `paysTheFare` is `true` when the credit with this coin reaches the
  fare. The guard runs before the transition's actions, so `context.credit` does not hold the coin
  yet: the guard adds `event.amount` itself.
- `guard: "paysTheFare"` on the `COIN` transition makes the machine take the transition only when
  the guard returns `true`. When it returns `false`, the event changes nothing: the state stays,
  and the transition's actions do not run.

Run the program:

```bash
npx tsx turnstile.ts
```

**What you should see:**

```text
start: locked { fare: 100, credit: 0, passes: 0 }
after 50p: locked { fare: 100, credit: 0, passes: 0 }
after 100p: unlocked { fare: 100, credit: 100, passes: 0 }
after PUSH: locked { fare: 100, credit: 0, passes: 1 }
```

The 50p coin does not pay the fare, so the guard blocks the transition, and `addCredit` does not
run: the coin is lost. The 100p coin pays the fare and unlocks the turnstile.

## Step 2: Let smaller coins add up

A coin below the fare should still count. Give `COIN` a second transition for that case. Replace
the content of `turnstile.ts` with this program:

```ts
import { assign, createActor, setup } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

const turnstileMachine = setup({
  types: {} as {
    context: { fare: number; credit: number; passes: number }
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
  },
  guards: {
    paysTheFare: ({ context, event }) =>
      event.type === "COIN" && context.credit + event.amount >= context.fare
  }
}).createMachine({
  id: "turnstile",
  initial: "locked",
  context: { fare: 100, credit: 0, passes: 0 },
  states: {
    locked: {
      on: {
        COIN: [
          { guard: "paysTheFare", target: "unlocked", actions: "addCredit" },
          { actions: "addCredit" }
        ]
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
  yield* report("after 50p")
  yield* actor.send({ type: "COIN", amount: 20 })
  yield* report("after 20p")
  yield* actor.send({ type: "COIN", amount: 50 })
  yield* report("after 50p")
  yield* actor.send({ type: "PUSH" })
  yield* report("after PUSH")
})

void Effect.runPromise(Effect.scoped(program))
```

`COIN` now has a list of transitions. The machine tries them in order and takes the first one
whose guard passes:

- The first transition unlocks the turnstile when the coin pays the fare.
- The second has no guard, so it always passes. It has no `target` either, so the turnstile stays
  `locked`, and only its action runs: the coin is added to the credit.

Run the program again with `npx tsx turnstile.ts`.

**What you should see:**

```text
start: locked { fare: 100, credit: 0, passes: 0 }
after 50p: locked { fare: 100, credit: 50, passes: 0 }
after 20p: locked { fare: 100, credit: 70, passes: 0 }
after 50p: unlocked { fare: 100, credit: 120, passes: 0 }
after PUSH: locked { fare: 100, credit: 0, passes: 1 }
```

The first two coins add up to 70p and leave the turnstile `locked`. The third brings the credit to
120p, which pays the fare, so the first transition is taken and the turnstile unlocks.

## Step 3: Combine two guards

The turnstile takes only 10p, 20p, 50p, £1 and £2 coins. Add a guard for that, and combine it with
`paysTheFare`. Replace the content of `turnstile.ts` with this program:

```ts
import { and, assign, createActor, setup } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

const turnstileMachine = setup({
  types: {} as {
    context: { fare: number; credit: number; passes: number }
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
  },
  guards: {
    isAcceptedCoin: ({ event }) =>
      event.type === "COIN" && [10, 20, 50, 100, 200].includes(event.amount),
    paysTheFare: ({ context, event }) =>
      event.type === "COIN" && context.credit + event.amount >= context.fare,
    unlocksTurnstile: and(["isAcceptedCoin", "paysTheFare"])
  }
}).createMachine({
  id: "turnstile",
  initial: "locked",
  context: { fare: 100, credit: 0, passes: 0 },
  states: {
    locked: {
      on: {
        COIN: [
          { guard: "unlocksTurnstile", target: "unlocked", actions: "addCredit" },
          { guard: "isAcceptedCoin", actions: "addCredit" }
        ]
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
  yield* report("after 50p")
  yield* actor.send({ type: "COIN", amount: 5 })
  yield* report("after 5p")
  yield* actor.send({ type: "COIN", amount: 50 })
  yield* report("after 50p")
  yield* actor.send({ type: "PUSH" })
  yield* report("after PUSH")
})

void Effect.runPromise(Effect.scoped(program))
```

What changed:

- `isAcceptedCoin` passes for the coins the turnstile takes.
- `and([...])`, imported beside `assign`, builds a guard that passes only when every guard it
  names passes. `unlocksTurnstile` names `isAcceptedCoin` and `paysTheFare`, and the first `COIN`
  transition uses it.
- The second transition now has the guard `isAcceptedCoin`, so a coin the turnstile does not take
  matches neither transition, and the machine ignores it.

Run the program again with `npx tsx turnstile.ts`.

**What you should see:**

```text
start: locked { fare: 100, credit: 0, passes: 0 }
after 50p: locked { fare: 100, credit: 50, passes: 0 }
after 5p: locked { fare: 100, credit: 50, passes: 0 }
after 50p: unlocked { fare: 100, credit: 100, passes: 0 }
after PUSH: locked { fare: 100, credit: 0, passes: 1 }
```

The 5p coin leaves the credit at 50p. The second 50p coin brings it to the fare, and the turnstile
unlocks.

## Step 4: Ask before you send

A snapshot can tell you whether the machine would accept an event, without sending it. Replace the
`program` at the end of `turnstile.ts`, so that the whole file reads:

```ts
import { and, assign, createActor, setup } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

const turnstileMachine = setup({
  types: {} as {
    context: { fare: number; credit: number; passes: number }
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
  },
  guards: {
    isAcceptedCoin: ({ event }) =>
      event.type === "COIN" && [10, 20, 50, 100, 200].includes(event.amount),
    paysTheFare: ({ context, event }) =>
      event.type === "COIN" && context.credit + event.amount >= context.fare,
    unlocksTurnstile: and(["isAcceptedCoin", "paysTheFare"])
  }
}).createMachine({
  id: "turnstile",
  initial: "locked",
  context: { fare: 100, credit: 0, passes: 0 },
  states: {
    locked: {
      on: {
        COIN: [
          { guard: "unlocksTurnstile", target: "unlocked", actions: "addCredit" },
          { guard: "isAcceptedCoin", actions: "addCredit" }
        ]
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

  const snapshot = yield* actor.getSnapshot
  const takes5p = yield* snapshot.can({ type: "COIN", amount: 5 })
  const takes50p = yield* snapshot.can({ type: "COIN", amount: 50 })
  const takesPush = yield* snapshot.can({ type: "PUSH" })
  console.log("5p accepted:", takes5p)
  console.log("50p accepted:", takes50p)
  console.log("PUSH accepted:", takesPush)
})

void Effect.runPromise(Effect.scoped(program))
```

`snapshot.can(event)` checks whether the machine, in the snapshot's state, has a transition for
the event whose guard passes. It runs the guards but no actions, and the actor's state does not
change. A guard can return an Effect instead of a boolean, so `can` is an Effect too: run it with
`yield*`, as you run `getSnapshot`.

Run the program again with `npx tsx turnstile.ts`.

**What you should see:**

```text
5p accepted: false
50p accepted: true
PUSH accepted: false
```

In the `locked` state, the 5p coin passes neither guard, the 50p coin passes `isAcceptedCoin`, and
`PUSH` has no transition at all.

## What you learned

- A guard is a named function in the `guards` record of `setup`. It receives `context` and
  `event` and returns `true` or `false`.
- A transition with a `guard` is taken only when the guard passes. When it fails, the state stays
  and the transition's actions do not run.
- One event can have a list of transitions. The machine takes the first one whose guard passes,
  and a transition without a guard always passes.
- A transition without a `target` keeps the current state and runs only its actions.
- `and` combines guards by name into one guard.
- `snapshot.can(event)` is an Effect that tells you whether the machine would accept an event.

## Next steps

- [Run side effects](./04-side-effects.md): make the machine act on the world when it changes
  state.
- [How to combine guards](../how-to/compose-guards.md) shows the other ways to combine guards.
- [Guards](../reference/guards.md) describes the guard forms and the built-in guards.
- [Snapshots](../reference/snapshots.md) describes `can` and the other members of a snapshot.
