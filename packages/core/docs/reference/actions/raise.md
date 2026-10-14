---
title: raise
doc-type: reference
sources: [packages/core/src/actions/raise.ts]
---

# raise

> **TL;DR:** `raise` builds an action that sends an event to the machine actor itself. Without a delay, the event joins the internal queue and the current macrostep handles it before any external event. With a delay, the actor's scheduler delivers it after that many milliseconds, under an `id` that `cancel` takes.

`raise` comes from `@jambudipa/xstate-effect` and from `@jambudipa/xstate-effect/actions`.

## Summary

| Export | Kind | Description |
| --- | --- | --- |
| [`raise`](#raise-1) | function | Builds an `xstate.raise` action. |
| [`RaiseEvent`](#types) | type | The event argument: an event object or a function that returns one. |
| [`RaiseOptions`](#types) | type | The `delay` and `id` options. |
| [`Raise`](#types) | type | The type of `raise`. |
| [`RaiseAction`](#types) | type | The action that `raise` returns, by its XState name. |

`RaiseAction` comes from both entry points. `RaiseEvent`, `RaiseOptions` and `Raise` come from `@jambudipa/xstate-effect/actions` only.

## raise

### Signature

```ts
import type { ActionContext, ActionDefinition, EventObject, ImplementationNames } from "@jambudipa/xstate-effect"
import type { RaiseOptions } from "@jambudipa/xstate-effect/actions"

// The events a raise may raise: the machine's, or any event object where the place of the call gives none
type RaisableEvent<TSelfEvent extends EventObject> = [TSelfEvent] extends [never] ? EventObject : TSelfEvent

// The default of the raised and computed events
type SelfEventOr<TSelfEvent extends EventObject, TEvent extends EventObject> = [TSelfEvent] extends [never]
  ? TEvent
  : TSelfEvent

export declare function raise<
  TContext,
  TEvent extends EventObject,
  TSelfEvent extends EventObject = never,
  TNames extends ImplementationNames = ImplementationNames,
  TRaisedEvent extends RaisableEvent<TSelfEvent> = SelfEventOr<TSelfEvent, TEvent>,
  TComputedEvent extends RaisableEvent<TSelfEvent> = SelfEventOr<TSelfEvent, TEvent>
>(
  event: TRaisedEvent | ((ctx: ActionContext<TContext, TEvent>, params: unknown) => TComputedEvent),
  options?: RaiseOptions<TContext, TEvent, NoInfer<TNames>["delays"]>
): ActionDefinition<TContext, TEvent, void, never, TNames, TSelfEvent>
```

`Raise` has a second call signature that no value can call. It exists only so that TypeScript types an inline `raise` from the `on` descriptor around it.

### Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `event` | an event object, or `(ctx, params) => event` | The event to raise. Required. A function receives the action context and the params of the use. |
| `options` | `RaiseOptions` | Optional. See the options table. |

The raised event must be one of the machine's events where the place of the call gives them: a `setup` `actions` record, an `enqueue` of `enqueueActions`, or a machine config whose events are known. Elsewhere, any event object is accepted.

### Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `delay` | `number \| TDelay \| ((ctx, params) => number)` | none | Milliseconds; the name of a delay in the machine's `delays` implementations; or a function of the action context and the params that returns milliseconds. In a setup machine, a name must be one of the setup's `delays`. |
| `id` | `string` | an id the scheduler makes | The id of the delayed event, for `cancel`. It has an effect only with a delay. |

### Return value

An `ActionDefinition` with `type: "xstate.raise"`.

### Behaviour

- **No delay.** The event joins the actor's internal queue as the action runs. The current macrostep processes it before it ends, so before any external event that waits.
- **A numeric delay, zero included.** The actor's scheduler delivers the event to the actor itself after the delay. The schedule starts once the macrostep commits, so a macrostep that fails schedules nothing.
- **Delay resolution.** A number is used as it is. A name reads the machine's `delays` (`setup({ delays })`, overridden by `machine.provide({ delays })`); a configured delay is a number, a `Duration`, or a function of the action arguments and the params. A function option is called with the action context and the params.
- **A delay that resolves to no number** (a name that the machine's `delays` do not hold, a function that returns no number) counts as no delay: the event joins the internal queue.
- **Order of evaluation.** The event function runs first, then the delay function.
- **Stop.** When the actor stops, the scheduler cancels every delayed event that the actor scheduled.
- **Inspection.** The `@xstate.action` inspection event has `type: "xstate.raise"` and `params: { event, id, delay }`.
- `raise` only builds an action. A custom action function that calls `raise` changes nothing, and the actor logs this warning: ``Custom actions should not call `raise()` directly, as it is not imperative. See https://stately.ai/docs/actions#built-in-actions for more details.``

### Errors

Each error stops the macrostep. The actor gets status `error`, and `snapshot.error` holds the error.

| Condition | `snapshot.error` |
| --- | --- |
| The event is a string. The type system rejects a string, so this happens only through an untyped value. | An `ActorError` with the message `Only event objects may be used with raise; use raise({ type: "<type>" }) instead` |
| The event function or the delay function throws. | The thrown value. |

### Example

```ts
import { cancel, raise, setup } from "@jambudipa/xstate-effect"

export const request = setup({
  types: {} as {
    events: { type: "SUBMIT" } | { type: "VALIDATED" } | { type: "TIMEOUT" } | { type: "RESPONSE" }
  },
  delays: { requestTimeout: 5000 },
  actions: {
    // Handled in the same macrostep, before any external event
    validate: raise({ type: "VALIDATED" }),
    // Delivered after the named delay, unless cancel("timeout") runs first
    startTimer: raise({ type: "TIMEOUT" }, { delay: "requestTimeout", id: "timeout" })
  }
}).createMachine({
  initial: "idle",
  states: {
    idle: { on: { SUBMIT: { target: "validating", actions: "validate" } } },
    validating: { on: { VALIDATED: "waiting" } },
    waiting: {
      entry: "startTimer",
      on: {
        RESPONSE: { target: "idle", actions: cancel("timeout") },
        TIMEOUT: "idle"
      }
    }
  }
})
```

## Types

| Type | Definition |
| --- | --- |
| `RaiseEvent<TContext, TEvent, TRaisedEvent = TEvent>` | `TRaisedEvent \| ((ctx: ActionContext<TContext, TEvent>, params: unknown) => TRaisedEvent)` |
| `RaiseOptions<TContext = unknown, TEvent = EventObject, TDelay extends string = string>` | `{ readonly delay?: number \| TDelay \| ((ctx: ActionContext<TContext, TEvent>, params: unknown) => number); readonly id?: string }` |
| `Raise` | The interface of `raise`: the signature above, and the second signature that only defers the type check. |
| `RaiseAction<TContext, TExpressionEvent, TParams, TEvent, TDelay>` | An `ActionDefinition` of `TContext` and `TExpressionEvent` that raises an event of `TEvent`, with a delay name of `TDelay`. It carries the name and type parameters of XState's `RaiseAction`. |

## Related

- [Run side effects](../../tutorials/04-side-effects.md): a lesson that raises events.
- [How to use delayed transitions and delayed events](../../how-to/use-delayed-transitions.md)
- [cancel](./cancel.md): cancels a delayed event by its `id`.
- [sendTo, sendParent, sendSelf and forwardTo](./send-to.md): `sendSelf` sends to the actor itself through the actor system instead of the internal queue.
- [How an actor processes events](../../explanation/event-processing.md)
