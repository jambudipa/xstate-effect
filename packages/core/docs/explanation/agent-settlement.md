---
title: Why agent machines must settle
doc-type: explanation
sources: [packages/core/src/actors/fromAgent.ts, packages/core/src/settlement.ts, packages/core/src/graph/settlement.ts, packages/core/src/graph/explore.ts]
---

# Why agent machines must settle

> **TL;DR:** A model can answer with text and move nothing, so a state that waits for a model can
> wait for ever. `fromAgent` removes this failure: an attempt either moves the state or uses the
> budget, and the spent budget gives one output that the machine must handle. A compile-time
> proof, a structural proof and an exhaustive run each check what the others cannot. No single
> layer is a guarantee.

## The question

An ordinary invoked actor ends with a value or an error. A model call has a third result: it
ends and nothing changes. The machine stays in its state, and no event tells it to leave. How can
a program show that this result does not stop the machine?

## A move is an observed state exit

The text of a model's answer is not a move. Only a state exit is a move. `AgentTurn.transition`
delivers an event to the machine and waits for its macrostep. The exit stops the agent before the
call returns. Every other result of an attempt has a name: `silent`, `illegal`, `malformed`,
`crashed` or `overdue`. The agent gives the name to the next attempt as feedback.

The budget and the deadline are literals, so the compiler can read them. When the budget is
spent, the agent outputs one value, `Unsettled`. The error channel is `never`, so `onDone` is the
one handler that the machine needs. The type requires that handler.

## Why agent logic cannot go everywhere

Agent logic runs only as a declared invocation of a state. `createActor`, a spawn and `provide`
all refuse it, as a spawned agent has no state to move. The brand does not spread to a machine
that holds an agent. That machine needs a certificate before a parent can use it, as a parent
must know that the child ends.

`AnyActorLogic` does not take agent logic, because a value of that type has callable methods. The
wider `AnyLogicSlot` takes agent logic, and its methods need a capability that only the runtime
holds.

## Why three layers

Each layer has a limit, and the next layer starts at that limit.

- **The type proof** gives the fastest answer, at the line of the fault. It sees only what
  TypeScript keeps. It counts a guard as able to pass, and a spread with an explicit key hides
  state keys from it.
- **`proveSettlement`** reads the built machine, so spreads and casts do not hide anything. It
  also counts a guard as able to pass. It runs when a test or a gate calls it.
- **`explore`** runs the real guards over the real context. It proves that a final state is
  reachable from every reachable state, for the environment that you declare.

A certificate records the result of these layers. The check derives the result again, so the
file is a record and not an authority. The compiler compares only the state and edge lists of a
certificate. A change to a guard body needs `--check` to find it.

## What a green compile does not mean

A green compile does not prove a machine. The compiler refuses a config that it cannot read, but
a spread into `states` with an explicit key keeps the type of a valid config. A cast through
`unknown` also compiles, so the proofs and the runtime stop it. See
[Limits of the compile-time proof](../reference/setup.md#limits-of-the-compile-time-proof).

## One copy of the library

Agent logic needs one copy of the library in a program. A brand and a stop target are registered
symbols, so a second copy reads them. The capability that runs an agent is private to one copy on
purpose: anything two copies could share, your own code could reach too, and it could then buy the
guarantee for logic that is not an agent. So agent logic under the runtime of another copy fails
closed. The actor errors, and no turn runs. A machine proved by another copy gets no progress credit
for its agent. Run `pnpm why @jambudipa/xstate-effect` if an agent machine errors at its first
invocation with `AgentSpawnError` or `AgentRunError`.

## Consequences for you

- Write the config inline in `createMachine`.
- Run `proveSettlement` and the certificate check in CI.
- Generate certificates again at each upgrade of this package.
- Keep a state's tools small. The state must accept each tool.

## Related

- [fromAgent and AgentTurn](../reference/actors/from-agent.md)
- [Settlement proof and certificates](../reference/settlement.md)
- [How to prove that an agent machine settles](../how-to/prove-an-agent-machine-settles.md)
- [How failures surface](./failure-model.md)
