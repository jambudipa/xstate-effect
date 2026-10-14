---
title: Entry points
doc-type: reference
sources: [packages/core/package.json, packages/core/src/index.ts, packages/core/src/actions/index.ts, packages/core/src/actors/index.ts, packages/core/src/guards/index.ts, packages/core/src/graph/index.ts, packages/core/src/dev/index.ts]
---

# Entry points

> **TL;DR:** The package has six entry points: the root `@jambudipa/xstate-effect` and the
> subpaths `/actions`, `/actors`, `/guards`, `/graph` and `/dev`. The root holds almost every
> export, the testing functions included; `/graph` and `/dev` hold exports that the root does not.
> The package is ESM only and needs `effect` 4 as a peer dependency.

## Summary

| Specifier | Holds | Exports |
|---|---|---|
| [`@jambudipa/xstate-effect`](#root-entry-point) | Machines, `setup`, actors, actions, guards, actor logic, snapshots, events, errors, testing functions, types | 170 values, 300 types |
| [`@jambudipa/xstate-effect/actions`](#actions) | The built-in actions and their types | 20 values, 52 types |
| [`@jambudipa/xstate-effect/actors`](#actors) | The actor logic creators, `createEmptyActor` and their types | 11 values, 24 types |
| [`@jambudipa/xstate-effect/guards`](#guards) | The built-in guards and `evaluateGuard` | 6 values, 7 types |
| [`@jambudipa/xstate-effect/graph`](#graph) | Graph traversal and model-based testing | 17 values, 24 types |
| [`@jambudipa/xstate-effect/dev`](#dev) | The dev tools hook | 4 values, 1 type |

## Package format

| Field | Value | Effect |
|---|---|---|
| `type` | `"module"` | The package is ESM only. It has no CommonJS build. |
| `exports` | `.`, `./actions`, `./actors`, `./guards`, `./graph`, `./dev`, `./package.json` | No other path is importable. There is no `./testing` subpath: the testing functions are in the root. |
| export conditions | `types`, `import`, `default` | `types` names `dist/<path>/index.d.ts`. `import` and `default` name the same ES module, `dist/<path>/index.js`. |
| `main`, `module`, `types` | `./dist/index.js`, `./dist/index.js`, `./dist/index.d.ts` | The root entry point, for tools that do not read `exports`. |
| `sideEffects` | `false` | Bundlers may leave out a module that the application does not use. |
| `engines.node` | `>=20.0.0` | The supported Node.js versions. |
| `peerDependencies.effect` | `^4.0.0` | The application installs `effect` itself. |
| `files` | `dist`, `src`, `README.md`, `LICENSE`, `llms.txt` | The published contents. |

### Example

```ts
import { Effect } from "effect"
import { createActor, createMachine } from "@jambudipa/xstate-effect"
import { assign } from "@jambudipa/xstate-effect/actions"
import { fromEffect } from "@jambudipa/xstate-effect/actors"
import { and } from "@jambudipa/xstate-effect/guards"
import { getShortestPaths } from "@jambudipa/xstate-effect/graph"
import { getGlobal } from "@jambudipa/xstate-effect/dev"

export const imported = [Effect.void, createActor, createMachine, assign, fromEffect, and, getShortestPaths, getGlobal]
```

## Root entry point

`@jambudipa/xstate-effect`, built from `src/index.ts`.

### Values

| Group | Values | Reference |
|---|---|---|
| Machines | `createMachine`, `makeStateMachine`, `StateMachine` (class; also a type and a namespace of types), `isStateMachine`, `StateMachineTypeId` | [createMachine and the machine](./create-machine.md) |
| Setup | `setup`, `setupWithSchema`, `action`, `guard`, `when` | [setup and setupWithSchema](./setup.md) |
| Actors | `createActor`, `makeActor`, `Actor` (class; also a namespace of types), `isActor`, `ActorTypeId`, `createEmptyActor` | [createActor and the actor](./create-actor.md) |
| Actor references | `ActorRef` (namespace; also a type), `ActorRefTypeId`, `isActorRef`, `getId`, `equals`, `isChildOf`, `send`, `toSnapshotStream` | [Actor references](./actor-refs.md) |
| Actor logic | `ActorLogic` (namespace; also a type), `ActorLogicTypeId`, `ActorScope`, `isActorLogic`, `makeActorLogic` | [Custom actor logic and createEmptyActor](./actors/custom-logic.md) |
| Actor system | `ActorSystem` (namespace; also a type), `ActorSystemTag`, `SchedulerTag`, `SchedulerLive`, `ActorSystemLive`, `ActorSystemLiveFull`, `makeActorSystem` | [The actor system](./actor-system.md) |
| Actions | `assign`, `assignProperty`, `raise`, `sendTo`, `sendParent`, `sendSelf`, `forwardTo`, `emit`, `cancel`, `log`, `logDebug`, `logInfo`, `logWarning`, `logError`, `spawnChild`, `stopChild`, `stop` (deprecated alias of `stopChild`), `stopAllChildren`, `enqueueActions`, `actions` (namespace of `/actions`) | [assign](./actions/assign.md), [raise](./actions/raise.md), [sendTo](./actions/send-to.md), [emit](./actions/emit.md), [cancel](./actions/cancel.md), [log](./actions/log.md), [spawnChild](./actions/spawn-child.md), [stopChild](./actions/stop-child.md), [enqueueActions](./actions/enqueue-actions.md) |
| Guards | `and`, `or`, `not`, `stateIn`, `stateNotIn`, `guards` (namespace of `/guards`) | [Guards](./guards.md) |
| Actor logic creators | `fromPromise`, `fromCallback`, `fromTransition`, `fromTransitionWithInput`, `fromObservable`, `fromEventObservable`, `fromStream`, `fromEffect`, `fromEffectBackground`, `actors` (namespace of `/actors`) | [fromPromise](./actors/from-promise.md), [fromCallback](./actors/from-callback.md), [fromTransition](./actors/from-transition.md), [fromObservable](./actors/from-observable.md), [fromStream](./actors/from-stream.md), [fromEffect](./actors/from-effect.md) |
| Pure transition functions | `transition`, `initialTransition`, `getNextSnapshot`, `getInitialSnapshot`, `getMicrosteps`, `getInitialMicrosteps`, `getNextTransitions` | [Pure transition functions](./testing/get-next-snapshot.md) |
| Waiting | `waitFor`, `waitForPromise`, `WaitForTimeoutError`, `WaitForTerminatedError`, `toEffect`, `toPromise`, `ActorOutputError` | [waitFor, toEffect and toPromise](./testing/wait-for.md) |
| Simulated clock | `SimulatedClock`, `makeSimulatedClock`, `makeSimulatedClockEffect`, `TimeTravelError` | [SimulatedClock](./testing/simulated-clock.md) |
| Testing namespace | `testing` (namespace of the testing module) | [Pure transition functions](./testing/get-next-snapshot.md) |
| Snapshots | `Snapshot` (namespace; also a type), `SnapshotTypeId`, `MachineSnapshotTypeId`, `SnapshotStatusSchema`, `isSnapshot`, `isMachineSnapshot`, `active`, `done`, `error`, `stopped`, `isActive`, `isDone`, `isError`, `isStopped`, `makeMachineSnapshot`, `initialMachineSnapshot`, `matches`, `hasTag`, `getTags`, `updateContext`, `updateValue`, `updateStatus`, `complete`, `fail` | [Snapshots](./snapshots.md) |
| State values | `StateValue` (namespace; also a type), `matchesState`, `pathToStateValue`, `mapState`, `getStateNodes`, `__unsafe_getAllOwnEventDescriptors` | [State values](./state-value.md) |
| State nodes | `StateNode` (class), `StateNodeTypeId`, `isStateNode`, `makeStateNode`, `atomic`, `compound`, `parallel`, `final`, `historyState`, `getChild`, `getChildren`, `getTransitions`, `getInitialTarget`, `getLeafStates`, `isAtomic`, `isCompound`, `isParallel`, `isFinal`, `isHistory`, `isLeaf`, `isAncestor`, `isDescendant`, `withTransitions`, `withEntry`, `withExit`, `withInvoke`, `withTags`, `withParent` | [State nodes](./state-nodes.md) |
| Events | `Event` (namespace), `InitEvent`, `StopEvent`, `DoneActorEvent`, `ErrorActorEvent`, `DoneStateEvent`, `AfterEvent`, `SnapshotEvent`, `NULL_EVENT`, `isEventObject`, `isNullEvent`, `isWildcardType`, `isDoneActorEvent`, `isErrorActorEvent`, `isDoneStateEvent`, `isAfterEvent`, `matchesEventDescriptor`, `assertEvent`, `SpecialTargets` | [Events](./events.md) |
| Errors | `Errors` (namespace of the error classes) | [Errors](./errors.md) |
| Types namespace | `Types` (namespace of the type definitions and the `ActionResult` constructors) | [Type utilities](./type-utilities.md) |

### Types

| Group | Types | Reference |
|---|---|---|
| Machines | `AnyStateMachine`, `StateMachineType`, `MachineConfig`, `MachineContext`, `MachineOptions`, `MachineTypes`, `MachineImplementations`, `ContextFactory`, `StateNodeConfig`, `StateSchema`, `TransitionConfig`, `TransitionsConfig`, `TransitionTarget`, `RouteTransitionConfig`, `InitialTransitionConfig`, `DelayedTransitionsConfig`, `DelayConfig`, `InvokeConfig`, `InvokeConfigMembers`, `InvokeInput`, `InvokeTransitionsConfig`, `OutputDefinition`, `StateNodeType`, `HistoryType`, `ProvidedActor`, `ParameterizedObject`, `ImplementationNames`, `RoutableStateId` | [createMachine and the machine](./create-machine.md) |
| Setup | `SetupTypes`, `SetupConfig`, `SetupReturn`, `SetupHelpers`, `SetupExtension`, `SetupMachine`, `SetupMachineConfig`, `SetupConfigMembers`, `SetupCreateMachine`, `SetupChildren`, `SetupChildrenActors`, `SetupGuardChecks`, `SetupNames`, `SetupRecordNames`, `SetupRequirements`, `SetupProvideImplementations`, `SetupAction`, `SetupActionImplementation`, `SetupSchemaConfig`, `SetupSchemaReturn`, `ExtensionNames`, `MergedImplementations`, `NamesOf`, `ImplementationParams`, `ParameterizedObjectsOf`, `DeclaredEmitted`, `SpawnedLogicOf`, `ToProvidedActor`, `ActorNamesOf`, `ContextFrom`, `EventFrom`, `ActorsFrom`, `ActionsFrom`, `GuardsFrom`, `DelaysFrom` | [setup and setupWithSchema](./setup.md), [Type utilities](./type-utilities.md) |
| Actions and guards | `Action`, `ActionArgs`, `ActionContext`, `ActionDefinition`, `ActionFunction`, `ActionImplementation`, `ActionParams`, `ActionReference`, `ActionResult`, `DynamicParams`, `ParameterizedAction`, `TypedActorContext`, `SpawnOptions`, `Spawner`, `Guard`, `GuardArgs`, `GuardContext`, `GuardDefinition`, `GuardImplementation`, `GuardPredicate`, `GuardReference`, `GuardScope`, `ParameterizedGuard`, `UnknownGuard`, `BuiltInGuardDefinition`, `AssignAction`, `AssignArgs`, `Assigner`, `PartialAssigner`, `PropertyAssigner`, `CancelAction`, `EmitAction`, `EnqueueActionsAction`, `LogAction`, `RaiseAction`, `SendToAction`, `SpawnAction`, `SpawnActionOptions`, `StopAction`, `StopAllChildren`, `StopChild`, `StopChildTarget` | [Type utilities](./upstream-type-names.md#actions-and-parameters), [Guards](./guards.md) |
| Actors and actor logic | `ActorType`, `AnyActor`, `Readable`, `ActorOptions`, `ActorOptionsArgs`, `RequiredActorOptionsKeys`, `ActorLogicType`, `AnyActorLogic`, `ActorScopeService`, `CustomActionExecution`, `ActorRefType`, `AnyActorRef`, `UnknownActorRef`, `SnapshotStream`, `ActorSystemInfo`, `ActorSystemService`, `SchedulerService`, `DevToolsAdapter`, `ActorRefFrom`, `ActorRefFromLogic`, `SnapshotFrom`, `InputFrom`, `OutputFrom`, `EmittedFrom`, `MachineImplementationsFrom`, `StateValueFrom`, `TagsFrom`, `PromiseActorLogic`, `PromiseActorRef`, `PromiseSnapshot`, `CallbackActorLogic`, `CallbackActorRef`, `CallbackLogicFunction`, `CallbackSnapshot`, `TransitionActorLogic`, `TransitionActorRef`, `TransitionActorScope`, `TransitionSnapshot`, `ObservableActorLogic`, `ObservableActorRef`, `ObservableSnapshot`, `Observer`, `Subscribable`, `EffectActorLogic`, `EffectActorRef`, `EffectSnapshot` | [createActor and the actor](./create-actor.md), [Actor references](./actor-refs.md), [Type utilities](./type-utilities.md) |
| Snapshots, state values and state nodes | `SnapshotType`, `SnapshotStatus`, `MachineSnapshot`, `AnyMachineSnapshot`, `HistoryValue`, `AnyHistoryValue`, `PersistedHistoryValue`, `StateConfig`, `AnyStateConfig`, `ProcessingStatus`, `StateValueType`, `StateValueMap`, `StateNodeInterface`, `AnyStateNode`, `AnyStateNodeDefinition`, `HistoryStateNode`, `TransitionDefinition`, `Transitions`, `DelayedTransitionDefinition`, `InitialTransition`, `InitialTransitionDefinition`, `InvokeDefinition` | [Snapshots](./snapshots.md), [State values](./state-value.md), [State nodes](./state-nodes.md) |
| Events | `EventObject`, `AnyEventObject`, `WildcardEvent`, `EventlessEvent`, `EventType`, `EventByType`, `EventDescriptor`, `ExtractEvent` | [Events](./events.md) |
| Errors | `TransitionError`, `InitializationError`, `ActorError`, `GuardError`, `ActionError`, `StateNodeNotFoundError`, `SerializationError`, `RestoreError`, `InvalidPersistedSnapshotError`, `StartError`, `InvokeError`, `DelayError`, `XStateError` | [Errors](./errors.md) |
| Testing | `SyncSimulatedClock`, `SimulatedClockEffect`, `WaitForOptions`, `ExecutableActionObject`, `ExecutableActionsFrom`, `ExecutableSpawnAction`, `SpecialExecutableAction`, `ToExecutableAction` | [Pure transition functions](./testing/get-next-snapshot.md), [SimulatedClock](./testing/simulated-clock.md), [waitFor, toEffect and toPromise](./testing/wait-for.md) |
| Inspection | `InspectionEvent`, `InspectedActionEvent`, `InspectedActorEvent`, `InspectedEventEvent`, `InspectedMicrostepEvent`, `InspectedSnapshotEvent`, `InspectedTransitionEvent` | [Inspection events](./inspection.md) |
| XState type utilities | `AnyFunction`, `Cast`, `Compute`, `ConditionalRequired`, `DoNotInfer`, `Elements`, `Equals`, `GetConcreteByKey`, `HomomorphicOmit`, `HomomorphicPick`, `Identity`, `IndexByProp`, `IndexByType`, `InferEvent`, `Invert`, `IsAny`, `IsLiteralString`, `IsNever`, `IsNotNever`, `Lazy`, `LowInfer`, `MaybeLazy`, `Merge`, `MetaObject`, `NoInfer`, `NonReducibleUnknown`, `Prop`, `SingleOrArray`, `TODO`, `Values` | [Type utilities](./type-utilities.md) |
| XState type names | `ActionExecutor`, `ActionFunctionMap`, `Actions`, `ActorLike`, `ActorLogicFrom`, `ActorRefLike`, `AnyActorScope`, `AnyInvokeConfig`, `AnyState`, `AnyStateNodeConfig`, `AnyTransitionConfig`, `AnyTransitionDefinition`, `AtomicStateNodeConfig`, `BaseActorRef`, `BuiltinActionResolution`, `DelayExpr`, `DelayFunctionMap`, `DelayedTransitions`, `EventFromLogic`, `GetParameterizedParams`, `HistoryStateNodeConfig`, `InternalMachineImplementations`, `InteropSubscribable`, `LogExpr`, `MachineImplementationsSimplified`, `Mapper`, `NoRequiredParams`, `RaiseActionOptions`, `RaiseActionParams`, `RequiredActorOptions`, `RequiredLogicInput`, `ResolvedStateMachineTypes`, `SendExpr`, `SendToActionOptions`, `SendToActionParams`, `SimpleOrStateNodeConfig`, `StateFrom`, `StateId`, `StateKey`, `StateLike`, `StateMachineDefinition`, `StateMachineTypes`, `StateNodeDefinition`, `StateNodesConfig`, `StateSchemaFrom`, `StatesConfig`, `StatesDefinition`, `StateTypes`, `ToChildren`, `ToStateValue`, `TransitionConfigOrTarget`, `TransitionConfigTarget`, `TransitionDefinitionMap`, `UnifiedArg`, `UnknownAction`, `UnknownActorLogic`, `UnknownMachineConfig`, `WithDynamicParams`, `Interpreter` (deprecated), `AnyInterpreter` (deprecated), `InterpreterFrom` (deprecated) | [XState type names](./upstream-type-names.md) |

The names `StateMachine`, `Snapshot`, `ActorLogic`, `ActorRef`, `ActorSystem` and `StateValue`
are both a value and a type. As types they are the XState forms: `StateMachine<TContext,
TEvent, …>`, `Snapshot<TOutput>`, `ActorLogic<TSnapshot, TEvent, …>`, `ActorRef<TSnapshot,
TEvent, TEmitted>`, `ActorSystem<T>` and the state value type.

### Reached only through a namespace

The root names these exports only as members of a namespace:

| Export | Namespace member | Also exported by |
|---|---|---|
| The error classes as values, `MachineDefinitionError`, `EventAssertionError` | `Errors.TransitionError`, `Errors.MachineDefinitionError`, … | — |
| The `ActionResult` constructors, `DeclaredImplementations` and the other module types | `Types.ActionResult`, `Types.DeclaredImplementations`, … | — |
| `fromEffectRetry` and the actor argument types | `actors.fromEffectRetry`, … | `/actors` |
| `spawnChildFromRegistry` and the action types | `actions.spawnChildFromRegistry`, … | `/actions` |
| `evaluateGuard` and the guard interfaces | `guards.evaluateGuard`, … | `/guards` |
| `createSimulatedClock`, `createInertActorScope`, `Clock`, `SimulatedTimeout`, `ExecutableRaiseAction`, `ExecutableSendToAction` | `testing.createSimulatedClock`, … | — |

### Example

```ts
import { Effect } from "effect"
import { Errors, createActor, createMachine, testing } from "@jambudipa/xstate-effect"

const machine = createMachine({ initial: "idle", states: { idle: {} } })

export const program = Effect.gen(function* () {
  const clock = testing.createSimulatedClock()
  const actor = yield* createActor(machine, { clock })
  yield* actor.start
  return actor
})

export const isTransitionError = (u: unknown): u is Errors.TransitionError => u instanceof Errors.TransitionError
```

## actions

`@jambudipa/xstate-effect/actions`, built from `src/actions/index.ts`.

### Values

| Values | Reference |
|---|---|
| `assign`, `assignProperty` | [assign and assignProperty](./actions/assign.md) |
| `raise` | [raise](./actions/raise.md) |
| `sendTo`, `sendParent`, `sendSelf`, `forwardTo` | [sendTo, sendParent, sendSelf and forwardTo](./actions/send-to.md) |
| `emit` | [emit](./actions/emit.md) |
| `cancel` | [cancel](./actions/cancel.md) |
| `log`, `logDebug`, `logInfo`, `logWarning`, `logError` | [log and the level helpers](./actions/log.md) |
| `spawnChild`, `spawnChildFromRegistry` | [spawnChild](./actions/spawn-child.md) |
| `stopChild`, `stop` (deprecated alias of `stopChild`), `stopAllChildren` | [stopChild, stop and stopAllChildren](./actions/stop-child.md) |
| `enqueueActions` | [enqueueActions](./actions/enqueue-actions.md) |

`spawnChildFromRegistry` is in this entry point only. The root holds the other values.

### Types

| Module | Types |
|---|---|
| assign | `Assign`, `Assignment`, `Assigner`, `PropertyAssigner`, `PartialAssigner`, `AssignArgs`, `AssignAction` |
| raise | `Raise`, `RaiseEvent`, `RaiseOptions`, `RaiseAction` |
| sendTo | `SendTo`, `SendParent`, `SendSelf`, `ForwardTo`, `SendToTarget`, `SendToEvent`, `SendToTargetEvent`, `SendToOptions`, `SendToAction` |
| emit | `Emit`, `EmitEvent`, `EmitAction` |
| cancel | `Cancel`, `CancelId`, `CancelAction` |
| log | `Log`, `LogDebug`, `LogInfo`, `LogWarning`, `LogError`, `LogLevel`, `LogMessage`, `LogOptions`, `LogAction` |
| spawnChild | `SpawnChild`, `SpawnChildArguments`, `SpawnChildOptions`, `UntypedSpawnChildOptions`, `SpawnOptions`, `SpawnAction`, `SpawnActionOptions` |
| stopChild | `StopChild`, `StopAllChildren`, `StopChildTarget`, `StopAction` |
| enqueueActions | `EnqueueActions`, `EnqueueActionsArg`, `EnqueueActionsDefinition`, `CollectActions`, `ActionEnqueuer`, `EnqueueActionsAction` |

### Example

```ts
import { createMachine } from "@jambudipa/xstate-effect"
import { assign, raise, type Assignment } from "@jambudipa/xstate-effect/actions"

type Context = { count: number }
type Event = { type: "INC" } | { type: "CHANGED" }

const increment: Assignment<Context, Event> = { count: ({ context }) => context.count + 1 }

export const machine = createMachine({
  types: {} as { context: Context; events: Event },
  context: { count: 0 },
  on: { INC: { actions: [assign(increment), raise({ type: "CHANGED" })] } }
})
```

## actors

`@jambudipa/xstate-effect/actors`, built from `src/actors/index.ts`.

### Values

| Values | Reference |
|---|---|
| `fromPromise` | [fromPromise](./actors/from-promise.md) |
| `fromCallback` | [fromCallback](./actors/from-callback.md) |
| `fromTransition`, `fromTransitionWithInput` | [fromTransition and fromTransitionWithInput](./actors/from-transition.md) |
| `fromObservable`, `fromEventObservable` | [fromObservable and fromEventObservable](./actors/from-observable.md) |
| `fromStream` | [fromStream](./actors/from-stream.md) |
| `fromEffect`, `fromEffectBackground`, `fromEffectRetry` | [fromEffect, fromEffectBackground and fromEffectRetry](./actors/from-effect.md) |
| `createEmptyActor` | [Custom actor logic and createEmptyActor](./actors/custom-logic.md) |

`fromEffectRetry` is in this entry point only. The root holds the other values.

### Types

| Module | Types |
|---|---|
| fromPromise | `PromiseActorLogic`, `PromiseActorRef`, `PromiseSnapshot`, `PromiseActorInput` |
| fromCallback | `CallbackActorLogic`, `CallbackActorRef`, `CallbackSnapshot`, `CallbackLogicFunction`, `CallbackActorArgs` |
| fromTransition | `TransitionActorLogic`, `TransitionActorRef`, `TransitionSnapshot`, `TransitionActorScope` |
| fromObservable, fromStream | `ObservableActorLogic`, `ObservableActorRef`, `ObservableSnapshot`, `ObservableActorArgs`, `Observer`, `Subscribable`, `StreamActorArgs` |
| fromEffect | `EffectActorLogic`, `EffectActorRef`, `EffectSnapshot`, `EffectActorArgs` |

### Example

```ts
import { Effect, Schedule } from "effect"
import { fromEffectRetry } from "@jambudipa/xstate-effect/actors"

export const load = fromEffectRetry(
  ({ input }: { readonly input: { readonly id: string } }) => Effect.succeed(`item ${input.id}`),
  Schedule.recurs(3)
)
```

## guards

`@jambudipa/xstate-effect/guards`, built from `src/guards/index.ts`.

### Values

| Values | Reference |
|---|---|
| `and`, `or`, `not` | [Guards](./guards.md) |
| `stateIn`, `stateNotIn` | [Guards](./guards.md) |
| `evaluateGuard` | [Guards](./guards.md) |

`evaluateGuard` is in this entry point only. The root holds the other values.

### Types

`Guard`, `GuardArgs`, `GuardPredicate`, `UnknownGuard`, `And`, `Or`, `Not`.

### Example

```ts
import { createMachine } from "@jambudipa/xstate-effect"
import { and, not, stateIn } from "@jambudipa/xstate-effect/guards"

export const machine = createMachine({
  types: {} as { context: { ready: boolean }; events: { type: "GO" } },
  context: { ready: true },
  type: "parallel",
  states: {
    light: { initial: "green", states: { green: {}, red: {} } },
    car: {
      initial: "waiting",
      states: {
        waiting: {
          on: { GO: { guard: and([stateIn({ light: "green" }), not(({ context }) => !context.ready)]), target: "moving" } }
        },
        moving: {}
      }
    }
  }
})
```

## graph

`@jambudipa/xstate-effect/graph`, built from `src/graph/index.ts`. Every export is in this entry
point only. The traversals return Effects; the functions that walk the state node tree or a
built map are synchronous.

### Values

| Group | Values |
|---|---|
| Test models | `createTestModel`, `TestModel` |
| Paths | `getShortestPaths`, `getSimplePaths`, `getPathsFromEvents`, `joinPaths`, `createShortestPathsGen`, `createSimplePathsGen` |
| Adjacency | `getAdjacencyMap`, `adjacencyMapToArray` |
| State node tree | `getStateNodes`, `toDirectedGraph`, `serializeSnapshot` |
| Errors | `TraversalLimitError`, `JoinPathsError`, `InvalidEventSequenceError`, `UnsupportedTestMachineError` |

This `getStateNodes(stateNode | machine)` is synchronous and gives every state node below the
argument. The root `getStateNodes(stateNode, stateValue)` is a different function: it returns
an Effect of the state nodes that a state value names.

### Types

`AdjacencyMap`, `AdjacencyValue`, `AnyStateNode`, `DirectedGraphEdge`, `DirectedGraphNode`,
`EventExecutor`, `PathGenerator`, `SerializationConfig`, `SerializedEvent`, `SerializedSnapshot`,
`StatePath`, `StatePlanMap`, `Step`, `Steps`, `TestMeta`, `TestModelOptions`, `TestParam`,
`TestPath`, `TestPathResult`, `TestStepResult`, `TraversalConfig`, `TraversalError`,
`TraversalOptions`, `VisitedContext`.

See [Graph and model-based testing](./graph.md).

### Example

```ts
import { Effect } from "effect"
import { createMachine } from "@jambudipa/xstate-effect"
import { getShortestPaths } from "@jambudipa/xstate-effect/graph"

const machine = createMachine({
  types: {} as { events: { type: "NEXT" } },
  initial: "a",
  states: { a: { on: { NEXT: "b" } }, b: {} }
})

export const pathCount = Effect.map(getShortestPaths(machine), (paths) => paths.length) // 2
```

## dev

`@jambudipa/xstate-effect/dev`, built from `src/dev/index.ts`. Every export is in this entry
point only. The functions return Effects, so nothing runs at import.

| Export | Kind | Description |
|---|---|---|
| `getGlobal` | function | `Effect<Option<typeof globalThis>>`: `globalThis`, else `self`, `window` or `global`. |
| `registerService` | function | Registers an actor with the global `__xstate__` hook, where a `window` object and the hook exist. |
| `devToolsAdapter` | function | The adapter that `createActor(logic, { devTools: true })` calls at `start`. |
| `DevToolsError` | class | The error of `registerService` and `devToolsAdapter` when the hook's `register` throws or is missing. |
| `XStateDevInterface` | type | The shape of the `__xstate__` hook. |

See [Dev tools entry point](./dev.md).

### Example

```ts
import { Effect, Option } from "effect"
import { getGlobal } from "@jambudipa/xstate-effect/dev"

export const hasGlobal = Effect.map(getGlobal(), Option.isSome) // true
```

## Related pages

- [How to port XState code to this package](../how-to/migrate-from-xstate.md)
- [How this package differs from XState](../explanation/differences-from-xstate.md)
- [XState type names](./upstream-type-names.md)
