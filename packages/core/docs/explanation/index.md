---
title: Explanation
doc-type: index
---

# Explanation

Understanding-oriented discussion of the design: why the package is built as it is, and what follows for your code.

## Concepts

- [About state machines and statecharts](./state-machines.md) — A state machine names every mode a system can be in and the events that move it from one mode to the next; a statechart adds nesting, parallel regions and history so that real behaviour stays readable.
- [About the actor model](./actor-model.md) — An actor is a running instance of some logic: it keeps a private snapshot, takes events one at a time, and affects other actors only by sending them events.

## The Effect design

- [Why Effect](./why-effect.md) — The package keeps XState's behaviour and gives it an Effect-native surface: creating, starting and talking to an actor are Effects, every actor lives in a `Scope`, the services that actions and actors need appear in types, and absent values are `Option`s.
- [How services reach actions and actors](./services-and-requirements.md) — An actor takes its Effect services from the program that creates it: `createActor` captures them once, and every action and child actor of that actor runs with them, the initial entry actions included.
- [Actor lifetimes and scopes](./actor-lifetimes-and-scopes.md) — Every actor lives in an Effect `Scope`.
- [How an actor processes events](./event-processing.md) — Each actor has its own mailbox and its own fiber, and it processes one event at a time, to completion: one macrostep per event, which publishes one snapshot.
- [How failures surface](./failure-model.md) — A failure inside a running actor — in an action, a guard, an assigner or the actor's logic — does not throw and does not fail `send`.

## Compared with XState

- [How this package differs from XState](./differences-from-xstate.md) — The package aims at XState 5.33.2's behaviour, not at its signatures.
