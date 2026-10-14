---
title: Snapshots
doc-type: reference
sources: [packages/core/src/Snapshot.ts]
---

# Snapshots

> **TL;DR:** A snapshot is the state of an actor at one moment. Every snapshot has `status`,
> `output` and `error`, and `output` and `error` are `Option`s. A machine snapshot adds `value`,
> `context`, `children`, `historyValue`, `tags`, `_nodes` and `machine`, and the query methods
> `matches`, `hasTag`, `can`, `getMeta` and `toJSON`. Only `can` returns an Effect.

All names on this page come from `@jambudipa/xstate-effect`. The root name `Snapshot` is two
things: the type `Snapshot<TOutput>`, and the namespace of the snapshot module
(`Snapshot.isSnapshot`, `Snapshot.stop`, …). Each function of the namespace is also a root
export, except `stop` and `withStatus`. The root `stop` is a different function: the deprecated
alias of `stopChild` (see [stopChild, stop and stopAllChildren](./actions/stop-child.md)).

## Summary

### Types

| Name | Summary |
| --- | --- |
| [`Snapshot<TOutput>`](#snapshot) | The snapshot of any actor. Also exported as `SnapshotType`. |
| [`SnapshotStatus`](#snapshotstatus) | `"active" \| "done" \| "error" \| "stopped"`. |
| [`MachineSnapshot<…>`](#machinesnapshot) | The snapshot of a state machine actor. |
| [`AnyMachineSnapshot`](#anymachinesnapshot) | A machine snapshot of any machine. |
| [`HistoryValue`, `AnyHistoryValue`](#historyvalue) | The configurations that the history states recorded. |
| [`StateConfig<TContext, TEvent>`, `AnyStateConfig`](#stateconfig) | The parts of a machine snapshot, as XState names them. |
| [`Snapshot.Snapshot.Output<T>`, `Snapshot.Snapshot.Any`](#type-extractors) | Extractors of the base snapshot type. |
| [`MachineSnapshot.Context<T>`, `.Value<T>`, `.Children<T>`, `.Output<T>`, `.StateSchemaOf<T>`, `.Any`](#type-extractors) | Extractors of the machine snapshot type. |
| [`MachineSnapshot.Machine`, `MachineSnapshot.Queries`](#machinesnapshotmachine) | The parts of the machine that a snapshot reads. |

### Values

| Name | Kind | Summary |
| --- | --- | --- |
| [`SnapshotTypeId`, `MachineSnapshotTypeId`](#type-ids-and-schema) | `unique symbol` | The brands that the type guards check. |
| [`SnapshotStatusSchema`](#type-ids-and-schema) | `Schema` | The schema of the four statuses. |
| [`isSnapshot`, `isMachineSnapshot`](#issnapshot-and-ismachinesnapshot) | type guard | Whether a value is a snapshot, or a machine snapshot. |
| [`active`, `done`, `error`, `stopped`](#active-done-error-and-stopped) | constructor | A plain snapshot of one status. |
| [`makeMachineSnapshot`](#makemachinesnapshot) | constructor | A machine snapshot from its fields. |
| [`initialMachineSnapshot`](#initialmachinesnapshot) | constructor | An active machine snapshot of a state value. |
| [`isActive`, `isDone`, `isError`, `isStopped`](#isactive-isdone-iserror-and-isstopped) | predicate | Whether a snapshot has one status. |
| [`matches`, `hasTag`, `getTags`](#matches-hastag-and-gettags) | query | The query methods as functions. |
| [`updateContext`, `updateValue`, `updateStatus`](#updatecontext-updatevalue-and-updatestatus) | copy | A machine snapshot with one field replaced. |
| [`complete`, `fail`, `Snapshot.stop`](#complete-fail-and-snapshotstop) | copy | A machine snapshot with a final status. |
| [`Snapshot.withStatus`](#snapshotwithstatus) | copy | Any snapshot with its status and error replaced. |

## Snapshot

The snapshot of any actor: a machine, a promise, a callback, an observable, an Effect or custom
logic. Each logic adds its own fields to these.

| Field | Type | Description |
| --- | --- | --- |
| `status` | `SnapshotStatus` | Where the actor is in its life. |
| `output` | `Option.Option<TOutput>` | `Some` together with status `done`; `None` otherwise. An `undefined` output is `None`, so `Some(undefined)` never occurs. |
| `error` | `Option.Option<unknown>` | The raw value that ended the actor, `Some` together with status `error`; `None` otherwise. An `undefined` error is `None`. |
| `[SnapshotTypeId]` | `SnapshotTypeId` | The brand that `isSnapshot` checks. It is an own enumerable field, so a spread of a snapshot keeps it. |

`TOutput` is covariant: a `Snapshot<number>` is a `Snapshot<unknown>`.

```ts
import { Effect, Option } from "effect"
import { createActor, fromPromise, toEffect } from "@jambudipa/xstate-effect"

const double = fromPromise<number, number>(({ input }) => Promise.resolve(input * 2))

const program = Effect.gen(function* () {
  const actor = yield* createActor(double, { input: 21 })
  yield* actor.start
  yield* toEffect(actor)
  const snapshot = yield* actor.getSnapshot
  console.log(snapshot.status) // "done"
  console.log(Option.getOrUndefined(snapshot.output)) // 42
  console.log(Option.isNone(snapshot.error)) // true
})

void Effect.runPromise(Effect.scoped(program))
```

## SnapshotStatus

| Status | Meaning | `output` | `error` |
| --- | --- | --- | --- |
| `"active"` | The actor runs and takes events. A new actor has this status before `start` too. | `None` | `None` |
| `"done"` | The actor finished. A machine reached a top-level final state. | `Some` of the output, or `None` for an `undefined` output | `None` |
| `"error"` | Something that the actor ran failed, threw or died. | `None` | `Some` of the raw value |
| `"stopped"` | The actor was stopped before it finished. | `None` | `None` |

## MachineSnapshot

The snapshot of a state machine actor. It extends [`Snapshot<TOutput>`](#snapshot).

### Type parameters

The parameters are in XState's order.

| Parameter | Default | Description |
| --- | --- | --- |
| `TContext` | `unknown` | The context type. Covariant. |
| `TEvent` | `EventObject` | The machine's events: what `can` takes. |
| `TChildren` | `Record<string, unknown>` | The type of `children`. Covariant. |
| `TStateValue` | `StateValue` | The type of `value`, and the base of what `matches` takes. |
| `TTag` | `string` | The machine's tags: what `hasTag` takes. |
| `TOutput` | `unknown` | The output type. Covariant. |
| `TMeta` | `unknown` | The state meta type: the values of `getMeta`. Covariant. |
| `_TStateSchema` | `StateSchema` | The state schema of the machine. It carries no value; it types the keys of `getMeta` and the mapper of `mapState`. |

`matches`, `hasTag` and `can` are methods, so a snapshot of typed state values, tags or events
is still assignable to a snapshot of the wide types.

### Fields

| Field | Type | Description |
| --- | --- | --- |
| `value` | `TStateValue` | The current [state value](./state-value.md). |
| `context` | `TContext` | The current context. A machine without a `context` config has `{}`. |
| `children` | `TChildren` | The child actors, keyed by actor id. |
| `historyValue` | `HistoryValue` | What each history state recorded. See [HistoryValue](#historyvalue). |
| `tags` | `ReadonlyArray<string>` | The tags of the active state nodes, each once, in the order of `_nodes`. |
| `_nodes` | `ReadonlyArray<StateNode.Any>` | The active state nodes, in the order they became active. A transition keeps the nodes it does not exit in their places and adds the nodes it enters after them, in document order. A restored or resolved snapshot lists them in configuration order. |
| `machine` | `MachineSnapshot.Machine` | At run time, the whole `StateMachine` object that produced the snapshot. The type keeps only `id` and the queries. |
| `status`, `output`, `error` | | As on [`Snapshot`](#snapshot). |

The query methods below are non-enumerable own properties. A spread or an equality check sees
only the fields. A spread keeps both brands, so `isMachineSnapshot` is still true for it, but it
has no methods.

### matches

```ts
import type { StateValue, Types } from "@jambudipa/xstate-effect"

export declare function matches<TStateValue extends StateValue>(
  partialStateValue: Types.ToTestStateValue<TStateValue>
): boolean
```

- Returns `matchesState(partialStateValue, snapshot.value)`. See
  [`matchesState`](./state-value.md#matchesstate).
- A dotted string is a path: `"a.b"` is `{ a: "b" }`.
- A key alone matches one region of a parallel state: `"upload"` matches
  `{ upload: "idle", download: "busy" }`.
- A pattern more specific than the value does not match.
- A machine made with `setup` takes only its own state keys, as deep as its states go. A machine
  made without `setup` takes any state value.

### hasTag

```ts
export declare function hasTag<TTag extends string>(tag: TTag): boolean
```

- Returns `true` when an active state node has the tag.
- `TTag` is the machine's `types.tags`; any string by default.

### can

```ts
import type { Effect } from "effect"
import type { EventObject, GuardError } from "@jambudipa/xstate-effect"

export declare function can<TEvent extends EventObject>(event: TEvent): Effect.Effect<boolean, GuardError>
```

- Succeeds with `true` when the event selects a transition that has a target or at least one
  action. An `on: { E: undefined }` entry, and a transition with no target and no action, give
  `false`.
- Guards run. No action runs, and nothing is spawned.
- Fails with a `GuardError` when a guard throws, dies or names no implementation. The message is
  `Unable to evaluate guard '<type>' in transition for event '<event>' in state node '<id>':`
  followed by the guard's own message.

### getMeta

```ts
export declare function getMeta<TStateId extends string, TMeta>(): Readonly<Partial<Record<TStateId, TMeta>>>
```

- Returns the `meta` of each active state node that has one, keyed by the state node's id, in
  the order of `_nodes`.
- For a machine made with `setup`, the keys are the machine's state ids, and `TMeta` is
  `types.meta`. A machine made without `setup` takes any key.

### toJSON

```ts
export declare function toJSON(): unknown
```

- `JSON.stringify` calls it. The result holds `status`, `output` (only when `Some`), `error`
  (only when `Some`), `context`, `value`, `children`, `historyValue` and `tags`.
- It leaves out `_nodes`, `machine` and the methods.
- Each child actor in `children` writes itself as `{ "xstate$$type": 1, "id": "<id>" }`.
- This is not the persisted form. To persist an actor, use `getPersistedSnapshot`; see
  [Persisted snapshots](./persistence.md).

### Example

```ts
import { Effect } from "effect"
import { createActor, setup } from "@jambudipa/xstate-effect"

export const door = setup({
  types: {} as {
    events: { type: "OPEN" } | { type: "CLOSE" }
    tags: "shut"
    meta: { label: string }
  }
}).createMachine({
  id: "door",
  initial: "closed",
  states: {
    closed: { tags: ["shut"], meta: { label: "Closed" }, on: { OPEN: "open" } },
    open: { meta: { label: "Open" }, on: { CLOSE: "closed" } }
  }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(door)
  yield* actor.start
  const snapshot = yield* actor.getSnapshot

  console.log(snapshot.value) // "closed"
  console.log(snapshot.matches("closed")) // true
  console.log(snapshot.hasTag("shut")) // true
  console.log(snapshot.getMeta()) // { "door.closed": { label: "Closed" } }
  console.log(yield* snapshot.can({ type: "OPEN" })) // true
  console.log(yield* snapshot.can({ type: "CLOSE" })) // false
  console.log(JSON.stringify(snapshot))
  // {"status":"active","context":{},"value":"closed","children":{},"historyValue":{},"tags":["shut"]}
})

void Effect.runPromise(Effect.scoped(program))
```

## AnyMachineSnapshot

`AnyMachineSnapshot` is `MachineSnapshot` with every parameter at its default. Every machine
snapshot is assignable to it.

## HistoryValue

```ts
import type { AnyStateNode } from "@jambudipa/xstate-effect"

export interface HistoryValueShape {
  readonly [historyStateNodeId: string]: ReadonlyArray<AnyStateNode>
}
```

- The key is the id of a history state node.
- The value is what that history state recorded when its parent last exited: the active direct
  children of the parent for a shallow history, its active atomic descendants for a deep
  history.
- `AnyHistoryValue` is the same type.
- The persisted form holds the ids of the state nodes only. See
  [Persisted snapshots](./persistence.md#historyvalue).

## StateConfig

`StateConfig<TContext, TEvent>` lists what a machine snapshot is made from, as XState names it.
No function of the package takes it; it exists for type parity with XState.
`AnyStateConfig` is `StateConfig` of any context and event.

| Field | Type | Required |
| --- | --- | --- |
| `context` | `TContext` | yes |
| `historyValue` | `HistoryValue` | no |
| `_nodes` | `ReadonlyArray<StateNode<TContext, TEvent, …>>` | yes |
| `children` | `Readonly<Record<string, AnyActorRef>>` | yes |
| `status` | `SnapshotStatus` | yes |
| `output` | `Option.Option<unknown>` | no |
| `error` | `Option.Option<unknown>` | no |
| `machine` | `AnyStateMachine` | no |

## MachineSnapshot.Machine

| Member | Type | Description |
| --- | --- | --- |
| `id` | `string` | The machine's id: its config `id`, or `(machine)` when that is missing or empty. |
| `_snapshotQueries` | `MachineSnapshot.Queries` | Internal. What the query methods read from the machine: `nodes`, `stateNodeById`, `tags` and `can`. |

At run time `snapshot.machine` is the whole `StateMachine` object.

## isSnapshot and isMachineSnapshot

```ts
import type { MachineSnapshot, Snapshot } from "@jambudipa/xstate-effect"

export declare function isSnapshot(u: unknown): u is Snapshot
export declare function isMachineSnapshot(u: unknown): u is MachineSnapshot
```

- `isSnapshot` checks for the `SnapshotTypeId` brand; `isMachineSnapshot` checks for the
  `MachineSnapshotTypeId` brand.
- A parsed persisted snapshot has no brand, so both return `false` for it.

## active, done, error and stopped

```ts
import type { Snapshot } from "@jambudipa/xstate-effect"

export declare function active(): Snapshot<never>
export declare function done<TOutput>(output: TOutput): Snapshot<TOutput>
export declare function error(err: unknown): Snapshot<never>
export declare function stopped(): Snapshot<never>
```

Each returns a plain snapshot with only the base fields: `status`, `output`, `error` and the
`SnapshotTypeId` brand. `done` sets `output` to `Option.some(output)`; `error` sets `error` to
`Option.some(err)`.

```ts
import { Option } from "effect"
import { done, isDone, isMachineSnapshot } from "@jambudipa/xstate-effect"

const finished = done({ total: 3 })
console.log(isDone(finished), isMachineSnapshot(finished)) // true false
console.log(Option.getOrUndefined(finished.output)) // { total: 3 }
```

## makeMachineSnapshot

```ts
import type { Option } from "effect"
import type { EventObject, HistoryValue, MachineSnapshot, SnapshotStatus, StateNode, StateValue } from "@jambudipa/xstate-effect"

export declare function makeMachineSnapshot<
  TContext,
  TStateValue extends StateValue,
  TChildren extends Record<string, unknown>,
  TOutput,
  TMeta = unknown
>(options: {
  readonly value: TStateValue
  readonly context: TContext
  readonly status: SnapshotStatus
  readonly children: TChildren
  readonly historyValue: HistoryValue
  readonly tags: ReadonlyArray<string>
  readonly _nodes?: ReadonlyArray<StateNode.Any>
  readonly output: Option.Option<TOutput>
  readonly error: Option.Option<unknown>
  readonly machine: MachineSnapshot.Machine
}): MachineSnapshot<TContext, EventObject, TChildren, TStateValue, string, TOutput, TMeta>
```

- Builds a machine snapshot and attaches the query methods. Every snapshot that the engine
  builds comes from this function.
- Without `_nodes`, the snapshot lists the state nodes that `value` names in `machine`.
- `tags` is used as given: it is not computed from the value.
- Pass `snapshot.machine` of an existing snapshot, or the machine itself, as `machine`.

## initialMachineSnapshot

```ts
import type { EventObject, MachineSnapshot, StateValue } from "@jambudipa/xstate-effect"

export declare function initialMachineSnapshot<TContext>(
  value: StateValue,
  context: TContext,
  machine: MachineSnapshot.Machine
): MachineSnapshot<TContext, EventObject, Record<string, never>, StateValue, string, never>
```

Returns a machine snapshot with status `active`, no children, no history, no output and no
error. `tags` are the tags of the state nodes that `value` names in `machine`; none when it names
no state. No entry action runs.

## isActive, isDone, isError and isStopped

```ts
import type { Snapshot } from "@jambudipa/xstate-effect"

export declare function isActive<TOutput>(snapshot: Snapshot<TOutput>): boolean
export declare function isDone<TOutput>(snapshot: Snapshot<TOutput>): boolean
export declare function isError<TOutput>(snapshot: Snapshot<TOutput>): boolean
export declare function isStopped<TOutput>(snapshot: Snapshot<TOutput>): boolean
```

Each compares `snapshot.status` with one status. None of them narrows the type.

## matches, hasTag and getTags

```ts
import type { EventObject, MachineSnapshot, StateValue } from "@jambudipa/xstate-effect"

type AnyOf<TContext, TStateValue extends StateValue, TChildren extends Record<string, unknown>, TOutput> =
  MachineSnapshot<TContext, EventObject, TChildren, TStateValue, string, TOutput>

export declare function matches<TContext, TStateValue extends StateValue, TChildren extends Record<string, unknown>, TOutput>(
  snapshot: AnyOf<TContext, TStateValue, TChildren, TOutput>,
  stateValue: StateValue
): boolean
export declare function hasTag<TContext, TStateValue extends StateValue, TChildren extends Record<string, unknown>, TOutput>(
  snapshot: AnyOf<TContext, TStateValue, TChildren, TOutput>,
  tag: string
): boolean
export declare function getTags<TContext, TStateValue extends StateValue, TChildren extends Record<string, unknown>, TOutput>(
  snapshot: AnyOf<TContext, TStateValue, TChildren, TOutput>
): ReadonlyArray<string>
```

- `matches(snapshot, stateValue)` is `snapshot.matches(stateValue)`, but takes any state value.
- `hasTag(snapshot, tag)` is `snapshot.hasTag(tag)`, but takes any string.
- `getTags(snapshot)` returns a new array of `snapshot.tags`.

## updateContext, updateValue and updateStatus

```ts
import type { EventObject, MachineSnapshot, SnapshotStatus, StateValue } from "@jambudipa/xstate-effect"

type Of<TContext, TStateValue extends StateValue, TChildren extends Record<string, unknown>, TOutput> =
  MachineSnapshot<TContext, EventObject, TChildren, TStateValue, string, TOutput>

export declare function updateContext<TContext, TStateValue extends StateValue, TChildren extends Record<string, unknown>, TOutput, TNewContext>(
  snapshot: Of<TContext, TStateValue, TChildren, TOutput>,
  context: TNewContext
): Of<TNewContext, TStateValue, TChildren, TOutput>
export declare function updateValue<TContext, TStateValue extends StateValue, TChildren extends Record<string, unknown>, TOutput, TNewStateValue extends StateValue>(
  snapshot: Of<TContext, TStateValue, TChildren, TOutput>,
  value: TNewStateValue
): Of<TContext, TNewStateValue, TChildren, TOutput>
export declare function updateStatus<TContext, TStateValue extends StateValue, TChildren extends Record<string, unknown>, TOutput>(
  snapshot: Of<TContext, TStateValue, TChildren, TOutput>,
  status: SnapshotStatus
): Of<TContext, TStateValue, TChildren, TOutput>
```

- Each returns a new machine snapshot with the query methods. The given snapshot does not change.
- No action runs, and no transition is taken.
- `updateValue` sets `_nodes` to the nodes of the new value. It keeps `tags` as they were: the
  tags are not computed again.
- `updateStatus` changes only `status`: `output` and `error` stay as they were.

## complete, fail and Snapshot.stop

```ts
import type { EventObject, MachineSnapshot, StateValue } from "@jambudipa/xstate-effect"

type Of<TContext, TStateValue extends StateValue, TChildren extends Record<string, unknown>, TOutput> =
  MachineSnapshot<TContext, EventObject, TChildren, TStateValue, string, TOutput>

export declare function complete<TContext, TStateValue extends StateValue, TChildren extends Record<string, unknown>, TOutput, TNewOutput>(
  snapshot: Of<TContext, TStateValue, TChildren, TOutput>,
  output: TNewOutput
): Of<TContext, TStateValue, TChildren, TNewOutput>
export declare function fail<TContext, TStateValue extends StateValue, TChildren extends Record<string, unknown>, TOutput>(
  snapshot: Of<TContext, TStateValue, TChildren, TOutput>,
  err: unknown
): Of<TContext, TStateValue, TChildren, TOutput>
// Read as Snapshot.stop: the root `stop` is the stopChild alias
export declare function stop<TContext, TStateValue extends StateValue, TChildren extends Record<string, unknown>, TOutput>(
  snapshot: Of<TContext, TStateValue, TChildren, TOutput>
): Of<TContext, TStateValue, TChildren, TOutput>
```

| Function | `status` | `output` | `error` |
| --- | --- | --- | --- |
| `complete(snapshot, output)` | `"done"` | `Option.some(output)` | as before |
| `fail(snapshot, err)` | `"error"` | as before | `Option.some(err)` |
| `Snapshot.stop(snapshot)` | `"stopped"` | as before | as before |

```ts
import { Effect } from "effect"
import { Snapshot, complete, createActor, createMachine, updateContext } from "@jambudipa/xstate-effect"

const counter = createMachine({
  types: {} as { context: { count: number } },
  context: { count: 0 },
  initial: "counting",
  states: { counting: {} }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(counter)
  const snapshot = yield* actor.getSnapshot

  const changed = updateContext(snapshot, { count: 5 })
  console.log(changed.context.count, changed.matches("counting")) // 5 true
  console.log(complete(changed, "all done").status) // "done"
  console.log(Snapshot.stop(snapshot).status, snapshot.status) // "stopped" "active"
})

void Effect.runPromise(Effect.scoped(program))
```

## Snapshot.withStatus

```ts
import type { Option } from "effect"
import type { Snapshot, SnapshotStatus } from "@jambudipa/xstate-effect"

export declare function withStatus<TSnapshot extends Snapshot>(
  snapshot: TSnapshot,
  fields: { readonly status: SnapshotStatus; readonly error?: Option.Option<unknown> }
): TSnapshot
```

- Returns a copy of any snapshot with `status`, and `error` when given, replaced.
- A machine snapshot is built again with `makeMachineSnapshot`, so it keeps its query methods.
  Any other snapshot is spread.
- Only on the namespace: read it as `Snapshot.withStatus`.

## Type extractors

| Type | Result |
| --- | --- |
| `Snapshot.Snapshot.Output<T>` | The output type of a `Snapshot`; `never` for another type. |
| `Snapshot.Snapshot.Any` | `Snapshot`. |
| `MachineSnapshot.Context<T>` | The context type. |
| `MachineSnapshot.Value<T>` | The state value type. |
| `MachineSnapshot.Children<T>` | The children type. |
| `MachineSnapshot.Output<T>` | The output type. |
| `MachineSnapshot.StateSchemaOf<T>` | The state schema; the wide `StateSchema` for a machine made without `setup`. |
| `MachineSnapshot.Any` | `MachineSnapshot`. |

```ts
import { createMachine } from "@jambudipa/xstate-effect"
import type { MachineSnapshot, SnapshotFrom } from "@jambudipa/xstate-effect"

export const toggle = createMachine({
  types: {} as { context: { on: boolean } },
  context: { on: false },
  initial: "off",
  states: { off: {}, on: {} }
})

type ToggleSnapshot = SnapshotFrom<typeof toggle>

export type ToggleContext = MachineSnapshot.Context<ToggleSnapshot> // { on: boolean }
export type ToggleValue = MachineSnapshot.Value<ToggleSnapshot>
```

## Type ids and schema

| Name | Value |
| --- | --- |
| `SnapshotTypeId` | `Symbol.for("@jambudipa/xstate-effect/Snapshot")` |
| `MachineSnapshotTypeId` | `Symbol.for("@jambudipa/xstate-effect/MachineSnapshot")` |
| `SnapshotStatusSchema` | `Schema.Literals(["active", "done", "error", "stopped"])` |

## Related pages

- [createActor and the actor](./create-actor.md): `getSnapshot`, `changes` and
  `getPersistedSnapshot`.
- [State values](./state-value.md): what `value` holds and how `matches` compares it.
- [Persisted snapshots](./persistence.md): the JSON form of a snapshot.
- [How to react to snapshot changes](../how-to/react-to-snapshot-changes.md).
