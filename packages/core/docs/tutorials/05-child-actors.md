---
title: Invoke and spawn child actors
doc-type: tutorial
sources: [packages/core/src/actors/, packages/core/src/actions/spawnChild.ts]
---

# Invoke and spawn child actors

> **TL;DR:** You build a station that runs one turnstile actor for each of its gates. You spawn
> child actors with `spawnChild`, send them events with `sendTo`, let them answer with
> `sendParent`, and invoke an Effect as a child actor with `fromEffect` and `onDone`.

## What you will build

A station with two gates, `north` and `south`. Each gate is a turnstile that runs as a child actor
of the station. The station passes each coin and each push to the right gate, and each gate
reports its passes back. Last, the station uploads the total of the passes with an Effect that
runs as a child actor. At the end of this tutorial the program prints:

```text
{ north: 2, south: 1 }
Uploaded 3 passes
running: 3 passes uploaded
```

## Before you start

Complete [Run side effects](./04-side-effects.md). This tutorial continues in its `turnstile`
project, in a new file, `station.ts`.

## Step 1: Spawn a turnstile for each gate

Create a file named `station.ts` with this program:

```ts
import { assign, createActor, setup, spawnChild } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

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
    })
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
        PUSH: { target: "locked", actions: "recordPass" }
      }
    }
  }
})

const stationMachine = setup({
  types: {} as {
    context: { passes: Record<string, number> }
    events: { type: "OPEN_GATE"; gate: string }
  },
  actors: {
    turnstile: turnstileMachine
  }
}).createMachine({
  id: "station",
  initial: "running",
  context: { passes: {} },
  states: {
    running: {
      on: {
        OPEN_GATE: {
          actions: spawnChild("turnstile", {
            id: ({ event }) => event.gate,
            input: ({ event }) => ({ gate: event.gate })
          })
        }
      }
    }
  }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(stationMachine)
  yield* actor.start
  yield* actor.send({ type: "OPEN_GATE", gate: "north" })
  yield* actor.send({ type: "OPEN_GATE", gate: "south" })

  const snapshot = yield* actor.getSnapshot
  console.log(Object.keys(snapshot.children))
})

void Effect.runPromise(Effect.scoped(program))
```

The turnstile is the one from [Guard your transitions](./03-guards-and-transitions.md), cut down
to keep the file short: it takes any coin and writes nothing to the console. What is new:

- `types.input` declares the data a turnstile receives when it starts: the name of its gate. The
  `context` of the machine is now a function that builds the first context from that `input`.
- The station's `setup` takes an `actors` record. It names the logic that the station can run as
  a child: here, the turnstile machine, under the name `turnstile`.
- `spawnChild("turnstile", { … })` builds an action that starts a new turnstile actor each time it
  runs. `id` gives the child its id, and `input` gives it its input; both read the event.
- `snapshot.children` holds the station's children, by id.

Run the program:

```bash
npx tsx station.ts
```

**What you should see:**

```text
[ 'north', 'south' ]
```

Each `OPEN_GATE` event spawned one turnstile, with the gate's name as its id.

## Step 2: Pass on coins and pushes, and hear back

Replace the content of `station.ts` with this program:

```ts
import { assign, createActor, sendParent, sendTo, setup, spawnChild, waitFor } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

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

const stationMachine = setup({
  types: {} as {
    context: { passes: Record<string, number> }
    events:
      | { type: "OPEN_GATE"; gate: string }
      | { type: "COIN"; gate: string; amount: number }
      | { type: "PUSH"; gate: string }
      | { type: "PASSED"; gate: string; passes: number }
  },
  actors: {
    turnstile: turnstileMachine
  }
}).createMachine({
  id: "station",
  initial: "running",
  context: { passes: {} },
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
        }
      }
    }
  }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(stationMachine)
  yield* actor.start
  yield* actor.send({ type: "OPEN_GATE", gate: "north" })
  yield* actor.send({ type: "OPEN_GATE", gate: "south" })

  yield* actor.send({ type: "COIN", gate: "north", amount: 100 })
  yield* actor.send({ type: "PUSH", gate: "north" })
  yield* actor.send({ type: "COIN", gate: "south", amount: 50 })
  yield* actor.send({ type: "COIN", gate: "south", amount: 50 })
  yield* actor.send({ type: "PUSH", gate: "south" })
  yield* actor.send({ type: "COIN", gate: "north", amount: 100 })
  yield* actor.send({ type: "PUSH", gate: "north" })

  const snapshot = yield* waitFor(
    actor,
    (current) => current.context.passes.north === 2 && current.context.passes.south === 1
  )
  console.log(snapshot.context.passes)
})

void Effect.runPromise(Effect.scoped(program))
```

What changed:

- The station takes `COIN` and `PUSH` events that name a gate. `sendTo` builds an action that
  sends an event to another actor. Its first argument picks the actor: here, a function that
  gives the child's id from the event. Its second argument is the event to send, or a function
  that builds it.
- `reportPass` in the turnstile uses `sendParent`, which sends an event to the actor that spawned
  this one. After each push, the turnstile sends the station a `PASSED` event with its gate and
  its passes.
- The station handles `PASSED` in the `on` of the machine itself, not of a state, so it records
  the passes in every state.
- Each turnstile handles its events on its own, so `send` returns before the `PASSED` events
  arrive. `waitFor` waits until the station has the passes of both gates.

Run the program again with `npx tsx station.ts`.

**What you should see:**

```text
{ north: 2, south: 1 }
```

Two passengers went through the north gate and one through the south gate.

## Step 3: Upload the passes with an invoked Effect

Replace the content of `station.ts` with this program:

```ts
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

const program = Effect.gen(function* () {
  const actor = yield* createActor(stationMachine)
  yield* actor.start
  yield* actor.send({ type: "OPEN_GATE", gate: "north" })
  yield* actor.send({ type: "OPEN_GATE", gate: "south" })

  yield* actor.send({ type: "COIN", gate: "north", amount: 100 })
  yield* actor.send({ type: "PUSH", gate: "north" })
  yield* actor.send({ type: "COIN", gate: "south", amount: 50 })
  yield* actor.send({ type: "COIN", gate: "south", amount: 50 })
  yield* actor.send({ type: "PUSH", gate: "south" })
  yield* actor.send({ type: "COIN", gate: "north", amount: 100 })
  yield* actor.send({ type: "PUSH", gate: "north" })

  const counted = yield* waitFor(
    actor,
    (current) => current.context.passes.north === 2 && current.context.passes.south === 1
  )
  console.log(counted.context.passes)

  yield* actor.send({ type: "UPLOAD" })
  const uploaded = yield* waitFor(actor, (current) => current.context.uploaded > 0)
  console.log(`${uploaded.value}: ${uploaded.context.uploaded} passes uploaded`)
})

void Effect.runPromise(Effect.scoped(program))
```

What changed:

- `fromEffect`, imported beside `assign`, turns a function that returns an Effect into actor
  logic. The function receives the actor's `input`, and the value the Effect succeeds with is the
  actor's output. `uploadPasses` stands in for a call to a server: it waits 100 milliseconds,
  writes a line and succeeds with the total of the passes.
- The station names `uploadPasses` in its `actors` record, beside `turnstile`.
- An `UPLOAD` event takes the station to the `uploading` state. Its `invoke` starts the
  `uploadPasses` actor when the station enters the state, with the passes as its input, and stops
  it if the station leaves the state first.
- `onDone` is the transition the station takes when the invoked actor finishes. Its event carries
  the actor's output as an `Option`, from `effect`, so `Option.getOrElse` reads the value, with 0
  when there is none.

Run the program again with `npx tsx station.ts`.

**What you should see:**

```text
{ north: 2, south: 1 }
Uploaded 3 passes
running: 3 passes uploaded
```

The upload ran as a child of the station, and its result brought the station back to `running`.

Keep `station.ts` as it is: [Test your machine](./07-testing.md) tests this machine.

## What you learned

- The `actors` record of `setup` names the logic that a machine can run as children.
- `spawnChild` starts a child each time the action runs; `invoke` runs a child for as long as the
  machine stays in the state.
- A machine with `types.input` builds its first context from the input it receives.
- `sendTo` sends an event to an actor, here a child by its id, and `sendParent` sends an event
  back to the parent.
- `fromEffect` runs an Effect as an actor, and `onDone` receives its output as an `Option`.

## Next steps

- [Test your machine](./07-testing.md): test the turnstile and the station, in the same project.
- [How to spawn and stop child actors](../how-to/spawn-and-stop-children.md) shows how to stop a
  spawned child and how to spawn from logic that `setup` does not name.
- [How to invoke asynchronous work](../how-to/invoke-async.md) shows how to invoke a Promise or an
  Effect and how to handle its failure with `onError`.
- [How to send events between actors](../how-to/send-events-between-actors.md) covers the other
  ways one actor can reach another.
- [About the actor model](../explanation/actor-model.md) explains why each actor handles its
  events on its own.
