---
title: Test your machine
doc-type: tutorial
sources: [packages/core/src/testing/]
---

# Test your machine

> **TL;DR:** You write Vitest tests for the turnstile and the station of the two previous
> tutorials. You check transitions without an actor with `getInitialSnapshot` and
> `getNextSnapshot`, move time yourself with a `SimulatedClock`, and wait for asynchronous work
> with `waitFor`. This is the last tutorial.

## What you will build

Two test files in the `turnstile` project. `turnstile.test.ts` checks how the turnstile of
[Run side effects](./04-side-effects.md) takes coins, and that it locks again one second after it
unlocks, without a real wait. `station.test.ts` checks that the station of
[Invoke and spawn child actors](./05-child-actors.md) uploads its passes. At the end of this
tutorial Vitest reports:

```text
 Test Files  2 passed (2)
      Tests  5 passed (5)
```

## Before you start

Complete [Invoke and spawn child actors](./05-child-actors.md). This tutorial continues in its
`turnstile` project, in two new files.

`turnstile.ts` and `station.ts` run their programs as soon as they load. So that a test does not
run them, each test file holds its own copy of the machine it tests.

## Step 1: Install Vitest

In the `turnstile` folder, run:

```bash
npm install --save-dev vitest
```

**What you should see:** the install ends without an error, and `package.json` lists `vitest`
under `devDependencies`.

## Step 2: Test the transitions without an actor

Create a file named `turnstile.test.ts` with this content:

```ts
import { describe, expect, it } from "vitest"
import { and, assign, cancel, getInitialSnapshot, getNextSnapshot, raise, setup } from "@jambudipa/xstate-effect"
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

describe("turnstileMachine", () => {
  it("starts locked, with no credit", () =>
    Effect.gen(function* () {
      const snapshot = yield* getInitialSnapshot(turnstileMachine)
      expect(snapshot.value).toBe("locked")
      expect(snapshot.context).toEqual({ fare: 100, credit: 0, passes: 0 })
    }).pipe(Effect.runPromise))

  it("adds a coin below the fare to the credit", () =>
    Effect.gen(function* () {
      const initial = yield* getInitialSnapshot(turnstileMachine)
      const next = yield* getNextSnapshot(turnstileMachine, initial, { type: "COIN", amount: 50 })
      expect(next.value).toBe("locked")
      expect(next.context.credit).toBe(50)
    }).pipe(Effect.runPromise))

  it("unlocks when the credit reaches the fare", () =>
    Effect.gen(function* () {
      let snapshot = yield* getInitialSnapshot(turnstileMachine)
      snapshot = yield* getNextSnapshot(turnstileMachine, snapshot, { type: "COIN", amount: 50 })
      snapshot = yield* getNextSnapshot(turnstileMachine, snapshot, { type: "COIN", amount: 50 })
      expect(snapshot.value).toBe("unlocked")
      expect(snapshot.context.credit).toBe(100)
    }).pipe(Effect.runPromise))
})
```

What is in the file:

- The machine is the turnstile of [Run side effects](./04-side-effects.md), as it was at the end of
  that tutorial.
- `describe` and `it` come from Vitest. Each test builds an Effect with `Effect.gen` and runs it
  with `Effect.runPromise`, and `it` waits for the Promise that this gives back.
- `getInitialSnapshot(machine)` gives the snapshot that a new actor of the machine starts with.
- `getNextSnapshot(machine, snapshot, event)` gives the snapshot after one event.
- Both are Effects, so you run them with `yield*`. Neither creates an actor.

Run the tests:

```bash
npx vitest run
```

**What you should see:** the summary ends with these lines.

```text
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

The functions run none of the machine's actions, so the tests write no `Barrier locked` or
`Credit` lines. `assign` is the exception: it still updates the context, so the tests can check
the credit.

## Step 3: Test the timeout with a simulated clock

The turnstile locks again one second after it unlocks. A test that waits a real second for every
case is slow. Replace the content of `turnstile.test.ts` with this content, which adds a fourth
test:

```ts
import { describe, expect, it } from "vitest"
import {
  and,
  assign,
  cancel,
  createActor,
  getInitialSnapshot,
  getNextSnapshot,
  raise,
  setup,
  SimulatedClock
} from "@jambudipa/xstate-effect"
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

describe("turnstileMachine", () => {
  it("starts locked, with no credit", () =>
    Effect.gen(function* () {
      const snapshot = yield* getInitialSnapshot(turnstileMachine)
      expect(snapshot.value).toBe("locked")
      expect(snapshot.context).toEqual({ fare: 100, credit: 0, passes: 0 })
    }).pipe(Effect.runPromise))

  it("adds a coin below the fare to the credit", () =>
    Effect.gen(function* () {
      const initial = yield* getInitialSnapshot(turnstileMachine)
      const next = yield* getNextSnapshot(turnstileMachine, initial, { type: "COIN", amount: 50 })
      expect(next.value).toBe("locked")
      expect(next.context.credit).toBe(50)
    }).pipe(Effect.runPromise))

  it("unlocks when the credit reaches the fare", () =>
    Effect.gen(function* () {
      let snapshot = yield* getInitialSnapshot(turnstileMachine)
      snapshot = yield* getNextSnapshot(turnstileMachine, snapshot, { type: "COIN", amount: 50 })
      snapshot = yield* getNextSnapshot(turnstileMachine, snapshot, { type: "COIN", amount: 50 })
      expect(snapshot.value).toBe("unlocked")
      expect(snapshot.context.credit).toBe(100)
    }).pipe(Effect.runPromise))

  it("locks again and refunds the credit after one second", () =>
    Effect.gen(function* () {
      const clock = new SimulatedClock()
      const actor = yield* createActor(turnstileMachine, { clock })
      yield* actor.start
      yield* actor.send({ type: "COIN", amount: 100 })

      yield* clock.increment(999)
      let snapshot = yield* actor.getSnapshot
      expect(snapshot.value).toBe("unlocked")

      yield* clock.increment(1)
      snapshot = yield* actor.getSnapshot
      expect(snapshot.value).toBe("locked")
      expect(snapshot.context.credit).toBe(0)
    }).pipe(Effect.scoped, Effect.runPromise))
})
```

What changed:

- `new SimulatedClock()` makes a clock whose time moves only when the test moves it.
- The `clock` option of `createActor` gives the actor that clock, so its delayed events wait on
  simulated time.
- `clock.increment(ms)` is an Effect that moves the clock forward and delivers each delayed event
  that falls due. After 999 milliseconds the turnstile is still unlocked; one more millisecond
  delivers `TIMEOUT`.
- `createActor` needs a scope, so this test runs its Effect with `Effect.scoped` before
  `Effect.runPromise`. The actor stops when the test ends.

Run the tests again with `npx vitest run`.

**What you should see:** the summary ends with these lines.

```text
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

The fourth test does not wait a real second: the simulated clock moves at once. It runs a real
actor, so the machine's actions run in it and write their lines to the console.

## Step 4: Wait for asynchronous work

The station uploads its passes with an Effect that takes 100 milliseconds of real time. Create a
file named `station.test.ts` with this content:

```ts
import { describe, expect, it } from "vitest"
import { assign, createActor, fromEffect, sendParent, sendTo, setup, spawnChild, waitFor } from "@jambudipa/xstate-effect"
import { Console, Effect, Option } from "effect"

const turnstileMachine = setup({
  types: {} as {
    context: { gate: string; fare: number; credit: number; passes: number }
    events: { type: "COIN"; amount: number } | { type: "PUSH" }
    input: { gate: string }
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
    reportPass: sendParent(({ context }) => ({ type: "PASSED", gate: context.gate, passes: context.passes }))
  },
  guards: {
    paysTheFare: ({ context, event }) =>
      event.type === "COIN" && context.credit + event.amount >= context.fare
  }
}).createMachine({
  id: "turnstile",
  initial: "locked",
  context: ({ input }) => ({ gate: input.gate, fare: 100, credit: 0, passes: 0 }),
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
        PUSH: { target: "locked", actions: ["recordPass", "reportPass"] }
      }
    }
  }
})

const uploadPasses = fromEffect(({ input }: { input: { passes: Record<string, number> } }) =>
  Effect.gen(function* () {
    yield* Effect.sleep("100 millis")
    const total = Object.values(input.passes).reduce((sum, passes) => sum + passes, 0)
    yield* Console.log(`Uploaded ${total} passes`)
    return total
  })
)

const stationMachine = setup({
  types: {} as {
    context: { passes: Record<string, number>; uploaded: number }
    events:
      | { type: "OPEN_GATE"; gate: string }
      | { type: "COIN"; gate: string; amount: number }
      | { type: "PUSH"; gate: string }
      | { type: "PASSED"; gate: string; passes: number }
      | { type: "UPLOAD" }
  },
  actors: {
    turnstile: turnstileMachine,
    uploadPasses
  }
}).createMachine({
  id: "station",
  initial: "running",
  context: { passes: {}, uploaded: 0 },
  on: {
    PASSED: {
      actions: assign({ passes: ({ context, event }) => ({ ...context.passes, [event.gate]: event.passes }) })
    }
  },
  states: {
    running: {
      on: {
        OPEN_GATE: {
          actions: spawnChild("turnstile", {
            id: ({ event }) => event.gate,
            input: ({ event }) => ({ gate: event.gate })
          })
        },
        COIN: {
          actions: sendTo(({ event }) => event.gate, ({ event }) => ({ type: "COIN", amount: event.amount }))
        },
        PUSH: {
          actions: sendTo(({ event }) => event.gate, { type: "PUSH" })
        },
        UPLOAD: { target: "uploading" }
      }
    },
    uploading: {
      invoke: {
        src: "uploadPasses",
        input: ({ context }) => ({ passes: context.passes }),
        onDone: {
          target: "running",
          actions: assign({ uploaded: ({ event }) => Option.getOrElse(event.output, () => 0) })
        }
      }
    }
  }
})

describe("stationMachine", () => {
  it("uploads the passes of its gates", () =>
    Effect.gen(function* () {
      const actor = yield* createActor(stationMachine)
      yield* actor.start
      yield* actor.send({ type: "OPEN_GATE", gate: "north" })
      yield* actor.send({ type: "COIN", gate: "north", amount: 100 })
      yield* actor.send({ type: "PUSH", gate: "north" })
      yield* waitFor(actor, (current) => current.context.passes.north === 1)

      yield* actor.send({ type: "UPLOAD" })
      const uploading = yield* actor.getSnapshot
      expect(uploading.value).toBe("uploading")

      const done = yield* waitFor(actor, (current) => current.matches("running"), { timeout: 1000 })
      expect(done.context.uploaded).toBe(1)
    }).pipe(Effect.scoped, Effect.runPromise))
})
```

What is in the file:

- The machines are the turnstile and the station of
  [Invoke and spawn child actors](./05-child-actors.md), as they were at the end of that
  tutorial.
- The test drives one gate. The first `waitFor` waits for the gate's `PASSED` event to reach the
  station, as the program of that tutorial did.
- After `UPLOAD`, the station is `uploading`. The second `waitFor` waits for it to come back to
  `running`, which it does when the upload finishes.
- The `timeout` option of `waitFor` makes it fail after 1000 milliseconds. If the upload never
  finishes, the test fails at that point instead of hanging.

Run the tests again with `npx vitest run`.

**What you should see:** Vitest runs both files, and the summary ends with these lines.

```text
 Test Files  2 passed (2)
      Tests  5 passed (5)
```

## What you learned

- `getInitialSnapshot` and `getNextSnapshot` are Effects that compute snapshots without an actor.
  They run no actions, but `assign` still updates the context.
- A Vitest test can return the Promise of `Effect.runPromise`; a test that creates an actor runs
  its Effect with `Effect.scoped` first.
- A `SimulatedClock`, given to `createActor` with the `clock` option, lets a test deliver delayed
  events with `clock.increment(ms)` instead of waiting.
- `waitFor` waits for a snapshot that matches a condition, and its `timeout` option stops the wait.

## Next steps

You have finished the tutorials. To go further:

- [How to test a machine without running an actor](../how-to/test-machines-without-actors.md)
  and [How to test delayed transitions](../how-to/test-delayed-transitions.md) cover more testing
  cases. The [how-to guides](../how-to/index.md) list every task.
- [Pure transition functions](../reference/testing/get-next-snapshot.md) describes
  `getNextSnapshot`, `transition` and the other functions that compute snapshots.
- [SimulatedClock](../reference/testing/simulated-clock.md) and
  [waitFor, toEffect and toPromise](../reference/testing/wait-for.md) describe every option of
  the tools in this tutorial.
- The [explanation pages](../explanation/index.md) explain why the library works as it does.
