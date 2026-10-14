---
title: How to wait for a state or an output
doc-type: how-to
sources: [packages/core/src/testing/waitFor.ts, packages/core/src/testing/toPromise.ts]
---

# How to wait for a state or an output

> **TL;DR:** `yield* waitFor(actor, predicate, { timeout })` gives the first snapshot that
> satisfies the predicate, the current snapshot included. `yield* toEffect(actor)` waits until the
> actor is done or stopped and gives its `output` as an `Option`. Both fail with the actor's own
> error when the actor errors; `waitFor` also fails when the actor ends first or the timeout
> elapses.

## When you need this

Use this when a program or a test must not go on until an actor reaches a state: a request handler
that waits for a payment workflow to settle, a script that waits for a job to finish, a test that
waits for a machine to leave its `loading` state. To follow every change instead of one, use
[How to react to snapshot changes](react-to-snapshot-changes.md).

## Before you start

- You have an actor from `createActor`, inside a `Scope`. Start it before you wait, unless
  something else starts it while you wait.
- Both functions come from `@jambudipa/xstate-effect`.

## Steps

1. Start the actor and send it the events that move it on.
2. Call `waitFor` with the actor and a predicate on the snapshot, such as
   `(snapshot) => snapshot.matches("ready")`.
3. Set `timeout`, as a `Duration` or a number of milliseconds, so that the wait cannot last for
   ever. Without it, `waitFor` waits until the predicate holds or the actor ends.
4. Use the snapshot that `waitFor` gives: it is the first snapshot that satisfies the predicate.

```ts
import { Duration, Effect, Option } from "effect"
import { assign, createActor, fromPromise, setup, waitFor } from "@jambudipa/xstate-effect"

const loaderMachine = setup({
  types: {} as { context: { data: string } },
  actors: {
    load: fromPromise(() => new Promise<string>((resolve) => setTimeout(() => resolve("loaded data"), 100)))
  }
}).createMachine({
  id: "loader",
  initial: "loading",
  context: { data: "" },
  states: {
    loading: {
      invoke: {
        src: "load",
        onDone: {
          target: "ready",
          actions: assign({ data: ({ event }) => Option.getOrElse(event.output, () => "") })
        }
      }
    },
    ready: {}
  }
})

const program = Effect.gen(function* () {
  // 1. Start the actor
  const actor = yield* createActor(loaderMachine)
  yield* actor.start

  // 2–3. Wait for the state, for five seconds at most
  const snapshot = yield* waitFor(actor, (snapshot) => snapshot.matches("ready"), {
    timeout: Duration.seconds(5)
  })

  // 4. Use the snapshot
  console.log(snapshot.context.data) // loaded data
})

void Effect.runPromise(Effect.scoped(program))
```

`waitFor` checks the current snapshot first. When it satisfies the predicate already, `waitFor`
gives it at once.

## Variations

### Wait for the output

`toEffect(actor)` waits until the actor's snapshot stream ends, and gives the `output` of the
actor's snapshot as an `Option`:

- `Some(output)` when the actor is done and its logic gives an output (for a machine, its `output`
  config).
- `None` when the actor stopped, or is done without an output.

It also returns at once when the actor ended before the call, and it has no timeout of its own.

```ts
import { Effect, Option } from "effect"
import { createActor, createMachine, toEffect } from "@jambudipa/xstate-effect"

const checkoutMachine = createMachine({
  types: {} as { context: { total: number }; events: { type: "pay" }; output: { paid: number } },
  id: "checkout",
  initial: "open",
  context: { total: 42 },
  states: {
    open: { on: { pay: "paid" } },
    paid: { type: "final" }
  },
  output: ({ context }) => ({ paid: context.total })
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(checkoutMachine)
  yield* actor.start
  yield* actor.send({ type: "pay" })
  const output = yield* toEffect(actor)
  console.log(Option.getOrUndefined(output)) // { paid: 42 }
})

void Effect.runPromise(Effect.scoped(program))
```

To bound the wait, add `Effect.timeout` to the Effect that `toEffect` returns.

### Handle a wait that does not succeed

The error channel of `waitFor` and `toEffect` is `unknown`, because it can carry the actor's own
error. `waitFor` fails with:

| Failure | When |
|---|---|
| `WaitForTimeoutError` | The `timeout` elapses first. Its message is `Timeout of <ms> ms exceeded`. |
| `WaitForTerminatedError` | The actor is done or stopped before the predicate holds, also when it ended before the call. |
| The actor's error | The actor errors first: the raw value it failed with. |
| The signal's reason | The `signal` aborts first, also when it is aborted before the call. |

Recover from one of them with `Effect.catchIf` and an `instanceof` check:

```ts
import { Effect } from "effect"
import { createActor, createMachine, waitFor, WaitForTimeoutError } from "@jambudipa/xstate-effect"

const approvalMachine = createMachine({
  types: {} as { events: { type: "approve" } },
  id: "approval",
  initial: "pending",
  states: {
    pending: { on: { approve: "approved" } },
    approved: {}
  }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(approvalMachine)
  yield* actor.start
  const result = yield* waitFor(actor, (snapshot) => snapshot.matches("approved"), { timeout: 100 }).pipe(
    Effect.map(() => "approved"),
    Effect.catchIf(
      (error): error is WaitForTimeoutError => error instanceof WaitForTimeoutError,
      () => Effect.succeed("still pending")
    )
  )
  console.log(result) // still pending
})

void Effect.runPromise(Effect.scoped(program))
```

`toEffect` fails only with the actor's own error.

### Wait for a tag or a context value

The predicate receives the whole snapshot, so it can test anything the snapshot holds:
`snapshot.hasTag("busy")`, `snapshot.context.attempts >= 3`, or `snapshot.status === "done"`.
While it waits, `waitFor` skips the snapshot with status `stopped` that a stop publishes.

### Cancel the wait from outside

Pass an `AbortSignal` as `signal`. When the signal aborts, `waitFor` fails with the signal's
reason, and leaves no fiber or listener behind.

```ts
import { Effect } from "effect"
import { createActor, createMachine, waitFor } from "@jambudipa/xstate-effect"

const uploadMachine = createMachine({
  types: {} as { events: { type: "complete" } },
  id: "upload",
  initial: "uploading",
  states: {
    uploading: { on: { complete: "complete" } },
    complete: {}
  }
})

export const waitUntilUploaded = (signal: AbortSignal) =>
  Effect.gen(function* () {
    const actor = yield* createActor(uploadMachine)
    yield* actor.start
    return yield* waitFor(actor, (snapshot) => snapshot.matches("complete"), { signal })
  })
```

### Wait from code that uses Promises

`waitForPromise(actor, predicate, options)` and `toPromise(actor)` run the same waits with
`Effect.runPromise`, and reject with the same errors. `waitForPromise` takes `timeout` as a number
of milliseconds only. The actor still lives in a `Scope`, so use them at the edge of an Effect
program, not in place of it.

## Related

- [waitFor, toEffect and toPromise](../reference/testing/wait-for.md): the signatures and the
  error classes.
- [Snapshots](../reference/snapshots.md): `matches`, `hasTag`, `status` and `output`.
- [How to react to snapshot changes](react-to-snapshot-changes.md)
- [How to handle actor errors](handle-actor-errors.md)
- [How to test delayed transitions](test-delayed-transitions.md)
