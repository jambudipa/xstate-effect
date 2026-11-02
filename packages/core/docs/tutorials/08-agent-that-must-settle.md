---
title: Add an agent that must settle
doc-type: tutorial
sources: [packages/core/src/actors/fromAgent.ts, packages/core/src/graph/settlement.ts]
---

# Add an agent that must settle

> **TL;DR:** You give the station an inspector: agent logic that reports on a gate. You see the
> compiler refuse a machine that does not handle the agent's outcome. You then fix the machine,
> run the agent, and prove the machine with `proveSettlement`.

A stub takes the place of a model, so this tutorial needs no network.

## Step 1: define the agent

An agent's tool is an event Schema. The first attempt moves nothing, so you can see
the agent try again.

```ts
import { fromAgent } from "@jambudipa/xstate-effect"
import { Effect, Option, Schema } from "effect"

export const Report = Schema.Struct({ type: Schema.Literal("REPORT"), summary: Schema.String })

export const inspector = fromAgent({
  budget: 3,
  deadline: 5_000,
  tools: { REPORT: Report },
  turn: (input: { readonly gate: number }, attempt, feedback, agent) =>
    Effect.gen(function* () {
      const last = Option.isSome(feedback) ? feedback.value.reason : "none"
      yield* Effect.log(`attempt ${attempt}, last outcome: ${last}`)
      if (attempt === 1) return
      yield* agent.transition({ type: "REPORT", summary: `gate ${input.gate} is clear` })
    }),
})
```

## Step 2: see the compiler refuse the machine

Add the agent to a machine, with no `onDone`:

```text
inspecting: {
  invoke: { src: "inspector", input: { gate: 1 } },
  on: { REPORT: "reported" },
},
```

The compiler refuses this state, as the machine has no plan for a spent budget. An `onDone` that
stays in the state gets a refusal too: the handler must leave the state.

## Step 3: handle each outcome

Give the agent a way out. Now the state has two exits: a report and a spent budget. Put the agent,
the machine and the program in one file, `station.ts`.

```ts
import { assign, createActor, fromAgent, setupWithSchema, waitFor } from "@jambudipa/xstate-effect"
import { proveSettlement } from "@jambudipa/xstate-effect/graph"
import { Effect, Option, Schema } from "effect"

const Report = Schema.Struct({ type: Schema.Literal("REPORT"), summary: Schema.String })

const inspector = fromAgent({
  budget: 3,
  deadline: 5_000,
  tools: { REPORT: Report },
  turn: (input: { readonly gate: number }, attempt, feedback, agent) =>
    Effect.gen(function* () {
      const last = Option.isSome(feedback) ? feedback.value.reason : "none"
      yield* Effect.log(`attempt ${attempt}, last outcome: ${last}`)
      if (attempt === 1) return
      yield* agent.transition({ type: "REPORT", summary: `gate ${input.gate} is clear` })
    }),
})

const station = setupWithSchema({
  context: Schema.Struct({ summary: Schema.String }),
  events: Report,
  actors: { inspector },
}).createMachine({
  context: { summary: "" },
  initial: "inspecting",
  states: {
    inspecting: {
      invoke: { src: "inspector", input: { gate: 1 }, onDone: "unsettled" },
      on: { REPORT: { target: "reported", actions: assign({ summary: ({ event }) => event.summary }) } },
    },
    reported: { type: "final" },
    unsettled: { type: "final" },
  },
})

const program = Effect.gen(function* () {
  yield* proveSettlement(station)
  const actor = yield* createActor(station)
  yield* actor.start
  const snapshot = yield* waitFor(actor, (each) => each.status === "done")
  yield* Effect.log(`${String(snapshot.value)}: ${snapshot.context.summary}`)
})

void Effect.runPromise(Effect.scoped(program))
```

## Step 4: run the agent

Run `station.ts`.

The log shows two attempts. The second attempt has the feedback `silent`, and the machine ends:

```text
attempt 1, last outcome: none
attempt 2, last outcome: silent
reported: gate 1 is clear
```

`proveSettlement` ran first. It read the built machine, so it also covers forms that the compiler
does not see.

## Step 5: spend the budget

Remove the last line of `turn`, and run the program again. Each attempt is `silent`. After three
attempts the agent outputs `Unsettled`, `onDone` runs, and the machine ends in `unsettled`. The
machine never waits for ever.

## Next steps

- [How to prove that an agent machine settles](../how-to/prove-an-agent-machine-settles.md) adds
  the explorer, a certificate and the CI check.
- [fromAgent and AgentTurn](../reference/actors/from-agent.md) describes every rule of agent logic.
- [Why agent machines must settle](../explanation/agent-settlement.md) explains the design.
