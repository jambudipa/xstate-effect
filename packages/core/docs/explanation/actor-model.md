---
title: About the actor model
doc-type: explanation
sources: [packages/core/src/Actor.ts, packages/core/src/ActorSystem.ts]
---

# About the actor model

> **TL;DR:** An actor is a running instance of some logic: it keeps a private snapshot, takes
> events one at a time, and affects other actors only by sending them events. In this package
> each actor runs in its own fiber inside its own scope, each root actor owns a separate actor
> system, and a parent owns the lifetime of its children. Failures travel up the tree as
> events, and the parent machine decides what happens next.

## The question

A state machine on its own is a description: it says how a snapshot and an event give the next
snapshot, but it does not hold a snapshot, receive events or run side effects. Something has to
do that, and as soon as more than one thing runs at a time, that something has to cope with
concurrency. This page explains the model the package uses for running logic, the actor model,
and the choices it makes about scheduling, systems and parent–child relationships.

## Logic and actors

The package separates *what* runs from *the thing that runs it*. Actor logic is a value: a
machine from `createMachine` or `setup`, or logic from `fromPromise`, `fromCallback`,
`fromObservable`, `fromEventObservable`, `fromTransition`, `fromEffect` or `fromStream`.
`createActor(logic)` turns any of them into an actor, and every actor has the same surface:
`start`, `stop`, `send`, `getSnapshot`, `changes` and the rest.

That uniformity is the point. A machine can invoke a Promise, an Effect, a Stream or another
machine in the same way, and their completion and failure reach it as the same kinds of event.
Code that holds an actor reference does not need to know what logic runs behind it, only which
events it accepts.

## Private state, messages only

An actor's snapshot belongs to it. Other code can read the current snapshot with `getSnapshot`
or follow it through `changes`, but nothing outside the actor can change it: the only way to
influence an actor is to send it an event, and the actor's own logic decides what that event
means in its current state. Each event gives a new snapshot rather than changing the old one,
so a snapshot you hold stays as it was when you read it.

This rules out a whole category of bugs, where two parts of a program update shared data in an
order neither of them expected. It also costs something: a question such as "what is the
current total?" becomes a read of a snapshot that may be out of date a moment later, and a
request–reply exchange between two actors becomes two events.

## One event at a time

Each started actor processes its events in its own fiber, one macrostep at a time. Events that
arrive while a macrostep is running wait in the actor's queue. Inside an actor, then, there is
no concurrency to reason about: actions and guards always see a consistent snapshot, however
many fibers send to the actor at once.

```ts
import { Effect } from "effect"
import { assign, createActor, setup } from "@jambudipa/xstate-effect"

const counter = setup({
  types: {} as { context: { readonly count: number }; events: { readonly type: "INCREMENT" } }
}).createMachine({
  context: { count: 0 },
  on: { INCREMENT: { actions: assign({ count: ({ context }) => context.count + 1 }) } }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(counter)
  yield* actor.start

  // Ten senders on ten fibers: the actor still takes their events one at a time
  yield* Effect.forEach(Array.from({ length: 10 }), () => actor.send({ type: "INCREMENT" }), {
    concurrency: "unbounded"
  })

  const snapshot = yield* actor.getSnapshot
  console.log(snapshot.context.count) // 10
})

void Effect.runPromise(Effect.scoped(program))
```

How long a `send` waits depends on who sends. A send from outside every actor completes after
the actor has committed that event's macrostep, so the next `getSnapshot` shows the result; this
keeps ordinary program code and tests simple to read. A send made from inside an actor (by
`sendTo`, `sendParent`, a delayed `raise`, a callback actor's `sendBack`, or an Effect that an
action returns) only queues the event and returns. If those sends waited too, two actors that
send to each other would each wait for the other to finish, and the system would deadlock.
Events sent before `start` are queued and processed when the actor starts. The detail of this
queueing is in [How an actor processes events](event-processing.md).

## Systems

Actors need to find each other and to share a few services: a registry of actors that have a
`systemId`, a scheduler for delayed events, and the inspection functions that observe
everything. The package groups these into an actor system. Each root actor, one created without
a parent, creates its own system, and every actor it invokes or spawns, at any depth, joins
that system.

The alternative would be one shared system, for example provided as a layer for the whole
program. The package does not do that: a root actor never reads a system from its context, so
two root actors never share one. Their `systemId`s cannot collide, their timers and inspection
streams stay apart, and two tests that run side by side cannot see each other's actors. The
trade-off is that two separate root actors cannot look each other up through the system; one
of them has to be given the other's reference, or both have to live under a common root.

Lookups through the system are Effects: `system.get(systemId)` gives an
`Option` of the actor reference, because the actor may not exist or may have stopped. A
reference is all a sender needs, and a reference carries the types of the events the actor
accepts, so the compiler checks a send against the receiver.

## Parents and children

Actors form a tree. A machine creates children in two ways: it **invokes** an actor for as long
as a state is active, or it **spawns** one from an action and keeps it until it stops it or the child ends. Either
way, the child lives in a scope nested in its parent's scope. When the parent stops, finishes
or fails, its children stop with it, and their finalizers run. No child outlives the actor
that owns it, so a stopped machine cannot leave a timer or a connection running behind it.
[Actor lifetimes and scopes](actor-lifetimes-and-scopes.md) explains the scopes in depth.

Information flows back up the tree as events. A child that completes sends its parent
`xstate.done.actor.<id>`, with its output as an `Option`; a child that fails sends
`xstate.error.actor.<id>`, with the original error. A parent machine reacts to these like any other event, typically in an
invocation's `onDone` and `onError`. An error event that the parent does not handle fails the
parent in turn, so an unexpected failure travels up the tree until some machine takes
responsibility for it, or reaches the root.

This is supervision expressed in the machine itself. The package has no automatic restart
strategy: what to do after a failure (retry after a delay, fall back, give up) is a set of
states and transitions that you write and can test.

```ts
import { Effect } from "effect"
import { fromEffect, setup } from "@jambudipa/xstate-effect"

const fetchQuote = fromEffect(() => Effect.fail("quote service unavailable"))

export const quoteMachine = setup({ actors: { fetchQuote } }).createMachine({
  initial: "loading",
  states: {
    loading: {
      // The child's failure arrives as an event; this machine chooses to wait and try again
      invoke: { src: "fetchQuote", onDone: "ready", onError: "waiting" }
    },
    waiting: { after: { 1000: "loading" } },
    ready: {}
  }
})
```

## What the model does not cover

The actor model is often associated with distribution: Erlang and Akka actors can live on other
machines and be reached through the same kind of reference. Here, actors are fibers in one
process. References give you decoupling and typed messages, not location transparency across
a network; sending events between processes is a job for your own transport.

## What this means for you

- Treat an actor's snapshot as read-only news about it, and send events to change it.
- Rely on one-at-a-time processing inside an actor; there is no need for locks in actions.
- Expect an outside `send` to return after its macrostep, and a send from inside an actor to
  return at once.
- Pass references between root actors that need to talk, or put them under one root.
- Model failure handling as states in the parent; an unhandled child error fails the parent.

## Related

- [Invoke and spawn child actors](../tutorials/05-child-actors.md) — a guided tour of children.
- [How to send events between actors](../how-to/send-events-between-actors.md) and
  [How to spawn and stop child actors](../how-to/spawn-and-stop-children.md)
- [createActor and the actor](../reference/create-actor.md),
  [Actor references](../reference/actor-refs.md) and
  [The actor system](../reference/actor-system.md)
- [How failures surface](failure-model.md) — the error path in full.
- [About state machines and statecharts](state-machines.md) — the logic most actors run.
