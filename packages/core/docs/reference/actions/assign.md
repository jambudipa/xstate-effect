---
title: assign and assignProperty
doc-type: reference
sources: [packages/core/src/actions/assign.ts]
---

# assign and assignProperty

> **TL;DR:** `assign` builds an action that merges new values into the machine's context; `assignProperty` builds the same action for one key. An assignment is a partial context, an object of property assigners, or a function that returns a partial context or an Effect of one. A throw, a failed Effect, or a snapshot without context gives the actor status `error`.

Both functions come from `@jambudipa/xstate-effect` and from `@jambudipa/xstate-effect/actions`.

## Summary

| Export | Kind | Description |
| --- | --- | --- |
| [`assign`](#assign) | function | Builds an `xstate.assign` action from an assignment. |
| [`assignProperty`](#assignproperty) | function | Builds an `xstate.assign` action that sets one context key. |
| [`Assignment`](#types) | type | The argument of `assign`: a partial context, a `PropertyAssigner` or an `Assigner`. |
| [`Assigner`](#types) | type | The function form of an assignment. |
| [`PropertyAssigner`](#types) | type | The object form of an assignment. |
| [`Assign`](#types) | type | The type of `assign`. |
| [`AssignProperty`](#types) | type | The type of `assignProperty`. |
| [`AssignArgs`](#types) | type | The first argument an assigner receives. |
| [`PartialAssigner`](#types) | type | A function that computes one context property. |
| [`AssignAction`](#types) | type | The action that `assign` returns. |

`Assignment`, `Assign` and `AssignProperty` come from `@jambudipa/xstate-effect/actions` only. The other types come from both entry points.

## assign

### Signature

```ts
import type { ActionDefinition, EventObject, ImplementationNames, Types } from "@jambudipa/xstate-effect"
import type { Assignment } from "@jambudipa/xstate-effect/actions"

export declare function assign<
  TContext,
  TEvent extends EventObject,
  TParams = undefined,
  TSelfEvent extends EventObject = TEvent,
  TNames extends ImplementationNames = ImplementationNames
>(
  assignment: Assignment<NoInfer<TContext>, NoInfer<TEvent>, TParams, NoInfer<TSelfEvent>, NoInfer<TNames>>
): ActionDefinition<TContext, TEvent, Types.AssignDefinitionParams<NoInfer<TParams>>, never, TNames, TSelfEvent> &
  Types.ImplementsParams<TParams>
```

`Assign` has a second call signature that no value can call. It exists only so that TypeScript types an inline `assign` from the machine config around it.

### Type parameters

| Type parameter | Comes from | Description |
| --- | --- | --- |
| `TContext` | where the action is used | The machine's context type. |
| `TEvent` | where the action is used | The event of the transition that runs the action: the event of the `on` descriptor, or every event of the machine. |
| `TParams` | an annotated `params` argument, the type argument, or an implementation slot that knows the params of its uses | The params of the use. `undefined` when nothing gives it. |
| `TSelfEvent` | where the action is used | Every event of the machine. The `self` reference takes these events. |
| `TNames` | where the action is used | The implementation names of the setup or machine. `spawn` takes only the actors that these names name. |

The context and event types never come from the assignment itself.

### Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `assignment` | `Assignment<TContext, TEvent, TParams, TSelfEvent, TNames>` | One of the three forms below. Required. |

| Form | Shape | Result |
| --- | --- | --- |
| Partial context | `{ count: 0 }` | The values are copied into the context. |
| Property assigners | `{ count: ({ context }) => context.count + 1 }` | A function value computes the value of its key; any other value is copied. |
| Assigner | `({ context, event }, params) => ({ count: 1 })` | The function returns the keys to change, or an `Effect.Effect<Partial<TContext>, unknown>` of them. |

### Assigner arguments

An assigner and each property assigner receive two arguments.

| Argument | Type | Description |
| --- | --- | --- |
| first | `ActionContext<TContext, TEvent, TSelfEvent, TNames>` | The action context (members below). |
| second | `TParams` | The params of the use: the `params` of a `{ type, params }` action that this assign implements; `undefined` for an inline assign and for a string reference. |

| Member of the action context | Type | Description |
| --- | --- | --- |
| `context` | `TContext` | The context before this action. |
| `event` | `TEvent` | The event that the transition handles. |
| `self` | `ActorRef` | The machine actor itself. It takes `TSelfEvent`. |
| `system` | `ActorSystemService` | The actor system of the actor. |
| `spawn` | `Spawner` | Spawns a child and returns its reference at once. |
| `children` | `Readonly<Record<string, ActorRefBase>>` | The children of the snapshot at this point of the action list. |
| `defer` | `(effect) => Effect<void>` | Queues an Effect to run after the current transition. |
| `emit` | `(event) => Effect<void>` | Emits an event to the actor's listeners once the macrostep commits. |
| `stopChild` | `(child) => Effect<void>` | Stops a child of this actor. |
| `evaluateGuard` | `(guard) => Effect<boolean, GuardError>` | Evaluates a guard with this action's context and event. |
| `resolveDelay` | `(name, params) => Option<number>` | The milliseconds that a delay name of the machine stands for. |

### Return value

An `ActionDefinition` with `type: "xstate.assign"`. Use it inline in a config, in an `actions` record of `setup`, or as an implementation in `createMachine(config, { actions })` and `machine.provide`.

### Behaviour

- The action runs at its place in the action list. It reads the context that the earlier actions of the same list left.
- In the object form, every property assigner receives the same context: the context from before the action. A property assigner does not see the values of the other assigners of the same call.
- The property assigners run in the key order of the object.
- The engine merges the result into a shallow copy of the context (`{ ...context, ...partial }`). Keys that the result does not hold keep their values.
- When an assigner returns an Effect, the engine runs that Effect and merges its value. The Effect has no requirements.
- A child that `spawn` creates in an assigner joins `snapshot.children` together with the context change.
- `assign` only builds an action. A custom action function that calls `assign` changes nothing, and the actor logs this warning: ``Custom actions should not call `assign()` directly, as it is not imperative. See https://stately.ai/docs/actions#built-in-actions for more details.``

### Errors

Each error stops the macrostep. The context keeps its earlier value, the actor gets status `error`, and `snapshot.error` holds the error.

| Condition | `snapshot.error` |
| --- | --- |
| The snapshot has no context (for example, a restored snapshot without one). A machine config without `context` starts with `{}`, so this case does not apply to it. | An `ActorError` with the message ``Cannot assign to undefined `context`. Ensure that `context` is defined in the machine config.`` |
| An assigner or a property assigner throws. | The thrown value. |
| The Effect that an assigner returns fails. | The failure value. |

### Example

```ts
import { assign, setup } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

export const cart = setup({
  types: {} as {
    context: { count: number; total: number }
    events: { type: "ADD"; price: number } | { type: "CLEAR" }
  },
  actions: {
    // Property assigners: both read the context from before the action
    add: assign({
      count: ({ context }) => context.count + 1,
      total: ({ context, event }) => (event.type === "ADD" ? context.total + event.price : context.total)
    }),
    // A partial context
    clear: assign({ count: 0, total: 0 }),
    // An assigner that returns an Effect
    double: assign(({ context }) => Effect.succeed({ total: context.total * 2 }))
  }
}).createMachine({
  context: { count: 0, total: 0 },
  on: {
    ADD: { actions: "add" },
    CLEAR: { actions: "clear" }
  }
})
```

## assignProperty

### Signature

```ts
import type { ActionContext, ActionDefinition, EventObject, Types } from "@jambudipa/xstate-effect"

export declare function assignProperty<
  TContext,
  TEvent extends EventObject,
  K extends keyof TContext = keyof TContext,
  TParams = undefined
>(
  key: K,
  value:
    | NoInfer<TContext[K]>
    | ((ctx: ActionContext<NoInfer<TContext>, NoInfer<TEvent>>, params: TParams) => NoInfer<TContext[K]>)
): ActionDefinition<TContext, TEvent, Types.AssignDefinitionParams<NoInfer<TParams>>> & Types.ImplementsParams<TParams>
```

As `Assign`, `AssignProperty` has a second call signature that no value can call. It exists only so that TypeScript types an inline `assignProperty` from the machine config around it.

### Type parameters

| Type parameter | Comes from | Description |
| --- | --- | --- |
| `TContext` | where the action is used, or the type argument | The machine's context type. |
| `TEvent` | where the action is used, or the type argument | The event of the transition that runs the action. |
| `K` | the `key` argument | The context key to set. |
| `TParams` | an annotated `params` argument, or the type argument | The params of the use. `undefined` when nothing gives it. |

The context and event types never come from `value`.

### Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `key` | `K extends keyof TContext` | The context key to set. Required. |
| `value` | `TContext[K]` or a function of the action context and the params | The new value, or a property assigner that computes it. Required. |

### Return value

An `ActionDefinition` with `type: "xstate.assign"`. Use it where `assign` goes: inline in a config, in an `actions` record of `setup`, or as an implementation.

### Behaviour

- The action is `assign({ [key]: value })`: the same merge, the same arguments for a function value, and the same errors.
- Written inline in a machine config, or in a setup's `actions` record, it reads `TContext` and `TEvent` from that place. It needs no type arguments there.
- Called on its own, outside a config or a setup, nothing gives it the context type, and the call is a type error. Give the type arguments: `assignProperty<Context, Event, "count">(...)`. A fourth type argument gives the params type.
- `assignProperty` only builds an action. A custom action function that calls `assignProperty` changes nothing, and the actor logs the warning of `assign`: ``Custom actions should not call `assign()` directly, as it is not imperative. See https://stately.ai/docs/actions#built-in-actions for more details.``

### Errors

The errors of [`assign`](#errors).

### Example

```ts
import { assignProperty, createMachine, setup } from "@jambudipa/xstate-effect"

interface Context {
  readonly count: number
  readonly label: string
}

type Event = { readonly type: "INC"; readonly by: number } | { readonly type: "RENAME" }

// Inline: the machine config gives the context and event types
export const counter = createMachine({
  types: {} as { context: Context; events: Event },
  context: { count: 0, label: "start" },
  on: {
    INC: { actions: assignProperty("count", ({ context, event }) => context.count + event.by) },
    RENAME: { actions: assignProperty("label", "renamed") }
  }
})

// In a setup's actions record: the setup gives the types
export const counterSetup = setup({
  types: {} as { context: Context; events: Event },
  actions: { reset: assignProperty("count", 0) }
})

// On its own: give the type arguments
export const increment = assignProperty<Context, Event, "count">("count", ({ context }) => context.count + 1)
```

## Types

| Type | Definition |
| --- | --- |
| `Assignment<TContext, TEvent, TParams = void, TSelfEvent = TEvent, TNames = ImplementationNames>` | `Partial<TContext> \| PropertyAssigner<…> \| Assigner<…>` |
| `Assigner<TContext, TEvent, TParams = void, TSelfEvent = TEvent, TNames = ImplementationNames>` | `(ctx: ActionContext<TContext, TEvent, TSelfEvent, TNames>, params: TParams) => Partial<TContext> \| Effect.Effect<Partial<TContext>, unknown>` |
| `PropertyAssigner<TContext, TEvent, TParams = void, TSelfEvent = TEvent, TNames = ImplementationNames>` | `{ readonly [K in keyof TContext]?: TContext[K] \| ((ctx: ActionContext<TContext, TEvent, TSelfEvent, TNames>, params: TParams) => TContext[K]) }` |
| `Assign` | The interface of `assign`: the signature above, and the second signature that only defers the type check. |
| `AssignProperty` | The interface of `assignProperty`: the signature in [assignProperty](#assignproperty), and the second signature that only defers the type check. |
| `AssignArgs<TContext, TExpressionEvent, TEvent, TActor>` | The `ActionContext` that an assigner receives, whose `spawn` takes the provided actors `TActor`. |
| `PartialAssigner<TContext, TExpressionEvent, TParams, TEvent, TActor, TKey>` | `(args: AssignArgs<TContext, TExpressionEvent, TEvent, TActor>, params: TParams) => TContext[TKey]` |
| `AssignAction<TContext, TExpressionEvent, TParams, TEvent, TActor>` | `ActionDefinition<TContext, TExpressionEvent, AssignDefinitionParams<TParams>, never, ImplementationNames, TEvent> & ImplementsParams<TParams>` |

`AssignArgs`, `PartialAssigner` and `AssignAction` carry the names and type parameters of XState's types of the same names.

## Related

- [Keep data in context](../../tutorials/02-working-with-context.md): a lesson that uses `assign`.
- [How to type a machine's context, events, input and output](../../how-to/define-custom-types.md)
- [setup and setupWithSchema](../setup.md): the `actions` record and the bound `setup(...).assign`.
- [spawnChild](./spawn-child.md) and [enqueueActions](./enqueue-actions.md)
- [Errors](../errors.md): `ActorError`.
