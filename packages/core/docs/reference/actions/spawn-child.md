---
title: spawnChild
doc-type: reference
sources: [packages/core/src/actions/spawnChild.ts]
---

# spawnChild

> **TL;DR:** `spawnChild(src, options?)` creates an action that spawns a child actor from actor
> logic or from the name of one of the machine's actors. The child gets the spawning actor as
> its parent, joins `snapshot.children` under its `id`, and starts after the macrostep.
> `spawnChildFromRegistry` spawns from an implementations object given in the call.

## Summary

| Export | Kind | Import from | Description |
|---|---|---|---|
| [`spawnChild`](#spawnchild) | function | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/actions` | An action that spawns a child actor. |
| [`spawnChildFromRegistry`](#spawnchildfromregistry) | function | `@jambudipa/xstate-effect/actions` | An action that spawns a child from the actors of an implementations object. |
| [`SpawnChildOptions`](#spawnchildoptions) | type | `@jambudipa/xstate-effect/actions` | The options of a spawn of typed logic. |
| [`UntypedSpawnChildOptions`](#untypedspawnchildoptions) | type | `@jambudipa/xstate-effect/actions` | The options of a spawn where the machine declares no actors. |
| [`SpawnChildArguments`](#spawnchildarguments) | type | `@jambudipa/xstate-effect/actions` | The argument list `spawnChild` accepts for a machine's names. |
| [`SpawnOptions`](#spawnoptions) | type | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/actions` | The options of a spawn without input functions. |
| [`SpawnAction`, `SpawnActionOptions`](#spawnaction-and-spawnactionoptions) | types | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/actions` | The XState names of the action and its options. |
| [`SpawnChild`](#spawnchild-interface) | type | `@jambudipa/xstate-effect/actions` | The type of `spawnChild`. |

## `spawnChild`

### Signature

```ts
import type { ActionDefinition, AnyActorLogic, EventObject, ImplementationNames } from "@jambudipa/xstate-effect"
import type { SpawnChildArguments } from "@jambudipa/xstate-effect/actions"

export declare function spawnChild<
  TContext,
  TEvent extends EventObject,
  TLogic extends AnyActorLogic,
  TNames extends ImplementationNames = ImplementationNames
>(...args: SpawnChildArguments<TContext, TEvent, TLogic, TNames>): ActionDefinition<TContext, TEvent, void, never, TNames>
```

The arguments are `src`, then `options`. Their accepted types depend on the actors the machine
declares; see [`SpawnChildArguments`](#spawnchildarguments).

### Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `src` | `string \| AnyActorLogic` | required | Actor logic, or the name of one of the machine's actor implementations (`setup({ actors })`, the `actors` of `createMachine`'s second argument, or `machine.provide`). |
| `options.id` | `string \| ((ctx) => string)` | none | The child's id, or a function of the action arguments that gives it. |
| `options.input` | the logic's input, or a function of the action arguments that gives it | none | The input that the child's initial snapshot receives. |
| `options.systemId` | `string` | none | The id under which the actor system registers the child. |
| `options.syncSnapshot` | `boolean` | `false` | Whether the child sends each active snapshot to its parent. |

### Returns

An `ActionDefinition<TContext, TEvent, void, never, TNames>` with `type: "xstate.spawnChild"`.

### Behaviour

- A string `src` resolves against the machine's actor implementations. A logic `src` is used as
  it is.
- The child is created with the spawning actor as its parent, in the spawning actor's scope. It
  joins `snapshot.children` under its id and starts after the macrostep.
- The child's `src` member is the name it was spawned by, or the logic.
- `id`: a function receives the action arguments when the action runs. Without an `id` option,
  the child's id is its session id, and its `snapshot.children` key is `"undefined"`. A second
  spawn without an `id` replaces that entry.
- `input`: a function receives the action arguments. The engine calls it only once `src`
  resolves to a logic.
- `systemId`: the child is reachable through `system.get(systemId)`. The `systemId` must be free
  in the system.
- `syncSnapshot: true`: the child sends each active snapshot to its parent as
  `{ type: "xstate.snapshot.<id>", snapshot }`.
- The input of a logic given inline is not checked against that logic's input type.

### Errors

| Condition | Result |
|---|---|
| A string `src` that names no actor implementation | A warning `Actor type '<src>' not found in machine '<actor id>'.` is logged, and nothing spawns. The actor keeps running. |
| A `systemId` that another actor of the system holds | The actor gets the status `error` with `Actor with system ID '<systemId>' already exists.` |

### Example

```ts
import { Effect } from "effect"
import { createActor, createMachine, setup, spawnChild } from "@jambudipa/xstate-effect"

const worker = createMachine({
  types: {} as { context: { taskId: string }; input: { taskId: string } },
  context: ({ input }) => ({ taskId: input.taskId }),
  initial: "working",
  states: { working: {} }
})

const parent = setup({
  types: { context: {} as { currentTask: string } },
  actors: { worker }
}).createMachine({
  context: { currentTask: "task-1" },
  entry: spawnChild("worker", {
    id: "worker-1",
    input: ({ context }) => ({ taskId: context.currentTask }),
    syncSnapshot: true
  })
})

export const program = Effect.gen(function* () {
  const actor = yield* createActor(parent)
  yield* actor.start
  const snapshot = yield* actor.getSnapshot
  return Object.keys(snapshot.children) // ["worker-1"]
})
```

## `spawnChildFromRegistry`

### Signature

```ts
import type { ActionContext, ActionDefinition, EventObject, MachineImplementations } from "@jambudipa/xstate-effect"

export declare function spawnChildFromRegistry<TContext, TEvent extends EventObject>(
  srcName: string,
  implementations: MachineImplementations<TContext, TEvent>,
  options?: {
    readonly id?: string | ((ctx: ActionContext<TContext, TEvent>) => string)
    readonly input?: unknown
    readonly systemId?: string
    readonly syncSnapshot?: boolean
  }
): ActionDefinition<TContext, TEvent>
```

### Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `srcName` | `string` | required | The name of an actor in `implementations.actors`. |
| `implementations` | `MachineImplementations<TContext, TEvent>` | required | The implementations whose `actors` the action reads. |
| `options.id` | `string \| ((ctx) => string)` | none | As for `spawnChild`. |
| `options.input` | `unknown` | none | A value, or a function of the action arguments that gives the input. |
| `options.systemId` | `string` | none | As for `spawnChild`. |
| `options.syncSnapshot` | `boolean` | `false` | As for `spawnChild`. |

### Returns

An `ActionDefinition<TContext, TEvent>` with `type: "xstate.spawnChild"`.

### Behaviour

- The action looks up `srcName` in `implementations.actors` when it runs, then spawns the logic
  it finds as `spawnChild` spawns a logic `src`.
- The machine's own actor implementations play no part.

### Errors

A name that `implementations.actors` lacks logs the warning
`Actor "<srcName>" not found in implementations`, and nothing spawns.

### Example

```ts
import { createMachine } from "@jambudipa/xstate-effect"
import { spawnChildFromRegistry } from "@jambudipa/xstate-effect/actions"

const worker = createMachine({ initial: "working", states: { working: {} } })

export const machine = createMachine({
  initial: "idle",
  states: {
    idle: {
      entry: spawnChildFromRegistry("worker", { actors: { worker } }, { id: "worker-1" })
    }
  }
})
```

## `SpawnChildOptions`

The options of a spawn of the logic `TLogic`, with the action context of `TContext` and
`TEvent`.

| Field | Type | Description |
|---|---|---|
| `id` | `string \| ((ctx: ActionContext<TContext, TEvent>) => string)` | The child's id. Defaults to its session id. |
| `input` | the input of `TLogic`, or a function of `ActionContext<TContext, TEvent>` that gives it | Any value when `TLogic` is `AnyActorLogic`. |
| `systemId` | `string` | The id under which the system registers the child. |
| `syncSnapshot` | `boolean` | Whether the child sends each active snapshot to its parent as `xstate.snapshot.<id>`. |

Type parameters: `<TContext, TEvent extends EventObject, TLogic extends AnyActorLogic>`.

## `UntypedSpawnChildOptions`

The options of a spawn where the machine declares no actors.

| Field | Type | Description |
|---|---|---|
| `id` | `string \| ((ctx: ActionContext<TContext, TEvent>) => string)` | The child's id. Defaults to its session id. |
| `input` | `unknown` | Any value, or a function that the engine calls with the action arguments. The function gets no contextual type, so its parameter needs a type annotation. |
| `systemId` | `string` | The id under which the system registers the child. |
| `syncSnapshot` | `boolean` | Whether the child sends each active snapshot to its parent as `xstate.snapshot.<id>`. |

Type parameters: `<TContext, TEvent extends EventObject>`.

## `SpawnChildArguments`

Type parameters: `<TContext, TEvent extends EventObject, TLogic extends AnyActorLogic, TNames
extends ImplementationNames>`.

The argument list of `spawnChild`, `setup(...).spawnChild` and `enqueue.spawnChild`, by the
actor names that `TNames` holds:

| Machine | `src` | `options` |
|---|---|---|
| Any actor name is accepted (a plain `createMachine` without `types.actors`) | An actor name or a logic | `UntypedSpawnChildOptions`, optional. |
| The machine declares its actors (`types.actors` of `createMachine`, or the actors of a `setup`) | One of the declared names | The ids that actor declares and the input of its logic. `id` is required when the actor declares ids (`types.children` of a `setup`). `input` is required when the logic's input type does not accept `undefined`. |
| The machine declares its actors | A logic given inline | `SpawnChildOptions` with any input. `id` is not accepted. |
| The machine declares no actors (a `setup` without `actors`) | A logic | `UntypedSpawnChildOptions` without `id`. |

## `SpawnOptions`

The options of a spawn without input functions, re-exported from the root types. It has the
fields `id?: string`, `input?: InputFrom<TLogic>`, `systemId?: string` and
`syncSnapshot?: boolean`. Type parameter: `<TLogic extends AnyActorLogic>`.

## `SpawnAction` and `SpawnActionOptions`

- `SpawnAction<TContext, TExpressionEvent, TParams, TEvent, TActor>`: the action that
  `spawnChild` returns, an `ActionDefinition` of `TContext` and `TExpressionEvent` whose names
  hold the actors `TActor`. `TParams` and `TEvent` do not change the type.
- `SpawnActionOptions<TContext, TExpressionEvent, TEvent, TActor>`: `SpawnChildOptions` of
  `TActor["logic"]`. `TEvent` does not change the type.

## `SpawnChild` interface

The type of `spawnChild`. Its first call signature is the one in [Signature](#signature). It also
declares a second call signature whose parameters are `never`; no call resolves to it.

## Related

- [How to spawn and stop child actors](../../how-to/spawn-and-stop-children.md)
- [stopChild, stop and stopAllChildren](./stop-child.md)
- [setup and setupWithSchema](../setup.md): `setup(...).spawnChild` takes the setup's actor names.
- [The actor system](../actor-system.md): `systemId` and `system.get`.
- [About the actor model](../../explanation/actor-model.md)
