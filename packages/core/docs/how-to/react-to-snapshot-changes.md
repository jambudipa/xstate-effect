---
title: How to react to snapshot changes
doc-type: how-to
sources: [packages/core/src/Actor.ts]
---

# How to react to snapshot changes

> **TL;DR:** Run `actor.changes` as a `Stream` to receive the current snapshot and then each new
> one, until the actor is done or stopped. Pass `actor.subscribe` a function that returns an
> Effect to run it for each snapshot published after the call. Use `actor.select` to react to one
> derived value only when it changes. Attach before `start`, so that no snapshot is missed.

## When you need this

Use this when other code must follow an actor as it runs: to update a view, write an audit log,
save the actor after each step, or start other work when the actor enters a state. To wait once
for one state, use [How to wait for a state or an output](wait-for-a-state.md) instead.

## Before you start

- You create the actor with `createActor` inside a `Scope`, as usual.
- Pick the form that fits:
  - `actor.changes` is a `Stream`: it starts with the snapshot the actor holds, ends after the
    done or stopped snapshot, and fails with the actor's error. Use it when you need Stream
    operators, or need to know that the actor ended.
  - `actor.subscribe(callback)` runs the callback for each snapshot published after the call,
    until the caller's scope closes. It never receives a snapshot with status `error` or `stopped`.
  - `actor.select(selector, equalityFn?)` derives one value, and gives it as `get`, `subscribe`
    and `changes`, only when the value changes.

## Steps

1. Create the actor.
2. Fork `actor.changes` with `Stream.runForEach` and `Effect.forkScoped`, before you start the
   actor. The fiber then lives until the actor ends or the scope closes.
3. Start the actor and send it events. The handler receives each snapshot the actor publishes, one
   for each event the actor processes.
4. Join the fiber when you need to wait until the actor ends. The stream ends after the snapshot
   with status `done` or `stopped`.

```ts
import { Effect, Fiber, Stream } from "effect"
import { assign, createActor, createMachine } from "@jambudipa/xstate-effect"

const counterMachine = createMachine({
  types: {} as { context: { count: number }; events: { type: "increment" } | { type: "finish" } },
  id: "counter",
  initial: "active",
  context: { count: 0 },
  states: {
    active: {
      on: {
        increment: { actions: assign({ count: ({ context }) => context.count + 1 }) },
        finish: "finished"
      }
    },
    finished: { type: "final" }
  }
})

const program = Effect.gen(function* () {
  // 1. Create the actor
  const actor = yield* createActor(counterMachine)

  // 2. Fork the stream before `start`
  const watcher = yield* actor.changes.pipe(
    Stream.runForEach((snapshot) => Effect.log(snapshot.value, snapshot.context.count, snapshot.status)),
    Effect.forkScoped
  )

  // 3. Start the actor and send it events
  yield* actor.start
  yield* actor.send({ type: "increment" })
  yield* actor.send({ type: "finish" })

  // 4. The stream ends after the done snapshot
  yield* Fiber.join(watcher)
})

void Effect.runPromise(Effect.scoped(program))
// Logs: active 0 active, then active 1 active, then finished 1 done
```

## Variations

### Run a callback for each snapshot

`actor.subscribe` takes a function that returns an Effect. A callback attached before `start`
receives the snapshot the actor starts from once, at `start`, then one snapshot for each processed
event. The subscription ends when the scope that ran `subscribe` closes.

```ts
import { Effect } from "effect"
import { assign, createActor, createMachine } from "@jambudipa/xstate-effect"

const counterMachine = createMachine({
  types: {} as { context: { count: number }; events: { type: "increment" } },
  id: "counter",
  initial: "active",
  context: { count: 0 },
  states: {
    active: {
      on: { increment: { actions: assign({ count: ({ context }) => context.count + 1 }) } }
    }
  }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(counterMachine)
  yield* actor.subscribe((snapshot) => Effect.log("count", snapshot.context.count))
  yield* actor.start
  yield* actor.send({ type: "increment" })
  yield* actor.send({ type: "increment" })
})

void Effect.runPromise(Effect.scoped(program))
// Logs: count 0, count 1, count 2
```

- A callback that fails, dies or throws is reported through the logger, and the subscription goes
  on.
- The callback never sees the actor's error. When the actor errors while a `subscribe` callback
  is attached, the actor reports the error through its logger. Use `changes` to handle the error
  yourself.

### React to one derived value

`actor.select(selector, equalityFn)` maps each snapshot to a value. Its `subscribe` and `changes`
give the value only when `equalityFn` finds it different from the last one given; the default is
`Object.is`. Pass an equality function when the selector builds a new object each time. `get`
reads the value from the snapshot the actor holds now.

```ts
import { Effect } from "effect"
import { assign, createActor, createMachine } from "@jambudipa/xstate-effect"

const formMachine = createMachine({
  types: {} as {
    context: { name: string; touched: number }
    events: { type: "edit"; name: string } | { type: "blur" }
  },
  id: "form",
  context: { name: "", touched: 0 },
  on: {
    edit: { actions: assign({ name: ({ event }) => event.name }) },
    blur: { actions: assign({ touched: ({ context }) => context.touched + 1 }) }
  }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(formMachine)
  const name = actor.select((snapshot) => snapshot.context.name)
  yield* name.subscribe((value) => Effect.log("name is now", value))
  yield* actor.start
  yield* actor.send({ type: "edit", name: "Ada" })
  yield* actor.send({ type: "blur" }) // the name does not change: no log
  return yield* name.get // "Ada"
})

void Effect.runPromise(Effect.scoped(program))
```

### Handle the actor's error

The `changes` stream fails with the value the actor failed with (the raw error, not a wrapper),
also when the stream runs after the error. Catch it on the Effect that runs the stream. A running
`changes` stream counts as an error listener, so the actor then reports nothing through its logger.

```ts
import { Effect, Fiber, Stream } from "effect"
import { createActor, createMachine } from "@jambudipa/xstate-effect"

const jobMachine = createMachine({
  types: {} as { events: { type: "run" } },
  id: "job",
  on: {
    run: {
      actions: () => {
        throw new Error("the job failed")
      }
    }
  }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(jobMachine)
  const watcher = yield* actor.changes.pipe(
    Stream.runForEach((snapshot) => Effect.log(snapshot.status)),
    Effect.catch((error) => Effect.logError("the actor failed", error)),
    Effect.forkScoped
  )
  yield* actor.start
  yield* actor.send({ type: "run" })
  yield* Fiber.join(watcher)
})

void Effect.runPromise(Effect.scoped(program))
```

[How to handle actor errors](handle-actor-errors.md) covers the other places an error reaches.

### React to some snapshots only

Use Stream operators on `changes`: `Stream.filter` to keep the snapshots you need,
`Stream.map` and then `Stream.changes` to drop a value equal to the one before it, `Stream.take` to
stop after a number of values.

```ts
import { Effect, Stream } from "effect"
import { createActor, createMachine } from "@jambudipa/xstate-effect"

const lightMachine = createMachine({
  types: {} as { events: { type: "next" } },
  id: "light",
  initial: "green",
  states: {
    green: { tags: ["go"], on: { next: "yellow" } },
    yellow: { on: { next: "red" } },
    red: { on: { next: "green" } }
  }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(lightMachine)
  yield* actor.changes.pipe(
    Stream.map((snapshot) => snapshot.hasTag("go")),
    Stream.changes,
    Stream.runForEach((canGo) => Effect.log(canGo ? "go" : "stop")),
    Effect.forkScoped
  )
  yield* actor.start
  yield* actor.send({ type: "next" })
  yield* actor.send({ type: "next" })
  yield* actor.send({ type: "next" })
})

void Effect.runPromise(Effect.scoped(program))
// Logs: go, stop, go
```

### Attach to an actor that already runs

`subscribe` and a forked stream each run in a fiber of their own, and on a running actor that fiber
can start after your next `send` returns. Until it starts, the snapshots the actor publishes reach
a `subscribe` callback late, and a `changes` stream starts from the snapshot the actor holds when
the fiber starts, so it misses the ones before. When the scope closes before the fiber starts, the
callback never runs. Attach before `start` when you can. When the actor runs already, yield once
with `Effect.yieldNow` after you attach, before you send the next event:

```ts
import { Effect } from "effect"
import { createActor, createMachine } from "@jambudipa/xstate-effect"

const toggleMachine = createMachine({
  types: {} as { events: { type: "toggle" } },
  id: "toggle",
  initial: "off",
  states: {
    off: { on: { toggle: "on" } },
    on: { on: { toggle: "off" } }
  }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(toggleMachine)
  yield* actor.start
  yield* actor.subscribe((snapshot) => Effect.log(snapshot.value))
  yield* Effect.yieldNow
  yield* actor.send({ type: "toggle" })
})

void Effect.runPromise(Effect.scoped(program))
// Logs: on
```

### Stop reacting before the actor ends

Interrupt the forked fiber with `Fiber.interrupt`, or bound the stream with `Stream.take` or
`Stream.takeUntil`. For `subscribe`, run it in a shorter scope (`Effect.scoped`) that closes when
you no longer need the callback.

## Related

- [createActor and the actor](../reference/create-actor.md): `changes`, `subscribe` and `select`.
- [Snapshots](../reference/snapshots.md): the fields each snapshot holds.
- [How to wait for a state or an output](wait-for-a-state.md)
- [How to persist and restore an actor](persist-and-restore-an-actor.md)
- [How to emit events and listen to them](emit-and-listen-to-events.md): for events that the
  machine emits, which are not snapshots.
- [Actor lifetimes and scopes](../explanation/actor-lifetimes-and-scopes.md)
