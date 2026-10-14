---
title: stopChild, stop and stopAllChildren
doc-type: reference
sources: [packages/core/src/actions/stopChild.ts]
---

# stopChild, stop and stopAllChildren

> **TL;DR:** `stopChild(target)` creates an action that stops one child actor, named by its id,
> its `systemId`, a reference, or a function that gives one of these. `stopAllChildren()` stops
> every child of the snapshot at that point of the action list. `stop` is the deprecated XState
> name of `stopChild`.

## Summary

| Export | Kind | Import from | Description |
|---|---|---|---|
| [`stopChild`](#stopchild) | function | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/actions` | An action that stops one child actor. |
| [`stop`](#stop) | function, deprecated | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/actions` | The same function as `stopChild`. |
| [`stopAllChildren`](#stopallchildren) | function | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/actions` | An action that stops every child of the actor. |
| [`StopChildTarget`](#stopchildtarget) | type | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/actions` | The target of `stopChild`. |
| [`StopAction`](#stopaction) | type | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/actions` | The type of the action that `stopChild` returns, under its XState name. |
| [`StopChild`, `StopAllChildren`](#stopchild-and-stopallchildren-interfaces) | types | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/actions` | The types of `stopChild` and `stopAllChildren`. |

## `stopChild`

### Signature

```ts
import type { ActionDefinition, EventObject, StopChildTarget } from "@jambudipa/xstate-effect"

export declare function stopChild<TContext, TEvent extends EventObject>(
  child: StopChildTarget<TContext, TEvent>
): ActionDefinition<TContext, TEvent>
```

### Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `child` | [`StopChildTarget<TContext, TEvent>`](#stopchildtarget) | required | A child's id, a child's `systemId`, an actor reference, or a function of the action arguments that gives one of these or `undefined`. |

### Returns

An `ActionDefinition<TContext, TEvent>` with `type: "xstate.stopChild"`.

### Behaviour

- A string resolves first against the keys of `snapshot.children`, then against the `systemId`
  of a child of this actor.
- A function receives the action arguments when the action runs.
- For the child it finds, the engine removes the entry under the child's `id` from
  `snapshot.children`, frees the `systemId` of the child and of its descendants at once, and
  stops the child.
- A child that has not started yet, such as one spawned earlier in the same action list, never
  starts. A running child stops after the events already sent to it.
- A child spawned without an `id` has the key `"undefined"` in `snapshot.children` and its
  session id as its `id`. The stop stops that child, and the `"undefined"` entry stays in
  `snapshot.children`.
- A string that names no child, and a function that gives `undefined`, change nothing.

### Errors

A reference to an actor that is not a child of this actor gives the actor the status `error`
with the message `Cannot stop child actor <child id> of <actor id> because it is not a child`.

### Example

```ts
import { Effect } from "effect"
import { createActor, createMachine, spawnChild, stopChild } from "@jambudipa/xstate-effect"

const worker = createMachine({ initial: "working", states: { working: {} } })

const machine = createMachine({
  types: {} as { events: { type: "START" } | { type: "CANCEL" } },
  initial: "idle",
  states: {
    idle: { on: { START: { target: "busy", actions: spawnChild(worker, { id: "worker" }) } } },
    busy: { on: { CANCEL: { target: "idle", actions: stopChild("worker") } } }
  }
})

export const program = Effect.gen(function* () {
  const actor = yield* createActor(machine)
  yield* actor.start
  yield* actor.send({ type: "START" })
  yield* actor.send({ type: "CANCEL" })
  const snapshot = yield* actor.getSnapshot
  return Object.keys(snapshot.children) // []
})
```

## `stop`

### Signature

```ts
import type { StopChild } from "@jambudipa/xstate-effect"

export declare const stop: StopChild
```

### Behaviour

`stop` is the `stopChild` function itself, so every fact of [`stopChild`](#stopchild) applies.
It is marked `@deprecated`; the replacement is `stopChild(...)`.

## `stopAllChildren`

### Signature

```ts
import type { ActionDefinition, EventObject } from "@jambudipa/xstate-effect"

export declare function stopAllChildren<TContext, TEvent extends EventObject>(): ActionDefinition<TContext, TEvent>
```

### Parameters

None.

### Returns

An `ActionDefinition<TContext, TEvent>` with `type: "xstate.stopAllChildren"`.

### Behaviour

- When the action runs, it takes the children of the snapshot at that point of the action list,
  and the engine runs one `stopChild` per child, in place, in the order of `snapshot.children`.
- A child spawned earlier in the same action list is included, and it never starts.
- A child with no `systemId` stops too.
- Each stop removes the entry under the child's `id`. The `"undefined"` entry of a child spawned
  without an `id` stays in `snapshot.children`, and the child stops.

### Errors

None of its own: each stop behaves as `stopChild` with a reference.

### Example

```ts
import { createMachine, spawnChild, stopAllChildren } from "@jambudipa/xstate-effect"

const worker = createMachine({ initial: "working", states: { working: {} } })

export const machine = createMachine({
  types: {} as { events: { type: "SHUTDOWN" } },
  initial: "running",
  states: {
    running: {
      entry: [spawnChild(worker, { id: "a" }), spawnChild(worker, { id: "b" })],
      on: { SHUTDOWN: { target: "stopped", actions: stopAllChildren() } }
    },
    stopped: {}
  }
})
```

## `StopChildTarget`

### Definition

```ts
import type { ActionContext, ActorRef, EventObject } from "@jambudipa/xstate-effect"

export type StopChildTarget<TContext, TEvent extends EventObject> =
  | string
  | ActorRef.ActorRefBase
  | ((ctx: ActionContext<TContext, TEvent>) => string | ActorRef.ActorRefBase | undefined)
```

Example: `stopChild(({ context }) => context.workerRef)`, where `context.workerRef` holds a
child reference.

## `StopAction`

### Definition

```ts
import type { ActionDefinition, EventObject } from "@jambudipa/xstate-effect"

export type StopAction<TContext, TExpressionEvent extends EventObject, _TParams, _TEvent extends EventObject> =
  ActionDefinition<TContext, TExpressionEvent>
```

The XState name of the action that `stopChild` returns. The third and fourth type parameters are
accepted for XState compatibility and do not change the type.

## `StopChild` and `StopAllChildren` interfaces

The types of `stopChild` (and `stop`) and of `stopAllChildren`. Each interface has the call
signature above as its first signature. Each also declares a second call signature whose
parameters are `never`; no call resolves to it.

## Related

- [How to spawn and stop child actors](../../how-to/spawn-and-stop-children.md)
- [spawnChild](./spawn-child.md)
- [setup and setupWithSchema](../setup.md): `setup(...).stopChild` is `stopChild` with the setup's
  context and events.
- [The actor system](../actor-system.md): `systemId` registration.
- [Actor lifetimes and scopes](../../explanation/actor-lifetimes-and-scopes.md)
