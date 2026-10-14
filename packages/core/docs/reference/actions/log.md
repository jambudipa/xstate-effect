---
title: log and the level helpers
doc-type: reference
sources: [packages/core/src/actions/log.ts]
---

# log and the level helpers

> **TL;DR:** `log(value?, labelOrOptions?)` creates an action that logs one value when it runs.
> The actor's `logger` option receives `(label, value)` or `(value)`; without a logger the entry
> goes to Effect logging at the action's level, annotated with the actor's ids. `logDebug`,
> `logInfo`, `logWarning` and `logError` are `log` with a fixed level.

## Summary

| Export | Kind | Import from | Description |
|---|---|---|---|
| [`log`](#log) | function | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/actions` | An action that logs a value, with an optional label or options. |
| [`logDebug`, `logInfo`, `logWarning`, `logError`](#logdebug-loginfo-logwarning-logerror) | functions | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/actions` | `log` at the level `debug`, `info`, `warning` or `error`. |
| [`LogMessage`](#logmessage) | type | `@jambudipa/xstate-effect/actions` | The value a log action logs: a string or a function. |
| [`LogLevel`](#loglevel) | type | `@jambudipa/xstate-effect/actions` | `"debug" \| "info" \| "warning" \| "error"`. |
| [`LogOptions`](#logoptions) | type | `@jambudipa/xstate-effect/actions` | The object form of the second argument of `log`. |
| [`LogAction`](#logaction) | type | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/actions` | The type of the action that `log` returns, under its XState name. |
| [`Log`, `LogDebug`, `LogInfo`, `LogWarning`, `LogError`](#log-logdebug-loginfo-logwarning-logerror-interfaces) | types | `@jambudipa/xstate-effect/actions` | The types of the five functions. |

## `log`

### Signature

```ts
import type { ActionDefinition, EventObject } from "@jambudipa/xstate-effect"
import type { LogMessage, LogOptions } from "@jambudipa/xstate-effect/actions"

export declare function log<TContext, TEvent extends EventObject>(
  value?: LogMessage<TContext, TEvent>,
  labelOrOptions?: string | LogOptions
): ActionDefinition<TContext, TEvent>
```

`TContext` and `TEvent` come from where the action is used: the machine's `types`, or its
`setup`, and the event of the transition that runs the action.

### Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `value` | [`LogMessage<TContext, TEvent>`](#logmessage) | `({ context, event }) => ({ context, event })` | A string, or a function of the action arguments and the params of the use that gives the value to log. |
| `labelOrOptions` | `string \| LogOptions` | none | A string is the label. An object holds the `level` and the `label`. |

### Returns

An `ActionDefinition<TContext, TEvent>` with `type: "xstate.log"`.

### Behaviour

- The engine computes the value when the action runs, with the context that the earlier actions
  of the same list left.
- The entry is logged at once in a running actor. The actions of the initial snapshot log at
  `start`.
- With the actor's `logger` option, the logger receives `(label, value)` when a label is set and
  is not empty, else `(value)`. The level does not reach the logger.
- An actor without its own `logger` uses its system's logger, which is the root actor's `logger`
  option. Every child that the root invokes or spawns, at any depth, logs through it unless the
  child was created with its own.
- Without any logger, the entry goes to Effect logging at the action's level, with the
  annotations `actorId` and `sessionId`. The levels map as follows: `debug` to `Debug`, `info`
  to `Info`, `warning` to `Warn`, `error` to `Error`. Effect's minimum log level applies: with
  the default runtime, `debug` entries do not print.

### Errors

A value function that throws, or a logger that throws, gives the actor the status `error`.
`snapshot.error` holds the thrown value.

### Example

```ts
import { Effect } from "effect"
import { createActor, createMachine, log } from "@jambudipa/xstate-effect"

const machine = createMachine({
  types: {} as { context: { count: number }; events: { type: "INC" } },
  context: { count: 0 },
  initial: "active",
  states: {
    active: {
      entry: log("entered", "lifecycle"),
      on: {
        INC: { actions: log(({ context }) => context.count, { label: "count", level: "debug" }) }
      }
    }
  }
})

export const program = Effect.gen(function* () {
  const entries: Array<ReadonlyArray<unknown>> = []
  const actor = yield* createActor(machine, {
    logger: (...args: ReadonlyArray<unknown>) => {
      entries.push(args)
    }
  })
  yield* actor.start
  yield* actor.send({ type: "INC" })
  return entries // [["lifecycle", "entered"], ["count", 0]]
})
```

## `logDebug`, `logInfo`, `logWarning`, `logError`

### Signature

```ts
import type { ActionDefinition, EventObject } from "@jambudipa/xstate-effect"
import type { LogMessage } from "@jambudipa/xstate-effect/actions"

export declare function logDebug<TContext, TEvent extends EventObject>(
  message: LogMessage<TContext, TEvent>
): ActionDefinition<TContext, TEvent>
export declare function logInfo<TContext, TEvent extends EventObject>(
  message: LogMessage<TContext, TEvent>
): ActionDefinition<TContext, TEvent>
export declare function logWarning<TContext, TEvent extends EventObject>(
  message: LogMessage<TContext, TEvent>
): ActionDefinition<TContext, TEvent>
export declare function logError<TContext, TEvent extends EventObject>(
  message: LogMessage<TContext, TEvent>
): ActionDefinition<TContext, TEvent>
```

### Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `message` | [`LogMessage<TContext, TEvent>`](#logmessage) | required | The value to log, as for `log`. |

### Returns

The action of `log(message, { level })`, with no label:

| Helper | Level |
|---|---|
| `logDebug` | `"debug"` |
| `logInfo` | `"info"` |
| `logWarning` | `"warning"` |
| `logError` | `"error"` |

### Behaviour and errors

As for [`log`](#log).

### Example

```ts
import { createMachine, logError, logInfo } from "@jambudipa/xstate-effect"

export const machine = createMachine({
  types: {} as { context: { attempts: number }; events: { type: "FAIL" } },
  context: { attempts: 0 },
  initial: "running",
  states: {
    running: {
      entry: logInfo("started"),
      on: {
        FAIL: { target: "failed", actions: logError(({ context }) => `failed after ${context.attempts} attempts`) }
      }
    },
    failed: {}
  }
})
```

## `LogMessage`

### Definition

```ts
import type { ActionContext, EventObject } from "@jambudipa/xstate-effect"

export type LogMessage<TContext, TEvent extends EventObject> =
  | string
  | ((ctx: ActionContext<TContext, TEvent>, params: unknown) => unknown)
```

A string is logged as it is. A function receives the action arguments (`context`, `event`,
`self`, `system` and the other members of `ActionContext`) and the params of the use, and may
return a value of any type. Example: `log(({ event }) => event.type)`.

## `LogLevel`

### Definition

```ts
export type LogLevel = "debug" | "info" | "warning" | "error"
```

The level of a log action. The default is `"info"`.

## `LogOptions`

### Fields

| Field | Type | Default | Description |
|---|---|---|---|
| `level` | `LogLevel` | `"info"` | The level for Effect logging. A `logger` option does not receive it. |
| `label` | `string` | none | The label, logged before the value. An empty string counts as no label. |

Example: `log("Something went wrong", { level: "warning", label: "payment" })`.

## `LogAction`

### Definition

```ts
import type { ActionDefinition, EventObject } from "@jambudipa/xstate-effect"

export type LogAction<TContext, TExpressionEvent extends EventObject, _TParams, _TEvent extends EventObject> =
  ActionDefinition<TContext, TExpressionEvent>
```

The XState name of the action that `log` returns. The third and fourth type parameters are
accepted for XState compatibility and do not change the type.

## `Log`, `LogDebug`, `LogInfo`, `LogWarning`, `LogError` interfaces

The types of `log`, `logDebug`, `logInfo`, `logWarning` and `logError`. Each interface has the
call signature above as its first signature. Each also declares a second call signature whose
parameters are `never`; no call resolves to it.

## Related

- [setup and setupWithSchema](../setup.md): `setup(...).log` is `log` with the setup's context
  and events.
- [createActor and the actor](../create-actor.md): the `logger` option.
- [How to choose actions at run time with enqueueActions](../../how-to/batch-actions-with-enqueue.md):
  `log(...)` inside `enqueue(...)`.
- [enqueueActions](./enqueue-actions.md)
