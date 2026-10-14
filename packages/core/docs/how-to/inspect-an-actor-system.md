---
title: How to inspect a running actor system
doc-type: how-to
sources: [packages/core/src/inspection.ts, packages/core/src/ActorSystem.ts, packages/core/src/dev/]
---

# How to inspect a running actor system

> **TL;DR:** Pass an `inspect` function to the root actor's `createActor`. It receives every
> inspection event of the actor's system, children included, and returns an Effect. Narrow each
> event on its `type`. To watch for a limited time, register a function with
> `actor.system.inspect(fn)`, which lasts until the current scope closes. Read the registered
> actors with `system.get` and `system.getAll`, and the pending delayed events with
> `system.getSnapshot`.

## When you need this

You want to see what a running system does: which actors exist, which events they receive, which
transitions and actions they take, and which snapshots they publish. Typical uses are debug
logging, metrics, a visualiser, or a dev tools extension.

## Before you start

- You create and run actors with `createActor` inside `Effect.scoped`.
  [Build your first state machine](../tutorials/01-first-state-machine.md) shows how.
- Each root actor has its own actor system. Its invoked and spawned children join that system.

## Steps

### 1. Pass an inspection function to the root actor

Give the root actor the `inspect` option: a function that takes an `InspectionEvent` and returns
an `Effect<void>`. The system calls it for each inspection event of every actor in the system,
while the root actor's scope is open. The `inspect` option of an actor with a parent has no
effect.

```ts
import { Effect } from "effect"
import { createActor, createMachine, type InspectionEvent } from "@jambudipa/xstate-effect"

const toggleMachine = createMachine({
  types: {} as { events: { type: "TOGGLE" } },
  initial: "off",
  states: {
    off: { on: { TOGGLE: "on" } },
    on: { on: { TOGGLE: "off" } }
  }
})

const logInspection = (event: InspectionEvent): Effect.Effect<void> =>
  Effect.log(`${event.type} on ${event.actorRef.id}`)

const program = Effect.gen(function* () {
  const actor = yield* createActor(toggleMachine, { inspect: logInspection })
  yield* actor.start
  yield* actor.send({ type: "TOGGLE" })
})

void Effect.runPromise(Effect.scoped(program))
```

For this program the function receives six events, in this order:

1. `@xstate.actor`: the root actor exists.
2. `@xstate.event`: the root actor receives `xstate.init`.
3. `@xstate.snapshot`: the root actor publishes its initial snapshot.
4. `@xstate.event`: the root actor receives `TOGGLE`.
5. `@xstate.microstep`: the root actor takes one transition.
6. `@xstate.snapshot`: the root actor publishes the snapshot after `TOGGLE`.

An inspection function that throws, fails or dies is logged once through the Effect logger. The
actors and the other inspection functions go on as before.

### 2. Narrow each event on its type

Every event has `rootId`, the session id of the system's root actor, and `actorRef`, the actor
the event is about. Switch on `type` to read the other fields:

| `type` | When the system sends it | Other fields |
|---|---|---|
| `@xstate.actor` | An actor is created in the system | none |
| `@xstate.event` | An event is sent to `actorRef` | `event`; `sourceRef`, an `Option` of the sending actor, `Option.none()` for an event from outside every actor |
| `@xstate.microstep` | A state machine takes one microstep | `event`, `snapshot`, `_transitions` (the transitions it took) |
| `@xstate.action` | An actor runs an action other than `assign` and `enqueueActions` | `action`, a `{ type, params }` record |
| `@xstate.snapshot` | An actor publishes a snapshot after it processes an event | `event`, `snapshot` |

The union also holds `@xstate.transition`, as XState's does, but no actor sends it.

```ts
import { Effect, Option } from "effect"
import type { InspectionEvent } from "@jambudipa/xstate-effect"

export const describeInspection = (event: InspectionEvent): Effect.Effect<void> => {
  switch (event.type) {
    case "@xstate.actor":
      return Effect.log(`created ${event.actorRef.id}`)
    case "@xstate.event": {
      const from = Option.match(event.sourceRef, { onNone: () => "outside", onSome: (ref) => ref.id })
      return Effect.log(`${from} sent ${event.event.type} to ${event.actorRef.id}`)
    }
    case "@xstate.microstep":
      return Effect.log(`${event.actorRef.id} took ${event._transitions.length} transition(s)`)
    case "@xstate.action":
      return Effect.log(`${event.actorRef.id} runs ${event.action.type}`)
    case "@xstate.snapshot":
      return Effect.log(`${event.actorRef.id} is ${event.snapshot.status} after ${event.event.type}`)
    case "@xstate.transition":
      return Effect.void
  }
}
```

### 3. Inspect for a limited time

To watch a system that is running already, or only for part of its life, register a function
with `actor.system.inspect(fn)`. The registration lasts until the scope that it runs in closes.
Each call adds a separate registration, also for a function that is registered already. The
functions run one after another, in registration order.

```ts
import { Effect } from "effect"
import { createActor, createMachine, type InspectionEvent } from "@jambudipa/xstate-effect"

const toggleMachine = createMachine({
  types: {} as { events: { type: "TOGGLE" } },
  initial: "off",
  states: {
    off: { on: { TOGGLE: "on" } },
    on: { on: { TOGGLE: "off" } }
  }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(toggleMachine)
  yield* actor.start

  const seen: Array<InspectionEvent["type"]> = []
  yield* Effect.scoped(
    Effect.gen(function* () {
      yield* actor.system.inspect((event) => Effect.sync(() => seen.push(event.type)))
      yield* actor.send({ type: "TOGGLE" })
    })
  )

  // The registration ended with its scope: this event is not inspected
  yield* actor.send({ type: "TOGGLE" })
  console.log(seen) // ["@xstate.event", "@xstate.microstep", "@xstate.snapshot"]
})

void Effect.runPromise(Effect.scoped(program))
```

### 4. Read the actors and the pending delayed events

The system keeps a registry of the actors that have a `systemId`, and a record of the delayed
events that are pending. Read them through `actor.system`:

- `system.get(systemId)` gives an `Option` of the actor registered under that id.
- `system.getAll` gives a new record of every actor that has a `systemId`, by `systemId`, in
  registration order. Actors without a `systemId` are not in it.
- `system.getSnapshot` gives `{ _scheduledEvents }`: the pending delayed events, keyed
  `<sessionId>.<id>`, each with its `source`, `target`, `event`, `delay`, `id` and `startedAt`.

```ts
import { Effect, Option } from "effect"
import { createActor, createMachine, raise, setup } from "@jambudipa/xstate-effect"

const timerMachine = createMachine({
  initial: "waiting",
  states: { waiting: { on: { RING: "ringing" } }, ringing: {} }
})

const appMachine = setup({
  actors: { timer: timerMachine }
}).createMachine({
  invoke: { src: "timer", id: "timer", systemId: "timer" },
  entry: raise({ type: "TICK" }, { delay: 1000, id: "tick" })
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(appMachine)
  yield* actor.start

  const timer = yield* actor.system.get("timer")
  console.log(Option.map(timer, (ref) => ref.id)) // Option.some("timer")

  const registered = yield* actor.system.getAll
  console.log(Object.keys(registered)) // ["timer"]

  const { _scheduledEvents } = yield* actor.system.getSnapshot
  console.log(Object.keys(_scheduledEvents)) // ["x:0.tick"]
})

void Effect.runPromise(Effect.scoped(program))
```

## Variations

### Connect a dev tools extension

A dev tools extension that follows XState's convention puts a hook object on the global object as
`__xstate__`. Pass `devTools: true` to `createActor` to register the actor with that hook when it
starts. The registration runs only where a `window` object exists and the hook is installed;
otherwise it does nothing. Children do not inherit the option.

To register an actor yourself, call `registerService(actor)` from the `/dev` entry point. To do
something else at start, pass your own adapter, a function from the actor to an Effect:

```ts
import { Effect } from "effect"
import { createActor, createMachine } from "@jambudipa/xstate-effect"
import { registerService } from "@jambudipa/xstate-effect/dev"

const machine = createMachine({})

const program = Effect.gen(function* () {
  // An adapter of your own runs once, when the actor starts
  const traced = yield* createActor(machine, {
    devTools: (actor) => Effect.log(`started ${actor.id}`)
  })
  yield* traced.start

  // Register an actor with the global hook by hand
  const other = yield* createActor(machine)
  yield* registerService(other).pipe(
    Effect.catchTag("DevToolsError", (error) => Effect.logWarning(error.message))
  )
})

void Effect.runPromise(Effect.scoped(program))
```

`registerService` and the default adapter fail with `DevToolsError` when the hook's `register`
throws, or when the hook has no `register` function. A failure of the adapter that the
`devTools` option calls makes the actor's `start` die, and the actor then processes no event.

## Related

- [Inspection events](../reference/inspection.md): every inspection event and its fields.
- [The actor system](../reference/actor-system.md): `get`, `getAll`, `getSnapshot` and `inspect`.
- [Dev tools entry point](../reference/dev.md): `devToolsAdapter`, `registerService`,
  `getGlobal` and `DevToolsError`.
- [createActor and the actor](../reference/create-actor.md): the `inspect` and `devTools` options.
- [How an actor processes events](../explanation/event-processing.md): what a macrostep and a
  microstep are.
