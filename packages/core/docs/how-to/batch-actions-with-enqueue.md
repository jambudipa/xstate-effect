---
title: How to choose actions at run time with enqueueActions
doc-type: how-to
sources: [packages/core/src/actions/enqueueActions.ts]
---

# How to choose actions at run time with enqueueActions

> **TL;DR:** Replace a fixed `actions` list with `enqueueActions(({ context, event, enqueue, check }) => { … })`.
> The function runs once when the engine reaches the action, and decides with plain `if`
> statements and loops which actions to `enqueue`; those actions then run in its place, in
> order. `check(guard)` evaluates a guard, and both `check` and `context` see the context from
> before any enqueued action runs.

## When you need this

- Which actions run depends on the context or the event, and a list of guarded transitions
  would repeat the same target several times.
- You need one action per item of a list: an event to emit for each expired item, a message for
  each worker.
- Several transitions share the same decision, and you want to name it once as an action.

## Prerequisites

- A machine with typed context and events, built with `setup(...).createMachine`. See
  [How to type a machine's context, events, input and output](define-custom-types.md).
- You know the built-in actions (`assign`, `raise`, `log`, …). See
  [Run side effects](../tutorials/04-side-effects.md).

## Decide which actions run

1. Put one `enqueueActions(...)` call where the `actions` list was.
2. In its function, read `context` and `event`, and evaluate guards with `check`. `check` takes
   any guard form: a name, `{ type, params }`, an inline function, or a combinator such as
   `and([...])`.
3. Enqueue each action to run. `enqueue(action)` takes any action form (a name,
   `{ type, params }`, an inline function, a built-in action such as `log(...)`); the helpers
   `enqueue.assign`, `enqueue.raise`, `enqueue.sendTo`, `enqueue.sendParent`, `enqueue.sendSelf`,
   `enqueue.emit`, `enqueue.spawnChild`, `enqueue.stopChild` and `enqueue.cancel` take the
   arguments of the built-in action of the same name.

```ts
import { Effect } from "effect"
import { createActor, enqueueActions, log, setup } from "@jambudipa/xstate-effect"

const cartMachine = setup({
  types: {} as {
    context: { items: number; total: number }
    events: { type: "ADD"; price: number } | { type: "FREE_SHIPPING" }
  },
  guards: {
    isEmpty: ({ context }) => context.items === 0
  },
  actions: {
    track: (_, params: { label: string }) => {
      console.log("track:", params.label)
    }
  }
}).createMachine({
  context: { items: 0, total: 0 },
  initial: "shopping",
  states: {
    shopping: {
      on: {
        ADD: {
          actions: enqueueActions(({ context, event, enqueue, check }) => {
            if (check("isEmpty")) {
              enqueue({ type: "track", params: { label: "first item" } })
            }

            const total = context.total + event.price
            enqueue.assign({ items: context.items + 1, total })

            if (context.total < 100 && total >= 100) {
              enqueue.raise({ type: "FREE_SHIPPING" })
            }

            enqueue(log("item added"))
          })
        },
        FREE_SHIPPING: {
          actions: { type: "track", params: { label: "free shipping" } }
        }
      }
    }
  }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(cartMachine)
  yield* actor.start
  yield* actor.send({ type: "ADD", price: 60 }) // track: first item
  yield* actor.send({ type: "ADD", price: 60 }) // track: free shipping

  const snapshot = yield* actor.getSnapshot
  console.log(snapshot.context) // { items: 2, total: 120 }
})

void Effect.runPromise(Effect.scoped(program))
```

There is no `enqueue.log`. To log, enqueue the `log` action itself, as above.

## Know which context each part sees

- `context` and `check` read the context as it was when the engine reached `enqueueActions`.
  An `enqueue.assign` changes nothing until the function has returned and the enqueued actions
  run. In the example, `check("isEmpty")` passes for the first `ADD` only, whatever the function
  enqueues before or after it.
- The enqueued actions run in order, and each one sees the context that the actions before it
  assigned. An assigner function such as
  `enqueue.assign({ items: ({ context }) => context.items + 1 })` therefore reads the updated
  value.
- A raised event, such as `FREE_SHIPPING` above, joins the internal queue: the actor handles it
  after the current transition's actions, before any event sent from outside.

To act on a value that the function itself computes, compute it once in a local variable, as
`total` is above, and use it both in the assignment and in the decision.

## Emit or send one action per item

Use a plain loop. Each call to `enqueue` adds one action.

```ts
import { enqueueActions, setup } from "@jambudipa/xstate-effect"

type Item = { readonly id: string; readonly expiresAt: number }

export const inventoryMachine = setup({
  types: {} as {
    context: { items: ReadonlyArray<Item> }
    events: { type: "CHECK"; now: number }
    emitted: { type: "expired"; id: string }
  }
}).createMachine({
  context: { items: [] },
  on: {
    CHECK: {
      actions: enqueueActions(({ context, event, enqueue }) => {
        for (const item of context.items) {
          if (item.expiresAt <= event.now) {
            enqueue.emit({ type: "expired", id: item.id })
          }
        }
        enqueue.assign({ items: context.items.filter((item) => item.expiresAt > event.now) })
      })
    }
  }
})
```

## Name the decision and pass it params

Write the `enqueueActions` call as an entry of `setup({ actions })`. Its function receives the
params of each use as its second argument, and it may enqueue the other actions of the same
record by name.

```ts
import { enqueueActions, setup } from "@jambudipa/xstate-effect"

export const alertMachine = setup({
  types: {} as {
    context: { email: boolean; sms: boolean }
    events: { type: "ALERT"; message: string }
  },
  actions: {
    sendEmail: (_, params: { text: string }) => {
      console.log("email:", params.text)
    },
    sendSms: (_, params: { text: string }) => {
      console.log("sms:", params.text)
    },
    notify: enqueueActions(({ context, enqueue }, params: { text: string }) => {
      if (context.email) {
        enqueue({ type: "sendEmail", params })
      }
      if (context.sms) {
        enqueue({ type: "sendSms", params })
      }
    })
  }
}).createMachine({
  context: { email: true, sms: false },
  on: {
    ALERT: {
      actions: { type: "notify", params: ({ event }) => ({ text: event.message }) }
    }
  }
})
```

## Variations

- **Typed names from the setup.** `setup(...)` returns a bound `enqueueActions` beside
  `createMachine`. Call it as `machineSetup.enqueueActions(...)` to write the action outside the
  config, for example in a shared module, with the setup's context, events and names.
- **Delayed events.** `enqueue.raise(event, { delay, id })` and `enqueue.cancel(id)` schedule
  and withdraw a delayed event, with a delay that the function can compute. See
  [How to use delayed transitions and delayed events](use-delayed-transitions.md).
- **Nested decisions.** `enqueue` also takes another `enqueueActions(...)`; it resolves in place,
  in order with the rest.
- **Guard combinations.** `check(and(["isAdmin", not("isLocked")]))` evaluates a combined guard.
  See [How to combine guards](compose-guards.md).

## If the function fails

If the function throws, or `check` names a guard that the machine does not have, the actor gets
status `error`, and `snapshot.error` holds the error as `Option.some(error)`. With `setup`, the type checker rejects a
guard name or an action name that the setup does not declare. See
[How to handle actor errors](handle-actor-errors.md).

## Related

- [enqueueActions](../reference/actions/enqueue-actions.md) — the arguments of the function and
  every enqueuer helper.
- [raise](../reference/actions/raise.md), [sendTo and its relatives](../reference/actions/send-to.md),
  [emit](../reference/actions/emit.md) and [log](../reference/actions/log.md) — the actions you
  enqueue most often.
- [How an actor processes events](../explanation/event-processing.md) — the internal queue and
  the order of actions.
