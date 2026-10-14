---
title: fromTransition and fromTransitionWithInput
doc-type: reference
sources: [packages/core/src/actors/fromTransition.ts]
---

# fromTransition and fromTransitionWithInput

> **TL;DR:** `fromTransition(reducer, initialState)` makes actor logic from a reducer: a plain
> function `(state, event, actorScope) => nextState`. The state is the snapshot's `context`.
> The initial state is a value, or a factory that builds it from the actor's input;
> `fromTransitionWithInput` is a curried form whose factory takes the input directly. A
> transition actor never reaches status `done`, and a stop leaves its status `active`.

## Summary

| Export | Kind | Import from | Description |
|---|---|---|---|
| [`fromTransition`](#fromtransition) | function | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/actors` | Creates actor logic from a reducer. |
| [`fromTransitionWithInput`](#fromtransitionwithinput) | function | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/actors` | Creates actor logic from a reducer and a factory of the raw input. |
| [`TransitionActorScope`](#transitionactorscope) | type | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/actors` | The third argument of the reducer. |
| [`TransitionSnapshot`](#transitionsnapshot) | type | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/actors` | The snapshot of a transition actor. |
| [`TransitionActorLogic`](#transitionactorlogic) | type | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/actors` | The logic that both functions return. |
| [`TransitionActorRef`](#transitionactorref) | type | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/actors` | A reference to a transition actor, the type of `self`. |

The root entry point also holds every export of this page on its `actors` namespace
(`actors.fromTransition`).

## `fromTransition`

### Signature

```ts
import type {
  ActorSystemService,
  EventObject,
  TransitionActorLogic,
  TransitionActorRef,
  TransitionActorScope
} from "@jambudipa/xstate-effect"

export declare function fromTransition<
  TContext,
  TEvent extends EventObject,
  TSystem extends ActorSystemService = ActorSystemService,
  TInput = unknown,
  TEmitted extends EventObject = EventObject
>(
  transition: (
    state: TContext,
    event: TEvent,
    actorScope: TransitionActorScope<TContext, TEvent, TSystem, TEmitted>
  ) => TContext,
  initialContext:
    | TContext
    | ((args: { readonly input: TInput; readonly self: TransitionActorRef<TContext, TEvent> }) => TContext)
): TransitionActorLogic<TContext, TEvent, TInput, TEmitted>
```

The type parameters are in the order `TContext`, `TEvent`, `TSystem`, `TInput`, `TEmitted`.
TypeScript infers `TContext` and `TEvent` from annotations on the reducer's parameters, and
`TInput` from an annotation on the factory's parameter.

### Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `transition` | `(state, event, actorScope) => TContext` | required | The reducer. It receives the current state, the event, and a [`TransitionActorScope`](#transitionactorscope), and returns the next state. |
| `initialContext` | `TContext \| (({ input, self }) => TContext)` | required | The initial state, or a factory that builds it from the actor's `input` and `self`. A function is always called as the factory, so a state that is itself a function needs the factory form. |

### Returns

A `TransitionActorLogic<TContext, TEvent, TInput, TEmitted>`. Pass it to `createActor`, to
`invoke.src`, to `spawnChild`, or to the `actors` of `setup`.

### Reducer argument

The reducer's third argument, `actorScope`, has these fields. The full block is in
[`TransitionActorScope`](#transitionactorscope).

| Field | Type | Description |
|---|---|---|
| `self` | `TransitionActorRef<TContext, TEvent>` | The transition actor itself. |
| `id` | `string` | The actor's id. |
| `sessionId` | `string` | The actor's session id. |
| `system` | `TSystem` | The actor system that the actor belongs to. |
| `emit` | `(emitted: TEmitted) => void` | Delivers an event to the actor's `on` listeners and its `emissions` stream at once. |
| `logger` | `(...args: ReadonlyArray<unknown>) => void` | The actor's logger. |
| `defer` | `(fn: () => void) => void` | Runs `fn` after the next state commits. |
| `stopChild` | `(child: AnyActorRef) => void` | Stops a child of the actor. |
| `actionExecutor` | `(action: CustomActionExecution) => void` | Runs an action's execution. |

### Snapshot at each status

| Status | When | `context` | `output` | `error` |
|---|---|---|---|---|
| `active` | From creation; also after a `stop` of a running actor. | The initial state, then what the reducer returned for the last event. | `Option.none()` | `Option.none()` |
| `error` | The reducer or the factory threw, or a work that a scope member started failed. | The state from before the failing event. | `Option.none()` | `Option.some(thrown)`, the raw thrown value. |
| `stopped` | The scope that owns the actor closed without a stop. | The last state. | `Option.none()` | `Option.none()` |

A transition actor never has status `done`, and its `output` is always `Option.none()`.

### Behaviour

- The initial snapshot is computed when the actor is created. A factory runs at that point,
  with the actor's `input` and `self`.
- `start` runs no user code.
- Each event that the actor receives goes to the reducer. Its return value becomes the
  snapshot's `context`.
- The reducer receives every event that the actor receives, built-in events included, even
  when `TEvent` does not name them.

### Stop behaviour

- `stop` passes the event `{ type: "xstate.stop" }` to the reducer and keeps what it returns.
  The status stays `active`. Later sends are dropped with a warning.
- The exit of the state that invoked the actor, or the stop of its parent, does the same.
- When the scope that owns the actor closes without a stop, the reducer receives no event and
  the snapshot gets status `stopped`.

### Errors

| Condition | Result |
|---|---|
| The reducer throws | Status `error` with the raw thrown value. The `context` stays at its value from before the event. The parent receives `xstate.error.actor.<id>`. |
| The factory throws | The initial snapshot has status `error` with the raw thrown value. The parent receives `xstate.error.actor.<id>` when the actor starts. |
| `stopChild` with an actor that is not a child of this actor | Status `error` with an `ActorError` whose message is `Cannot stop child actor <child id> of <id> because it is not a child`. |
| A `logger`, `defer`, `stopChild` or `actionExecutor` work that fails or dies while the reducer runs | Status `error` when the reducer returns, with the snapshot from before the event. |
| Any of these errors in a root actor that nothing observes | The error is also logged through Effect logging at level Error. |

### Persisted form

`getPersistedSnapshot` gives `{ status, output, error, context }` with plain values. An absent
`Option` has no key: a running actor persists as `{ status: "active", context }`. The `context`
goes through the same context codec as a machine's context.

### Example

```ts
import { Effect } from "effect"
import { createActor, fromTransition } from "@jambudipa/xstate-effect"

type CounterEvent = { type: "INCREMENT"; by: number } | { type: "RESET" }

const counter = fromTransition(
  (state: { count: number }, event: CounterEvent, { emit }) => {
    switch (event.type) {
      case "INCREMENT":
        emit({ type: "counted" })
        return { count: state.count + event.by }
      case "RESET":
        return { count: 0 }
      default:
        return state
    }
  },
  { count: 0 }
)

export const program = Effect.gen(function* () {
  const actor = yield* createActor(counter)
  yield* actor.start
  yield* actor.send({ type: "INCREMENT", by: 2 })
  return (yield* actor.getSnapshot).context.count // 2
})
```

The `default` branch returns the state for the events that `CounterEvent` does not name, such
as `xstate.stop`.

## `fromTransitionWithInput`

### Signature

```ts
import type { ActorSystemService, EventObject, TransitionActorLogic, TransitionActorScope } from "@jambudipa/xstate-effect"

export declare function fromTransitionWithInput<TInput>(): <
  TContext,
  TEvent extends EventObject,
  TEmitted extends EventObject = EventObject
>(
  transition: (
    state: TContext,
    event: TEvent,
    actorScope: TransitionActorScope<TContext, TEvent, ActorSystemService, TEmitted>
  ) => TContext,
  initialContext: (input: TInput) => TContext
) => TransitionActorLogic<TContext, TEvent, TInput, TEmitted>
```

### Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `TInput` (type argument of the first call) | type | `unknown` | The type of the actor's input. |
| `transition` | `(state, event, actorScope) => TContext` | required | The reducer, as for `fromTransition`. |
| `initialContext` | `(input: TInput) => TContext` | required | Builds the initial state from the actor's input. |

### Returns

The same `TransitionActorLogic<TContext, TEvent, TInput, TEmitted>` as
`fromTransition(transition, ({ input }) => initialContext(input))`.

### Behaviour

The snapshot, the stop behaviour, the errors and the persisted form are those of
[`fromTransition`](#fromtransition). The `TSystem` of the reducer's `actorScope` is
`ActorSystemService`.

### Example

```ts
import { Effect } from "effect"
import { createActor, fromTransitionWithInput } from "@jambudipa/xstate-effect"

const counter = fromTransitionWithInput<{ initial: number }>()(
  (state: { count: number }, event: { type: "INCREMENT" }) =>
    event.type === "INCREMENT" ? { count: state.count + 1 } : state,
  ({ initial }) => ({ count: initial })
)

export const program = Effect.gen(function* () {
  const actor = yield* createActor(counter, { input: { initial: 10 } })
  yield* actor.start
  yield* actor.send({ type: "INCREMENT" })
  return (yield* actor.getSnapshot).context.count // 11
})
```

## `TransitionActorScope`

```ts
import type {
  ActorSystemService,
  AnyActorRef,
  CustomActionExecution,
  EventObject,
  TransitionActorRef
} from "@jambudipa/xstate-effect"

export interface TransitionActorScope<
  TContext,
  TEvent extends EventObject,
  TSystem extends ActorSystemService = ActorSystemService,
  TEmitted extends EventObject = EventObject
> {
  readonly self: TransitionActorRef<TContext, TEvent>
  readonly id: string
  readonly sessionId: string
  readonly logger: (...args: ReadonlyArray<unknown>) => void
  readonly defer: (fn: () => void) => void
  readonly system: TSystem
  readonly stopChild: (child: AnyActorRef) => void
  readonly emit: (emitted: TEmitted) => void
  readonly actionExecutor: (action: CustomActionExecution) => void
}
```

| Member | Called while the reducer runs | Called later (from a timer that the reducer set) | In the pure transition functions |
|---|---|---|---|
| `emit` | Delivers the event at once, before the next state commits. | Delivers the event while the actor runs. | Delivers nothing. |
| `logger` | The actor's `logger` option, else its system's. Without one, an Effect log at level Info annotated with `actorId` and `sessionId`. | The same, through the actor while it runs. | Does nothing. |
| `defer` | Runs `fn` after the next state commits, before the observers see it. | Runs `fn` after the commit of the actor's next event. | Does nothing. |
| `stopChild` | Stops the child as a machine's `stopChild` stops it. An actor that is not a child gives the error in [Errors](#errors). | The same, through the actor while it runs. | Does nothing. |
| `actionExecutor` | Sends the `@xstate.action` inspection event, then runs the action's `exec`, at once. | The same, through the actor while it runs. | Runs nothing; the `transition` function returns the action in its list. |

A work that `logger`, `defer`, `stopChild` or `actionExecutor` starts while the reducer runs
uses the actor's services. A transition actor spawns no child: its only children are actors
created with it as their `parent` option.

## `TransitionSnapshot`

```ts
import type { Snapshot } from "@jambudipa/xstate-effect"

export interface TransitionSnapshot<TContext> extends Snapshot<undefined> {
  readonly context: TContext
}
```

| Field | Type | Description |
|---|---|---|
| `status` | `SnapshotStatus` | See [Snapshot at each status](#snapshot-at-each-status). |
| `output` | `Option.Option<undefined>` | Always `Option.none()`. |
| `error` | `Option.Option<unknown>` | The raw thrown value when the status is `error`. |
| `context` | `TContext` | The reducer's current state. A reducer that throws leaves it as it was before that event. |

## `TransitionActorLogic`

`TransitionActorLogic<TContext, TEvent extends EventObject, TInput = unknown, TEmitted extends
EventObject = EventObject>` is `ActorLogic<TransitionSnapshot<TContext>, TEvent, TInput,
TEmitted>`.

## `TransitionActorRef`

`TransitionActorRef<TContext, TEvent extends EventObject>` is
`ActorRef<TransitionSnapshot<TContext>, TEvent>`. It is the type of `self` in the reducer's
`actorScope` and in the factory.

## Related

- [createActor and the actor](../create-actor.md): `start`, `stop`, `on` and the `logger` option.
- [Pure transition functions](../testing/get-next-snapshot.md): `transition` and
  `initialTransition` with a transition actor's logic.
- [Custom actor logic and createEmptyActor](./custom-logic.md): `createEmptyActor` is built on
  transition logic.
- [Inspection events](../inspection.md): the `@xstate.action` event.
- [Persisted snapshots](../persistence.md)
- [About the actor model](../../explanation/actor-model.md)
