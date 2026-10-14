---
title: How to emit events and listen to them
doc-type: how-to
sources: [packages/core/src/actions/emit.ts, packages/core/src/Actor.ts]
---

# How to emit events and listen to them

> **TL;DR:** Declare the events in `types.emitted`, add `emit(event)` to an action list, and listen with `yield* actor.on("<type>", handler)`, where the handler returns an Effect. The listener lasts until the `Scope` it ran in closes. For Stream combinators, read `actor.emissions` instead. Listeners run after the macrostep that emits commits, so they see the new snapshot.

## When you need this

Code outside a machine needs to hear about something the machine did (a payment arrived, a document was saved) without sending the machine an event and without comparing snapshots. An emitted event goes only to the listeners of that actor: the machine does not process it, and its parent does not receive it. To notify another actor, send it an event instead; see [How to send events between actors](./send-events-between-actors.md).

## Before you start

- A machine built with `setup(...).createMachine(...)`. A plain `createMachine` works too, but its `emit` then accepts any event object.
- An Effect program that creates the actor in a `Scope`, as every actor needs.

## Steps

1. **Declare the emitted events** in `setup({ types: { emitted: … } })`. `emit` in that machine's config then accepts only those events, and the listeners receive them typed.
2. **Emit** with `emit(event)` in an action list. Pass a function of the action arguments to build the event from the context or the event.
3. **Listen** with `yield* actor.on("<type>", handler)`. The handler receives the event, narrowed to that type, and returns an Effect.
4. **Choose the listener's lifetime.** The listener stays until the `Scope` that `actor.on` ran in closes. Register it before `start` to hear the events that the initial actions emit.

```ts
import { assign, createActor, emit, setup } from "@jambudipa/xstate-effect"
import { Console, Effect } from "effect"

const checkout = setup({
  types: {} as {
    context: { total: number }
    events: { type: "PAY"; amount: number }
    emitted: { type: "payment.received"; amount: number } | { type: "total.changed"; total: number }
  },
}).createMachine({
  id: "checkout",
  context: { total: 0 },
  on: {
    PAY: {
      actions: [
        assign({ total: ({ context, event }) => context.total + event.amount }),
        emit(({ event }) => ({ type: "payment.received", amount: event.amount })),
        emit(({ context }) => ({ type: "total.changed", total: context.total })),
      ],
    },
  },
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(checkout)
  yield* actor.on("payment.received", (event) => Console.log(`received ${event.amount}`))
  yield* actor.on("total.changed", (event) => Console.log(`total is now ${event.total}`))
  yield* actor.start
  yield* actor.send({ type: "PAY", amount: 20 })
  // received 20
  // total is now 20
})

export const main = Effect.runPromise(Effect.scoped(program))
```

The listeners run before `yield* actor.send(...)` returns. They run one at a time, in the order of the `emit` actions, and each one reads the snapshot that the macrostep committed.

## Variations

### Listen to every emitted event

Pass `"*"` as the type. For each event, the listeners of its own type run first, then the `"*"` listeners, each group in the order they were added.

```ts
import { createActor, createMachine, emit } from "@jambudipa/xstate-effect"
import { Console, Effect } from "effect"

const door = createMachine({
  on: {
    OPEN: { actions: emit({ type: "door.opened" }) },
    CLOSE: { actions: emit({ type: "door.closed" }) },
  },
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(door)
  yield* actor.on("*", (event) => Console.log(event.type))
  yield* actor.start
  yield* actor.send({ type: "OPEN" })
  yield* actor.send({ type: "CLOSE" })
})

export const main = Effect.runPromise(Effect.scoped(program))
```

### Listen for part of the program only

Run `actor.on` inside its own `Effect.scoped`. The listener is removed when that inner scope closes, and the actor goes on.

```ts
import { createActor, createMachine, emit } from "@jambudipa/xstate-effect"
import { Console, Effect } from "effect"

const bell = createMachine({ on: { RING: { actions: emit({ type: "rang" }) } } })

const program = Effect.gen(function* () {
  const actor = yield* createActor(bell)
  yield* actor.start
  yield* Effect.scoped(
    Effect.gen(function* () {
      yield* actor.on("rang", () => Console.log("heard it"))
      yield* actor.send({ type: "RING" }) // heard it
    })
  )
  yield* actor.send({ type: "RING" }) // no output: the listener is gone
})

export const main = Effect.runPromise(Effect.scoped(program))
```

### Read the events as a Stream

`actor.emissions` is a `Stream` of every emitted event. It gives only the events emitted after the stream starts to run, and it ends when the actor ends: after a stop, a done snapshot or an error. A stream forked with `Effect.forkScoped` starts later, after the sends that follow the fork, so fork it with `{ startImmediately: true }` before you send. To end it before the actor ends, bound it with `Stream.take` or `Stream.takeUntil`, or close the scope that the fork belongs to.

```ts
import { createActor, createMachine, emit } from "@jambudipa/xstate-effect"
import { Console, Effect, Fiber, Stream } from "effect"

const sensor = createMachine({
  on: { READ: { actions: emit({ type: "reading", value: 21 }) } },
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(sensor)
  yield* actor.start
  const readings = yield* actor.emissions.pipe(
    Stream.runCollect,
    Effect.forkScoped({ startImmediately: true })
  )
  yield* actor.send({ type: "READ" })
  yield* actor.send({ type: "READ" })
  // The stream ends when the actor stops, so the collection completes
  yield* actor.stop
  yield* Console.log(yield* Fiber.join(readings))
  // [{ type: "reading", value: 21 }, { type: "reading", value: 21 }]
})

export const main = Effect.runPromise(Effect.scoped(program))
```

### Emit from `enqueueActions`

Inside `enqueueActions`, use `enqueue.emit(event)`. It takes the same events as `emit`.

```ts
import { enqueueActions, setup } from "@jambudipa/xstate-effect"

export const stock = setup({
  types: {} as {
    context: { level: number }
    events: { type: "TAKE"; amount: number }
    emitted: { type: "stock.low"; level: number }
  },
}).createMachine({
  context: { level: 10 },
  on: {
    TAKE: {
      actions: enqueueActions(({ context, event, enqueue }) => {
        const level = context.level - event.amount
        enqueue.assign({ level })
        if (level < 3) {
          enqueue.emit({ type: "stock.low", level })
        }
      }),
    },
  },
})
```

### Listen to a child actor

A child's reference has the same `on`. Find the child through `snapshot.children` or `actor.system.get("<systemId>")`, then call `on` on it.

```ts
import { createActor, emit, setup } from "@jambudipa/xstate-effect"
import { Console, Effect, Option } from "effect"

const notifier = setup({
  types: {} as { events: { type: "PING" }; emitted: { type: "pinged" } },
}).createMachine({
  on: { PING: { actions: emit({ type: "pinged" }) } },
})

const app = setup({ actors: { notifier } }).createMachine({
  invoke: { src: "notifier", systemId: "notifier" },
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(app)
  yield* actor.start
  const found = yield* actor.system.get("notifier")
  yield* Option.match(found, {
    onNone: () => Effect.void,
    onSome: (child) =>
      Effect.andThen(
        child.on("pinged", (event) => Console.log(`child emitted ${event.type}`)),
        child.send({ type: "PING" })
      ),
  })
})

export const main = Effect.runPromise(Effect.scoped(program))
```

## Things to check

- **A failing listener does not stop the others.** A handler that fails, dies or throws is reported through the actor's logger; the other listeners and the actor carry on.
- **Each registration counts.** Registering the same handler twice makes it run twice for each event.
- **Do not call `emit(...)` inside an inline action function.** The action creator only builds an action; calling it there logs a warning and emits nothing. Put `emit(...)` in the action list, or use `enqueue.emit` inside `enqueueActions`.

## Related

- [emit](../reference/actions/emit.md): the action and its typing rules.
- [createActor and the actor](../reference/create-actor.md): `on`, `emissions` and the other members of an actor.
- [How to react to snapshot changes](./react-to-snapshot-changes.md): following state instead of events.
- [How an actor processes events](../explanation/event-processing.md): what a macrostep is, and why listeners run after it commits.
