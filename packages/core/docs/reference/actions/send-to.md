---
title: sendTo, sendParent, sendSelf and forwardTo
doc-type: reference
sources: [packages/core/src/actions/sendTo.ts]
---

# sendTo, sendParent, sendSelf and forwardTo

> **TL;DR:** `sendTo` builds an action that sends an event to another actor: a reference, a child id, a `systemId`, or a special target name. `sendParent`, `sendSelf` and `forwardTo` are `sendTo` with a fixed target or a fixed event. The event goes out after the macrostep commits; with a `delay`, the scheduler delivers it later under an `id` that `cancel` takes. A target that resolves to no actor gives the sender status `error`.

The four functions come from `@jambudipa/xstate-effect` and from `@jambudipa/xstate-effect/actions`.

## Summary

| Export | Kind | Description |
| --- | --- | --- |
| [`sendTo`](#sendto) | function | Sends an event to a target actor. |
| [`sendParent`](#sendparent) | function | Sends an event to the parent actor. |
| [`sendSelf`](#sendself) | function | Sends an event to the actor itself, through the actor system. |
| [`forwardTo`](#forwardto) | function | Sends the event being handled to a target actor. |
| [`SendToTarget`](#types) | type | The target argument. |
| [`SendToEvent`](#types) | type | An event object, or a function that returns one. |
| [`SendToTargetEvent`](#types) | type | The event that a given target accepts. |
| [`SendToOptions`](#types) | type | The `delay`, `id` and `implementations` options. |
| [`SendTo`](#types), [`SendParent`](#types), [`SendSelf`](#types), [`ForwardTo`](#types) | type | The types of the four functions. |
| [`SendToAction`](#types) | type | The action that `sendTo` returns, by its XState name. |

`SendToAction` comes from both entry points. The other types come from `@jambudipa/xstate-effect/actions` only.

## Target resolution

The engine resolves the target while the transition runs, with the snapshot at that point of the action list.

| Target | Resolves to |
| --- | --- |
| An actor reference | That actor. |
| `"#_parent"` (`SpecialTargets.Parent`) | The parent actor. A root actor has none. |
| `"#_internal"` (`SpecialTargets.Internal`) or `"#_self"` | The machine actor itself. |
| `"#_<id>"` | The child with the id `<id>`. |
| Any other string | The child with that id; a child spawned earlier in the same action list counts. If no child has that id, the actor that the actor system holds under that `systemId`. |
| A function | Called with the action context and the params of the use. It returns a reference or a name, which resolves as above, or `undefined`, which targets the machine actor itself. |

A `sendTo` in a state's entry actions that names an invocation id of the same state resolves after the whole entry list. It reaches the child that the state invokes.

`SpecialTargets` is the constant `{ Parent: "#_parent", Internal: "#_internal" }` from `@jambudipa/xstate-effect`.

## Options

`SendToOptions<TContext, TEvent, TDelay, TSelfEvent>`, shared by the four functions. `sendParent` takes them without `id`.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `delay` | `number \| TDelay \| ((ctx, params) => number)` | none | Milliseconds; the name of a delay in the machine's `delays` implementations; or a function of the action context and the params that returns milliseconds. In a setup machine, a name must be one of the setup's `delays`. |
| `id` | `string` | an id the scheduler makes | The id of the delayed event, for `cancel`. It has an effect only with a delay. |
| `implementations` | `MachineImplementations<TContext, TEvent>` | none | Delays that the action reads before the machine's own `delays`. A name that they do not hold reads the machine's `delays`. XState has no such option. |

## Shared behaviour

These facts hold for all four functions.

- **Evaluation order.** The event function runs first, then the delay, then the target function. A delay name calls a configured delay function at this point.
- **No delay.** The event goes out after the macrostep commits, through the actor system (`system.relay`), so the `@xstate.event` inspection event names the sender. A `raise` in the same transition is handled before it.
- **A numeric delay, zero included.** The actor's scheduler delivers the event to the target after the delay, under the `id`. The schedule starts once the macrostep commits.
- **A delay that resolves to no number** (a name that no `delays` holds, a function that returns no number) counts as no delay.
- **Failed macrostep.** A macrostep that fails sends and schedules nothing.
- **Error events.** An event of type `xstate.error` arrives as `{ type: "xstate.error.actor.<sender id>", error: <the event's data>, actorId: <sender id> }`.
- **Stop.** When the sender stops, the scheduler cancels every delayed event that it scheduled.
- **Inspection.** The `@xstate.action` inspection event has `type: "xstate.sendTo"`.
- **Custom actions.** These functions only build an action. A custom action function that calls one of them sends nothing, and the actor logs a warning that names `sendTo()`: ``Custom actions should not call `sendTo()` directly, as it is not imperative. See https://stately.ai/docs/actions#built-in-actions for more details.``

## Shared errors

Each error stops the macrostep. The sending actor gets status `error`, and `snapshot.error` holds the error.

| Condition | `snapshot.error` |
| --- | --- |
| A target name resolves to no actor. | An `ActorError` with the message `Unable to send event to actor '<target>' from machine '<machine id>'.` |
| The event is a string. The type system accepts a string only for a name target or an untyped reference. | An `ActorError` with the message `Only event objects may be used with sendTo; use sendTo({ type: "<type>" }) instead` |
| The event function, the delay function or the target function throws. | The thrown value. |

## sendTo

### Signature

```ts
import type { ActionDefinition, EventObject, ImplementationNames, ActorRef } from "@jambudipa/xstate-effect"
import type { SendToOptions, SendToTarget, SendToTargetEvent } from "@jambudipa/xstate-effect/actions"

export declare function sendTo<
  TContext,
  TEvent extends EventObject,
  TSentEvent extends EventObject = EventObject,
  TNames extends ImplementationNames = ImplementationNames,
  TTarget extends ActorRef.ActorRefBase = ActorRef.ActorRefBase,
  TSelfEvent extends EventObject = TEvent
>(
  target: SendToTarget<TContext, TEvent, TTarget, TSelfEvent>,
  event: SendToTargetEvent<TContext, TEvent, TTarget, TSentEvent, TSelfEvent>,
  options?: SendToOptions<TContext, TEvent, NoInfer<TNames>["delays"], TSelfEvent>
): ActionDefinition<TContext, TEvent, void, never, TNames, TSelfEvent>
```

`SendTo` has a second call signature that no value can call. It exists only so that TypeScript types an inline `sendTo` from the `on` descriptor around it.

### Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `target` | `SendToTarget` | A name, an actor reference, or a function of the action context and the params. Required. See [Target resolution](#target-resolution). |
| `event` | `SendToTargetEvent` | An event object, or a function of the action context and the params that returns one. Required. A reference that its logic types (an `ActorRef`) accepts only its own events. A name or an untyped reference accepts any event object. |
| `options` | `SendToOptions` | Optional. See [Options](#options). |

### Return value

An `ActionDefinition` with `type: "xstate.sendTo"`.

### Behaviour

See [Target resolution](#target-resolution) and [Shared behaviour](#shared-behaviour).

### Errors

See [Shared errors](#shared-errors).

### Example

```ts
import { createMachine, sendTo, setup } from "@jambudipa/xstate-effect"

const worker = createMachine({
  types: {} as { events: { type: "PING" } }
})

export const parent = setup({
  types: {} as { events: { type: "PING" } | { type: "PING_LATER" } },
  actors: { worker }
}).createMachine({
  invoke: { id: "worker", src: "worker" },
  on: {
    // A child id
    PING: { actions: sendTo("worker", { type: "PING" }) },
    // The same child after 1000 ms, under an id that cancel("ping") takes
    PING_LATER: { actions: sendTo("worker", { type: "PING" }, { delay: 1000, id: "ping" }) }
  }
})
```

## sendParent

### Signature

```ts
import type { ActionDefinition, EventObject, ImplementationNames } from "@jambudipa/xstate-effect"
import type { SendToEvent, SendToOptions } from "@jambudipa/xstate-effect/actions"

export declare function sendParent<
  TContext,
  TEvent extends EventObject,
  TSentEvent extends EventObject = EventObject,
  TNames extends ImplementationNames = ImplementationNames
>(
  event: SendToEvent<TContext, TEvent, TSentEvent>,
  options?: Omit<SendToOptions<TContext, TEvent, NoInfer<TNames>["delays"]>, "id">
): ActionDefinition<TContext, TEvent, void, never, TNames>
```

### Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `event` | `SendToEvent` | An event object, or a function of the action context and the params that returns one. Required. |
| `options` | `SendToOptions` without `id` | Optional: `delay` and `implementations`. |

### Return value

An `ActionDefinition` with `type: "xstate.sendTo"`.

### Behaviour

- The action is `sendTo("#_parent", event, options)`.
- See [Shared behaviour](#shared-behaviour).

### Errors

- An actor without a parent gets status `error` with an `ActorError` whose message is `Unable to send event to actor '#_parent' from machine '<machine id>'.`
- See [Shared errors](#shared-errors).

### Example

```ts
import { createMachine, sendParent } from "@jambudipa/xstate-effect"

export const child = createMachine({
  initial: "working",
  states: {
    working: { on: { FINISH: "done" } },
    done: { entry: sendParent({ type: "CHILD_DONE", result: 42 }) }
  }
})
```

## sendSelf

### Signature

```ts
import type { ActionDefinition, EventObject, ImplementationNames } from "@jambudipa/xstate-effect"
import type { SendToEvent, SendToOptions } from "@jambudipa/xstate-effect/actions"

export declare function sendSelf<
  TContext,
  TEvent extends EventObject,
  TSentEvent extends EventObject = EventObject,
  TNames extends ImplementationNames = ImplementationNames
>(
  event: SendToEvent<TContext, TEvent, TSentEvent>,
  options?: SendToOptions<TContext, TEvent, NoInfer<TNames>["delays"]>
): ActionDefinition<TContext, TEvent, void, never, TNames>
```

### Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `event` | `SendToEvent` | An event object, or a function of the action context and the params that returns one. Required. |
| `options` | `SendToOptions` | Optional: `delay`, `id` and `implementations`. |

### Return value

An `ActionDefinition` with `type: "xstate.sendTo"`.

### Behaviour

- The action is `sendTo("#_self", event, options)`. XState has no `sendSelf`.
- Without a delay, the event reaches the actor through the actor system after the macrostep commits, as an external event. A `raise` without a delay puts the event on the internal queue of the current macrostep instead.
- See [Shared behaviour](#shared-behaviour).

### Errors

See [Shared errors](#shared-errors).

### Example

```ts
import { createMachine, sendSelf } from "@jambudipa/xstate-effect"

export const poller = createMachine({
  types: {} as { events: { type: "POLL" } },
  on: {
    POLL: { actions: sendSelf({ type: "POLL" }, { delay: 1000, id: "poll" }) }
  }
})
```

## forwardTo

### Signature

```ts
import type { ActionDefinition, EventObject } from "@jambudipa/xstate-effect"
import type { SendToOptions, SendToTarget } from "@jambudipa/xstate-effect/actions"

export declare function forwardTo<TContext, TEvent extends EventObject>(
  target: SendToTarget<TContext, TEvent>,
  options?: SendToOptions<TContext, TEvent>
): ActionDefinition<TContext, TEvent>
```

### Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `target` | `SendToTarget` | A name, an actor reference, or a function of the action context and the params. Required. |
| `options` | `SendToOptions` | Optional: `delay`, `id` and `implementations`. |

### Return value

An `ActionDefinition` with `type: "xstate.sendTo"`.

### Behaviour

- The action sends the event that the transition handles, as it is, to the target. It is a `sendTo` of the current event with the same targets and options.
- See [Shared behaviour](#shared-behaviour).

### Errors

- A target that resolves to nothing (`undefined` or `""`) would send the event back to the machine itself. The actor gets status `error` with an `ActorError` whose message is `Attempted to forward event to undefined actor. This risks an infinite loop in the sender.`
- See [Shared errors](#shared-errors).

### Example

```ts
import { createMachine, forwardTo, setup } from "@jambudipa/xstate-effect"

const logger = createMachine({
  types: {} as { events: { type: "LOG"; message: string } }
})

export const app = setup({
  types: {} as { events: { type: "LOG"; message: string } },
  actors: { logger }
}).createMachine({
  invoke: { id: "logger", src: "logger" },
  on: { LOG: { actions: forwardTo("logger") } }
})
```

## Types

| Type | Definition |
| --- | --- |
| `SendToTarget<TContext, TEvent, TTarget = ActorRefBase, TSelfEvent = TEvent>` | `string \| TTarget \| ((ctx: ActionContext<TContext, TEvent, TSelfEvent>, params: unknown) => TTarget \| string \| undefined)` |
| `SendToEvent<TContext, TEvent, TSentEvent = EventObject, TSelfEvent = TEvent>` | `TSentEvent \| ((ctx: ActionContext<TContext, TEvent, TSelfEvent>, params: unknown) => TSentEvent)` |
| `SendToTargetEvent<TContext, TEvent, TTarget, TSentEvent = AnyEventObject, TSelfEvent = TEvent>` | For a target of type `ActorRef<Snapshot, E>`: `SendToEvent<…, E, …>`. For any other target: `SendToEvent<…, TSentEvent, …> \| string`. |
| `SendToOptions<TContext, TEvent, TDelay extends string = string, TSelfEvent = TEvent>` | `{ readonly delay?: number \| TDelay \| ((ctx, params) => number); readonly id?: string; readonly implementations?: MachineImplementations<TContext, TEvent> }` |
| `SendTo`, `SendParent`, `SendSelf`, `ForwardTo` | The interfaces of the four functions: each signature above, and a second signature that only defers the type check. |
| `SendToAction<TContext, TExpressionEvent, TParams, TEvent, TDelay>` | An `ActionDefinition` of `TContext` and `TExpressionEvent` for a machine of `TEvent`, with a delay name of `TDelay`. It carries the name and type parameters of XState's `SendToAction`. |

## Related

- [How to send events between actors](../../how-to/send-events-between-actors.md)
- [The actor system](../actor-system.md): `systemId` lookup and `relay`.
- [Actor references](../actor-refs.md)
- [cancel](./cancel.md): cancels a delayed send by its `id`.
- [raise](./raise.md): sends an event to the actor itself through the internal queue.
- [Errors](../errors.md): `ActorError`.
