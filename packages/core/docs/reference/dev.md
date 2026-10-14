---
title: Dev tools entry point
doc-type: reference
sources: [packages/core/src/dev/]
---

# Dev tools entry point

> **TL;DR:** `@jambudipa/xstate-effect/dev` connects actors to a dev tools extension through the
> global hook `__xstate__`. `registerService` and `devToolsAdapter` register an actor with the
> hook, and `getGlobal` gives the global object. Each one returns an Effect; a hook that throws or
> has no `register` function fails it with `DevToolsError`. Where no `window` object exists, the
> register functions do nothing.

Every export of this page comes from `@jambudipa/xstate-effect/dev`. The type
`DevToolsAdapter`, the type of the `devTools` actor option's function form, comes from
`@jambudipa/xstate-effect`.

## Summary

| Export | Kind | Description |
| --- | --- | --- |
| [`getGlobal`](#getglobal) | function | Gives the global object as an `Option`. |
| [`registerService`](#registerservice) | function | Registers an actor with the global hook. |
| [`devToolsAdapter`](#devtoolsadapter) | function | The adapter that the `devTools: true` actor option calls. |
| [`XStateDevInterface`](#xstatedevinterface) | interface | The shape of the global hook `__xstate__`. |
| [`DevToolsError`](#devtoolserror) | class | The error of a hook that cannot register an actor. |

## getGlobal

### Signature

```ts
import type { Effect, Option } from "effect"

export declare function getGlobal(): Effect.Effect<Option.Option<typeof globalThis>>
```

### Return value

An Effect that gives the first global object that exists, as `Option.some`, in this order:
`globalThis`, `self`, `window`, `global`.

### Behaviour

- The Effect reads the environment when it runs, not at import.
- With none of the four objects, it logs this warning through the Effect logger and gives
  `Option.none()`: `XState could not find a global object in this environment. Please let the
  maintainers know and raise an issue here: https://github.com/statelyai/xstate/issues`.
- It never fails.

### Example

```ts
import { getGlobal } from "@jambudipa/xstate-effect/dev"
import { Effect, Option } from "effect"

export const hookInstalled = Effect.map(
  getGlobal(),
  Option.exists((global) => "__xstate__" in global)
)
```

## registerService

### Signature

```ts
import type { AnyActor } from "@jambudipa/xstate-effect"
import type { DevToolsError } from "@jambudipa/xstate-effect/dev"
import type { Effect } from "effect"

export declare function registerService(service: AnyActor): Effect.Effect<void, DevToolsError>
```

### Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `service` | `AnyActor` | Required. The actor to register. |

### Behaviour

| Condition | Result |
| --- | --- |
| No `window` object exists. | Succeeds and does nothing. |
| The global object has no truthy `__xstate__` value. | Succeeds and does nothing. |
| `__xstate__` has a `register` function. | Calls `register(service)` once and succeeds. |
| `register` throws. | Fails with `DevToolsError`; the message is `The dev tools hook could not register actor "<id>"`, and `cause` is the thrown value. |
| `__xstate__` is truthy but has no `register` function. | Fails with `DevToolsError`; the message is `The dev tools hook has no register function`, and `cause` is the `__xstate__` value. |

It never calls the hook's `unregister` or `onRegister`, and never reads its `services`.

### Example

```ts
import { createActor, createMachine } from "@jambudipa/xstate-effect"
import { registerService } from "@jambudipa/xstate-effect/dev"
import { Effect } from "effect"

const toggle = createMachine({
  id: "toggle",
  initial: "off",
  states: {
    off: { on: { TOGGLE: "on" } },
    on: { on: { TOGGLE: "off" } }
  }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(toggle)
  yield* registerService(actor).pipe(
    Effect.catchTag("DevToolsError", (error) => Effect.logWarning(error.message))
  )
  yield* actor.start
})

void Effect.runPromise(Effect.scoped(program))
```

## devToolsAdapter

### Signature

```ts
import type { AnyActor } from "@jambudipa/xstate-effect"
import type { DevToolsError } from "@jambudipa/xstate-effect/dev"
import type { Effect } from "effect"

export declare function devToolsAdapter(service: AnyActor): Effect.Effect<void, DevToolsError>
```

### Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `service` | `AnyActor` | Required. The actor to register. |

### Behaviour

- It does what `registerService` does, with the same conditions and errors.
- `createActor(logic, { devTools: true })` calls it with the actor in `start`, once, after the
  actor publishes the snapshot it starts from and before it processes the events sent before
  `start`.
- Through the `devTools` option, a failure or a defect of the adapter makes `start` die, and the
  actor then processes no event.
- The `devTools` option also takes a `DevToolsAdapter`, a function
  `(service: AnyActor) => Effect<void, unknown>`, which is called instead of `devToolsAdapter`.
  An invoked or spawned child does not inherit the option. See
  [createActor and the actor](./create-actor.md).

### Example

```ts
import { createActor, createMachine } from "@jambudipa/xstate-effect"
import { devToolsAdapter } from "@jambudipa/xstate-effect/dev"
import { Effect } from "effect"

const machine = createMachine({ id: "light", initial: "green", states: { green: {} } })

const program = Effect.gen(function* () {
  // devToolsAdapter runs in start; a failing hook is logged instead of making start die
  const actor = yield* createActor(machine, {
    devTools: (service) =>
      devToolsAdapter(service).pipe(Effect.catchTag("DevToolsError", (error) => Effect.logWarning(error.message)))
  })
  yield* actor.start
})

void Effect.runPromise(Effect.scoped(program))
```

## XStateDevInterface

The shape of the hook that a dev tools extension puts on the global object as `__xstate__`.

| Member | Type | Description |
| --- | --- | --- |
| `register` | `(service: AnyActor) => void` | Takes an actor. `registerService` and `devToolsAdapter` call it, only where a `window` object exists. A throw fails the call with `DevToolsError`. |
| `unregister` | `(service: AnyActor) => void` | Never called by this package, not even at an actor's stop. |
| `onRegister` | `(listener: (service: AnyActor) => void) => { readonly unsubscribe: () => void }` | Adds a listener for later registrations. Never called by this package. |
| `services` | `Set<AnyActor>` | The actors that the hook holds. The hook owns this set; this package neither reads nor changes it. |

### Example

```ts
import type { AnyActor } from "@jambudipa/xstate-effect"
import type { XStateDevInterface } from "@jambudipa/xstate-effect/dev"

export const makeRecordingHook = (registered: Array<string>): XStateDevInterface => ({
  services: new Set<AnyActor>(),
  register: (service) => {
    registered.push(service.id)
  },
  unregister: () => undefined,
  onRegister: () => ({ unsubscribe: () => undefined })
})
```

## DevToolsError

`DevToolsError` is a tagged error with the `_tag` `"DevToolsError"`.

| Field | Type | Description |
| --- | --- | --- |
| `_tag` | `"DevToolsError"` | The tag. |
| `message` | `string` | `The dev tools hook could not register actor "<id>"`, or `The dev tools hook has no register function`. |
| `cause` | `unknown` | The value that `register` threw, or the `__xstate__` value that has no `register` function. |

### Example

```ts
import type { AnyActor } from "@jambudipa/xstate-effect"
import { DevToolsError, registerService } from "@jambudipa/xstate-effect/dev"
import { Effect } from "effect"

export const registerOrReport = (actor: AnyActor) =>
  registerService(actor).pipe(
    Effect.catchIf(
      (error) => error instanceof DevToolsError,
      (error) => Effect.logError(error.message, error.cause)
    )
  )
```

## Related

- [How to inspect a running actor system](../how-to/inspect-an-actor-system.md)
- [createActor and the actor](./create-actor.md): the `devTools` and `inspect` options.
- [Inspection events](./inspection.md): the `inspect` option, which reports actor events without
  a global hook.
- [Entry points](./entry-points.md)
