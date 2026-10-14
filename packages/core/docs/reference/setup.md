---
title: setup and setupWithSchema
doc-type: reference
sources: [packages/core/src/setup.ts, packages/core/src/StateMachine.ts, packages/core/src/Types.ts]
---

# setup and setupWithSchema

> **TL;DR:** `setup(config)` declares a machine's types and its named actors, actions, guards and
> delays once, and returns a factory whose `createMachine` builds machines checked against them.
> `setupWithSchema(config)` does the same with Effect Schemas for the context, the events and,
> optionally, the input and the output; its machines check those values at run time, and it adds
> validators. A setup machine's Effect requirements are the services that its actions' Effects
> and its actors need, named in the setup or written inline in the config, so `createActor` of
> that machine requires them. `action`, `guard` and `when` build action and guard definitions.

All the items below are exported from `@jambudipa/xstate-effect`. For the machine that
`createMachine` returns, see [createMachine and the machine](./create-machine.md).

## Summary

| Item | Kind | Description |
|---|---|---|
| [`setup`](#setup) | function | Declares the types and implementations of a family of machines. |
| [`setupWithSchema`](#setupwithschema) | function | `setup` with Effect Schemas for the context, the events, the input and the output, checked at run time. |
| [`createMachine`](#setupcreatemachine) | `SetupReturn` member | Builds a machine of the setup. |
| [`extend`](#setupextend) | `SetupReturn` member | A new setup with more actions, guards and delays. |
| [`createStateConfig`](#setupcreatestateconfig) | `SetupReturn` member | Types a state config by the setup. |
| [`createAction`](#setupcreateaction) | `SetupReturn` member | Types an action by the setup. |
| [Bound action creators](#bound-action-creators) | `SetupReturn` members | `assign`, `raise`, `sendTo`, `log`, `cancel`, `stopChild`, `enqueueActions`, `emit`, `spawnChild`, typed by the setup. |
| [Implementation records](#implementation-records) | `SetupReturn` members | `actors`, `actions`, `guards`, `delays`. |
| [Schema setup members](#schema-setup-members) | `SetupSchemaReturn` members | `contextSchema`, `eventSchema`, `validateContext`, `validateEvent`. |
| [`action`](#action) | function | Builds an action definition from an Effect. |
| [`guard`](#guard) | function | Builds a guard definition from an Effect predicate. |
| [`when`](#when) | function | Builds a guard definition from a synchronous predicate. |

## setup

Declares the types of a family of machines and their named implementations. The returned
`SetupReturn` builds machines of those types.

### Signature

```ts
import type {
  AnyActorLogic,
  AnyEventObject,
  DelayConfig,
  EventObject,
  GuardImplementation,
  NonReducibleUnknown,
  SetupActionImplementation,
  SetupChildrenActors,
  SetupConfig,
  SetupReturn
} from "@jambudipa/xstate-effect"

// Simplified: the action constraint also carries the names that a built-in action written in
// the `actions` record may use, and one more type parameter holds that record's own names
export declare function setup<
  TContext,
  TEvent extends EventObject = AnyEventObject,
  const TActors extends Record<string, AnyActorLogic> = Record<string, never>,
  const TActions extends Record<string, SetupActionImplementation<TContext, TEvent>> =
    Record<string, SetupActionImplementation<TContext, TEvent>>,
  const TGuards extends Record<string, GuardImplementation<TContext, TEvent>> =
    Record<string, GuardImplementation<TContext, TEvent>>,
  const TDelays extends Record<string, DelayConfig<TContext, TEvent>> = Record<string, DelayConfig<TContext, TEvent>>,
  TStateMeta = unknown,
  TTransitionMeta = TStateMeta,
  TInput = NonReducibleUnknown,
  TEmitted extends EventObject = EventObject,
  TChildrenMap extends Record<string, string> = Record<never, never>,
  TTag extends string = string,
  TOutput = unknown
>(
  config: SetupConfig<
    TContext, TEvent, TActors, TActions, TGuards, TDelays,
    TStateMeta, TTransitionMeta, TInput, TEmitted, TChildrenMap, TTag, TOutput
  > & SetupChildrenActors<TChildrenMap>
): SetupReturn<
  TContext, TEvent, TActors, TActions, TGuards, TDelays,
  TStateMeta, TTransitionMeta, TInput, TEmitted, TChildrenMap, TTag, TOutput
>
```

### Parameters

Every member of `config` is optional.

| Member | Type | Description |
|---|---|---|
| `types` | object, written `{} as { ... }` | The phantom types of the setup's machines; see the next table. `setup` reads none of its values. |
| `actors` | `Record<string, AnyActorLogic>` | The actor logic by name, which a config may invoke or spawn by its `src` name. |
| `actions` | `Record<string, SetupActionImplementation>` | The actions by name: plain functions `({ context, event, self, system }, params) => unknown`, or action definitions. A built-in action written here may name a sibling action and the setup's guards, delays and actors. |
| `guards` | `Record<string, GuardImplementation>` | The guards by name. A built-in `not`, `and` or `or` written here names only guards of this record. |
| `delays` | `Record<string, DelayConfig>` | The delays by name: milliseconds, a `Duration`, or a function of the action arguments and the params of the use. |
| `schemas` | `unknown` | Carried as given by each machine of the setup, as `machine.schemas`. |

### The `types` member

| Member | Declares | Without it |
|---|---|---|
| `context` | The context type of each machine. | `unknown` |
| `events` | The union of the events that each machine takes. | `AnyEventObject` |
| `input` | What the context factory and the `input` option of `createActor` take. | `NonReducibleUnknown` |
| `output` | The type of the snapshots' `output` and of the done event's `output`. The machine's `output` must give a value of this type. | `unknown` |
| `emitted` | The events that `emit` and `enqueue.emit` take, and that `actor.on` listeners receive. | any event object |
| `children` | Each child id with the name of the actor that it runs. The snapshots type the child under that id, and `actors` must give every named actor. | no declared ids |
| `meta` | The type of each state node's `meta`, and of each transition's `meta` when `transitionMeta` is absent. | `unknown` |
| `transitionMeta` | The type of each transition's `meta`. | `meta` |
| `tags` | The tags that the state configs may set and that `snapshot.hasTag` takes. | `string` |

### Returns

A `SetupReturn`: the [`createMachine`](#setupcreatemachine), [`extend`](#setupextend),
[`createStateConfig`](#setupcreatestateconfig) and [`createAction`](#setupcreateaction)
members, the [bound action creators](#bound-action-creators) and the
[implementation records](#implementation-records).

### Errors

`setup` does not fail at run time. The type checker rejects a `types.children` entry whose actor
is not in `actors`, and a built-in guard in `guards` that names a guard outside the record.

### Example

```ts
import { assign, setup } from "@jambudipa/xstate-effect"

export const counterSetup = setup({
  types: {} as {
    context: { count: number; max: number }
    events: { type: "INC" } | { type: "RESET" }
    output: number
  },
  actions: {
    increment: assign({ count: ({ context }) => context.count + 1 }),
    log: ({ context }) => console.log(`count: ${context.count}`)
  },
  guards: {
    belowMax: ({ context }) => context.count < context.max
  },
  delays: {
    idle: 5000
  }
})
```

## setupWithSchema

Declares the context, the events and, optionally, the input and the output of a family of
machines with Effect Schemas: the decoded type of each schema is that type. Each machine checks
those values against the types at run time (see [Run-time checks](#run-time-checks)). The
returned setup also holds the schemas and validators for them.

### Signature

```ts
import type { Schema } from "effect"
import type {
  AnyActorLogic,
  DelayConfig,
  EventObject,
  GuardImplementation,
  NonReducibleUnknown,
  SchemaTypeOr,
  SetupActionImplementation,
  SetupSchemaConfig,
  SetupSchemaReturn
} from "@jambudipa/xstate-effect"

type ContextOf<S extends Schema.Decoder<unknown>> = Schema.Schema.Type<S>
type EventOf<S extends Schema.Decoder<unknown>> = Schema.Schema.Type<S> & EventObject

export declare function setupWithSchema<
  TContextSchema extends Schema.Decoder<unknown>,
  TEventSchema extends Schema.Decoder<unknown>,
  const TActors extends Record<string, AnyActorLogic> = Record<string, never>,
  const TActions extends Record<string, SetupActionImplementation<ContextOf<TContextSchema>, EventOf<TEventSchema>>> =
    Record<string, SetupActionImplementation<ContextOf<TContextSchema>, EventOf<TEventSchema>>>,
  const TGuards extends Record<string, GuardImplementation<ContextOf<TContextSchema>, EventOf<TEventSchema>>> =
    Record<string, GuardImplementation<ContextOf<TContextSchema>, EventOf<TEventSchema>>>,
  const TDelays extends Record<string, DelayConfig<ContextOf<TContextSchema>, EventOf<TEventSchema>>> =
    Record<string, DelayConfig<ContextOf<TContextSchema>, EventOf<TEventSchema>>>,
  TInputSchema extends Schema.Decoder<unknown> | undefined = undefined,
  TOutputSchema extends Schema.Decoder<unknown> | undefined = undefined
>(
  config: SetupSchemaConfig<TContextSchema, TEventSchema, TActors, TActions, TGuards, TDelays, TInputSchema, TOutputSchema>
): SetupSchemaReturn<
  ContextOf<TContextSchema>, EventOf<TEventSchema>, TContextSchema, TEventSchema,
  TActors, TActions, TGuards, TDelays,
  SchemaTypeOr<TInputSchema, NonReducibleUnknown>, SchemaTypeOr<TOutputSchema, unknown>
>
```

### Parameters

| Member of `config` | Type | Required | Description |
|---|---|---|---|
| `context` | `Schema.Decoder<unknown>` | yes | The context schema. Its decoded type is the context type. |
| `events` | `Schema.Decoder<unknown>` | yes | The event schema, usually a `Schema.Union` of `Schema.Struct`s with a literal `type`. Its decoded type is the event type. |
| `input` | `Schema.Decoder<unknown>` | no | The input schema. Its decoded type is the input type: what the context factory and the `input` option of `createActor` take. Without it, the input type is `NonReducibleUnknown` and the input is not checked. |
| `output` | `Schema.Decoder<unknown>` | no | The output schema. Its decoded type is the output type: what the config's `output` gives, and the value in `snapshot.output` and in the done event's `output`. Without it, the output type is `unknown` and the output is not checked. |
| `actors` | `Record<string, AnyActorLogic>` | no | As for [`setup`](#setup). |
| `actions` | `Record<string, SetupActionImplementation>` | no | As for `setup`, typed by the decoded context and events. |
| `guards` | `Record<string, GuardImplementation>` | no | As for `setup`, typed by the decoded context and events. |
| `delays` | `Record<string, DelayConfig>` | no | As for `setup`. |

`setupWithSchema` takes no `types` and no `schemas` member. Its machines have the input type
`SchemaTypeOr<TInputSchema, NonReducibleUnknown>`, the output type
`SchemaTypeOr<TOutputSchema, unknown>`, any emitted event, any tag, and the meta types `unknown`.

### Run-time checks

Each machine that the setup creates checks these values against the decoded type of their
schema (`Schema.toType` of the schema). A transforming schema, such as `Schema.NumberFromString`,
checks its decoded side: the machine holds decoded values.

| Value | When it is checked |
|---|---|
| An event | Before each transition, for each event that the actor receives, except the built-in `xstate.*` events (`xstate.init`, the done and error events of children and states, the events of delayed transitions). An event of a type that the schema does not have fails too. |
| The context | In the initial snapshot, and in each snapshot that a transition gives. |
| The input | When the initial snapshot is computed, before the context factory reads it. Only with an `input` schema. |
| The output | In each snapshot with the status `done`. Only with an `output` schema. |
| A restored snapshot | When the machine restores a snapshot (`createActor` with the `snapshot` option, or `machine.restoreSnapshot`): its context, and the output of a `done` one. A mismatch fails the restore with a `RestoreError` whose `cause` is the `SchemaError`, so the actor gets the status `error`. |

These are not checked:

- An event that an action raises without a delay: the macrostep processes it inside the
  transition. The context that it leads to is checked.
- The snapshot that `machine.resolveState` gives.
- The snapshots that `machine.microstep` gives: it checks the event only.

`provide`, `withContext` and `withId` give machines with the same checks; `extend` gives a setup
whose machines have them.

### Returns

A `SetupSchemaReturn`: the members of `SetupReturn`, whose `extend` gives a `SetupSchemaReturn`
that keeps the schemas, the validators and the run-time checks, and the
[schema setup members](#schema-setup-members).

### Errors

`setupWithSchema` does not fail. A value that does not match its schema fails as user code that
throws the `SchemaError` would:

| Where | Result |
|---|---|
| A transition of an actor | The transition dies with the `SchemaError`. The actor gets the status `error`, with the `SchemaError` in `snapshot.error`, and keeps the snapshot it had before the event: its state value and its context. It processes no more events. Its parent receives an `xstate.error.actor.*` event; an actor without a parent logs the error. |
| The initial snapshot (the input, or the initial context or output) | The initial snapshot has the status `error`, with the `SchemaError` as its `error`. |
| `machine.transition`, `machine.microstep` and the pure transition functions | The Effect dies with the `SchemaError`. |

`validateContext` and `validateEvent` decode values on request and fail with a typed
`SchemaError`; see [Schema setup members](#schema-setup-members).

### Example

```ts
import { Schema } from "effect"
import { assign, setupWithSchema } from "@jambudipa/xstate-effect"

const Context = Schema.Struct({ count: Schema.Number })

const Events = Schema.Union([
  Schema.Struct({ type: Schema.Literal("INCREMENT"), value: Schema.Number }),
  Schema.Struct({ type: Schema.Literal("RESET") }),
  Schema.Struct({ type: Schema.Literal("STOP") })
])

export const counterSetup = setupWithSchema({
  context: Context,
  events: Events,
  input: Schema.Struct({ start: Schema.Number }),
  output: Schema.Number,
  guards: {
    isPositive: ({ context }) => context.count > 0
  }
})

// The input type is { readonly start: number }, and the output type is number
export const counter = counterSetup.createMachine({
  context: ({ input }) => ({ count: input.start }),
  initial: "counting",
  states: {
    counting: {
      on: {
        INCREMENT: { actions: assign({ count: ({ context, event }) => context.count + event.value }) },
        RESET: { guard: "isPositive", actions: assign({ count: 0 }) },
        STOP: "stopped"
      }
    },
    stopped: { type: "final" }
  },
  output: ({ context }) => context.count
})
```

## setup.createMachine

Builds a machine of the setup: the setup's records become the machine's implementations.

### Signature

`createMachine<TConfig>(config: SetupMachineConfig<…> & TConfig): SetupMachine<…>`

`SetupMachine` is a [`StateMachine.StateMachine`](./create-machine.md#the-machine) with these
type parameters:

| Machine type parameter | Value |
|---|---|
| `TContext` | `types.context` |
| `TEvent` | `types.events`, and the `xstate.route` event when the config has routable states |
| `TInput` | `types.input` |
| `TOutput` | `types.output` |
| `TEmitted` | `types.emitted` |
| `R` | `SetupRequirements<TActions, TActors> \| Types.ConfigRequirementsOf<TConfig>`: the services of the setup's actions and actor logic, and of the config's inline actions and inline actor logic; see [Requirements](#requirements) |
| `TStateMeta`, `TTransitionMeta` | `types.meta`, `types.transitionMeta` |
| `TStateSchema` | The state keys and ids of the config as written |
| `TProvided` | `SetupProvideImplementations`: only the setup's names, each with the type of the setup's implementation |
| `TStateValue` | The state value of the config as written |
| `TChildren` | `SetupChildren`: the setup's actors under the ids of `types.children`, or of the config's root `invoke` entries |
| `TTag` | `types.tags` |

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `config` | the [machine config](./create-machine.md#machine-config) without `types` | The machine config. It names only the setup's implementations. |

The type checker applies these rules to the config:

- An action or guard name is one of the setup's. A name stands alone only when its params may be
  `undefined`; otherwise the config writes `{ type, params }` with params of its type.
- An `after` key is one of the setup's delay names, or a number.
- An `invoke` `src` is one of the setup's actor names, or actor logic. A setup without an
  `actors` record takes no `invoke`. Inline logic takes no `id`, and its `onDone` gives
  `event.output` as an `Option` of `unknown`, as in XState. An inline action under that `onDone`
  is typed for each invocation the setup allows, so one that reads `event.output` does not
  compile (XState gives the same error). To type the output, name the logic in `actors` and
  invoke it by its name.
- With `types.emitted`, `emit` and `enqueue.emit` take only those events.
- A setup without a record takes no name of that kind.

### Returns

The machine. Its `schemas` is the setup's `schemas`, which replaces the config's own:
`undefined` when the setup gives none. A machine of `setupWithSchema` keeps the config's own
`schemas`, and has the [run-time checks](#run-time-checks).

### Requirements

The machine's `R` is the union of these services:

- What the Effect that each action of `setup({ actions })` returns requires (for an action
  definition, the Effect of its `exec`), and the requirements of each actor logic of
  `setup({ actors })` (`SetupRequirements<TActions, TActors>`).
- What the Effects of the config's inline actions require: `entry`, `exit`, and the `actions` of
  the `on`, `always`, `after` and `onDone` transitions, of an `initial` object
  (`initial: { target, actions }`), of a `route`, and of an `invoke`'s `onDone`, `onError` and
  `onSnapshot`, in every state (`Types.ConfigRequirementsOf<TConfig>`).
- The requirements of inline actor logic in an `invoke`, such as `src: fromEffect(...)`.

An action that the config names, by a string or as `{ type, params }`, counts through the
setup's record. The actions that `enqueueActions` enqueues at run time add nothing. A guard
cannot need a service: its Effect has the type `Effect<boolean>`, so one that needs a service is
a type error. [`machine.provide`](./create-machine.md#machineprovide) adds the services of the
implementations that it is given.

```ts
import { Context, Effect, type Scope } from "effect"
import { createActor, setup } from "@jambudipa/xstate-effect"

class Audit extends Context.Service<Audit, {
  readonly record: (entry: string) => Effect.Effect<void>
}>()("app/Audit") {}

const door = setup({ types: {} as { events: { type: "CLOSE" } } }).createMachine({
  initial: "open",
  states: {
    open: {
      on: {
        CLOSE: {
          target: "closed",
          // An inline action: the services of its Effect count too
          actions: () =>
            Effect.gen(function* () {
              const audit = yield* Audit
              yield* audit.record("closed")
            })
        }
      }
    },
    closed: {}
  }
})

export const created: Effect.Effect<unknown, never, Scope.Scope | Audit> = createActor(door)
```

### Errors

The definition errors of [`createMachine`](./create-machine.md#createmachine). `createActor` of
the machine returns `Effect<Actor, never, Scope | R>`: the caller provides each service in `R`.

### Example

```ts
import { Context, Effect } from "effect"
import { createActor, setup } from "@jambudipa/xstate-effect"

class Greeter extends Context.Service<Greeter, { readonly greet: (name: string) => string }>()("app/Greeter") {}

export const greeter = setup({
  actions: {
    hello: () =>
      Effect.gen(function* () {
        const service = yield* Greeter
        yield* Effect.log(service.greet("Ada"))
      })
  }
}).createMachine({ entry: "hello" })

// createActor(greeter) needs Scope | Greeter
const program = Effect.gen(function* () {
  const actor = yield* createActor(greeter)
  yield* actor.start
})

void Effect.runPromise(
  program.pipe(
    Effect.provideService(Greeter, { greet: (name) => `Hello, ${name}` }),
    Effect.scoped
  )
)
```

## setup.extend

A new setup with the same types, schemas and actors. Its actions, guards and delays are this
setup's with the extension's added: `{ ...base, ...extension }` for each record, so an
extension wins over a base implementation of the same name. The original setup does not change.

### Signature

`extend(extension: SetupExtension<TExtendActions, TExtendGuards, TExtendDelays>): SetupReturn<…, MergedImplementations<TActions, TExtendActions>, MergedImplementations<TGuards, TExtendGuards>, MergedImplementations<TDelays, TExtendDelays>, …>`

### Parameters

| Member of `extension` | Type | Description |
|---|---|---|
| `actions` | `Record<string, SetupActionImplementation>` | The actions to add. A built-in action written here may name the base's actions, the record's own actions, and the guards and delays of both. |
| `guards` | `Record<string, GuardImplementation>` | The guards to add. A built-in guard here names only guards of the base and of this record. |
| `delays` | `Record<string, DelayConfig>` | The delays to add. |

### Returns

A `SetupReturn` with the merged records; for a schema setup, a `SetupSchemaReturn` that keeps
the schemas, the validators and the run-time checks.

### Example

```ts
import { setup } from "@jambudipa/xstate-effect"

const base = setup({ actions: { track: () => console.log("track") } })

export const extended = base.extend({
  guards: { isReady: () => true },
  delays: { soon: 100 }
})

export const machine = extended.createMachine({ entry: "track", on: { GO: { guard: "isReady" } } })
```

## setup.createStateConfig

Gives a state config back, typed by the setup, so a state can be written apart from the machine
that uses it.

### Signature

`createStateConfig<const TStateConfig extends StateNodeConfig<TContext, TEvent, TStateMeta, TTransitionMeta, SetupNames<…>>>(config: TStateConfig): TStateConfig`

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `config` | `StateNodeConfig` with the setup's names | A [state node config](./create-machine.md#state-node-members). |

### Returns

The same config object, with its literal type.

### Example

```ts
import { setup } from "@jambudipa/xstate-effect"

const lights = setup({ actions: { note: () => console.log("note") } })

const green = lights.createStateConfig({ on: { TIMER: { target: "yellow", actions: "note" } } })

export const machine = lights.createMachine({ initial: "green", states: { green, yellow: {} } })
```

## setup.createAction

Gives an action back, typed by the setup: an inline function of
`({ context, event, self, system }, params)`, or a built-in action.

### Signature

`createAction<const TAction extends SetupAction<TContext, TEvent>>(action: TAction): TAction`

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `action` | `SetupAction<TContext, TEvent>`: an `ActionFunction` or an `ActionDefinition` | The action. |

### Returns

The same action, with its literal type.

### Example

```ts
import { setup } from "@jambudipa/xstate-effect"

const counter = setup({ types: {} as { context: { count: number } } })

const report = counter.createAction(({ context }) => console.log(context.count))

export const machine = counter.createMachine({ context: { count: 0 }, entry: report })
```

## Bound action creators

Each member is the built-in action of the same name with the setup's context and events: its
callbacks need no type annotations, and its arguments are checked against the setup's types. In
the signatures, `TNames` is the setup's names (`SetupNames`): a delay name, an actor name, an
emitted event and a name that `enqueueActions` enqueues or checks must be one of the setup's.

| Member | Signature | Module function |
|---|---|---|
| `assign` | `assign<TParams = undefined>(assignment: Assignment<TContext, TEvent, TParams>)` | [`assign`](./actions/assign.md) |
| `raise` | `raise(event: RaiseEvent<TContext, TEvent, TEvent>, options?: RaiseOptions<TContext, TEvent, TNames["delays"]>)`; the raised event is one of the setup's events | [`raise`](./actions/raise.md) |
| `sendTo` | `sendTo(target: SendToTarget<TContext, TEvent, TTarget>, event: SendToTargetEvent<TContext, TEvent, TTarget, TSentEvent>, options?: SendToOptions<TContext, TEvent, TNames["delays"]>)` | [`sendTo`](./actions/send-to.md) |
| `log` | `log(value?: LogMessage<TContext, TEvent>, labelOrOptions?: string \| LogOptions)` | [`log`](./actions/log.md) |
| `cancel` | `cancel(id: CancelId<TContext, TEvent>)` | [`cancel`](./actions/cancel.md) |
| `stopChild` | `stopChild(child: StopChildTarget<TContext, TEvent>)` | [`stopChild`](./actions/stop-child.md) |
| `enqueueActions` | `enqueueActions<TParams = void>(collect: CollectActions<TContext, TEvent, TParams, TNames>)` | [`enqueueActions`](./actions/enqueue-actions.md) |
| `emit` | `emit(event: EmitEvent<TContext, TEvent, TNames["emitted"]>)`; the event is one of `types.emitted`, or any event object when the setup declares none | [`emit`](./actions/emit.md) |
| `spawnChild` | `spawnChild(...args: SpawnChildArguments<TContext, TEvent, TLogic, TNames>)`: the name of one of the setup's actors, with an id that `types.children` gives it and its logic's input, or actor logic | [`spawnChild`](./actions/spawn-child.md) |

Each member returns an `ActionDefinition` of the setup's context and events; `enqueueActions`
returns an `EnqueueActionsDefinition`.

### Example

```ts
import { setup } from "@jambudipa/xstate-effect"

const counter = setup({
  types: {} as {
    context: { count: number }
    events: { type: "INC" } | { type: "CHECK" }
  }
})

export const machine = counter.createMachine({
  context: { count: 0 },
  on: {
    INC: { actions: [counter.assign({ count: ({ context }) => context.count + 1 }), counter.raise({ type: "CHECK" })] },
    CHECK: { actions: counter.log(({ context }) => `count: ${context.count}`) }
  }
})
```

## Implementation records

| Member | Type | Description |
|---|---|---|
| `actors` | `TActors` | The `actors` record as given; `{}` when the config has none. `extend` keeps it. |
| `actions` | `TActions` | The `actions` record; `{}` when the config has none. |
| `guards` | `TGuards` | The `guards` record; `{}` when the config has none. |
| `delays` | `TDelays` | The `delays` record; `{}` when the config has none. |

### Example

```ts
import { setup } from "@jambudipa/xstate-effect"

const timers = setup({ delays: { short: 100, long: 1000 } })

export const delayNames = Object.keys(timers.delays) // ["short", "long"]
```

## Schema setup members

The members that `setupWithSchema` adds to the setup.

| Member | Type | Description |
|---|---|---|
| `contextSchema` | `TContextSchema` | The `context` schema as given. |
| `eventSchema` | `TEventSchema` | The `events` schema as given. |
| `validateContext` | `(value: unknown) => Effect<TContext, Schema.SchemaError>` | Decodes a value with the context schema, from its encoded form to the decoded context. |
| `validateEvent` | `(value: unknown) => Effect<TEvent, Schema.SchemaError>` | Decodes a value with the event schema, from its encoded form to the decoded event. |

The validators decode, so a transforming schema turns the encoded form of data from outside
into the decoded form; the [run-time checks](#run-time-checks) of the machines accept only the
decoded form. Decode data from outside with `validateEvent` before `send`: a `SchemaError` there
is a typed failure that you can handle, but an event that fails the machine's check gives the
actor the status `error`.

### Errors

| Error | When |
|---|---|
| `Schema.SchemaError` | The value does not decode with the schema. |

### Example

```ts
import { Effect, Schema } from "effect"
import { setupWithSchema } from "@jambudipa/xstate-effect"

const counterSetup = setupWithSchema({
  context: Schema.Struct({ count: Schema.Number }),
  events: Schema.Struct({ type: Schema.Literal("RESET") })
})

export const checked = Effect.gen(function* () {
  const event = yield* counterSetup.validateEvent({ type: "RESET" })
  const failure = yield* Effect.flip(counterSetup.validateContext({ count: "zero" }))
  return [event.type, failure.message] as const
})
```

## action

Builds an action definition whose `exec` returns an Effect of an `ActionResult`, which the engine
carries out.

### Signature

```ts
import type { Effect } from "effect"
import type { ActionContext, ActionDefinition, ActionResult, EventObject } from "@jambudipa/xstate-effect"

export declare function action<TContext, TEvent extends EventObject, TParams = void, R = never>(
  type: string,
  exec: (ctx: ActionContext<TContext, TEvent>, params: TParams) => Effect.Effect<ActionResult, never, R>
): ActionDefinition<TContext, TEvent, TParams, R>
```

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `type` | `string` | The action's name, as the definition and the JSON form show it. The engine never looks it up. |
| `exec` | `(ctx, params) => Effect<ActionResult, never, R>` | Runs once for each use. `ctx` holds `context`, `event`, `self`, `system`, `children`, `defer`, `emit`, `spawn`, `stopChild`, `evaluateGuard` and `resolveDelay`. |

The `ActionResult` constructors are in `Types.ActionResult`: `NoOp`, `ContextUpdate` (the whole
new context), `SpawnChild`, `StopChild`, `SendEvent`, `RaiseEvent`, `EmitEvent`, `Cancel`,
`Log` and `Enqueued`.

### Returns

An `ActionDefinition<TContext, TEvent, TParams, R>` with the given `type` and `exec`.

### Errors

A failure or a defect of the Effect at run time stops the macrostep, and the actor gets the
status `error`.

### Example

```ts
import { Effect } from "effect"
import { Types, action, createMachine } from "@jambudipa/xstate-effect"

type Context = { count: number }
type Event = { type: "INC" }

const increment = action<Context, Event>("increment", ({ context }) =>
  Effect.succeed(Types.ActionResult.ContextUpdate({ ...context, count: context.count + 1 }))
)

export const machine = createMachine({
  types: {} as { context: Context; events: Event },
  context: { count: 0 },
  on: { INC: { actions: increment } }
})
```

## guard

Builds a guard definition whose predicate returns an `Effect<boolean>`.

### Signature

```ts
import type { Effect } from "effect"
import type { EventObject, GuardContext, GuardDefinition } from "@jambudipa/xstate-effect"

export declare function guard<TContext, TEvent extends EventObject, TParams = void>(
  type: string,
  predicate: (ctx: GuardContext<TContext, TEvent>, params: TParams) => Effect.Effect<boolean>
): GuardDefinition<TContext, TEvent, TParams>
```

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `type` | `string` | The guard's name, as the JSON form shows it. The evaluator never looks it up. |
| `predicate` | `(ctx, params) => Effect<boolean>` | Decides the guard. `ctx` holds `context`, `event`, `self`, `system`, and optionally `implementations` and `snapshot`. |

### Returns

A `GuardDefinition<TContext, TEvent, TParams>` with the given `type` and `predicate`.

### Example

```ts
import { Effect } from "effect"
import { createMachine, guard } from "@jambudipa/xstate-effect"

type Context = { ready: boolean }
type Event = { type: "SUBMIT" }

const isReady = guard<Context, Event>("isReady", ({ context }) => Effect.succeed(context.ready))

export const machine = createMachine({
  types: {} as { context: Context; events: Event },
  context: { ready: false },
  initial: "editing",
  states: {
    editing: { on: { SUBMIT: { guard: isReady, target: "sent" } } },
    sent: {}
  }
})
```

## when

Builds a guard definition from a synchronous predicate. Its `type` is `"xstate.when"`.

### Signature

```ts
import type { EventObject, GuardContext, GuardDefinition } from "@jambudipa/xstate-effect"

export declare function when<TContext, TEvent extends EventObject>(
  predicate: (ctx: GuardContext<TContext, TEvent>) => boolean
): GuardDefinition<TContext, TEvent>
```

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `predicate` | `(ctx: GuardContext<TContext, TEvent>) => boolean` | Decides the guard. |

### Returns

A `GuardDefinition<TContext, TEvent>` whose predicate wraps the result in an Effect.

### Example

```ts
import { createMachine, when } from "@jambudipa/xstate-effect"

type Context = { todos: ReadonlyArray<string> }
type Event = { type: "CLEAR" }

const hasTodos = when<Context, Event>(({ context }) => context.todos.length > 0)

export const machine = createMachine({
  types: {} as { context: Context; events: Event },
  context: { todos: [] },
  on: { CLEAR: { guard: hasTodos, actions: () => console.log("clear") } }
})
```

## Related pages

- [createMachine and the machine](./create-machine.md)
- [Type utilities](./type-utilities.md): `ContextFrom`, `EventFrom`, `ActorsFrom`, `ActionsFrom`,
  `GuardsFrom`, `DelaysFrom`, `SchemaTypeOr`, `SetupRequirements` and the requirement extractors
  of `Types`
- [Guards](./guards.md)
- [How to type a machine's context, events, input and output](../how-to/define-custom-types.md)
- [How to type a machine from Effect Schemas](../how-to/validate-events-with-schema.md)
- [How to handle actor errors](../how-to/handle-actor-errors.md)
- [How to give a machine's actions and actors Effect services](../how-to/provide-services-to-a-machine.md)
- [How services reach actions and actors](../explanation/services-and-requirements.md)
