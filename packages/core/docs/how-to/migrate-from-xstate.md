---
title: How to port XState code to this package
doc-type: how-to
sources: [packages/core/src/index.ts, packages/core/README.md]
---

# How to port XState code to this package

> **TL;DR:** Machine configs port almost unchanged: change the imports and keep `setup`,
> `createMachine` and the action, guard and actor logic creators. The code around the machine
> changes. Create actors inside `Effect.gen` and `Effect.scoped`, `yield*` each actor member, read
> absent values as `Option`s, and replace observer objects and `Subscription`s with scoped Effects
> and the `changes` stream. Catch failures as typed Effect errors, because nothing throws.

## When you need this

You have code written for XState v5 and want it to run on Effect. The package follows
`xstate@5.33.2`: the same statechart behaviour, with an Effect-native API. Code written for
XState v4 must first move to v5 with XState's own migration guide.

## Before you start

- Your project is an ES module project on Node.js 20 or later. The package ships no CommonJS
  build.
- Install the package and its peer dependency:

  ```bash
  pnpm add @jambudipa/xstate-effect effect
  ```

- You know `Effect.gen`, `Scope`, `Stream` and `Option` from `effect` 4.

## Steps

### 1. Change the imports

Each XState entry point has a counterpart with the same subpath:

| XState | This package |
|---|---|
| `xstate` | `@jambudipa/xstate-effect` |
| `xstate/actions` | `@jambudipa/xstate-effect/actions` |
| `xstate/actors` | `@jambudipa/xstate-effect/actors` |
| `xstate/guards` | `@jambudipa/xstate-effect/guards` |
| `xstate/graph` | `@jambudipa/xstate-effect/graph` |
| `xstate/dev` | `@jambudipa/xstate-effect/dev` |

Each entry point is one ES module build, with no `development` build. A `require` resolves to
the same ES module file.

Some XState names have no counterpart:

- `interpret`: use `createActor`.
- `toObserver`, `InteropObservable` and the `Subscription` type: use the `changes` stream and
  scoped subscriptions (step 4).
- `new Actor(logic)`: `Actor` is still the class of every actor, so `actor instanceof Actor`
  works, but only `createActor` creates an actor.

### 2. Keep the machine definitions, and adjust the code inside them

The config shape, `setup`, `createMachine`, `machine.provide`, the built-in actions and guards,
and `fromPromise`, `fromCallback`, `fromObservable`, `fromEventObservable` and `fromTransition`
work as in XState. Adjust the code that you wrote inside the config:

- **Return Effects from actions.** A custom action or guard may return an Effect, and the actor
  runs it. A guard's Effect gives the `boolean`.
- **`self` and `system` are Effect-based.** `self.send(event)` returns an Effect, and
  `self.getSnapshot` and `system.get(systemId)` are Effects. Return the Effect from the action,
  or it never runs. Reading `self.getSnapshot` while the initial snapshot is computed dies, in
  every build, with the message of XState's development build.
- **`assertEvent` returns an Effect** of the narrowed event, and fails with an
  `EventAssertionError` that carries XState's message.
- **`log` actions use Effect logging** at the action's level by default, not `console.log`.
  The `logger` actor option still receives `(label, value)` or `(value)`, as in XState. The
  package's warnings also go through the Effect logger, because it writes nothing to the console.
- **A string target of `sendTo` and `stopChild`** resolves by child id and also by
  `systemId`.
- **`#_self` names the machine actor itself.** In XState it names a child whose id is `self`.
  Reach such a child by its plain id: `sendTo("self", ...)`.
- **`spawn` with a src that names no actor** returns a reference and lets your function go on.
  The action then fails with XState's message, so the actor errors as for XState's uncaught
  throw. A `try`/`catch` around the call catches nothing.
- **`spawnChild` with a src that names no actor** logs XState's warning and adds no entry to
  `snapshot.children`. The actor stays active.
- **The built-in action and guard creators return definition objects**, not functions. Pass
  them as actions and guards. Code that calls them as functions fails.

```ts
import { Effect } from "effect"
import { assertEvent, setup } from "@jambudipa/xstate-effect"

type FormEvent = { type: "SUBMIT"; value: string } | { type: "CLEAR" }

export const formMachine = setup({
  types: {} as { context: { value: string }; events: FormEvent },
  actions: {
    // The returned Effect runs; a bare `self.send(...)` statement would do nothing
    clearForm: ({ self }) => self.send({ type: "CLEAR" }),
    // assertEvent narrows the event through an Effect
    report: ({ event }) =>
      Effect.gen(function* () {
        const submitted = yield* assertEvent(event, "SUBMIT")
        yield* Effect.log(`submitted ${submitted.value}`)
      })
  }
}).createMachine({
  context: { value: "" },
  initial: "editing",
  states: {
    editing: {
      on: { SUBMIT: { target: "submitted", actions: ["report", "clearForm"] } }
    },
    submitted: {
      on: { CLEAR: "editing" }
    }
  }
})
```

Check the types of the machine too:

- Type a machine through `types` or `setup`. If you pass type arguments to `createMachine`, the
  order is context, events, input, output, emitted events, then `R`, then XState's other
  parameters. `R` holds the Effect services that the machine's actions and actors need: see
  [How to give a machine's actions and actors Effect services](provide-services-to-a-machine.md).
- An `after` key that names no delay of a `setup` machine is a type error. XState misses this
  error.
- Inside a `setup` record, a built-in action that names a sibling action of the same record
  accepts any params for it. XState checks them.
- A few config type errors appear on a nearby line, not where XState reports them: for example
  an action object with an unknown `type` in a `setup` machine.

### 3. Run actors as Effects

`createActor` returns an Effect that needs a `Scope`. Create the actor with `yield*` inside
`Effect.gen`, and run the program with `Effect.scoped`. Each actor member that XState calls is an
Effect here:

| XState | This package |
|---|---|
| `const actor = createActor(machine)` | `const actor = yield* createActor(machine)` |
| `actor.start()` | `yield* actor.start` |
| `actor.send(event)` | `yield* actor.send(event)` |
| `actor.getSnapshot()` | `yield* actor.getSnapshot` |
| `actor.stop()` | `yield* actor.stop` |
| `actor.system.get(id)` | `yield* actor.system.get(id)`, an `Option` |
| `actor.system.getAll()` | `yield* actor.system.getAll` |
| `actor.system.getSnapshot()` | `yield* actor.system.getSnapshot` |
| `createEmptyActor()` | `yield* createEmptyActor()` |

```ts
import { Effect } from "effect"
import { createActor, createMachine } from "@jambudipa/xstate-effect"

const toggleMachine = createMachine({
  types: {} as { events: { type: "TOGGLE" } },
  initial: "off",
  states: {
    off: { on: { TOGGLE: "on" } },
    on: { on: { TOGGLE: "off" } }
  }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(toggleMachine)
  yield* actor.start

  // An external send completes after the event's macrostep, so the next read sees it
  yield* actor.send({ type: "TOGGLE" })
  const snapshot = yield* actor.getSnapshot
  console.log(snapshot.value) // on
})

// Closing the scope stops the actor and its children
void Effect.runPromise(Effect.scoped(program))
```

These lifetime and delivery rules differ from XState:

- **The scope owns the actor.** Closing the scope that created a root actor stops it and its
  children, and runs their finalizers. A child stops with its parent, also a child that a later
  `spawnChild` with the same id replaced, and an actor created with the `parent` option.
- **A send from outside waits for its macrostep.** A send made from inside an actor or its
  callbacks only queues the event. Events sent before `start` are processed at `start`. A string
  in place of an event object is a defect.
- **`stop` stops only a root actor.** On a child it dies; stop a child from its parent with
  `stopChild`.
- **Each root actor creates its own system**, also when an `ActorSystemLive` layer is provided.

### 4. Replace subscriptions and observer objects

A subscription is a scoped Effect: it ends when the scope that it runs in closes, so there is no
`unsubscribe`. Each callback returns an Effect.

| XState | This package |
|---|---|
| `actor.subscribe(fn)` | `yield* actor.subscribe((snapshot) => Effect…)` |
| `actor.subscribe({ next, error, complete })` | `actor.changes`: the current snapshot, then each new one; the stream fails with the actor's error and ends when the actor is done or stopped |
| `subscription.unsubscribe()` | close the scope of the subscription |
| `actor.on(type, handler)` | `yield* actor.on(type, (event) => Effect…)`, or the `actor.emissions` stream |
| `actor.select(selector).get()` | `yield* actor.select(selector).get` |
| `actor.select(selector).subscribe(fn)` | `yield* actor.select(selector).subscribe((value) => Effect…)`, or its `changes` stream |
| `inspect: { next }` (an observer object) | `inspect: (event) => Effect…` (a function only) |
| `from(actor)` with RxJS | `actor.changes` |

```ts
import { Effect, Stream } from "effect"
import { createActor, createMachine } from "@jambudipa/xstate-effect"

const toggleMachine = createMachine({
  types: {} as { events: { type: "TOGGLE" } },
  initial: "off",
  states: {
    off: { on: { TOGGLE: "on" } },
    on: { on: { TOGGLE: "off" } }
  }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(toggleMachine)

  // As XState's subscribe(fn): each snapshot published after this call
  yield* actor.subscribe((snapshot) => Effect.log(`now ${String(snapshot.value)}`))

  // As an observer object with next, error and complete: the changes stream
  yield* actor.changes.pipe(
    Stream.runForEach((snapshot) => Effect.log(`status ${snapshot.status}`)),
    Effect.catch((error) => Effect.logError("the actor failed", error)),
    Effect.forkScoped
  )

  yield* actor.start
  yield* actor.send({ type: "TOGGLE" })
})

void Effect.runPromise(Effect.scoped(program))
```

A `subscribe` callback, an `on` listener or an inspection function that throws is logged once
and never changes the actor. See [How to react to snapshot changes](react-to-snapshot-changes.md)
and [How to emit events and listen to them](emit-and-listen-to-events.md).

### 5. Read absent values as `Option`s

Where XState holds a value or `undefined`, the package holds an `Option`. An `undefined` value is
`Option.none()`, so `Option.some(undefined)` never occurs:

- `snapshot.output` and `snapshot.error`. `OutputFrom<T>` is still the output type itself, so the
  field is `Option<OutputFrom<T>>`.
- The `output` of `xstate.done.actor.*` and `xstate.done.state.*` events. The `error` of an
  `xstate.error.actor.*` event stays the raw value.
- The `sourceRef` of an `@xstate.event` inspection event.
- The `snapshot.context` of `fromObservable` and `fromEventObservable` logic.
- The `parent`, `machine` and `output` fields of a `StateNode`, and its extra `target` field
  (the default target of a history node).

Two collections change shape too:

- `snapshot.tags` is a read-only array, each tag once, in the order of XState's `Set`. `hasTag`
  works as before. Write `new Set(snapshot.tags)` where you need a `Set`.
- `stateNode.transitions` is a read-only array of `[descriptor, transitions]` entries, in XState's
  `Map` order. Iteration works as before; `get` does not exist.

```ts
import { Effect, Option } from "effect"
import { createActor, createMachine } from "@jambudipa/xstate-effect"

const checkoutMachine = createMachine({
  types: {} as { events: { type: "PAY" }; output: { orderId: string } },
  initial: "cart",
  states: {
    cart: { tags: ["editable"], on: { PAY: "paid" } },
    paid: { type: "final" }
  },
  output: { orderId: "order-1" }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(checkoutMachine)
  yield* actor.start
  console.log((yield* actor.getSnapshot).tags) // ["editable"]

  yield* actor.send({ type: "PAY" })
  const snapshot = yield* actor.getSnapshot
  const orderId = Option.match(snapshot.output, {
    onNone: () => "no order",
    onSome: (output) => output.orderId
  })
  console.log(orderId) // order-1
})

void Effect.runPromise(Effect.scoped(program))
```

### 6. Yield the snapshot queries and the pure functions

Every API that can run a guard or an action returns an Effect, because guards and actions may
be Effects:

- `snapshot.can(event)` gives `Effect<boolean, GuardError>`. `matches`, `hasTag`, `getMeta` and
  `toJSON` stay synchronous. A spread copy of a snapshot has no `can`.
- `transition`, `initialTransition`, `getNextSnapshot`, `getInitialSnapshot`, `getMicrosteps`,
  `getInitialMicrosteps` and `getNextTransitions` return Effects.
- `machine.transition`, `machine.microstep`, `machine.getTransitionData`,
  `machine.resolveState` and `machine.getStateNodeById` return Effects. `machine.transition` and
  `machine.microstep` read the actor scope from the Effect context instead of a third argument,
  so outside an actor use the pure functions above.
- The `exec` of an executable action that `transition` or `initialTransition` gives is an
  `Effect<void>` with its arguments bound, not a function of `(info, params)`.
- `evaluateGuard(guard, context, event, scope)` from `/guards` returns `Effect<boolean,
  GuardError>`. Its fourth argument is `{ self, system, implementations?, snapshot? }`, not the
  snapshot.
- The graph traversals of `/graph` return Effects.

```ts
import { Effect } from "effect"
import { createMachine, getInitialSnapshot, getNextSnapshot, transition } from "@jambudipa/xstate-effect"

const toggleMachine = createMachine({
  types: {} as { events: { type: "TOGGLE" } },
  initial: "off",
  states: {
    off: { on: { TOGGLE: "on" } },
    on: {
      entry: () => Effect.log("light on"),
      on: { TOGGLE: "off" }
    }
  }
})

const program = Effect.gen(function* () {
  const initial = yield* getInitialSnapshot(toggleMachine)
  const canToggle = yield* initial.can({ type: "TOGGLE" })
  console.log(canToggle) // true

  const next = yield* getNextSnapshot(toggleMachine, initial, { type: "TOGGLE" })
  console.log(next.value) // on

  // transition gives the actions without running them; exec runs one
  const [, actions] = yield* transition(toggleMachine, initial, { type: "TOGGLE" })
  yield* Effect.forEach(actions, (action) => action.exec, { discard: true })
})

void Effect.runPromise(program)
```

### 7. Replace `try`/`catch` with Effect error handling

No call of the package throws synchronously:

- `createMachine` never throws. A config with a definition error gives an actor whose status is
  `error` from creation on, with an `InitializationError` that carries XState's message. Each
  Effect that computes a snapshot of that machine fails with the `MachineDefinitionError`, or
  with an error whose `cause` it is.
- `machine.resolveState` with a state value that names no state, and `assertEvent` with an event
  of another type, fail their Effects with XState's messages.
- Actions, guards and children that fail set the actor's status to `error`, as in XState.
- An error that nothing handles is logged once with `Effect.logError`, not thrown again
  asynchronously. Provide an Effect `Logger` to capture it.
- An actor that errors closes its scope: its children stop, and the cleanup of a callback actor
  runs. A cleanup that throws is logged, and the callback actor still ends `stopped`.
- A guard that refers back to itself through `and`, `or` or `not` fails with a `GuardError` after
  10,000 nested evaluations.
- Each error class has a `_tag`. Several set `name` to `"Error"` to print as XState's errors do,
  so match on `_tag`.

[How to handle actor errors](handle-actor-errors.md) gives the steps.

### 8. Port the tests and their helpers

| XState | This package |
|---|---|
| `await toPromise(actor)` | `yield* toEffect(actor)`: the output as an `Option`; it fails with the raw actor error |
| `await waitFor(actor, predicate, { timeout })` | `yield* waitFor(actor, predicate, { timeout })`; the timeout runs on the Effect clock, so `TestClock` drives it |
| `clock.increment(ms)`, `clock.set(ms)` on a `SimulatedClock` | `yield* clock.increment(ms)`, `yield* clock.set(ms)` |
| `createTestModel(machine)` | `yield* createTestModel(machine)` |
| `model.getShortestPaths()` and the other path methods | Effects |
| `await model.testPath(path, params)`, `testState`, `testTransition`, `path.test` | Effects |

The helpers also behave differently in some cases:

- `waitFor` on an actor that is stopped already fails at once with `WaitForTerminatedError`, and
  `toEffect` succeeds at once with `Option.none()`. XState waits for ever.
- `SimulatedClock` fires the due timers one at a time, in deadline order, and waits for the
  macrostep of each delivered event. A timer that such a macrostep starts counts from the firing
  time, so it can fire in the same `increment`. `set` to an earlier time fails with
  `TimeTravelError`. A timer callback that throws leaves the clock usable.
- `createTestModel` fails with `UnsupportedTestMachineError` for a machine that it cannot test,
  and the `error` fields of a test result are `Option`s. The default `logger` of a test model
  does nothing.
- `getPathsFromEvents` with an event that the reached state does not take fails with
  `InvalidEventSequenceError` and XState's message.

```ts
import { Effect } from "effect"
import { createActor, createMachine, SimulatedClock, toEffect } from "@jambudipa/xstate-effect"

const timeoutMachine = createMachine({
  types: {} as { output: string },
  initial: "waiting",
  states: {
    waiting: { after: { 1000: "timedOut" } },
    timedOut: { type: "final" }
  },
  output: "timed out"
})

const program = Effect.gen(function* () {
  const clock = new SimulatedClock()
  const actor = yield* createActor(timeoutMachine, { clock })
  yield* actor.start

  yield* clock.increment(1000)
  const output = yield* toEffect(actor)
  console.log(output) // Option.some("timed out")
})

void Effect.runPromise(Effect.scoped(program))
```

### 9. Port persistence

- `yield* actor.getPersistedSnapshot` gives a JSON-safe value typed `unknown`. An Effect `Schema`
  codec encodes it, so a context that the codec cannot encode fails with `SerializationError`.
  An `Option.none()` field is an absent key, and a machine snapshot also holds its tags.
- Restore with `createActor(machine, { snapshot: persisted })`, as in XState.
- The delayed events that an actor scheduled and that are pending are persisted too, under
  `scheduledEvents`. A restored actor resumes them at `start`, after the time that was left.
  XState loses them.
- Pass `validateSnapshot: true` to reject a machine snapshot whose status is `done` on a state
  that does not complete the machine. XState checks nothing, and so does the package by default.

See [How to persist and restore an actor](persist-and-restore-an-actor.md).

## Variations

### Dev tools

`getGlobal()` returns an Effect of an `Option`. `registerService(actor)` and
`devToolsAdapter(actor)` return Effects that fail with `DevToolsError` instead of throwing. A
`DevToolsAdapter` returns an Effect. The `devTools` actor option is typed
`boolean | DevToolsAdapter`, not deprecated. See
[How to inspect a running actor system](inspect-an-actor-system.md).

### Custom actor logic

An actor logic object that you write yourself has Effect members. Its `transition`,
`getInitialSnapshot` and `start` return Effects and read the actor scope from the Effect context,
not from an argument. A logic that wraps another passes only the snapshot and the event. The
reducer of `fromTransition` still receives a plain actor scope as its third argument, and its
initial-state factory receives `{ input, self }`. See
[Custom actor logic and createEmptyActor](../reference/actors/custom-logic.md).

### Use the Effect-native extras

Once the port runs, you can replace Promise-based code with the package's extras:

- `fromEffect`, `fromEffectBackground` and `fromEffectRetry` run an Effect as an actor, and
  `fromStream` runs a `Stream`. Import `fromEffectRetry` from `/actors`; the others are also
  root exports.
- `setupWithSchema` types a machine from Effect Schemas.
- `sendSelf`, `assignProperty`, `stopAllChildren`, `stateNotIn` and the level helpers of `log`
  (`logDebug`, `logInfo`, `logWarning`, `logError`) shorten common configs.

See [How to run an Effect or a Stream as an actor](run-an-effect-as-an-actor.md) and
[How to type a machine from Effect Schemas](validate-events-with-schema.md).

## Related

- [How this package differs from XState](../explanation/differences-from-xstate.md): why each
  difference exists.
- [Entry points](../reference/entry-points.md): what each subpath exports.
- [XState type names](../reference/upstream-type-names.md): the XState types that the package
  exports.
- [createActor and the actor](../reference/create-actor.md): every actor member and option.
- [Snapshots](../reference/snapshots.md): the snapshot fields and their `Option`s.
