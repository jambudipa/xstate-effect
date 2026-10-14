---
title: How to use delayed transitions and delayed events
doc-type: how-to
sources: [packages/core/src/StateMachine.ts, packages/core/src/actions/raise.ts, packages/core/src/actions/cancel.ts]
---

# How to use delayed transitions and delayed events

> **TL;DR:** Give a state an `after` map to leave it once a time has passed: the timer starts
> when the state is entered and is cancelled when the state exits. Name a delay in
> `setup({ delays })` when it depends on data. To schedule an event from an action, use
> `raise(event, { delay, id })`, and withdraw it before it fires with `cancel(id)`.

## When you need this

- A state must end by itself after a while: a toast that hides, a session that expires, a
  request that gives up.
- An action must schedule an event for later, and a later event may call it off: a reminder,
  a debounce, a retry with back-off.

## Prerequisites

- A machine built with `createMachine` or `setup(...).createMachine`. If you have not built
  one yet, start with [Build your first state machine](../tutorials/01-first-state-machine.md).
- Delays run on the actor's clock. Unless you pass a `clock` option to `createActor`, that is
  the Effect clock, so a program sees a delayed transition once that much Effect time has
  passed. To control time in tests, see
  [How to test delayed transitions](test-delayed-transitions.md).

## Leave a state after a fixed time

1. Add an `after` map to the state. Each key is a delay in milliseconds; each value is the
   transition to take, written as an `on` transition is: a target, a transition config, or a
   list of them.
2. Start the actor. The delay counts from the moment the actor enters the state.

```ts
import { Effect } from "effect"
import { createActor, createMachine } from "@jambudipa/xstate-effect"

const toastMachine = createMachine({
  id: "toast",
  initial: "visible",
  states: {
    visible: {
      // Leave `visible` 3 seconds after entering it
      after: { 3000: "hidden" },
      on: { DISMISS: "hidden" }
    },
    hidden: {
      on: { SHOW: "visible" }
    }
  }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(toastMachine)
  yield* actor.start

  yield* Effect.sleep("3100 millis")
  const snapshot = yield* actor.getSnapshot
  console.log(snapshot.value) // "hidden"
})

void Effect.runPromise(Effect.scoped(program))
```

If `DISMISS` takes the actor out of `visible` before the 3 seconds pass, the exit cancels the
timer and the delayed transition never runs. Each new entry into `visible` (after `SHOW`)
starts a fresh timer.

To choose between targets when the time is up, give the key a list of guarded transitions.
The engine schedules one timer for the key and, when it fires, takes the first transition
whose guard passes:

```ts
import { createMachine } from "@jambudipa/xstate-effect"

export const connectionMachine = createMachine({
  types: {} as { context: { retries: number } },
  context: { retries: 0 },
  initial: "connecting",
  states: {
    connecting: {
      after: {
        5000: [
          { guard: ({ context }) => context.retries < 3, target: "retrying" },
          { target: "failed" }
        ]
      }
    },
    retrying: {},
    failed: {}
  }
})
```

## Compute the delay from data

1. Declare the delay by name in `setup({ delays })`. A delay is a number of milliseconds, an
   Effect `Duration`, or a function of the action arguments (`context`, `event`, `self`,
   `system`) that returns either.
2. Use the name as the key of the `after` map. With `setup`, the type checker accepts only the
   names you declared, or numbers.

```ts
import { Duration } from "effect"
import { assign, setup } from "@jambudipa/xstate-effect"

export const retryMachine = setup({
  types: {} as {
    context: { attempts: number }
    events: { type: "FAIL" } | { type: "SUCCEED" }
  },
  delays: {
    // 2 s, 4 s, 8 s, … after the first, second, third failure
    backoff: ({ context }) => Duration.seconds(2 ** context.attempts)
  }
}).createMachine({
  context: { attempts: 0 },
  initial: "working",
  states: {
    working: {
      on: {
        FAIL: {
          target: "waiting",
          actions: assign({ attempts: ({ context }) => context.attempts + 1 })
        },
        SUCCEED: "done"
      }
    },
    waiting: {
      after: { backoff: "working" }
    },
    done: { type: "final" }
  }
})
```

The engine resolves a named delay when the state is entered, with the context and the event
of that moment. Here the delay already sees the `attempts` value that the `FAIL` transition
assigned.

To change a delay without editing the config, for example to shorten it in a test, provide a
new value under the same name: `retryMachine.provide({ delays: { backoff: 10 } })`.

> **Note:** a key that names no delay in the machine's `delays` gives no delay at all: the
> actor takes the transition at once, in the same step that entered the state. An untyped
> `createMachine` config does not catch a misspelt name, so prefer `setup` when you use named
> delays.

## Restart a timer

A transition that exits and re-enters the state restarts its `after` timers. A transition to
the state itself does this only with `reenter: true`; without it the state stays active and
its timer keeps running.

```ts
import { createMachine } from "@jambudipa/xstate-effect"

export const sessionMachine = createMachine({
  id: "session",
  initial: "active",
  states: {
    active: {
      after: { 900_000: "expired" },
      on: {
        // Any activity restarts the 15-minute timer
        ACTIVITY: { target: "active", reenter: true }
      }
    },
    expired: {}
  }
})
```

## Schedule an event from an action

1. Raise the event with a `delay` and an `id`. The `delay` is milliseconds, the name of one of
   the machine's `delays`, or a function of the action context that returns milliseconds.
2. Cancel it with `cancel(id)` from any action of the same actor before it fires.

```ts
import { cancel, raise, setup } from "@jambudipa/xstate-effect"

export const reminderMachine = setup({
  types: {} as {
    events: { type: "SNOOZE" } | { type: "DISMISS" } | { type: "REMIND" }
  }
}).createMachine({
  initial: "quiet",
  states: {
    quiet: {
      on: {
        SNOOZE: {
          actions: raise({ type: "REMIND" }, { delay: 600_000, id: "reminder" })
        },
        DISMISS: {
          actions: cancel("reminder")
        },
        REMIND: "ringing"
      }
    },
    ringing: {}
  }
})
```

A delayed event reaches the actor through the system's scheduler once the current macrostep
has finished. Without a `delay`, `raise` puts the event on the internal queue instead, and the
actor handles it in the same macrostep, before any event sent from outside.

`cancel` only withdraws events that the same actor scheduled. An id that is not pending (one
that has already fired, or was never scheduled) does nothing. The id may also be a function of
the action context, for example `` cancel(({ context }) => `reminder-${context.taskId}`) ``.

## Replace a pending event (debounce)

Scheduling an id that is still pending does not replace the earlier event: both fire. To
replace it, cancel the id first in the same action list.

```ts
import { assign, cancel, raise, setup } from "@jambudipa/xstate-effect"

export const searchMachine = setup({
  types: {} as {
    context: { query: string }
    events: { type: "TYPE"; query: string } | { type: "SEARCH" }
  }
}).createMachine({
  context: { query: "" },
  initial: "idle",
  states: {
    idle: {
      on: {
        TYPE: {
          actions: [
            assign({ query: ({ event }) => event.query }),
            // Withdraw the previous search, then schedule a new one
            cancel("search"),
            raise({ type: "SEARCH" }, { delay: 300, id: "search" })
          ]
        },
        SEARCH: "searching"
      }
    },
    searching: {}
  }
})
```

The engine applies the cancel and the new schedule in action order when the macrostep
finishes. A `SEARCH` therefore arrives only after 300 ms pass with no new `TYPE`.

## Variations

- **Delay an event to another actor.** `sendTo(target, event, { delay, id })` and
  `sendParent(event, { delay })` take the same `delay` forms, and `cancel(id)` withdraws a
  delayed `sendTo` of the same actor. See [sendTo and its relatives](../reference/actions/send-to.md).
- **Decide the delay at run time.** Inside `enqueueActions`, use
  `enqueue.raise(event, { delay, id })` and `enqueue.cancel(id)`. See
  [How to choose actions at run time with enqueueActions](batch-actions-with-enqueue.md).
- **Keep timers across a restart.** `actor.getPersistedSnapshot` records each pending delayed
  event with the time it was scheduled. An actor restored from that snapshot fires each event
  when its remaining time has passed, or at once if it is overdue. See
  [How to persist and restore an actor](persist-and-restore-an-actor.md).
- **Stop all timers.** Stopping an actor, or closing the scope it lives in, cancels all its
  pending delayed events.

## Related

- [cancel](../reference/actions/cancel.md) and [raise](../reference/actions/raise.md) — the
  options of each action.
- [createMachine and the machine](../reference/create-machine.md) — the `after` member of a
  state config.
- [setup and setupWithSchema](../reference/setup.md) — the `delays` record.
- [How to test delayed transitions](test-delayed-transitions.md) and
  [SimulatedClock](../reference/testing/simulated-clock.md) — control time in tests.
