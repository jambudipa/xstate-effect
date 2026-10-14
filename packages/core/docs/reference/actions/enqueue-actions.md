---
title: enqueueActions
doc-type: reference
sources: [packages/core/src/actions/enqueueActions.ts]
---

# enqueueActions

> **TL;DR:** `enqueueActions(collect)` creates an action whose `collect` function runs once and
> enqueues other actions through `enqueue`. The enqueued actions then run in its place, in
> order. `check` evaluates a guard against the context from before those actions run.

## Summary

| Export | Kind | Import from | Description |
|---|---|---|---|
| [`enqueueActions`](#enqueueactions) | function | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/actions` | An action that enqueues other actions at run time. |
| [`ActionEnqueuer`](#actionenqueuer) | type | `@jambudipa/xstate-effect/actions` | The `enqueue` function and its helpers. |
| [`EnqueueActionsArg`](#enqueueactionsarg) | type | `@jambudipa/xstate-effect/actions` | The argument object that `collect` receives. |
| [`CollectActions`](#collectactions) | type | `@jambudipa/xstate-effect/actions` | The type of `collect`. |
| [`EnqueueActionsDefinition`](#enqueueactionsdefinition) | type | `@jambudipa/xstate-effect/actions` | The action that `enqueueActions` returns. |
| [`EnqueueActionsAction`](#enqueueactionsaction) | type | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/actions` | The same action under its XState name. |
| [`EnqueueActions`](#enqueueactions-interface) | type | `@jambudipa/xstate-effect/actions` | The type of `enqueueActions`. |

## `enqueueActions`

### Signature

```ts
import type { EventObject, ImplementationNames } from "@jambudipa/xstate-effect"
import type { CollectActions, EnqueueActionsDefinition } from "@jambudipa/xstate-effect/actions"

export declare function enqueueActions<
  TContext,
  TEvent extends EventObject,
  TParams = void,
  TNames extends ImplementationNames = ImplementationNames,
  TSelfEvent extends EventObject = TEvent
>(
  collect: CollectActions<TContext, TEvent, TParams, TNames, TSelfEvent>
): EnqueueActionsDefinition<TContext, TEvent, TParams, never, TNames, TSelfEvent>
```

`TNames` holds the action, guard, delay and actor names that `enqueue` and `check` accept. Any
name is accepted by default; `setup(...).enqueueActions` accepts the setup's names.

### Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `collect` | [`CollectActions<TContext, TEvent, TParams, TNames, TSelfEvent>`](#collectactions) | required | A synchronous function of the [argument object](#enqueueactionsarg) and the params of the use. Its return value is ignored. |

### Returns

An [`EnqueueActionsDefinition`](#enqueueactionsdefinition) with `type: "xstate.enqueueActions"`
and the `collect` function as its `collect` member.

### Behaviour

- The engine calls `collect` once, when it reaches the action in the action list.
- The second argument of `collect` is the params of the use. A use as a named action,
  `{ type: "name", params }`, passes those params.
- The actions that `collect` enqueued run in its place, in the order they were enqueued, as if
  they stood in the action list:
  - each action sees the context that the actions before it assigned;
  - a `raise` joins the internal event queue;
  - sends, emits, spawns, stops, cancels and logs go through the engine as usual;
  - a nested `enqueueActions` resolves in place too.
- `check` evaluates a guard against the context from before any enqueued action runs. A
  `check` after `enqueue.assign(...)` in the same `collect` does not see that assignment.
- There is no `enqueue.log`. `enqueue(log(...))` enqueues a log.

### Errors

| Condition | Result |
|---|---|
| `collect` throws | The actor gets the status `error`, with the thrown value in `snapshot.error`. |
| `check` gets a guard name that has no implementation | `check` throws a `GuardError` with the message `Guard '<name>' is not implemented.'.`. It ends `collect`, and the actor gets the status `error` with that `GuardError`. |
| A guard that `check` evaluates throws, fails, or does not complete synchronously | `check` throws, and the actor gets the status `error`. |

### Example

```ts
import { Effect } from "effect"
import { createActor, enqueueActions, log, setup } from "@jambudipa/xstate-effect"

const machine = setup({
  types: {
    context: {} as { count: number; notified: boolean },
    events: {} as { type: "INC" } | { type: "NOTIFY" }
  },
  guards: {
    isLarge: ({ context }) => context.count >= 2
  }
}).createMachine({
  context: { count: 0, notified: false },
  on: {
    INC: {
      actions: enqueueActions(({ context, enqueue, check }) => {
        enqueue.assign({ count: context.count + 1 })
        if (check("isLarge")) {
          enqueue.raise({ type: "NOTIFY" })
        }
        enqueue(log("incremented"))
      })
    },
    NOTIFY: { actions: enqueueActions(({ enqueue }) => enqueue.assign({ notified: true })) }
  }
})

export const program = Effect.gen(function* () {
  const actor = yield* createActor(machine, { logger: () => undefined })
  yield* actor.start
  yield* actor.send({ type: "INC" })
  yield* actor.send({ type: "INC" })
  yield* actor.send({ type: "INC" })
  const snapshot = yield* actor.getSnapshot
  return snapshot.context // { count: 3, notified: true }
})
```

The third `INC` raises `NOTIFY`: `check("isLarge")` reads `count: 2`, the context from before
the enqueued `assign`.

## `ActionEnqueuer`

The `enqueue` member of the argument object. Type parameters: `<TContext, TEvent extends
EventObject, TNames extends ImplementationNames = ImplementationNames, TSelfEvent extends
EventObject = TEvent>`.

| Member | Signature | Enqueues |
|---|---|---|
| call | `(action: Action<TContext, TEvent, TNames, TSelfEvent>) => void` | Any action form a machine config takes: an implementation name, `{ type, params }`, an inline function, a built-in action such as `raise(...)` or `log(...)`, or a nested `enqueueActions`. |
| `assign` | `(assignment) => void` | `assign(assignment)`. Its assigners receive `undefined` params. |
| `raise` | `(event, options?) => void` | `raise(event, options)`. `options` is `{ id, delay }`; `delay` is a number, a delay name or a function. |
| `sendTo` | `(target, event, options?) => void` | `sendTo(target, event, options)`. The event is typed by the target, as for `sendTo`. |
| `sendParent` | `(event, options?) => void` | `sendParent(event, options)`. `options` has no `id`. |
| `sendSelf` | `(event, options?) => void` | `sendSelf(event, options)`. |
| `spawnChild` | `(...args: SpawnChildArguments<TContext, TEvent, TLogic, TNames>) => void` | `spawnChild(src, options)`, with the arguments that `spawnChild` accepts. |
| `stopChild` | `(child: StopChildTarget<TContext, TEvent>) => void` | `stopChild(child)`. |
| `emit` | `(event) => void` | `emit(event)`. In a setup that declares `types.emitted`, the event is one of those events; elsewhere any event object. |
| `cancel` | `(sendId) => void` | `cancel(sendId)`. |

Example: `enqueue.sendParent({ type: "DONE" })`.

## `EnqueueActionsArg`

The first argument of `collect`. Type parameters as for [`ActionEnqueuer`](#actionenqueuer).

| Field | Type | Description |
|---|---|---|
| `context` | `TContext` | The context when the action runs. |
| `event` | `TEvent` | The event of the action. |
| `enqueue` | `ActionEnqueuer<TContext, TEvent, TNames, TSelfEvent>` | Enqueues actions. |
| `check` | `(guard: Guard<TContext, TEvent, TNames>) => boolean` | Evaluates a guard now: a name or `{ type, params }` of the machine's guards, an inline function of `{ context, event }`, or a built-in guard (`and`, `or`, `not`, `stateIn`). |
| `self` | the action context's `self` | A reference to the machine actor. |
| `system` | the action context's `system` | The actor system. |

Example: `enqueueActions(({ event, enqueue }) => enqueue.raise({ type: "ECHO", value: event.type }))`.

## `CollectActions`

```ts
import type { EventObject, ImplementationNames } from "@jambudipa/xstate-effect"
import type { EnqueueActionsArg } from "@jambudipa/xstate-effect/actions"

export type CollectActions<
  TContext,
  TEvent extends EventObject,
  TParams = void,
  TNames extends ImplementationNames = ImplementationNames,
  TSelfEvent extends EventObject = TEvent
> = (args: EnqueueActionsArg<TContext, TEvent, TNames, TSelfEvent>, params: TParams) => void
```

## `EnqueueActionsDefinition`

An `ActionDefinition<TContext, TEvent, TParams, R, TNames, TSelfEvent>` with one more member:

| Field | Type | Description |
|---|---|---|
| `collect` | `CollectActions<TContext, TEvent, TParams, TNames, TSelfEvent>` | The function given to `enqueueActions`. |

Type parameters: `<TContext, TEvent extends EventObject, TParams = void, R = never, TNames
extends ImplementationNames = ImplementationNames, TSelfEvent extends EventObject = TEvent>`.

## `EnqueueActionsAction`

The XState name of the action that `enqueueActions` returns:
`EnqueueActionsAction<TContext, TExpressionEvent, TParams, TEvent, TActor, TAction, TGuard,
TDelay>` is an `EnqueueActionsDefinition` of `TContext`, `TExpressionEvent` and `TParams`, whose
names are the actors `TActor`, the actions `TAction`, the guards `TGuard` and the delays
`TDelay`, and whose self event is `TEvent`.

## `EnqueueActions` interface

The type of `enqueueActions`. Its first call signature is the one in [Signature](#signature). It
also declares a second call signature whose parameters are `never`; no call resolves to it.

## Related

- [How to choose actions at run time with enqueueActions](../../how-to/batch-actions-with-enqueue.md)
- [setup and setupWithSchema](../setup.md): `setup(...).enqueueActions` accepts the setup's names.
- [Guards](../guards.md): the guard forms that `check` accepts.
- [log and the level helpers](./log.md)
- [raise](./raise.md)
- [How an actor processes events](../../explanation/event-processing.md)
