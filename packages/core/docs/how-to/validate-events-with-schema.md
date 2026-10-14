---
title: How to type a machine from Effect Schemas
doc-type: how-to
sources: [packages/core/src/setup.ts, packages/core/src/StateMachine.ts]
---

# How to type a machine from Effect Schemas

> **TL;DR:** Pass Schemas for the context and the events, and optionally for the input and the
> output, to `setupWithSchema`. Each machine it creates takes those types from the Schemas'
> decoded types and checks its values against them at run time: a value that does not match
> gives the actor the status `error`. Decode data from outside with the setup's `validateEvent`
> (or `validateContext`) before you send it, so that you can reject a bad value and keep the
> actor running.

## When you need this

Use this guide when the context, the events, the input or the output are already described as
Effect Schemas, or when events arrive as untrusted data (an HTTP body, a queue message, a
WebSocket frame) and must be checked before the machine sees them.

## Before you start

- You know how to type a machine with `setup` (see
  [How to type a machine's context, events, input and output](define-custom-types.md)).
- You know how to write a Schema with `Schema.Struct`, `Schema.Literal` and `Schema.Union` from
  `effect`.

## Steps

### 1. Describe the context and the events as Schemas

Give each event a `type` field with a literal Schema, and join the events with `Schema.Union`.

```ts
import { Schema } from "effect"

export const ThermostatContext = Schema.Struct({
  celsius: Schema.Number
})

export const ThermostatEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("SET_TARGET"), celsius: Schema.Number }),
  Schema.Struct({ type: Schema.Literal("TURN_OFF") })
])
```

### 2. Create the setup and the machine

Pass the Schemas as `context` and `events`. `setupWithSchema` also takes `actions`, `guards`,
`actors` and `delays`, as `setup` does. Its `createMachine` types the context and the events by
the Schemas' decoded types, so an event's fields are typed in each transition. At run time, the
machine checks each event that it receives, and each context that it gets, against those types.

```ts
import { assign, setupWithSchema } from "@jambudipa/xstate-effect"
import { Schema } from "effect"

const ThermostatContext = Schema.Struct({ celsius: Schema.Number })

const ThermostatEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("SET_TARGET"), celsius: Schema.Number }),
  Schema.Struct({ type: Schema.Literal("TURN_OFF") })
])

export const thermostat = setupWithSchema({
  context: ThermostatContext,
  events: ThermostatEvent
})

export const thermostatMachine = thermostat.createMachine({
  context: { celsius: 18 },
  initial: "on",
  states: {
    on: {
      on: {
        // `event.celsius` is a number here
        SET_TARGET: { actions: assign({ celsius: ({ event }) => event.celsius }) },
        TURN_OFF: "off"
      }
    },
    off: { type: "final" }
  }
})
```

### 3. Decode each event before you send it

`thermostat.validateEvent(value)` decodes an `unknown` value with the event Schema. It succeeds
with the typed event, or fails with a `SchemaError` that you can handle. Send only what it gives
back. The actor checks each event too, but an event that fails that check stops the actor with
the status `error` (see [Handle a value that does not match](#handle-a-value-that-does-not-match)).

`validateEvent` also turns the encoded form into the decoded form: for a field of
`Schema.NumberFromString`, the string `"21"` becomes the number `21`. The actor checks only the
decoded form, so it rejects the string.

```ts
import { assign, createActor, setupWithSchema } from "@jambudipa/xstate-effect"
import { Effect, Schema } from "effect"

const thermostat = setupWithSchema({
  context: Schema.Struct({ celsius: Schema.Number }),
  events: Schema.Union([
    Schema.Struct({ type: Schema.Literal("SET_TARGET"), celsius: Schema.Number }),
    Schema.Struct({ type: Schema.Literal("TURN_OFF") })
  ])
})

const thermostatMachine = thermostat.createMachine({
  context: { celsius: 18 },
  on: {
    SET_TARGET: { actions: assign({ celsius: ({ event }) => event.celsius }) }
  }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(thermostatMachine)
  yield* actor.start

  // Values from outside the program, such as parsed JSON
  const messages: ReadonlyArray<unknown> = [
    { type: "SET_TARGET", celsius: 21 },
    { type: "SET_TARGET", celsius: "warm" }
  ]

  for (const message of messages) {
    yield* thermostat.validateEvent(message).pipe(
      Effect.flatMap((event) => actor.send(event)),
      Effect.catchTag("SchemaError", (error) => Effect.logWarning(`Rejected event: ${error.message}`))
    )
  }

  const snapshot = yield* actor.getSnapshot
  // 21 active: the second message was rejected, and the actor still runs
  yield* Effect.log(snapshot.context.celsius, snapshot.status)
})

void Effect.runPromise(Effect.scoped(program))
```

## Variations

### Type and check the input and the output

`setupWithSchema` also takes an `input` and an `output` Schema. The decoded type of `input` is
what the context factory and the `input` option of `createActor` take. The decoded type of
`output` is what the config's `output` must give, and the value inside `snapshot.output`. The
actor checks its input before the context factory reads it, and the output of its done snapshot.
Without an `input` Schema, the input type is `NonReducibleUnknown`; without an `output` Schema,
the output type is `unknown`. Neither is then checked.

```ts
import { assign, createActor, setupWithSchema } from "@jambudipa/xstate-effect"
import { Effect, Option, Schema } from "effect"

const thermostat = setupWithSchema({
  context: Schema.Struct({ celsius: Schema.Number }),
  events: Schema.Union([
    Schema.Struct({ type: Schema.Literal("SET_TARGET"), celsius: Schema.Number }),
    Schema.Struct({ type: Schema.Literal("TURN_OFF") })
  ]),
  input: Schema.Struct({ startAt: Schema.Number }),
  output: Schema.Struct({ lastTarget: Schema.Number })
})

const thermostatMachine = thermostat.createMachine({
  // `input` is { readonly startAt: number }
  context: ({ input }) => ({ celsius: input.startAt }),
  initial: "on",
  states: {
    on: {
      on: {
        SET_TARGET: { actions: assign({ celsius: ({ event }) => event.celsius }) },
        TURN_OFF: "off"
      }
    },
    off: { type: "final" }
  },
  // Must give { readonly lastTarget: number }
  output: ({ context }) => ({ lastTarget: context.celsius })
})

const program = Effect.gen(function* () {
  // The input option is required, and typed by the input Schema
  const actor = yield* createActor(thermostatMachine, { input: { startAt: 18 } })
  yield* actor.start
  yield* actor.send({ type: "SET_TARGET", celsius: 21 })
  yield* actor.send({ type: "TURN_OFF" })

  // snapshot.output is an Option<{ readonly lastTarget: number }>
  const snapshot = yield* actor.getSnapshot
  yield* Option.match(snapshot.output, {
    onNone: () => Effect.log("Still on"),
    onSome: (output) => Effect.log(`Last target: ${output.lastTarget}`) // Last target: 21
  })
})

void Effect.runPromise(Effect.scoped(program))
```

### Handle a value that does not match

The type checker stops most bad values before they reach the actor, but some get through: a
check such as `Schema.isBetween` is not part of the type, and a value cast from `JSON.parse` is
not checked at all. When the actor finds a value that does not match:

- **An event, or the context or the output that a transition gives.** The transition fails as an
  action that throws would. The actor gets the status `error`, `snapshot.error` holds the
  `SchemaError`, and the snapshot keeps the state and the context from before the event. The
  actor processes no more events.
- **The input, or the initial context.** The initial snapshot has the status `error`, with the
  `SchemaError` as its error.

The parent of the actor receives the error as an `xstate.error.actor.*` event; an actor without
a parent logs it through the Effect logger. See [How to handle actor errors](handle-actor-errors.md).

```ts
import { assign, createActor, setupWithSchema } from "@jambudipa/xstate-effect"
import { Effect, Option, Schema } from "effect"

const thermostat = setupWithSchema({
  // A target outside 5 to 30 does not match the context Schema
  context: Schema.Struct({
    celsius: Schema.Number.pipe(Schema.check(Schema.isBetween({ minimum: 5, maximum: 30 })))
  }),
  events: Schema.Struct({ type: Schema.Literal("SET_TARGET"), celsius: Schema.Number })
})

const thermostatMachine = thermostat.createMachine({
  context: { celsius: 18 },
  on: {
    SET_TARGET: { actions: assign({ celsius: ({ event }) => event.celsius }) }
  }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(thermostatMachine)
  yield* actor.start
  // The event type takes any number, but the context that the transition gives fails the check
  yield* actor.send({ type: "SET_TARGET", celsius: 90 })

  const snapshot = yield* actor.getSnapshot
  yield* Effect.log(snapshot.status, snapshot.context.celsius) // error 18
  yield* Effect.log(Option.exists(snapshot.error, Schema.isSchemaError)) // true
})

void Effect.runPromise(Effect.scoped(program))
```

### Check a context that comes from outside

`validateContext(value)` decodes an `unknown` value with the context Schema, in the same way:
it succeeds with the typed context or fails with a `SchemaError`. The setup also keeps the
Schemas as `contextSchema` and `eventSchema`, so you can reuse them, for example to encode a
context for storage. A snapshot that `createActor` restores from its `snapshot` option is
checked when it is restored: a stored context that the Schema rejects gives the actor the status
`error`, with a `RestoreError` whose `cause` is the `SchemaError`.

```ts
import { setupWithSchema } from "@jambudipa/xstate-effect"
import { Effect, Schema } from "effect"

const thermostat = setupWithSchema({
  context: Schema.Struct({ celsius: Schema.Number }),
  events: Schema.Struct({ type: Schema.Literal("TURN_OFF") })
})

export const loadContext = (stored: unknown) =>
  thermostat.validateContext(stored).pipe(
    Effect.catchTag("SchemaError", () => Effect.succeed({ celsius: 18 }))
  )

export const encodeContext = Schema.encodeUnknownEffect(thermostat.contextSchema)
```

### Add implementations later

`thermostat.extend({ actions, guards, delays })` gives a new schema-based setup with the extra
implementations. It keeps the Schemas, `validateContext`, `validateEvent` and the run-time
checks. A machine's `provide`, `withContext` and `withId` also keep the checks.

### Attach Schemas to a machine for tools

`setup({ schemas })` stores any value on each machine it creates, as `machine.schemas`, for tools
that read it. It decodes nothing, checks nothing and types nothing.

## Related

- [setup and setupWithSchema](../reference/setup.md) — the full signatures, the run-time checks,
  `validateContext`, `validateEvent` and `extend`.
- [How to type a machine's context, events, input and output](define-custom-types.md) — the
  `types` form of `setup`.
- [How to handle actor errors](handle-actor-errors.md) — what to do when an actor gets the status
  `error`.
