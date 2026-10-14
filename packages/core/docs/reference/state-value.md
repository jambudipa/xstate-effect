---
title: State values
doc-type: reference
sources: [packages/core/src/StateValue.ts, packages/core/src/mapState.ts]
---

# State values

> **TL;DR:** A state value names the active states of a machine: a string for an atomic state,
> or an object that maps each active child key to its own state value. `matchesState` compares
> a pattern with a value as XState does, and `mapState` maps a machine snapshot to one result
> for each active state node. The `StateValue` namespace holds the other helpers; they are all
> synchronous.

All names on this page come from `@jambudipa/xstate-effect`. The root name `StateValue` is two
things: the type `StateValue`, and the namespace of the state-value module
(`StateValue.matches`, `StateValue.fromPath`, …). `matchesState`, `pathToStateValue` and
`mapState` are also root exports.

## Summary

### Types

| Name | Summary |
| --- | --- |
| [`StateValue`](#statevalue) | `string \| StateValueMap`. Also exported as `StateValueType` and read as `StateValue.StateValue`. |
| [`StateValueMap`](#statevalue) | `{ readonly [key: string]: StateValue }`. Also read as `StateValue.StateValueMap`. |

### Functions

| Name | Where | Returns | Summary |
| --- | --- | --- | --- |
| [`matchesState`](#matchesstate) | root, namespace | `boolean` | XState matching: whether a pattern matches a state value. |
| [`pathToStateValue`](#pathtostatevalue) | root, namespace | `StateValue` | A state value from a path; `{}` for the empty path. |
| [`mapState`](#mapstate) | root | `Array<{ stateNode, result }>` | One result for each active state node that has a mapper. |
| [`StateValue.isAtomicStateValue`, `StateValue.isCompoundStateValue`](#isatomicstatevalue-and-iscompoundstatevalue) | namespace | type guard | Whether a value is a string, or an object. |
| [`StateValue.atomic`, `StateValue.compound`](#atomic-and-compound) | namespace | `StateValue` | The value as given, typed as a state value. |
| [`StateValue.fromPath`](#frompath) | namespace | `StateValue` | A state value from a path; `""` for the empty path. |
| [`StateValue.fromString`](#fromstring) | namespace | `StateValue` | A state value from a dotted string. |
| [`StateValue.toStatePath`](#tostatepath) | namespace | `ReadonlyArray<string>` | A dotted string split into segments, with `\` as escape. |
| [`StateValue.toStrings`](#tostrings) | namespace | `ReadonlyArray<string>` | The dotted path of each leaf. |
| [`StateValue.getAtomicStateValues`](#getatomicstatevalues) | namespace | `HashSet<string>` | The dotted path of each leaf, as a set. |
| [`StateValue.matches`](#statevaluematches) | namespace | `boolean` | The package's own matching rule (not XState's). |
| [`StateValue.keys`](#keys) | namespace | `ReadonlyArray<string>` | The top-level keys of an object value. |
| [`StateValue.getChild`](#getchild) | namespace | `Option<StateValue>` | The value under one key. |
| [`StateValue.getFirstKey`](#getfirstkey) | namespace | `Option<string>` | The string, or the first key. |
| [`StateValue.hasPath`](#haspath) | namespace | `boolean` | Whether a path leads through the value. |
| [`StateValue.toHashMap`](#tohashmap) | namespace | `HashMap<string, StateValue>` | The top-level entries as a `HashMap`. |
| [`StateValue.merge`](#merge) | namespace | `StateValue` | Two values merged, the second first. |
| [`StateValue.getActiveStateIds`](#getactivestateids) | namespace | `Chunk<string>` | Ids built from the machine id and the keys of the value. |

## StateValue

```ts
export type StateValueShape = string | StateValueMapShape

export interface StateValueMapShape {
  readonly [key: string]: StateValueShape
}
```

| Machine state | State value |
| --- | --- |
| An atomic or final state `idle` at the top level | `"idle"` |
| A compound state `loading` whose active child is `pending` | `{ loading: "pending" }` |
| A parallel state `transfer` with regions `upload` and `download` | `{ transfer: { upload: "active", download: "idle" } }` |

`snapshot.value` is a state value. A machine made with `setup` types it more narrowly: see
`StateValueFrom` in [Type utilities](./type-utilities.md).

## matchesState

```ts
import type { StateValue } from "@jambudipa/xstate-effect"

export declare function matchesState(parentStateId: StateValue, childStateId: StateValue): boolean
```

- `parentStateId` is the pattern; `childStateId` is the value. Each may be a state value or a
  dotted string, which is read as a path (`"a.b.c"` is `{ a: { b: "c" } }`; `"a\\.b"` is the one
  key `a.b`).
- An atomic value matches only the same atomic pattern.
- An atomic pattern matches an object value that has the pattern as a key, so one region of a
  parallel state matches.
- An object pattern matches when each of its keys is in the value and matches there.
- A pattern more specific than the value does not match.
- Either side may also be an object with both a `machine` and a `value` key, such as a machine
  snapshot; its `value` is used. The parameter types take state values only.
- `snapshot.matches(pattern)` is `matchesState(pattern, snapshot.value)`.

| Pattern | Value | Result |
| --- | --- | --- |
| `"a"` | `{ a: "b" }` | `true` |
| `{ a: "b" }` | `"a"` | `false` |
| `"a.b"` | `{ a: { b: "c" } }` | `true` |
| `{ a: "x" }` | `{ a: "x", b: "y" }` | `true` |
| `"a"` | `{ a: "b", c: "d" }` | `true` |

```ts
import { matchesState } from "@jambudipa/xstate-effect"

console.log(matchesState("transfer.upload", { transfer: { upload: "active", download: "idle" } })) // true
console.log(matchesState({ transfer: { upload: "idle" } }, { transfer: { upload: "active" } })) // false
```

## pathToStateValue

```ts
import type { StateValue } from "@jambudipa/xstate-effect"

export declare function pathToStateValue(statePath: ReadonlyArray<string>): StateValue
```

- One segment gives that string; more segments nest: `["a", "b", "c"]` gives `{ a: { b: "c" } }`.
- The empty path gives `{}`, as in XState. `StateValue.fromPath` gives `""` for it instead.

## mapState

```ts
import type { MachineSnapshot, StateNode } from "@jambudipa/xstate-effect"

// The mapper type is not exported; its shape is below
interface Mapper<TSnapshot, TResult> {
  readonly map?: (snapshot: TSnapshot) => TResult
  readonly states?: { readonly [key: string]: Mapper<TSnapshot, TResult> | undefined }
}

export declare function mapState<TSnapshot extends MachineSnapshot.Any, TResult>(
  snapshot: TSnapshot,
  mapper: Mapper<TSnapshot, TResult>
): Array<{ readonly stateNode: StateNode.Any; readonly result: TResult }>
```

### Parameters

| Parameter | Description |
| --- | --- |
| `snapshot` | A machine snapshot. |
| `mapper` | A mapper object. `map` turns the snapshot into a result while the state is active. `states` holds the mappers of the child states by key, as deep as the machine's states go. |

For a machine made with `setup`, the keys of `states` are the machine's state keys: a key that
names no child state is a type error. A machine made without `setup` takes any key.

### Returns

One entry for each active state node whose mapper has a `map`:

| Field | Description |
| --- | --- |
| `stateNode` | The active state node: the snapshot's own node, not a copy. |
| `result` | What `map` returned for the snapshot. |

### Behaviour

- The order is leaf to root: the most specific state first.
- The walk starts from each active atomic state node in the order of `snapshot._nodes` and visits
  each node once. An ancestor that parallel regions share comes once, after the nodes of the
  first region.
- After a transition changes the active node of a parallel region that is not the last, the
  nodes of that region come after the nodes of the later regions.

### Example

```ts
import { Effect } from "effect"
import { createActor, createMachine, mapState } from "@jambudipa/xstate-effect"

const machine = createMachine({
  types: {} as { context: { count: number } },
  context: { count: 42 },
  initial: "a",
  states: { a: { initial: "one", states: { one: {} } } }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(machine)
  const snapshot = yield* actor.getSnapshot
  const results = mapState(snapshot, {
    map: ({ context }) => `root:${context.count}`,
    states: { a: { states: { one: { map: () => "one" } } } }
  })
  console.log(results.map((entry) => [entry.stateNode.id, entry.result]))
  // [["(machine).a.one", "one"], ["(machine)", "root:42"]]
})

void Effect.runPromise(Effect.scoped(program))
```

## isAtomicStateValue and isCompoundStateValue

```ts
import type { StateValue, StateValueMap } from "@jambudipa/xstate-effect"

export declare function isAtomicStateValue(value: StateValue): value is string
export declare function isCompoundStateValue(value: StateValue): value is StateValueMap
```

`isAtomicStateValue` is `true` for a string. `isCompoundStateValue` is `true` for an object that
is not `null`, the empty object included.

## atomic and compound

```ts
import type { StateValue, StateValueMap } from "@jambudipa/xstate-effect"

export declare function atomic(value: string): StateValue
export declare function compound(value: StateValueMap): StateValue
```

Each returns its argument unchanged, typed as a `StateValue`.

## fromPath

```ts
import type { StateValue } from "@jambudipa/xstate-effect"

export declare function fromPath(path: ReadonlyArray<string>): StateValue
```

| Path | Result |
| --- | --- |
| `[]` | `""` |
| `["idle"]` | `"idle"` |
| `["a", "b", "c"]` | `{ a: { b: "c" } }` |

## fromString

```ts
import type { StateValue } from "@jambudipa/xstate-effect"

export declare function fromString(str: string): StateValue
```

Splits on every `.` and calls `fromPath`: `"a.b.c"` gives `{ a: { b: "c" } }`, `"idle"` gives
`"idle"`, and `""` gives `""`. It has no escape character; `toStatePath` has one.

## toStatePath

```ts
export declare function toStatePath(statePath: string): ReadonlyArray<string>
```

Splits on `.`. A backslash makes the next character part of the segment: `"a\\.b"` gives
`["a.b"]`. `"a.b.c"` gives `["a", "b", "c"]`, and `""` gives `[""]`.

## toStrings

```ts
import type { StateValue } from "@jambudipa/xstate-effect"

export declare function toStrings(value: StateValue): ReadonlyArray<string>
```

- Returns the dotted path of each leaf: `"idle"` gives `["idle"]`, `{ a: "b" }` gives `["a.b"]`.
- It does not list the intermediate paths (`"a"` for `{ a: "b" }`).
- The order is not the key order: `{ a: { b: "c" }, d: "e" }` gives `["d.e", "a.b.c"]`.

## getAtomicStateValues

```ts
import type { HashSet } from "effect"
import type { StateValue } from "@jambudipa/xstate-effect"

export declare function getAtomicStateValues(value: StateValue): HashSet.HashSet<string>
```

Returns the dotted path of each leaf as a `HashSet`: `{ a: "b", c: { d: "e" } }` gives the set of
`"a.b"` and `"c.d.e"`.

## StateValue.matches

```ts
import type { StateValue } from "@jambudipa/xstate-effect"

export declare function matches(source: StateValue, target: StateValue): boolean
```

This is the package's own rule, not XState's. Use [`matchesState`](#matchesstate) or
`snapshot.matches` for XState matching.

| `source` | `target` | Rule |
| --- | --- | --- |
| string | string | Equal strings. |
| string | object | The object has exactly one key, and that key equals the string. |
| object | string | The object has exactly one key, and that key equals the string. |
| object | object | Each key of `target` is in `source`, and the two values under it match by this rule. |

| `source` | `target` | Result |
| --- | --- | --- |
| `"idle"` | `"idle"` | `true` |
| `{ a: "b" }` | `{ a: { b: "c" } }` | `true` |
| `{ a: { b: "c" } }` | `{ a: "b" }` | `true` |
| `"a"` | `{ a: "b", c: "d" }` | `false` |

## keys

```ts
import type { StateValue } from "@jambudipa/xstate-effect"

export declare function keys(value: StateValue): ReadonlyArray<string>
```

Returns `Object.keys(value)` for an object, and `[]` for a string.

## getChild

```ts
import type { Option } from "effect"
import type { StateValue } from "@jambudipa/xstate-effect"

export declare function getChild(value: StateValue, key: string): Option.Option<StateValue>
```

Returns `Option.some` of the value under `key`. Returns `Option.none()` for a string, and for a
key that is absent.

## getFirstKey

```ts
import type { Option } from "effect"
import type { StateValue } from "@jambudipa/xstate-effect"

export declare function getFirstKey(value: StateValue): Option.Option<string>
```

Returns `Option.some` of the string itself, or of the first key of an object. Returns
`Option.none()` for `{}`.

## hasPath

```ts
import type { StateValue } from "@jambudipa/xstate-effect"

export declare function hasPath(value: StateValue, path: ReadonlyArray<string>): boolean
```

- The empty path gives `true`.
- For a string, the path must be one segment equal to the string.
- For an object, the first segment must be a key; the rest of the path is checked against the
  value under it.

| Value | Path | Result |
| --- | --- | --- |
| `{ a: { b: "c" } }` | `["a", "b"]` | `true` |
| `{ a: { b: "c" } }` | `["a", "b", "c"]` | `true` |
| `{ a: "b" }` | `["a", "b", "c"]` | `false` |
| `"idle"` | `["idle"]` | `true` |

## toHashMap

```ts
import type { HashMap } from "effect"
import type { StateValue } from "@jambudipa/xstate-effect"

export declare function toHashMap(value: StateValue): HashMap.HashMap<string, StateValue>
```

Returns the top-level entries of an object as a `HashMap`; an empty `HashMap` for a string.

## merge

```ts
import type { StateValue } from "@jambudipa/xstate-effect"

export declare function merge(a: StateValue, b: StateValue): StateValue
```

- When either value is a string, the result is `b`.
- Otherwise the result has the keys of both. A key in both holds the merge of its two values.

| `a` | `b` | Result |
| --- | --- | --- |
| `{ a: "b" }` | `{ c: "d" }` | `{ a: "b", c: "d" }` |
| `{ a: { x: "1" } }` | `{ a: { y: "2" } }` | `{ a: { x: "1", y: "2" } }` |
| `"a"` | `{ c: "d" }` | `{ c: "d" }` |

## getActiveStateIds

```ts
import type { Chunk } from "effect"
import type { StateValue } from "@jambudipa/xstate-effect"

export declare function getActiveStateIds(value: StateValue, machineId: string): Chunk.Chunk<string>
```

- The first id is `machineId`. Each key of an object value adds `<machineId>.<path to the key>`,
  depth first.
- The string at the end of a path is not added: `"idle"` gives `["m"]` for machine id `m`, and
  `{ a: "b", c: { d: "e" } }` gives `["m", "m.a", "m.c", "m.c.d"]`.
- It reads only the value, not a machine: a state node with a custom `id` is not named by it.

## Related pages

- [Snapshots](./snapshots.md): `snapshot.value` and `snapshot.matches`.
- [State nodes](./state-nodes.md): the state node objects that `mapState` returns.
- [How to model parallel and history states](../how-to/model-parallel-and-history-states.md).
- [About state machines and statecharts](../explanation/state-machines.md).
