---
title: Guards
doc-type: reference
sources: [packages/core/src/guards/]
---

# Guards

> **TL;DR:** The built-in guards `stateIn`, `stateNotIn`, `and`, `or` and `not` return guard
> definitions that a transition's `guard`, a setup's `guards` record or an `enqueueActions`
> `check` accepts. `evaluateGuard` evaluates any guard form as an `Effect<boolean, GuardError>`.
> `Guard`, `GuardArgs`, `GuardPredicate` and `UnknownGuard` type the guard forms.

## Summary

| Export | Kind | Import from | Description |
|---|---|---|---|
| [`stateIn`](#statein) | function | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/guards` | Passes while the machine is in a state. |
| [`stateNotIn`](#statenotin) | function | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/guards` | Passes while the machine is not in a state. |
| [`and`](#and) | function | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/guards` | Passes when every guard passes. |
| [`or`](#or) | function | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/guards` | Passes when any guard passes. |
| [`not`](#not) | function | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/guards` | Passes when the guard fails. |
| [`evaluateGuard`](#evaluateguard) | function | `@jambudipa/xstate-effect/guards` | Evaluates a guard in any form. |
| [`Guard`](#guard) | type | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/guards` | A guard as a machine config writes it. |
| [`GuardArgs`](#guardargs) | type | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/guards` | The `{ context, event }` object a guard function receives. |
| [`GuardPredicate`](#guardpredicate) | type | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/guards` | A guard written as a function. |
| [`UnknownGuard`](#unknownguard) | type | `@jambudipa/xstate-effect`, `@jambudipa/xstate-effect/guards` | A guard of any machine. |

The root entry point also exports the guards module as the namespace `guards`, so
`guards.evaluateGuard` is reachable from `@jambudipa/xstate-effect`.

Every built-in guard returns a `BuiltInGuardDefinition`: an object with a `type`, a `params`
member that shows its arguments, and a `predicate`. The guard decides from the arguments it was
created with, so a use of it by name with other params decides the same way.

| Guard | `type` | `params` |
|---|---|---|
| `stateIn` | `"xstate.stateIn"` | `{ stateValue }` |
| `stateNotIn` | `"xstate.stateNotIn"` | `{ stateValue }` |
| `and` | `"xstate.and"` | `{ guards, implementations }` |
| `or` | `"xstate.or"` | `{ guards, implementations }` |
| `not` | `"xstate.not"` | `{ guard, implementations }` |

## `stateIn`

### Signature

```ts
import type { BuiltInGuardDefinition, EventObject, StateValue } from "@jambudipa/xstate-effect"

export declare function stateIn<TContext, TEvent extends EventObject>(
  stateValue: StateValue
): BuiltInGuardDefinition<TContext, TEvent, { stateValue: StateValue }>
```

### Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `stateValue` | `StateValue` | required | A state node id (`"#id"`, also with a key path such as `"#b.B1"`), or any other state value: a key, a dotted path, or an object value. |

### Returns

A `BuiltInGuardDefinition` with `type: "xstate.stateIn"` and `params: { stateValue }`.

### Behaviour

- A state node id passes while that node is one of the snapshot's active nodes.
- Any other state value passes when `snapshot.matches(stateValue)` is true: a dotted string is a
  path, and the keys of parallel regions match.
- The check reads the whole active configuration, so a guard in one parallel region can test a
  node of another.
- The guard reads the snapshot of the step it decides: the current step for a transition, the
  snapshot that `can` is called on, and the snapshot at that point of the action list for a
  `check`.
- Without a snapshot (an `evaluateGuard` call whose scope has none), no state is active and the
  guard is `false`.

### Errors

A state node id that names no node fails the guard with a `GuardError` whose message is
`Child state node '<stateValue>' does not exist on machine '<machine id>'`, where
`<stateValue>` is the id as given, with its `#`. In a transition for an event,
the actor gets the status `error` with a `GuardError` whose message is
`Unable to evaluate guard in transition for event '<event type>' in state node '<node id>':`,
a new line, and that message.

### Example

```ts
import { createMachine, stateIn } from "@jambudipa/xstate-effect"

export const machine = createMachine({
  types: {} as { events: { type: "START" } | { type: "FINISH" } },
  id: "transfer",
  type: "parallel",
  states: {
    upload: {
      initial: "idle",
      states: { idle: { on: { START: "active" } }, active: { id: "uploading" } }
    },
    ui: {
      initial: "editing",
      states: {
        editing: { on: { FINISH: { guard: stateIn("#uploading"), target: "done" } } },
        done: {}
      }
    }
  }
})
```

## `stateNotIn`

### Signature

```ts
import type { BuiltInGuardDefinition, EventObject, StateValue } from "@jambudipa/xstate-effect"

export declare function stateNotIn<TContext, TEvent extends EventObject>(
  stateValue: StateValue
): BuiltInGuardDefinition<TContext, TEvent, { stateValue: StateValue }>
```

### Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `stateValue` | `StateValue` | required | As for [`stateIn`](#statein). |

### Returns

A `BuiltInGuardDefinition` with `type: "xstate.stateNotIn"` and `params: { stateValue }`.

### Behaviour

The negation of `stateIn(stateValue)`, evaluated through `evaluateGuard`. Without a snapshot,
`stateIn` is `false`, so `stateNotIn` is `true`.

### Errors

As for [`stateIn`](#statein).

### Example

```ts
import { createMachine, stateNotIn } from "@jambudipa/xstate-effect"

export const machine = createMachine({
  types: {} as { events: { type: "RETRY" } | { type: "DISCONNECT" } },
  type: "parallel",
  states: {
    network: {
      initial: "online",
      states: { online: { on: { DISCONNECT: "offline" } }, offline: {} }
    },
    request: {
      initial: "failed",
      states: {
        failed: { on: { RETRY: { guard: stateNotIn({ network: "offline" }), target: "pending" } } },
        pending: {}
      }
    }
  }
})
```

## `and`

### Signature

```ts
import type { BuiltInGuardDefinition, EventObject, Guard, MachineImplementations } from "@jambudipa/xstate-effect"

// Simplified: the full type also records the guard names that the list holds,
// which a machine with named guards checks against its own guards
export declare function and<TContext, TEvent extends EventObject>(
  guards: ReadonlyArray<Guard<TContext, TEvent>>,
  implementations?: MachineImplementations<TContext, TEvent>
): BuiltInGuardDefinition<
  TContext,
  TEvent,
  {
    readonly guards: ReadonlyArray<Guard<TContext, TEvent>>
    readonly implementations?: MachineImplementations<TContext, TEvent>
  }
>
```

### Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `guards` | `ReadonlyArray<Guard<TContext, TEvent>>` | required | The guards, in any form: names, `{ type, params }` uses, functions, built-in guards. |
| `implementations` | `MachineImplementations<TContext, TEvent>` | the machine's | Implementations that the names in `guards` resolve against, in place of the machine's. |

### Returns

A `BuiltInGuardDefinition` with `type: "xstate.and"` and `params: { guards, implementations }`.

### Behaviour

- Evaluates each guard in order through `evaluateGuard` and stops at the first one that fails.
- Passes when every guard passes. An empty list passes.
- A name or `{ type, params }` resolves against the machine's implementations, or the
  `implementations` argument when given, at any depth of nesting.
- In a machine with named guards (a setup with `guards`, or a machine whose `types` declare
  `guards`), the type checker checks each name that `and` holds, at any depth, against those
  guards: an unknown name, or a name without the params that its guard's type needs, is a type
  error. The check is the same for an `and` written inline as a transition's guard and for one
  in the setup's `guards` record. Without named guards, any name and any params pass.

### Errors

A name that has no implementation fails the guard with a `GuardError`; see
[`evaluateGuard`](#evaluateguard).

### Example

```ts
import { and, not, setup } from "@jambudipa/xstate-effect"

export const machine = setup({
  types: {
    context: {} as { count: number; locked: boolean },
    events: {} as { type: "SUBMIT" }
  },
  guards: {
    isLocked: ({ context }) => context.locked
  }
}).createMachine({
  context: { count: 1, locked: false },
  initial: "editing",
  states: {
    editing: {
      on: {
        SUBMIT: { guard: and([({ context }) => context.count > 0, not("isLocked")]), target: "submitted" }
      }
    },
    submitted: {}
  }
})
```

## `or`

### Signature

```ts
import type { BuiltInGuardDefinition, EventObject, Guard, MachineImplementations } from "@jambudipa/xstate-effect"

// Simplified: the full type also records the guard names that the list holds,
// which a machine with named guards checks against its own guards
export declare function or<TContext, TEvent extends EventObject>(
  guards: ReadonlyArray<Guard<TContext, TEvent>>,
  implementations?: MachineImplementations<TContext, TEvent>
): BuiltInGuardDefinition<
  TContext,
  TEvent,
  {
    readonly guards: ReadonlyArray<Guard<TContext, TEvent>>
    readonly implementations?: MachineImplementations<TContext, TEvent>
  }
>
```

### Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `guards` | `ReadonlyArray<Guard<TContext, TEvent>>` | required | The guards, in any form. |
| `implementations` | `MachineImplementations<TContext, TEvent>` | the machine's | Implementations that the names in `guards` resolve against, in place of the machine's. |

### Returns

A `BuiltInGuardDefinition` with `type: "xstate.or"` and `params: { guards, implementations }`.

### Behaviour

- Evaluates each guard in order through `evaluateGuard` and stops at the first one that passes.
- Passes when any guard passes. An empty list fails.
- Names resolve, and the type checker checks them, as for [`and`](#and).

### Errors

A name that has no implementation and is evaluated fails the guard with a `GuardError`. A name
after the first guard that passes is not evaluated.

### Example

```ts
import { or, setup } from "@jambudipa/xstate-effect"

export const machine = setup({
  types: {
    context: {} as { isAdmin: boolean; role: string },
    events: {} as { type: "EDIT" }
  },
  guards: {
    hasRole: ({ context }, params: { role: string }) => context.role === params.role
  }
}).createMachine({
  context: { isAdmin: false, role: "editor" },
  initial: "viewing",
  states: {
    viewing: {
      on: {
        EDIT: {
          guard: or([({ context }) => context.isAdmin, { type: "hasRole", params: { role: "editor" } }]),
          target: "editing"
        }
      }
    },
    editing: {}
  }
})
```

## `not`

### Signature

```ts
import type { BuiltInGuardDefinition, EventObject, Guard, MachineImplementations } from "@jambudipa/xstate-effect"

// Simplified: the full type also records the guard names that the argument holds,
// which a machine with named guards checks against its own guards
export declare function not<TContext, TEvent extends EventObject>(
  guard: Guard<TContext, TEvent>,
  implementations?: MachineImplementations<TContext, TEvent>
): BuiltInGuardDefinition<
  TContext,
  TEvent,
  {
    readonly guard: Guard<TContext, TEvent>
    readonly implementations?: MachineImplementations<TContext, TEvent>
  }
>
```

### Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `guard` | `Guard<TContext, TEvent>` | required | The guard to negate, in any form. |
| `implementations` | `MachineImplementations<TContext, TEvent>` | the machine's | Implementations that a name in `guard` resolves against, in place of the machine's. |

### Returns

A `BuiltInGuardDefinition` with `type: "xstate.not"` and `params: { guard, implementations }`.

### Behaviour

Evaluates `guard` through `evaluateGuard` and passes when it fails. Names resolve, and the type
checker checks them, as for [`and`](#and).

### Errors

A name that has no implementation fails the guard with a `GuardError`.

### Example

```ts
import { createMachine, not, stateIn } from "@jambudipa/xstate-effect"

export const machine = createMachine({
  types: {} as { context: { disabled: boolean }; events: { type: "GO" } },
  context: { disabled: false },
  type: "parallel",
  states: {
    mode: { initial: "normal", states: { normal: {}, error: {} } },
    action: {
      initial: "idle",
      states: {
        idle: {
          on: {
            GO: { guard: not(({ context }) => context.disabled), target: "going" }
          }
        },
        going: { always: { guard: not(stateIn({ mode: "error" })), target: "idle" } }
      }
    }
  }
})
```

## `evaluateGuard`

### Signature

```ts
import type { Effect } from "effect"
import type { EventObject, Guard, GuardError, GuardScope } from "@jambudipa/xstate-effect"

export declare function evaluateGuard<TContext, TEvent extends EventObject>(
  guard: Guard<TContext, TEvent>,
  context: TContext,
  event: TEvent,
  scope: GuardScope<TContext, TEvent>
): Effect.Effect<boolean, GuardError>
```

### Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `guard` | `Guard<TContext, TEvent>` | required | The guard, in any form. |
| `context` | `TContext` | required | The context the guard decides on. |
| `event` | `TEvent` | required | The event the guard decides on. |
| `scope.self` | an actor reference | required | The evaluating actor. A guard definition's `predicate` receives it as `self`. |
| `scope.system` | `ActorSystemService` | required | The evaluating actor's system. A guard definition's `predicate` receives it as `system`. |
| `scope.implementations` | `MachineImplementations<TContext, TEvent>` | none | The implementations that names resolve against. Without them, every name fails. |
| `scope.snapshot` | `MachineSnapshot<TContext>` | none | The snapshot whose active states `stateIn` checks. Without it, `stateIn` is `false`. |

### Returns

An `Effect<boolean, GuardError>` that succeeds with whether the guard passes.

### Behaviour

How each form is evaluated:

| Form | Evaluation |
|---|---|
| Inline function | Called as `fn({ context, event }, undefined)`. |
| Guard definition (an object with a `predicate` function, such as a built-in guard) | Its `predicate` runs with the guard context (`context`, `event`, `self`, `system`, `implementations`, `snapshot`) and its own `params`. |
| Name | The implementation of that name is called with `undefined` params. |
| `{ type, params }` | The implementation named `type` is called with the params of this use: the static value, or the result of `params({ context, event })`. |

- An implementation is a function, a guard definition, or another name or `{ type, params }`,
  which resolves in turn with its own params. A built-in guard used by name ignores the params
  of that use.
- A guard function may return a `boolean` or an `Effect<boolean>`; the evaluator runs the
  Effect.
- A guard function that throws, or whose Effect fails, is a defect that carries the original
  value. In a running actor it gives the status `error`.

### Errors

| Condition | Failure |
|---|---|
| A name with no implementation | `GuardError` with the message `Guard '<name>' is not implemented.'.` |
| Guards nested deeper than 10,000 evaluations (a guard that refers back to itself through a built-in guard, such as `a: not("a")`) | `GuardError` with the message `Maximum call stack size exceeded` |

When an evaluation fails with a `GuardError` while a running actor selects a transition for an
event, the actor gets the status `error` with a `GuardError` whose message starts with
`Unable to evaluate guard in transition for event '<event type>' in state node '<node id>':`.
For an eventless transition, the error carries the guard's own message.

### Example

```ts
import { Effect } from "effect"
import { createActor, createMachine } from "@jambudipa/xstate-effect"
import { and, evaluateGuard, not } from "@jambudipa/xstate-effect/guards"

type Ctx = { readonly admin: boolean }
type Ev = { readonly type: "CHECK" }

export const program = Effect.gen(function* () {
  const actor = yield* createActor(createMachine({}))
  return yield* evaluateGuard<Ctx, Ev>(and(["isAdmin", not("isLocked")]), { admin: true }, { type: "CHECK" }, {
    self: actor,
    system: actor.system,
    implementations: {
      guards: { isAdmin: ({ context }) => context.admin, isLocked: () => false }
    }
  }) // true
})
```

## `Guard`

### Definition

```ts
import type {
  EventObject,
  GuardDefinition,
  GuardPredicate,
  GuardReference,
  ImplementationNames,
  ParameterizedObject
} from "@jambudipa/xstate-effect"

// The check on a built-in guard written inline; the package does not export this name
type ReferencedGuardsCheck<TGuards extends ParameterizedObject> = string extends TGuards["type"]
  ? unknown
  : { readonly "~guards"?: TGuards }

export type Guard<TContext, TEvent extends EventObject, TNames extends ImplementationNames = ImplementationNames> =
  | GuardReference<TContext, TEvent, TNames["guards"]>
  | GuardPredicate<TContext, TEvent>
  | (Pick<GuardDefinition<TContext, TEvent, never>, "type" | "predicate"> & ReferencedGuardsCheck<TNames["guards"]>)
```

A guard in one of these forms:

| Form | Example |
|---|---|
| The name of an implementation | `"isValid"` |
| A `{ type, params }` use of an implementation | `{ type: "atLeast", params: ({ context }) => ({ min: context.limit }) }` |
| An inline function | `({ context, event }) => context.count + event.amount > 10` |
| A guard definition | `stateIn("ready")`, `and([...])` |

`TNames` holds the guard names a reference may name, with their params. With the default, any
name and any params are accepted. With named guards (a setup's `guards`, or the guards that a
machine's `types` declare), a name alone is accepted for a guard whose params may be
`undefined`, else `{ type, params }` with params of that guard's type.

A built-in `and`, `or` or `not` records the guards that it names, at any depth, in a type-only
`"~guards"` member that is never set. With named guards, each of these must be one of the named
guards, with params of its type, so an inline `and(["isValid", "isMissing"])` is a type error
when no guard is named `isMissing`. `stateIn` and `stateNotIn` name no guard. With the default,
every guard definition is accepted.

## `GuardArgs`

### Definition

```ts
import type { EventObject } from "@jambudipa/xstate-effect"

export interface GuardArgs<TContext, TEvent extends EventObject> {
  readonly context: TContext
  readonly event: TEvent
}
```

| Field | Description |
|---|---|
| `context` | The context the guard decides on: the snapshot's context at the point of evaluation. |
| `event` | The event being handled. The guard of an eventless transition gets the event of its macrostep. |

## `GuardPredicate`

### Definition

```ts
import type { Effect } from "effect"
import type { EventObject, GuardArgs } from "@jambudipa/xstate-effect"

export type GuardPredicate<TContext, TEvent extends EventObject, TParams = undefined> = (
  args: GuardArgs<TContext, TEvent>,
  params: TParams
) => boolean | Effect.Effect<boolean>
```

A guard written as a function, called as `fn({ context, event }, params)`. Inline in a config it
receives `undefined` params. As an implementation it receives the params of each use. It returns
a `boolean`, or an `Effect<boolean>` that the evaluator runs.

Example: `guard: ({ context, event }) => context.count + event.amount > 10`.

## `UnknownGuard`

### Definition

```ts
import type { EventObject, Guard } from "@jambudipa/xstate-effect"

export type UnknownGuard = Guard<unknown, EventObject>
```

A guard of any machine.

## Related

- [Guard your transitions](../tutorials/03-guards-and-transitions.md)
- [How to combine guards](../how-to/compose-guards.md)
- [enqueueActions](./actions/enqueue-actions.md): `check` evaluates a guard inside an action.
- [setup and setupWithSchema](./setup.md): the `guards` record.
- [Errors](./errors.md): `GuardError`.
- [How failures surface](../explanation/failure-model.md)
