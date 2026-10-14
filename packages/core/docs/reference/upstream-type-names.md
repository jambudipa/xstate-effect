---
title: XState type names
doc-type: reference
sources: [packages/core/src/Types.ts, packages/core/src/interpreter.ts]
---

# XState type names

> **TL;DR:** The root exports the type names that `xstate@5.33.2` exports from its root, so a type
> written against XState's names compiles here. Each name maps to one of this package's own types.
> Where XState lists the actor, action, guard, delay and emitted types one by one, the package
> reads them as one record of names; a parameter that the mapped type does not read stays in the
> list. `Interpreter`, `AnyInterpreter` and `InterpreterFrom` are deprecated aliases of the actor
> types.

Every name on this page is a type-only export of `@jambudipa/xstate-effect`. In the tables, a
type parameter in *italics* is accepted for parity and not read by the mapped type. `any` in a
mapped type is the `any` that XState writes at that place.

## Summary

| Group | Names |
|---|---|
| [Names that are also modules](#names-that-are-also-modules) | `StateMachine`, `Snapshot`, `ActorLogic`, `ActorRef`, `ActorSystem`, `StateValue` |
| [Extractors](#extractors) | `StateFrom`, `StateSchemaFrom`, `ActorLogicFrom`, `EventFromLogic` |
| [State node configs](#state-node-configs) | `AnyStateNodeConfig`, `AtomicStateNodeConfig`, `HistoryStateNodeConfig`, `SimpleOrStateNodeConfig`, `StatesConfig`, `StateNodesConfig`, `StateTypes`, `UnknownMachineConfig` |
| [Transition configs](#transition-configs) | `AnyTransitionConfig`, `TransitionConfigTarget`, `TransitionConfigOrTarget`, `DelayedTransitions`, `AnyInvokeConfig` |
| [Definitions](#definitions) | `AnyTransitionDefinition`, `TransitionDefinitionMap`, `StateNodeDefinition`, `StateMachineDefinition`, `StatesDefinition`, `InitialTransitionDefinition` |
| [State schemas, values and snapshots](#state-schemas-values-and-snapshots) | `StateId`, `ToStateValue`, `ToChildren`, `StateKey`, `StateLike`, `AnyState`, `PersistedHistoryValue` |
| [Machine types and implementations](#machine-types-and-implementations) | `StateMachineTypes`, `ResolvedStateMachineTypes`, `InternalMachineImplementations`, `MachineImplementationsSimplified`, `ActionFunctionMap`, `DelayFunctionMap` |
| [Actions and parameters](#actions-and-parameters) | `Actions`, `UnknownAction`, `GetParameterizedParams`, `NoRequiredParams`, `WithDynamicParams`, `DelayExpr`, `LogExpr`, `SendExpr`, `Mapper`, `UnifiedArg`, `RaiseActionOptions`, `RaiseActionParams`, `SendToActionOptions`, `SendToActionParams`, `ActionExecutor`, `BuiltinActionResolution`, `ToExecutableAction` |
| [Actors](#actors) | `BaseActorRef`, `ActorLike`, `ActorRefLike`, `AnyActorScope`, `UnknownActorLogic`, `InteropSubscribable`, `RequiredActorOptions`, `RequiredLogicInput` |
| [Built-in action types](#built-in-action-types) | `AssignAction`, `AssignArgs`, `Assigner`, `PartialAssigner`, `PropertyAssigner`, `CancelAction`, `EmitAction`, `EnqueueActionsAction`, `LogAction`, `RaiseAction`, `SendToAction`, `SpawnAction`, `SpawnActionOptions`, `StopAction` |
| [General type utilities](#general-type-utilities) | `AnyFunction` to `Values` |
| [Deprecated interpreter names](#deprecated-interpreter-names) | `Interpreter`, `AnyInterpreter`, `InterpreterFrom` |

## Names that are also modules

Each of these root names is a value and a type. As a value it is the module namespace or the
class of this package. As a type it is the XState form.

| Name | As a type | As a value | Package type with the same meaning |
|---|---|---|---|
| `StateMachine` | `StateMachine<TContext, TEvent, TChildren, TActor, TAction, TGuard, TDelay, TStateValue, TTag, TInput, TOutput, TEmitted, TStateMeta, TStateSchema, TTransitionMeta>`, XState's parameter order | The machine class | `StateMachine.StateMachine<Id, TContext, …>` (also `StateMachineType`), the id first |
| `Snapshot` | `Snapshot<TOutput>` | The snapshot module | `SnapshotType` |
| `ActorLogic` | `ActorLogic<TSnapshot, TEvent, TInput, TEmitted, R>` | The actor logic module | `ActorLogicType` |
| `ActorRef` | `ActorRef<TSnapshot, TEvent, TEmitted>` | The actor reference module | `ActorRefType` |
| `ActorSystem` | `ActorSystem<T extends ActorSystemInfo>` | The actor system module | — |
| `StateValue` | The state value: a state key, or a map from each active child key to its value | The state value module | `StateValueType` |

As namespaces, `ActorLogic` and `ActorRef` also hold the type helpers of their types:
`ActorLogic.SnapshotOf<T>`, `ActorLogic.EventOf<T>`, `ActorLogic.InputOf<T>`,
`ActorLogic.EmittedOf<T>` and `ActorLogic.RequirementsOf<T>`, and `ActorRef.SnapshotOf<T>`,
`ActorRef.EventOf<T>` and `ActorRef.EmittedOf<T>`. The same helpers are also members of
`ActorLogicType` and `ActorRefType`, for example `ActorLogicType.SnapshotOf<T>`.

`Actor` is the actor class and a namespace of types, but not a root type. The actor type is
`Actor.Actor<TSnapshot, TEvent, TEmitted>`, also exported as `ActorType`. `StateNode` is the
state node class, and its instance type is also `StateNodeInterface`.

## Extractors

| Name | Maps to |
|---|---|
| `StateFrom<T extends AnyStateMachine \| ((...args: never) => AnyStateMachine)>` | `SnapshotFrom` of the machine, or of the machine that a function returns. |
| `StateSchemaFrom<T extends AnyStateMachine>` | The state schema of a machine. |
| `ActorLogicFrom<T>` | A machine itself, `PromiseActorLogic<U>` for `Promise<U>`, the result for a function's return type, else `never`. |
| `EventFromLogic<TLogic extends AnyActorLogic>` | The events that the logic takes. |

[Type utilities](./type-utilities.md) describes each one, with the other extractors.

## State node configs

| Name | Maps to |
|---|---|
| `AnyStateNodeConfig` | `StateNodeConfig<any, any, any, any>`. |
| `AtomicStateNodeConfig<TContext, TEvent>` | A `StateNodeConfig` whose `initial`, `states` and `onDone` are `undefined`. It also has `parallel?: false \| undefined`, which the engine does not read. |
| `HistoryStateNodeConfig<TContext, TEvent>` | An `AtomicStateNodeConfig` with `history: "shallow" \| "deep" \| true` and `target: string \| undefined`. |
| `SimpleOrStateNodeConfig<TContext, TEvent>` | `AtomicStateNodeConfig<TContext, TEvent> \| StateNodeConfig<TContext, TEvent, any, any>`. |
| `StatesConfig<TContext, TEvent, TActor, TAction, TGuard, TDelay, TTag, `*`TOutput`*`, TEmitted, TStateMeta, TTransitionMeta>` | A record of `StateNodeConfig`s by key, whose names are those of `TAction`, `TGuard`, `TDelay`, `TActor`, `TEmitted` and `TTag`. |
| `StateNodesConfig<TContext, TEvent, TStateMeta, TTransitionMeta>` | A record of `StateNode`s by key. |
| `StateTypes` | `StateNodeType`, or any other string. |
| `UnknownMachineConfig` | `MachineConfig<MachineContext, EventObject>`. |

## Transition configs

| Name | Maps to |
|---|---|
| `AnyTransitionConfig` | `TransitionConfig<any, any, any>`. |
| `TransitionConfigTarget` | `string \| undefined`. |
| `TransitionConfigOrTarget<TContext, TExpressionEvent, TEvent, TActor, TAction, TGuard, TDelay, TEmitted, TTransitionMeta>` | `SingleOrArray` of a `TransitionConfigTarget` or a `TransitionConfig`. |
| `DelayedTransitions<TContext, TEvent, TActor, TAction, TGuard, TDelay, TEmitted, TTransitionMeta>` | `DelayedTransitionsConfig`: the `after` member of a state node config. |
| `AnyInvokeConfig` | `InvokeConfig<any, any, any>`. |

## Definitions

| Name | Maps to |
|---|---|
| `AnyTransitionDefinition` | `TransitionDefinition<any, any, any>`. |
| `TransitionDefinitionMap<TContext, TEvent, TTransitionMeta>` | A record from each event descriptor of `TEvent` to a `ReadonlyArray` of `TransitionDefinition`s for the events that the descriptor matches. XState's lists are mutable arrays. |
| `StateNodeDefinition<TContext, TEvent, TStateMeta, TTransitionMeta>` | `StateNode.Definition`: the type of `node.definition`. |
| `StateMachineDefinition<TContext, TEvent, TStateMeta, TTransitionMeta>` | `StateNodeDefinition`: the type of `machine.definition`, which is the root's. |
| `StatesDefinition<TContext, TEvent, TStateMeta, TTransitionMeta>` | A record of `StateNodeDefinition`s by key. |
| `InitialTransitionDefinition<TContext, TEvent, TTransitionMeta>` | `StateNode.InitialTransitionDefinition`: the type of `node.initial`. |

[State nodes](./state-nodes.md) lists the fields of each definition.

## State schemas, values and snapshots

| Name | Maps to |
|---|---|
| `StateId<TSchema, TKey, TParentKey>` | The ids of the state nodes of a state schema: a node's own `id`, else its key path after the root's id. The root's default id is `(machine)`. The wide `StateSchema` gives `string`. |
| `ToStateValue<TConfig>` | The state value of a config as written: for a compound node, each atomic child key or `{ key: <child value> }`; for a parallel node, one object with every region. History states are left out. A config without literal state keys gives `StateValue`. |
| `ToChildren<TActor extends ProvidedActor>` | The `children` of a snapshot for the declared actors: each actor with a literal id under that id, as an optional reference of its logic. When an actor has no literal id, any other key holds a reference of such an actor or `undefined`. An actor whose `src` is not a literal name gives `Record<string, AnyActorRef>`. |
| `StateKey` | `string \| AnyMachineSnapshot`. |
| `StateLike<TContext extends MachineContext>` | `{ value: StateValue; context: TContext; event: EventObject }`, all `readonly`. |
| `AnyState` | `AnyMachineSnapshot`. |
| `PersistedHistoryValue` | The recorded nodes of each history state, by history node id: `{ readonly [id: string]: ReadonlyArray<{ readonly id: string }> }`. See [Persisted snapshots](./persistence.md). |

```ts
import { fromPromise, type StateId, type ToChildren, type ToStateValue } from "@jambudipa/xstate-effect"

type DoorConfig = {
  id: "door"
  initial: "closed"
  states: { closed: {}; open: { id: "opened" }; locked: { initial: "a"; states: { a: {}; b: {} } } }
}

export type Ids = StateId<DoorConfig>
// "door" | "opened" | "door.closed" | "door.locked" | "door.locked.a" | "door.locked.b"

export type Value = ToStateValue<DoorConfig> // "closed" | "open" | { readonly locked: "a" | "b" }

export const loader = fromPromise(() => Promise.resolve(1))

export type Children = ToChildren<{ src: "loader"; logic: typeof loader; id: "first" }>
// { readonly first?: ActorRefFromLogic<typeof loader> }
```

## Machine types and implementations

| Name | Maps to |
|---|---|
| `StateMachineTypes` | One record of the types that a machine declares: `context`, `events`, `actors` (`ProvidedActor`), `actions` and `guards` (`ParameterizedObject`), `delays` (`string`), `tags` (`string`) and `emitted` (`EventObject`). |
| `ResolvedStateMachineTypes<TContext, TEvent, TActor, TAction, TGuard, TDelay, TTag, TEmitted>` | A `StateMachineTypes` with each member narrowed to its type parameter. `TEmitted` defaults to `EventObject`. |
| `InternalMachineImplementations<TTypes extends StateMachineTypes>` | `DeclaredImplementations` of the record's context, events, actions, guards, delays and actors: the implementations that a machine of these types takes. |
| `MachineImplementationsSimplified<TContext, TEvent, `*`TActor`*`, `*`TAction`*`, `*`TGuard`*`>` | `Required<MachineImplementations<TContext, TEvent>>`: every record, of any name. |
| `ActionFunctionMap<TContext, TEvent, `*`TActor`*`, TAction, `*`TGuard`*`, `*`TDelay`*`, `*`TEmitted`*`>` | For each action name of `TAction`, an optional `ActionFunction` whose params are the params of that action. |
| `DelayFunctionMap<TContext, TEvent, `*`TAction`*`>` | `Record<string, DelayConfig<TContext, TEvent>>`. |

## Actions and parameters

| Name | Maps to |
|---|---|
| `Actions<TContext, TExpressionEvent, TEvent, `*`TParams`*`, TActor, TAction, TGuard, TDelay, TEmitted>` | `SingleOrArray` of `Action`: one action or a list, as a config writes them. |
| `UnknownAction` | `Action<MachineContext, EventObject>`. |
| `GetParameterizedParams<T extends ParameterizedObject \| undefined>` | The `params` type of `T`, or `undefined` when `T` has no `params`. |
| `NoRequiredParams<T extends ParameterizedObject>` | The names in `T` whose params may be `undefined`: the names that a config may write alone. |
| `WithDynamicParams<TContext, TExpressionEvent, T extends ParameterizedObject>` | `{ type, params? }` for each member of `T`, where `params` is a value or a function of `{ context, event }`. `params` is required when it may not be `undefined`. |
| `DelayExpr<TContext, TExpressionEvent, TParams, TEvent>` | `(args: ActionArgs<…>, params: TParams) => number`. |
| `LogExpr<TContext, TExpressionEvent, TParams, TEvent>` | `(args: ActionArgs<…>, params: TParams) => unknown`. |
| `SendExpr<TContext, TExpressionEvent, TParams, TSentEvent, TEvent>` | `(args: ActionArgs<…>, params: TParams) => TSentEvent`. |
| `Mapper<TContext, TExpressionEvent, TResult, TEvent>` | A function of `{ context, event, self }` that gives `TResult`, as the `input` of an invocation or a spawn takes it. |
| `UnifiedArg<TContext, TExpressionEvent, TEvent>` | `ActionArgs<TContext, TExpressionEvent, TEvent>`: what an action, a guard or a mapper receives. |
| `RaiseActionOptions<TContext, TExpressionEvent, `*`TParams`*`, `*`TEvent`*`, TDelay>` | `RaiseOptions`: the options of `raise`. |
| `RaiseActionParams<TContext, TExpressionEvent, TParams, TEvent, TDelay>` | `RaiseOptions` with `event`: a `TEvent`, or a `SendExpr` that gives one. |
| `SendToActionOptions<TContext, TExpressionEvent, `*`TParams`*`, TEvent, TDelay>` | `SendToOptions`: the options of `sendTo`. |
| `SendToActionParams<TContext, TExpressionEvent, TParams, TSentEvent, TEvent, TDelay>` | `SendToOptions` with `event`: a `TSentEvent`, or a `SendExpr` that gives one. |
| `ActionExecutor` | `(actionToExecute: CustomActionExecution) => Effect<void>`. XState's executor returns `void`. |
| `BuiltinActionResolution` | `readonly [AnyMachineSnapshot, NonReducibleUnknown, ReadonlyArray<UnknownAction> \| undefined]`: the snapshot, the params and the actions that a built-in action adds. |
| `ToExecutableAction<T extends ParameterizedObject>` | An executable action whose `type` is the name of `T` and whose `params` are the params of `T`. Its `exec` is an Effect, as for every executable action. See [Pure transition functions](./testing/get-next-snapshot.md). |

`RaiseOptions` and `SendToOptions` are described on [raise](./actions/raise.md) and
[sendTo](./actions/send-to.md).

## Actors

| Name | Maps to |
|---|---|
| `BaseActorRef<TEvent extends EventObject>` | `{ readonly send: (event: TEvent) => Effect<void> }`. XState's `send` returns `void`. |
| `ActorLike<TCurrent, TEvent extends EventObject>` | A `BaseActorRef` with `subscribe: (observer: (value: TCurrent) => Effect<void>) => Effect<void, never, Scope>`. The subscription ends when the caller's scope closes. XState's `subscribe` takes an observer and returns a `Subscription`. |
| `ActorRefLike` | `Pick<AnyActorRef, "sessionId" \| "send" \| "getSnapshot">`. |
| `AnyActorScope` | `ActorScopeService`: the scope that any actor logic runs in. |
| `UnknownActorLogic` | `ActorLogic<any, any, any, any>`. |
| `InteropSubscribable<T>` | `Subscribable<T>`: a source with an observer-object `subscribe`, as `fromObservable` takes it. |
| `RequiredActorOptions<TActor extends ProvidedActor>` | `"id"` when the actor declares an id, and `"input"` when the input of its logic may not be `undefined`. |
| `RequiredLogicInput<TLogic extends AnyActorLogic>` | `RequiredActorOptionsKeys<TLogic>`: `"input"` when the input of the logic may not be `undefined`, else `never`. |

```ts
import { Effect } from "effect"
import { createActor, createMachine, type BaseActorRef } from "@jambudipa/xstate-effect"

// Any target whose `send` takes PING fits, an actor included
const ping = (target: BaseActorRef<{ type: "PING" }>) => target.send({ type: "PING" })

const machine = createMachine({
  types: {} as { events: { type: "PING" } },
  initial: "idle",
  states: { idle: { on: { PING: "pinged" } }, pinged: {} }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(machine)
  yield* actor.start
  yield* ping(actor)
  return (yield* actor.getSnapshot).value // "pinged"
})

void Effect.runPromise(Effect.scoped(program))
```

## Built-in action types

The root also exports the types of the built-in actions under XState's names. Each action page
describes its own types.

| Names | Reference |
|---|---|
| `AssignAction`, `AssignArgs`, `Assigner`, `PartialAssigner`, `PropertyAssigner` | [assign and assignProperty](./actions/assign.md) |
| `CancelAction` | [cancel](./actions/cancel.md) |
| `EmitAction` | [emit](./actions/emit.md) |
| `EnqueueActionsAction` | [enqueueActions](./actions/enqueue-actions.md) |
| `LogAction` | [log and the level helpers](./actions/log.md) |
| `RaiseAction` | [raise](./actions/raise.md) |
| `SendToAction` | [sendTo, sendParent, sendSelf and forwardTo](./actions/send-to.md) |
| `SpawnAction`, `SpawnActionOptions` | [spawnChild](./actions/spawn-child.md) |
| `StopAction` | [stopChild, stop and stopAllChildren](./actions/stop-child.md) |

## General type utilities

The root exports XState's general helper types with the same names and formulas: `AnyFunction`,
`Cast`, `Compute`, `ConditionalRequired`, `DoNotInfer`, `Elements`, `Equals`, `GetConcreteByKey`,
`HomomorphicOmit`, `HomomorphicPick`, `Identity`, `IndexByProp`, `IndexByType`, `InferEvent`,
`Invert`, `IsAny`, `IsLiteralString`, `IsNever`, `IsNotNever`, `Lazy`, `LowInfer`, `MaybeLazy`,
`Merge`, `MetaObject`, `NoInfer`, `NonReducibleUnknown`, `Prop`, `SingleOrArray`, `TODO` and
`Values`. See [Type utilities](./type-utilities.md#general-type-utilities).

## Deprecated interpreter names

XState deprecates these names, and so does this package. `interpret` itself is not exported:
use `createActor`.

| Name | Maps to | Use instead |
|---|---|---|
| `Interpreter` | `typeof Actor`: the type of the actor class. | `Actor` |
| `AnyInterpreter` | `AnyActor`. | `AnyActor` |
| `InterpreterFrom<T extends AnyStateMachine \| ((...args: never) => AnyStateMachine)>` | `Actor.Actor<TSnapshot, TEvent, TEmitted>` of the machine, or of the machine that a function returns: the actor that `createActor` gives for it. | `ActorRefFrom`, or the type of the actor that `createActor` gives |

```ts
import type { Effect, Scope } from "effect"
import { createActor, createMachine, type InterpreterFrom } from "@jambudipa/xstate-effect"

const machine = createMachine({ types: {} as { context: { count: number } }, context: { count: 0 } })

// Deprecated: the type of the actor that `createActor(machine)` gives
export type MachineActor = InterpreterFrom<typeof machine>

export const makeActor: Effect.Effect<MachineActor, never, Scope.Scope> = createActor(machine)
```

## Related pages

- [Type utilities](./type-utilities.md)
- [Entry points](./entry-points.md)
- [State nodes](./state-nodes.md)
- [createMachine and the machine](./create-machine.md)
- [createActor and the actor](./create-actor.md)
- [How to port XState code to this package](../how-to/migrate-from-xstate.md)
- [How this package differs from XState](../explanation/differences-from-xstate.md)
