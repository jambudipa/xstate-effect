---
title: finiteDelay
doc-type: reference
sources: [packages/core/src/finiteDelay.ts, packages/core/src/internal/delay.ts, packages/core/src/internal/provideCheck.ts, packages/core/src/StateMachine.ts, packages/core/src/graph/settlement.ts]
---

# finiteDelay

> **TL;DR:** `finiteDelay(fn, { max })` wraps a delay function in a total one. The wrapper
> calls `fn` at each entry of the state and clamps the result to `[0, max]`. `max` must be a
> positive integer literal. In a machine that holds agent logic, a named `after` delay that
> leaves its state must be sure to fire. A `finiteDelay` is accepted there, and a plain function
> is refused.

`finiteDelay` and its types come from `@jambudipa/xstate-effect`. It was added in 0.4.1. It is a
port addition: upstream XState has no counterpart.

## Summary

| Export | Kind | Description |
| --- | --- | --- |
| [`finiteDelay`](#finitedelay-1) | function | Wraps a delay function, with a literal upper bound. |
| [`FiniteDelay`](#types) | type | The wrapper: a delay function with a type-only brand. |
| [`FiniteDelayMark`](#types) | type | The brand alone, which the type check of `provide` reads. |
| [`FiniteDelayOptions`](#types) | type | `{ max }`, with the literal check on `max`. |

## finiteDelay

```ts
import type { ActionArgs, CheckedLiteral, EventObject, FiniteDelay } from "@jambudipa/xstate-effect"
import type { Duration } from "effect"

export declare const finiteDelay: <TContext, TEvent extends EventObject, const TMax extends number, TParams = undefined>(
  fn: (args: ActionArgs<TContext, TEvent>, params: TParams) => number | Duration.Duration,
  options: { readonly max: TMax & CheckedLiteral<TMax, "max"> }
) => FiniteDelay<TContext, TEvent, TMax, TParams>
```

### Example

```ts
import { Effect, Schema } from "effect"
import { finiteDelay, fromAgent, setup } from "@jambudipa/xstate-effect"

const worker = fromAgent({
  budget: 3,
  deadline: 30_000,
  tools: { GO: Schema.Struct({ type: Schema.Literal("GO") }) },
  turn: (_input: number) => Effect.void
})

export const machine = setup({
  types: {} as { context: { deadline: number; now: number } },
  actors: { worker },
  delays: {
    // Computed at each entry of `running`, never more than 4 hours
    timebox: finiteDelay(({ context }) => context.deadline - context.now, { max: 14_400_000 })
  }
}).createMachine({
  context: { deadline: 60_000, now: 0 },
  initial: "running",
  states: {
    running: {
      invoke: { src: "worker", input: 1, onDone: "done" },
      on: { GO: "done" },
      after: { timebox: "done" }
    },
    done: { type: "final" }
  }
})
```

## What the wrapper returns

The wrapper calls `fn` once at each entry of the state, as a plain delay function is called.
It returns a number of milliseconds in `[0, max]`.

| `fn` returns (`max` = 1000) | Delay used | Why |
| --- | --- | --- |
| `0`, `1`, `1000` | `0`, `1`, `1000` ms | in range |
| `5000`, `Infinity` | `1000` ms | above `max`: clamped |
| `-5`, `-0`, `-Infinity` | `0` ms | below zero: clamped |
| `NaN` | `1000` ms | `NaN` has no order against the bound, so the delay fires at its latest |
| a value that is no number and no `Duration` (a JavaScript caller) | `1000` ms | as `NaN` |
| `Duration.seconds(2)` | `1000` ms | the `Duration` in milliseconds, clamped |
| a throw | none | the defect is not caught: the actor ends with status `error` and the thrown value |

A throw in `fn` is a defect, as a throw in a plain delay function or an action is. The wrapper
does not swallow it, so the actor does not hang in the state.

## The bound

`max` is checked as an agent's `budget` is. Each of these fails to compile at `max`, with
`TS2322`, under TypeScript 6.0.3 and under tsgo:

- a wide `number`;
- `0`, `-1` and `1.5`;
- `Infinity`;
- a union such as `2 | 3`;
- a branded number;
- a generic `N extends number`.

A cast past the type, or a JavaScript caller, can still pass a value that is no positive safe
integer. The wrapper is then not recorded, so it is refused as a plain function is.

## Where it is accepted

A machine that holds agent logic, directly, inline or through a child, treats each named `after`
delay that leaves its state as a progress delay. Every layer below accepts a `finiteDelay` there
and refuses a plain function:

| Layer | A `finiteDelay` | A plain function |
| --- | --- | --- |
| Run time, at start or restore | runs | the actor ends with [`ProgressDelayError`](./errors.md#agent-settlement-errors) |
| `machine.provide({ delays })` types | compiles | refused with `progress delay <name> must be a positive integer literal` |
| [`proveSettlement`](./settlement.md#provesettlement) | a progress guarantee | `NoProgressGuarantee` |
| [`certify`](./settlement.md#certify) and the gate | `"proved"` | `"failed"` |
| [`explore`](./settlement.md#explore) with `timerFirings` | the timer is offered | the timer is offered |

The delay may come from `setup({ delays })`, from the second argument of `createMachine` or from
`provide`. The run-time check reads the merged record.

`explore` reads no delay value. `timerFirings` offers each `after` of the state as an input, at
any point and in any order with the others. That covers every value in `[0, max]`, so the
explorer's verdict holds whatever the function computes.

## Forgery

Only `finiteDelay` records a wrapper, in a `WeakMap` that no entry point exports. A copy of a
wrapper has no record. These all compile, and all are refused at run time with
`ProgressDelayError` and by `proveSettlement`:

- a plain function cast with `as unknown as FiniteDelay<…>`;
- a plain function with the wrapper's own properties copied onto it;
- `wrapper.bind(…)`;
- a `finiteDelay` whose `max` was cast past the literal check.

The type brand of `FiniteDelay` is type-only, so a cast passes the type check of `provide`. The
run-time refusal is the check that a cast cannot pass.

The record is private to one copy of the library. A genuine wrapper from a second copy fails
closed under this copy, with `ProgressDelayError` and `NoProgressGuarantee`, as agent logic does
across copies.

## Restore

A persisted snapshot holds each pending delayed event with its clamped delay and its start
time. A restored actor resumes that event with the time it has left. It does not call `fn`
again.

## Certificates

A certificate hashes a `finiteDelay` by the source of `fn` and by `max`. A change to either
makes the certificate stale.

## Types

```ts
import type { ActionArgs, CheckedLiteral, EventObject } from "@jambudipa/xstate-effect"

declare const FiniteDelayBrand: unique symbol

export interface FiniteDelayMark<TMax extends number = number> {
  readonly [FiniteDelayBrand]: TMax
}

export interface FiniteDelay<TContext, TEvent extends EventObject, TMax extends number, TParams = undefined>
  extends FiniteDelayMark<TMax> {
  (args: ActionArgs<TContext, TEvent>, params: TParams): number
}

export interface FiniteDelayOptions<TMax extends number> {
  readonly max: TMax & CheckedLiteral<TMax, "max">
}
```

A `FiniteDelay` fits wherever a `DelayConfig` goes: `setup({ delays })`, the second argument of
`createMachine`, `provide({ delays })`, `raise` and `sendTo`.

## Related

- [How to set a timeout per instance](../how-to/a-timeout-per-instance.md)
- [Settlement proof and certificates](./settlement.md)
- [fromAgent and AgentTurn](./actors/from-agent.md)
- [How to use delayed transitions and delayed events](../how-to/use-delayed-transitions.md)
