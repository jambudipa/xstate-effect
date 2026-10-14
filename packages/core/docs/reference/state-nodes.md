---
title: State nodes
doc-type: reference
sources: [packages/core/src/StateNode.ts]
---

# State nodes

> **TL;DR:** A machine builds one `StateNode` for each state of its config, linked into a tree
> under `machine.root`. The root exports functions that read nodes (`getChild`, `getChildren`,
> `getTransitions`, `getInitialTarget`, `getLeafStates`), test them (`isAtomic`, `isLeaf`,
> `isAncestor` and the others), build nodes outside a machine (`atomic`, `compound`, `parallel`,
> `final`, `historyState`, `makeStateNode`) and copy a node with one field changed (`withTags`
> and the other `with*` functions). Each function is also a static member of the `StateNode`
> class.

Every item on this page is exported from `@jambudipa/xstate-effect`. `StateNode` is a class, a
type and a namespace of types under one name.

## Summary

| Item | Kind | Description |
|---|---|---|
| [`StateNode`](#the-statenode-class) | class | The class of every state node. |
| [Node properties](#properties) | fields and getters | `id`, `key`, `path`, `type`, `states`, `transitions`, `initial`, `definition` and the others. |
| [`makeStateNode`](#makestatenode) | function | Builds a node from all of its fields. |
| [`atomic`, `compound`, `parallel`, `final`, `historyState`](#atomic-compound-parallel-final-and-historystate) | functions | Build a node of one type, outside a machine. |
| [`getChild`](#getchild) | function | The child node of a key, as an `Option`. |
| [`getChildren`](#getchildren) | function | The child nodes, as a `Chunk`. |
| [`getTransitions`](#gettransitions) | function | The transitions of one event descriptor. |
| [`getInitialTarget`](#getinitialtarget) | function | The keys of the initial child. |
| [`getLeafStates`](#getleafstates) | function | The atomic and final nodes at and below a node. |
| [`isStateNode`](#isstatenode) | function | Whether a value is a state node. |
| [`isAtomic`, `isCompound`, `isParallel`, `isFinal`, `isHistory`, `isLeaf`](#type-predicates) | functions | Whether a node is of a type. |
| [`isAncestor`, `isDescendant`](#isancestor-and-isdescendant) | functions | Whether one node is above the other. |
| [`withTransitions`, `withEntry`, `withExit`, `withInvoke`, `withTags`, `withParent`](#combinators) | functions | A copy of a node with one field replaced. |
| [`StateNodeTypeId`](#statenodetypeid) | unique symbol | The brand of every state node. |
| [Node types](#node-types) | types | `AnyStateNode`, `HistoryStateNode`, the `StateNode` namespace types and the transition types. |
| [Definitions](#definitions) | types | The plain form that `node.definition` and `machine.definition` give. |

## Where nodes come from

| Source | Gives |
|---|---|
| `machine.root` | The root node. Its `id` is the machine id: the config `id`, or `(machine)` when the config has none. |
| `machine.states` | The child nodes of the root, by key. |
| `machine.idMap` | Every node of the machine, by id, as a `HashMap`. |
| `machine.getStateNodeById(id)` | An Effect of the node that an id names. See [createMachine and the machine](./create-machine.md#machinegetstatenodebyid). |
| `getStateNodes(node, stateValue)` | An Effect of the nodes that a state value names. See [State values](./state-value.md). |
| `snapshot._nodes` | The active nodes of a machine snapshot. See [Snapshots](./snapshots.md). |
| `node.parent`, `node.states`, `node.initial.target`, `transition.target` | The linked nodes. |

`createMachine` builds the nodes in document order, links each node to its parent and to its
machine, and never changes a node after it builds the tree. The functions on this page never
change a node either.

## The StateNode class

`StateNode<TContext, TEvent extends EventObject, TStateMeta = unknown, TTransitionMeta = TStateMeta>`
is invariant in `TContext` and `TEvent`, and covariant in the two meta types. To accept a node of
any types, use [`AnyStateNode`](#node-types).

The class extends Effect's `Pipeable.Class`, and implements `Equal` and `Inspectable`. The
instance type is also exported as `StateNodeInterface` and as `StateNode.StateNode`.

### Properties

| Property | Type | Description |
|---|---|---|
| `type` | `StateNodeType` | `"atomic"`, `"compound"`, `"parallel"`, `"final"` or `"history"`. The config's `type`; else `"compound"` for a config with child states, `"history"` for a config with `history`, and `"atomic"` otherwise. |
| `key` | `string` | The key of the node in its parent. The machine id for the root. |
| `id` | `string` | The config's `id`; else `<machine id>.<path joined with ".">`, for example `"door.closed"`. |
| `path` | `ReadonlyArray<string>` | The keys from the root to the node. `[]` for the root. |
| `description` | `string \| undefined` | The config's `description`. |
| `order` | `number` | The position of the node in a pre-order walk of the machine. `0` for the root. |
| `states` | `Readonly<Record<string, StateNode<…>>>` | The child nodes, by key, in config order. |
| `transitions` | `ReadonlyArray<readonly [descriptor, ReadonlyArray<TransitionDefinition>]>` | The transitions by event descriptor, in this order: the `on` descriptors, then `onDone` (`xstate.done.state.<id>`), then the delayed transitions (`xstate.after.<delay>.<id>`). A forbidden event (`on: { E: undefined }`) keeps its descriptor, with one transition that has no target and no actions. |
| `always` | `ReadonlyArray<TransitionDefinition<…>>` | The eventless transitions, in config order. |
| `after` | `ReadonlyArray<DelayedTransitionDefinition<…>>` | The delayed transitions, in the key order of the config's `after`. Each is the same object as the transition on its `xstate.after.<delay>.<id>` descriptor. |
| `entry` | `ReadonlyArray<Action<TContext, TEvent>>` | The entry actions in config order, then one `raise` for each delayed transition. |
| `exit` | `ReadonlyArray<Action<TContext, TEvent>>` | The exit actions in config order, then one `cancel` for each delayed transition. |
| `invoke` | `ReadonlyArray<InvokeDefinition<…>>` | The invocations, in config order. |
| `meta` | `TStateMeta \| undefined` | The config's `meta`. |
| `tags` | `ReadonlyArray<string>` | The config's tags, in config order. |
| `output` | `Option<OutputDefinition<TContext, TEvent>>` | The config's `output`, kept on a final node and on the root only. `null` is an output; `undefined` is none. |
| `history` | `false \| HistoryType` | The config's `history`: `"shallow"` (also for `true`) or `"deep"`; else `false`. A `type: "history"` node without `history` holds `false` and restores as shallow. |
| `target` | `Option<string>` | The config's `target`: the default target of a history node. |
| `parent` | `Option<StateNode<…>>` | The parent node. None for the root and for a node built outside a machine. |
| `machine` | `Option<StateNode.Machine<TContext, TEvent>>` | The machine of the node. None for a node built outside a machine. At run time it holds the whole machine object. |
| `config` | `StateNodeConfig<…>` | The config object that the node was built from, not a copy. `{}` for a node built outside a machine. |
| `initial` | `InitialTransitionDefinition<…>` | A getter. The initial transition: see [Initial transitions](#initial-transitions). |
| `on` | `Readonly<Record<string, ReadonlyArray<TransitionDefinition<…>>>>` | A getter. `transitions` as an object, in the same order, without descriptors that have no transition. |
| `ownEvents` | `ReadonlyArray<string>` | A getter. The descriptors of `on` that have a transition that does something: a target, an action or a re-entry. A forbidden event is not one. |
| `events` | `ReadonlyArray<string>` | A getter. `ownEvents`, then the `events` of each child in document order, each descriptor once. |
| `definition` | `StateNode.Definition<…>` | A getter, built on each read. The plain form of the node: see [Definitions](#definitions). |

### Methods

| Method | Returns | Description |
|---|---|---|
| `toJSON()` | `StateNode.Definition<…>` | The `definition`. It names other nodes as `#<id>` strings and holds no `parent` or `machine`, so `JSON.stringify` does not walk up the tree. |
| `toString()` | `string` | `StateNode(<id>)`. |
| `pipe(...)` | — | Effect's `pipe`, with the node as its first argument. |
| `Equal.equals(a, b)` | `boolean` | Identity: two nodes with equal fields are not equal. |
| `Hash.hash(node)` | `number` | A random hash, fixed for each node, so that a node can key a `HashMap` or a `HashSet`. |

Node's `util.inspect`, and so `console.log`, prints the `definition`.

### Static members

Each function of this page is also a static member of the class: `StateNode.StateNodeTypeId`,
`StateNode.isStateNode`, `StateNode.make` (the root export `makeStateNode`), `StateNode.atomic`,
`StateNode.compound`, `StateNode.parallel`, `StateNode.final`, `StateNode.historyState`,
`StateNode.getChild`, `StateNode.getChildren`, `StateNode.getTransitions`,
`StateNode.getInitialTarget`, `StateNode.getLeafStates`, `StateNode.isAtomic`,
`StateNode.isCompound`, `StateNode.isParallel`, `StateNode.isFinal`, `StateNode.isHistory`,
`StateNode.isLeaf`, `StateNode.isAncestor`, `StateNode.isDescendant`,
`StateNode.withTransitions`, `StateNode.withEntry`, `StateNode.withExit`,
`StateNode.withInvoke`, `StateNode.withTags` and `StateNode.withParent`.

### Example

```ts
import { Effect } from "effect"
import { createMachine, StateNode } from "@jambudipa/xstate-effect"

const machine = createMachine({
  id: "door",
  initial: "closed",
  states: {
    closed: { on: { OPEN: "open" }, tags: ["shut"] },
    open: { id: "opened", on: { CLOSE: "closed" } }
  }
})

export const isNode = machine.root instanceof StateNode // true
export const rootEvents = machine.root.events // ["OPEN", "CLOSE"]

const program = Effect.gen(function* () {
  const open = yield* machine.getStateNodeById("#opened")
  console.log(open.id, open.key, open.path, open.ownEvents) // opened open ["open"] ["CLOSE"]
  console.log(String(open)) // StateNode(opened)
})

void Effect.runPromise(program)
```

## Builders

`makeStateNode` builds a node from all of its fields; `createMachine` builds each node of a
machine with it. The type builders make a node outside a machine, and no machine reads a node
that they build.

### makeStateNode

Builds a node from all of its fields, unchecked. It is the `StateNode` constructor as a function.

```ts
import type { EventObject, StateNode } from "@jambudipa/xstate-effect"

export declare function makeStateNode<TContext, TEvent extends EventObject, TStateMeta = unknown, TTransitionMeta = TStateMeta>(
  options: StateNode.Options<TContext, TEvent, TStateMeta, TTransitionMeta>
): StateNode<TContext, TEvent, TStateMeta, TTransitionMeta>
```

| Parameter | Type | Description |
|---|---|---|
| `options` | `StateNode.Options<…>` | Every field of the [properties table](#properties) that is not a getter, and `_initial`: `Option<InitialTransition>`, the initial child key as the config writes it. |

Returns a new `StateNode` that holds the options as its own fields.

### atomic, compound, parallel, final and historyState

```ts
import type { Option } from "effect"
import type { EventObject, HistoryType, InitialTransition, OutputDefinition, StateNode } from "@jambudipa/xstate-effect"

export declare function atomic<TContext, TEvent extends EventObject>(
  key: string,
  parentId: string,
  order: number
): StateNode<TContext, TEvent>

export declare function compound<TContext, TEvent extends EventObject>(
  key: string,
  parentId: string,
  order: number,
  states: Readonly<Record<string, StateNode<TContext, TEvent>>>,
  initial: InitialTransition<TContext, TEvent>
): StateNode<TContext, TEvent>

export declare function parallel<TContext, TEvent extends EventObject>(
  key: string,
  parentId: string,
  order: number,
  states: Readonly<Record<string, StateNode<TContext, TEvent>>>
): StateNode<TContext, TEvent>

export declare function final<TContext, TEvent extends EventObject>(
  key: string,
  parentId: string,
  order: number,
  output: Option.Option<OutputDefinition<TContext, TEvent>>
): StateNode<TContext, TEvent>

export declare function historyState<TContext, TEvent extends EventObject>(
  key: string,
  parentId: string,
  order: number,
  historyType: HistoryType,
  target: Option.Option<string>
): StateNode<TContext, TEvent>
```

| Parameter | Type | Description |
|---|---|---|
| `key` | `string` | The node's `key`. |
| `parentId` | `string` | The id that the node's `id` starts with: the `id` is `<parentId>.<key>`, or `<key>` when `parentId` is `""`. |
| `order` | `number` | The node's `order`. |
| `states` | `Readonly<Record<string, StateNode>>` | `compound` and `parallel`: the child nodes. |
| `initial` | `InitialTransition<TContext, TEvent>` | `compound`: the initial transition, with the initial child's key as the only `target`. |
| `output` | `Option<OutputDefinition<TContext, TEvent>>` | `final`: the output. |
| `historyType` | `HistoryType` | `historyState`: `"shallow"` or `"deep"`. |
| `target` | `Option<string>` | `historyState`: the default target. |

Each builder returns a node of its type with these fields: `path` is `[key]`, `parent` and
`machine` are none, `config` is `{}`, and the node has no transitions, actions, invocations or
tags. A `compound` or `parallel` node does not become the `parent` of its children. Because
`path` is `[key]`, `isAncestor` relates no two nodes built this way.

```ts
import { Chunk, Option } from "effect"
import { atomic, compound, final, getInitialTarget, isAncestor, isLeaf } from "@jambudipa/xstate-effect"

type Context = { readonly count: number }
type Event = { readonly type: "NEXT" }

const idle = atomic<Context, Event>("idle", "flow", 1)
const done = final<Context, Event>("done", "flow", 2, Option.some(42))
const flow = compound<Context, Event>("flow", "", 0, { idle, done }, { target: ["idle"], actions: Chunk.empty() })

export const ids = [flow.id, idle.id, done.id] // ["flow", "flow.idle", "flow.done"]
export const initialKeys = getInitialTarget(flow) // Option.some(["idle"])
export const doneIsLeaf = isLeaf(done) // true
export const related = isAncestor(flow, idle) // false: both paths have one key
```

## Accessors

### getChild

```ts
import type { Option } from "effect"
import type { EventObject, StateNode } from "@jambudipa/xstate-effect"

export declare function getChild<TContext, TEvent extends EventObject>(
  node: StateNode<TContext, TEvent>,
  key: string
): Option.Option<StateNode<TContext, TEvent>>
```

Returns the child node of `key`, or none when `node` has no child of that key. Only the node's
own keys count: a key of `Object.prototype`, such as `"toString"`, gives none.

### getChildren

```ts
import type { Chunk } from "effect"
import type { EventObject, StateNode } from "@jambudipa/xstate-effect"

export declare function getChildren<TContext, TEvent extends EventObject>(
  node: StateNode<TContext, TEvent>
): Chunk.Chunk<StateNode<TContext, TEvent>>
```

Returns the child nodes in document order. Empty for a node without children.

### getTransitions

```ts
import type { Chunk } from "effect"
import type { EventObject, StateNode, TransitionDefinition } from "@jambudipa/xstate-effect"

export declare function getTransitions<TContext, TEvent extends EventObject>(
  node: StateNode<TContext, TEvent>,
  eventType: string
): Chunk.Chunk<TransitionDefinition<TContext, TEvent>>
```

Returns the node's own transitions listed under the descriptor `eventType`, in config order. The
match is exact: a wildcard descriptor (`*`, `a.*`) that would select the event is not read, and
the transitions of ancestors are not included. Empty when the node has no such descriptor.

### getInitialTarget

```ts
import type { Option } from "effect"
import type { EventObject, StateNode } from "@jambudipa/xstate-effect"

export declare function getInitialTarget<TContext, TEvent extends EventObject>(
  node: StateNode<TContext, TEvent>
): Option.Option<ReadonlyArray<string>>
```

Returns the target of the node's `initial` as the config writes it: the initial child's key, as
the only element. None for a node without `initial`, a parallel node included. The key is not
checked: for the target nodes, read `node.initial.target`.

### getLeafStates

```ts
import type { Chunk } from "effect"
import type { EventObject, StateNode } from "@jambudipa/xstate-effect"

export declare function getLeafStates<TContext, TEvent extends EventObject>(
  node: StateNode<TContext, TEvent>
): Chunk.Chunk<StateNode<TContext, TEvent>>
```

Returns the atomic and final nodes at and below `node`, in document order. An atomic or final
`node` gives itself. History nodes are not leaves, so the result never holds one.

### Example

```ts
import { Chunk, Option } from "effect"
import { createMachine, getChild, getChildren, getInitialTarget, getLeafStates, getTransitions } from "@jambudipa/xstate-effect"

const machine = createMachine({
  initial: "closed",
  states: {
    closed: { on: { OPEN: "open" } },
    open: { initial: "wide", states: { wide: {}, ajar: {} } }
  }
})

export const keys = Chunk.toReadonlyArray(getChildren(machine.root)).map((node) => node.key)
// ["closed", "open"]

export const leaves = Chunk.toReadonlyArray(getLeafStates(machine.root)).map((node) => node.id)
// ["(machine).closed", "(machine).open.wide", "(machine).open.ajar"]

export const initialKeys = getInitialTarget(machine.root) // Option.some(["closed"])

export const openCount = Option.map(getChild(machine.root, "closed"), (closed) => Chunk.size(getTransitions(closed, "OPEN")))
// Option.some(1)
```

## Predicates

### isStateNode

```ts
import type { EventObject, StateNode } from "@jambudipa/xstate-effect"

export declare function isStateNode(u: unknown): u is StateNode<unknown, EventObject>
```

Returns `true` when `u` carries the [`StateNodeTypeId`](#statenodetypeid) brand: every
`StateNode`, a copy from a `with*` function included. A plain object with the same fields gives
`false`.

### Type predicates

```ts
import type { EventObject, StateNode } from "@jambudipa/xstate-effect"

export declare function isAtomic<TContext, TEvent extends EventObject>(node: StateNode<TContext, TEvent>): boolean
export declare function isCompound<TContext, TEvent extends EventObject>(node: StateNode<TContext, TEvent>): boolean
export declare function isParallel<TContext, TEvent extends EventObject>(node: StateNode<TContext, TEvent>): boolean
export declare function isFinal<TContext, TEvent extends EventObject>(node: StateNode<TContext, TEvent>): boolean
export declare function isHistory<TContext, TEvent extends EventObject>(node: StateNode<TContext, TEvent>): boolean
export declare function isLeaf<TContext, TEvent extends EventObject>(node: StateNode<TContext, TEvent>): boolean
```

| Function | `true` when `node.type` is |
|---|---|
| `isAtomic` | `"atomic"` |
| `isCompound` | `"compound"` |
| `isParallel` | `"parallel"` |
| `isFinal` | `"final"` |
| `isHistory` | `"history"` |
| `isLeaf` | `"atomic"` or `"final"` |

### isAncestor and isDescendant

```ts
import type { EventObject, StateNode } from "@jambudipa/xstate-effect"

export declare function isAncestor<TContext, TEvent extends EventObject>(
  ancestor: StateNode<TContext, TEvent>,
  descendant: StateNode<TContext, TEvent>
): boolean

export declare function isDescendant<TContext, TEvent extends EventObject>(
  descendant: StateNode<TContext, TEvent>,
  ancestor: StateNode<TContext, TEvent>
): boolean
```

`isAncestor` returns `true` when the `path` of `ancestor` is a proper prefix of the `path` of
`descendant`. A node is not its own ancestor. `isDescendant(descendant, ancestor)` is
`isAncestor(ancestor, descendant)`. The functions compare paths only, so they relate nodes of the
same machine.

### Example

```ts
import { Option } from "effect"
import { createMachine, getChild, isAncestor, isCompound, isDescendant, isFinal, isStateNode } from "@jambudipa/xstate-effect"

const machine = createMachine({
  initial: "a",
  states: { a: { initial: "a1", states: { a1: {} } }, z: { type: "final" } }
})

export const aChecks = Option.map(getChild(machine.root, "a"), (a) => [
  isCompound(a),
  isAncestor(machine.root, a),
  isDescendant(a, machine.root)
]) // Option.some([true, true, true])

export const zIsFinal = Option.map(getChild(machine.root, "z"), (z) => isFinal(z)) // Option.some(true)
export const branded = [isStateNode(machine.root), isStateNode({})] // [true, false]
```

## Combinators

Each combinator returns a new node: a copy of `node` with one field replaced. The machine does
not link the copy. The parent's `states`, the children's `parent` and the machine's `idMap` still
hold the original node, and the original node is unchanged.

```ts
import type { Action, EventObject, InvokeDefinition, StateNode, TransitionDefinition } from "@jambudipa/xstate-effect"

type TransitionEntries<TContext, TEvent extends EventObject> = ReadonlyArray<
  readonly [descriptor: string, transitions: ReadonlyArray<TransitionDefinition<TContext, TEvent>>]
>

export declare function withTransitions<TContext, TEvent extends EventObject>(
  node: StateNode<TContext, TEvent>,
  transitions: TransitionEntries<TContext, TEvent>
): StateNode<TContext, TEvent>

export declare function withEntry<TContext, TEvent extends EventObject>(
  node: StateNode<TContext, TEvent>,
  entry: ReadonlyArray<Action<TContext, TEvent>>
): StateNode<TContext, TEvent>

export declare function withExit<TContext, TEvent extends EventObject>(
  node: StateNode<TContext, TEvent>,
  exit: ReadonlyArray<Action<TContext, TEvent>>
): StateNode<TContext, TEvent>

export declare function withInvoke<TContext, TEvent extends EventObject>(
  node: StateNode<TContext, TEvent>,
  invoke: ReadonlyArray<InvokeDefinition<TContext, TEvent>>
): StateNode<TContext, TEvent>

export declare function withTags<TContext, TEvent extends EventObject>(
  node: StateNode<TContext, TEvent>,
  tags: ReadonlyArray<string>
): StateNode<TContext, TEvent>

export declare function withParent<TContext, TEvent extends EventObject>(
  node: StateNode<TContext, TEvent>,
  parent: StateNode<TContext, TEvent>
): StateNode<TContext, TEvent>
```

| Function | Replaces | Notes |
|---|---|---|
| `withTransitions` | `transitions` | `on`, `ownEvents` and `events` follow the new entries. `always` and `after` keep their old lists. |
| `withEntry` | `entry` | The whole list, the `raise` of each delayed transition included. |
| `withExit` | `exit` | The whole list, the `cancel` of each delayed transition included. |
| `withInvoke` | `invoke` | `definition` still reads `config.invoke` for the JSON form of each invocation. |
| `withTags` | `tags` | — |
| `withParent` | `parent` | `id` and `path` do not change, and the copy is not added to the parent's `states`. |

```ts
import { Option } from "effect"
import { createMachine, getChild, withTags } from "@jambudipa/xstate-effect"

const machine = createMachine({ initial: "idle", states: { idle: { tags: ["ready"] } } })

export const tagged = Option.map(getChild(machine.root, "idle"), (idle) => withTags(idle, ["ready", "visible"]))
// Option.some of a node whose tags are ["ready", "visible"]; the machine's idle node keeps ["ready"]
```

## StateNodeTypeId

`StateNodeTypeId` is the unique symbol `Symbol.for("@jambudipa/xstate-effect/StateNode")`, and
`StateNodeTypeId` is also its type. Every state node carries it, from its prototype: a spread of a
node does not copy it. [`isStateNode`](#isstatenode) checks it.

```ts
import { createMachine, StateNodeTypeId } from "@jambudipa/xstate-effect"

const machine = createMachine({})

export const branded = StateNodeTypeId in machine.root // true
```

## Node types

| Type | Description |
|---|---|
| `StateNode<TContext, TEvent, TStateMeta, TTransitionMeta>` | The class instance type. Also `StateNodeInterface` and `StateNode.StateNode`. |
| `StateNode.Any` | `StateNode<unknown, EventObject, any, any>`. The type of the nodes in a snapshot's `_nodes`. |
| `AnyStateNode` | A structural supertype of every state node: the members whose types do not depend on the context or the events, and the `StateNodeTypeId` brand. `AnyStateMachine.root` and the parameter of `getStateNodes` have this type. |
| `AnyStateNodeDefinition` | The definition of any state node: `StateNode.Definition` with any context, events and metas. `AnyStateNode.definition` has this type. |
| `HistoryStateNode<TContext>` | A history node: a `StateNode` whose `history` is typed `HistoryType`. At run time, a `type: "history"` node without `history` in its config holds `false`. |
| `StateNode.ContextOf<T>` | The context type of the node type `T`. |
| `StateNode.EventOf<T>` | The event type of the node type `T`. |
| `StateNode.Options<TContext, TEvent, TStateMeta, TTransitionMeta>` | The fields that [`makeStateNode`](#makestatenode) takes. |
| `StateNode.Machine<TContext, TEvent>` | What a node's `machine` exposes: `id`, `version`, `root`, `idMap`, `implementations` and `options`. |
| `StateNodeType` | `"atomic" \| "compound" \| "parallel" \| "final" \| "history"`. |
| `HistoryType` | `"shallow" \| "deep"`. |
| `TransitionDefinition<TContext, TEvent, TMeta>` | A resolved transition. See [Transition definitions](#transition-definitions). |
| `DelayedTransitionDefinition<TContext, TEvent, TMeta>` | A `TransitionDefinition` with `delay`: milliseconds for a key that reads as a number, else the delay's name. |
| `Transitions<TContext, TEvent>` | `Array<TransitionDefinition<TContext, TEvent, any>>`. |
| `InvokeDefinition<TContext, TEvent, TMeta>` | A resolved invocation: `src` (a name or the logic), `id` (the config's, or `<index>.<node id>`), `systemId` and `input` (`Option`s), and the `onDone`, `onError` and `onSnapshot` configs as written. |
| `InitialTransition<TContext, TEvent, TMeta>` | The `initial` of a config as the node stores it: `target` (the initial child's key, as the only element), `actions` (a `Chunk`), `meta` and `description`. |
| `InitialTransitionDefinition<TContext, TEvent, TTransitionMeta>` | The type of `node.initial`. Also `StateNode.InitialTransitionDefinition`. See [Initial transitions](#initial-transitions). |

```ts
import { createMachine, type AnyStateNode } from "@jambudipa/xstate-effect"

const ids = (node: AnyStateNode): ReadonlyArray<string> => [node.id, ...Object.values(node.states).flatMap(ids)]

const machine = createMachine({ initial: "a", states: { a: { initial: "a1", states: { a1: {} } }, b: {} } })

export const all = ids(machine.root) // ["(machine)", "(machine).a", "(machine).a.a1", "(machine).b"]
```

### Transition definitions

| Field | Type | Description |
|---|---|---|
| `target` | `ReadonlyArray<StateNode> \| undefined` | The target nodes. `undefined` for a targetless or forbidden transition. |
| `guard` | `Option<Guard>` | The guard as written. None for a transition without one. |
| `actions` | `Chunk<Action>` | The actions as written, in the order they run. |
| `description` | `string`, optional | The config's `description`. The key is there only when the config has it. |
| `reenter` | `boolean` | The config's `reenter`. `false` when the config gives none. |
| `eventType` | `string` | The descriptor that the transition is listed under: an `on` key, `xstate.done.state.<id>`, `xstate.done.actor.<id>`, `xstate.error.actor.<id>`, `xstate.snapshot.<id>`, `xstate.after.<delay>.<id>`, `xstate.route`, or `""` for an eventless transition. |
| `source` | `string` | The id of the node that the transition belongs to. |
| `meta` | `TMeta`, optional | The config's `meta`. The key is there only when the config has it. |
| `toJSON` | `() => unknown` | The JSON form: the source and the targets as `#<id>` strings. |

### Initial transitions

`node.initial` is built on each read, on every node.

| Field | Type | Description |
|---|---|---|
| `target` | `ReadonlyArray<StateNode>` | The child node that the `initial` key names. Empty when the node has no `initial`, or when the key names no child. |
| `source` | `StateNode` | The node itself. |
| `actions` | `ReadonlyArray<Action>` | The actions of `initial: { target, actions }`, in config order. Empty otherwise. |
| `eventType` | `null` | Always `null`. |
| `reenter` | `false` | Always `false`. |
| `meta` | `TTransitionMeta \| undefined` | The `meta` of the object form of `initial`. |
| `description` | `string \| undefined` | The `description` of the object form of `initial`. |
| `toJSON` | `() => unknown` | These fields, with the source and each target as a `#<id>` string. |

## Definitions

`node.definition`, `node.toJSON()`, `machine.definition` and `machine.toJSON()` give a
`StateNode.Definition`: the plain form of a node, built on each read. The machine's forms are the
root's.

| Field | Type | Description |
|---|---|---|
| `id` | `string` | The node's `id`. |
| `key` | `string` | The node's `key`. |
| `version` | `string \| undefined` | The machine's `version`. `undefined` when the machine has none, or the node has no machine. |
| `type` | `StateNodeType` | The node's `type`. |
| `initial` | `StateNode.InitialDefinition<…>` | `node.initial` with each action as a `StateNode.SerializableAction`. Its JSON form leaves out `reenter`. |
| `history` | `false \| HistoryType` | The node's `history`. |
| `states` | `Readonly<Record<string, StateNode.Definition<…>>>` | The definitions of the children, by key, in document order. |
| `on` | `Readonly<Record<string, ReadonlyArray<TransitionDefinition>>>` | The node's `on`, as it is. Its actions are not made serialisable. |
| `transitions` | `ReadonlyArray<StateNode.DefinitionTransition<…>>` | Every transition of every descriptor, in declaration order, with serialisable actions. |
| `entry` | `ReadonlyArray<StateNode.SerializableAction>` | The entry actions, the `raise` of each delayed transition included. |
| `exit` | `ReadonlyArray<StateNode.SerializableAction>` | The exit actions, the `cancel` of each delayed transition included. |
| `meta` | `TStateMeta \| undefined` | The config's `meta`. |
| `order` | `number` | The node's `order`, except that the root has `-1`. |
| `output` | `unknown` | The config's `output` on a final node and on the root. `undefined` elsewhere, and when there is none. |
| `invoke` | `ReadonlyArray<StateNode.DefinitionInvoke<…>>` | The invocations. The JSON form of each is the config without `onDone` and `onError`, with `type: "xstate.invoke"`, the source name (`xstate.invoke.<index>.<node id>` for inline logic) and the `id`. |
| `description` | `string \| undefined` | The config's `description`. |
| `tags` | `ReadonlyArray<string>` | The node's tags. |

A `StateNode.SerializableAction` is `{ type: string }`. An action name becomes `{ type: name }`, a
function becomes `{ type: <the function's name> }`, and an action object stays as it is.

```ts
import { createMachine } from "@jambudipa/xstate-effect"

const machine = createMachine({
  id: "light",
  initial: "green",
  states: { green: { on: { TIMER: "yellow" } }, yellow: {} }
})

export const rootOrder = machine.definition.order // -1
export const childKeys = Object.keys(machine.definition.states) // ["green", "yellow"]
export const json = JSON.stringify(machine.root.definition.initial) // {"target":["#light.green"],"source":"#light","actions":[],"eventType":null}
```

## Related pages

- [createMachine and the machine](./create-machine.md): `machine.root`, `machine.idMap` and
  `machine.getStateNodeById`
- [State values](./state-value.md): `getStateNodes` and `mapState`
- [Snapshots](./snapshots.md): the active nodes of a snapshot
- [How to model parallel and history states](../how-to/model-parallel-and-history-states.md)
- [About state machines and statecharts](../explanation/state-machines.md)
