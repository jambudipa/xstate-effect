---
title: How services reach actions and actors
doc-type: explanation
sources: [packages/core/src/setup.ts, packages/core/src/Actor.ts, packages/core/src/Types.ts, packages/core/src/StateMachine.ts]
---

# How services reach actions and actors

> **TL;DR:** An actor takes its Effect services from the program that creates it: `createActor`
> captures them once, and every action and child actor of that actor runs with them, the
> initial entry actions included. For a `setup` machine the compiler knows which services those
> are: `createActor`'s type requires what the setup's actions and actors need, what the config's
> inline actions and actor logic need, and what the implementations given to `provide` need. A
> plain `createMachine` config, the actions that `enqueueActions` enqueues and the actions of an
> `initial` object or a `route` add nothing to the type, and a guard cannot use a service at all.

## The question

An action can return an Effect, and an Effect can read a service such as a repository, a mailer
or an HTTP client. That raises two questions. Where does the action's Effect get the service
from, when the action runs long after the program called `createActor`, perhaps because a timer
fired or another actor sent an event? And why does the compiler insist on a service for some
machines and say nothing for others? This page answers both.

## Services are captured at creation

`createActor` is an Effect, so it runs inside a program that has a set of services. At that
moment the actor captures them. Everything the actor does afterwards runs with that captured set:
the logic's start, the initial entry actions, every macrostep, the stop, and every child it
invokes or spawns, at any depth. `start`, `send` and `getSnapshot` need no services of their
own; their type is `Effect<void>` or `Effect<Snapshot>` with no requirements.

The design follows from how actors run. A started actor processes events in its own fiber, and
events reach it from anywhere: an HTTP handler, a timer, another actor's `sendTo`. If an action
read its services from whoever sent the event, every sender would have to provide every service
of every actor it talks to, and an actor reference would have to carry a requirements type.
Sending between actors would then leak each actor's dependencies into the others. Capturing
once, at creation, keeps `send` free of requirements and keeps references uniform: a reference
says which events an actor accepts, not what it needs to run.

Two other designs were possible. A global runtime holding every service would work at run time,
but the compiler could no longer say which services a machine needs. XState's own answer,
`machine.provide`, is still available, but it swaps implementations of named actions and actors;
it does not supply an Effect service to code that reads one.

The trade-off of capturing is that an actor keeps the services it was created with. Providing a
different implementation later, around a `send`, changes nothing for a running actor. To run a
machine against a test implementation, create its actor in a program that provides the test
implementation. A service built from a scoped layer must also outlive the actors that captured
it. That holds when the layer is provided outside the `Effect.scoped` that owns the actors, so
the actors stop before the layer releases its resources; a layer provided inside that scope is
released first, while its actors are still running.

## What the compiler tracks

For a machine built with `setup`, the machine's type carries a requirements parameter. It is the
union of these:

- the requirements of the Effect that each action in `setup({ actions })` returns, and of each
  actor logic in `setup({ actors })`;
- the requirements of the config as it is written: the Effects of the inline actions in `entry`,
  `exit` and the transitions of every state, and the inline actor logic of an `invoke`;
- for a machine that `machine.provide` made, the requirements of the implementations it was
  given.

A `fromEffect`, `fromEffectBackground`, `fromEffectRetry` or `fromStream` logic carries the
requirements of its Effect or Stream, and a child machine built with `setup` carries its own, so
they add up through the tree. `createActor` of that machine then requires `Scope` and that union.

The setup's `createMachine` can read the config because it keeps the config's own type, as it
is written: each inline function keeps its return type, so the type sees the Effect that an
action returns and what that Effect needs. `provide` keeps the type of the implementations it is
given in the same way, so a replacement action whose Effect needs a new service adds that
service to the new machine. A replacement actor is stricter: it must have the type of the logic
that it replaces, so one that needs a new service is a type error rather than a new requirement.

```ts
import { Context, Effect, type Scope } from "effect"
import { createActor, setup } from "@jambudipa/xstate-effect"

class Audit extends Context.Service<Audit, {
  readonly record: (entry: string) => Effect.Effect<void>
}>()("app/Audit") {}

const orderMachine = setup({
  actions: {
    recordOpened: () =>
      Effect.gen(function* () {
        const audit = yield* Audit
        yield* audit.record("order opened")
      })
  }
}).createMachine({ entry: "recordOpened" })

// The setup action's Effect needs Audit, so creating the actor needs Audit too
export const created: Effect.Effect<unknown, never, Scope.Scope | Audit> = createActor(orderMachine)
```

A program that runs this without providing `Audit` does not compile: `Effect.runPromise` accepts
only an Effect with no requirements left. This is the main reason to prefer `setup` for machines
that use services. The compiler turns "forgot to wire the audit log" from a run-time surprise
into a type error.

## What the compiler does not track

Requirements are read from a setup's records, from a setup machine's config, and from what
`provide` is given. Each of the gaps below has a reason, and each has the same run-time
consequence: the actor still runs with whatever services its creator had, so an Effect that
reads a service the program never provided fails with `Service not found`, and the actor ends
with status `error`.

**A plain `createMachine`.** XState types the config and the implementations of `createMachine`
by the declared types alone, not as they are written, and its errors for an action or a guard
name that the types do not declare depend on that. The port keeps that inference, so an action
function's return type there is `unknown`: a returned Effect is accepted, but its requirements
are not inferred, in the config or in the `implementations` argument. Its actor needs only a
`Scope`. The machine below compiles, and it works only if the program that creates the actor
happens to provide `Audit`. Its `provide`, as for a setup machine, adds the services of what it
is given.

```ts
import { Context, Effect, type Scope } from "effect"
import { createActor, createMachine } from "@jambudipa/xstate-effect"

class Audit extends Context.Service<Audit, {
  readonly record: (entry: string) => Effect.Effect<void>
}>()("app/Audit") {}

const orderMachine = createMachine({
  entry: () =>
    Effect.gen(function* () {
      const audit = yield* Audit
      yield* audit.record("order opened")
    })
})

// Only a Scope: nothing asks for Audit. Without it, the entry action fails when the actor starts
export const created: Effect.Effect<unknown, never, Scope.Scope> = createActor(orderMachine)
```

**An action that `enqueueActions` enqueues.** The callback of `enqueueActions` chooses its
actions at run time, and `enqueue` takes any action, so the type never sees the Effect of an
action that the callback enqueues inline. An action named in `setup({ actions })` and enqueued
by its name is tracked through the record.

**An inline action of an `initial` object or a `route`.** The setup reads the inline actions of
`entry`, `exit` and the transitions of each state, but not the `actions` of
`initial: { target, actions }` or of a state's `route`. An action named in the setup and used by
its name there is tracked through the record.

**A guard.** A guard may return an `Effect<boolean>`, but that Effect has no requirements, and
a guard that reads a service is a type error. Guards answer whether a transition is enabled,
and the package asks that question in places that have no service context: `snapshot.can`,
for instance, works on a plain snapshot value and returns an Effect without requirements. Data
from a service therefore reaches a guard through the context or the event: an action or an
invoked actor reads the service and puts the result where the guard can see it.

## What this means for you

- Build machines whose actions or actors use services with `setup`. The compiler then asks for
  the services of the setup's records, of the config's inline actions and actor logic, and of
  the implementations given to `provide`.
- Provide services around the Effect that calls `createActor`, not around `start` or `send`.
- Treat the actions of a plain `createMachine`, the actions that `enqueueActions` enqueues
  inline, and the inline actions of an `initial` object or a `route` as untracked: the program
  must provide their services by convention, and a missing one shows up as an actor error.
- Keep guards free of services; move service data into context first.
- To swap a service in a test, create the actor in a program that provides the test version.

## Related

- [How to give a machine's actions and actors Effect services](../how-to/provide-services-to-a-machine.md)
  — the steps, with a `Layer` and with a test implementation.
- [createActor and the actor](../reference/create-actor.md) — the signatures of `createActor` and
  their requirements.
- [setup and setupWithSchema](../reference/setup.md) — the `actions` and `actors` records.
- [fromEffect, fromEffectBackground and fromEffectRetry](../reference/actors/from-effect.md)
- [Why Effect](why-effect.md) — the wider reasons for an Effect-native runtime.
- [Actor lifetimes and scopes](actor-lifetimes-and-scopes.md) — how long an actor, and the
  services it captured, stay in use.
