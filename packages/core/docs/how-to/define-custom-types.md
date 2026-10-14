---
title: How to type a machine's context, events, input and output
doc-type: how-to
sources: [packages/core/src/setup.ts, packages/core/src/Types.ts]
---

# How to type a machine's context, events, input and output

> **TL;DR:** Declare the types once in `setup({ types: {} as { context; events; input; output } })`.
> The setup reads none of these values; it only carries their types to each machine it creates.
> The compiler then checks the context, narrows the event in each transition, makes
> `createActor` ask for the input, and types `snapshot.output` as an `Option` of the output.

## When you need this

Use this guide when you want the compiler to catch a wrong context update, an event the
machine does not take, a missing input or a misread output. Without declared types, the
event type is any event object and the input and output types are `unknown`.

## Before you start

- You can create, start and read an actor (see
  [Build your first state machine](../tutorials/01-first-state-machine.md)).
- You have `@jambudipa/xstate-effect` and `effect` installed.

## Steps

### 1. Declare the types in `setup`

Write the types as the `types` member of `setup`, in the `{} as { … }` form. Each member is
optional; declare only the ones you need.

```ts
import { setup } from "@jambudipa/xstate-effect"

interface CartContext {
  readonly customerId: string
  readonly items: ReadonlyArray<string>
}

type CartEvent =
  | { readonly type: "ADD_ITEM"; readonly item: string }
  | { readonly type: "CHECKOUT" }

interface CartInput {
  readonly customerId: string
}

interface CartOutput {
  readonly customerId: string
  readonly itemCount: number
}

export const cart = setup({
  types: {} as {
    context: CartContext
    events: CartEvent
    input: CartInput
    output: CartOutput
  }
})
```

| Member | What it types |
|---|---|
| `context` | The machine's context. Once declared, the machine config must give `context`, unless every member of the type is optional. |
| `events` | The events the machine takes, as a union discriminated by `type`. |
| `input` | What the context factory receives, and what `createActor`'s `input` option takes. |
| `output` | What the machine's `output` config must give, and the value inside `snapshot.output`. |

### 2. Write the machine against the types

Call `createMachine` on the setup. Give the context as a value, or as a factory of
`{ input }` when it depends on the input. In a transition under an event type, the event is
narrowed to that member of the union, so its own fields are typed. Give `output` as a value or
as a function of `{ context, event }` that returns the declared output type.

```ts
import { assign, createActor, setup } from "@jambudipa/xstate-effect"
import { Effect, Option } from "effect"

interface CartContext {
  readonly customerId: string
  readonly items: ReadonlyArray<string>
}

type CartEvent =
  | { readonly type: "ADD_ITEM"; readonly item: string }
  | { readonly type: "CHECKOUT" }

interface CartOutput {
  readonly customerId: string
  readonly itemCount: number
}

const cartMachine = setup({
  types: {} as {
    context: CartContext
    events: CartEvent
    input: { readonly customerId: string }
    output: CartOutput
  }
}).createMachine({
  id: "cart",
  // The factory receives the declared input
  context: ({ input }) => ({ customerId: input.customerId, items: [] }),
  initial: "shopping",
  states: {
    shopping: {
      on: {
        // `event` is { type: "ADD_ITEM"; item: string } here
        ADD_ITEM: { actions: assign({ items: ({ context, event }) => [...context.items, event.item] }) },
        CHECKOUT: { guard: ({ context }) => context.items.length > 0, target: "checkedOut" }
      }
    },
    checkedOut: { type: "final" }
  },
  // Must return a CartOutput
  output: ({ context }) => ({ customerId: context.customerId, itemCount: context.items.length })
})

const program = Effect.gen(function* () {
  // The input option is required: the input type does not accept undefined
  const actor = yield* createActor(cartMachine, { input: { customerId: "c-42" } })
  yield* actor.start
  yield* actor.send({ type: "ADD_ITEM", item: "book" })
  yield* actor.send({ type: "CHECKOUT" })

  // snapshot.output is an Option<CartOutput>: None until the machine reaches a top-level final state
  const snapshot = yield* actor.getSnapshot
  yield* Option.match(snapshot.output, {
    onNone: () => Effect.log("Not checked out yet"),
    onSome: (output) => Effect.log(`${output.customerId} bought ${output.itemCount} item(s)`)
  })
})

void Effect.runPromise(Effect.scoped(program))
```

### 3. Let the compiler check the use

With the types declared, each of these is a type error:

- a context value or an `assign` result that does not match `context`;
- `actor.send` with an event that is not a member of `events`;
- `createActor(cartMachine)` without `input`, or with an input of the wrong shape;
- an `output` config that does not give the `output` type.

## Variations

### Type a machine without `setup`

`createMachine` takes the same `types` member inside its config. Use it for a machine that
needs no named actions, guards, actors or delays.

```ts
import { createMachine } from "@jambudipa/xstate-effect"

export const toggle = createMachine({
  types: {} as {
    context: { readonly flips: number }
    events: { readonly type: "TOGGLE" }
    output: { readonly flips: number }
  },
  context: { flips: 0 },
  initial: "off",
  states: {
    off: { on: { TOGGLE: "on" } },
    on: { on: { TOGGLE: "done" } },
    done: { type: "final" }
  },
  output: ({ context }) => ({ flips: context.flips })
})
```

### Declare the tags and the emitted events

`types` also takes `tags`, which narrows what `snapshot.hasTag` and each state's `tags` accept,
and `emitted`, which narrows what `emit` takes and what `actor.on` listeners receive (see
[How to emit events and listen to them](emit-and-listen-to-events.md)). It also takes
`children`, `meta` and `transitionMeta`; [setup and setupWithSchema](../reference/setup.md)
lists them.

```ts
import { setup } from "@jambudipa/xstate-effect"

export const loader = setup({
  types: {} as {
    events: { readonly type: "LOAD" } | { readonly type: "LOADED" }
    tags: "busy"
  }
}).createMachine({
  initial: "idle",
  states: {
    idle: { on: { LOAD: "loading" } },
    // A tag outside "busy" is a type error here and in snapshot.hasTag
    loading: { tags: ["busy"], on: { LOADED: "idle" } }
  }
})
```

### Keep a child actor's reference in the context

Type the reference with `ActorRefFrom<typeof logic>`. The reference that `spawn` returns for
that logic fits the type.

```ts
import { assign, fromPromise, setup, type ActorRefFrom } from "@jambudipa/xstate-effect"

const fetchUser = fromPromise(({ input }: { input: { readonly id: string } }) =>
  Promise.resolve({ id: input.id, name: "Example user" })
)

export const users = setup({
  types: {} as {
    context: { readonly userRef: ActorRefFrom<typeof fetchUser> | null }
    events: { readonly type: "FETCH"; readonly userId: string }
  },
  actors: { fetchUser }
}).createMachine({
  context: { userRef: null },
  on: {
    FETCH: {
      actions: assign({
        userRef: ({ event, spawn }) => spawn("fetchUser", { input: { id: event.userId } })
      })
    }
  }
})
```

### Read the types back from a machine

Derive types from an existing machine instead of exporting each interface. `ContextFrom` and
`EventFrom` also accept the value that `setup` returns.

```ts
import {
  setup,
  type ContextFrom,
  type EventFrom,
  type InputFrom,
  type OutputFrom,
  type SnapshotFrom
} from "@jambudipa/xstate-effect"

export const counter = setup({
  types: {} as {
    context: { readonly count: number }
    events: { readonly type: "INC" } | { readonly type: "STOP" }
    input: { readonly start: number }
    output: number
  }
}).createMachine({
  context: ({ input }) => ({ count: input.start }),
  initial: "counting",
  states: { counting: { on: { STOP: "stopped" } }, stopped: { type: "final" } },
  output: ({ context }) => context.count
})

export type CounterContext = ContextFrom<typeof counter> // { readonly count: number }
export type CounterEvent = EventFrom<typeof counter> // { readonly type: "INC" } | { readonly type: "STOP" }
export type StopEvent = EventFrom<typeof counter, "STOP"> // { readonly type: "STOP" }
export type CounterInput = InputFrom<typeof counter> // { readonly start: number }
export type CounterOutput = OutputFrom<typeof counter> // number
export type CounterSnapshot = SnapshotFrom<typeof counter>
```

### Take the types from Effect Schemas

When the context and events are already described as Effect Schemas, see
[How to type a machine from Effect Schemas](validate-events-with-schema.md).

## Related

- [setup and setupWithSchema](../reference/setup.md) — every member of `types` and of the setup.
- [Type utilities](../reference/type-utilities.md) — `ContextFrom`, `EventFrom`, `InputFrom`,
  `OutputFrom`, `SnapshotFrom`, `ActorRefFrom` and the others.
- [Keep data in context](../tutorials/02-working-with-context.md) — a lesson on context and
  `assign`.
