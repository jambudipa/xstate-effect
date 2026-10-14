---
title: How to type a machine from Effect Schemas
doc-type: how-to
sources: [packages/core/src/setup.ts]
---

# How to type a machine from Effect Schemas

> **TL;DR:** Pass a context Schema and an event Schema to `setupWithSchema`; each machine it
> creates takes its context and event types from the Schemas' decoded types. The actor does not
> decode what you send it, so pass data from outside through the setup's `validateEvent` (or
> `validateContext`) first and handle the `SchemaError`. For typed input or output, use `setup`
> with types taken from the Schemas.

## When you need this

Use this guide when the context and the events are already described as Effect Schemas, or when
events arrive as untrusted data (an HTTP body, a queue message, a WebSocket frame) and must be
checked before the machine sees them.

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
the Schemas' decoded types, so an event's fields are typed in each transition.

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
with the typed event, or fails with a `SchemaError`. Send only what it gives back: the actor
itself does not check events against the Schema, so an unchecked value reaches the actions as
it is.

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
  yield* Effect.log(snapshot.context.celsius) // 21: the second message was rejected
})

void Effect.runPromise(Effect.scoped(program))
```

## Variations

### Check a context that comes from outside

`validateContext(value)` decodes an `unknown` value with the context Schema, in the same way:
it succeeds with the typed context or fails with a `SchemaError`. The setup also keeps the
Schemas as `contextSchema` and `eventSchema`, so you can reuse them, for example to encode a
context for storage.

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

### Type the input or the output as well

`setupWithSchema` takes no `types` member, so the input and the output of its machines stay
untyped: any value goes in, and `snapshot.output` holds an `unknown`. When you need those
typed, use `setup` and take the context and event types from the Schemas with
`Schema.Schema.Type`. Decode incoming events yourself with `Schema.decodeUnknownEffect`.

```ts
import { setup } from "@jambudipa/xstate-effect"
import { Schema } from "effect"

export const ThermostatContext = Schema.Struct({ celsius: Schema.Number })
export const ThermostatEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("SET_TARGET"), celsius: Schema.Number }),
  Schema.Struct({ type: Schema.Literal("TURN_OFF") })
])

export const decodeEvent = Schema.decodeUnknownEffect(ThermostatEvent)

export const thermostatMachine = setup({
  types: {} as {
    context: Schema.Schema.Type<typeof ThermostatContext>
    events: Schema.Schema.Type<typeof ThermostatEvent>
    input: { readonly startAt: number }
    output: { readonly lastTarget: number }
  }
}).createMachine({
  context: ({ input }) => ({ celsius: input.startAt }),
  initial: "on",
  states: {
    on: { on: { TURN_OFF: "off" } },
    off: { type: "final" }
  },
  output: ({ context }) => ({ lastTarget: context.celsius })
})
```

### Add implementations later

`thermostat.extend({ actions, guards, delays })` gives a new schema-based setup with the extra
implementations. It keeps the Schemas, `validateContext` and `validateEvent`.

### Attach Schemas to a machine for tools

`setup({ schemas })` stores any value on each machine it creates, as `machine.schemas`, for tools
that read it. It decodes nothing and types nothing.

## Related

- [setup and setupWithSchema](../reference/setup.md) — the full signatures, including
  `validateContext`, `validateEvent` and `extend`.
- [How to type a machine's context, events, input and output](define-custom-types.md) — the
  `types` form of `setup`.
