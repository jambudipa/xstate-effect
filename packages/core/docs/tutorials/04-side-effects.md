---
title: Run side effects
doc-type: tutorial
sources: [packages/core/src/actions/, packages/core/src/setup.ts]
---

# Run side effects

> **TL;DR:** You make the turnstile act on the world: it reports its barrier, its credit and its
> passes on the console, and it locks itself again when nobody passes in time. You write actions
> that return Effects, run them on `entry`, on `exit` and on transitions, schedule an event with a
> delayed `raise`, and call it off with `cancel`.

## What you will build

The turnstile from [Guard your transitions](./03-guards-and-transitions.md) changes state, but it
does nothing you can see. Now it writes a line for each thing that happens at the barrier. When it
unlocks and nobody pushes within one second, it refunds the credit and locks again. At the end of
this tutorial the program prints:

```text
Barrier locked
Credit: 50p
Credit: 100p
Barrier open
Barrier closing
Passes: 1
Barrier locked
Credit: 100p
Barrier open
Barrier closing
Timed out: refunding 100p
Barrier locked
end: locked { fare: 100, credit: 0, passes: 1 }
```

## Before you start

Complete [Guard your transitions](./03-guards-and-transitions.md). This tutorial continues in its
`turnstile` project and changes its `turnstile.ts` file.

## Step 1: Report the barrier on entry

Replace the content of `turnstile.ts` with this program:

```ts
import { and, assign, createActor, setup } from "@jambudipa/xstate-effect"
import { Console, Effect } from "effect"

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
    }),
    showLocked: () => Console.log("Barrier locked"),
    showOpen: () => Console.log("Barrier open")
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
      entry: "showLocked",
      on: {
        COIN: [
          { guard: "unlocksTurnstile", target: "unlocked", actions: "addCredit" },
          { guard: "isAcceptedCoin", actions: "addCredit" }
        ]
      }
    },
    unlocked: {
      entry: "showOpen",
      on: {
        PUSH: { target: "locked", actions: "recordPass" }
      }
    }
  }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(turnstileMachine)
  yield* actor.start
  yield* actor.send({ type: "COIN", amount: 50 })
  yield* actor.send({ type: "COIN", amount: 50 })
  yield* actor.send({ type: "PUSH" })
})

void Effect.runPromise(Effect.scoped(program))
```

What changed:

- `Console` comes from `effect`. `Console.log` gives an Effect that writes one line.
- `showLocked` and `showOpen` are actions that return such an Effect. When an action returns an
  Effect, the actor runs it.
- `entry` names the actions that run each time the machine enters the state. For the initial
  state, they run at `start`.
- The program no longer prints snapshots: the actions now report what happens.

Run the program:

```bash
npx tsx turnstile.ts
```

**What you should see:**

```text
Barrier locked
Barrier open
Barrier locked
```

The first line comes from `start`, which enters `locked`. The first 50p coin changes no state, so
it prints nothing. The second unlocks the turnstile, and the push locks it again.

## Step 2: Report the credit on each coin

Replace the content of `turnstile.ts` with this program:

```ts
import { and, assign, createActor, setup } from "@jambudipa/xstate-effect"
import { Console, Effect } from "effect"

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
    }),
    showLocked: () => Console.log("Barrier locked"),
    showOpen: () => Console.log("Barrier open"),
    showCredit: ({ context }) => Console.log(`Credit: ${context.credit}p`)
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
      entry: "showLocked",
      on: {
        COIN: [
          { guard: "unlocksTurnstile", target: "unlocked", actions: ["addCredit", "showCredit"] },
          { guard: "isAcceptedCoin", actions: ["addCredit", "showCredit"] }
        ]
      }
    },
    unlocked: {
      entry: "showOpen",
      on: {
        PUSH: { target: "locked", actions: "recordPass" }
      }
    }
  }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(turnstileMachine)
  yield* actor.start
  yield* actor.send({ type: "COIN", amount: 50 })
  yield* actor.send({ type: "COIN", amount: 50 })
  yield* actor.send({ type: "PUSH" })
})

void Effect.runPromise(Effect.scoped(program))
```

What changed:

- `showCredit` writes the credit from the context.
- Both `COIN` transitions now list two actions: `addCredit`, then `showCredit`. The actions of a
  list run in that order, and each one reads the context that the actions before it left.

Run the program again with `npx tsx turnstile.ts`.

**What you should see:**

```text
Barrier locked
Credit: 50p
Credit: 100p
Barrier open
Barrier locked
```

`showCredit` runs after `addCredit`, so it shows the credit with the new coin. On the second coin,
`Credit: 100p` comes before `Barrier open`: the transition's actions run before the entry actions
of the state it goes to.

## Step 3: Report the passes when the barrier closes

Replace the content of `turnstile.ts` with this program:

```ts
import { and, assign, createActor, setup } from "@jambudipa/xstate-effect"
import { Console, Effect } from "effect"

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
    }),
    showLocked: () => Console.log("Barrier locked"),
    showOpen: () => Console.log("Barrier open"),
    showClosing: () => Console.log("Barrier closing"),
    showCredit: ({ context }) => Console.log(`Credit: ${context.credit}p`),
    showPasses: ({ context }) => Console.log(`Passes: ${context.passes}`)
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
      entry: "showLocked",
      on: {
        COIN: [
          { guard: "unlocksTurnstile", target: "unlocked", actions: ["addCredit", "showCredit"] },
          { guard: "isAcceptedCoin", actions: ["addCredit", "showCredit"] }
        ]
      }
    },
    unlocked: {
      entry: "showOpen",
      exit: "showClosing",
      on: {
        PUSH: { target: "locked", actions: ["recordPass", "showPasses"] }
      }
    }
  }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(turnstileMachine)
  yield* actor.start
  yield* actor.send({ type: "COIN", amount: 50 })
  yield* actor.send({ type: "COIN", amount: 50 })
  yield* actor.send({ type: "PUSH" })
})

void Effect.runPromise(Effect.scoped(program))
```

What changed:

- `exit` names the actions that run each time the machine leaves the state. `unlocked` now runs
  `showClosing` when it exits.
- The `PUSH` transition runs `showPasses` after `recordPass`.

Run the program again with `npx tsx turnstile.ts`.

**What you should see:**

```text
Barrier locked
Credit: 50p
Credit: 100p
Barrier open
Barrier closing
Passes: 1
Barrier locked
```

Look at the last three lines, which the push gives. When a transition changes the state, the
actor runs the exit actions of the old state first, then the actions of the transition, then the
entry actions of the new state.

## Step 4: Lock again when nobody passes

Replace the content of `turnstile.ts` with this program:

```ts
import { and, assign, cancel, createActor, raise, setup, waitFor } from "@jambudipa/xstate-effect"
import { Console, Effect } from "effect"

const turnstileMachine = setup({
  types: {} as {
    context: { fare: number; credit: number; passes: number }
    events: { type: "COIN"; amount: number } | { type: "PUSH" } | { type: "TIMEOUT" }
  },
  actions: {
    addCredit: assign({
      credit: ({ context, event }) =>
        event.type === "COIN" ? context.credit + event.amount : context.credit
    }),
    recordPass: assign({
      credit: 0,
      passes: ({ context }) => context.passes + 1
    }),
    refund: assign({ credit: 0 }),
    showLocked: () => Console.log("Barrier locked"),
    showOpen: () => Console.log("Barrier open"),
    showClosing: () => Console.log("Barrier closing"),
    showCredit: ({ context }) => Console.log(`Credit: ${context.credit}p`),
    showPasses: ({ context }) => Console.log(`Passes: ${context.passes}`),
    showRefund: ({ context }) => Console.log(`Timed out: refunding ${context.credit}p`),
    startTimer: raise({ type: "TIMEOUT" }, { delay: 1000, id: "relock" }),
    stopTimer: cancel("relock")
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
      entry: "showLocked",
      on: {
        COIN: [
          { guard: "unlocksTurnstile", target: "unlocked", actions: ["addCredit", "showCredit"] },
          { guard: "isAcceptedCoin", actions: ["addCredit", "showCredit"] }
        ]
      }
    },
    unlocked: {
      entry: ["showOpen", "startTimer"],
      exit: ["showClosing", "stopTimer"],
      on: {
        PUSH: { target: "locked", actions: ["recordPass", "showPasses"] },
        TIMEOUT: { target: "locked", actions: ["showRefund", "refund"] }
      }
    }
  }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(turnstileMachine)
  yield* actor.start
  yield* actor.send({ type: "COIN", amount: 50 })
  yield* actor.send({ type: "COIN", amount: 50 })
  yield* actor.send({ type: "PUSH" })
  yield* actor.send({ type: "COIN", amount: 100 })

  const snapshot = yield* waitFor(actor, (current) => current.matches("locked"))
  console.log(`end: ${snapshot.value}`, snapshot.context)
})

void Effect.runPromise(Effect.scoped(program))
```

What changed:

- The machine accepts a `TIMEOUT` event.
- `raise`, imported beside `assign`, builds an action that sends an event to the actor itself.
  `startTimer` raises `TIMEOUT` with a `delay` of 1000 milliseconds, so the event arrives one
  second after the action runs. The `id` names this delayed event.
- `cancel("relock")` builds an action that calls off the delayed event with the id `relock`,
  if it has not arrived yet.
- `unlocked` starts the timer on entry and stops it on exit. A push within the second leaves
  `unlocked`, so its `TIMEOUT` never arrives.
- When `TIMEOUT` arrives, the turnstile locks and refunds the credit. `showRefund` comes before
  `refund`, so it still reads the credit.
- After the last coin, the program waits. `waitFor` gives an Effect that succeeds with the first
  snapshot for which the function returns `true`: here, the first one in the `locked` state.

Run the program again with `npx tsx turnstile.ts`.

**What you should see:** the first nine lines at once, and the last four about one second later.

```text
Barrier locked
Credit: 50p
Credit: 100p
Barrier open
Barrier closing
Passes: 1
Barrier locked
Credit: 100p
Barrier open
Barrier closing
Timed out: refunding 100p
Barrier locked
end: locked { fare: 100, credit: 0, passes: 1 }
```

The first passenger pushes in time, so the first timer is cancelled. Nobody pushes after the
100p coin, so the second timer fires: the barrier closes and the credit goes back to 0.

Keep `turnstile.ts` as it is: [Test your machine](./07-testing.md) tests this machine.

## What you learned

- An action can return an Effect, and the actor runs it. `Console.log` is one such Effect.
- `entry` actions run when the machine enters a state, and `exit` actions when it leaves one.
  On a change of state, the order is exit actions, then the transition's actions, then entry
  actions.
- The actions of a list run in order, and each reads the context the earlier ones left.
- `raise` sends an event to the actor itself; with `delay`, the event arrives later, and `cancel`
  calls it off by its `id`.
- `waitFor` waits for a snapshot that matches a condition.

## Next steps

- [Invoke and spawn child actors](./05-child-actors.md): run several turnstiles as children of a
  station, in the same project.
- [raise](../reference/actions/raise.md) and [cancel](../reference/actions/cancel.md) describe
  every option of the two actions.
- [How to use delayed transitions and delayed events](../how-to/use-delayed-transitions.md) shows
  the other ways to act after a delay.
- [How an actor processes events](../explanation/event-processing.md) explains the order in which
  an actor runs actions and handles events.
- [Why Effect](../explanation/why-effect.md) explains why actions return Effects.
