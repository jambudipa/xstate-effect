---
title: How to invoke asynchronous work
doc-type: how-to
sources: [packages/core/src/actors/fromPromise.ts, packages/core/src/actors/fromEffect.ts]
---

# How to invoke asynchronous work

> **TL;DR:** Wrap the work in `fromPromise` or `fromEffect`, register it under `actors` in
> `setup`, and invoke it from the state that waits for it. The work starts when the machine
> enters the state and stops when the machine leaves it. Handle `onDone`, whose event carries
> the result as an `Option` in `output`, and `onError`, whose event carries the raw failure in
> `error`.

## When you need this

A state must call an API, read a file or run some other asynchronous work, and the machine
must move on when that work succeeds or fails.

Related tasks have their own guides: to run an Effect or a Stream on its own, see
[How to run an Effect or a Stream as an actor](run-an-effect-as-an-actor.md); to try failed
work again, see [How to retry a failing service](retry-pattern.md).

## Before you start

- You have a machine built with `setup`. [Build your first state machine](../tutorials/01-first-state-machine.md)
  shows how.
- You know what an invoked child actor is. [Invoke and spawn child actors](../tutorials/05-child-actors.md)
  introduces them.

## Steps

### 1. Wrap the work in actor logic

Pass a function that returns a Promise to `fromPromise`. Annotate the fields of the argument
that you read, so the logic knows the type of its `input`. The `signal` is aborted when the actor stops before the
Promise settles, so hand it to `fetch` or to any other API that accepts one.

```ts
import { fromPromise } from "@jambudipa/xstate-effect"

interface User {
  readonly id: string
  readonly name: string
}

export const fetchUser = fromPromise(
  async ({ input, signal }: { input: { userId: string }; signal: AbortSignal }): Promise<User> => {
    const response = await fetch(`/api/users/${input.userId}`, { signal })
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`)
    }
    const user: User = await response.json()
    return user
  }
)
```

If the work is an Effect, use `fromEffect` in its place: see
[Use an Effect in place of a Promise](#use-an-effect-in-place-of-a-promise).

### 2. Register the logic and invoke it from a state

Name the logic under `actors` in `setup`. In the state that waits for the work, set `invoke`:

- `src` names the logic.
- `input` computes the logic's input from the context and the event that entered the state.
- `onDone` takes the transition when the work succeeds.
- `onError` takes the transition when the work fails.

```ts
import { assign, fromPromise, setup } from "@jambudipa/xstate-effect"
import { Option } from "effect"

interface User {
  readonly id: string
  readonly name: string
}

const fetchUser = fromPromise(
  async ({ input, signal }: { input: { userId: string }; signal: AbortSignal }): Promise<User> => {
    const response = await fetch(`/api/users/${input.userId}`, { signal })
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`)
    }
    const user: User = await response.json()
    return user
  }
)

export const userMachine = setup({
  types: {} as {
    context: { userId: string; user: User | null; error: string | null }
    events: { type: "FETCH" }
  },
  actors: { fetchUser }
}).createMachine({
  id: "user",
  initial: "idle",
  context: { userId: "user-123", user: null, error: null },
  states: {
    idle: {
      on: { FETCH: "loading" }
    },
    loading: {
      invoke: {
        id: "userRequest",
        src: "fetchUser",
        input: ({ context }) => ({ userId: context.userId }),
        onDone: {
          target: "success",
          actions: assign({ user: ({ event }) => Option.getOrNull(event.output) })
        },
        onError: {
          target: "failure",
          actions: assign({
            error: ({ event }) => (event.error instanceof Error ? event.error.message : String(event.error))
          })
        }
      }
    },
    success: {},
    failure: {
      on: { FETCH: "loading" }
    }
  }
})
```

### 3. Read the result and the failure

- In `onDone`, `event.output` is an `Option`: `Option.some(value)` when the work returned a
  value, `Option.none()` when it returned `undefined`. Unwrap it with `Option.getOrNull`,
  `Option.getOrElse` or `Option.match`.
- In `onError`, `event.error` is the value the work failed with, as it was thrown or rejected.
  It is not wrapped and it is not an `Option`, so check its type before you read from it.
- The done event's type is `xstate.done.actor.<id>` and the error event's type is
  `xstate.error.actor.<id>`, where `<id>` is the invocation's `id` (`userRequest` above).

The machine now leaves `loading` for `success` or `failure` when the request settles. To wait
for one of those states from your own code, see [How to wait for a state or an output](wait-for-a-state.md).

## Variations

### Use an Effect in place of a Promise

Wrap the Effect with `fromEffect`. The actor is done with the Effect's success value. A typed
failure, a defect or a throw in the creator gives the error event, whose `error` is the raw
failure value. Tagged error classes make the failures easy to tell apart in `onError`.

```ts
import { assign, fromEffect, setup } from "@jambudipa/xstate-effect"
import { Data, Effect } from "effect"

class NetworkError extends Data.TaggedError("NetworkError")<{ readonly reason: string }> {}
class ValidationError extends Data.TaggedError("ValidationError")<{ readonly field: string }> {}

const submitForm = fromEffect(({ input }: { input: { email: string } }) =>
  Effect.gen(function* () {
    if (input.email.length === 0) {
      return yield* new ValidationError({ field: "email" })
    }
    const response = yield* Effect.tryPromise({
      try: () => fetch("/api/subscribe", { method: "POST", body: JSON.stringify(input) }),
      catch: () => new NetworkError({ reason: "The request did not reach the server" })
    })
    return response.status
  })
)

export const formMachine = setup({
  types: {} as {
    context: { email: string; message: string }
    events: { type: "SUBMIT" }
  },
  actors: { submitForm }
}).createMachine({
  id: "form",
  initial: "editing",
  context: { email: "", message: "" },
  states: {
    editing: {
      on: { SUBMIT: "submitting" }
    },
    submitting: {
      invoke: {
        src: "submitForm",
        input: ({ context }) => ({ email: context.email }),
        onDone: "submitted",
        onError: {
          target: "editing",
          actions: assign({
            message: ({ event }) => {
              if (event.error instanceof ValidationError) {
                return `Check the ${event.error.field} field`
              }
              if (event.error instanceof NetworkError) {
                return event.error.reason
              }
              return "Something went wrong"
            }
          })
        }
      }
    },
    submitted: { type: "final" }
  }
})
```

If the Effect needs a service, the machine needs it too, and `createActor` asks for it. See
[How to give a machine's actions and actors Effect services](provide-services-to-a-machine.md).

### Stop the work when the user cancels

Add a transition out of the invoking state; you need nothing else. When the machine leaves the
state, it stops the child: a `fromPromise` actor aborts its `signal`, and a `fromEffect` actor
interrupts its Effect, so the Effect's finalizers run. A result that arrives after the stop
changes nothing, and the machine receives no done event for it.

```ts
import { fromEffect, setup } from "@jambudipa/xstate-effect"
import { Console, Effect } from "effect"

const slowReport = fromEffect(() =>
  Effect.sleep("10 seconds").pipe(
    Effect.as("report.pdf"),
    Effect.onInterrupt(() => Console.log("Report generation cancelled"))
  )
)

export const reportMachine = setup({
  types: {} as {
    events: { type: "GENERATE" } | { type: "CANCEL" }
  },
  actors: { slowReport }
}).createMachine({
  id: "report",
  initial: "idle",
  states: {
    idle: {
      on: { GENERATE: "generating" }
    },
    generating: {
      invoke: { src: "slowReport", onDone: "ready" },
      on: { CANCEL: "idle" }
    },
    ready: {}
  }
})
```

### Pass data from the event that entered the state

The `input` function receives the event that caused the transition into the state. Narrow it
by its `type` before you read its fields.

```ts
import { fromPromise, setup } from "@jambudipa/xstate-effect"

const search = fromPromise(
  async ({ input }: { input: { query: string; limit: number } }): Promise<ReadonlyArray<string>> => {
    const response = await fetch(`/api/search?q=${encodeURIComponent(input.query)}&limit=${input.limit}`)
    const titles: ReadonlyArray<string> = await response.json()
    return titles
  }
)

export const searchMachine = setup({
  types: {} as {
    context: { limit: number }
    events: { type: "SEARCH"; query: string }
  },
  actors: { search }
}).createMachine({
  id: "search",
  initial: "idle",
  context: { limit: 20 },
  states: {
    idle: {
      on: { SEARCH: "searching" }
    },
    searching: {
      invoke: {
        src: "search",
        input: ({ context, event }) => ({
          query: event.type === "SEARCH" ? event.query : "",
          limit: context.limit
        }),
        onDone: "idle",
        onError: "idle"
      }
    }
  }
})
```

### Run several pieces of work at once

Give each piece of work its own region of a parallel state. Each region invokes its work and
moves to a final state when the work settles. When every region is final, the parallel state is
done and takes its own `onDone`.

```ts
import { assign, fromPromise, setup } from "@jambudipa/xstate-effect"
import { Option } from "effect"

const fetchJson = async (url: string): Promise<ReadonlyArray<string>> => {
  const response = await fetch(url)
  const items: ReadonlyArray<string> = await response.json()
  return items
}

export const dashboardMachine = setup({
  types: {} as {
    context: { posts: ReadonlyArray<string>; alerts: ReadonlyArray<string> }
    events: { type: "LOAD" }
  },
  actors: {
    fetchPosts: fromPromise(() => fetchJson("/api/posts")),
    fetchAlerts: fromPromise(() => fetchJson("/api/alerts"))
  }
}).createMachine({
  id: "dashboard",
  initial: "idle",
  context: { posts: [], alerts: [] },
  states: {
    idle: {
      on: { LOAD: "loading" }
    },
    loading: {
      type: "parallel",
      states: {
        posts: {
          initial: "fetching",
          states: {
            fetching: {
              invoke: {
                src: "fetchPosts",
                onDone: {
                  target: "settled",
                  actions: assign({ posts: ({ event }) => Option.getOrElse(event.output, () => []) })
                },
                onError: "settled"
              }
            },
            settled: { type: "final" }
          }
        },
        alerts: {
          initial: "fetching",
          states: {
            fetching: {
              invoke: {
                src: "fetchAlerts",
                onDone: {
                  target: "settled",
                  actions: assign({ alerts: ({ event }) => Option.getOrElse(event.output, () => []) })
                },
                onError: "settled"
              }
            },
            settled: { type: "final" }
          }
        }
      },
      onDone: "ready"
    },
    ready: {}
  }
})
```

A state can also hold an array of invocations, `invoke: [{ … }, { … }]`. All of them start on
entry, but the first `onDone` that leaves the state stops the others. Use the parallel state when
you must wait for all of them.

## Related

- [fromPromise](../reference/actors/from-promise.md): the promise logic, its snapshot and its
  creator's arguments.
- [fromEffect, fromEffectBackground and fromEffectRetry](../reference/actors/from-effect.md):
  the Effect logics.
- [How to handle actor errors](handle-actor-errors.md): failures of actors, actions and guards.
- [About the actor model](../explanation/actor-model.md): why work runs in child actors.
