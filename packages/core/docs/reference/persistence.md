---
title: Persisted snapshots
doc-type: reference
sources: [packages/core/src/persistence.ts, packages/core/src/Actor.ts]
---

# Persisted snapshots

> **TL;DR:** `actor.getPersistedSnapshot` gives a JSON-safe object: the logic's persisted form of
> the current snapshot, plus the pending delayed events under `scheduledEvents`. A machine's form
> holds the state value, the context with actor references as markers, the history as state-node
> ids, the tags and each child with its own persisted snapshot. Pass it, or its `JSON.parse`
> result, to `createActor` as the `snapshot` option to restore. A failed restore never fails
> `createActor`: the actor gets status `error`.

All names on this page come from `@jambudipa/xstate-effect`. The steps to persist and restore an
actor are in [How to persist and restore an actor](../how-to/persist-and-restore-an-actor.md).

## Summary

### Functions and members

| Name | Type | Summary |
| --- | --- | --- |
| [`actor.getPersistedSnapshot`](#actorgetpersistedsnapshot) | `Effect.Effect<unknown, SerializationError>` | The persisted form of the actor's current snapshot, with `scheduledEvents`. Also on every actor reference. |
| [`logic.getPersistedSnapshot`](#logic-members) | `(snapshot) => Effect.Effect<unknown, SerializationError>` | The persisted form of one snapshot of the logic, without `scheduledEvents`. |
| [`logic.restoreSnapshot`](#logic-members) | `(persisted: unknown) => Effect.Effect<TSnapshot, RestoreError, ActorScope \| R>` | A snapshot from its persisted form. |
| [`actorRef.toJSON`](#actor-references) | `() => { xstate$$type: 1; id: string }` | The marker that `JSON.stringify` writes for an actor. |

### Options of `createActor`

| Option | Type | Default | Summary |
| --- | --- | --- | --- |
| [`snapshot`](#the-snapshot-option) | `unknown` | none: the logic's initial snapshot | The snapshot to start from. |
| [`validateSnapshot`](#the-validatesnapshot-option) | `boolean` | `false` | Check a persisted machine snapshot whose status is `done`. |

### Persisted forms

| Form | Keys |
| --- | --- |
| [Machine snapshot](#machine-snapshot) | `status`, `value`, `context`, `output`, `error`, `historyValue`, `tags`, `children` |
| [Child entry](#children) | `snapshot`, `src`, `systemId`, `syncSnapshot` |
| [Actor reference in the context](#context) | `xstate$$type`, `id` |
| [History value](#historyvalue) | history state id → `[{ id }]` |
| [Scheduled event](#scheduledevents) | `id`, `event`, `delay`, `startedAt`, `target` |
| [Promise, callback and Effect snapshot](#other-logic) | `status`, `output`, `error`, `input` |
| [Observable and stream snapshot](#other-logic) | `status`, `output`, `error`, `context`, `input` |
| [Transition snapshot](#other-logic) | `status`, `output`, `error`, `context` |

### Types

| Name | Summary |
| --- | --- |
| [`PersistedHistoryValue`](#historyvalue) | `{ readonly [historyStateNodeId: string]: ReadonlyArray<{ readonly id: string }> }` |

## actor.getPersistedSnapshot

**Type:** `Effect.Effect<unknown, SerializationError>`

- Reads the actor's current snapshot and passes it to the logic's `getPersistedSnapshot`.
- Adds the delayed events that this actor scheduled and that are still pending, under the key
  `scheduledEvents`. The key is absent when no event is pending, and when the logic's persisted
  form is not a plain object.
- Never waits. It works before `start` too.
- The result is JSON-safe: `JSON.parse(JSON.stringify(result))` restores as the result does.
- It fails with a `SerializationError`; see [What fails](#what-fails).
- Every actor reference has the same member, so `snapshot.children.<id>.getPersistedSnapshot`
  gives a child's own persisted form.

`JSON.stringify` of a live machine snapshot is not the persisted form: it writes each child as a
marker, the history as full state nodes, and no `scheduledEvents`.

## Machine snapshot

A machine's `getPersistedSnapshot` writes these keys, in this order:

| Key | Type | Description |
| --- | --- | --- |
| `status` | `"active" \| "done" \| "error" \| "stopped"` | The status as it is. |
| `value` | state value | The state value. |
| `context` | JSON | The context, with each actor reference as a marker. See [Context](#context). |
| `output` | any | The output, when `snapshot.output` is `Some`. The key is absent for `None`. |
| `error` | any | The error, when `snapshot.error` is `Some`. The key is absent for `None`. |
| `historyValue` | `PersistedHistoryValue` | The history, as state-node ids. See [historyValue](#historyvalue). |
| `tags` | `string[]` | The tags of the active state nodes, sorted. |
| `children` | object | One entry for each child actor, by child id. See [Children](#children). |
| `scheduledEvents` | array | Added by the actor; see [scheduledEvents](#scheduledevents). |

- `machine`, `_nodes` and the query methods are left out.
- `output`, `error` and an `input` are values of your own types. They are written as they are,
  without a check: an `Error` object becomes `{}` in JSON text.

### Example

```ts
import { Effect } from "effect"
import { SimulatedClock, createActor, fromTransition, raise, setup, type ActorRefFrom } from "@jambudipa/xstate-effect"

const counter = fromTransition((count: number, event: { readonly type: "inc" }) => (event.type === "inc" ? count + 1 : count), 0)

export const parent = setup({
  types: {} as {
    context: { readonly ref: ActorRefFrom<typeof counter> }
    events: { readonly type: "NEXT" } | { readonly type: "GO" } | { readonly type: "BACK" } | { readonly type: "LATER" }
  },
  actors: { counter }
}).createMachine({
  id: "parent",
  context: ({ spawn }) => ({ ref: spawn("counter", { id: "c1" }) }),
  initial: "a",
  states: {
    a: {
      initial: "a1",
      entry: raise({ type: "LATER" }, { delay: 5000, id: "later" }),
      states: { a1: { on: { NEXT: "a2" } }, a2: {}, hist: { type: "history", history: "deep" } },
      on: { GO: "b" }
    },
    b: {
      tags: ["waiting", "idle"],
      invoke: { src: "counter", id: "inv", systemId: "sys1" },
      on: { BACK: "a.hist" }
    }
  }
})

const program = Effect.gen(function* () {
  const clock = new SimulatedClock()
  const actor = yield* createActor(parent, { clock })
  yield* actor.start
  yield* actor.send({ type: "NEXT" })
  yield* clock.increment(1000)
  yield* actor.send({ type: "GO" })

  const persisted = yield* actor.getPersistedSnapshot
  console.log(JSON.stringify(persisted, null, 2))
})

void Effect.runPromise(Effect.scoped(program))
```

The program prints:

```json
{
  "status": "active",
  "value": "b",
  "context": { "ref": { "xstate$$type": 1, "id": "c1" } },
  "historyValue": { "parent.a.hist": [{ "id": "parent.a.a2" }] },
  "tags": ["idle", "waiting"],
  "children": {
    "c1": {
      "snapshot": { "status": "active", "context": 0 },
      "src": "counter",
      "syncSnapshot": false
    },
    "inv": {
      "snapshot": { "status": "active", "context": 0 },
      "src": "counter",
      "systemId": "sys1",
      "syncSnapshot": false
    }
  },
  "scheduledEvents": [
    {
      "id": "later",
      "event": { "type": "LATER" },
      "delay": 5000,
      "startedAt": 0,
      "target": { "kind": "self" }
    }
  ]
}
```

## Children

Each child actor in `snapshot.children` is written as an entry under its child id:

| Key | Type | Description |
| --- | --- | --- |
| `snapshot` | any | The child's own `getPersistedSnapshot` result, with the child's own `scheduledEvents`. |
| `src` | `string` | The name of the child's logic: an implementation name in `setup({ actors })`, or `xstate.invoke.<index>.<state node id>` for an invocation of inline logic. |
| `systemId` | `string` | The child's `systemId`. Absent when it has none. |
| `syncSnapshot` | `boolean` | Whether the child sends its snapshots to the parent. |

- A child whose `src` is a logic object, not a name, cannot be persisted. A `spawnChild` or a
  `spawn` of inline logic makes such a child.
- On restore, a missing `syncSnapshot` reads as `false`, and a missing `systemId` as none.

## Context

- The context is copied. Each actor reference in it, also inside arrays and plain objects, is
  written as `{ "xstate$$type": 1, "id": "<the actor's id>" }`.
- The other values must be JSON values: strings, finite numbers, booleans, `null`, arrays and
  plain objects. `undefined` is kept, and JSON text leaves it out.
- On restore, each marker becomes the restored child with that id, or `undefined` when no child
  has it. Any context object with `xstate$$type: 1` counts as a marker, also one that you wrote.
- A restore copies each array or object that holds a marker, so the persisted value does not
  change and can be restored again.
- A persisted machine snapshot without a `context` key restores with an `undefined` context.

## historyValue

```ts
import type { PersistedHistoryValue } from "@jambudipa/xstate-effect"

export const history: PersistedHistoryValue = {
  "parent.a.hist": [{ id: "parent.a.a2" }]
}
```

- The key is a history state node's id. The value lists the ids of the state nodes that it
  recorded.
- On restore, each id is looked up in the machine. An id that names no state node is dropped,
  and the actor logs the warning `Could not resolve StateNode for id: <id>`. A history state
  whose entries are all dropped has no record.
- A missing `historyValue`, or one that is not an object (`null`, a number, a string, a
  boolean), restores as no history.

## scheduledEvents

The pending delayed events of the actor, sorted by `id`. Each event was scheduled by this actor:
an `after` transition, a `raise` with a delay, a `sendTo` or `sendParent` with a delay.

| Key | Type | Description |
| --- | --- | --- |
| `id` | `string` | The event's id: the `id` option, `xstate.after.<delay>.<state node id>` for an `after` transition, or an id that the scheduler made. |
| `event` | event object | The event to deliver. |
| `delay` | finite number | The delay in milliseconds. |
| `startedAt` | finite number | The time, on the system's clock, at which the delay started. |
| `target` | object | The actor that receives the event, named from the actor that scheduled it. |

| `target` | Receiver |
| --- | --- |
| `{ "kind": "self" }` | The actor itself. |
| `{ "kind": "parent" }` | The actor's parent. |
| `{ "kind": "child", "id": "<child id>" }` | The actor's child with that id. |
| `{ "kind": "system", "systemId": "<systemId>" }` | The actor that the system holds under that `systemId`. |

- An event to an actor that none of these four forms names is left out.
- A child's own pending events are in the child's entry, under its own `scheduledEvents`.
- On restore, the events wait until `start`. Then, before the logic starts, each event is
  scheduled again for the time left: `startedAt + delay` minus the clock's time. An event whose
  time has passed is delivered at once. An event whose target names no actor any more is
  dropped.
- `getPersistedSnapshot` of a restored actor that has not started yet still holds the restored
  events.

## Other logic

| Logic | Persisted keys |
| --- | --- |
| `fromPromise`, `fromCallback`, `fromEffect` and its variants | `status`, `output`, `error`, `input` |
| `fromObservable`, `fromEventObservable`, `fromStream` | `status`, `output`, `error`, `context`, `input` |
| `fromTransition`, `fromTransitionWithInput` | `status`, `output`, `error`, `context` |
| Custom logic | What its `getPersistedSnapshot` returns. |

- A key whose value is `None` or `undefined` is absent. For example, a done promise actor with
  output `42` persists as `{ "status": "done", "output": 42 }`.
- An observable's `context` is an `Option` in the snapshot; it is written as the value, or absent
  for `None`.
- A context of transition or observable logic follows the rules of [Context](#context).
- Restore reads a missing key as `None` (for `output`, `error` and an observable's `context`) or
  as `undefined`.

## Actor references

`JSON.stringify` of an actor, alone or inside a snapshot, writes the marker
`{ "xstate$$type": 1, "id": "<id>" }`. It never reads the actor's state.

## Logic members

```ts
import type { Effect } from "effect"
import type { ActorScope, RestoreError, SerializationError } from "@jambudipa/xstate-effect"

export interface PersistenceMembers<TSnapshot, R> {
  readonly getPersistedSnapshot: (snapshot: TSnapshot) => Effect.Effect<unknown, SerializationError>
  readonly restoreSnapshot?: (persisted: unknown) => Effect.Effect<TSnapshot, RestoreError, ActorScope | R>
}
```

- Every logic has `getPersistedSnapshot`. It does not add `scheduledEvents`: only the actor
  knows its pending events.
- `restoreSnapshot` is optional on custom logic. Machines and the logic of every `from…`
  creator have it.
- A machine's `restoreSnapshot` also takes a live machine snapshot (from `getSnapshot` or
  `resolveState`). Its children are created again from their logic's initial snapshot, not from
  their current state.
- `restoreSnapshot` reads the `ActorScope` service, which an actor provides.

## The snapshot option

`createActor(logic, { snapshot })` starts the actor from `snapshot` instead of the initial
snapshot.

- The logic's `restoreSnapshot` reads the value. A logic without `restoreSnapshot` uses the value
  as it is.
- The value may be the result of `getPersistedSnapshot`, its `JSON.parse` result, or a live
  snapshot.
- No initial action runs, and the context factory does not run.
- A machine restore, in order: the value is decoded; the state value is checked; the children
  are created, not started; the history is revived; the context markers are revived.
- The state value is completed to a full configuration. The tags are read from that
  configuration; the persisted `tags` are not used.
- A child entry whose `src` names no implementation of the machine is left out. A child entry
  without a string `src` is left out too, so the markers that `JSON.stringify` writes for live
  children restore as no children.
- `status`, `output` and `error` are kept as they are. A restored `done` actor stays done, and
  `start` starts no child. A restored `error` actor errors at `start`.
- `start` resumes the pending delayed events, then starts the children and the logic.

## The validateSnapshot option

`createActor(machine, { snapshot, validateSnapshot: true })` checks a persisted machine snapshot
after the restore.

- A snapshot with status `done` on a state that does not complete the machine gives the actor
  status `error` with an `InvalidPersistedSnapshotError`. A state completes the machine when a
  final child of the root is active, or, for a parallel root, when every region is complete.
- Each child that the restore creates is checked too.
- A live snapshot is never checked. Other statuses, and snapshots of other logic, pass as they
  are.
- Without the option, such a snapshot restores unchecked.

## What fails

### When an actor persists

`getPersistedSnapshot` fails with a `SerializationError`:

| Condition | `message` |
| --- | --- |
| The context holds a function. | `context.<path> is a function: a persisted context holds JSON values and actor references only` |
| The context holds a bigint, a symbol or a non-finite number. | `… is a bigint`, `… is a symbol`, `… is the non-finite number Infinity`, with the same ending |
| The context holds a class instance, for example a `Date`. | `context.<path> is an instance of Date: …` |
| The context holds a circular reference. | `… is a circular reference: …` |
| A child's `src` is a logic object. | `An inline child actor cannot be persisted.` |
| A child's own `getPersistedSnapshot` fails. | The child's error. |

The path in the message is `context.a[0].b`, or `the context itself` for the root. The codec adds
the schema path on the next line.

### When an actor restores

`createActor` never fails. A failed restore gives the actor status `error`, and its snapshot then
holds only `status`, `output` and `error`.

| Condition | `snapshot.error` |
| --- | --- |
| The value is not an object, or a key has a wrong type: a status that is not one of the four, a missing `value` or `children`. | `RestoreError` with the codec's text, for example `Missing key` and `at ["children"]` |
| The state value names no state of the machine. | `RestoreError`: `State '<value>' does not exist on '<machineId>'` |
| The machine config has a definition error. | `RestoreError` with the definition error as `cause` |
| `scheduledEvents` does not decode. | `RestoreError` with the codec's text |
| `validateSnapshot` is on and a `done` status names a state that does not complete the machine. | `InvalidPersistedSnapshotError` |

### What a restore drops without an error

| Item | Result |
| --- | --- |
| A child entry whose `src` names no implementation, or has no string `src`. | The child is left out. |
| A history entry whose id names no state node. | The entry is dropped, with a logged warning. |
| A context marker whose id names no restored child. | The marker becomes `undefined`. |
| A pending event whose target names no actor at `start`. | The event is dropped. |
| The persisted `tags`. | Ignored: the tags come from the configuration. |

## Related pages

- [How to persist and restore an actor](../how-to/persist-and-restore-an-actor.md).
- [createActor and the actor](./create-actor.md): `getPersistedSnapshot` and the actor options.
- [Errors](./errors.md): `SerializationError`, `RestoreError` and `InvalidPersistedSnapshotError`.
- [Snapshots](./snapshots.md): the live snapshot and its `toJSON`.
