---
title: How to give a machine's actions and actors Effect services
doc-type: how-to
sources: [packages/core/src/setup.ts, packages/core/src/Actor.ts]
---

# How to give a machine's actions and actors Effect services

> **TL;DR:** Build the machine with `setup`. An action that returns an Effect, and an actor
> built with `fromEffect`, add the services their Effects need to the machine's requirements, so
> `createActor` asks for them beside `Scope`. Provide them with `Effect.provideService` or a
> `Layer` around the Effect that calls `createActor`. The actor keeps the services it was
> created with, and every action (the initial entry actions included) and every child actor
> receives them.

## When you need this

Use this guide when an action or an invoked actor needs a dependency, such as a mailer, a
repository or an HTTP client, and you want to supply it as an Effect service rather than import
it directly. The compiler then reports a service that you forgot to provide, and a test can
swap the implementation without changing the machine.

## Before you start

- You can create and run an actor (see
  [Build your first state machine](../tutorials/01-first-state-machine.md)).
- You know how to define an Effect service with `Context.Service` and provide it.

## Steps

### 1. Define the service

```ts
import { Context, Effect } from "effect"

export class Mailer extends Context.Service<Mailer, {
  readonly send: (to: string, subject: string) => Effect.Effect<void>
}>()("app/Mailer") {}
```

### 2. Read the service in a `setup` action

Write the action in `setup({ actions })` as a function that returns an Effect. The Effect reads
the service with `yield*`. The machine's requirements are now `Mailer`, and so are those of the
Effect that `createActor` returns.

```ts
import { setup } from "@jambudipa/xstate-effect"
import { Context, Effect } from "effect"

class Mailer extends Context.Service<Mailer, {
  readonly send: (to: string, subject: string) => Effect.Effect<void>
}>()("app/Mailer") {}

export const signupMachine = setup({
  types: {} as {
    context: { readonly email: string }
    events: { readonly type: "CONFIRM" }
    input: { readonly email: string }
  },
  actions: {
    sendWelcome: ({ context }) =>
      Effect.gen(function* () {
        const mailer = yield* Mailer
        yield* mailer.send(context.email, "Welcome")
      })
  }
}).createMachine({
  context: ({ input }) => ({ email: input.email }),
  entry: "sendWelcome",
  initial: "pending",
  states: {
    pending: { on: { CONFIRM: "confirmed" } },
    confirmed: { type: "final" }
  }
})
```

### 3. Provide the service and run the program

Provide the service to the Effect that calls `createActor`. The actor captures the services at
creation, so `start`, `send` and `getSnapshot` need none of their own. If you leave a service
out, `Effect.runPromise` reports a type error, because the program still requires it.

```ts
import { createActor, setup } from "@jambudipa/xstate-effect"
import { Context, Effect } from "effect"

class Mailer extends Context.Service<Mailer, {
  readonly send: (to: string, subject: string) => Effect.Effect<void>
}>()("app/Mailer") {}

const signupMachine = setup({
  types: {} as {
    context: { readonly email: string }
    events: { readonly type: "CONFIRM" }
    input: { readonly email: string }
  },
  actions: {
    sendWelcome: ({ context }) =>
      Effect.gen(function* () {
        const mailer = yield* Mailer
        yield* mailer.send(context.email, "Welcome")
      })
  }
}).createMachine({
  context: ({ input }) => ({ email: input.email }),
  entry: "sendWelcome",
  initial: "pending",
  states: {
    pending: { on: { CONFIRM: "confirmed" } },
    confirmed: { type: "final" }
  }
})

const program = Effect.gen(function* () {
  const actor = yield* createActor(signupMachine, { input: { email: "user@example.com" } })
  // The entry action runs here, with the Mailer the actor captured
  yield* actor.start
  yield* actor.send({ type: "CONFIRM" })
})

void Effect.runPromise(
  Effect.scoped(program).pipe(
    Effect.provideService(Mailer, {
      send: (to, subject) => Effect.log(`To ${to}: ${subject}`)
    })
  )
)
```

## Variations

### Give an invoked actor a service

Actor logic from `fromEffect` carries the requirements of its Effect. Put it in
`setup({ actors })` and invoke it by name: the machine's requirements then include the actor's,
and the actor reads the services when it starts. The same holds for `fromEffectBackground`,
`fromEffectRetry` and `fromStream`, and for a child machine built with `setup`.

```ts
import { assign, fromEffect, setup } from "@jambudipa/xstate-effect"
import { Context, Effect, Option } from "effect"

class Directory extends Context.Service<Directory, {
  readonly displayName: (email: string) => Effect.Effect<string>
}>()("app/Directory") {}

const lookUpName = fromEffect(({ input }: { input: { readonly email: string } }) =>
  Effect.gen(function* () {
    const directory = yield* Directory
    return yield* directory.displayName(input.email)
  })
)

// createActor(profileMachine) requires Scope and Directory
export const profileMachine = setup({
  types: {} as { context: { readonly email: string; readonly name: string } },
  actors: { lookUpName }
}).createMachine({
  context: { email: "user@example.com", name: "" },
  initial: "loading",
  states: {
    loading: {
      invoke: {
        src: "lookUpName",
        input: ({ context }) => ({ email: context.email }),
        onDone: {
          target: "ready",
          actions: assign({ name: ({ event }) => Option.getOrElse(event.output, () => "") })
        }
      }
    },
    ready: {}
  }
})
```

### Provide the services with a `Layer`

Provide a `Layer` once for the whole program when the services have their own dependencies or
need set-up and clean-up.

```ts
import { createActor, setup } from "@jambudipa/xstate-effect"
import { Context, Effect, Layer } from "effect"

class Mailer extends Context.Service<Mailer, {
  readonly send: (to: string, subject: string) => Effect.Effect<void>
}>()("app/Mailer") {}

const MailerLive = Layer.succeed(Mailer, {
  send: (to, subject) => Effect.log(`To ${to}: ${subject}`)
})

const greeter = setup({
  actions: {
    greet: () =>
      Effect.gen(function* () {
        const mailer = yield* Mailer
        yield* mailer.send("user@example.com", "Hello")
      })
  }
}).createMachine({ entry: "greet" })

const program = Effect.gen(function* () {
  const actor = yield* createActor(greeter)
  yield* actor.start
})

void Effect.runPromise(Effect.scoped(program).pipe(Effect.provide(MailerLive)))
```

### Swap a service in a test

Keep the machine as it is and provide a test implementation instead, for example one that
records each call. Nothing in the machine names the implementation, so no `provide` call on
the machine is needed.

### Where services are not tracked

The compiler tracks services only through `setup`. In these cases nothing asks you for the
service, and an Effect that reads a missing one fails with `Service not found`, which gives the
actor the status `error`:

- **`createMachine` without `setup`.** Its machine requires no services, whatever its actions'
  Effects need. Use `setup` for a machine whose actions need services.
- **Inline actions in a `setup` machine's config.** Only the actions named in
  `setup({ actions })` count. Name an action in `setup` when its Effect needs a service.
- **Replacement actions given to `machine.provide`.** A replacement action that needs a service
  the machine did not already require adds nothing to the requirements. Provide that service
  yourself around `createActor`. A replacement actor is different: it must have the replaced
  logic's type, so one that needs a new service is a type error.

A guard cannot read a service: it may return an `Effect<boolean>`, but that Effect has no
requirements. A failure of an action's Effect also gives the actor the status `error`; see
[How to handle actor errors](handle-actor-errors.md).

## Related

- [How services reach actions and actors](../explanation/services-and-requirements.md) — why
  the actor captures its services at creation.
- [createActor and the actor](../reference/create-actor.md) — the signatures of `createActor`
  and its requirements.
- [fromEffect, fromEffectBackground and fromEffectRetry](../reference/actors/from-effect.md) —
  Effect-based actor logic and its requirements.
- [setup and setupWithSchema](../reference/setup.md) — the `actions` and `actors` records.
