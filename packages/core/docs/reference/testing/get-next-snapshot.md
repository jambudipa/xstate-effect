---
title: Pure transition functions
doc-type: reference
sources: [packages/core/src/testing/getNextSnapshot.ts]
---

# Pure transition functions

> **TL;DR:** These functions compute snapshots from actor logic without creating an actor:
> `getInitialSnapshot`, `getNextSnapshot`, `initialTransition`, `transition`,
> `getInitialMicrosteps`, `getMicrosteps` and `getNextTransitions`. Each one returns an Effect.
> No action runs: `transition`, `initialTransition` and the microstep functions return the
> actions as data instead, and `assign` still computes the context. A guard that throws fails
> the Effect with `GuardError`.

All names on this page come from `@jambudipa/xstate-effect`. The root entry point also exports
them in the `testing` namespace (`testing.transition`); there is no `/testing` subpath.
`ExecutableRaiseAction` and `ExecutableSendToAction` come from the `testing` namespace only.

## Summary

### Functions

| Name | Succeeds with | Fails with | Summary |
| --- | --- | --- | --- |
| [`getInitialSnapshot`](#getinitialsnapshot) | the initial snapshot | `InitializationError` | The initial snapshot of any actor logic. |
| [`getNextSnapshot`](#getnextsnapshot) | the next snapshot | the logic's transition error, `GuardError` | The snapshot after one event. |
| [`initialTransition`](#initialtransition) | `[snapshot, actions]` | `InitializationError` | The initial snapshot and the actions of the initial transition. |
| [`transition`](#transition) | `[snapshot, actions]` | the logic's transition error, `GuardError` | The next snapshot and the actions of the transition. |
| [`getInitialMicrosteps`](#getinitialmicrosteps) | an array of `[snapshot, actions]` | `InitializationError`, `TransitionError`, `GuardError` | Each microstep of a machine's initial transition. |
| [`getMicrosteps`](#getmicrosteps) | an array of `[snapshot, actions]` | the machine's transition error, `GuardError` | Each microstep of the macrostep that processes one event. |
| [`getNextTransitions`](#getnexttransitions) | an array of transition definitions | never | Every transition that the active state nodes of a snapshot hold. |

### Types

| Name | Summary |
| --- | --- |
| [`ExecutableActionObject`](#executableactionobject) | One action as a transition returns it: `type`, `info`, `params` and `exec`. |
| [`ExecutableRaiseAction`](#executableraiseaction) | A `raise` action as a transition returns it. |
| [`ExecutableSendToAction`](#executablesendtoaction) | A `sendTo` action as a transition returns it. |
| [`ExecutableSpawnAction`](#executablespawnaction) | A `spawnChild` action as a transition returns it. |
| [`SpecialExecutableAction`](#specialexecutableaction) | `ExecutableSpawnAction \| ExecutableRaiseAction \| ExecutableSendToAction`. |
| [`ExecutableActionsFrom<TLogic>`](#executableactionsfrom) | The element type of the action arrays for a logic. |
| [`ToExecutableAction<T>`](#toexecutableaction) | The executable form of a named action type. |

## Shared behaviour

- **No actor.** Each function runs the logic's own `getInitialSnapshot` or `transition` with an
  inert actor scope. No actor and no actor system exist, and no inspection event is sent.
- **No action runs.** Custom actions and the built-in actions that do work (`raise`, `sendTo`,
  `cancel`, `emit`, `log`, `spawnChild` and `stopChild`) do not run. `getInitialSnapshot` and
  `getNextSnapshot` drop them; the other functions return them in the order that the
  transition handed them to the action executor.
- **The context still changes.** `assign` and a context factory run, so the snapshot holds the
  new context.
- **Raised events.** An event raised without a delay is processed in the same macrostep, as in
  an actor. A delayed event, an `after` timer and a send to another actor are not delivered.
- **Children.** A child that `spawnChild` or `invoke` creates appears in `snapshot.children`,
  but it never starts.
- **Guards.** Guards run. A guard that throws fails the Effect with `GuardError`. Its message
  is `Unable to evaluate guard '<guard>' in transition for event '<type>' in state node '<id>':`
  followed by the thrown message.
- **Reading the signatures.** `getNextSnapshot`, `transition` and `getMicrosteps` read four
  types from the logic's own `transition` method: its snapshot type, its event type, the
  services that it needs and the error that it fails with. The signature blocks declare this as
  `TransitionTypes<TLogic>`. The package does not export that name.
- **The types of the actions.** The action arrays name the special built-in actions and each
  action that the machine names, with the params of its uses. See
  [`ExecutableActionsFrom`](#executableactionsfrom). `initialTransition` and
  `getInitialMicrosteps` take the logic as given (`TLogic`, `TMachine`) to read those names. Their
  signature blocks declare the named actions as `NamedExecutableActions<TLogic>`, which the
  package does not export either.

## getInitialSnapshot

```ts
import type { Effect, Scope } from "effect"
import type { ActorLogic, EventObject, InitializationError, Snapshot } from "@jambudipa/xstate-effect"

export declare function getInitialSnapshot<
  TSnapshot extends Snapshot,
  TEvent extends EventObject,
  TInput,
  TEmitted extends EventObject,
  R
>(
  logic: ActorLogic<TSnapshot, TEvent, TInput, TEmitted, R>,
  ...[input]: undefined extends TInput ? [input?: TInput] : [input: TInput]
): Effect.Effect<TSnapshot, InitializationError, Exclude<R, Scope.Scope>>
```

### Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `logic` | `ActorLogic<TSnapshot, TEvent, TInput, TEmitted, R>` | A machine or any other actor logic. |
| `input` | `TInput` | The input. Optional when the input type admits `undefined`, so a machine that declares no input type takes none. Required otherwise. |

### Returns

An Effect that succeeds with the logic's initial snapshot.

**Fails with:** `InitializationError`, when the logic's own `getInitialSnapshot` fails. For a
machine, this happens for a definition error of the config and for an `initial` key that names
no child state, for example
`Initial state node "nope" not found on parent state node #bad`.

**Requires:** the services `R` of the logic, without `Scope`: the function provides and closes
a scope of its own.

### Behaviour

- What the context factory or an entry `assign` throws does not fail the Effect. The machine
  gives a snapshot with status `error`, and `snapshot.error` holds the thrown value.

### Example

```ts
import { Effect } from "effect"
import { getInitialSnapshot, setup } from "@jambudipa/xstate-effect"

const greeter = setup({
  types: {} as { context: { name: string }; input: { name: string } }
}).createMachine({
  context: ({ input }) => ({ name: input.name }),
  initial: "idle",
  states: { idle: {} }
})

export const program = Effect.gen(function* () {
  const snapshot = yield* getInitialSnapshot(greeter, { name: "Ada" })
  return snapshot.context.name // "Ada"
})
```

## getNextSnapshot

```ts
import type { Effect } from "effect"
import type { ActorScope, AnyActorLogic, EventObject, GuardError, Snapshot } from "@jambudipa/xstate-effect"

// The snapshot, event, services and error of the logic's own `transition`
type TransitionTypes<TLogic> = TLogic extends {
  readonly transition: (
    snapshot: infer TSnapshot extends Snapshot,
    event: infer TEvent extends EventObject
  ) => Effect.Effect<unknown, infer E, infer R>
}
  ? readonly [snapshot: TSnapshot, event: TEvent, requirements: R, error: E]
  : never

export declare function getNextSnapshot<TLogic extends AnyActorLogic>(
  logic: TLogic,
  snapshot: TransitionTypes<TLogic>[0],
  event: TransitionTypes<TLogic>[1]
): Effect.Effect<
  TransitionTypes<TLogic>[0],
  TransitionTypes<TLogic>[3] | GuardError,
  Exclude<TransitionTypes<TLogic>[2], ActorScope>
>
```

### Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `logic` | `TLogic extends AnyActorLogic` | A machine or any other actor logic. |
| `snapshot` | the snapshot type of the logic's `transition` | The snapshot to start from. |
| `event` | the event type of the logic's `transition` | The event to process. |

### Returns

An Effect that succeeds with the snapshot after the event's macrostep.

**Fails with:** the error of the logic's `transition`. For a machine, this is `TransitionError`
when the macrostep runs past the machine's `maxIterations`. It also fails with `GuardError`
when a guard throws.

**Requires:** the services of the logic's `transition`, without `ActorScope`.

### Behaviour

- An event that no active state node takes gives the same snapshot.
- A snapshot that is not active (`done`, `error` or `stopped`) gives the same snapshot.
- What a user function other than a guard throws, for example an `assign` assigner, is a
  defect of the Effect. The snapshot does not get status `error`.

### Example

```ts
import { Effect } from "effect"
import { assign, getInitialSnapshot, getNextSnapshot, setup } from "@jambudipa/xstate-effect"

const counter = setup({
  types: {} as { context: { count: number }; events: { type: "INCREMENT" } }
}).createMachine({
  context: { count: 0 },
  initial: "active",
  states: {
    active: {
      on: { INCREMENT: { actions: assign({ count: ({ context }) => context.count + 1 }) } }
    }
  }
})

export const program = Effect.gen(function* () {
  const initial = yield* getInitialSnapshot(counter)
  const next = yield* getNextSnapshot(counter, initial, { type: "INCREMENT" })
  return next.context.count // 1
})
```

## initialTransition

```ts
import type { Effect, Scope } from "effect"
import type {
  ActorLogic,
  AnyMachineSnapshot,
  EventObject,
  ExecutableActionsFrom,
  InitializationError,
  Snapshot,
  SpecialExecutableAction
} from "@jambudipa/xstate-effect"

// The special built-in actions for a machine, none for other logic
type ExecutableActionsOf<TSnapshot> = TSnapshot extends AnyMachineSnapshot ? SpecialExecutableAction : never

// The actions that the logic names, each with the params of its uses
type NamedExecutableActions<TLogic> = Exclude<ExecutableActionsFrom<TLogic>, SpecialExecutableAction>

export declare function initialTransition<
  TSnapshot extends Snapshot,
  TEvent extends EventObject,
  TInput,
  TEmitted extends EventObject,
  R,
  TLogic = unknown
>(
  logic: ActorLogic<TSnapshot, TEvent, TInput, TEmitted, R> & TLogic,
  ...[input]: undefined extends TInput ? [input?: TInput] : [input: TInput]
): Effect.Effect<
  readonly [
    nextSnapshot: TSnapshot,
    actions: Array<ExecutableActionsOf<TSnapshot> | NamedExecutableActions<TLogic>>
  ],
  InitializationError,
  Exclude<R, Scope.Scope>
>
```

### Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `logic` | `ActorLogic<TSnapshot, TEvent, TInput, TEmitted, R> & TLogic` | A machine or any other actor logic. `TLogic` is its type as given, which carries the names of a machine's actions. |
| `input` | `TInput` | The input. Optional when the input type admits `undefined`. |

### Returns

An Effect that succeeds with a tuple: the initial snapshot, and the actions of the initial
transition, entry actions included, in the order that they would run.

**Fails with:** `InitializationError`, as [`getInitialSnapshot`](#getinitialsnapshot) does.

**Requires:** the services `R` of the logic, without `Scope`.

### Behaviour

- The snapshot equals the one that `getInitialSnapshot` gives for the same input.
- What the context factory or an entry `assign` throws gives a snapshot with status `error`, as
  in `getInitialSnapshot`.
- For a machine, the array type names the special built-in actions (`xstate.raise`,
  `xstate.sendTo` and `xstate.spawnChild`) and each action that the machine names: an action of
  the setup's `actions` record, or an action that the machine's `types` declare. A named action
  is a [`ToExecutableAction`](#toexecutableaction) with the params of its uses, so a check such
  as `action.type === "track"` narrows `action.params` to the params of `track`.
- At run time, a machine's array also holds its inline actions and the other built-in actions
  (`log`, `emit`, `cancel` and `stopChild`), each as an
  [`ExecutableActionObject`](#executableactionobject). The array type does not name them, as in
  XState.
- For any other logic, the array is empty and its element type is `never`.

### Example

```ts
import { Effect } from "effect"
import { initialTransition, setup } from "@jambudipa/xstate-effect"

const light = setup({
  actions: { turnOn: () => Effect.void }
}).createMachine({
  initial: "on",
  states: { on: { entry: "turnOn" } }
})

export const program = Effect.gen(function* () {
  const [snapshot, actions] = yield* initialTransition(light)
  return {
    value: snapshot.value, // "on"
    types: actions.map((action) => action.type) // ["turnOn"]
  }
})
```

## transition

```ts
import type { Effect } from "effect"
import type {
  ActorScope,
  AnyActorLogic,
  EventObject,
  ExecutableActionsFrom,
  GuardError,
  Snapshot
} from "@jambudipa/xstate-effect"

// The snapshot, event, services and error of the logic's own `transition`
type TransitionTypes<TLogic> = TLogic extends {
  readonly transition: (
    snapshot: infer TSnapshot extends Snapshot,
    event: infer TEvent extends EventObject
  ) => Effect.Effect<unknown, infer E, infer R>
}
  ? readonly [snapshot: TSnapshot, event: TEvent, requirements: R, error: E]
  : never

export declare function transition<TLogic extends AnyActorLogic>(
  logic: TLogic,
  snapshot: TransitionTypes<TLogic>[0],
  event: TransitionTypes<TLogic>[1]
): Effect.Effect<
  readonly [
    nextSnapshot: TransitionTypes<TLogic>[0],
    actions: Array<ExecutableActionsFrom<TLogic>>
  ],
  TransitionTypes<TLogic>[3] | GuardError,
  Exclude<TransitionTypes<TLogic>[2], ActorScope>
>
```

### Parameters

The parameters of [`getNextSnapshot`](#getnextsnapshot).

### Returns

An Effect that succeeds with a tuple: the next snapshot, and the actions of the macrostep in the
order that the transition handed them to the action executor.

**Fails with:** what [`getNextSnapshot`](#getnextsnapshot) fails with.

**Requires:** the services of the logic's `transition`, without `ActorScope`.

### Behaviour

- The snapshot equals the one that `getNextSnapshot` gives for the same arguments.
- `assign` is not in the actions: its change is already in the snapshot.
- The actions hold every microstep of the macrostep: the exit, transition and entry actions of
  the event's microstep, then those of each eventless and raised-event microstep.
- A raise without a delay is in the actions, although the macrostep has already processed its
  event. A delayed raise and an `after` timer are `xstate.raise` actions with their `delay`.
- The array type is [`ExecutableActionsFrom<TLogic>`](#executableactionsfrom), as for
  [`initialTransition`](#initialtransition): the special built-in actions and the actions that
  the machine names, each with the params of its uses. At run time the array also holds inline
  actions and the other built-in actions, which the type does not name.

### Example

```ts
import { Effect } from "effect"
import { initialTransition, setup, transition } from "@jambudipa/xstate-effect"

const toggle = setup({
  types: {} as { events: { type: "TOGGLE" } },
  actions: { track: (_, params: { readonly id: string }) => Effect.log(params.id) }
}).createMachine({
  initial: "off",
  states: {
    off: { on: { TOGGLE: { target: "on", actions: { type: "track", params: { id: "switched-on" } } } } },
    on: { on: { TOGGLE: "off" } }
  }
})

export const program = Effect.gen(function* () {
  const [initial] = yield* initialTransition(toggle)
  const [next, actions] = yield* transition(toggle, initial, { type: "TOGGLE" })
  return {
    value: next.value, // "on"
    types: actions.map((action) => action.type), // ["track"]
    // The type names `track` with its params, so the check narrows `action.params`
    ids: actions.flatMap((action) => (action.type === "track" ? [action.params.id] : [])) // ["switched-on"]
  }
})
```

## getInitialMicrosteps

```ts
import type { Effect, Scope } from "effect"
import type {
  ActorLogic,
  ActorScope,
  AnyMachineSnapshot,
  AnyStateMachine,
  EventObject,
  ExecutableActionsFrom,
  GuardError,
  InitializationError,
  Snapshot,
  SpecialExecutableAction,
  StateMachineTypeId,
  TransitionError
} from "@jambudipa/xstate-effect"

// The special built-in actions for a machine
type ExecutableActionsOf<TSnapshot> = TSnapshot extends AnyMachineSnapshot ? SpecialExecutableAction : never

// The actions that the machine names, each with the params of its uses
type NamedExecutableActions<TMachine> = Exclude<ExecutableActionsFrom<TMachine>, SpecialExecutableAction>

export declare function getInitialMicrosteps<
  TSnapshot extends Snapshot,
  TEvent extends EventObject,
  TInput,
  TEmitted extends EventObject,
  R,
  TMachine = unknown
>(
  machine: ActorLogic<TSnapshot, TEvent, TInput, TEmitted, R> & Pick<AnyStateMachine, StateMachineTypeId> & TMachine,
  ...[input]: undefined extends TInput ? [input?: TInput] : [input: TInput]
): Effect.Effect<
  Array<
    readonly [
      snapshot: TSnapshot,
      actions: Array<ExecutableActionsOf<TSnapshot> | NamedExecutableActions<TMachine>>
    ]
  >,
  InitializationError | TransitionError | GuardError,
  Exclude<Exclude<R, ActorScope>, Scope.Scope>
>
```

### Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `machine` | a state machine | Only a state machine; other actor logic is a type error. `TMachine` is its type as given, which carries the names of its actions. |
| `input` | `TInput` | The input. Optional when the input type admits `undefined`. |

### Returns

An Effect that succeeds with one `[snapshot, actions]` tuple per microstep. The first microstep
enters the initial states and holds their entry actions. Each eventless and raised-event
microstep follows, with its own actions.

**Fails with:** `InitializationError` for an `initial` key that names no child state;
`TransitionError` when the initial macrostep runs past `maxIterations`; `GuardError` when a
guard throws. Any other value that the initialization throws is a defect.

**Requires:** the services `R` of the machine, without `ActorScope` and `Scope`.

### Behaviour

- No action runs. The context factory runs, so each snapshot holds the context of its
  microstep.
- The actions of each microstep have the types that [`initialTransition`](#initialtransition)
  describes.

### Example

```ts
import { Effect } from "effect"
import { assign, getInitialMicrosteps, raise, setup } from "@jambudipa/xstate-effect"

const machine = setup({
  types: {} as { context: { count: number }; events: { type: "INC" } }
}).createMachine({
  context: { count: 0 },
  entry: raise({ type: "INC" }),
  initial: "active",
  states: {
    active: { on: { INC: { actions: assign({ count: ({ context }) => context.count + 1 }) } } }
  }
})

export const program = Effect.gen(function* () {
  const microsteps = yield* getInitialMicrosteps(machine)
  // Two microsteps: the initial one (count 0), then the raised INC (count 1)
  return microsteps.map(([snapshot]) => snapshot.context.count)
})
```

## getMicrosteps

```ts
import type { Effect } from "effect"
import type {
  ActorScope,
  AnyStateMachine,
  EventObject,
  ExecutableActionsFrom,
  GuardError,
  Snapshot
} from "@jambudipa/xstate-effect"

// The snapshot, event, services and error of the machine's own `transition`
type TransitionTypes<TLogic> = TLogic extends {
  readonly transition: (
    snapshot: infer TSnapshot extends Snapshot,
    event: infer TEvent extends EventObject
  ) => Effect.Effect<unknown, infer E, infer R>
}
  ? readonly [snapshot: TSnapshot, event: TEvent, requirements: R, error: E]
  : never

export declare function getMicrosteps<TMachine extends AnyStateMachine>(
  machine: TMachine,
  snapshot: TransitionTypes<TMachine>[0],
  event: TransitionTypes<TMachine>[1]
): Effect.Effect<
  Array<
    readonly [
      snapshot: TransitionTypes<TMachine>[0],
      actions: Array<ExecutableActionsFrom<TMachine>>
    ]
  >,
  TransitionTypes<TMachine>[3] | GuardError,
  Exclude<TransitionTypes<TMachine>[2], ActorScope>
>
```

### Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `machine` | `TMachine extends AnyStateMachine` | Only a state machine. |
| `snapshot` | the machine's snapshot type | The snapshot to start from. |
| `event` | the machine's event type | The event to process. |

### Returns

An Effect that succeeds with one `[snapshot, actions]` tuple per microstep of the macrostep: the
microstep of the event first, then each eventless and raised-event microstep.

**Fails with:** `TransitionError` when the macrostep runs past `maxIterations`, and
`GuardError` when a guard throws.

**Requires:** the services of the machine's `transition`, without `ActorScope`.

### Behaviour

- An event that no active state node takes gives one microstep: the same snapshot, with no
  actions.
- A snapshot that is not active (`done`, `error` or `stopped`) gives the first microstep only.
  A `done` snapshot stays `done`, and the microstep holds the exit actions of every active
  state node.
- The actions of each microstep have the type
  [`ExecutableActionsFrom<TMachine>`](#executableactionsfrom).

### Example

```ts
import { Effect } from "effect"
import { createMachine, getInitialSnapshot, getMicrosteps } from "@jambudipa/xstate-effect"

const machine = createMachine({
  types: {} as { events: { type: "GO" } },
  initial: "a",
  states: {
    a: { on: { GO: "b" } },
    b: { always: "c" },
    c: {}
  }
})

export const program = Effect.gen(function* () {
  const initial = yield* getInitialSnapshot(machine)
  const microsteps = yield* getMicrosteps(machine, initial, { type: "GO" })
  return microsteps.map(([snapshot]) => snapshot.value) // ["b", "c"]
})
```

## getNextTransitions

```ts
import type { Effect } from "effect"
import type { AnyMachineSnapshot, EventObject, TransitionDefinition } from "@jambudipa/xstate-effect"

export declare function getNextTransitions(
  snapshot: AnyMachineSnapshot
): Effect.Effect<ReadonlyArray<TransitionDefinition<unknown, EventObject>>>
```

### Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `snapshot` | `AnyMachineSnapshot` | A machine snapshot. |

### Returns

An Effect that succeeds with the transition definitions of the active state nodes. It never
fails.

### Behaviour

- The order: for each active atomic state node, in the snapshot's node order, the transitions
  of that node, then those of each of its ancestors that no earlier atomic node visited.
- Within one node: its event transitions in declaration order, then its `always` transitions.
  A delayed transition is among the event transitions, under its `xstate.after.<delay>.<id>`
  event type.
- No guard runs. A guarded transition is in the result whatever its guard would give.
- Each definition holds `eventType`, `source` (the id of its state node), `target` (the target
  nodes, or `undefined` for a targetless transition), `guard`, `actions` and `reenter`. See
  [State nodes](../state-nodes.md).

### Example

```ts
import { Effect } from "effect"
import { createMachine, getInitialSnapshot, getNextTransitions } from "@jambudipa/xstate-effect"

const light = createMachine({
  id: "light",
  initial: "green",
  states: {
    green: { on: { TIMER: "yellow", POWER_OUT: "red" } },
    yellow: {},
    red: {}
  }
})

export const program = Effect.gen(function* () {
  const snapshot = yield* getInitialSnapshot(light)
  const transitions = yield* getNextTransitions(snapshot)
  return transitions.map((definition) => definition.eventType) // ["TIMER", "POWER_OUT"]
})
```

## ExecutableActionObject

```ts
import type { CustomActionExecution } from "@jambudipa/xstate-effect"

export type ExecutableActionObject = CustomActionExecution
```

| Field | Type | Description |
| --- | --- | --- |
| `type` | `string` | The action's type: the name of a named action, the built-in type such as `xstate.raise`, or for an inline function its function name (`(anonymous)` when it has none). |
| `info` | object | The action's arguments: `context` (the context that the earlier actions of the same list left), `event` (the event of the macrostep), `self` and `system`. In the pure functions, `self` and `system` are inert. |
| `params` | `unknown` | The params of this use; `undefined` when there are none. For a built-in action, the resolved params. |
| `exec` | `Effect.Effect<void>` | Runs the action. For a custom action, it runs the implementation with `info` and `params`. For a built-in action, it does the action's work through the actor scope that resolved it; in the pure functions, that scope is inert. |

## ExecutableRaiseAction

From the `testing` namespace only: `testing.ExecutableRaiseAction`.

| Field | Type | Description |
| --- | --- | --- |
| `type` | `"xstate.raise"` | |
| `params.event` | `EventObject` | The raised event. |
| `params.id` | `string \| undefined` | The action's `id` option, which `cancel` takes; `undefined` without one. |
| `params.delay` | `number \| undefined` | The resolved delay in milliseconds; `undefined` for no delay. |

It also has the `info` and `exec` fields of `ExecutableActionObject`.

## ExecutableSendToAction

From the `testing` namespace only: `testing.ExecutableSendToAction`.

| Field | Type | Description |
| --- | --- | --- |
| `type` | `"xstate.sendTo"` | |
| `params.event` | `EventObject` | The event to send. |
| `params.id` | `string \| undefined` | The action's `id` option, which `cancel` takes. |
| `params.delay` | `number \| undefined` | The resolved delay in milliseconds; `undefined` sends at once. |
| `params.to` | `AnyActorRef` | The target actor. For a target name that resolves only after its action list, the actor that it resolved to. |
| `params.targetId` | `string \| undefined` | The target's name; `undefined` for a target given as a reference. |

It also has the `info` and `exec` fields of `ExecutableActionObject`.

## ExecutableSpawnAction

| Field | Type | Description |
| --- | --- | --- |
| `type` | `"xstate.spawnChild"` | |
| `params.id` | `string` | The `id` option as written. An id function stays the function at run time. |
| `params.actorRef` | `AnyActorRef \| undefined` | The child, created and never started; `undefined` for a `src` that names no logic. |
| `params.src` | `string \| AnyActorLogic` | The `src` as written. |
| `params.systemId` | `string \| undefined` | The `systemId` option. |
| `params.input` | `unknown` | The input resolved for the child; `undefined` without one. |

Its `exec` is `Effect.void`. It also has the `info` field of `ExecutableActionObject`.

## SpecialExecutableAction

```ts
import type { ExecutableSpawnAction, testing } from "@jambudipa/xstate-effect"

export type SpecialExecutableAction =
  | ExecutableSpawnAction
  | testing.ExecutableRaiseAction
  | testing.ExecutableSendToAction
```

## ExecutableActionsFrom

The element type of the action arrays that the pure functions give for a logic.

| Logic | `ExecutableActionsFrom<TLogic>` |
| --- | --- |
| A machine that names actions | `SpecialExecutableAction`, and for each named action a `ToExecutableAction` with the name as its `type` and the params of its uses as its `params`. |
| A machine that names no action | `SpecialExecutableAction`. |
| Any other logic | `never`. |

A machine names the actions of its setup's `actions` record, or the actions that its `types`
declare. The params of a named action are the type of the second parameter of its
implementation, or the `params` that `types` declares for it.

Inline actions and the other built-in actions (`log`, `emit`, `cancel` and `stopChild`) are not
members of the type, as in XState. They are in the arrays at run time, each as an
[`ExecutableActionObject`](#executableactionobject). `assign` is never in the arrays.

```ts
import { setup, type ExecutableActionsFrom } from "@jambudipa/xstate-effect"

export const machine = setup({
  types: {} as { events: { type: "SAVE" } },
  actions: { track: (_, params: { readonly id: string }) => console.log(params.id) }
}).createMachine({
  on: { SAVE: { actions: { type: "track", params: { id: "save" } } } }
})

// SpecialExecutableAction | ToExecutableAction<{ type: "track"; params: { readonly id: string } }>
export type MachineAction = ExecutableActionsFrom<typeof machine>
```

## ToExecutableAction

```ts
import type { CustomActionExecution, ParameterizedObject } from "@jambudipa/xstate-effect"

export interface ToExecutableAction<T extends ParameterizedObject>
  extends Omit<CustomActionExecution, "type" | "params"> {
  readonly type: T["type"]
  readonly params: T["params"]
}
```

The executable form of a named action type: its `type` narrowed to the literal of `T`, its
`params` typed as `T` declares them, and the `info` and `exec` fields of
`ExecutableActionObject`.

## Related

- [How to test a machine without running an actor](../../how-to/test-machines-without-actors.md)
- [Test your machine](../../tutorials/07-testing.md)
- [createMachine and the machine](../create-machine.md): `machine.transition` and
  `machine.resolveState`.
- [Snapshots](../snapshots.md)
- [Errors](../errors.md): `GuardError`, `TransitionError` and `InitializationError`.
- [Graph and model-based testing](../graph.md): traversals built on these functions.
- [How an actor processes events](../../explanation/event-processing.md): macrosteps and
  microsteps.
