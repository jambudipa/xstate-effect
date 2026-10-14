---
title: "@jambudipa/xstate-effect documentation"
doc-type: index
---

# @jambudipa/xstate-effect documentation

`@jambudipa/xstate-effect` gives TypeScript developers the runtime behaviour of XState 5.33.2 as
Effect programs: state machines, statecharts and actors that you create, start and talk to as
Effects, whose actors live in a `Scope`, and whose failures, services and snapshots are typed.
These pages are for developers who use the package in their applications.

## The core: `setup`, `createMachine` and `createActor`

You describe a machine with `setup({ types, actions, guards, actors, delays })` and its
`createMachine(config)`, then run it with `createActor(machine)` inside an Effect program:
`yield* actor.start`, `yield* actor.send(event)`, `yield* actor.getSnapshot`. The
[first tutorial](./tutorials/01-first-state-machine.md) builds one from an empty folder; the
reference for [`setup`](./reference/setup.md), [`createMachine`](./reference/create-machine.md)
and [`createActor`](./reference/create-actor.md) describes every option.

## Start here

[Tutorials](./tutorials/index.md) — six lessons that take you from a first machine to context,
guards, side effects, child actors and tests, with one running example.

## Get a task done

[How-to guides](./how-to/index.md) — recipes for real tasks: type a machine, give its actions
Effect services, invoke asynchronous work, persist and restore an actor, react to snapshots,
test delayed transitions, port XState code, and more.

## Look something up

[Reference](./reference/index.md) — every entry point, function, option, action, guard, actor
logic creator, error and type, with its exact signature and behaviour.

## Understand the design

[Explanation](./explanation/index.md) — why the package is built on Effect, how actor lifetimes
follow scopes, how an actor processes events, how failures surface, how services reach actions,
and how the package differs from XState.
