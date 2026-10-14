---
title: Inspection events
doc-type: reference
sources: [packages/core/src/inspection.ts]
---

# Inspection events

> **TL;DR:** An actor system sends an `InspectionEvent` to its inspection functions each time
> an actor is created, receives an event, runs an action, takes a microstep or publishes a
> snapshot. Register a function with the `inspect` option of a root actor or with
> `system.inspect(fn)`. Every event has `type`, `rootId` and `actorRef`; narrow on `type` to
> read the other fields.

All the types on this page are exported from the root of `@jambudipa/xstate-effect`.
`Types.InspectionEvent` is the same union as `InspectionEvent`.

## Summary

| Type | `type` | Sent when |
|---|---|---|
| [`InspectedActorEvent`](#inspectedactorevent) | `"@xstate.actor"` | An actor is created. |
| [`InspectedEventEvent`](#inspectedeventevent) | `"@xstate.event"` | An event is sent to an actor. |
| [`InspectedActionEvent`](#inspectedactionevent) | `"@xstate.action"` | An actor runs an action that has an execution. |
| [`InspectedMicrostepEvent`](#inspectedmicrostepevent) | `"@xstate.microstep"` | A state machine takes a microstep. |
| [`InspectedSnapshotEvent`](#inspectedsnapshotevent) | `"@xstate.snapshot"` | An actor publishes a snapshot after it processes an event. |
| [`InspectedTransitionEvent`](#inspectedtransitionevent) | `"@xstate.transition"` | Never. |
| [`InspectionEvent`](#inspectionevent) | — | The union of the six types above. |

## Receiving inspection events

| Registration | Signature | Lasts |
|---|---|---|
| The `inspect` option of `createActor` | `(event: InspectionEvent) => Effect.Effect<void>` | While the root actor's scope is open. It is registered before every other function, so it also receives the root actor's own `@xstate.actor`. An actor with a `parent` ignores the option. |
| `system.inspect(fn)` | `(fn: (event: InspectionEvent) => Effect.Effect<void>) => Effect.Effect<void, never, Scope.Scope>` | Until the caller's scope closes. See [inspect](./actor-system.md#inspect). |

- The functions of a system receive the events of every actor of that system: the root actor
  and each actor it invokes or spawns, at any depth.
- For each event, the functions run one after another, in registration order, each to its end.
- A function that throws, fails or dies is reported through the logger. It changes nothing for
  the actor or for the functions after it.

```ts
import { Effect } from "effect"
import { createActor, createMachine, type InspectionEvent } from "@jambudipa/xstate-effect"

const toggle = createMachine({
  types: {} as { events: { type: "TOGGLE" } },
  initial: "off",
  states: { off: { on: { TOGGLE: "on" } }, on: { on: { TOGGLE: "off" } } }
})

const describe = (event: InspectionEvent): string => {
  switch (event.type) {
    case "@xstate.event":
      return `event ${event.event.type} to ${event.actorRef.id}`
    case "@xstate.snapshot":
      return `snapshot of ${event.actorRef.id}: ${event.snapshot.status}`
    default:
      return event.type
  }
}

const program = Effect.gen(function* () {
  const actor = yield* createActor(toggle, { inspect: (event) => Effect.log(describe(event)) })
  yield* actor.start
  yield* actor.send({ type: "TOGGLE" })
})

void Effect.runPromise(Effect.scoped(program))
```

## Common fields

Every inspection event has these fields.

| Field | Type | Description |
|---|---|---|
| `type` | `string` literal | The discriminant: narrow an `InspectionEvent` on it. |
| `rootId` | `string` | The session id of the root actor of the system that sent the event, for example `x:0`. |
| `actorRef` | `ActorRef.ActorRefBase` | The actor the event is about: the created actor, the recipient of the event, the actor that runs the action, or the actor of the microstep or the snapshot. |

## InspectedActorEvent

**Sent:** once for each actor that `createActor`, an `invoke` or a spawn creates. The event is
sent once the actor exists, before the actor registers its `systemId` and computes its first
snapshot. An actor whose creating macrostep then fails is still reported.

| Field | Type | Description |
|---|---|---|
| `type` | `"@xstate.actor"` | |

No other field than the [common fields](#common-fields).

```ts
import { Effect } from "effect"
import type { InspectionEvent } from "@jambudipa/xstate-effect"

export const logCreations = (event: InspectionEvent) =>
  event.type === "@xstate.actor" ? Effect.log(`created ${event.actorRef.id}`) : Effect.void
```

## InspectedEventEvent

**Sent:** for each event sent to an actor, before the recipient receives it:

- an event sent from outside with `actor.send` (`sourceRef` is `None`);
- an event that the system relays from one actor to another: a built-in send action, a delayed
  event, a child's done, error or snapshot event (`sourceRef` is the sender);
- the init event `xstate.init` at `start` (`sourceRef` is the parent, or `None` for a root
  actor).

For `actor.send`, the inspection functions run before the event reaches the actor's mailbox,
so an event that an inspection function sends at that time is queued ahead of it.

| Field | Type | Description |
|---|---|---|
| `type` | `"@xstate.event"` | |
| `sourceRef` | `Option.Option<ActorRef.ActorRefBase>` | The sending actor, or `None`. |
| `event` | `EventObject` | The event as sent. |

```ts
import { Effect, Option } from "effect"
import type { InspectionEvent } from "@jambudipa/xstate-effect"

export const logMessages = (event: InspectionEvent) =>
  event.type === "@xstate.event"
    ? Effect.log(
        `${Option.match(event.sourceRef, { onNone: () => "outside", onSome: (ref) => ref.id })} -> ${event.actorRef.id}: ${event.event.type}`
      )
    : Effect.void
```

## InspectedActionEvent

**Sent:** when an actor runs an action that has an execution, before the execution: a custom
action, or a built-in action other than `assign` and `enqueueActions`. The actions of the
initial snapshot run, and are reported, at `start`.

| Field | Type | Description |
|---|---|---|
| `type` | `"@xstate.action"` | |
| `action` | `{ readonly type: string; readonly params: unknown }` | A plain record, not the action object. `type` is the action's name, or the `xstate.*` type of a built-in action (for example `xstate.raise`, `xstate.sendTo`, `xstate.emit`, `xstate.log`, `xstate.spawnChild`, `xstate.stopChild`). `params` holds the params of this use, or `undefined` when there are none. |

```ts
import { Effect } from "effect"
import type { InspectionEvent } from "@jambudipa/xstate-effect"

export const logActions = (event: InspectionEvent) =>
  event.type === "@xstate.action" ? Effect.log(`${event.actorRef.id} runs ${event.action.type}`) : Effect.void
```

## InspectedMicrostepEvent

**Sent:** by a state machine actor for each microstep of a macrostep, with the snapshot after
it. A macrostep gives one for the event it processes, then one for each eventless transition it
takes and each raised event it handles. The stop event gives one microstep with no transitions.

| Field | Type | Description |
|---|---|---|
| `type` | `"@xstate.microstep"` | |
| `event` | `EventObject` | The event the microstep handled. |
| `snapshot` | `Snapshot` | The snapshot after the microstep. |
| `_transitions` | `ReadonlyArray<TransitionDefinition<unknown, EventObject>>` | The transitions the microstep took, in selection order. Empty for an event that selects no transition, and for the stop event. |

```ts
import { Effect } from "effect"
import type { InspectionEvent } from "@jambudipa/xstate-effect"

export const logMicrosteps = (event: InspectionEvent) =>
  event.type === "@xstate.microstep"
    ? Effect.log(`${event.event.type}: ${event._transitions.length} transition(s)`)
    : Effect.void
```

## InspectedSnapshotEvent

**Sent:** when an actor publishes a snapshot after it processes an event:

- at `start`, with the init event `xstate.init`;
- after each macrostep, with the event it processed;
- after a stop, with the stop event `xstate.stop`, for an actor that was running and active.

An event whose transition fails gives no `@xstate.snapshot`.

| Field | Type | Description |
|---|---|---|
| `type` | `"@xstate.snapshot"` | |
| `event` | `EventObject` | The event the actor processed. |
| `snapshot` | `Snapshot` | The snapshot the actor published. |

```ts
import { Effect } from "effect"
import type { InspectionEvent } from "@jambudipa/xstate-effect"

export const logStatuses = (event: InspectionEvent) =>
  event.type === "@xstate.snapshot" ? Effect.log(`${event.actorRef.id}: ${event.snapshot.status}`) : Effect.void
```

## InspectedTransitionEvent

**Sent:** never. The type is in the `InspectionEvent` union for parity with XState, which also
never sends it.

| Field | Type | Description |
|---|---|---|
| `type` | `"@xstate.transition"` | |
| `event` | `EventObject` | Never filled. |
| `snapshot` | `Snapshot` | Never filled. |

## InspectionEvent

`InspectionEvent` is the union `InspectedSnapshotEvent | InspectedEventEvent |
InspectedActorEvent | InspectedTransitionEvent | InspectedMicrostepEvent | InspectedActionEvent`.
It is the parameter type of the `inspect` option and of the function that `system.inspect`
takes. Narrow it on `type`, or extract one member with `Extract`.

```ts
import type { InspectionEvent } from "@jambudipa/xstate-effect"

// The same type as InspectedSnapshotEvent
export type SnapshotEvent = Extract<InspectionEvent, { type: "@xstate.snapshot" }>
```

## Order of events

The sequence below is what the inspection functions of a root actor `root` receive. `root` is a
state machine that invokes a callback actor `kid` and, on `GO`, takes a transition with the
actions `assign`, a custom action, `emit`, `raise({ type: "NEXT" })`, `log` and
`sendTo("kid", { type: "HI" })`. `NEXT` then takes a second transition.

```text
createActor(root)
  @xstate.actor      root
  @xstate.actor      kid
start
  @xstate.event      xstate.init  (no source)  -> root
  @xstate.event      xstate.init  root         -> kid
  @xstate.snapshot   kid  (xstate.init)
  @xstate.action     root runs xstate.spawnChild
  @xstate.snapshot   root (xstate.init)
send({ type: "GO" })
  @xstate.event      GO  (no source)  -> root
  @xstate.action     root runs custom
  @xstate.action     root runs xstate.emit
  @xstate.action     root runs xstate.raise
  @xstate.action     root runs xstate.log
  @xstate.action     root runs xstate.sendTo
  @xstate.microstep  root  GO    (1 transition)
  @xstate.microstep  root  NEXT  (1 transition)
  @xstate.event      HI  root  -> kid
  @xstate.snapshot   root (GO)
stop
  @xstate.action     root runs xstate.stopChild
  @xstate.microstep  root  xstate.stop  (0 transitions)
  @xstate.snapshot   kid  (HI)
  @xstate.snapshot   kid  (xstate.stop)
  @xstate.snapshot   root (xstate.stop)
```

`assign` gives no `@xstate.action`. The `rootId` of every event is `x:0`, the session id of
`root`.

## Related

- [How to inspect a running actor system](../how-to/inspect-an-actor-system.md)
- [The actor system](./actor-system.md) — `system.inspect`.
- [createActor and the actor](./create-actor.md#actoroptions) — the `inspect` option.
- [Dev tools entry point](./dev.md)
