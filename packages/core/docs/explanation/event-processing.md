---
title: How an actor processes events
doc-type: explanation
sources: [packages/core/src/Actor.ts, packages/core/src/stateUtils.ts]
---

# How an actor processes events

> **TL;DR:** Each actor has its own mailbox and its own fiber, and it processes one event at a
> time, to completion: one macrostep per event, which publishes one snapshot. An external
> `yield* actor.send(event)` returns once that macrostep commits, so a read right after it sees
> the result, but work that the macrostep handed to other actors can still be in flight. Sends
> made from inside an actor only queue their event, so no actor ever waits for itself. An event
> sent while an actor ends is dropped silently, and one sent after it has ended is dropped with a
> warning.

## The question

Between `send` and the next snapshot a lot can happen: transitions, actions, eventless
transitions, raised events, messages to other actors. This page explains the order of that
work, what a caller can rely on when `send` returns, and why the package draws the line where it
does. It assumes you know what a state machine and an actor are; see
[About state machines and statecharts](state-machines.md) and
[About the actor model](actor-model.md).

## One mailbox, one fiber, one event at a time

Every actor owns an unbounded mailbox. A send never waits for room, and events leave the
mailbox in the order they arrived. After `start`, the actor takes events from the mailbox in
its own fiber, inside its own scope (see [Actor lifetimes and scopes](actor-lifetimes-and-scopes.md)).

Events sent before `start` wait in the mailbox. `start` runs the initial actions, then processes
those events, and an external `start` returns only after them. So a program can send to an actor
it has not started yet and read the result after `start`.

There is no global order across actors. Each actor sees its own events in arrival order, and two
actors run their macrosteps concurrently.

## Run to completion: one macrostep per event

The actor hands each event to its logic and waits until the logic has finished with it before it
takes the next one. For a state machine this unit of work is a *macrostep*, the same algorithm as
XState's:

1. The first microstep takes the transitions that the event enables: the exit actions, the
   transition actions and the entry actions, in document order.
2. Then, while the machine is active, the macrostep takes the enabled eventless (`always`)
   transitions, one microstep at a time. When none is enabled, it takes the next event that the
   macrostep raised for itself with `raise` (without a delay), `xstate.done.state.*` events
   included.
3. The macrostep ends when no eventless transition is enabled and no raised event is left, or when
   the machine is no longer active.

Only the end of the macrostep is published. Observers never see the intermediate microsteps, so
a subscriber never sees a state that the machine passes through on its way to a stable one:

```ts
import { Effect } from "effect"
import { createActor, createMachine, raise } from "@jambudipa/xstate-effect"

const machine = createMachine({
  types: {} as { events: { type: "GO" } | { type: "NEXT" } },
  initial: "a",
  states: {
    a: { on: { GO: { target: "b", actions: raise({ type: "NEXT" }) } } },
    b: { on: { NEXT: "c" } },
    c: {}
  }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(machine)
  yield* actor.subscribe((snapshot) => Effect.log(snapshot.value))
  yield* actor.start // logs "a"
  yield* actor.send({ type: "GO" }) // logs "c": "b" is a microstep inside the macrostep
})

void Effect.runPromise(Effect.scoped(program))
```

The intermediate states are still observable when you need them: the inspection functions
receive a `@xstate.microstep` event for each microstep, and `getMicrosteps` computes them without
an actor (see [Pure transition functions](../reference/testing/get-next-snapshot.md)).

A machine config can bound the loop with `options: { maxIterations }`. A macrostep that runs past
the bound fails with XState's infinite-loop message, and the actor errors. The default is no bound.

### What runs inside the macrostep, and what runs after it

A custom action runs at its place in the macrostep, in order, while the snapshot is computed.
`assign` changes the context for the actions after it. The work that reaches other actors waits
until the macrostep has produced its snapshot: the events that `sendTo`, `sendParent` and
`forwardTo` deliver, the start of each spawned or invoked child, the stop of each child that the
macrostep stopped, and the emitted events. The actor then runs that deferred work in order,
hands the snapshot to its `changes` streams and its `subscribe` callbacks, and reports
`@xstate.snapshot` to the inspection functions. An `actor.on` listener therefore runs after the
commit and reads the new snapshot.

This split is what makes a failed macrostep clean. When user code fails half-way, the actor keeps
the snapshot it had before the event and drops the deferred work: no send of that macrostep goes
out and no child it spawned starts. A custom action that ran before the failure has run, because
its effect cannot be undone. [How failures surface](failure-model.md) follows that path further.

The processing of one event is uninterruptible. A `stop` that arrives during a macrostep waits
for the macrostep to commit, and a stop from inside a macrostep lets the rest of that macrostep's
actions run first, as in XState.

## What `send` waits for

XState processes an event synchronously: when `actor.send(event)` returns, the snapshot already
reflects it. This package cannot do that in the caller's stack, because the event is processed
in the actor's own fiber. It restores the same guarantee from the other side: an external
`yield* actor.send(event)` waits until the macrostep of that event commits, or until the event
is dropped. A `getSnapshot` right after the send shows the result, as in XState. A send never
fails: what goes wrong inside the actor is the actor's failure, not the sender's.

The guarantee covers that one actor and that one macrostep. When the macrostep sends an event
to another actor, the send returns once the event is in the other actor's mailbox, not once the
other actor has processed it. A cascade across actors can still be in flight:

```ts
import { Effect } from "effect"
import { createActor, createMachine, sendParent, sendTo, setup, waitFor } from "@jambudipa/xstate-effect"

const echo = createMachine({
  types: {} as { events: { type: "PING" } },
  on: { PING: { actions: sendParent({ type: "PONG" }) } }
})

const machine = setup({
  types: {} as { events: { type: "PING" } | { type: "PONG" } },
  actors: { echo }
}).createMachine({
  invoke: { src: "echo", id: "echo" },
  initial: "waiting",
  states: {
    waiting: {
      on: {
        PING: { actions: sendTo("echo", { type: "PING" }) },
        PONG: "answered"
      }
    },
    answered: {}
  }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(machine)
  yield* actor.start
  yield* actor.send({ type: "PING" })

  // The parent's macrostep has committed, but the reply may not have arrived yet
  const now = yield* actor.getSnapshot
  console.log(now.value) // usually "waiting"

  // Wait for the state that the cascade leads to
  const answered = yield* waitFor(actor, (snapshot) => snapshot.matches("answered"))
  console.log(answered.value) // "answered"
})

void Effect.runPromise(Effect.scoped(program))
```

When the result you need depends on another actor, wait for the state that proves it with
`waitFor`; see [How to wait for a state or an output](../how-to/wait-for-a-state.md).

### Sends from inside an actor never wait

Only a send from outside every actor waits. These sends only queue their event:

- the sends of actions: `sendTo`, `sendParent`, `forwardTo`, `raise` with a delay;
- the delayed events that the scheduler delivers, and the events that a callback actor's
  `sendBack` delivers;
- any send made while the caller runs inside an actor's processing or callbacks: an Effect that
  a custom action returns, a `subscribe` callback, an `actor.on` listener, an inspection
  function.

If these waited, two actors that send to each other could each wait for the other to finish a
macrostep that cannot finish until the wait ends. Queuing without waiting rules that deadlock
out, and it keeps one actor's macrostep from depending on the speed of another actor. The
package tells the two kinds of caller apart with a marker on the running fiber, so you do not
choose between them: the same `send` waits or queues depending on where it runs.

## Delayed events

A delayed transition (`after`) or a delayed send schedules the event on the actor system's
clock. When the delay ends, the scheduler delivers the event to the mailbox like any other
send from inside the system: it queues and does not wait. When an actor ends, the events it
scheduled that are still pending are cancelled. `SimulatedClock` makes these delays
deterministic in tests; see [How to test delayed transitions](../how-to/test-delayed-transitions.md).

## Events that are dropped

An actor accepts events only while it runs or before it starts. Once it ends, events have
nowhere to go, and the package distinguishes two moments:

- **While the actor's lifetime closes**, an event is dropped without a warning. The lifetime
  closes after a `stop`, after a snapshot with status `done` or `error`, or when the scope that
  owns the actor closes. At that moment the actor's children are stopping too, and their own
  clean-up often sends a last event to the parent: a callback actor's clean-up that calls
  `sendBack`, for example. XState keeps such an actor running until its stop procedure and then
  clears the event with the mailbox, so the event is lost there too, and quietly. The package
  keeps that quiet.
- **After the actor has ended**, an event is dropped with XState's warning, through the Effect
  logger: `Event "<type>" was sent to stopped actor "<id> (<sessionId>)". This actor has already
  reached its final state, and will not transition.` A send this late is almost always a
  mistake in the sender, so it is worth a line in the log.

A `stop` also drops the events still queued in the mailbox: the macrostep in progress commits,
and nothing after it runs.

## Trade-offs

- **More waiting points than XState.** XState's synchronous `send` gives a total order inside one
  call stack. Here only the sender of an external event waits, and only for one actor. Code that
  reasons about several actors at once must wait for states, not for sends.
- **No deadlocks, at the cost of a rule to remember.** A send from inside an action returns at
  once, even when the same expression outside an actor would wait. This is deliberate, but an
  Effect that a custom action returns cannot use a send to "wait for" another actor.
- **Uninterruptible macrosteps.** A stop or a scope close never tears a macrostep in half, so a
  snapshot is always one that the algorithm produced. A long-running Effect inside a custom
  action delays the stop by the same amount; long work belongs in an invoked actor, such as
  `fromEffect`, which a stop interrupts.

## Consequences for you

- Read the snapshot right after `yield* actor.send` when the result depends only on that actor.
- Use `waitFor` when it depends on a child, a parent, a delayed event or any other actor.
- Do not send to an actor after it has ended; the warning in your log points at the sender.
- Keep custom actions short, and move long work into invoked or spawned actors.

## Related

- [Actor lifetimes and scopes](actor-lifetimes-and-scopes.md): when an actor starts and ends.
- [How failures surface](failure-model.md): what happens when a macrostep fails.
- [How to send events between actors](../how-to/send-events-between-actors.md).
- [How to react to snapshot changes](../how-to/react-to-snapshot-changes.md).
- [createActor and the actor](../reference/create-actor.md): `send`, `start`, `subscribe` and
  `changes`.
- [Inspection events](../reference/inspection.md): `@xstate.event`, `@xstate.microstep` and
  `@xstate.snapshot`.
