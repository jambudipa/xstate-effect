---
title: createActor and the actor
doc-type: reference
sources: [packages/core/src/Actor.ts, packages/core/src/Types.ts]
---

# createActor and the actor

> **TL;DR:** `createActor(logic, options?)` returns an `Effect` that needs a `Scope` and gives
> an actor that has not started. `start`, `stop`, `send`, `getSnapshot` and
> `getPersistedSnapshot` are Effects; `changes`, `snapshotStream` and `emissions` are Streams;
> `subscribe` and `on` register callbacks until the caller's scope closes. No member has a
> typed error except `getPersistedSnapshot`, which can fail with a `SerializationError`.

All names on this page come from `@jambudipa/xstate-effect`.

## Summary

### Functions

| Name | Type | Summary |
|---|---|---|
| [`createActor`](#createactor) | `MakeActor` | Creates an actor from any actor logic. The actor is not started. |
| `makeActor`, `Actor.make`, `Actor.createActor` | `MakeActor` | The same function as `createActor`. |
| [`isActor`](#isactor) | `(u: unknown) => u is Actor.Actor.Any` | Whether a value is an actor. |

### Options of `createActor`

| Field | Type | Default |
|---|---|---|
| [`id`](#actoroptions) | `string` | the session id |
| [`systemId`](#actoroptions) | `string` | none |
| [`input`](#actoroptions) | the logic's input type | `undefined`; required when the input type does not take `undefined` |
| [`parent`](#actoroptions) | `AnyActorRef` | none: a root actor |
| [`syncSnapshot`](#actoroptions) | `boolean` | `false` |
| [`src`](#actoroptions) | `string \| AnyActorLogic` | the logic |
| [`snapshot`](#actoroptions) | `unknown` | none: the logic's initial snapshot |
| [`validateSnapshot`](#actoroptions) | `boolean` | `false` |
| [`clock`](#actoroptions) | `ActorSystem.Clock` | the Effect clock |
| [`logger`](#actoroptions) | `(...args: ReadonlyArray<unknown>) => void` | Effect logging |
| [`inspect`](#actoroptions) | `(event: InspectionEvent) => Effect.Effect<void>` | none |
| [`devTools`](#actoroptions) | `boolean \| DevToolsAdapter` | `false` |

### Members of the actor

| Member | Type | Completes | Fails with |
|---|---|---|---|
| [`start`](#start) | `Effect.Effect<void>` | after the events sent before `start` are processed | never |
| [`stop`](#stop) | `Effect.Effect<void>` | after the actor has stopped and its scope has closed | never; dies for a non-root actor |
| [`send`](#send) | `(event) => Effect.Effect<void>` | after the event's macrostep commits | never |
| [`getSnapshot`](#getsnapshot) | `Effect.Effect<TSnapshot>` | at once | never |
| [`getPersistedSnapshot`](#getpersistedsnapshot) | `Effect.Effect<unknown, SerializationError>` | at once | `SerializationError` |
| [`changes`](#changes) | `Stream.Stream<TSnapshot, unknown>` | ends when the actor is done or stopped | the actor's error |
| [`snapshotStream`](#snapshotstream) | `SnapshotStream<TSnapshot, unknown>` | as `changes` | the actor's error |
| [`subscribe`](#subscribe) | `(observer) => Effect.Effect<void, never, Scope>` | at once | never |
| [`on`](#on) | `(type, handler) => Effect.Effect<void, never, Scope>` | at once | never |
| [`emissions`](#emissions) | `Stream.Stream<TEmitted>` | ends when the actor stops, is done or errors | never |
| [`select`](#select) | `(selector, equalityFn?) => Readable<TSelected>` | synchronous | never |
| [Value members](#value-members) | `id`, `sessionId`, `systemId`, `system`, `clock`, `logic`, `src`, `ref`, … | — | — |

### Types

| Name | Summary |
|---|---|
| [`Actor`](#the-actor-class-and-actor-types) | The class of every actor (`actor instanceof Actor`), and the namespace of the actor types. |
| [`Actor.Actor<TSnapshot, TEvent, TEmitted>`](#the-actor-class-and-actor-types) | An actor of known snapshot, event and emitted types. Also exported as `ActorType`. |
| [`AnyActor`](#the-actor-class-and-actor-types) | A structural type that every actor fits. |
| [`Readable<T>`](#select) | A value derived from an actor's snapshot. |
| [`MakeActor`](#createactor) | The signatures of `createActor`. |
| [`ActorOptions<TLogic>`](#actoroptions) | The options of `createActor`. |
| [`ActorOptionsArgs<TLogic>`](#actoroptions) | The options argument as a rest tuple: required when the logic requires an input. |
| [`RequiredActorOptionsKeys<TLogic>`](#actoroptions) | `"input"` when the logic's input type does not take `undefined`, else `never`. |
| [`DevToolsAdapter`](#actoroptions) | `(service: AnyActor) => Effect.Effect<void, unknown>`. |
| [`ProcessingStatus`](#the-actor-class-and-actor-types) | `"not-started" \| "running" \| "stopped"`. |

## createActor

```ts
import type { Effect, Scope } from "effect"
import type { Actor, ActorLogic, ActorOptionsArgs, EventObject, Snapshot } from "@jambudipa/xstate-effect"

export declare function createActor<
  TSnapshot extends Snapshot,
  TEvent extends EventObject,
  TInput,
  TEmitted extends EventObject,
  R
>(
  logic: ActorLogic<TSnapshot, TEvent, TInput, TEmitted, R>,
  ...[options]: ActorOptionsArgs<ActorLogic<TSnapshot, TEvent, TInput, TEmitted, R>>
): Effect.Effect<Actor.Actor<TSnapshot, TEvent, TEmitted>, never, Scope.Scope | R>
```

The signature above is the one that a logic of known types selects. `MakeActor` has four
signatures:

| Logic given | Result |
|---|---|
| An `AnyStateMachine` (a machine whose types the caller does not know) | `Effect<Actor.Actor<AnyMachineSnapshot, EventObject>, never, Scope>` |
| An `AnyActorLogic` (a logic whose types the caller does not know) | `Effect<AnyActor, never, Scope>` |
| An `ActorLogic<TSnapshot, TEvent, TInput, TEmitted, R>` | `Effect<Actor.Actor<TSnapshot, TEvent, TEmitted>, never, Scope \| R>` |
| A logic whose type is a type parameter `TLogic` | `Effect<Actor.Actor<SnapshotOf<TLogic>, EventOf<TLogic>, EmittedOf<TLogic>>, never, Scope>` |

**Completes:** once the actor exists and its initial snapshot is computed. The actor is not
started.

**Fails with:** nothing; the error channel is `never`. It dies with
`Actor with system ID '<systemId>' already exists.` when another actor of the same system holds
the `systemId`.

**Requires:** `Scope`, and `R`, the services of the logic.

- Nothing happens until the Effect runs. Each run of the same Effect value creates a new actor.
- A root actor (no `parent` option) creates its own [actor system](./actor-system.md). An actor
  with a `parent` joins the parent's system. `createActor` never reads an `ActorSystemTag`
  service from the context, so two root actors never share a system.
- The system books the session id, `x:<n>`, from `x:0`. The `id` defaults to it.
- The initial snapshot is computed at creation: the logic's initial snapshot for `input`, or the
  `snapshot` option. A failure or a defect during that computation does not fail the creation:
  the snapshot gets status `error`, with the original value as `error`.
- The custom actions and emits of the initial snapshot run at `start`, not at creation.
- A root actor lives in a child scope of the caller's scope: closing the caller's scope stops
  it. An actor with a `parent` lives in a child scope of the parent's scope, so the parent's
  stop, done or error stops it.
- The logic's services (`R`) are read from the caller's context, and the actor keeps them for
  all its later work.

```ts
import { Effect } from "effect"
import { createActor, createMachine } from "@jambudipa/xstate-effect"

const toggle = createMachine({
  types: {} as { events: { type: "TOGGLE" } },
  id: "toggle",
  initial: "off",
  states: {
    off: { on: { TOGGLE: "on" } },
    on: { on: { TOGGLE: "off" } }
  }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(toggle)
  yield* actor.start
  yield* actor.send({ type: "TOGGLE" })
  const snapshot = yield* actor.getSnapshot
  return snapshot.value // "on"
})

void Effect.runPromise(Effect.scoped(program))
```

## ActorOptions

`ActorOptions<TLogic>` is the type of the second argument of `createActor`. Every field is
optional, except `input` when `RequiredActorOptionsKeys<TLogic>` is `"input"`.

| Field | Type | Description |
|---|---|---|
| `id` | `string` | The actor's `id`. Default: the session id (`x:<n>`). |
| `systemId` | `string` | The key under which the system registers the actor, for `system.get`. The system registers it at creation, before the initial snapshot is computed, and drops it again when that snapshot is not active. A key that another actor of the system holds is a defect: `Actor with system ID '<systemId>' already exists.` |
| `input` | `ActorLogic.InputOf<TLogic>` | The input that the logic's initial snapshot receives. Required when the logic's input type does not take `undefined`. |
| `parent` | `AnyActorRef` | The parent actor. The new actor joins the parent's system and lives in the parent's scope. Its own `stop` then dies (see [`stop`](#stop)). |
| `syncSnapshot` | `boolean` | With a `parent`: the actor sends each active snapshot that it publishes to the parent as `xstate.snapshot.<id>`, from the snapshot it starts with. |
| `src` | `string \| AnyActorLogic` | The value of `actor.src`. Default: the logic. |
| `snapshot` | `unknown` | A snapshot to start from instead of the initial snapshot. The logic's `restoreSnapshot` reads it; a logic without `restoreSnapshot` uses it as it is. No initial action runs for it. Pending delayed events under `scheduledEvents` resume at `start`. See [Persisted snapshots](./persistence.md). |
| `validateSnapshot` | `boolean` | With `snapshot`: a persisted machine snapshot with status `done` on a state that does not complete the machine gives the actor status `error`, with an `InvalidPersistedSnapshotError`. The children that the restore creates are checked too. Default: `false`. |
| `clock` | `ActorSystem.Clock` | The clock that starts and clears the timers of delayed events: an object with `setTimeout` and `clearTimeout`, or a [`SimulatedClock`](./testing/simulated-clock.md). A root actor's system starts every delayed event of the system on it. Without one, timers run on the Effect clock. For an actor with a `parent`, it sets only the actor's `clock` member. |
| `logger` | `(...args: ReadonlyArray<unknown>) => void` | The function that [`log`](./actions/log.md) actions call: `(label, value)` with a label, `(value)` without one. A root actor's system keeps it, so every child at any depth logs through it unless the child has its own. Without one, `log` actions go to Effect logging at their level. A logger that throws gives the actor status `error`. |
| `inspect` | `(event: InspectionEvent) => Effect.Effect<void>` | An [inspection function](./inspection.md) for the system of a root actor. It is registered before every other one and stays registered while the actor's scope is open. An actor with a `parent` ignores it. |
| `devTools` | `boolean \| DevToolsAdapter` | `true` calls `devToolsAdapter` of the [`/dev` entry point](./dev.md) with the actor in `start`; a function is called instead of it; `false` registers nothing. It runs once, after the actor publishes the snapshot it starts from and before it processes the events sent before `start`. It does not run for an actor that is done or errored before `start`, or whose logic's `start` fails. A failure or a defect of the adapter makes `start` die, and the actor then processes no event. A child does not inherit it. |

`ActorOptionsArgs<TLogic>` is the options argument as a rest tuple: `[options?: ActorOptions<TLogic>]`
when `RequiredActorOptionsKeys<TLogic>` is `never`, else `[options: ActorOptions<TLogic> & { readonly input: unknown }]`.

```ts
import { Effect } from "effect"
import { createActor, fromPromise } from "@jambudipa/xstate-effect"

const loadUser = fromPromise<{ readonly name: string }, { readonly id: string }>(({ input }) =>
  Promise.resolve({ name: `user ${input.id}` })
)

const program = Effect.gen(function* () {
  // `input` is required: the logic's input type does not take `undefined`
  const actor = yield* createActor(loadUser, {
    id: "loader",
    systemId: "loader",
    input: { id: "42" },
    inspect: (event) => Effect.log(event.type)
  })
  yield* actor.start
  return actor.id // "loader"
})

void Effect.runPromise(Effect.scoped(program))
```

## The actor

`Actor.Actor<TSnapshot, TEvent, TEmitted>` is the object that `createActor` gives. An actor is
also its own [reference](./actor-refs.md): it has every member of `ActorRef<TSnapshot, TEvent, TEmitted>`.

A "send from outside" in the blocks below is a send from a fiber that is not inside the
processing, the `start` or a callback of any actor. A send from an action, a listener, an
observer or an inspection function is a send from inside.

### start

**Type:** `Effect.Effect<void>`

**Completes:** from outside, after the logic's `start`, the initial actions, and the events sent
before `start` are processed. From inside an actor's processing or callbacks, without waiting
for those events.

**Fails with:** nothing. It dies when the `devTools` adapter fails or dies, and when another
actor took the actor's `systemId` after its creation.

- It runs in order: the logic's `start`, the initial actions, a first notification of the
  observers, then the events sent before `start`, one macrostep at a time in the actor's own
  fiber.
- On an actor that started, stopped, is done or errored, `start` does nothing.
- An actor whose snapshot has status `error` (its initial snapshot failed, or it was restored
  so), or whose logic's `start` or initial actions fail, ends in status `error` with the
  original value.
- An actor whose snapshot has status `done` runs its initial actions, notifies its observers
  once and ends: the logic's `start` does not run, later sends are dropped, and its parent
  receives `xstate.done.actor.<id>`.

```ts
import { Effect } from "effect"
import { createActor, createMachine } from "@jambudipa/xstate-effect"

const toggle = createMachine({
  types: {} as { events: { type: "TOGGLE" } },
  initial: "off",
  states: { off: { on: { TOGGLE: "on" } }, on: { on: { TOGGLE: "off" } } }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(toggle)
  // Queued before start: processed before `start` completes
  yield* actor.send({ type: "TOGGLE" })
  yield* actor.start
  return (yield* actor.getSnapshot).value // "on"
})

void Effect.runPromise(Effect.scoped(program))
```

### stop

**Type:** `Effect.Effect<void>`

**Completes:** after the macrostep in progress commits, the logic takes the stop event, the
actor's scheduled events are cancelled and its scope closes (its finalizers run, and its
children stop). From inside the actor's own processing or callbacks, it completes at once, and
the stop finishes after the current macrostep.

**Fails with:** nothing. On an actor with a parent (an invoked or spawned child, or an actor
created with the `parent` option) it dies with `A non-root actor cannot be stopped directly.`,
and the actor goes on. Its parent stops it.

- The queued events are dropped. Later sends are dropped with a warning.
- The snapshot after the stop: machine, promise, callback and observable logic give status
  `stopped` (a machine stops its children and keeps none in `children`); transition logic gives
  what its reducer returns for the stop event, and stays `active`.
- A second `stop` does nothing. A not-started actor keeps its snapshot and never starts.
- Closing the scope that owns the actor stops it too, but its logic does not take the stop
  event: a running, active actor ends with status `stopped`.

```ts
import { Effect } from "effect"
import { createActor, createMachine } from "@jambudipa/xstate-effect"

const idle = createMachine({ initial: "idle", states: { idle: {} } })

const program = Effect.gen(function* () {
  const actor = yield* createActor(idle)
  yield* actor.start
  yield* actor.stop
  return (yield* actor.getSnapshot).status // "stopped"
})

void Effect.runPromise(Effect.scoped(program))
```

### send

**Type:** `(event: TEvent) => Effect.Effect<void>`

**Completes:** from outside, to a running actor: after the event's macrostep commits, or after
the event is dropped, so `getSnapshot` right after it shows the result. From inside an actor's
processing or callbacks, or to an actor that has not started: once the event is queued.

**Fails with:** nothing.

- The [inspection functions](./inspection.md) receive the event as `@xstate.event`, with no
  `sourceRef`, before the actor does.
- Events sent before `start` are processed at `start`, in order.
- A send to a stopped, done or errored actor drops the event and logs the warning
  `Event "<type>" was sent to stopped actor "<id> (<sessionId>)". This actor has already reached its final state, and will not transition.`
- A string in place of an event object (outside the type system) dies with
  `Only event objects may be sent to actors; use .send({ type: "<type>" }) instead`.

```ts
import { Effect } from "effect"
import { assign, createActor, createMachine } from "@jambudipa/xstate-effect"

const counter = createMachine({
  types: {} as { context: { count: number }; events: { type: "INC" } },
  context: { count: 0 },
  on: { INC: { actions: assign({ count: ({ context }) => context.count + 1 }) } }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(counter)
  yield* actor.start
  yield* actor.send({ type: "INC" })
  return (yield* actor.getSnapshot).context.count // 1
})

void Effect.runPromise(Effect.scoped(program))
```

### getSnapshot

**Type:** `Effect.Effect<TSnapshot>`

**Completes:** at once; it never waits.

**Fails with:** nothing.

- Before `start`, it gives the initial snapshot. After `start`, it gives the snapshot after the
  last processed event.
- A read from inside the logic while the actor computes its initial snapshot dies with
  `Snapshot can't be read while the actor initializes itself`.
- `snapshot.output` and `snapshot.error` are `Option`s. See [Snapshots](./snapshots.md).

```ts
import { Effect, Option } from "effect"
import { createActor, createMachine } from "@jambudipa/xstate-effect"

const once = createMachine({
  types: {} as { events: { type: "FINISH" }; output: string },
  initial: "running",
  states: { running: { on: { FINISH: "done" } }, done: { type: "final" } },
  output: () => "finished"
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(once)
  yield* actor.start
  yield* actor.send({ type: "FINISH" })
  const snapshot = yield* actor.getSnapshot
  return Option.getOrElse(snapshot.output, () => "none") // "finished"
})

void Effect.runPromise(Effect.scoped(program))
```

### getPersistedSnapshot

**Type:** `Effect.Effect<unknown, SerializationError>`

**Completes:** at once; it never waits.

**Fails with:** `SerializationError` when the logic cannot encode the snapshot: a context that
the persisted-snapshot codec cannot encode, or an inline child actor
(`An inline child actor cannot be persisted.`).

- It gives the logic's persisted form of the snapshot the actor holds now.
- The delayed events that the actor scheduled and that are still pending are under the key
  `scheduledEvents`. The key is absent when there are none.
- Pass the result as the `snapshot` option of `createActor` to restore the actor. See
  [Persisted snapshots](./persistence.md).

```ts
import { Effect } from "effect"
import { createActor, createMachine } from "@jambudipa/xstate-effect"

const toggle = createMachine({
  types: {} as { events: { type: "TOGGLE" } },
  initial: "off",
  states: { off: { on: { TOGGLE: "on" } }, on: { on: { TOGGLE: "off" } } }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(toggle)
  yield* actor.start
  yield* actor.send({ type: "TOGGLE" })
  const persisted = yield* actor.getPersistedSnapshot
  const restored = yield* createActor(toggle, { snapshot: persisted })
  yield* restored.start
  return (yield* restored.getSnapshot).value // "on"
})

void Effect.runPromise(Effect.scoped(program))
```

### changes

**Type:** `Stream.Stream<TSnapshot, unknown>`

**Gives:** the snapshot the actor holds when the stream runs, then each snapshot the actor
publishes: one per processed event. It works before `start`.

**Ends:** after the done snapshot when the actor is done. After the snapshot that the logic
gives for the stop when the actor stops, once its children and finalizers have stopped. The
stop of an actor that never started ends it with no new snapshot. A stream that runs after the
actor ended gives the final snapshot, then ends.

**Fails with:** the actor's error, the original value, when the actor errors. It never gives a
snapshot with status `error`. A stream that runs after the error fails too.

- A running `changes` stream is an observer with an error listener. A root actor whose error
  reaches at least one such stream, and no `subscribe` observer, does not log the error.
- The stream reads the actor when it runs, not when it is built. A stream forked with
  `Effect.forkScoped` starts later, after the sends that follow the fork. Fork it with
  `{ startImmediately: true }` to receive the snapshots of those sends.

```ts
import { Effect, Fiber, Stream } from "effect"
import { createActor, createMachine } from "@jambudipa/xstate-effect"

const light = createMachine({
  types: {} as { events: { type: "NEXT" } },
  initial: "green",
  states: {
    green: { on: { NEXT: "amber" } },
    amber: { on: { NEXT: "red" } },
    red: { type: "final" }
  }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(light)
  // The stream ends after the done snapshot
  const values = yield* actor.changes.pipe(
    Stream.map((snapshot) => snapshot.value),
    Stream.runCollect,
    Effect.forkScoped
  )
  yield* actor.start
  yield* actor.send({ type: "NEXT" })
  yield* actor.send({ type: "NEXT" })
  return yield* Fiber.join(values) // green, amber, red
})

void Effect.runPromise(Effect.scoped(program))
```

### snapshotStream

**Type:** `SnapshotStream<TSnapshot, unknown>`, with three members:

| Member | Type | Value |
|---|---|---|
| `get` | `Effect.Effect<TSnapshot>` | `getSnapshot` |
| `stream` | `Stream.Stream<TSnapshot, unknown>` | `changes` |
| `changes` | `Stream.Stream<TSnapshot, unknown>` | `changes` without its first value |

**Ends** and **fails** as [`changes`](#changes) does.

- The type is covariant in `TSnapshot`, so a `SnapshotStream` of a specific snapshot fits a
  `SnapshotStream<Snapshot, unknown>`. See [Actor references](./actor-refs.md#snapshotstream).

```ts
import { Effect, Fiber, Stream } from "effect"
import { createActor, createMachine } from "@jambudipa/xstate-effect"

const toggle = createMachine({
  types: {} as { events: { type: "TOGGLE" } },
  initial: "off",
  states: { off: { on: { TOGGLE: "on" } }, on: { on: { TOGGLE: "off" } } }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(toggle)
  // Only the snapshots after the current one
  const next = yield* actor.snapshotStream.changes.pipe(
    Stream.map((snapshot) => snapshot.value),
    Stream.take(1),
    Stream.runCollect,
    Effect.forkScoped
  )
  yield* actor.start
  yield* actor.send({ type: "TOGGLE" })
  return yield* Fiber.join(next) // ["on"]
})

void Effect.runPromise(Effect.scoped(program))
```

### subscribe

**Type:** `(observer: (snapshot: TSnapshot) => Effect.Effect<void>) => Effect.Effect<void, never, Scope.Scope>`

**Completes:** at once, once the subscription exists.

**Fails with:** nothing.

- `observer` receives each snapshot that the actor publishes after the call, one per processed
  event, and nothing at subscription time.
- An observer added before `start` receives the initial snapshot once, at `start`.
- It never receives a snapshot with status `error` or `stopped`. At a stop, it receives the
  active snapshot that a transition logic gives for the stop event.
- An observer that throws, fails or dies is reported with `Effect.logError`, through the Effect
  logger, and keeps its subscription.
- An observer has no error listener: an actor that errors while it is subscribed logs the error.
- Each call starts while the actor publishes the snapshot. A call that never waits ends before
  the `send` of the event returns, as in XState. A call that waits goes on in a fiber of its
  own, and the actor does not wait for it.
- The calls of one observer run one at a time, in order.
- The subscription ends when the caller's scope closes.

```ts
import { Effect } from "effect"
import { assign, createActor, createMachine } from "@jambudipa/xstate-effect"

const counter = createMachine({
  types: {} as { context: { count: number }; events: { type: "INC" } },
  context: { count: 0 },
  on: { INC: { actions: assign({ count: ({ context }) => context.count + 1 }) } }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(counter)
  yield* actor.subscribe((snapshot) => Effect.log(`count: ${snapshot.context.count}`))
  yield* actor.start // logs "count: 0"
  yield* actor.send({ type: "INC" }) // logs "count: 1"
})

void Effect.runPromise(Effect.scoped(program))
```

### on

**Type:** `<TType extends TEmitted["type"] | "*">(type: TType, handler: (event: ActorRef.EmittedOfType<TEmitted, TType>) => Effect.Effect<void>) => Effect.Effect<void, never, Scope.Scope>`

**Completes:** at once, once the listener is registered.

**Fails with:** nothing.

- `handler` runs for each emitted event of `type`, or of every type for `"*"`, after the
  macrostep that emits it commits, while the caller's scope stays open.
- For each event, the listeners of its type run first, then the `"*"` listeners, each in the
  order of registration, one at a time. A listener added while an event goes round waits for
  the next event.
- Each registration is separate: a handler registered twice runs twice. The scope's close
  removes only its own registration.
- A handler that throws, fails or dies is reported with `Effect.logError`, through the Effect
  logger. The other handlers and the actor go on.
- See [emit](./actions/emit.md) for the action that emits events.

```ts
import { Effect } from "effect"
import { createActor, emit, setup } from "@jambudipa/xstate-effect"

const notifier = setup({
  types: {} as {
    events: { type: "SAVE" }
    emitted: { type: "saved"; at: number } | { type: "failed" }
  }
}).createMachine({
  on: { SAVE: { actions: emit({ type: "saved" as const, at: 1 }) } }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(notifier)
  // `event` is { type: "saved"; at: number }
  yield* actor.on("saved", (event) => Effect.log(`saved at ${event.at}`))
  yield* actor.start
  yield* actor.send({ type: "SAVE" })
})

void Effect.runPromise(Effect.scoped(program))
```

### emissions

**Type:** `Stream.Stream<TEmitted>`

**Gives:** each event that the actor emits after the stream starts to run, after the macrostep
that emits it commits.

**Ends:** when the actor ends (it stops, is done or errors), after the last event it gives. A
stream that runs after the actor ended ends at once.

**Fails with:** nothing. An actor that errors ends the stream.

- The stream subscribes when it runs, not when it is built. A stream forked with
  `Effect.forkScoped` starts later, after the sends that follow the fork. Fork it with
  `{ startImmediately: true }` to receive the events of those sends.
- Each read of `actor.emissions` builds a new stream.

```ts
import { Effect, Fiber, Stream } from "effect"
import { createActor, emit, setup } from "@jambudipa/xstate-effect"

const notifier = setup({
  types: {} as { events: { type: "PING" }; emitted: { type: "pong" } }
}).createMachine({
  on: { PING: { actions: emit({ type: "pong" as const }) } }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(notifier)
  yield* actor.start
  // Start the fiber now, so that the stream receives the events of the sends below
  const all = yield* actor.emissions.pipe(Stream.runCollect, Effect.forkScoped({ startImmediately: true }))
  yield* actor.send({ type: "PING" })
  yield* actor.send({ type: "PING" })
  // The stream ends when the actor stops
  yield* actor.stop
  return yield* Fiber.join(all) // [{ type: "pong" }, { type: "pong" }]
})

void Effect.runPromise(Effect.scoped(program))
```

### select

**Type:** `<TSelected>(selector: (snapshot: TSnapshot) => TSelected, equalityFn?: (a: TSelected, b: TSelected) => boolean) => Readable<TSelected>`

**Completes:** `select` is synchronous. The selector runs only when the result is read or
subscribed to.

**Fails with:** nothing.

`equalityFn` decides whether a new value differs from the last value given. Default:
`Object.is`. The members of `Readable<T>`:

| Member | Type | Behaviour |
|---|---|---|
| `get` | `Effect.Effect<T>` | The selected value of the snapshot the actor holds now. It never waits. A selector that throws makes it die. |
| `subscribe` | `(observer: (value: T) => Effect.Effect<void>) => Effect.Effect<void, never, Scope.Scope>` | As the actor's `subscribe`: nothing at subscription time, then the selected value of each published snapshot when `equalityFn` finds it different from the last value given. The first "last value" is the value at subscription time. What the selector, `equalityFn` or `observer` throws, fails or dies with is logged, and the subscription goes on. Its calls start and wait as those of the actor's `subscribe`. It ends when the caller's scope closes. |
| `changes` | `Stream.Stream<T, unknown>` | The value of the current snapshot when the stream runs, then each value that `equalityFn` finds different from the last value given. It ends and fails as the actor's `changes`. |

```ts
import { Effect, Fiber, Stream } from "effect"
import { assign, createActor, createMachine } from "@jambudipa/xstate-effect"

const counter = createMachine({
  types: {} as { context: { count: number }; events: { type: "INC" } },
  context: { count: 0 },
  on: { INC: { actions: assign({ count: ({ context }) => context.count + 1 }) } }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(counter)
  const isBig = actor.select(({ context }) => context.count > 1)
  // The value changes once: false, then true
  const values = yield* isBig.changes.pipe(Stream.take(2), Stream.runCollect, Effect.forkScoped)
  yield* actor.start
  yield* actor.send({ type: "INC" })
  yield* actor.send({ type: "INC" })
  yield* actor.send({ type: "INC" })
  const now = yield* isBig.get // true
  return [now, yield* Fiber.join(values)] // [true, [false, true]]
})

void Effect.runPromise(Effect.scoped(program))
```

### Value members

These members are plain values, not Effects.

| Member | Type | Value |
|---|---|---|
| `id` | `string` | The `id` option, else the session id. |
| `sessionId` | `string` | `x:<n>`, unique in the actor's system. Each system counts from `x:0`, so two root actors both have `x:0`. |
| `systemId` | `string \| undefined` | The `systemId` option. |
| `system` | `ActorSystemService` | The actor's [system](./actor-system.md). Children share their root's system. |
| `clock` | `ActorSystem.Clock` | The `clock` option, else the system's clock. |
| `logic` | `ActorLogic<TSnapshot, TEvent, never, TEmitted, unknown>` | The logic the actor runs. |
| `src` | `string \| AnyActorLogic` | The `src` option, else the logic. For an invoked or spawned child, the name its parent used. |
| `ref` | `ActorRef<TSnapshot, TEvent, TEmitted>` | The actor itself. |
| `snapshot` | `SubscriptionRef.SubscriptionRef<TSnapshot>` | The holder of the live snapshot. Read snapshots through `getSnapshot`, `changes` or `snapshotStream`. |
| `_parent` | `Option.Option<AnyActorRef>` | The parent, or `None` for a root actor. |
| `_syncSnapshot` | `boolean` | The `syncSnapshot` option. |
| `_system` | `ActorSystemService` | The same value as `system`. |

The actor also has the members of `ActorRefBase` that are not listed here: `sendUntyped`,
`getSnapshotUntyped`, `toJSON` and `pipe`. See [Actor references](./actor-refs.md#actorrefbase).
`String(actor)` gives `Actor(<id>)`, and `JSON.stringify(actor)` gives
`{"xstate$$type":1,"id":"<id>"}`.

```ts
import { Effect, Option } from "effect"
import { createActor, createMachine } from "@jambudipa/xstate-effect"

const idle = createMachine({ initial: "idle", states: { idle: {} } })

const program = Effect.gen(function* () {
  const actor = yield* createActor(idle, { systemId: "main" })
  const found = yield* actor.system.get("main")
  return {
    id: actor.id, // "x:0"
    sessionId: actor.sessionId, // "x:0"
    systemId: actor.systemId, // "main"
    isRoot: Option.isNone(actor._parent), // true
    registered: Option.isSome(found) // true
  }
})

void Effect.runPromise(Effect.scoped(program))
```

## isActor

**Type:** `(u: unknown) => u is Actor.Actor.Any`

**Gives:** `true` for an object that carries the actor type id (`ActorTypeId`), which every actor
that `createActor` or a parent builds has.

```ts
import { isActor } from "@jambudipa/xstate-effect"

export const describe = (value: unknown): string => (isActor(value) ? `actor ${value.id}` : "not an actor")
```

## The Actor class and actor types

| Name | Description |
|---|---|
| `Actor` (value) | The class of every actor: `actor instanceof Actor` is `true` for each actor that `createActor` or a parent builds. `new Actor(...)` does not compile. Its static members are `make`, `createActor`, `isActor` and `ActorTypeId`, and the engine members `allocateChild`, `buildChild`, `restoreChild` and `createSpawnFunction`. |
| `Actor.Actor<TSnapshot, TEvent, TEmitted>` | The actor type. Invariant in `TSnapshot` and `TEvent`, covariant in `TEmitted` (default `EventObject`). Also exported as `ActorType`. |
| `Actor.Actor.SnapshotOf<T>`, `Actor.Actor.EventOf<T>`, `Actor.Actor.EmittedOf<T>` | The snapshot, event and emitted types of an actor type. |
| `Actor.Actor.Any` | `Actor.Actor<Snapshot, EventObject>`. |
| `AnyActor` | A structural type that every actor fits: the members of `AnyActorRef`, and `id`, `sessionId`, `getSnapshot`, `changes`, `start` and `stop`. Its snapshot type, `AnyActor.Snapshot`, is a `Snapshot` with optional `value`, `context` and `children`. |
| `Readable<T>` | The result of [`select`](#select). |
| `MakeActor` | The type of `createActor`, with the four signatures in [createActor](#createactor). |
| `ActorTypeId` | The unique symbol that marks an actor. |
| `ProcessingStatus` | `"not-started" \| "running" \| "stopped"`: whether the actor has started, runs, or has ended. The `Types.ProcessingStatus` object holds the three values as `NotStarted`, `Running` and `Stopped`. No member of the actor gives it. |

```ts
import { Effect } from "effect"
import { Actor, type AnyActor, createActor, createMachine } from "@jambudipa/xstate-effect"

const idle = createMachine({ initial: "idle", states: { idle: {} } })

const startAll = (actors: ReadonlyArray<AnyActor>) => Effect.forEach(actors, (actor) => actor.start, { discard: true })

const program = Effect.gen(function* () {
  const first = yield* createActor(idle)
  const second = yield* createActor(idle)
  yield* startAll([first, second])
  return first instanceof Actor // true
})

void Effect.runPromise(Effect.scoped(program))
```

## Related

- [Actor references](./actor-refs.md) — the members an actor shares with every reference.
- [The actor system](./actor-system.md) — `actor.system` and its members.
- [Inspection events](./inspection.md) — what the `inspect` option receives.
- [Persisted snapshots](./persistence.md) — `getPersistedSnapshot` and the `snapshot` option.
- [How to react to snapshot changes](../how-to/react-to-snapshot-changes.md)
- [Actor lifetimes and scopes](../explanation/actor-lifetimes-and-scopes.md)
- [How an actor processes events](../explanation/event-processing.md)
