---
title: createMachine and the machine
doc-type: reference
sources: [packages/core/src/StateMachine.ts, packages/core/src/Types.ts]
---

# createMachine and the machine

> **TL;DR:** `createMachine(config, implementations?)` builds a state machine: an actor logic
> whose snapshots are machine snapshots. It never throws: a definition error in the config fails
> each Effect that computes a snapshot of the machine. Each machine member that can fail or run
> user code returns an Effect. `StateMachine` is the class of every machine.

All the items below are exported from `@jambudipa/xstate-effect`. For machines built with
`setup(...).createMachine`, see [setup and setupWithSchema](./setup.md).

## Summary

| Item | Kind | Description |
|---|---|---|
| [`createMachine`](#createmachine) | function | Builds a machine from a config, typed by the config's `types` member. |
| [Machine config](#machine-config) | `MachineConfig` | The members of the config that `createMachine` takes. |
| [`types`](#the-types-member) | `MachineTypes` | The type-only member that declares the machine's types. |
| [Implementations](#implementations) | `MachineImplementations` | The named actions, guards, actors and delays of a machine. |
| [The machine](#the-machine) | `StateMachine.StateMachine` | The object that `createMachine` returns, and its properties. |
| [`machine.provide`](#machineprovide) | method | A new machine with other implementations. |
| [`machine.withContext`](#machinewithcontext) | method | A new machine with another context. |
| [`machine.withId`](#machinewithid) | method | A new machine with another id. |
| [`machine.getStateNodeById`](#machinegetstatenodebyid) | method | The state node that an id names. |
| [`machine.resolveState`](#machineresolvestate) | method | The snapshot of a state value. |
| [`machine.getInitialSnapshot`](#machinegetinitialsnapshot) | method | The initial snapshot for an input. |
| [`machine.transition`](#machinetransition) | method | The next snapshot for an event. |
| [`machine.microstep`](#machinemicrostep) | method | The snapshot after each microstep of an event. |
| [`machine.getTransitionData`](#machinegettransitiondata) | method | The transitions that an event selects. |
| [`machine.getPersistedSnapshot`](#machinegetpersistedsnapshot) | method | The persisted form of a snapshot. |
| [`machine.restoreSnapshot`](#machinerestoresnapshot) | method | A snapshot from its persisted form. |
| [`machine.start`](#machinestart) | method | Starts the active children of a snapshot. |
| [`StateMachine`](#statemachine-class) | class | The class of every machine. |
| [`makeStateMachine`](#makestatemachine) | function | Builds a machine from a config, without the `types` member. |
| [`isStateMachine`](#isstatemachine) | function | Checks whether a value is a machine. |
| [`StateMachineTypeId`](#statemachinetypeid) | symbol | The brand of every machine. |
| [Machine types](#machine-types) | types | `AnyStateMachine`, the `StateMachine` type forms and their extractors. |
| [Machine errors](#machine-errors) | — | The errors that the machine's Effects fail with. |

## createMachine

Builds a state machine from a config and its optional implementations.

### Signature

```ts
import type {
  AnyEventObject,
  EventObject,
  MachineConfig,
  MachineContext,
  MachineTypes,
  ParameterizedObject,
  ProvidedActor,
  StateMachine,
  StateSchema,
  StateValue,
  ToChildren,
  Types
} from "@jambudipa/xstate-effect"

// Simplified: the config's type also takes the declared names, and the returned machine's
// `provide` takes the declared implementations
export declare function createMachine<
  TContext extends MachineContext,
  TEvent extends EventObject = AnyEventObject,
  TInput = unknown,
  TOutput = unknown,
  TEmitted extends EventObject = EventObject,
  R = never,
  TStateMeta = unknown,
  TTransitionMeta = TStateMeta,
  TAction extends ParameterizedObject = ParameterizedObject,
  TGuard extends ParameterizedObject = ParameterizedObject,
  TDelay extends string = string,
  TActor extends ProvidedActor = ProvidedActor,
  TTag extends string = string
>(
  config: MachineConfig<TContext, TEvent, TInput, TOutput, TStateMeta, TTransitionMeta> & {
    readonly types?: MachineTypes<
      TContext, TEvent, TInput, TOutput, TEmitted, TStateMeta, TTransitionMeta,
      TAction, TGuard, TDelay, TActor, TTag
    >
  },
  implementations?: Types.DeclaredImplementations<TContext, TEvent, TAction, TGuard, TDelay, TActor>
): StateMachine.StateMachine<
  string, TContext, TEvent, TInput, TOutput, TEmitted, R, TStateMeta, TTransitionMeta,
  StateSchema, Types.DeclaredImplementations<TContext, TEvent, TAction, TGuard, TDelay, TActor>,
  StateValue, ToChildren<TActor>, TTag
>
```

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `config` | [`MachineConfig`](#machine-config) with an optional [`types`](#the-types-member) member | yes | The root state node config, with the machine-level members. |
| `implementations` | [`Types.DeclaredImplementations`](#implementations) | no | The named actions, guards, actors and delays that the config uses. Defaults to `{}`. |

### Type parameters

| Type parameter | Default | Source |
|---|---|---|
| `TContext` | inferred | `types.context`, else the `context` value. A machine that declares no context has the context `MachineContext` (`Record<string, any>`). |
| `TEvent` | `AnyEventObject` | `types.events`. |
| `TInput` | `unknown` | `types.input`. |
| `TOutput` | `unknown` | `types.output`. |
| `TEmitted` | `EventObject` | `types.emitted`. |
| `R` | `never` | Never inferred: only an explicit type argument sets it. The Effects of the config's actions and of `implementations` add nothing. A [`setup`](./setup.md#requirements) machine infers them, and [`provide`](#machineprovide) adds the services of what it is given. |
| `TStateMeta` | `unknown` | `types.meta`. |
| `TTransitionMeta` | `TStateMeta` | `types.transitionMeta`. |
| `TAction`, `TGuard`, `TDelay`, `TActor` | any name | `types.actions`, `types.guards`, `types.delays`, `types.actors`. |
| `TTag` | `string` | `types.tags`. |

### Returns

A [machine](#the-machine). Its event type is `TEvent`. Its `provide` takes the declared
implementations, or any name while `types` declares no actions, guards, delays or actors. Its
snapshots' `children` hold an optional reference under each literal child id that `types.actors`
declares (`ToChildren<TActor>`).

### Errors

`createMachine` never throws. The machine keeps the first definition error of its config, in
this order, and each Effect that computes a snapshot fails with it (see
[Machine errors](#machine-errors)):

1. A compound state without `initial`, the deepest first.
2. In each state node's transitions, in document order: a target that names no state, a legacy
   `cond` member, or the empty event key in `on`. Route transitions get the same checks.
3. A history state whose `target` names no state.

### Example

```ts
import { Effect } from "effect"
import { assign, createActor, createMachine } from "@jambudipa/xstate-effect"

export const toggle = createMachine({
  types: {} as {
    context: { count: number }
    events: { type: "TOGGLE" }
  },
  id: "toggle",
  initial: "off",
  context: { count: 0 },
  states: {
    off: { on: { TOGGLE: { target: "on", actions: assign({ count: ({ context }) => context.count + 1 }) } } },
    on: { on: { TOGGLE: "off" } }
  }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(toggle)
  yield* actor.start
  yield* actor.send({ type: "TOGGLE" })
  const snapshot = yield* actor.getSnapshot
  console.log(snapshot.value, snapshot.context.count) // on 1
})

void Effect.runPromise(Effect.scoped(program))
```

## Machine config

The config is the root state node config (`StateNodeConfig`) with the machine-level members
(`MachineConfigMembers`) and `context`. A child state config in `states` takes the same members,
except the machine-level ones.

### Machine-level members

| Member | Type | Default | Description |
|---|---|---|---|
| `id` | `string` | `"(machine)"` | The machine id. The state ids start with it (`(machine).a`). The empty string gives `"(machine)"`. |
| `types` | [`MachineTypes`](#the-types-member) | — | Type only. `createMachine` reads no value from it; `machine.config` keeps it. |
| `context` | `TContext \| ContextFactory` | `{}` | The initial context. Optional while the context type is not declared; required once `types.context` declares it. A falsy value gives `{}`. |
| `output` | `TOutput \| (args: { context, event, self }) => TOutput` | — | The machine output when a top-level final state is reached. The mapper gets the `xstate.done.state.*` event that completes the machine. |
| `options` | `MachineOptions` | `{ maxIterations: Infinity }` | `maxIterations` limits the loop iterations of one macrostep. The iteration that finds the macrostep stable counts too. |
| `version` | `string` | — | Read back as `machine.version`. |
| `schemas` | `unknown` | — | Carried as given, read back as `machine.schemas`. |

### Context factory

A function `context` is a `ContextFactory`. The machine calls it once for each actor, when the
actor is created, with this argument:

| Member | Type | Description |
|---|---|---|
| `input` | `TInput` | The actor's `input` option. |
| `spawn` | `Spawner` | A synchronous spawn. Its children join the initial snapshot and start with the actor. |
| `self` | `ActorRef` | The machine actor. |

A value that the factory throws gives the initial snapshot the status `error`.

### State node members

| Member | Type | Description |
|---|---|---|
| `type` | `"atomic" \| "compound" \| "parallel" \| "final" \| "history"` | The node kind. Without it, a node with `states` is `compound`, a node with a truthy `history` is `history`, and any other node is `atomic`. |
| `initial` | `string \| InitialTransitionConfig` | The initial child key, or `{ target, actions?, meta?, description? }`. Required on a compound node. |
| `states` | `Record<string, StateNodeConfig>` | The child state configs by key. |
| `on` | `TransitionsConfig` | For each event descriptor (`"TYPE"`, `"mouse.*"`, `"*"`): a transition config, a target string, or a list of them. `undefined` is a forbidden transition. |
| `always` | transition config, target string, or list | Eventless transitions. |
| `after` | `DelayedTransitionsConfig` | Delayed transitions. A key that reads as a number is milliseconds; any other key names a delay. |
| `onDone` | transition config, target string, or list | The transition on `xstate.done.state.<node id>`. |
| `entry` | `Action \| ReadonlyArray<Action>` | The entry actions. |
| `exit` | `Action \| ReadonlyArray<Action>` | The exit actions. |
| `invoke` | `InvokeConfig \| ReadonlyArray<InvokeConfig>` | The actors that the state invokes: `src`, `id`, `systemId`, `input`, `onDone`, `onError`, `onSnapshot`. |
| `tags` | `TTag \| ReadonlyArray<TTag>` | The state's tags. |
| `meta` | `TStateMeta` | The node metadata, read by `snapshot.getMeta()`. |
| `description` | `string` | A note for people and tools. The engine never reads it. |
| `output` | value or mapper | The output of a final state, in the parent's `xstate.done.state.<parent id>` event. |
| `history` | `"shallow" \| "deep" \| boolean` | The history kind of a history state. `true` is `"shallow"`. |
| `target` | `string` | The default target of a history state. |
| `id` | `string` | A custom node id, used in `#id` targets. |
| `route` | `RouteTransitionConfig` | Makes a node with an explicit `id` routable: the machine takes `{ type: "xstate.route", to: "#<id>" }`. |

### Transition config members

| Member | Type | Default | Description |
|---|---|---|---|
| `target` | `string \| ReadonlyArray<string>` | none | A sibling key, `.child`, or `#id`. No target, or `""`, gives a targetless transition. |
| `guard` | `Guard` | — | A guard name, `{ type, params }`, an inline predicate, or a guard definition. See [Guards](./guards.md). |
| `actions` | `Action \| ReadonlyArray<Action>` | — | An action name, `{ type, params }`, an inline function, or an action definition. |
| `reenter` | `boolean` | `false` | Whether the source exits and enters again when every target is the source or below it. |
| `description` | `string` | — | Kept on the transition definition. |
| `meta` | `TTransitionMeta` | — | Kept on the transition definition. |

## The types member

`types` declares the machine's types. It carries no value: write it as
`types: {} as { ... }`. Every member is optional.

| Member | Declares |
|---|---|
| `context` | The context type. The config's `context` must fit it. |
| `events` | The union of the events that the machine takes. Without it, the event type is `AnyEventObject`. |
| `input` | What the `input` option of `createActor` and the context factory take. |
| `output` | What the machine's `output` gives; `snapshot.output` holds it as an `Option`. |
| `emitted` | The events that `emit` may emit and that `actor.on` listeners receive. |
| `actions` | The named actions as `{ type, params }`. The config and the implementations take only these names. |
| `guards` | The named guards as `{ type, params }`, as for `actions`. |
| `delays` | The delay names, as a string union. |
| `actors` | The named actors as `{ src, logic, id? }`. A literal `id` types the snapshot's child under that id. |
| `tags` | The tags that the state configs may set and that `snapshot.hasTag` takes. |
| `meta` | The type of each state node's `meta`, and of each transition's `meta` when `transitionMeta` is absent. |
| `transitionMeta` | The type of each transition's `meta`. |
| `children` | Not declarable (type `never`). |

```ts
import { createMachine } from "@jambudipa/xstate-effect"

export const counter = createMachine({
  types: {} as {
    context: { count: number }
    events: { type: "INC"; by: number } | { type: "RESET" }
    input: { start: number }
    output: number
    tags: "busy"
  },
  context: ({ input }) => ({ count: input.start }),
  initial: "active",
  states: {
    active: {
      tags: "busy",
      on: { RESET: "done" }
    },
    done: { type: "final" }
  },
  output: ({ context }) => context.count
})
```

## Implementations

The second argument of `createMachine` and the argument of `provide`. Each record is optional.

| Record | Value type | Behaviour for a name without an implementation |
|---|---|---|
| `actions` | A function `({ context, event, self, system }, params) => unknown`, or an action definition | The use runs nothing. A returned Effect runs. |
| `guards` | A predicate `({ context, event }, params) => boolean \| Effect<boolean>`, a guard definition, or another guard's name or `{ type, params }` | The evaluation fails with `GuardError`. |
| `actors` | Any actor logic | An `invoke` of the name logs a warning and starts nothing. |
| `delays` | Milliseconds, a `Duration`, or a function of the action arguments and params | The name gives no delay: the event is raised or sent at once. |

While `types` declares no names of a kind, that record takes any name. Once `types` declares
them, the record takes only those names, each with the params type of its uses.

```ts
import { createMachine } from "@jambudipa/xstate-effect"

export const machine = createMachine(
  {
    types: {} as {
      context: { count: number }
      events: { type: "INC"; by: number }
      actions: { type: "track"; params: { by: number } }
      guards: { type: "belowMax" }
    },
    context: { count: 0 },
    on: {
      INC: { guard: "belowMax", actions: { type: "track", params: ({ event }) => ({ by: event.by }) } }
    }
  },
  {
    actions: { track: (_, params) => console.log(params.by) },
    guards: { belowMax: ({ context }) => context.count < 10 }
  }
)
```

## The machine

The machine is an `ActorLogic` whose snapshot is a `MachineSnapshot`, so `createActor`, the
[pure transition functions](./testing/get-next-snapshot.md) and the [graph functions](./graph.md)
take it. Its type is `StateMachine.StateMachine<Id, TContext, TEvent, TInput, TOutput, TEmitted,
R, TStateMeta, TTransitionMeta, TStateSchema, TProvided, TStateValue, TChildren, TTag>`.

### Properties

| Property | Type | Description |
|---|---|---|
| `id` | `Id` (`string`) | The machine id; `"(machine)"` when the config gives none. |
| `root` | `StateNode` | The root state node. See [State nodes](./state-nodes.md). |
| `states` | `Record<string, StateNode>` | The root's child state nodes, in config order. |
| `events` | `ReadonlyArray<string>` | The event descriptors that the machine takes, each once, in document order. A forbidden transition alone does not count. |
| `version` | `string \| undefined` | The config's `version`. |
| `schemas` | `unknown` | The config's `schemas`. |
| `definition` | `StateNode.Definition` | The root's definition: the machine's JSON-ready form. |
| `toJSON()` | `StateNode.Definition` | Gives `definition`. |
| `idMap` | `HashMap<string, StateNode>` | The state nodes by id. |
| `stateIds` | `ReadonlyArray<string>` | Every state node id, in document order. |
| `implementations` | `MachineImplementations` | The machine's implementations; `{}` when none were given. |
| `options` | `MachineOptions` | The config's `options` over the defaults. |
| `config` | `MachineConfig` | The config as given. |

### Example

```ts
import { createMachine } from "@jambudipa/xstate-effect"

export const machine = createMachine({
  initial: "a",
  states: { a: { on: { GO: "b" } }, b: { type: "final" } }
})

console.log(machine.id) // (machine)
console.log(machine.stateIds) // ["(machine)", "(machine).a", "(machine).b"]
console.log(machine.events) // ["GO"]
console.log(machine.options) // { maxIterations: Infinity }
```

## machine.provide

A new machine with the same config. For each of `actions`, `guards`, `actors` and `delays`, the
new implementations are `{ ...old, ...provided }`. The original machine does not change.

### Signature

`provide<const TGiven extends TProvided>(implementations: TGiven): StateMachine.StateMachine<Id, TContext, TEvent, TInput, TOutput, TEmitted, R | Types.ImplementationsRequirementsOf<TGiven>, TStateMeta, TTransitionMeta, TStateSchema, TProvided, TStateValue, TChildren, TTag>`


### Parameters

| Parameter | Type | Description |
|---|---|---|
| `implementations` | `TGiven`, which must fit `TProvided` | For a machine from `createMachine`: the [implementations](#implementations) that its `types` declare, or any name. For a setup machine: only the setup's names, and for an actor a logic of the type of the setup's logic of that name. |

### Returns

A machine of the same type, except for its requirements: `R` with the services that the given
implementations need (`Types.ImplementationsRequirementsOf<TGiven>`). Those are what the Effect
of each given action requires (for an action definition, the Effect of its `exec`) and the
requirements of each given actor logic. This holds for a machine from `createMachine` and for a
setup machine. A machine of `setupWithSchema` keeps its
[run-time checks](./setup.md#run-time-checks).

### Example

```ts
import { Context, Effect, type Scope } from "effect"
import { createActor, createMachine } from "@jambudipa/xstate-effect"

class Tracker extends Context.Service<Tracker, {
  readonly track: (id: number) => Effect.Effect<void>
}>()("app/Tracker") {}

const machine = createMachine({
  types: {} as { actions: { type: "track"; params: { id: number } } },
  entry: { type: "track", params: { id: 1 } }
})

export const tested = machine.provide({
  actions: {
    track: (_, params) =>
      Effect.gen(function* () {
        const tracker = yield* Tracker
        yield* tracker.track(params.id)
      })
  }
})

// The given action's Effect needs Tracker, so creating the actor needs Tracker too
export const created: Effect.Effect<unknown, never, Scope.Scope | Tracker> = createActor(tested)
```

## machine.withContext

A new machine with the same config and another `context`.

### Signature

`withContext<TNewContext extends MachineContext>(context: TNewContext | ContextFactory<TNewContext, ProvidedActor, TInput, TEvent>): StateMachine.StateMachine<Id, TNewContext, TEvent, TInput, TOutput, TEmitted, R, …, MachineImplementations<TNewContext, TEvent>, …>`


### Parameters

| Parameter | Type | Description |
|---|---|---|
| `context` | `TNewContext \| ContextFactory<TNewContext, ProvidedActor, TInput, TEvent>` | A context value, or a [context factory](#context-factory): a function of `{ input, spawn, self }` that the new machine calls once for each actor, as it calls the config's `context` function. |

### Returns

A machine whose context type is `TNewContext`. Its `provide` takes any name. A machine of
`setupWithSchema` keeps its [run-time checks](./setup.md#run-time-checks), so the new context
must still match the context schema.

### Example

```ts
import { createMachine } from "@jambudipa/xstate-effect"

const machine = createMachine({
  types: {} as { context: { count: number }; input: { readonly start: number } },
  context: { count: 0 }
})

export const fromTen = machine.withContext({ count: 10 })

// The factory gets the actor's input, as the config's context function does
export const fromInput = machine.withContext(({ input }) => ({ count: input.start }))
```

## machine.withId

A new machine with the same config and another id. The state ids change with it. A machine of
`setupWithSchema` keeps its [run-time checks](./setup.md#run-time-checks).

### Signature

`withId<TNewId extends string>(id: TNewId): StateMachine.StateMachine<TNewId, TContext, TEvent, …>`


### Parameters

| Parameter | Type | Description |
|---|---|---|
| `id` | `TNewId` | The new machine id. |

### Returns

A machine whose `Id` type parameter is `TNewId`.

### Example

```ts
import { createMachine } from "@jambudipa/xstate-effect"

const machine = createMachine({ initial: "a", states: { a: {} } })

export const other = machine.withId("other") // stateIds: ["other", "other.a"]
```

## machine.getStateNodeById

The state node that an id names: a custom id or a full id, with or without `#`, then an optional
key path below that node (`#id.child`).

### Signature

`getStateNodeById(id: string): Effect<StateNode<TContext, TEvent, TStateMeta, TTransitionMeta>, StateNodeNotFoundError>`


### Parameters

| Parameter | Type | Description |
|---|---|---|
| `id` | `string` | The state node id, with an optional key path. |

### Returns

An Effect that succeeds with the state node.

### Errors

| Error | When |
|---|---|
| `StateNodeNotFoundError` | The id or the path names no node. The message is `Child state node '#<id>' does not exist on machine '<machine id>'`, or `Child state '<key>' does not exist on '<id>'` for a path. |

### Example

```ts
import { Effect } from "effect"
import { createMachine } from "@jambudipa/xstate-effect"

const machine = createMachine({ initial: "a", states: { a: { id: "first" } } })

export const nodeId = Effect.map(machine.getStateNodeById("#first"), (node) => node.id) // "first"
```

## machine.resolveState

The snapshot of a state value. A partial value is completed to a full configuration: a compound
state enters its initial child, a parallel state enters every region, and a `#id` key names the
node with that id.

### Signature

`resolveState(config: StateMachine.StateMachine.ResolveStateConfig<TContext, TOutput>): Effect<MachineSnapshot<TContext, …>, MachineDefinitionError>`


### Parameters

| Member of `config` | Type | Default | Description |
|---|---|---|---|
| `value` | `StateValue` | required | The state value; it may be partial. |
| `context` | `TContext` | `{}` | The snapshot's context. A falsy value gives `{}`. |
| `historyValue` | `HistoryValue` | `{}` | Kept as given. |
| `status` | `SnapshotStatus` | `"active"` | The status when the completed value is not final. A final value gives `"done"`. |
| `output` | `TOutput` | `Option.none()` | The snapshot's output, as an `Option`. |
| `error` | `unknown` | `Option.none()` | The snapshot's error, as an `Option`. |

### Returns

An Effect that succeeds with the machine snapshot. The snapshot has no children.

### Errors

| Error | When |
|---|---|
| `MachineDefinitionError` | The value names no state, or the config has a definition error. |

### Example

```ts
import { Effect } from "effect"
import { createMachine } from "@jambudipa/xstate-effect"

const machine = createMachine({
  initial: "a",
  states: { a: { initial: "one", states: { one: {} } }, b: {} }
})

export const value = Effect.map(machine.resolveState({ value: "a" }), (snapshot) => snapshot.value) // { a: "one" }
```

## machine.getInitialSnapshot

The initial snapshot for an input. It runs the context factory and the initial actions, so it
needs the `ActorScope` service. `createActor`, `getInitialSnapshot` and `initialTransition`
provide that service; see [Pure transition functions](./testing/get-next-snapshot.md).

### Signature

`getInitialSnapshot(input: TInput): Effect<MachineSnapshot<TContext, TEvent, …>, InitializationError, ActorScope | R>`


### Parameters

| Parameter | Type | Description |
|---|---|---|
| `input` | `TInput` | The input that the context factory receives. |

### Returns

An Effect that succeeds with the initial snapshot. When the context factory, an initial action or
an initial guard throws, the snapshot has the status `error` and the thrown value as `error`. A
machine of `setupWithSchema` gives that snapshot too when its input, its initial context or its
initial output does not match its schema, with the `SchemaError` as `error`.

### Errors

| Error | When |
|---|---|
| `InitializationError` | The config has a definition error, or an `initial` key names no child. Its `cause` is the `MachineDefinitionError`. |

### Example

```ts
import { Effect } from "effect"
import { createMachine, getInitialSnapshot } from "@jambudipa/xstate-effect"

const machine = createMachine({ initial: "idle", states: { idle: {} } })

export const initialValue = Effect.map(getInitialSnapshot(machine), (snapshot) => snapshot.value) // "idle"
```

## machine.transition

The next snapshot of a snapshot for an event: one macrostep. It runs guards and actions, so it
needs the `ActorScope` service. `getNextSnapshot` and `transition` from the root entry point
provide it; see [Pure transition functions](./testing/get-next-snapshot.md).

### Signature

`transition(snapshot: MachineSnapshot<TContext, TEvent, …>, event: TEvent): Effect<MachineSnapshot<TContext, TEvent, …>, TransitionError, ActorScope | R>`


### Parameters

| Parameter | Type | Description |
|---|---|---|
| `snapshot` | `MachineSnapshot` | A snapshot of this machine. |
| `event` | `TEvent` | The event to process. |

### Returns

An Effect that succeeds with the next snapshot.

### Errors

| Error | When |
|---|---|
| `TransitionError` | The config has a definition error (its `cause` is the `MachineDefinitionError`), or the macrostep fails, for example past `options.maxIterations`. |

A machine of `setupWithSchema` dies with the `SchemaError` when the event, or the context or the
output of the next snapshot, does not match its schema; see
[Run-time checks](./setup.md#run-time-checks).

### Example

```ts
import { Effect } from "effect"
import { createMachine, getInitialSnapshot, getNextSnapshot } from "@jambudipa/xstate-effect"

const machine = createMachine({
  types: {} as { events: { type: "GO" } },
  initial: "a",
  states: { a: { on: { GO: "b" } }, b: {} }
})

export const next = Effect.gen(function* () {
  const initial = yield* getInitialSnapshot(machine)
  const snapshot = yield* getNextSnapshot(machine, initial, { type: "GO" })
  return snapshot.value // "b"
})
```

## machine.microstep

The snapshot after each microstep of the macrostep that processes an event, in order. An event
that selects no transition gives one microstep with the snapshot unchanged. It needs the
`ActorScope` service, as `transition` does.

### Signature

`microstep(snapshot: MachineSnapshot<TContext, TEvent, …>, event: TEvent): Effect<ReadonlyArray<MachineSnapshot<TContext, TEvent, …>>, TransitionError, ActorScope | R>`


### Parameters

| Parameter | Type | Description |
|---|---|---|
| `snapshot` | `MachineSnapshot` | A snapshot of this machine. |
| `event` | `TEvent` | The event to process. |

### Returns

An Effect that succeeds with the list of snapshots, one for each microstep.

### Errors

The same as [`machine.transition`](#machinetransition), except that a machine of
`setupWithSchema` checks only the event, not the snapshots of the microsteps.

### Example

`getMicrosteps(machine, snapshot, event)` from the root entry point gives each microstep with
its actions and needs no `ActorScope`; see [Pure transition functions](./testing/get-next-snapshot.md).

## machine.getTransitionData

The transition definitions that an event selects in a snapshot, in selection order: one for
each node that takes the event, a forbidden transition included. Guards run with an inert actor
scope; no action runs.

### Signature

`getTransitionData(snapshot: MachineSnapshot<TContext, TEvent, …>, event: TEvent): Effect<ReadonlyArray<TransitionDefinition<TContext, TEvent, TTransitionMeta>>, GuardError | MachineDefinitionError>`


### Parameters

| Parameter | Type | Description |
|---|---|---|
| `snapshot` | `MachineSnapshot` | A snapshot of this machine. |
| `event` | `TEvent` | The event to select transitions for. |

### Returns

An Effect that succeeds with the selected transition definitions; an empty list when no node
takes the event.

### Errors

| Error | When |
|---|---|
| `GuardError` | A guard throws, or a guard name has no implementation. |
| `MachineDefinitionError` | The config has a definition error. |

### Example

```ts
import { Effect } from "effect"
import { createMachine, getInitialSnapshot } from "@jambudipa/xstate-effect"

const machine = createMachine({
  types: {} as { events: { type: "GO" } },
  initial: "a",
  states: { a: { on: { GO: "b" } }, b: {} }
})

export const selected = Effect.gen(function* () {
  const snapshot = yield* getInitialSnapshot(machine)
  const transitions = yield* machine.getTransitionData(snapshot, { type: "GO" })
  return transitions.length // 1
})
```

## machine.getPersistedSnapshot

The persisted form of a snapshot, through the persisted-snapshot codec: children, tags, history
ids and actor references in the context included. See [Persisted snapshots](./persistence.md).

### Signature

`getPersistedSnapshot(snapshot: MachineSnapshot<TContext, TEvent, …>): Effect<unknown, SerializationError>`


### Parameters

| Parameter | Type | Description |
|---|---|---|
| `snapshot` | `MachineSnapshot` | A snapshot of this machine. |

### Returns

An Effect that succeeds with the persisted value.

### Errors

| Error | When |
|---|---|
| `SerializationError` | The codec cannot encode the snapshot. |

### Example

```ts
import { Effect } from "effect"
import { createMachine, getInitialSnapshot } from "@jambudipa/xstate-effect"

const machine = createMachine({ initial: "idle", states: { idle: {} } })

export const persisted = Effect.flatMap(getInitialSnapshot(machine), machine.getPersistedSnapshot)
```

## machine.restoreSnapshot

A snapshot from its persisted form, through the persisted-snapshot codec. A live machine
snapshot is read as it is. It creates the persisted children, not started, so it needs the
`ActorScope` service; `createActor` with the `snapshot` option calls it. See
[Persisted snapshots](./persistence.md).

### Signature

`restoreSnapshot(persisted: unknown): Effect<MachineSnapshot<TContext, TEvent, …>, RestoreError, ActorScope | R>`


### Parameters

| Parameter | Type | Description |
|---|---|---|
| `persisted` | `unknown` | A persisted snapshot, or a live machine snapshot. |

### Returns

An Effect that succeeds with the restored snapshot. A persisted child whose `src` names no
implementation is left out. A history entry with an unknown state id is dropped with a warning.

### Errors

| Error | When |
|---|---|
| `RestoreError` | The codec rejects the value, the state value names no state, or the config has a definition error. |

### Example

```ts
import { Effect } from "effect"
import { createActor, createMachine } from "@jambudipa/xstate-effect"

const machine = createMachine({ initial: "a", states: { a: {}, b: {} } })

export const restored = Effect.gen(function* () {
  const first = yield* createActor(machine)
  const persisted = yield* first.getPersistedSnapshot
  const second = yield* createActor(machine, { snapshot: persisted })
  return second
})
```

## machine.start

Starts each active child of the snapshot that an actor starts from: the restored children, and
the children spawned while the initial snapshot was computed. A snapshot with the status `done`
starts nothing. The actor calls it at `start`.

### Signature

`start(snapshot: MachineSnapshot<TContext, TEvent, …>): Effect<void, never, ActorScope>`


### Parameters

| Parameter | Type | Description |
|---|---|---|
| `snapshot` | `MachineSnapshot` | The snapshot that the actor starts from. |

### Returns

An Effect that completes when the children have started.

### Example

`yield* actor.start` calls `machine.start`; see [createActor and the actor](./create-actor.md).

## StateMachine class

`StateMachine` is the class of every machine: `machine instanceof StateMachine` is `true` for
each machine that `createMachine`, `makeStateMachine` or `setup(...).createMachine` builds.

### Signature

`new StateMachine(config, implementations?)`: the constructor takes the arguments of
[`createMachine`](#createmachine) and gives the machine that `createMachine` gives.

### Static members

| Member | Description |
|---|---|
| `StateMachine.createMachine` | [`createMachine`](#createmachine). |
| `StateMachine.make` | [`makeStateMachine`](#makestatemachine). |
| `StateMachine.isStateMachine` | [`isStateMachine`](#isstatemachine). |
| `StateMachine.StateMachineTypeId` | [`StateMachineTypeId`](#statemachinetypeid). |
| `StateMachine.normalizeTarget` | The targets of a transition config as a list: `undefined` for no target or `""`, else the list. |

### Example

```ts
import { StateMachine, createMachine } from "@jambudipa/xstate-effect"

const machine = createMachine({ id: "light" })

export const isMachine = machine instanceof StateMachine // true
export const built = new StateMachine({ id: "door", initial: "closed", states: { closed: {} } })
export const targets = StateMachine.normalizeTarget("next") // ["next"]
```

## makeStateMachine

Builds a machine from a config and its optional implementations, as `createMachine` does. Its
config type has no `types` member and no declared names: the type parameters come from the
config or from explicit type arguments.

### Signature

```ts
import type { EventObject, MachineConfig, MachineImplementations, StateMachine } from "@jambudipa/xstate-effect"

export declare function makeStateMachine<
  TContext,
  TEvent extends EventObject,
  TInput = unknown,
  TOutput = unknown,
  TEmitted extends EventObject = EventObject,
  R = never,
  TStateMeta = unknown,
  TTransitionMeta = TStateMeta
>(
  config: MachineConfig<TContext, TEvent, TInput, TOutput, TStateMeta, TTransitionMeta>,
  implementations?: MachineImplementations<TContext, TEvent>
): StateMachine.StateMachine<string, TContext, TEvent, TInput, TOutput, TEmitted, R, TStateMeta, TTransitionMeta>
```

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `config` | `MachineConfig` | yes | The machine config, without `types`. |
| `implementations` | `MachineImplementations` | no | Any named actions, guards, actors and delays. |

### Returns

A [machine](#the-machine). `R` is `never` unless given as a type argument.

### Errors

The same definition errors as [`createMachine`](#createmachine).

### Example

```ts
import { makeStateMachine } from "@jambudipa/xstate-effect"

export const machine = makeStateMachine<{ count: number }, { type: "INC" }>({
  context: { count: 0 },
  on: { INC: { actions: () => console.log("inc") } }
})
```

## isStateMachine

Checks whether a value is a machine: whether it carries `StateMachineTypeId`.

### Signature

```ts
import type { StateMachine } from "@jambudipa/xstate-effect"

export declare function isStateMachine(u: unknown): u is StateMachine.StateMachine.Any
```

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `u` | `unknown` | Any value. |

### Returns

`true` for a machine, `false` otherwise.

### Example

```ts
import { createMachine, fromPromise, isStateMachine } from "@jambudipa/xstate-effect"

export const forMachine = isStateMachine(createMachine({})) // true
export const forPromise = isStateMachine(fromPromise(async () => 1)) // false
```

## StateMachineTypeId

The symbol `Symbol.for("@jambudipa/xstate-effect/StateMachine")`, which every machine carries as
a property key. Its type is `StateMachineTypeId`. Its value on a machine holds type-level variance
markers only.

### Example

```ts
import { StateMachineTypeId, createMachine } from "@jambudipa/xstate-effect"

export const branded = StateMachineTypeId in createMachine({}) // true
```

## Machine types

| Type | Description |
|---|---|
| `StateMachine.StateMachine<Id, TContext, TEvent, TInput, TOutput, TEmitted, R, TStateMeta, TTransitionMeta, TStateSchema, TProvided, TStateValue, TChildren, TTag>` | The machine type, the id first. Also exported as `StateMachineType`. |
| `StateMachine<TContext, TEvent, TChildren, TActor, TAction, TGuard, TDelay, TStateValue, TTag, TInput, TOutput, TEmitted, TStateMeta, TStateSchema, TTransitionMeta>` | The machine type with the XState parameter order, the context first, and no Effect requirement. Also `StateMachine.UpstreamStateMachine`. |
| `AnyStateMachine` | A structural supertype of every machine whose `R` is `never`. `createActor` and `getNextSnapshot` take it. |
| `StateMachine.StateMachine.Any` | A machine of any id, context, events, input, output and requirements. |
| `StateMachine.StateMachine.IdOf<T>` | The id type of a machine. |
| `StateMachine.StateMachine.ContextOf<T>` | The context type of a machine. |
| `StateMachine.StateMachine.EventOf<T>` | The event type of a machine. |
| `StateMachine.StateMachine.InputOf<T>` | The input type of a machine. |
| `StateMachine.StateMachine.OutputOf<T>` | The output type of a machine. |
| `StateMachine.StateMachine.EmittedOf<T>` | The emitted event type of a machine. |
| `StateMachine.StateMachine.RequirementsOf<T>` | The Effect services that a machine needs (`R`). |
| `StateMachine.StateMachine.ResolveStateConfig<TContext, TOutput>` | What [`resolveState`](#machineresolvestate) takes. |
| `StateMachine.StateMachineConstructor` | The type of the `StateMachine` class. |

```ts
import { createMachine, type StateMachine } from "@jambudipa/xstate-effect"

export const machine = createMachine({ types: {} as { context: { count: number } }, context: { count: 0 } })

export type Context = StateMachine.StateMachine.ContextOf<typeof machine> // { count: number }
```

## Machine errors

| Error | Raised by | Cause |
|---|---|---|
| `InitializationError` | `getInitialSnapshot` | A definition error in the config, or an `initial` key that names no child. |
| `TransitionError` | `transition`, `microstep` | A definition error in the config, or a failed macrostep. |
| `RestoreError` | `restoreSnapshot` | A definition error, a value that the codec rejects, or a state value that names no state. |
| `MachineDefinitionError` | `resolveState`, `getTransitionData` | A definition error in the config, or a state value that names no state. |
| `GuardError` | `getTransitionData` | A guard that throws or names no implementation. |
| `StateNodeNotFoundError` | `getStateNodeById` | An id or a path that names no node. |
| `SerializationError` | `getPersistedSnapshot` | A snapshot that the codec cannot encode. |

A definition error keeps the XState message, for example
`Initial state node "zzz" not found on parent state node #(machine)`. An actor of a machine with a
definition error gets the status `error`, with the `InitializationError` as its `error`. Each
error class is in the `Errors` namespace; see [Errors](./errors.md).

## Related pages

- [setup and setupWithSchema](./setup.md)
- [createActor and the actor](./create-actor.md)
- [Snapshots](./snapshots.md)
- [Type utilities](./type-utilities.md)
- [About state machines and statecharts](../explanation/state-machines.md)
- [Build your first state machine](../tutorials/01-first-state-machine.md)
