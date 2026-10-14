---
title: Actor lifetimes and scopes
doc-type: explanation
sources: [packages/core/src/Actor.ts]
---

# Actor lifetimes and scopes

> **TL;DR:** Every actor lives in an Effect `Scope`. A root actor's scope is a child of the scope
> you create it in, and a child actor's scope is a child of its parent's, so the scopes form the
> same tree as the actors. An actor ends when it is stopped, when it is done or errors, or when
> the scope that owns it closes; each way cancels its delayed events, stops its children and runs
> its finalizers once. The price is that an actor cannot outlive the scope you created it in.

## The question

Who owns an actor, and what guarantees that nothing it started — a timer, a child, a
subscription, a connection that its logic opened — is left running after it is gone?

In XState an actor lives until something calls `stop`. An actor that nobody stops is never
stopped, and its delayed events and children stay alive with it. A few paths leave work running
even after a stop: the children of an actor that fails inside an action, a child replaced by a
later `spawnChild` with the same id, and an actor created with the `parent` option. Each of these
is a small leak that only discipline in the calling code prevents.

This package answers the question with Effect's structured concurrency: ownership is a scope,
and closing a scope releases everything in it.

## The design: a scope per actor

`createActor` is an Effect that needs a `Scope`. Running it creates the actor and gives it a
scope of its own, its lifetime:

- A root actor's lifetime is a child scope of the caller's scope.
- A child actor's lifetime — spawned, invoked, or created with the `parent` option — is a child
  scope of its parent's lifetime.

So the tree of scopes mirrors the tree of actors. After `start`, the actor processes its events
in its own fiber, forked into its lifetime, and the work of its logic runs there too: the Effect
of a `fromEffect` actor, the Stream of a `fromStream` actor, the subscription of a
`fromObservable` actor, the clean-up function that a `fromCallback` actor returns. Each of them
is attached to the actor's lifetime, and so released when that lifetime closes.

`createActor` describes a creation; it does not perform one. Each run of the same Effect value
creates a new actor, with its own lifetime. A root actor also creates its own actor system —
registry, scheduler and inspection functions — even when an `ActorSystemLive` layer is in scope,
so two root actors never share a system.

## Four ways to end

| How the actor ends | The logic receives the stop event | Status afterwards | The parent hears |
|---|---|---|---|
| `yield* actor.stop` (root actors only) | yes | `stopped` for most logic | nothing |
| The snapshot reaches status `done` | no | `done` | `xstate.done.actor.<id>` |
| The actor errors | no | `error` | `xstate.error.actor.<id>` |
| The scope that owns the actor closes | no | `stopped` | nothing |

Whatever the way, the end follows the same procedure. The mailbox closes, so later sends are
dropped (see [How an actor processes events](event-processing.md)). The delayed events that the
actor scheduled are cancelled. The actor leaves its system, which frees its `systemId`. Then its
lifetime closes: the lifetimes of its children close with it, so the whole subtree stops, and
every finalizer in that subtree runs, once. Last, its `changes` streams end — or fail, for an
actor that errored — and any sender still waiting for a macrostep returns.

The differences between the ways are small but deliberate:

- **`stop`** is XState's stop. The macrostep in progress commits, the queued events are dropped,
  and the logic receives XState's stop event: a machine stops its children and takes status
  `stopped`, while a `fromTransition` logic gives what its reducer returns for that event.
- **Done and error** keep their snapshot. A done actor hands its output to its parent; an errored
  one hands its error (see [How failures surface](failure-model.md)). In XState the children of an
  actor that errors can keep running; here the actor's lifetime closes, so they stop.
- **A scope close** has no counterpart in XState, so the logic is not asked: a running, active
  actor simply ends with status `stopped`. This is what makes `Effect.scoped(program)` enough to
  clean up every actor the program created.

Two rules follow from the ownership tree. First, a child cannot be stopped from outside: `stop` on
an actor that has a parent dies with `A non-root actor cannot be stopped directly.`, as XState
throws. Its parent owns its lifetime, so stop it through the parent — with `stopChild`, by
leaving the state that invoked it, or by ending the parent. Second, an actor that is stopped
before it starts keeps its snapshot and never starts.

## Resources follow the actor

Because the logic runs in the actor's lifetime, a resource that it acquires is released when the
actor ends, whichever way it ends:

```ts
import { Effect } from "effect"
import { createActor, fromEffect } from "@jambudipa/xstate-effect"

const connection = fromEffect(() =>
  Effect.acquireRelease(Effect.log("connection opened"), () => Effect.log("connection closed")).pipe(
    Effect.andThen(Effect.never)
  )
)

const program = Effect.gen(function* () {
  const actor = yield* createActor(connection)
  yield* actor.start
  yield* Effect.sleep("10 millis")
  yield* actor.stop // logs "connection closed"

  const snapshot = yield* actor.getSnapshot
  console.log(snapshot.status) // "stopped"
})

void Effect.runPromise(Effect.scoped(program))
```

The same holds for the clean-up function of a `fromCallback` actor: it is a finalizer of the
actor's lifetime, so it runs once on a stop, on an error, or when the owning scope closes. XState
runs it only on a stop.

## Subscriptions have their own lifetime

`subscribe`, `on` and the `subscribe` of `actor.select(...)` need a `Scope` too, but it is the
caller's scope, not the actor's. A subscription ends when the scope it ran in closes, which is
why the package has no `Subscription` objects and no `unsubscribe`: closing the scope is the
unsubscribe. A subscription also stops receiving anything once the actor ends. The `changes`
stream is tied to the actor instead: it ends when the actor is done or stopped, and fails when it
errors.

## Alternatives and trade-offs

The obvious alternative is XState's own model: run the logic in the caller's fiber, let `stop` set
a flag, and give each kind of logic its own clean-up hook. An early version of this package
worked that way, and it failed in exactly the places scopes address: finalizers attached to the
caller's scope instead of the actor's, a stop did not interrupt running work, and every kind of
logic needed its own clean-up path. A fiber and a scope per actor solve all three at once,
because interruption and finalization already propagate through Effect's scopes.

The cost is that lifetime is no longer a free choice of the calling code. Above all, an actor
cannot escape its scope: an actor returned out of `Effect.scoped` is already stopped by the time
the caller reads it.

```ts
import { Effect } from "effect"
import { createActor, createMachine } from "@jambudipa/xstate-effect"

const toggle = createMachine({
  types: {} as { events: { type: "TOGGLE" } },
  initial: "off",
  states: { off: { on: { TOGGLE: "on" } }, on: { on: { TOGGLE: "off" } } }
})

const program = Effect.gen(function* () {
  const actor = yield* Effect.scoped(
    Effect.gen(function* () {
      const inner = yield* createActor(toggle)
      yield* inner.start
      return inner
    })
  )
  const snapshot = yield* actor.getSnapshot
  console.log(snapshot.status) // "stopped": the scope that owned it has closed
})

void Effect.runPromise(program)
```

The other costs follow from the same rule:

- **Long-lived actors need a long-lived scope.** An actor that serves a whole application belongs
  in a scope that lives as long: the scope of a layer built with `Layer.effect`, or the scope of
  the program's main Effect.
- **Children never outlive their parent.** Code that relied on XState leaving a child running
  after its parent failed, or after a replacing spawn, sees that child stop here.
- **A scope close skips the stop event.** Logic that reacts to XState's stop event — a
  `fromTransition` reducer, for example — sees it only on an explicit `stop` or when its parent
  stops it, not when its owner's scope closes.

## Consequences for you

- Run each program that creates actors inside `Effect.scoped`, or inside a layer, and let the
  scope stop them.
- Choose the scope by how long the actor must live, not by where it is convenient to create it.
- Put clean-up in finalizers — `Effect.acquireRelease` inside `fromEffect`, the function that a
  `fromCallback` actor returns — and rely on it running once, however the actor ends.
- Stop a child through its parent, never with the child's own `stop`.

## Related

- [About the actor model](actor-model.md): actors, parents and children.
- [How an actor processes events](event-processing.md): what happens to events around a stop.
- [How failures surface](failure-model.md): the error path that closes an actor's lifetime.
- [How to spawn and stop child actors](../how-to/spawn-and-stop-children.md).
- [How to give a machine's actions and actors Effect services](../how-to/provide-services-to-a-machine.md).
- [createActor and the actor](../reference/create-actor.md): `start`, `stop`, `subscribe` and
  `changes`.
- [stopChild, stop and stopAllChildren](../reference/actions/stop-child.md).
