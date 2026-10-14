---
title: How to send events between actors
doc-type: how-to
sources: [packages/core/src/actions/sendTo.ts, packages/core/src/ActorSystem.ts]
---

# How to send events between actors

> **TL;DR:** Use `sendTo(target, event)` to send from one actor to another, where the target is a child id, a `systemId`, a reference or a function that returns one. Use `sendParent(event)` to reply to the parent and `forwardTo(target)` to pass the current event on. From code outside the actors, look the target up with `actor.system.get(systemId)` and `yield*` its `send`.

## When you need this

A machine has to tell another actor that something happened: a parent hands work to a child, a child reports progress to its parent, or two actors that do not share a parent need to talk. Every action on this page is exported from `@jambudipa/xstate-effect` and from `@jambudipa/xstate-effect/actions`.

## Before you start

- A machine built with `setup(...).createMachine(...)` or `createMachine(...)`.
- An address for the target actor. A child has the `id` it was invoked or spawned with. Any actor can also have a `systemId`: an `invoke` entry, `spawnChild` and `createActor` all take that option, and the actor system then knows the actor by that name.

## Steps

1. **Give each target an address.** Invoke or spawn the child with an `id`. Add a `systemId` to an actor that actors other than its parent must reach.
2. **Send from the parent to a child** with `sendTo("<child id>", event)`.
3. **Reply from the child to its parent** with `sendParent(event)`, and give the parent a transition for that event type.
4. **Send to an actor anywhere in the system** with `sendTo("<systemId>", event)`. The engine looks a name up as a child id first, then as a `systemId`.
5. **Wait for the result.** `yield* actor.send(...)` returns when the root actor's macrostep for that event commits. The events that macrostep sends go out after the commit, and the other actors handle them later, so wait for the state you expect with `waitFor`.

The example below does all five. The parent invokes a `logger` (with the `systemId` `"logger"`) and a `worker`. On `START`, the parent sends `WORK` to the worker. The worker writes to the logger by its `systemId`, which is not one of the worker's own children, and reports its progress to the parent.

```ts
import { assign, createActor, sendParent, sendTo, setup, waitFor } from "@jambudipa/xstate-effect"
import { Console, Effect } from "effect"

const logger = setup({
  types: {} as {
    context: { lines: ReadonlyArray<string> }
    events: { type: "LOG"; line: string }
  },
}).createMachine({
  id: "logger",
  context: { lines: [] },
  on: {
    LOG: { actions: assign({ lines: ({ context, event }) => [...context.lines, event.line] }) },
  },
})

const worker = setup({
  types: {} as {
    context: { done: number }
    events: { type: "WORK" }
  },
}).createMachine({
  id: "worker",
  context: { done: 0 },
  on: {
    WORK: {
      actions: [
        assign({ done: ({ context }) => context.done + 1 }),
        // "logger" is no child of the worker: the engine finds it by its systemId
        sendTo("logger", ({ context }) => ({ type: "LOG", line: `job ${context.done} finished` })),
        sendParent(({ context }) => ({ type: "WORKER.PROGRESS", done: context.done })),
      ],
    },
  },
})

const parent = setup({
  types: {} as {
    context: { progress: number }
    events: { type: "START" } | { type: "WORKER.PROGRESS"; done: number }
  },
  actors: { logger, worker },
}).createMachine({
  id: "parent",
  context: { progress: 0 },
  invoke: [
    { id: "logger", src: "logger", systemId: "logger" },
    { id: "worker", src: "worker" },
  ],
  on: {
    START: { actions: sendTo("worker", { type: "WORK" }) },
    "WORKER.PROGRESS": { actions: assign({ progress: ({ event }) => event.done }) },
  },
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(parent)
  yield* actor.start
  yield* actor.send({ type: "START" })
  yield* actor.send({ type: "START" })
  const snapshot = yield* waitFor(actor, (current) => current.context.progress === 2, { timeout: 1000 })
  yield* Console.log(snapshot.context.progress) // 2
})

export const main = Effect.runPromise(Effect.scoped(program))
```

After the run, the logger's context holds `["job 1 finished", "job 2 finished"]`.

## Variations

### Build the event from the context or the event

Pass a function as the event. It receives the action arguments, such as `context` and `event`, and returns the event object. The worker above does this to put its counter into the `LOG` line.

### Send to a reference kept in context

When the machine holds a child's reference, pass a function that returns it. A reference typed with `ActorRefFrom<typeof logic>` accepts only that logic's events, so a wrong event type is a compile error. A name, or an untyped reference, accepts any event object.

```ts
import { assign, sendTo, setup, type ActorRefFrom } from "@jambudipa/xstate-effect"

const logger = setup({
  types: {} as {
    context: { lines: ReadonlyArray<string> }
    events: { type: "LOG"; line: string }
  },
}).createMachine({
  context: { lines: [] },
  on: {
    LOG: { actions: assign({ lines: ({ context, event }) => [...context.lines, event.line] }) },
  },
})

export const editor = setup({
  types: {} as {
    context: { logger: ActorRefFrom<typeof logger> }
    events: { type: "SAVE"; name: string }
  },
  actors: { logger },
}).createMachine({
  context: ({ spawn }) => ({ logger: spawn("logger", { id: "logger" }) }),
  on: {
    SAVE: {
      actions: sendTo(
        ({ context }) => context.logger,
        ({ event }) => ({ type: "LOG", line: `saved ${event.name}` })
      ),
    },
  },
})
```

A target function that returns `undefined` sends the event to the machine itself.

### Forward the current event

`forwardTo(target)` sends the event being handled, unchanged, to the target. It takes the same targets and options as `sendTo`.

```ts
import { createMachine, forwardTo } from "@jambudipa/xstate-effect"

const search = createMachine({
  id: "search",
  initial: "idle",
  states: { idle: { on: { QUERY: "searching" } }, searching: {} },
})

export const page = createMachine({
  id: "page",
  invoke: { id: "search", src: search },
  on: { QUERY: { actions: forwardTo("search") } },
})
```

### Delay a send, and cancel it

Add `delay` (milliseconds, or the name of a delay in the machine's `delays`) and an `id`. The `cancel` action takes that `id` and drops the event if it has not gone out yet.

```ts
import { cancel, createMachine, sendTo } from "@jambudipa/xstate-effect"

const alarm = createMachine({
  id: "alarm",
  initial: "quiet",
  states: { quiet: { on: { RING: "ringing" } }, ringing: {} },
})

export const timer = createMachine({
  id: "timer",
  invoke: { id: "alarm", src: alarm },
  on: {
    ARM: { actions: sendTo("alarm", { type: "RING" }, { delay: 5000, id: "ring" }) },
    DISARM: { actions: cancel("ring") },
  },
})
```

A delay that does not resolve to a number (for example, a name that the machine's `delays` does not hold) sends the event at once. See [How to use delayed transitions and delayed events](./use-delayed-transitions.md) for the other delay forms.

### Send to the machine itself

`sendSelf(event, options?)` sends the event to the machine's own mailbox, with the same `delay` and `id` options as `sendTo`. The machine handles it after the current macrostep, as it handles an event from outside. To handle an event within the current macrostep instead, before any external event, use `raise`.

```ts
import { createMachine, sendSelf } from "@jambudipa/xstate-effect"

export const poller = createMachine({
  id: "poller",
  initial: "waiting",
  states: {
    waiting: { entry: sendSelf({ type: "POLL" }, { delay: 1000 }), on: { POLL: "polling" } },
    polling: {},
  },
})
```

### Send from code outside the actors

The root actor's `system.get(systemId)` returns an `Effect` of an `Option` of the reference. Without a type argument, the reference accepts any event; with one, `send` is typed by that reference. The type argument is not checked against the actor that holds the `systemId`, so keep the two in step.

```ts
import { assign, createActor, setup, type ActorRefFrom } from "@jambudipa/xstate-effect"
import { Effect, Option } from "effect"

const logger = setup({
  types: {} as {
    context: { lines: ReadonlyArray<string> }
    events: { type: "LOG"; line: string }
  },
}).createMachine({
  context: { lines: [] },
  on: {
    LOG: { actions: assign({ lines: ({ context, event }) => [...context.lines, event.line] }) },
  },
})

const app = setup({ actors: { logger } }).createMachine({
  invoke: { src: "logger", systemId: "logger" },
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(app)
  yield* actor.start
  const found = yield* actor.system.get<ActorRefFrom<typeof logger>>("logger")
  yield* Option.match(found, {
    onNone: () => Effect.logWarning("no logger in the system"),
    onSome: (ref) => ref.send({ type: "LOG", line: "hello from outside" }),
  })
})

export const main = Effect.runPromise(Effect.scoped(program))
```

See [The actor system](../reference/actor-system.md) for `getAll` and the typed `ActorSystem<{ actors: … }>` form.

## When a send fails

`actor.send` never fails. Instead, a target or an event that the engine cannot use puts the **sending** machine into status `error`, and its `snapshot.error` holds an `ActorError` with one of these messages:

| Cause | Message |
|---|---|
| A name that is neither a child id nor a `systemId` | `Unable to send event to actor '<name>' from machine '<machine id>'.` |
| `sendParent` from an actor without a parent | `Unable to send event to actor '#_parent' from machine '<machine id>'.` |
| A string in place of an event object | `Only event objects may be used with sendTo; use sendTo({ type: "<type>" }) instead` |
| A `forwardTo` target that resolves to nothing | `Attempted to forward event to undefined actor. This risks an infinite loop in the sender.` |

An event sent to an actor that has stopped, is done or has failed is dropped with a warning. See [How to handle actor errors](./handle-actor-errors.md) to react to the `error` status.

## Related

- [sendTo, sendParent, sendSelf and forwardTo](../reference/actions/send-to.md): every target form and option.
- [The actor system](../reference/actor-system.md): `system.get`, `getAll` and `systemId` registration.
- [cancel](../reference/actions/cancel.md): cancelling a delayed send.
- [How to spawn and stop child actors](./spawn-and-stop-children.md) and [How to emit events and listen to them](./emit-and-listen-to-events.md).
- [How an actor processes events](../explanation/event-processing.md) and [About the actor model](../explanation/actor-model.md): why a send is handled after the sender's macrostep.
