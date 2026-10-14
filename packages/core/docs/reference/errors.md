---
title: Errors
doc-type: reference
sources: [packages/core/src/Errors.ts, packages/core/src/graph/errors.ts, packages/core/src/testing/]
---

# Errors

> **TL;DR:** Every error class of the package is a `Data.TaggedError`: an `Error` with a `_tag`
> that `Effect.catchTag` reads. The `Errors` namespace holds the core classes; the root exports
> twelve of them, and the union `XStateError`, as types only. The graph entry point, the
> testing helpers and the dev entry point have their own classes, and a machine of
> `setupWithSchema` errors with the `SchemaError` of Effect Schema. Several classes have the
> `name` `Error`, so match on `_tag`, never on `name`.

## Summary

### The `Errors` namespace

`Errors` comes from `@jambudipa/xstate-effect`. "Root type" marks the classes that the root
also exports with `export type`.

| Class | `name` | Root type | Reaches you as |
| --- | --- | --- | --- |
| [`TransitionError`](#transitionerror) | `TransitionError` | yes | a failure of the transition functions; an actor's error |
| [`InitializationError`](#initializationerror) | `Error` | yes | a failure of the initial-snapshot functions; an actor's error |
| [`ActorError`](#actorerror) | `Error` | yes | a defect; an actor's error |
| [`GuardError`](#guarderror) | `Error` | yes | a failure of `can` and the transition functions; an actor's error |
| [`ActionError`](#actionerror-invokeerror-and-delayerror) | `ActionError` | yes | never: no function raises it |
| [`StateNodeNotFoundError`](#statenodenotfounderror) | `StateNodeNotFoundError` | yes | a failure of `machine.getStateNodeById` |
| [`SerializationError`](#serializationerror) | `Error` | yes | a failure of `getPersistedSnapshot` |
| [`RestoreError`](#restoreerror) | `RestoreError` | yes | a failure of `restoreSnapshot`; a restored actor's error |
| [`InvalidPersistedSnapshotError`](#invalidpersistedsnapshoterror) | `InvalidPersistedSnapshotError` | yes | a restored actor's error, with `validateSnapshot` |
| [`StartError`](#starterror) | `StartError` | yes | the failure type of a custom logic's `start` |
| [`InvokeError`](#actionerror-invokeerror-and-delayerror) | `InvokeError` | yes | never: no function raises it |
| [`DelayError`](#actionerror-invokeerror-and-delayerror) | `DelayError` | yes | never: no function raises it |
| [`MachineDefinitionError`](#machinedefinitionerror) | `MachineDefinitionError` | no | a failure of `resolveState`, `getStateNodes` and `getTransitionData`; the `cause` of other errors |
| [`EventAssertionError`](#eventassertionerror) | `Error` | no | a failure of `assertEvent` |

| Type | Definition |
| --- | --- |
| [`XStateError`](#xstateerror) | The union of the twelve classes with a root type export. |

### Other error classes

| Class | Entry point | `name` | Raised by |
| --- | --- | --- | --- |
| [`TraversalLimitError`](#traversallimiterror) | `/graph` | `Error` | a traversal past its `limit` |
| [`JoinPathsError`](#joinpathserror) | `/graph` | `Error` | `joinPaths` |
| [`InvalidEventSequenceError`](#invalideventsequenceerror) | `/graph` | `Error` | `getPathsFromEvents` |
| [`UnsupportedTestMachineError`](#unsupportedtestmachineerror) | `/graph` | `Error` | `createTestModel` |
| [`WaitForTimeoutError`](#waitfortimeouterror) | root | `WaitForTimeoutError` | `waitFor` |
| [`WaitForTerminatedError`](#waitforterminatederror) | root | `WaitForTerminatedError` | `waitFor` |
| [`ActorOutputError`](#actoroutputerror) | root | `ActorOutputError` | nothing |
| [`TimeTravelError`](#timetravelerror) | root | `TimeTravelError` | `SimulatedClock.set` |
| [`DevToolsError`](#devtoolserror) | `/dev` | `DevToolsError` | `registerService`, `devToolsAdapter` |
| [`SchemaError`](#schemaerror) | `effect` (`Schema.SchemaError`) | `SchemaError` | a machine of `setupWithSchema`, for a value that does not match its schema |

| Type | Entry point | Definition |
| --- | --- | --- |
| [`TraversalError`](#traversalerror) | `/graph` | `TraversalLimitError \| InitializationError \| TransitionError \| GuardError` |

The root also holds the testing classes on its `testing` namespace (`testing.WaitForTimeoutError`).

## Facts common to every class

- Each class extends `Data.TaggedError` of `effect`. An instance is an `Error`, has a readonly
  `_tag` equal to the class name, and has the fields of its class.
- An instance can be yielded in `Effect.gen` to fail with it, and `Effect.catchTag` selects it by
  `_tag`.
- A class whose `name` is `Error` prints as `[Error: <message>]`, as XState prints its plain
  errors. Its `_tag` is still the class name.
- A root type export is a type only. To construct a core error, or to test it with `instanceof`,
  use the class on the `Errors` namespace:

```ts
import { Effect } from "effect"
import { Errors } from "@jambudipa/xstate-effect"
import type { RestoreError } from "@jambudipa/xstate-effect"

export const failed: Effect.Effect<never, RestoreError> = Effect.fail(
  new Errors.RestoreError({ message: "The stored snapshot is out of date" })
)

export const recovered = failed.pipe(
  Effect.catchTag("RestoreError", (error) => Effect.succeed(`restore failed: ${error.message}`))
)
```

## How an error reaches you

| Channel | What happens | Where to read it |
| --- | --- | --- |
| A typed failure | The Effect you run fails with the error. | The error channel: `Effect.catchTag`, `Effect.either`, `Effect.exit`. |
| An actor's error | The actor gets status `error`. Its parent receives `xstate.error.actor.<id>`. | `snapshot.error` (an `Option`); the actor's `changes` stream fails with the value. |
| A defect | The Effect you run dies. | The cause of the Effect: `Effect.catchDefect`, `Effect.exit`. |

An action, a guard or actor logic that throws, fails or dies gives the actor status `error` with
the original value in `snapshot.error`. Only the errors on this page have a fixed class; a value
that your own code throws reaches `snapshot.error` as it is. See
[How to handle actor errors](../how-to/handle-actor-errors.md).

An actor's error is also reported once with `Effect.logError` when nothing handles it: the
actor has no parent and no observer, or a `subscribe` callback watches it (a callback has no
error listener). A `subscribe` callback, an `on` listener or an inspection function that
throws, fails or dies is reported in the same way, and the actor's status does not change. The
report goes through the Effect `Logger` of the fiber that meets the error: provide another
Effect `Logger` to send it elsewhere. The actor's `logger` option does not receive it: that
option is the function that `log` actions call. See
[How failures surface](../explanation/failure-model.md).

## TransitionError

| Field | Type | Description |
| --- | --- | --- |
| `message` | `string` | The text of the failure. |
| `snapshot` | `unknown` | The snapshot that took the event. |
| `event` | `unknown` | The event. |
| `cause` | `unknown` (optional) | The `MachineDefinitionError` of a definition error. |

**Raised by:** `machine.transition`, `machine.microstep`, and the pure functions
`getNextSnapshot`, `transition` and `getMicrosteps`, as a typed failure. In an actor, it is the
actor's error.

| Condition | `message` |
| --- | --- |
| The event's `type` is `"*"`. | `An event cannot have the wildcard type ('*')` |
| One macrostep takes more microsteps than the machine's `options.maxIterations` (default `Infinity`). | `Infinite loop detected: the machine has processed more than <n> microsteps without reaching a stable state. This usually happens when there's a cycle of transitions (e.g., eventless transitions or raised events causing state A -> B -> C -> A).` |
| The transition reaches a definition error of the machine. | The message of the `MachineDefinitionError`, which is the `cause`. |

An infinite loop in the initial macrostep does not fail `getInitialSnapshot`: the initial
snapshot has status `error` with the `TransitionError`.

## InitializationError

| Field | Type | Description |
| --- | --- | --- |
| `message` | `string` | The text of the failure. |
| `input` | `unknown` | The input that the initial snapshot received. |
| `cause` | `unknown` (optional) | The `MachineDefinitionError`. |

**Raised by:** `machine.getInitialSnapshot`, and the pure functions `getInitialSnapshot` and
`initialTransition`, as a typed failure. An actor of the machine has status `error` with it from
its creation.

| Condition | `message` |
| --- | --- |
| The machine config has a definition error, for example a compound state without `initial`. | The definition error's message, for example `No initial state specified for compound state node "#d.a". Try adding { initial: "x" } to the state config.` |
| An `initial` key names no child state. | `Initial state node "<key>" not found on parent state node #<id>` |

## ActorError

| Field | Type | Description |
| --- | --- | --- |
| `message` | `string` | The text of the failure. |
| `actorId` | `string` | The id of the actor that met the fault. |
| `cause` | `unknown` (optional) | The underlying value, when there is one. |

**Raised by:** no function has it in its error type. Each fault below is a defect of the Effect
you run, or the actor's error.

| Condition | Channel | `message` |
| --- | --- | --- |
| `actor.send` with a string. | defect of `send` | `Only event objects may be sent to actors; use .send({ type: "<type>" }) instead` |
| `actor.stop` of an actor that has a parent. | defect of `stop` | `A non-root actor cannot be stopped directly.` |
| `getSnapshot` from inside the actor's own initial-snapshot computation. | defect of `getSnapshot` | `Snapshot can't be read while the actor initializes itself` |
| A second actor of one system takes a `systemId` in use. | actor's error inside a spawn or an invocation; otherwise a defect | `Actor with system ID '<systemId>' already exists.` |
| `sendTo` to a target that names no actor. | actor's error | `Unable to send event to actor '<target>' from machine '<machineId>'.` |
| `raise` or `sendTo` with a string event. | actor's error | `Only event objects may be used with raise; use raise({ type: "<type>" }) instead`, or the same text for `sendTo` |
| `forwardTo` to a target that names no actor. | actor's error | `Attempted to forward event to undefined actor. This risks an infinite loop in the sender.` |
| `stopChild` of an actor that is not a child. | actor's error | `Cannot stop child actor <childId> of <actorId> because it is not a child` |
| The `spawn` of an assigner or of the context factory names no implementation. | actor's error | `Actor logic '<src>' not implemented in machine '<machineId>'` |
| `assign` in a machine whose context is `undefined`. | actor's error | ``Cannot assign to undefined `context`. Ensure that `context` is defined in the machine config.`` |

## GuardError

| Field | Type | Description |
| --- | --- | --- |
| `message` | `string` | The text of the failure. |
| `guard` | `string` | The guard's type; `""` for an inline function. |
| `cause` | `unknown` (optional) | What the guard threw, or the inner `GuardError`. |

**Raised by:** `snapshot.can`, `machine.getTransitionData`, `evaluateGuard` (from `/guards`),
and the pure functions `getNextSnapshot`, `transition` and `getMicrosteps`, as a typed failure.
In an actor, it is the actor's error.

| Condition | `message` |
| --- | --- |
| A guard throws, fails or dies while a transition is selected. | `Unable to evaluate guard '<type>' in transition for event '<event>' in state node '<id>':` then a new line and the thrown value's `message`. An inline function has no `'<type>' ` part. |
| A guard names no implementation. | The same wrapper around an inner `GuardError` with the message `Guard '<type>' is not implemented.'.` |
| `stateIn` names an id that no state node has. | The same wrapper around an inner `GuardError` with the message `Child state node '<id>' does not exist on machine '<machineId>'`. |
| Built-in guards (`and`, `or`, `not`) nest too deeply. | `Maximum call stack size exceeded` |

## StateNodeNotFoundError

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | The id as given. |
| `message` | `string` | XState's text, for example `Child state node '#nope' does not exist on machine 'g'`. |

**Raised by:** `machine.getStateNodeById(id)`, for an id or a path that names no state node.

## SerializationError

| Field | Type | Description |
| --- | --- | --- |
| `message` | `string` | The text of the failure. |
| `cause` | `unknown` (optional) | The schema error of the codec. |

**Raised by:** `actor.getPersistedSnapshot`, the `getPersistedSnapshot` of an actor reference,
and `logic.getPersistedSnapshot(snapshot)`.

| Condition | `message` |
| --- | --- |
| The context holds a value that JSON cannot hold: a function, a bigint, a symbol, a non-finite number, a class instance or a circular reference. | `<path> is <what>: a persisted context holds JSON values and actor references only`, followed by the schema path, for example `context.d is an instance of Date: …` |
| A child's `src` is a logic object, not a name: a child spawned from inline logic. | `An inline child actor cannot be persisted.` |

See [Persisted snapshots](./persistence.md#what-fails).

## RestoreError

| Field | Type | Description |
| --- | --- | --- |
| `message` | `string` | The text of the failure. |
| `cause` | `unknown` (optional) | The schema error, or the `MachineDefinitionError`. |

**Raised by:** `logic.restoreSnapshot(persisted)` as a typed failure. `createActor` with the
`snapshot` option never fails: the actor gets status `error` with the `RestoreError`, and its
snapshot then holds only `status`, `output` and `error`.

| Condition | `message` |
| --- | --- |
| The codec rejects the persisted value: a missing key, a wrong type, an unknown status. | The codec's text, for example `Missing key` and the path `at ["children"]`. |
| The state value names no state of the machine. | `State '<value>' does not exist on '<machineId>'` |
| The machine config has a definition error. | The definition error's message, which is the `cause`. |
| `scheduledEvents` does not decode. | The codec's text, for example `Expected ScheduledEventId` and its path. |

## InvalidPersistedSnapshotError

| Field | Type | Description |
| --- | --- | --- |
| `message` | `string` | `[Actor] Invalid persisted snapshot: status is 'done' but state '<stateValue>' is not a final state. This actor cannot process any events. If you want to retry/reset this actor, change status to 'active' in the persisted snapshot. Machine: <machineId>` |
| `machineId` | `string` | The machine's id. |
| `stateValue` | `string` | The state value; JSON text when it is not a string. |
| `status` | `string` | The persisted status. |
| `suggestedFix` | `{ readonly status: "active" }` | The status that makes the snapshot usable again. |

**Raised by:** `createActor` with `validateSnapshot: true`, when a persisted machine snapshot has
status `done` on a state that does not complete the machine. The actor gets status `error` with
it. The same check runs for each child that the restore creates. Without the option, the
snapshot restores unchecked.

## StartError

| Field | Type | Description |
| --- | --- | --- |
| `message` | `string` | The text of the failure. |
| `actorId` | `string` | The actor's id. |
| `cause` | `unknown` (optional) | The underlying value. |

**Raised by:** none of the package's own logic. It is the declared failure type of the optional
`start` of custom actor logic; see [Custom actor logic](./actors/custom-logic.md). A `start` that
fails gives the actor status `error` with the value.

## ActionError, InvokeError and DelayError

| Class | Fields |
| --- | --- |
| `ActionError` | `message: string`, `action: string`, `cause?: unknown` |
| `InvokeError` | `message: string`, `src: string`, `cause?: unknown` |
| `DelayError` | `message: string`, `delay: string`, `cause?: unknown` |

**Raised by:** no function of the package. They are members of `XStateError`. An action that
throws gives the actor status `error` with the thrown value, not an `ActionError`.

## MachineDefinitionError

| Field | Type | Description |
| --- | --- | --- |
| `message` | `string` | XState's text for the definition error. |

**Raised by:**

- `machine.resolveState(config)`, for a state value that names no state, or a machine with a
  definition error. Example message: `State 'zz' does not exist on 'g'`.
- `getStateNodes(stateNode, stateValue)`, for a state value that names no state.
- `machine.getTransitionData(snapshot, event)`, for a machine with a definition error.
- `createMachine` never fails. It keeps the first definition error of the config, and each
  Effect that computes a snapshot fails with an `InitializationError`, a `RestoreError` or a
  `TransitionError` whose `cause` is the `MachineDefinitionError`.

Read it as `Errors.MachineDefinitionError`; the root has no type export of it.

## EventAssertionError

| Field | Type | Description |
| --- | --- | --- |
| `message` | `string` | `Expected event <the event as JSON> to have type matching "<type>"`, or `… to have one of types matching "<type1>", "<type2>"` for several types. |

**Raised by:** `assertEvent(event, type)`, when no given type matches the event. In an action,
it is the actor's error. Read it as `Errors.EventAssertionError`. See [Events](./events.md#assertevent).

## XStateError

```ts
import type {
  ActionError,
  ActorError,
  DelayError,
  GuardError,
  InitializationError,
  InvalidPersistedSnapshotError,
  InvokeError,
  RestoreError,
  SerializationError,
  StartError,
  StateNodeNotFoundError,
  TransitionError
} from "@jambudipa/xstate-effect"

export type XStateErrorShape =
  | TransitionError
  | InitializationError
  | ActorError
  | GuardError
  | ActionError
  | StateNodeNotFoundError
  | SerializationError
  | RestoreError
  | InvalidPersistedSnapshotError
  | StartError
  | InvokeError
  | DelayError
```

`XStateError` does not hold `MachineDefinitionError` or `EventAssertionError`.

## TraversalLimitError

| Field | Type | Description |
| --- | --- | --- |
| `message` | `string` | `Traversal limit exceeded` |

**Raised by:** the graph traversals of `@jambudipa/xstate-effect/graph` (`getAdjacencyMap`,
`getShortestPaths`, `getSimplePaths`, `getPathsFromEvents`, and the path methods of a
`TestModel`), when the traversal visits more states than its `limit` option. The default limit is
`Infinity`.

## JoinPathsError

| Field | Type | Description |
| --- | --- | --- |
| `message` | `string` | `Paths cannot be joined` |

**Raised by:** `joinPaths(headPath, tailPath)` of `/graph`, when the tail path does not start
where the head path ends; also `TestModel.getShortestPathsFrom` and
`TestModel.getSimplePathsFrom`, which join paths.

## InvalidEventSequenceError

| Field | Type | Description |
| --- | --- | --- |
| `message` | `string` | `Invalid transition from <serialized state> with <serialized event>` |

**Raised by:** `getPathsFromEvents` of `/graph` and `TestModel.getPathsFromEvents`, when an
event of the sequence has no entry in the adjacency map from the state that it meets, for
example an event that `filterEvents` leaves out. The sequence is also the traversal's `events`,
so an event that the state does not take has an entry: it leaves the path in that state, as in
XState, and raises no error.

## UnsupportedTestMachineError

| Field | Type | Description |
| --- | --- | --- |
| `message` | `string` | One of the texts below. |

**Raised by:** `createTestModel(machine)` of `/graph`, for a machine that a test model cannot
drive:

| Condition | `message` |
| --- | --- |
| A state node has an invocation. | `Invocations on test machines are not supported` |
| A state node has an `after` transition. | `After events on test machines are not supported` |
| An action is delayed. | `Delayed actions on test machines are not supported` |

## TraversalError

`TraversalError` is the failure type of a traversal of `/graph`: a `TraversalLimitError`, the
`InitializationError` of the initial snapshot, or the `TransitionError` or `GuardError` of a
transition or of a `filterEvents` Effect. See [Graph and model-based testing](./graph.md).

## WaitForTimeoutError

| Field | Type | Description |
| --- | --- | --- |
| `timeout` | `number` | The timeout in milliseconds. |
| `message` | `string` (getter) | `Timeout of <timeout> ms exceeded` |

**Raised by:** `waitFor` and `waitForPromise`, when the `timeout` passes on the Effect clock
before a snapshot satisfies the predicate. See [waitFor, toEffect and toPromise](./testing/wait-for.md).

## WaitForTerminatedError

| Field | Type | Description |
| --- | --- | --- |
| `message` | `string` (getter) | `Actor terminated without satisfying predicate` |

**Raised by:** `waitFor` and `waitForPromise`, when the actor is done or stopped before a
snapshot satisfies the predicate, also when it ended before the call. An actor that errors makes
`waitFor` fail with the actor's own error instead.

```ts
import { Duration, Effect } from "effect"
import { createActor, createMachine, waitFor, WaitForTimeoutError } from "@jambudipa/xstate-effect"

const job = createMachine({
  types: {} as { events: { type: "FINISH" } },
  initial: "running",
  states: { running: { on: { FINISH: "finished" } }, finished: { type: "final" } }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(job)
  yield* actor.start
  const result = yield* waitFor(actor, (snapshot) => snapshot.matches("finished"), {
    timeout: Duration.millis(50)
  }).pipe(
    Effect.map(() => "finished"),
    Effect.catchIf(
      (error): error is WaitForTimeoutError => error instanceof WaitForTimeoutError,
      (error) => Effect.succeed(error.message)
    )
  )
  console.log(result) // "Timeout of 50 ms exceeded"
})

void Effect.runPromise(Effect.scoped(program))
```

## ActorOutputError

| Field | Type | Description |
| --- | --- | --- |
| `cause` | `unknown` | The actor's error. |
| `message` | `string` (getter) | `Actor errored before producing output` |

**Raised by:** nothing. `toEffect` and `toPromise` fail with the actor's own error, not with this
class.

## TimeTravelError

| Field | Type | Description |
| --- | --- | --- |
| `message` | `string` | `Unable to travel back in time` |
| `from` | `number` | The clock's time, in milliseconds. |
| `to` | `number` | The time that `set` was given. |

**Raised by:** `set(ms)` of a `SimulatedClock`, and of the clock that `makeSimulatedClockEffect`
gives, when `ms` is earlier than the clock's time. The clock keeps its time. See
[SimulatedClock](./testing/simulated-clock.md).

## DevToolsError

| Field | Type | Description |
| --- | --- | --- |
| `message` | `string` | `The dev tools hook could not register actor "<id>"`, or `The dev tools hook has no register function` |
| `cause` | `unknown` | What `register` threw, or the hook value. |

**Raised by:** `registerService` and `devToolsAdapter` of `@jambudipa/xstate-effect/dev`, when
the global `__xstate__` hook's `register` throws, or the hook has no `register` function. An
actor's `start` with the `devTools` option dies with it. See [Dev tools entry point](./dev.md).

## SchemaError

`SchemaError` is the error class of Effect Schema (`Schema.SchemaError` of `effect`), not of
this package. Its `_tag` and its `name` are `SchemaError`.

| Field | Type | Description |
| --- | --- | --- |
| `issue` | `SchemaIssue.Issue` | The tree of what did not match, with the path to each value. |
| `message` | `string` (getter) | The issue as text, for example `Expected number` and the line `at ["count"]`. |

**Raised by:** a machine that `setupWithSchema` creates, when a value does not match the
decoded type of its schema. The machine checks each event that it takes (not the built-in
`xstate.*` events), the context of its initial snapshot and of each snapshot that a transition
gives, its input, and the output of a done snapshot. A value that does not match fails as user
code that throws the `SchemaError`:

| Where | Result |
| --- | --- |
| In an actor, for an event | The actor gets status `error` with the `SchemaError` in `snapshot.error`, and keeps the state and context from before the event. Its parent receives `xstate.error.actor.<id>`. |
| At the initial snapshot, for the input or the initial context | The initial snapshot has status `error` with the `SchemaError`. `getInitialSnapshot` does not fail. |
| `machine.transition` and the pure functions `transition`, `getNextSnapshot` and `getMicrosteps` | A defect of the Effect you run. |

`validateContext` and `validateEvent` of the setup fail with it as a typed failure. See
[setup and setupWithSchema](./setup.md).

## Related pages

- [How to handle actor errors](../how-to/handle-actor-errors.md).
- [How failures surface](../explanation/failure-model.md).
- [Snapshots](./snapshots.md): `snapshot.error`.
- [Persisted snapshots](./persistence.md): what fails when an actor persists or restores.
