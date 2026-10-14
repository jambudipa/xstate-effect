---
title: Events
doc-type: reference
sources: [packages/core/src/Event.ts, packages/core/src/assert.ts]
---

# Events

> **TL;DR:** An event is a plain object with a string `type`. The built-in events
> (`xstate.init`, `xstate.done.actor.<id>`, `xstate.error.actor.<id>`, `xstate.done.state.<id>`,
> `xstate.after.<delay>.<id>`, `xstate.snapshot.<id>`, `xstate.stop`) are plain objects too: their
> classes only build them, so `instanceof` is never true. The `output` of a done event is an
> `Option`. Event descriptors (`"a.b"`, `"a.*"`, `"*"`) select events in `on` keys and in
> `assertEvent`, which returns an Effect that fails with an `EventAssertionError`.

All names on this page come from `@jambudipa/xstate-effect`. The module namespace `Event` holds
the same values, plus `matchEventDescriptor` and the `EventDescriptorMatch` type.

## Summary

### Types

| Name | Definition | Summary |
|---|---|---|
| [`EventObject`](#eventobject) | `{ readonly type: string }` | The base type of every event. |
| [`AnyEventObject`](#anyeventobject) | `EventObject & { [key: string]: any }` | The event type of a machine whose `types` declare no events. |
| [`EventType<TEvent>`](#type-utilities) | `TEvent["type"]` | The `type` of an event. |
| [`EventByType<TEvent, TType>`](#type-utilities) | `Extract<TEvent, { readonly type: TType }>` | The members of an event union with one type. |
| [`EventDescriptor<TEvent>`](#type-utilities) | a type, a partial descriptor or `"*"` | What an `on` key or `assertEvent` takes. |
| [`ExtractEvent<TEvent, TDescriptor>`](#type-utilities) | the matching members | The members of an event union that a descriptor selects. |
| [`WildcardEvent`](#type-utilities) | `"*"` | The wildcard descriptor. |
| [`EventlessEvent`](#type-utilities) | `""` | The type of the null event of eventless transitions. |
| [`Event.EventDescriptorMatch`](#eventmatcheventdescriptor) | `{ matches: boolean; warnings: ReadonlyArray<string> }` | The result of `Event.matchEventDescriptor`. |

### Built-in events

| Class | `type` | Fields | Guard |
|---|---|---|---|
| [`InitEvent`](#initevent) | `xstate.init` | `input` | none |
| [`StopEvent`](#stopevent) | `xstate.stop` | none | none |
| [`DoneActorEvent`](#doneactorevent) | `xstate.done.actor.<actorId>` | `output: Option`, `actorId` | `isDoneActorEvent` |
| [`ErrorActorEvent`](#erroractorevent) | `xstate.error.actor.<actorId>` | `error`, `actorId` | `isErrorActorEvent` |
| [`DoneStateEvent`](#donestateevent) | `xstate.done.state.<stateId>` | `output: Option` | `isDoneStateEvent` |
| [`AfterEvent`](#afterevent) | `xstate.after.<delay>.<stateNodeId>` | none | `isAfterEvent` |
| [`SnapshotEvent`](#snapshotevent) | `xstate.snapshot.<actorId>` | `snapshot` | none |
| [`NULL_EVENT`](#null_event) | `""` | none | `isNullEvent` |

### Functions

| Name | Signature | Summary |
|---|---|---|
| [`isEventObject`](#iseventobject) | `(u: unknown) => u is EventObject` | Whether a value is an object with a string `type`. |
| [`isDoneActorEvent`](#built-in-event-guards) | `(event: EventObject) => event is DoneActorEvent` | `type` starts with `xstate.done.actor.` |
| [`isErrorActorEvent`](#built-in-event-guards) | `(event: EventObject) => event is ErrorActorEvent` | `type` starts with `xstate.error.actor.` |
| [`isDoneStateEvent`](#built-in-event-guards) | `(event: EventObject) => event is DoneStateEvent` | `type` starts with `xstate.done.state.` |
| [`isAfterEvent`](#built-in-event-guards) | `(event: EventObject) => event is AfterEvent` | `type` starts with `xstate.after.` |
| [`isNullEvent`](#null_event) | `(event: EventObject) => boolean` | `type` is `""`. |
| [`isWildcardType`](#iswildcardtype) | `(type: string) => type is "*"` | `type` is `"*"`. |
| [`matchesEventDescriptor`](#matcheseventdescriptor) | `(eventType: string, descriptor: string) => boolean` | Whether a descriptor selects an event type. |
| [`Event.matchEventDescriptor`](#eventmatcheventdescriptor) | `(eventType: string, descriptor: string) => EventDescriptorMatch` | The same match, with the warnings for a malformed wildcard. |
| [`assertEvent`](#assertevent) | `(event, type) => Effect<narrowed event, EventAssertionError>` | Narrows an event to the types given, or fails. |

## EventObject

```ts
import type { EventObject } from "@jambudipa/xstate-effect"

export type Events =
  | { readonly type: "SUBMIT"; readonly email: string }
  | { readonly type: "CANCEL" }

export const submit: EventObject = { type: "SUBMIT" }
```

- Every event has a string `type`. Other fields are free.
- `on` keys, wildcard descriptors and `assertEvent` read `type`.
- The prefix `xstate.` belongs to the built-in events.
- `actor.send` takes event objects only. A string is a defect of `send`; see
  [Errors](./errors.md#actorerror).

## AnyEventObject

- `EventObject` with an index signature of upstream's `any`.
- `createMachine` and `setup` infer it as the event type of a machine whose `types` declare no
  events. A guard, an action or a params function of such a machine can read any field of its
  event, and its actor takes events with any fields.

## Built-in events

Each built-in event class is a constructor only. `new DoneActorEvent(...)` returns a plain object
with an own `type` first, then the fields in the order of the table. The object has no `_tag`,
and `instanceof` is never true. Test a built-in event by its `type`, or with its guard.

### InitEvent

**Construct:** `new InitEvent({ input })` → `{ type: "xstate.init", input }`

- The first event a machine processes.
- `input` is the actor input as given to `createActor`. It is `undefined` when there is none.

### StopEvent

**Construct:** `new StopEvent()` → `{ type: "xstate.stop" }`

- The internal event that stops an actor. `actor.stop` and a parent's stop of its children give
  the logic this event. A stop through the close of a scope does not.

### DoneActorEvent

**Construct:** `new DoneActorEvent({ actorId, output })` →
`{ type: "xstate.done.actor.<actorId>", output, actorId }`

- The event a parent receives when a child actor is done.
- `output` is an `Option` of the child's output: `Option.none()` where XState gives `undefined`.
- `actorId` is the id of the child, as its parent knows it.
- The `onDone` of the invocation with that id takes it.
- Type parameters: `DoneActorEvent<TOutput = unknown, TId extends string = string>`.

### ErrorActorEvent

**Construct:** `new ErrorActorEvent({ actorId, error })` →
`{ type: "xstate.error.actor.<actorId>", error, actorId }`

- The event a parent receives when a child actor fails.
- `error` is the value the child failed with, as it is: not wrapped, and not an `Option`.
- The `onError` of the invocation with that id takes it.
- Type parameters: `ErrorActorEvent<TErrorData = unknown, TId extends string = string>`.

### DoneStateEvent

**Construct:** `new DoneStateEvent({ stateId, output })` →
`{ type: "xstate.done.state.<stateId>", output }`

- The event raised when a compound or parallel state node is done. `stateId` is that state
  node's id.
- `output` is an `Option` of the output that the final state resolves.
- The `onDone` of that state node takes it.

### AfterEvent

**Construct:** `new AfterEvent({ delay, stateNodeId })` →
`{ type: "xstate.after.<delay>.<stateNodeId>" }`

- The event that a delayed (`after`) transition waits for.
- `delay` is the key of the `after` entry: a number of milliseconds, or the name of a delay, also
  when that delay is computed at run time.
- Only the `after` entry that scheduled it takes it.

### SnapshotEvent

**Construct:** `new SnapshotEvent({ actorId, snapshot })` →
`{ type: "xstate.snapshot.<actorId>", snapshot }`

- The event a parent receives with each active snapshot of a child that was created with
  `syncSnapshot: true`.
- `snapshot` is the child's snapshot, as the child published it.

### NULL_EVENT

**Value:** `NULL_EVENT: EventObject` = `{ type: "" }`

- The event of eventless (`always`) transitions.
- `isNullEvent(event)` is `true` when `event.type` is `""`.

### Event.ObservableNextEvent

**Construct:** `new Event.ObservableNextEvent({ data })` → `{ type: "xstate.observable.next", data }`

- Internal. An observable actor sends it to itself for each value its source emits. It is
  reachable only through the `Event` namespace.

### Example

```ts
import { Option } from "effect"
import { DoneActorEvent, ErrorActorEvent, isDoneActorEvent } from "@jambudipa/xstate-effect"

const done = new DoneActorEvent({ actorId: "fetchUser", output: Option.some({ name: "Ada" }) })
console.log(done)
// { type: "xstate.done.actor.fetchUser", output: Option.some({ name: "Ada" }), actorId: "fetchUser" }
console.log(done instanceof DoneActorEvent) // false: a plain object
console.log(isDoneActorEvent(done)) // true

export const failed = new ErrorActorEvent({ actorId: "fetchUser", error: "timeout" })
// { type: "xstate.error.actor.fetchUser", error: "timeout", actorId: "fetchUser" }
```

## isEventObject

**Signature:** `isEventObject(u: unknown): u is EventObject`

- `true` for an object whose `type` is a string.

## Built-in event guards

**Signatures:** `isDoneActorEvent`, `isErrorActorEvent`, `isDoneStateEvent` and `isAfterEvent`,
each `(event: EventObject) => event is <the built-in event>`

- Each checks the prefix of `event.type` only: `xstate.done.actor.`, `xstate.error.actor.`,
  `xstate.done.state.` and `xstate.after.`.

## isWildcardType

**Signature:** `isWildcardType(type: string): type is "*"`

- `true` when `type` is `"*"`.

## Type utilities

```ts
import type { EventByType, EventDescriptor, EventType, ExtractEvent } from "@jambudipa/xstate-effect"

type Events =
  | { readonly type: "feedback.good" }
  | { readonly type: "feedback.bad"; readonly reason: string }
  | { readonly type: "close" }

// "feedback.good" | "feedback.bad" | "close"
export type Types = EventType<Events>

// { readonly type: "feedback.bad"; readonly reason: string }
export type Bad = EventByType<Events, "feedback.bad">

// "feedback.good" | "feedback.bad" | "close" | "feedback.*" | "*"
export type Descriptor = EventDescriptor<Events>

// { readonly type: "feedback.good" } | { readonly type: "feedback.bad"; readonly reason: string }
export type Feedback = ExtractEvent<Events, "feedback.*">
```

| Type | Definition |
|---|---|
| `EventType<TEvent>` | `TEvent["type"]`. |
| `EventByType<TEvent, TType>` | The members of `TEvent` whose `type` is `TType`. |
| `EventDescriptor<TEvent>` | Each event type, each partial descriptor of a dotted type (`a.*` and `a.b.*` for `a.b.c`), and `"*"`. A type without `.` has no partial descriptor. |
| `ExtractEvent<TEvent, TDescriptor>` | The members of `TEvent` that the descriptor selects: the events of that type, every event under a partial descriptor, or every event for `"*"`. An event union whose `type` is the wide `string` stays as it is. |
| `WildcardEvent` | `"*"`. |
| `EventlessEvent` | `""`. |

## matchesEventDescriptor

**Signature:** `matchesEventDescriptor(eventType: string, descriptor: string): boolean`

- `true` when the descriptor equals the event type.
- `true` for the descriptor `"*"`.
- A partial descriptor ends in `.*`. It is compared with the event type token by token (tokens
  split on `.`) up to its `*` token, which matches the rest of the event type, also nothing.
- Any other descriptor, for example `a*` or `a.*.b`, does not match.
- A descriptor that ends in `.*` and has another `*` before the end never matches.

| Event type | Descriptor | Result |
|---|---|---|
| `a.b` | `a.b` | `true` |
| `a.b` | `*` | `true` |
| `a.b.c` | `a.*` | `true` |
| `a` | `a.*` | `true` |
| `ab` | `a.*` | `false` |
| `a.b` | `a*` | `false` |
| `a.b.c` | `a.*.c` | `false` |
| `a.b` | `a.*.*` | `false`, with two warnings |

## Event.matchEventDescriptor

**Signature:** `Event.matchEventDescriptor(eventType: string, descriptor: string): Event.EventDescriptorMatch`

- `matches` is the result of [`matchesEventDescriptor`](#matcheseventdescriptor).
- `warnings` is empty for a well-formed descriptor. The function logs nothing; the caller does.
- A descriptor that ends in `.*` with a `*` before the end gets the warning
  ``Wildcards can only be the last token of an event descriptor (e.g., "event.*") or the entire event descriptor ("*"). Check the "<descriptor>" event.``
- When the tokens of that descriptor match the event type up to its first `*`, a second warning
  follows: ``Infix wildcards in transition events are not allowed. Check the "<descriptor>" transition.``

## assertEvent

```ts
import type { Effect } from "effect"
import type { EventDescriptor, EventObject, ExtractEvent } from "@jambudipa/xstate-effect"

// The error type: `Errors.EventAssertionError` (not exported from the root)
interface EventAssertionError {
  readonly _tag: "EventAssertionError"
  readonly message: string
}

export declare function assertEvent<TEvent extends EventObject, TAssertedDescriptor extends EventDescriptor<TEvent>>(
  event: TEvent,
  type: TAssertedDescriptor | ReadonlyArray<TAssertedDescriptor>
): Effect.Effect<ExtractEvent<TEvent, TAssertedDescriptor>, EventAssertionError>
```

- `type` is one descriptor or an array of descriptors: event types, partial descriptors such as
  `"feedback.*"`, or `"*"`.
- When one descriptor matches the event, the Effect succeeds with the same event, narrowed to the
  events those descriptors select.
- Otherwise the Effect fails with `Errors.EventAssertionError`. Its `message` is
  `Expected event <the event as JSON> to have type matching "<type>"` for one type, and
  `Expected event <the event as JSON> to have one of types matching "<type1>", "<type2>"` for
  several.
- In an action, a failed `assertEvent` Effect gives the actor status `error` with the
  `EventAssertionError` in `snapshot.error`.

```ts
import { Effect } from "effect"
import { assertEvent } from "@jambudipa/xstate-effect"

type Events =
  | { readonly type: "greet"; readonly message: string }
  | { readonly type: "notify"; readonly message: string; readonly level: "info" | "error" }
  | { readonly type: "count"; readonly value: number }

// Succeeds with the message of a greet or a notify event
export const messageOf = (event: Events) =>
  Effect.map(assertEvent(event, ["greet", "notify"]), (narrowed) => narrowed.message)

// Fails: Expected event {"type":"count","value":1} to have one of types matching "greet", "notify"
export const failure = messageOf({ type: "count", value: 1 }).pipe(
  Effect.catchTag("EventAssertionError", (error) => Effect.succeed(error.message))
)
```

## Related

- [Errors](./errors.md): `EventAssertionError` and the other error classes.
- [How to emit events and listen to them](../how-to/emit-and-listen-to-events.md).
- [How to send events between actors](../how-to/send-events-between-actors.md).
- [How an actor processes events](../explanation/event-processing.md).
