---
title: cancel
doc-type: reference
sources: [packages/core/src/actions/cancel.ts]
---

# cancel

> **TL;DR:** `cancel` builds an action that removes a pending delayed event, by the `id` that a delayed `raise` or `sendTo` gave it. The cancel takes effect once the macrostep commits, and it reaches only the events that the same actor scheduled. An id that names no pending event does nothing.

`cancel` comes from `@jambudipa/xstate-effect` and from `@jambudipa/xstate-effect/actions`.

## Summary

| Export | Kind | Description |
| --- | --- | --- |
| [`cancel`](#cancel-1) | function | Builds an `xstate.cancel` action. |
| [`CancelId`](#types) | type | The id argument: a string or a function that returns one. |
| [`Cancel`](#types) | type | The type of `cancel`. |
| [`CancelAction`](#types) | type | The action that `cancel` returns, by its XState name. |

`CancelAction` comes from both entry points. `CancelId` and `Cancel` come from `@jambudipa/xstate-effect/actions` only.

## cancel

### Signature

```ts
import type { ActionDefinition, EventObject } from "@jambudipa/xstate-effect"
import type { CancelId } from "@jambudipa/xstate-effect/actions"

export declare function cancel<TContext, TEvent extends EventObject>(
  id: CancelId<TContext, TEvent>
): ActionDefinition<TContext, TEvent>
```

`Cancel` has a second call signature that no value can call. It exists only so that TypeScript types an inline `cancel` from the `on` descriptor around it.

### Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `id` | `string`, or `(ctx) => string` | The `id` option of the delayed `raise`, `sendTo`, `sendSelf` or `forwardTo` to cancel. Required. A function receives the action context only; it receives no params. |

### Return value

An `ActionDefinition` with `type: "xstate.cancel"`.

### Behaviour

- The scheduler cancels the event once the macrostep commits, in order with the delayed sends of the same macrostep. A `cancel` in a state's exit actions therefore runs before a delayed event with the same id that the re-entry of that state schedules.
- The scheduler keys each delayed event by the actor that scheduled it and the id. A `cancel` reaches only the events of its own actor.
- An id that names no pending event (never scheduled, already delivered, or already cancelled) does nothing. It is not an error.
- When two pending events of one actor have the same id, both timers run. A `cancel` of that id clears the newer one only.
- A delayed event without an `id` gets an id from the scheduler, which the machine does not know.
- When the actor stops, the scheduler cancels every delayed event that the actor scheduled, with no `cancel` action.
- **Inspection.** The `@xstate.action` inspection event has `type: "xstate.cancel"` and `params: { sendId }`.

### Errors

| Condition | Result |
| --- | --- |
| The id function throws. | The macrostep stops. The actor gets status `error`, and `snapshot.error` holds the thrown value. |

### Example

```ts
import { cancel, createMachine, raise } from "@jambudipa/xstate-effect"

export const session = createMachine({
  types: {} as { events: { type: "ACTIVITY" } | { type: "IDLE_TIMEOUT" } },
  initial: "active",
  states: {
    active: {
      entry: raise({ type: "IDLE_TIMEOUT" }, { delay: 60_000, id: "idle" }),
      // The exit cancel runs before the re-entry schedules "idle" again
      exit: cancel("idle"),
      on: {
        ACTIVITY: { target: "active", reenter: true },
        IDLE_TIMEOUT: "idle"
      }
    },
    idle: {}
  }
})
```

## Types

| Type | Definition |
| --- | --- |
| `CancelId<TContext, TEvent>` | `string \| ((ctx: ActionContext<TContext, TEvent>) => string)` |
| `Cancel` | The interface of `cancel`: the signature above, and the second signature that only defers the type check. |
| `CancelAction<TContext, TExpressionEvent, TParams, TEvent>` | `ActionDefinition<TContext, TExpressionEvent>`. It carries the name and type parameters of XState's `CancelAction`. |

## Related

- [How to use delayed transitions and delayed events](../../how-to/use-delayed-transitions.md)
- [raise](./raise.md): the `delay` and `id` options.
- [sendTo, sendParent, sendSelf and forwardTo](./send-to.md): the `delay` and `id` options.
- [SimulatedClock](../testing/simulated-clock.md): drives delayed events in tests.
- [The actor system](../actor-system.md): the scheduler.
