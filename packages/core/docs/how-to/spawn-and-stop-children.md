---
title: How to spawn and stop child actors
doc-type: how-to
sources: [packages/core/src/actions/spawnChild.ts, packages/core/src/actions/stopChild.ts]
---

# How to spawn and stop child actors

> **TL;DR:** Declare the child's logic in `setup({ actors })`, then start a child with `spawnChild("<name>", { id, input })` in any action list. The child appears in `snapshot.children` under its `id`, and its parent receives `xstate.done.actor.<id>` or `xstate.error.actor.<id>` when it ends. Stop it with `stopChild(id)` or `stopAllChildren()`: only its parent can stop a child, and every child stops with its parent.

## When you need this

Use `spawnChild` when the number of children, or their lifetime, does not follow a state: one child per upload, per connection or per job, created and removed by events. When a child must run exactly while the machine is in one state, an `invoke` on that state is simpler: the machine starts and stops it for you.

## Before you start

- A machine built with `setup(...).createMachine(...)`, with the child's logic in `actors`. Any actor logic works: a machine, `fromEffect`, `fromPromise`, `fromCallback` and the others.
- An id scheme for the children. Each child needs an id that is unique among its siblings.

## Steps

1. **Declare the logic** in `setup({ actors: { download } })`.
2. **Spawn the child** with `spawnChild("download", { id, input })`. Both `id` and `input` may be functions of the action arguments, so they can read the event and the context.
3. **Handle its end.** A child that finishes sends its parent `xstate.done.actor.<id>`; one that fails sends `xstate.error.actor.<id>`. A transition on `xstate.done.actor.*` catches the done event of every child.
4. **Stop the child** with `stopChild(id)`, or with a function that returns the id or the reference.
5. **Remove finished children.** A child that is done stays in `snapshot.children` until it is stopped, so stop it in the transition that handles its done event.

This download manager spawns one child per `ADD` event, cancels a child on `CANCEL`, and records each download that finishes.

```ts
import { assign, createActor, fromEffect, setup, spawnChild, stopChild, waitFor, type DoneActorEvent } from "@jambudipa/xstate-effect"
import { Console, Effect } from "effect"

// A stand-in for a download: it waits `ms` milliseconds, then gives a number
const download = fromEffect(({ input }: { input: { url: string; ms: number } }) =>
  Effect.as(Effect.sleep(input.ms), input.url.length)
)

const downloads = setup({
  types: {} as {
    context: { finished: ReadonlyArray<string> }
    events:
      | { type: "ADD"; id: string; url: string; ms: number }
      | { type: "CANCEL"; id: string }
      | DoneActorEvent<number>
  },
  actors: { download },
}).createMachine({
  id: "downloads",
  context: { finished: [] },
  on: {
    ADD: {
      actions: spawnChild("download", {
        id: ({ event }) => event.id,
        input: ({ event }) => ({ url: event.url, ms: event.ms }),
      }),
    },
    CANCEL: { actions: stopChild(({ event }) => event.id) },
    "xstate.done.actor.*": {
      actions: [
        assign({ finished: ({ context, event }) => [...context.finished, event.actorId] }),
        // A finished child stays in snapshot.children until it is stopped
        stopChild(({ event }) => event.actorId),
      ],
    },
  },
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(downloads)
  yield* actor.start
  yield* actor.send({ type: "ADD", id: "small", url: "https://example.com/small", ms: 10 })
  yield* actor.send({ type: "ADD", id: "large", url: "https://example.com/large", ms: 60_000 })
  yield* Console.log(Object.keys((yield* actor.getSnapshot).children)) // ["small", "large"]

  yield* actor.send({ type: "CANCEL", id: "large" })
  const snapshot = yield* waitFor(actor, (current) => current.context.finished.length === 1, { timeout: 1000 })
  yield* Console.log(snapshot.context.finished, Object.keys(snapshot.children)) // ["small"] []
})

export const main = Effect.runPromise(Effect.scoped(program))
```

The engine creates a spawned child during the transition and starts it after the macrostep commits. A child stopped in the same macrostep that spawned it never starts. A running child stops after the events already sent to it.

## Variations

### Keep the child's reference in context

To send to the child or read its snapshot later, spawn it inside `assign` with the `spawn` argument and keep the reference. `stopChild` accepts a function that returns a reference, or `undefined` to stop nothing.

```ts
import { assign, fromEffect, setup, stopChild, type ActorRefFrom } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

// Waits `every` milliseconds, again and again, until it is stopped
const heartbeat = fromEffect(({ input }: { input: { every: number } }) => Effect.forever(Effect.sleep(input.every)))

export const connection = setup({
  types: {} as {
    context: { heartbeat: ActorRefFrom<typeof heartbeat> | undefined }
    events: { type: "CONNECT" } | { type: "DISCONNECT" }
  },
  actors: { heartbeat },
}).createMachine({
  context: { heartbeat: undefined },
  on: {
    CONNECT: {
      actions: assign({
        heartbeat: ({ spawn }) => spawn("heartbeat", { id: "heartbeat", input: { every: 1000 } }),
      }),
    },
    DISCONNECT: {
      actions: [stopChild(({ context }) => context.heartbeat), assign({ heartbeat: undefined })],
    },
  },
})
```

### Reach the child from other actors

Give the child a `systemId`. Any actor of the same system can then send to it with `sendTo("<systemId>", event)`, and code outside the actors can find it with `actor.system.get("<systemId>")`. `stopChild` also accepts the `systemId` in place of the id.

```ts
import { assign, setup, spawnChild, stopChild } from "@jambudipa/xstate-effect"

const auditLog = setup({
  types: {} as {
    context: { entries: ReadonlyArray<string> }
    events: { type: "RECORD"; entry: string }
  },
}).createMachine({
  context: { entries: [] },
  on: {
    RECORD: { actions: assign({ entries: ({ context, event }) => [...context.entries, event.entry] }) },
  },
})

export const server = setup({
  types: {} as { events: { type: "AUDIT.ON" } | { type: "AUDIT.OFF" } },
  actors: { auditLog },
}).createMachine({
  on: {
    "AUDIT.ON": { actions: spawnChild("auditLog", { id: "audit", systemId: "audit" }) },
    "AUDIT.OFF": { actions: stopChild("audit") },
  },
})
```

The `systemId` option is a fixed string, and it must be free in the system. Spawning a second actor under a `systemId` that another actor holds puts the parent into status `error` with `Actor with system ID '<systemId>' already exists.`. A child gives its `systemId` up when it stops or finishes, so the same `systemId` is free again after `AUDIT.OFF`.

### Follow the child's snapshots

With `syncSnapshot: true`, the child sends its parent `{ type: "xstate.snapshot.<id>", snapshot }` for each active snapshot it publishes, starting with its initial snapshot when it starts. Type the event with `SnapshotEvent`.

```ts
import { assign, createMachine, setup, spawnChild, type SnapshotEvent } from "@jambudipa/xstate-effect"

const counter = createMachine({
  context: { count: 0 },
  on: { INC: { actions: assign({ count: ({ context }) => context.count + 1 }) } },
})

export const dashboard = setup({
  types: {} as {
    context: { updates: number }
    events: { type: "WATCH" } | SnapshotEvent
  },
  actors: { counter },
}).createMachine({
  context: { updates: 0 },
  on: {
    WATCH: { actions: spawnChild("counter", { id: "counter", syncSnapshot: true }) },
    "xstate.snapshot.counter": { actions: assign({ updates: ({ context }) => context.updates + 1 }) },
  },
})
```

### Handle a child that fails

A child that fails sends `xstate.error.actor.<id>`; its `error` field holds the value the child failed with. Type the event with `ErrorActorEvent`. Without a transition for that event, the parent itself goes into status `error`; see [How to handle actor errors](./handle-actor-errors.md).

```ts
import { assign, fromEffect, setup, spawnChild, type ErrorActorEvent } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

const job = fromEffect(() => Effect.fail("disk full"))

export const runner = setup({
  types: {} as {
    context: { failures: ReadonlyArray<string> }
    events: { type: "RUN" } | ErrorActorEvent<string>
  },
  actors: { job },
}).createMachine({
  context: { failures: [] },
  on: {
    RUN: { actions: spawnChild("job", { id: "job" }) },
    "xstate.error.actor.*": {
      actions: assign({ failures: ({ context, event }) => [...context.failures, `${event.actorId}: ${event.error}`] }),
    },
  },
})
```

### Spawn a number of children from one event

Use `enqueueActions` and its `enqueue.spawnChild`, which takes the same arguments as `spawnChild`.

```ts
import { enqueueActions, fromEffect, setup } from "@jambudipa/xstate-effect"
import { Effect } from "effect"

const resize = fromEffect(({ input }: { input: { file: string } }) => Effect.succeed(input.file))

export const batch = setup({
  types: {} as { events: { type: "RESIZE_ALL"; files: ReadonlyArray<string> } },
  actors: { resize },
}).createMachine({
  on: {
    RESIZE_ALL: {
      actions: enqueueActions(({ event, enqueue }) => {
        for (const file of event.files) {
          enqueue.spawnChild("resize", { id: `resize.${file}`, input: { file } })
        }
      }),
    },
  },
})
```

### Stop every child at once

`stopAllChildren()` stops each child that `snapshot.children` holds at that point of the action list, in order.

```ts
import { createMachine, stopAllChildren } from "@jambudipa/xstate-effect"

export const pool = createMachine({
  on: { SHUTDOWN: { actions: stopAllChildren() } },
})
```

### Spawn logic that is not declared

`spawnChild` also takes the logic itself. In a `setup` machine its type then accepts no `id`, so the child is stored under the key `"undefined"`, and a second spawn without an id replaces that entry. Declare the logic in `actors` whenever the child needs an id.

## Things to check

- **Always give an `id`.** Without one, the child joins `snapshot.children` under the key `"undefined"`.
- **An unknown name spawns nothing.** `spawnChild("<name>")` with a name that the machine's `actors` lacks logs the warning `Actor type '<name>' not found in machine '<actor id>'.`. In a `setup` machine, such a name is already a type error.
- **Stopping is the parent's job.** `stopChild` with an unknown id changes nothing. Stopping an actor that is not a child of the machine puts the machine into status `error` with `Cannot stop child actor <child> of <actor> because it is not a child`. Calling `stop` on the child actor itself dies with `A non-root actor cannot be stopped directly.` and leaves the child running.
- **Children stop with their parent.** When the parent stops, or the `Scope` that owns it closes, its children stop and give up their `systemId`s.

## Related

- [spawnChild](../reference/actions/spawn-child.md): every option and the typing rules for declared actors.
- [stopChild, stop and stopAllChildren](../reference/actions/stop-child.md): every target form.
- [Invoke and spawn child actors](../tutorials/05-child-actors.md): the tutorial that introduces children.
- [How to send events between actors](./send-events-between-actors.md): talking to the children you spawn.
- [About the actor model](../explanation/actor-model.md) and [Actor lifetimes and scopes](../explanation/actor-lifetimes-and-scopes.md).
