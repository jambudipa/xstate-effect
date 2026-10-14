---
title: The actor system
doc-type: reference
sources: [packages/core/src/ActorSystem.ts]
---

# The actor system

> **TL;DR:** Each root actor creates one actor system, and every actor that it invokes or
> spawns, at any depth, joins it. The system registers actors by `systemId` (`get`, `getAll`),
> schedules delayed events (`scheduler`, `getSnapshot`), and sends inspection events to the
> functions that `inspect` registers. Read it as `actor.system`, or as `system` in the
> arguments of an action or a guard.

The root of `@jambudipa/xstate-effect` exports `ActorSystem` both as a type and as the module
namespace. `ActorSystem<T>` is the [typed system](#typed-systems); `ActorSystem.makeActorSystem`,
`ActorSystem.Clock` and the other module members are reached through the namespace, and some of
them also have their own root names (see the table).

## Summary

### The system service

| Name | Kind | Summary |
|---|---|---|
| [`ActorSystemService`](#actorsystemservice) | interface | The system of an actor: `actor.system`, `system` in action and guard arguments. |
| [`SchedulerService`](#schedulerservice) | interface | The delayed-event scheduler of a system: `system.scheduler`. |
| [`ScheduledEvent`](#scheduledevent) | interface (`ActorLogic.ScheduledEvent`) | One pending delayed event. |
| [`SystemSnapshot`](#systemsnapshot) | interface (`ActorLogic.SystemSnapshot`) | What `system.getSnapshot` gives. |
| [`ActorSystemInfo`](#typed-systems) | interface | The actors a system declares, by `systemId`. |
| [`ActorSystem<T>`](#typed-systems) | type | A system whose `get` and `getAll` are typed by `T`. |

### The ActorSystem module

| Module member | Root name | Kind | Summary |
|---|---|---|---|
| [`ActorSystem.Clock`](#clock) | — | interface | A timer clock: `setTimeout` and `clearTimeout`. |
| [`ActorSystem.ActorSystemOptions`](#makeactorsystem) | — | interface | The options of `makeActorSystem`. |
| [`ActorSystem.makeActorSystem`](#makeactorsystem) | `makeActorSystem` | function | Creates a standalone system. |
| [`ActorSystem.ActorSystem`](#layers-and-tags) | `ActorSystemTag` | service tag | The tag of an `ActorSystemService`. |
| [`ActorSystem.Scheduler`](#layers-and-tags) | `SchedulerTag` | service tag | The tag of a `SchedulerService`. |
| [`ActorSystem.SchedulerLive`](#layers-and-tags) | `SchedulerLive` | layer | `Layer<Scheduler>`. |
| [`ActorSystem.ActorSystemLive`](#layers-and-tags) | `ActorSystemLive` | layer | `Layer<ActorSystem, never, Scheduler>`. |
| [`ActorSystem.Live`](#layers-and-tags) | `ActorSystemLiveFull` | layer | `Layer<ActorSystem \| Scheduler>`. |

## Systems and actors

- An actor without a `parent` (a root actor) creates a new system when `createActor` runs. An
  actor with a `parent` joins the parent's system.
- `createActor` never reads an `ActorSystemTag` service from the Effect context. Two root actors
  therefore never share a system.
- The system books session ids `x:0`, `x:1`, … in creation order. The first id belongs to the
  root actor.
- The system keeps two registries: every started actor by session id, and the actors that have
  a `systemId`, by `systemId`. `get` and `getAll` read only the second one.
- An actor with a `systemId` is registered under it at creation, and again at `start` while its
  snapshot is active. An actor whose initial snapshot is not active gives it up at once.
- An actor leaves both registries when it stops, is done or errors, and when its parent stops
  it (its descendants first). Its `systemId` is then free for another actor.

## ActorSystemService

| Member | Type | Description |
|---|---|---|
| [`get`](#get) | `<T extends ActorRefBase = AnyActorRef>(systemId: string) => Effect.Effect<Option.Option<T>>` | The actor registered under `systemId`. |
| [`getAll`](#getall) | `Effect.Effect<Readonly<Record<string, ActorRefBase>>>` | Every actor registered under a `systemId`. |
| [`getSnapshot`](#getsnapshot) | `Effect.Effect<SystemSnapshot>` | The pending delayed events. |
| [`inspect`](#inspect) | `(observer: (event: InspectionEvent) => Effect.Effect<void>) => Effect.Effect<void, never, Scope.Scope>` | Registers an inspection function. |
| [`scheduler`](#schedulerservice) | `SchedulerService` | The system's scheduler. |
| [`relay`](#relay) | `(source: ActorRefBase, target: ActorRefBase, event: EventObject) => Effect.Effect<void>` | Sends an event from one actor to another. |
| `generateId` | `Effect.Effect<string>` | Books the next session id, `x:<n>`. `createActor` calls it. |
| `register` | `(sessionId: string, actor: ActorRefBase) => Effect.Effect<string>` | Registers an actor under its session id and gives the session id back. `start` calls it. |
| `unregister` | `(actor: ActorRefBase) => Effect.Effect<void>` | Removes an actor and its `systemId` from the registries. |
| `_set` | `(systemId: string, actor: ActorRefBase) => Effect.Effect<void, ActorError>` | Registers an actor under a `systemId`. The same actor again changes nothing. Another actor under a key in use fails with an `ActorError`: `Actor with system ID '<systemId>' already exists.` |
| `_lookup` | `(systemId: string) => Option.Option<ActorRefBase>` | The synchronous form of `get`, for the engine. |
| `_clock` | `ActorSystem.Clock` | The root actor's `clock` option, else a clock on the Effect clock. |
| `_logger` | `Option.Option<(...args: ReadonlyArray<unknown>) => void>` | The root actor's `logger` option, which the `log` actions of the system call, or `None` for Effect logging. |
| `_sendInspectionEvent` | `(event) => Effect.Effect<void>` | Hands an inspection event to every inspection function, with `rootId` added. The actors call it. |

`generateId`, `register`, `unregister`, `_set`, `_lookup` and `_sendInspectionEvent` serve the
actors of the system; `createActor`, `start` and `stop` call them.

### get

**Completes:** at once.

**Fails with:** nothing.

**Gives:** `Some` of the actor registered under `systemId`, else `None`. The default type
argument is `AnyActorRef`, whose `send` takes any event object. A session id is not a key of
this registry.

```ts
import { Effect, Option } from "effect"
import { createActor, createMachine } from "@jambudipa/xstate-effect"

const logger = createMachine({
  types: {} as { events: { type: "LOG"; text: string } },
  on: { LOG: {} }
})
const app = createMachine({
  invoke: { src: logger, systemId: "logger" }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(app)
  yield* actor.start
  const found = yield* actor.system.get("logger")
  yield* Option.match(found, {
    onNone: () => Effect.void,
    onSome: (ref) => ref.send({ type: "LOG", text: "hello" })
  })
})

void Effect.runPromise(Effect.scoped(program))
```

### getAll

**Completes:** at once.

**Fails with:** nothing.

**Gives:** a new record of every actor that is registered under a `systemId`, keyed by
`systemId`, in registration order. Actors without a `systemId` are not in it. A change to the
record does not change the system.

```ts
import { Effect } from "effect"
import { createActor, createMachine } from "@jambudipa/xstate-effect"

const idle = createMachine({ initial: "idle", states: { idle: {} } })

const program = Effect.gen(function* () {
  const actor = yield* createActor(idle, { systemId: "main" })
  yield* actor.start
  return Object.keys(yield* actor.system.getAll) // ["main"]
})

void Effect.runPromise(Effect.scoped(program))
```

### getSnapshot

**Completes:** at once.

**Fails with:** nothing.

**Gives:** a [`SystemSnapshot`](#systemsnapshot): a copy of the pending delayed events of every
actor of the system, keyed `<sessionId>.<id>`. An event leaves it when it fires or is cancelled.

```ts
import { Effect } from "effect"
import { createActor, createMachine } from "@jambudipa/xstate-effect"

const timer = createMachine({
  id: "timer",
  initial: "waiting",
  states: {
    waiting: { after: { 1000: "late" } },
    late: {}
  }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(timer)
  yield* actor.start
  const { _scheduledEvents } = yield* actor.system.getSnapshot
  return Object.keys(_scheduledEvents) // ["x:0.xstate.after.1000.timer.waiting"]
})

void Effect.runPromise(Effect.scoped(program))
```

### inspect

**Completes:** at once, once the function is registered.

**Fails with:** nothing.

- The function receives every [inspection event](./inspection.md) of the system until the
  caller's scope closes. The close removes only this registration.
- Each call is a separate registration, also for a function that is registered already.
- The functions run one after another for each event, in registration order. The `inspect`
  option of the root actor is registered first.
- A function that throws, fails or dies is reported once with `Effect.logError`, through the
  Effect `Logger` of the fiber that runs it; the `logger` option does not receive the report.
  It changes nothing for the actors or for the other functions.

```ts
import { Effect } from "effect"
import { createActor, createMachine } from "@jambudipa/xstate-effect"

const idle = createMachine({ initial: "idle", states: { idle: {} } })

const program = Effect.gen(function* () {
  const actor = yield* createActor(idle)
  yield* actor.system.inspect((event) => Effect.log(`${event.type} on ${event.actorRef.id}`))
  yield* actor.start
})

void Effect.runPromise(Effect.scoped(program))
```

### relay

**Completes:** once the event is queued for `target`.

**Fails with:** nothing.

The inspection functions receive the event as `@xstate.event` with `source` as its
`sourceRef`, then `target` receives it through `sendUntyped`. The built-in actions that send
to another actor, delayed events and the events a child sends to its parent go through it.

```ts
import type { ActorSystemService, AnyActorRef } from "@jambudipa/xstate-effect"

export const ping = (system: ActorSystemService, from: AnyActorRef, to: AnyActorRef) =>
  system.relay(from, to, { type: "PING" })
```

## SchedulerService

`system.scheduler`. Every member is an Effect that completes at once and never fails.

| Member | Type | Description |
|---|---|---|
| `schedule` | `(source: ActorRefBase, target: ActorRefBase, event: EventObject, delayMs: number, id: Option.Option<string>) => Effect.Effect<void>` | Schedules `event` from `source` to `target` after `delayMs` milliseconds, under `id`, or under a new id `xstate.scheduled.<n>` that no pending event of `source` holds. |
| `cancel` | `(source: ActorRefBase, id: string) => Effect.Effect<void>` | Clears the pending event `id` of `source`: it never fires. An id that is not pending changes nothing. |
| `cancelAll` | `(actor: ActorRefBase) => Effect.Effect<void>` | Cancels every pending event that `actor` scheduled. Events that other actors scheduled for `actor` stay. An actor's end runs it. |
| `resume` | `(scheduled: ScheduledEvent) => Effect.Effect<void>` | Schedules a restored event again with its id, `delay` and `startedAt`: it fires after `startedAt + delay` minus the clock's time now, or at once when that time has passed. |
| `scheduledEvents` | `Effect.Effect<Readonly<Record<string, ScheduledEvent>>>` | A new record of the pending events, keyed `<sessionId>.<id>`, in the order their keys were first recorded. |

- An event is keyed `<sessionId>.<id>` of the actor that scheduled it.
- An `after` transition uses the id `xstate.after.<delay>.<state node id>`.
- Scheduling an id that is already pending keeps the older timer running: both events fire, and
  `cancel` of the id clears only the newer one.
- A timer that fires removes its key before it delivers the event.

```ts
import { Option } from "effect"
import type { ActorSystemService, AnyActorRef } from "@jambudipa/xstate-effect"

export const remindLater = (system: ActorSystemService, self: AnyActorRef) =>
  system.scheduler.schedule(self, self, { type: "REMIND" }, 5000, Option.some("reminder"))

export const forget = (system: ActorSystemService, self: AnyActorRef) => system.scheduler.cancel(self, "reminder")
```

## ScheduledEvent

`ActorLogic.ScheduledEvent`: one pending delayed event. It fires at `startedAt + delay`.

| Field | Type | Description |
|---|---|---|
| `source` | `ActorRefBase` | The actor that scheduled the event. Its session id is part of the key. |
| `target` | `ActorRefBase` | The actor the event goes to: the source itself for a delayed `raise`. |
| `event` | `EventObject` | The event to deliver. |
| `delay` | `number` | The delay in milliseconds. A restored event keeps it. |
| `id` | `string` | The action's `id`, or a generated `xstate.scheduled.<n>`. `cancel` takes it. |
| `startedAt` | `number` | The clock's time in milliseconds when the event was scheduled. |

```ts
import type { ActorLogic } from "@jambudipa/xstate-effect"

export const dueAt = (event: ActorLogic.ScheduledEvent): number => event.startedAt + event.delay
```

## SystemSnapshot

`ActorLogic.SystemSnapshot`: what `system.getSnapshot` gives.

| Field | Type | Description |
|---|---|---|
| `_scheduledEvents` | `Readonly<Record<string, ScheduledEvent>>` | The pending delayed events, keyed `<sessionId>.<id>`: a copy taken at the read. |

```ts
import type { ActorLogic } from "@jambudipa/xstate-effect"

export const pendingCount = (snapshot: ActorLogic.SystemSnapshot): number =>
  Object.keys(snapshot._scheduledEvents).length
```

## Typed systems

`ActorSystem<T extends ActorSystemInfo>` is `ActorSystemService` with `get` and `getAll` typed
by the actors that `T` declares. `ActorSystemInfo` has one field:

| Field | Type | Description |
|---|---|---|
| `actors` | `Readonly<Record<string, ActorRefBase>>` | The reference type of each declared actor, by `systemId`. |

| Member | Type |
|---|---|
| `get` | `<K extends keyof T["actors"] & string>(systemId: K) => Effect.Effect<Option.Option<T["actors"][K]>>` |
| `getAll` | `Effect.Effect<Partial<T["actors"]>>` |

The other members are those of `ActorSystemService`. An `ActorSystemService` value is not
assignable to `ActorSystem<T>` without a type assertion: the type describes what the code
expects the system to hold, and nothing checks it at run time.

```ts
import type { ActorRef, ActorSystem, Snapshot } from "@jambudipa/xstate-effect"

type AppSystem = ActorSystem<{
  actors: { receiver: ActorRef<Snapshot, { type: "HELLO" }> }
}>

// `get` accepts only the declared keys, and gives the declared reference type
export const greet = (system: AppSystem) => system.get("receiver")
```

## Clock

`ActorSystem.Clock`: a clock that starts and clears timers. The host's `setTimeout` and
`clearTimeout` make one, and so does [`SimulatedClock`](./testing/simulated-clock.md).

| Member | Type | Description |
|---|---|---|
| `setTimeout` | `(fn: () => void, timeout: number) => unknown` | Calls `fn` once after `timeout` milliseconds. The id it gives is opaque: only this clock's `clearTimeout` reads it. |
| `clearTimeout` | `(id: unknown) => void` | Clears the timer of an id that `setTimeout` gave. A fired or unknown id is ignored. |

- Pass a clock to a root actor with the `clock` option: its system then starts every delayed
  event on it. Without one, timers run on the Effect clock (`TestClock` in tests).
- A clock that also has a `now()` method, as `SimulatedClock` has, gives the `startedAt` of
  each scheduled event. Otherwise `startedAt` comes from the Effect clock.

```ts
import type { ActorSystem } from "@jambudipa/xstate-effect"

const timers = new Map<number, ReturnType<typeof setTimeout>>()
let nextId = 0

export const hostClock: ActorSystem.Clock = {
  setTimeout: (fn, timeout) => {
    const id = nextId++
    timers.set(id, setTimeout(() => {
      timers.delete(id)
      fn()
    }, timeout))
    return id
  },
  clearTimeout: (id) => {
    if (typeof id === "number") {
      clearTimeout(timers.get(id))
      timers.delete(id)
    }
  }
}
```

## makeActorSystem

**Type:** `(options?: ActorSystem.ActorSystemOptions) => Effect.Effect<ActorSystemService, never, Scope.Scope>`

**Completes:** once the system exists.

**Fails with:** nothing.

**Requires:** `Scope`: the system's timers and its delivery queue live in it, and its close
interrupts the timers.

`ActorSystemOptions`:

| Field | Type | Description |
|---|---|---|
| `clock` | `ActorSystem.Clock` | The clock every delayed event of the system starts on. Default: the Effect clock. |
| `logger` | `(...args: ReadonlyArray<unknown>) => void` | The function every `log` action of the system calls, unless its actor has its own. Errors that nothing handles do not reach it. Default: Effect logging. |

Each root actor creates its own system in this way, with its `clock` and `logger` options. A
system that `makeActorSystem` creates has no actors, and `createActor` does not use it.

```ts
import { Effect } from "effect"
import { makeActorSystem } from "@jambudipa/xstate-effect"

const program = Effect.gen(function* () {
  const system = yield* makeActorSystem()
  return yield* system.generateId // "x:0"
})

void Effect.runPromise(Effect.scoped(program))
```

## Layers and tags

| Root name | Module member | Type | Description |
|---|---|---|---|
| `ActorSystemTag` | `ActorSystem.ActorSystem` | `Context.Service<ActorSystem, ActorSystemService>` | The tag of an `ActorSystemService`. |
| `SchedulerTag` | `ActorSystem.Scheduler` | `Context.Service<Scheduler, SchedulerService>` | The tag of a `SchedulerService`. |
| `SchedulerLive` | `ActorSystem.SchedulerLive` | `Layer.Layer<Scheduler>` | A scheduler with timers on the Effect clock, in the layer's scope. It delivers each event straight to its target, with no inspection event. |
| `ActorSystemLive` | `ActorSystem.ActorSystemLive` | `Layer.Layer<ActorSystem, never, Scheduler>` | A system around the `Scheduler` service of the context. |
| `ActorSystemLiveFull` | `ActorSystem.Live` | `Layer.Layer<ActorSystem \| Scheduler>` | `SchedulerLive` and `ActorSystemLive` together. |

`createActor` does not read these services. An actor's system is always the one its root actor
created.

```ts
import { Effect } from "effect"
import { ActorSystemLiveFull, ActorSystemTag } from "@jambudipa/xstate-effect"

const program = Effect.gen(function* () {
  const system = yield* ActorSystemTag
  return yield* system.getAll // {}
})

void Effect.runPromise(Effect.scoped(Effect.provide(program, ActorSystemLiveFull)))
```

## Related

- [createActor and the actor](./create-actor.md) — the `systemId`, `clock`, `logger` and
  `inspect` options.
- [Inspection events](./inspection.md) — what `system.inspect` receives.
- [How to send events between actors](../how-to/send-events-between-actors.md)
- [How to inspect a running actor system](../how-to/inspect-an-actor-system.md)
- [About the actor model](../explanation/actor-model.md)
