---
title: Why Effect
doc-type: explanation
sources: [packages/core/src/Actor.ts, packages/core/src/setup.ts]
---

# Why Effect

> **TL;DR:** The package keeps XState's behaviour and gives it an Effect-native surface:
> creating, starting and talking to an actor are Effects, every actor lives in a `Scope`, the
> services that actions and actors need appear in types, and absent values are `Option`s. The
> gain is that lifetimes, dependencies and failures are visible to both the compiler and the
> runtime. The cost is more ceremony than XState and code that does not paste across from it
> unchanged.

## The question

XState already works, and Effect programs can call it. Why port its runtime instead of wrapping
it? And why offer only the Effect form, with no Promise or callback API beside it? This page
gives the reasons, and the price you pay for them.

## Parity of behaviour, not of signatures

The aim of the package is that a machine behaves exactly as it does in XState 5.33.2: the same
transitions, the same action order, the same events. It is not that the calls look the same. An
Effect program wants things that XState's synchronous, callback-based surface cannot give it:
work described before it runs, interruption that reaches everything started on its behalf,
resources released when their owner ends, and dependencies that the type checker tracks.

**Why not wrap XState.** A thin layer of Effects around XState's actors would look right from
the outside, but the work would still run outside Effect's fibers. An invoked Promise would not
be interrupted when its state exits; a resource opened by an action would not be tied to any
scope; an action that needs a service would have to capture it from a closure, out of sight of
the compiler. The package runs the statechart algorithm itself, on Effect, so that each of
these is handled by Effect's own machinery.

**Why no Promise facade.** A second, Promise-based API over the Effect core was considered and
rejected. Every behaviour would have two surfaces to keep consistent, and the Promise surface
would drop the scope and the requirements that justify the port. Instead, `createActor`,
`start`, `stop`, `send` and `getSnapshot` are Effects, and the parts of XState that only make
sense with callbacks (`interpret`, `toObserver`, the observer-object form of `subscribe`,
`Subscription` objects) are replaced by scoped Effects and Streams. One small exception
remains: `toPromise` exists for parity with XState's helper of that name, and resolves the same
value as `toEffect`.

## Lifetimes are scopes

Every actor, and every invocation inside it, runs in its own fiber with its own scope.
`createActor` needs a `Scope` from its caller, and the actor's scope is nested in it. Stopping
an actor interrupts its fiber and closes its scope, which runs its finalizers and stops its
children. Leaving a state ends the invocations of that state the same way. Closing the caller's
scope stops a root actor, so `Effect.scoped(program)` is enough to guarantee that nothing it
started is still running afterwards.

```ts
import { Console, Effect } from "effect"
import { createActor, fromEffect, setup } from "@jambudipa/xstate-effect"

const watchFeed = fromEffect(() =>
  Effect.acquireRelease(Console.log("connection opened"), () => Console.log("connection closed")).pipe(
    Effect.andThen(Effect.never)
  )
)

const feedMachine = setup({ actors: { watchFeed } }).createMachine({
  initial: "watching",
  states: {
    watching: { invoke: { src: "watchFeed" }, on: { PAUSE: "paused" } },
    paused: {}
  }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(feedMachine)
  yield* actor.start
  // Leaving "watching" interrupts the invocation: its release runs, "connection closed"
  yield* actor.send({ type: "PAUSE" })
})

void Effect.runPromise(Effect.scoped(program))
```

The alternative is to run each logic in the caller's fiber and give every logic type its own
cleanup hook. That attaches finalizers to the caller's scope instead of the actor's, leaves
`stop` little more than a flag, needs a separate cleanup path for every kind of logic, and still
does not carry interruption into the work an actor started. A fiber and a scope per actor
replaces all of that with one mechanism.
[Actor lifetimes and scopes](actor-lifetimes-and-scopes.md) follows the scopes in detail.

## Descriptions before execution

Because `createActor` returns an Effect, nothing happens until that Effect runs, and each run
creates a new actor. A program can hold `createActor(machine)` as a value, retry it, race it
or run it once per request, and the usual Effect combinators apply. The same holds for
`getNextSnapshot`, `snapshot.can` and the graph traversals: they describe a computation that
may run guards written as Effects.

## Dependencies in types

An action can return an Effect, and an actor can be an Effect or a Stream. Those Effects often
need services: a repository, a mailer, a clock. With `setup`, the services they need become
part of the type of `createActor`, so a program that forgets one does not compile. The actor
captures the services when it is created and gives them to every action and child it runs.
[How services reach actions and actors](services-and-requirements.md) explains the rules, and
where the type tracking stops.

## Failures and absence as values

The package never throws synchronously. A failure inside user code (an action, a guard, an
invoked Effect) does not escape from `send`; it sets the actor's status to `error`, keeps the
original error on the snapshot, ends the actor's `changes` stream with that error and reaches
the parent as an `xstate.error.actor.<id>` event, as XState reports it. The Effect APIs that can
fail have typed errors in their signatures, such as `GuardError` for a guard that throws while
`getNextSnapshot` evaluates it. [How failures surface](failure-model.md) covers the whole path.

Values that may be absent are `Option`s: `snapshot.output`, `snapshot.error` and the `output`
of a done event. In XState these are `undefined` until they are set, and nothing in the type
reminds the reader. `Option` puts the absence in the type, so code that reads an output has to
say what happens when there is none. An output or error whose value is `undefined` is `None`
as well, so there is one representation of "nothing", and the codec for persisted snapshots
turns it into plain JSON and back without loss.

## Time and testing

Delayed transitions and delayed events run on Effect's clock unless an actor is given another
one. A test that runs on `TestClock` can therefore move time forward and see `after`
transitions fire, without real waiting. `SimulatedClock` keeps XState's method names for tests
that already use it, with Effect-returning `increment` and `set`.

## The costs

- **Ceremony.** Every interaction is a `yield*`, a program needs `Effect.scoped` around it, and
  something at the edge has to run the Effect.
- **XState code does not paste across.** The behaviour is the same, but the calls differ:
  `send` is an Effect, `subscribe` takes a function that returns an Effect, outputs are
  `Option`s, and the pure functions return Effects. [How to port XState code to this
  package](../how-to/migrate-from-xstate.md) lists the changes.
- **Effects where XState is synchronous.** `snapshot.can` and `getNextSnapshot` need `yield*`
  even for a machine whose guards are plain functions.
- **Effect itself.** Readers who do not know Effect must learn it first; the package assumes
  fibers, scopes, layers and services.

The judgement behind the package is that these costs are paid once, in syntax, while the
benefits (no leaked fibers, no forgotten dependencies, no hidden exceptions) are paid back on
every actor you run.

## What this means for you

- Run actors inside a scope you control; closing it is how you stop everything.
- Put long-running and resource-holding work in invoked actors, and let state exits end it.
- Build machines whose actions need services with `setup`, so the compiler asks for them.
- Read outcomes from the snapshot status, `Option` outputs and typed Effect errors rather than
  from exceptions.

## Related

- [Run side effects](../tutorials/04-side-effects.md) — actions and Effects in a first machine.
- [How to run an Effect or a Stream as an actor](../how-to/run-an-effect-as-an-actor.md)
- [How to give a machine's actions and actors Effect services](../how-to/provide-services-to-a-machine.md)
- [createActor and the actor](../reference/create-actor.md)
- [How this package differs from XState](differences-from-xstate.md)
- [About the actor model](actor-model.md)
