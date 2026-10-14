---
title: Graph and model-based testing
doc-type: reference
sources: [packages/core/src/graph/]
---

# Graph and model-based testing

> **TL;DR:** `@jambudipa/xstate-effect/graph` walks the transitions of a machine or any other
> actor logic. `getAdjacencyMap`, `getShortestPaths`, `getSimplePaths` and `getPathsFromEvents`
> run the logic's transitions, so they return Effects. `toDirectedGraph`, `getStateNodes`,
> `serializeSnapshot` and `adjacencyMapToArray` only read a machine or a map, so they are
> synchronous. `createTestModel` and `TestModel` turn the paths into tests of a system.

All names on this page come from `@jambudipa/xstate-effect/graph`. The root entry point does not
export them.

## Summary

### Traversals

| Name | Returns | Fails with | Summary |
| --- | --- | --- | --- |
| [`getAdjacencyMap`](#getadjacencymap) | `Effect<AdjacencyMap>` | `TraversalError` | Every state that the traversal reaches, with the state that each event leads to. |
| [`getShortestPaths`](#getshortestpaths) | `Effect<Array<StatePath>>` | `TraversalError` | The shortest path to each reached state. |
| [`getSimplePaths`](#getsimplepaths) | `Effect<Array<StatePath>>` | `TraversalError` | Every path that visits no state twice, to each reached state. |
| [`getPathsFromEvents`](#getpathsfromevents) | `Effect<Array<StatePath>>` | `TraversalError`, `InvalidEventSequenceError` | The path that a fixed event sequence takes. |
| [`joinPaths`](#joinpaths) | `Effect<StatePath>` | `JoinPathsError` | One path followed by a second path that starts where the first ends. |

### Machine structure

| Name | Returns | Summary |
| --- | --- | --- |
| [`toDirectedGraph`](#todirectedgraph) | `DirectedGraphNode` | The state nodes of a machine as a graph of nodes and edges. |
| [`getStateNodes`](#getstatenodes) | `Array<AnyStateNode>` | Every state node below a machine or a node, in document order. |
| [`serializeSnapshot`](#serializesnapshot) | `SerializedSnapshot` | The default key of a machine snapshot: its value and context as JSON. |
| [`adjacencyMapToArray`](#adjacencymaptoarray) | `Array<{ state, event, nextState }>` | The transitions of an adjacency map as a list. |

### Test models

| Name | Returns | Summary |
| --- | --- | --- |
| [`createTestModel`](#createtestmodel) | `Effect<TestModel, UnsupportedTestMachineError>` | A test model of a machine. |
| [`TestModel`](#testmodel) | class | A test model of any actor logic. |
| [`createShortestPathsGen`](#createshortestpathsgen-and-createsimplepathsgen) | `PathGenerator` | A path generator of the shortest paths. |
| [`createSimplePathsGen`](#createshortestpathsgen-and-createsimplepathsgen) | `PathGenerator` | A path generator of the simple paths. |

### Errors

| Name | `message` | Raised by |
| --- | --- | --- |
| [`TraversalLimitError`](#errors) | `Traversal limit exceeded` | Every traversal, past its `limit`. |
| [`JoinPathsError`](#errors) | `Paths cannot be joined` | `joinPaths`. |
| [`InvalidEventSequenceError`](#errors) | `Invalid transition from <state> with <event>` | `getPathsFromEvents`. |
| [`UnsupportedTestMachineError`](#errors) | see [Errors](#errors) | `createTestModel`. |

### Types

| Name | Summary |
| --- | --- |
| [`TraversalOptions`](#traversaloptions) | The options of a traversal. |
| [`TraversalConfig`](#traversalconfig) | The resolved options of a traversal. |
| [`SerializationConfig`](#serializationconfig) | `serializeState` and `serializeEvent`. |
| [`TraversalError`](#traversalerror) | `TraversalLimitError \| InitializationError \| TransitionError \| GuardError`. |
| [`StatePath`](#statepath-step-and-steps), [`Step`](#statepath-step-and-steps), [`Steps`](#statepath-step-and-steps) | A path, one step of it, and its steps. |
| [`AdjacencyMap`](#adjacencymap-and-adjacencyvalue), [`AdjacencyValue`](#adjacencymap-and-adjacencyvalue) | The adjacency map and one state of it. |
| [`SerializedSnapshot`](#serializedsnapshot-and-serializedevent), [`SerializedEvent`](#serializedsnapshot-and-serializedevent) | The string keys of states and events. |
| [`DirectedGraphNode`](#directedgraphnode-and-directedgraphedge), [`DirectedGraphEdge`](#directedgraphnode-and-directedgraphedge) | The nodes and edges of `toDirectedGraph`. |
| [`TestModelOptions`](#testmodeloptions) | The options of a test model. |
| [`TestPath`](#testpath) | A path of a test model, with its description and its test. |
| [`TestParam`](#testparam-and-eventexecutor), [`EventExecutor`](#testparam-and-eventexecutor) | The state tests and event executors of a path test. |
| [`TestPathResult`](#testpathresult-and-teststepresult), [`TestStepResult`](#testpathresult-and-teststepresult) | The result of a path test and of one step. |
| [`TestMeta`](#testmeta) | The shape of a state node's `meta` for a test model. |
| [`PathGenerator`](#pathgenerator) | A function that gives the paths of a logic. |
| [`StatePlanMap`](#other-types), [`VisitedContext`](#other-types), [`AnyStateNode`](#other-types) | Types kept for parity with XState. |

## Traversal options

Every traversal takes a [`TraversalOptions`](#traversaloptions) object. These are the values
that a traversal uses for a field that the options leave out:

| Field | Machine | Other actor logic |
| --- | --- | --- |
| `fromState` | the initial snapshot for `input` | the initial snapshot for `input` |
| `events` | for each state, one event per event type that its active state nodes take: `{ type }` | none: an empty list |
| `serializeState` | [`serializeSnapshot`](#serializesnapshot): the value, and the context when it has keys, as JSON | the snapshot as JSON |
| `serializeEvent` | the event as JSON | the event as JSON |
| `filterEvents` | none: every event is sent | none |
| `limit` | `Infinity` | `Infinity` |
| `stopWhen` | the `toState` predicate | the `toState` predicate |
| `toState` | none: every reached state | none |

- An `events` option replaces the machine's default events: the traversal sends only the given
  events, in every state. [`createTestModel`](#createtestmodel) merges them instead.
- Each traversal runs the logic with an inert actor scope: no action runs, and a child is
  created but never starts. See [Pure transition functions](./testing/get-next-snapshot.md).
- A path is a [`StatePath`](#statepath-step-and-steps). Its first step is the start state with
  the event `{ type: "xstate.init" }`. Each later step is the state that an event reached, with
  that event. Its `weight` is the number of events.

## getAdjacencyMap

```ts
import type { Effect, Scope } from "effect"
import type { ActorLogic, ActorScope, EventObject, Snapshot } from "@jambudipa/xstate-effect"
import type { AdjacencyMap, TraversalError, TraversalOptions } from "@jambudipa/xstate-effect/graph"

export declare function getAdjacencyMap<TSnapshot extends Snapshot, TEvent extends EventObject, TInput, R = never>(
  logic: ActorLogic<TSnapshot, TEvent, TInput, EventObject, R>,
  options: TraversalOptions<TSnapshot, TEvent, TInput>
): Effect.Effect<AdjacencyMap<TSnapshot, TEvent>, TraversalError, Exclude<Exclude<R, ActorScope>, Scope.Scope>>
```

### Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `logic` | `ActorLogic<TSnapshot, TEvent, TInput, EventObject, R>` | A machine or any other actor logic. |
| `options` | `TraversalOptions<TSnapshot, TEvent, TInput>` | Required; `{}` takes every default. |

### Returns

An Effect that succeeds with the [`AdjacencyMap`](#adjacencymap-and-adjacencyvalue): each
state that a breadth-first traversal reaches from `fromState`, keyed by `serializeState`, with
the state that each of its events leads to, keyed by `serializeEvent`.

**Fails with:** `TraversalLimitError` when the breadth-first walk takes more than `limit + 1`
entries from its queue (each transition adds an entry, also to a state that the walk reached
before); `InitializationError` when
the initial snapshot fails; `TransitionError` or `GuardError` when a transition fails;
`GuardError` when a `filterEvents` Effect fails.

**Requires:** the services `R` of the logic, without `ActorScope` and `Scope`.

### Behaviour

- Two states with the same key are one state: the traversal visits it once and keeps the state
  that it reached first.
- An event that `filterEvents` rejects is not sent.
- A state for which `stopWhen` holds is in the map with no transitions.
- Two events of one state with the same key are one transition: the later one replaces the
  earlier one.

### Example

```ts
import { Effect } from "effect"
import { createMachine } from "@jambudipa/xstate-effect"
import { adjacencyMapToArray, getAdjacencyMap } from "@jambudipa/xstate-effect/graph"

const light = createMachine({
  id: "light",
  initial: "green",
  states: {
    green: { on: { TIMER: "yellow" } },
    yellow: { on: { TIMER: "red" } },
    red: { on: { TIMER: "green" } }
  }
})

export const program = Effect.gen(function* () {
  const adjacency = yield* getAdjacencyMap(light, {})
  // ['{"value":"green"}', '{"value":"yellow"}', '{"value":"red"}']
  const keys = Object.keys(adjacency)
  const edges = adjacencyMapToArray(adjacency).map(
    ({ state, event, nextState }) => `${String(state.value)} -${event.type}-> ${String(nextState.value)}`
  )
  return { keys, edges }
})
```

## getShortestPaths

```ts
import type { Effect, Scope } from "effect"
import type { ActorLogic, ActorScope, EventObject, Snapshot } from "@jambudipa/xstate-effect"
import type { StatePath, TraversalError, TraversalOptions } from "@jambudipa/xstate-effect/graph"

export declare function getShortestPaths<TSnapshot extends Snapshot, TEvent extends EventObject, TInput, R = never>(
  logic: ActorLogic<TSnapshot, TEvent, TInput, EventObject, R>,
  options?: TraversalOptions<TSnapshot, TEvent, TInput>
): Effect.Effect<Array<StatePath<TSnapshot, TEvent>>, TraversalError, Exclude<Exclude<R, ActorScope>, Scope.Scope>>
```

### Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `logic` | `ActorLogic<TSnapshot, TEvent, TInput, EventObject, R>` | A machine or any other actor logic. |
| `options` | `TraversalOptions<TSnapshot, TEvent, TInput>` | Optional. |

### Returns

An Effect that succeeds with one path to each state that the traversal reaches, in the order in
which the states are first reached. Each transition has the weight 1, so each path has the
fewest events. With `toState`, only the paths to the states for which it holds; the traversal
does not continue past them.

**Fails with:** what [`getAdjacencyMap`](#getadjacencymap) fails with.

**Requires:** the services `R` of the logic, without `ActorScope` and `Scope`.

### Example

```ts
import { Effect } from "effect"
import { createMachine } from "@jambudipa/xstate-effect"
import { getShortestPaths } from "@jambudipa/xstate-effect/graph"

const light = createMachine({
  id: "light",
  initial: "green",
  states: {
    green: { on: { TIMER: "yellow", POWER_OUT: "red" } },
    yellow: { on: { TIMER: "red" } },
    red: { on: { TIMER: "green" } }
  }
})

export const program = Effect.gen(function* () {
  const paths = yield* getShortestPaths(light, { toState: (state) => state.matches("red") })
  // One path: ["xstate.init", "POWER_OUT"], weight 1
  return paths.map((path) => path.steps.map((step) => step.event.type))
})
```

## getSimplePaths

```ts
import type { Effect, Scope } from "effect"
import type { ActorLogic, ActorScope, EventObject, Snapshot } from "@jambudipa/xstate-effect"
import type { StatePath, TraversalError, TraversalOptions } from "@jambudipa/xstate-effect/graph"

export declare function getSimplePaths<TSnapshot extends Snapshot, TEvent extends EventObject, TInput, R = never>(
  logic: ActorLogic<TSnapshot, TEvent, TInput, EventObject, R>,
  options?: TraversalOptions<TSnapshot, TEvent, TInput>
): Effect.Effect<Array<StatePath<TSnapshot, TEvent>>, TraversalError, Exclude<Exclude<R, ActorScope>, Scope.Scope>>
```

### Parameters

The parameters of [`getShortestPaths`](#getshortestpaths).

### Returns

An Effect that succeeds with every simple path from `fromState` to each reached state: a path
that enters no state twice. The paths are grouped by end state, in the key order of the
adjacency map, and each group is in depth-first order. With `toState`, only the paths to the
states for which it holds.

**Fails with:** what [`getAdjacencyMap`](#getadjacencymap) fails with.

**Requires:** the services `R` of the logic, without `ActorScope` and `Scope`.

### Example

```ts
import { Effect } from "effect"
import { createMachine } from "@jambudipa/xstate-effect"
import { getSimplePaths } from "@jambudipa/xstate-effect/graph"

const light = createMachine({
  types: {} as { events: { type: "TIMER" } | { type: "POWER_OUT" } },
  id: "light",
  initial: "green",
  states: {
    green: { on: { TIMER: "yellow", POWER_OUT: "red" } },
    yellow: { on: { TIMER: "red" } },
    red: { on: { TIMER: "green" } }
  }
})

export const program = Effect.gen(function* () {
  // `snapshot.can` returns an Effect, which `filterEvents` accepts
  const paths = yield* getSimplePaths(light, { filterEvents: (state, event) => state.can(event) })
  // Two of the four paths end in "red": TIMER → TIMER, and POWER_OUT
  return paths.filter((path) => path.state.matches("red")).length
})
```

## getPathsFromEvents

```ts
import type { Effect, Scope } from "effect"
import type { ActorLogic, ActorScope, EventObject, Snapshot } from "@jambudipa/xstate-effect"
import type {
  InvalidEventSequenceError,
  StatePath,
  TraversalError,
  TraversalOptions
} from "@jambudipa/xstate-effect/graph"

export declare function getPathsFromEvents<TSnapshot extends Snapshot, TEvent extends EventObject, TInput, R = never>(
  logic: ActorLogic<TSnapshot, TEvent, TInput, EventObject, R>,
  events: ReadonlyArray<TEvent>,
  options?: TraversalOptions<TSnapshot, TEvent, TInput>
): Effect.Effect<
  Array<StatePath<TSnapshot, TEvent>>,
  TraversalError | InvalidEventSequenceError,
  Exclude<Exclude<R, ActorScope>, Scope.Scope>
>
```

### Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `logic` | `ActorLogic<TSnapshot, TEvent, TInput, EventObject, R>` | A machine or any other actor logic. |
| `events` | `ReadonlyArray<TEvent>` | The event sequence. It is also the traversal's `events`, unless `options.events` gives others. |
| `options` | `TraversalOptions<TSnapshot, TEvent, TInput>` | Optional. |

### Returns

An Effect that succeeds with one path: the steps that the events take from `fromState`. It
succeeds with no path when `toState` does not hold for the state where the events end.

**Fails with:** `InvalidEventSequenceError` when an event has no entry in the adjacency map
from the state that it meets: an event that `filterEvents` leaves out, an event that
`options.events` does not list, or any event from a state where `stopWhen` (by default
`toState`) holds. Otherwise the sequence is the traversal's `events`, so each of its events has
an entry from each state that the traversal goes on from. It also fails with what
[`getAdjacencyMap`](#getadjacencymap) fails with.

**Requires:** the services `R` of the logic, without `ActorScope` and `Scope`.

### Behaviour

- An event that the state does not take is still a transition: the path stays in that state,
  as in XState.
- For a machine, the default start state is the initial snapshot computed without input: the
  `input` option does not reach it. Give `fromState` to start from a snapshot with input.

### Example

```ts
import { Effect } from "effect"
import { createMachine } from "@jambudipa/xstate-effect"
import { getPathsFromEvents } from "@jambudipa/xstate-effect/graph"

const light = createMachine({
  types: {} as { events: { type: "TIMER" } },
  id: "light",
  initial: "green",
  states: {
    green: { on: { TIMER: "yellow" } },
    yellow: { on: { TIMER: "red" } },
    red: {}
  }
})

export const program = Effect.gen(function* () {
  const [path] = yield* getPathsFromEvents(light, [{ type: "TIMER" }, { type: "TIMER" }])
  return path?.state.value // "red"
})
```

## joinPaths

```ts
import type { Effect } from "effect"
import type { EventObject, Snapshot } from "@jambudipa/xstate-effect"
import type { JoinPathsError, StatePath } from "@jambudipa/xstate-effect/graph"

export declare function joinPaths<TSnapshot extends Snapshot, TEvent extends EventObject>(
  headPath: StatePath<TSnapshot, TEvent>,
  tailPath: StatePath<TSnapshot, TEvent>
): Effect.Effect<StatePath<TSnapshot, TEvent>, JoinPathsError>
```

### Returns

An Effect that succeeds with one path: the steps of `headPath`, then the steps of `tailPath`
without its first step. The `state` is the end state of `tailPath`, and the `weight` is the sum
of both weights.

**Fails with:** `JoinPathsError` when the state of the first step of `tailPath` is not the same
object as the end state of `headPath`.

## toDirectedGraph

```ts
import type { AnyStateMachine } from "@jambudipa/xstate-effect"
import type { AnyStateNode, DirectedGraphNode } from "@jambudipa/xstate-effect/graph"

export declare function toDirectedGraph(stateMachine: AnyStateNode | AnyStateMachine): DirectedGraphNode
```

### Returns

The [`DirectedGraphNode`](#directedgraphnode-and-directedgraphedge) of the machine's root node,
or of the given state node. Each node holds its child nodes and one edge per target of each of
its transitions. Synchronous; it never fails.

### Behaviour

- The edges come from the `on` transitions and the `after` transitions of the node, in
  declaration order. Eventless (`always`) transitions give no edge.
- A targetless transition gives an edge to the node itself.
- An edge's id is `<node id>:<transition index>:<target index>`, and its label text is the
  transition's event type, such as `TIMER` or `xstate.after.10.m.a`.
- `JSON.stringify` writes a node as `{ id, children, edges }` and an edge as
  `{ source, target, label }`, with node ids in place of nodes.

### Example

```ts
import { createMachine } from "@jambudipa/xstate-effect"
import { toDirectedGraph } from "@jambudipa/xstate-effect/graph"

const light = createMachine({
  id: "light",
  initial: "green",
  states: {
    green: { on: { TIMER: "yellow" } },
    yellow: {}
  }
})

// {"id":"light","children":[{"id":"light.green","children":[],"edges":[{"source":"light.green",
// "target":"light.yellow","label":{"text":"TIMER"}}]},{"id":"light.yellow","children":[],"edges":[]}],"edges":[]}
export const json = JSON.stringify(toDirectedGraph(light))
```

## getStateNodes

```ts
import type { AnyStateMachine } from "@jambudipa/xstate-effect"
import type { AnyStateNode } from "@jambudipa/xstate-effect/graph"

export declare function getStateNodes(stateNode: AnyStateNode | AnyStateMachine): Array<AnyStateNode>
```

### Returns

Every state node below the given machine or state node, in document order: each child, then the
nodes below it. The root node of a machine is not in the result. Synchronous; it never fails.

### Example

```ts
import { createMachine } from "@jambudipa/xstate-effect"
import { getStateNodes } from "@jambudipa/xstate-effect/graph"

const machine = createMachine({
  id: "m",
  initial: "a",
  states: { a: { initial: "a1", states: { a1: {} } }, b: {} }
})

export const ids = getStateNodes(machine).map((node) => node.id) // ["m.a", "m.a.a1", "m.b"]
```

## serializeSnapshot

```ts
import type { Snapshot } from "@jambudipa/xstate-effect"
import type { SerializedSnapshot } from "@jambudipa/xstate-effect/graph"

export declare function serializeSnapshot(snapshot: Snapshot): SerializedSnapshot
```

### Returns

The JSON text of an object with the snapshot's `value`, and its `context` when the context has at
least one key. For a machine snapshot in the state `green` with an empty context:
`{"value":"green"}`. Synchronous; it never fails.

## adjacencyMapToArray

```ts
import type { AdjacencyMap } from "@jambudipa/xstate-effect/graph"

export declare function adjacencyMapToArray<TSnapshot, TEvent>(
  adjMap: AdjacencyMap<TSnapshot, TEvent>
): Array<{ state: TSnapshot; event: TEvent; nextState: TSnapshot }>
```

### Returns

One entry per transition of the map: the state, the event, and the state that the event leads
to. The order is the key order of the map, then the key order of each state's transitions.
Synchronous; it never fails. See the example of [`getAdjacencyMap`](#getadjacencymap).

## createTestModel

```ts
import type { Effect } from "effect"
import type { AnyStateMachine, EventFromLogic, InputFrom, SnapshotFrom } from "@jambudipa/xstate-effect"
import type { TestModel, TestModelOptions, UnsupportedTestMachineError } from "@jambudipa/xstate-effect/graph"

export declare function createTestModel<TMachine extends AnyStateMachine>(
  machine: TMachine,
  options?: Partial<TestModelOptions<SnapshotFrom<TMachine>, EventFromLogic<TMachine>, InputFrom<TMachine>>>
): Effect.Effect<
  TestModel<SnapshotFrom<TMachine>, EventFromLogic<TMachine>, unknown>,
  UnsupportedTestMachineError
>
```

### Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `machine` | `TMachine extends AnyStateMachine` | The model of the system under test. |
| `options` | `Partial<TestModelOptions<…>>` | Optional. See [`TestModelOptions`](#testmodeloptions). |

### Returns

An Effect that succeeds with a [`TestModel`](#testmodel) of the machine.

**Fails with:** `UnsupportedTestMachineError` when a state node of the machine, checked in
document order from the root, has one of these:

| Found | `message` |
| --- | --- |
| an `invoke` | `Invocations on test machines are not supported` |
| an `after` transition | `After events on test machines are not supported` |
| a `raise` or `sendTo` with a numeric delay, written inline in `entry`, `exit` or an event transition | `Delayed actions on test machines are not supported` |

Eventless transitions and named actions are not checked.

### Behaviour

The model differs from a `TestModel` built directly in these options:

| Option | Value in the model |
| --- | --- |
| `serializeState` | `serializeSnapshot(state)` followed by `serializeTransition(state, event, prevState)`. |
| `serializeTransition` | By default ` via <event as JSON> from <previous value as JSON>`; an empty string at the start state and when the value does not change. Pass `() => ""` to key states by value and context only. |
| `events` | For each state, the events of each event type that its active state nodes take: the given events of that type when `options.events` lists any, else `{ type }`. |
| `stateMatcher` | A state test key matches when it is a state value that the state matches (`"form.invalid"`), or a state node id (`"#feedback.form"`) whose node is active. |

The other options are those of [`TestModelOptions`](#testmodeloptions) and its defaults.

### Example

```ts
import { Effect } from "effect"
import { createMachine } from "@jambudipa/xstate-effect"
import { createTestModel } from "@jambudipa/xstate-effect/graph"

const toggle = createMachine({
  types: {} as { events: { type: "TOGGLE" } },
  id: "toggle",
  initial: "off",
  states: {
    off: { on: { TOGGLE: "on" } },
    on: { on: { TOGGLE: "off" } }
  }
})

// The system under test
class Switch {
  isOn = false
  flip(): void {
    this.isOn = !this.isOn
  }
}

export const program = Effect.gen(function* () {
  const model = yield* createTestModel(toggle)
  const paths = yield* model.getShortestPaths()
  yield* Effect.forEach(
    paths,
    (path) => {
      const device = new Switch()
      return path.test({
        events: { TOGGLE: () => device.flip() },
        states: {
          off: () => (device.isOn ? Effect.fail(new Error("expected off")) : Effect.void),
          on: () => (device.isOn ? Effect.void : Effect.fail(new Error("expected on")))
        }
      })
    },
    { discard: true }
  )
})
```

## TestModel

```ts
import type { Effect } from "effect"
import type { ActorLogic, EventObject, Snapshot } from "@jambudipa/xstate-effect"
import type {
  AdjacencyMap,
  InvalidEventSequenceError,
  JoinPathsError,
  PathGenerator,
  StatePath,
  Step,
  TestModelOptions,
  TestParam,
  TestPath,
  TestPathResult,
  TraversalError,
  TraversalOptions
} from "@jambudipa/xstate-effect/graph"

// The options of one path query; the package does not export this name
type GetPathOptions<TSnapshot extends Snapshot, TEvent extends EventObject, TInput> = Partial<
  TraversalOptions<TSnapshot, TEvent, TInput>
> & { allowDuplicatePaths?: boolean }

export declare class TestModel<TSnapshot extends Snapshot, TEvent extends EventObject, TInput> {
  constructor(
    testLogic: ActorLogic<TSnapshot, TEvent, TInput>,
    options?: Partial<TestModelOptions<TSnapshot, TEvent, TInput>>
  )
  testLogic: ActorLogic<TSnapshot, TEvent, TInput>
  options: TestModelOptions<TSnapshot, TEvent, TInput>
  defaultTraversalOptions?: TraversalOptions<TSnapshot, TEvent, TInput>
  getDefaultOptions(): TestModelOptions<TSnapshot, TEvent, TInput>
  getPaths(
    pathGenerator: PathGenerator<TSnapshot, TEvent, TInput>,
    options?: GetPathOptions<TSnapshot, TEvent, TInput>
  ): Effect.Effect<Array<TestPath<TSnapshot, TEvent>>, TraversalError>
  getShortestPaths(
    options?: GetPathOptions<TSnapshot, TEvent, TInput>
  ): Effect.Effect<Array<TestPath<TSnapshot, TEvent>>, TraversalError>
  getShortestPathsFrom(
    paths: Array<TestPath<TSnapshot, TEvent>>,
    options?: GetPathOptions<TSnapshot, TEvent, TInput>
  ): Effect.Effect<Array<TestPath<TSnapshot, TEvent>>, TraversalError | JoinPathsError>
  getSimplePaths(
    options?: GetPathOptions<TSnapshot, TEvent, TInput>
  ): Effect.Effect<Array<TestPath<TSnapshot, TEvent>>, TraversalError>
  getSimplePathsFrom(
    paths: Array<TestPath<TSnapshot, TEvent>>,
    options?: GetPathOptions<TSnapshot, TEvent, TInput>
  ): Effect.Effect<Array<TestPath<TSnapshot, TEvent>>, TraversalError | JoinPathsError>
  getPathsFromEvents(
    events: Array<TEvent>,
    options?: GetPathOptions<TSnapshot, TEvent, TInput>
  ): Effect.Effect<Array<TestPath<TSnapshot, TEvent>>, TraversalError | InvalidEventSequenceError>
  getAdjacencyMap(): Effect.Effect<AdjacencyMap<TSnapshot, TEvent>, TraversalError>
  testPath(
    path: StatePath<TSnapshot, TEvent>,
    params: TestParam<TSnapshot, TEvent>,
    options?: Partial<TestModelOptions<TSnapshot, TEvent, TInput>>
  ): Effect.Effect<TestPathResult<TSnapshot, TEvent>, unknown>
  testState(
    params: TestParam<TSnapshot, TEvent>,
    state: TSnapshot,
    options?: Partial<TestModelOptions<TSnapshot, TEvent, TInput>>
  ): Effect.Effect<void, unknown>
  testTransition(params: TestParam<TSnapshot, TEvent>, step: Step<TSnapshot, TEvent>): Effect.Effect<void, unknown>
}
```

The constructor is synchronous and runs no user code. The logic runs only when a path query or
`getAdjacencyMap` runs.

### Members

| Member | Description |
| --- | --- |
| `testLogic` | The logic that the constructor received. |
| `options` | `getDefaultOptions()`, overridden by the constructor's options. |
| `defaultTraversalOptions` | Traversal options under `options`, for a caller to set. The package never sets it. |
| `getDefaultOptions()` | The defaults for a logic that is not a machine: states and events keyed by their JSON text, `serializeTransition` as `<state as JSON>\|<event type>`, no events, a `stateMatcher` that accepts only the `*` key, and a `logger` that discards every message. |
| `getPaths(pathGenerator, options?)` | The test paths that the generator gives. Without `allowDuplicatePaths: true`, the result is sorted longest first, and a path whose event sequence starts the sequence of a longer path is left out. |
| `getShortestPaths(options?)` | `getPaths` with the shortest paths. |
| `getSimplePaths(options?)` | `getPaths` with the simple paths. |
| `getShortestPathsFrom(paths, options?)` | Each given path joined with each shortest path from its end state, in order. |
| `getSimplePathsFrom(paths, options?)` | Each given path joined with each simple path from its end state, in order. |
| `getPathsFromEvents(events, options?)` | The test path of an event sequence. It uses the given options only, not the model's `options`. |
| `getAdjacencyMap()` | The adjacency map with the model's `options`. |
| `testPath(path, params, options?)` | Runs each step of the path: the executor of the step's event, then the state tests of the step's state. |
| `testState(params, state, options?)` | Runs the state tests whose keys `stateMatcher` accepts, in the key order of `params.states`; the `*` test when no other key matches. |
| `testTransition(params, step)` | Runs the executor of the step's event type, when `params.events` has one. |

`allowDuplicatePaths` defaults to `false`. Each path query reads its options over the model's
`options`, and those over `defaultTraversalOptions`, key by key.

### Path tests

- A state test or an event executor may return nothing or an Effect. What it throws, or what
  its Effect fails with, fails the path test with that value.
- When that value is an `Error`, the path test appends a trace to its `message`: `Path:`, then
  each step that ran as `State:` and `Event:` lines, then the target state.
- The first step has the event `xstate.init`, which has no executor unless `params.events`
  names that type.

### Example

```ts
import { Effect } from "effect"
import { fromTransition } from "@jambudipa/xstate-effect"
import { TestModel } from "@jambudipa/xstate-effect/graph"

type CounterEvent = { type: "inc" } | { type: "dec" }

const counter = fromTransition(
  (count: number, event: CounterEvent) => (event.type === "inc" ? Math.min(count + 1, 2) : Math.max(count - 1, 0)),
  0
)

const events: ReadonlyArray<CounterEvent> = [{ type: "inc" }, { type: "dec" }]

export const program = Effect.gen(function* () {
  const model = new TestModel(counter, { events })
  const paths = yield* model.getShortestPaths({ toState: (state) => state.context === 2 })
  return paths.map((path) => path.steps.map((step) => step.event.type)) // [["xstate.init", "inc", "inc"]]
})
```

## createShortestPathsGen and createSimplePathsGen

```ts
import type { EventObject, Snapshot } from "@jambudipa/xstate-effect"
import type { PathGenerator } from "@jambudipa/xstate-effect/graph"

export declare function createShortestPathsGen<
  TSnapshot extends Snapshot,
  TEvent extends EventObject,
  TInput
>(): PathGenerator<TSnapshot, TEvent, TInput>

export declare function createSimplePathsGen<
  TSnapshot extends Snapshot,
  TEvent extends EventObject,
  TInput
>(): PathGenerator<TSnapshot, TEvent, TInput>
```

Each returns a [`PathGenerator`](#pathgenerator) that calls
[`getShortestPaths`](#getshortestpaths) or [`getSimplePaths`](#getsimplepaths) with the logic
and the options that it receives. `TestModel.getShortestPaths` and `TestModel.getSimplePaths`
pass them to `getPaths`.

## Errors

Each error is a `Data.TaggedError` with a `message` field. Its `name` is `Error`, so it prints
as `[Error: <message>]`. Match on `_tag`.

| Class | `_tag` | `message` |
| --- | --- | --- |
| `TraversalLimitError` | `"TraversalLimitError"` | `Traversal limit exceeded` |
| `JoinPathsError` | `"JoinPathsError"` | `Paths cannot be joined` |
| `InvalidEventSequenceError` | `"InvalidEventSequenceError"` | `Invalid transition from <state key> with <event key>`, for example `Invalid transition from {"value":"yellow"} with {"type":"POWER_OUT"}` when `filterEvents` leaves `POWER_OUT` out in `yellow` |
| `UnsupportedTestMachineError` | `"UnsupportedTestMachineError"` | One of the three messages that [`createTestModel`](#createtestmodel) lists. |

## TraversalOptions

`TraversalOptions<TSnapshot, TEvent, TInput>`. Every field is optional. The defaults are in
[Traversal options](#traversal-options).

| Field | Type | Description |
| --- | --- | --- |
| `input` | `TInput` | The input of the initial snapshot, when `fromState` is not given. |
| `fromState` | `TSnapshot` | The state that the traversal starts from. |
| `events` | `ReadonlyArray<TEvent> \| ((state: TSnapshot) => ReadonlyArray<TEvent>)` | The events that the traversal sends in each state, in order. |
| `filterEvents` | `(snapshot: TSnapshot, event: TEvent) => boolean \| Effect.Effect<boolean, GuardError>` | Whether the traversal sends `event` in `snapshot`. `snapshot.can(event)` fits as it is. |
| `serializeState` | `(state: TSnapshot, event: TEvent \| undefined, prevState?: TSnapshot) => string` | The key of a state. `event` and `prevState` are `undefined` for the start state. |
| `serializeEvent` | `(event: TEvent) => string` | The key of an event. |
| `limit` | `number` | The bound of the walk: past `limit + 1` queue entries, the traversal fails with `TraversalLimitError`. |
| `stopWhen` | `(state: TSnapshot) => boolean` | The traversal sends no event in a state for which it holds. |
| `toState` | `(state: TSnapshot) => boolean` | The path functions return only the paths that end in a state for which it holds. |

## TraversalConfig

`TraversalConfig<TSnapshot, TEvent>` is the resolved form of `TraversalOptions` without
`input`: `serializeState`, `serializeEvent`, `events` and `limit` are required; `filterEvents`,
`fromState`, `stopWhen` and `toState` may be `undefined`.

## SerializationConfig

`SerializationConfig<TSnapshot, TEvent>` holds the `serializeState` and `serializeEvent` fields
of `TraversalOptions`, both required.

## TraversalError

```ts
import type { GuardError, InitializationError, TransitionError } from "@jambudipa/xstate-effect"
import type { TraversalLimitError } from "@jambudipa/xstate-effect/graph"

export type TraversalError = TraversalLimitError | InitializationError | TransitionError | GuardError
```

## StatePath, Step and Steps

| Type | Field | Type | Description |
| --- | --- | --- | --- |
| `StatePath<TSnapshot, TEvent>` | `state` | `TSnapshot` | The end state of the path. |
| | `steps` | `Steps<TSnapshot, TEvent>` | The steps, in order. |
| | `weight` | `number` | The number of events of the path. |
| `Step<TSnapshot, TEvent>` | `event` | `TEvent` | The event that led to `state`; `{ type: "xstate.init" }` for the first step. |
| | `state` | `TSnapshot` | The state after the event. |
| `Steps<TSnapshot, TEvent>` | | `Array<Step<TSnapshot, TEvent>>` | |

## AdjacencyMap and AdjacencyValue

| Type | Definition |
| --- | --- |
| `AdjacencyMap<TState, TEvent>` | `{ [key: SerializedSnapshot]: AdjacencyValue<TState, TEvent> }` |
| `AdjacencyValue<TState, TEvent>` | `{ state: TState; transitions: { [key: SerializedEvent]: { event: TEvent; state: TState } } }` |

`state` is the state as the traversal first reached it under its key. A state for which
`stopWhen` holds has no transitions.

## SerializedSnapshot and SerializedEvent

`SerializedSnapshot` and `SerializedEvent` are `string`, branded for the type checker only so
that a state key and an event key are not mixed. No value carries the brand.

## DirectedGraphNode and DirectedGraphEdge

| Type | Field | Type | Description |
| --- | --- | --- | --- |
| `DirectedGraphNode` | `id` | `string` | The state node's id. |
| | `stateNode` | `AnyStateNode` | The state node. |
| | `children` | `Array<DirectedGraphNode>` | The child nodes, in document order. |
| | `edges` | `Array<DirectedGraphEdge>` | The edges of the node's transitions. |
| | `toJSON` | `() => …` | Gives `{ id, children, edges }`. |
| `DirectedGraphEdge` | `id` | `string` | `<node id>:<transition index>:<target index>`. |
| | `source` | `AnyStateNode` | The node that holds the transition. |
| | `target` | `AnyStateNode` | One target of the transition. |
| | `label` | `{ text: string; toJSON: () => { text: string } }` | The transition's event type. |
| | `transition` | `TransitionDefinition` | The transition. |
| | `toJSON` | `() => { source: string; target: string; label: { text: string } }` | The ids of `source` and `target`, and the label. |

## TestModelOptions

`TestModelOptions<TSnapshot, TEvent, TInput>` extends [`TraversalOptions`](#traversaloptions)
with these required fields. `createTestModel` and the `TestModel` constructor take a `Partial`
of it.

| Field | Type | Default in `TestModel` | Description |
| --- | --- | --- | --- |
| `stateMatcher` | `(state: TSnapshot, stateKey: string) => boolean \| Effect.Effect<boolean, unknown>` | accepts only `*` | Whether the state test of `stateKey` applies to `state`. |
| `serializeTransition` | `(state: TSnapshot, event: TEvent \| undefined, prevState?: TSnapshot) => string` | `<state as JSON>\|<event type>` | The transition part of a state key. Only `createTestModel` reads it. |
| `logger` | `{ log: (msg: string) => void; error: (msg: string) => void }` | discards every message | No code of the package calls it. |

## TestPath

`TestPath<TSnapshot, TEvent>` extends [`StatePath`](#statepath-step-and-steps) with:

| Field | Type | Description |
| --- | --- | --- |
| `description` | `string` | For a machine snapshot: `Reaches <states>: <event> → <event> …`, for example `Reaches state "red": xstate.init → TIMER → TIMER`. For other logic: the snapshot as JSON. |
| `test` | `(params: TestParam<TSnapshot, TEvent>) => Effect.Effect<TestPathResult<TSnapshot, TEvent>, unknown>` | Runs `testPath` for this path with the model's options. |

In a description, each active atomic or final state node is named by the `description` of its
[`TestMeta`](#testmeta), quoted, or by its path, quoted (`"form.invalid"`). A `description`
function gives the text unquoted. One node gives `state …`, more give `states …, …`. The context
follows as JSON in parentheses when it has keys. An event with other fields than `type` is
written `<type> (<other fields as JSON>)`.

## TestParam and EventExecutor

| Type | Definition |
| --- | --- |
| `TestParam<TSnapshot, TEvent>` | `{ states?: { [key: string]: (state: TSnapshot) => void \| Effect.Effect<unknown, unknown> }; events?: { [type in TEvent["type"]]?: EventExecutor<TSnapshot, …> } }` |
| `EventExecutor<TSnapshot, TEvent>` | `(step: Step<TSnapshot, TEvent>) => void \| Effect.Effect<unknown, unknown>` |

An executor receives the step. Its `event` is typed with the event's `type` only.

## TestPathResult and TestStepResult

| Type | Field | Type | Description |
| --- | --- | --- | --- |
| `TestPathResult` | `steps` | `Array<TestStepResult>` | One result per step, in path order. |
| | `state.error` | `Option.Option<unknown>` | Always `Option.none()`: a failure shows in `steps` and fails the test. |
| `TestStepResult` | `step` | `Step<TSnapshot, TEvent>` | The step. |
| | `event.error` | `Option.Option<unknown>` | What the event executor failed with. |
| | `state.error` | `Option.Option<unknown>` | What a state test failed with. |

A failed path test returns no result. The results up to the failing step go into the trace on
the error's message.

## TestMeta

`TestMeta<T, TContext>` is the shape of a state node's `meta` for a test model.

| Field | Type | Description |
| --- | --- | --- |
| `description` | `string \| ((state: MachineSnapshot<TContext>) => string)` | Names the state node in a path description. An empty string names it by the snapshot's value as JSON. |
| `test` | `(testContext: T, state: MachineSnapshot<TContext>) => void \| Effect.Effect<unknown, unknown>` | No code of the package runs it. |
| `skip` | `boolean` | No code of the package reads it. |

## PathGenerator

```ts
import type { Effect } from "effect"
import type { ActorLogic, EventObject, Snapshot } from "@jambudipa/xstate-effect"
import type { StatePath, TraversalError, TraversalOptions } from "@jambudipa/xstate-effect/graph"

export type PathGenerator<TSnapshot extends Snapshot, TEvent extends EventObject, TInput> = (
  behavior: ActorLogic<TSnapshot, TEvent, TInput>,
  options: TraversalOptions<TSnapshot, TEvent, TInput>
) => Effect.Effect<Array<StatePath<TSnapshot, TEvent>>, TraversalError>
```

## Other types

| Type | Description |
| --- | --- |
| `AnyStateNode` | Any state node; the same type as the root entry point's `AnyStateNode`. |
| `StatePlanMap<TSnapshot, TEvent>` | `{ [key: string]: { state: TSnapshot; paths: Array<StatePath<TSnapshot, TEvent>> } }`. No public function takes or returns it. |
| `VisitedContext<TState, TEvent>` | `{ vertices: Set<SerializedSnapshot>; edges: Set<SerializedEvent>; a?: TState \| TEvent }`. No code of the package builds one. |

## Related

- [How to generate tests from a machine](../how-to/generate-tests-from-a-machine.md)
- [Pure transition functions](./testing/get-next-snapshot.md)
- [createMachine and the machine](./create-machine.md)
- [State nodes](./state-nodes.md)
- [Entry points](./entry-points.md)
