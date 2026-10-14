---
title: How failures surface
doc-type: explanation
sources: [packages/core/src/Errors.ts, packages/core/src/Actor.ts, packages/core/src/stateUtils.ts]
---

# How failures surface

> **TL;DR:** A failure inside a running actor — in an action, a guard, an assigner or the actor's
> logic — does not throw and does not fail `send`. It gives the actor status `error`, keeps the
> raw value in `snapshot.error`, ends the actor, and reaches the parent as
> `xstate.error.actor.<id>`, as in XState. A machine definition error fails each Effect that
> computes a snapshot, with XState's message. The Effect APIs fail with typed errors, and an
> error that nothing handles is logged once through the Effect logger.

## The question

XState reports failures in three ways: it turns some into an actor status, it throws some from
the call that meets them, and it rethrows the rest asynchronously. An Effect program has one
place for failures — the error channel of the Effect that meets them — and expects library code
never to throw. This page explains how the package reconciles the two: which failures become a
status, which become a failed Effect, which are only logged, and why.

## Failures inside an actor become a status

A running actor executes your code: actions, guards, assigners, the context factory, the logic
of `fromPromise`, `fromEffect` and the other creators, even the `logger` option. When that code
throws, returns an Effect that fails, or dies, the package follows XState's model:

- The actor's status becomes `error`, and `snapshot.error` is `Option.some` of the original
  value: the thrown value or the Effect's failure, not a wrapper around it.
- The snapshot keeps the state value and the context from before the failed event. Nothing that
  the failed macrostep changed is in it; none of its sends goes out and no child it spawned
  starts. A custom action that ran before the failure has run, because its effect cannot be
  undone (see [How an actor processes events](event-processing.md)).
- The actor ends: its mailbox closes, later sends are dropped with a warning, its delayed events
  are cancelled, and its scope closes, so its children stop (see
  [Actor lifetimes and scopes](actor-lifetimes-and-scopes.md)).
- Its `changes` streams fail with the original value, and so do `toEffect` and a `waitFor` that
  had not matched yet. A `changes` stream started later fails with it too.
- Its parent receives `xstate.error.actor.<id>`, whose `error` is the raw value.

A parent decides what the failure means. An invocation takes the event with `onError`, and any
transition can take it by its type. A parent that takes no transition for it errors itself, with
the same raw value, so an untaken failure climbs the actor tree until some ancestor handles it or
the root errors. This is the supervision of the actor model: the actor that knows the context of
a failure decides whether it is fatal.

The one wrapping that XState performs is kept. A guard that throws while a transition is
selected for an event fails with a `GuardError` whose message is XState's — `Unable to evaluate
guard '<type>' in transition for event '<event>' in state node '<id>':` followed by the original
message — and whose `cause` is the original value.

A machine of `setupWithSchema` treats a value that does not match its schemas as code that
throws: an event, a context, an input or an output of the wrong type gives the actor status
`error` with the `SchemaError` of Effect Schema, as an action that throws it would.

```ts
import { Data, Effect, Option } from "effect"
import { createActor, setup } from "@jambudipa/xstate-effect"

class SaveFailed extends Data.TaggedError("SaveFailed")<{ readonly reason: string }> {}

const editor = setup({
  types: {} as { events: { type: "SAVE" } },
  actions: {
    save: () => Effect.fail(new SaveFailed({ reason: "disk full" }))
  }
}).createMachine({
  initial: "editing",
  states: {
    editing: { on: { SAVE: { target: "saved", actions: "save" } } },
    saved: {}
  }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(editor)
  yield* actor.start
  yield* actor.send({ type: "SAVE" }) // succeeds: the failure belongs to the actor

  const snapshot = yield* actor.getSnapshot
  console.log(snapshot.status, snapshot.value) // error editing
  console.log(Option.isSome(snapshot.error)) // true: the SaveFailed value itself
})

void Effect.runPromise(Effect.scoped(program))
```

### Why `send` does not fail

It would be possible to fail the `send` whose event made the actor error. XState does not throw
from `send` in that case either: an action that throws while `send` processes the event gives the
actor status `error`. The package keeps that, and the reason goes beyond parity: the sender does
not own the actor. The same failure could come from a delayed event, a child's message or another
actor's send, and none of those has a caller to fail. Putting the failure on the actor, where every
observer can see it, gives one answer for all of them. So `send` never fails, and its error
channel is `never`.

### Why the error type is `unknown`

`snapshot.error`, the error of `changes` and the failure of `toEffect` are typed `unknown`.
Any of your code can fail with any value — a thrown `Error`, a tagged error, a rejected Promise's
reason — and the package passes the value through unchanged rather than forcing it into one class.
Narrow it with `instanceof` or `Predicate.isTagged` where you handle it. Keeping the raw value also
keeps XState's behaviour: code that inspects `event.error` in an `onError` handler sees what the
child failed with.

## Definition errors fail Effects, never `createMachine`

XState's `createMachine` throws for a broken config: a compound state without `initial`, a target
that names no state, an unknown `#id`. Here `createMachine` never throws. The machine keeps the
first definition error, in the order XState would report them, and each Effect that computes a
snapshot of it fails with that error and XState's message:

- `getInitialSnapshot` and `initialTransition` fail with an `InitializationError`,
  `machine.transition` and `transition` with a `TransitionError`, and a restore with a
  `RestoreError`; each carries the `MachineDefinitionError` as its `cause`.
- `machine.resolveState` fails with the `MachineDefinitionError` itself, as it does for a state
  value that names no state.
- `createActor` keeps its signature: its actor has status `error` from creation on, with the
  `InitializationError` in `snapshot.error`.

The trade-off is visibility. XState reports a broken config at the line that defines it; here
the report comes when the first snapshot is computed. In practice that is the first test or the
first `createActor`, so a broken config still fails early, but through the error channel of an
Effect you already handle rather than as an exception at module load.

## The Effect APIs fail with typed errors

The APIs that XState lets throw, and that run outside an actor, return Effects with a typed error
channel. `snapshot.can` and the pure transition functions fail with a `GuardError` when a guard
throws; `assertEvent` fails with an `EventAssertionError`; `getPersistedSnapshot` fails with a
`SerializationError` for context the codec cannot encode; `waitFor` fails with a
`WaitForTimeoutError` or a `WaitForTerminatedError`. Each is a tagged error, so `Effect.catchTag`
selects it. Several of them set `name` to `"Error"`, so that they print as XState's errors do;
match on `_tag`, never on `name`.

## Programming errors are defects

A few failures mean that the calling code is wrong, not that the world failed, and the package
makes them defects: the Effect dies instead of failing. Examples are a string passed to `send` in
place of an event object, `stop` on an actor that has a parent, and a second actor registered
under a `systemId` that is in use. Each dies with XState's message. A defect is visible in the
cause of the Effect, but it is not part of its declared error type, because no program should
handle it as an expected outcome.

## What nothing handles is logged, not rethrown

XState rethrows an actor error that nobody handles asynchronously, from a timer, so that it
cannot go unnoticed. A library on Effect cannot do that: an exception from a timer escapes the
program's fibers, its error handling and its supervision, and can bring down the process. The
package reports such an error once, with `Effect.logError`, through the Effect `Logger` of the
fiber that meets it. A root actor reports its error when no `changes` stream reads it, or when a
`subscribe` callback watches it, since a callback never receives the error. A child hands its
error to its parent instead, unless a `subscribe` callback watches the child. To route these
reports to your monitoring, provide an Effect `Logger`. The actor's `logger` option is not the
place: as in XState, it is the function that `log` actions call, and no error reaches it.

Failures in your observers follow the same path. A `subscribe` callback, an `actor.on` listener,
an inspection function or a callback actor's clean-up that throws, fails or dies is logged once,
and the actor's status does not change for it. An observer is a bystander: its failure says
nothing about the actor's state, so it must not change the actor's status.

## Consequences for you

- Read a failure from the actor — its status, `snapshot.error`, `changes`, `toEffect` or
  `waitFor` — not from the `send` that triggered it.
- Handle a child's failure in its parent with `onError` or an `xstate.error.actor.<id>`
  transition; an untaken failure takes the parent down with it.
- Expect a broken config to fail the first Effect that computes a snapshot, and test machines
  early.
- Provide an Effect `Logger` in production, so that errors nothing handles reach your monitoring.
- Catch the typed errors of the Effect APIs by `_tag`.

## Related

- [How to handle actor errors](../how-to/handle-actor-errors.md): recover, observe and log
  failures step by step.
- [Errors](../reference/errors.md): every error class, its tag and its fields.
- [Snapshots](../reference/snapshots.md): `status`, `error` and `output`.
- [Actor lifetimes and scopes](actor-lifetimes-and-scopes.md): what ending an actor releases.
- [How this package differs from XState](differences-from-xstate.md).
- [Why Effect](why-effect.md).
