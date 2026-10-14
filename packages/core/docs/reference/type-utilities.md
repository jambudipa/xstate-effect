---
title: Type utilities
doc-type: reference
sources: [packages/core/src/Types.ts, packages/core/src/setup.ts, packages/core/src/typeUtils.ts]
---

# Type utilities

> **TL;DR:** The extractor types read one part of a setup, a machine, an actor logic, an actor or
> a reference: `ContextFrom`, `EventFrom`, `SnapshotFrom`, `InputFrom`, `OutputFrom`,
> `ActorRefFrom` and the others; `OutputFrom` gives the output type itself, not the `Option` that
> `snapshot.output` holds. The requirement extractors, such as `Types.ConfigRequirementsOf`, give
> the Effect services that an action, a config or a set of implementations needs. A type that an
> extractor does not recognise gives `never`. The root also exports XState's general type
> utilities, such as `IsNever`, `Compute` and `SingleOrArray`.

Every item on this page is a type-only export of `@jambudipa/xstate-effect`. Import it with
`import type` or with the `type` modifier. No item has a value at run time.

## Summary

| Type | Takes | Gives |
|---|---|---|
| [`ContextFrom<T>`](#contextfrom) | A setup, a machine, an actor, an actor reference, a machine snapshot, or a function that returns one | The context type |
| [`EventFrom<T, K>`](#eventfrom) | A setup, an actor logic, an actor, an actor reference, or a function that returns one | The events it takes, or only those of the types `K` |
| [`ActorsFrom<T>`](#actorsfrom-actionsfrom-guardsfrom-and-delaysfrom) | A setup | The `actors` record of the setup |
| [`ActionsFrom<T>`](#actorsfrom-actionsfrom-guardsfrom-and-delaysfrom) | A setup | The `actions` record of the setup |
| [`GuardsFrom<T>`](#actorsfrom-actionsfrom-guardsfrom-and-delaysfrom) | A setup | The `guards` record of the setup |
| [`DelaysFrom<T>`](#actorsfrom-actionsfrom-guardsfrom-and-delaysfrom) | A setup | The `delays` record of the setup |
| [`SchemaTypeOr<TSchema, TDefault>`](#schematypeor) | A schema, or `undefined` | The decoded type of the schema, or `TDefault` |
| [`ActorRefFrom<T>`](#actorreffrom) | An actor logic, a `Promise`, or a function that returns one | The reference type of the logic |
| [`ActorRefFromLogic<T>`](#actorreffromlogic) | An actor logic | The reference type of the logic |
| [`SnapshotFrom<T>`](#snapshotfrom) | An actor logic, an actor, an actor reference, or a function that returns one | The snapshot type |
| [`InputFrom<T>`](#inputfrom) | An actor logic | The input type |
| [`OutputFrom<T>`](#outputfrom) | An actor logic, an actor or an actor reference | The output type |
| [`EmittedFrom<TLogic>`](#emittedfrom) | An actor logic | The emitted event type |
| [`EventFromLogic<TLogic>`](#eventfromlogic) | An actor logic | The events it takes |
| [`ActorLogicFrom<T>`](#actorlogicfrom) | A machine, a `Promise`, or a function that returns one | The actor logic type |
| [`StateFrom<T>`](#statefrom) | A machine, or a function that returns one | The machine snapshot type |
| [`StateValueFrom<TMachine>`](#statevaluefrom) | A machine | The values that `snapshot.matches` takes |
| [`TagsFrom<TMachine>`](#tagsfrom) | A machine | The tags that `snapshot.hasTag` takes |
| [`MachineImplementationsFrom<T>`](#machineimplementationsfrom) | A machine, or a function that returns one | The implementations that `machine.provide` takes |
| [`StateSchemaFrom<T>`](#stateschemafrom) | A machine | The state schema of the machine |
| [`Types.EffectRequirementsOf<T>`](#effectrequirementsof) | Any type | What the Effect `T` requires |
| [`Types.ActionRequirementsOf<TAction>`](#actionrequirementsof) | An action, or an array of actions | The services that its Effect needs |
| [`Types.ConfigRequirementsOf<TConfig>`](#configrequirementsof) | A machine config, as it is written | The services of its inline actions and inline actor logic |
| [`Types.ImplementationsRequirementsOf<T>`](#implementationsrequirementsof) | The implementations given to `machine.provide` | The services that they need |
| [`SetupRequirements<TActions, TActors>`](#setuprequirements) | The `actions` and `actors` records of a setup | The services that they need |
| [General type utilities](#general-type-utilities) | Any types | XState's helper types, from `AnyFunction` to `Values` |

## Setup extractors

### ContextFrom

`ContextFrom<T>` gives a context type.

| `T` | Result |
|---|---|
| The return value of `setup(...)` | The `types.context` of the setup; `unknown` when the setup declares none. |
| A machine snapshot (a type with `context` and `value`) | Its `context` type. |
| A machine, an actor or an actor reference | The `context` type of its snapshot. |
| An actor logic whose snapshot has a `context`, such as `fromTransition` logic | That `context` type. For `fromTransition` logic, it is the state type. |
| A function | The result for its return type. |
| Any other type | `never`. A `fromPromise` logic, for example, has no context. |

```ts
import { setup, type ContextFrom, type SnapshotFrom } from "@jambudipa/xstate-effect"

const counter = setup({ types: {} as { context: { count: number } } })
export const machine = counter.createMachine({ context: { count: 0 } })

export type FromSetup = ContextFrom<typeof counter> // { count: number }
export type FromMachine = ContextFrom<typeof machine> // { count: number }
export type FromSnapshot = ContextFrom<SnapshotFrom<typeof machine>> // { count: number }
```

### EventFrom

`EventFrom<T, K extends TEvent["type"] = never, TEvent extends EventObject = …>` gives an event
type. The third parameter holds the events of `T`; do not set it.

| `T` | Result |
|---|---|
| The return value of `setup(...)` | The `types.events` of the setup; `AnyEventObject` when the setup declares none. |
| A machine or any other actor logic | The events it takes. `fromPromise` logic takes `EventObject`. |
| An actor or an actor reference | The events it takes. |
| A function | The result for its return type. |
| Any other type | `never`. |

| Parameter | Constraint | Default | Effect |
|---|---|---|---|
| `K` | A union of event types of `T` | `never` | When set, the result keeps only the events whose `type` is in `K`. |

```ts
import { setup, type EventFrom } from "@jambudipa/xstate-effect"

export const machine = setup({
  types: {} as { events: { type: "GO" } | { type: "STOP"; reason: string } }
}).createMachine({})

export type Any = EventFrom<typeof machine> // { type: "GO" } | { type: "STOP"; reason: string }
export type Stop = EventFrom<typeof machine, "STOP"> // { type: "STOP"; reason: string }
```

### ActorsFrom, ActionsFrom, GuardsFrom and DelaysFrom

Each type takes the return value of `setup(...)` and gives one implementation record of that
setup, typed as it is written in the setup config. Any other type, a machine included, gives
`never`.

| Type | Result |
|---|---|
| `ActorsFrom<T>` | The `actors` record. |
| `ActionsFrom<T>` | The `actions` record. |
| `GuardsFrom<T>` | The `guards` record. |
| `DelaysFrom<T>` | The `delays` record. |

The same records are the members `actors`, `actions`, `guards` and `delays` of the setup. See
[setup and setupWithSchema](./setup.md#implementation-records).

```ts
import { fromPromise, setup, type ActionsFrom, type ActorsFrom, type DelaysFrom, type GuardsFrom } from "@jambudipa/xstate-effect"

export const shop = setup({
  actors: { load: fromPromise(() => Promise.resolve(1)) },
  actions: { track: () => {} },
  guards: { isReady: () => true },
  delays: { soon: 100 }
})

export type Actors = ActorsFrom<typeof shop> // { readonly load: PromiseActorLogic<number, …> }
export type Actions = ActionsFrom<typeof shop> // { readonly track: () => void }
export type Guards = GuardsFrom<typeof shop> // { readonly isReady: () => true }
export type Delays = DelaysFrom<typeof shop> // { readonly soon: 100 }
```

### SchemaTypeOr

`SchemaTypeOr<TSchema, TDefault>` gives the decoded type of an Effect Schema
(`Schema.Schema.Type<TSchema>`) when `TSchema` is a schema, and `TDefault` for any other type,
such as `undefined`. `setupWithSchema` uses it for the input and the output types of its
machines: the decoded type of the `input` or `output` schema, or `NonReducibleUnknown` and
`unknown` without one. See [setupWithSchema](./setup.md#setupwithschema).

```ts
import { Schema } from "effect"
import type { NonReducibleUnknown, SchemaTypeOr } from "@jambudipa/xstate-effect"

export const Input = Schema.Struct({ start: Schema.NumberFromString })

export type WithSchema = SchemaTypeOr<typeof Input, NonReducibleUnknown> // { readonly start: number }
export type WithoutSchema = SchemaTypeOr<undefined, NonReducibleUnknown> // NonReducibleUnknown
```

## Actor and logic extractors

### ActorRefFrom

`ActorRefFrom<T>` gives the reference type of an actor logic: an
`ActorRef<TSnapshot, TEvent, TEmitted>` of the snapshot, event and emitted types of the logic. A
`Spawner` returns this type for the logic.

| `T` | Result |
|---|---|
| An actor logic, a machine included | `ActorRef` of its snapshot, events and emitted events. |
| `Promise<TOutput>` | `ActorRefFrom<PromiseActorLogic<TOutput>>`. |
| `AnyActorLogic` or `AnyStateMachine` | `AnyActorRef`, which every reference fits. |
| A function | The result for its return type. |
| Any other type | `never`. |

```ts
import { createMachine, type ActorRefFrom, type AnyStateMachine } from "@jambudipa/xstate-effect"

export const child = createMachine({ types: {} as { events: { type: "PING" } } })

export type ChildRef = ActorRefFrom<typeof child>
export type Context = {
  readonly child?: ChildRef
  readonly other?: ActorRefFrom<AnyStateMachine> // AnyActorRef
}
```

See [Actor references](./actor-refs.md) for the members of a reference.

### ActorRefFromLogic

`ActorRefFromLogic<T extends AnyActorLogic>` gives
`ActorRef<SnapshotOf<T>, EventOf<T>, EmittedOf<T>>`: the same type as `ActorRefFrom<T>` for an
actor logic. A type that is not an actor logic is a type error.

```ts
import { createMachine, type ActorRefFromLogic } from "@jambudipa/xstate-effect"

export const child = createMachine({ types: {} as { events: { type: "PING" } } })

export type ChildRef = ActorRefFromLogic<typeof child>
```

### SnapshotFrom

`SnapshotFrom<T>` gives a snapshot type.

| `T` | Result |
|---|---|
| An actor or an actor reference | Its snapshot type. |
| An actor logic | The snapshot type of the logic. For a machine, it is a `MachineSnapshot`. |
| A function | The result for its return type. |
| Any other type | `never`. |

```ts
import { createMachine, fromPromise, type SnapshotFrom } from "@jambudipa/xstate-effect"

export const machine = createMachine({ context: { count: 0 } })
export const fetchCount = fromPromise(() => Promise.resolve(1))

export const countOf = (snapshot: SnapshotFrom<typeof machine>) => snapshot.context.count
export type FetchSnapshot = SnapshotFrom<typeof fetchCount> // PromiseSnapshot<number, unknown>
```

See [Snapshots](./snapshots.md) for the snapshot members.

### InputFrom

`InputFrom<T>` gives the input type of an actor logic: what the `input` option of `createActor`
takes for it. Any other type gives `never`: an actor reference and a function that returns a
logic both give `never`.

A machine that declares no input gives `unknown`. A `setup(...)` machine without
`types.input` gives `NonReducibleUnknown`.

```ts
import { fromPromise, type InputFrom } from "@jambudipa/xstate-effect"

export const fetchUser = fromPromise(({ input }: { input: { id: string } }) => Promise.resolve(input.id))

export type Input = InputFrom<typeof fetchUser> // { id: string }
```

### OutputFrom

`OutputFrom<T>` gives the output type of an actor logic, an actor or an actor reference: the
type of the output of its done snapshot. Any other type gives `never`.

The snapshot stores the output as an `Option` of this type, so `snapshot.output` is
`Option<OutputFrom<T>>` and `toEffect` succeeds with `Option<OutputFrom<T>>`. A machine that
declares no output gives `unknown`. `fromTransition` logic gives `undefined`.

```ts
import { createMachine, fromPromise, type OutputFrom } from "@jambudipa/xstate-effect"

export const machine = createMachine({ types: {} as { output: number }, output: 42 })
export const fetchName = fromPromise(() => Promise.resolve("Ada"))

export type MachineOutput = OutputFrom<typeof machine> // number
export type FetchOutput = OutputFrom<typeof fetchName> // string
```

### EmittedFrom

`EmittedFrom<TLogic extends AnyActorLogic>` gives the events that an actor logic emits: what
`actor.on` hands to its listeners. A machine without `types.emitted`, and logic that declares no
emitted events, give `EventObject`. A type that is not an actor logic is a type error.

```ts
import { createMachine, type EmittedFrom } from "@jambudipa/xstate-effect"

export const machine = createMachine({ types: {} as { emitted: { type: "saved" } } })

export type Emitted = EmittedFrom<typeof machine> // { type: "saved" }
```

### EventFromLogic

`EventFromLogic<TLogic extends AnyActorLogic>` gives the events that an actor logic takes. It is
the same as `EventFrom<TLogic>` for an actor logic. A type that is not an actor logic is a type
error.

```ts
import { fromTransition, type EventFromLogic } from "@jambudipa/xstate-effect"

export const counter = fromTransition((count: number, _event: { type: "inc" }) => count + 1, 0)

export type CounterEvent = EventFromLogic<typeof counter> // { type: "inc" }
```

### ActorLogicFrom

`ActorLogicFrom<T>` gives an actor logic type.

| `T` | Result |
|---|---|
| A machine | The machine type itself. |
| `Promise<U>` | `PromiseActorLogic<U>`. |
| A function | The result for its return type. |
| Any other type | `never`. Actor logic that is not a machine, such as `fromPromise` logic, also gives `never`. |

```ts
import type { ActorLogicFrom } from "@jambudipa/xstate-effect"

export declare function loadUser(): Promise<{ name: string }>

export type LoadUserLogic = ActorLogicFrom<typeof loadUser> // PromiseActorLogic<{ name: string }>
```

## Machine extractors

### StateFrom

`StateFrom<T extends AnyStateMachine | ((...args: never) => AnyStateMachine)>` gives the snapshot
type of a machine, or of the machine that a function returns. It is the same as `SnapshotFrom`
for these types.

```ts
import { createMachine, type StateFrom } from "@jambudipa/xstate-effect"

export const machine = createMachine({ context: { count: 0 } })

export const isZero = (snapshot: StateFrom<typeof machine>) => snapshot.context.count === 0
```

### StateValueFrom

`StateValueFrom<TMachine extends AnyStateMachine>` gives the values that `snapshot.matches` of the
machine takes.

| `TMachine` | Result |
|---|---|
| A `setup(...).createMachine` machine | The state values of its config: each state key, and each partial object of keys, as deep as the states go. |
| Any other machine | `StateValue`: any state value. |

```ts
import { setup, type StateValueFrom } from "@jambudipa/xstate-effect"

export const machine = setup({}).createMachine({
  initial: "idle",
  states: { idle: {}, busy: { initial: "loading", states: { loading: {} } } }
})

export type Value = StateValueFrom<typeof machine> // "idle" | "busy" | { readonly busy?: "loading" }
export const busy: Value = { busy: "loading" }
```

See [State values](./state-value.md).

### TagsFrom

`TagsFrom<TMachine extends AnyStateMachine>` gives the tags that `snapshot.hasTag` of the machine
takes. A machine whose `types` (or setup `types`) declare `tags` gives those tags. Any other
machine gives `string`.

```ts
import { createMachine, type TagsFrom } from "@jambudipa/xstate-effect"

export const machine = createMachine({
  types: {} as { tags: "loading" | "saving" },
  initial: "busy",
  states: { busy: { tags: ["loading"] } }
})

export const tag: TagsFrom<typeof machine> = "loading"
```

### MachineImplementationsFrom

`MachineImplementationsFrom<T extends AnyStateMachine | ((...args: never) => AnyStateMachine)>`
gives the implementations that `machine.provide` takes: the machine's actions, guards, actors and
delays, each action and guard typed by the machine's context and events.

| `T` | Result |
|---|---|
| A `setup(...).createMachine` machine | The names of the setup. |
| A `createMachine` machine whose `types` declare `actions`, `guards`, `delays` or `actors` | Those names. |
| A `createMachine` machine that declares none | `MachineImplementations<TContext, TEvent>`: any name. |
| A function | The result for the machine it returns. |

```ts
import { assign, createMachine, type MachineImplementationsFrom } from "@jambudipa/xstate-effect"

export const machine = createMachine({ context: { count: 0 } })

export const implementations: MachineImplementationsFrom<typeof machine> = {
  actions: { reset: assign(() => ({ count: 0 })) }
}
```

See [machine.provide](./create-machine.md#machineprovide).

### StateSchemaFrom

`StateSchemaFrom<T extends AnyStateMachine>` gives the state schema of a machine: each node's
`id` and its child states under `states`. A `setup(...).createMachine` machine gives the schema
of its config. Any other machine gives the wide `StateSchema`.

```ts
import { setup, type StateSchemaFrom } from "@jambudipa/xstate-effect"

export const machine = setup({}).createMachine({ id: "door", initial: "closed", states: { closed: {}, open: {} } })

export type Schema = StateSchemaFrom<typeof machine> // { readonly id: "door"; readonly states: { … } }
```

## Requirement extractors

These types give the Effect services (the `R` of an Effect) that a part of a machine needs. A
`setup` machine's requirements are built from them; see
[setup.createMachine](./setup.md#requirements) and [machine.provide](./create-machine.md#machineprovide).
The first four are members of the `Types` namespace only; `SetupRequirements` is a root export.

### EffectRequirementsOf

`Types.EffectRequirementsOf<T>` gives `R` when `T` is an `Effect<A, E, R>`. Any other type gives
`never`, and so does `any`: a mock such as `vi.fn()` returns `any`, which would otherwise require
`unknown`.

### ActionRequirementsOf

`Types.ActionRequirementsOf<TAction>` gives the services that an action needs.

| `TAction` | Result |
|---|---|
| A function | What the Effect that it returns requires; `never` when it returns no Effect. |
| An action definition (an object with `exec`) | What the Effect that its `exec` returns requires. |
| An array of actions | The union of the result for each action. |
| A name, or `{ type, params }` | `never`: the implementation of that name counts where it is given. |

### ConfigRequirementsOf

`Types.ConfigRequirementsOf<TConfig>` gives the services that a machine config needs, as it is
written: the union of `ActionRequirementsOf` for its `entry` and `exit`, for the `actions` of
each transition in `on`, `always`, `after` and `onDone`, of an `initial` object
(`initial: { target, actions }`) and of a `route`, and for the `actions` of an `invoke`'s
`onDone`, `onError` and `onSnapshot`; the requirements of each `invoke` `src` that is actor
logic, not a name; and the result for each state in `states`, at any depth. A `states` record
whose keys are typed as `string` adds nothing.

### ImplementationsRequirementsOf

`Types.ImplementationsRequirementsOf<TImplementations>` gives the services that a set of
implementations needs: `ActionRequirementsOf` of each action in `actions`, and the requirements
of each actor logic in `actors`. Guards and delays add nothing. `machine.provide` adds this type
to the requirements of the machine it gives.

### SetupRequirements

`SetupRequirements<TActions, TActors>` gives the services that the records of a setup need:
`ActionRequirementsOf` of each action in `TActions`, and the requirements of each actor logic in
`TActors`. A record that the setup does not give (its `string`-keyed default) adds nothing.

```ts
import { Context, Effect } from "effect"
import type { Types } from "@jambudipa/xstate-effect"

class Mailer extends Context.Service<Mailer, {
  readonly send: (to: string) => Effect.Effect<void>
}>()("app/Mailer") {}

export const sendWelcome = () =>
  Effect.gen(function* () {
    const mailer = yield* Mailer
    yield* mailer.send("user@example.com")
  })

export type FromEffect = Types.EffectRequirementsOf<ReturnType<typeof sendWelcome>> // Mailer
export type FromAction = Types.ActionRequirementsOf<typeof sendWelcome> // Mailer
export type FromName = Types.ActionRequirementsOf<"sendWelcome"> // never

export type FromConfig = Types.ConfigRequirementsOf<{
  readonly initial: "idle"
  readonly states: { readonly idle: { readonly exit: typeof sendWelcome } }
}> // Mailer

export type FromImplementations = Types.ImplementationsRequirementsOf<{
  readonly actions: { readonly welcome: typeof sendWelcome }
}> // Mailer
```

## General type utilities

The root exports the helper types of XState's `types.ts` with the same names and formulas. They
hold no machine or actor type. Where XState writes `any`, the definition below writes `any` too.

| Type | Definition | Example | Result |
|---|---|---|---|
| `AnyFunction` | `(...args: Array<any>) => any` | — | Any function. |
| `Cast<A, B>` | `A extends B ? A : B` | `Cast<"a", string>` | `"a"` |
| `Compute<A>` | `{ [K in keyof A]: A[K] } & unknown` | `Compute<{ a: 1 } & { b: 2 }>` | `{ a: 1; b: 2 }` |
| `ConditionalRequired<T, Condition extends boolean>` | `Condition extends true ? Required<T> : T` | `ConditionalRequired<{ a?: 1 }, true>` | `{ a: 1 }` |
| `DoNotInfer<T>` | `T`, at a position where TypeScript does not infer `T` | See the example below | — |
| `Elements<T>` | `` T[keyof T & `${number}`] `` | `Elements<[1, "x"]>` | `1 \| "x"` |
| `Equals<A1, A2>` | `true` when the two types are identical, else `false` | `Equals<1, 1 \| 2>` | `false` |
| `GetConcreteByKey<T, TKey extends keyof T, TValue extends T[TKey]>` | `T & Record<TKey, TValue>` | `GetConcreteByKey<{ kind: "x" \| "y" }, "kind", "x">` | `{ kind: "x" \| "y" } & Record<"kind", "x">` |
| `HomomorphicOmit<T, K extends PropertyKey>` | `Omit` that keeps the `readonly` and `?` modifiers | `HomomorphicOmit<{ readonly a?: 1; b: 2 }, "b">` | `{ readonly a?: 1 }` |
| `HomomorphicPick<T, K extends PropertyKey>` | `Pick` that keeps the `readonly` and `?` modifiers | `HomomorphicPick<{ readonly a?: 1; b: 2 }, "a">` | `{ readonly a?: 1 }` |
| `Identity<T>` | `{ [K in keyof T]: T[K] }` | `Identity<{ a: 1 } & { b: 2 }>` | `{ a: 1; b: 2 }` |
| `IndexByProp<T extends Record<P, string>, P extends keyof T>` | The members of the union `T`, keyed by their property `P` | `IndexByProp<{ kind: "x" } \| { kind: "y" }, "kind">` | `{ x: { kind: "x" }; y: { kind: "y" } }` |
| `IndexByType<T extends { type: string }>` | `IndexByProp<T, "type">` | `IndexByType<{ type: "A" } \| { type: "B" }>` | `{ A: { type: "A" }; B: { type: "B" } }` |
| `InferEvent<E extends EventObject>` | Each member of the event union `E`, intersected with `{ type: <its literal type> }` | `InferEvent<{ type: "A" } \| { type: "B" }>` | One member for `"A"` and one for `"B"` |
| `Invert<T extends Record<PropertyKey, PropertyKey>>` | The record with its keys and values swapped | `Invert<{ a: "x"; b: "y" }>` | `{ x: "a"; y: "b" }` |
| `IsAny<T>` | `Equals<T, any>` | `IsAny<unknown>` | `false` |
| `IsLiteralString<T extends string>` | `string extends T ? false : true` | `IsLiteralString<string>` | `false` |
| `IsNever<T>` | `[T] extends [never] ? true : false` | `IsNever<never>` | `true` |
| `IsNotNever<T>` | `[T] extends [never] ? false : true` | `IsNotNever<string>` | `true` |
| `Lazy<T>` | `() => T` | `Lazy<number>` | `() => number` |
| `LowInfer<T>` | `T & NonNullable<unknown>`: an inference site of lower priority | — | — |
| `MaybeLazy<T>` | `T \| Lazy<T>` | `MaybeLazy<number>` | `number \| (() => number)` |
| `Merge<M, N>` | `Omit<M, keyof N> & N` | `Merge<{ a: 1; b: 2 }, { b: "x" }>` | `a: 1` and `b: "x"` |
| `MetaObject` | `Record<string, any>` | — | The type of a meta object. |
| `NoInfer<T>` | `DoNotInfer<T>` | — | Not TypeScript's own `NoInfer`. An import of this name hides the built-in type in that file. |
| `NonReducibleUnknown` | `NonNullable<unknown> \| null \| undefined` | `string \| NonReducibleUnknown` | Stays a union: unlike `unknown`, it does not absorb the other members. |
| `Prop<T, K>` | `K extends keyof T ? T[K] : never` | `Prop<{ a: 1 }, "b">` | `never` |
| `SingleOrArray<T>` | `ReadonlyArray<T> \| T` | `SingleOrArray<number>` | `number \| ReadonlyArray<number>` |
| `TODO` | `any` | — | A type that XState has not written yet. |
| `Values<T>` | `T[keyof T]` | `Values<{ a: 1; b: "x" }>` | `1 \| "x"` |

```ts
import type { Compute, DoNotInfer, IndexByType, IsNever, SingleOrArray } from "@jambudipa/xstate-effect"

type CartEvent = { type: "add"; amount: number } | { type: "clear" }

export type ByType = IndexByType<CartEvent> // { add: { type: "add"; amount: number }; clear: { type: "clear" } }
export type Flat = Compute<{ a: 1 } & { b: 2 }> // { a: 1; b: 2 }
export type NoEvents = IsNever<never> // true
export type Targets = SingleOrArray<string> // string | ReadonlyArray<string>

// `T` comes from `values` only: `pick(["a", "b"], "c")` is a type error
export declare function pick<T extends string>(values: ReadonlyArray<T>, fallback: DoNotInfer<T>): T
```

## The Types namespace

The root also exports `Types`, the namespace of the module that defines most machine and actor
types. The extractors from `ActorRefFrom` to `StateSchemaFrom` on this page are also its members,
for example `Types.SnapshotFrom`. `EffectRequirementsOf`, `ActionRequirementsOf`,
`ConfigRequirementsOf` and `ImplementationsRequirementsOf` are members of `Types` only: the root
does not export them by name. The setup extractors (`ContextFrom`, `EventFrom`, `ActorsFrom`,
`ActionsFrom`, `GuardsFrom`, `DelaysFrom` and `SchemaTypeOr`), `SetupRequirements` and the
general type utilities are not members of `Types`.

```ts
import { createMachine, type Types } from "@jambudipa/xstate-effect"

export const machine = createMachine({ context: { count: 0 } })

export type Snapshot = Types.SnapshotFrom<typeof machine>
```

## Related pages

- [setup and setupWithSchema](./setup.md)
- [createMachine and the machine](./create-machine.md): the `StateMachine.StateMachine.ContextOf`
  family of extractors
- [createActor and the actor](./create-actor.md): the `Actor.Actor.SnapshotOf` family of
  extractors
- [Actor references](./actor-refs.md)
- [XState type names](./upstream-type-names.md)
- [How to type a machine's context, events, input and output](../how-to/define-custom-types.md)
