---
title: How to persist and restore an actor
doc-type: how-to
sources: [packages/core/src/persistence.ts, packages/core/src/Actor.ts]
---

# How to persist and restore an actor

> **TL;DR:** Read `actor.getPersistedSnapshot`, turn it into text with `JSON.stringify`, and store
> the text. To restore, parse the text, pass it to `createActor` as the `snapshot` option, and
> start the actor. A failed restore does not fail `createActor`: check that the restored
> snapshot's `status` is not `error` before you start the actor.

## When you need this

Use this when an actor must outlive the process that runs it: a long-running workflow that must
survive a deploy, a user's session that resumes on the next request, or a job that a worker picks
up after a crash. The persisted snapshot holds the state value, the context, the children with
their own snapshots, and the delayed events that are still pending, so the restored actor
continues where the old one stopped.

## Before you start

- The machine's context holds only JSON values (strings, finite numbers, booleans, `null`,
  arrays and plain objects) and references to the machine's own children. See
  [Context values that are not JSON](#context-values-that-are-not-json) for the rest.
- Each child that the machine spawns has a name in `setup({ actors })`, or is invoked with
  `invoke`. See [Child actors](#child-actors).
- You have somewhere to keep a string: a database row, a file, a key-value store.

## Steps

1. Run the actor as usual, inside a `Scope`.
2. Read `actor.getPersistedSnapshot`. It is an `Effect<unknown, SerializationError>` that gives
   the persisted form of the snapshot the actor holds now; it never waits.
3. Turn the persisted form into text with `JSON.stringify`, and store the text.
4. Later, perhaps in another process, parse the stored text.
5. Create an actor from the same machine with `createActor(machine, { snapshot })`. The entry
   actions do not run again for a restored snapshot.
6. Read the restored actor's snapshot before you start it. A snapshot that does not decode, or a
   state value that names no state of the machine, gives status `error` with a `RestoreError`
   in `snapshot.error`; `createActor` itself never fails.
7. Start the restored actor. It goes on from the restored state.

```ts
import { Data, Effect } from "effect"
import { assign, createActor, createMachine } from "@jambudipa/xstate-effect"

const counterMachine = createMachine({
  types: {} as { context: { count: number }; events: { type: "increment" } },
  id: "counter",
  initial: "active",
  context: { count: 0 },
  states: {
    active: {
      on: { increment: { actions: assign({ count: ({ context }) => context.count + 1 }) } }
    }
  }
})

class RestoreFailed extends Data.TaggedError("RestoreFailed")<{ readonly cause: unknown }> {}

const program = Effect.gen(function* () {
  // 1. Run the actor
  const actor = yield* createActor(counterMachine)
  yield* actor.start
  yield* actor.send({ type: "increment" })
  yield* actor.send({ type: "increment" })

  // 2–3. Read the persisted snapshot and turn it into text for your storage
  const persisted = yield* actor.getPersistedSnapshot
  const text = JSON.stringify(persisted)
  console.log(text)
  // {"status":"active","value":"active","context":{"count":2},"historyValue":{},"tags":[],"children":{}}
  yield* actor.stop

  // 4. Later: parse the stored text
  const stored = yield* Effect.try((): unknown => JSON.parse(text))

  // 5. Create an actor from it
  const restored = yield* createActor(counterMachine, { snapshot: stored })

  // 6. Check the restore before you start the actor
  const restoredSnapshot = yield* restored.getSnapshot
  if (restoredSnapshot.status === "error") {
    return yield* Effect.fail(new RestoreFailed({ cause: restoredSnapshot.error }))
  }

  // 7. Start it: it goes on from the restored state
  yield* restored.start
  yield* restored.send({ type: "increment" })
  const snapshot = yield* restored.getSnapshot
  console.log(snapshot.value, snapshot.context.count) // active 3
})

void Effect.runPromise(Effect.scoped(program))
```

Use `getPersistedSnapshot`, not `JSON.stringify` of a live snapshot. The live snapshot's JSON form
leaves out the children's snapshots and the pending delayed events.

## Variations

### Save after every change

Subscribe before `start`, and read the persisted snapshot in the callback. A callback that
subscribes before `start` also receives the snapshot the actor starts from. The callback's
Effect must not fail, so handle the `SerializationError` there.

```ts
import { Effect } from "effect"
import { assign, createActor, createMachine } from "@jambudipa/xstate-effect"

const counterMachine = createMachine({
  types: {} as { context: { count: number }; events: { type: "increment" } },
  id: "counter",
  initial: "active",
  context: { count: 0 },
  states: {
    active: {
      on: { increment: { actions: assign({ count: ({ context }) => context.count + 1 }) } }
    }
  }
})

// Replace this with a write to your storage
const save = (text: string) => Effect.log(`saved ${text}`)

const program = Effect.gen(function* () {
  const actor = yield* createActor(counterMachine)
  yield* actor.subscribe(() =>
    actor.getPersistedSnapshot.pipe(
      Effect.flatMap((persisted) => save(JSON.stringify(persisted))),
      Effect.catchTag("SerializationError", (error) => Effect.logError(error.message))
    )
  )
  yield* actor.start
  yield* actor.send({ type: "increment" })
})

void Effect.runPromise(Effect.scoped(program))
```

[How to react to snapshot changes](react-to-snapshot-changes.md) covers the other ways to follow
an actor.

### Start a fresh actor when the restore fails

When the stored text is out of date (for example, it names a state that a newer version of the
machine no longer has), the restored actor has status `error`. Create an actor without the
`snapshot` option instead. An actor that you do not start reports nothing; the scope that owns it
cleans it up.

```ts
import { Effect } from "effect"
import { assign, createActor, createMachine } from "@jambudipa/xstate-effect"

const counterMachine = createMachine({
  types: {} as { context: { count: number }; events: { type: "increment" } },
  id: "counter",
  initial: "active",
  context: { count: 0 },
  states: {
    active: {
      on: { increment: { actions: assign({ count: ({ context }) => context.count + 1 }) } }
    }
  }
})

export const restoreOrCreate = (text: string) =>
  Effect.gen(function* () {
    const stored = yield* Effect.try((): unknown => JSON.parse(text))
    const restored = yield* createActor(counterMachine, { snapshot: stored })
    const snapshot = yield* restored.getSnapshot
    if (snapshot.status !== "error") {
      yield* restored.start
      return restored
    }
    yield* Effect.logWarning("The stored snapshot does not restore: starting a fresh actor", snapshot.error)
    const fresh = yield* createActor(counterMachine)
    yield* fresh.start
    return fresh
  })
```

`Effect.try` fails with an `UnknownError` when the text is not JSON at all.

### Reject a done snapshot on a state that is not final

By default, a persisted snapshot with status `done` restores as it is, even when its state value
is not a final state of the machine. Such an actor processes no events. Pass
`validateSnapshot: true` to check for this case: the restored actor then has status `error`, with
an `InvalidPersistedSnapshotError` whose `suggestedFix` is `{ status: "active" }`. The check also
reaches each child that the restore creates again.

```ts
import { Effect } from "effect"
import { createActor, createMachine } from "@jambudipa/xstate-effect"

const orderMachine = createMachine({
  id: "order",
  initial: "pending",
  states: {
    pending: { on: { ship: "shipped" } },
    shipped: { type: "final" }
  }
})

const program = Effect.gen(function* () {
  // A stored snapshot whose status does not match its state
  const stored: unknown = { status: "done", value: "pending", context: {}, children: {} }
  const actor = yield* createActor(orderMachine, { snapshot: stored, validateSnapshot: true })
  const snapshot = yield* actor.getSnapshot
  console.log(snapshot.status) // error
})

void Effect.runPromise(Effect.scoped(program))
```

### Delayed events that are still pending

Nothing extra is needed. When the actor has a delayed event pending (an `after` transition, or a
`raise` or `sendTo` with a `delay`), `getPersistedSnapshot` adds it under the `scheduledEvents`
key, with the time it was scheduled at. The restored actor resumes each one at `start`, after the
time that is left; an event whose time has passed fires at once. An event to an actor that no
longer exists after the restore is dropped. The key is absent when no event is pending.

### Child actors

- The persisted snapshot holds each child under `children`, by its id, with its own persisted
  snapshot and the name of its logic (`src`).
- The restore creates each child again from the machine's implementations, so the name must still
  be in `setup({ actors })`. An entry whose name gives no logic is left out of the restore.
- An invoked child persists also when its logic is written inline in `invoke`.
- A child spawned from inline logic (`spawnChild(fromPromise(...))`) cannot be persisted:
  `getPersistedSnapshot` fails with `SerializationError` and the message
  `An inline child actor cannot be persisted.` Name the logic in `setup({ actors })` and spawn it
  by its name.
- The restored children start when the restored parent starts. A `fromPromise` child that was
  still running runs its promise again.
- A reference to a child in the context persists as a marker with the child's id, and comes back
  as the restored child. A reference to an actor that is not a child comes back as `undefined`.

### Context values that are not JSON

A function, a `bigint`, a symbol, `NaN` or an infinite number, an instance of a class (a `Date`, a
`Map`, a `Set`) and a circular reference make `getPersistedSnapshot` fail with
`SerializationError`. The message names the path, for example
`context.when is an instance of Date: a persisted context holds JSON values and actor references only`.
Keep such values in a JSON form in the context: a date as a number of milliseconds or an ISO
string, a map as a plain object or an array of pairs.

### Copy an actor in the same process

The `snapshot` option also takes a live snapshot from `getSnapshot`. The new actor starts from the
same state and context. Its children start again from their initial snapshots, and the pending
delayed events are not copied, so use `getPersistedSnapshot` when they matter.

## Related

- [Persisted snapshots](../reference/persistence.md): the persisted form, field by field.
- [createActor and the actor](../reference/create-actor.md): the `snapshot` and
  `validateSnapshot` options and `getPersistedSnapshot`.
- [Errors](../reference/errors.md): `SerializationError`, `RestoreError` and
  `InvalidPersistedSnapshotError`.
- [How to use delayed transitions and delayed events](use-delayed-transitions.md)
- [How to react to snapshot changes](react-to-snapshot-changes.md)
