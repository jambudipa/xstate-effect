---
title: How this package differs from XState
doc-type: explanation
sources: [packages/core/README.md, packages/core/test/upstream/CONFORMANCE.md]
---

# How this package differs from XState

> **TL;DR:** The package aims at XState 5.33.2's behaviour, not at its signatures. Machine
> configs, the statechart algorithm, the action and guard forms and the built-in events follow
> XState; the API around them is Effect-native. Actors are created and driven through Effects,
> live in a `Scope`, report absent values as `Option`s and never throw. Where XState would leave
> an actor, a timer or a resource running, the package stops it, and every deliberate difference
> is recorded with its reason.

## The question

If you know XState, which of that knowledge carries over, and why do the parts that changed look
the way they do? This page gives the reasons. For the line-by-line changes to your code, see
[How to port XState code to this package](../how-to/migrate-from-xstate.md).

## Same behaviour, different signatures

The package is a port of XState 5.33.2, held to it by XState's own tests: all 74 test files of
that release are rewritten in Effect form and run in the package's test suite. A difference from
XState's behaviour is allowed only on purpose. Each one is recorded in a conformance ledger in the
repository, with the decision that requires it; how hard it would be to match XState is never a
reason.

What carries over unchanged is most of what you write when you model: the config shape, `setup`,
`createMachine` and `provide`; parallel and history states, eventless and delayed transitions,
final states, `invoke` and `spawnChild`; the action and guard creators and their forms; the
built-in event types and their fields; the entry-point subpaths; and the names of XState's type
helpers (see [XState type names](../reference/upstream-type-names.md)). XState's documentation
of statechart semantics applies here.

What changes is the code that runs the machines. The package could have offered XState's
synchronous, Promise-based API as a facade over an Effect core. It does not: a facade would double
the API, hide the scope that owns each actor, and turn typed failures back into exceptions. A
program that wants Effect gets all of it; a program that wants XState's API has XState.

## Effects in place of calls

`createActor` returns an Effect that needs a `Scope`, and `start`, `stop`, `send` and
`getSnapshot` are Effects too. `system.get` gives an Effect of an `Option`. Beyond the actor, every
API that can run one of your guards or actions returns an Effect: `snapshot.can`,
`machine.transition`, the pure functions such as `transition` and `getNextSnapshot`, and the graph
traversals.

The reason is that a guard or an action may itself return an Effect here, with the services it
needs (see [How services reach actions and actors](services-and-requirements.md)). A function
that may run an Effect cannot return a plain value without running that Effect behind your back,
outside your runtime and your services. So the whole chain stays an Effect.

```ts
import { Effect } from "effect"
import { createActor, createMachine } from "@jambudipa/xstate-effect"

const door = createMachine({
  types: {} as { events: { type: "OPEN" } | { type: "CLOSE" } },
  initial: "closed",
  states: {
    closed: { on: { OPEN: "open" } },
    open: { on: { CLOSE: "closed" } }
  }
})

const program = Effect.gen(function* () {
  // XState: const actor = createActor(door); actor.start()
  const actor = yield* createActor(door)
  yield* actor.start

  // XState: actor.send({ type: "OPEN" }); const snapshot = actor.getSnapshot()
  yield* actor.send({ type: "OPEN" })
  const snapshot = yield* actor.getSnapshot

  // XState: snapshot.can({ type: "CLOSE" }) returns a boolean
  const canClose = yield* snapshot.can({ type: "CLOSE" })
  console.log(snapshot.value, canClose) // open true
})

void Effect.runPromise(Effect.scoped(program))
```

The cost is ceremony: a `yield*` where XState has a call, and no way to ask `can` from synchronous
code without running an Effect. `matches`, `hasTag`, `getMeta` and `toJSON` stay synchronous,
because they never run your code.

## Nothing throws

XState throws in a few places as part of its contract: `createMachine` for a broken config,
`machine.resolveState` for a state value that names no state, and `assertEvent`. Here none of them
throws. `createMachine` keeps the first definition error and every Effect that computes a snapshot
of the machine fails with it; `resolveState` and `assertEvent` fail their Effects. Each failure
keeps XState's message, so error texts you know still match.

An Effect program handles failures in the error channel; an exception from library code would
bypass it, along with the typed errors and the supervision that come with it. The trade-off is
timing: a broken config is reported when its first snapshot is computed, not at the line that
defines it. [How failures surface](failure-model.md) covers the whole error model, including why
an actor error that nothing handles is logged instead of being rethrown from a timer as XState
does.

The same rule — library code stays inside Effect — explains why the package writes nothing to the
console. `log` actions use Effect logging at their level by default, and the package's warnings
go through the Effect logger, where XState prints with `console`.

## `Option` in place of `undefined`

`snapshot.output`, `snapshot.error`, the `output` of a done event and the context of a
`fromObservable` actor are `Option`s. Effect code models absence with `Option`, and a field that is
sometimes `undefined` is easy to read without checking. An `undefined` value becomes
`Option.none()`, so `Option.some(undefined)` never appears. The persisted form encodes `none` as a
missing key, which keeps persisted JSON close to XState's. The `error` of an error event stays the
raw value: it is always present.

## Lifetimes belong to scopes

An actor lives in the scope you create it in, and its children live in its scope. Closing the scope
stops the actor and everything under it, and their finalizers run. Subscriptions follow the same
idea: `subscribe` and `on` last until the scope they ran in closes, which is why there is no
`Subscription` object, no observer-object form and no `Symbol.observable`; the `changes` stream is
the observable form of an actor.

This closes the gaps where XState can leave work running: the children of an actor that errors, a
child replaced by a later spawn with the same id, and an actor created with the `parent` option
after its parent stops. Here each of them stops, because its scope is inside its parent's.
[Actor lifetimes and scopes](actor-lifetimes-and-scopes.md) explains the model and its cost: an
actor cannot outlive its scope.

## A send waits for its macrostep

XState processes an event inside `send`, so the snapshot is up to date when `send` returns. Each
actor here processes events in its own fiber. An external `yield* actor.send` therefore waits
until the macrostep of its event commits, which gives the same guarantee for that actor. Sends
from inside an actor only queue, so two actors can never wait for each other.
[How an actor processes events](event-processing.md) explains where this differs in practice: a
cascade to other actors can still be in flight when `send` returns.

## Where the package goes further

Some differences add what XState does not have, each because an Effect program needs it or because
XState's behaviour loses information:

- **Effect-based logic.** `fromEffect`, `fromEffectBackground`, `fromEffectRetry` and `fromStream`
  run an `Effect` or a `Stream` as an actor, with its services and its interruption.
- **Persistence through a `Schema` codec.** A persisted snapshot encodes children, tags and the
  delayed events still pending, and a restore decodes through the same codec. XState's restore
  loses pending delayed events; here they resume after the time that was left. An opt-in check,
  `validateSnapshot`, rejects an inconsistent snapshot that XState would accept.
- **Wider send targets.** A string target of `sendTo` and `stopChild` also resolves by `systemId`,
  and `sendSelf` targets the actor itself.
- **A clock you drive with Effects.** `SimulatedClock` keeps XState's method names, but `increment`
  and `set` are Effects that fire due timers one at a time and wait for each macrostep they cause,
  so a timer that a fired event starts can fire in the same `increment`.
- **Streams.** `changes`, `emissions` and `select(...).changes` give snapshots, emitted events and
  selected values as Effect `Stream`s.

## What is left out

`interpret`, `toObserver`, the observer-object forms of `subscribe` and `inspect`, `Subscription`,
`InteropObservable` and `new Actor` have no counterpart: scoped Effects and Streams do their work.
The package ships one ES module build, with no CommonJS build and no development build.

## Smaller differences

A few differences follow from the package's coding rules rather than from Effect itself:

- `snapshot.tags` is a read-only array, each tag once in XState's order, and a state node's
  `transitions` is an array of entries in declaration order. XState uses a `Set` and a `Map`; the
  order is observable, and the package avoids native `Set` and `Map`.
- The built-in action and guard creators return definition objects, not functions. Passing them as
  actions and guards works as in XState; calling them as functions does not.
- `createMachine`'s type parameters start with context, events, input, output, emitted events and
  the Effect requirements, then XState's others. Code that types a machine through `types` or
  `setup` sees no difference.

## Consequences for you

- Keep your machine definitions; rewrite the code that creates, drives and observes actors.
- Read XState's documentation for what a statechart does, and this package's reference for the
  signatures.
- Where an XState example calls something synchronously, expect an Effect here, and where it
  checks for `undefined`, expect an `Option`.
- If you find a behaviour that differs from XState and that neither this page nor the migration
  guide explains, treat it as a defect and report it.

## Related

- [How to port XState code to this package](../how-to/migrate-from-xstate.md): the practical list.
- [XState type names](../reference/upstream-type-names.md).
- [Entry points](../reference/entry-points.md).
- [Why Effect](why-effect.md).
- [Actor lifetimes and scopes](actor-lifetimes-and-scopes.md),
  [How an actor processes events](event-processing.md) and
  [How failures surface](failure-model.md).
