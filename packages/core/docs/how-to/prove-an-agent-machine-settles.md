---
title: How to prove that an agent machine settles
doc-type: how-to
sources: [packages/core/src/graph/settlement.ts, packages/core/src/graph/explore.ts, packages/core/scripts/certify.ts]
---

# How to prove that an agent machine settles

> **TL;DR:** Declare the agent in `setup`, fix each compile error, then run `proveSettlement` and
> `explore` in a test. Generate a certificate with `xstate-effect-certify`, and run it with
> `--check` in CI. Also add the lint rule, as the compiler does not refuse every form.

## Before you start

You have a machine that invokes logic from [`fromAgent`](../reference/actors/from-agent.md). Use
TypeScript 6.0.3 or later.

## Fix the compile errors

Build the machine with `setup` or `setupWithSchema`, and write the config inline in the
`createMachine` call. Give each agent invocation an `onDone` that leaves the state, and accept
each tool in the state's `on`.

```ts
import { fromAgent, setupWithSchema } from "@jambudipa/xstate-effect"
import { Schema } from "effect"

const Approved = Schema.Struct({ type: Schema.Literal("APPROVED") })

const reviewer = fromAgent({
  budget: 3,
  deadline: 30_000,
  tools: { APPROVED: Approved },
  turn: (_input: { readonly diff: string }, _attempt, _feedback, agent) => agent.transition({ type: "APPROVED" }),
})

export const review = setupWithSchema({
  context: Schema.Struct({}),
  events: Approved,
  actors: { reviewer },
}).createMachine({
  context: {},
  initial: "reviewing",
  states: {
    reviewing: {
      invoke: { src: "reviewer", id: "reviewer", input: { diff: "" }, onDone: "unsettled" },
      on: { APPROVED: "approved" },
    },
    approved: { type: "final" },
    unsettled: { type: "final" },
  },
})
```

The [error table](../reference/settlement.md#the-type-proof) names each compile error.

## Run the structural proof and the explorer

Name every input that the machine can get. Map each context field that the machine reads to a
finite class.

```ts
import type { AnyStateMachine } from "@jambudipa/xstate-effect"
import { explore, proveSettlement, type ExploreEnvironment } from "@jambudipa/xstate-effect/graph"
import { Effect } from "effect"

declare const review: AnyStateMachine

const environment: ExploreEnvironment = {
  catalogue: ["settle", "approve"],
  inputs: {
    settle: () => [{ type: "xstate.done.actor.reviewer", output: { reason: "silent", attempts: 3 } }],
    approve: () => [{ type: "APPROVED" }],
  },
  abstraction: {},
  timeout: "30 seconds",
}

export const proof = Effect.gen(function* () {
  yield* proveSettlement(review)
  return yield* explore(review, environment)
})
```

`proveSettlement` fails with every finding. `explore` fails with a trace to the fault. To fix an
`UnabstractedField` failure, add the field to `abstraction`. No other change ends this failure.

## Generate and check a certificate

1. Write a config module. It must import the machine and its environment.

   ```js
   import { environment, review } from "./review.js"

   export default {
     output: "review.certificate.ts",
     machines: { review: { machine: review, environment } },
   }
   ```

2. Generate the certificate module. Commit it.

   ```text
   xstate-effect-certify src/review.config.js
   ```

3. Add the gate to CI. It runs the check under a time limit and reads the JSON report for you,
   as an exit code alone proves nothing. The step fails unless the gate exits 0.

   ```text
   xstate-effect-certify-gate src/review.config.js
   ```

   Run the gate under the runtime that wrote the certificate, for example
   `bun --bun xstate-effect-certify-gate src/review.config.js`.

Generate the certificate again after a change to the machine, its module closure, or the version
of this package. The check fails with `hash` until you do.

If a guard or an action needs a service, add a `layer` to the machine's entry. Without it the run
fails with `crash`.

```js
import { Layer } from "effect"
import { environment, Policy, review } from "./review.js"

export default {
  output: "review.certificate.ts",
  machines: { review: { machine: review, environment, layer: Layer.succeed(Policy, { strict: true }) } },
}
```

The check fails with `unresolved-import` when a real import names no file. Add the file, or add
the alias to `paths` in the nearest `tsconfig.json`. A comment, a string or an `import type` does
not fail it.

## Certify a child machine

A parent can invoke or spawn a machine that holds agents only when the machine has a certificate.
Mark the machine with `certified`, then declare it in the parent's `actors`. The parent must
handle the child's done event in each state where the child is alive.

```ts
import { certified, setup, type AnyLogicSlot, type SettlementCertificate } from "@jambudipa/xstate-effect"

declare const review: AnyLogicSlot
declare const certificate: SettlementCertificate

export const child = certified(review, certificate)
export const parent = setup({ actors: { child } })
```

## Add the lint rule

The compiler does not refuse a spread into `states` with an explicit key. Add this selector to
your ESLint `no-restricted-syntax` rule. The rule does not ship with the package.

```js
{
  selector:
    "CallExpression:matches([callee.name='createMachine'], [callee.property.name='createMachine']) :matches(Property[key.name='states'], Property[key.value='states']) SpreadElement",
  message: "A spread inside states hides state keys from the settlement proof.",
}
```

The [limits](../reference/setup.md#limits-of-the-compile-time-proof) list the forms that this
selector does not see. `proveSettlement` covers those forms at run time.

## Related

- [Settlement proof and certificates](../reference/settlement.md)
- [Why agent machines must settle](../explanation/agent-settlement.md)
- [Limits of the compile-time proof](../reference/setup.md#limits-of-the-compile-time-proof)
