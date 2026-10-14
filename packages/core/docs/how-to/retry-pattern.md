---
title: How to retry a failing service
doc-type: how-to
sources: [packages/core/src/actors/fromEffect.ts, packages/core/src/actions/raise.ts]
---

# How to retry a failing service

> **TL;DR:** Retry inside the actor when the machine only needs the final result: wrap the
> request in `fromEffectRetry` with an Effect `Schedule`, and the machine sees one `onDone` or one
> `onError` after the last attempt. Retry in the machine when users must see, cancel or trigger
> the attempts: count them in the context, guard `onError`, and go back to the request state after
> a delay, with `after` or a delayed `raise`.

## When you need this

A machine invokes a service that fails now and then, such as a network call that times out, and
one failure must not end the flow.

This guide assumes that you invoke the service already, as
[How to invoke asynchronous work](invoke-async.md) shows.

## Choose where to retry

| Retry… | Use | The machine sees |
|---|---|---|
| inside the actor | `fromEffectRetry`, or `Effect.retry` in `fromEffect` | one done event after the first success, or one error event after the last failure |
| in the machine | a counter in the context, a guard and a delayed transition | each failure, the wait between attempts and the attempt count |

To stop retries inside the actor, leave the invoking state: the machine stops the child, which
interrupts the running attempt or the wait before the next one. To stop retries in the machine,
leave the state that waits, as the `CANCEL` transitions below do.

## Retry inside the actor

1. Write the request as an Effect that fails with a typed error.
2. Wrap it in `fromEffectRetry`, with the `Schedule` that decides the delays and the number of
   retries. Import `fromEffectRetry` from `@jambudipa/xstate-effect/actors`.
3. Invoke the logic as usual. `onDone` takes the first success. `onError` takes the last failure,
   after the schedule stops.

```ts
import { assign, setup } from "@jambudipa/xstate-effect"
import { fromEffectRetry } from "@jambudipa/xstate-effect/actors"
import { Data, Effect, Option, Schedule } from "effect"

class RequestFailed extends Data.TaggedError("RequestFailed")<{ readonly status: number }> {}

const loadPrices = fromEffectRetry(
  ({ input }: { input: { symbol: string } }) =>
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () => fetch(`/api/prices/${input.symbol}`),
        catch: () => new RequestFailed({ status: 0 })
      })
      if (!response.ok) {
        return yield* new RequestFailed({ status: response.status })
      }
      const price: number = yield* Effect.tryPromise({
        try: () => response.json(),
        catch: () => new RequestFailed({ status: response.status })
      })
      return price
    }),
  // Up to 3 retries after the first attempt: about 200 ms, 400 ms, then 800 ms apart
  Schedule.exponential("200 millis").pipe(Schedule.upTo({ times: 3 }), Schedule.jittered)
)

export const priceMachine = setup({
  types: {} as {
    context: { price: number | null; failedStatus: number | null }
    events: { type: "LOAD" }
  },
  actors: { loadPrices }
}).createMachine({
  id: "prices",
  initial: "idle",
  context: { price: null, failedStatus: null },
  states: {
    idle: {
      on: { LOAD: "loading" }
    },
    loading: {
      invoke: {
        src: "loadPrices",
        input: { symbol: "ACME" },
        onDone: {
          target: "loaded",
          actions: assign({ price: ({ event }) => Option.getOrNull(event.output) })
        },
        onError: {
          target: "failed",
          actions: assign({
            failedStatus: ({ event }) => (event.error instanceof RequestFailed ? event.error.status : null)
          })
        }
      }
    },
    loaded: {},
    failed: {
      on: { LOAD: "loading" }
    }
  }
})
```

`Schedule.recurs(n)`, `Schedule.spaced(duration)` and the other Effect schedules work in the same
place. A service that the schedule needs joins the machine's requirements, as a service of the
Effect does.

### Retry only some failures

`fromEffectRetry` retries every typed failure. To retry only some of them, use `fromEffect` and
give `Effect.retry` a `while` predicate. A defect or an interruption is never retried.

```ts
import { fromEffect } from "@jambudipa/xstate-effect"
import { Data, Effect, Schedule } from "effect"

class Timeout extends Data.TaggedError("Timeout")<{}> {}
class Rejected extends Data.TaggedError("Rejected")<{ readonly reason: string }> {}

declare const placeOrder: (orderId: string) => Effect.Effect<string, Timeout | Rejected>

export const submitOrder = fromEffect(({ input }: { input: { orderId: string } }) =>
  placeOrder(input.orderId).pipe(
    Effect.retry({
      schedule: Schedule.spaced("1 second"),
      times: 5,
      // A rejected order fails at once; only a timeout is tried again
      while: (error) => error._tag === "Timeout"
    })
  )
)
```

## Retry in the machine

1. Add an attempt counter to the context.
2. Add a guard that compares the counter with the limit.
3. Give `onError` two transitions: the guarded one goes to a waiting state and counts the
   attempt; the other one goes to the failure state.
4. In the waiting state, go back to the request state `after` a named delay. A delay in `setup`
   can compute its value from the context, which gives an exponential backoff.
5. Reset the counter on the transitions that start a new series of attempts. Do not reset it on
   entry to the request state, because each automatic retry enters that state too.

```ts
import { assign, fromPromise, setup } from "@jambudipa/xstate-effect"
import { Duration, Option } from "effect"

const fetchReport = fromPromise(async ({ input }: { input: { reportId: string } }): Promise<string> => {
  const response = await fetch(`/api/reports/${input.reportId}`)
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`)
  }
  return response.text()
})

export const reportMachine = setup({
  types: {} as {
    context: { reportId: string; attempts: number; report: string | null; lastError: string | null }
    events: { type: "FETCH" } | { type: "RETRY" } | { type: "CANCEL" }
  },
  actors: { fetchReport },
  guards: {
    canRetry: ({ context }) => context.attempts < 3
  },
  delays: {
    // 1 s, 2 s, then 4 s: the entry of "waiting" counts the attempt before the delay is read
    backoff: ({ context }) => Duration.seconds(2 ** (context.attempts - 1))
  },
  actions: {
    resetAttempts: assign({ attempts: 0, lastError: null })
  }
}).createMachine({
  id: "report",
  initial: "idle",
  context: { reportId: "q3", attempts: 0, report: null, lastError: null },
  states: {
    idle: {
      on: { FETCH: { target: "fetching", actions: "resetAttempts" } }
    },
    fetching: {
      invoke: {
        src: "fetchReport",
        input: ({ context }) => ({ reportId: context.reportId }),
        onDone: {
          target: "done",
          actions: assign({ report: ({ event }) => Option.getOrNull(event.output) })
        },
        onError: [
          { guard: "canRetry", target: "waiting" },
          {
            target: "failed",
            actions: assign({
              lastError: ({ event }) => (event.error instanceof Error ? event.error.message : String(event.error))
            })
          }
        ]
      },
      on: { CANCEL: "idle" }
    },
    waiting: {
      entry: assign({ attempts: ({ context }) => context.attempts + 1 }),
      after: { backoff: "fetching" },
      on: { RETRY: "fetching", CANCEL: "idle" }
    },
    done: {},
    failed: {
      on: { RETRY: { target: "fetching", actions: "resetAttempts" } }
    }
  }
})
```

The `CANCEL` transitions stop the retries: leaving `fetching` stops the request, and leaving
`waiting` cancels the pending delay. `RETRY` in `waiting` lets the user skip the rest of the wait.
`RETRY` in `failed` lets the user start a new series of attempts after the automatic ones run
out.

To add jitter, return a random share of the delay as well, for example
`Duration.millis(base * (1 + Math.random() * 0.3))`.

### Use the delay that the failure gives

Some services say how long to wait, for example with a `Retry-After` header on a 429 response.
The `event` of a named delay in `setup` has the type of the machine's own events, so the delay
cannot read the failure's fields. In place of `after`, raise a delayed `RETRY` event in the
`onError` transition: there, the delay function of `raise` receives the error event, and the `id`
names the pending event for `cancel`.

A delayed event does not belong to a state, so it stays pending when the machine leaves the state.
Cancel it on each transition that leaves the state, as the `RETRY` and `CANCEL` transitions below
do. `RETRY` takes the scheduled event and also one that the user sends sooner.

```ts
import { assign, cancel, fromEffect, raise, setup } from "@jambudipa/xstate-effect"
import { Data, Effect } from "effect"

class RateLimited extends Data.TaggedError("RateLimited")<{ readonly retryAfterMs: number }> {}
class SyncFailed extends Data.TaggedError("SyncFailed")<{ readonly status: number }> {}

const syncInbox = fromEffect(() =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => fetch("/api/inbox/sync", { method: "POST" }),
      catch: () => new SyncFailed({ status: 0 })
    })
    if (response.status === 429) {
      const seconds = Number(response.headers.get("Retry-After") ?? "1")
      return yield* new RateLimited({ retryAfterMs: seconds * 1000 })
    }
    if (!response.ok) {
      return yield* new SyncFailed({ status: response.status })
    }
    return response.status
  })
)

export const inboxMachine = setup({
  types: {} as {
    context: { attempts: number }
    events: { type: "SYNC" } | { type: "RETRY" } | { type: "CANCEL" }
  },
  actors: { syncInbox },
  guards: {
    canRetry: ({ context }) => context.attempts < 5
  }
}).createMachine({
  id: "inbox",
  initial: "idle",
  context: { attempts: 0 },
  states: {
    idle: {
      on: { SYNC: { target: "syncing", actions: assign({ attempts: 0 }) } }
    },
    syncing: {
      invoke: {
        src: "syncInbox",
        onDone: "synced",
        onError: [
          {
            guard: "canRetry",
            target: "retrying",
            actions: [
              raise(
                { type: "RETRY" },
                {
                  // The server's delay, or a backoff of 1 s, 2 s, 4 s… for any other failure
                  delay: ({ context, event }) =>
                    event.error instanceof RateLimited ? event.error.retryAfterMs : 1000 * 2 ** context.attempts,
                  id: "autoRetry"
                }
              ),
              assign({ attempts: ({ context }) => context.attempts + 1 })
            ]
          },
          { target: "failed" }
        ]
      }
    },
    retrying: {
      on: {
        RETRY: { target: "syncing", actions: cancel("autoRetry") },
        CANCEL: { target: "idle", actions: cancel("autoRetry") }
      }
    },
    synced: {},
    failed: {
      on: { SYNC: { target: "syncing", actions: assign({ attempts: 0 }) } }
    }
  }
})
```

The actions of a transition run in order, so the delay function reads `attempts` before the
`assign` increments it.

## Related

- [fromEffect, fromEffectBackground and fromEffectRetry](../reference/actors/from-effect.md): the
  retry logic and its schedule.
- [raise](../reference/actions/raise.md) and [cancel](../reference/actions/cancel.md): delayed
  events and their ids.
- [How to use delayed transitions and delayed events](use-delayed-transitions.md): `after`, named
  delays and delayed events in more depth.
- [How to test delayed transitions](test-delayed-transitions.md): drive the backoff with a
  simulated clock.
