---
title: How to handle actor errors
doc-type: how-to
sources: [packages/core/src/Errors.ts, packages/core/src/Actor.ts]
---

# How to handle actor errors

> **TL;DR:** Recover from a child's failure in its parent with `onError`, or with a transition on
> `xstate.error.actor.<id>` for a spawned child; the event's `error` is the raw value. An actor
> that errors has status `error` and keeps the value in `snapshot.error`, an `Option`, and its
> `changes` stream, `toEffect` and `waitFor` fail with that value. An error that nothing handles
> is logged once with `Effect.logError`, so provide an Effect `Logger` to capture it.

## When you need this

Part of an actor can fail: an invoked or spawned child, a custom action or guard that throws or
returns a failing Effect, or a machine config with a definition error. You want the machine to
recover, your program to see the failure, or your monitoring to receive it.

## Before you start

- You create and run actors with `createActor` inside `Effect.scoped`.
  [Build your first state machine](../tutorials/01-first-state-machine.md) shows how.
- You know how to invoke work from a state. See
  [How to invoke asynchronous work](invoke-async.md).

## Steps

### 1. Recover from an invoked child's failure

An invoked child that fails sends `xstate.error.actor.<id>` to its parent. Give the invocation an
`onError` transition to take that event. The event's `error` is the value that the child failed
with, unchanged: the typed failure of an Effect, the rejection of a Promise, or what a callback
threw. Its type is `unknown`, so narrow it before you read it.

```ts
import { Data, Effect, Option } from "effect"
import { assign, createActor, fromEffect, setup, waitFor } from "@jambudipa/xstate-effect"

class SaveFailed extends Data.TaggedError("SaveFailed")<{ readonly reason: string }> {}

const saveMachine = setup({
  types: {} as { context: { lastError: Option.Option<string> } },
  actors: {
    saveDocument: fromEffect(() => Effect.fail(new SaveFailed({ reason: "disk full" })))
  }
}).createMachine({
  context: { lastError: Option.none() },
  initial: "saving",
  states: {
    saving: {
      invoke: {
        src: "saveDocument",
        onDone: "saved",
        onError: {
          target: "failed",
          actions: assign({
            lastError: ({ event }) =>
              Option.some(event.error instanceof SaveFailed ? event.error.reason : String(event.error))
          })
        }
      }
    },
    saved: { type: "final" },
    failed: {}
  }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(saveMachine)
  yield* actor.start

  // The child's error reaches the parent as an event: wait for the state it leads to
  const snapshot = yield* waitFor(actor, (s) => s.matches("failed"))
  console.log(snapshot.status, snapshot.context.lastError) // active, Option.some("disk full")
})

void Effect.runPromise(Effect.scoped(program))
```

The parent stays `active`: a failure that the parent takes never changes the parent's own
status. The child runs in its own fiber, so its error event can arrive after `start` returns.
Wait for the state that `onError` leads to, as the example does with `waitFor`.

### 2. Recover from a spawned child's failure

A child that `spawnChild` or `spawn` creates has no `onError`. Take its error event with a
transition on `xstate.error.actor.<id>`, where `<id>` is the id that you gave the child.

```ts
import { Data, Effect } from "effect"
import { assign, fromEffect, setup, spawnChild } from "@jambudipa/xstate-effect"

class SyncFailed extends Data.TaggedError("SyncFailed")<{ readonly attempt: number }> {}

export const syncMachine = setup({
  types: {} as { context: { failures: number } },
  actors: {
    syncWorker: fromEffect(() => Effect.fail(new SyncFailed({ attempt: 1 })))
  }
}).createMachine({
  context: { failures: 0 },
  entry: spawnChild("syncWorker", { id: "worker" }),
  on: {
    "xstate.error.actor.worker": {
      actions: assign({ failures: ({ context }) => context.failures + 1 })
    }
  }
})
```

A child's failure that no transition takes errors the parent too. The parent's status becomes
`error`, and its `snapshot.error` holds the child's raw error.

### 3. Detect that an actor errored

An actor errors when a custom action or guard throws, when an action returns an Effect that fails
or dies, or when a child's failure goes untaken. Then:

- `snapshot.status` is `"error"`.
- `snapshot.error` is `Option.some(error)` with the original value.
- The snapshot keeps the state value and the context from before the event that failed.
- The actor stops. It drops each later `send` with a warning, and its children stop.

```ts
import { Data, Effect, Option } from "effect"
import { createActor, setup } from "@jambudipa/xstate-effect"

class SaveFailed extends Data.TaggedError("SaveFailed")<{ readonly reason: string }> {}

const editorMachine = setup({
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
  const actor = yield* createActor(editorMachine)
  yield* actor.start
  yield* actor.send({ type: "SAVE" })

  const snapshot = yield* actor.getSnapshot
  if (snapshot.status === "error") {
    const message = Option.match(snapshot.error, {
      onNone: () => "no error value",
      onSome: (error) => (error instanceof SaveFailed ? error.reason : String(error))
    })
    console.log(snapshot.value, message) // editing disk full
  }
})

void Effect.runPromise(Effect.scoped(program))
```

### 4. Fail your program with the actor's error

Read the actor through an API that fails with its error:

- `actor.changes` fails with the error, also when the stream starts after the error.
- `toEffect(actor)` waits until the actor ends. It succeeds with the output, an `Option`, and
  fails with the error.
- `waitFor(actor, predicate)` fails with the error when the actor errors before the predicate
  holds.

Their error channel is `unknown`, because an actor can fail with any value. Catch the error with
`Effect.catch`, then narrow it with `instanceof` or `Predicate.isTagged`.

```ts
import { Data, Effect, Fiber, Option, Predicate } from "effect"
import { createActor, fromEffect, toEffect } from "@jambudipa/xstate-effect"

class SaveFailed extends Data.TaggedError("SaveFailed")<{ readonly reason: string }> {}

const saveLogic = fromEffect(() => Effect.fail(new SaveFailed({ reason: "disk full" })))

const program = Effect.gen(function* () {
  const actor = yield* createActor(saveLogic)

  // Wait before start: this actor can fail during start
  const outcome = yield* Effect.forkScoped(toEffect(actor), { startImmediately: true })
  yield* actor.start

  const output = yield* Fiber.join(outcome).pipe(
    Effect.catch((error) =>
      Predicate.isTagged(error, "SaveFailed")
        ? Effect.as(Effect.logWarning("save failed"), Option.none())
        : Effect.die(error)
    )
  )
  console.log(output) // Option.none()
})

void Effect.runPromise(Effect.scoped(program))
```

A running `changes` stream, and so a running `toEffect` or `waitFor`, counts as an error
listener. An actor that hands its error to one does not log it (see the next step). Start the
wait before `start` when the actor can fail during `start`, as the example does. A wait that
starts after the error still fails with it, but the actor has logged the error already.

### 5. Capture the errors that nothing handles

A root actor logs its error once, with `Effect.logError`, in two cases:

- Nothing reads its `changes` stream when it errors.
- A `subscribe` callback watches it. A `subscribe` callback never receives the error, so the
  actor logs it even when a `changes` stream also reads it.

A child hands its error to its parent instead, unless a `subscribe` callback watches the child.

To send these reports to your monitoring, provide an Effect `Logger` to the program that creates
the actor. The `logger` actor option does not receive them: it receives only the output of `log`
actions.

```ts
import { Effect, Logger } from "effect"
import { createActor, setup } from "@jambudipa/xstate-effect"

const reported: Array<unknown> = []

const monitoringLogger = Logger.make((options) => {
  if (options.logLevel === "Error") {
    reported.push(options.message)
  }
})

const machine = setup({
  types: {} as { events: { type: "BREAK" } }
}).createMachine({
  on: {
    BREAK: {
      actions: () => {
        throw new Error("unexpected")
      }
    }
  }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(machine)
  yield* actor.start
  yield* actor.send({ type: "BREAK" })
})

void Effect.runPromise(Effect.scoped(program).pipe(Effect.provide(Logger.layer([monitoringLogger]))))
```

Failures in your own observers go the same way. A `subscribe` callback, an `actor.on` listener
or an inspection function that throws, fails or dies is logged once, and the actor goes on as
before.

### 6. Catch the typed errors of the Effect APIs

The APIs that XState lets throw return an Effect here, and fail it with a tagged error. The
classes are in the `Errors` namespace of the root entry point; the `waitFor` errors are root
exports.

| API | Fails with |
|---|---|
| `snapshot.can(event)` | `GuardError` when a guard throws or names no implementation |
| `assertEvent(event, type)` | `EventAssertionError` when the event matches none of the types |
| `actor.getPersistedSnapshot` | `SerializationError` when the context cannot be encoded |
| `machine.resolveState(config)` | `MachineDefinitionError` for a state value that names no state |
| `machine.getStateNodeById(id)` | `StateNodeNotFoundError` for an id that names no state node |
| `getNextSnapshot`, `transition`, `machine.transition` | `GuardError` or `TransitionError` |
| `waitFor(actor, predicate, options)` | `WaitForTimeoutError`, `WaitForTerminatedError`, the actor's error, or the abort signal's reason |
| `toEffect(actor)` | the actor's error |

Catch one of them by its tag with `Effect.catchTag`:

```ts
import { Effect } from "effect"
import { createActor, createMachine } from "@jambudipa/xstate-effect"

const doorMachine = createMachine({
  types: {} as { events: { type: "OPEN" } },
  initial: "closed",
  states: {
    closed: {
      on: {
        OPEN: {
          guard: () => {
            throw new Error("sensor offline")
          },
          target: "open"
        }
      }
    },
    open: {}
  }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(doorMachine)
  yield* actor.start
  const snapshot = yield* actor.getSnapshot

  const canOpen = yield* snapshot.can({ type: "OPEN" }).pipe(
    Effect.catchTag("GuardError", (error) => Effect.as(Effect.logWarning(error.message), false))
  )
  console.log(canOpen) // false
})

void Effect.runPromise(Effect.scoped(program))
```

Match an error on its `_tag`, not on its `name`. Several classes, such as `GuardError`,
`ActorError` and `InitializationError`, set `name` to `"Error"`, so that they print as XState's
errors do.

## Variations

### A machine config with a definition error

`createMachine` never throws. A config with a definition error, such as an `initial` key that
names no child state, gives an actor whose status is `error` from creation on. Its
`snapshot.error` holds an `InitializationError` with the XState message, whose `cause` is the
`MachineDefinitionError`. Each Effect that computes a snapshot of that machine fails with the
`MachineDefinitionError`, or with an error of its own type whose `cause` it is.

### Retry before you give up

To try failed work again before the parent sees an error, wrap it in `fromEffectRetry` from
`/actors`, or retry from the machine with a delayed transition. See
[How to retry a failing service](retry-pattern.md).

### Reject an inconsistent restored snapshot

Pass `validateSnapshot: true` to `createActor` with a persisted `snapshot`. A machine snapshot with
status `done` on a state that does not complete the machine then gives the actor status `error`,
with an `InvalidPersistedSnapshotError` in `snapshot.error`. See
[How to persist and restore an actor](persist-and-restore-an-actor.md).

## Related

- [Errors](../reference/errors.md): every error class, its tag and its fields.
- [How failures surface](../explanation/failure-model.md): why errors become a status, not a throw.
- [createActor and the actor](../reference/create-actor.md): `changes`, `subscribe` and the
  actor options.
- [How to wait for a state or an output](wait-for-a-state.md): `waitFor` and `toEffect` in detail.
- [How to invoke asynchronous work](invoke-async.md): `onDone` and `onError` on an invocation.
