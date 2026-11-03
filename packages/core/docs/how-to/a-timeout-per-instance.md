---
title: How to set a timeout per instance
doc-type: how-to
sources: [packages/core/src/finiteDelay.ts, packages/core/src/internal/delay.ts, packages/core/src/StateMachine.ts]
---

# How to set a timeout per instance

> **TL;DR:** Wrap the delay function in `finiteDelay(fn, { max })`, name it in
> `setup({ delays })`, and use the name as an `after` key. The delay is computed from the
> instance's context at each entry of the state, never exceeds `max`, and counts as the
> state's progress guarantee in a machine that holds agent logic.

## When you need this

- A state must end when this instance's own deadline passes, for example "leave `running`
  when this attempt's deadline passes".
- The machine holds agent logic, so a plain delay function is refused there with
  `ProgressDelayError` and `NoProgressGuarantee`. A plain function can return `Infinity` or
  `NaN`, or throw, so nothing proves that it fires.

## Prerequisites

- A machine built with `setup(...).createMachine` that invokes logic from
  [`fromAgent`](../reference/actors/from-agent.md).
- A context field that holds the time to wait, or the values to compute it from.

## Steps

1. Choose a ceiling: the longest timeout any instance may have. Write it as a positive integer
   literal of milliseconds, such as `14_400_000` for 4 hours. A wide `number` does not compile.
2. Refuse a longer timeout where the instance is created. Above the ceiling, the delay is
   clamped to `max` and fires early.
3. Wrap the delay function in `finiteDelay` and name it in `setup({ delays })`.
4. Use the name as an `after` key with a target outside the state.

```ts
import { Effect, Schema } from "effect"
import { finiteDelay, fromAgent, setup } from "@jambudipa/xstate-effect"

const worker = fromAgent({
  budget: 3,
  deadline: 30_000,
  tools: { GO: Schema.Struct({ type: Schema.Literal("GO") }) },
  turn: (_input: number) => Effect.void
})

export const leaf = setup({
  types: {} as { context: { deadline: number; now: number }; input: { deadline: number; now: number } },
  actors: { worker },
  delays: {
    // The time this instance has left, at most 4 hours
    timebox: finiteDelay(({ context }) => context.deadline - context.now, { max: 14_400_000 })
  }
}).createMachine({
  context: ({ input }) => input,
  initial: "running",
  states: {
    running: {
      invoke: { src: "worker", input: 1, onDone: "done" },
      on: { GO: "done" },
      after: { timebox: "stopping" }
    },
    stopping: { after: { 1000: "done" } },
    done: { type: "final" }
  }
})
```

## What happens at run time

- The function runs once when `running` is entered. A deadline already past gives `0`, so the
  timer fires at once. A value above `max`, `Infinity` and `NaN` give `max`.
- A restored actor resumes the pending timer with the time it has left. It does not run the
  function again.
- A throw in the function is not caught: the actor ends with status `error` and the thrown
  value.

## Prove it

`proveSettlement` counts the `timebox` exit as the state's progress guarantee, and `certify`
proves the machine. Give the explorer the `timerFirings` input, and map each context field that
the delay reads in the abstraction. See
[How to prove that an agent machine settles](./prove-an-agent-machine-settles.md).

## Related

- [finiteDelay](../reference/finite-delay.md) — the full result table and the forgery rules.
- [How to use delayed transitions and delayed events](./use-delayed-transitions.md)
- [How to test delayed transitions](./test-delayed-transitions.md)
