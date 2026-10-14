---
title: emit
doc-type: reference
sources: [packages/core/src/actions/emit.ts]
---

# emit

> **TL;DR:** `emit` builds an action that sends an event to the actor's listeners, not to the machine. The listeners that `actor.on` registers, and the `actor.emissions` stream, receive the event after the macrostep commits, in action order. In a setup machine that declares `types.emitted`, the event must be one of those events.

`emit` comes from `@jambudipa/xstate-effect` and from `@jambudipa/xstate-effect/actions`.

## Summary

| Export | Kind | Description |
| --- | --- | --- |
| [`emit`](#emit-1) | function | Builds an `xstate.emit` action. |
| [`EmitEvent`](#types) | type | The event argument: an event object or a function that returns one. |
| [`Emit`](#types) | type | The type of `emit`. |
| [`EmitAction`](#types) | type | The action that `emit` returns, by its XState name. |

`EmitAction` comes from both entry points. `EmitEvent` and `Emit` come from `@jambudipa/xstate-effect/actions` only.

## emit

### Signature

```ts
import type { ActionDefinition, EventObject, ImplementationNames } from "@jambudipa/xstate-effect"
import type { EmitEvent } from "@jambudipa/xstate-effect/actions"

export declare function emit<TContext, TEvent extends EventObject, TNames extends ImplementationNames = ImplementationNames>(
  event: EmitEvent<TContext, TEvent, NoInfer<TNames>["emitted"]>
): ActionDefinition<TContext, TEvent, void, never, TNames>
```

`Emit` has a second call signature that no value can call. It exists only so that TypeScript types an inline `emit` from the `on` descriptor around it.

### Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `event` | an event object, or `(ctx) => event` | The event to emit. Required. A function receives the action context only; it receives no params. |

In the config or the `actions` record of a setup machine that declares `types.emitted`, the event must be one of those events. TypeScript reads the allowed events from the config, never from the argument. Elsewhere, any event object is accepted.

### Return value

An `ActionDefinition` with `type: "xstate.emit"`.

### Behaviour

- The machine does not process the emitted event. Only the actor's listeners receive it.
- The listeners receive the event after the macrostep commits, in action order. A listener that reads the snapshot reads the new one.
- A macrostep that fails delivers nothing.
- For each event, the actor publishes it to `actor.emissions` (a `Stream`), then calls the listeners that `actor.on(type, handler)` registered: first those of the event's type, then those of `"*"`, each in the order of registration. Each listener runs to its end before the next one starts.
- A listener that throws, fails or dies is reported through the logger. The other listeners and the actor go on.
- A listener registered before `actor.start` receives the events that the initial state's entry actions emit.
- **Inspection.** The `@xstate.action` inspection event has `type: "xstate.emit"` and `params: { event }`.
- `emit` only builds an action. A custom action function that calls `emit` emits nothing, and the actor logs this warning: ``Custom actions should not call `emit()` directly, as it is not imperative. See https://stately.ai/docs/actions#built-in-actions for more details.``

### Errors

| Condition | Result |
| --- | --- |
| The event function throws. | The macrostep stops. The actor gets status `error`, and `snapshot.error` holds the thrown value. |

### Example

```ts
import { assign, createActor, emit, setup } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

const counter = setup({
  types: {} as {
    context: { count: number }
    events: { type: "INC" }
    emitted: { type: "changed"; count: number }
  },
  actions: {
    notify: emit(({ context }) => ({ type: "changed", count: context.count }))
  }
}).createMachine({
  context: { count: 0 },
  on: { INC: { actions: [assign({ count: ({ context }) => context.count + 1 }), "notify"] } }
})

export const program = Effect.gen(function* () {
  const actor = yield* createActor(counter)
  // The listener stays registered while the scope stays open
  yield* actor.on("changed", (event) => Effect.log(`count is now ${event.count}`))
  yield* actor.start
  yield* actor.send({ type: "INC" })
})
```

## Types

| Type | Definition |
| --- | --- |
| `EmitEvent<TContext, TEvent, TEmitted = EventObject>` | `TEmitted \| ((ctx: ActionContext<TContext, TEvent>) => TEmitted)` |
| `Emit` | The interface of `emit`: the signature above, and the second signature that only defers the type check. |
| `EmitAction<TContext, TExpressionEvent, TParams, TEvent, TEmitted>` | An `ActionDefinition` of `TContext` and `TExpressionEvent` for a machine that emits `TEmitted`. It carries the name and type parameters of XState's `EmitAction`. |

## Related

- [How to emit events and listen to them](../../how-to/emit-and-listen-to-events.md)
- [createActor and the actor](../create-actor.md): `actor.on` and `actor.emissions`.
- [setup and setupWithSchema](../setup.md): `types.emitted`.
- [Inspection events](../inspection.md)
