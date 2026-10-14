---
title: Actor references
doc-type: reference
sources: [packages/core/src/ActorRef.ts]
---

# Actor references

> **TL;DR:** An actor reference is the part of an actor that other code talks to: `send`,
> `getSnapshot`, `changes`, `subscribe` and `on`. Every actor is its own reference, so the
> children in `snapshot.children`, `self` in an action and the result of `system.get` are
> actors. `ActorRef<TSnapshot, TEvent, TEmitted>` is the typed form, `AnyActorRef` fits every
> reference, and the module also holds the helpers `equals`, `getId`, `isChildOf`, `send` and
> `toSnapshotStream`.

The root of `@jambudipa/xstate-effect` exports `ActorRef` both as a type and as the module
namespace. `ActorRef<TSnapshot, TEvent, TEmitted>` is the type; `ActorRef.isActorRef`,
`ActorRef.ActorRefBase` and the other members of the table below are members of the module.

## Summary

| Name | Kind | Root export | Summary |
|---|---|---|---|
| [`ActorRef<TSnapshot, TEvent, TEmitted>`](#actorref) | interface | `ActorRef`, `ActorRefType` | A typed reference to an actor. |
| [`ActorRefBase`](#actorrefbase) | interface | `ActorRef.ActorRefBase` | The members that do not depend on the actor's types. |
| [`AnyActorRef`](#anyactorref) | interface | `AnyActorRef` | A reference that every actor reference fits. |
| [`UnknownActorRef`](#unknownactorref) | type | `UnknownActorRef` | `ActorRef<Snapshot, EventObject>`. |
| [`EmittedOfType<TEmitted, TType>`](#emittedoftype) | type | `ActorRef.EmittedOfType` | The event type that an `on` handler of `type` receives. |
| [`ActorRef.ActorRef.SnapshotOf`, `EventOf`, `EmittedOf`, `Any`](#type-extractors) | types | `ActorRef.ActorRef.*` | The parts of a reference type. |
| [`SnapshotStream<TSnapshot, E>`](#snapshotstream) | interface | `SnapshotStream` | Covariant read access to snapshots. |
| [`toSnapshotStream`](#tosnapshotstream) | function | `toSnapshotStream` | A `SnapshotStream` over a `SubscriptionRef`. |
| [`ActorRefTypeId`](#isactorref) | unique symbol | `ActorRefTypeId` | The marker that every reference carries. |
| [`isActorRef`](#isactorref) | function | `isActorRef` | Whether a value is an actor reference. |
| [`getId`](#getid) | function | `getId` | The id of a reference, or a string as it is. |
| [`equals`](#equals) | function | `equals` | Whether two references are the same actor. |
| [`isChildOf`](#ischildof) | function | `isChildOf` | Whether one reference is a child of another. |
| [`send`](#send) | function | `send` | Sends a typed event to a reference. |
| [`sendUntyped`](#senduntyped) | function | `ActorRef.sendUntyped` | Queues any event for a reference. |

## ActorRef

`ActorRef<TSnapshot, TEvent, TEmitted>` has the members in the table below and those of
[`ActorRefBase`](#actorrefbase). It is covariant in `TSnapshot` and `TEmitted`
(default `EventObject`) and contravariant in `TEvent`.

| Member | Type | Completes | Fails with |
|---|---|---|---|
| `send` | `(event: TEvent) => Effect.Effect<void>` | From outside every actor: after the event's macrostep commits, or after the event is dropped. From inside an actor's processing or callbacks: once the event is queued. | never |
| `getSnapshot` | `Effect.Effect<TSnapshot>` | At once. | never |
| `on` | `(type, handler) => Effect.Effect<void, never, Scope.Scope>` | At once. `handler` runs for each emitted event of `type` (`"*"`: every event) until the caller's scope closes. | never |
| `changes` | `Stream.Stream<TSnapshot, unknown>` | The current snapshot, then each change. Ends when the actor is done or stopped. | the actor's error |
| `subscribe` | `(observer) => Effect.Effect<void, never, Scope.Scope>` | At once. `observer` receives each snapshot published after the call, until the caller's scope closes. | never |
| `_parent` | `Option.Option<AnyActorRef>` | — | — |

The members behave as the actor's members of the same names. See
[createActor and the actor](./create-actor.md#the-actor).

```ts
import { Effect } from "effect"
import { type ActorRef, createActor, createMachine, type Snapshot } from "@jambudipa/xstate-effect"

type Ping = { type: "PING" }

// Any reference that takes `PING` fits
const ping = (ref: ActorRef<Snapshot, Ping>) => ref.send({ type: "PING" })

const pong = createMachine({
  types: {} as { events: Ping },
  initial: "waiting",
  states: { waiting: { on: { PING: "pinged" } }, pinged: {} }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(pong)
  yield* actor.start
  yield* ping(actor)
  return (yield* actor.getSnapshot).value // "pinged"
})

void Effect.runPromise(Effect.scoped(program))
```

## ActorRefBase

The members of every reference that do not depend on its types. `ActorRefBase` extends
Effect's `Pipeable` and `Inspectable`.

| Member | Type | Description |
|---|---|---|
| `id` | `string` | The actor's id. |
| `sessionId` | `string` | The actor's session id, `x:<n>`, unique in its system. |
| `src` | `string \| AnyActorLogic` | The name the parent used for the logic, or the logic. |
| `sendUntyped` | `(event: EventObject) => Effect.Effect<void>` | Queues `event` for the actor. It never waits for the macrostep and never fails. No inspection event is sent for it. A stopped, done or errored actor drops the event with a warning. |
| `getSnapshotUntyped` | `Effect.Effect<Snapshot>` | The current snapshot, typed as `Snapshot`. It never waits. |
| `getPersistedSnapshot` | `Effect.Effect<unknown, SerializationError>` | The persisted form of the current snapshot. See [getPersistedSnapshot](./create-actor.md#getpersistedsnapshot). |
| `_parent` | `Option.Option<AnyActorRef>` | The parent, or `None` for a root actor. |
| `_system` | `ActorSystemService` | The actor's [system](./actor-system.md). |
| `toJSON()` | `() => { xstate$$type: 1; id: string }` | The marker that `JSON.stringify` writes for the actor, alone or inside a snapshot's `context` or `children`. It never reads the actor's state. |
| `pipe` | `Pipeable` | Effect's `pipe` method. |
| `toString()` | `() => string` | `Actor(<id>)` for an actor. |

```ts
import { Effect } from "effect"
import { createActor, createMachine } from "@jambudipa/xstate-effect"

const idle = createMachine({ initial: "idle", states: { idle: {} } })

const program = Effect.gen(function* () {
  const actor = yield* createActor(idle, { id: "counter" })
  return JSON.stringify(actor) // '{"xstate$$type":1,"id":"counter"}'
})

void Effect.runPromise(Effect.scoped(program))
```

## AnyActorRef

A reference that every actor reference fits.

| Member | Type | Description |
|---|---|---|
| `send(event)` | `(event: AnyEventObject) => Effect.Effect<void>` | Sends any event object, as `ActorRef`'s `send`. It is a method, so a reference that takes fewer events still fits. |
| `getSnapshot` | `Effect.Effect<…>` | The current snapshot, untyped: reading `value`, `context` or `children` type-checks. |
| `on(type, handler)` | `(type: string, handler: (event: AnyEventObject) => Effect.Effect<void>) => Effect.Effect<void, never, Scope.Scope>` | Listens to emitted events, as `ActorRef`'s `on`. |
| `changes` | `Stream.Stream<…, unknown>` | The untyped snapshots, current first. It fails with the actor's error and ends when the actor is done or stopped. |
| `subscribe(observer)` | `(observer: (snapshot) => Effect.Effect<void>) => Effect.Effect<void, never, Scope.Scope>` | As `ActorRef`'s `subscribe`. |

`AnyActorRef` also has every member of [`ActorRefBase`](#actorrefbase). It is the type of the
`parent` option, of the default `system.get` result, and of the entries of a machine
snapshot's `children`.

```ts
import { Effect, Stream } from "effect"
import type { AnyActorRef } from "@jambudipa/xstate-effect"

export const forward = (ref: AnyActorRef) => ref.send({ type: "PING", from: "parent" })
export const listen = (ref: AnyActorRef) => ref.on("done", (event) => Effect.log(event.type))
export const failure = (ref: AnyActorRef) => Effect.flip(Stream.runDrain(ref.changes))
```

## UnknownActorRef

`UnknownActorRef` is `ActorRef<Snapshot, EventObject>`: its `getSnapshot` gives a `Snapshot`,
and its `send` takes every event object.

```ts
import { Effect } from "effect"
import { createEmptyActor, type UnknownActorRef } from "@jambudipa/xstate-effect"

const program = Effect.gen(function* () {
  const ref: UnknownActorRef = yield* createEmptyActor()
  const snapshot = yield* ref.getSnapshot
  return snapshot.status // "active"
})

void Effect.runPromise(Effect.scoped(program))
```

## EmittedOfType

`EmittedOfType<TEmitted, TType>` is the event type that an `on` handler of `type` receives:

| `TType` | Result |
|---|---|
| `"*"` | `TEmitted` |
| any, when `TEmitted["type"]` is `string` | `TEmitted` |
| a type that no member of `TEmitted` has as its own | `TEmitted & { readonly type: TType }` |
| a type of a member of `TEmitted` | the members of `TEmitted` with that type |

```ts
import type { ActorRef } from "@jambudipa/xstate-effect"

type Emitted = { type: "click"; x: number } | { type: "change" }

// { type: "click"; x: number }
export type Click = ActorRef.EmittedOfType<Emitted, "click">
```

## Type extractors

The extractors are in the `ActorRef` namespace of the module, so from the root they are
`ActorRef.ActorRef.<name>`.

| Type | Result |
|---|---|
| `ActorRef.ActorRef.SnapshotOf<T>` | The snapshot type of the reference type `T`. |
| `ActorRef.ActorRef.EventOf<T>` | The event type of `T`. |
| `ActorRef.ActorRef.EmittedOf<T>` | The emitted event type of `T`. |
| `ActorRef.ActorRef.Any` | `ActorRef<Snapshot, EventObject>`. Deprecated: use `ActorRef.ActorRefBase` to accept any reference. |

For the reference type of a logic or a machine, see `ActorRefFrom` and `ActorRefFromLogic` in
[Type utilities](./type-utilities.md).

```ts
import type { ActorRef, Snapshot } from "@jambudipa/xstate-effect"

type Ref = ActorRef<Snapshot<number>, { type: "GO" }>

export type Events = ActorRef.ActorRef.EventOf<Ref> // { type: "GO" }
```

## SnapshotStream

`SnapshotStream<TSnapshot, E>` gives read access to snapshots. It is covariant in `TSnapshot`,
so a `SnapshotStream` of a specific snapshot fits a `SnapshotStream<Snapshot, unknown>`.

| Member | Type | Value |
|---|---|---|
| `get` | `Effect.Effect<TSnapshot>` | The current snapshot. |
| `stream` | `Stream.Stream<TSnapshot, E>` | The current snapshot, then each change. |
| `changes` | `Stream.Stream<TSnapshot, E>` | Each change after the current snapshot. |

`E` is what the streams fail with. An actor's `snapshotStream` has `E = unknown`: its streams end
when the actor is done or stopped, and fail with the actor's error. A `SnapshotStream` from
`toSnapshotStream` has `E = never`, and its streams never end.

```ts
import { Effect, Stream } from "effect"
import type { Snapshot, SnapshotStream } from "@jambudipa/xstate-effect"

export const logStatuses = (snapshots: SnapshotStream<Snapshot, unknown>) =>
  snapshots.stream.pipe(Stream.runForEach((snapshot) => Effect.log(snapshot.status)))
```

## toSnapshotStream

**Type:** `<TSnapshot>(ref: SubscriptionRef.SubscriptionRef<TSnapshot>) => SnapshotStream<TSnapshot>`

**Gives:** a `SnapshotStream` whose `get` reads `ref`, whose `stream` gives the current value and
then each change, and whose `changes` gives each change only. The streams never end.

```ts
import { Effect, Stream, SubscriptionRef } from "effect"
import { toSnapshotStream } from "@jambudipa/xstate-effect"

const program = Effect.gen(function* () {
  const ref = yield* SubscriptionRef.make(0)
  const snapshots = toSnapshotStream(ref)
  yield* SubscriptionRef.set(ref, 1)
  return yield* snapshots.stream.pipe(Stream.take(1), Stream.runCollect) // [1]
})

void Effect.runPromise(program)
```

## isActorRef

**Type:** `(u: unknown) => u is ActorRef.ActorRefBase`

**Gives:** `true` for an object that carries `ActorRefTypeId`. Every actor carries it.

```ts
import { isActorRef } from "@jambudipa/xstate-effect"

export const idOf = (value: unknown): string | undefined => (isActorRef(value) ? value.id : undefined)
```

## getId

**Type:** `(refOrId: ActorRef.ActorRefBase | string) => string`

**Gives:** the reference's `id`, or the string as it is.

```ts
import { getId } from "@jambudipa/xstate-effect"

export const target = getId("logger") // "logger"
```

## equals

**Type:** `(a: ActorRef.ActorRefBase, b: ActorRef.ActorRefBase) => boolean`

**Gives:** `true` when `a` and `b` have the same system and the same session id. A session id is
unique in its system only: each root actor has its own system, numbered from `x:0`, so two root
actors have the same session id but are not equal.

```ts
import { Effect } from "effect"
import { createActor, createMachine, equals } from "@jambudipa/xstate-effect"

const idle = createMachine({ initial: "idle", states: { idle: {} } })

const program = Effect.gen(function* () {
  const first = yield* createActor(idle)
  const second = yield* createActor(idle)
  return [equals(first, first.ref), equals(first, second)] // [true, false]
})

void Effect.runPromise(Effect.scoped(program))
```

## isChildOf

**Type:** `(child: ActorRef.ActorRefBase, parent: ActorRef.ActorRefBase) => Effect.Effect<boolean>`

**Completes:** at once.

**Fails with:** nothing.

**Gives:** `true` when `child` has a parent and that parent [equals](#equals) `parent`.

```ts
import { Effect } from "effect"
import { createActor, createMachine, isChildOf } from "@jambudipa/xstate-effect"

const child = createMachine({ initial: "idle", states: { idle: {} } })
const parent = createMachine({ invoke: { id: "child", src: child } })

const program = Effect.gen(function* () {
  const actor = yield* createActor(parent)
  yield* actor.start
  const snapshot = yield* actor.getSnapshot
  const ref = snapshot.children["child"]
  return ref === undefined ? false : yield* isChildOf(ref, actor) // true
})

void Effect.runPromise(Effect.scoped(program))
```

## send

**Type:** `<TEvent extends EventObject>(ref: ActorRef<Snapshot, TEvent>, event: TEvent) => Effect.Effect<void>`

**Completes** and **fails** as `ref.send(event)`, which it calls.

```ts
import { Effect } from "effect"
import { type ActorRef, send, type Snapshot } from "@jambudipa/xstate-effect"

export const ping = (ref: ActorRef<Snapshot, { type: "PING" }>): Effect.Effect<void> => send(ref, { type: "PING" })
```

## sendUntyped

**Type:** `(ref: ActorRef.ActorRefBase, event: EventObject) => Effect.Effect<void>`

**Completes:** once the event is queued; it never waits for the macrostep.

**Fails with:** nothing.

It calls `ref.sendUntyped(event)`. No inspection event is sent for it.

```ts
import { ActorRef } from "@jambudipa/xstate-effect"

export const nudge = (ref: ActorRef.ActorRefBase) => ActorRef.sendUntyped(ref, { type: "NUDGE" })
```

## Related

- [createActor and the actor](./create-actor.md) — the full behaviour of each member.
- [The actor system](./actor-system.md) — `system.get` and `system.getAll`.
- [How to send events between actors](../how-to/send-events-between-actors.md)
- [About the actor model](../explanation/actor-model.md)
